"""
Build card_scores.db — a SQLite database of scored card data for sorting/querying.

Usage (from project root):
    python pipeline/data/build_scores_db.py [--sets OP16 OP15 ...]
    python pipeline/data/build_scores_db.py          # all score JSON files found

The DB is written to pipeline/data/card_scores.db.
"""

import json
import sqlite3
import sys
import glob
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
SCORE_DIR = os.path.join(ROOT, "src", "data")
PRICE_FILE = os.path.join(ROOT, "pipeline", "data", "price_raw.json")
DB_PATH = os.path.join(ROOT, "pipeline", "data", "card_scores.db")

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS card_scores (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    set_code        TEXT,
    rarity          TEXT,
    category        TEXT,
    cost            INTEGER,
    power           INTEGER,
    counter         INTEGER,
    score           REAL,
    tier            TEXT,
    power_score     REAL,
    power_baseline  INTEGER,
    counter_score   REAL,
    effect_score    REAL,
    raw_total       REAL,
    cost_divisor    INTEGER,
    event_discount  REAL,
    matched_keywords TEXT,
    price_jpy       INTEGER
);
"""

def set_code_from_id(card_id):
    """Extract set code from card ID, e.g. 'OP16-032' → 'OP16'."""
    base = card_id.split("_")[0]  # strip _p1, _r, etc.
    parts = base.rsplit("-", 1)
    return parts[0] if len(parts) == 2 else base

def load_prices():
    try:
        with open(PRICE_FILE) as f:
            raw = json.load(f)
        prices = {}
        for card_id, entries in raw.items():
            base = next((e for e in entries if e.get("rank") == 0), None)
            if base:
                prices[card_id] = base["price"]
        return prices
    except FileNotFoundError:
        return {}

def find_score_files(sets=None):
    pattern = os.path.join(SCORE_DIR, "card_scores_*.json")
    files = sorted(glob.glob(pattern))
    if sets:
        sets_lower = {s.lower() for s in sets}
        files = [f for f in files if any(s in os.path.basename(f).lower() for s in sets_lower)]
    return files

def main():
    args = sys.argv[1:]
    requested_sets = [a for a in args if not a.startswith("--")]
    score_files = find_score_files(requested_sets if requested_sets else None)

    if not score_files:
        print("No score JSON files found. Run the scorer first.")
        sys.exit(1)

    prices = load_prices()
    print(f"Loaded {len(prices)} prices from price_raw.json")

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute(CREATE_TABLE)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_set  ON card_scores(set_code)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_score ON card_scores(score DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tier  ON card_scores(tier)")

    total = 0
    for path in score_files:
        with open(path) as f:
            data = json.load(f)

        rows = []
        for card_id, info in data.items():
            calc = info.get("calculation", {})
            rows.append((
                card_id,
                info.get("name"),
                set_code_from_id(card_id),
                info.get("rarity"),
                info.get("category"),
                info.get("cost"),
                info.get("power"),
                info.get("counter"),
                info.get("score"),
                info.get("tier"),
                calc.get("powerScore"),
                calc.get("powerBaseline"),
                calc.get("counterScore"),
                calc.get("effectScore"),
                calc.get("rawTotal"),
                calc.get("costDivisor"),
                calc.get("eventDiscount"),
                json.dumps(calc.get("matchedEffectKeywords", []), ensure_ascii=False),
                prices.get(card_id),
            ))

        cur.executemany(
            """INSERT OR REPLACE INTO card_scores VALUES
               (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows,
        )
        total += len(rows)
        print(f"  {os.path.basename(path)}: {len(rows)} cards")

    con.commit()
    con.close()
    print(f"\nDone — {total} cards written to {DB_PATH}")
    print("\nExample queries:")
    print("  sqlite3 pipeline/data/card_scores.db 'SELECT id,name,score,tier FROM card_scores ORDER BY score DESC LIMIT 20'")
    print("  sqlite3 pipeline/data/card_scores.db 'SELECT id,name,score,price_jpy FROM card_scores WHERE set_code=\"OP16\" ORDER BY price_jpy DESC'")

if __name__ == "__main__":
    main()
