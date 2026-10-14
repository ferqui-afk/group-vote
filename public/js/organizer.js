'use strict';
const $ = id => document.getElementById(id);
const selected = new Map(); // id -> place
let searchTimer = null;

function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Si la imagen local no existe (deploy slim sin /images), cae a GitHub raw y luego al placeholder.
function placeImgErr(el){
  const lp = el.getAttribute('data-lp') || '';
  if(lp && !el.dataset.fb){ el.dataset.fb = '1'; el.src = 'https://raw.githubusercontent.com/ferqui-afk/group-vote/main/public' + lp; }
  else { el.onerror = null; el.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84"><rect width="84" height="84" fill="#eee"/><text x="42" y="48" font-size="28" text-anchor="middle">🍽️</text></svg>'); }
}
// ---- Fechas del calendario (YYYY-MM-DD, sin zona horaria) ----
function todayLocal(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseYMD(s){
  const p = String(s || '').split('-').map(Number);
  return new Date(p[0] || 1970, (p[1] || 1) - 1, p[2] || 1);
}
function shortDate(ymd, lang){
  if (!ymd) return '';
  return parseYMD(ymd).toLocaleDateString(lang || currentLang(), { day: 'numeric', month: 'short' });
}
function calDateLabel(ymd, lang){
  lang = lang || currentLang();
  if (!ymd) return '';
  const t0 = todayLocal();
  if (ymd === t0) return '📅 ' + t('today');
  const tm = parseYMD(t0); tm.setDate(tm.getDate() + 1);
  const tmStr = tm.getFullYear() + '-' + String(tm.getMonth() + 1).padStart(2, '0') + '-' + String(tm.getDate()).padStart(2, '0');
  if (ymd === tmStr) return '📅 ' + t('tomorrow');
  return '📅 ' + parseYMD(ymd).toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
}
function imgTag(p){
  const src = p.image || '';
  const fb = src.startsWith('/images/') ? ` data-lp="${esc(src)}" onerror="placeImgErr(this)"` : '';
  return src ? `<img src="${esc(src)}" alt="" loading="lazy"${fb}>`
             : `<img src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84"><rect width="84" height="84" fill="#eee"/><text x="42" y="48" font-size="28" text-anchor="middle">🍽️</text></svg>')}" alt="">`;
}
function reelShortcode(url){
  const m = /instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/.exec(url || '');
  return m ? m[1] : null;
}
let focusedId = null; // tarjeta/pin enfocado (sincronización mapa ↔ tarjetas)
function placeCard(p){
  const sel = selected.has(p.id) ? ' selected' : '';
  const act = focusedId === p.id ? ' active' : '';
  const linkBadge = String(p.id).startsWith('custom-') ? '<span class="badge">🔗</span>' : '';
  const sc = reelShortcode(p.reel_url);
  const hasX = (p.hours && p.hours.trim()) || (p.notes && p.notes.trim()) || sc;
  return `<div class="pick-card${sel}${act}" data-id="${esc(p.id)}">
    ${hasX ? `<button class="card-x" data-x="${esc(p.id)}" aria-label="ver horarios">ⓘ</button>` : ''}
    ${imgTag(p)}
    <div class="info">
      <div class="name">${esc(p.name)}${selected.has(p.id) ? '<span class="badge">✓</span>' : ''}${linkBadge}</div>
      ${p.type ? `<div class="type">${esc(p.type)}</div>` : ''}
      ${p.distance != null ? `<div class="dist">📍 ${p.distance} mi</div>` : ''}
      <div class="addr">${p.address ? esc(p.address.slice(0, 60)) + (p.address.length > 60 ? '…' : '') + ' ' : ''}<a class="maps-link" href="${esc(gmapsUrl(p))}" target="_blank" rel="noopener" title="${t('maps_btn')}" onclick="event.stopPropagation()">${mapsLogo()}</a></div>
      ${hasX ? `<div class="xinfo hidden">
        ${p.hours ? `<div class="hours">🕐 ${esc(p.hours)}</div>` : ''}
        ${p.notes ? `<div class="notes">${esc(p.notes)}</div>` : ''}
        ${sc ? `<div class="reel-slot" data-reel="${esc(sc)}"></div>` : ''}
      </div>` : ''}
    </div>
  </div>`;
}

let lastResults = [];
let carouselSeeded = false;
async function seedCarousel(){
  // Empieza con todos los lugares cercanos al centro del mapa
  if (!pickCenter) pickCenter = { ...BA_AIRBNB };
  if ($('search').value.trim()) return;
  const on = $('openNowSw').checked ? '&openNow=1' : '';
  const rg = selectedRegion ? '&region=' + encodeURIComponent(selectedRegion) : '';
  for (const m of [5, 25, 100]) {
    try {
      const r = await fetch(`/api/places/near?lat=${pickCenter.lat}&lng=${pickCenter.lng}&miles=${m}${on}${rg}`);
      const data = await r.json();
      if (data.places && data.places.length) {
        lastResults = data.places;
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
  if (!q && carouselSeeded) { loadNearby(false); seedCarousel(); return; }
  const rg = selectedRegion ? '&region=' + encodeURIComponent(selectedRegion) : '';
  const on = $('openNowSw').checked ? '&openNow=1' : '';
  const r = await fetch('/api/places?q=' + encodeURIComponent(q) + rg + on);
  const data = await r.json();
  lastResults = data.places;
  carouselSeeded = true;
  render();
  if (q) { // la búsqueda también filtra los pines del mapa
    drawPins(lastResults);
    fitToPins();
  }
}
function render(){
  const q = $('search').value.trim();
  $('countHint').textContent = q
    ? lastResults.length + ' ' + t('search_results')
    : (lastResults.length
        ? lastResults.length + ' ' + t('near_hint')
        : t('no_near'));
  $('results').innerHTML = lastResults.map(placeCard).join('') || '<p class="hint">' + t('no_results') + '</p>';
  $('results').querySelectorAll('.pick-card').forEach(el => {
    el.addEventListener('click', () => { focusedId = el.dataset.id; toggle(el.dataset.id); panToPick(el.dataset.id); });
  });
  $('results').querySelectorAll('[data-x]').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const card = b.closest('.pick-card');
      const xi = card.querySelector('.xinfo');
      const willOpen = xi.classList.contains('hidden');
      // Acordeón: al abrir una, las demás se cierran y sus videos se pausan (se quita el iframe).
      $('results').querySelectorAll('.xinfo').forEach(other => {
        if (other !== xi && !other.classList.contains('hidden')) {
          other.classList.add('hidden');
          const s = other.querySelector('.reel-slot');
          if (s) s.innerHTML = '';
          const ob = other.closest('.pick-card').querySelector('[data-x]');
          if (ob) ob.textContent = 'ⓘ';
        }
      });
      xi.classList.toggle('hidden', !willOpen);
      b.textContent = willOpen ? '✕' : 'ⓘ';
      if (willOpen) {
        const slot = xi.querySelector('.reel-slot');
        if (slot && !slot.querySelector('iframe')) {
          slot.innerHTML = `<div class="reel-wrap"><iframe src="https://www.instagram.com/reel/${esc(slot.dataset.reel)}/embed" loading="lazy" allowtransparency="true" title="Reel de Instagram"></iframe></div>`;
        }
      } else {
        const slot = xi.querySelector('.reel-slot');
        if (slot) slot.innerHTML = '';
      }
    });
  });
  updateBar();
}
function toggle(id){
  const p = lastResults.find(x => x.id === id) || nearCache.get(id);
  if (!p) return;
  if (selected.has(id)) selected.delete(id);
  else { if (selected.size >= 12) { alert(t('max12')); return; } selected.set(id, p); }
  render();
  refreshPickPins();
}
function updateBar(){
  const n = selected.size;
  $('selectedBar').classList.toggle('show', n > 0);
  $('chips').innerHTML = [...selected.values()].map(p =>
    `<span class="chip">${esc(p.name)}<button data-id="${esc(p.id)}" aria-label="quitar">✕</button></span>`).join('');
  $('chips').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); selected.delete(b.dataset.id); render(); }));
  const ok = n >= 2;
  $('createBtn').disabled = !ok;
}
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 250);
});
$('title').addEventListener('input', updateBar);
async function createVoting(){
  let title = $('title').value.trim();
  if (!title) { // sin título: usar los 2 primeros elegidos
    title = [...selected.values()].slice(0, 2).map(p => p.name).join(' vs ');
    $('title').value = title;
  }
  if (selected.size < 2 || !title) return;
  $('createBtn').disabled = true;
  $('goCreate').disabled = true;
  $('createBtn').textContent = t('creating');
  try {
    const r = await fetch('/api/rooms', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ title, placeIds: [...selected.keys()], eventDate: ($('eventDate') && $('eventDate').value) || todayLocal() })
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
      ? t('server_fail')
      : e.message;
    alert(t('create_fail') + msg);
  }
  $('createBtn').disabled = false;
  $('goCreate').disabled = false;
  $('createBtn').textContent = t('create_btn');
}
$('goCreate').addEventListener('click', createVoting);
$('createBtn').addEventListener('click', createVoting);
$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('voteLink').value); $('copyBtn').textContent = t('copied'); }
  catch(e){ $('voteLink').select(); document.execCommand('copy'); }
  setTimeout(() => $('copyBtn').textContent = t('copy'), 1500);
});

// ---- Añadir lugar con link de Instagram / Google Maps ----
let pendingLink = null;
$('linkBtn').addEventListener('click', async () => {
  const url = $('linkInput').value.trim();
  if (!url) { alert(t('link_paste_first')); return; }
  const prev = $('linkPreview');
  prev.innerHTML = '<p class="hint">' + t('link_reading') + '</p>';
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
        <div><strong>${t('reel_of_ig')}</strong></div>
        ${data.author ? `<div class="hint">${t('by_author')} @${esc(data.author)}</div>` : ''}
        ${data.caption ? `<div class="hint">${esc(data.caption)}</div>` : ''}
        <label class="mt" for="linkName"><strong>${t('place_name_label')}</strong></label>
        <input type="text" id="linkName" class="mt" placeholder="${esc(t('name_example'))}" maxlength="120">
        <label class="mt" for="linkType"><strong>${t('type_optional')}</strong></label>
        <input type="text" id="linkType" placeholder="${esc(t('type_example'))}" maxlength="60">
        <button class="btn mt" id="linkConfirm">${t('add_btn')}</button>
      </div>`;
    } else {
      prev.innerHTML = `<div class="link-card">
        <div><strong>${t('maps_gmaps_label')}</strong></div>
        <label class="mt" for="linkName"><strong>${t('place_name_label')}</strong></label>
        <input type="text" id="linkName" class="mt" value="${esc(data.name || '')}" maxlength="120">
        ${data.address ? `<div class="hint">${esc(data.address.slice(0, 140))}</div>` : ''}
        <button class="btn mt" id="linkConfirm">${t('add_btn')}</button>
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
  if (!name) { alert(t('link_name_it')); return; }
  if (selected.size >= 12) { alert(t('max12')); return; }
  const btn = $('linkConfirm');
  btn.disabled = true; btn.textContent = t('link_adding');
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
    $('linkPreview').innerHTML = `<p class="hint">✅ <strong>${esc(data.place.name)}</strong> ${t('added_msg')}</p>`;
    $('linkInput').value = '';
    pendingLink = null;
  } catch (e) { alert(t('link_add_fail') + e.message); }
  btn.disabled = false; btn.textContent = t('add_btn');
}

// ---- Elegir lugares por mapa (filtro por millas) ----
const nearCache = new Map();
let pickMap = null, pickCenter = null, pickPins = [], pickCircle = null, pickCenterDot = null;
const BA_AIRBNB = { lat: -34.5928367, lng: -58.4218671 };
function pickIcon(sel, focus){
  return L.divIcon({ className: '', html: `<div class="pick-pin${sel ? ' sel' : ''}${focus ? ' focus' : ''}">${sel ? '✓' : ''}</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11] });
}
function panToPick(id){
  if (!pickMap) return;
  focusedId = id;
  refreshPickPins();
  const m = pickPins.find(m => m._pid === id);
  if (!m) return;
  pickMap.setView(m.getLatLng(), Math.max(pickMap.getZoom(), 14), { animate: true });
  setTimeout(() => m.openPopup(), 350);
}
// Pin → tarjeta: baja a su tarjeta, la resalta y abre sus detalles (ⓘ)
function focusPickCard(id){
  focusedId = id;
  refreshPickPins();
  const card = $('results').querySelector('.pick-card[data-id="' + CSS.escape(id) + '"]');
  if (!card) return;
  $('results').querySelectorAll('.pick-card.active').forEach(el => el.classList.remove('active'));
  card.classList.add('active');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const xi = card.querySelector('.xinfo');
  if (xi && xi.classList.contains('hidden')) {
    const btn = card.querySelector('[data-x]');
    if (btn) btn.click();
  }
}
function refreshPickPins(){
  pickPins.forEach(m => m.setIcon(pickIcon(selected.has(m._pid), focusedId === m._pid)));
}
async function loadNearby(fit){
  if (!pickMap || !pickCenter) return;
  const miles = parseFloat($('radiusSel').value);
  const on = $('openNowSw').checked ? '&openNow=1' : '';
  const rg = selectedRegion ? '&region=' + encodeURIComponent(selectedRegion) : '';
  $('countHint').textContent = t('map_searching');
  try {
    const r = await fetch(`/api/places/near?lat=${pickCenter.lat}&lng=${pickCenter.lng}&miles=${miles}${on}${rg}`);
    const data = await r.json();
    pickPins.forEach(m => pickMap.removeLayer(m)); pickPins = [];
    nearCache.clear();
    if (pickCircle) pickMap.removeLayer(pickCircle);
    if (pickCenterDot) pickMap.removeLayer(pickCenterDot);
    pickCircle = null; pickCenterDot = null;
    const q = $('search').value.trim();
    if (q) {
      // Búsqueda activa: el mapa muestra solo los resultados de la búsqueda
      drawPins(lastResults);
      fitToPins();
      return;
    }
    pickCircle = L.circle([pickCenter.lat, pickCenter.lng], {
      radius: miles * 1609.34, color: '#c96f2e', weight: 1.5, fillOpacity: 0.07 }).addTo(pickMap);
    pickCenterDot = L.marker([pickCenter.lat, pickCenter.lng], {
      icon: L.divIcon({ className: '', html: '<div class="me-dot" style="width:14px;height:14px"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })
    }).addTo(pickMap).bindPopup(t('search_center'));
    drawPins(data.places);
    if (fit) pickMap.fitBounds(pickCircle.getBounds().pad(0.05));
  } catch(e){ $('countHint').textContent = t('map_load_fail'); }
}
function drawPins(places){
  pickPins.forEach(m => pickMap.removeLayer(m)); pickPins = [];
  places.forEach(p => {
    if (p.lat == null || p.lng == null) return;
    nearCache.set(p.id, p);
    const m = L.marker([p.lat, p.lng], { icon: pickIcon(selected.has(p.id), focusedId === p.id) }).addTo(pickMap);
    m._pid = p.id;
    m.on('click', () => focusPickCard(p.id));
    m.bindPopup(`<strong>${esc(p.name)}</strong><br>
      <span style="color:var(--muted);font-size:.85rem">${esc(p.type || '')}${p.type && p.distance != null ? ' · ' : ''}${p.distance != null ? p.distance + ' mi' : ''}</span><br>
      <a href="${esc(gmapsUrl(p))}" target="_blank" rel="noopener" title="${t('maps_btn')}">${mapsLogo()}</a>
      <button data-pick="${esc(p.id)}" class="btn-ghost btn-small" style="margin-top:6px">${selected.has(p.id) ? t('remove') : t('add')}</button>`);
    pickPins.push(m);
  });
}
function fitToPins(){
  if (!pickMap || !pickPins.length) return;
  const pts = pickPins.map(m => m.getLatLng());
  if (pts.length === 1) pickMap.setView(pts[0], 14);
  else pickMap.fitBounds(L.latLngBounds(pts).pad(0.1));
}
function initPickMap(){
  pickCenter = { ...BA_AIRBNB };
  pickMap = L.map('pickMap', { scrollWheelZoom: false }).setView([pickCenter.lat, pickCenter.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(pickMap);
  $('pickMap').addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    toggle(b.dataset.pick);
    b.textContent = selected.has(b.dataset.pick) ? t('remove') : t('add');
  });
  $('radiusSel').addEventListener('change', () => loadNearby(true));
  $('openNowSw').addEventListener('change', () => { loadNearby(true); if ($('search').value.trim()) doSearch(); else seedCarousel(); });
  $('expandMapBtn').addEventListener('click', () => {
    const c = $('pickMapCard');
    const full = c.classList.toggle('map-full');
    $('expandMapBtn').textContent = full ? t('collapse') : t('expand');
    setTimeout(() => pickMap && pickMap.invalidateSize(), 80);
  });
  $('geoBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { alert(t('link_no_geo')); return; }
    $('geoBtn').disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
      pickCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      loadNearby(true);
      seedCarousel();
      $('geoBtn').disabled = false;
    }, () => { alert(t('link_no_loc')); $('geoBtn').disabled = false; }, { timeout: 10000 });
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
  const map = { open: ['open', t('state_open')], closed: ['closed', t('state_closed')], expired: ['expired', t('state_expired')] };
  const [cls, label] = map[state] || map.expired;
  return `<span class="status ${cls}">${label}</span>`;
}
let lastActiveSig = '';
async function loadActiveRooms(){
  const list = $('activeRoomsList');
  if (!list) return;
  try {
    const r = await fetch('/api/rooms/active');
    const d = await r.json();
    const sig = JSON.stringify(d.rooms);
    if (sig === lastActiveSig) return; // sin cambios: no tocar el DOM (sin parpadeo)
    lastActiveSig = sig;
    if (!d.rooms.length) {
      list.innerHTML = '<p class="hint">' + t('active_empty') + '</p>';
      return;
    }
    list.innerHTML = d.rooms.map(rm => {
      const mins = Math.max(0, Math.round((rm.expiresAt - Date.now()) / 60000));
      const hrs = Math.floor(mins / 60), mm = mins % 60;
      const left = hrs ? `${hrs}${t('hours_h')} ${mm}${t('minutes')}` : `${mm}${t('minutes')}`;
      const dateChip = rm.eventDate ? ` · 📅 ${esc(shortDate(rm.eventDate))}` : '';
      return `<div class="dash-row">
        <span style="flex:1;min-width:0"><strong>${esc(rm.title)}</strong>
          <span class="hint"> · ${rm.candidates} lugares · ${rm.votes} ${rm.votes === 1 ? t('vote_1') : t('vote_n')}${dateChip} · ${t('active_expires')} ${left}</span></span>
        <a class="btn-ghost btn-small" style="text-decoration:none;white-space:nowrap" href="/v/${esc(rm.code)}">${t('active_enter')}</a>
      </div>`;
    }).join('');
  } catch(e) { /* sin conexión: se reintenta en el próximo ciclo */ }
}

// ---- Calendario: votaciones agrupadas por fecha del plan (público, para el grupo) ----
let lastCalSig = '';
async function loadCalendar(){
  const list = $('calList');
  if (!list) return;
  try {
    const r = await fetch('/api/calendar?days=14');
    const d = await r.json();
    const sig = JSON.stringify(d.rooms);
    if (sig === lastCalSig) return; // sin cambios: no tocar el DOM
    lastCalSig = sig;
    if (!d.rooms.length) {
      list.innerHTML = '<p class="hint">' + t('cal_empty') + '</p>';
      return;
    }
    const groups = {};
    d.rooms.forEach(rm => { (groups[rm.eventDate || '?'] = groups[rm.eventDate || '?'] || []).push(rm); });
    list.innerHTML = Object.keys(groups).sort().map(ymd => {
      const rows = groups[ymd].map(rm => {
        const badge = rm.state === 'open'
          ? `<span class="status open">${t('state_open')}</span>`
          : `<span class="status closed">🏆 ${esc(rm.winnerName || t('state_closed'))}</span>`;
        return `<div class="dash-row">
          <span style="flex:1;min-width:0"><strong>${esc(rm.title)}</strong> ${badge}
            <span class="hint"> · ${rm.candidates} lugares · ${rm.votes} ${rm.votes === 1 ? t('vote_1') : t('vote_n')}</span></span>
          <a class="btn-ghost btn-small" style="text-decoration:none;white-space:nowrap" href="/v/${esc(rm.code)}">${t('active_enter')}</a>
        </div>`;
      }).join('');
      return `<p class="hint" style="margin:10px 0 4px"><strong>${esc(calDateLabel(ymd))}</strong></p>` + rows;
    }).join('');
  } catch(e) { /* sin conexión: se reintenta en el próximo ciclo */ }
}

document.addEventListener('DOMContentLoaded', () => {
  const ed = $('eventDate');
  if (ed && !ed.value) ed.value = todayLocal(); // fecha del plan: hoy por defecto
  loadActiveRooms();
  setInterval(loadActiveRooms, 5000); // las nuevas aparecen solas
  loadCalendar();
  setInterval(loadCalendar, 30000); // el calendario cambia poco
  loadRegions();
});

let selectedRegion = ''; // id de la carpeta elegida; '' = todas
async function loadRegions(){
  const sel = $('regionSel');
  if (!sel) return;
  try {
    const r = await fetch('/api/regions');
    const d = await r.json();
    const byId = {};
    d.regions.forEach(rg => byId[rg.id] = rg);
    sel.innerHTML = '<option value="" disabled selected>' + t('folder_ph') + '</option>'
      + '<option value="__all__">' + t('folder_all') + '</option>' + d.regions.map(rg =>
      `<option value="${esc(rg.id)}">${esc(rg.label)} (${rg.count})</option>`).join('');
    sel.addEventListener('change', () => {
      selectedRegion = sel.value === '__all__' ? '' : sel.value;
      const rg = byId[selectedRegion];
      if (sel.value === '__all__') {
        pickCenter = { ...BA_AIRBNB };
        if (pickMap) pickMap.setView([pickCenter.lat, pickCenter.lng], 11, { animate: true });
      } else if (rg) {
        pickCenter = { lat: rg.lat, lng: rg.lng };
        if (pickMap) pickMap.setView([pickCenter.lat, pickCenter.lng], 11, { animate: true });
      }
      loadNearby(true);
      if ($('search').value.trim()) doSearch(); else seedCarousel();
    });
  } catch(e) { /* sin conexión */ }
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
  list.innerHTML = '<p class="hint">' + t('dash_loading') + '</p>';
  async function fetchRooms(codes, skipPrefix, skipSet){
    const rooms = [];
    for (const c of codes) {
      if (skipSet && skipSet.has(c)) continue; // ya listada en la otra sección
      try {
        const r = await fetch('/api/rooms/' + c);
        if (r.status === 404) { localStorage.removeItem(skipPrefix + c); continue; } // sala realmente borrada
        if (!r.ok) continue; // error transitorio (deploy caído, 5xx): conservar la clave, no borrarla
        rooms.push(await r.json());
      } catch(e){}
    }
    rooms.sort((a, b) => b.createdAt - a.createdAt);
    return rooms;
  }
  const orgRooms = await fetchRooms(orgCodes, 'gv_org_', null);
  const votedRooms = await fetchRooms(votedCodes, 'gv_voted_', new Set(orgCodes));
  if (!orgRooms.length && !votedRooms.length) { box.classList.add('hidden'); return; }
  const row = (rm, origin, canDelete) => {
    const lead = rm.state === 'open'
      ? (rm.candidates[0] && rm.candidates[0].votes > 0
          ? `${t('leading')} <strong>${esc(rm.candidates[0].name)}</strong> (${rm.candidates[0].votes})`
          : t('no_votes'))
      : (rm.winner ? `${t('won')} <strong>${esc(rm.winner.name)}</strong>` : t('no_winner'));
    return `<div class="dash-row">
      <div style="flex:1;min-width:0">
        <div><strong>${esc(rm.title)}</strong> ${statusBadge(rm.state)}${rm.eventDate ? ` <span class="hint">📅 ${esc(shortDate(rm.eventDate))}</span>` : ''} <span class="hint">· ${origin}</span></div>
        <div class="hint">${rm.totalVotes === 1 ? '1 ' + t('vote_1') : rm.totalVotes + ' ' + t('vote_n')} · ${lead}</div>
      </div>
      <a class="btn-ghost btn-small" style="text-decoration:none;white-space:nowrap" href="/v/${esc(rm.code)}">${t('dash_view')}</a>
      ${canDelete && rm.state !== 'open' ? `<button class="btn-ghost btn-small" data-reopen="${esc(rm.code)}" title="${t('reopen_vote')}">🔄 ${t('reopen_short')}</button>` : ''}
      ${canDelete ? `<button class="btn-ghost btn-small" data-del="${esc(rm.code)}" title="Eliminar votación">🗑️</button>`
                   : `<button class="btn-ghost btn-small" data-hide="${esc(rm.code)}" title="Quitar de mi lista">✕</button>`}
    </div>`;
  };
  const tagged = [
    ...orgRooms.map(r => ({ r, origin: t('dash_created'), canDelete: true })),
    ...votedRooms.map(r => ({ r, origin: t('dash_voted'), canDelete: false }))
  ];
  const actives = tagged.filter(x => x.r.state === 'open');
  const history = tagged.filter(x => x.r.state !== 'open');
  list.innerHTML =
    (actives.length ? `<p class="hint" style="margin:0 0 4px"><strong>${t('active_section')}</strong></p>` +
      actives.map(x => row(x.r, x.origin, x.canDelete)).join('') : '') +
    (history.length ? `<p class="hint" style="margin:12px 0 4px"><strong>${t('history_section')}</strong></p>` +
      history.map(x => row(x.r, x.origin, x.canDelete)).join('') : '');
  list.querySelectorAll('[data-reopen]').forEach(b => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await fetch('/api/rooms/' + b.dataset.reopen + '/reopen', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizerToken: localStorage.getItem('gv_org_' + b.dataset.reopen) })
        });
        if (!r.ok) throw new Error((await r.json()).error || 'Error');
        loadDashboard(); loadActiveRooms();
      } catch(e){ alert(t('reopen_fail') + ' ' + e.message); b.disabled = false; }
    });
  });
  list.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', async () => {
      const code = b.dataset.del;
      const rm = tagged.find(x => x.r.code === code);
      if (!confirm(t('dash_delete_confirm', { t: rm ? rm.r.title : code }))) return;
      b.disabled = true;
      try {
        const r = await fetch('/api/rooms/' + code, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizerToken: localStorage.getItem('gv_org_' + code) })
        });
        if (!r.ok) throw new Error((await r.json()).error || 'Error');
        localStorage.removeItem('gv_org_' + code);
        loadDashboard();
      } catch(e){ alert(t('dash_delete_fail') + e.message); b.disabled = false; }
    });
  });
  list.querySelectorAll('[data-hide]').forEach(b => {
    b.addEventListener('click', () => {
      localStorage.removeItem('gv_voted_' + b.dataset.hide);
      loadDashboard();
    });
  });
}
initPickMap();
seedCarousel();
loadDashboard();
setInterval(loadDashboard, 15000);
window.__reRender = () => { render(); loadDashboard(); loadActiveRooms(); if (pickMap) loadNearby(false); };
