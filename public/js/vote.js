'use strict';
const $ = id => document.getElementById(id);
const code = location.pathname.split('/').pop().toUpperCase();
let pollTimer = null;
let myVote = null;

function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function imgTag(p){
  return p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">`
    : `<img src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84"><rect width="84" height="84" fill="#eee"/><text x="42" y="48" font-size="28" text-anchor="middle">🍽️</text></svg>')}" alt="">`;
}
function votedFlag(){ return localStorage.getItem('gv_voted_' + code) === '1'; }
function setVotedFlag(){ localStorage.setItem('gv_voted_' + code, '1'); }

function statusLabel(state){
  if (state === 'open') return ['open', 'Abierta'];
  if (state === 'closed') return ['closed', 'Cerrada'];
  return ['expired', 'Vencida'];
}

async function load(){
  const r = await fetch('/api/rooms/' + code);
  if (!r.ok) {
    $('roomTitle').textContent = '😕 Votación no encontrada';
    $('candidates').innerHTML = '<div class="card"><p>Revisa que el enlace o QR esté completo.</p></div>';
    return;
  }
  render(await r.json());
}

function render(room){
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
    ? 'Cierra automáticamente: ' + d.toLocaleString('es', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
    : '';

  // Ganador
  const wb = $('winnerBox');
  if (room.winner && room.state !== 'open') {
    const w = room.winner;
    wb.classList.remove('hidden');
    wb.innerHTML = `<div class="winner"><h2>🏆 ¡Ganador!</h2>
      <div class="name" style="font-weight:700;font-size:1.1rem">${esc(w.name)}</div>
      ${w.address?`<div class="hint">📍 ${esc(w.address)}</div>`:''}
      <div class="hint">${w.votes} ${w.votes===1?'voto':'votos'}</div></div>`;
  } else wb.classList.add('hidden');

  const maxVotes = Math.max(1, ...room.candidates.map(c => c.votes));
  $('candidates').innerHTML = room.candidates.map(c => {
    const mine = myVote === c.id;
    const pct = Math.round(c.votes / maxVotes * 100);
    const canVote = room.state === 'open' && !votedFlag();
    return `<div class="card">
      <div class="place">${imgTag(c)}
        <div class="info">
          <div class="name">${esc(c.name)}${mine?'<span class="badge">tu voto ✓</span>':''}</div>
          ${c.type?`<div class="type">${esc(c.type)}</div>`:''}
          ${c.address?`<div class="addr">📍 ${esc(c.address)}</div>`:''}
          ${c.hours?`<div class="hours">🕐 ${esc(c.hours)}</div>`:''}
          ${c.notes?`<div class="notes">${esc(c.notes.slice(0,160))}${c.notes.length>160?'…':''}</div>`:''}
        </div>
      </div>
      <div class="result-line"><span><strong>${c.votes}</strong> ${c.votes===1?'voto':'votos'}</span></div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      ${canVote ? `<button class="vote-btn" data-id="${esc(c.id)}">Votar por este lugar</button>` : ''}
    </div>`;
  }).join('');

  $('candidates').querySelectorAll('.vote-btn').forEach(b =>
    b.addEventListener('click', () => vote(b.dataset.id)));

  // Organizador
  const orgToken = localStorage.getItem('gv_org_' + code);
  $('orgCard').classList.toggle('hidden', !(orgToken && room.state === 'open'));
  $('closeBtn').onclick = async () => {
    if (!confirm('¿Cerrar la votación y mostrar el ganador?')) return;
    const r = await fetch('/api/rooms/' + code + '/close', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ organizerToken: orgToken })
    });
    if (r.ok) render(await r.json());
    else alert('No se pudo cerrar.');
  };

  // Polling mientras esté abierta
  clearInterval(pollTimer);
  if (room.state === 'open') pollTimer = setInterval(load, 3000);
}

async function vote(placeId){
  const r = await fetch('/api/rooms/' + code + '/vote', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ placeId })
  });
  const data = await r.json();
  if (!r.ok) { alert(data.error || 'No se pudo votar'); return; }
  setVotedFlag();
  render(data);
}

load();
