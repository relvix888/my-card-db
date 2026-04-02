import json
import os
from datetime import datetime  # Add this import

# --- MANUAL AMENDMENTS ---
# This is your "Master Ledger" for ID corrections.
MANUAL_OVERRIDES = {
    "OP09-004_p2": "OP09-004_p3",
    "OP09-004_p3": "OP09-004_p2", # This is the known SP version of OP09-004
    "OP09-004_p4": "OP09-004_p5",
    "OP09-004_p5": "OP09-004_p6",
    "OP09-093_p2": "OP09-093_p3",
    "OP09-093_p3": "OP09-093_p2",
    "ST13-011_p2": "ST13-011_p1",
    "ST13-011_p1": "ST13-011_p2",
    "EB01-003_p2": "EB01-003_p3",
    "OP01-016_p3": "OP01-016_p7",
    "OP01-016_p2": "OP01-016_p4",
    "OP01-016_p4": "OP01-016_p3",
    "OP05-119_p5": "OP05-119_p6",
    "OP05-119_p3": "OP05-119_p5",
    "OP05-119_p4": "OP05-119_p7",

    # #OP15
    # "OP12-014-P": "OP12-014_p2",
    # "OP13-042-P": "OP13-042_p2",
    # "EB02-052-P": "EB02-052_p2",
    # "P-105-P": "P-105_p2",


    # #Manga IDs
    # "OP01-121-P-SEC": "OP01-121_p2", #ok
    # "OP03-122-P-SEC": "OP03-122_p2", #ok
    # "OP04-083-P-SR": "OP04-083_p2", #ok
    # "OP05-069-P-SR": "OP05-069_p2", #ok
    # #"OP05-074-SP" Kid
    # "OP06-118-P-SEC": "OP06-118_p2", #ok
    # "OP07-051-P-SR": "OP07-051_p2", #ok
    # "OP08-118-P-SEC": "OP08-118_p2", #ok
    # "OP09-118-P-SEC": "OP09-118_p2", #ok Rogers
    # "OP09-119-P-SEC": "OP09-119_p3", #ok
    # "OP10-119-P-SEC": "OP10-119_p2", #ok
    # "OP11-118-P-SEC": "OP11-118_p2", #ok
    # "OP12-118-P-SEC": "OP12-118_p2", #ok
    # "OP13-118-P-SEC": "OP13-118_p3", #ok
    # "OP13-119-P-SEC": "OP13-119_p3", #ok
    # "OP13-120-P-SEC": "OP13-120_p3", #ok
    # "OP14-119-P-SEC": "OP14-119_p2", #ok
    # "OP15-118-P-SEC": "OP15-118_p2", #ok

    # #SP
    # "EB01-003-SP": "EB01-003_p2",
    # "EB01-023-SP": "EB01-023_p2",
    # "EB01-056-SP": "EB01-056_p2",
    # "EB01-057-SP": "EB01-057_p2",
    # "EB02-028-SP": "EB02-028_p2", 
    # "EB02-052-SP": "EB02-052_p2",
    # "EB02-061-P": "EB02-061_p2", #ok
    # "EB02-061-SP": "EB02-061_p3", #ok
    # "EB03-003-SP": "EB03-003_p2",
    # "EB03-018-SP": "EB03-018_p2",
    # "EB03-024-SP": "EB03-024_p2",
    # "EB03-026-SP": "EB03-026_p2",
    # "EB03-031-SP": "EB03-031_p2",
    # "EB03-042-SP": "EB03-042_p2",
    # "EB03-045-SP": "EB03-045_p2",
    # "EB03-053-SP": "EB03-053_p2",
    # "EB03-055-SP": "EB03-055_p2",
    # "EB04-003-SP": "EB04-003_p1", #ok
    # "EB04-039-SP": "EB04-039_p1", #ok
    # "OP01-016-SP": "OP01-016_p4", #ok   
    # "OP01-035-SP": "OP01-035_p2", #ok
    # "OP01-047-SP": "OP01-047_p2", #ok
    # "OP01-051-SP": "OP01-051_p2", #ok
    # "OP01-073-SP": "OP01-073_p2", #ok
    # "OP01-078-SP": "OP01-078_p2", #ok
    # "OP01-121-SP": "OP01-121_p2", #ok
    # "OP02-004-SP": "OP02-004_p2", #ok
    # "OP02-013-SP": "OP02-013_p3", #ok
    # "OP02-085-SP": "OP02-085_p2", #ok
    # "OP02-099-SP": "OP02-099_p2", #ok   
    # "OP02-120-SP": "OP02-120_p2", #ok
    # "OP03-003-SP": "OP03-003_p2", #ok p1
    # "OP03-008-SP": "OP03-008_p1", #ok
    # "OP03-078-SP": "OP03-078_p2", #ok
    # "OP03-092-SP": "OP03-092_p2",
    # "OP03-112-SP": "OP03-112_p4", #ok
    # "OP03-114-SP": "OP03-114_p2", #ok
    # "OP03-ID-10153-SP": "ST01-012_p1", #ok
    # "OP03-ID-10154-SP": "ST03-009_p1", #ok
    # "OP03-ID-10155-SP": "ST04-003_p1", #ok
    # "OP04-024-SP": "OP04-024_p2", #ok   
    # "OP04-044-SP": "OP04-044_p2", #ok
    # "OP04-064-SP": "OP04-064_p2", #ok
    # "OP04-119-SP": "OP04-119_p2", #ok
    # "OP05-051-SP": "OP05-051_p2", #ok
    # "OP05-067-SP": "OP05-067_p4", #ok
    # "OP05-074-SP": "OP05-074_p3", #ok
    # "OP05-091-SP": "OP05-091_p2", #ok
    # "OP05-093-SP": "OP05-093_p2", #ok
    # "OP05-100-SP": "OP05-100_p2", #ok 
    # "OP05-119-P-SEC": "OP05-119_p2", #ok
    # "OP05-119-SP": "OP05-119_p5", #ok
    # "OP06-007-SP": "OP06-007_p2", #ok
    # "OP06-047-SP": "OP06-047_p3", #ok
    # "OP06-050-SP": "OP06-050_p2", #ok
    # "OP06-093-SP": "OP06-093_p3", #ok
    # "OP06-101-SP": "OP06-101_p2", #ok
    # "OP06-119-SP": "OP06-119_p2",
    # "OP07-015-SP": "OP07-015_p2", #ok
    # "OP07-021-SP": "OP07-021_p1",
    # "OP07-046-SP": "OP07-046_p2", #ok
    # "OP07-051-SP": "OP07-051_p3", #ok
    # "OP07-085-SP": "OP07-085_p2", #ok
    # "OP07-111-SP": "OP07-111_p2", #ok
    # "OP07-118-SP": "OP07-118_p2", #ok
    # "OP08-023-SP": "OP08-023_p2", #ok
    # "OP08-106-SP": "OP08-106_p2",
    # "OP08-ID-10146-SP": "ST02-007_p3", #ok
    # "OP08-ID-10147-SP": "ST03-004_p2", #ok
    # "OP08-ID-10148-SP": "ST04-005_p3", #ok
    # "OP08-ID-10149-SP": "ST06-006_p2", #ok
    # "OP09-004-SP": "OP09-004_p6",
    # "OP09-005-SP": "OP09-005_p1", #ok
    # "OP09-009-SP": "OP09-009_p2", #ok 
    # "OP09-013-SP": "OP09-013_p1", #ok    
    # "OP09-037-SP": "OP09-037_p2", #ok
    # "OP09-051-SP": "OP09-051_p6", #ok
    # "OP09-093-SP": "OP09-093_p2",
    # "OP09-118-SP": "OP09-118_p2",
    # "OP09-119-SP": "OP09-119_p3", #ok
    # "OP10-030-SP": "OP10-030_p2", #ok
    # "OP10-065-SP": "OP10-065_p1", #ok
    # "OP10-082-SP": "OP10-082_p2", #ok
    # "OP10-119-SP": "OP10-119_p3", #ok
    # "OP10-ID-10147-SP": "ST12-012_p1", #ok
    # "OP10-ID-10148-SP": "ST14-003_p1", #ok
    # "OP10-ID-10149-SP": "OP06-119_p2", #ok
    # "OP10-ID-10150-SP": "OP07-085_p2", #ok
    # "OP11-106-SP": "OP11-106_p2",
    # "OP11-ID-10152-SP": "ST16-004_p1", #ok
    # "OP11-ID-10153-SP": "ST18-005_p1", #ok
    # "OP11-ID-10154-SP": "EB01-057_p2", #ok
    # "OP12-014-SP": "OP12-014_p2", #ok
    # "OP12-030-SP": "OP12-030_p2", #ok
    # "OP12-ID-10152-SP": "ST13-011_p2", #ok
    # "OP12-ID-10153-SP": "ST18-004_p1", #ok
    # "OP13-031-SP": "OP13-031_p1", #ok
    # "OP13-042-SP": "OP13-042_p2", #ok
    # "OP13-118-SP": "OP13-118_p2", #ok
    # "OP13-119-SP": "OP13-119_p2", #ok
    # "OP13-120-SP": "OP13-120_p2", #ok
    # "OP13-ID-10174-SP": "EB02-028_p1", #ok
    # "OP09-004-P-SR": "OP09-004_p5", #ok
    # "OP09-051-P-R": "OP09-051_p5",
    # "OP14-112-SP": "OP14-112_p2", #ok
    # "OP14-ID-10156-SP": "EB01-003_p3", #ok
    # "OP15-ID-10152-SP": "ST26-005_p1", #ok
    # "OP15-ID-10153-SP": "EB02-052_p2", #ok
    # "OP15-ID-10154-SP": "P-105_p2", #ok

    # "P-105-SP": "P-105_p2",
    # "PRB02-006-SP": "PRB02-006_p2", #ok
    # "PRB02-014-SP": "PRB02-014_p2", #ok
    # "ST01-012-SP": "ST01-012_p2",
    # "ST02-007-SP": "ST02-007_p2",
    # "ST03-004-SP": "ST03-004_p2",
    # "ST03-009-SP": "ST03-009_p2",
    # "ST04-003-SP": "ST04-003_p2",
    # "ST04-005-SP": "ST04-005_p2",
    # "ST06-006-SP": "ST06-006_p2",
    # "ST12-012-SP": "ST12-012_p2",
    # "ST13-011-SP": "ST13-011_p2",
    # "ST14-003-SP": "ST14-003_p2",
    # "ST15-002-SP": "ST15-002_p2",
    # "ST16-004-SP": "ST16-004_p2",
    # "ST18-001-SP": "ST18-001_p2",
    # "ST18-004-SP": "ST18-004_p2",
    # "ST18-005-SP": "ST18-005_p2",
    # "ST26-005-SP": "ST26-005_p2",
}

def transform_logic(raw_id):
    # This remains as your fallback/manual check
    if raw_id in MANUAL_OVERRIDES:
        return MANUAL_OVERRIDES[raw_id]
    
    # if raw_id.endswith("-SP"):
    #     return raw_id.replace("-SP", "") + "_p2"
    
    # if raw_id.endswith("-P"):
    #     return raw_id.replace("-P", "") + "_p1"
    
    # rarity_suffixes = ["-SEC", "-SR", "-L", "-R", "-UC", "-C"]
    # for suffix in rarity_suffixes:
    #     if raw_id.endswith(suffix):
    #         return raw_id.replace(suffix, "")
    return raw_id

def run_transformer():
    raw_path = "data_pipeline/raw_prices.json"
    output_path = "src/card_prices.json"
    last_updated = datetime.now().strftime("%Y-%m-%d")

    if not os.path.exists(raw_path):
        print(f"❌ Error: {raw_path} not found.")
        return

    with open(raw_path, "r", encoding="utf-8") as f:
        # This now loads the DICTIONARY from the new scraper
        raw_data = json.load(f)

    final_prices = []

    # --- START OF TRANSFORM_ALL_DATA LOGIC ---
    for base_id, versions in raw_data.items():
        # 1. Sort versions chronologically by set and then by rarity rank
        sorted_versions = sorted(versions, key=lambda x: (x['set'], x['rank']))

        p_counter = 1
        for v in sorted_versions:
            jpy_price = v.get("price")
            
            # 2. Check for Manual Overrides using a "legacy style" string
            legacy_id = base_id
            if v['rank'] == 2: legacy_id += "-SP"
            elif v['rank'] == 1: legacy_id += "-P"

            if legacy_id in MANUAL_OVERRIDES:
                final_id = MANUAL_OVERRIDES[legacy_id]
                if v['rank'] > 0: p_counter += 1
            
            # 3. Automatic Suffix Logic
            elif v['rank'] == 0:
                final_id = base_id
            else:
                final_id = f"{base_id}_p{p_counter}"
                p_counter += 1

            final_prices.append({
                "id": final_id,
                "jpy": jpy_price,
                "hkd": round(jpy_price * 0.05, 0)
            })
    # --- END OF TRANSFORM_ALL_DATA LOGIC ---

    final_output = {
        "metadata": { "lastUpdated": last_updated },
        "prices": final_prices
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(final_output, f, indent=2, ensure_ascii=False)

    print(f"✅ Successfully transformed {len(final_prices)} cards.")
    print(f"📅 Timestamp added: {last_updated}")

if __name__ == "__main__":
    run_transformer()