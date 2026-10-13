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
  return `<div class="card place selectable${sel}" data-id="${esc(p.id)}">
    ${imgTag(p)}
    <div class="info">
      <div class="name">${esc(p.name)}${selected.has(p.id)?'<span class="badge">✓</span>':''}${linkBadge}</div>
      ${p.type?`<div class="type">${esc(p.type)}</div>`:''}
      ${p.address?`<div class="addr">📍 ${esc(p.address)}</div>`:''}
      ${p.hours?`<div class="hours">🕐 ${esc(p.hours)}</div>`:''}
      ${p.notes?`<div class="notes">${esc(p.notes.slice(0,140))}${p.notes.length>140?'…':''}</div>`:''}
    </div>
  </div>`;
}

let lastResults = [];
async function doSearch(){
  const q = $('search').value.trim();
  const r = await fetch('/api/places?q=' + encodeURIComponent(q));
  const data = await r.json();
  lastResults = data.places;
  render();
}
function render(){
  $('countHint').textContent = lastResults.length + ' lugares. Toca para elegir o quitar.';
  $('results').innerHTML = lastResults.map(placeCard).join('') || '<p class="hint">Sin resultados.</p>';
  $('results').querySelectorAll('.selectable').forEach(el => {
    el.addEventListener('click', () => toggle(el.dataset.id));
  });
  updateBar();
}
function toggle(id){
  const p = lastResults.find(x => x.id === id);
  if (!p) return;
  if (selected.has(id)) selected.delete(id);
  else { if (selected.size >= 12) { alert('Máximo 12 lugares por votación'); return; } selected.set(id, p); }
  render();
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
  } catch(e){ alert('No se pudo crear: ' + e.message); }
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
  const codes = myRoomCodes();
  const box = $('dashCard'), list = $('dashList');
  if (!codes.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  list.innerHTML = '<p class="hint">Cargando…</p>';
  const rooms = [];
  for (const c of codes) {
    try {
      const r = await fetch('/api/rooms/' + c);
      if (!r.ok) { localStorage.removeItem('gv_org_' + c); continue; }
      rooms.push(await r.json());
    } catch(e){ /* offline: se intenta luego */ }
  }
  rooms.sort((a, b) => b.createdAt - a.createdAt);
  if (!rooms.length) { box.classList.add('hidden'); return; }
  list.innerHTML = rooms.map(rm => {
    const lead = rm.state === 'open'
      ? (rm.candidates[0] && rm.candidates[0].votes > 0
          ? `👑 Va ganando: <strong>${esc(rm.candidates[0].name)}</strong> (${rm.candidates[0].votes})`
          : 'Sin votos todavía')
      : (rm.winner ? `🏆 Ganó: <strong>${esc(rm.winner.name)}</strong>` : 'Sin ganador');
    return `<div class="dash-row">
      <div style="flex:1;min-width:0">
        <div><strong>${esc(rm.title)}</strong> ${statusBadge(rm.state)}</div>
        <div class="hint">${rm.totalVotes === 1 ? '1 voto' : rm.totalVotes + ' votos'} · ${lead}</div>
      </div>
      <a class="btn-ghost btn-small" style="text-decoration:none;white-space:nowrap" href="/v/${esc(rm.code)}">Ver</a>
    </div>`;
  }).join('');
}
doSearch();
loadDashboard();
setInterval(loadDashboard, 15000);
