'use strict';
// Preferencias compartidas: tema (dark/light) e idioma (es/en). Se guarda en localStorage.
const I18N = {
  es: {
    app_title: 'Votación en grupo', app_sub: 'Elige lugares, crea la votación y comparte el QR',
    active_title: '🗳️ Votaciones en curso', active_sub: 'Las votaciones nuevas aparecen aquí solas — no hay que reenviar el link.',
    active_loading: 'Buscando votaciones…', active_empty: 'Sin votaciones en curso — crea la primera arriba 👆',
    active_enter: 'Entrar →', active_expires: 'expira en',
    dash_title: '📊 Mis votaciones', dash_loading: 'Cargando…', dash_created: 'Creada por ti', dash_voted: 'Votaste',
    dash_view: 'Ver', dash_delete_confirm: '¿Eliminar la votación "{t}"? Se borrará para todos.', dash_delete_fail: 'No se pudo eliminar: ',
    step1: '1. Título de la votación', title_ph: 'Ej. Cena del viernes',
    map_title: '🗺️ Elige por mapa', map_sub: 'Filtra por distancia y toca los pines para añadir lugares.',
    my_loc: '📍 Mi ubicación', expand: '⛶ Expandir', collapse: '✕ Cerrar', open_now: 'Abiertos ahora', radius: 'Radio:',
    folder: '📁 Carpeta:', folder_ph: '📁 Elegir carpeta…', folder_all: '📁 Todas las carpetas',
    mile1: '1 milla', mile2: '2 millas', mile5: '5 millas', mile10: '10 millas', mile25: '25 millas', mile50: '50 millas', mile100: '100 millas',
    map_loading: 'Cargando lugares…', map_searching: 'Buscando lugares…', map_places_in: 'lugares dentro de',
    map_search_pins: 'resultados de la búsqueda en el mapa.',
    mile_sg: 'milla', mile_pl: 'millas', map_tap_pin: 'Toca un pin para añadirlo.', map_load_fail: 'No se pudo cargar los lugares.',
    step2: '2. O busca y elige al menos 2 lugares', search_ph: 'Buscar por nombre, tipo, barrio…',
    search_hint: 'Escribe para buscar entre los lugares del mapa.',
    near_hint: 'lugares cerca. Toca para elegir, ⓘ para ver horarios y reel.',
    search_results: 'resultados. Toca para elegir o quitar.',
    no_near: 'No hay lugares cerca de este punto. Amplía el radio o busca por nombre.',
    no_results: 'Sin resultados.', add_link_label: 'O añade un lugar pegando un link de Instagram o Google Maps',
    link_ph: 'Pega el link aquí…', add_btn: 'Añadir a la votación', link_reading: 'Leyendo el link…',
    link_paste_first: 'Pega un link primero', link_name_it: 'Ponle un nombre al lugar', link_adding: 'Añadiendo…',
    link_add_fail: 'No se pudo añadir: ', link_no_loc: 'No se pudo obtener tu ubicación', link_no_geo: 'Tu navegador no da ubicación',
    max12: 'Máximo 12 lugares por votación', create_btn: 'Crear votación', creating: 'Creando…', create_fail: 'No se pudo crear: ',
    go_create: 'Crear la votación',
    winner: '🏆 ¡Ganador!', vote_btn: 'Votar por este lugar', change_vote: 'Cambiar mi voto a este lugar',
    your_vote: 'tu voto ✓', voted_for: 'Votaste por', change_hint: 'toca otro lugar para cambiar tu voto 🔄',
    state_open: 'Abierta', state_closed: 'Cerrada', state_expired: 'Vencida',
    vote_1: 'voto', vote_n: 'votos', anon: 'anónimo', no_votes: 'Sin votos todavía', no_winner: 'Sin ganador',
    auto_close: 'Cierra automáticamente: ', name_prompt: '✏️ Escribe tu nombre para votar:', name_ph: 'Tu nombre',
    qr_title: '📱 QR para invitar', qr_sub: '— que entren más a votar', copy_link: 'Copiar enlace', copied: '¡Copiado!',
    copy_prompt: 'Copia el enlace:', view_cards: 'Tarjetas', view_board: 'Tablero en vivo',
    close_vote: 'Cerrar votación', close_fail: 'No se pudo cerrar.', vote_fail: 'No se pudo votar',
    room_not_found: 'Revisa que el enlace o QR esté completo.', view_loc: 'Ver mi ubicación',
    maps_btn: 'Ver en Google Maps', reel_btn: '▶ Ver reel en Instagram',
    server_fail: 'No se pudo conectar con el servidor. El enlace puede haber vencido, pide uno nuevo.',
    add: 'Añadir ✓', remove: 'Quitar ✕', hours: 'ver horarios', minutes: 'm', hours_h: 'h',
    close_confirm: '¿Cerrar la votación y mostrar el ganador?', board_sub: 'Toca un lugar para ver su tarjeta · se actualiza solo',
    not_found_title: 'Votación no encontrada',
    view_places: '🗺️ Lugares', org_hint: 'Eres el organizador de esta votación.',
    close_vote_long: 'Cerrar votación y ver ganador', back_dash: '← Volver a Mis votaciones',
    add_link_title: '3. O añade un lugar con link',
    link_hint: 'Pega un link de Instagram (reel o post) o de Google Maps para agregarlo como opción.',
    add_short: 'Añadir', create_hint: 'Selecciona 2 o más lugares y ponle título.',
    created_title: '¡Votación creada! 🎉', download_qr: 'Descargar QR', vote_link_label: 'Enlace para votar:',
    share_hint: 'Comparte el enlace o el QR con tus amigos. La votación dura 24 horas. Puedes cerrarla antes desde la página de votación.',
    open_vote: 'Abrir la votación', go_continue: 'Continuar con', picked: 'elegidos',
    copy: 'Copiar', reel_of_ig: '🎬 Reel de Instagram', by_author: 'por @',
    place_name_label: 'Nombre del lugar', type_optional: 'Tipo (opcional)',
    name_example: 'Ej. La Choppería', type_example: 'Ej. Bar',
    added_msg: 'añadido. Puedes seguir buscando o crear la votación.',
    search_center: 'Centro de búsqueda', leading: '👑 Va ganando:', won: '🏆 Ganó:',
    active_section: '🟢 Votaciones activas', history_section: '📜 Historial',
    maps_gmaps_label: '📍 Google Maps',
    view_board_short: '📊 Tablero',
    reopen_vote: 'Reabrir votación', reopen_short: 'Reabrir', reopen_fail: 'No se pudo reabrir.',
    edit_places: '✏️ Editar lugares', add_place_ph: 'Buscar lugar para añadir…', add_btn: 'Añadir',
    remove_cand: 'Quitar lugar', remove_cand_confirm: '¿Quitar este lugar de la votación?'
  },
  en: {
    app_title: 'Group voting', app_sub: 'Pick places, create the voting and share the QR',
    active_title: '🗳️ Votings in progress', active_sub: 'New votings show up here on their own — no need to resend the link.',
    active_loading: 'Looking for votings…', active_empty: 'No votings in progress — create the first one above 👆',
    active_enter: 'Join →', active_expires: 'expires in',
    dash_title: '📊 My votings', dash_loading: 'Loading…', dash_created: 'Created by you', dash_voted: 'You voted',
    dash_view: 'View', dash_delete_confirm: 'Delete voting "{t}"? It will be deleted for everyone.', dash_delete_fail: 'Could not delete: ',
    step1: '1. Voting title', title_ph: 'E.g. Friday dinner',
    map_title: '🗺️ Pick from the map', map_sub: 'Filter by distance and tap pins to add places.',
    my_loc: '📍 My location', expand: '⛶ Expand', collapse: '✕ Close', open_now: 'Open now', radius: 'Radius:',
    folder: '📁 Folder:', folder_ph: '📁 Choose folder…', folder_all: '📁 All folders',
    mile1: '1 mile', mile2: '2 miles', mile5: '5 miles', mile10: '10 miles', mile25: '25 miles', mile50: '50 miles', mile100: '100 miles',
    map_loading: 'Loading places…', map_searching: 'Searching places…', map_places_in: 'places within',
    map_search_pins: 'search results on the map.',
    mile_sg: 'mile', mile_pl: 'miles', map_tap_pin: 'Tap a pin to add it.', map_load_fail: 'Could not load places.',
    step2: '2. Or search and pick at least 2 places', search_ph: 'Search by name, type, neighborhood…',
    search_hint: 'Type to search among map places.',
    near_hint: 'places nearby. Tap to pick, ⓘ for hours and reel.',
    search_results: 'results. Tap to pick or remove.',
    no_near: 'No places near this point. Widen the radius or search by name.',
    no_results: 'No results.', add_link_label: 'Or add a place by pasting an Instagram or Google Maps link',
    link_ph: 'Paste the link here…', add_btn: 'Add to the voting', link_reading: 'Reading the link…',
    link_paste_first: 'Paste a link first', link_name_it: 'Give the place a name', link_adding: 'Adding…',
    link_add_fail: 'Could not add: ', link_no_loc: 'Could not get your location', link_no_geo: 'Your browser doesn\'t provide location',
    max12: 'Max 12 places per voting', create_btn: 'Create voting', creating: 'Creating…', create_fail: 'Could not create: ',
    go_create: 'Create the voting',
    winner: '🏆 Winner!', vote_btn: 'Vote for this place', change_vote: 'Change my vote to this place',
    your_vote: 'your vote ✓', voted_for: 'You voted for', change_hint: 'tap another place to change your vote 🔄',
    state_open: 'Open', state_closed: 'Closed', state_expired: 'Expired',
    vote_1: 'vote', vote_n: 'votes', anon: 'anonymous', no_votes: 'No votes yet', no_winner: 'No winner',
    auto_close: 'Closes automatically: ', name_prompt: '✏️ Write your name to vote:', name_ph: 'Your name',
    qr_title: '📱 QR to invite', qr_sub: '— so more can join to vote', copy_link: 'Copy link', copied: 'Copied!',
    copy_prompt: 'Copy the link:', view_cards: 'Cards', view_board: 'Live board',
    close_vote: 'Close voting', close_fail: 'Could not close.', vote_fail: 'Could not vote',
    room_not_found: 'Check that the link or QR is complete.', view_loc: 'See my location',
    maps_btn: 'See on Google Maps', reel_btn: '▶ Watch reel on Instagram',
    server_fail: 'Could not connect to the server. The link may have expired, ask for a new one.',
    add: 'Add ✓', remove: 'Remove ✕', hours: 'see hours', minutes: 'm', hours_h: 'h',
    close_confirm: 'Close the voting and show the winner?', board_sub: 'Tap a place to see its card · updates on its own',
    not_found_title: 'Voting not found',
    view_places: '🗺️ Places', org_hint: 'You are the organizer of this voting.',
    close_vote_long: 'Close voting and see winner', back_dash: '← Back to My votings',
    add_link_title: '3. Or add a place with a link',
    link_hint: 'Paste an Instagram link (reel or post) or a Google Maps link to add it as an option.',
    add_short: 'Add', create_hint: 'Pick 2 or more places and give it a title.',
    created_title: 'Voting created! 🎉', download_qr: 'Download QR', vote_link_label: 'Link to vote:',
    share_hint: 'Share the link or the QR with your friends. The voting lasts 24 hours. You can close it early from the voting page.',
    open_vote: 'Open the voting', go_continue: 'Continue with', picked: 'picked',
    copy: 'Copy', reel_of_ig: '🎬 Instagram reel', by_author: 'by @',
    place_name_label: 'Place name', type_optional: 'Type (optional)',
    name_example: 'E.g. The Chophouse', type_example: 'E.g. Bar',
    added_msg: 'added. You can keep searching or create the voting.',
    search_center: 'Search center', leading: '👑 Leading:', won: '🏆 Won:',
    active_section: '🟢 Active votings', history_section: '📜 History',
    maps_gmaps_label: '📍 Google Maps',
    view_board_short: '📊 Board',
    reopen_vote: 'Reopen voting', reopen_short: 'Reopen', reopen_fail: 'Could not reopen.',
    edit_places: '✏️ Edit places', add_place_ph: 'Search a place to add…', add_btn: 'Add',
    remove_cand: 'Remove place', remove_cand_confirm: 'Remove this place from the voting?'
  }
};
function currentLang(){ return localStorage.getItem('gv_lang') || 'es'; }
function t(key, vars){
  let s = (I18N[currentLang()] || I18N.es)[key];
  if (s == null) s = I18N.es[key] || key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}
function applyLang(){
  const lang = currentLang();
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  const lb = document.getElementById('langBtn');
  if (lb) lb.textContent = lang === 'es' ? 'EN' : 'ES';
  if (typeof window.__reRender === 'function') window.__reRender();
}
function setLang(lang){
  localStorage.setItem('gv_lang', lang);
  applyLang();
}
function applyTheme(){
  const theme = localStorage.getItem('gv_theme') || 'light';
  document.documentElement.dataset.theme = theme;
  const tb = document.getElementById('themeBtn');
  if (tb) tb.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme(){
  localStorage.setItem('gv_theme', (localStorage.getItem('gv_theme') || 'light') === 'dark' ? 'light' : 'dark');
  applyTheme();
}
// Google Maps: enlace por nombre + dirección (no coordenadas) para que muestre la ficha del lugar.
function gmapsUrl(p){
  const q = [p.name, p.address].filter(Boolean).join(' ');
  if (q) return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((p.lat || '') + ',' + (p.lng || ''));
}
// Logo de Google Maps (pin multicolor) como SVG inline.
function mapsLogo(){
  return '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-3px;margin-right:4px"><path fill="#EA4335" d="M12 2a8 8 0 0 0-8 8c0 5.2 7 11.4 7.3 11.7a1 1 0 0 0 1.4 0C13 21.4 20 15.2 20 10a8 8 0 0 0-8-8z"/><circle cx="12" cy="10" r="3.2" fill="#fff"/><path fill="#4285F4" d="M12 6.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z"/><circle cx="12" cy="10" r="1.4" fill="#34A853"/></svg>';
}
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  const tb = document.getElementById('themeBtn');
  if (tb) tb.addEventListener('click', toggleTheme);
  const lb = document.getElementById('langBtn');
  if (lb) lb.addEventListener('click', () => setLang(currentLang() === 'es' ? 'en' : 'es'));
  applyLang();
});
