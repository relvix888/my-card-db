// audit-effects.js
// Bulk audit of card effect parsing and handler coverage.
//
// Usage (run from my-card-db root):
//   node --input-type=module scripts/audit-effects.js              # all cards — UNKNOWN pattern table
//   node --input-type=module scripts/audit-effects.js OP14-084     # single card report
//   node --input-type=module scripts/audit-effects.js --missing    # cards with missing handlers
//   node --input-type=module scripts/audit-effects.js --deck EB02-010  # full deck audit by leader ID

import { parseEffect } from '../src/components/practice/engine/effectParser.js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ── Handler registries (keep in sync with effectActions.js / EffectModal.jsx) ──

// Action types with a case in executeAction()
const KNOWN_HANDLERS = new Set([
  'ADD_DON_FROM_DECK', 'ADD_TO_HAND', 'ADD_TO_LIFE', 'ATTACH_DON', 'BLOCK_DEPLOY', 'BOTTOM_DECK', 'CONFIRM_OPTIONAL_ACTIVATION',
  'COPY_POWER_FROM_TARGET', 'COST_MOD', 'DEAL_DAMAGE', 'DECK_TO_LIFE', 'DECK_TO_TRASH', 'DEPLOY', 'DISCARD', 'DISCARD_FREE',
  'DISCARD_EQUAL_TO_DRAW', 'DRAW', 'FIRE_MAIN_EFFECT', 'FLIP_LIFE_FACE_UP', 'FREE_EVENT', 'GRANT_KEYWORD',
  'FIELD_TO_LIFE', 'HAND_TO_DECK', 'HAND_TO_LIFE', 'KO', 'LIFE_TO_HAND', 'LIFE_TO_TRASH', 'TRASH_TO_LIFE_OR_FIELD',
  'OPPONENT_DON_REST_DEFERRED', 'POWER_MOD', 'POWER_MOD_BY_LIFE_COST', 'POWER_MOD_PER_DON_RESTED', 'POWER_PER_DISCARD', 'PREVENT_REST',
  'ATTACK_LOCK', 'CHOOSE_ONE', 'KO_OR_DISCARD_HAND', 'LOCK_DON_UNREST_BY_CHAR',
  'REDIRECT_ATTACK_TARGET', 'REFRESH_LOCK', 'REGISTER_ON_EVENT_TRIGGER',
  'REMAINDER_TO_TRASH', 'REST', 'RETURN_HAND', 'REVEAL_HAND_CARDS', 'REVEAL_LIFE', 'REVEAL_TOP_DECK', 'SEARCH', 'SELF_DEPLOY', 'SELF_DEPLOY_FROM_TRASH', 'SELF_TO_TRASH', 'UNREST', 'UNREST_DON', 'UNREST_DON_END_OF_TURN',
  'BLOCK_EFFECT', 'BLOCK_LIFE_TO_HAND', 'CONDITIONAL_DEPLOY', 'DECLARE_COST', 'DEPLOY_RESTED_PASSIVE', 'DON_EQUALIZE_EOT', 'DON_RETURN_FROM_FIELD', 'DRAW_LOCK', 'EXTRA_TURN', 'FLIP_LIFE_FACE_DOWN', 'FORCE_ATTACK_TARGET', 'HAND_PLAY_LOCK', 'LOOK_ARRANGE_LIFE', 'NULL_EFFECT', 'OPPONENT_HAND_TO_DECK', 'SELECT_TARGET', 'SHUFFLE_DECK', 'WIN_GAME',
  'SET_BASE_POWER', // continuous eval via evaluateLeaderBasePowerOverride, not executeAction
  'HAND_COST_MOD',
  'ALTERNATE_NAMES', // static rule read from card.effect by getAlternateNames(); no runtime action needed
]);

// CHOOSE_* types with a case in resolveEffectChoice()
const KNOWN_CHOOSE_HANDLERS = new Set([
  'CHOOSE_ADD_TO_HAND_TARGET', 'CHOOSE_ADD_TO_LIFE', 'CHOOSE_BOTTOM_DECK_TARGET', 'CHOOSE_COST_TARGET',
  'CHOOSE_DEPLOY_FROM_HAND', 'CHOOSE_DEPLOY_FROM_HAND_OR_TRASH', 'CHOOSE_DEPLOY_FROM_TRASH', 'CHOOSE_DISCARD', 'CHOOSE_DISCARD_FREE',
  'CHOOSE_DON_ATTACH_TARGET', 'CHOOSE_DON_RETURN', 'CHOOSE_DON_UNREST',
  'CHOOSE_FIELD_FOR_LIFE', 'CHOOSE_FREE_EVENT', 'CHOOSE_GRANT_KEYWORD_TARGET', 'CHOOSE_HAND_TO_DECK',
  'CHOOSE_HAND_TO_LIFE', 'CHOOSE_KO_OR_DISCARD_HAND', 'CHOOSE_KO_TARGET', 'CHOOSE_LIFE_OPTIONAL', 'CHOOSE_LIFE_TO_HAND_POSITION', 'CHOOSE_POWER_TARGET',
  'CHOOSE_ATTACK_LOCK_TARGET', 'CHOOSE_PREVENT_REST_TARGET', 'CHOOSE_REDIRECT_ATTACK_TARGET', 'CHOOSE_REFRESH_LOCK_TARGET', 'CHOOSE_REST_TARGET',
  'CHOOSE_RETURN_HAND_TARGET', 'CHOOSE_REVEAL_CARDS', 'CHOOSE_TRASH_CARD_DEST', 'CHOOSE_TRASH_FOR_LIFE_OR_FIELD', 'CHOOSE_UNREST_TARGET',
  'CHOOSE_ONE_OPTION', 'SEARCH_ORDER', 'SEARCH_PICK',
]);

// CHOOSE_* types with a case in EffectModal.jsx
const KNOWN_MODAL_CASES = new Set([
  'CHOOSE_ADD_TO_HAND_TARGET', 'CHOOSE_ADD_TO_LIFE', 'CHOOSE_BOTTOM_DECK_TARGET', 'CHOOSE_COST_TARGET',
  'CHOOSE_DEPLOY_FROM_HAND', 'CHOOSE_DEPLOY_FROM_HAND_OR_TRASH', 'CHOOSE_DEPLOY_FROM_TRASH', 'CHOOSE_DISCARD', 'CHOOSE_DISCARD_FREE',
  'CHOOSE_DON_ATTACH_TARGET', 'CHOOSE_DON_RETURN', 'CHOOSE_DON_UNREST',
  'CHOOSE_FREE_EVENT', 'CHOOSE_HAND_TO_DECK', 'CHOOSE_HAND_TO_LIFE',
  'CHOOSE_ATTACK_LOCK_TARGET', 'CHOOSE_FIELD_FOR_LIFE', 'CHOOSE_KO_OR_DISCARD_HAND', 'CHOOSE_KO_TARGET', 'CHOOSE_LIFE_OPTIONAL', 'CHOOSE_LIFE_TO_HAND_POSITION', 'CHOOSE_POWER_TARGET', 'CHOOSE_PREVENT_REST_TARGET', 'CHOOSE_REFRESH_LOCK_TARGET',
  'CHOOSE_REDIRECT_ATTACK_TARGET', 'CHOOSE_REST_TARGET', 'CHOOSE_RETURN_HAND_TARGET', 'CHOOSE_REVEAL_CARDS', 'CHOOSE_TRASH_CARD_DEST', 'CHOOSE_TRASH_FOR_LIFE_OR_FIELD', 'CHOOSE_UNREST_TARGET',
  'CHOOSE_ONE_OPTION', 'CONFIRM_OPTIONAL_ACTIVATION', 'SEARCH_ORDER', 'SEARCH_PICK',
]);

const DATA_DIR = '/Users/rexchan/opc-uploader/data';

// ── Data loading ──────────────────────────────────────────────────────────────

function loadAllCards() {
  const files = readdirSync(DATA_DIR)
    .filter(f => f.startsWith('cards_') && f.endsWith('.json'))
    .sort();
  const cards = [];
  for (const file of files) {
    cards.push(...JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')));
  }
  return cards;
}

// ── Audit logic ───────────────────────────────────────────────────────────────

function auditCard(card) {
  if (!card.effect || card.effect.trim() === '-') return { clauses: null, issues: [] };
  let clauses;
  try {
    clauses = parseEffect(card.effect);
  } catch (e) {
    return { clauses: null, issues: [{ kind: 'PARSE_ERROR', msg: e.message }] };
  }

  const issues = [];
  for (const clause of clauses) {
    for (const action of clause.actions) {
      if (action.type === 'UNKNOWN') {
        issues.push({ kind: 'UNKNOWN', raw: action.raw, clause });
      } else if (!KNOWN_HANDLERS.has(action.type)) {
        issues.push({ kind: 'MISSING_HANDLER', actionType: action.type, clause });
      }
    }
  }
  return { clauses, issues };
}

// Normalize UNKNOWN raw text for pattern grouping
function normalizeRaw(raw) {
  return raw
    .replace(/「[^」]+」/g, '「X」')   // card names → placeholder
    .replace(/《[^》]+》/g, '《X》')
    .replace(/『[^』]+』/g, '『X』')
    .replace(/\d+/g, 'N')              // numbers → N
    .slice(0, 48);
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatFilter(f) {
  if (!f || !Object.keys(f).length) return '';
  const p = [];
  if (f.owner) p.push(f.owner);
  if (f.zone) p.push(f.zone);
  if (f.category) p.push(f.category);
  if (f.traitContains) p.push(`trait⊃${f.traitContains}`);
  if (f.trait) p.push(`trait=${f.trait}`);
  if (f.costMin !== undefined || f.costMax !== undefined) p.push(`cost${f.costMin ?? '?'}–${f.costMax ?? '?'}`);
  else if (f.cost !== undefined) p.push(`cost${f.costOp === 'gte' ? '≥' : '≤'}${f.cost}`);
  if (f.power !== undefined) p.push(`pow${f.powerOp === 'gte' ? '≥' : '≤'}${f.power}`);
  if (f.name) p.push(`name=${f.name}`);
  if (f.self) p.push('self');
  if (f.cardType) p.push(f.cardType);
  if (f.includesLeader) p.push('+leader');
  if (f.state) p.push(f.state);
  return p.length ? `{${p.join(', ')}}` : '';
}

function formatAction(action) {
  const params = [];
  if (action.count !== undefined) params.push(`count=${action.count}`);
  if (action.delta !== undefined) params.push(`delta=${action.delta > 0 ? '+' : ''}${action.delta}`);
  if (action.until) params.push(`until=${action.until}`);
  if (action.filter) { const f = formatFilter(action.filter); if (f) params.push(`filter=${f}`); }
  if (action.costDescription) params.push(`cost="${action.costDescription}"`);
  if (action.keyword) params.push(`kw=${action.keyword}`);
  return params.length ? `  ${params.join('  ')}` : '';
}

// ── Single-card report ────────────────────────────────────────────────────────

function singleCardReport(card) {
  const { clauses, issues } = auditCard(card);

  console.log(`\n${card.id}  ${card.name}  [${card.category} / cost ${card.cost ?? '—'}]`);
  if (card.trigger) console.log(`  trigger: ${card.trigger}`);

  if (!clauses) {
    if (issues[0]?.kind === 'PARSE_ERROR') console.log(`  PARSE ERROR: ${issues[0].msg}`);
    else console.log('  (no effect)');
    return;
  }

  console.log();
  for (let ci = 0; ci < clauses.length; ci++) {
    const cl = clauses[ci];
    const meta = [
      cl.timings.join('/') || '(no timing)',
      cl.isOptional ? 'optional' : null,
      cl.oncePerTurn ? 'once/turn' : null,
      cl.donGate ? `donGate=${cl.donGate}` : null,
    ].filter(Boolean).join('  ');
    console.log(`Clause ${ci + 1}  ${meta}`);
    if (cl.condition) console.log(`  condition: ${cl.condition.raw}`);

    for (const action of cl.actions) {
      if (action.type === 'UNKNOWN') {
        console.log(`  UNKNOWN  raw: "${action.raw.slice(0, 80)}"`);
        console.log(`           → parser ✗  handler n/a  modal n/a`);
        continue;
      }
      const hasHandler = KNOWN_HANDLERS.has(action.type);
      console.log(`  ${action.type}${formatAction(action)}  ${hasHandler ? '✓ handler' : '✗ NO HANDLER'}`);
    }
    console.log();
  }

  if (issues.length === 0) {
    console.log('✓ No parser/handler issues found.');
    console.log('  Timing wiring and phase-transition flags require manual check — see debug-card.md Steps 4–5.');
  } else {
    console.log(`✗ ${issues.length} issue(s) found (see above).`);
  }
}

// ── All-cards reports ─────────────────────────────────────────────────────────

function allCardsReport() {
  const cards = loadAllCards();

  // Collect stats
  const unknownsByPattern = new Map(); // normalized → { count, examples }
  const missingByType = new Map();     // actionType → [{ id, name }]
  let totalWithEffect = 0, issueCards = 0, totalUnknowns = 0;

  for (const card of cards) {
    if (!card.effect || card.effect.trim() === '-') continue;
    totalWithEffect++;
    const { issues } = auditCard(card);
    if (issues.length) issueCards++;

    for (const issue of issues) {
      if (issue.kind === 'UNKNOWN') {
        totalUnknowns++;
        const key = normalizeRaw(issue.raw);
        if (!unknownsByPattern.has(key)) unknownsByPattern.set(key, { count: 0, examples: [] });
        const entry = unknownsByPattern.get(key);
        entry.count++;
        if (entry.examples.length < 3) entry.examples.push({ id: card.id, raw: issue.raw });
      } else if (issue.kind === 'MISSING_HANDLER') {
        if (!missingByType.has(issue.actionType)) missingByType.set(issue.actionType, []);
        missingByType.get(issue.actionType).push({ id: card.id, name: card.name });
      }
    }
  }

  const sorted = [...unknownsByPattern.entries()].sort((a, b) => b[1].count - a[1].count);

  console.log(`\nTotal UNKNOWN: ${totalUnknowns}  (${issueCards} / ${totalWithEffect} cards with effects affected)\n`);

  if (missingByType.size) {
    console.log(`Parsed-but-unhandled action types:`);
    for (const [type, list] of [...missingByType.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${type}  (${list.length} cards)`);
    }
    console.log();
  }

  console.log(`UNKNOWN pattern ranking:`);
  console.log(`${'Rank'.padStart(4)}  ${'Count'.padStart(5)}  Normalized pattern text`);
  console.log(`─`.repeat(72));

  let rank = 1;
  for (const [pattern, { count, examples }] of sorted) {
    if (count === 0) continue;
    console.log(`${String(rank).padStart(4)}  ${String(count).padStart(5)}  ${pattern}`);
    if (rank <= 15) {
      for (const ex of examples.slice(0, 2)) {
        console.log(`            ↳ ${ex.id}  "${ex.raw.slice(0, 58)}"`);
      }
    }
    rank++;
  }
}

function missingHandlersReport() {
  const cards = loadAllCards();
  const missingByType = new Map();
  let total = 0;

  for (const card of cards) {
    if (!card.effect || card.effect.trim() === '-') continue;
    const { issues } = auditCard(card);
    for (const issue of issues) {
      if (issue.kind === 'MISSING_HANDLER') {
        if (!missingByType.has(issue.actionType)) missingByType.set(issue.actionType, []);
        missingByType.get(issue.actionType).push(`${card.id}  ${card.name}`);
        total++;
      }
    }
  }

  if (!missingByType.size) {
    console.log('\n✓ No parsed-but-unhandled action types found.');
    return;
  }

  console.log(`\nParsed-but-unhandled action types (${total} cases across ${missingByType.size} types):\n`);
  for (const [type, list] of [...missingByType.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${type}  (${list.length} card${list.length > 1 ? 's' : ''})`);
    list.slice(0, 6).forEach(c => console.log(`  ${c}`));
    if (list.length > 6) console.log(`  … and ${list.length - 6} more`);
    console.log();
  }
}

// ── Deck report ───────────────────────────────────────────────────────────────

function deckReport(leaderId) {
  const DECK_FILE = new URL('../src/data/deck_final.json', import.meta.url).pathname;
  const deckData = JSON.parse(readFileSync(DECK_FILE, 'utf8'));

  const entry = Object.entries(deckData).find(([id]) => id.toUpperCase() === leaderId);
  if (!entry) {
    console.error(`Deck not found: ${leaderId}`);
    console.error(`Known leaders: ${Object.keys(deckData).join(', ')}`);
    process.exit(1);
  }

  const [leaderKey, { deck: deckStr }] = entry;
  const cardIds = deckStr.split(',').map(pair => pair.split('x')[1]).filter(Boolean);
  const uniqueIds = [...new Set(cardIds)];

  const allCards = loadAllCards();
  const cardMap = new Map(allCards.map(c => [c.id.toUpperCase(), c]));

  const clean = [];
  const issues = [];

  for (const id of uniqueIds) {
    const card = cardMap.get(id.toUpperCase());
    if (!card) {
      issues.push({ id, name: '(not found in card data)', issueList: [{ kind: 'NOT_FOUND' }] });
      continue;
    }
    const { issues: cardIssues } = auditCard(card);
    if (cardIssues.length === 0) {
      clean.push(id);
    } else {
      issues.push({ id, name: card.name, issueList: cardIssues });
    }
  }

  console.log(`\nDeck: ${leaderKey}  (${uniqueIds.length} unique cards)\n`);

  if (clean.length) {
    console.log(`✓ Clean: ${clean.length} card${clean.length !== 1 ? 's' : ''}`);
    // print in rows of 7
    for (let i = 0; i < clean.length; i += 7) {
      console.log('  ' + clean.slice(i, i + 7).join('  '));
    }
    console.log();
  }

  if (issues.length === 0) {
    console.log('✓ No parser/handler issues found across this deck.');
    console.log('  Timing wiring and phase-transition flags require manual check — see debug-card.md Steps 4–5.');
    return;
  }

  console.log(`✗ Issues: ${issues.length} card${issues.length !== 1 ? 's' : ''}`);
  for (const { id, name, issueList } of issues) {
    console.log(`  ${id}  ${name}  [${issueList.length} issue${issueList.length !== 1 ? 's' : ''}]`);
    for (const issue of issueList) {
      if (issue.kind === 'NOT_FOUND') {
        console.log(`    (card not found in data files)`);
      } else if (issue.kind === 'PARSE_ERROR') {
        console.log(`    PARSE_ERROR: ${issue.msg}`);
      } else if (issue.kind === 'UNKNOWN') {
        console.log(`    UNKNOWN  raw: "${issue.raw.slice(0, 72)}"`);
      } else if (issue.kind === 'MISSING_HANDLER') {
        console.log(`    MISSING_HANDLER  ${issue.actionType}`);
      }
    }
  }
  console.log('\nRun /debug-card <ID> for full step-by-step analysis on any card above.');
}

// ── Entry point ───────────────────────────────────────────────────────────────

const arg = process.argv[2];

if (!arg) {
  allCardsReport();
} else if (arg === '--missing') {
  missingHandlersReport();
} else if (arg === '--deck') {
  const leaderId = process.argv[3];
  if (!leaderId) {
    console.error('Usage: node --input-type=module scripts/audit-effects.js --deck LEADER-ID');
    process.exit(1);
  }
  deckReport(leaderId.toUpperCase());
} else if (arg.startsWith('--')) {
  console.error(`Unknown flag: ${arg}`);
  console.error('Usage: node --input-type=module scripts/audit-effects.js [CARD-ID | --missing | --deck LEADER-ID]');
  process.exit(1);
} else {
  const cardId = arg.toUpperCase();
  const card = loadAllCards().find(c => c.id.toUpperCase() === cardId);
  if (!card) { console.error(`Card not found: ${arg}`); process.exit(1); }
  singleCardReport(card);
}
