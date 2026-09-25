# Swole Mole — gym logging PWA

Phone-first logging tool for gym sessions. Gianluca opens it at the gym, works
through the exercises in his current program, records load and reps per set,
optionally writes a note about the day, and (from v1) exports the session as a
JSON file into Google Drive.

**That is the entire scope.** Not a fitness app: no accounts, no social, no
exercise database of its own, no charts, no coaching logic. Analysis happens in
the separate **data project** at `C:\Progetti\Gym` (with Claude in Cowork),
which reads the exported files. The app *produces* data; it never analyses it.

Originally specified as "GymBro" in `C:\Progetti\Gym\WEBAPP-SPEC.md`. This file
supersedes that spec.

## Files

| Path | What |
|---|---|
| `index.html`, `app.js`, `styles.css` | The whole app. |
| `manifest.json`, `sw.js` | PWA install + offline cache. |
| `data/exercises.json`, `data/program.json`, `data/venues.json` | Copies from the data project. **Read-only — never edit here.** |
| `data/last.json` | Derived from the data project's `log.json`: most recent load/reps per exercise, numbers only. Prefill on a fresh install or after IndexedDB eviction. |
| `tools/sync_data.py` | Re-copies the four data files. Run `python tools/sync_data.py` whenever the data project changes. |
| `icons/icon-source.png` | Original app icon (1254 px). `app-192.png` / `app-512.png` are resized from it. |
| `icons/exercises/<exercise-id>.svg` | Per-exercise pictograms, named by exercise id. A missing file falls back to a neutral grey square. **House style** (keep every icon consistent): `viewBox="0 0 64 64"`; background `rect` rx 12 fill `#2a2a2a`; equipment strokes `#8c8c8c` width 4 (pads width 7); figure strokes `#fdbb1a` width 5; head a filled circle r 5.5; round caps and joins; no text, no gradients; side view unless front view reads better (e.g. pulldown). Must read at 48 px. |

## Deploy

- Repo: https://github.com/Egiohh/swole-mole (public — free Pages requires it).
- Live: **https://egiohh.github.io/swole-mole/** — GitHub Pages, built from
  `main` at `/`. **Pushing to `main` is deploying.** The phone picks it up on
  the next launch after that (see the service-worker note below).
- `gh` CLI is installed at `C:\Program Files\GitHub CLI\gh.exe` (may not be on
  the Bash tool's PATH), logged in as `Egiohh`. Commit identity is set in this
  repo's local git config (noreply email), not globally.

## Decisions already made

Reasoned through at length. Do not re-open them without asking — each removes
a specific failure mode.

| Decision | Reason |
|---|---|
| **Vanilla JavaScript. No TypeScript.** | The owner dislikes TS and will not maintain it. |
| **No build step, no npm, no bundler, no framework.** | `node_modules`, Vite configs and dependency drift are what kill this owner's side projects. Open the file, it runs. |
| **Small, legible code — well under ~500 lines of JS.** | The owner won't read it daily but must be *able* to fix a typo mid-session. Optimise for someone squinting at a phone, not for abstraction. |
| **PWA, installed to the Android home screen.** | Own launcher icon, own task-switcher entry, works offline. `display: standalone` (status bar and clock stay visible). |
| **Hosted on GitHub Pages.** | Free HTTPS, all a PWA needs. No backend. All paths are relative so it works under a `/repo-name/` subpath. |
| **Data in IndexedDB on the device.** | Never transmitted. No server ever sees a session. |
| **NO Google OAuth. NO Drive API. NO tokens.** | The most important constraint. OAuth setup is exactly the yak-shave that would kill the project in week two. Designed out, not worked around. |
| **Export via the Web Share API** (`navigator.share` with a file). | One tap, pick Google Drive from the share sheet, file lands in the `SwoleMole-Inbox` folder in My Drive. Zero auth code. |
| **Single user, single device.** | No sync, no conflict resolution, no merge UI. |
| **Log set by set, during the session.** | "I always have the phone out anyway." Honest per-set rep counts are an open question in the training data; rounding at the end would defeat the purpose. |
| **The program is ONE flat list of exercises.** | The owner wings it at the gym — no A/B days, no day picker. The app flattens every `blocks[].items` in `program.json` into one list. If per-day programs are ever wanted, that is solved with multiple program files or a bigger single one, not now. |

## Build order

Each stage must be independently useful. v0 must be usable at the gym before
any infrastructure work.

- **v0 — Today tab only. ← BUILT, not yet field-tested.** PWA shell, exercise
  list, expand-to-fullscreen entry, per-set done flags, load/reps steppers, cues
  and cautions, completed-row greying, rest timer, IndexedDB persistence,
  "last time" prefill.
- **v1 — export.** Share-to-Drive button and tab 3 (day note, mood chips,
  unexported-session count). One file per session.
- **v1.5 — tab 2.** "Not in program" / "At home" list, and `coaching.json`.
- **v2 — only if ever actually wanted.** Nothing planned. No speculative
  features. Charts, history and statistics are explicitly *not* wanted.

## Screens

Three tabs, flat navigation, nothing nested beyond the fullscreen expand.

### Tab 1 — Today (v0)

Scrolling list of the program's exercises: icon, name, and last session's load
and reps in small secondary text (or today's progress once a set is done).

Tapping a row expands it to fullscreen:

- Load with `−` / `+` beside it; unit label from the exercise's `load_type`.
  Hidden for `bodyweight`.
- One row per prescribed set: reps field with `−` / `+`, and a **done** flag.
  `+ set` adds an extra set; fewer sets is simply not flagging them.
- RIR chips (0–4) for the last set, optional.
- `cues`, `rom_notes` and `cautions`. **Some are safety-relevant**:
  `roman-chair-back-extension` carries a standing low-blood-pressure
  instruction (pause on the handles before standing). Cautions are styled to be
  hard to miss; never hide or truncate them.
- Per-exercise note, collapsed by default.
- Back (button or Android back gesture) returns to the list at the same scroll
  position.

A row goes grey when every set is flagged done. **Completion is derived from
the flags — never persist a "completed" field.**

**Rest timer.** Flagging a set done shows a count-up of elapsed rest.

> A web app only runs while its page is showing. So: store the timestamp of the
> last done flag and compute `Date.now() - timestamp` on every repaint and on
> `visibilitychange`. The 1 s interval only repaints; it is never the source of
> truth (Android suspends timers in the background, a tick counter would
> drift). Coming back to the app shows the true elapsed time immediately.
>
> **No background alerts, no notifications, no push, no service-worker
> notification scheme.** Not possible reliably in a PWA and confirmed not
> wanted. Don't propose them. Foreground sound/vibration would be harmless but
> isn't asked for.

### Tab 2 — Everything else (v1.5)

Same list and fullscreen interaction. A segmented toggle *above* the list:

| Toggle | Shows |
|---|---|
| **Not in program** | Library exercises not in tab 1 — how a movement outside the program gets logged, and how a trial is performed before adoption. |
| **At home** | Exercises performable at home. |

**"At home" is DERIVED**: `requires ⊆ venues.home.equipment`, from each
exercise's `requires` and `data/venues.json`. Never add an `at_home` field —
buying a pull-up bar must be one edit to `venues.json`. Show
`venues.home.notes` in that view (the home dumbbell only loads to 1/3/5/7/9 kg).
Home sessions are a sparse fallback, not a regime: no schedule, no streaks, no
nagging. Anything logged from tab 2 goes into the same day object.

A **freeform** entry also lives here: a text field for a movement with no
library id (see data contract).

### Tab 3 — Day & notes (v1)

- Free-text day note.
- **Mood chips** → the day's `state` array. Multi-select emoji chips. Starter
  set: `slept-badly`, `low-energy`, `good-day`, `strong`, `sore`, `hot`,
  `stressed`, `rushed`. Keep it small and playful.
- **Coaching notes** (v1.5): read-only text from `coaching.json` in this repo,
  written by Claude in the data project. Same origin, cached for offline. The
  app never writes it.
- The export/share button, with the count of unexported sessions visible and
  slightly nagging (the export is also the backup).

## Data contract

The app is a producer for the data project's log format. Everything downstream
depends on getting this exactly right. Reference: `C:\Progetti\Gym\schema\log.schema.json`,
the `day` definition.

### Inputs

`data/exercises.json`, `data/program.json`, `data/venues.json`, `data/last.json`
— bundled static files. The app never writes them and **never invents an
exercise id**. Ids are the names: display name is the id de-kebab-cased; show
`aliases` (Italian gym names) where present.

`load_type` sets the unit and must be respected: `stack-kg`,
`dumbbell-per-hand-kg` (weight of ONE dumbbell), `bodyweight` (no load),
`bodyweight-plus-kg`, `time-seconds` (load is the hold time; no reps).

`+`/`−` steps in `app.js` (`STEP`): stack 5 kg (measured on the gym's
machines), dumbbell 1 kg, added weight 2.5 kg, time 5 s.

### Output

One file per session, `YYYY-MM-DD.json`, a single **day** object:

```json
{
  "date": "2026-09-18",
  "note": "hot, felt flat all session",
  "state": ["hot", "low-energy"],
  "exercises": [
    { "exercise": "horizontal-leg-press", "load": 95, "sets": 3, "reps": [15, 14, 12], "rir": 1, "note": "last set was a grind" },
    { "freeform": "standing cable pullover, copied from the guy next to me", "load": 25, "sets": 3, "status": "trialing" }
  ]
}
```

`toDay()` in `app.js` converts the internal IndexedDB record to this shape.
Rules:

- Only `date` is required on a day; only `exercise` **or** `freeform` on an
  entry. A day with just a note is valid and must be exportable.
- Only sets flagged done are exported; `sets` is their count, `reps` their
  values in order, `null` for a set that wasn't counted. An exercise with no
  done sets and no note was not performed and is omitted.
- `freeform` (plain string) + `status: "trialing"` for a movement with no
  library id — promoted to a real entry later, by hand, in the data project.
  **This escape hatch matters**: without it he'd have to stop mid-session to
  author a catalogue entry, and he wouldn't.
- `status` is only ever `"trialing"` or `"abandoned"`. No `"active"`. The
  project rule is **record intent, derive state**. No other status fields.
- Never write a `program` field — derived from dates in the data project.
- `rir` = reps in reserve on the final set. Never RPE.
- **Per-side exercises record ONE value per set**: 15 left + 15 right is
  `reps: [15]`. No left/right fields. Side differences go in the day note as
  prose.

### Why one file per session, and where it goes

The data project's `log.json` is append-only and also edited on the PC; two
writers through Drive would produce conflict copies and silent corruption. One
uniquely named file per session makes conflicts impossible. The app shares to
`SwoleMole-Inbox` in My Drive; getting it from there into the data project
(`C:\Progetti\Gym\log\inbox\`) and merging into `log.json` is the data
project's job, not the app's. The data project folder is deliberately *not*
inside Google Drive — don't redesign that.

## UX requirements

Phone held one-handed, sometimes damp, between sets, by someone tired.

- Large touch targets (`--tap: 56px`). Thumb, not fingertip.
- Numeric fields open the numeric keypad (`inputmode="decimal"` / `"numeric"`).
  Plain text inputs, not `type=number`; parse accepts a comma decimal.
- Prefill from the last session. The common action is confirming a number.
- **Never lose data.** Persist to IndexedDB on every change; no save button.
- `navigator.storage.persist()` on start.
- Works with no network.
- Dark by default, light via `prefers-color-scheme`.
- No confirmation dialogs for ordinary actions; tapping a done flag again
  un-flags it.

## Behaviour worth knowing

- **Day boundary:** the day key is the local date. If the app is reopened after
  midnight, it stays on the previous day while a set was flagged within the last
  3 h (a session crossing midnight), otherwise it switches to the new day.
- **Service worker:** stale-while-revalidate for every same-origin GET. A deploy
  reaches the phone on the *next* launch, never mid-session. `VERSION` in
  `sw.js` only needs bumping to throw the whole cache away. After a deploy,
  opening the app twice picks up the new version.

## Explicit non-goals

No accounts, login, backend, analytics, telemetry, crash reporting, third-party
scripts, ads, notifications, charts or statistics; no exercise instructions
beyond the library's `cues`; no editing the library or program from the app.

## Risks

- **IndexedDB can be evicted** (cleared browsing data, storage pressure).
  `persist()` reduces but doesn't eliminate this; the export is the backup.
- **`navigator.share` with files** must be feature-detected with
  `navigator.canShare({ files })`. A clipboard fallback is not optional.
- **GitHub Pages sites are public**, even from a private repo on a free plan.
  `data/` (exercise cautions, loads) and a future `coaching.json` are readable
  by anyone with the URL. Keep notes and anything personal out of the bundled
  files — hence `last.json` carries numbers only.

## Open questions

- A read-only "Program" view was considered and deferred.

## Working with the owner

Gianluca is an experienced developer (B4X, Java/Android, React/TypeScript for
tooling) who could write this himself and deliberately chose not to, to reduce
the friction that kills side projects. Explain decisions, don't condescend,
don't expand the scope. The most valuable thing this project can be is
**finished and in use**.

Health context lives in `C:\Progetti\Gym\health.md`. It matters here only as
"show the cautions prominently"; the app never makes training or medical
decisions.
