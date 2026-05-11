import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'deck_raw_gg.db')
OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'data', 'deck_gg_final.json')


def generate_meta_deck(cursor, leader_id):
    """Aggregate up to 5 most recent decks for a leader into a single optimised list."""
    cursor.execute(
        'SELECT cards_json FROM meta_decks WHERE leader = ? ORDER BY id ASC LIMIT 5',
        (leader_id,)
    )
    rows = cursor.fetchall()
    if not rows:
        return None

    num_decks = len(rows)
    card_stats = {}

    for (cards_json,) in rows:
        try:
            for card in json.loads(cards_json):
                cid, qty = card['id'], card['qty']
                if cid not in card_stats:
                    card_stats[cid] = {'total_qty': 0, 'appearance_count': 0}
                card_stats[cid]['total_qty'] += qty
                card_stats[cid]['appearance_count'] += 1
        except Exception:
            continue

    ranked = []
    for cid, stats in card_stats.items():
        avg_qty = round(stats['total_qty'] / stats['appearance_count'])
        score = stats['appearance_count'] / num_decks
        ranked.append({'id': cid, 'avg_qty': avg_qty, 'score': score})

    ranked.sort(key=lambda x: (x['score'], x['avg_qty']), reverse=True)

    battle_cards = [c for c in ranked if c['id'] != leader_id]
    main_deck, total = [], 0
    for card in battle_cards:
        if total >= 50:
            break
        take = min(card['avg_qty'], 50 - total)
        if take > 0:
            main_deck.append(f"{take}x{card['id']}")
            total += take

    return f"1x{leader_id}," + ",".join(main_deck)


def export_all():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute('SELECT leader, COUNT(*) FROM meta_decks GROUP BY leader')
    leaders = cursor.fetchall()

    print(f"Processing {len(leaders)} leaders...")
    deck_library = {}

    for leader_id, count in leaders:
        if not leader_id:
            continue
        deck_string = generate_meta_deck(cursor, leader_id)
        if deck_string:
            deck_library[leader_id] = {'deck': deck_string, 'count': count}

    conn.close()

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(deck_library, f, indent=2, ensure_ascii=False)

    print(f"Exported {len(deck_library)} decks to {OUT_PATH}")


if __name__ == '__main__':
    export_all()
