'use strict';
const $ = id => document.getElementById(id);
const selected = new Map(); // id -> place
let searchTimer = null;

function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function imgTag(p){
  const src = p.image || '';
  return src ? `<img src="${esc(src)}" alt="" loading="lazy">`
             : `<img src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84"><rect width="84" height="84" fill="#eee"/><text x="42" y="48" font-size="28" text-anchor="middle">🍽️</text></svg>')}" alt="">`;
}
function placeCard(p){
  const sel = selected.has(p.id) ? ' selected' : '';
  const linkBadge = String(p.id).startsWith('custom-') ? '<span class="badge">🔗</span>' : '';
  return `<div class="pick-card${sel}" data-id="${esc(p.id)}">
    ${imgTag(p)}
    <div class="info">
      <div class="name">${esc(p.name)}${selected.has(p.id) ? '<span class="badge">✓</span>' : ''}${linkBadge}</div>
      ${p.type ? `<div class="type">${esc(p.type)}</div>` : ''}
      ${p.distance != null ? `<div class="dist">📍 ${p.distance} mi</div>` : ''}
      ${p.address ? `<div class="addr">${esc(p.address.slice(0, 60))}${p.address.length > 60 ? '…' : ''}</div>` : ''}
    </div>
  </div>`;
}

let lastResults = [];
let carouselSeeded = false;
async function seedCarousel(){
  // Empieza con los 5 lugares más cercanos al centro del mapa
  if (!pickCenter) pickCenter = { ...BA_AIRBNB };
  if ($('search').value.trim()) return;
  for (const m of [5, 25, 100]) {
    try {
      const r = await fetch(`/api/places/near?lat=${pickCenter.lat}&lng=${pickCenter.lng}&miles=${m}`);
      const data = await r.json();
      if (data.places && data.places.length) {
        lastResults = data.places.slice(0, 5);
        carouselSeeded = true;
        render();
        return;
      }
    } catch(e){}
  }
  lastResults = [];
  carouselSeeded = true;
  render();
}
async function doSearch(){
  const q = $('search').value.trim();
  if (!q && carouselSeeded) { render(); return; }
  const r = await fetch('/api/places?q=' + encodeURIComponent(q));
  const data = await r.json();
  lastResults = data.places;
  carouselSeeded = true;
  render();
}
function render(){
  const q = $('search').value.trim();
  $('countHint').textContent = q
    ? lastResults.length + ' resultados. Toca para elegir o quitar.'
    : (lastResults.length
        ? 'Empieza con los más cercanos. Toca para elegir o busca más.'
        : 'No hay lugares cerca de este punto. Amplía el radio o busca por nombre.');
  $('results').innerHTML = lastResults.map(placeCard).join('') || '<p class="hint">Sin resultados.</p>';
  $('results').querySelectorAll('.pick-card').forEach(el => {
    el.addEventListener('click', () => toggle(el.dataset.id));
  });
  updateBar();
}
function toggle(id){
  const p = lastResults.find(x => x.id === id) || nearCache.get(id);
  if (!p) return;
  if (selected.has(id)) selected.delete(id);
  else { if (selected.size >= 12) { alert('Máximo 12 lugares por votación'); return; } selected.set(id, p); }
  render();
  refreshPickPins();
}
function updateBar(){
  const n = selected.size;
  $('selCount').textContent = n;
  $('selectedBar').classList.toggle('show', n > 0);
  $('chips').innerHTML = [...selected.values()].map(p =>
    `<span class="chip">${esc(p.name)}<button data-id="${esc(p.id)}" aria-label="quitar">✕</button></span>`).join('');
  $('chips').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); selected.delete(b.dataset.id); render(); }));
  const ok = n >= 2 && $('title').value.trim().length > 0;
  $('createBtn').disabled = !ok;
}
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 250);
});
$('title').addEventListener('input', updateBar);
$('goCreate').addEventListener('click', () => {
  $('createBtn').scrollIntoView({behavior:'smooth', block:'center'});
  $('title').focus();
});
$('createBtn').addEventListener('click', async () => {
  const title = $('title').value.trim();
  if (selected.size < 2 || !title) return;
  $('createBtn').disabled = true;
  $('createBtn').textContent = 'Creando…';
  try {
    const r = await fetch('/api/rooms', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ title, placeIds: [...selected.keys()] })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error');
    localStorage.setItem('gv_org_' + data.code, data.organizerToken);
    $('qrImg').src = data.qrDataUrl;
    $('qrDl').href = data.qrDataUrl;
    $('qrDl').download = 'votacion-' + data.code + '.png';
    $('voteLink').value = data.voteUrl;
    $('openVote').href = data.voteUrl;
    $('doneCard').classList.remove('hidden');
    $('doneCard').scrollIntoView({behavior:'smooth'});
  } catch(e){
    const msg = (e instanceof TypeError || /failed|network|load/i.test(e.message))
      ? 'No se pudo conectar con el servidor. El enlace puede haber vencido, pide uno nuevo.'
      : e.message;
    alert('No se pudo crear: ' + msg);
  }
  $('createBtn').disabled = false;
  $('createBtn').textContent = 'Crear votación';
});
$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('voteLink').value); $('copyBtn').textContent = '¡Copiado!'; }
  catch(e){ $('voteLink').select(); document.execCommand('copy'); }
  setTimeout(() => $('copyBtn').textContent = 'Copiar', 1500);
});

// ---- Añadir lugar con link de Instagram / Google Maps ----
let pendingLink = null;
$('linkBtn').addEventListener('click', async () => {
  const url = $('linkInput').value.trim();
  if (!url) { alert('Pega un link primero'); return; }
  const prev = $('linkPreview');
  prev.innerHTML = '<p class="hint">Leyendo el link…</p>';
  $('linkBtn').disabled = true;
  try {
    const r = await fetch('/api/places/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error');
    pendingLink = data;
    if (data.kind === 'instagram') {
      prev.innerHTML = `<div class="link-card">
        <div><strong>🎬 Reel de Instagram</strong></div>
        ${data.author ? `<div class="hint">por @${esc(data.author)}</div>` : ''}
        ${data.caption ? `<div class="hint">${esc(data.caption)}</div>` : ''}
        <label class="mt" for="linkName"><strong>Nombre del lugar</strong></label>
        <input type="text" id="linkName" class="mt" placeholder="Ej. La Choppería" maxlength="120">
        <label class="mt" for="linkType"><strong>Tipo (opcional)</strong></label>
        <input type="text" id="linkType" placeholder="Ej. Bar" maxlength="60">
        <button class="btn mt" id="linkConfirm">Añadir a la votación</button>
      </div>`;
    } else {
      prev.innerHTML = `<div class="link-card">
        <div><strong>📍 Google Maps</strong></div>
        <label class="mt" for="linkName"><strong>Nombre del lugar</strong></label>
        <input type="text" id="linkName" class="mt" value="${esc(data.name || '')}" maxlength="120">
        ${data.address ? `<div class="hint">${esc(data.address.slice(0, 140))}</div>` : ''}
        <button class="btn mt" id="linkConfirm">Añadir a la votación</button>
      </div>`;
    }
    $('linkConfirm').addEventListener('click', confirmLinkPlace);
    setTimeout(() => $('linkName') && $('linkName').focus(), 100);
  } catch (e) { prev.innerHTML = `<p class="hint">⚠️ ${esc(e.message)}</p>`; }
  $('linkBtn').disabled = false;
});
async function confirmLinkPlace(){
  const d = pendingLink;
  if (!d) return;
  const name = ($('linkName') || {}).value ? $('linkName').value.trim() : (d.name || '');
  if (!name) { alert('Ponle un nombre al lugar'); return; }
  if (selected.size >= 12) { alert('Máximo 12 lugares por votación'); return; }
  const btn = $('linkConfirm');
  btn.disabled = true; btn.textContent = 'Añadiendo…';
  try {
    const body = { name,
      address: d.kind === 'gmaps' ? (d.address || '') : '',
      lat: d.kind === 'gmaps' ? d.lat : null,
      lng: d.kind === 'gmaps' ? d.lng : null,
      reelUrl: d.kind === 'instagram' ? d.reelUrl : '',
      type: ($('linkType') || {}).value ? $('linkType').value.trim() : '',
      notes: d.kind === 'gmaps' ? d.url : ''
    };
    const r = await fetch('/api/places/custom', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error');
    selected.set(data.place.id, data.place);
    lastResults.unshift(data.place);
    render();
    $('linkPreview').innerHTML = `<p class="hint">✅ <strong>${esc(data.place.name)}</strong> añadido. Puedes seguir buscando o crear la votación.</p>`;
    $('linkInput').value = '';
    pendingLink = null;
  } catch (e) { alert('No se pudo añadir: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Añadir a la votación';
}

// ---- Elegir lugares por mapa (filtro por millas) ----
const nearCache = new Map();
let pickMap = null, pickCenter = null, pickPins = [], pickCircle = null, pickCenterDot = null;
const BA_AIRBNB = { lat: -34.5928367, lng: -58.4218671 };
function pickIcon(sel){
  return L.divIcon({ className: '', html: `<div class="pick-pin${sel ? ' sel' : ''}">${sel ? '✓' : ''}</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11] });
}
function refreshPickPins(){
  pickPins.forEach(m => m.setIcon(pickIcon(selected.has(m._pid))));
}
async function loadNearby(fit){
  if (!pickMap || !pickCenter) return;
  const miles = parseFloat($('radiusSel').value);
  $('pickHint').textContent = 'Buscando lugares…';
  try {
    const r = await fetch(`/api/places/near?lat=${pickCenter.lat}&lng=${pickCenter.lng}&miles=${miles}`);
    const data = await r.json();
    pickPins.forEach(m => pickMap.removeLayer(m)); pickPins = [];
    nearCache.clear();
    if (pickCircle) pickMap.removeLayer(pickCircle);
    if (pickCenterDot) pickMap.removeLayer(pickCenterDot);
    pickCircle = L.circle([pickCenter.lat, pickCenter.lng], {
      radius: miles * 1609.34, color: '#c96f2e', weight: 1.5, fillOpacity: 0.07 }).addTo(pickMap);
    pickCenterDot = L.marker([pickCenter.lat, pickCenter.lng], {
      icon: L.divIcon({ className: '', html: '<div class="me-dot" style="width:14px;height:14px"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })
    }).addTo(pickMap).bindPopup('Centro de búsqueda');
    data.places.forEach(p => {
      nearCache.set(p.id, p);
      const m = L.marker([p.lat, p.lng], { icon: pickIcon(selected.has(p.id)) }).addTo(pickMap);
      m._pid = p.id;
      m.bindPopup(`<strong>${esc(p.name)}</strong><br>
        <span style="color:#666;font-size:.85rem">${esc(p.type || '')}${p.type ? ' · ' : ''}${p.distance} mi</span><br>
        <button data-pick="${esc(p.id)}" class="btn-ghost btn-small" style="margin-top:6px">${selected.has(p.id) ? 'Quitar ✕' : 'Añadir ✓'}</button>`);
      pickPins.push(m);
    });
    $('pickHint').textContent = `${data.count} lugares dentro de ${miles} ${miles === 1 ? 'milla' : 'millas'}. Toca un pin para añadirlo.`;
    if (fit) pickMap.fitBounds(pickCircle.getBounds().pad(0.05));
  } catch(e){ $('pickHint').textContent = 'No se pudo cargar los lugares.'; }
}
function initPickMap(){
  pickCenter = { ...BA_AIRBNB };
  pickMap = L.map('pickMap', { scrollWheelZoom: false }).setView([pickCenter.lat, pickCenter.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(pickMap);
  $('pickMap').addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    toggle(b.dataset.pick);
    b.textContent = selected.has(b.dataset.pick) ? 'Quitar ✕' : 'Añadir ✓';
  });
  $('radiusSel').addEventListener('change', () => loadNearby(true));
  $('geoBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('Tu navegador no da ubicación'); return; }
    $('geoBtn').disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
      pickCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      loadNearby(true);
      seedCarousel();
      $('geoBtn').disabled = false;
    }, () => { alert('No se pudo obtener tu ubicación'); $('geoBtn').disabled = false; }, { timeout: 10000 });
  });
  loadNearby(true);
}

// ---- Dashboard de mis votaciones ----
function myRoomCodes(){
  const codes = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('gv_org_')) codes.push(k.slice('gv_org_'.length));
  }
  return codes;
}
function statusBadge(state){
  const map = { open: ['open', 'Abierta'], closed: ['closed', 'Cerrada'], expired: ['expired', 'Vencida'] };
  const [cls, label] = map[state] || map.expired;
  return `<span class="status ${cls}">${label}</span>`;
}
async function loadDashboard(){
  const orgCodes = myRoomCodes();
  const votedCodes = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('gv_voted_')) votedCodes.push(k.slice('gv_voted_'.length));
  }
  const box = $('dashCard'), list = $('dashList');
  if (!orgCodes.length && !votedCodes.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  list.innerHTML = '<p class="hint">Cargando…</p>';
  async function fetchRooms(codes, skipPrefix, skipSet){
    const rooms = [];
    for (const c of codes) {
      if (skipSet && skipSet.has(c)) continue; // ya listada en la otra sección
      try {
        const r = await fetch('/api/rooms/' + c);
        if (!r.ok) { localStorage.removeItem(skipPrefix + c); continue; }
        rooms.push(await r.json());
      } catch(e){}
    }
    rooms.sort((a, b) => b.createdAt - a.createdAt);
    return rooms;
  }
  const orgRooms = await fetchRooms(orgCodes, 'gv_org_', null);
  const votedRooms = await fetchRooms(votedCodes, 'gv_voted_', new Set(orgCodes));
  if (!orgRooms.length && !votedRooms.length) { box.classList.add('hidden'); return; }
  const row = (rm, origin) => {
    const lead = rm.state === 'open'
      ? (rm.candidates[0] && rm.candidates[0].votes > 0
          ? `👑 Va ganando: <strong>${esc(rm.candidates[0].name)}</strong> (${rm.candidates[0].votes})`
          : 'Sin votos todavía')
      : (rm.winner ? `🏆 Ganó: <strong>${esc(rm.winner.name)}</strong>` : 'Sin ganador');
    return `<div class="dash-row">
      <div style="flex:1;min-width:0">
        <div><strong>${esc(rm.title)}</strong> ${statusBadge(rm.state)} <span class="hint">· ${origin}</span></div>
        <div class="hint">${rm.totalVotes === 1 ? '1 voto' : rm.totalVotes + ' votos'} · ${lead}</div>
      </div>
      <a class="btn-ghost btn-small" style="text-decoration:none;white-space:nowrap" href="/v/${esc(rm.code)}">Ver</a>
    </div>`;
  };
  const tagged = [
    ...orgRooms.map(r => ({ r, origin: 'creada por ti' })),
    ...votedRooms.map(r => ({ r, origin: 'votaste' }))
  ];
  const actives = tagged.filter(x => x.r.state === 'open');
  const history = tagged.filter(x => x.r.state !== 'open');
  list.innerHTML =
    (actives.length ? `<p class="hint" style="margin:0 0 4px"><strong>🟢 Votaciones activas</strong></p>` +
      actives.map(x => row(x.r, x.origin)).join('') : '') +
    (history.length ? `<p class="hint" style="margin:12px 0 4px"><strong>📜 Historial</strong></p>` +
      history.map(x => row(x.r, x.origin)).join('') : '');
}
initPickMap();
seedCarousel();
loadDashboard();
setInterval(loadDashboard, 15000);
