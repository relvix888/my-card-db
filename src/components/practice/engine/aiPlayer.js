import { PLAYER, MAX_CHARACTERS } from './constants';
import {
  applyPlayCharacter, applyAttachDon,
  applyDeclareAttack, canAfford, calcPower, activeDonCount,
} from './gameState';
import { hasBlocker, hasOnAttack } from './effects';

const AI = PLAYER.AI;
const HUMAN = PLAYER.HUMAN;

// ---------------------------------------------------------------------------
// Build a simple AI deck from the card database
// ---------------------------------------------------------------------------

export function buildAiDeck(allCards) {
  // Pick a random leader from available leaders (prefer single-color for simplicity)
  const leaders = allCards.filter(c => c.category === 'Leader' && !c.id?.includes('_p'));
  const leader  = leaders[Math.floor(Math.random() * leaders.length)] || leaders[0];
  if (!leader) return { leader: null, deck: [] };

  const leaderColors = new Set(leader.colors || []);

  // Eligible: matches leader color, 50-card main deck, max 4 copies
  const eligible = allCards.filter(c =>
    c.category !== 'Leader' &&
    !c.id?.includes('_p') &&
    (c.colors || []).some(col => leaderColors.has(col))
  );

  // Build deck: prioritize characters, then events, fill to 50
  const deck = [];
  const counts = {};

  // Sort by power desc (AI prefers strong characters)
  const sorted = [...eligible].sort((a, b) => (b.power ?? 0) - (a.power ?? 0));

  for (const card of sorted) {
    if (deck.length >= 50) break;
    const base = card.id.replace(/_p\d+$/, '');
    counts[base] = counts[base] || 0;
    if (counts[base] < 4) {
      deck.push(card);
      counts[base]++;
    }
  }

  // Pad to 50 if needed (repeat first eligible cards)
  let i = 0;
  while (deck.length < 50 && sorted.length > 0) {
    const card = sorted[i % sorted.length];
    const base = card.id.replace(/_p\d+$/, '');
    if ((counts[base] || 0) < 4) {
      deck.push(card);
      counts[base] = (counts[base] || 0) + 1;
    }
    i++;
    if (i > sorted.length * 4) break; // safety
  }

  return { leader, deck };
}

// ---------------------------------------------------------------------------
// AI Decision Engine
// ---------------------------------------------------------------------------

// Returns an array of actions for the AI to take in sequence.
// Each action is dispatched with a delay in the React layer.
function planMainPhase(state) {
  const actions = [];
  let sim = { ...state }; // simulate state to plan ahead

  // 1. Play characters (most expensive affordable first)
  for (let attempt = 0; attempt < 5; attempt++) {
    const ps = sim[AI];
    const affordable = ps.hand
      .map((card, i) => ({ card, i }))
      .filter(({ card }) => card.category === 'Character' && canAfford(ps.costArea, card.cost ?? 0))
      .sort((a, b) => (b.card.cost ?? 0) - (a.card.cost ?? 0));

    if (affordable.length === 0 || ps.characterArea.length >= MAX_CHARACTERS) break;

    const { i } = affordable[0];
    actions.push({ type: 'PLAY_CHARACTER', handIndex: i });
    sim = applyPlayCharacter(sim, { handIndex: i });
  }

  // 2. Attach DON!! to highest-power character if any active DON!! remain
  {
    const ps = sim[AI];
    if (activeDonCount(ps.costArea) > 0 && ps.characterArea.length > 0) {
      // Find character with highest base power
      const best = ps.characterArea.reduce((bi, fc, i) =>
        (fc.card.power ?? 0) > (ps.characterArea[bi].card.power ?? 0) ? i : bi, 0);
      actions.push({ type: 'ATTACH_DON', targetZone: 'character', targetIndex: best });
      sim = applyAttachDon(sim, { targetZone: 'character', targetIndex: best });
    }
  }

  // 3. Attack with each active non-justDeployed character
  {
    const ps = sim[AI];
    const humanPs = sim[HUMAN];

    for (let i = 0; i < ps.characterArea.length; i++) {
      const fc = ps.characterArea[i];
      if (fc.state !== 'active' || fc.justDeployed) continue;

      // Target: rested human characters first, then leader
      const restedTargets = humanPs.characterArea
        .map((hfc, idx) => ({ hfc, idx }))
        .filter(({ hfc }) => hfc.state === 'rest');

      let attackAction;
      if (restedTargets.length > 0) {
        attackAction = { type: 'DECLARE_ATTACK', attackerZone: 'character', attackerIndex: i, targetOwner: HUMAN, targetZone: 'character', targetIndex: restedTargets[0].idx };
      } else {
        attackAction = { type: 'DECLARE_ATTACK', attackerZone: 'character', attackerIndex: i, targetOwner: HUMAN, targetZone: 'leader', targetIndex: -1 };
      }

      // Skip losing attacks unless the card has an On Attack effect worth triggering
      const atkPow = calcPower(fc, AI, AI);
      const defTarget = attackAction.targetZone === 'leader'
        ? humanPs.leader
        : humanPs.characterArea[attackAction.targetIndex];
      const defPow = defTarget ? calcPower(defTarget, AI, HUMAN) : 0;
      if (atkPow < defPow && !hasOnAttack(fc.card)) continue;

      actions.push(attackAction);
      sim = applyDeclareAttack(sim, attackAction);
      if (sim.winner) break;
    }
  }

  actions.push({ type: 'END_TURN' });
  return actions;
}

// AI decides whether to block during human's attack.
// Returns { type: 'USE_BLOCKER', blockerIndex } or { type: 'SKIP_BLOCK' }.
export function aiDecideBlock(state) {
  const battle = state.battle;
  if (!battle) return { type: 'SKIP_BLOCK' };

  const aiPs = state[AI];
  const atkPow = battle.atkPower;

  // Find a character with Blocker that, if used, would make defender win
  for (let i = 0; i < aiPs.characterArea.length; i++) {
    const fc = aiPs.characterArea[i];
    if (!hasBlocker(fc.card) || fc.state !== 'active') continue;
    const blockerPow = calcPower(fc, battle.attackerOwner, AI);
    if (blockerPow > atkPow) {
      return { type: 'USE_BLOCKER', blockerIndex: i };
    }
  }
  return { type: 'SKIP_BLOCK' };
}

// AI decides whether to play counter cards.
// Returns { type: 'PLAY_COUNTER', handIndex } or { type: 'SKIP_COUNTER' }.
export function aiDecideCounter(state) {
  const battle = state.battle;
  if (!battle) return { type: 'SKIP_COUNTER' };

  const aiPs = state[AI];
  const gap  = battle.atkPower - battle.defPower;

  if (gap <= 0) return { type: 'SKIP_COUNTER' }; // Already winning

  // Use a counter card if it would flip the result
  for (let i = 0; i < aiPs.hand.length; i++) {
    const card = aiPs.hand[i];
    // Need counter > gap so defPower strictly exceeds atkPower (tie still loses)
    if ((card.counter ?? 0) > gap) {
      return { type: 'PLAY_COUNTER', handIndex: i };
    }
  }
  return { type: 'SKIP_COUNTER' };
}

// ---------------------------------------------------------------------------
// AI Turn Runner — called from useEffect in PracticeView
// Returns an array of timed action sequences.
// ---------------------------------------------------------------------------

export function getAiTurnActions(state) {
  // Auto-phases (REFRESH/DRAW/DON_PHASE) are already dispatched by the
  // useEffect in PracticeView. This queue only covers the main phase.
  return planMainPhase(state);
}
