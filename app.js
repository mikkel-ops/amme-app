'use strict';

const KEY = 'amme-v1';
const $ = (id) => document.getElementById(id);

// ---------- Lagring ----------
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.sessions)) {
      // Migrering: ble og søvn kom til senere
      if (!Array.isArray(s.diapers)) s.diapers = [];
      if (!Array.isArray(s.sleeps)) s.sleeps = [];
      if (s.sleepActive === undefined) s.sleepActive = null;
      return s;
    }
  } catch (e) {}
  return { name: '', lastSide: null, active: null, sessions: [], diapers: [], sleeps: [], sleepActive: null };
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
const fmtClockH = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}<small>T</small> ${pad(Math.floor(s / 60) % 60)}<small>M</small> ${pad(s % 60)}<small>S</small>`;
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
  if (sleepPick) closeSleepPicker();
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
  ed = { id, start: s.start, end: endOf(s), L: s.L, R: s.R, open: null, ratioL: s.L + s.R > 0 ? s.L / (s.L + s.R) : 1 };
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
    // Start eller slut ændret: den anden står stille, og den nye varighed
    // fordeles på siderne i samme forhold som før
    ed[which] = v;
    if (ed.end > ed.start) {
      const dur = Math.round((ed.end - ed.start) / 1000);
      ed.L = Math.round(dur * ed.ratioL);
      ed.R = dur - ed.L;
      $('edL').value = minStr(ed.L);
      $('edR').value = minStr(ed.R);
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
  if (ed.L + ed.R > 0) ed.ratioL = ed.L / (ed.L + ed.R);
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
  $('since').textContent = !a && last ? `Siden sidste amning sluttede: ${fmtAgo(now - endOf(last))}` : '';
  renderSleepLive(now);
  const lastD = state.diapers[0];
  $('diaperSince').textContent = lastD ? `Siden sidste ble: ${fmtAgo(now - lastD.ts)} · ${lastD.kind}` : '';
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
  renderDiapers();
  renderSleeps();
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
  applyViews();
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

document.querySelectorAll('#statsView .seg button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#statsView .seg button').forEach((x) => x.classList.toggle('on', x === b));
  statsDays = +b.dataset.days;
  statsSel = null;
  renderStats();
}));

// ---------- Faner ----------
const TAB_COLOR = { feed: '#f4cd5f', diaper: '#efe6d2', sleep: '#bfe0ee' };
const TAB_VIEW = { feed: 'mainView', diaper: 'diaperView', sleep: 'sleepView' };
let tab = 'feed';
try { const t = localStorage.getItem('amme-tab'); if (TAB_VIEW[t]) tab = t; } catch (e) {}

function applyViews() {
  $('statsView').hidden = !statsOpen;
  for (const t in TAB_VIEW) $(TAB_VIEW[t]).hidden = statsOpen || t !== tab;
  document.body.className = 'tab-' + tab;
  $('themeColor').setAttribute('content', TAB_COLOR[tab]);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
}

function showTab(t) {
  closePickers();
  tab = t;
  try { localStorage.setItem('amme-tab', t); } catch (e) {}
  if (statsOpen) showStats(false); else { applyViews(); window.scrollTo(0, 0); }
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// Fælles: historik grupperet pr. dag
function renderGrouped(el, items, tsOf, emptyTxt, headFn, rowFn) {
  el.innerHTML = '';
  if (!items.length) { el.innerHTML = `<div class="empty">${emptyTxt}</div>`; return; }
  let currentDay = null;
  for (const it of items) {
    const k = dayKey(tsOf(it));
    if (k !== currentDay) {
      currentDay = k;
      const h = document.createElement('div');
      h.className = 'day';
      h.textContent = `${dayLabel(tsOf(it))} · ${headFn(items.filter((x) => dayKey(tsOf(x)) === k))}`;
      el.appendChild(h);
    }
    el.appendChild(rowFn(it));
  }
}

// Fælles: rækker med drejehjul i en dialog. rows = { felt: [rækkeId, hjulboksId] }.
// getObj() giver objektet, hvis felter er tidspunkter. onApply(felt) kaldes, når et tidspunkt ændres.
function wheelRows(rows, getObj, onApply) {
  let open = null, apply = null;
  const close = () => {
    for (const k in rows) {
      const box = $(rows[k][1]);
      box.hidden = true;
      box.innerHTML = '';
      $(rows[k][0]).classList.remove('open');
    }
    open = null;
    apply = null;
  };
  const toggle = (k) => {
    const was = open;
    close();
    if (was === k) return;
    open = k;
    const box = $(rows[k][1]);
    box.hidden = false;
    $(rows[k][0]).classList.add('open');
    const o = getObj();
    const get = dateWheels(box, o[k], () => apply && apply());
    apply = () => {
      const v = get();
      if (v === o[k]) return;
      o[k] = v;
      onApply(k);
    };
  };
  for (const k in rows) $(rows[k][0]).addEventListener('click', () => toggle(k));
  return { close, flush: () => { if (apply) apply(); } };
}

// ---------- Ble ----------
// diapers = [{ id, ts, kind: 'tis'|'lort' }], nyeste først
let flashTimer = null;
function logDiaper(kind, btn) {
  const now = Date.now();
  state.diapers.push({ id: now.toString(36), ts: now, kind });
  state.diapers.sort((x, y) => y.ts - x.ts);
  persist();
  render();
  btn.classList.add('hit');
  setTimeout(() => btn.classList.remove('hit'), 350);
  $('diaperFlash').textContent = `${kind === 'tis' ? 'Tis' : 'Lort'} gemt kl. ${fmtTime(now)}`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { $('diaperFlash').textContent = ''; }, 4000);
}
document.querySelectorAll('.diaper-btns .circle').forEach((b) => b.addEventListener('click', () => logDiaper(b.dataset.kind, b)));

function renderDiapers() {
  renderGrouped($('diaperList'), state.diapers, (d) => d.ts, 'Ingen bleer endnu.',
    (list) => {
      const tis = list.filter((d) => d.kind === 'tis').length, lort = list.length - tis;
      const parts = [`${list.length} ${list.length === 1 ? 'ble' : 'bleer'}`];
      if (tis) parts.push(`${tis} tis`);
      if (lort) parts.push(`${lort} lort`);
      return parts.join(' · ');
    },
    (d) => {
      const row = document.createElement('div');
      row.className = 'entry';
      row.innerHTML = `<span class="time">${fmtTime(d.ts)}</span><span class="kind"><b class="${d.kind}"></b>${d.kind === 'tis' ? 'Tis' : 'Lort'}</span>`;
      row.addEventListener('click', () => openDiaperEdit(d.id));
      return row;
    });
}

// dp = { id, ts, kind }
let dp = null;
const dpWheels = wheelRows({ ts: ['dpTimeRow', 'dpTimeWheels'] }, () => dp, () => updateDp());
function updateDp() {
  $('dpTimeTxt').textContent = fmtDT(dp.ts);
  document.querySelectorAll('#dpKind button').forEach((b) => b.classList.toggle('on', b.dataset.kind === dp.kind));
}
function openDiaperEdit(id) {
  const d = state.diapers.find((x) => x.id === id);
  if (!d) return;
  dp = { id, ts: d.ts, kind: d.kind };
  dpWheels.close();
  updateDp();
  $('diaperDlg').returnValue = '';
  $('diaperDlg').showModal();
}
document.querySelectorAll('#dpKind button').forEach((b) => b.addEventListener('click', () => { dp.kind = b.dataset.kind; updateDp(); }));
$('dpDelete').addEventListener('click', () => {
  if (!confirm(`Slet ble kl. ${fmtTime(dp.ts)}?`)) return;
  state.diapers = state.diapers.filter((x) => x.id !== dp.id);
  persist();
  render();
  $('diaperDlg').close('deleted');
});
$('diaperDlg').querySelector('form').addEventListener('submit', (e) => {
  if (!e.submitter || e.submitter.value !== 'save' || !dp) return;
  dpWheels.flush();
  const d = state.diapers.find((x) => x.id === dp.id);
  if (!d) return;
  d.ts = dp.ts;
  d.kind = dp.kind;
  state.diapers.sort((x, y) => y.ts - x.ts);
  persist();
  render();
});

// ---------- Søvn ----------
// sleeps = [{ id, start, end }], nyeste først. sleepActive = null | { start }
function toggleSleep() {
  const now = Date.now();
  const a = state.sleepActive;
  if (!a) {
    state.sleepActive = { start: now };
  } else {
    closePickers();
    if (now > a.start) {
      state.sleeps.push({ id: now.toString(36), start: a.start, end: now });
      state.sleeps.sort((x, y) => y.start - x.start);
    }
    state.sleepActive = null;
  }
  persist();
  render();
}

function cancelSleep() {
  if (!confirm('Annullér denne søvn uden at gemme?')) return;
  closePickers();
  state.sleepActive = null;
  persist();
  render();
}

let sleepPick = null;
function openSleepPicker() {
  const a = state.sleepActive;
  if (!a || sleepPick) return closeSleepPicker();
  $('sleepStartPanel').hidden = false;
  sleepPick = { get: dateWheels($('sleepStartWheels'), a.start) };
  $('sleepStartDone').hidden = false;
  $('sleepStart').hidden = true;
}
function closeSleepPicker(apply) {
  if (sleepPick && apply && state.sleepActive) {
    state.sleepActive.start = Math.min(sleepPick.get(), Date.now());
    persist();
  }
  sleepPick = null;
  $('sleepStartPanel').hidden = true;
  $('sleepStartDone').hidden = true;
  $('sleepStart').hidden = false;
  renderLive();
}

function renderSleepLive(now) {
  const a = state.sleepActive;
  $('sleepClock').innerHTML = fmtClockH(a ? Math.max(0, now - a.start) : 0);
  $('sleepBtn').textContent = a ? 'Vågnet' : 'Start søvn';
  document.querySelector('.sleep-top').classList.toggle('running', !!a);
  $('sleepLabel').textContent = a ? 'Sover nu' : 'Vågen';
  $('sleepBar').hidden = !a;
  if (a) $('sleepStart').textContent = fmtDT(a.start);
  const last = state.sleeps[0];
  $('sleepSince').textContent = !a && last ? `Vågnede for ${fmtAgo(now - last.end)} siden` : '';
}

function renderSleeps() {
  renderGrouped($('sleepList'), state.sleeps, (s) => s.start, 'Ingen lure endnu.',
    (list) => `${list.length} ${list.length === 1 ? 'lur' : 'lure'} · ${fmtHM(list.reduce((t, s) => t + (s.end - s.start) / 1000, 0))}`,
    (s) => {
      const row = document.createElement('div');
      row.className = 'entry';
      row.innerHTML = `<span class="time">${fmtTime(s.start)}<span class="to">–${fmtTime(s.end)}</span></span><span class="total">${fmtHM((s.end - s.start) / 1000)}</span>`;
      row.addEventListener('click', () => openSleepEdit(s.id));
      return row;
    });
}

// sl = { id (null = ny), start, end }
let sl = null;
const slWheels = wheelRows({ start: ['slStartRow', 'slStartWheels'], end: ['slEndRow', 'slEndWheels'] }, () => sl, () => updateSl());
function updateSl() {
  $('slStartTxt').textContent = fmtDT(sl.start);
  $('slEndTxt').textContent = fmtDT(sl.end);
  const bad = !(sl.end > sl.start);
  $('slInfo').textContent = bad ? 'Slut skal være efter start.' : `Sov i ${fmtHM((sl.end - sl.start) / 1000)}`;
  $('slInfo').style.color = bad ? 'var(--danger)' : '';
}
function openSleepEdit(id) {
  if (id) {
    const s = state.sleeps.find((x) => x.id === id);
    if (!s) return;
    sl = { id, start: s.start, end: s.end };
  } else {
    const now = new Date(); now.setSeconds(0, 0);
    sl = { id: null, start: now.getTime() - 3600e3, end: now.getTime() };
  }
  $('slTitle').textContent = id ? 'Redigér søvn' : 'Tilføj søvn';
  $('slDelete').hidden = !id;
  slWheels.close();
  updateSl();
  $('sleepDlg').returnValue = '';
  $('sleepDlg').showModal();
}
$('slDelete').addEventListener('click', () => {
  if (!confirm(`Slet søvn kl. ${fmtTime(sl.start)}–${fmtTime(sl.end)}?`)) return;
  state.sleeps = state.sleeps.filter((x) => x.id !== sl.id);
  persist();
  render();
  $('sleepDlg').close('deleted');
});
$('sleepDlg').querySelector('form').addEventListener('submit', (e) => {
  if (!e.submitter || e.submitter.value !== 'save' || !sl) return;
  slWheels.flush();
  if (!(sl.end > sl.start)) { alert('Søvnen blev ikke gemt: slut skal være efter start.'); return; }
  if (sl.id) {
    const s = state.sleeps.find((x) => x.id === sl.id);
    if (!s) return;
    s.start = sl.start;
    s.end = sl.end;
  } else {
    state.sleeps.push({ id: Date.now().toString(36), start: sl.start, end: sl.end });
  }
  state.sleeps.sort((x, y) => y.start - x.start);
  persist();
  render();
});

$('sleepBtn').addEventListener('click', toggleSleep);
$('sleepCancel').addEventListener('click', cancelSleep);
$('sleepAdd').addEventListener('click', () => openSleepEdit(null));
$('sleepStartRow').addEventListener('click', (e) => { if (e.target.id !== 'sleepStartDone') openSleepPicker(); });
$('sleepStartDone').addEventListener('click', () => closeSleepPicker(true));

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
    const keys = ['sessions', 'diapers', 'sleeps'].filter((k) => Array.isArray(d[k]));
    if (!keys.length) throw new Error('format');
    const cnt = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
    if (!confirm(`Importér ${cnt('sessions')} amninger, ${cnt('diapers')} bleer og ${cnt('sleeps')} lure? De lægges sammen med dem, der allerede er her.`)) return;
    for (const k of keys) {
      const ids = new Set(state[k].map((s) => s.id));
      for (const s of d[k]) if (!ids.has(s.id)) state[k].push(s);
    }
    state.sessions.sort((x, y) => y.start - x.start);
    state.diapers.sort((x, y) => y.ts - x.ts);
    state.sleeps.sort((x, y) => y.start - x.start);
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

applyViews();
render();
setInterval(renderLive, 500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { state = load(); render(); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
