// simulate-cards.js
// Headless per-card effect simulation. Deploys each card in a minimal game state and
// verifies that the effect resolver produces the expected state change.
//
// Usage (run from my-card-db root):
//   node --loader ./scripts/esm-loader.js scripts/simulate-cards.js --set OP16
//   node --loader ./scripts/esm-loader.js scripts/simulate-cards.js OP16-101

import {
  createInitialState, gameReducer,
} from '../src/components/practice/engine/gameState.js';
import {
  resolveOnPlayEffect, resolveOnAttackEffect, resolveOnOpponentAttackEffect, resolveOnBlockEffect,
  resolveActivatedMainEffect, resolveOnKOEffect, resolveLeaderKOWatchEffect,
  resolveOnDamageTakenEffect, resolveEndOfTurnEffects, resolveTriggerEffect,
  resolveEventEffect, resolveCounterEffect,
} from '../src/components/practice/engine/effects.js';
import { parseEffectForCard } from '../src/components/practice/engine/effectParser.js';
import { PHASE, PLAYER } from '../src/components/practice/engine/constants.js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = '/Users/rexchan/opc-uploader/data';
const ZH_DATA_DIR = '/Users/rexchan/opc-uploader/data/ZH';

// ─── Dummy fixtures ───────────────────────────────────────────────────────────

const DUMMY_LEADER = {
  id: 'OP01-001',
  name: 'Monkey D. Luffy',
  category: 'Leader',
  cost: 5,
  power: 5000,
  effect: '-',
  color: 'Red',
  type: [],
};

function dummyFiller(i) {
  return { id: `DUMMY-FILLER-${i}`, name: 'Filler', category: 'Character', cost: 1, power: 1000, effect: '-', color: 'Red', type: [] };
}

function dummyOpp(i) {
  return { id: `DUMMY-OPP-${i}`, name: 'Dummy Opp', category: 'Character', cost: 2, power: 2000, effect: '-', color: 'Black', type: [] };
}

function makeFieldCard(card, opts = {}) {
  return { card, state: 'active', attachedDon: 0, justDeployed: false, deployedThisTurn: false, _fcId: `test-fc-${Math.random()}`, ...opts };
}

// ─── Data loading ─────────────────────────────────────────────────────────────

function loadAllCards() {
  const cards = [];
  for (const dir of [DATA_DIR, ZH_DATA_DIR]) {
    let files;
    try { files = readdirSync(dir).filter(f => f.startsWith('cards_') && f.endsWith('.json')).sort(); }
    catch { continue; }
    for (const f of files) cards.push(...JSON.parse(readFileSync(join(dir, f), 'utf8')));
  }
  return cards;
}

// ─── Auto-resolver (mirrors simulate-deck.js) ─────────────────────────────────

function safeResolveEffectChoice(state, args) {
  try {
    return gameReducer(state, { type: 'RESOLVE_EFFECT_CHOICE', ...args });
  } catch {
    try { return gameReducer(state, { type: 'RESOLVE_EFFECT_CHOICE', selectedIndices: [], selectedZone: null }); }
    catch { return { ...state, pendingEffect: null }; }
  }
}

function autoResolvePendingEffect(state) {
  const pe = state.pendingEffect;
  if (!pe) return state;
  const { choices } = pe;
  if (!choices) return safeResolveEffectChoice(state, { selectedIndices: [], selectedZone: null });
  if (choices.type === 'CONFIRM_OPTIONAL_ACTIVATION') {
    return safeResolveEffectChoice(state, { selectedIndices: [0], selectedZone: null });
  }
  if (choices.type === 'CHOOSE_REDIRECT_ATTACK_TARGET') {
    const charIdx = choices.targets.findIndex(t => t.zone === 'character');
    return safeResolveEffectChoice(state, { selectedIndices: [charIdx >= 0 ? charIdx : 0], selectedZone: null });
  }
  const items = choices.items ?? choices.targets ?? choices.fieldTargets ?? [];
  const maxSelect = choices.maxSelect ?? choices.max ?? 1;
  const count = Math.min(maxSelect, items.length);
  return safeResolveEffectChoice(state, {
    selectedIndices: Array.from({ length: count }, (_, i) => i),
    selectedZone: choices.zone ?? null,
  });
}

function drainPendingEffects(state, maxIter = 12) {
  let s = state;
  let hadPending = false;
  let iter = maxIter;
  while (s.pendingEffect && iter-- > 0) {
    hadPending = true;
    const prev = s;
    s = autoResolvePendingEffect(s);
    if (s === prev) break;
  }
  return { state: s, hadPending, stuck: !!s.pendingEffect };
}

// ─── Base state builder ───────────────────────────────────────────────────────

function buildBaseState() {
  const humanDeck = Array.from({ length: 50 }, (_, i) => dummyFiller(i));
  const aiDeck    = Array.from({ length: 50 }, (_, i) => dummyFiller(i + 100));

  let s = createInitialState(DUMMY_LEADER, humanDeck, DUMMY_LEADER, aiDeck);
  // Force human first so the first MAIN phase is always human's turn
  s = { ...s, firstPlayer: PLAYER.HUMAN, activePlayer: PLAYER.HUMAN, waitingFor: PLAYER.HUMAN };
  s = gameReducer(s, { type: 'MULLIGAN_KEEP' });
  s = gameReducer(s, { type: 'REFRESH' });
  s = gameReducer(s, { type: 'DRAW' });
  s = gameReducer(s, { type: 'DON_PHASE' });
  // Drain any pending from phase transitions
  let safetyIter = 10;
  while (s.pendingEffect && safetyIter-- > 0) s = autoResolvePendingEffect(s);

  // Give plenty of DON (12 active)
  const extraDon = Array.from({ length: 12 }, (_, i) => ({ _donId: `test-don-${i}`, state: 'active' }));
  s = { ...s, human: { ...s.human, costArea: [...s.human.costArea, ...extraDon] } };

  // Pre-populate AI with 3 active dummy characters (targets for KO/REST effects)
  const oppChars = Array.from({ length: 3 }, (_, i) => makeFieldCard(dummyOpp(i)));
  s = { ...s, ai: { ...s.ai, characterArea: oppChars } };

  // Advance to turn 2 so attacks are allowed
  s = { ...s, turn: 2 };

  return s;
}

// ─── Timing simulators ────────────────────────────────────────────────────────

const SUPPORTED_TIMINGS = new Set([
  '登場時', '攻擊時', '啟動主要', '起動メイン', 'KO時', '受到傷害時', '我方回合結束時',
  '觸發器', '對方攻擊時', '防禦時', '反擊',
]);

function simulateTiming(card, baseState, timing, clause) {
  const owner = PLAYER.HUMAN;
  const donGate = clause.donGate ?? 0;
  let before = baseState;
  let after  = baseState;
  let exception = null;

  try {
    if (timing === '登場時') {
      if (card.category === 'Leader') {
        // Leader on-play: it's already the leader field card
        const s = { ...before, human: { ...before.human, leader: makeFieldCard(card) } };
        after = resolveOnPlayEffect(card, s, owner);
        before = s;
      } else if (card.category === 'Character') {
        // Add to hand then play via game action
        const handWithCard = [...before.human.hand, card];
        before = { ...before, human: { ...before.human, hand: handWithCard } };
        after = gameReducer(before, { type: 'PLAY_CHARACTER', handIndex: handWithCard.length - 1 });
      } else if (card.category === 'Event') {
        const handWithCard = [...before.human.hand, card];
        before = { ...before, human: { ...before.human, hand: handWithCard } };
        after = gameReducer(before, { type: 'PLAY_EVENT', handIndex: handWithCard.length - 1 });
      } else if (card.category === 'Stage') {
        const handWithCard = [...before.human.hand, card];
        before = { ...before, human: { ...before.human, hand: handWithCard } };
        after = gameReducer(before, { type: 'PLAY_STAGE', handIndex: handWithCard.length - 1 });
      }

    } else if (timing === '攻擊時') {
      if (card.category === 'Leader') {
        const leaderFc = makeFieldCard(card, { attachedDon: donGate });
        before = { ...before, human: { ...before.human, leader: leaderFc } };
        after = resolveOnAttackEffect(card, before, owner, 'leader', null);
      } else {
        const fc = makeFieldCard(card, { attachedDon: donGate });
        before = { ...before, human: { ...before.human, characterArea: [fc] } };
        after = resolveOnAttackEffect(card, before, owner, 'character', 0);
      }

    } else if (timing === '啟動主要' || timing === '起動メイン') {
      if (card.category === 'Leader') {
        const leaderFc = makeFieldCard(card, { attachedDon: donGate });
        before = { ...before, human: { ...before.human, leader: leaderFc } };
        after = resolveActivatedMainEffect(card, before, owner, 'leader', null);
      } else {
        const fc = makeFieldCard(card, { attachedDon: donGate });
        before = { ...before, human: { ...before.human, characterArea: [fc] } };
        after = resolveActivatedMainEffect(card, before, owner, 'character', 0);
      }

    } else if (timing === 'KO時') {
      if (card.category === 'Leader') {
        // Leader KO-watch: set up leader with donGate DON!! and pass a matching dummy KO'd card
        const leaderFc = makeFieldCard(card, { attachedDon: donGate });
        before = { ...before, human: { ...before.human, leader: leaderFc } };
        // Dummy KO'd card — use generic 6000+ power character to satisfy typical koFilters
        const koCard = { id: 'DUMMY-KO', name: 'Dummy KO', category: 'Character', cost: 3, power: 6000, effect: '-', color: 'Red', type: [] };
        after = resolveLeaderKOWatchEffect(koCard, before, owner, 'self');
      } else {
        // Character self-KO effect: simulate KO'd with the minimum DON!! required so donGate clauses can fire
        after = resolveOnKOEffect(card, before, owner, donGate);
      }

    } else if (timing === '受到傷害時') {
      // Damage-taken effects are always leader effects; set donGate DON!! on leader field card
      const leaderFc = makeFieldCard(card, { attachedDon: donGate });
      before = { ...before, human: { ...before.human, leader: leaderFc } };
      after = resolveOnDamageTakenEffect(card, before, owner);

    } else if (timing === '我方回合結束時') {
      if (card.category === 'Leader') {
        const leaderFc = makeFieldCard(card, { attachedDon: donGate });
        before = { ...before, human: { ...before.human, leader: leaderFc } };
      } else {
        const fc = makeFieldCard(card, { attachedDon: donGate });
        before = { ...before, human: { ...before.human, characterArea: [fc] } };
      }
      after = resolveEndOfTurnEffects(before, owner);

    } else if (timing === '觸發器') {
      after = resolveTriggerEffect(card, before, owner);

    } else if (timing === '對方攻擊時') {
      if (card.category === 'Leader') {
        // Leader: already in leader slot; just ensure donGate DON!! attached
        const leaderFc = makeFieldCard(card, { attachedDon: donGate });
        before = { ...before, human: { ...before.human, leader: leaderFc } };
        after = resolveOnOpponentAttackEffect(card, before, owner); // default {target:'leader'}
      } else {
        const fc = makeFieldCard(card, { attachedDon: donGate });
        before = { ...before, human: { ...before.human, characterArea: [fc] } };
        after = resolveOnOpponentAttackEffect(card, before, owner, { target: 0 });
      }

    } else if (timing === '防禦時') {
      const fc = makeFieldCard(card, { attachedDon: donGate });
      before = { ...before, human: { ...before.human, characterArea: [fc] } };
      after = resolveOnBlockEffect(card, before, owner, 0);

    } else if (timing === '反擊') {
      after = resolveCounterEffect(card, before, owner);

    } else {
      return { timing, skipped: true, reason: 'unsupported timing' };
    }
  } catch (e) {
    exception = e?.message ?? String(e);
    after = before;
  }

  const effectFired = after !== before;
  const drained = drainPendingEffects(after);

  return {
    timing, before, after: drained.state,
    effectFired, hadPending: drained.hadPending || effectFired,
    stuck: drained.stuck, exception,
  };
}

// ─── Assertions ───────────────────────────────────────────────────────────────

// Action types whose presence implies the state WILL change (absent a guard or condition).
// POWER_MOD excluded here: it may legitimately no-op when no matching targets exist
// or when until='battle' (counter effects require an active battle step).
// The per-action POWER_MOD assertion below handles it with target-presence context.
const UNCONDITIONAL_DELTA_TYPES = new Set([
  'DRAW', 'KO', 'REST', 'DISCARD', 'SEARCH', 'SELF_DEPLOY', 'RETURN_HAND',
  'ADD_TO_LIFE', 'ATTACH_DON', 'DEPLOY', 'UNREST', 'UNREST_DON', 'BOTTOM_DECK',
  'HAND_TO_DECK', 'LIFE_TO_HAND', 'DECK_TO_TRASH', 'FLIP_LIFE_FACE_UP', 'REVEAL_TOP_DECK',
]);

function assertResults(card, clause, result) {
  if (result.skipped) return [];
  const issues = [];

  if (result.exception) {
    issues.push({ type: 'EXCEPTION', msg: result.exception });
    return issues;
  }

  if (result.stuck) {
    const stuckType = result.before.pendingEffect?.choices?.type ?? 'unknown';
    issues.push({ type: 'INTERACTIVE_STUCK', msg: `pendingEffect ${stuckType} not cleared by auto-resolver — missing modal/resolver case` });
  }

  const { before, after, hadPending } = result;
  const hasCondition  = !!clause.condition || clause.isOptional;
  const hasOnceGuard  = clause.oncePerTurn;
  // Only assert state-delta for clauses that are unconditional and not guarded
  const shouldDelta   = !hasCondition && !hasOnceGuard &&
    clause.actions.some(a => UNCONDITIONAL_DELTA_TYPES.has(a.type));

  if (shouldDelta && !result.effectFired && !hadPending) {
    issues.push({
      type: 'NO_STATE_CHANGE',
      msg: `Effect did not fire for timing [${result.timing}] — timing may not be wired in gameState.js, or effect resolver returned same state`,
    });
    return issues; // delta checks below will all be meaningless
  }

  // Per-action-type delta assertions
  for (const action of clause.actions) {
    if (hasCondition) continue; // skip delta checks when condition might be unmet

    switch (action.type) {
      case 'DRAW': {
        const isOnPlay = result.timing === '登場時' && card.category !== 'Event';
        const deployOffset = isOnPlay ? -1 : 0; // card removed from hand when deployed
        const expectedCount = typeof action.count === 'number' ? action.count : 1;
        const deckSize = before.human.deck.length;
        const possibleDraw = Math.min(expectedCount, deckSize);
        if (possibleDraw > 0) {
          const delta = after.human.hand.length - before.human.hand.length - deployOffset;
          if (delta < possibleDraw) {
            issues.push({
              type: 'WRONG_COUNT',
              msg: `DRAW: expected +${expectedCount} to hand (deck had ${deckSize}), got +${Math.max(0, delta)}`,
            });
          }
        }
        break;
      }

      case 'KO': {
        const beforeTrash = before.ai.trash.length;
        const afterTrash  = after.ai.trash.length;
        const availTargets = before.ai.characterArea.length;
        if (availTargets > 0 && afterTrash <= beforeTrash && !hadPending) {
          issues.push({
            type: 'WRONG_COUNT',
            msg: `KO: ${availTargets} opponent chars available but trash unchanged (was ${beforeTrash}, now ${afterTrash})`,
          });
        }
        break;
      }

      case 'REST': {
        const beforeRested = before.ai.characterArea.filter(fc => fc.state === 'rest').length;
        const afterRested  = after.ai.characterArea.filter(fc => fc.state === 'rest').length;
        const availActive  = before.ai.characterArea.filter(fc => fc.state === 'active').length;
        if (availActive > 0 && afterRested <= beforeRested && !hadPending) {
          issues.push({
            type: 'WRONG_COUNT',
            msg: `REST: ${availActive} opponent active chars available but none were rested`,
          });
        }
        break;
      }

      case 'POWER_MOD': {
        // Battle-duration mods are intentionally ephemeral during battle steps; skip
        if (action.until === 'battle') break;
        // Determine whether the test state has any targets for this mod.
        // Own-character targets (owner:'self') may legitimately no-op when no matching
        // friendly characters exist in the base state — not a bug in that case.
        const targetsOpponent = action.filter?.owner === 'opponent';
        const availTargets = targetsOpponent
          ? before.ai.characterArea.length
          : before.human.characterArea.length;
        if (availTargets === 0) break; // no targets in test state; skip assertion
        const beforeMods = before.human.powerMods.length + before.ai.powerMods.length;
        const afterMods  = after.human.powerMods.length  + after.ai.powerMods.length;
        if (afterMods <= beforeMods && !hadPending) {
          issues.push({
            type: 'NO_STATE_CHANGE',
            msg: `POWER_MOD +${action.delta}: no power mod entry added (before=${beforeMods}, after=${afterMods})`,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  return issues;
}

// ─── Card simulation ──────────────────────────────────────────────────────────

function simulateCard(card, baseState) {
  if (!card.effect || card.effect.trim() === '-') return { cardId: card.id, issues: [], noEffect: true };

  let clauses;
  try {
    clauses = parseEffectForCard(card);
  } catch (e) {
    return { cardId: card.id, issues: [{ type: 'PARSE_ERROR', msg: e?.message ?? String(e) }] };
  }

  const issues = [];

  for (const clause of clauses) {
    // Build effective timing list
    let timings = [
      ...(clause.timings ?? []),
      ...(clause.activated ?? []),
    ];

    // Event main body (no timing declared) fires on play
    if (timings.length === 0 && card.category === 'Event' &&
        !clause.continuous?.length && !clause.passive?.length) {
      timings = ['登場時'];
    }

    for (const timing of timings) {
      if (!SUPPORTED_TIMINGS.has(timing)) continue;

      const result = simulateTiming(card, baseState, timing, clause);
      const clauseIssues = assertResults(card, clause, result);
      for (const issue of clauseIssues) {
        const raw = clause.raw?.replace(/<br>/g, ' ').trim();
        issues.push({
          ...issue,
          timing,
          clauseRaw: raw ? (raw.length > 70 ? raw.slice(0, 70) + '…' : raw) : undefined,
        });
      }
    }
  }

  return { cardId: card.id, issues };
}

// ─── Reporters ────────────────────────────────────────────────────────────────

function pad(str, len) { return String(str).padEnd(len); }

function setReport(setId, allCards) {
  const prefix = setId.toUpperCase() + '-';
  const setCards = allCards.filter(c =>
    c.id.toUpperCase().startsWith(prefix) && !c.id.includes('_p')
  );
  if (!setCards.length) {
    console.error(`No cards found for set: ${setId}`);
    process.exit(1);
  }

  console.log(`\nSet: ${setId}  (${setCards.length} cards)\n`);
  const baseState = buildBaseState();
  const results = [];

  for (let i = 0; i < setCards.length; i++) {
    process.stdout.write(`\r  Simulating: ${i + 1}/${setCards.length}  `);
    results.push(simulateCard(setCards[i], baseState));
  }
  console.log('');

  const clean = results.filter(r => r.issues.length === 0);
  const flagged = results.filter(r => r.issues.length > 0);

  if (clean.length) {
    console.log(`\n✓ Clean: ${clean.length} cards`);
    const ids = clean.map(r => r.cardId);
    for (let i = 0; i < ids.length; i += 7)
      console.log('  ' + ids.slice(i, i + 7).join('  '));
  }

  if (flagged.length) {
    console.log(`\n✗ Issues found in ${flagged.length} cards:\n`);
    for (const r of flagged) {
      const card = setCards.find(c => c.id === r.cardId);
      console.log(`  ${pad(r.cardId, 12)}  ${card?.name ?? ''}`);
      for (const issue of r.issues) {
        const loc = issue.timing ? `(${issue.timing}) ` : '';
        console.log(`    [${issue.type}] ${loc}${issue.msg}`);
        if (issue.clauseRaw) console.log(`      effect: ${issue.clauseRaw}`);
      }
      console.log('');
    }
  }

  console.log(`\n${clean.length} of ${setCards.length} cards clean. ${flagged.length} card${flagged.length !== 1 ? 's' : ''} need attention.`);
  if (flagged.length > 0)
    console.log(`  Run /debug-card <id> on each flagged card for full chain analysis.`);
  else
    console.log(`  Timing wiring and semantic checks still require manual review — see debug-card Steps 2–5.`);
  console.log('');
}

function singleCardReport(cardId, allCards) {
  const card = allCards.find(c =>
    c.id.toUpperCase() === cardId.toUpperCase() && !c.id.includes('_p')
  );
  if (!card) {
    console.error(`Card not found: ${cardId}`);
    process.exit(1);
  }

  console.log(`\nCard: ${card.id}  ${card.name ?? ''}`);
  console.log(`  Effect: ${(card.effect ?? '(none)').replace(/<br>/g, ' ')}\n`);

  const baseState = buildBaseState();
  const result = simulateCard(card, baseState);

  if (result.noEffect) {
    console.log('  No effect text — nothing to simulate.');
  } else if (result.issues.length === 0) {
    console.log('✓ No simulation issues found.');
    console.log('  Semantic chain (parser → executor → modal → wiring) still requires manual check — see debug-card Steps 2–5.');
  } else {
    console.log(`✗ ${result.issues.length} issue(s) found:\n`);
    for (const issue of result.issues) {
      const loc = issue.timing ? `(${issue.timing}) ` : '';
      console.log(`  [${issue.type}] ${loc}${issue.msg}`);
      if (issue.clauseRaw) console.log(`    effect: ${issue.clauseRaw}`);
    }
  }
  console.log('');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const arg  = args[0];

if (!arg) {
  console.error('Usage: node scripts/simulate-cards.js [CARD-ID | --set SET-ID]');
  process.exit(1);
}

process.stdout.write('Loading card data… ');
const allCards = loadAllCards();
console.log(`${allCards.length} cards loaded.`);

if (arg === '--set') {
  const setId = args[1];
  if (!setId) { console.error('Missing set ID'); process.exit(1); }
  setReport(setId, allCards);
} else {
  singleCardReport(arg, allCards);
}
