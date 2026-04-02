import json
import os
import re
from datetime import datetime

# --- PATHS ---
# Update this to the absolute or relative path of your uploader project
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOADER_DATA_PATH = os.path.join(BASE_DIR, "..", "..", "..", "opc-uploader", "data")
RAW_PRICES_PATH = os.path.join(BASE_DIR, "..", "..", "pipeline", "data", "price_raw.json")
OUTPUT_PATH = os.path.join(BASE_DIR, "..", "..", "src", "data", "price_final.json")

PACK_DATA = {
    "554302": "PRB-02", "554301": "PRB-01",
    "554204": "EB-04",  "554203": "EB-03",  "554202": "EB-02", "554201": "EB-01",
    "554115": "OP-15",  "554114": "OP-14",  "554113": "OP-13", "554112": "OP-12",
    "554111": "OP-11",  "554110": "OP-10",  "554109": "OP-09", "554108": "OP-08",
    "554107": "OP-07",  "554106": "OP-06",  "554105": "OP-05", "554104": "OP-04",
    "554103": "OP-03",  "554102": "OP-02",  "554101": "OP-01",
    "554029": "ST-29",  "554028": "ST-28",  "554027": "ST-27", "554026": "ST-26",
    "554025": "ST-25",  "554024": "ST-24",  "554023": "ST-23", "554022": "ST-22",
    "554021": "ST-21",  "554020": "ST-20",  "554019": "ST-19", "554018": "ST-18",
    "554017": "ST-17",  "554016": "ST-16",  "554015": "ST-15", "554014": "ST-14",
    "554013": "ST-13",  "554012": "ST-12",  "554011": "ST-11", "554010": "ST-10",
    "554009": "ST-09",  "554008": "ST-08",  "554007": "ST-07", "554006": "ST-06",
    "554005": "ST-05",  "554004": "ST-04",  "554003": "ST-03", "554002": "ST-02",
    "554001": "ST-01",  "554701": "Family", "554901": "Promo", "554801": "Limited"
}
# Create a mapping of "op05" -> "554105"
REVERSE_PACK_MAP = {
    v.lower().replace("-", ""): k 
    for k, v in PACK_DATA.items()
}
def get_pack_id(raw_set_name):
    """Helper to find Pack ID, with fallback for any 'promo-xxx' string."""
    clean_name = str(raw_set_name).lower().replace("-", "")
    
    # Check standard map
    if clean_name in REVERSE_PACK_MAP:
        return REVERSE_PACK_MAP[clean_name]
    
    # Dynamic fallback for promos (e.g., promo200, promo201)
    if "promo" in clean_name:
        return "554901" # Default Promo Pack ID
    
    return None

# RANK_OVERRIDES maps (ID, Rank) -> Target Suffix Number
# 0 = Base, 1 = _p1, 2 = _p2 (Manga), 3 = _p3 (Treasure), 4 = _p4 (SP)
# first number is the base ID, second number is the original rank from scraper, value is the _p value to assign
RANK_OVERRIDES = {
    # OP13 Examples
    ("OP13-118", 0): 0, ("OP13-118", 5): 2, ("OP13-118", 6): 3, ("OP13-118", 2): 4,
    ("OP13-119", 0): 0, ("OP13-119", 5): 2, ("OP13-119", 6): 3, ("OP13-119", 2): 4,
    ("OP13-120", 0): 0, ("OP13-120", 5): 2, ("OP13-120", 6): 3, ("OP13-120", 2): 4,
    ("OP09-004", 0): 0, ("OP09-004", 3): 6, ("OP09-004", 2): 3, ("OP09-004", 5): 2, ("OP09-004", 4): 5, 
    ("OP09-093", 0): 0, ("OP09-093", 3): 5, ("OP09-093", 2): 3,
    ("OP09-051", 0): 0, ("OP09-051", 2): 3, ("OP09-051", 4): 5, ("OP09-051", 3): 6,
    ("P-105", 2): 2,
    ("EB01-023", 2): 2,
    ("EB01-003", 2): 3,
    ("OP06-093", 2): 3,
    ("OP09-118", 2): 3,
    ("OP09-119", 2): 3,
    ("OP05-119", 4): 7, ("OP05-119", 3): 6, ("OP05-119", 2): 5,
    ("ST16-004", 2): 1,
    ("OP07-021", 2): 1,
    ("ST15-002", 2): 1,
    ("ST18-001", 2): 1,
    ("OP05-067", 2): 4,
    ("OP07-051", 2): 3,
    ("OP08-106", 2): 4,
    ("OP02-013", 2): 3,
    ("OP03-112", 2): 4,
    ("ST02-007", 2): 3,
    ("ST03-004", 2): 2,
    ("ST04-005", 2): 3,
    ("ST06-006", 2): 2,
    ("OP03-003", 2): 1,
    ("OP05-074", 2): 3,
    ("OP01-035", 2): 2,
    ("OP01-016", 2): 4,
    ("ST01-012", 2): 1,
    ("ST04-003", 2): 1,
    ("EB02-061", 5): 2, ("EB02-061", 2): 3,
    ("OP09-020", 1): 2,
    ("OP09-057", 1): 2,
    ("OP09-078", 1): 2,
    ("OP10-119", 2): 3,
    ("OP13-080", 7): 2,
    ("OP13-083", 7): 2,
    ("OP13-084", 7): 2,
    ("OP13-089", 7): 2,
    ("OP13-091", 7): 2,

}

def get_custom_sort_weight(base_id, rank, name, price, pid, all_global_versions):
    if (base_id, rank) in RANK_OVERRIDES:
        return RANK_OVERRIDES[(base_id, rank)]

    is_sp = "SP " in str(name).upper() or rank == 2
    
    if is_sp:
        current_set_prefix = pid.replace("554", "OP")
        is_reprint = not base_id.startswith(current_set_prefix)

        # We look through ALL versions of this card (OP07, OP14, etc.)
        all_ranks = [v.get('rank', 0) for v in all_global_versions]
        has_standard_parallel = 1 in all_ranks
        has_manga_or_treasure = 5 in all_ranks or 6 in all_ranks

        if is_reprint:
            # If a standard parallel (Rank 1) exists ANYWHERE in the data, 
            # this SP MUST be _p2.
            return 2 if has_standard_parallel else 1
        
        # Native SP Logic (e.g. OP13-118)
        return 4 if has_manga_or_treasure else 1

    if rank == 5: return 2
    if rank == 6: return 3
    if rank == 1: return 1
    
    return rank

def build_master_map():
    """
    Creates a validation map: { "pack_id": ["OP01-001", "OP01-001_p1", ...] }
    """
    master_map = {}
    
    if not os.path.exists(UPLOADER_DATA_PATH):
        print(f"❌ Error: Cannot find uploader data at {UPLOADER_DATA_PATH}")
        return None

    for filename in os.listdir(UPLOADER_DATA_PATH):
        if filename.endswith(".json"):
            # Extract numbers from filename (e.g., cards_554001.json -> 554001)
            # This matches your '554115.json' and 'cards_554001.json' formats
            match = re.search(r'(\d+)', filename)
            if not match:
                continue
            
            pack_id = match.group(1)
            file_path = os.path.join(UPLOADER_DATA_PATH, filename)
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    cards = json.load(f)
                    
                    # We only care about the ID field for mapping
                    if isinstance(cards, list):
                        # Filter out any null IDs just in case
                        valid_ids = [card['id'] for card in cards if 'id' in card]
                        master_map[pack_id] = valid_ids
                        
            except Exception as e:
                print(f"⚠️ Error reading {filename}: {e}")

    return master_map

def run_transformer():
    last_updated = datetime.now().strftime("%Y-%m-%d")
    master_map = build_master_map()
    if not master_map: return

    with open(RAW_PRICES_PATH, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    final_prices = []
    mismatch_log = []

    for base_id, versions in raw_data.items():
        # Group by the dynamically determined Pack ID
        versions_by_pack = {}
        for v in versions:
            pid = get_pack_id(v.get("set", "")) # Use the new helper
            if pid:
                if pid not in versions_by_pack: 
                    versions_by_pack[pid] = []
                versions_by_pack[pid].append(v)

        for pid in sorted(versions_by_pack.keys()):
            valid_ids_in_this_pack = master_map.get(pid, [])
            
            for v in versions_by_pack[pid]:
                rank = v.get('rank', 0)
                name = v.get('name', '')
                price = v.get('price', 0)

                weight = get_custom_sort_weight(base_id, rank, name, price, pid, versions)

                # Generate the ID (e.g., P-105 or P-105_p1)
                suffix = f"_p{weight}" if weight > 0 else ""
                final_id = f"{base_id}{suffix}"

                # Validation against your uploader JSON files
                if final_id in valid_ids_in_this_pack:
                    final_prices.append({
                        "id": final_id,
                        "jpy": price,
                        "hkd": round(price * 0.05, 0),
                        "pack_id": pid
                    })
                else:
                    mismatch_log.append({
                        "base_id": base_id,
                        "generated_id": final_id,
                        "rank": rank,
                        "name": name,
                        "pack_id": pid,
                        "reason": f"Check if {final_id} exists in {pid}.json"
                    })

    # 4. Save Final Output
    final_output = {
        "metadata": { "lastUpdated": last_updated },
        "prices": final_prices
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(final_output, f, indent=2, ensure_ascii=False)

    # 5. Save Mismatch Log
    LOG_PATH = os.path.join(BASE_DIR, "..", "..", "pipeline", "data", "price_mismatch.json")
    with open(LOG_PATH, "w", encoding="utf-8") as f:
        json.dump(mismatch_log, f, indent=2, ensure_ascii=False)

    print(f"✅ Transformed {len(final_prices)} cards.")
    if mismatch_log:
        print(f"⚠️ Found {len(mismatch_log)} mismatches. See {LOG_PATH} for manual overrides.")

if __name__ == "__main__":
    run_transformer()