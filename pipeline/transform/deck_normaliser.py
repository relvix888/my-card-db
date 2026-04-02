import sqlite3
import os

# 1. Get the directory where the current script is located
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 2. Build the path: 
# Go "up" to the pipeline folder, then "down" into data
DB_PATH = os.path.join(BASE_DIR, "..", "data", "deck_raw.db")

# Define your "Translation Table"
# Format: "Nickname in DB": "Official Card ID"
ID_MAP = {
    "G Zoro": "OP12-020", 
    "RG Luffy": "OP13-001", 
    "Purple Doffy": "OP14-060",
    "Red Blue Lucy": "OP15-002",
    "BY Nami": "OP11-041",
    "Kalgara": "OP08-098", 
    "Black Crocodile": "OP14-079", 
    "BY Boa": "OP14-041", 
    "Boa": "OP14-041", 
    "Sky Island Luffy": "OP15-098",
    "Purple Enel": "OP15-058", 
    "RG Krieg": "OP15-001", 
    "UP Luffy": "OP11-040", 
    "BY Ace": "ST13-002", 
    "YB Ace": "ST13-002", 
    "Teach": "OP09-081",
    "Blackbeard": "OP09-081",
    "RB Koby": "OP11-001", 
    "Green Mihawk": "OP14-020", 
    "Egghead Luffy": "ST29-001", 
    "PY Rosinante": "OP12-061", 
    "G Bonnie": "OP07-019",
    "G Bonney": "OP07-019",
    "Egghead Bonney": "EB04-001", 
    "Gold D Roger": "OP13-003", 
    "Blue Jinbei": "OP11-021", 
    "Rebecca": "OP15-039", 
    "GB Brook": "OP15-022", 
    "BR Ace": "OP13-002", 
    "Imu": "OP13-079", 
    "BY Moria": "OP14-080", 
    "ZoroSanji": "ST12-001", 
    "Shirahoshi": "OP11-022", 
    "GY Law": "OP10-022", 
    "Red Blue Vivi": "EB03-001", 
    "Purple Foxy": "OP07-059", 
    "BR Sabo": "OP13-004", 
    "Green Carrot": "OP08-021", 
    "UP Sanji": "OP12-041", 
    "Blue Kuzan": "OP12-040", 
    "Black Lucci": "OP07-079", 
    "RY Betty": "OP05-002", 
    "GP Luffy": "EB02-010", 
    "Blue Jinbe": "OP14-040", 
    "Vegapunk": "OP07-007", 
    "RG Smoker": "OP10-001", 
    "PY Robin": "OP09-062",
    "Yellow Enel": "OP05-098",
    "Vivi": "EB03-001",
}

def migrate_database():
    if not os.path.exists(DB_PATH):
        print(f"Error: Could not find {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("--- Starting ID Migration ---")
    
    updates_count = 0
    for nickname, card_id in ID_MAP.items():
        # Update the leader column where it matches the nickname
        cursor.execute(
            "UPDATE meta_decks SET leader = ? WHERE leader = ?", 
            (card_id, nickname)
        )
        if cursor.rowcount > 0:
            print(f"Updated: {nickname} -> {card_id} ({cursor.rowcount} rows)")
            updates_count += cursor.rowcount

    conn.commit()
    conn.close()
    print(f"--- Migration Finished! Total rows updated: {updates_count} ---")

if __name__ == "__main__":
    migrate_database()