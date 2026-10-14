'use strict';
/*
 * group-vote — votación en grupo con QR.
 * Rutas:
 *   GET  /                  página del organizador
 *   GET  /v/:code           página de votación
 *   GET  /api/places?q=     buscar lugares
 *   POST /api/rooms         crear sala {title, placeIds[]}
 *   GET  /api/rooms/:code   estado de la sala + votos
 *   POST /api/rooms/:code/vote   votar {placeId}
 *   POST /api/rooms/:code/close  cerrar {organizerToken}
 *   GET  /api/rooms/:code/qr.png QR del enlace de votación
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const multer = require('multer');
const archiver = require('archiver');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'groupvote.db'));
db.pragma('journal_mode = WAL');
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
db.exec(`
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT '',
  address TEXT DEFAULT '', lat REAL, lng REAL, hours TEXT DEFAULT '',
  hours_json TEXT DEFAULT '',
  region TEXT DEFAULT '',
  notes TEXT DEFAULT '', image TEXT, neighborhood TEXT DEFAULT '',
  search_text TEXT DEFAULT '', reel_url TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY, title TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  closed_at INTEGER, organizer_token TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS room_candidates (
  room_code TEXT NOT NULL, place_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_code, place_id)
);
CREATE TABLE IF NOT EXISTS votes (
  room_code TEXT NOT NULL, device_token TEXT NOT NULL,
  place_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (room_code, device_token)
);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY, room_code TEXT NOT NULL,
  uploader_name TEXT DEFAULT '', url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_room ON photos(room_code);
`);
 // Migración: agregar voter_name si la tabla ya existía sin esa columna
if (!db.prepare('PRAGMA table_info(votes)').all().some(c => c.name === 'voter_name')) {
  db.exec("ALTER TABLE votes ADD COLUMN voter_name TEXT DEFAULT ''");
}
// Migración: fecha del plan (calendario) en las salas
if (!db.prepare('PRAGMA table_info(rooms)').all().some(c => c.name === 'event_date')) {
  db.exec("ALTER TABLE rooms ADD COLUMN event_date TEXT DEFAULT ''");
  // las salas viejas quedan con la fecha de su creación
  db.exec("UPDATE rooms SET event_date = date(created_at/1000, 'unixepoch') WHERE event_date = '' OR event_date IS NULL");
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_votes_room ON votes(room_code);
`);
if (!db.prepare('PRAGMA table_info(places)').all().some(c => c.name === 'search_text')) {
  db.exec("ALTER TABLE places ADD COLUMN search_text TEXT DEFAULT ''");
}
if (!db.prepare('PRAGMA table_info(places)').all().some(c => c.name === 'hours_json')) {
  db.exec("ALTER TABLE places ADD COLUMN hours_json TEXT DEFAULT ''");
}
if (!db.prepare('PRAGMA table_info(places)').all().some(c => c.name === 'region')) {
  db.exec("ALTER TABLE places ADD COLUMN region TEXT DEFAULT ''");
}
if (!db.prepare('PRAGMA table_info(places)').all().some(c => c.name === 'reel_url')) {
  db.exec("ALTER TABLE places ADD COLUMN reel_url TEXT DEFAULT ''");
}

const ROOM_TTL_MS = 24 * 3600 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genCode(n = 6) {
  let s = '';
  const buf = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return s;
}
function uniqueCode() {
  for (let i = 0; i < 20; i++) {
    const c = genCode();
    if (!db.prepare('SELECT 1 FROM rooms WHERE code=?').get(c)) return c;
  }
  return genCode(8);
}
function getDeviceToken(req, res) {
  const m = /(?:^|;\s*)gv_device=([a-f0-9]{32})/.exec(req.headers.cookie || '');
  if (m) return m[1];
  const t = crypto.randomBytes(16).toString('hex');
  res.cookie('gv_device', t, { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'Lax', path: '/' });
  return t;
}
function voteUrl(req, code) {
  return req.protocol + '://' + req.get('host') + '/v/' + code;
}
function getRoom(code) {
  return db.prepare('SELECT * FROM rooms WHERE code=?').get(String(code).toUpperCase());
}
function roomState(room) {
  const now = Date.now();
  if (!room) return null;
  if (now > room.expires_at) return 'expired';
  if (room.closed_at) return 'closed';
  return 'open';
}
function roomPayload(req, room, deviceToken) {
  const state = roomState(room);
  const cands = db.prepare(
    `SELECT p.id, p.name, p.type, p.address, p.hours, p.notes, p.image, p.neighborhood, p.reel_url, p.lat, p.lng
     FROM room_candidates rc JOIN places p ON p.id = rc.place_id
     WHERE rc.room_code=? ORDER BY rc.position`).all(room.code);
  const counts = db.prepare(
    'SELECT place_id, COUNT(*) AS c FROM votes WHERE room_code=? GROUP BY place_id').all(room.code);
  const byId = {};
  for (const r of counts) byId[r.place_id] = r.c;
  const voterRows = db.prepare(
    'SELECT place_id, voter_name FROM votes WHERE room_code=? ORDER BY created_at').all(room.code);
  const votersById = {};
  for (const r of voterRows) {
    (votersById[r.place_id] = votersById[r.place_id] || []).push(r.voter_name || '');
  }
  let total = 0;
  const candidates = cands.map(c => {
    const v = byId[c.id] || 0; total += v;
    return { ...c, votes: v, voters: votersById[c.id] || [] };
  });
  candidates.sort((a, b) => b.votes - a.votes);
  const mine = deviceToken
    ? db.prepare('SELECT place_id FROM votes WHERE room_code=? AND device_token=?').get(room.code, deviceToken)
    : null;
  const winner = state !== 'open' && candidates.length ? candidates[0] : null;
  const photos = db.prepare(
    'SELECT id, uploader_name AS uploader, url, created_at AS createdAt FROM photos WHERE room_code=? ORDER BY created_at'
  ).all(room.code);
  return {
    code: room.code, title: room.title, state,
    createdAt: room.created_at, expiresAt: room.expires_at, closedAt: room.closed_at,
    eventDate: room.event_date || null,
    candidates, totalVotes: total,
    myVote: mine ? mine.place_id : null,
    winner: winner && (winner.votes > 0 || state !== 'open') ? winner : null,
    photos,
    voteUrl: voteUrl(req, room.code)
  };
}

// Siembra inicial desde data/places.json (para el deploy, donde no está el mapa)
function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM places').get().c;
  if (n > 0) return n;
  const seedPath = path.join(__dirname, 'data', 'places.json');
  if (!fs.existsSync(seedPath)) { console.log('Sin semilla: data/places.json no existe. Corre: npm run import'); return 0; }
  const places = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const ins = db.prepare(`INSERT OR REPLACE INTO places
    (id, name, type, address, lat, lng, hours, hours_json, region, notes, image, neighborhood, search_text, reel_url)
    VALUES (@id, @name, @type, @address, @lat, @lng, @hours, @hours_json, @region, @notes, @image, @neighborhood, @search_text, @reel_url)`);
  db.transaction(list => {
    for (const p of list) {
      if (!p.search_text) p.search_text = norm([p.name, p.type, p.address, p.notes, p.neighborhood].join(' '));
      ins.run(p);
    }
  })(places);
  console.log('Sembrados ' + places.length + ' lugares desde data/places.json');
  return places.length;
}
seedIfEmpty();

// Limpieza periódica de salas vencidas
setInterval(() => {
  const cutoff = Date.now() - 3600 * 1000;
  const old = db.prepare('SELECT code FROM rooms WHERE expires_at < ?').all(cutoff).map(r => r.code);
  if (!old.length) return;
  const del = db.transaction(codes => {
    for (const c of codes) {
      db.prepare('DELETE FROM votes WHERE room_code=?').run(c);
      db.prepare('DELETE FROM room_candidates WHERE room_code=?').run(c);
      db.prepare('DELETE FROM rooms WHERE code=?').run(c);
    }
  });
  del(old);
  console.log('Limpieza: ' + old.length + ' salas vencidas eliminadas');
}, 3600 * 1000);

// ---- Abierto ahora (horarios estructurados del mapa privado) ----
const WD_SHORT = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function isOpenNow(hoursJson) {
  if (!hoursJson) return false;
  try {
    const { tz, periods } = JSON.parse(hoursJson);
    if (!periods) return false;
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/Argentina/Buenos_Aires',
      weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false
    });
    const parts = {};
    for (const p of dtf.formatToParts(new Date())) parts[p.type] = p.value;
    const wd = WD_SHORT[parts.weekday];
    if (wd == null) return false;
    const t = (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10);
    const today = periods[String(wd)] || [];
    for (const [o, c] of today) {
      if (t >= o && (c == null || t < Math.min(c, 1440))) return true;
    }
    // trasnoche del dia anterior (cierre > 1440)
    const prev = periods[String((wd + 6) % 7)] || [];
    for (const [o, c] of prev) {
      if (c != null && c > 1440 && t < (c - 1440)) return true;
    }
    return false;
  } catch { return false; }
}

// ---- Lugares cercanos a un punto (para elegir por mapa) ----
app.get('/api/places/near', (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return res.status(400).json({ error: 'Faltan coordenadas' });
  const miles = Math.min(200, Math.max(0.1, parseFloat(req.query.miles) || 10));
  const openNow = req.query.openNow === '1';
  const region = String(req.query.region || '').trim();
  const regionFilter = region ? 'AND region = ?' : '';
  const rows = db.prepare(`SELECT id, name, type, address, lat, lng, hours, hours_json, notes, image, neighborhood, reel_url
    FROM places WHERE lat IS NOT NULL AND lng IS NOT NULL ${regionFilter}`).all(...(region ? [region] : []));
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const out = [];
  for (const p of rows) {
    if (openNow && !isOpenNow(p.hours_json)) continue;
    const a = Math.sin(toRad(p.lat - lat) / 2) ** 2 +
      Math.cos(toRad(lat)) * Math.cos(toRad(p.lat)) * Math.sin(toRad(p.lng - lng) / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(a));
    if (d <= miles) out.push({ ...p, hours_json: undefined, distance: Math.round(d * 10) / 10 });
  }
  out.sort((a, b) => a.distance - b.distance);
  res.json({ places: out.slice(0, 250), count: out.length });
});

// ---- Eliminar votación (solo organizador) ----
app.delete('/api/rooms/:code', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'No encontrada' });
  const t = String((req.body && req.body.organizerToken) || '');
  if (!t || t !== room.organizer_token) return res.status(403).json({ error: 'No autorizado' });
  db.prepare('DELETE FROM votes WHERE room_code=?').run(room.code);
  db.prepare('DELETE FROM room_candidates WHERE room_code=?').run(room.code);
  db.prepare('DELETE FROM rooms WHERE code=?').run(room.code);
  res.json({ ok: true });
});

// ---- Resolver links de Instagram / Google Maps para añadir lugares ----
function numOrNull(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
async function resolveGmapsLink(rawUrl) {
  let url = rawUrl;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (group-vote)' } });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) url = new URL(loc, url).toString();
    else break;
  }
  const final = url;
  let name = '';
  const pm = /\/place\/([^/@?]+)/.exec(final);
  if (pm) name = decodeURIComponent(pm[1].replace(/\+/g, ' '));
  let lat = null, lng = null;
  const cm = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(final);
  if (cm) { lat = parseFloat(cm[1]); lng = parseFloat(cm[2]); }
  if (lat == null) {
    const dm = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(final);
    if (dm) { lat = parseFloat(dm[1]); lng = parseFloat(dm[2]); }
  }
  try {
    const u = new URL(final);
    if (!name) name = u.searchParams.get('q') || u.searchParams.get('query') || '';
  } catch {}
  let address = '';
  if (lat != null) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2`, {
        headers: { 'User-Agent': 'group-vote/1.0' }, signal: AbortSignal.timeout(8000)
      });
      if (r.ok) address = (await r.json()).display_name || '';
    } catch {}
  }
  return { name, address, lat, lng, url: final };
}

app.post('/api/places/resolve', async (req, res) => {
  const rawUrl = String(req.body.url || '').trim();
  let u;
  try { u = new URL(rawUrl); } catch { return res.status(400).json({ error: 'Link inválido' }); }
  const host = u.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(u.protocol)) return res.status(400).json({ error: 'Link inválido' });
  // Instagram: reel o post
  if (host.includes('instagram.com')) {
    const m = /\/(reel|p)\/([A-Za-z0-9_-]+)/.exec(u.pathname);
    if (!m) return res.status(400).json({ error: 'Usa el link de un reel o post de Instagram' });
    const reelUrl = `https://www.instagram.com/${m[1]}/${m[2]}/`;
    let meta = {};
    try {
      const r = await fetch('https://www.instagram.com/oembed?url=' + encodeURIComponent(reelUrl),
        { headers: { 'User-Agent': 'Mozilla/5.0 (group-vote)' }, signal: AbortSignal.timeout(8000) });
      if (r.ok) meta = await r.json();
    } catch {}
    return res.json({ kind: 'instagram', reelUrl,
      author: meta.author_name || '', caption: (meta.title || '').slice(0, 220),
      thumbnail: meta.thumbnail_url || '' });
  }
  // Google Maps
  if (host === 'maps.app.goo.gl' || host === 'goo.gl' ||
      (host.includes('google.') && u.pathname.startsWith('/maps')) || host.includes('maps.google.')) {
    try {
      const g = await resolveGmapsLink(rawUrl);
      if (!g.name && g.lat == null) return res.status(422).json({ error: 'No pude leer ese link de Google Maps' });
      return res.json({ kind: 'gmaps', ...g });
    } catch (e) {
      return res.status(422).json({ error: 'No pude leer ese link de Google Maps' });
    }
  }
  return res.status(400).json({ error: 'Link no reconocido (usa Instagram o Google Maps)' });
});

app.post('/api/places/custom', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'Falta el nombre del lugar' });
  const id = 'custom-' + crypto.randomBytes(6).toString('hex');
  const rec = {
    id, name,
    type: String(req.body.type || '').slice(0, 60),
    address: String(req.body.address || '').slice(0, 250),
    lat: numOrNull(req.body.lat), lng: numOrNull(req.body.lng),
    hours: '', notes: String(req.body.notes || '').slice(0, 500),
    image: '', neighborhood: '',
    reel_url: String(req.body.reelUrl || '').slice(0, 300)
  };
  rec.search_text = norm([rec.name, rec.type, rec.address, rec.notes].join(' '));
  db.prepare(`INSERT INTO places
    (id, name, type, address, lat, lng, hours, notes, image, neighborhood, search_text, reel_url)
    VALUES (@id, @name, @type, @address, @lat, @lng, @hours, @notes, @image, @neighborhood, @search_text, @reel_url)`)
    .run(rec);
  res.json({ place: rec });
});

// ---- API ----
app.get('/api/places', (req, res) => {
  const q = norm((req.query.q || '').trim());
  const region = String(req.query.region || '').trim();
  const openNow = req.query.openNow === '1';
  const regionFilter = region ? 'AND region = ?' : '';
  const params = [];
  let sql;
  if (q) {
    sql = `SELECT id, name, type, address, hours, hours_json, notes, image, neighborhood, reel_url, lat, lng FROM places
       WHERE search_text LIKE ? ${regionFilter} ORDER BY name LIMIT 60`;
    params.push('%' + q.replace(/[%_]/g, '') + '%');
  } else {
    sql = `SELECT id, name, type, address, hours, hours_json, notes, image, neighborhood, reel_url, lat, lng FROM places
       WHERE 1=1 ${regionFilter} ORDER BY name LIMIT 60`;
  }
  if (region) params.push(region);
  let places = db.prepare(sql).all(...params);
  if (openNow) places = places.filter(p => isOpenNow(p.hours_json));
  res.json({ places: places.map(({ hours_json, ...p }) => p) });
});

// ---- Votaciones en curso (lista pública, se actualiza en vivo) ----
app.get('/api/rooms/active', (req, res) => {
  const now = Date.now();
  const rooms = db.prepare(`SELECT code, title, created_at, expires_at, closed_at, event_date FROM rooms
    WHERE expires_at > ? AND closed_at IS NULL ORDER BY event_date, created_at DESC`).all(now);
  const out = rooms.map(r => ({
    code: r.code, title: r.title,
    createdAt: r.created_at, expiresAt: r.expires_at, eventDate: r.event_date || null,
    candidates: db.prepare('SELECT COUNT(*) AS c FROM room_candidates WHERE room_code=?').get(r.code).c,
    votes: db.prepare('SELECT COUNT(*) AS c FROM votes WHERE room_code=?').get(r.code).c
  }));
  res.json({ rooms: out });
});

// ---- Calendario: votaciones (abiertas y cerradas) agrupadas por fecha del plan ----
app.get('/api/calendar', (req, res) => {
  const days = Math.min(60, Math.max(1, parseInt(req.query.days, 10) || 14));
  let from = String(req.query.from || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.parse(from + 'T00:00:00Z') + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const now = Date.now();
  const rooms = db.prepare(
    `SELECT code, title, event_date, created_at, expires_at, closed_at FROM rooms
     WHERE event_date >= ? AND event_date < ? ORDER BY event_date, created_at`).all(from, to);
  const out = [];
  for (const r of rooms) {
    const state = now > r.expires_at ? 'expired' : (r.closed_at ? 'closed' : 'open');
    if (state === 'expired') continue;
    let winnerName = null;
    if (state === 'closed') {
      const w = db.prepare(
        `SELECT p.name FROM votes v JOIN places p ON p.id = v.place_id
         WHERE v.room_code=? GROUP BY v.place_id ORDER BY COUNT(*) DESC LIMIT 1`).get(r.code);
      winnerName = w ? w.name : null;
    }
    out.push({
      code: r.code, title: r.title, eventDate: r.event_date,
      state,
      candidates: db.prepare('SELECT COUNT(*) AS c FROM room_candidates WHERE room_code=?').get(r.code).c,
      votes: db.prepare('SELECT COUNT(*) AS c FROM votes WHERE room_code=?').get(r.code).c,
      winnerName
    });
  }
  res.json({ rooms: out, from, days });
});

// ---- Regiones (carpetas) con centro y cantidad ----
const REGION_LABELS = {
  argentina: 'Argentina', orlando: 'Orlando', pr: 'Puerto Rico',
  spacecoast: 'Space Coast', miami: 'Miami', boston: 'Boston',
  vegas: 'Las Vegas', newyork: 'Nueva York', colombia: 'Colombia',
  cdmx: 'Ciudad de México', espana: 'España', tulum: 'Tulum',
  losangeles: 'Los Ángeles', philly: 'Filadelfia', tampa: 'Tampa',
  stpete: 'St. Pete'
};
app.get('/api/regions', (req, res) => {
  const rows = db.prepare(`SELECT region, COUNT(*) AS count, AVG(lat) AS lat, AVG(lng) AS lng
    FROM places WHERE region IS NOT NULL AND region != '' AND lat IS NOT NULL GROUP BY region ORDER BY count DESC`).all();
  res.json({ regions: rows.map(r => ({
    id: r.region, label: REGION_LABELS[r.region] || r.region,
    count: r.count, lat: Math.round(r.lat * 10000) / 10000, lng: Math.round(r.lng * 10000) / 10000
  })) });
});
app.post('/api/rooms', async (req, res) => {  const title = String(req.body.title || '').trim().slice(0, 80);
  const placeIds = Array.isArray(req.body.placeIds) ? [...new Set(req.body.placeIds.map(String))].slice(0, 12) : [];
  if (!title) return res.status(400).json({ error: 'Falta el título' });
  if (placeIds.length < 2) return res.status(400).json({ error: 'Elige al menos 2 lugares' });
  const ok = db.prepare(`SELECT COUNT(*) AS c FROM places WHERE id IN (${placeIds.map(() => '?').join(',')})`).get(...placeIds).c;
  if (ok !== placeIds.length) return res.status(400).json({ error: 'Algún lugar no existe' });
  const code = uniqueCode();
  const organizerToken = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  // Fecha del plan (calendario): la sala vive hasta el fin del día del plan + 1 día de margen
  const todayStr = new Date().toISOString().slice(0, 10);
  let eventDate = String(req.body.eventDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || isNaN(Date.parse(eventDate + 'T00:00:00Z'))) eventDate = todayStr;
  if (eventDate < todayStr) eventDate = todayStr;
  const expiresAt = Date.parse(eventDate + 'T00:00:00Z') + 2 * 24 * 3600 * 1000;
  db.prepare('INSERT INTO rooms (code, title, created_at, expires_at, organizer_token, event_date) VALUES (?,?,?,?,?,?)')
    .run(code, title, now, expiresAt, organizerToken, eventDate);
  const ins = db.prepare('INSERT INTO room_candidates (room_code, place_id, position) VALUES (?,?,?)');
  db.transaction(() => { placeIds.forEach((id, i) => ins.run(code, id, i)); })();
  const url = voteUrl(req, code);
  const qrDataUrl = await QRCode.toDataURL(url, { width: 512, margin: 1 });
  res.json({ code, title, voteUrl: url, qrDataUrl, organizerToken, expiresAt, eventDate });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  const token = getDeviceToken(req, res);
  res.json(roomPayload(req, room, token));
});

app.post('/api/rooms/:code/vote', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  if (roomState(room) !== 'open') return res.status(409).json({ error: 'La votación está cerrada' });
  const placeId = String(req.body.placeId || '');
  const voterName = String(req.body.name || '').slice(0, 40).trim();
  const isCandidate = db.prepare('SELECT 1 FROM room_candidates WHERE room_code=? AND place_id=?').get(room.code, placeId);
  if (!isCandidate) return res.status(400).json({ error: 'Candidato inválido' });
  const token = getDeviceToken(req, res);
  db.prepare(`INSERT INTO votes (room_code, device_token, place_id, created_at, voter_name) VALUES (?,?,?,?,?)
              ON CONFLICT(room_code, device_token) DO UPDATE SET place_id=excluded.place_id, created_at=excluded.created_at, voter_name=excluded.voter_name`)
    .run(room.code, token, placeId, Date.now(), voterName);
  res.json(roomPayload(req, room, token));
});

app.post('/api/rooms/:code/close', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  if (req.body.organizerToken !== room.organizer_token) return res.status(403).json({ error: 'No autorizado' });
  if (!room.closed_at) db.prepare('UPDATE rooms SET closed_at=? WHERE code=?').run(Date.now(), room.code);
  const fresh = getRoom(room.code);
  res.json(roomPayload(req, fresh, getDeviceToken(req, res)));
});

app.post('/api/rooms/:code/reopen', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  if (req.body.organizerToken !== room.organizer_token) return res.status(403).json({ error: 'No autorizado' });
  // Reabre con 24 h frescas desde ahora, conservando los votos que ya había
  db.prepare('UPDATE rooms SET closed_at=NULL, expires_at=? WHERE code=?').run(Date.now() + 24 * 3600 * 1000, room.code);
  const fresh = getRoom(room.code);
  res.json(roomPayload(req, fresh, getDeviceToken(req, res)));
});

// ---- Editar candidatos de una votación abierta (solo organizador) ----
app.post('/api/rooms/:code/candidates', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  if (req.body.organizerToken !== room.organizer_token) return res.status(403).json({ error: 'No autorizado' });
  if (roomState(room) !== 'open') return res.status(409).json({ error: 'La votación está cerrada' });
  const placeId = String(req.body.placeId || '');
  const exists = db.prepare('SELECT 1 FROM places WHERE id=?').get(placeId);
  if (!exists) return res.status(400).json({ error: 'Lugar no existe' });
  const dup = db.prepare('SELECT 1 FROM room_candidates WHERE room_code=? AND place_id=?').get(room.code, placeId);
  if (dup) return res.status(409).json({ error: 'Ya está en la votación' });
  const n = db.prepare('SELECT COUNT(*) AS c FROM room_candidates WHERE room_code=?').get(room.code).c;
  if (n >= 12) return res.status(409).json({ error: 'Máximo 12 lugares' });
  db.prepare('INSERT INTO room_candidates (room_code, place_id, position) VALUES (?,?,?)').run(room.code, placeId, n);
  res.json(roomPayload(req, room, getDeviceToken(req, res)));
});

app.delete('/api/rooms/:code/candidates/:placeId', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  if (req.body.organizerToken !== room.organizer_token) return res.status(403).json({ error: 'No autorizado' });
  if (roomState(room) !== 'open') return res.status(409).json({ error: 'La votación está cerrada' });
  const votes = db.prepare('SELECT COUNT(*) AS c FROM votes WHERE room_code=? AND place_id=?').get(room.code, req.params.placeId).c;
  if (votes > 0) return res.status(409).json({ error: 'Tiene votos, no se puede quitar' });
  db.prepare('DELETE FROM room_candidates WHERE room_code=? AND place_id=?').run(room.code, req.params.placeId);
  res.json(roomPayload(req, room, getDeviceToken(req, res)));
});

// ---- Fotos de la experiencia (solo cuando la votación está cerrada) ----
// Las fotos se suben a un host externo gratuito y sin cuentas para que
// sobrevivan a los redeploys, que borran el disco del contenedor.
// Cadena: catbox.moe (permanente) -> x0.at (3-100 días) -> uguu.se (3 h) -> tmpfiles.org (60 min).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 6 }
});
async function catboxUpload(buf, filename) {
  const fd = new FormData();
  fd.append('reqtype', 'fileupload');
  fd.append('fileToUpload', new Blob([buf], { type: 'image/jpeg' }), filename || 'foto.jpg');
  const r = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST', body: fd,
    headers: { 'User-Agent': 'Mozilla/5.0 (group-vote)' },
    signal: AbortSignal.timeout(60000)
  });
  if (!r.ok) throw new Error('catbox ' + r.status);
  const url = (await r.text()).trim();
  if (!url.startsWith('https://files.catbox.moe/')) throw new Error('catbox respuesta inválida');
  return url;
}
async function tmpfilesUpload(buf, filename) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'image/jpeg' }), filename || 'foto.jpg');
  const r = await fetch('https://tmpfiles.org/api/v1/upload', {
    method: 'POST', body: fd,
    headers: { 'User-Agent': 'Mozilla/5.0 (group-vote)' },
    signal: AbortSignal.timeout(60000)
  });
  if (!r.ok) throw new Error('tmpfiles ' + r.status);
  const j = await r.json().catch(() => ({}));
  const pageUrl = j && j.data && j.data.url;
  if (!pageUrl || !pageUrl.startsWith('https://tmpfiles.org/')) throw new Error('tmpfiles respuesta inválida');
  // La API devuelve la página del archivo, no el archivo: la URL directa está en el HTML.
  const html = await (await fetch(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (group-vote)' },
    signal: AbortSignal.timeout(30000)
  })).text();
  const m = html.match(/https:\/\/tmpfiles\.org\/dl\/[^"'\s<>]+/);
  if (!m) throw new Error('tmpfiles sin url directa');
  return m[0];
}
async function x0atUpload(buf, filename) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'image/jpeg' }), filename || 'foto.jpg');
  const r = await fetch('https://x0.at/', {
    method: 'POST', body: fd,
    headers: { 'User-Agent': 'Mozilla/5.0 (group-vote)' },
    signal: AbortSignal.timeout(60000)
  });
  if (!r.ok) throw new Error('x0at ' + r.status);
  const url = (await r.text()).trim();
  if (!url.startsWith('https://x0.at/')) throw new Error('x0at respuesta inválida');
  return url;
}
async function uguuUpload(buf, filename) {
  const fd = new FormData();
  fd.append('files[]', new Blob([buf], { type: 'image/jpeg' }), filename || 'foto.jpg');
  const r = await fetch('https://uguu.se/upload.php', {
    method: 'POST', body: fd,
    headers: { 'User-Agent': 'Mozilla/5.0 (group-vote)' },
    signal: AbortSignal.timeout(60000)
  });
  if (!r.ok) throw new Error('uguu ' + r.status);
  const j = await r.json().catch(() => ({}));
  const url = j && j.files && j.files[0] && j.files[0].url;
  if (!url || !url.startsWith('https://')) throw new Error('uguu respuesta inválida');
  return url;
}
async function externalUpload(buf, filename) {
  for (let i = 0; i < 3; i++) {
    try { return await catboxUpload(buf, filename); } catch (e) { /* reintentar */ }
    await new Promise(r => setTimeout(r, 800));
  }
  for (const fn of [x0atUpload, uguuUpload, tmpfilesUpload]) {
    try { return await fn(buf, filename); } catch (e) { /* siguiente */ }
  }
  throw new Error('no se pudo subir la foto a ningún host');
}
app.post('/api/rooms/:code/photos', upload.array('photos', 6), async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  if (roomState(room) === 'open') return res.status(409).json({ error: 'La votación sigue abierta' });
  const files = (req.files || []).filter(f => f.mimetype && f.mimetype.startsWith('image/'));
  if (!files.length) return res.status(400).json({ error: 'Sin fotos válidas' });
  const name = String(req.body.name || '').slice(0, 40).trim();
  const out = [];
  const ins = db.prepare('INSERT INTO photos (id, room_code, uploader_name, url, created_at) VALUES (?,?,?,?,?)');
  for (const f of files) {
    try {
      const url = await externalUpload(f.buffer, f.originalname);
      const id = crypto.randomBytes(8).toString('hex');
      ins.run(id, room.code, name, url, Date.now());
      out.push({ id, uploader: name, url });
    } catch (e) {
      return res.status(502).json({ error: 'No se pudo subir la foto' });
    }
  }
  res.json({ photos: out });
});
app.delete('/api/rooms/:code/photos/:id', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  if (String((req.body && req.body.organizerToken) || '') !== room.organizer_token)
    return res.status(403).json({ error: 'No autorizado' });
  db.prepare('DELETE FROM photos WHERE id=? AND room_code=?').run(req.params.id, room.code);
  res.json({ ok: true });
});
app.get('/api/rooms/:code/photos.zip', async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Sala no encontrada' });
  if (String(req.query.token || '') !== room.organizer_token)
    return res.status(403).json({ error: 'No autorizado' });
  const photos = db.prepare('SELECT id, url FROM photos WHERE room_code=? ORDER BY created_at').all(room.code);
  res.type('zip');
  res.set('Content-Disposition', 'attachment; filename="fotos-' + room.code + '.zip"');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', () => { try { res.end(); } catch {} });
  archive.pipe(res);
  let i = 0;
  for (const p of photos) {
    try {
      const r = await fetch(p.url, { signal: AbortSignal.timeout(30000) });
      if (r.ok) archive.append(Buffer.from(await r.arrayBuffer()), { name: 'foto-' + (++i) + '.jpg' });
    } catch { /* salta la foto que falle */ }
  }
  await archive.finalize();
});

app.get('/api/rooms/:code/qr.png', async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).send('Sala no encontrada');
  const buf = await QRCode.toBuffer(voteUrl(req, room.code), { width: 512, margin: 1 });
  res.type('png').send(buf);
});

// ---- Páginas ----
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/v/:code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vote.html')));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log('group-vote escuchando en puerto ' + PORT));
