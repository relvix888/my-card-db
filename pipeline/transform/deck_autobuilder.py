import sqlite3
import json
import os

# --- 1. THE BRAIN (Define this FIRST) ---
def generate_meta_deck(cursor, leader_id):
    """Analyzes meta trends for a leader and returns an optimized deck string."""
    query = "SELECT cards_json FROM meta_decks WHERE leader = ?"
    cursor.execute(query, (leader_id,))
    rows = cursor.fetchall()
    
    if not rows:
        return None

    num_decks = len(rows)
    card_stats = {} 
    
    # Aggregate stats
    for row in rows:
        # Note: fetchall() returns tuples. cards_json is the first column (index 0)
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
        avg_qty = round(stats["total_qty"] / stats["appearance_count"])
        score = stats["appearance_count"] / num_decks
        ranked_cards.append({"id": cid, "avg_qty": avg_qty, "score": score})

    ranked_cards.sort(key=lambda x: x['score'], reverse=True)

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

    # Final Assembly: 1xLeader, then the main deck
    return f"1x{leader_id}," + ",".join(main_deck)


# --- 2. THE EXPORTER (Calls the Brain) ---
def export_all_to_react():
    # Paths adjusted for pipeline/transform/ folder
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    # Adjusting to your folder structure: up to pipeline, then into data
    DB_PATH = os.path.join(BASE_DIR, "..", "data", "deck_raw.db")
    # Up to pipeline, up to project root, then into src/data
    OUT_PATH = os.path.join(BASE_DIR, "..", "..", "src", "data", "deck_final.json")

    if not os.path.exists(DB_PATH):
        print(f"❌ Error: Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get all unique leaders and their total appearance count
    cursor.execute("SELECT leader, COUNT(*) FROM meta_decks GROUP BY leader")
    leaders = cursor.fetchall()
    
    deck_library = {}
    
    print(f"⏳ Processing {len(leaders)} leaders...")

    for l_id, count in leaders:
        if not l_id: continue
        
        # Now Python knows what this function is!
        deck_string = generate_meta_deck(cursor, l_id)
        
        if deck_string:
            deck_library[l_id] = {
                "deck": deck_string,
                "count": count 
            }

    # Ensure output directory exists
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    # Write to React
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(deck_library, f, indent=2, ensure_ascii=False)
    
    conn.close()
    print(f"✅ Success! Exported {len(deck_library)} optimized decks to: {OUT_PATH}")


if __name__ == "__main__":
    export_all_to_react()