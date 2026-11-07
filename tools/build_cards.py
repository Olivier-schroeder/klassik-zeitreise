"""Build cards.json from the piece lists in data/*.tsv.

    python tools/build_cards.py

- Gives every new row (empty id) a random card id and writes it back into the .tsv.
  Never change an id once its card is printed: the QR code contains only the id.
- Keeps the Spotify choices (track, start time) already stored in cards.json.
- Checks years, notes and duplicates; prints how the pieces spread over the centuries.
"""

from __future__ import annotations

import json
import random
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CARDS = ROOT / "cards.json"

ID_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"  # no 0/o, 1/l/i
NOTES = {"": "vollendet", "UA": "Uraufführung", "Druck": "Erstdruck", "Widmung": "Widmung", "ca": "ungefähr"}
COLUMNS = ["id", "composer", "title", "year", "note", "check", "query"]

# Spellings Spotify knows better than the German ones on the cards.
SEARCH_NAMES = {
    "Pjotr Iljitsch Tschaikowsky": "Tchaikovsky",
    "Sergei Rachmaninow": "Rachmaninoff",
    "Igor Strawinsky": "Stravinsky",
    "Sergei Prokofjew": "Prokofiev",
    "Dmitri Schostakowitsch": "Shostakovich",
    "Aram Chatschaturjan": "Khachaturian",
    "Alexander Skrjabin": "Scriabin",
    "Nikolai Rimski-Korsakow": "Rimsky-Korsakov",
    "Alexander Glasunow": "Glazunov",
    "Dmitri Kabalewski": "Kabalevsky",
    "Mili Balakirew": "Balakirev",
    "Michail Glinka": "Glinka",
    "Michail Ippolitow-Iwanow": "Ippolitov-Ivanov",
    "Modest Mussorgsky": "Mussorgsky",
    "Georg Friedrich Händel": "Handel",
    "Arnold Schönberg": "Schoenberg",
    "Orlando di Lasso": "Lassus",
    "Johann Strauss (Vater)": "Johann Strauss I",
    "Johann Strauss (Sohn)": "Johann Strauss II",
    "Johann Strauss (Sohn) und Josef Strauss": "Johann Strauss II Josef Strauss",
    "Hans Zimmer und Lisa Gerrard": "Hans Zimmer Lisa Gerrard",
}
# German title words -> words Spotify track titles usually use.
TITLE_WORDS = [
    (r"\bSinfonie\b", "Symphony"),
    (r"\bKlavierkonzert\b", "Piano Concerto"),
    (r"\bViolinkonzert\b", "Violin Concerto"),
    (r"\bCellokonzert\b", "Cello Concerto"),
    (r"\bKlaviersonate\b", "Piano Sonata"),
    (r"\bViolinsonate\b", "Violin Sonata"),
    (r"\bStreichquartett\b", "String Quartet"),
    (r"\bStreichquintett\b", "String Quintet"),
    (r"\bKlaviertrio\b", "Piano Trio"),
    (r"\bOuvertüre\b", "Overture"),
    (r"\bTrompetenkonzert\b", "Trumpet Concerto"),
    (r"\bKlarinettenkonzert\b", "Clarinet Concerto"),
    (r"\bOboenkonzert\b", "Oboe Concerto"),
    (r"\bHornkonzert\b", "Horn Concerto"),
    (r"\bOrgelkonzert\b", "Organ Concerto"),
    (r"\bNr\.", "No."),
    (r"\bKV\b", "K."),
    (r"\b\d+\. Satz\b", ""),
    (r"\bFinale\b", ""),
]


def read_rows(path: Path) -> tuple[list[str], list[dict | None]]:
    """Returns the file's lines and, per line, the parsed row (None for comments/header)."""
    lines = path.read_text(encoding="utf-8").splitlines()
    rows: list[dict | None] = []
    for n, line in enumerate(lines, 1):
        if not line.strip() or line.startswith("#") or line.startswith("id\t"):
            rows.append(None)
            continue
        cells = line.split("\t") + [""] * len(COLUMNS)
        row = {k: cells[i].strip() for i, k in enumerate(COLUMNS)}
        row["_where"] = f"{path.name}:{n}"
        rows.append(row)
    return lines, rows


def read_search(data: Path, ids: set[str]) -> tuple[dict, list[str]]:
    """data/spotify_*.tsv: id | query (alternatives with ' | ') | start (m:ss) | hint."""
    out, errors = {}, []
    for f in sorted(data.glob("spotify_*.tsv")):
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip() or line.startswith("#") or line.startswith("id\t"):
                continue
            cells = [c.strip() for c in line.split("\t")] + ["", "", ""]
            card_id, query, start, hint = cells[:4]
            where = f"{f.name}:{n}"
            if card_id not in ids:
                errors.append(f"{where}: unknown card id {card_id}")
                continue
            if card_id in out:
                errors.append(f"{where}: id {card_id} listed twice")
            entry = {"query": query, "hint": hint}
            if start:
                m = re.fullmatch(r"(\d+):(\d{2})", start)
                if not m:
                    errors.append(f"{where}: start '{start}' must look like 1:45")
                else:
                    entry["start_ms"] = (int(m[1]) * 60 + int(m[2])) * 1000
            out[card_id] = entry
    missing = sorted(ids - set(out))
    if missing:
        print(f"Hinweis: {len(missing)} Karten ohne Eintrag in data/spotify_*.tsv: {', '.join(missing[:10])}")
    return out, errors


def read_pinned(path: Path, ids: set[str]) -> tuple[dict, list[str]]:
    """data/pinned.tsv: id | spotify:track:… | label | back_note."""
    out, errors = {}, []
    if not path.exists():
        return out, errors
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.startswith("#") or line.startswith("id\t"):
            continue
        card_id, uri, label, note = ([c.strip() for c in line.split("\t")] + ["", "", ""])[:4]
        if card_id not in ids:
            errors.append(f"{path.name}:{n}: unknown card id {card_id}")
        elif not re.fullmatch(r"spotify:track:[A-Za-z0-9]{22}", uri):
            errors.append(f"{path.name}:{n}: '{uri}' is not a spotify:track:… address")
        else:
            out[card_id] = {"spotify": uri, "label": label, "back_note": note}
    return out, errors


def make_query(row: dict) -> str:
    if row["query"]:
        return row["query"]
    composer = SEARCH_NAMES.get(row["composer"], row["composer"])
    title = row["title"]
    for pattern, repl in TITLE_WORDS:
        title = re.sub(pattern, repl, title)
    title = re.sub(r"[„“\"()…,:–]", " ", title)
    return re.sub(r"\s+", " ", f"{composer} {title}").strip()


def main() -> int:
    files = sorted(DATA.glob("pieces_*.tsv"))
    parsed = {f: read_rows(f) for f in files}
    all_rows = [r for _, rows in parsed.values() for r in rows if r]

    errors = []
    used = {r["id"] for r in all_rows if r["id"]}
    seen_ids, seen_works = set(), {}
    for r in all_rows:
        if not r["composer"] or not r["title"]:
            errors.append(f"{r['_where']}: composer or title missing")
        if not re.fullmatch(r"\d{3,4}", r["year"]) or not 800 <= int(r["year"]) <= 2100:
            errors.append(f"{r['_where']}: year '{r['year']}' is not a year")
        if r["note"] not in NOTES:
            errors.append(f"{r['_where']}: note '{r['note']}' must be one of {sorted(n for n in NOTES if n)} or empty")
        if r["check"] not in ("", "1"):
            errors.append(f"{r['_where']}: check must be empty or 1")
        if r["id"]:
            if r["id"] in seen_ids:
                errors.append(f"{r['_where']}: id {r['id']} used twice")
            seen_ids.add(r["id"])
        work = (r["composer"].lower(), r["title"].lower())
        if work in seen_works:
            errors.append(f"{r['_where']}: same piece as {seen_works[work]}")
        seen_works[work] = r["_where"]
    if errors:
        print("\n".join(errors))
        return 1

    # New ids, written back into the .tsv files.
    rng = random.SystemRandom()
    for f, (lines, rows) in parsed.items():
        changed = False
        for i, r in enumerate(rows):
            if r and not r["id"]:
                while True:
                    new = "".join(rng.choice(ID_CHARS) for _ in range(5))
                    if new not in used:
                        break
                used.add(new)
                r["id"] = new
                lines[i] = new + lines[i]
                changed = True
        if changed:
            f.write_text("\n".join(lines) + "\n", encoding="utf-8")

    search, search_errors = read_search(DATA, {r["id"] for r in all_rows})
    if search_errors:
        print("\n".join(search_errors))
        return 1

    pinned, pin_errors = read_pinned(DATA / "pinned.tsv", {r["id"] for r in all_rows})
    if pin_errors:
        print("\n".join(pin_errors))
        return 1

    old = {c["id"]: c for c in json.loads(CARDS.read_text(encoding="utf-8"))} if CARDS.exists() else {}
    cards = []
    for r in all_rows:
        prev = old.get(r["id"], {})
        help_ = search.get(r["id"], {})
        card = {
            "id": r["id"],
            "composer": r["composer"],
            "title": r["title"],
            "year": int(r["year"]),
            "year_note": NOTES[r["note"]],
            # search text: data/spotify_*.tsv wins, then an older cards.json, then generated
            "query": help_.get("query") or prev.get("query") or make_query(r),
            "spotify": prev.get("spotify", ""),
            # a start chosen by hand (cards.json) wins over the suggested one
            "start_ms": prev.get("start_ms") or help_.get("start_ms", 0),
        }
        if help_.get("hint"):
            card["hint"] = help_["hint"]
        if prev.get("auto_score") is not None and card["spotify"]:
            card["auto_score"] = prev["auto_score"]
        if prev.get("spotify_label"):
            card["spotify_label"] = prev["spotify_label"]
        if prev.get("audio"):
            card["audio"] = prev["audio"]
        if r["check"] == "1":
            card["check"] = True
        pin = pinned.get(r["id"])
        if pin:
            # fixed recording (data/pinned.tsv): always this track, never re-picked
            card["spotify"] = pin["spotify"]
            card["spotify_label"] = pin["label"] or card.get("spotify_label", "")
            card["pinned"] = True
            card.pop("auto_score", None)
            if pin["back_note"]:
                card["back_note"] = pin["back_note"]
        cards.append(card)
    cards.sort(key=lambda c: (c["year"], c["composer"], c["title"]))

    dropped = sorted(set(old) - {c["id"] for c in cards})
    CARDS.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    eras = Counter()
    for c in cards:
        y = c["year"]
        eras["bis 1600" if y < 1600 else "1600-1749" if y < 1750 else "1750-1819" if y < 1820 else
             f"{y // 20 * 20}-{y // 20 * 20 + 19}" if y < 1960 else "ab 1960"] += 1
    print(f"{len(cards)} Karten in cards.json, {sum(1 for c in cards if c.get('check'))} mit Jahr zum Prüfen")
    for era in sorted(eras, key=lambda e: (e != "bis 1600", e)):
        print(f"  {era:>10}: {eras[era]:4d} {'#' * (eras[era] // 3)}")
    if dropped:
        print("Nicht mehr in den Listen (aus cards.json entfernt):", ", ".join(dropped))
    return 0


if __name__ == "__main__":
    sys.exit(main())
