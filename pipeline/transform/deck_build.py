# runs as API

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
import json
import os

app = FastAPI(title="Spasta Meta API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "..", "data", "deck_raw.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.get("/")
def read_root():
    return {"status": "Spasta Backend Online", "meta_version": "OP-15"}

@app.get("/api/autobuild/{leader_id}")
async def autobuild(leader_id: str):
    conn = get_db_connection() 
    cursor = conn.cursor()
    
    query = "SELECT cards_json FROM meta_decks WHERE leader = ?"
    
    try:
        search_term = f'%{leader_id}%'
        cursor.execute(query, (leader_id,))
        rows = cursor.fetchall()
        
        if not rows:
            raise HTTPException(status_code=404, detail=f"No decks found for {leader_id}")

        num_decks = len(rows)
        card_stats = {} 
        
        # 1. Aggregate stats from all matching decks
        for row in rows:
            deck_list = json.loads(row['cards_json'])
            for card in deck_list:
                cid = card['id']
                qty = card['qty']
                if cid not in card_stats:
                    card_stats[cid] = {"total_qty": 0, "appearance_count": 0}
                card_stats[cid]["total_qty"] += qty
                card_stats[cid]["appearance_count"] += 1

        # 2. Rank cards by appearance rate
        ranked_cards = []
        for cid, stats in card_stats.items():
            avg_qty = round(stats["total_qty"] / stats["appearance_count"])
            appearance_rate = stats["appearance_count"] / num_decks
            ranked_cards.append({
                "id": cid,
                "avg_qty": avg_qty,
                "score": appearance_rate 
            })

        ranked_cards.sort(key=lambda x: x['score'], reverse=True)

        # 3. Separate Leader from Battle Cards
        # We assume the leader is the one passed in, or the first card with avg_qty 1
        battle_cards_pool = [c for c in ranked_cards if c['id'] != leader_id]

        main_deck = {}
        main_deck_total = 0
        
        # 4. Fill the Main Deck to exactly 50 based on average quantities
        for card in battle_cards_pool:
            if main_deck_total >= 50:
                break
            space_left = 50 - main_deck_total
            qty_to_take = min(card['avg_qty'], space_left)
            if qty_to_take > 0:
                main_deck[card['id']] = qty_to_take
                main_deck_total += qty_to_take

        # 5. Safety Filler (Optional: adds a staple if the meta list was too short)
        if main_deck_total < 50:
            filler_id = "OP01-016" # Nami or similar staple
            shortfall = 50 - main_deck_total
            main_deck[filler_id] = main_deck.get(filler_id, 0) + shortfall

        # 6. Final Assembly
        export_lines = [f"1x{leader_id}"]
        for cid, qty in main_deck.items():
            export_lines.append(f"{qty}x{cid}")
        
        export_string = "\n".join(export_lines)

        return {
            "leader_id": leader_id,
            "main_deck_count": sum(main_deck.values()),
            "export_string": export_string,
            "deck": main_deck
        }

    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/api/meta-stats")
async def get_meta_stats():
    conn = get_db_connection() 
    cursor = conn.cursor()
    cursor.execute("SELECT leader, COUNT(*) as count FROM meta_decks GROUP BY leader")
    rows = cursor.fetchall()
    conn.close()
    
    # Return a dictionary for easy lookup: {"OP12-020": 45, "OP01-001": 12}
    return {row[0]: row[1] for row in rows if row[0]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)