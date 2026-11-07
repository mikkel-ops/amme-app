'use strict';

const KEY = 'amme-v1';
const $ = (id) => document.getElementById(id);

// ---------- Lagring ----------
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.sessions)) return s;
  } catch (e) {}
  return { name: '', lastSide: null, active: null, sessions: [] };
}
let state = load();
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { alert('Kunne ikke gemme data.'); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- Hjælpere ----------
const pad = (n) => String(n).padStart(2, '0');
const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}<small>M</small> ${pad(s % 60)}<small>S</small>`;
};
const fmtDur = (sec) => {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
};
const fmtShort = (sec) => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
const fmtTime = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = (ts) => new Date(ts).toDateString();
function dayLabel(ts) {
  const d = new Date(ts), today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'I dag';
  if (d.toDateString() === yest.toDateString()) return 'I går';
  return d.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
}
function fmtAgo(ms) {
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}t ${m}m` : `${m}m`;
}

// ---------- Timer-logik ----------
// active = { start, acc: {L, R} (ms), running: 'L'|'R'|null, since }
function elapsed(side, now = Date.now()) {
  const a = state.active;
  if (!a) return 0;
  return a.acc[side] + (a.running === side ? now - a.since : 0);
}

function toggle(side) {
  const now = Date.now();
  let a = state.active;
  if (!a) {
    a = state.active = { start: now, acc: { L: 0, R: 0 }, running: side, since: now };
  } else if (a.running === side) {
    a.acc[side] += now - a.since;
    a.running = null;
  } else {
    if (a.running) a.acc[a.running] += now - a.since;
    a.running = side;
    a.since = now;
  }
  state.lastSide = side;
  persist();
  render();
}

function save() {
  const a = state.active;
  if (!a) return;
  const now = Date.now();
  const L = Math.round(elapsed('L', now) / 1000);
  const R = Math.round(elapsed('R', now) / 1000);
  if (L + R > 0) {
    state.sessions.push({ id: now.toString(36), start: a.start, end: now, L, R });
    state.sessions.sort((x, y) => y.start - x.start);
  }
  state.active = null;
  persist();
  render();
}

function cancel() {
  if (!confirm('Annullér denne amning uden at gemme?')) return;
  state.active = null;
  persist();
  render();
}

function del(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  if (!confirm(`Slet amning kl. ${fmtTime(s.start)} (${fmtDur(s.L + s.R)})?`)) return;
  state.sessions = state.sessions.filter((x) => x.id !== id);
  persist();
  render();
}

// ---------- Visning ----------
function renderLive() {
  const now = Date.now();
  const a = state.active;
  for (const side of ['L', 'R']) {
    $('clock' + side).innerHTML = fmtClock(elapsed(side, now));
    const running = a && a.running === side;
    document.querySelector(`.side[data-side="${side}"]`).classList.toggle('running', !!running);
    const label = side === 'L' ? 'venstre' : 'højre';
    $('btn' + side).textContent = running ? 'Pause' : `Start ${label}`;
    $('last' + side).classList.toggle('show', state.lastSide === side);
  }
  $('sessionBar').hidden = !a;
  if (a) {
    const d = new Date(a.start);
    $('sessStart').textContent = `${d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })} ${fmtTime(a.start)}`;
    $('sessTotal').textContent = fmtDur(Math.floor((elapsed('L', now) + elapsed('R', now)) / 1000));
  }
  const last = state.sessions[0];
  $('since').textContent = !a && last ? `Siden sidste amning: ${fmtAgo(now - last.start)}` : '';
}

function renderHistory() {
  const list = $('historyList');
  list.innerHTML = '';
  if (!state.sessions.length) {
    list.innerHTML = '<div class="empty">Ingen amninger endnu.</div>';
    return;
  }
  let currentDay = null;
  for (const s of state.sessions) {
    const k = dayKey(s.start);
    if (k !== currentDay) {
      currentDay = k;
      const h = document.createElement('div');
      h.className = 'day';
      const daySessions = state.sessions.filter((x) => dayKey(x.start) === k);
      const dayTotal = daySessions.reduce((t, x) => t + x.L + x.R, 0);
      h.textContent = `${dayLabel(s.start)} · ${daySessions.length} gange · ${fmtDur(dayTotal)}`;
      list.appendChild(h);
    }
    const row = document.createElement('div');
    row.className = 'entry';
    row.innerHTML = `
      <span class="time">${fmtTime(s.start)}</span>
      <span class="sides">V ${fmtShort(s.L)} · H ${fmtShort(s.R)}</span>
      <span class="total">${fmtDur(s.L + s.R)}</span>`;
    row.addEventListener('click', () => del(s.id));
    list.appendChild(row);
  }
}

function renderTitle() {
  $('title').textContent = state.name ? state.name : 'Amning';
}

function render() {
  renderTitle();
  renderLive();
  renderHistory();
}

// ---------- Indstillinger + backup ----------
function openSettings() {
  $('nameInput').value = state.name || '';
  $('settings').showModal();
}
$('settings').addEventListener('close', () => {
  if ($('settings').returnValue === 'save') {
    state.name = $('nameInput').value.trim();
    persist();
    renderTitle();
  }
});

$('exportBtn').addEventListener('click', async () => {
  const data = JSON.stringify({ app: 'amme', version: 1, exported: new Date().toISOString(), ...state }, null, 2);
  const fname = `amning-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([data], fname, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Amning backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = fname;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.sessions)) throw new Error('format');
    if (!confirm(`Importér ${d.sessions.length} amninger? De lægges sammen med dem, der allerede er her.`)) return;
    const ids = new Set(state.sessions.map((s) => s.id));
    for (const s of d.sessions) if (!ids.has(s.id)) state.sessions.push(s);
    state.sessions.sort((x, y) => y.start - x.start);
    if (!state.name && d.name) state.name = d.name;
    persist();
    render();
    alert('Backup importeret.');
  } catch (err) {
    alert('Filen kunne ikke læses som en backup.');
  }
});

// ---------- Opstart ----------
$('btnL').addEventListener('click', () => toggle('L'));
$('btnR').addEventListener('click', () => toggle('R'));
$('saveBtn').addEventListener('click', save);
$('cancelBtn').addEventListener('click', cancel);
$('settingsBtn').addEventListener('click', openSettings);

// Installationsvejledning i Safari (ikke når appen kører fra hjemmeskærmen)
const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
if (!standalone && isIOS && localStorage.getItem('amme-hint-closed') !== '1') $('installHint').hidden = false;
$('installClose').addEventListener('click', () => {
  $('installHint').hidden = true;
  try { localStorage.setItem('amme-hint-closed', '1'); } catch (e) {}
});

// Første opstart: spørg om barnets navn
if (!state.name && !state.sessions.length) setTimeout(openSettings, 300);

render();
setInterval(renderLive, 500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { state = load(); render(); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
