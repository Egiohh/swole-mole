// Swole Mole - v0: the Today tab. Spec and rules: CLAUDE.md.
'use strict';

// +/- step and unit label per load_type (see CLAUDE.md, "Data contract").
const STEP = { 'stack-kg': 5, 'dumbbell-per-hand-kg': 1, 'bodyweight-plus-kg': 2.5, 'time-seconds': 5 };
const UNIT = { 'stack-kg': 'kg', 'dumbbell-per-hand-kg': 'kg per hand', 'bodyweight-plus-kg': 'kg added', 'time-seconds': 'seconds' };
const REST_HIDE_MS = 30 * 60 * 1000;      // rest timer disappears after 30 min
const NEW_DAY_IDLE_MS = 3 * 60 * 60 * 1000; // past midnight, stay on the old day until 3 h idle

let exercises = {};   // id -> library entry
let program = [];     // program items: { exercise, sets, rep_range, per_side, note }
let bundledLast = {}; // id -> { date, load, reps } from data/last.json
let last = {};        // id -> most recent { date, load, reps }, bundled or local
let day = null;       // today's record: { date, note, state, ex: { id: { load, reps, done, rir, note } } }
let openId = null;    // exercise shown fullscreen, or null

const $ = sel => document.querySelector(sel);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const name = id => id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
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
async function save() {
  (await db()).transaction('days', 'readwrite').objectStore('days').put(day);
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
    const p = { exercise: id };
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
      if (!last[p.exercise] || last[p.exercise].date <= d.date) last[p.exercise] = { date: d.date, load: p.load, reps: p.reps };
    }
  }
}

// An exercise entry: { load, sets: [{ reps, at }] (committed, in order),
// next: reps for the set being worked on, rir, note }.

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

// Completion is derived from the committed sets, never stored.
function isComplete(item) {
  return (day.ex[item.exercise]?.sets.length ?? 0) >= (item.sets ?? 1);
}

function lastDoneAt() {
  return Math.max(0, ...Object.values(day.ex).flatMap(e => e.sets.map(s => s.at)));
}

// ---------- Rendering ----------

function loadText(id, load) {
  if (!hasLoad(id)) return 'bodyweight';
  return load == null ? '' : `${load} ${loadType(id) === 'time-seconds' ? 's' : 'kg'}`;
}

function icon(id) {
  // The grey square is the neutral fallback; the image covers it when it exists.
  return `<div class="ico"><img src="icons/exercises/${id}.svg" alt="" onerror="this.remove()"></div>`;
}

function renderList() {
  $('#list').innerHTML = program.map(item => {
    const id = item.exercise;
    const e = day.ex[id];
    let sub;
    if (e?.sets.length) {
      sub = `today: ${e.sets.length}/${item.sets ?? '?'} sets · ${loadText(id, e.load)}`;
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
  }).join('') || '<li class="empty">The program is empty. Run tools/sync_data.py.</li>';
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
  const item = program.find(p => p.exercise === openId);
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

  // Reps in reserve: asked once the planned sets are done, in plain words.
  const rir = isComplete(item) ? `
    <label class="lbl">Reps left in the tank on the last set?</label>
    <div class="chips">${[0, 1, 2, 3, 4].map(r =>
      `<button class="chip${e.rir === r ? ' on' : ''}" data-act="rir" data-n="${r}">${r === 4 ? '4+' : r}</button>`).join('')}</div>` : '';

  const detail = $('#detail');
  const scroll = detail.scrollTop;
  detail.innerHTML = `
    <header class="bar">
      <button class="back" data-act="back" aria-label="Back">‹</button>
      <div><h2>${esc(name(id))}</h2>${ex.aliases?.length ? `<div class="sub">${esc(ex.aliases.join(' · '))}</div>` : ''}</div>
    </header>
    ${target ? `<p class="target">${esc(target)}</p>` : ''}
    ${item.note ? `<p class="sub">${esc(item.note)}</p>` : ''}
    ${hasLoad(id) ? `<label class="lbl">Load <span>${UNIT[loadType(id)]}</span></label>${stepper('load', e.load)}` : '<p class="lbl">Bodyweight</p>'}
    <label class="lbl">Sets</label>
    <div class="sets">${done}${active}</div>
    ${rir}
    ${bullets(ex.cues, 'cues')}
    ${bullets(ex.rom_notes, 'rom')}
    ${bullets(ex.cautions, 'cautions')}
    <details${e.note ? ' open' : ''}><summary>Note</summary><textarea data-field="note" rows="3">${esc(e.note)}</textarea></details>`;
  detail.scrollTop = scroll;
}

function renderRest() {
  const t = lastDoneAt();
  const el = $('#rest');
  const ms = Date.now() - t; // the timestamp is the truth; the interval only repaints
  el.hidden = !t || ms > REST_HIDE_MS;
  if (!el.hidden) el.textContent = `Rest ${Math.floor(ms / 60000)}:${pad(Math.floor(ms / 1000) % 60)}`;
}

function render() {
  renderList();
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
  renderList(); // the list itself is never hidden, so its scroll position survives
}

window.addEventListener('popstate', () => { if (openId) closeDetail(); });

// ---------- Events ----------

$('#list').addEventListener('click', ev => {
  const row = ev.target.closest('.row');
  if (row) openDetail(row.dataset.id);
});

$('#detail').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  const e = day.ex[openId];
  switch (b.dataset.act) {
    case 'back': history.back(); return;
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
      else e.next = program.find(p => p.exercise === openId)?.rep_range?.[1] ?? 0; // empty field: start somewhere sensible
      break;
    }
    default: return;
  }
  save();
  renderDetail();
  renderRest();
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
});

// Android suspends timers in the background: recompute everything on return.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (day.date !== todayKey() && Date.now() - lastDoneAt() > NEW_DAY_IDLE_MS) await loadDay();
  renderRest();
});

// ---------- Startup ----------

async function loadDay() {
  const all = await dbAll();
  const key = todayKey();
  all.forEach(upgrade);
  day = all.find(d => d.date === key) ?? { date: key, note: '', state: [], ex: {} };
  buildLast(all.filter(d => d.date !== key));
  if (openId) { closeDetail(); history.back(); }
  render();
}

async function start() {
  if (history.state) history.replaceState(null, '');
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  try {
    const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
    const [lib, prog, lastJson] = await Promise.all([get('data/exercises.json'), get('data/program.json'), get('data/last.json')]);
    lib.exercises.forEach(e => { exercises[e.id] = e; });
    program = prog.blocks.flatMap(b => b.items); // one flat list, whatever the blocks
    bundledLast = lastJson;
    await loadDay();
    setInterval(renderRest, 1000);
  } catch (err) {
    $('#list').innerHTML = `<li class="empty">Could not start: ${esc(err.message)}</li>`;
  }
}

start();
