'use strict';
/*
 * Agrega reel_url a los lugares de group-vote cruzando con el mapa privado
 * (~/workspace/ts-spaces/mapa-argentina), que tiene el link de Instagram por lugar.
 * Hace match por nombre normalizado (sin tildes, minúsculas).
 * Actualiza data/places.json y SQLite. Re-ejecutable.
 * Uso: node scripts/add-reels.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const PRIVATE_MAP = path.join(process.env.HOME || '/home/hatch',
  'workspace', 'ts-spaces', 'mapa-argentina', 'index.html');

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function extractRegionPlaces(html, regionKey) {
  const marker = `"${regionKey}":{"title":"Argentina","short":"Argentina","places":[`;
  const i = html.indexOf(marker);
  if (i < 0) throw new Error('No se encontró la región ' + regionKey);
  let j = i + marker.length - 1;
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

function main() {
  const priv = extractRegionPlaces(fs.readFileSync(PRIVATE_MAP, 'utf8'), 'argentina');
  const reelByName = new Map();
  for (const p of priv) {
    if (p.link && p.label) reelByName.set(norm(p.label), p.link);
  }
  console.log('Lugares con reel en mapa privado: ' + reelByName.size);

  const jsonPath = path.join(ROOT, 'data', 'places.json');
  const places = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  let matched = 0;
  for (const p of places) {
    const reel = reelByName.get(norm(p.name));
    p.reel_url = reel || p.reel_url || '';
    if (reel) matched++;
  }
  fs.writeFileSync(jsonPath, JSON.stringify(places, null, 1));
  console.log(`Match por nombre: ${matched}/${places.length} lugares con reel`);

  const db = new Database(path.join(ROOT, 'data', 'groupvote.db'));
  const cols = db.prepare('PRAGMA table_info(places)').all().map(c => c.name);
  if (!cols.includes('reel_url')) db.exec("ALTER TABLE places ADD COLUMN reel_url TEXT DEFAULT ''");
  const upd = db.prepare('UPDATE places SET reel_url=? WHERE id=?');
  let n = 0;
  db.transaction((list) => { for (const p of list) { if (p.reel_url) { upd.run(p.reel_url, p.id); n++; } } })(places);
  db.close();
  console.log('SQLite actualizado: ' + n + ' lugares con reel_url');
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('ERROR: ' + e.message); process.exit(1); }
}

module.exports = { main };
