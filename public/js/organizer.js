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
  return `<div class="card place selectable${sel}" data-id="${esc(p.id)}">
    ${imgTag(p)}
    <div class="info">
      <div class="name">${esc(p.name)}${selected.has(p.id)?'<span class="badge">✓</span>':''}</div>
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
doSearch();
