// find-unknown-effects.mjs
// Identify cards in a set whose effect text fails to parse — i.e. scoreCard()
// (src/utils/cardRanker.js) emits an "UNKNOWN" action keyword for a card that
// actually has effect text. These are the genuine parser gaps worth debugging.
//
// Cards with no effect (empty or "-") also yield UNKNOWN but are expected noise,
// so they are excluded — matching audit-effects.js's no-effect check.
//
// Usage (run from my-card-db root):
//   node --loader ./scripts/esm-loader.js scripts/find-unknown-effects.mjs OP15
//   node --loader ./scripts/esm-loader.js scripts/find-unknown-effects.mjs OP15 --json
//
// --json  emits a machine-readable list of flagged card IDs (for /debug-unknowns).

import { scoreCard } from '../src/utils/cardRanker.js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DATA_DIRS = [
  '/Users/rexchan/opc-uploader/data',
  '/Users/rexchan/opc-uploader/data/ZH',
];

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const setArg = args.find(a => !a.startsWith('--'));

if (!setArg) {
  console.error('Usage: node --loader ./scripts/esm-loader.js scripts/find-unknown-effects.mjs <SET> [--json]');
  process.exit(1);
}
const prefix = setArg.toUpperCase();

// ── Load all CN cards, dedupe by id ─────────────────────────────────────────────
const byId = new Map();
for (const dir of DATA_DIRS) {
  let files;
  try { files = readdirSync(dir).filter(f => f.startsWith('cards_') && f.endsWith('.json')); }
  catch { continue; }
  for (const file of files) {
    for (const c of JSON.parse(readFileSync(join(dir, file), 'utf8'))) {
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
  }
}

// ── Filter to set, exclude leaders, parallel/reprint variants, no-effect cards ──
const hasEffect = (c) => c.effect && c.effect.trim() && c.effect.trim() !== '-';

const flagged = [];
for (const card of byId.values()) {
  if (!card.id.toUpperCase().startsWith(prefix)) continue;
  if (card.category === 'Leader' || card.category === '領航') continue;
  if (/_(p\d+|r\d*)$/.test(card.id)) continue;       // variants share base effect
  if (!hasEffect(card)) continue;                 // no-effect UNKNOWN is expected noise

  const { breakdown } = scoreCard({
    id: card.id, name: card.name, category: card.category,
    cost: card.cost ?? 0, power: card.power ?? null,
    counter: card.counter ?? null, effect: card.effect ?? '',
  });
  if (breakdown.matchedKeywords.includes('UNKNOWN')) {
    flagged.push({ id: card.id, name: card.name, effect: card.effect.replace(/\n/g, ' ') });
  }
}

flagged.sort((a, b) => a.id.localeCompare(b.id));

// ── Output ──────────────────────────────────────────────────────────────────────
if (jsonOut) {
  console.log(JSON.stringify(flagged.map(f => f.id)));
  process.exit(0);
}

if (!flagged.length) {
  console.log(`\n${prefix}: no cards with unparseable effects (UNKNOWN). All effect text parses cleanly.\n`);
  process.exit(0);
}

console.log(`\n=== ${prefix}: ${flagged.length} card(s) with effect text that fails to parse (UNKNOWN) ===\n`);
for (const f of flagged) {
  console.log(`${f.id}  ${f.name}`);
  console.log(`  ${f.effect}\n`);
}
console.log(`IDs: ${flagged.map(f => f.id).join(' ')}\n`);
