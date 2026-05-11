import asyncio
import random
import os
import json
import firebase_admin
from firebase_admin import credentials, firestore
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import re
import unicodedata

# --- NEW: Initialize Firebase ---
# Ensure the path matches where you saved the JSON file
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

async def scrape_all_sets():
    set_codes = [
    "st01", "st02", "st03", "st04", "op01", "st05", "st06", "op02", "st07", "op03", 
    "st08", "st09", "op04", "st10", "op05", "st11", "st12", "op06", "st13", "eb01", 
    "op07", "st14", "op08", "st15", "st16", "st17", "st18", "st19", "st20", "prb01", 
    "op09", "op10", "st21",  "eb02", "prb02", "op11", "st22", "op12", "st23", "st24", 
    "st25", "st26", "st27", "st28", "op13", "eb03", "op14", "st29", "eb04", "op15", "st30",
    "promo-100", "promo-200",
    "promo-op10", "promo-op20", "promo-st10", "promo-eb10",
    ]
    
    results = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()

        # --- 1. INITIAL HUMAN VERIFICATION ---
        # Load the first set and pause for the human to solve the CAPTCHA
        first_url = f"https://yuyu-tei.jp/sell/opc/s/{set_codes[0]}"
        print(f"🚀 Initializing session with {set_codes[0].upper()}...")
        
        await page.goto(first_url, wait_until="networkidle")
        
        print("\n👉 ACTION REQUIRED:")
        print("1. Solve the CAPTCHA/Puzzle in the browser window.")
        print("2. Once the card list is visible, come back here.")
        input("3. Press ENTER to start the automated batch scrape...")

        # --- 2. THE AUTOMATED LOOP ---
        for set_code in set_codes:
            url = f"https://yuyu-tei.jp/sell/opc/s/{set_code}"
            print(f"🔍 Scraping Set: {set_code.upper()}...")
            
            try:
                # 1. Wait for the network to be quiet
                await page.goto(url, wait_until="networkidle", timeout=60000)

                # 2. CRITICAL: Wait for at least one card to actually appear on the screen
                # This ensures the JavaScript has finished rendering the list
                await page.wait_for_selector(".card-product", timeout=10000)
                await asyncio.sleep(1) # Extra buffer for dynamic elements
                
                content = await page.content()
                soup = BeautifulSoup(content, 'html.parser')

                # 3. Use a more flexible "contains" selector for the card divs
                cards = soup.select('div[class*="card-product"]')
                
                if not cards:
                    print(f"⚠️ No cards found for {set_code} even after waiting.")
                    continue

                for card in cards:
                    # 1. Price Extraction
                    price_tag = card.find("strong")
                    if not price_tag: continue
                    price_text = "".join(filter(str.isdigit, price_tag.get_text()))
                    if not price_text: continue
                    current_price = int(price_text)

                    # 2. Base ID Extraction (from the span with the border)
                    id_span = card.find("span", class_=lambda x: x and 'border' in x)
                    base_id = id_span.get_text(strip=True) if id_span else None
                    
                    # 3. Parallel Detection
                    # Get the product name (h4) and the image description (alt)
                    h4_tag = card.find("h4")
                    product_name = h4_tag.get_text(strip=True) if h4_tag else ""
                    
                    # --- WITHIN YOUR CARD LOOP ---
                    # 1. Find the specific card image (avoiding the "Star" icon)
                    img_tag = card.find('img', class_='card')
                    product_h4 = card.find('h4')
                    price_tag = card.find('strong') # Grabs the price text

                    if img_tag and product_h4:
                        alt_text = img_tag.get('alt', '')
                        product_name = product_h4.get_text(strip=True)

                        # 1. Normalize Japanese text to standard English letters/numbers
                        # This converts ＳＰ -> SP and Japanese spaces -> standard spaces
                        raw_context = f"{alt_text} {product_name}"
                        search_context = unicodedata.normalize('NFKC', raw_context).upper()

                        # 2. Assign Rank
                        rank = 0
                        display_name = product_name # Default name

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
                        # --- THE ROBUST SP CHECK ---
                        # We look for "SP" anywhere, but ensure it's not part of a longer word
                        elif "SP" in search_context:
                            rank = 2
                            # NEW: Force "SP " into the name if we found the tag
                            if not product_name.startswith("SP"):
                                display_name = f"SP {product_name}"
                        elif "パラレル" in search_context:
                            rank = 1

                        # --- STORE DATA ---
                        if base_id:
                            if base_id not in results:
                                results[base_id] = []
                            
                            results[base_id].append({
                                "set": set_code,
                                "price": current_price,
                                "rank": rank,
                                "name": display_name 
                            })

                print(f"✅ Finished {set_code.upper()}. Taking a breather...")
                await asyncio.sleep(random.uniform(2, 4))

            except Exception as e:
                # If a set fails (like a timeout), we just log it and move to the next set
                print(f"⚠️ Skipping {set_code}: {e}")
        
        await browser.close()
    
    print(f"📊 Total cards indexed: {len(results)}")   
    return results

def upload_to_firestore(price_dict):
    print(f"🔥 Syncing to Firestore...")
    batch = db.batch()
    count = 0

    for base_id, versions in price_dict.items():
        # Sort versions chronologically by set and then by rarity rank
        sorted_versions = sorted(versions, key=lambda x: (x['set'], x['rank']))

        p_counter = 1
        for version in sorted_versions:
            # Determine the final ID (e.g., OP01-121 or OP01-121_p1)
            if version['rank'] == 0:
                final_id = base_id
            else:
                final_id = f"{base_id}_p{p_counter}"
                p_counter += 1

            doc_ref = db.collection("card_prices").document(final_id)
            jpy_price = version['price']
            hkd_price = round(jpy_price * 0.05, 2) # Changed to 2 decimal places for accuracy
            
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
    prices = await scrape_all_sets() 
    
    if prices:
        # 1. Sync to Firestore (using the updated logic above)
        upload_to_firestore(prices)
        
        # 2. Prepare Local JSON (Flattening the lists into the final _p format)
        json_output = []
        for base_id, versions in prices.items():
            sorted_v = sorted(versions, key=lambda x: (x['set'], x['rank']))
            p_counter = 1
            for v in sorted_v:
                final_id = base_id if v['rank'] == 0 else f"{base_id}_p{p_counter}"
                if v['rank'] > 0: p_counter += 1
                
                json_output.append({
                    "id": final_id,
                    "jpy": v['price'],
                    "hkd": round(v['price'] * 0.05, 2)
                })

        current_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(current_dir, "..", "data", "price_raw.json")
        with open(file_path, "w", encoding="utf-8") as f:
            # We save 'prices' directly because it is already a dict
            json.dump(prices, f, indent=2, ensure_ascii=False)
            
        print(f"💾 Local JSON updated: {file_path}")

    else:
        print("❌ No prices found. JSON was not updated.")

# This is the "Start Button" - it should be the last thing in the file
if __name__ == "__main__":
    asyncio.run(main())