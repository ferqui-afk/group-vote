'use strict';
const $ = id => document.getElementById(id);
const code = location.pathname.split('/').pop().toUpperCase();
let pollTimer = null;
let myVote = null;
let roomData = null;
let map = null;
let markers = [];
let userLoc = null;
let activeIdx = 0;

function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function votedFlag(){ return localStorage.getItem('gv_voted_' + code) === '1'; }
function setVotedFlag(){ localStorage.setItem('gv_voted_' + code, '1'); }
function savedName(){ return localStorage.getItem('gv_name_' + code) || ''; }
function saveName(n){ localStorage.setItem('gv_name_' + code, n); }

function statusLabel(state){
  if (state === 'open') return ['open', 'Abierta'];
  if (state === 'closed') return ['closed', 'Cerrada'];
  return ['expired', 'Vencida'];
}
function imgSrc(p){
  return p.image || ('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#eee"/><text x="300" y="165" font-size="48" text-anchor="middle">🍽️</text></svg>'));
}
function reelShortcode(url){
  const m = /instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/.exec(url || '');
  return m ? m[1] : null;
}
function gmapsUrl(p){
  const q = (p.lat != null && p.lng != null)
    ? p.lat + ',' + p.lng
    : [p.name, p.address].filter(Boolean).join(' ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}
function haversineKm(a, b, c, d){
  const R = 6371, t = Math.PI / 180;
  const h = Math.sin((c-a)*t/2)**2 + Math.cos(a*t) * Math.cos(c*t) * Math.sin((d-b)*t/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function distLabel(p){
  if (!userLoc || p.lat == null || p.lng == null) return '';
  const km = haversineKm(userLoc.lat, userLoc.lng, p.lat, p.lng);
  return km < 1 ? ` · 📍 a ${Math.round(km*1000)} m` : ` · 📍 a ${km.toFixed(1)} km`;
}

function initMap(cands){
  if (map) { map.remove(); map = null; markers = []; }
  const withLoc = cands.filter(c => c.lat != null && c.lng != null);
  const el = $('voteMap');
  if (!withLoc.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  map = L.map('voteMap', { scrollWheelZoom: false }).setView([withLoc[0].lat, withLoc[0].lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  markers = cands.map((c, i) => {
    if (c.lat == null || c.lng == null) return null;
    const icon = L.divIcon({ className: '', html: `<div class="pin-num" data-i="${i}">${i+1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    const mk = L.marker([c.lat, c.lng], { icon }).addTo(map).bindPopup(esc(c.name));
    mk.on('click', () => scrollToCard(i));
    return mk;
  });
  const pts = withLoc.map(c => [c.lat, c.lng]);
  map.fitBounds(pts, { padding: [30, 30] });
  highlightPin(activeIdx);
}
function highlightPin(i){
  document.querySelectorAll('#voteMap .pin-num').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.i) === i);
  });
}
function scrollToCard(i){
  const cards = $('carousel').children;
  if (cards[i]) cards[i].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function cardHtml(c, i, room){
  const mine = myVote === c.id;
  const maxVotes = Math.max(1, ...room.candidates.map(x => x.votes));
  const pct = Math.round(c.votes / maxVotes * 100);
  const canVote = room.state === 'open' && !votedFlag();
  const named = (c.voters || []).filter(Boolean);
  const anon = c.votes - named.length;
  const voterLine = named.length || anon > 0
    ? `<div class="voters">👤 ${esc(named.join(', '))}${named.length && anon > 0 ? ', ' : ''}${anon > 0 ? anon + ' anónimo' + (anon > 1 ? 's' : '') : ''}</div>` : '';
  const sc = reelShortcode(c.reel_url);
  const reel = sc
    ? `<div class="reel-wrap"><iframe src="https://www.instagram.com/reel/${sc}/embed" loading="lazy" allowtransparency="true" title="Reel de Instagram"></iframe></div>
       <div class="btn-row"><a class="btn-ghost" href="${esc(c.reel_url)}" target="_blank" rel="noopener">▶ Ver reel en Instagram</a></div>`
    : '';
  return `<article class="ccard${i === activeIdx ? ' active' : ''}" data-i="${i}">
    <div class="num-badge">${i + 1}</div>
    <img class="photo" src="${esc(imgSrc(c))}" alt="" loading="lazy">
    <div class="name">${esc(c.name)}${mine ? '<span class="badge">tu voto ✓</span>' : ''}</div>
    <div class="meta">${esc([c.type, c.neighborhood].filter(Boolean).join(' · '))}${esc(distLabel(c))}</div>
    ${c.address ? `<div class="line">📍 ${esc(c.address)}</div>` : ''}
    ${c.hours ? `<div class="line">🕐 ${esc(c.hours)}</div>` : ''}
    ${c.notes ? `<div class="line notes">${esc(c.notes.length > 200 ? c.notes.slice(0, 200) + '…' : c.notes)}</div>` : ''}
    ${reel}
    <div class="btn-row"><a class="btn-ghost" href="${esc(gmapsUrl(c))}" target="_blank" rel="noopener">🗺️ Ver en Google Maps</a></div>
    <div class="result-line"><span><strong>${c.votes}</strong> ${c.votes === 1 ? 'voto' : 'votos'}</span></div>
    ${voterLine}
    <div class="bar"><div style="width:${pct}%"></div></div>
    ${canVote ? `<button class="vote-btn" data-id="${esc(c.id)}">Votar por este lugar</button>` : ''}
  </article>`;
}

function render(room){
  roomData = room;
  myVote = room.myVote;
  if (myVote) setVotedFlag();
  $('roomTitle').textContent = '🗳️ ' + room.title;
  const [cls, label] = statusLabel(room.state);
  const st = $('roomStatus');
  st.className = 'status ' + cls;
  st.textContent = label;
  $('voteCount').textContent = room.totalVotes === 1 ? '1 voto' : room.totalVotes + ' votos';

  const d = new Date(room.expiresAt);
  $('expiryHint').textContent = room.state === 'open'
    ? 'Cierra automáticamente: ' + d.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';

  const wb = $('winnerBox');
  if (room.winner && room.state !== 'open') {
    const w = room.winner;
    wb.classList.remove('hidden');
    wb.innerHTML = `<div class="winner"><h2>🏆 ¡Ganador!</h2>
      <div class="name" style="font-weight:700;font-size:1.1rem">${esc(w.name)}</div>
      ${w.address ? `<div class="hint">📍 ${esc(w.address)}</div>` : ''}
      <div class="hint">${w.votes} ${w.votes === 1 ? 'voto' : 'votos'}</div></div>`;
  } else wb.classList.add('hidden');

  // Caja de nombre
  const nb = $('nameBox');
  const showName = room.state === 'open' && !votedFlag();
  nb.classList.toggle('hidden', !showName);
  if (showName && !$('nameInput').value) $('nameInput').value = savedName();

  // Carrusel
  const car = $('carousel');
  car.innerHTML = room.candidates.map((c, i) => cardHtml(c, i, room)).join('');
  $('dots').innerHTML = room.candidates.map((_, i) =>
    `<span class="${i === activeIdx ? 'on' : ''}"></span>`).join('');
  car.querySelectorAll('.vote-btn').forEach(b =>
    b.addEventListener('click', () => vote(b.dataset.id)));
  car.onscroll = () => {
    const cards = [...car.children];
    if (!cards.length) return;
    const mid = car.scrollLeft + car.clientWidth / 2;
    let best = 0, bestD = Infinity;
    cards.forEach((el, i) => {
      const c = el.offsetLeft + el.offsetWidth / 2;
      const dd = Math.abs(c - mid);
      if (dd < bestD) { bestD = dd; best = i; }
    });
    if (best !== activeIdx) {
      activeIdx = best;
      cards.forEach((el, i) => el.classList.toggle('active', i === best));
      [...$('dots').children].forEach((el, i) => el.classList.toggle('on', i === best));
      highlightPin(best);
    }
  };

  initMap(room.candidates);

  // Organizador
  const orgToken = localStorage.getItem('gv_org_' + code);
  $('orgCard').classList.toggle('hidden', !(orgToken && room.state === 'open'));
  $('closeBtn').onclick = async () => {
    if (!confirm('¿Cerrar la votación y mostrar el ganador?')) return;
    const r = await fetch('/api/rooms/' + code + '/close', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizerToken: orgToken })
    });
    if (r.ok) render(await r.json());
    else alert('No se pudo cerrar.');
  };

  clearInterval(pollTimer);
  if (room.state === 'open') pollTimer = setInterval(load, 3000);
}

async function load(){
  try {
    const r = await fetch('/api/rooms/' + code);
    if (!r.ok) {
      $('roomTitle').textContent = '😕 Votación no encontrada';
      $('carousel').innerHTML = '<div class="ccard"><p>Revisa que el enlace o QR esté completo.</p></div>';
      return;
    }
    render(await r.json());
  } catch (e) { /* reintenta en el próximo poll */ }
}

async function vote(placeId){
  const nameInput = $('nameInput');
  const name = (nameInput ? nameInput.value : savedName()).trim();
  if (!name) { alert('Escribe tu nombre para votar 🙂'); if (nameInput) nameInput.focus(); return; }
  saveName(name);
  const r = await fetch('/api/rooms/' + code + '/vote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placeId, name })
  });
  const data = await r.json();
  if (!r.ok) { alert(data.error || 'No se pudo votar'); return; }
  setVotedFlag();
  render(data);
}

// Ubicación para distancias (opcional)
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    pos => { userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; if (roomData) render(roomData); },
    () => {}, { timeout: 8000 });
}

load();
