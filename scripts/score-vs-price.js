// Compares scoreCard() (static per-card evaluator) against market prices for a set.
// Intended to gauge scoring accuracy: high-value cards should correlate with high prices.
//
// Usage:
//   node --loader ./scripts/esm-loader.js scripts/score-vs-price.js [SET]
//   node --loader ./scripts/esm-loader.js scripts/score-vs-price.js OP16

import { scoreCard } from '../src/utils/cardRanker.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SET = process.argv[2] ?? 'OP16';
const PACK_ZH_ID = '554116'; // OP16 ZH pack id; extend map if needed
const PACK_ID_MAP = { OP16: '554116', OP15: '554115', OP14: '554114', OP13: '554113', OP12: '554112' };
const packId = PACK_ID_MAP[SET] ?? PACK_ZH_ID;

// ─── Load card data ───────────────────────────────────────────────────────────

const cardDataPath = `/Users/rexchan/opc-uploader/data/ZH/cards_${packId}.json`;
let allCards;
try {
  allCards = JSON.parse(readFileSync(cardDataPath, 'utf-8'));
} catch {
  console.error(`Cannot load card data: ${cardDataPath}`);
  process.exit(1);
}

// ─── Load prices ──────────────────────────────────────────────────────────────

const priceRaw = JSON.parse(
  readFileSync(join(ROOT, 'pipeline/data/price_raw.json'), 'utf-8')
);

function getBasePrice(cardId) {
  const entries = priceRaw[cardId];
  if (!entries) return null;
  const base = entries.find(e => e.rank === 0);
  return base?.price ?? null;
}

// ─── Score + merge ────────────────────────────────────────────────────────────

const EXCLUDED_CATEGORIES = new Set(['Leader', '領航']);

const rows = [];
for (const card of allCards) {
  if (EXCLUDED_CATEGORIES.has(card.category)) continue;

  // Normalise card shape to what scoreCard expects
  const normalized = {
    id: card.id,
    name: card.name,
    category: card.category,
    cost: card.cost ?? 0,
    power: card.power ?? null,
    counter: card.counter ?? null,
    effect: card.effect ?? '',
    rarity: card.rarity ?? '',
    colors: card.colors ?? [],
  };

  const { score, tier, breakdown } = scoreCard(normalized);
  const price = getBasePrice(card.id);

  rows.push({
    id: card.id,
    name: card.name,
    rarity: card.rarity,
    cost: card.cost,
    category: card.category,
    score,
    tier,
    breakdown,
    price,
  });
}

// ─── Correlation ──────────────────────────────────────────────────────────────

function spearman(data) {
  const n = data.length;
  const rankOf = (arr) => {
    const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    sorted.forEach(({ i }, r) => (ranks[i] = r + 1));
    return ranks;
  };
  const priceValues = data.map(r => r.price ?? 0);
  const scoreValues = data.map(r => r.score);
  const rp = rankOf(priceValues);
  const rs = rankOf(scoreValues);
  const dSq = rp.reduce((s, r, i) => s + (r - rs[i]) ** 2, 0);
  return 1 - (6 * dSq) / (n * (n * n - 1));
}

const withPrice = rows.filter(r => r.price != null);
const rho = withPrice.length >= 2 ? spearman(withPrice) : null;

// ─── Output ───────────────────────────────────────────────────────────────────

const sorted = [...rows].sort((a, b) => (b.price ?? -1) - (a.price ?? -1));

const PAD_ID   = 12;
const PAD_NAME = 28;
const PAD_CAT  = 12;
const PAD_TIER =  5;
const PAD_SCORE = 7;
const PAD_PRICE = 10;

function pad(s, n) { return String(s ?? '—').padEnd(n); }
function padL(s, n) { return String(s ?? '—').padStart(n); }

const header = [
  pad('ID', PAD_ID),
  pad('Name', PAD_NAME),
  pad('Rarity', 8),
  padL('Cost', 5),
  pad('Category', PAD_CAT),
  padL('Score', PAD_SCORE),
  pad('Tier', PAD_TIER),
  padL('Price¥', PAD_PRICE),
  'Breakdown',
].join('  ');

console.log(`\n=== ${SET} · Score vs Price (sorted by price desc) ===\n`);
console.log(header);
console.log('─'.repeat(header.length));

for (const r of sorted) {
  const { power, counter, effect } = r.breakdown;
  const bk = `pow=${power.toFixed(1)} ctr=${counter.toFixed(1)} eff=${effect.toFixed(1)}`;
  console.log([
    pad(r.id, PAD_ID),
    pad(r.name.slice(0, PAD_NAME - 1), PAD_NAME),
    pad(r.rarity, 8),
    padL(r.cost, 5),
    pad(r.category, PAD_CAT),
    padL(r.score.toFixed(1), PAD_SCORE),
    pad(r.tier, PAD_TIER),
    padL(r.price != null ? `¥${r.price}` : '—', PAD_PRICE),
    bk,
  ].join('  '));
}

console.log('─'.repeat(header.length));
console.log(`\nCards scored: ${rows.length}  |  Cards with price data: ${withPrice.length}`);

if (rho !== null) {
  console.log(`Spearman rank correlation (score vs price): ρ = ${rho.toFixed(3)}`);
  const quality = Math.abs(rho) >= 0.6 ? 'strong' : Math.abs(rho) >= 0.4 ? 'moderate' : 'weak';
  console.log(`Correlation strength: ${quality}`);
}

// ─── Outlier detection ────────────────────────────────────────────────────────

if (withPrice.length >= 4) {
  console.log('\n--- Top price / low score outliers (overpriced by market?) ---');
  const medianScore = [...withPrice].sort((a, b) => a.score - b.score)[Math.floor(withPrice.length / 2)].score;
  const overpriced = withPrice
    .filter(r => r.price >= 500 && r.score < medianScore)
    .sort((a, b) => b.price - a.price)
    .slice(0, 10);
  for (const r of overpriced)
    console.log(`  ${r.id.padEnd(12)} score=${r.score.toFixed(1).padStart(5)}  price=¥${r.price}  (${r.name})`);

  console.log('\n--- High score / low price outliers (undervalued by scorer?) ---');
  const medianPrice = [...withPrice].sort((a, b) => a.price - b.price)[Math.floor(withPrice.length / 2)].price;
  const underscored = withPrice
    .filter(r => r.score >= medianScore && r.price < medianPrice)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  for (const r of underscored)
    console.log(`  ${r.id.padEnd(12)} score=${r.score.toFixed(1).padStart(5)}  price=¥${r.price}  (${r.name})`);
}
