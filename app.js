// Swole Mole - Today, More and Day tabs, export. Spec and rules: CLAUDE.md.
'use strict';

// +/- step and unit label per load_type (see CLAUDE.md, "Data contract").
const STEP = { 'stack-kg': 5, 'dumbbell-per-hand-kg': 1, 'bodyweight-plus-kg': 2.5, 'time-seconds': 5 };
const UNIT = { 'stack-kg': 'kg', 'dumbbell-per-hand-kg': 'kg per hand', 'bodyweight-plus-kg': 'kg added', 'time-seconds': 'seconds' };
const REST_HIDE_MS = 30 * 60 * 1000;      // rest timer disappears after 30 min
const NEW_DAY_IDLE_MS = 3 * 60 * 60 * 1000; // past midnight, stay on the old day until 3 h idle

// Mood chips -> the day's "state" array. Tag values are fixed by log.schema.json.
const MOODS = [
  ['good-day', '🙂', 'good day'], ['strong', '💪', 'strong'], ['slept-badly', '😴', 'slept badly'],
  ['low-energy', '🐌', 'low energy'], ['sore', '🤕', 'sore'], ['hot', '🥵', 'hot'],
  ['stressed', '😬', 'stressed'], ['rushed', '⏱️', 'rushed'],
];

let exercises = {};   // id -> library entry
let program = [];     // program items: { exercise, sets, rep_range, per_side, note }
let bundledLast = {}; // id -> { date, load, reps } from data/last.json
let last = {};        // id -> most recent { date, load, reps }, bundled or local
let days = [];        // every day record in IndexedDB, today's included
let day = null;       // today's record: { date, note, state, ex: { id: entry }, exported }
let venues = null;    // data/venues.json "venues": { gym, home }
let coaching = null;  // data/coaching.json { updated, text }, or null when absent
let openId = null;    // exercise shown fullscreen, or null
let tab = 'today';    // 'today' | 'more' | 'day'
let moreView = 'other'; // tab 2 toggle: 'other' (not in program) | 'home'
let resetArmedAt = 0; // reset needs a second tap within RESET_CONFIRM_MS
const RESET_CONFIRM_MS = 5000;

// Settings are per-device conveniences, so localStorage is fine.
function getPref(key, fallback) {
  try { return localStorage.getItem('swolemole.' + key) ?? fallback; } catch { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem('swolemole.' + key, value); } catch { /* private mode: keep the default */ }
}
const LANGS = [['it', 'Italiano'], ['en', 'English']]; // nothing is translated yet
const getLang = () => getPref('lang', 'en');
const timerOn = () => getPref('timer', 'on') === 'on';
const tabScroll = {}; // window scroll per tab

const $ = sel => document.querySelector(sel);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isFreeform = id => id.startsWith('ff-');
const name = id => isFreeform(id) ? day.ex[id]?.freeform ?? '' : id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
const loadType = id => exercises[id]?.load_type ?? 'stack-kg';
const hasLoad = id => loadType(id) !== 'bodyweight';
const hasReps = id => loadType(id) !== 'time-seconds';
const num = s => { const n = parseFloat(String(s).replace(',', '.')); return isNaN(n) ? null : n; };
const round = n => Math.round(n * 100) / 100;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- IndexedDB: one record per day, keyed by date ----------

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((ok, fail) => {
    const req = indexedDB.open('swolemole', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('days', { keyPath: 'date' });
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
  return dbPromise;
}

async function dbAll() {
  const store = (await db()).transaction('days').objectStore('days');
  return new Promise((ok, fail) => {
    const req = store.getAll();
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

// Called on every change - there is no save button.
async function save(rec = day) {
  (await db()).transaction('days', 'readwrite').objectStore('days').put(rec);
}

// ---------- Day record -> log.schema.json "day" object ----------

// Only committed sets are exported. An exercise with nothing committed and no
// note was not performed and is left out.
function toDay(rec) {
  const out = { date: rec.date };
  if (rec.note) out.note = rec.note;
  if (rec.state?.length) out.state = rec.state;
  const list = [];
  for (const [id, e] of Object.entries(rec.ex)) {
    if (!e.sets.length && !e.note) continue;
    const p = e.freeform ? { freeform: e.freeform, status: 'trialing' } : { exercise: id };
    if (hasLoad(id) && e.load != null) p.load = e.load;
    if (e.sets.length) {
      p.sets = e.sets.length;
      if (hasReps(id)) p.reps = e.sets.map(s => s.reps);
    }
    if (e.rir != null) p.rir = e.rir;
    if (e.note) p.note = e.note;
    list.push(p);
  }
  if (list.length) out.exercises = list;
  return out;
}

function buildLast(pastDays) {
  last = { ...bundledLast };
  for (const d of pastDays.sort((a, b) => a.date.localeCompare(b.date))) {
    for (const p of toDay(d).exercises ?? []) {
      if (p.freeform) continue;
      if (!last[p.exercise] || last[p.exercise].date <= d.date) last[p.exercise] = { date: d.date, load: p.load, reps: p.reps };
    }
  }
}

// An exercise entry: { load, sets: [{ reps, at }] (committed, in order),
// next: reps for the set being worked on, rir, note }. A freeform entry (a
// movement with no library id) is keyed "ff-<timestamp>" and also carries
// `freeform`, its description.

// The program item for an id, or a bare item (no planned sets) for anything
// logged from tab 2.
function itemFor(id) {
  return program.find(p => p.exercise === id) ?? { exercise: id };
}

function addFreeform(text) {
  const id = 'ff-' + Date.now();
  day.ex[id] = { freeform: text, load: null, sets: [], next: null, rir: null, note: '' };
  save();
  return id;
}

// Reps to offer for set number i (0-based): last session's same set, else the
// set just committed.
function prefillReps(id, i) {
  return last[id]?.reps?.[i] ?? day.ex[id]?.sets.at(-1)?.reps ?? null;
}

// Today's entry for an exercise, prefilled from last time on first touch.
function entry(item) {
  const id = item.exercise;
  day.ex[id] ??= { load: last[id]?.load ?? null, sets: [], next: prefillReps(id, 0), rir: null, note: '' };
  return day.ex[id];
}

// Records saved before sets became a commit list had parallel reps/done arrays.
function upgrade(rec) {
  for (const e of Object.values(rec.ex)) {
    if (!e.done) continue;
    e.sets = e.done.flatMap((at, i) => (at ? [{ reps: e.reps[i] ?? null, at }] : []));
    e.next = null;
    delete e.done;
    delete e.reps;
  }
  return rec;
}

// Completion is derived from the committed sets, never stored. Without planned
// sets (tab 2) nothing is ever "complete".
function isComplete(item) {
  return !!item.sets && (day.ex[item.exercise]?.sets.length ?? 0) >= item.sets;
}

function lastDoneAt() {
  return Math.max(0, ...Object.values(day.ex).flatMap(e => e.sets.map(s => s.at)));
}

// ---------- Rendering ----------

function loadText(id, load) {
  if (!hasLoad(id)) return 'bodyweight';
  return load == null ? '' : `${load} ${loadType(id) === 'time-seconds' ? 's' : 'kg'}`;
}

// "Can be done at home" is derived: everything the exercise requires is in
// venues.home.equipment. Never store it on the exercise.
function isHome(id) {
  const home = venues?.home?.equipment ?? [];
  return !!exercises[id]?.requires.every(r => home.includes(r));
}

function icon(id) {
  // The grey square is the neutral fallback; the image covers it when it exists.
  // Home-doable exercises are tinted blue by CSS, so the colour follows venues.json.
  if (isFreeform(id)) return '<div class="ico"></div>';
  return `<div class="ico${isHome(id) ? ' home' : ''}"><img src="icons/exercises/${id}.svg" alt="" onerror="this.remove()"></div>`;
}

function rowHtml(item) {
  const id = item.exercise;
  const e = day.ex[id];
  let sub;
  if (e?.sets.length) {
    const n = item.sets ? `${e.sets.length}/${item.sets} sets` : `${e.sets.length} set${e.sets.length > 1 ? 's' : ''}`;
    sub = `today: ${n} · ${loadText(id, e.load)}`;
  } else if (isFreeform(id)) {
    sub = 'new movement · trialing';
  } else if (last[id]) {
    const reps = last[id].reps?.map(r => r ?? '?').join(' ');
    sub = `last: ${loadText(id, last[id].load)}${reps ? ' · ' + reps : ''}`;
  } else {
    sub = 'no history yet';
  }
  return `<li class="row${isComplete(item) ? ' complete' : ''}" data-id="${esc(id)}">
    ${icon(esc(id))}
    <div><div class="name">${esc(name(id))}</div><div class="sub">${esc(sub)}</div></div>
  </li>`;
}

// Completed exercises sink to the bottom; otherwise the given order (sort is stable).
const byDone = items => [...items].sort((a, b) => isComplete(a) - isComplete(b));

function renderList() {
  $('#list').innerHTML = byDone(program).map(rowHtml).join('')
    || '<li class="empty">The program is empty. Run tools/sync_data.py.</li>';
}

// Tab 2: library exercises not in the program, or those doable at home.
function renderMore() {
  const inProgram = new Set(program.map(p => p.exercise));
  const lib = Object.values(exercises).sort((a, b) => a.id.localeCompare(b.id));
  const pick = moreView === 'home'
    ? lib.filter(x => isHome(x.id))
    : lib.filter(x => !inProgram.has(x.id));
  const freeform = Object.keys(day.ex).filter(isFreeform).map(id => ({ exercise: id }));
  const toggle = [['other', 'Not in program'], ['home', 'At home']].map(([v, label]) =>
    `<button class="${moreView === v ? 'on' : ''}" data-view="${v}">${label}</button>`).join('');
  $('#more').innerHTML = `
    <div class="segmented">${toggle}</div>
    ${moreView === 'home' ? bullets(venues?.home?.notes, 'rom') : ''}
    <ul class="rows">${[...freeform, ...byDone(pick.map(x => ({ exercise: x.id })))].map(rowHtml).join('')}</ul>
    <label class="lbl">Doing something not in the library?</label>
    <div class="addff">
      <input data-field="freeform" enterkeyhint="done" placeholder="e.g. standing cable pullover">
      <button data-act="addff">Add</button>
    </div>
    <p class="sub">Logged as a trial. It becomes a real library entry later, in the Gym project, if it sticks.</p>`;
}

function stepper(field, value) {
  const mode = field === 'reps' ? 'numeric' : 'decimal';
  return `<div class="stepper">
    <button data-act="dec" data-field="${field}">−</button>
    <input inputmode="${mode}" data-field="${field}" value="${value ?? ''}">
    <button data-act="inc" data-field="${field}">+</button>
  </div>`;
}

function bullets(list, cls) {
  return list?.length ? `<ul class="${cls}">${list.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
}

function renderDetail() {
  const item = itemFor(openId);
  const id = openId;
  const ex = exercises[id] ?? {};
  const e = entry(item);
  const range = item.rep_range ? `${item.rep_range[0]}–${item.rep_range[1]} ${hasReps(id) ? 'reps' : 's'}` : '';
  const target = [item.sets && `${item.sets} sets`, range, item.per_side && 'per side, weak side first'].filter(Boolean).join(' · ');

  // Committed sets are read-only one-liners; only the latest can be undone.
  const done = e.sets.map((s, i) => `
    <div class="doneset">✓ Set ${i + 1}${hasReps(id) ? ` · ${s.reps ?? '?'} reps` : ''}
      ${i === e.sets.length - 1 ? '<button class="undo" data-act="undo">undo</button>' : ''}
    </div>`).join('');

  // Only the set being worked on has controls. Committing it reveals the next.
  const n = e.sets.length + 1;
  const active = `
    <div class="set">
      <span class="setno">${n}</span>
      ${hasReps(id) ? stepper('reps', e.next) : '<span class="grow"></span>'}
      <button class="tick" data-act="commit" aria-label="Set ${n} done">✓</button>
    </div>`;

  // Reps in reserve: asked once the planned sets are done (or, with no plan,
  // after the first set), in plain words.
  const rir = (item.sets ? isComplete(item) : e.sets.length > 0) ? `
    <label class="lbl">Reps left in the tank on the last set?</label>
    <div class="chips">${[0, 1, 2, 3, 4].map(r =>
      `<button class="chip${e.rir === r ? ' on' : ''}" data-act="rir" data-n="${r}">${r === 4 ? '4+' : r}</button>`).join('')}</div>` : '';

  const detail = $('#detail');
  const scroll = detail.scrollTop;
  detail.innerHTML = `
    <header class="bar">
      <button class="back" data-act="back" aria-label="Back"><span>‹</span>${icon(esc(id))}</button>
      <div><h2>${esc(name(id))}</h2>${ex.aliases?.length ? `<div class="sub">${esc(ex.aliases.join(' · '))}</div>` : ''}</div>
    </header>
    ${target ? `<p class="target">${esc(target)}</p>` : ''}
    ${isFreeform(id) ? '<p class="target">New movement · logged as a trial</p>' : ''}
    ${item.note ? `<p class="sub">${esc(item.note)}</p>` : ''}
    ${hasLoad(id) ? `<label class="lbl">Load <span>${UNIT[loadType(id)]}</span></label>${stepper('load', e.load)}` : '<p class="lbl">Bodyweight</p>'}
    <label class="lbl">Sets</label>
    <div class="sets">${done}${active}</div>
    ${rir}
    ${bullets(ex.cues, 'cues')}
    ${bullets(ex.rom_notes, 'rom')}
    ${bullets(ex.cautions, 'cautions')}
    <details${e.note ? ' open' : ''}><summary>Note</summary><textarea data-field="note" rows="3">${esc(e.note)}</textarea></details>
    ${isFreeform(id) && !e.sets.length ? '<button class="remove" data-act="remove">Remove this entry</button>' : ''}`;
  detail.scrollTop = scroll;
}

function renderRest() {
  const t = lastDoneAt();
  const el = $('#rest');
  const ms = Date.now() - t; // the timestamp is the truth; the interval only repaints
  el.hidden = !timerOn() || !t || ms > REST_HIDE_MS;
  if (!el.hidden) el.textContent = `Rest ${Math.floor(ms / 60000)}:${pad(Math.floor(ms / 1000) % 60)}`;
}

function fmtDate(date) {
  return new Date(date + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Read-only notes written by Claude in the Gym project (data/coaching.json).
function coachingHtml() {
  if (!coaching?.text) return '';
  return `<details class="coach" open>
      <summary>Coaching notes${coaching.updated ? ` <span>· ${esc(fmtDate(coaching.updated))}</span>` : ''}</summary>
      <p>${esc(coaching.text)}</p>
    </details>`;
}

function renderDayTab() {
  $('#daytab').innerHTML = `
    ${coachingHtml()}
    <label class="lbl">How was today? <span>${esc(fmtDate(day.date))}</span></label>
    <div class="moods">${MOODS.map(([tag, emoji, label]) =>
      `<button class="mood${day.state.includes(tag) ? ' on' : ''}" data-mood="${tag}"><span>${emoji}</span>${label}</button>`).join('')}</div>
    <label class="lbl">Day note</label>
    <textarea data-field="daynote" rows="4" placeholder="Weather, schedule, how it felt…">${esc(day.note)}</textarea>
    <div id="export"></div>`;
  renderExport();
}

// ---------- Export: one file per day, through the Android share sheet ----------

// A day is unexported while its current output differs from what was last
// shared - so editing an exported day makes it pending again.
function pendingDays() {
  return days
    .filter(d => { const out = toDay(d); return (out.note || out.state || out.exercises) && d.exported !== JSON.stringify(out); })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function renderExport(msg = '', offerCopy = false) {
  const pending = pendingDays();
  const badge = $('#badge');
  badge.hidden = !pending.length;
  badge.textContent = pending.length;
  const el = $('#export');
  if (!el) return;
  el.innerHTML = pending.length ? `
    <button class="share" data-act="export">Share ${pending.length} session${pending.length > 1 ? 's' : ''} to Drive</button>
    <p class="nag">Not exported yet: ${pending.map(d => esc(fmtDate(d.date)) + (d === day ? ' (today)' : '')).join(', ')}</p>
    <p class="sub">Pick Drive, then the SwoleMole-Inbox folder. The export is also your backup.</p>`
    : '<p class="sub">All sessions exported ✓</p>';
  if (msg) el.insertAdjacentHTML('beforeend', `<p class="msg">${esc(msg)}</p>`);
  if (offerCopy && pending.length) el.insertAdjacentHTML('beforeend', '<button class="copy" data-act="copy">Copy to clipboard instead</button>');
}

async function markExported(list) {
  for (const d of list) {
    d.exported = JSON.stringify(toDay(d));
    await save(d);
  }
}

// Clipboard route: one JSON day object, or an array of them for several days.
async function copyDays() {
  const list = pendingDays();
  if (!list.length) return;
  const out = list.map(toDay);
  try {
    await navigator.clipboard.writeText(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));
  } catch (err) {
    renderExport('Copy failed too: ' + err.message);
    return;
  }
  await markExported(list);
  renderExport(`Copied ${list.length} session${list.length > 1 ? 's' : ''} to the clipboard — paste it into a file in SwoleMole-Inbox.`);
}

// Always .txt: Chrome on Android refuses to share .json, and its canShare()
// pre-check says yes anyway - share() then fails with "Permission denied".
// text/plain is on the allow-list; the content is the same JSON.
async function exportDays() {
  const list = pendingDays();
  if (!list.length) return;
  const files = list.map(d => new File([JSON.stringify(toDay(d), null, 2) + '\n'], `${d.date}.txt`, { type: 'text/plain' }));
  if (!navigator.canShare?.({ files })) {
    renderExport('Sharing files is not available in this browser.', true);
    return;
  }
  try {
    await navigator.share({ files });
  } catch (err) {
    // AbortError = share sheet dismissed, nothing to report. Anything else: say
    // what happened and offer the clipboard (a fresh tap, so it is allowed).
    if (err.name !== 'AbortError') renderExport(`Export failed: ${err.name}: ${err.message}`, true);
    return;
  }
  await markExported(list);
  renderExport();
}

function showTab(name) {
  tabScroll[tab] = window.scrollY;
  tab = name;
  $('#list').hidden = tab !== 'today';
  $('#more').hidden = tab !== 'more';
  $('#daytab').hidden = tab !== 'day';
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'more') renderMore();
  if (tab === 'day') renderDayTab();
  window.scrollTo(0, tabScroll[tab] ?? 0);
}

function render() {
  renderList();
  renderMore();
  renderDayTab();
  if (openId) renderDetail();
  renderRest();
}

// ---------- Navigation: the Android back gesture closes the detail view ----------

function openDetail(id) {
  openId = id;
  history.pushState({ detail: id }, '');
  $('#detail').scrollTop = 0;
  renderDetail();
  $('#detail').hidden = false;
}

function closeDetail() {
  openId = null;
  $('#detail').hidden = true;
  renderList(); // the lists are never hidden by the detail view, so scroll positions survive
  renderMore();
}

// ---------- Settings (fullscreen, like the detail view) ----------

function renderSettings(msg = '') {
  const armed = Date.now() - resetArmedAt < RESET_CONFIRM_MS;
  $('#settings').innerHTML = `
    <header class="bar">
      <button class="back" data-act="back" aria-label="Back"><span>‹</span></button>
      <h2>Settings</h2>
    </header>
    <label class="lbl">Language</label>
    <div class="segmented">${LANGS.map(([code, label]) =>
      `<button class="${getLang() === code ? 'on' : ''}" data-lang="${code}">${label}</button>`).join('')}</div>
    <p class="sub">Translations are not in yet — the app stays in English for now.</p>
    <label class="lbl">Rest timer</label>
    <div class="segmented">${[['on', 'On'], ['off', 'Off']].map(([v, label]) =>
      `<button class="${getPref('timer', 'on') === v ? 'on' : ''}" data-timer="${v}">${label}</button>`).join('')}</div>
    <p class="sub">The count-up shown after each set.</p>
    <label class="lbl">Today's session</label>
    <button class="danger${armed ? ' armed' : ''}" data-act="reset">${armed ? 'Tap again to erase today' : 'Reset today\'s session'}</button>
    <p class="sub">Erases everything logged today (${esc(fmtDate(day.date))}): sets, loads, notes, moods. Other days are untouched, and files already shared to Drive stay there.</p>
    ${msg ? `<p class="msg">${esc(msg)}</p>` : ''}`;
}

function openSettings() {
  history.pushState({ settings: true }, '');
  resetArmedAt = 0;
  renderSettings();
  $('#settings').hidden = false;
}

function closeSettings() {
  $('#settings').hidden = true;
}

function resetToday() {
  day.ex = {};
  day.note = '';
  day.state = [];
  delete day.exported;
  save();
  render();
}

$('#gear').addEventListener('click', openSettings);

$('#settings').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'back') { history.back(); return; }
  if (b.dataset.lang) { setPref('lang', b.dataset.lang); renderSettings(); return; }
  if (b.dataset.timer) { setPref('timer', b.dataset.timer); renderSettings(); renderRest(); return; }
  if (b.dataset.act !== 'reset') return;
  if (Date.now() - resetArmedAt < RESET_CONFIRM_MS) {
    resetArmedAt = 0;
    resetToday();
    renderSettings("Today's session was reset.");
  } else {
    resetArmedAt = Date.now();
    renderSettings();
    setTimeout(() => { if (resetArmedAt && !$('#settings').hidden) renderSettings(); }, RESET_CONFIRM_MS); // disarm visibly
  }
});

window.addEventListener('popstate', () => {
  if (openId) closeDetail();
  else if (!$('#settings').hidden) closeSettings();
});

// ---------- Events ----------

$('#list').addEventListener('click', ev => {
  const row = ev.target.closest('.row');
  if (row) openDetail(row.dataset.id);
});

function submitFreeform() {
  const input = $('#more [data-field=freeform]');
  const text = input.value.trim();
  if (text) openDetail(addFreeform(text));
}

$('#more').addEventListener('click', ev => {
  const row = ev.target.closest('.row');
  if (row) { openDetail(row.dataset.id); return; }
  const b = ev.target.closest('button');
  if (b?.dataset.view) { moreView = b.dataset.view; renderMore(); }
  else if (b?.dataset.act === 'addff') submitFreeform();
});

$('#more').addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.dataset.field === 'freeform') submitFreeform();
});

$('#detail').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  const e = day.ex[openId];
  switch (b.dataset.act) {
    case 'back': history.back(); return;
    case 'remove': // a freeform entry added by mistake, nothing committed yet
      delete day.ex[openId];
      save();
      renderExport();
      history.back();
      return;
    case 'commit': // the timestamp starts the rest timer
      e.sets.push({ reps: hasReps(openId) ? e.next : null, at: Date.now() });
      e.next = prefillReps(openId, e.sets.length);
      break;
    case 'undo': e.next = e.sets.pop().reps; break;
    case 'rir': e.rir = e.rir === Number(b.dataset.n) ? null : Number(b.dataset.n); break;
    case 'inc':
    case 'dec': {
      const sign = b.dataset.act === 'inc' ? 1 : -1;
      if (b.dataset.field === 'load') e.load = Math.max(0, round((e.load ?? 0) + sign * (STEP[loadType(openId)] ?? 1)));
      else if (e.next != null) e.next = Math.max(0, e.next + sign);
      else e.next = itemFor(openId).rep_range?.[1] ?? 10; // empty field: start somewhere sensible
      break;
    }
    default: return;
  }
  save();
  renderDetail();
  renderRest();
  renderExport();
});

// Typing updates state without re-rendering, so the field keeps focus.
$('#detail').addEventListener('input', ev => {
  const f = ev.target.dataset.field;
  const e = day.ex[openId];
  if (f === 'load') e.load = num(ev.target.value);
  else if (f === 'reps') e.next = num(ev.target.value);
  else if (f === 'note') e.note = ev.target.value;
  else return;
  save();
  renderExport();
});

$('.tabs').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (b) showTab(b.dataset.tab);
});

$('#daytab').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'export') { exportDays(); return; }
  if (b.dataset.act === 'copy') { copyDays(); return; }
  const tag = b.dataset.mood;
  if (!tag) return;
  day.state = day.state.includes(tag) ? day.state.filter(t => t !== tag) : [...day.state, tag];
  b.classList.toggle('on');
  save();
  renderExport();
});

$('#daytab').addEventListener('input', ev => {
  if (ev.target.dataset.field !== 'daynote') return;
  day.note = ev.target.value;
  save();
  renderExport();
});

// Android suspends timers in the background: recompute everything on return.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (day.date !== todayKey() && Date.now() - lastDoneAt() > NEW_DAY_IDLE_MS) await loadDay();
  renderRest();
});

// ---------- Startup ----------

async function loadDay() {
  days = (await dbAll()).map(upgrade);
  const key = todayKey();
  day = days.find(d => d.date === key);
  if (!day) days.push(day = { date: key, note: '', state: [], ex: {} });
  buildLast(days.filter(d => d !== day));
  if (openId) { closeDetail(); history.back(); }
  render();
}

async function start() {
  if (history.state) history.replaceState(null, '');
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  try {
    const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
    const [lib, prog, lastJson, ven] = await Promise.all([get('data/exercises.json'), get('data/program.json'),
      get('data/last.json'), get('data/venues.json')]);
    lib.exercises.forEach(e => { exercises[e.id] = e; });
    program = prog.blocks.flatMap(b => b.items); // one flat list, whatever the blocks
    bundledLast = lastJson;
    venues = ven.venues;
    await loadDay();
    setInterval(renderRest, 1000);
    // Optional and possibly absent, so never cached: fetched after the first
    // render, or a dead gym network would hold up the whole start waiting for it.
    get('data/coaching.json').then(c => { coaching = c; renderDayTab(); }).catch(() => {});
  } catch (err) {
    $('#list').innerHTML = `<li class="empty">Could not start: ${esc(err.message)}</li>`;
  }
}

start();
