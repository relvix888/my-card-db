import sqlite3
import json
from pathlib import Path

DB = Path("pipeline/data/deck_raw_gg.db")
OUT = Path("src/data/deck_gg_raw_final.json")

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

# Latest deck per leader: latest event_date, ties broken by highest id
rows = conn.execute("""
    SELECT leader, cards_json, event_name, event_date
    FROM meta_decks m
    WHERE id = (
        SELECT id FROM meta_decks m2
        WHERE m2.leader = m.leader
        ORDER BY m2.event_date DESC, m2.id DESC
        LIMIT 1
    )
""").fetchall()

result = {}
for row in rows:
    cards = json.loads(row["cards_json"])
    deck_str = ",".join(f"{c['qty']}x{c['id']}" for c in cards)
    result[row["leader"].upper()] = {
        "deck": deck_str,
        "event_name": row["event_name"],
        "event_date": row["event_date"],
    }

OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(f"Exported {len(result)} leaders → {OUT}")
