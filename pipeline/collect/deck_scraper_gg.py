import requests
from bs4 import BeautifulSoup
import json
import sqlite3
import re

def scrape_gumgum_deck(url):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,/ ;q=0.8',
    }
    
    print(f"Fetching: {url}")
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        print(f"Failed to load page. Status: {response.status_code}")
        return None

    soup = BeautifulSoup(response.text, 'html.parser')
    
    # Next.js stores all page data in a script tag with id "__NEXT_DATA__"
    script_tag = soup.find('script', id='__NEXT_DATA__')
    if not script_tag:
        print("Could not find __NEXT_DATA__ tag.")
        return None

    data = json.loads(script_tag.string)
    
    # Navigating GumGum's specific data tree
    # This path may vary slightly but usually follows this pattern:
    try:
        page_props = data['props']['pageProps']
        deck_data = page_props.get('deck', {})
        
        leader_name = deck_data.get('leaderName', 'Unknown Leader')
        # GumGum usually stores the list as a list of objects with {cardId, count}
        cards = deck_data.get('cards', []) 
        
        # Formatting into your app's preferred format: [{'id': 'OP01-001', 'qty': 4}]
        formatted_cards = []
        for card in cards:
            formatted_cards.append({
                'id': card.get('cardId'),
                'qty': card.get('count')
            })

        return {
            'leader': leader_name,
            'placement': deck_data.get('event', 'GumGum Export'),
            'cards': json.dumps(formatted_cards)
        }
    except KeyError as e:
        print(f"Data structure changed: {e}")
        return None

def save_to_db(deck, db_path):
    if not deck: return
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS meta_decks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            leader TEXT,
            placement TEXT,
            cards_json TEXT,
            scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        INSERT INTO meta_decks (leader, placement, cards_json)
        VALUES (?, ?, ?)
    ''', (deck['leader'], deck['placement'], deck['cards']))
    
    conn.commit()
    conn.close()
    print("Deck saved successfully.")

# --- EXECUTION ---
# Using the URL you provided
TARGET_URL = "https://gumgum.gg/one-piece/decklists/deck/east/op15/84ae146f-8a98-4eec-883c-2fd2d66531b5"
DB_LOCATION = "/Users/rexchan/my-card-db/pipeline/data/deck_raw_gg.db"

deck_info = scrape_gumgum_deck(TARGET_URL)
save_to_db(deck_info, DB_LOCATION)