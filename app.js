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

function closePickers() {
  if (startPick) closeStartPicker();
}

function save() {
  const a = state.active;
  if (!a) return;
  closePickers();
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
  closePickers();
  state.active = null;
  persist();
  render();
}

function del(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return false;
  if (!confirm(`Slet amning kl. ${fmtTime(s.start)} (${fmtDur(s.L + s.R)})?`)) return false;
  state.sessions = state.sessions.filter((x) => x.id !== id);
  persist();
  render();
  return true;
}

// ---------- Drejehjul ----------
const ROW = 40;
class Wheel {
  constructor(parent, labels, index, cls, onChange) {
    this.el = document.createElement('div');
    this.el.className = 'wheel ' + (cls || '');
    this.el.innerHTML = '<div class="pad"></div>' + labels.map((l) => `<div class="item">${l}</div>`).join('') + '<div class="pad"></div>';
    this.items = [...this.el.querySelectorAll('.item')];
    this.onChange = onChange;
    parent.appendChild(this.el);
    this.el.addEventListener('scroll', () => this.mark(), { passive: true });
    this.items.forEach((it, i) => it.addEventListener('click', () => this.el.scrollTo({ top: i * ROW, behavior: 'smooth' })));
    for (const ev of ['pointerdown', 'touchstart', 'wheel']) this.el.addEventListener(ev, () => { this.touched = true; }, { passive: true });
    // Sæt startposition med det samme (kræver at boksen er synlig), og igen i næste frame som fallback
    this.el.scrollTop = index * ROW;
    this.mark();
    this.ready = true;
    requestAnimationFrame(() => {
      if (!this.touched && this.el.scrollTop !== index * ROW) { this.el.scrollTop = index * ROW; this.mark(); }
    });
  }
  get index() { return Math.max(0, Math.min(this.items.length - 1, Math.round(this.el.scrollTop / ROW))); }
  mark() {
    const i = this.index;
    if (i === this._last) return;
    this._last = i;
    this.items.forEach((it, k) => it.classList.toggle('sel', k === i));
    if (this.ready && this.onChange) this.onChange();
  }
}
const range = (n) => Array.from({ length: n }, (_, i) => i);

// Tre hjul (dag, time, minut). Returnerer en funktion, der giver det valgte tidspunkt.
function dateWheels(box, ts, onChange) {
  box.innerHTML = '';
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const s = new Date(ts);
  const sd = new Date(s); sd.setHours(0, 0, 0, 0);
  let first = new Date(t0); first.setDate(t0.getDate() - 6);
  if (sd < first) first = sd;
  const days = [];
  for (const d = new Date(first); d <= t0; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const labels = days.map((d, i) => {
    const back = days.length - 1 - i;
    if (back === 0) return 'I dag';
    if (back === 1) return 'I går';
    return `${WD[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
  });
  const idx = Math.max(0, days.findIndex((d) => d.toDateString() === s.toDateString()));
  // Tidspunktet er det vigtigste: time og minut først og størst, dagen til sidst
  const w = {
    h: new Wheel(box, range(24).map(pad), s.getHours(), 'num big', onChange),
    m: new Wheel(box, range(60).map(pad), s.getMinutes(), 'num big', onChange),
    d: new Wheel(box, labels, idx, 'wday', onChange),
  };
  return () => {
    const d = new Date(days[w.d.index]);
    d.setHours(w.h.index, w.m.index, 0, 0);
    return d.getTime();
  };
}

// --- Starttid for igangværende amning ---
let startPick = null;
function openStartPicker() {
  const a = state.active;
  if (!a || startPick) return closeStartPicker();
  $('startPanel').hidden = false;
  startPick = { get: dateWheels($('startWheels'), a.start) };
  $('startDone').hidden = false;
  $('sessStart').hidden = true;
}
function closeStartPicker(apply) {
  if (startPick && apply && state.active) {
    state.active.start = Math.min(startPick.get(), Date.now());
    persist();
  }
  startPick = null;
  $('startPanel').hidden = true;
  $('startDone').hidden = true;
  $('sessStart').hidden = false;
  renderLive();
}

// ---------- Redigering ----------
const endOf = (s) => s.end || s.start + (s.L + s.R) * 1000;
const minStr = (sec) => String(Math.round(sec / 6) / 10);
function fmtDT(ts) {
  const d = new Date(ts), t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const back = Math.round((t0 - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (back === 0) return fmtTime(ts);
  if (back === 1) return `i går ${fmtTime(ts)}`;
  return `${d.getDate()}/${d.getMonth() + 1} ${fmtTime(ts)}`;
}

// ed = { id, start, end, L, R (sek), open: 'start'|'end'|null }
let ed = null;

function openEdit(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  ed = { id, start: s.start, end: endOf(s), L: s.L, R: s.R, open: null };
  closeEdWheels();
  $('edL').value = minStr(s.L);
  $('edR').value = minStr(s.R);
  updateEd();
  $('editDlg').returnValue = '';
  $('editDlg').showModal();
}

function closeEdWheels() {
  for (const k of ['start', 'end']) {
    const box = $(k === 'start' ? 'edStartWheels' : 'edEndWheels');
    box.hidden = true;
    box.innerHTML = '';
    $(k === 'start' ? 'edStartRow' : 'edEndRow').classList.remove('open');
  }
  if (ed) { ed.open = null; ed.apply = null; }
}

function toggleEdWheels(which) {
  const was = ed.open;
  closeEdWheels();
  if (was === which) return;
  ed.open = which;
  const box = $(which === 'start' ? 'edStartWheels' : 'edEndWheels');
  box.hidden = false;
  $(which === 'start' ? 'edStartRow' : 'edEndRow').classList.add('open');
  const apply = () => {
    const v = get();
    if (v === ed[which]) return;
    if (which === 'start') {
      // Flyt hele amningen; varigheden er uændret
      ed.end += v - ed.start;
      ed.start = v;
    } else {
      // Ny sluttid: fordel den nye varighed på siderne i samme forhold
      ed.end = v;
      if (ed.end > ed.start) {
        const dur = Math.round((ed.end - ed.start) / 1000), sum = ed.L + ed.R;
        if (sum > 0) { ed.L = Math.round((dur * ed.L) / sum); ed.R = dur - ed.L; }
        else { ed.L = dur; ed.R = 0; }
        $('edL').value = minStr(ed.L);
        $('edR').value = minStr(ed.R);
      }
    }
    updateEd();
  };
  const get = dateWheels(box, ed[which], apply);
  ed.apply = apply;
}

function updateEd() {
  $('edStartTxt').textContent = fmtDT(ed.start);
  $('edEndTxt').textContent = fmtDT(ed.end);
  const bad = !(ed.end > ed.start);
  $('edInfo').textContent = bad ? 'Slut skal være efter start.' : `Samlet amning: ${fmtDur(Math.round(ed.L + ed.R))}`;
  $('edInfo').style.color = bad ? 'var(--danger)' : '';
}

// Ændres minutterne: flyt sluttidspunktet tilsvarende
function onSideChange() {
  ed.L = Math.max(0, Math.round((parseFloat($('edL').value.replace(',', '.')) || 0) * 60));
  ed.R = Math.max(0, Math.round((parseFloat($('edR').value.replace(',', '.')) || 0) * 60));
  ed.end = ed.start + (ed.L + ed.R) * 1000;
  if (ed.open === 'end') closeEdWheels();
  updateEd();
}

$('edStartRow').addEventListener('click', () => toggleEdWheels('start'));
$('edEndRow').addEventListener('click', () => toggleEdWheels('end'));
$('edL').addEventListener('input', onSideChange);
$('edR').addEventListener('input', onSideChange);
$('edDelete').addEventListener('click', () => { if (del(ed.id)) $('editDlg').close('deleted'); });

// Gem via formularens submit (synkront) i stedet for dialogens close-event, som ikke altid affyres
$('editDlg').querySelector('form').addEventListener('submit', (e) => {
  if (!e.submitter || e.submitter.value !== 'save' || !ed) return;
  if (ed.apply) ed.apply(); // tag hjulets sidste position med, selv hvis scroll stadig var i gang
  const s = state.sessions.find((x) => x.id === ed.id);
  if (!s || !(ed.end > ed.start)) { alert('Ændringerne blev ikke gemt: slut skal være efter start.'); return; }
  s.start = ed.start;
  s.end = ed.end;
  s.L = ed.L;
  s.R = ed.R;
  state.sessions.sort((x, y) => y.start - x.start);
  persist();
  render();
});

// ---------- Visning ----------
function renderLive() {
  const now = Date.now();
  const a = state.active;
  for (const side of ['L', 'R']) {
    $('clock' + side).innerHTML = fmtClock(elapsed(side, now));
    const running = a && a.running === side;
    document.querySelector(`.side[data-side="${side}"]`).classList.toggle('running', !!running);
    const label = side === 'L' ? 'venstre' : 'højre';
    $('btn' + side).textContent = running ? `Stop ${label}` : `Start ${label}`;
    $('last' + side).classList.toggle('show', state.lastSide === side);
  }
  $('sessionBar').hidden = !a;
  if (a) {
    $('sessStart').textContent = fmtDT(a.start);
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
      <span class="time">${fmtTime(s.start)}<span class="to">–${fmtTime(endOf(s))}</span></span>
      <span class="sides">V ${fmtShort(s.L)} · H ${fmtShort(s.R)}</span>
      <span class="total">${fmtDur(s.L + s.R)}</span>`;
    row.addEventListener('click', () => openEdit(s.id));
    list.appendChild(row);
  }
}

function renderTitle() {
  $('title').textContent = statsOpen ? 'Statistik' : (state.name || 'Amning');
}

function render() {
  renderTitle();
  renderLive();
  renderHistory();
  if (statsOpen) renderStats();
}

// ---------- Statistik ----------
let statsOpen = false;
let statsDays = 7;
let statsSel = null;
const WD = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
const fmtHM = (sec) => {
  const m = Math.round(sec / 60), h = Math.floor(m / 60);
  return h ? `${h}t ${m % 60}m` : `${m}m`;
};

function showStats(open) {
  statsOpen = open;
  statsSel = null;
  $('statsView').hidden = !open;
  $('mainView').hidden = open;
  $('statsBtn').innerHTML = open
    ? '<span style="font-size:22px">✕</span>'
    : '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 20V12M12 20V5M19 20v-9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
  $('statsBtn').setAttribute('aria-label', open ? 'Tilbage' : 'Statistik');
  window.scrollTo(0, 0);
  render();
}

function computeStats(days) {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(t0); d.setDate(t0.getDate() - i);
    buckets.push({ date: d, key: d.toDateString(), list: [] });
  }
  const from = buckets[0].date.getTime();
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  const inPeriod = state.sessions.filter((s) => s.start >= from).sort((a, b) => a.start - b.start);
  for (const s of inPeriod) { const b = byKey.get(dayKey(s.start)); if (b) b.list.push(s); }

  const n = inPeriod.length;
  if (!n) return { buckets, n };
  const firstIdx = buckets.findIndex((b) => b.list.length);
  const activeDays = days - firstIdx;
  const sumL = inPeriod.reduce((t, s) => t + s.L, 0);
  const sumR = inPeriod.reduce((t, s) => t + s.R, 0);
  let gapSum = 0;
  for (let i = 1; i < n; i++) gapSum += inPeriod[i].start - inPeriod[i - 1].start;

  const today = buckets[buckets.length - 1].list;
  let longest = 0;
  for (let i = 1; i < today.length; i++) longest = Math.max(longest, today[i].start - today[i - 1].start);

  return {
    buckets, n, firstIdx,
    perDay: n / activeDays,
    avgDur: (sumL + sumR) / n,
    avgGap: n > 1 ? gapSum / (n - 1) : null,
    pctL: sumL + sumR ? Math.round((sumL / (sumL + sumR)) * 100) : null,
    today: { n: today.length, total: today.reduce((t, s) => t + s.L + s.R, 0), longest },
  };
}

function barPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function chartSVG(st) {
  const W = 358, H = 170, top = 18, bottom = 22, plotH = H - top - bottom;
  const n = st.buckets.length, slot = W / n, gap = n > 10 ? 2 : 8;
  const bw = slot - gap;
  const max = Math.max(1, ...st.buckets.map((b) => b.list.length));
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Antal amninger pr. dag">`;
  st.buckets.forEach((b, i) => {
    const c = b.list.length, x = i * slot + gap / 2;
    const h = (c / max) * plotH, y = top + plotH - h;
    const isToday = i === n - 1;
    if (c) out += `<path class="bar${isToday ? ' today' : ''}${statsSel === i ? ' sel' : ''}" d="${barPath(x, y, bw, h, 4)}"/>`;
    if (n <= 10 && c) out += `<text class="val" x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${c}</text>`;
    const label = n <= 10 ? (isToday ? 'i dag' : WD[b.date.getDay()])
      : ((n - 1 - i) % 5 === 0 ? (isToday ? 'i dag' : `${b.date.getDate()}/${b.date.getMonth() + 1}`) : '');
    if (label) out += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${label}</text>`;
    out += `<rect class="hit" data-i="${i}" x="${i * slot}" y="0" width="${slot}" height="${H}"/>`;
  });
  out += `<line class="base" x1="0" x2="${W}" y1="${top + plotH + 0.5}" y2="${top + plotH + 0.5}"/></svg>`;
  return out;
}

function captionFor(st, i) {
  if (i == null) return 'Tryk på en søjle for detaljer';
  const b = st.buckets[i];
  const tot = b.list.reduce((t, s) => t + s.L + s.R, 0);
  const d = b.date.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${d}: ${b.list.length} amninger · ${fmtHM(tot)}`;
}

function renderStats() {
  const st = computeStats(statsDays);
  const body = $('statsBody');
  if (!st.n) {
    body.innerHTML = '<div class="empty">Ingen amninger i perioden endnu.</div>';
    return;
  }
  const tile = (v, l) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const t = st.today;
  const todayLine = t.n
    ? `${t.n} amninger · ${fmtHM(t.total)} i alt${t.longest ? ` · længste pause ${fmtAgo(t.longest)}` : ''}`
    : 'Ingen amninger endnu i dag.';
  body.innerHTML = `
    <div class="tiles">
      ${tile(st.perDay.toLocaleString('da-DK', { maximumFractionDigits: 1 }), 'amninger pr. dag')}
      ${tile(fmtDur(Math.round(st.avgDur)), 'gns. varighed')}
      ${tile(st.avgGap ? fmtAgo(st.avgGap) : '–', 'gns. tid mellem')}
      ${tile(st.pctL == null ? '–' : `${st.pctL}<small style="font-size:16px">%</small> / ${100 - st.pctL}<small style="font-size:16px">%</small>`, 'venstre / højre')}
    </div>
    <h3>Amninger pr. dag</h3>
    <div class="chart">${chartSVG(st)}</div>
    <div class="chart-cap">${captionFor(st, statsSel)}</div>
    <h3>I dag</h3>
    <div class="today-line">${todayLine}</div>`;
  body.querySelectorAll('.hit').forEach((r) => r.addEventListener('click', () => {
    const i = +r.dataset.i;
    statsSel = statsSel === i ? null : i;
    renderStats();
  }));
}

document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
  statsDays = +b.dataset.days;
  statsSel = null;
  renderStats();
}));

// ---------- Indstillinger + backup ----------
function openSettings() {
  $('nameInput').value = state.name || '';
  $('settings').returnValue = '';
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
$('statsBtn').addEventListener('click', () => showStats(!statsOpen));
$('startRow').addEventListener('click', (e) => { if (e.target.id !== 'startDone') openStartPicker(); });
$('startDone').addEventListener('click', () => closeStartPicker(true));

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
