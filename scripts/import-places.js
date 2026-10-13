'use strict';
/*
 * Importa los lugares de Argentina desde el build del mapa público
 * (~/workspace/ts-spaces/nandy-s-insta-map-safari/) a:
 *   - data/places.json   (semilla versionada, se usa en el deploy)
 *   - public/images/     (copias de las fotos webp)
 *   - SQLite             (data/groupvote.db, tabla places)
 *
 * Re-ejecutable: usa INSERT OR REPLACE con clave estable por lugar.
 * Uso: node scripts/import-places.js [--source <dir>]
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const IMG_DIR = path.join(ROOT, 'public', 'images');
const DEFAULT_SOURCE = (process.env.MAPS_SOURCE_DIR ||
  path.join(process.env.HOME || '/home/hatch', 'workspace', 'ts-spaces', 'nandy-s-insta-map-safari'));

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SOURCE_DIR = argValue('--source', DEFAULT_SOURCE);

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function slugify(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'lugar';
}

// Extrae el array MAPS.argentina.places del index.html con conteo de corchetes
function extractPlaces(html) {
  const marker = '"argentina":{"title":"Argentina","short":"Argentina","places":[';
  const i = html.indexOf(marker);
  if (i < 0) throw new Error('No se encontró MAPS.argentina.places en index.html');
  let j = i + marker.length - 1; // posición del '['
  let depth = 0, inStr = false, esc = false;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) break; }
    }
  }
  return JSON.parse(html.slice(i + marker.length - 1, j + 1));
}

function copyImage(sourceAssets, fileName) {
  const src = path.join(sourceAssets, fileName);
  if (!fs.existsSync(src)) return null;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const dest = path.join(IMG_DIR, fileName);
  if (!fs.existsSync(dest) || fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs) {
    fs.copyFileSync(src, dest);
  }
  return '/images/' + fileName;
}

function main() {
  const indexPath = path.join(SOURCE_DIR, 'index.html');
  const assetsDir = path.join(SOURCE_DIR, 'assets');
  if (!fs.existsSync(indexPath)) {
    console.error('No existe ' + indexPath);
    process.exit(1);
  }
  const raw = extractPlaces(fs.readFileSync(indexPath, 'utf8'));
  console.log('Lugares en el mapa: ' + raw.length);

  const seen = new Set();
  const places = [];
  let withImage = 0;
  for (const p of raw) {
    const id = p.id || ('argentina-' + slugify(p.label));
    if (seen.has(id)) continue;
    seen.add(id);
    // La foto del mapa sigue la convención assets/<id>.webp
    let image = null;
    const fileName = id + '.webp';
    image = copyImage(assetsDir, fileName);
    if (image) withImage++;
    const rec = {
      id,
      name: p.label || id,
      type: p.tipo || p.cat || '',
      address: p.direccion || '',
      lat: typeof p.lat === 'number' ? p.lat : null,
      lng: typeof p.lng === 'number' ? p.lng : null,
      hours: p.scheduleText || '',
      notes: p.notas || '',
      image,
      neighborhood: p.barrio || p.ciudad || ''
    };
    rec.search_text = norm([rec.name, rec.type, rec.address, rec.notes, rec.neighborhood].join(' '));
    places.push(rec);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const jsonPath = path.join(DATA_DIR, 'places.json');
  fs.writeFileSync(jsonPath, JSON.stringify(places, null, 1));
  console.log('Escritos ' + places.length + ' lugares en data/places.json (' + withImage + ' con foto)');

  // Carga a SQLite (re-ejecutable)
  const dbPath = path.join(DATA_DIR, 'groupvote.db');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT '',
    address TEXT DEFAULT '', lat REAL, lng REAL, hours TEXT DEFAULT '',
    notes TEXT DEFAULT '', image TEXT, neighborhood TEXT DEFAULT '',
    search_text TEXT DEFAULT '', reel_url TEXT DEFAULT ''
  )`);
  const cols = db.prepare('PRAGMA table_info(places)').all().map(c => c.name);
  if (!cols.includes('search_text')) db.exec('ALTER TABLE places ADD COLUMN search_text TEXT DEFAULT \'\'');
  if (!cols.includes('reel_url')) db.exec('ALTER TABLE places ADD COLUMN reel_url TEXT DEFAULT \'\'');
  const ins = db.prepare(`INSERT OR REPLACE INTO places
    (id, name, type, address, lat, lng, hours, notes, image, neighborhood, search_text, reel_url)
    VALUES (@id, @name, @type, @address, @lat, @lng, @hours, @notes, @image, @neighborhood, @search_text, @reel_url)`);
  db.transaction((list) => { for (const p of list) { p.reel_url = p.reel_url || ''; ins.run(p); } })(places);
  const n = db.prepare('SELECT COUNT(*) AS c FROM places').get().c;
  db.close();
  console.log('SQLite: ' + n + ' lugares en ' + dbPath);
  // Enriquecer con reels del mapa privado (hace match por nombre)
  try {
    require('./add-reels').main();
  } catch (e) { console.error('Aviso: no se pudieron agregar reels: ' + e.message); }
  return { total: places.length, withImage };
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('ERROR: ' + e.message); process.exit(1); }
}

module.exports = { main, slugify };
