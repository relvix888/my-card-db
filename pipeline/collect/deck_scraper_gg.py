import requests
import json
import sqlite3
import re
import sys
import time

BASE_URL = "https://gumgum.gg"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}
DB_PATH = "/Users/rexchan/my-card-db/pipeline/data/deck_raw_gg.db"
NUM_DECKS = 200

# Current active format. Update TARGET_FORMAT each new set release.
# LEADER_IDS = all standard-regulation leaders (block 2–5), queried from
# Firestore via pipeline/collect/fetch_leaders.js. Refresh after each new set.
TARGET_FORMAT = 'OP15'
REGIONS = ['east']
LEADER_IDS = [
    'EB01-001', 'EB01-021', 'EB01-040',
    'EB02-010',
    'EB03-001',
    'EB04-001',
    'OP05-001', 'OP05-002', 'OP05-022', 'OP05-041', 'OP05-060', 'OP05-098',
    'OP06-001', 'OP06-020', 'OP06-021', 'OP06-022', 'OP06-042', 'OP06-080',
    'OP07-001', 'OP07-019', 'OP07-038', 'OP07-059', 'OP07-079', 'OP07-097',
    'OP08-001', 'OP08-002', 'OP08-021', 'OP08-057', 'OP08-058', 'OP08-098',
    'OP09-001', 'OP09-022', 'OP09-042', 'OP09-061', 'OP09-062', 'OP09-081',
    'OP10-001', 'OP10-002', 'OP10-003', 'OP10-022', 'OP10-042', 'OP10-099',
    'OP11-001', 'OP11-021', 'OP11-022', 'OP11-040', 'OP11-041', 'OP11-062',
    'OP12-001', 'OP12-020', 'OP12-040', 'OP12-041', 'OP12-061', 'OP12-081',
    'OP13-001', 'OP13-002', 'OP13-003', 'OP13-004', 'OP13-079', 'OP13-100',
    'OP14-001', 'OP14-020', 'OP14-040', 'OP14-041', 'OP14-060', 'OP14-079', 'OP14-080',
    'OP15-001', 'OP15-002', 'OP15-022', 'OP15-039', 'OP15-058', 'OP15-098',
    'P-047', 'P-076', 'P-086', 'P-117',
    'PRB01-001',
    'ST10-001', 'ST10-002', 'ST10-003',
    'ST11-001',
    'ST12-001',
    'ST13-001', 'ST13-002', 'ST13-003',
    'ST14-001',
    'ST21-001', 'ST22-001',
    'ST29-001', 'ST30-001',
]


def get_next_f_chunks(html):
    """Parse Next.js App Router __next_f push blocks into decoded strings."""
    chunks = []
    for m in re.finditer(r'self\.__next_f\.push\((\[.*?\])\)', html, re.DOTALL):
        try:
            arr = json.loads(m.group(1))
            if isinstance(arr, list) and len(arr) == 2 and arr[0] == 1:
                chunks.append(arr[1])
        except Exception:
            pass
    return chunks


def get_leader_decklists_via_api(format_id, leader_id, region):
    """Call the gumgum.gg decklists API for one leader + region combination."""
    url = f"{BASE_URL}/api/decklists/leader?set={format_id}&region={region}&leaderId={leader_id}"
    r = requests.get(url, headers=HEADERS, timeout=15)
    if r.status_code != 200:
        return []
    try:
        return r.json() or []
    except Exception:
        return []


def get_deck_from_url(deck_url):
    """Fetch a single deck detail page and return a deck dict, or None on failure."""
    r = requests.get(deck_url, headers=HEADERS, timeout=15)
    if r.status_code != 200:
        print(f"  Failed to fetch {deck_url}: {r.status_code}")
        return None

    chunks = get_next_f_chunks(r.text)
    for chunk in chunks:
        if '"leader_id"' not in chunk or '"decklist"' not in chunk:
            continue
        idx = chunk.find('"deck":{')
        if idx == -1:
            continue
        start = idx + len('"deck":')
        depth, end = 0, start
        for i, ch in enumerate(chunk[start:], start):
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        try:
            deck = json.loads(chunk[start:end])
        except Exception:
            continue

        leader_id = deck.get('leader_id', '')
        decklist_str = deck.get('decklist', '')
        if not leader_id or not decklist_str:
            return None

        event_name = deck.get('event_name') or deck.get('tournament_type', '')
        return {
            'leader': leader_id,
            'placement': str(deck.get('placement_text') or deck.get('placement', '')),
            'cards_json': json.dumps(parse_decklist(decklist_str, leader_id)),
            'event_name': event_name,
            'event_date': deck.get('date', ''),
        }
    return None


def parse_decklist(decklist_str, leader_id):
    """Convert gumgum decklist string (4xOP01-001;2xOP02-002) to card list."""
    cards = [{'id': leader_id, 'qty': 1}]
    for entry in decklist_str.split(';'):
        entry = entry.strip()
        if 'x' not in entry:
            continue
        qty_str, card_id = entry.split('x', 1)
        try:
            cards.append({'id': card_id.strip(), 'qty': int(qty_str)})
        except ValueError:
            pass
    return cards


def save_to_db(decks):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS meta_decks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            leader TEXT,
            placement TEXT,
            cards_json TEXT,
            event_name TEXT,
            event_date TEXT,
            scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('DELETE FROM meta_decks')
    for d in decks:
        cursor.execute(
            'INSERT INTO meta_decks (leader, placement, cards_json, event_name, event_date) VALUES (?,?,?,?,?)',
            (d['leader'], d['placement'], d['cards_json'], d['event_name'], d['event_date'])
        )
    conn.commit()
    conn.close()
    print(f"Saved {len(decks)} decks to {DB_PATH}")


# --- EXECUTION ---
direct_urls = [a for a in sys.argv[1:] if a.startswith('http')]

print(f"Fetching {TARGET_FORMAT} decklists from gumgum.gg API...")
all_raw = []
seen_ids = set()

for leader_id in LEADER_IDS:
    for region in REGIONS:
        raw = get_leader_decklists_via_api(TARGET_FORMAT, leader_id, region)
        new = [d for d in raw if d.get('id') not in seen_ids]
        if new:
            seen_ids.update(d['id'] for d in new if d.get('id'))
            all_raw.extend(new)
            print(f"  {leader_id} ({region}): {len(new)} decks")
        time.sleep(0.3)

all_decks = []
for deck in all_raw:
    decklist_str = deck.get('decklist', '')
    leader_id = deck.get('leader_id', '')
    if not decklist_str or not leader_id:
        continue
    event_name = deck.get('event_name') or deck.get('tournament_type', '')
    all_decks.append({
        'leader': leader_id,
        'placement': str(deck.get('placement_text') or deck.get('placement', '')),
        'cards_json': json.dumps(parse_decklist(decklist_str, leader_id)),
        'event_name': event_name,
        'event_date': deck.get('date', ''),
    })

if direct_urls:
    print(f"\nScraping {len(direct_urls)} direct deck URL(s)...")
    for url in direct_urls:
        deck = get_deck_from_url(url)
        if deck:
            all_decks.append(deck)
            print(f"  Got: {deck['leader']} ({deck['event_name']}, {deck['event_date']})")
        else:
            print(f"  Failed: {url}")
        time.sleep(0.5)

all_decks.sort(key=lambda d: d['event_date'], reverse=True)
all_decks = all_decks[:NUM_DECKS]

print(f"\nTotal collected (keeping {NUM_DECKS} most recent): {len(all_decks)}")
if all_decks:
    print(f"Date range: {all_decks[-1]['event_date']} → {all_decks[0]['event_date']}")
save_to_db(all_decks)
