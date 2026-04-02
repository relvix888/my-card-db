import subprocess
import sys
import os

def run_step(command, description):
    """Helper to run a shell command and check for success."""
    print(f"\n--- 🚀 Step: {description} ---")
    try:
        # Use the same python executable that is running this script (the .venv)
        result = subprocess.run([sys.executable] + command, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Error during {description}: {e}")
        return False

def main():
    print("📈 Starting One Piece Card Price Pipeline")

    # Step 1: Run the Scraper
    # This generates data_pipeline/raw_prices.json
    scraper_path = os.path.join("data_pipeline", "scraper.py")
    if not run_step([scraper_path], "Scraping Yuyu-tei"):
        sys.exit(1)

    # Step 2: Run the Transformer
    # This reads raw_prices.json and generates card_prices.json
    transformer_path = os.path.join("data_pipeline", "transformer.py")
    if not run_step([transformer_path], "Transforming IDs and Currency"):
        sys.exit(1)

    print("\n" + "="*40)
    print("✅ PIPELINE COMPLETE: Your React app is ready!")
    print("="*40)

if __name__ == "__main__":
    main()