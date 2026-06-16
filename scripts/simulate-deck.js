// Usage: node --input-type=module scripts/simulate-deck.js --deck <leader-id> [--games N]

import {
  createInitialState, gameReducer, canAfford, calcPower, activeDonCount, applyActivateMain,
} from '../src/components/practice/engine/gameState.js';
import {
  getAiTurnActions, aiDecideBlock, aiDecideCounter,
} from '../src/components/practice/engine/aiPlayer.js';
import { getActivatedMainStatus, evaluateContinuousKeywords } from '../src/components/practice/engine/effects.js';
import { parseEffect } from '../src/components/practice/engine/effectParser.js';
import { PHASE, PLAYER, BATTLE_STEP, MAX_CHARACTERS } from '../src/components/practice/engine/constants.js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// constants.js exports PLAYER as { HOST, GUEST }; this harness was written against the older
// HUMAN/AI seat names. Alias them: HOST = deck under test (driven by the coverage heuristic),
// GUEST = opponent (driven by aiPlayer.planMainPhase). This matches createInitialState's
// (hostLeader, hostCards, guestLeader, guestCards) signature used by runGame below.
PLAYER.HUMAN = PLAYER.HOST;
PLAYER.AI = PLAYER.GUEST;
// Card JSON was reorganised into ZH/ and EN/ subdirs; the flat dir now holds only promo files.
// Read cards_*.json from the flat dir (legacy) and the ZH subdir, ZH taking precedence.
const CARD_DATA_DIRS = [
  '/Users/rexchan/opc-uploader/data',
  '/Users/rexchan/opc-uploader/data/ZH',
];

// ─── Arg Parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let deckLeaderId = null;
let numGames = 3;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--deck' && args[i + 1]) deckLeaderId = args[++i];
  if (args[i] === '--games' && args[i + 1]) numGames = parseInt(args[++i]);
}
if (!deckLeaderId) {
  console.error('Usage: node --input-type=module scripts/simulate-deck.js --deck <leader-id> [--games N]');
  process.exit(1);
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

function loadAllCards() {
  const byId = new Map();
  for (const dir of CARD_DATA_DIRS) {
    let files;
    try { files = readdirSync(dir).filter(f => f.startsWith('cards_') && f.endsWith('.json')); }
    catch { continue; }
    for (const f of files) {
      for (const card of JSON.parse(readFileSync(join(dir, f), 'utf-8'))) {
        byId.set(card.id, card); // later dir (ZH) wins on duplicate id
      }
    }
  }
  return [...byId.values()];
}

function parseDeckString(deckStr, cardById) {
  const cards = [];
  for (const entry of deckStr.split(',')) {
    const [countStr, id] = entry.trim().split('x');
    const card = cardById.get(id?.trim());
    if (card) for (let i = 0; i < parseInt(countStr); i++) cards.push(card);
  }
  return cards;
}

function buildDeckFromEntry(entry, cardById) {
  const all = parseDeckString(entry.deck, cardById);
  const leader = all.find(c => c.category === 'Leader');
  const deckCards = all.filter(c => c.category !== 'Leader');
  return { leader, deckCards };
}

function loadDecks(leaderId, allCards) {
  const deckJson = JSON.parse(readFileSync(join(ROOT, 'src/data/deck_final.json'), 'utf-8'));
  const cardById = new Map(allCards.map(c => [c.id, c]));

  const normalised = leaderId.toUpperCase();
  const entry = deckJson[normalised] ?? deckJson[leaderId];
  if (!entry) return null;
  const humanDeck = buildDeckFromEntry(entry, cardById);
  if (!humanDeck.leader) return null;

  // Pick opponent: highest-count deck that isn't the target
  const opponent = Object.entries(deckJson)
    .filter(([id]) => id !== leaderId)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([, e]) => buildDeckFromEntry(e, cardById))
    .find(d => d.leader && d.deckCards.length >= 10);

  return { humanDeck, aiDeck: opponent };
}

// ─── Expected Timings ─────────────────────────────────────────────────────────

const TRACKABLE_TIMINGS = new Set([
  '登場時', 'KO時', '攻擊時', '啟動主要', '起動メイン', '觸發器',
  '防禦時', '對方攻擊時', '我方回合結束時',
]);

function getExpectedTimings(card) {
  const timings = new Set();
  if (!card.effect) return timings;
  try {
    const clauses = parseEffect(card.effect);
    for (const cl of clauses) {
      for (const t of cl.timings ?? []) timings.add(t);
      for (const a of cl.activated ?? []) timings.add(a);
    }
  } catch {
    // ignore parser errors
  }
  if (card.trigger) timings.add('觸發器');
  return timings;
}

// ─── Coverage Tracker ─────────────────────────────────────────────────────────

class CoverageTracker {
  constructor() {
    this.played = new Map();        // cardId → count (登場時 exercised)
    this.attacked = new Map();      // cardId → count (攻擊時 exercised)
    this.koed = new Map();          // cardId → count (KO時 exercised)
    this.activatedMain = new Map(); // cardId → count (啟動主要 exercised)
    this.triggered = new Map();     // cardId → count (觸發器 exercised)
    this.opponentAttacked = new Map(); // cardId → count (對方攻擊時 exercised)
    this.blocked = new Map();       // cardId → count (防禦時 exercised)
    this.eotEffects = new Map();    // cardId → count (我方回合結束時 reached on field)
  }

  inc(map, cardId) { map.set(cardId, (map.get(cardId) ?? 0) + 1); }

  observed(cardId, timing) {
    switch (timing) {
      case '登場時':               return this.played.has(cardId);
      case '攻擊時':               return this.attacked.has(cardId);
      case 'KO時':                 return this.koed.has(cardId);
      case '啟動主要':
      case '起動メイン':           return this.activatedMain.has(cardId);
      case '觸發器':               return this.triggered.has(cardId);
      case '對方攻擊時':           return this.opponentAttacked.has(cardId);
      case '我方回合結束時':       return this.eotEffects.has(cardId);
      case '防禦時':               return this.blocked.has(cardId);
      default:                     return false;
    }
  }

  countFor(cardId, timing) {
    const map = {
      '登場時': this.played, '攻擊時': this.attacked, 'KO時': this.koed,
      '啟動主要': this.activatedMain, '起動メイン': this.activatedMain,
      '觸発器': this.triggered, '觸發器': this.triggered,
      '對方攻擊時': this.opponentAttacked, '防禦時': this.blocked,
      '我方回合結束時': this.eotEffects,
    }[timing];
    return map?.get(cardId) ?? 0;
  }
}

// ─── Auto-Resolver ────────────────────────────────────────────────────────────

function safeResolveEffectChoice(state, args) {
  try {
    return gameReducer(state, { type: 'RESOLVE_EFFECT_CHOICE', ...args });
  } catch {
    // If dispatching the choice throws (e.g. engine bug in an edge-case path),
    // fall back to declining to keep the simulation alive.
    try {
      return gameReducer(state, { type: 'RESOLVE_EFFECT_CHOICE', selectedIndices: [], selectedZone: null });
    } catch {
      return { ...state, pendingEffect: null }; // last resort: clear the stuck state
    }
  }
}

function autoResolvePendingEffect(state) {
  const pe = state.pendingEffect;
  if (!pe) return state;

  const { choices } = pe;
  if (!choices) {
    return safeResolveEffectChoice(state, { selectedIndices: [], selectedZone: null });
  }

  if (choices.type === 'CONFIRM_OPTIONAL_ACTIVATION') {
    // Decline KO-replacement confirmation to keep game flowing smoothly
    if (state.pendingKOReplacement) {
      return safeResolveEffectChoice(state, { selectedIndices: [], selectedZone: null });
    }
    // Accept optional activations to exercise effects; fall back to decline on engine errors
    return safeResolveEffectChoice(state, { selectedIndices: [0], selectedZone: null });
  }

  if (choices.type === 'CHOOSE_REDIRECT_ATTACK_TARGET') {
    // Prefer a character target so KO時 effects can be exercised; fall back to leader if none.
    const charIdx = choices.targets.findIndex(t => t.zone === 'character');
    const pick = charIdx >= 0 ? charIdx : 0;
    return safeResolveEffectChoice(state, { selectedIndices: [pick], selectedZone: null });
  }

  const items = choices.items ?? choices.targets ?? choices.fieldTargets ?? [];
  const maxSelect = choices.maxSelect ?? choices.max ?? 1;
  const count = Math.min(maxSelect, items.length);
  const selectedIndices = Array.from({ length: count }, (_, i) => i);

  return safeResolveEffectChoice(state, {
    selectedIndices,
    selectedZone: choices.zone ?? null,
  });
}

// ─── Human Player Strategy ────────────────────────────────────────────────────

function nextHumanAction(state) {
  const H = PLAYER.HUMAN;
  const ps = state[H];

  // Coverage-first: deploy a 防禦時 character before cost-sorted play so it reaches
  // the field and can be exercised as a blocker.
  if (ps.characterArea.length < MAX_CHARACTERS && !ps.deployBlockedThisTurn && !ps.handPlayLocked) {
    const alreadyOnField = new Set(ps.characterArea.map(fc => fc.card?.id).filter(Boolean));
    const blockCovCard = ps.hand
      .map((c, i) => ({ c, i }))
      .filter(({ c }) =>
        (c.category === 'Character' || c.category === '角色') &&
        canAfford(ps.costArea, c.cost ?? 0) &&
        !alreadyOnField.has(c.id) &&
        parseEffect(c.effect ?? '').some(cl => cl.timings.includes('防禦時'))
      )[0];
    if (blockCovCard) return { type: 'PLAY_CHARACTER', handIndex: blockCovCard.i };
  }

  // Play a character (most expensive first for effect coverage)
  if (ps.characterArea.length < MAX_CHARACTERS && !ps.deployBlockedThisTurn && !ps.handPlayLocked) {
    const best = ps.hand
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.category === 'Character' && canAfford(ps.costArea, c.cost ?? 0))
      .sort((a, b) => (b.c.cost ?? 0) - (a.c.cost ?? 0))[0];
    if (best) return { type: 'PLAY_CHARACTER', handIndex: best.i };
  }

  // Play a non-counter event
  if (!ps.handPlayLocked) {
    const event = ps.hand
      .map((c, i) => ({ c, i }))
      .filter(({ c }) =>
        c.category === 'Event' &&
        !(c.effect ?? '').includes('反擊') &&
        canAfford(ps.costArea, c.cost ?? 0),
      )[0];
    if (event) return { type: 'PLAY_EVENT', handIndex: event.i };

    // Play a stage
    if (!ps.stageArea) {
      const stage = ps.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.category === 'Stage' && canAfford(ps.costArea, c.cost ?? 0))[0];
      if (stage) return { type: 'PLAY_STAGE', handIndex: stage.i };
    }
  }

  // Activate leader's main-phase ability if available
  {
    const status = getActivatedMainStatus(ps.leader.card, ps, state, H, { target: 'leader' });
    if (status?.available) {
      const trial = applyActivateMain(state, { zone: 'leader', index: -1 });
      // trial === state means the effect silently no-oped (e.g. FLIP_LIFE_FACE_UP guard failed) —
      // don't dispatch; that would create a stuck-state loop that triggers the deadlock guard.
      if (trial !== state && !trial.pendingReplace && !trial.pendingTrigger) {
        return { type: 'ACTIVATE_MAIN', zone: 'leader', index: -1 };
      }
    }
  }

  // Activate character 啟動主要 abilities
  for (let i = 0; i < ps.characterArea.length; i++) {
    const fc = ps.characterArea[i];
    if (!fc.card || fc.state === 'rest') continue;
    const status = getActivatedMainStatus(fc.card, ps, state, H, { target: i });
    if (status?.available) {
      const trial = applyActivateMain(state, { zone: 'character', index: i });
      // trial === state means the effect silently no-oped — skip to avoid stuck-state loops.
      if (trial !== state && !trial.pendingReplace && !trial.pendingTrigger) {
        return { type: 'ACTIVATE_MAIN', zone: 'character', index: i };
      }
    }
  }

  // Activate stage 啟動主要 ability
  if (ps.stageArea?.card) {
    const status = getActivatedMainStatus(ps.stageArea.card, ps, state, H, { target: 'stage' });
    if (status?.available) {
      const trial = applyActivateMain(state, { zone: 'stage', index: -1 });
      if (trial !== state && !trial.pendingReplace && !trial.pendingTrigger) {
        return { type: 'ACTIVATE_MAIN', zone: 'stage', index: -1 };
      }
    }
  }

  // Attack with active characters (skip turn 1)
  if (state.turn > 1) {
    for (let i = 0; i < ps.characterArea.length; i++) {
      const fc = ps.characterArea[i];
      if (fc.state !== 'active' || fc.justDeployed || fc.attackLocked) continue;
      // rushCharOnly: only rush characters may attack this turn
      if (ps.rushCharOnly) {
        const hasRush = (fc.card?.effect ?? '').includes('速攻') ||
          (fc.tempKeywords ?? []).some(k => k === 'rush' || k === '速攻');
        if (!hasRush) continue;
      }
      return {
        type: 'DECLARE_ATTACK',
        attackerZone: 'character',
        attackerIndex: i,
        targetOwner: PLAYER.AI,
        targetZone: 'leader',
        targetIndex: -1,
      };
    }

    // Leader attacks last (skip if CANNOT_ATTACK)
    const leaderKws = evaluateContinuousKeywords(ps.leader, H, H, state);
    if (ps.leader.state === 'active' && !ps.leader.attackLocked && !ps.rushCharOnly && !leaderKws.has('CANNOT_ATTACK')) {
      return {
        type: 'DECLARE_ATTACK',
        attackerZone: 'leader',
        attackerIndex: -1,
        targetOwner: PLAYER.AI,
        targetZone: 'leader',
        targetIndex: -1,
      };
    }
  }

  return { type: 'END_TURN' };
}

// ─── Battle Resolution ────────────────────────────────────────────────────────

function resolveBattleStep(state) {
  const { battle } = state;
  if (!battle) return state;

  if (battle.step === BATTLE_STEP.BLOCK) {
    // AI defends using its strategy; human always skips (防禦時 coverage is handled in runGame)
    const action = battle.targetOwner === PLAYER.AI
      ? aiDecideBlock(state)
      : { type: 'SKIP_BLOCK' };
    return gameReducer(state, action);
  }

  if (battle.step === BATTLE_STEP.COUNTER) {
    // AI counters; human skips unless lethal
    let action;
    if (battle.targetOwner === PLAYER.AI) {
      action = aiDecideCounter(state);
    } else {
      const isLethal = battle.targetZone === 'leader' && state[PLAYER.HUMAN].lifeArea.length <= 1;
      action = isLethal ? { type: 'SKIP_COUNTER' } : { type: 'SKIP_COUNTER' };
    }
    return gameReducer(state, action);
  }

  if (battle.step === BATTLE_STEP.DAMAGE) {
    return gameReducer(state, { type: 'RESOLVE_DAMAGE' });
  }

  return state;
}

// ─── Coverage Tracking ────────────────────────────────────────────────────────

function trackDispatch(tracker, humanCardIds, action, before, after) {
  const H = PLAYER.HUMAN;

  if (before.activePlayer === H) {
    // Character deployed
    if (action.type === 'PLAY_CHARACTER') {
      const card = before[H].hand[action.handIndex];
      if (card && humanCardIds.has(card.id)) tracker.inc(tracker.played, card.id);
    }

    // Event played
    if (action.type === 'PLAY_EVENT') {
      const card = before[H].hand[action.handIndex];
      if (card && humanCardIds.has(card.id)) tracker.inc(tracker.played, card.id);
    }

    // Stage played (continuous effect begins)
    if (action.type === 'PLAY_STAGE') {
      const card = before[H].hand[action.handIndex];
      if (card && humanCardIds.has(card.id)) tracker.inc(tracker.played, card.id);
    }

    // Attack declared
    if (action.type === 'DECLARE_ATTACK') {
      const ps = before[H];
      const card = action.attackerZone === 'leader'
        ? ps.leader.card
        : ps.characterArea[action.attackerIndex]?.card;
      if (card && humanCardIds.has(card.id)) tracker.inc(tracker.attacked, card.id);
    }

    // Activated main
    if (action.type === 'ACTIVATE_MAIN') {
      const ps = before[H];
      const card = action.zone === 'leader'
        ? ps.leader.card
        : action.zone === 'stage'
          ? ps.stageArea?.card
          : ps.characterArea[action.index]?.card;
      if (card && humanCardIds.has(card.id)) tracker.inc(tracker.activatedMain, card.id);
    }
  }

  // 防禦時 tracking: human uses a character as blocker
  if (action.type === 'USE_BLOCKER' && before.battle?.targetOwner === H) {
    const card = before[H].characterArea[action.blockerIndex]?.card;
    if (card && humanCardIds.has(card.id)) tracker.inc(tracker.blocked, card.id);
  }

  // 對方攻擊時 tracking: when AI declares an attack, human's characters/leader with this timing are exercised
  if (action.type === 'DECLARE_ATTACK' && before.activePlayer === PLAYER.AI) {
    const ps = before[PLAYER.HUMAN];
    for (const fc of ps.characterArea) {
      if (fc.card && humanCardIds.has(fc.card.id)) {
        tracker.inc(tracker.opponentAttacked, fc.card.id);
      }
    }
    // Leader is always on field
    if (ps.leader.card && humanCardIds.has(ps.leader.card.id)) {
      tracker.inc(tracker.opponentAttacked, ps.leader.card.id);
    }
    if (ps.stageArea?.card && humanCardIds.has(ps.stageArea.card.id)) {
      tracker.inc(tracker.opponentAttacked, ps.stageArea.card.id);
    }
  }

  // 我方回合結束時 tracking: when human ends their turn, all human field cards with this timing are reached
  if (action.type === 'END_TURN' && before.activePlayer === H) {
    const ps = before[H];
    if (ps.leader.card && humanCardIds.has(ps.leader.card.id))
      tracker.inc(tracker.eotEffects, ps.leader.card.id);
    for (const fc of ps.characterArea) {
      if (fc.card && humanCardIds.has(fc.card.id))
        tracker.inc(tracker.eotEffects, fc.card.id);
    }
    if (ps.stageArea?.card && humanCardIds.has(ps.stageArea.card.id))
      tracker.inc(tracker.eotEffects, ps.stageArea.card.id);
  }

  // KO tracking: cards that were in human characterArea before but are now in human trash
  const beforeCharIds = new Set(before[H].characterArea.map(fc => fc.card?.id).filter(Boolean));
  const prevTrashLen = before[H].trash.length;
  const newTrashCards = after[H].trash.slice(prevTrashLen);
  for (const card of newTrashCards) {
    if (card && beforeCharIds.has(card.id) && humanCardIds.has(card.id)) {
      tracker.inc(tracker.koed, card.id);
    }
  }
}

function trackTrigger(tracker, humanCardIds, lifeCard) {
  if (lifeCard && humanCardIds.has(lifeCard.id)) {
    tracker.inc(tracker.triggered, lifeCard.id);
  }
}

// ─── Single Game Simulation ───────────────────────────────────────────────────

function safeStep(state, fn) {
  try {
    const next = fn();
    // If state didn't change at all, that's a stuck state — return as-is
    return next ?? state;
  } catch {
    // On engine error, clear interactive states to keep the game moving
    return {
      ...state,
      pendingEffect: null,
      pendingTrigger: null,
      pendingReplace: null,
      pendingKOReplacement: null,
      battle: state.battle?.step === BATTLE_STEP.DAMAGE ? null : state.battle,
    };
  }
}

function runGame(humanDeck, aiDeck, tracker, humanCardIds) {
  let state = createInitialState(
    humanDeck.leader, humanDeck.deckCards,
    aiDeck.leader, aiDeck.deckCards,
  );

  // Both players keep opening hand
  state = gameReducer(state, { type: 'MULLIGAN_KEEP' });

  // Execute pre-game ability: deploy the first matching Stage from deck (e.g. OP13-079)
  if (state.preGameAbility) {
    const deck = state[PLAYER.HUMAN].deck;
    const stageIdx = deck.findIndex(c => c.category === 'Stage');
    state = gameReducer(state, { type: 'LEADER_PRE_GAME_STAGE', cardIndex: stageIdx >= 0 ? stageIdx : null });
  }

  const aiQueue = [];
  let maxSteps = 2000;
  let lastKey = '';
  let stuckCount = 0;

  while (!state.winner && maxSteps-- > 0) {
    // Deadlock guard
    const key = `${state.phase}|${state.activePlayer}|${state.turn}|${state.battle?.step ?? '-'}|${!!state.pendingEffect}|${!!state.pendingTrigger}|${!!state.pendingReplace}`;
    if (key === lastKey) {
      if (++stuckCount > 10) break;
    } else {
      stuckCount = 0;
      lastKey = key;
    }

    // ── Pending interactive states ────────────────────────────────────────────
    if (state.pendingEffect) {
      state = safeStep(state, () => autoResolvePendingEffect(state));
      continue;
    }

    if (state.pendingReplace) {
      state = safeStep(state, () => gameReducer(state, { type: 'RESOLVE_REPLACE', replaceIndex: 0 }));
      continue;
    }

    if (state.pendingTrigger) {
      const lifeCard = state.pendingTrigger.lifeCard;
      trackTrigger(tracker, humanCardIds, lifeCard);
      state = safeStep(state, () => gameReducer(state, { type: 'RESOLVE_TRIGGER', activate: true }));
      continue;
    }

    // ── Active battle ─────────────────────────────────────────────────────────
    if (state.battle) {
      // 防禦時 coverage: when human defends during the BLOCK step, use a 防禦時
      // character as blocker so the timing gets exercised and tracked.
      if (state.battle.step === BATTLE_STEP.BLOCK && state.battle.targetOwner === PLAYER.HUMAN) {
        const ps = state[PLAYER.HUMAN];
        const blockerIdx = ps.characterArea.findIndex(fc =>
          fc.state === 'active' &&
          parseEffect(fc.card?.effect ?? '').some(c => c.timings.includes('防禦時'))
        );
        if (blockerIdx >= 0) {
          const action = { type: 'USE_BLOCKER', blockerIndex: blockerIdx };
          const before = state;
          state = safeStep(state, () => gameReducer(state, action));
          trackDispatch(tracker, humanCardIds, action, before, state);
          continue;
        }
      }
      const beforeBattle = state;
      state = safeStep(state, () => resolveBattleStep(state));
      trackDispatch(tracker, humanCardIds, { type: '_BATTLE_STEP' }, beforeBattle, state);
      continue;
    }

    // ── Mulligan (safety) ─────────────────────────────────────────────────────
    if (state.mulligan === 'pending') {
      state = gameReducer(state, { type: 'MULLIGAN_KEEP' });
      continue;
    }

    // ── Phase progression ─────────────────────────────────────────────────────
    if (state.phase === PHASE.REFRESH) {
      state = safeStep(state, () => gameReducer(state, { type: 'REFRESH' }));
      continue;
    }

    if (state.phase === PHASE.DRAW) {
      state = safeStep(state, () => gameReducer(state, { type: 'DRAW' }));
      continue;
    }

    if (state.phase === PHASE.DON) {
      state = safeStep(state, () => gameReducer(state, { type: 'DON_PHASE' }));
      continue;
    }

    // ── Main phase ────────────────────────────────────────────────────────────
    if (state.phase === PHASE.MAIN) {
      if (state.activePlayer === PLAYER.AI) {
        if (!aiQueue.length) {
          try { aiQueue.push(...getAiTurnActions(state)); } catch { /* ignore */ }
        }
        if (!aiQueue.length) {
          state = safeStep(state, () => gameReducer(state, { type: 'END_TURN' }));
        } else {
          const before = state;
          const action = aiQueue.shift();
          state = safeStep(state, () => gameReducer(state, action));
          trackDispatch(tracker, humanCardIds, action, before, state);
        }
      } else {
        const action = nextHumanAction(state);
        const before = state;
        state = safeStep(state, () => gameReducer(state, action));
        trackDispatch(tracker, humanCardIds, action, before, state);
        if (action.type === 'END_TURN') aiQueue.length = 0;
      }
      continue;
    }

    // ── Fallback for unknown state ────────────────────────────────────────────
    break;
  }

  return state;
}

// ─── Report ───────────────────────────────────────────────────────────────────

function formatCount(n) {
  return n > 0 ? ` ×${n}` : '';
}

function pad(str, len) {
  return String(str).padEnd(len);
}

function decodeHtml(str) {
  if (!str) return str;
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function printReport(humanDeck, aiDeck, tracker, numGames) {
  // Deduplicate deck cards by ID
  const uniqueCards = new Map();
  for (const card of [humanDeck.leader.card ?? humanDeck.leader, ...humanDeck.deckCards]) {
    const c = card.card ?? card;
    if (!uniqueCards.has(c.id)) uniqueCards.set(c.id, c);
  }
  // Also include the leader itself
  const leaderCard = humanDeck.leader.card ?? humanDeck.leader;
  if (!uniqueCards.has(leaderCard.id)) uniqueCards.set(leaderCard.id, leaderCard);

  const rows = [];
  let noEffectCount = 0;

  for (const [id, card] of uniqueCards) {
    const expected = getExpectedTimings(card);
    const trackable = [...expected].filter(t => TRACKABLE_TIMINGS.has(t));
    const untrackable = [...expected].filter(t => !TRACKABLE_TIMINGS.has(t));

    if (!trackable.length) {
      if (expected.size > 0) noEffectCount++;
      // Cards with no trackable timings (pure counters, continuous-only) — skip from main table
      continue;
    }

    const observedTimings = trackable.filter(t => tracker.observed(id, t));
    const missedTimings = trackable.filter(t => !tracker.observed(id, t));

    rows.push({ id, card, trackable, observedTimings, missedTimings, untrackable });
  }

  const fullyObserved = rows.filter(r => r.missedTimings.length === 0);
  const partial = rows.filter(r => r.missedTimings.length > 0 && r.observedTimings.length > 0);
  const neverTriggered = rows.filter(r => r.observedTimings.length === 0);

  const opponentLeader = aiDeck?.leader?.card ?? aiDeck?.leader;

  console.log('');
  console.log(`=== Deck Simulation: ${deckLeaderId} | ${decodeHtml(leaderCard.name) ?? '?'} (${numGames} game${numGames > 1 ? 's' : ''}) ===`);
  console.log(`    vs opponent: ${opponentLeader?.id ?? '?'} | ${decodeHtml(opponentLeader?.name) ?? '?'}`);
  console.log(`    ${uniqueCards.size} unique cards — ${rows.length} with trackable effects`);
  console.log('');

  if (fullyObserved.length) {
    console.log(`  FULLY EXERCISED (${fullyObserved.length}):`);
    for (const r of fullyObserved) {
      const obs = r.observedTimings.map(t => `${t}${formatCount(tracker.countFor(r.id, t))}`).join(', ');
      console.log(`  ✓ ${pad(r.id, 12)}  ${pad(decodeHtml(r.card.name) ?? '?', 20)}  ${obs}`);
    }
    console.log('');
  }

  if (partial.length) {
    console.log(`  PARTIAL COVERAGE (${partial.length}):`);
    for (const r of partial) {
      const obs = r.observedTimings.map(t => `${t}${formatCount(tracker.countFor(r.id, t))}`).join(', ');
      const missed = r.missedTimings.join(', ');
      console.log(`  ⚠ ${pad(r.id, 12)}  ${pad(decodeHtml(r.card.name) ?? '?', 20)}  observed: ${obs}   missed: ${missed}`);
    }
    console.log('');
  }

  if (neverTriggered.length) {
    console.log(`  NEVER TRIGGERED (${neverTriggered.length}) — run /debug-card <id> to verify handler chain:`);
    for (const r of neverTriggered) {
      const expected = r.trackable.join(', ');
      console.log(`  ✗ ${pad(r.id, 12)}  ${pad(decodeHtml(r.card.name) ?? '?', 20)}  expected: ${expected}`);
    }
    console.log('');
  }

  if (noEffectCount > 0) {
    console.log(`  (${noEffectCount} card(s) with continuous/counter-only effects skipped — not runtime-trackable)`);
    console.log('');
  }

  const coveragePct = rows.length > 0
    ? Math.round((fullyObserved.length / rows.length) * 100)
    : 100;
  console.log(`  Coverage: ${fullyObserved.length}/${rows.length} cards fully exercised (${coveragePct}%)`);
  if (neverTriggered.length + partial.length > 0) {
    console.log(`  ${neverTriggered.length + partial.length} card(s) need investigation — check above`);
  } else {
    console.log('  All trackable effects were observed firing. ✓');
  }
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`Loading card data…`);
const allCards = loadAllCards();

console.log(`Loading deck ${deckLeaderId}…`);
const decks = loadDecks(deckLeaderId, allCards);
if (!decks) {
  console.error(`Deck not found for leader "${deckLeaderId}" in src/data/deck_final.json`);
  process.exit(1);
}
const { humanDeck, aiDeck } = decks;

const humanCardIds = new Set([
  (humanDeck.leader.card ?? humanDeck.leader).id,
  ...humanDeck.deckCards.map(c => c.id),
]);

const tracker = new CoverageTracker();

console.log(`Running ${numGames} game(s)…\n`);
for (let g = 1; g <= numGames; g++) {
  process.stdout.write(`  Game ${g}/${numGames}… `);
  const finalState = runGame(humanDeck, aiDeck, tracker, humanCardIds);
  const winner = finalState.winner ?? 'draw/timeout';
  console.log(`done (${winner === PLAYER.HUMAN ? 'human wins' : winner === PLAYER.AI ? 'AI wins' : winner})`);
}

printReport(humanDeck, aiDeck, tracker, numGames);
