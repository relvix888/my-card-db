"""
One Piece TCG pipeline runner.

Usage:
  python run_pipeline.py update      — prices + meta decks (no new set)
  python run_pipeline.py prices      — scrape prices & transform only
  python run_pipeline.py decks       — scrape meta decks (topdecks + gumgum.gg) & build
  python run_pipeline.py new-set [zh_pack_id]
                              — full new-set workflow:
                                scrape ZH/EN cards → upload to Firestore
                                → Q&A → download images → upload to Cloudinary
                                → update prices & decks
                                Pass a ZH pack ID (e.g. 554116) to target one set;
                                omit to process all packs.
"""

import subprocess
import sys
import os
import shutil

PIPELINE_ROOT = os.path.dirname(os.path.abspath(__file__))
COLLECT       = os.path.join(PIPELINE_ROOT, "pipeline", "collect")
TRANSFORM     = os.path.join(PIPELINE_ROOT, "pipeline", "transform")
DATA_OUT      = os.path.join(PIPELINE_ROOT, "src", "data")
PIPELINE_DATA = os.path.join(PIPELINE_ROOT, "pipeline", "data")
OPC_UPLOADER  = os.path.join(PIPELINE_ROOT, "..", "opc-uploader")


def run_py(script_path, description, *, abort_on_fail=True):
    print(f"\n{'='*55}")
    print(f"  🐍  {description}")
    print(f"{'='*55}")
    result = subprocess.run([sys.executable, script_path])
    if result.returncode != 0:
        print(f"❌  Failed: {description}")
        if abort_on_fail:
            sys.exit(1)
        return False
    return True


def run_node(script_path, description, *, cwd=None, abort_on_fail=True, extra_args=()):
    print(f"\n{'='*55}")
    print(f"  🟩  {description}")
    print(f"{'='*55}")
    node = shutil.which("node")
    if not node:
        print("❌  'node' not found in PATH.")
        if abort_on_fail:
            sys.exit(1)
        return False
    result = subprocess.run([node, script_path] + list(extra_args), cwd=cwd or os.path.dirname(script_path))
    if result.returncode != 0:
        print(f"❌  Failed: {description}")
        if abort_on_fail:
            sys.exit(1)
        return False
    return True


# ---------------------------------------------------------------------------
# Workflow: prices
# ---------------------------------------------------------------------------

def pipeline_prices():
    print("\n📈  PRICES PIPELINE")
    run_py(
        os.path.join(COLLECT, "price_scraper.py"),
        "Scrape prices → pipeline/data/price_raw.json",
    )
    run_py(
        os.path.join(TRANSFORM, "price_transformer.py"),
        "Transform prices → src/data/price_final.json",
    )
    print("\n✅  Prices pipeline complete.")


# ---------------------------------------------------------------------------
# Workflow: decks
# ---------------------------------------------------------------------------

def pipeline_decks():
    print("\n🃏  DECKS PIPELINE")

    # --- onepiecetopdecks.com ---
    run_py(
        os.path.join(COLLECT, "deck_scraper.py"),
        "Scrape meta decks (topdecks) → pipeline/data/deck_raw.db",
    )
    run_py(
        os.path.join(TRANSFORM, "deck_normaliser.py"),
        "Normalise leader names → card IDs",
    )
    run_py(
        os.path.join(TRANSFORM, "deck_autobuilder.py"),
        "Build deck JSON → src/data/deck_final.json",
    )

    # --- gumgum.gg ---
    run_py(
        os.path.join(COLLECT, "deck_scraper_gg.py"),
        "Scrape meta decks (gumgum.gg) → pipeline/data/deck_raw_gg.db",
    )
    run_py(
        os.path.join(TRANSFORM, "deck_gg_autobuilder.py"),
        "Build GG deck JSON → src/data/deck_gg_raw_final.json",
    )

    print("\n✅  Decks pipeline complete.")


# ---------------------------------------------------------------------------
# Workflow: update  (prices + decks, no new set)
# ---------------------------------------------------------------------------

def pipeline_update():
    print("\n🔄  UPDATE PIPELINE  (prices + decks)")
    pipeline_prices()
    pipeline_decks()
    print("\n✅  Update complete.")


# ---------------------------------------------------------------------------
# Workflow: new-set
# ---------------------------------------------------------------------------

def pipeline_new_set(pack_id=None):
    """pack_id: ZH pack ID like '554116', or omit to process all packs."""
    print("\n🆕  NEW SET PIPELINE")

    # Derive regional IDs from the ZH pack ID (554xxx → 556xxx for EN)
    zh_id = pack_id if pack_id else None
    en_id = zh_id.replace("554", "556", 1) if zh_id and zh_id.startswith("554") else zh_id
    zh_args = (zh_id,) if zh_id else ()
    en_args = (en_id,) if en_id else ()
    img_args = (zh_id,) if zh_id else ()

    if zh_id:
        print(f"\n  🎯  Targeting pack: ZH={zh_id}  EN={en_id}")
    else:
        print(
            "\n  ⚠️   Manual step required before continuing:\n"
            "    • Open src/constants/packs.js and add the new pack to packData\n"
            "      and packOrder with its pack ID, zh/en/ja titles.\n"
        )
        input("  Press Enter once packData / packOrder are updated, or Ctrl-C to abort...\n")

    # Step 1 — Scrape card data from official site
    run_node(
        os.path.join(OPC_UPLOADER, "scrape-cards-zh.js"),
        f"Scrape ZH cards → opc-uploader/data/ZH/{zh_id or 'all'}",
        cwd=OPC_UPLOADER,
        extra_args=zh_args,
    )
    run_node(
        os.path.join(OPC_UPLOADER, "scrape-cards.js"),
        f"Scrape EN cards → opc-uploader/data/EN/{en_id or 'all'}",
        cwd=OPC_UPLOADER,
        extra_args=en_args,
    )

    # Step 2 — Upload card data to Firestore + export en_cards.json
    run_node(
        os.path.join(OPC_UPLOADER, "upload.js"),
        "Upload cards to Firestore → src/data/en_cards.json",
        cwd=OPC_UPLOADER,
    )

    # Step 3 — Q&A (Traditional Chinese)
    run_node(
        os.path.join(COLLECT, "qanda_scraper.js"),
        f"Scrape Q&A (zh) → pipeline/data/temp_qa_data.json",
        extra_args=zh_args,
    )
    _copy_qa(
        src=os.path.join(PIPELINE_DATA, "temp_qa_data.json"),
        dst=os.path.join(DATA_OUT, "master_qa.json"),
        label="zh",
    )

    # Step 4 — Q&A (English)
    run_node(
        os.path.join(COLLECT, "qanda_scraper_en.js"),
        f"Scrape Q&A (en) → pipeline/data/temp_qa_data_en.json",
        extra_args=en_args,
    )
    _copy_qa(
        src=os.path.join(PIPELINE_DATA, "temp_qa_data_en.json"),
        dst=os.path.join(DATA_OUT, "master_qa_en.json"),
        label="en",
    )

    # Step 5 — Download card images
    run_node(
        os.path.join(COLLECT, "download_images.js"),
        f"Download card images → opc-uploader-images/images/{zh_id or 'all'}",
        extra_args=img_args,
    )

    # Step 6 — Upload images to Cloudinary
    run_node(
        os.path.join(TRANSFORM, "images_to_cloudinary.js"),
        f"Upload images to Cloudinary (opc-images/{zh_id or 'all'})",
        extra_args=img_args,
    )

    # Step 7 — Rebuild card type indexes (picks up any new types in the new set)
    run_node(
        os.path.join(TRANSFORM, "card_sort_type.js"),
        "Rebuild ZH type index → src/data/sorted_types.json",
    )
    run_node(
        os.path.join(TRANSFORM, "card_sort_type_en.js"),
        "Rebuild EN type index → src/data/sorted_types_en.json",
    )

    # Step 8 — Refresh prices & decks
    pipeline_update()

    print("\n✅  New-set pipeline complete.")


def _copy_qa(src, dst, label):
    import json
    if not os.path.exists(src):
        print(f"⚠️   Q&A output not found at {src} — skipping copy.")
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(src, encoding="utf-8") as f:
        new_entries = json.load(f)
    if os.path.exists(dst):
        with open(dst, encoding="utf-8") as f:
            existing = json.load(f)
        existing_ids = {e["qaNum"] for e in existing}
        added = [e for e in new_entries if e["qaNum"] not in existing_ids]
        merged = existing + added
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        print(f"📋  Merged Q&A ({label}): +{len(added)} new entries → {dst} (total {len(merged)})")
    else:
        shutil.copy2(src, dst)
        print(f"📋  Copied Q&A ({label}): {src} → {dst}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

WORKFLOWS = {
    "update":   pipeline_update,
    "prices":   pipeline_prices,
    "decks":    pipeline_decks,
    "new-set":  pipeline_new_set,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in WORKFLOWS:
        print(__doc__)
        print(f"Available workflows: {', '.join(WORKFLOWS)}")
        sys.exit(1)

    if sys.argv[1] == "new-set":
        pipeline_new_set(sys.argv[2] if len(sys.argv) > 2 else None)
    else:
        WORKFLOWS[sys.argv[1]]()
