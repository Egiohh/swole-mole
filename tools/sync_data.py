"""Copy the bundled data files from the Gym data project into data/.

Run after exercises.json, program/current.json, venues.json, log.json or
coaching.json change in the data project:

    python tools/sync_data.py

The app never writes to these files. last.json is derived from log.json and
carries numbers only (date, load, reps) - no notes, since the site is public.
"""
import json
import shutil
import sys
from pathlib import Path

GYM = Path(r"C:\Progetti\Gym")
DATA = Path(__file__).resolve().parent.parent / "data"

COPIES = {
    "exercises.json": GYM / "exercises.json",
    "program.json": GYM / "program" / "current.json",
    "venues.json": GYM / "venues.json",
}


def main():
    for name, src in COPIES.items():
        json.loads(src.read_text(encoding="utf-8"))  # refuse to copy broken JSON
        shutil.copyfile(src, DATA / name)
        print(f"copied   {src} -> data/{name}")

    # Optional: coaching notes written by Claude in the data project. Mirrored,
    # so deleting them there removes them from the app. PUBLIC once pushed.
    src, dst = GYM / "coaching.json", DATA / "coaching.json"
    if src.exists():
        coaching = json.loads(src.read_text(encoding="utf-8"))
        if not isinstance(coaching.get("text"), str):
            sys.exit("coaching.json needs a string 'text' field")
        shutil.copyfile(src, dst)
        print(f"copied   {src} -> data/coaching.json")
    elif dst.exists():
        dst.unlink()
        print("removed  data/coaching.json (no longer in the data project)")

    # Most recent load / reps per exercise id, for "last time" prefill on a
    # fresh install or after IndexedDB has been evicted.
    log = json.loads((GYM / "log.json").read_text(encoding="utf-8"))
    last = {}
    for day in sorted(log["entries"], key=lambda d: d["date"]):
        for e in day.get("exercises", []):
            if "exercise" not in e or e.get("status") == "abandoned":
                continue
            last[e["exercise"]] = {k: e[k] for k in ("load", "reps") if k in e}
            last[e["exercise"]]["date"] = day["date"]
    (DATA / "last.json").write_text(json.dumps(last, indent=2) + "\n", encoding="utf-8")
    print(f"derived  data/last.json ({len(last)} exercises)")


if __name__ == "__main__":
    sys.exit(main())
