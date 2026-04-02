import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "..", "data", "price_raw.json")

def find_special_cards():
    raw_path = DB_PATH
    
    if not os.path.exists(raw_path):
        print("❌ price_raw.json not found. Run the scraper first!")
        return

    with open(raw_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Handle both list and dictionary formats just in case
    if isinstance(data, list):
        # Format: [{"id": "OP01-001-SP", "jpy": 100}, ...]
        sp_cards = [item['id'] for item in data if item.get('id', '').endswith('-SP')]
    else:
        # Format: {"OP01-001-SP": 100, ...}
        sp_cards = [card_id for card_id in data.keys() if card_id.endswith('-SP')]

    print(f"\n🔍 Found {len(sp_cards)} SP cards:\n")
    print("Copy and paste these into your transformer.py MANUAL_OVERRIDES:")
    print("-" * 30)
    
    for card in sorted(sp_cards):
        # This prints it in a format ready for your Python dictionary
        print(f'    "{card}": "{card.replace("-SP", "")}_p2",')
    
    print("-" * 30)

if __name__ == "__main__":
    find_special_cards()