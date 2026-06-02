import requests
from bs4 import BeautifulSoup
import sqlite3
import json
import os

def scrape_top_decks(url):
    print(f"Fetching data from {url}...")
    headers = {'User-Agent': 'Mozilla/5.0'}
    response = requests.get(url, headers=headers)
    soup = BeautifulSoup(response.text, 'html.parser')

    table = soup.find('table', {'id': 'tablepress-41'})
    if not table:
        print("Table not found.")
        return []

    decks = []
    rows = table.find('tbody').find_all('tr')
    
    for row in rows:
        cells = row.find_all('td')
        if len(cells) < 11: continue
            
        raw_deck_string = cells[0].get_text(strip=True)
        leader_name = cells[4].get_text(strip=True)
        placement = cells[8].get_text(strip=True) # e.g., "1st Place"
        
        card_segments = raw_deck_string.split('a')
        parsed_cards = []
        for segment in card_segments:
            if 'n' in segment:
                qty, card_id = segment.split('n', 1)
                parsed_cards.append({'id': card_id, 'qty': int(qty)})
        
        decks.append({
            'leader': leader_name,
            'placement': placement,
            'cards': json.dumps(parsed_cards) # Store as JSON string for SQLite
        })
    return decks

def save_to_db(decks, db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create the table if it doesn't exist
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS meta_decks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            leader TEXT,
            placement TEXT,
            cards_json TEXT,
            scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Clear old meta data to keep it fresh for OP-15
    cursor.execute('DELETE FROM meta_decks')
    
    # Insert the new 190 decks
    for d in decks:
        cursor.execute('''
            INSERT INTO meta_decks (leader, placement, cards_json)
            VALUES (?, ?, ?)
        ''', (d['leader'], d['placement'], d['cards']))
    
    conn.commit()
    conn.close()
    print(f"Successfully saved {len(decks)} decks to {db_path}")

# --- EXECUTION ---
# Before changing this URL for a new set, archive the current meta:
#   cp src/data/deck_final.json src/data/deck_prev_meta.json
URL = "https://onepiecetopdecks.com/deck-list/japan-op16-deck-list-the-time-of-battle/"
DB_LOCATION = "/Users/rexchan/my-card-db/pipeline/data/deck_raw.db" # Adjusted for your path

all_meta_decks = scrape_top_decks(URL)
if all_meta_decks:
    save_to_db(all_meta_decks, DB_LOCATION)