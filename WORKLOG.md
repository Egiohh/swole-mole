# Swole Mole — worklog

Append-only history of the app: what changed, why, what was confirmed in the
field, and what the data project (`C:\Progetti\Gym`) asked for. Newest at the
bottom; one `## dd/mm/yyyy` header per day. How the app works *now* is in
`CLAUDE.md` — this file is the story of how it got there. Commit hashes in
brackets.

## 25/09/2026

- **v0 built** — Today tab: exercise list, fullscreen entry, sets, load/reps
  steppers, cues and cautions, rest timer, IndexedDB, "last time" prefill.
  Deployed to GitHub Pages.
- Exercise pictograms, first for the 11 program exercises, then all 28; home
  exercises tinted blue at render time from `venues.json`.
- Sets changed to **commit one at a time** (only the current set has
  controls, last one undoable); completed exercises sink to the bottom.
- **v1** — Day tab (mood chips, day note) and share-to-Drive export.
- Owner lifted the ~500-line JS budget from the original spec.
- **v1.5** — More tab ("Not in program" / "At home" / freeform) and coaching
  notes from `coaching.json`. Planned app complete.
- Service worker made network-first (3 s timeout) so a deploy reaches the
  phone on the next launch.
- Settings page: language (Italian gym names), reset today's session.

## 26/09/2026

- **Field bug: export failed with "Permission denied".** Chrome on Android
  refuses to share `.json` although `canShare()` says yes. Fix: always share
  `YYYY-MM-DD.txt` (JSON inside), and offer "Copy to clipboard instead" on any
  failure [b1414fa]. First export to `SwoleMole-Inbox` confirmed working.
- Settings: rest timer on/off [4f1c5b8].

## 27/09/2026

- First real gym session logged and exported.
- From the owner after the session [dfd8fe8]: re-share an already exported
  day; 1 kg steps on the stacks too (magnetic add-on weights); Italian names
  as titles; in-progress exercises sorted to the top (he alternates during
  rests).

## 01/10/2026

- Home sessions on 28/09 and 29/09 logged from the More tab and exported:
  **v1 and v1.5 in use.**
- The data project updated `WEBAPP-SPEC.md` with four requests; all built:
  - **Header clock** `18:42 · 2:15` (session start from program sets · since
    last set), replacing the floating rest bubble, which the owner found
    anxiety-inducing [96535b8].
  - **Per-exercise coaching tips** at the top of the exercise view
    (`coaching.exercises`) [96535b8].
  - **`done_at`** per set in the export, so the data project can derive
    session order and rest. Old export snapshots upgraded so already-shared
    days didn't all turn pending again [96535b8].
  - **Data import from Drive** [b8eb0be]: reference data now comes from
    `swole-mole-data.json` (built by the data project into
    `SwoleMole-Outbox`) through the file picker; `data/` and
    `tools/sync_data.py` removed from the repo. Old data stays in git
    history — the owner doesn't mind.
- Declined from the same message: switching export files back to `.json`
  (see 26/09). The truncated chest-press note of 27/09 was investigated (no
  length limit anywhere; the phone holds the same text) and dropped by the
  owner.
- Testing: headless Edge driven over the DevTools protocol from Python (no
  node on this PC) — file picker, bad-file rejection, v1→v2 database upgrade.
- **Field-confirmed the same evening:** import worked on the phone, coaching
  notes visible, data restored from the imported file.
