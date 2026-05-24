"""
One Piece TCG pipeline runner.

Usage:
  python run_pipeline.py update      — prices + meta decks (no new set)
  python run_pipeline.py prices      — scrape prices & transform only
  python run_pipeline.py decks       — scrape meta decks (topdecks + gumgum.gg) & build
  python run_pipeline.py new-set     — full new-set workflow:
                                         scrape ZH/EN cards → upload to Firestore
                                         → Q&A → download images → upload to Cloudinary
                                         → update prices & decks
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


def run_node(script_path, description, *, cwd=None, abort_on_fail=True):
    print(f"\n{'='*55}")
    print(f"  🟩  {description}")
    print(f"{'='*55}")
    node = shutil.which("node")
    if not node:
        print("❌  'node' not found in PATH.")
        if abort_on_fail:
            sys.exit(1)
        return False
    result = subprocess.run([node, script_path], cwd=cwd or os.path.dirname(script_path))
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

def pipeline_new_set():
    print("\n🆕  NEW SET PIPELINE")
    print(
        "\n  ⚠️   Manual step required before continuing:\n"
        "    • Open src/App.js and add the new pack to packData (line ~47)\n"
        "      and packOrder (line ~482) with its pack ID, name, and series.\n"
    )
    input("  Press Enter once packData / packOrder are updated, or Ctrl-C to abort...\n")

    # Step 1 — Scrape card data from official site
    run_node(
        os.path.join(OPC_UPLOADER, "scrape-cards-zh.js"),
        "Scrape ZH cards → opc-uploader/data/ZH/",
        cwd=OPC_UPLOADER,
    )
    run_node(
        os.path.join(OPC_UPLOADER, "scrape-cards.js"),
        "Scrape EN cards → opc-uploader/data/EN/",
        cwd=OPC_UPLOADER,
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
        "Scrape Q&A (zh) → pipeline/data/temp_qa_data.json",
    )
    _copy_qa(
        src=os.path.join(PIPELINE_DATA, "temp_qa_data.json"),
        dst=os.path.join(DATA_OUT, "master_qa.json"),
        label="zh",
    )

    # Step 4 — Q&A (English)
    run_node(
        os.path.join(COLLECT, "qanda_scraper_en.js"),
        "Scrape Q&A (en) → pipeline/data/temp_qa_data_en.json",
    )
    _copy_qa(
        src=os.path.join(PIPELINE_DATA, "temp_qa_data_en.json"),
        dst=os.path.join(DATA_OUT, "master_qa_en.json"),
        label="en",
    )

    # Step 5 — Download card images
    run_node(
        os.path.join(COLLECT, "download_images.js"),
        "Download card images → opc-uploader-images/images/",
    )

    # Step 6 — Upload images to Cloudinary
    run_node(
        os.path.join(TRANSFORM, "images_to_cloudinary.js"),
        "Upload images to Cloudinary (opc-images/)",
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
    if not os.path.exists(src):
        print(f"⚠️   Q&A output not found at {src} — skipping copy.")
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
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

    WORKFLOWS[sys.argv[1]]()
