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
`);
 // Migración: agregar voter_name si la tabla ya existía sin esa columna
if (!db.prepare('PRAGMA table_info(votes)').all().some(c => c.name === 'voter_name')) {
  db.exec("ALTER TABLE votes ADD COLUMN voter_name TEXT DEFAULT ''");
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_votes_room ON votes(room_code);
`);
if (!db.prepare('PRAGMA table_info(places)').all().some(c => c.name === 'search_text')) {
  db.exec("ALTER TABLE places ADD COLUMN search_text TEXT DEFAULT ''");
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
  return {
    code: room.code, title: room.title, state,
    createdAt: room.created_at, expiresAt: room.expires_at, closedAt: room.closed_at,
    candidates, totalVotes: total,
    myVote: mine ? mine.place_id : null,
    winner: winner && (winner.votes > 0 || state !== 'open') ? winner : null,
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
    (id, name, type, address, lat, lng, hours, notes, image, neighborhood, search_text, reel_url)
    VALUES (@id, @name, @type, @address, @lat, @lng, @hours, @notes, @image, @neighborhood, @search_text, @reel_url)`);
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
  let rows;
  if (q) {
    rows = db.prepare(
      `SELECT id, name, type, address, hours, notes, image, neighborhood, reel_url, lat, lng FROM places
       WHERE search_text LIKE ? ORDER BY name LIMIT 60`)
      .all('%' + q.replace(/[%_]/g, '') + '%');
  } else {
    rows = db.prepare(
      `SELECT id, name, type, address, hours, notes, image, neighborhood, reel_url, lat, lng FROM places
       ORDER BY name LIMIT 60`).all();
  }
  res.json({ places: rows });
});

app.post('/api/rooms', async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 80);
  const placeIds = Array.isArray(req.body.placeIds) ? [...new Set(req.body.placeIds.map(String))].slice(0, 12) : [];
  if (!title) return res.status(400).json({ error: 'Falta el título' });
  if (placeIds.length < 2) return res.status(400).json({ error: 'Elige al menos 2 lugares' });
  const ok = db.prepare(`SELECT COUNT(*) AS c FROM places WHERE id IN (${placeIds.map(() => '?').join(',')})`).get(...placeIds).c;
  if (ok !== placeIds.length) return res.status(400).json({ error: 'Algún lugar no existe' });
  const code = uniqueCode();
  const organizerToken = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO rooms (code, title, created_at, expires_at, organizer_token) VALUES (?,?,?,?,?)')
    .run(code, title, now, now + ROOM_TTL_MS, organizerToken);
  const ins = db.prepare('INSERT INTO room_candidates (room_code, place_id, position) VALUES (?,?,?)');
  db.transaction(() => { placeIds.forEach((id, i) => ins.run(code, id, i)); })();
  const url = voteUrl(req, code);
  const qrDataUrl = await QRCode.toDataURL(url, { width: 512, margin: 1 });
  res.json({ code, title, voteUrl: url, qrDataUrl, organizerToken, expiresAt: now + ROOM_TTL_MS });
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
