import sqlite3
import json
import os

# 1. SETUP PATHS
# Get the folder where this script (db_to_json.py) lives: .../pipeline/transform/
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Input: Up one to pipeline, down to data: .../pipeline/data/deck_raw.db
DB_PATH = os.path.join(BASE_DIR, "..", "data", "deck_raw.db")

# Output: Up twice to root, down to src/data: .../src/data/deck_final.json
OUTPUT_PATH = os.path.join(BASE_DIR, "..", "..", "src", "data", "deck_final.json")

# 2. CONNECT
# Use the dynamic DB_PATH instead of a hardcoded string
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Query remains the same
query = """
    SELECT 
        leader, 
        cards_json,
        COUNT(*) OVER (PARTITION BY leader) as appearance_count,
        ROW_NUMBER() OVER (PARTITION BY leader ORDER BY id DESC) as rn
    FROM meta_decks
"""

cursor.execute(query)
rows = cursor.fetchall()

processed_decks = {}

for leader_id, cards_raw, count, rn in rows:
    if rn != 1:  
        continue
    if not leader_id or not cards_raw:
        continue
    
    try:
        card_list = json.loads(cards_raw)
        deck_string = ",".join([f"{item['qty']}x{item['id']}" for item in card_list])
        
        processed_decks[leader_id] = {
            "deck": deck_string,
            "count": count
        }
    except Exception as e:
        print(f"Error processing {leader_id}: {e}")

# 3. SAVE TO NEW LOCATION
# Ensure the directory exists before saving
os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(processed_decks, f, indent=2, ensure_ascii=False)

conn.close()
print(f"✅ Success! Exported {len(processed_decks)} decks to {os.path.abspath(OUTPUT_PATH)}")