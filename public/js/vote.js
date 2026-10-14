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
let lastSig = '';
let mapSig = '';
let scrollEndT = null;

function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function votedFlag(){ return localStorage.getItem('gv_voted_' + code) === '1'; }
function setVotedFlag(){ localStorage.setItem('gv_voted_' + code, '1'); }
function savedName(){ return localStorage.getItem('gv_name') || localStorage.getItem('gv_name_' + code) || ''; }
function saveName(n){ localStorage.setItem('gv_name', n); localStorage.setItem('gv_name_' + code, n); }

function statusLabel(state){
  if (state === 'open') return ['open', t('state_open')];
  if (state === 'closed') return ['closed', t('state_closed')];
  return ['expired', t('state_expired')];
}
function imgSrc(p){
  return p.image || ('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#eee"/><text x="300" y="165" font-size="48" text-anchor="middle">🍽️</text></svg>'));
}
function reelShortcode(url){
  const m = /instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/.exec(url || '');
  return m ? m[1] : null;
}
function haversineKm(a, b, c, d){
  const R = 6371, t = Math.PI / 180;
  const h = Math.sin((c-a)*t/2)**2 + Math.cos(a*t) * Math.cos(c*t) * Math.sin((d-b)*t/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function distLabel(p){
  if (!userLoc || p.lat == null || p.lng == null) return '';
  const km = haversineKm(userLoc.lat, userLoc.lng, p.lat, p.lng);
  return km < 1 ? ` · 📍 ${Math.round(km*1000)} m` : ` · 📍 ${km.toFixed(1)} km`;
}

let meMarker = null;
function showMyLocation(center){
  if (!map || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    userLoc = { lat: ll[0], lng: ll[1] };
    if (meMarker) map.removeLayer(meMarker);
    meMarker = L.marker(ll, {
      icon: L.divIcon({ className: '', html: '<div class="me-dot" style="width:16px;height:16px"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      zIndexOffset: 1000
    }).addTo(map).bindPopup('📍 Tú estás aquí');
    if (center) map.setView(ll, 14);
    if (roomData) render(roomData); // refresca distancias
  }, () => alert(t('link_no_loc')), { timeout: 10000 });
}

function initMap(cands){
  if (map) { map.remove(); map = null; markers = []; meMarker = null; }
  const withLoc = cands.filter(c => c.lat != null && c.lng != null);
  const el = $('voteMap');
  if (!withLoc.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  map = L.map('voteMap', { scrollWheelZoom: false }).setView([withLoc[0].lat, withLoc[0].lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  // Botón "mi ubicación"
  const LocateCtrl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function(){
      const btn = L.DomUtil.create('button', 'locate-btn');
      btn.title = t('view_loc');
      btn.innerHTML = '📍';
      btn.setAttribute('aria-label', t('view_loc'));
      L.DomEvent.on(btn, 'click', e => { L.DomEvent.stop(e); showMyLocation(true); });
      return btn;
    }
  });
  map.addControl(new LocateCtrl());
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
  const canVote = room.state === 'open' && !mine;
  const votedAlready = room.state === 'open' && votedFlag();
  const named = (c.voters || []).filter(Boolean);
  const anon = c.votes - named.length;
  const voterLine = named.length || anon > 0
    ? `<div class="voters">👤 ${esc(named.join(', '))}${named.length && anon > 0 ? ', ' : ''}${anon > 0 ? anon + ' ' + t('anon') + (anon > 1 && currentLang() === 'es' ? 's' : '') : ''}</div>` : '';
  const sc = reelShortcode(c.reel_url);
  const reel = sc
    ? `<div class="reel-wrap reel-slot" data-reel="${esc(sc)}"></div>
       <div class="btn-row"><a class="btn-ghost" href="${esc(c.reel_url)}" target="_blank" rel="noopener">${t('reel_btn')}</a></div>`
    : '';
  return `<article class="ccard${i === activeIdx ? ' active' : ''}" data-i="${i}">
    <div class="num-badge">${i + 1}</div>
    <img class="photo" src="${esc(imgSrc(c))}" alt="" loading="lazy">
    <div class="name">${esc(c.name)}${mine ? '<span class="badge">' + t('your_vote') + '</span>' : ''}</div>
    <div class="meta">${esc([c.type, c.neighborhood].filter(Boolean).join(' · '))}${esc(distLabel(c))}</div>
    ${c.address ? `<div class="line">📍 ${esc(c.address)}</div>` : ''}
    ${c.hours ? `<div class="line">🕐 ${esc(c.hours)}</div>` : ''}
    ${c.notes ? `<div class="line notes">${esc(c.notes.length > 200 ? c.notes.slice(0, 200) + '…' : c.notes)}</div>` : ''}
    ${reel}
    <div class="btn-row"><a class="btn-ghost" href="${esc(gmapsUrl(c))}" target="_blank" rel="noopener">${mapsLogo()}${t('maps_btn')}</a></div>
    <div class="result-line"><span><strong>${c.votes}</strong> ${c.votes === 1 ? t('vote_1') : t('vote_n')}</span></div>
    ${voterLine}
    <div class="bar"><div style="width:${pct}%"></div></div>
    ${canVote ? `<button class="vote-btn" data-id="${esc(c.id)}">${votedAlready ? t('change_vote') : t('vote_btn')}</button>` : ''}
  </article>`;
}

function confettiBurst(){
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const W = c.width = innerWidth, H = c.height = innerHeight;
  const colors = ['#f43f5e','#f59e0b','#22c55e','#3b82f6','#a855f7','#ec4899','#facc15'];
  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * W, y: -20 - Math.random() * H * 0.4,
    w: 6 + Math.random() * 8, h: 8 + Math.random() * 10,
    vy: 2 + Math.random() * 3.5, vx: -1.5 + Math.random() * 3,
    rot: Math.random() * Math.PI, vr: -0.15 + Math.random() * 0.3,
    color: colors[(Math.random() * colors.length) | 0], shape: Math.random() < 0.4 ? 'circle' : 'rect'
  }));
  const start = performance.now();
  (function frame(now){
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.y += p.vy; p.x += p.vx + Math.sin((p.y + t / 300) / 20);
      p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
      if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 7); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 4200) requestAnimationFrame(frame); else c.remove();
  })(start);
}
let lastWinnerKey = '';
function syncReels(){
  // Solo la tarjeta activa tiene el iframe vivo: al salir de una tarjeta su video se pausa (se destruye el reproductor).
  document.querySelectorAll('#carousel .ccard').forEach((cardEl, i) => {
    const slot = cardEl.querySelector('.reel-slot');
    if (!slot) return;
    const has = !!slot.querySelector('iframe');
    if (i === activeIdx && !has) {
      slot.innerHTML = `<iframe src="https://www.instagram.com/reel/${esc(slot.dataset.reel)}/embed" loading="lazy" allowtransparency="true" title="Reel de Instagram"></iframe>`;
    } else if (i !== activeIdx && has) {
      slot.innerHTML = '';
    }
  });
}

function render(room){
  roomData = room;
  myVote = room.myVote;
  if (myVote) setVotedFlag();
  // Si nada cambió desde el último render, no tocar el DOM: así ni el mapa ni las tarjetas parpadean cada 3 s.
  const sig = JSON.stringify([view, room.state, room.myVote, room.totalVotes, room.winner && room.winner.id,
    room.candidates.map(c => [c.id, c.votes, (c.voters || []).join('|')]),
    votedFlag(), userLoc ? [Math.round(userLoc.lat * 1000), Math.round(userLoc.lng * 1000)] : null]);
  if (sig === lastSig) {
    clearInterval(pollTimer);
    if (room.state === 'open') pollTimer = setInterval(load, 3000);
    return;
  }
  lastSig = sig;
  $('roomTitle').textContent = '🗳️ ' + room.title;
  const [cls, label] = statusLabel(room.state);
  const st = $('roomStatus');
  st.className = 'status ' + cls;
  st.textContent = label;
  $('voteCount').textContent = room.totalVotes === 1 ? '1 ' + t('vote_1') : room.totalVotes + ' ' + t('vote_n');

  const d = new Date(room.expiresAt);
  $('expiryHint').textContent = room.state === 'open'
    ? t('auto_close') + d.toLocaleString(currentLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';

  // Vista tablero vs tarjetas
  const inBoard = view === 'board';
  $('voteMap').classList.toggle('hidden', inBoard);
  $('carousel').classList.toggle('hidden', inBoard);
  $('dots').classList.toggle('hidden', inBoard);
  $('boardView').classList.toggle('hidden', !inBoard);
  if (inBoard) { renderBoard(room); }

  const wb = $('winnerBox');
  if (room.winner && room.state !== 'open') {
    const w = room.winner;
    wb.classList.remove('hidden');
    wb.innerHTML = `<div class="winner"><h2>${t('winner')}</h2>
      <div class="name" style="font-weight:700;font-size:1.1rem">${esc(w.name)}</div>
      ${w.address ? `<div class="hint">📍 ${esc(w.address)}</div>` : ''}
      <div class="hint">${w.votes} ${w.votes === 1 ? t('vote_1') : t('vote_n')}</div>
      <p><a class="btn" style="display:inline-block;text-decoration:none" target="_blank" rel="noopener" href="${gmapsUrl(w)}">${mapsLogo()}${t('maps_btn')}</a></p></div>`;
  } else wb.classList.add('hidden');
  // Al terminar: llevar al cuadro del ganador con confeti (una sola vez por ganador)
  const wKey = room.winner && room.state !== 'open' ? code + ':' + room.winner.id + ':' + room.state : '';
  if (wKey && wKey !== lastWinnerKey) {
    lastWinnerKey = wKey;
    setTimeout(() => { wb.scrollIntoView({ behavior: 'smooth', block: 'center' }); confettiBurst(); }, 350);
  } else if (!wKey) lastWinnerKey = '';

  // Caja de nombre
  const nb = $('nameBox');
  const showName = room.state === 'open' && !votedFlag();
  nb.classList.toggle('hidden', !showName);
  if (showName && !$('nameInput').value) $('nameInput').value = savedName();

  // Aviso de cambio de voto
  let cv = $('changeHint');
  if (room.state === 'open' && votedFlag() && myVote) {
    const picked = room.candidates.find(c => c.id === myVote);
    if (!cv) {
      cv = document.createElement('p');
      cv.id = 'changeHint';
      cv.className = 'hint center';
      nb.after(cv);
    }
    cv.innerHTML = `${t('voted_for')} <strong>${esc(picked ? picked.name : '')}</strong> · ${t('change_hint')}`;
  } else if (cv) cv.remove();

  // QR para invitar (siempre disponible mientras la sala exista)
  const qi = $('qrImgVote');
  if (qi && !qi.src) qi.src = '/api/rooms/' + code + '/qr.png';

  // Carrusel (conserva la posición de scroll entre re-renders)
  const car = $('carousel');
  const savedScroll = car.scrollLeft;
  car.innerHTML = room.candidates.map((c, i) => cardHtml(c, i, room)).join('');
  $('dots').innerHTML = room.candidates.map((_, i) =>
    `<span class="${i === activeIdx ? 'on' : ''}"></span>`).join('');
  car.querySelectorAll('.vote-btn').forEach(b =>
    b.addEventListener('click', () => vote(b.dataset.id)));
  [...$('dots').children].forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));
  car.scrollLeft = savedScroll;
  car.onscroll = () => {
    // Durante el swipe se ocultan los iframes (no flotan) y al terminar se sincronizan los reels.
    car.classList.add('scrolling');
    clearTimeout(scrollEndT);
    scrollEndT = setTimeout(() => car.classList.remove('scrolling'), 150);
    const cards = [...car.children];
    if (!cards.length) return;
    const mid = car.scrollLeft + car.clientWidth / 2;
    let best = 0, bestD = Infinity;
    cards.forEach((el, i) => {
      // offsetLeft es relativo a la página: restar el del carrusel para comparar en coordenadas del carrusel.
      const c = el.offsetLeft - car.offsetLeft + el.offsetWidth / 2;
      const dd = Math.abs(c - mid);
      if (dd < bestD) { bestD = dd; best = i; }
    });
    if (best !== activeIdx) {
      activeIdx = best;
      cards.forEach((el, i) => el.classList.toggle('active', i === best));
      [...$('dots').children].forEach((el, i) => el.classList.toggle('on', i === best));
      highlightPin(best);
      syncReels();
    }
  };
  syncReels();

  if (view !== 'board') {
    const mSig = room.candidates.map(c => c.id).join(',');
    if (!map || mSig !== mapSig) { initMap(room.candidates); mapSig = mSig; }
    else highlightPin(activeIdx);
  }

  // Organizador: cerrar si está abierta, reabrir si está cerrada/vencida
  const orgToken = localStorage.getItem('gv_org_' + code);
  $('orgCard').classList.toggle('hidden', !orgToken);
  const cb = $('closeBtn');
  cb.textContent = room.state === 'open' ? t('close_vote_long') : t('reopen_vote');
  cb.onclick = async () => {
    if (room.state === 'open') {
      if (!confirm(t('close_confirm'))) return;
      const r = await fetch('/api/rooms/' + code + '/close', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizerToken: orgToken })
      });
      if (r.ok) render(await r.json());
      else alert(t('close_fail'));
    } else {
      const r = await fetch('/api/rooms/' + code + '/reopen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizerToken: orgToken })
      });
      if (r.ok) render(await r.json());
      else alert(t('reopen_fail'));
    }
  };

  clearInterval(pollTimer);
  if (room.state === 'open') pollTimer = setInterval(load, 3000);
}

// ---- Tablero en vivo ----
let view = 'cards';
function setView(v){
  view = v;
  $('viewCards').classList.toggle('active-view', v === 'cards');
  $('viewBoard').classList.toggle('active-view', v === 'board');
  if (v === 'cards' && map) setTimeout(() => map.invalidateSize(), 60);
  if (roomData) render(roomData);
}
function renderBoard(room){
  const cands = [...room.candidates].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  const max = Math.max(1, ...cands.map(c => c.votes));
  const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span class="hint">${i + 1}.</span>`;
  $('boardView').innerHTML =
    `<div class="card"><h3 style="margin:0 0 4px">📊 ${t('view_board')}</h3>
     <p class="hint" style="margin:0">${t('board_sub')}</p></div>` +
    cands.map((c, i) => {
      const pct = Math.round(c.votes / max * 100);
      const voters = (c.voters || []).map(v => `<span class="voter-chip">${esc(v)}</span>`).join('');
      return `<div class="board-row" data-id="${esc(c.id)}">
        <div class="board-top"><div>${medal(i)} <strong>${esc(c.name)}</strong></div>
        <div class="hint">${c.votes === 1 ? '1 ' + t('vote_1') : c.votes + ' ' + t('vote_n')}</div></div>
        <div class="board-bar"><div class="board-fill" style="width:${pct}%"></div></div>
        ${voters ? `<div class="board-voters">${voters}</div>` : '<div class="hint">' + t('no_votes') + '</div>'}
      </div>`;
    }).join('');
  $('boardView').querySelectorAll('.board-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = room.candidates.findIndex(c => String(c.id) === row.dataset.id);
      if (idx >= 0) { setView('cards'); setTimeout(() => goTo(idx), 120); }
    });
  });
}
$('viewCards').addEventListener('click', () => setView('cards'));
$('viewBoard').addEventListener('click', () => setView('board'));
$('viewCards').classList.add('active-view');
$('copyVoteLink').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('copyVoteLink').textContent = t('copied'); }
  catch(e){ prompt(t('copy_prompt'), location.href); }
  setTimeout(() => $('copyVoteLink').textContent = t('copy_link'), 1500);
});
window.__reRender = () => { if (roomData) render(roomData); };

function goTo(idx){
  const car = $('carousel');
  const cards = [...car.children];
  if (!cards[idx]) return;
  activeIdx = idx;
  cards.forEach((el, i) => el.classList.toggle('active', i === idx));
  [...$('dots').children].forEach((el, i) => el.classList.toggle('on', i === idx));
  car.scrollTo({ left: cards[idx].offsetLeft - car.offsetLeft - (car.clientWidth - cards[idx].offsetWidth) / 2, behavior: 'smooth' });
  highlightPin(idx);
  setTimeout(syncReels, 400);
}
async function load(){
  try {
    const r = await fetch('/api/rooms/' + code);
    if (!r.ok) {
      $('roomTitle').textContent = '😕 ' + t('not_found_title');
      $('carousel').innerHTML = '<div class="ccard"><p>' + t('room_not_found') + '</p></div>';
      return;
    }
    render(await r.json());
  } catch (e) { /* reintenta en el próximo poll */ }
}

async function vote(placeId){
  const nameInput = $('nameInput');
  const name = (nameInput ? nameInput.value : savedName()).trim();
  if (!name) { alert(t('name_prompt')); if (nameInput) nameInput.focus(); return; }
  saveName(name);
  const r = await fetch('/api/rooms/' + code + '/vote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placeId, name })
  });
  const data = await r.json();
  if (!r.ok) { alert(data.error || t('vote_fail')); return; }
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
