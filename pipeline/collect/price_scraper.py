import asyncio
import random
import os
import sys
import json
import firebase_admin
from firebase_admin import credentials, firestore
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import unicodedata

cred = credentials.Certificate(os.path.expanduser("~/.secrets/serviceAccountKey.json"))
firebase_admin.initialize_app(cred)
db = firestore.client()

ALL_SET_CODES = [
    "st01", "st02", "st03", "st04", "op01", "st05", "st06", "op02", "st07", "op03",
    "st08", "st09", "op04", "st10", "op05", "st11", "st12", "op06", "st13", "eb01",
    "op07", "st14", "op08", "st15", "st16", "st17", "st18", "st19", "st20", "prb01",
    "op09", "op10", "st21", "eb02", "prb02", "op11", "st22", "op12", "st23", "st24",
    "st25", "st26", "st27", "st28", "op13", "eb03", "op14", "st29", "eb04", "op15", "st30", "op16",
    "st31", "st32", "st33", "st34", "st35", "st36",
    "promo-100", "promo-200",
    "promo-op10", "promo-op20", "promo-st10", "promo-eb10",
]

RAW_PRICES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "price_raw.json")


async def scrape_sets(set_codes):
    results = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()

        first_url = f"https://yuyu-tei.jp/sell/opc/s/{set_codes[0]}"
        print(f"🚀 Initializing session with {set_codes[0].upper()}...")
        await page.goto(first_url, wait_until="networkidle")

        print("\n👉 ACTION REQUIRED:")
        print("1. Solve the CAPTCHA/Puzzle in the browser window.")
        print("2. Once the card list is visible, come back here.")
        input("3. Press ENTER to start the automated batch scrape...")

        for set_code in set_codes:
            url = f"https://yuyu-tei.jp/sell/opc/s/{set_code}"
            print(f"🔍 Scraping Set: {set_code.upper()}...")

            try:
                await page.goto(url, wait_until="networkidle", timeout=60000)
                await page.wait_for_selector(".card-product", timeout=10000)
                await asyncio.sleep(1)

                content = await page.content()
                soup = BeautifulSoup(content, 'html.parser')
                cards = soup.select('div[class*="card-product"]')

                if not cards:
                    print(f"⚠️ No cards found for {set_code} even after waiting.")
                    continue

                for card in cards:
                    price_tag = card.find("strong")
                    if not price_tag:
                        continue
                    price_text = "".join(filter(str.isdigit, price_tag.get_text()))
                    if not price_text:
                        continue
                    current_price = int(price_text)

                    id_span = card.find("span", class_=lambda x: x and 'border' in x)
                    base_id = id_span.get_text(strip=True) if id_span else None
                    if not base_id:
                        continue

                    img_tag = card.find('img', class_='card')
                    product_h4 = card.find('h4')
                    if not img_tag or not product_h4:
                        continue

                    alt_text = img_tag.get('alt', '')
                    product_name = product_h4.get_text(strip=True)
                    raw_context = f"{alt_text} {product_name}"
                    search_context = unicodedata.normalize('NFKC', raw_context).upper()

                    rank = 0
                    display_name = product_name

                    if "レッドスーパーパラレル" in search_context:
                        rank = 6
                    elif "特別パラレル" in search_context:
                        rank = 7
                    elif "スーパーパラレル" in search_context:
                        rank = 5
                    elif "金パラレル" in search_context:
                        rank = 4
                    elif "銀パラレル" in search_context:
                        rank = 3
                    elif "SP" in search_context:
                        rank = 2
                        if not product_name.startswith("SP"):
                            display_name = f"SP {product_name}"
                    elif "パラレル" in search_context:
                        rank = 1

                    if base_id not in results:
                        results[base_id] = []
                    results[base_id].append({
                        "set": set_code,
                        "price": current_price,
                        "rank": rank,
                        "name": display_name,
                    })

                print(f"✅ Finished {set_code.upper()}. Taking a breather...")
                await asyncio.sleep(random.uniform(2, 4))

            except Exception as e:
                print(f"⚠️ Skipping {set_code}: {e}")

        await browser.close()

    print(f"📊 Cards indexed this run: {len(results)}")
    return results


def merge_into_raw(existing_data, new_data, scraped_sets):
    """
    Merge freshly scraped prices into the existing price_raw dict.
    All entries whose 'set' is in scraped_sets are replaced; everything
    else is preserved so the transformer has the full picture.
    """
    merged = {}

    # Keep entries from existing data that were NOT re-scraped
    for base_id, versions in existing_data.items():
        kept = [v for v in versions if v.get("set") not in scraped_sets]
        if kept:
            merged[base_id] = kept

    # Overlay the fresh data
    for base_id, versions in new_data.items():
        if base_id not in merged:
            merged[base_id] = []
        merged[base_id].extend(versions)

    return merged


def upload_to_firestore(price_dict):
    print(f"🔥 Syncing {len(price_dict)} base IDs to Firestore...")
    batch = db.batch()
    count = 0

    for base_id, versions in price_dict.items():
        sorted_versions = sorted(versions, key=lambda x: (x['set'], x['rank']))

        p_counter = 1
        for version in sorted_versions:
            if version['rank'] == 0:
                final_id = base_id
            else:
                final_id = f"{base_id}_p{p_counter}"
                p_counter += 1

            doc_ref = db.collection("card_prices").document(final_id)
            jpy_price = version['price']
            hkd_price = round(jpy_price * 0.05, 2)

            batch.set(doc_ref, {
                "id": final_id,
                "jpy": jpy_price,
                "hkd": hkd_price,
                "set": version['set'],
                "lastUpdated": firestore.SERVER_TIMESTAMP
            }, merge=True)

            count += 1
            if count % 400 == 0:
                batch.commit()
                batch = db.batch()

    batch.commit()
    print(f"✅ Sync complete! {count} card versions uploaded.")


async def main():
    # Accept set codes as CLI args; default to the full list.
    # Usage: python price_scraper.py op16
    #        python price_scraper.py op16 eb04
    #        python price_scraper.py          (scrapes everything)
    target_sets = sys.argv[1:] if len(sys.argv) > 1 else ALL_SET_CODES
    incremental = len(target_sets) < len(ALL_SET_CODES)

    if incremental:
        print(f"🔄 Incremental mode — scraping: {', '.join(s.upper() for s in target_sets)}")
    else:
        print("🔄 Full mode — scraping all sets")

    new_prices = await scrape_sets(target_sets)

    if not new_prices:
        print("❌ No prices found. price_raw.json was not updated.")
        return

    # Load existing price_raw.json (if present) and merge
    existing_data = {}
    if incremental and os.path.exists(RAW_PRICES_PATH):
        with open(RAW_PRICES_PATH, "r", encoding="utf-8") as f:
            existing_data = json.load(f)
        print(f"📂 Loaded existing price_raw.json ({len(existing_data)} base IDs)")

    merged_data = merge_into_raw(existing_data, new_prices, set(target_sets))

    with open(RAW_PRICES_PATH, "w", encoding="utf-8") as f:
        json.dump(merged_data, f, indent=2, ensure_ascii=False)
    print(f"💾 price_raw.json updated: {len(merged_data)} total base IDs")

    # In incremental mode only upload the base IDs whose prices actually changed.
    # In full mode upload everything (same behaviour as before).
    if incremental:
        affected = {bid: merged_data[bid] for bid in new_prices if bid in merged_data}
        upload_to_firestore(affected)
    else:
        upload_to_firestore(merged_data)


if __name__ == "__main__":
    asyncio.run(main())
