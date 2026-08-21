#!/usr/bin/env python3
"""Local OLX cache: city resolves and search history.

Cities are resolved through the live API (`docs/snippets/olx-city.js`) — expensive and identical every time,
so a hit here saves a call. The history is there to repeat a past search exactly as it was.

    scripts/olx-cache.py city Szczecin
    scripts/olx-cache.py city-add --name Szczecin --id 16705 --region Zachodniopomorskie --region-id 11
    scripts/olx-cache.py log --params '{"query":"ps5 slim","cityId":16705,"distance":15}' --total 16
    scripts/olx-cache.py history --limit 5
"""
import argparse
import datetime
import json
import pathlib
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITIES = ROOT / "docs" / "olx-pl-cities.json"
SEARCHES = ROOT / "docs" / "olx-pl-searches.json"

MISS = 3  # exit code: not in the cache — resolve through olx-city.js


def fold(s):
    """'Kraków' and 'krakow' are the same key."""
    n = unicodedata.normalize("NFKD", s.strip().lower())
    return "".join(c for c in n if not unicodedata.combining(c))


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def today():
    return datetime.date.today().isoformat()


def find_city(db, name):
    key = fold(name)
    for c in db["cities"]:
        if key == fold(c["name"]) or key in [fold(a) for a in c.get("aliases", [])]:
            return c
    return None


def cmd_city(args):
    hit = find_city(load(CITIES), args.name)
    if not hit:
        print(f"MISS: {args.name} is not in {CITIES.relative_to(ROOT)} — resolve it through olx-city.js "
              f"and write it back here with city-add", file=sys.stderr)
        return MISS
    print(json.dumps(hit, ensure_ascii=False))
    return 0


def cmd_city_add(args):
    db = load(CITIES)
    existing = find_city(db, args.name)
    if existing:
        if existing["cityId"] != args.id:
            print(f"conflict: {existing['name']} is already cached with cityId={existing['cityId']}, "
                  f"got {args.id}. Check by hand.", file=sys.stderr)
            return 1
        for alias in args.alias:
            if alias not in existing.setdefault("aliases", []):
                existing["aliases"].append(alias)
        save(CITIES, db)
        print(json.dumps(existing, ensure_ascii=False))
        return 0
    entry = {
        "name": args.name,
        "cityId": args.id,
        "region": args.region,
        "regionId": args.region_id,
        "county": args.county,
        "aliases": args.alias,
        "resolved": today(),
    }
    db["cities"].append(entry)
    db["cities"].sort(key=lambda c: fold(c["name"]))
    save(CITIES, db)
    print(json.dumps(entry, ensure_ascii=False))
    return 0


def cmd_log(args):
    try:
        params = json.loads(args.params)
    except json.JSONDecodeError as e:
        print(f"--params is not JSON: {e}", file=sys.stderr)
        return 1
    if not params.get("query"):
        print("--params has no query", file=sys.stderr)
        return 1
    db = load(SEARCHES)
    entry = {
        "date": today(),
        "params": params,
        "total": args.total,
        "note": args.note,
    }
    db["searches"].insert(0, entry)
    db["searches"] = db["searches"][: db.get("keep", 100)]
    save(SEARCHES, db)
    print(json.dumps(entry, ensure_ascii=False))
    return 0


def cmd_history(args):
    db = load(SEARCHES)
    rows = db["searches"]
    if args.query:
        key = fold(args.query)
        rows = [r for r in rows if key in fold(json.dumps(r["params"], ensure_ascii=False))]
    if not rows:
        print("history is empty", file=sys.stderr)
        return MISS
    for r in rows[: args.limit]:
        total = "—" if r["total"] is None else r["total"]
        print(f"{r['date']}  matches: {total}  {r['note'] or ''}".rstrip())
        # single quotes on the outside: the JSON inside has its own double quotes
        print(f"  playwright-cli -s=olx eval 'window.__P={json.dumps(r['params'], ensure_ascii=False, separators=(',', ':'))}'")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("city", help="cityId from the cache; exit 3 — miss")
    c.add_argument("name")
    c.set_defaults(fn=cmd_city)

    a = sub.add_parser("city-add", help="write a resolve into the cache")
    a.add_argument("--name", required=True)
    a.add_argument("--id", type=int, required=True)
    a.add_argument("--region", default=None)
    a.add_argument("--region-id", type=int, default=None)
    a.add_argument("--county", default=None)
    a.add_argument("--alias", action="append", default=[])
    a.set_defaults(fn=cmd_city_add)

    l = sub.add_parser("log", help="record a completed search in the history")
    l.add_argument("--params", required=True, help="the same thing that goes into window.__P")
    l.add_argument("--total", type=int, default=None, help="the counter from olx-count.js")
    l.add_argument("--note", default=None)
    l.set_defaults(fn=cmd_log)

    h = sub.add_parser("history", help="past searches + a ready-to-run command to repeat them")
    h.add_argument("--limit", type=int, default=10)
    h.add_argument("--query", default=None)
    h.set_defaults(fn=cmd_history)

    args = p.parse_args()
    sys.exit(args.fn(args))


if __name__ == "__main__":
    main()
