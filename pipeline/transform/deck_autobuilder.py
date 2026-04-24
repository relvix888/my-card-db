import sqlite3
import json
import os

# --- 1. THE BRAIN (Modified to take only 5 most recent) ---
def generate_meta_deck(cursor, leader_id):
    """Analyzes the 5 most recent meta trends for a leader."""
    # We sort by ID ASC (smallest = most recent) and limit to 5
    query = """
        SELECT cards_json 
        FROM meta_decks 
        WHERE leader = ? 
        ORDER BY id ASC 
        LIMIT 5
    """
    cursor.execute(query, (leader_id,))
    rows = cursor.fetchall()
    
    if not rows:
        return None

    # num_decks will now be between 1 and 5
    num_decks = len(rows)
    card_stats = {} 
    
    # Aggregate stats
    for row in rows:
        try:
            deck_list = json.loads(row[0]) 
            for card in deck_list:
                cid, qty = card['id'], card['qty']
                if cid not in card_stats:
                    card_stats[cid] = {"total_qty": 0, "appearance_count": 0}
                card_stats[cid]["total_qty"] += qty
                card_stats[cid]["appearance_count"] += 1
        except Exception:
            continue

    # Rank cards by Score
    ranked_cards = []
    for cid, stats in card_stats.items():
        # Average quantity based on how many of the 5 decks it appeared in
        avg_qty = round(stats["total_qty"] / stats["appearance_count"])
        # Score is frequency of appearance within the sample size (1-5)
        score = stats["appearance_count"] / num_decks
        ranked_cards.append({"id": cid, "avg_qty": avg_qty, "score": score})

    # Sort primarily by score, secondarily by avg_qty for ties
    ranked_cards.sort(key=lambda x: (x['score'], x['avg_qty']), reverse=True)

    # Build Main Deck (50 cards)
    battle_cards = [c for c in ranked_cards if c['id'] != leader_id]
    main_deck = []
    total_count = 0
    
    for card in battle_cards:
        if total_count >= 50: break
        take = min(card['avg_qty'], 50 - total_count)
        if take > 0:
            main_deck.append(f"{take}x{card['id']}")
            total_count += take

    return f"1x{leader_id}," + ",".join(main_deck)


# --- 2. THE EXPORTER ---
def export_all_to_react():
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    DB_PATH = os.path.join(BASE_DIR, "..", "data", "deck_raw.db")
    OUT_PATH = os.path.join(BASE_DIR, "..", "..", "src", "data", "deck_final.json")

    if not os.path.exists(DB_PATH):
        print(f"❌ Error: Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get unique leaders
    cursor.execute("SELECT leader, COUNT(*) FROM meta_decks GROUP BY leader")
    leaders = cursor.fetchall()
    
    deck_library = {}
    
    print(f"⏳ Processing {len(leaders)} leaders (Top 5 Meta)...")

    for l_id, total_count in leaders:
        if not l_id: continue
        
        deck_string = generate_meta_deck(cursor, l_id)
        
        if deck_string:
            deck_library[l_id] = {
                "deck": deck_string,
                "count": total_count # Total decks found in DB for context
            }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(deck_library, f, indent=2, ensure_ascii=False)
    
    conn.close()
    print(f"✅ Success! Exported {len(deck_library)} optimized decks to: {OUT_PATH}")


if __name__ == "__main__":
    export_all_to_react()