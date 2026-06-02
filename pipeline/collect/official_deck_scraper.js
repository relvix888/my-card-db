// Scrapes recommended decks from https://www.onepiece-cardgame.com/feature/deck/
// Output: src/data/official_decks.json
// Usage: node pipeline/collect/official_deck_scraper.js

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const BASE = "https://www.onepiece-cardgame.com/feature/deck/";
const OUT = path.resolve(__dirname, "../../src/data/official_decks.json");

const CARD_IMG_RE = /\/images\/cardlist\/card\/([A-Za-z0-9-]+)\.png/i;

async function getDeckList(page) {
  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });

  return await page.evaluate(() => {
    const decks = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const m = a.href.match(/deck_(\d+)\.php/);
      if (!m) return;

      const id = parseInt(m[1], 10);
      if (decks.some((d) => d.id === id)) return;

      // Name: prefer the thumbnail img[alt] which always has the deck name,
      // then fall back to the first h2/h3/h4 text inside the anchor.
      let name = "";
      const thumbImg = a.querySelector('img[src*="/feature/deck/"]');
      if (thumbImg && thumbImg.alt) {
        name = thumbImg.alt.trim();
      } else {
        const heading = a.querySelector("h4, h3, h2");
        name = heading ? heading.textContent.trim() : "";
      }

      // Date: look for YYYY.MM.DD pattern in anchor text content
      const dateMatch = a.textContent.match(/(\d{4}\.\d{2}\.\d{2})/);
      const date = dateMatch ? dateMatch[1] : "";

      decks.push({ id, name: name.slice(0, 50), date, url: a.href });
    });

    return decks.sort((a, b) => b.id - a.id);
  });
}

async function scrapeDeck(page, deckEntry) {
  const { id, name, date, url } = deckEntry;

  try {
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
  } catch (e) {
    console.warn(`  Timeout for deck ${id}, retrying with domcontentloaded`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  }

  const cards = await page.evaluate((cardImgRe) => {
    const re = new RegExp(cardImgRe, "i");
    const imgs = Array.from(
      document.querySelectorAll('img[src*="/cardlist/card/"]')
    );

    // Collect all card occurrences, then deduplicate by keeping max qty.
    // Cards appear multiple times on the page (deck list + strategy guide sections).
    // Deck list entries have explicit "N枚" markers (qty 2 or 4); strategy guide
    // images default to qty=1. Taking max qty collapses duplicates correctly.
    const maxByCard = new Map();

    for (const img of imgs) {
      const m = img.src.match(re);
      if (!m) continue;
      const rawId = m[1].toUpperCase();
      if (rawId.includes("_")) continue; // skip parallel art

      // Walk up the DOM to find the tightest container with exactly this card image
      let qty = 1;
      let el = img.parentElement;
      for (let depth = 0; depth < 6 && el && el !== document.body; depth++) {
        const innerImgs = el.querySelectorAll('img[src*="/cardlist/card/"]');
        if (innerImgs.length === 1) {
          const qm = (el.textContent || "").match(/(\d+)\s*枚/);
          if (qm) qty = parseInt(qm[1], 10);
          break;
        }
        el = el.parentElement;
      }

      const prev = maxByCard.get(rawId) || 0;
      if (qty > prev) maxByCard.set(rawId, qty);
    }

    return Array.from(maxByCard.entries()).map(([id, qty]) => ({ id, qty }));
  }, CARD_IMG_RE.source);

  if (!cards.length) {
    console.warn(`  No cards found for deck ${id} (${name})`);
    return null;
  }

  // Detect leader: first card with qty=1, or any card that looks like a leader
  // Leader cards have the same set prefix and low numbers, but qty=1 is the best signal
  const leaderIdx = cards.findIndex((c) => c.qty === 1);
  const leader = leaderIdx >= 0 ? cards[leaderIdx] : cards[0];

  // Build deck code string: "1xOP16-001,4xOP13-007,..."
  const deck = cards
    .map((c) => `${c.qty}x${c.id}`)
    .join(",");

  return {
    id,
    name,
    date,
    leader: leader.id,
    deck,
  };
}

(async () => {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  console.log("Fetching deck listing...");
  const deckList = await getDeckList(page);
  console.log(`Found ${deckList.length} decks`);

  const results = [];

  for (const entry of deckList) {
    process.stdout.write(`  Scraping deck ${entry.id} (${entry.name})... `);
    const deck = await scrapeDeck(page, entry);
    if (deck) {
      results.push(deck);
      console.log(`OK (leader: ${deck.leader}, ${deck.deck.split(",").length} cards)`);
    } else {
      console.log("SKIPPED");
    }
    // Polite delay
    await new Promise((r) => setTimeout(r, 500));
  }

  await browser.close();

  // Sort newest first
  results.sort((a, b) => b.id - a.id);

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nSaved ${results.length} decks → ${OUT}`);
})();
