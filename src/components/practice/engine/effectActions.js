/**
 * effectActions.js
 * Condition evaluation, card-filter matching, and action execution.
 * All functions are pure: (state, ...) → newState.
 * Interactive effects set state.pendingEffect instead of resolving immediately.
 */

import { PLAYER, DON_PER_TURN, FIRST_TURN_DON } from './constants';
import { parseEffect, parseEffectEN } from './effectParser';
import { hasRush, hasCharacterRushOnly, leaderDiscardCompensationTrait } from './effects';

// ─── Internal helpers (duplicated to avoid circular imports with gameState.js) ─

function addLog(state, text, type = 'info') {
  return { ...state, log: [...(state.log ?? []), { text, type, id: Date.now() + Math.random() }] };
}

let _flashId = 0;
function appendFlash(state, card, label, extra = {}) {
  return {
    ...state,
    cardFlashQueue: [...(state.cardFlashQueue ?? []), { id: ++_flashId, card, label, ...extra }],
  };
}

function cn(card) {
  if (!card) return '?';
  const id = card.id?.replace(/_p\d+$/, '') ?? '';
  return id ? `${id} ${card.name}` : (card.name ?? '?');
}

function makeDon(tag) {
  return { _donId: `don-eff-${tag}-${Math.random()}`, state: 'active' };
}

function opp(owner) {
  return owner === PLAYER.HUMAN ? PLAYER.AI : PLAYER.HUMAN;
}

// In PvP both players are human; in AI mode only PLAYER.HUMAN gets interactive prompts.
function shouldPrompt(owner, state) {
  return owner === PLAYER.HUMAN || !!state.pvpMode;
}

// Pick the best `take` cards from a SEARCH candidate pool using a three-tier heuristic:
//   1. Fills a missing curve slot (DON totals per turn for this player's order)
//   2. Cost not already represented in hand (new tier)
//   3. Fallback: highest cost
// Within each tier, higher cost wins.
function pickAiSearchCards(candidates, take, hand, state, owner) {
  if (candidates.length <= take) return candidates;

  const isFirst = state.firstPlayer === owner;

  // Cumulative DON available per turn, capped at 10
  // First player:  1, 3, 5, 7, 9, 10, 10 …
  // Second player: 2, 4, 6, 8, 10, 10 …
  const curveCosts = new Set();
  let don = isFirst ? FIRST_TURN_DON : DON_PER_TURN;
  curveCosts.add(Math.min(don, 10));
  for (let t = 2; t <= 10; t++) {
    don = Math.min(don + DON_PER_TURN, 10);
    curveCosts.add(don);
  }

  const handCostSet = new Set(hand.map(c => c.cost ?? 0));
  const missingCurve = new Set([...curveCosts].filter(c => !handCostSet.has(c)));

  const score = card => {
    const cost = card.cost ?? 0;
    if (missingCurve.has(cost)) return 20000 + cost;
    if (!handCostSet.has(cost)) return 10000 + cost;
    return cost;
  };

  return [...candidates].sort((a, b) => score(b) - score(a)).slice(0, take);
}

// ─── Condition Evaluator ──────────────────────────────────────────────────────

/**
 * Return true when the parsed condition is currently met.
 * @param {object} state  full game state
 * @param {string} owner  card controller ('human'|'ai')
 * @param {object} cond   condition from effectParser.parseCondition
 */
export function evaluateCondition(state, owner, cond, fieldCard = null, skipContinuousCost = false) {
  if (!cond) return true;

  if (cond.subject === 'self_justDeployed') return fieldCard?.justDeployed === true;
  if (cond.subject === 'lastDeployed') return (state._lastDeployedCount ?? 0) > 0;

  const condOwner = cond.owner === 'opponent' ? opp(owner) : owner;
  const ps = state[condOwner];

  switch (cond.subject) {
    case 'leader': {
      const leader = ps?.leader?.card;
      if (!leader) return false;
      if (cond.handMax !== undefined && (ps?.hand?.length ?? 0) > cond.handMax) return false;
      if (cond.multiColor) {
        if ((leader.colors?.length ?? 0) <= 1) return false;
      }
      if (cond.attribute && cond.predicate === 'has') {
        if (!(leader.attributes ?? []).includes(cond.attribute)) return false;
      }
      if (cond.traits && cond.predicate === 'has') {
        if (!cond.traits.some(trait => (leader.types ?? []).some(t => t.includes(trait)))) return false;
      } else if (cond.trait && cond.predicate === 'has') {
        if (!(leader.types ?? []).some(t => t.includes(cond.trait))) return false;
      } else if (cond.names) {
        if (!cond.names.includes(leader.name)) return false;
      } else if (cond.name) {
        if (leader.name !== cond.name) return false;
      }
      // Compound: also require no other character named X on own field
      if (cond.noOther) {
        const count = (state[owner]?.characterArea ?? [])
          .filter(fc => fc.card.name === cond.noOther).length;
        if (count > 1) return false; // > 1 means there's another copy besides this card
      }
      // Compound: AND opponent's field DON count
      if (cond.oppDonField) {
        const opp = owner === 'human' ? 'ai' : 'human';
        const ops = state[opp];
        const fieldDon = (ops?.costArea?.length ?? 0)
          + (ops?.leader?.attachedDon ?? 0)
          + (ops?.characterArea ?? []).reduce((s, fc) => s + fc.attachedDon, 0);
        const { count: donCount, countOp } = cond.oppDonField;
        if (countOp === 'gte' ? fieldDon < donCount : fieldDon > donCount) return false;
      }
      return true;
    }
    case 'characters': {
      const chars = ps?.characterArea ?? [];
      if (cond.predicate === 'only' && cond.trait)
        return chars.length > 0 && chars.every(fc =>
          (fc.card.types ?? []).some(t => t.includes(cond.trait)));
      if (cond.predicate === 'has' && cond.name)
        return chars.some(fc => fc.card.name === cond.name);
      if (cond.name) {
        const hasName = chars.some(fc =>
          fc.card.name === cond.name &&
          (cond.power === undefined || (
            cond.powerOp === 'gte' ? (fc.card.power ?? 0) >= cond.power :
            cond.powerOp === 'eq'  ? (fc.card.power ?? 0) === cond.power :
                                     (fc.card.power ?? 0) <= cond.power
          ))
        );
        if (!hasName) return false;
        if (cond.noOther) {
          const count = chars.filter(fc => fc.card.name === cond.noOther).length;
          if (count > 1) return false;
        }
        return true;
      }
      if (cond.power !== undefined) {
        const powerMatching = chars.filter(fc =>
          cond.powerOp === 'gte'
            ? (fc.card.power ?? 0) >= cond.power
            : cond.powerOp === 'eq'
              ? (fc.card.power ?? 0) === cond.power
              : (fc.card.power ?? 0) <= cond.power
        );
        if (cond.count !== undefined)
          return cond.countOp === 'gte'
            ? powerMatching.length >= cond.count
            : powerMatching.length <= cond.count;
        return powerMatching.length > 0;
      }
      if (cond.costAlts)
        return chars.some((fc, i) => {
          const costMod = (ps.costMods ?? []).filter(m => m.target === i).reduce((acc, m) => acc + m.delta, 0)
            + (skipContinuousCost ? 0 : evaluateContinuousCostDelta(fc, condOwner, state));
          const cardCost = Math.max(0, (fc.card.cost ?? 0) + costMod);
          return cond.costAlts.some(alt => {
            if (alt.op === 'eq') return cardCost === alt.val;
            if (alt.op === 'gte') return cardCost >= alt.val;
            return cardCost <= alt.val;
          });
        });
      if (cond.cost !== undefined)
        return chars.some((fc, i) => {
          const costMod = (ps.costMods ?? []).filter(m => m.target === i).reduce((acc, m) => acc + m.delta, 0)
            + (skipContinuousCost ? 0 : evaluateContinuousCostDelta(fc, condOwner, state));
          const effectiveCost = Math.max(0, (fc.card.cost ?? 0) + costMod);
          return cond.costOp === 'gte' ? effectiveCost >= cond.cost : effectiveCost <= cond.cost;
        });
      if (cond.count !== undefined) {
        const pool = cond.rested ? chars.filter(fc => fc.state === 'rest') : chars;
        return cond.countOp === 'gte' ? pool.length >= cond.count : pool.length <= cond.count;
      }
      if (cond.predicate === 'has' && cond.trait)
        return chars.some(fc => (fc.card.types ?? []).some(t => t.includes(cond.trait)));
      if (cond.predicate === 'has' && cond.traits)
        return chars.some(fc => cond.traits.some(tr => (fc.card.types ?? []).some(t => t.includes(tr))));
      return true;
    }
    case 'rested_field_cards': {
      // "自己休息狀態的卡片有N張以上" — leader + characters + stage + all DON!!
      let restedCount = 0;
      if (ps?.leader?.state === 'rest') restedCount++;
      restedCount += (ps?.characterArea ?? []).filter(fc => fc.state === 'rest').length;
      if (ps?.stageArea?.state === 'rest') restedCount++;
      restedCount += (ps?.costArea ?? []).filter(d => d.state === 'rest').length;
      if (cond.count !== undefined)
        return cond.countOp === 'gte' ? restedCount >= cond.count : restedCount <= cond.count;
      return true;
    }
    case 'don_field': {
      // Total DON!! in play: cost area + attached to leader/characters
      const fieldDon = (ps?.costArea?.length ?? 0)
        + (ps?.leader?.attachedDon ?? 0)
        + (ps?.characterArea ?? []).reduce((s, fc) => s + fc.attachedDon, 0);
      if (cond.compareToOppDon) {
        const oppPs = state[opp(condOwner)];
        const oppFieldDon = (oppPs?.costArea?.length ?? 0)
          + (oppPs?.leader?.attachedDon ?? 0)
          + (oppPs?.characterArea ?? []).reduce((s, fc) => s + fc.attachedDon, 0);
        return fieldDon <= oppFieldDon;
      }
      if (cond.count !== undefined) {
        if (cond.countOp === 'zeroOrGte') return fieldDon === 0 || fieldDon >= cond.count;
        return cond.countOp === 'gte' ? fieldDon >= cond.count : fieldDon <= cond.count;
      }
      return true;
    }
    case 'don': {
      const costArea = ps?.costArea ?? [];
      const total = cond.state === 'active'
        ? costArea.filter(d => d.state === 'active').length
        : costArea.length
            + (ps?.leader?.attachedDon ?? 0)
            + (ps?.characterArea ?? []).reduce((s, fc) => s + fc.attachedDon, 0);
      if (cond.count !== undefined)
        return cond.countOp === 'gte' ? total >= cond.count : total <= cond.count;
      return true;
    }
    case 'lifeAndHand': {
      const combined = (ps?.lifeArea?.length ?? 0) + (ps?.hand?.length ?? 0);
      if (cond.count !== undefined)
        return cond.countOp === 'gte' ? combined >= cond.count : combined <= cond.count;
      return true;
    }
    case 'life': {
      const life = ps?.lifeArea?.length ?? 0;
      if (cond.count !== undefined) {
        if (cond.countOp === 'eq') return life === cond.count;
        return cond.countOp === 'gte' ? life >= cond.count : life <= cond.count;
      }
      return true;
    }
    case 'hand': {
      const handSize = ps?.hand?.length ?? 0;
      if (cond.count !== undefined)
        return cond.countOp === 'gte' ? handSize >= cond.count : handSize <= cond.count;
      return true;
    }
    case 'trash': {
      const trash = ps?.trash ?? [];
      const trashSize = cond.category
        ? trash.filter(c => c.category === cond.category).length
        : trash.length;
      if (cond.count !== undefined)
        return cond.countOp === 'gte' ? trashSize >= cond.count : trashSize <= cond.count;
      return true;
    }
    case 'deck': {
      const deckSize = ps?.deck?.length ?? 0;
      if (cond.count !== undefined)
        return cond.countOp === 'gte' ? deckSize >= cond.count
             : cond.countOp === 'lte' ? deckSize <= cond.count
             : deckSize === cond.count;
      return true;
    }
    case 'my_turn_count': {
      return (state.turn ?? 1) >= (cond.turnMin ?? 1);
    }
    case 'lastRevealedCard': {
      const card = state.lastRevealedLifeCard;
      if (!card) return false;
      if (cond.name && card.name !== cond.name) return false;
      if (cond.cost !== undefined && card.cost !== cond.cost) return false;
      return true;
    }
    default:
      return true;
  }
}

// ─── Self-Conditional Hand Cost Helper ───────────────────────────────────────

/**
 * Returns the total cost delta for a hand card from its own conditional cost-reduction
 * clauses (timings=[], COST_MOD self continuous, condition evaluated against current state).
 * e.g. "若自己廢棄區有4張以上事件卡時，手牌中這張卡片的費用-3"
 */
export function getSelfCondHandCostDelta(card, state, owner) {
  if (!card?.effect) return 0;
  const clauses = parseEffect(card.effect);
  let delta = 0;
  for (const clause of clauses) {
    if (clause.timings?.length || clause.continuous?.length || clause.passive?.length) continue;
    if (!clause.condition) continue;
    if (!clause.raw?.includes('手牌中')) continue;
    for (const action of (clause.actions ?? [])) {
      if (action.type === 'COST_MOD' && action.until === 'continuous' && action.filter?.self) {
        if (evaluateCondition(state, owner, clause.condition)) delta += action.delta;
      }
    }
  }
  return delta;
}

// ─── Card Filter Matcher ──────────────────────────────────────────────────────

/**
 * Returns true when a card matches the filter criteria.
 * @param {object} card    raw card object (card.category, card.types, etc.)
 * @param {object} filter  from parseCardFilter()
 * @param {object} [fc]    FieldCard wrapper (for state/donAttached checks)
 * @param {number} [power] current power value (for power comparisons)
 */
export function getAlternateNames(card) {
  const m = (card.effect ?? '').match(/在規則上，這張卡片的卡片名稱也可視為(「[^」]+」(?:和「[^」]+」)*)/);
  if (!m) return [];
  return [...m[1].matchAll(/「([^」]+)」/g)].map(x => x[1]);
}

export function matchesFilter(card, filter, fc = null, power = null, effectiveCost = null) {
  if (!filter || !Object.keys(filter).length) return true;

  if (filter.orFilters) {
    if (!filter.orFilters.some(f => matchesFilter(card, f, fc, power))) return false;
  }
  if (filter.attribute && !(card.attributes ?? []).includes(filter.attribute)) return false;

  if (filter.orCategories) {
    if (!filter.orCategories.includes(card.category)) return false;
  } else if (filter.category && card.category !== filter.category) {
    if (!(filter.includesLeader && card.category === 'Leader')) return false;
  }
  if (filter.trait         && !(card.types ?? []).some(t => t === filter.trait))                                        return false;
  if (filter.traits        && !filter.traits.some(trait => (card.types ?? []).some(t => t === trait)))                 return false;
  if (filter.traitContains && !(card.types ?? []).some(t => t.includes(filter.traitContains)))                         return false;
  if (filter.traitsContains && !filter.traitsContains.some(trait => (card.types ?? []).some(t => t.includes(trait)))) return false;
  if (filter.name  && card.name !== filter.name && !getAlternateNames(card).includes(filter.name)) return false;
  if (filter.names && !filter.names.some(n => card.name === n || getAlternateNames(card).includes(n))) return false;
  if (filter.excludeName && card.name === filter.excludeName) return false;

  if (filter.costMin !== undefined || filter.costMax !== undefined) {
    const c = card.cost ?? 0;
    if (filter.costMin !== undefined && c < filter.costMin) return false;
    if (filter.costMax !== undefined && c > filter.costMax) return false;
  } else if (filter.cost !== undefined) {
    const c = effectiveCost !== null ? effectiveCost : (card.cost ?? 0);
    if (filter.costOp === 'gte' ? c < filter.cost : filter.costOp === 'eq' ? c !== filter.cost : c > filter.cost) return false;
  }
  if (filter.power !== undefined && power !== null) {
    if (filter.powerOp === 'gte' ? power < filter.power : filter.powerOp === 'eq' ? power !== filter.power : power > filter.power) return false;
  }
  if (filter.donAttached !== undefined && fc) {
    if (fc.attachedDon < filter.donAttached) return false;
  }
  if (filter.state && fc) {
    if (fc.state !== filter.state) return false;
  }
  if (filter.hasAbility) {
    if (!(card.effect ?? '').includes(`【${filter.hasAbility}】`)) return false;
  }
  if (filter.withoutKeyword) {
    if (card.effect?.includes(filter.withoutKeyword)) return false;
  }
  if (filter.noEffect) {
    if ((card.effect ?? '') !== '' || (card.trigger ?? '') !== '') return false;
  }
  if (filter.color && !(card.colors ?? []).includes(filter.color)) return false;
  if (filter.excludeColors?.length && (card.colors ?? []).some(c => filter.excludeColors.includes(c))) return false;
  return true;
}

// ─── Power Mod Helpers ────────────────────────────────────────────────────────

// t: { zone: 'leader'|'character', index: number }
function applyTempKeyword(state, targetOwner, t, keyword) {
  const tps = state[targetOwner];
  if (t.zone === 'leader') {
    return { ...state, [targetOwner]: { ...tps, leader: { ...tps.leader, tempKeywords: [...(tps.leader.tempKeywords ?? []), keyword] } } };
  }
  const newChars = tps.characterArea.map((fc, i) =>
    i === t.index ? { ...fc, tempKeywords: [...(fc.tempKeywords ?? []), keyword] } : fc
  );
  return { ...state, [targetOwner]: { ...tps, characterArea: newChars } };
}

// target: 'leader' | charIndex (number)
function addPowerMod(state, targetOwner, target, delta, until, opts = {}) {
  const ps = state[targetOwner];
  return {
    ...state,
    [targetOwner]: { ...ps, powerMods: [...(ps.powerMods ?? []), { target, delta, until, ...opts }] },
  };
}

export function clearPowerMods(state, owner, until) {
  const ps = state[owner];
  return {
    ...state,
    [owner]: { ...ps, powerMods: (ps.powerMods ?? []).filter(m => m.until !== until) },
  };
}

function addCostMod(state, targetOwner, target, delta, until) {
  const ps = state[targetOwner];
  return {
    ...state,
    [targetOwner]: { ...ps, costMods: [...(ps.costMods ?? []), { target, delta, until }] },
  };
}

export function clearCostMods(state, owner, until) {
  const ps = state[owner];
  return {
    ...state,
    [owner]: { ...ps, costMods: (ps.costMods ?? []).filter(m => m.until !== until) },
  };
}

// When a character is removed from characterArea at `removedIndex`, shift all index-keyed
// power/cost mods: drop mods targeting the removed slot, decrement mods targeting later slots.
export function shiftModsAfterRemoval(mods, removedIndex) {
  if (!mods?.length) return [];
  return mods
    .filter(m => m.target !== removedIndex)
    .map(m => typeof m.target === 'number' && m.target > removedIndex
      ? { ...m, target: m.target - 1 }
      : m
    );
}

function addHandCostMod(state, targetOwner, filter, delta, until) {
  const ps = state[targetOwner];
  return {
    ...state,
    [targetOwner]: { ...ps, handCostMods: [...(ps.handCostMods ?? []), { filter, delta, until }] },
  };
}

export function clearHandCostMods(state, owner, until) {
  const ps = state[owner];
  return {
    ...state,
    [owner]: { ...ps, handCostMods: (ps.handCostMods ?? []).filter(m => m.until !== until) },
  };
}

// ─── Life-card-leave event firing ────────────────────────────────────────────

function markEffectUsedLocal(state, owner, effectKey) {
  const ps = state[owner];
  return { ...state, [owner]: { ...ps, effectUsed: { ...(ps.effectUsed ?? {}), [effectKey]: true } } };
}

// Fire '生命值卡離開時' clauses on all field cards owned by `owner`.
// Only runs when it is the owner's turn (activePlayer === owner).
function fireLifeLeaveEffects(state, owner) {
  if (state.activePlayer !== owner) return state;
  const ps = state[owner];
  let s = state;
  const timing = '生命值卡離開時';

  function fireForCard(card, s2, fieldPos) {
    if (!card?.effect) return s2;
    for (const clause of parseEffect(card.effect)) {
      if (!clause.timings.includes(timing)) continue;
      if (clause.condition && !evaluateCondition(s2, owner, clause.condition)) continue;
      const effectKey = `${card.id}_${timing}`;
      if (clause.oncePerTurn) {
        if (s2[owner]?.effectUsed?.[effectKey]) continue;
        s2 = markEffectUsedLocal(s2, owner, effectKey);
      }
      s2 = executeActionSequence(s2, owner, clause.actions, card, effectKey, fieldPos);
      if (s2.pendingEffect) break;
    }
    return s2;
  }

  s = fireForCard(ps.leader.card, s, { target: 'leader' });
  for (let i = 0; i < ps.characterArea.length; i++) {
    if (s.pendingEffect) break;
    s = fireForCard(ps.characterArea[i].card, s, { target: i });
  }
  return s;
}

// Fire '咚‼卡被放回時' clauses on all field cards owned by `owner` when `count` DON!! were returned.
function fireDonReturnEffects(state, owner, count) {
  const ps = state[owner];
  if (!ps) return state;
  let s = state;
  const timing = '咚‼卡被放回時';
  const activePlayer = state.activePlayer;

  function fireForCard(card, s2, fieldPos) {
    if (!card?.effect) return s2;
    for (const clause of parseEffect(card.effect)) {
      if (!clause.timings.includes(timing)) continue;
      // Respect 我方回合中 / 對方回合中 continuous turn restrictions
      const isOwnTurnOnly = clause.continuous.includes('我方回合中') || clause.continuous.includes('Your Turn');
      const isOppTurnOnly = clause.continuous.includes('對方回合中') || clause.continuous.includes("Opponent's Turn");
      if (isOwnTurnOnly && activePlayer !== owner) continue;
      if (isOppTurnOnly && activePlayer === owner) continue;
      // Default (no restriction): only fire when it's the owner's turn (DON!! returned by own effects)
      if (!isOwnTurnOnly && !isOppTurnOnly && activePlayer !== owner) continue;
      if ((clause.donReturnMinCount ?? 0) > count) continue;
      if (clause.condition && !evaluateCondition(s2, owner, clause.condition)) continue;
      const effectKey = `${card.id}_${timing}`;
      if (clause.oncePerTurn) {
        if (s2[owner]?.effectUsed?.[effectKey]) continue;
        s2 = markEffectUsedLocal(s2, owner, effectKey);
      }
      s2 = executeActionSequence(s2, owner, clause.actions, card, effectKey, fieldPos);
      if (s2.pendingEffect) break;
    }
    return s2;
  }

  s = fireForCard(ps.leader.card, s, { target: 'leader' });
  for (let i = 0; i < ps.characterArea.length; i++) {
    if (s.pendingEffect) break;
    s = fireForCard(ps.characterArea[i].card, s, { target: i });
  }
  return s;
}

// Fire '置為休息狀態時' clauses on a specific card that was just rested.
// Only fires during the card owner's turn (handles 【我方回合中】 scope).
function fireOnRestEffect(state, owner, card, fieldPos) {
  if (!card?.effect) return state;
  if (state.activePlayer !== owner) return state;
  let s = state;
  const timing = '置為休息狀態時';
  for (const clause of parseEffect(card.effect)) {
    if (!clause.timings.includes(timing)) continue;
    if (clause.condition && !evaluateCondition(s, owner, clause.condition)) continue;
    s = executeActionSequence(s, owner, clause.actions, card, `${card.id}_${timing}`, fieldPos);
    if (s.pendingEffect) break;
  }
  return s;
}

// ─── Continuous cost evaluation ──────────────────────────────────────────────

const _SKIP_TIMINGS = new Set(['登場時','KO時','攻擊時','對方攻擊時','防禦時','我方回合結束時','觸發器','啟動主要','起動メイン','主要','反擊']);

/**
 * Sum continuous COST_MOD deltas applied to targetFC by all field cards' continuous effects.
 * Mirrors evaluateGlobalContinuousPower but for cost. Used in KO/SELECT target cost checks.
 */
export function evaluateContinuousCostDelta(targetFC, targetOwner, state) {
  if (!state) return 0;
  const activePlayer = state.activePlayer;
  let delta = 0;
  for (const srcOwner of [PLAYER.HUMAN, PLAYER.AI]) {
    const ps = state[srcOwner];
    for (const srcFC of [ps.leader, ...(ps.characterArea ?? [])]) {
      if (!srcFC?.card?.effect) continue;
      const clauses = parseEffect(srcFC.card.effect);
      for (const clause of clauses) {
        if (clause.timings.some(t => _SKIP_TIMINGS.has(t))) continue;
        if (clause.passive.length > 0) continue;
        if (clause.continuous.includes('對方回合中') && activePlayer === srcOwner) continue;
        if (clause.continuous.includes('我方回合中') && activePlayer !== srcOwner) continue;
        if (clause.donGate !== null && (srcFC.attachedDon ?? 0) < clause.donGate) continue;
        if (clause.condition && !evaluateCondition(state, srcOwner, clause.condition, null, true)) continue;
        for (const action of clause.actions) {
          if (action.type !== 'COST_MOD' || action.until !== 'continuous') continue;
          const fo = action.filter?.owner;
          if (fo === 'opponent' && targetOwner === srcOwner) continue;
          if ((fo === 'self' || fo === 'owner') && targetOwner !== srcOwner) continue;
          if (action.filter?.self && srcFC !== targetFC) continue;
          if (matchesFilter(targetFC.card, action.filter)) delta += action.delta;
        }
      }
    }
  }
  return delta;
}

// ─── Action Executor ─────────────────────────────────────────────────────────

/**
 * Execute one parsed action.
 * Interactive effects return state with pendingEffect set.
 *
 * @param {object}   state        current game state
 * @param {string}   owner        card's controller
 * @param {object}   action       { type, ... } from effectParser
 * @param {object}   sourceCard   raw card object (for names in logs)
 * @param {string}   effectKey    unique key for once-per-turn tracking
 * @param {object[]} continuation remaining actions to execute after this
 * @param {object}   fieldPos     { target: 'leader'|number } — card's field position
 */
export function executeAction(state, owner, action, sourceCard, effectKey, continuation = [], fieldPos = null) {
  const opponent = opp(owner);

  switch (action.type) {

    case 'CONDITIONAL_EXEC': {
      if (!evaluateCondition(state, owner, action.condition)) {
        return executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos);
      }
      return executeActionSequence(state, owner, [...action.actions, ...continuation], sourceCard, effectKey, fieldPos);
    }

    case 'CONFIRM_OPTIONAL_ACTIVATION':
      if (!shouldPrompt(owner, state)) return state; // AI (non-pvp): no-op, loop continues to cost actions
      return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
        type: 'CONFIRM_OPTIONAL_ACTIVATION',
        costDescription: action.costDescription,
      }, fieldPos);

    case 'DRAW': {
      const handBefore = state[owner].hand.length;
      const s = execDraw(state, owner, action.count, sourceCard.name);
      return { ...s, _lastDrawnCount: s[owner].hand.length - handBefore };
    }

    case 'DRAW_PER_RETURNED': {
      const count = state[owner].lastReturnedToDeckCount ?? 0;
      if (count === 0) return state;
      const handBefore = state[owner].hand.length;
      const s = execDraw(state, owner, count, sourceCard.name);
      return { ...s, [owner]: { ...s[owner], lastReturnedToDeckCount: 0 }, _lastDrawnCount: s[owner].hand.length - handBefore };
    }

    case 'DRAW_TO_SIZE': {
      const current = state[owner].hand.length;
      const needed = (action.targetSize ?? 0) - current;
      if (needed <= 0) return state;
      const handBefore = state[owner].hand.length;
      const s = execDraw(state, owner, needed, sourceCard.name);
      return { ...s, _lastDrawnCount: s[owner].hand.length - handBefore };
    }

    case 'SELF_DEPLOY': {
      const ps = state[owner];
      if (ps.characterArea.length >= 5) return state;
      const deployCard = sourceCard._originalCard ?? sourceCard;
      const fieldCard = { card: deployCard, state: 'active', attachedDon: 0, justDeployed: false };
      return addLog({
        ...state,
        pendingOpponentDeployTrigger: state.pendingOpponentDeployTrigger ?? { card: deployCard, deployOwner: owner, isViaCharEffect: true },
        pendingOnPlayTriggers: [...(state.pendingOnPlayTriggers ?? []), { card: deployCard, owner }],
        [owner]: { ...ps, characterArea: [...ps.characterArea, fieldCard] },
      }, `${cn(sourceCard)} deployed via trigger.`, 'action');
    }

    case 'SELF_DEPLOY_FROM_TRASH': {
      const trashIndex = state[owner].trash.findIndex(c => c.id === sourceCard.id);
      if (trashIndex === -1) return state;
      const s = execDeployFromTrash(state, owner, trashIndex, sourceCard.name, action.deployState);
      return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'POWER_MOD': {
      if (action.until === 'continuous') return state; // evaluated dynamically in calcPower

      if (action.filter?.self) {
        if (!fieldPos) return state;
        const modOpts = action.setToZero ? { setToZero: true } : {};
        const logMsg = action.setToZero
          ? `${cn(sourceCard)}: power set to 0 (${action.until}).`
          : `${cn(sourceCard)}: ${action.delta > 0 ? '+' : ''}${action.delta} power (${action.until}).`;
        return addLog(
          addPowerMod(state, owner, fieldPos.target, action.delta ?? 0, action.until, modOpts),
          logMsg, 'action'
        );
      }

      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const tps = state[targetOwner];
      const targets = [];
      if ((action.filter?.includesLeader || action.filter?.category === 'Leader') && matchesFilter(tps.leader?.card, action.filter))
        targets.push({ zone: 'leader', index: -1, card: tps.leader.card });
      tps.characterArea.forEach((fc, i) => {
        if (matchesFilter(fc.card, action.filter, fc))
          targets.push({ zone: 'character', index: i, card: fc.card });
      });

      if (!targets.length) return state;

      const effectiveCount = action.count ?? 1;
      const modOpts = action.setToZero ? { setToZero: true } : {};
      const applyMod = (s, t) =>
        addPowerMod(s, targetOwner, t.zone === 'leader' ? 'leader' : t.index, action.delta ?? 0, action.until, modOpts);

      // Mass power mod: apply to all matched targets without prompting
      if (effectiveCount >= targets.length) {
        let s = state;
        const names = [];
        for (const t of targets) {
          s = applyMod(s, t);
          if (action.grantKeyword) s = applyTempKeyword(s, targetOwner, t, action.grantKeyword);
          names.push(cn(t.card));
        }
        const massLog = action.setToZero
          ? `${cn(sourceCard)}: power set to 0 for ${names.join(', ')} (${action.until}).`
          : `${cn(sourceCard)}: ${action.delta > 0 ? '+' : ''}${action.delta} to ${names.join(', ')} (${action.until}).`;
        return addLog(s, massLog, 'action');
      }

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_POWER_TARGET',
          targetOwner,
          targets: targets.map(t => ({ zone: t.zone, index: t.index })),
          max: effectiveCount,
        }, fieldPos);
      }
      // AI: pick highest-power target (maximises impact whether debuffing enemy or buffing own)
      const aiTarget = [...targets].sort((a, b) => (b.card.power ?? 0) - (a.card.power ?? 0))[0];
      let s0 = applyMod(state, aiTarget);
      if (action.grantKeyword) s0 = applyTempKeyword(s0, targetOwner, aiTarget, action.grantKeyword);
      const aiLog = action.setToZero
        ? `${cn(sourceCard)}: power set to 0 on ${cn(aiTarget.card)} (${action.until}).`
        : `${cn(sourceCard)}: power ${action.delta > 0 ? '+' : ''}${action.delta} on ${cn(aiTarget.card)} (${action.until}).`;
      return addLog(s0, aiLog, 'action');
    }

    case 'POWER_SET': {
      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const tps = state[targetOwner];
      const untilKey = action.until === 'nextOppTurnEnd' ? 'opponent_turn_end' : (action.until ?? 'turn');
      if (action.filter?.category === 'Leader' && matchesFilter(tps.leader?.card, action.filter)) {
        const s = addLog(
          addPowerMod(state, targetOwner, 'leader', 0, untilKey, { setBase: action.power }),
          `${cn(sourceCard)}: ${cn(tps.leader.card)} base power becomes ${action.power} until opponent's next End Phase.`,
          'action'
        );
        return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
      }
      return executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'COST_MOD': {
      if (action.until === 'continuous') return executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos); // evaluated dynamically by evaluateContinuousCostDelta
      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const tps = state[targetOwner];
      const targets = tps.characterArea
        .map((fc, i) => ({ fc, i }))
        .filter(({ fc }) => matchesFilter(fc.card, action.filter, fc));

      if (!targets.length) return state;

      const effectiveCount = action.count ?? 1;

      if (effectiveCount >= targets.length) {
        let s = state;
        const names = [];
        for (const { i, fc } of targets) {
          s = addCostMod(s, targetOwner, i, action.delta, action.until);
          names.push(cn(fc.card));
        }
        return addLog(s,
          `${cn(sourceCard)}: cost ${action.delta > 0 ? '+' : ''}${action.delta} on ${names.join(', ')} (${action.until}).`,
          'action');
      }

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_COST_TARGET',
          targetOwner,
          indices: targets.map(t => t.i),
          max: effectiveCount,
        }, fieldPos);
      }
      return addLog(
        addCostMod(state, targetOwner, targets[0].i, action.delta, action.until),
        `${cn(sourceCard)}: cost ${action.delta > 0 ? '+' : ''}${action.delta} on ${cn(tps.characterArea[targets[0].i].card)} (${action.until}).`, 'action'
      );
    }

    case 'COST_SET': {
      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const tps = state[targetOwner];
      const targets = tps.characterArea
        .map((fc, i) => ({ fc, i }))
        .filter(({ fc }) => matchesFilter(fc.card, action.filter, fc));

      if (!targets.length) return state;

      const effectiveCount = action.count ?? 1;

      if (effectiveCount >= targets.length) {
        let s = state;
        const names = [];
        for (const { i, fc } of targets) {
          const delta = action.targetCost - (fc.card.cost ?? 0);
          s = addCostMod(s, targetOwner, i, delta, action.until);
          names.push(cn(fc.card));
        }
        return addLog(s,
          `${cn(sourceCard)}: cost set to ${action.targetCost} on ${names.join(', ')} (${action.until}).`,
          'action');
      }

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_COST_SET_TARGET',
          targetOwner,
          indices: targets.map(t => t.i),
          max: effectiveCount,
        }, fieldPos);
      }
      const { i: autoI, fc: autoFc } = targets[0];
      const autoDelta = action.targetCost - (autoFc.card.cost ?? 0);
      return addLog(
        addCostMod(state, targetOwner, autoI, autoDelta, action.until),
        `${cn(sourceCard)}: cost set to ${action.targetCost} on ${cn(autoFc.card)} (${action.until}).`, 'action'
      );
    }

    case 'HAND_COST_MOD': {
      const s = addHandCostMod(state, owner, action.filter, action.delta, action.until);
      return addLog(s,
        `${cn(sourceCard)}: play cost ${action.delta > 0 ? '+' : ''}${action.delta} for matching hand cards (${action.until}).`,
        'action');
    }

    case 'REST': {
      // Self-rest: automatically rest the source card (no player choice needed)
      if (action.filter?.self) {
        if (!fieldPos) return executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos);
        const tps = state[owner];
        if (fieldPos.target === 'leader') {
          return addLog({ ...state, [owner]: { ...tps, leader: { ...tps.leader, state: 'rest' } } }, `${cn(sourceCard)}: rested itself.`, 'action');
        }
        if (fieldPos.target === 'stage') {
          return addLog({ ...state, [owner]: { ...tps, stageArea: { ...tps.stageArea, state: 'rest' } } }, `${cn(sourceCard)}: rested itself.`, 'action');
        }
        const idx = fieldPos.target;
        const newChars = tps.characterArea.map((fc, i) =>
          i === idx ? { ...fc, state: 'rest' } : fc
        );
        return addLog({ ...state, [owner]: { ...tps, characterArea: newChars } }, `${cn(sourceCard)}: rested itself.`, 'action');
      }

      // DON!! rest: own active DON!! cards from the cost area.
      // Fires when no owner is set (activation costs) or owner:'self' (effect-body rests).
      // Effects targeting the *opponent's* DON have owner:'opponent' and fall through to below.
      if (action.filter?.cardType === 'don' && (!action.filter?.owner || action.filter?.owner === 'self')) {
        const tps = state[owner];
        const activeDon = tps.costArea.filter(d => d.state === 'active');

        // Variable-count (任意張數): player picks how many to rest
        if (action.count === Infinity) {
          if (!activeDon.length) return executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos);
          if (shouldPrompt(owner, state)) {
            const targets = activeDon.map(d => ({ zone: 'don', donId: d._donId }));
            return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
              type: 'CHOOSE_REST_TARGET',
              targetOwner: owner,
              targets,
              max: activeDon.length,
              optional: true,
            }, fieldPos);
          }
          // AI: rest all active DON!! (maximise the power boost)
          let s = state;
          for (const d of activeDon) s = execRestTarget(s, owner, { zone: 'don', donId: d._donId }, sourceCard.name);
          return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
        }

        // Fixed count — existing behaviour (e.g. activation costs)
        const needed = action.count ?? 1;
        if (activeDon.length < needed) return state;
        const toRest = new Set(activeDon.slice(0, needed).map(d => d._donId));
        return addLog({
          ...state,
          [owner]: { ...tps, costArea: tps.costArea.map(d => toRest.has(d._donId) ? { ...d, state: 'rest' } : d) },
        }, `${cn(sourceCard)}: rested ${needed} DON!!.`, 'action');
      }

      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;

      // "Any of your field cards" — no category/cardType/zone restriction on own cards
      const noRestriction = !action.filter?.category && !action.filter?.cardType &&
                            !action.filter?.zone && !action.filter?.self;
      if (targetOwner === owner && noRestriction) {
        const tps = state[owner];
        const allTargets = [];
        if (tps.leader?.state === 'active')
          allTargets.push({ zone: 'leader', card: tps.leader.card });
        tps.characterArea.forEach((fc, i) => {
          if (fc.state === 'active') allTargets.push({ zone: 'character', index: i, card: fc.card });
        });
        if (tps.stageArea?.state === 'active')
          allTargets.push({ zone: 'stage', card: tps.stageArea.card });
        tps.costArea.filter(d => d.state === 'active').forEach(d =>
          allTargets.push({ zone: 'don', donId: d._donId })
        );
        if (!allTargets.length) return state;
        if (shouldPrompt(owner, state)) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_REST_TARGET',
            targetOwner: owner,
            targets: allTargets,
            max: action.count ?? 1,
            cancelable: true,
          }, fieldPos);
        }
        // AI: prefer resting a character, then leader, then stage, then DON
        const aiPick = allTargets.find(t => t.zone === 'character')
          ?? allTargets.find(t => t.zone === 'stage')
          ?? allTargets.find(t => t.zone === 'don')
          ?? allTargets[0];
        return execRestTarget(state, owner, aiPick, sourceCard.name);
      }

      // "Any of opponent's field cards" — no category/cardType restriction, zone is field (or unspecified)
      // e.g. OP15-032: rest 1 of opponent's cards (leader, character, stage, or DON!!)
      const isAnyOpponentField = targetOwner !== owner
        && !action.filter?.category
        && !action.filter?.cardType
        && (action.filter?.zone === 'field' || !action.filter?.zone);
      if (isAnyOpponentField) {
        const tps = state[targetOwner];
        const allTargets = [];
        if (tps.leader?.state === 'active')
          allTargets.push({ zone: 'leader', card: tps.leader.card });
        tps.characterArea.forEach((fc, i) => {
          if (fc.state === 'active') allTargets.push({ zone: 'character', index: i, card: fc.card });
        });
        if (tps.stageArea?.state === 'active')
          allTargets.push({ zone: 'stage', card: tps.stageArea.card });
        tps.costArea.filter(d => d.state === 'active').forEach(d =>
          allTargets.push({ zone: 'don', donId: d._donId })
        );
        if (!allTargets.length) return state;
        if (shouldPrompt(owner, state)) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_REST_TARGET',
            targetOwner,
            targets: allTargets,
            max: action.count ?? 1,
          }, fieldPos);
        }
        // AI: prefer resting a character (highest-cost first), then leader, then stage, then DON!!
        const charTargets = allTargets.filter(t => t.zone === 'character')
          .sort((a, b) => (b.card?.cost ?? 0) - (a.card?.cost ?? 0));
        const aiPick = charTargets[0]
          ?? allTargets.find(t => t.zone === 'leader')
          ?? allTargets.find(t => t.zone === 'stage')
          ?? allTargets.find(t => t.zone === 'don')
          ?? allTargets[0];
        return execRestTarget(state, targetOwner, aiPick, sourceCard.name);
      }

      // Opponent Character-or-DON targeting: when filter has category='Character' AND cardType='don',
      // the effect can target either opponent Characters or opponent DON!! cards (e.g. OP06-035).
      const isCharOrDonOpponent = targetOwner !== owner
        && action.filter?.category === 'Character'
        && action.filter?.cardType === 'don';
      if (isCharOrDonOpponent) {
        const tps = state[targetOwner];
        const allTargets = [];
        tps.characterArea.forEach((fc, i) => {
          if (fc.state === 'active') allTargets.push({ zone: 'character', index: i, card: fc.card });
        });
        tps.costArea.filter(d => d.state === 'active').forEach(d =>
          allTargets.push({ zone: 'don', donId: d._donId })
        );
        if (!allTargets.length) return state;
        const maxCount = action.count ?? 1;
        if (shouldPrompt(owner, state)) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_REST_TARGET',
            targetOwner,
            targets: allTargets,
            max: maxCount,
          }, fieldPos);
        }
        // AI: prefer resting characters (highest-cost first) over DON!!
        let s = state;
        const picks = [
          ...allTargets.filter(t => t.zone === 'character')
            .sort((a, b) => (b.card?.cost ?? 0) - (a.card?.cost ?? 0)),
          ...allTargets.filter(t => t.zone === 'don'),
        ].slice(0, maxCount);
        for (const pick of picks) {
          s = execRestTarget(s, targetOwner, pick, sourceCard.name);
        }
        return s;
      }

      const tps = state[targetOwner];

      // Leader-or-Character targeting (includesLeader: true): build an all-zone targets list
      if (action.filter?.includesLeader) {
        const allTargets = [];
        if (tps.leader?.state === 'active' && matchesFilter(tps.leader.card, action.filter, tps.leader))
          allTargets.push({ zone: 'leader', card: tps.leader.card });
        tps.characterArea.forEach((fc, i) => {
          if (fc.state === 'active' && matchesFilter(fc.card, action.filter, fc))
            allTargets.push({ zone: 'character', index: i, card: fc.card });
        });
        if (!allTargets.length) return executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos);
        if (shouldPrompt(owner, state)) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_REST_TARGET',
            targetOwner,
            targets: allTargets,
            max: action.count ?? 1,
          }, fieldPos);
        }
        // AI: prefer highest-cost character, then leader
        const charTargets = allTargets
          .filter(t => t.zone === 'character')
          .sort((a, b) => (b.card?.cost ?? 0) - (a.card?.cost ?? 0));
        const aiPick = charTargets[0] ?? allTargets.find(t => t.zone === 'leader');
        return executeActionSequence(
          execRestTarget(state, targetOwner, aiPick, sourceCard.name),
          owner, continuation, sourceCard, effectKey, fieldPos
        );
      }

      const targets = tps.characterArea
        .map((fc, i) => ({ fc, i }))
        .filter(({ fc }) => matchesFilter(fc.card, action.filter, fc));

      if (!targets.length) return state;

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_REST_TARGET',
          targetOwner,
          indices: targets.map(t => t.i),
          max: action.count ?? 1,
        }, fieldPos);
      }
      // AI: rest highest-cost active target
      targets.sort((a, b) => (b.fc.card.cost ?? 0) - (a.fc.card.cost ?? 0));
      const newChars = tps.characterArea.map((fc, i) =>
        i === targets[0].i ? { ...fc, state: 'rest', ...(action.lockNextRefresh ? { refreshLocked: true } : {}) } : fc
      );
      return addLog({
        ...state,
        [targetOwner]: { ...tps, characterArea: newChars },
      }, `${cn(sourceCard)}: ${cn(tps.characterArea[targets[0].i].card)} rested${action.lockNextRefresh ? ' (locked next refresh)' : ''}.`, 'action');
    }

    case 'REFRESH_LOCK': {
      const targetOwner = opponent;
      const tps = state[targetOwner];

      const applyRefreshLockTarget = (s, o, t) => {
        const tps2 = s[o];
        if (t.zone === 'leader') {
          return addLog({
            ...s,
            [o]: { ...tps2, leader: { ...tps2.leader, refreshLocked: true } },
          }, `${cn(tps2.leader.card)}: will not refresh next turn.`, 'action');
        }
        if (t.zone === 'don') {
          return addLog({
            ...s,
            [o]: { ...tps2, costArea: tps2.costArea.map(d =>
              d._donId === t.donId ? { ...d, refreshLocked: true } : d
            ) },
          }, `DON!!: will not refresh next turn.`, 'action');
        }
        return addLog({
          ...s,
          [o]: { ...tps2, characterArea: tps2.characterArea.map((fc, idx) =>
            idx === t.index ? { ...fc, refreshLocked: true } : fc
          ) },
        }, `${cn(tps2.characterArea[t.index].card)}: will not refresh next turn.`, 'action');
      };

      // Build all-zone targets list (characters + rested DON!! when filter includes both)
      const isCharOrDon = action.filter?.category === 'Character' && action.filter?.cardType === 'don';
      const allTargets = [];
      if (action.filter?.includesLeader && tps.leader && matchesFilter(tps.leader.card, action.filter, tps.leader)) {
        allTargets.push({ zone: 'leader' });
      }
      tps.characterArea.forEach((fc, i) => {
        if (matchesFilter(fc.card, action.filter, fc)) allTargets.push({ zone: 'character', index: i, card: fc.card });
      });
      if (isCharOrDon) {
        tps.costArea.filter(d => d.state === 'rest').forEach(d =>
          allTargets.push({ zone: 'don', donId: d._donId })
        );
      }

      if (!allTargets.length) return state;

      // "全數" (all) — lock every matching target, no player choice
      if (action.count === Infinity) {
        let s = state;
        for (const t of allTargets) s = applyRefreshLockTarget(s, targetOwner, t);
        return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
      }

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_REFRESH_LOCK_TARGET',
          targetOwner,
          targets: allTargets,
          max: action.count ?? 1,
        }, fieldPos);
      }
      // AI: prefer locking characters (highest-cost first) over DON!!
      const aiPicks = [
        ...allTargets.filter(t => t.zone === 'character').sort((a, b) => (b.card?.cost ?? 0) - (a.card?.cost ?? 0)),
        ...allTargets.filter(t => t.zone === 'don'),
        ...allTargets.filter(t => t.zone === 'leader'),
      ].slice(0, action.count ?? 1);
      let s = state;
      for (const t of aiPicks) s = applyRefreshLockTarget(s, targetOwner, t);
      return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'ATTACK_LOCK': {
      const targetOwner = opponent;
      const tps = state[targetOwner];
      const targets = tps.characterArea
        .map((fc, i) => ({ fc, i }))
        .filter(({ fc }) => matchesFilter(fc.card, action.filter, fc));

      if (!targets.length) return state;

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_ATTACK_LOCK_TARGET',
          targetOwner,
          indices: targets.map(t => t.i),
          max: action.count ?? 1,
        }, fieldPos);
      }
      // AI: lock highest-cost targets first
      targets.sort((a, b) => (b.fc.card.cost ?? 0) - (a.fc.card.cost ?? 0));
      let s = state;
      for (const { i } of targets.slice(0, action.count ?? 1)) {
        const tps2 = s[targetOwner];
        s = addLog({
          ...s,
          [targetOwner]: { ...tps2, characterArea: tps2.characterArea.map((fc, idx) =>
            idx === i ? { ...fc, attackLocked: true } : fc
          ) },
        }, `${cn(tps2.characterArea[i].card)}: cannot attack until end of opponent's turn.`, 'action');
      }
      return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'PREVENT_REST': {
      const targetOwner = opponent;
      const tps = state[targetOwner];
      const targets = tps.characterArea
        .map((fc, i) => ({ fc, i }))
        .filter(({ fc }) => matchesFilter(fc.card, action.filter, fc));

      if (!targets.length) return state;

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_PREVENT_REST_TARGET',
          targetOwner,
          indices: targets.map(t => t.i),
          max: action.count ?? 1,
        }, fieldPos);
      }
      // AI: lock highest-cost targets first
      targets.sort((a, b) => (b.fc.card.cost ?? 0) - (a.fc.card.cost ?? 0));
      let s = state;
      for (const { i } of targets.slice(0, action.count ?? 1)) {
        const tps2 = s[targetOwner];
        s = addLog({
          ...s,
          [targetOwner]: { ...tps2, characterArea: tps2.characterArea.map((fc, idx) =>
            idx === i ? { ...fc, restLocked: true } : fc
          ) },
        }, `${cn(tps2.characterArea[i].card)}: cannot be rested until end of next turn.`, 'action');
      }
      return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'KO': {
      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const tps = state[targetOwner];

      // Resolve dynamic cost bound: "cost ≤ opponent's current life count"
      let koFilter = action.filter;
      if (action.filter?.maxCostByOpponentLifeCount) {
        const lifeCount = state[targetOwner].lifeArea?.length ?? 0;
        koFilter = { ...action.filter, cost: lifeCount, costOp: 'lte', maxCostByOpponentLifeCount: undefined };
      }

      const targets = tps.characterArea
        .map((fc, i) => ({
          fc, i,
          // Use effective power/cost (base + mods) so post-POWER_MOD / post-COST_MOD thresholds are correct
          power: (fc.card.power ?? 0) + (tps.powerMods ?? [])
            .filter(m => m.target === i)
            .reduce((acc, m) => acc + m.delta, 0),
          effectiveCost: Math.max(0, (fc.card.cost ?? 0) + (tps.costMods ?? [])
            .filter(m => m.target === i)
            .reduce((acc, m) => acc + m.delta, 0) + evaluateContinuousCostDelta(fc, targetOwner, state)),
        }))
        .filter(({ fc, power, effectiveCost }) => matchesFilter(fc.card, koFilter, fc, power, effectiveCost))
        // Exclude characters protected from effect-based KO this turn
        .filter(({ fc }) => !fc.tempKeywords?.includes('MASS_EFFECT_KO_PROTECTION') && !fc.opponentTurnEndKeywords?.includes('MASS_EFFECT_KO_PROTECTION'));

      if (!targets.length) return executeActionSequence(
        addLog(state, `${cn(sourceCard)}: no eligible KO targets.`, 'action'),
        owner, continuation, sourceCard, effectKey, fieldPos
      );

      const effectiveCount = action.count ?? 1;

      // Mass KO: remove all matched targets without prompting (KO from highest index to preserve earlier indices)
      if (effectiveCount >= targets.length) {
        let s = state;
        for (const { i } of [...targets].sort((a, b) => b.i - a.i)) {
          s = execKO(s, targetOwner, i, sourceCard.name);
        }
        return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
      }

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_KO_TARGET',
          targetOwner,
          indices: targets.map(t => t.i),
          max: effectiveCount,
        }, fieldPos);
      }
      // AI: KO highest-power target
      const best = [...targets].sort((a, b) => b.power - a.power)[0];
      return executeActionSequence(execKO(state, targetOwner, best.i, sourceCard.name), owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'CONDITIONAL_KO': {
      // "Select up to N of opponent's rested characters. If chosen character's cost == attachedDon, KO it."
      const targetOwner = opponent;
      const tps = state[targetOwner];
      const filterNoOwner = { ...action.filter, owner: undefined };
      const targets = tps.characterArea
        .map((fc, i) => ({ fc, i }))
        .filter(({ fc }) => matchesFilter(fc.card, filterNoOwner, fc));

      if (!targets.length) return executeActionSequence(
        addLog(state, `${cn(sourceCard)}: no eligible targets.`, 'action'),
        owner, continuation, sourceCard, effectKey, fieldPos
      );

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_CONDITIONAL_KO_TARGET',
          targetOwner,
          indices: targets.map(t => t.i),
        }, fieldPos);
      }
      // AI: pick a target that meets the condition; if none qualifies, skip
      const condMet = targets.filter(t => t.fc.card.cost === t.fc.attachedDon);
      if (!condMet.length) return executeActionSequence(
        addLog(state, `${cn(sourceCard)}: no target meets the condition, skipping.`, 'action'),
        owner, continuation, sourceCard, effectKey, fieldPos
      );
      const best = condMet.sort((a, b) => (b.fc.card.power ?? 0) - (a.fc.card.power ?? 0))[0];
      return executeActionSequence(
        execKO(state, targetOwner, best.i, sourceCard.name),
        owner, continuation, sourceCard, effectKey, fieldPos
      );
    }

    case 'KO_OR_DISCARD_HAND': {
      // Player chooses: KO a matching field character from their side, OR discard a hand card.
      const ps = state[owner];
      const fieldFilter = { ...action.filter, zone: undefined };
      const fieldTargets = ps.characterArea
        .map((fc, i) => ({ i, fc }))
        .filter(({ fc }) => matchesFilter(fc.card, fieldFilter, fc))
        .map(({ i }) => ({ charIndex: i }));
      const handIndices = ps.hand.map((_, i) => i);

      if (!fieldTargets.length && !handIndices.length) return state;

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_KO_OR_DISCARD_HAND',
          fieldTargets,
          handIndices,
        }, fieldPos);
      }
      // AI: prefer KO a field character, else discard lowest-cost hand card
      if (fieldTargets.length) {
        return execKO(state, owner, fieldTargets[0].charIndex, sourceCard.name);
      }
      const worstIdx = handIndices.reduce((best, i) =>
        (ps.hand[i].cost ?? 0) <= (ps.hand[best].cost ?? 0) ? i : best, handIndices[0]);
      const discarded = ps.hand[worstIdx];
      return addLog({
        ...state,
        [owner]: { ...ps, hand: ps.hand.filter((_, i) => i !== worstIdx), trash: [...ps.trash, discarded] },
      }, `${cn(sourceCard)}: discarded ${cn(discarded)} from hand.`, 'action');
    }

    case 'RETURN_HAND': {
      // Self-bounce: filter.self = true means "this card" (the activating card itself)
      if (action.filter?.self && fieldPos?.zone === 'character') {
        return execReturnHand(state, owner, fieldPos.index, sourceCard.name);
      }

      // Build candidate target list from one or both sides
      const filterNoMeta = { ...action.filter, owner: undefined, zone: undefined, self: undefined, excludeSelf: undefined };
      const sides =
        action.filter?.owner === 'opponent' ? [opponent] :
        action.filter?.owner === 'self'     ? [owner]    : [owner, opponent];

      const targets = [];
      for (const p of sides) {
        state[p].characterArea.forEach((fc, i) => {
          if (action.filter?.excludeSelf && p === owner && typeof fieldPos?.target === 'number' && i === fieldPos.target) return;
          if (matchesFilter(fc.card, filterNoMeta, fc, fc.card.power ?? 0))
            targets.push({ owner: p, charIndex: i });
        });
      }

      if (!targets.length) return state;

      const effectiveCount = Math.min(action.count ?? 1, targets.length);

      // "對手將...放回" — opponent (not activating player) chooses which of their own cards to return
      const chooser = action.chooser === 'opponent' ? opponent : owner;
      if (shouldPrompt(chooser, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_RETURN_HAND_TARGET',
          targets,
          max: effectiveCount,
          promptPlayer: chooser,
        }, fieldPos);
      }

      // Auto-resolve: if opponent is the chooser, they return their own lowest-cost character;
      // otherwise activating player bounces opponent's highest-cost character.
      let pick;
      if (action.chooser === 'opponent') {
        pick = [...targets].sort((a, b) =>
          (state[a.owner].characterArea[a.charIndex].card.cost ?? 0) - (state[b.owner].characterArea[b.charIndex].card.cost ?? 0)
        )[0];
      } else {
        const opponentTargets = targets.filter(t => t.owner === opponent);
        const pool = opponentTargets.length ? opponentTargets : targets;
        pick = [...pool].sort((a, b) =>
          opponentTargets.length
            ? (state[b.owner].characterArea[b.charIndex].card.cost ?? 0) - (state[a.owner].characterArea[a.charIndex].card.cost ?? 0)
            : (state[a.owner].characterArea[a.charIndex].card.power ?? 0) - (state[b.owner].characterArea[b.charIndex].card.power ?? 0)
        )[0];
      }
      return execReturnHand(state, pick.owner, pick.charIndex, sourceCard.name);
    }

    case 'DEPLOY': {
      const srcOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const ps = state[srcOwner];
      const fromZone = action.filter?.zone;
      const fromTrash = fromZone === 'trash';

      // Resolve dynamic cost bound (e.g. "cost ≤ number of DON!! on field")
      let resolvedFilter = action.filter;
      if (resolvedFilter?.differentColorFromLastReturned) {
        const excludeColors = state._lastReturnedColors ?? [];
        resolvedFilter = { ...resolvedFilter, differentColorFromLastReturned: undefined, excludeColors };
      }
      if (action.filter?.maxCostByFieldDonCount) {
        const fieldDonCount = state[owner].costArea.length;
        resolvedFilter = { ...action.filter, cost: fieldDonCount, costOp: 'lte' };
      } else if (action.filter?.orFilters?.some(f => f.maxCostByFieldDonCount)) {
        const fieldDonCount = state[owner].costArea.length;
        resolvedFilter = {
          ...action.filter,
          orFilters: action.filter.orFilters.map(f =>
            f.maxCostByFieldDonCount
              ? { ...f, cost: fieldDonCount, costOp: 'lte', maxCostByFieldDonCount: undefined }
              : f
          ),
        };
      }

      // "hand or trash" — two-step UI: first pick zone, then pick card
      if (fromZone === 'hand_or_trash') {
        const handTargets  = ps.hand.map((c, i) => ({ c, i })).filter(({ c }) => matchesFilter(c, resolvedFilter, null, c.power ?? 0));
        const trashTargets = ps.trash.map((c, i) => ({ c, i })).filter(({ c }) => matchesFilter(c, resolvedFilter, null, c.power ?? 0));
        if (!handTargets.length && !trashTargets.length) return state;
        if (shouldPrompt(owner, state)) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_DEPLOY_FROM_HAND_OR_TRASH',
            sourceOwner: srcOwner,
            handIndices:  handTargets.map(t => t.i),
            trashIndices: trashTargets.map(t => t.i),
            max: action.count ?? 1,
            uniqueName: resolvedFilter?.uniqueName ?? false,
          }, fieldPos);
        }
        // AI: deploy highest-cost card from either zone
        const bestH = handTargets.length  ? [...handTargets].sort((a, b)  => (b.c.cost ?? 0) - (a.c.cost ?? 0))[0] : null;
        const bestT = trashTargets.length ? [...trashTargets].sort((a, b) => (b.c.cost ?? 0) - (a.c.cost ?? 0))[0] : null;
        if (!bestH && !bestT) return state;
        if (!bestH) return execDeployFromTrash(state, srcOwner, bestT.i, sourceCard.name);
        if (!bestT) return execDeploy(state, srcOwner, bestH.i, sourceCard.name);
        return (bestH.c.cost ?? 0) >= (bestT.c.cost ?? 0)
          ? execDeploy(state, srcOwner, bestH.i, sourceCard.name)
          : execDeployFromTrash(state, srcOwner, bestT.i, sourceCard.name);
      }

      const pool = fromTrash ? ps.trash : ps.hand;
      const targets = pool
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => matchesFilter(c, resolvedFilter, null, c.power ?? 0));

      if (!targets.length) return state;

      let handDeployState = resolvedFilter?.state ?? 'active';
      if (handDeployState === 'active') {
        const leaderPassives = parseEffect(state[owner].leader?.card?.effect ?? '');
        if (leaderPassives.some(cl => cl.actions?.some(a => a.type === 'DEPLOY_RESTED_PASSIVE'))) {
          handDeployState = 'rest';
        }
      }
      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: fromTrash ? 'CHOOSE_DEPLOY_FROM_TRASH' : 'CHOOSE_DEPLOY_FROM_HAND',
          sourceOwner: srcOwner,
          indices: targets.map(t => t.i),
          max: action.count ?? 1,
          uniqueName: resolvedFilter?.uniqueName ?? false,
          deployState: handDeployState,
        }, fieldPos);
      }
      // AI: deploy highest-cost match
      const best = [...targets].sort((a, b) => (b.c.cost ?? 0) - (a.c.cost ?? 0))[0];
      if (fromTrash) return execDeployFromTrash(state, srcOwner, best.i, sourceCard.name);
      return execDeploy(state, srcOwner, best.i, sourceCard.name, handDeployState);
    }

    case 'DISCARD': {
      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const ps = state[targetOwner];

      // Trash a character from the character area (e.g. "將1張自己的角色卡放置在廢棄區")
      if (action.filter?.zone === 'field') {
        const filterNoZone = { ...action.filter, zone: undefined, owner: undefined };
        const fieldTargets = ps.characterArea
          .map((fc, i) => ({ fc, i }))
          .filter(({ fc }) => matchesFilter(fc.card, filterNoZone, fc));

        if (!fieldTargets.length) return state;

        if (shouldPrompt(owner, state) && fieldTargets.length >= action.count) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_DISCARD',
            fromZone: 'field',
            indices: fieldTargets.map(t => t.i),
            count: action.count,
          }, fieldPos);
        }
        // AI: trash lowest-cost character; process highest index first to keep earlier indices stable
        const sortedAsc = [...fieldTargets].sort((a, b) => (a.fc.card.cost ?? 0) - (b.fc.card.cost ?? 0));
        const toTrash = sortedAsc.slice(0, action.count);
        const sortedDesc = [...toTrash].sort((a, b) => b.i - a.i);
        let ps2 = ps;
        for (const { i, fc } of sortedDesc) {
          const returnedDon = Array.from({ length: fc.attachedDon ?? 0 }, (_, k) =>
            ({ ...makeDon(`trash-field-${i}-${k}`), state: 'rest' })
          );
          ps2 = {
            ...ps2,
            characterArea: ps2.characterArea.filter((_, idx) => idx !== i),
            powerMods: shiftModsAfterRemoval(ps2.powerMods ?? [], i),
            costMods:  shiftModsAfterRemoval(ps2.costMods  ?? [], i),
            trash:    [...ps2.trash, fc.card],
            costArea: [...ps2.costArea, ...returnedDon],
          };
        }
        return addLog({ ...state, [targetOwner]: ps2 },
          `${cn(sourceCard)}: trashed ${toTrash.length} character(s) from field.`, 'action');
      }

      const targets = ps.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => matchesFilter(c, action.filter));

      if (!targets.length) return state;

      if (targetOwner === opponent) {
        // Opponent hand discard is always random — never prompted
        const shuffled = [...targets].sort(() => Math.random() - 0.5);
        const toDiscard = shuffled.slice(0, action.count);
        const discardSet = new Set(toDiscard.map(t => t.i));
        return addLog({
          ...state,
          [targetOwner]: {
            ...ps,
            hand:  ps.hand.filter((_, i) => !discardSet.has(i)),
            trash: [...ps.trash, ...toDiscard.map(t => t.c)],
          },
        }, `${cn(sourceCard)}: randomly discarded ${toDiscard.length} card(s) from opponent's hand.`, 'action');
      }

      if (shouldPrompt(owner, state) && targets.length >= action.count) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_DISCARD',
          indices: targets.map(t => t.i),
          count: action.count,
        }, fieldPos);
      }
      // AI or too few eligible cards: discard lowest-cost; outer loop handles continuation
      const sorted = [...targets].sort((a, b) => (a.c.cost ?? 0) - (b.c.cost ?? 0));
      const toDiscard = sorted.slice(0, action.count);
      const discardSet = new Set(toDiscard.map(t => t.i));
      let s1 = addLog({
        ...state,
        [owner]: {
          ...ps,
          hand:  ps.hand.filter((_, i) => !discardSet.has(i)),
          trash: [...ps.trash, ...toDiscard.map(t => t.c)],
        },
      }, `${cn(sourceCard)}: discarded ${toDiscard.length} card(s).`, 'action');
      const compTrait1 = leaderDiscardCompensationTrait(s1, owner);
      if (toDiscard.length && compTrait1 && (sourceCard?.types ?? []).some(t => t.includes(compTrait1)))
        s1 = execDraw(s1, owner, toDiscard.length, s1[owner].leader.card.name);
      return s1;
    }

    case 'REVEAL_HAND_CARDS': {
      const ps = state[owner];
      const targets = ps.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => matchesFilter(c, action.filter, null, c.power ?? 0));

      if (targets.length < action.count) return state; // can't pay cost — skip

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_REVEAL_CARDS',
          indices: targets.map(t => t.i),
          count: action.count,
        }, fieldPos);
      }
      // AI: auto-select first N matching cards — cards stay in hand
      const revealed = targets.slice(0, action.count).map(t => t.c);
      return addLog(
        executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos),
        `${cn(sourceCard)}: revealed ${revealed.map(c => cn(c)).join(', ')}.`,
        'action'
      );
    }

    case 'REVEAL_HAND': {
      const ps = state[owner];

      // Reveal-all variant: "公開手牌" — flash every hand card, no selection prompt
      if (action.count === Infinity) {
        const hand = ps.hand;
        if (!hand.length) return executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos);
        const afterFlash = hand.reduce((acc, c) => appendFlash(acc, c, 'REVEAL'), state);
        return addLog(
          executeActionSequence(afterFlash, owner, continuation, sourceCard, effectKey, fieldPos),
          `${cn(sourceCard)}: ${owner} reveals their hand (${hand.map(c => cn(c)).join(', ')}).`,
          'action'
        );
      }

      // Filtered reveal: player selects up to count matching cards, then optionally deploy them
      const targets = ps.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => matchesFilter(c, action.filter, null, c.power ?? 0));

      const hasDeployFollow = continuation[0]?.type === 'DEPLOY_REVEALED_PICK';
      const deployAct = hasDeployFollow ? continuation[0] : null;
      const remainCont = hasDeployFollow ? continuation.slice(1) : continuation;

      if (!targets.length) return executeActionSequence(state, owner, remainCont, sourceCard, effectKey, fieldPos);

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, remainCont, {
          type: 'CHOOSE_REVEAL_HAND',
          indices: targets.map(t => t.i),
          max: action.count,
          deployCount: deployAct?.deployCount ?? 0,
          restIfCostLte: deployAct?.restIfCostLte ?? null,
        }, fieldPos);
      }

      // AI: auto-select up to max matching, deploy highest-cost active, rest if cost ≤ restIfCostLte
      const taken = targets.slice(0, action.count);
      const revealed = taken.map(t => t.c);
      let s = addLog(state, `${cn(sourceCard)}: revealed ${revealed.map(c => cn(c)).join(', ')}.`, 'action');

      if (deployAct && revealed.length > 0) {
        const sorted = [...revealed].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
        const toDeploy = sorted.slice(0, deployAct.deployCount);
        const toRest = sorted.slice(deployAct.deployCount);
        for (const card of toDeploy) {
          const idx = s[owner].hand.indexOf(card);
          if (idx >= 0) {
            const dc = card;
            s = execDeploy(s, owner, idx, sourceCard.name, 'active');
            s = { ...s, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card: dc, owner }] };
          }
        }
        for (const card of toRest) {
          if ((card.cost ?? 0) <= (deployAct.restIfCostLte ?? -1)) {
            const idx = s[owner].hand.indexOf(card);
            if (idx >= 0) {
              const dc = card;
              s = execDeploy(s, owner, idx, sourceCard.name, 'rest');
              s = { ...s, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card: dc, owner }] };
            }
          }
        }
      }

      return executeActionSequence(s, owner, remainCont, sourceCard, effectKey, fieldPos);
    }

    case 'DEPLOY_REVEALED_PICK':
      return state; // consumed by the preceding REVEAL_HAND action; no-op if reached directly

    case 'DISCARD_FREE': {
      // Discard any number of matching hand cards (0 = skip).
      const ps = state[owner];
      const targets = ps.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => matchesFilter(c, action.filter));

      if (!targets.length) {
        // No eligible cards — store 0 so POWER_PER_DISCARD no-ops
        return { ...state, [owner]: { ...ps, lastDiscardCount: 0 } };
      }

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_DISCARD_FREE',
          indices: targets.map(t => t.i),
        }, fieldPos);
      }
      // AI: in a battle with a POWER_PER_DISCARD follow-up, discard only enough to flip
      // the result; otherwise discard all eligible cards to maximise power boost.
      const powerPd = continuation.find(a => a.type === 'POWER_PER_DISCARD');
      let toDiscard = targets;
      if (state.battle && powerPd?.delta > 0) {
        const gap = state.battle.atkPower - state.battle.defPower;
        const needed = gap > 0 ? Math.floor(gap / powerPd.delta) + 1 : 0;
        toDiscard = targets.slice(0, Math.min(needed, targets.length));
      }
      const discardSet = new Set(toDiscard.map(t => t.i));
      return addLog({
        ...state,
        [owner]: {
          ...ps,
          hand:  ps.hand.filter((_, i) => !discardSet.has(i)),
          trash: [...ps.trash, ...toDiscard.map(t => t.c)],
          lastDiscardCount: toDiscard.length,
        },
      }, `${cn(sourceCard)}: discarded ${toDiscard.length} card(s).`, 'action');
    }

    case 'DISCARD_EQUAL_TO_DRAW': {
      const count = state._lastDrawnCount ?? 0;
      const s = { ...state, _lastDrawnCount: undefined };
      if (!count) return s;
      return executeAction(s, owner, { ...action, type: 'DISCARD', count }, sourceCard, effectKey, continuation, fieldPos);
    }

    case 'DISCARD_TO_SIZE': {
      const count = state[owner].hand.length - action.targetSize;
      if (count <= 0) return state;
      return executeAction(state, owner, { ...action, type: 'DISCARD', count, filter: null }, sourceCard, effectKey, continuation, fieldPos);
    }

    case 'POWER_PER_DISCARD': {
      // Applies delta * lastDiscardCount power mod.  Locates fieldPos from sourceCard in state.
      const count = state[owner].lastDiscardCount ?? 0;
      // Clear the ephemeral counter now that we've read it
      const ps = state[owner];
      let s2 = { ...state, [owner]: { ...ps, lastDiscardCount: 0 } };
      if (count === 0) return s2;
      // Determine target position from sourceCard
      let target;
      if (ps.leader.card === sourceCard)          target = 'leader';
      else { const idx = ps.characterArea.findIndex(fc => fc.card === sourceCard); if (idx >= 0) target = idx; }
      if (target === undefined) return s2;
      return addLog(
        addPowerMod(s2, owner, target, action.delta * count, action.until),
        `${cn(sourceCard)}: +${action.delta * count} power (${action.until}).`, 'action'
      );
    }

    case 'REGISTER_ON_EVENT_TRIGGER': {
      // Stores a per-turn trigger that fires when the player plays a matching event card.
      // Also fires retroactively for any qualifying event already played this turn,
      // so the player can activate this effect either before or after playing the event.
      const ps = state[owner];
      let s = {
        ...state,
        [owner]: {
          ...ps,
          onEventTriggers: [
            ...(ps.onEventTriggers ?? []),
            { filter: action.filter, actions: action.triggerActions, sourceCard, effectKey },
          ],
        },
      };
      for (const playedCard of (ps.eventsPlayedThisTurn ?? [])) {
        if (matchesFilter(playedCard, action.filter)) {
          s = executeActionSequence(s, owner, action.triggerActions, sourceCard, effectKey + '_retro');
          if (s.pendingEffect) break;
        }
      }
      return s;
    }

    case 'SEARCH': {
      const ps = state[owner];
      if (!ps.deck.length) return state;

      const revealed  = ps.deck.slice(-action.look).reverse(); // top first
      const deckBase  = ps.deck.slice(0, -action.look);

      // Reorder-only: look at top N, arrange, place on top or bottom — no cards taken
      if (action.take === 0 && action.reorder) {
        if (shouldPrompt(owner, state)) {
          return setPendingEffect(
            { ...state, [owner]: { ...ps, deck: deckBase } },
            owner, sourceCard, effectKey, action, continuation,
            { type: 'SEARCH_ORDER', remaining: revealed, canPlaceOnTop: action.canPlaceOnTop ?? false },
            fieldPos
          );
        }
        // AI: put cards back on top in original order
        return addLog({ ...state, [owner]: { ...ps, deck: [...deckBase, ...revealed.slice().reverse()] } },
          `${cn(sourceCard)}: reordered top ${action.look} cards.`, 'action');
      }

      const nextIsTrash      = continuation[0]?.type === 'REMAINDER_TO_TRASH';
      const nextIsTopOrBottom = continuation[0]?.type === 'REMAINDER_TOP_OR_BOTTOM';
      const remainCont = (nextIsTrash || nextIsTopOrBottom) ? continuation.slice(1) : continuation;

      if (shouldPrompt(owner, state)) {
        const eligibleIndices = revealed
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => matchesFilter(c, action.filter))
          .map(({ i }) => i);
        return setPendingEffect(state, owner, sourceCard, effectKey, action, remainCont, {
          type: 'SEARCH_PICK',
          revealed,
          eligibleIndices,
          take: action.take,
          filter: action.filter,
          remainderToTrash: nextIsTrash,
          canPlaceOnTop: nextIsTopOrBottom,
          reveal: action.reveal ?? false,
          destination: action.destination,
          faceUp: action.faceUp,
        }, fieldPos);
      }
      // AI: take matching, put rest on bottom or trash depending on flag
      const allMatching = revealed.filter(c => matchesFilter(c, action.filter));
      const matching = pickAiSearchCards(allMatching, action.take, state[owner].hand, state, owner);
      const rest     = revealed.filter(c => !matching.includes(c));
      if (action.destination === 'life') {
        const curFU = ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false);
        const aiBase = {
          ...state,
          [owner]: {
            ...ps,
            deck: [...rest.reverse(), ...deckBase],
            lifeArea: [...ps.lifeArea, ...matching],
            lifeAreaFaceUp: [...curFU, ...matching.map(() => action.faceUp ?? true)],
          },
        };
        return addLog(aiBase, `${cn(sourceCard)}: searched, placed ${matching.length} card(s) face-up in life.`, 'action');
      }
      const aiBase = {
        ...state,
        [owner]: {
          ...ps,
          deck: nextIsTrash ? deckBase : [...rest.reverse(), ...deckBase],
          hand: [...ps.hand, ...matching],
          trash: nextIsTrash ? [...ps.trash, ...rest] : ps.trash,
        },
      };
      const aiRevealed = action.reveal && matching.length > 0
        ? matching.reduce((acc, c) => appendFlash(acc, c, 'REVEAL'), aiBase)
        : aiBase;
      const aiLog = action.reveal && matching.length > 0
        ? `${cn(sourceCard)}: revealed ${matching.map(c => cn(c)).join(', ')}.`
        : `${cn(sourceCard)}: searched, added ${matching.length} card(s).`;
      return addLog(aiRevealed, aiLog, 'action');
    }

    case 'REMAINDER_TO_TRASH':
    case 'REMAINDER_TOP_OR_BOTTOM':
      return state; // consumed by the preceding SEARCH action; no-op if reached directly

    case 'SELF_TO_TRASH': {
      // Activation cost: move this card from play area to trash without triggering KO effects.
      // fieldPos.target is a numeric index for characters (not 'leader' or 'stage').
      if (!fieldPos || typeof fieldPos.target !== 'number') return state;
      const ps = state[owner];
      const fc = ps.characterArea[fieldPos.target];
      if (!fc) return state;
      const returnedDon = Array.from({ length: fc.attachedDon ?? 0 }, (_, i) =>
        ({ ...makeDon(`stt-${i}`), state: 'rest' })
      );
      return addLog({
        ...state,
        [owner]: {
          ...ps,
          characterArea: ps.characterArea.filter((_, i) => i !== fieldPos.target),
          powerMods: shiftModsAfterRemoval(ps.powerMods ?? [], fieldPos.target),
          costMods:  shiftModsAfterRemoval(ps.costMods  ?? [], fieldPos.target),
          trash: [...ps.trash, fc.card],
          costArea: [...ps.costArea, ...returnedDon],
        },
      }, `${cn(sourceCard)}: moved to trash as activation cost (not KO).`, 'action');
    }

    case 'DECK_TO_TRASH': {
      const ps = state[owner];
      const count = Math.min(action.count, ps.deck.length);
      if (!count) return state;
      const milled = ps.deck.slice(-count);
      return addLog({
        ...state,
        [owner]: { ...ps, deck: ps.deck.slice(0, -count), trash: [...ps.trash, ...milled] },
      }, `${cn(sourceCard)}: sent ${count} card(s) from deck top to trash.`, 'action');
    }

    case 'TRASH_RECYCLE': {
      const ps = state[owner];
      const count = action.count ?? 20;
      if (ps.trash.length < count) return state;
      const indices = ps.trash.map((_, i) => i);
      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_TRASH_RECYCLE',
          count,
          indices,
        }, fieldPos);
      }
      const chosen = ps.trash.slice(0, count);
      const newTrash = ps.trash.slice(count);
      const newDeck = [...ps.deck, ...chosen].sort(() => Math.random() - 0.5);
      return executeActionSequence(
        addLog({ ...state, [owner]: { ...ps, trash: newTrash, deck: newDeck } },
          `${cn(sourceCard)}: returned ${count} card(s) from trash to deck and shuffled.`, 'action'),
        owner, continuation, sourceCard, effectKey, fieldPos
      );
    }

    case 'ATTACH_DON': {
      if (action.donSource === 'targetOwner') {
        // "持有者" DON: target can be from either side; DON comes from whoever owns the chosen card
        const targets = [];
        for (const tOwner of [owner, opponent]) {
          const ps = state[tOwner];
          const donPool = ps.costArea.filter(d => !action.donState || d.state === action.donState);
          if (!donPool.length) continue;
          if (matchesFilter(ps.leader.card, action.filter))
            targets.push({ zone: 'leader', index: -1, owner: tOwner });
          ps.characterArea.forEach((fc, i) => {
            if (matchesFilter(fc.card, action.filter, fc)) targets.push({ zone: 'character', index: i, owner: tOwner });
          });
        }
        if (!targets.length) return state;
        if (shouldPrompt(owner, state)) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_DON_ATTACH_TARGET',
            targets,
            donState: action.donState,
            count: action.count ?? 1,
            donFromTargetOwner: true,
            canSkip: action.isUpTo !== false,
          }, fieldPos);
        }
        // AI: prefer own targets to buff self
        const preferred = targets.filter(t => t.owner === owner);
        const pool = preferred.length ? preferred : targets;
        const best = pool.reduce((a, b) => {
          const pw = t => t.zone === 'leader'
            ? (state[t.owner].leader.card?.power ?? 0)
            : (state[t.owner].characterArea[t.index]?.card?.power ?? 0);
          return pw(b) > pw(a) ? b : a;
        });
        const bestOwner = best.owner;
        const donPool = state[bestOwner].costArea.filter(d => !action.donState || d.state === action.donState);
        return execAttachDon(state, bestOwner, best, donPool.slice(0, action.count ?? 1));
      }

      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const ps = state[targetOwner];
      const donPool = ps.costArea.filter(d => !action.donState || d.state === action.donState);
      if (!donPool.length) return state;

      // Gather valid targets (leader + characters matching filter)
      const targets = [];
      if (matchesFilter(ps.leader.card, action.filter))
        targets.push({ zone: 'leader', index: -1, owner: targetOwner });
      ps.characterArea.forEach((fc, i) => {
        if (matchesFilter(fc.card, action.filter, fc)) targets.push({ zone: 'character', index: i, owner: targetOwner });
      });
      if (!targets.length) return state;

      // eachTarget: attach up to count DON!! to EVERY matching target (e.g. "Give each Character 1 rested DON!!")
      if (action.eachTarget) {
        let s = state;
        for (const t of targets) {
          const available = s[targetOwner].costArea.filter(d => !action.donState || d.state === action.donState);
          if (!available.length) break;
          s = execAttachDon(s, targetOwner, t, available.slice(0, action.count ?? 1));
        }
        return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
      }

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_DON_ATTACH_TARGET',
          targets,
          donState: action.donState,
          count: action.count ?? 1,
          maxTargets: action.maxTargets ?? 1,
          targetOwner,
          canSkip: !!action.isUpTo,
        }, fieldPos);
      }
      // AI: attach to up to maxTargets highest-power targets
      const maxTargets = action.maxTargets ?? 1;
      const sortedByPower = [...targets].sort((a, b) => {
        const pw = t => t.zone === 'leader'
          ? (ps.leader.card?.power ?? 0)
          : (ps.characterArea[t.index]?.card?.power ?? 0);
        return pw(b) - pw(a);
      });
      let aiState = state;
      for (const t of sortedByPower.slice(0, maxTargets)) {
        const pool = aiState[targetOwner].costArea.filter(d => !action.donState || d.state === action.donState);
        if (!pool.length) break;
        aiState = execAttachDon(aiState, targetOwner, t, pool.slice(0, action.count ?? 1));
      }
      return executeActionSequence(aiState, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'FLIP_LIFE_FACE_UP': {
      const count = action.count ?? 1;
      const ps = state[owner];
      const lifeLen = ps.lifeArea?.length ?? 0;
      if (!lifeLen) return state;
      const faceUpArr = ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false);
      const toFlip = Math.min(count, lifeLen);
      const newFaceUp = faceUpArr.map((v, i) => i >= lifeLen - toFlip ? true : v);
      if (newFaceUp.every((v, i) => v === faceUpArr[i])) return state;
      return addLog(
        { ...state, [owner]: { ...ps, lifeAreaFaceUp: newFaceUp } },
        `${cn(sourceCard)}: flipped ${toFlip} life card(s) face up.`, 'action'
      );
    }

    case 'REVEAL_LIFE': {
      const ps = state[owner];
      if (!ps.lifeArea?.length) return state;
      const take = Math.min(action.count ?? 1, ps.lifeArea.length);
      const oldFaceUp = ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false);
      const newFaceUp = oldFaceUp.map((v, i) => i >= ps.lifeArea.length - take ? true : v);
      const revealed = ps.lifeArea.slice(-take);
      const topCard = revealed[revealed.length - 1];
      return addLog(
        { ...state, lastRevealedLifeCard: topCard, [owner]: { ...ps, lifeAreaFaceUp: newFaceUp } },
        `${cn(sourceCard)}: revealed top ${take} life card(s): ${revealed.map(c => cn(c)).join(', ')}.`, 'action'
      );
    }

    case 'POWER_MOD_BY_LIFE_COST': {
      // OP15-119: for each N cost of the top revealed life card, this card gets +M power.
      // Cumulative: fires once per opponent event/blocker, stacking across the turn.
      const ps = state[owner];
      if (!ps.lifeArea?.length) return state;
      const topCard = ps.lifeArea[ps.lifeArea.length - 1];
      const topCost = topCard?.cost ?? 0;
      const delta = Math.floor(topCost / (action.perCost ?? 1)) * (action.amountPerCost ?? 1000);
      if (delta === 0) return state;
      return addLog(
        addPowerMod(state, owner, fieldPos?.target ?? 'leader', delta, action.until ?? 'turn'),
        `${cn(sourceCard)}: +${delta} power (${cn(topCard)} cost ${topCost}).`, 'action'
      );
    }

    case 'POWER_MOD_PER_SELF_DON': {
      // Per DON!! attached to this card: compute total delta and apply as a mass POWER_MOD.
      const srcFC = fieldPos
        ? (fieldPos.target === 'leader' ? state[owner].leader : state[owner].characterArea[fieldPos.target])
        : null;
      const donCount = srcFC?.attachedDon ?? 0;
      if (donCount === 0) return executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos);
      const totalDelta = Math.floor(donCount / (action.perDon ?? 1)) * (action.delta ?? 0);
      if (totalDelta === 0) return executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos);
      return executeAction(
        state, owner,
        { ...action, type: 'POWER_MOD', delta: totalDelta, count: Infinity },
        sourceCard, effectKey, continuation, fieldPos
      );
    }

    case 'POWER_MOD_PER_DON_RESTED': {
      // totalDelta is injected by CHOOSE_REST_TARGET once the player has committed their DON!! rest count.
      const totalDelta = action.totalDelta ?? 0;
      if (totalDelta === 0) return executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos);

      const tps = state[owner];
      const allTargets = [];
      if (tps.leader) allTargets.push({ zone: 'leader', card: tps.leader.card });
      tps.characterArea.forEach((fc, i) => {
        if (matchesFilter(fc.card, { category: action.filter?.category, trait: action.filter?.trait, includesLeader: false }, fc))
          allTargets.push({ zone: 'character', index: i, card: fc.card });
      });
      if (!allTargets.length) return executeActionSequence(state, owner, continuation, sourceCard, effectKey, fieldPos);

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_POWER_TARGET',
          targetOwner: owner,
          targets: allTargets,
        }, fieldPos);
      }
      // AI: boost the Leader
      const aiTarget = allTargets.find(t => t.zone === 'leader') ?? allTargets[0];
      const aiPos = aiTarget.zone === 'leader' ? 'leader' : aiTarget.index;
      return executeActionSequence(
        addLog(addPowerMod(state, owner, aiPos, totalDelta, action.until), `${cn(sourceCard)}: +${totalDelta} power (${action.until}).`, 'action'),
        owner, continuation, sourceCard, effectKey, fieldPos
      );
    }

    case 'DEAL_DAMAGE': {
      const targetOwner = action.targetOwner === 'opponent' ? opponent : owner;
      const defPs = state[targetOwner];

      // Win: opponent already has 0 life when damage would be dealt
      if (defPs.lifeArea.length === 0) {
        return addLog({ ...state, winner: owner },
          `${cn(sourceCard) ?? 'Effect'}: opponent has 0 life — player wins!`, 'battle');
      }

      const lifeCard  = defPs.lifeArea[defPs.lifeArea.length - 1];
      const newLife   = defPs.lifeArea.slice(0, -1);
      const newFaceUp = (defPs.lifeAreaFaceUp ?? defPs.lifeArea.map(() => false)).slice(0, -1);

      // Trigger check: let the human decide whether to activate it
      if (!!(lifeCard?.trigger) && (targetOwner === PLAYER.HUMAN || state.pvpMode)) {
        return addLog(appendFlash({
          ...state,
          waitingFor: targetOwner,
          pendingTrigger: {
            owner: targetOwner,
            lifeCard,
            isDoubleAtk: false,
            postTriggerLife: newLife,
            // Store the remaining effect chain so it can resume after trigger resolves
            effectContinuation: continuation,
            effectContinuationOwner: owner,
            effectContinuationSourceCard: sourceCard,
            effectContinuationEffectKey: effectKey,
            effectContinuationFieldPos: fieldPos,
          },
          [targetOwner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp },
        }, lifeCard, 'LIFE_TO_HAND'), `Damage! Life card revealed: ${cn(lifeCard)} — has Trigger!`, 'damage');
      }

      // No trigger (or opponent is AI): card goes straight to hand
      const s = addLog(appendFlash({
        ...state,
        [targetOwner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, hand: [...defPs.hand, lifeCard] },
      }, lifeCard, 'LIFE_TO_HAND'), `Damage! ${cn(lifeCard)} → ${targetOwner}'s hand. Life remaining: ${newLife.length}.`, 'action');
      return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'SELF_DAMAGE': {
      const defPs = state[owner];

      if (defPs.lifeArea.length === 0) {
        return addLog(state, `${cn(sourceCard) ?? 'Effect'}: self has 0 life — no damage taken.`, 'action');
      }

      const lifeCard  = defPs.lifeArea[defPs.lifeArea.length - 1];
      const newLife   = defPs.lifeArea.slice(0, -1);
      const newFaceUp = (defPs.lifeAreaFaceUp ?? defPs.lifeArea.map(() => false)).slice(0, -1);

      // Trigger check: let the human decide whether to activate it
      if (!!(lifeCard?.trigger) && (owner === PLAYER.HUMAN || state.pvpMode)) {
        return addLog(appendFlash({
          ...state,
          waitingFor: owner,
          pendingTrigger: {
            owner,
            lifeCard,
            isDoubleAtk: false,
            postTriggerLife: newLife,
            effectContinuation: continuation,
            effectContinuationOwner: owner,
            effectContinuationSourceCard: sourceCard,
            effectContinuationEffectKey: effectKey,
            effectContinuationFieldPos: fieldPos,
          },
          [owner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp },
        }, lifeCard, 'LIFE_TO_HAND'), `Self-damage! Life card revealed: ${cn(lifeCard)} — has Trigger!`, 'damage');
      }

      // No trigger: card goes straight to hand
      const s = addLog(appendFlash({
        ...state,
        [owner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, hand: [...defPs.hand, lifeCard] },
      }, lifeCard, 'LIFE_TO_HAND'), `Self-damage! ${cn(lifeCard)} → ${owner}'s hand. Life remaining: ${newLife.length}.`, 'action');
      return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'LIFE_TO_HAND': {
      const targetOwner = action.targetOwner === 'opponent' ? opponent : owner;
      if (targetOwner === owner && state[owner]?.lifeToHandBlocked) return state;
      if (action.isOptional && shouldPrompt(owner, state)) {
        // When choosePosition is set, CONFIRM_OPTIONAL_ACTIVATION already captured yes/no;
        // skip the redundant yes/no prompt and go straight to the top-vs-bottom choice.
        if (action.choosePosition && (targetOwner === PLAYER.HUMAN || state.pvpMode)) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_LIFE_TO_HAND_POSITION',
            targetOwner,
          }, fieldPos);
        }
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_LIFE_OPTIONAL',
          targetOwner,
        }, fieldPos);
      }
      if (!action.isOptional && shouldPrompt(owner, state) && targetOwner === opponent) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_LIFE_OPTIONAL',
          targetOwner,
        }, fieldPos);
      }
      if (action.choosePosition && (targetOwner === PLAYER.HUMAN || state.pvpMode)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_LIFE_TO_HAND_POSITION',
          targetOwner,
        }, fieldPos);
      }
      const ps   = state[targetOwner];
      const take = Math.min(action.count ?? 1, ps.lifeArea.length);
      if (!take) return state;
      const taken     = ps.lifeArea.slice(-take);
      const newLife   = ps.lifeArea.slice(0, -take);
      const newFaceUp = (ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false)).slice(0, -take);
      const base1 = { ...state, [targetOwner]: { ...ps, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, hand: [...ps.hand, ...taken] } };
      const s1 = addLog(
        (targetOwner === PLAYER.HUMAN || state.pvpMode) ? appendFlash(base1, taken[taken.length - 1], 'LIFE_TO_HAND') : base1,
        `${cn(sourceCard)}: moved ${take} life card(s) to hand.`, 'action'
      );
      return fireLifeLeaveEffects(s1, targetOwner);
    }

    case 'TRASH_TO_LIFE_OR_FIELD': {
      const ps = state[owner];
      const srcZone = action.filter?.zone ?? 'trash';
      const srcPool = srcZone === 'hand' ? ps.hand : ps.trash;
      const filterNoZone = { ...action.filter, zone: undefined };
      const targets = srcPool
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => matchesFilter(c, filterNoZone));
      if (!targets.length) return state;
      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_TRASH_FOR_LIFE_OR_FIELD',
          sourceOwner: owner,
          sourceZone: srcZone,
          indices: targets.map(t => t.i),
          max: action.count ?? 1,
          faceUp: action.faceUp ?? false,
        }, fieldPos);
      }
      // AI: pick highest-cost match and deploy it
      const best = [...targets].sort((a, b) => (b.c.cost ?? 0) - (a.c.cost ?? 0))[0];
      const s = srcZone === 'hand'
        ? execDeploy(state, owner, best.i, sourceCard.name)
        : execDeployFromTrash(state, owner, best.i, sourceCard.name);
      return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'FIELD_TO_LIFE': {
      const ps = state[owner];
      const ftlTargets = ps.characterArea
        .map((fc, i) => ({ fc, i }))
        .filter(({ fc }) => matchesFilter(fc.card, action.filter, fc));
      if (!ftlTargets.length) return state;
      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_FIELD_FOR_LIFE',
          indices: ftlTargets.map(t => t.i),
          max: action.count ?? 1,
          faceUp: action.faceUp ?? true,
        }, fieldPos);
      }
      // AI: pick first match
      const ftlTarget = ftlTargets[0];
      const ftlCard = ftlTarget.fc.card;
      const ftlNewChars = ps.characterArea.filter((_, i) => i !== ftlTarget.i);
      const ftlCurFU = ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false);
      return addLog({
        ...state,
        [owner]: {
          ...ps,
          characterArea: ftlNewChars,
          powerMods: shiftModsAfterRemoval(ps.powerMods ?? [], ftlTarget.i),
          costMods:  shiftModsAfterRemoval(ps.costMods  ?? [], ftlTarget.i),
          lifeArea: [...ps.lifeArea, ftlCard],
          lifeAreaFaceUp: [...ftlCurFU, action.faceUp ?? true],
        },
      }, `${cn(sourceCard)}: placed ${cn(ftlCard)} face-up into life.`, 'action');
    }

    case 'LIFE_TO_TRASH': {
      const targetOwner = action.targetOwner === 'opponent' ? opponent : owner;
      const ps      = state[targetOwner];

      if (action.faceUpOnly) {
        const faceUpArr = ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false);
        const keptLife = [], keptFU = [], trashed = [];
        for (let i = 0; i < ps.lifeArea.length; i++) {
          if (faceUpArr[i]) { trashed.push(ps.lifeArea[i]); }
          else { keptLife.push(ps.lifeArea[i]); keptFU.push(faceUpArr[i]); }
        }
        if (!trashed.length) return state;
        return addLog({
          ...state,
          [targetOwner]: { ...ps, lifeArea: keptLife, lifeAreaFaceUp: keptFU, trash: [...ps.trash, ...trashed] },
        }, `${cn(sourceCard)}: trashed ${trashed.length} face-up life card(s).`, 'action');
      }

      const take    = Math.min(action.count ?? 1, ps.lifeArea.length);
      if (!take) return state;
      const lifeCard  = ps.lifeArea[ps.lifeArea.length - 1];
      const trashed   = ps.lifeArea.slice(-take);
      const newLife   = ps.lifeArea.slice(0, -take);
      const newFaceUp = (ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false)).slice(0, -take);
      // Trigger check: if the trashed life card has a trigger and its owner is the human, let them activate it
      if (lifeCard?.trigger && (targetOwner === PLAYER.HUMAN || state.pvpMode)) {
        return addLog(appendFlash({
          ...state,
          waitingFor: targetOwner,
          pendingTrigger: {
            owner: targetOwner,
            lifeCard,
            isDoubleAtk: false,
            postTriggerLife: newLife,
            effectContinuation: continuation,
            effectContinuationOwner: owner,
            effectContinuationSourceCard: sourceCard,
            effectContinuationEffectKey: effectKey,
            effectContinuationFieldPos: fieldPos,
            cardAlreadyInZone: 'trash',
          },
          [targetOwner]: { ...ps, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, trash: [...ps.trash, ...trashed] },
        }, lifeCard, null), `${cn(sourceCard)}: trashed ${cn(lifeCard)} — has Trigger!`, 'damage');
      }
      const baseTrash = { ...state, [targetOwner]: { ...ps, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, trash: [...ps.trash, ...trashed] } };
      const s = addLog(
        (targetOwner === PLAYER.HUMAN || state.pvpMode) ? appendFlash(baseTrash, trashed[trashed.length - 1], 'LIFE_TO_TRASH') : baseTrash,
        `${cn(sourceCard)}: trashed ${take} life card(s).`, 'action'
      );
      return s;
    }

    case 'ADD_TO_HAND': {
      const srcOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const ps = state[srcOwner];
      const zone = action.filter?.zone;
      const count = action.count ?? 1;

      // Self-bounce: this card moves itself to hand (e.g. KO-time self-rescue)
      if (action.filter?.self && fieldPos?.zone === 'character') {
        return execReturnHand(state, owner, fieldPos.index, sourceCard.name);
      }

      if (zone === 'trash') {
        const filterNoZone = { ...action.filter, zone: undefined };
        const targets = ps.trash
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => matchesFilter(c, filterNoZone));
        if (!targets.length) return state;
        const effectiveCount = Math.min(count, targets.length);
        if (srcOwner === PLAYER.HUMAN || state.pvpMode) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_ADD_TO_HAND_TARGET',
            zone: 'trash',
            sourceOwner: srcOwner,
            indices: targets.map(t => t.i),
            max: effectiveCount,
          }, fieldPos);
        }
        // AI: pick highest-cost matching card
        const best = [...targets].sort((a, b) => (b.c.cost ?? 0) - (a.c.cost ?? 0))[0];
        return addLog({
          ...state,
          [srcOwner]: {
            ...ps,
            trash: ps.trash.filter((_, i) => i !== best.i),
            hand:  [...ps.hand, best.c],
          },
        }, `${cn(sourceCard)}: moved ${cn(best.c)} from trash to hand.`, 'action');
      }

      if (zone === 'field') {
        const filterNoZone = { ...action.filter, zone: undefined, self: undefined };
        const targets = [];
        state[srcOwner].characterArea.forEach((fc, i) => {
          if (matchesFilter(fc.card, filterNoZone, fc)) targets.push({ owner: srcOwner, charIndex: i });
        });
        if (!targets.length) return state;
        const effectiveCount = Math.min(count, targets.length);
        if (srcOwner === PLAYER.HUMAN || state.pvpMode) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_ADD_TO_HAND_TARGET',
            zone: 'field',
            targets,
            max: effectiveCount,
          }, fieldPos);
        }
        const pick = [...targets].sort((a, b) =>
          (state[b.owner].characterArea[b.charIndex].card.cost ?? 0) -
          (state[a.owner].characterArea[a.charIndex].card.cost ?? 0)
        )[0];
        return execReturnHand(state, pick.owner, pick.charIndex, sourceCard.name);
      }

      if (zone === 'life') {
        const take = Math.min(count, ps.lifeArea.length);
        if (!take) return state;
        const taken     = ps.lifeArea.slice(-take);
        const newLife   = ps.lifeArea.slice(0, -take);
        const newFaceUp = (ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false)).slice(0, -take);
        const s1 = addLog({
          ...state,
          [srcOwner]: { ...ps, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, hand: [...ps.hand, ...taken] },
        }, `${cn(sourceCard)}: moved ${take} life card(s) to hand.`, 'action');
        return fireLifeLeaveEffects(s1, srcOwner);
      }

      // zone = 'deck' or undefined with a non-trivial filter: look at top N cards, take matching
      if (zone === 'deck' || (zone == null && Object.keys(action.filter ?? {}).length > 0)) {
        if (!ps.deck.length) return state;
        const look     = count;
        const revealed = ps.deck.slice(-look).reverse(); // top first
        const deckBase = ps.deck.slice(0, -look);
        const filterNoZone = { ...action.filter, zone: undefined };
        const matching = revealed.filter(c => matchesFilter(c, filterNoZone)).slice(0, count);
        const rest     = revealed.filter(c => !matching.includes(c));
        return addLog({
          ...state,
          [srcOwner]: {
            ...ps,
            deck: [...rest.slice().reverse(), ...deckBase],
            hand: [...ps.hand, ...matching],
          },
        }, `${cn(sourceCard)}: moved ${matching.length} card(s) from deck to hand.`, 'action');
      }

      return state;
    }

    case 'DECK_TO_LIFE': {
      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const ps   = state[targetOwner];
      const take = Math.min(action.count ?? 1, ps.deck.length);
      if (!take) return state;
      const added     = ps.deck.slice(-take);
      const newDeck   = ps.deck.slice(0, -take);
      const newLife   = [...ps.lifeArea, ...added];
      const newFaceUp = [...(ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false)), ...Array(take).fill(false)];
      const baseDtl = { ...state, [targetOwner]: { ...ps, deck: newDeck, lifeArea: newLife, lifeAreaFaceUp: newFaceUp } };
      const s1 = addLog(
        (targetOwner === PLAYER.HUMAN || state.pvpMode) ? appendFlash(baseDtl, added[added.length - 1], 'DECK_TO_LIFE', { faceDown: true }) : baseDtl,
        `${cn(sourceCard)}: added ${take} card(s) from deck to life.`, 'action'
      );
      return executeActionSequence(s1, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'HAND_TO_LIFE': {
      const ps = state[owner];
      const targets = ps.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => matchesFilter(c, action.filter));

      if (!targets.length) return state;

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_HAND_TO_LIFE',
          indices: targets.map(t => t.i),
          count: action.count ?? 1,
        }, fieldPos);
      }
      // AI: move lowest-cost matching card
      const sorted   = [...targets].sort((a, b) => (a.c.cost ?? 0) - (b.c.cost ?? 0));
      const toMove   = sorted.slice(0, action.count ?? 1);
      const moveSet  = new Set(toMove.map(t => t.i));
      const moved    = toMove.map(t => t.c);
      const newFaceUp = [...(ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false)), ...Array(moved.length).fill(false)];
      return addLog({
        ...state,
        [owner]: {
          ...ps,
          hand:           ps.hand.filter((_, i) => !moveSet.has(i)),
          lifeArea:       [...ps.lifeArea, ...moved],
          lifeAreaFaceUp: newFaceUp,
        },
      }, `${cn(sourceCard)}: moved ${moved.length} hand card(s) to life.`, 'action');
    }

    case 'ADD_TO_LIFE': {
      const srcOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const ps       = state[srcOwner];
      let targets;
      if (action.sourceZone === 'hand') {
        targets = ps.hand
          .map((c, i) => ({ c, i, zone: 'hand', ownerKey: srcOwner }))
          .filter(({ c }) => matchesFilter(c, action.filter));
      } else if (action.sourceZone === 'handOrTrash') {
        const handT = ps.hand
          .map((c, i) => ({ c, i, zone: 'hand', ownerKey: srcOwner }))
          .filter(({ c }) => matchesFilter(c, action.filter));
        const trashT = ps.trash
          .map((c, i) => ({ c, i, zone: 'trash', ownerKey: srcOwner }))
          .filter(({ c }) => matchesFilter(c, action.filter));
        targets = [...handT, ...trashT];
      } else {
        targets = ps.characterArea
          .map((fc, i) => ({ c: fc.card, i, zone: 'character', ownerKey: srcOwner, fc }))
          .filter(({ c, fc }) => matchesFilter(c, action.filter, fc, (c.power ?? 0) + (fc.attachedDon ?? 0) * 1000));
        // For 持有者 effects with no owner filter, also consider opponent's field
        if (!action.filter?.owner) {
          const oppPsLocal = state[opponent];
          const oppTargets = oppPsLocal.characterArea
            .map((fc, i) => ({ c: fc.card, i, zone: 'character', ownerKey: opponent, fc }))
            .filter(({ c, fc }) => matchesFilter(c, action.filter, fc, (c.power ?? 0) + (fc.attachedDon ?? 0) * 1000));
          targets = [...targets, ...oppTargets];
        }
      }
      if (!targets.length) return state;

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_ADD_TO_LIFE',
          targets:       targets.map(t => ({ ownerKey: t.ownerKey, index: t.i, zone: t.zone })),
          count:         action.count ?? 1,
          sourceZone:    action.sourceZone,
          targetOwner:   action.targetOwner,
          position:      action.position,
          faceUp:        action.faceUp ?? false,
          positionChoice: action.position === 'choice',
        }, fieldPos);
      }

      // AI: pick opponent's weakest (lowest-cost) match, else own highest-cost
      const oppTargets2 = targets.filter(t => t.ownerKey === opponent);
      const toMove = (oppTargets2.length ? oppTargets2 : targets)
        .sort((a, b) => (a.c.cost ?? 0) - (b.c.cost ?? 0))
        .slice(0, action.count ?? 1);

      let s = state;
      for (const t of toMove) {
        const lifeOwnerKey = action.targetOwner === 'opponent' ? opponent
                           : action.targetOwner === 'holder'   ? t.ownerKey
                           : owner;
        let card;
        const tps = s[t.ownerKey];
        if (t.zone === 'hand') {
          card = tps.hand[t.i];
          s = { ...s, [t.ownerKey]: { ...tps, hand: tps.hand.filter((_, i) => i !== t.i) } };
        } else if (t.zone === 'trash') {
          card = tps.trash[t.i];
          s = { ...s, [t.ownerKey]: { ...tps, trash: tps.trash.filter((_, i) => i !== t.i) } };
        } else {
          const fc = tps.characterArea[t.i];
          card = fc.card;
          // Check for leave-field replacement before moving to life area
          const atlReplace = checkLeaveFieldReplacement(s, t.ownerKey, t.i, {
            context: 'ADD_TO_LIFE', targetOwner: t.ownerKey, targetIndex: t.i,
            lifeOwner: lifeOwnerKey, sourceName: cn(sourceCard),
          });
          if (atlReplace) { s = atlReplace.state; continue; }
          const returnedDon = Array.from({ length: fc.attachedDon ?? 0 }, (_, k) =>
            ({ _donId: `don-atl-${k}-${Math.random()}`, state: 'rest' })
          );
          s = { ...s, [t.ownerKey]: {
            ...tps,
            characterArea: tps.characterArea.filter((_, i) => i !== t.i),
            powerMods: shiftModsAfterRemoval(tps.powerMods ?? [], t.i),
            costMods:  shiftModsAfterRemoval(tps.costMods  ?? [], t.i),
            costArea: [...tps.costArea, ...returnedDon],
          }};
        }
        const lps = s[lifeOwnerKey];
        const curFaceUp = lps.lifeAreaFaceUp ?? lps.lifeArea.map(() => false);
        const placing   = action.faceUp ?? false;
        if (action.position === 'bottom') {
          s = addLog(appendFlash({ ...s, [lifeOwnerKey]: {
            ...lps, lifeArea: [card, ...lps.lifeArea], lifeAreaFaceUp: [placing, ...curFaceUp],
          }}, card, 'ADD_LIFE'), `${cn(sourceCard)}: moved ${cn(card)} to bottom of life.`, 'action');
        } else {
          s = addLog(appendFlash({ ...s, [lifeOwnerKey]: {
            ...lps, lifeArea: [...lps.lifeArea, card], lifeAreaFaceUp: [...curFaceUp, placing],
          }}, card, 'ADD_LIFE'), `${cn(sourceCard)}: moved ${cn(card)} to top of life.`, 'action');
        }
      }
      return s;
    }

    case 'OPPONENT_DON_REST_DEFERRED': {
      const prev = state[opponent].pendingDonRest ?? 0;
      return addLog(
        { ...state, [opponent]: { ...state[opponent], pendingDonRest: prev + action.count } },
        `${cn(sourceCard)}: opponent must rest ${action.count} DON!! at start of their main phase.`, 'action'
      );
    }

    case 'UNREST_DON_END_OF_TURN': {
      const prev = state[owner].pendingDonUnrestEot ?? 0;
      return addLog(
        { ...state, [owner]: { ...state[owner], pendingDonUnrestEot: Math.max(prev, action.count) } },
        `${cn(sourceCard)}: will activate up to ${action.count} DON!! at end of turn.`, 'action'
      );
    }

    case 'DON_ACTIVE':    // EN parser alias for UNREST_DON (same semantics)
    case 'UNREST_DON': {
      const ps       = state[owner];
      if (ps.donUnrestByCharLocked && sourceCard?.category === 'Character') return state;
      const restDons = ps.costArea.filter(d => d.state === 'rest');
      if (!restDons.length) return state;

      // count === null means "all" — activate every rested DON!! without a player choice
      if (action.count === null) {
        return addLog({
          ...state,
          [owner]: { ...ps, costArea: ps.costArea.map(d => d.state === 'rest' ? { ...d, state: 'active' } : d) },
        }, `${cn(sourceCard)}: activated all DON!!.`, 'action');
      }

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_DON_UNREST',
          options: restDons,
          max: action.count,
        }, fieldPos);
      }
      // AI: activate as many rested DON!! as allowed
      const toActivate  = restDons.slice(0, action.count);
      const activateIds = new Set(toActivate.map(d => d._donId));
      return addLog({
        ...state,
        [owner]: { ...ps, costArea: ps.costArea.map(d => activateIds.has(d._donId) ? { ...d, state: 'active' } : d) },
      }, `${cn(sourceCard)}: activated ${toActivate.length} DON!!.`, 'action');
    }

    case 'LOCK_DON_UNREST_BY_CHAR': {
      const ps = state[owner];
      return addLog(
        { ...state, [owner]: { ...ps, donUnrestByCharLocked: true } },
        `${cn(sourceCard)}: character card effects cannot activate DON!! this turn.`, 'action'
      );
    }

    case 'UNREST': {
      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const tps = state[targetOwner];

      // Self-activate: activate the source card itself
      if (action.filter?.self) {
        if (!fieldPos) return state;
        if (fieldPos.target === 'leader') {
          return addLog(
            { ...state, [targetOwner]: { ...tps, leader: { ...tps.leader, state: 'active' } } },
            `${cn(sourceCard)}: activated itself.`, 'action'
          );
        }
        if (fieldPos.target === 'stage') {
          return addLog(
            { ...state, [targetOwner]: { ...tps, stageArea: { ...tps.stageArea, state: 'active' } } },
            `${cn(sourceCard)}: activated itself.`, 'action'
          );
        }
        const idx = fieldPos.target;
        return addLog({
          ...state,
          [targetOwner]: { ...tps, characterArea: tps.characterArea.map((fc, i) =>
            i === idx ? { ...fc, state: 'active' } : fc
          ) },
        }, `${cn(sourceCard)}: activated itself.`, 'action');
      }

      // Leader-only target (no includesLeader): activate it directly, no choice needed
      if (action.filter?.category === 'Leader' && !action.filter?.includesLeader) {
        if (!tps.leader?.card || !matchesFilter(tps.leader.card, action.filter)) return state;
        return addLog(
          { ...state, [targetOwner]: { ...tps, leader: { ...tps.leader, state: 'active' } } },
          `${cn(sourceCard)}: ${cn(tps.leader.card)} activated.`, 'action'
        );
      }

      // Character (or character+leader) target: gather rested candidates
      const candidates = [];
      if (action.filter?.includesLeader && tps.leader?.card && tps.leader.state === 'rest' &&
          matchesFilter(tps.leader.card, action.filter)) {
        candidates.push({ zone: 'leader', index: -1 });
      }
      tps.characterArea.forEach((fc, i) => {
        if (fc.state === 'rest' && matchesFilter(fc.card, action.filter, fc, fc.card.power ?? 0))
          candidates.push({ zone: 'character', index: i });
      });

      if (!candidates.length) return state;

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_UNREST_TARGET',
          targetOwner,
          targets: candidates,
          max: action.count ?? 1,
        }, fieldPos);
      }
      // AI: activate first N rested candidates
      let s = state;
      const kwUntilKey = action.grantKeywordUntil === 'opponent_turn_end' ? 'opponentTurnEndKeywords' : 'tempKeywords';
      for (const t of candidates.slice(0, action.count ?? 1)) {
        const tps2 = s[targetOwner];
        const kwPatch = action.grantKeywords?.length
          ? Object.fromEntries(action.grantKeywords.map(kw => [kwUntilKey, [...(tps2[t.zone === 'leader' ? 'leader' : 'characterArea']?.[t.zone === 'leader' ? kwUntilKey : t.index]?.[kwUntilKey] ?? []), kw]]))
          : {};
        if (t.zone === 'leader') {
          s = addLog(
            { ...s, [targetOwner]: { ...tps2, leader: { ...tps2.leader, state: 'active', ...kwPatch } } },
            `${cn(sourceCard)}: ${cn(tps2.leader.card)} activated.`, 'action'
          );
        } else {
          s = addLog({
            ...s,
            [targetOwner]: { ...tps2, characterArea: tps2.characterArea.map((fc, i) => {
              if (i !== t.index) return fc;
              const kwArr = action.grantKeywords?.length
                ? { [kwUntilKey]: [...(fc[kwUntilKey] ?? []), ...action.grantKeywords] }
                : {};
              return { ...fc, state: 'active', ...kwArr };
            }) },
          }, `${cn(sourceCard)}: ${cn(tps2.characterArea[t.index].card)} activated.`, 'action');
          // Apply power mod to the unrested character (e.g. OP01-003 Luffy +1000 this turn)
          if (action.powerMod) {
            s = addPowerMod(s, targetOwner, t.index, action.powerMod.delta, action.powerMod.until);
          }
        }
      }
      return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'ADD_DON_FROM_DECK': {
      const ps = state[owner];
      const take = Math.min(action.count, ps.donDeck.length);
      if (take === 0) return state;
      const gained = ps.donDeck.slice(-take).map(d => ({ ...d, state: action.donState ?? 'active' }));
      const newDeck = ps.donDeck.slice(0, -take);
      return addLog({
        ...state,
        [owner]: { ...ps, donDeck: newDeck, costArea: [...ps.costArea, ...gained] },
      }, `${cn(sourceCard)}: Added ${take} ${action.donState ?? 'active'} DON!! from DON!! deck.`, 'action');
    }

    case 'OPPONENT_ADD_DON': {
      const ops = state[opponent];
      const take = Math.min(action.count, ops.donDeck.length);
      if (take === 0) return state;
      const gained = ops.donDeck.slice(-take).map(d => ({ ...d, state: 'active' }));
      const newDeck = ops.donDeck.slice(0, -take);
      return addLog({
        ...state,
        [opponent]: { ...ops, donDeck: newDeck, costArea: [...ops.costArea, ...gained] },
      }, `${cn(sourceCard)}: opponent added ${take} active DON!! from DON!! deck.`, 'action');
    }

    case 'BLOCK_DEPLOY': {
      const ps = state[owner];
      if (action.costThreshold != null) {
        const opLabel = action.costOp === 'gte' ? '以上' : '以下';
        return addLog(
          { ...state, [owner]: { ...ps, deployBlockCost: { threshold: action.costThreshold, op: action.costOp } } },
          `${cn(sourceCard)}: cannot deploy characters with original cost ${action.costThreshold}${opLabel} this turn.`, 'action'
        );
      }
      return addLog(
        { ...state, [owner]: { ...ps, deployBlockedThisTurn: true } },
        `${cn(sourceCard)}: cannot deploy characters this turn.`, 'action'
      );
    }

    case 'REDIRECT_ATTACK_TARGET': {
      if (!state.battle) return state;
      const ps = state[owner]; // owner = defending player
      // Include leader plus any characters matching the required trait
      const targets = [{ zone: 'leader', index: -1 }];
      ps.characterArea.forEach((fc, i) => {
        if (!action.trait || (fc.card.types ?? []).some(t => t.includes(action.trait)))
          targets.push({ zone: 'character', index: i });
      });
      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_REDIRECT_ATTACK_TARGET',
          targets,
        }, fieldPos);
      }
      // AI: only redirect to a target that can survive the attack.
      // If no target survives, stay on the current target (no positional change, leader protected).
      const atkPower = state.battle?.atkPower ?? 0;
      const pw = t => t.zone === 'leader'
        ? (ps.leader.card?.power ?? 0)
        : (ps.characterArea[t.index]?.card?.power ?? 0);
      const survivingTargets = targets.filter(t => pw(t) > atkPower);
      const pool = survivingTargets.length ? survivingTargets : targets;
      const best = pool.reduce((a, b) => pw(b) > pw(a) ? b : a);
      return applyRedirectAttack(state, owner, best);
    }

    case 'FLAG_EOT_BOTTOM_DECK': {
      // Mark the last N characters deployed this turn for end-of-turn return to deck bottom.
      // The preceding DEPLOY action appends to characterArea, so the last `count` entries are
      // the ones just deployed by this effect.
      const ps = state[owner];
      const count = action.count ?? 1;
      const len = ps.characterArea.length;
      const newChars = ps.characterArea.map((fc, i) =>
        i >= len - count ? { ...fc, willBottomDeckAtEndOfTurn: true } : fc
      );
      return { ...state, [owner]: { ...ps, characterArea: newChars } };
    }

    case 'BOTTOM_DECK': {
      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const tps = state[targetOwner];
      const fromTrash = action.filter?.zone === 'trash';

      if (fromTrash) {
        const targets = tps.trash
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => matchesFilter(c, action.filter));

        if (!targets.length) return state;

        if (shouldPrompt(owner, state)) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_BOTTOM_DECK_TARGET',
            targetOwner,
            fromTrash: true,
            indices: targets.map(t => t.i),
            max: action.count ?? 1,
            orderMode: (action.count ?? 1) > 1,
          }, fieldPos);
        }
        // AI: pick up to count cards and place at bottom in arbitrary order
        const take = Math.min(action.count ?? 1, targets.length);
        const chosen = targets.slice(0, take);
        const chosenIdxSet = new Set(chosen.map(t => t.i));
        return addLog(appendFlash({
          ...state,
          [targetOwner]: {
            ...tps,
            trash: tps.trash.filter((_, i) => !chosenIdxSet.has(i)),
            deck: [...tps.deck, ...chosen.map(t => t.c)],
          },
        }, chosen[chosen.length - 1].c, 'BOTTOM_DECK'), `${cn(sourceCard)}: placed ${take} card(s) from trash at bottom of deck.`, 'action');
      }

      const targets = tps.characterArea
        .map((fc, i) => ({
          fc, i,
          power: (fc.card.power ?? 0) + (tps.powerMods ?? [])
            .filter(m => m.target === i)
            .reduce((acc, m) => acc + m.delta, 0),
        }))
        .filter(({ fc, power }) => matchesFilter(fc.card, action.filter, fc, power));

      if (!targets.length) return state;

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_BOTTOM_DECK_TARGET',
          targetOwner,
          fromTrash: false,
          indices: targets.map(t => t.i),
          max: action.count ?? 1,
        }, fieldPos);
      }
      // AI: pick highest-power target
      const best = [...targets].sort((a, b) => b.power - a.power)[0];
      // Check for leave-field replacement before sending to bottom of deck
      const bdReplace = checkLeaveFieldReplacement(state, targetOwner, best.i, {
        context: 'BOTTOM_DECK', targetOwner, targetIndex: best.i, sourceName: cn(sourceCard),
      });
      if (bdReplace) return bdReplace.state;
      const bestFC = tps.characterArea[best.i];
      const returnedDon = Array.from({ length: bestFC.attachedDon }, (_, i) =>
        ({ ...makeDon(`bd-${i}`), state: 'rest' })
      );
      return addLog(appendFlash({
        ...state,
        [targetOwner]: {
          ...tps,
          characterArea: tps.characterArea.filter((_, i) => i !== best.i),
          powerMods: shiftModsAfterRemoval(tps.powerMods ?? [], best.i),
          costMods:  shiftModsAfterRemoval(tps.costMods  ?? [], best.i),
          deck: [bestFC.card, ...tps.deck],
          costArea: [...tps.costArea, ...returnedDon],
        },
      }, bestFC.card, 'BOTTOM_DECK'), `${cn(sourceCard)}: ${cn(bestFC.card)} placed at bottom of deck.`, 'action');
    }

    case 'HAND_TO_DECK': {
      const ps = state[owner];
      if (!ps.hand.length) return state;
      const handIndices = ps.hand.map((_, i) => i);

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_HAND_TO_DECK',
          indices: handIndices,
          max: action.count,
          canPlaceOnTop: action.canPlaceOnTop ?? false,
        }, fieldPos);
      }
      // AI: pick last N cards from hand (arbitrary), place on top
      const take = Math.min(action.count, ps.hand.length);
      const chosen = ps.hand.slice(-take);
      const newHand = ps.hand.slice(0, -take);
      const newDeck = action.canPlaceOnTop
        ? [...ps.deck, ...[...chosen].reverse()]
        : [[...chosen].reverse(), ...ps.deck].flat();
      return addLog({ ...state, [owner]: { ...ps, hand: newHand, deck: newDeck, lastReturnedToDeckCount: take } },
        `${cn(sourceCard)}: placed ${take} hand card(s) on deck.`, 'action');
    }

    case 'OPP_HAND_TO_DECK': {
      // Opponent selects N of their hand cards and places them at the bottom of their deck.
      // Used for effects like EB04-022 "對手將2張自身的手牌依任意順序放置在卡組下面".
      const ops = state[opponent];
      if (!ops.hand.length) return state;
      const handIndices = ops.hand.map((_, i) => i);

      if (shouldPrompt(opponent, state)) {
        return setPendingEffect(state, opponent, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_HAND_TO_DECK',
          indices: handIndices,
          max: action.count,
          canPlaceOnTop: false,
        }, fieldPos);
      }
      // AI: pick last N cards (arbitrary), place at deck bottom
      const take = Math.min(action.count, ops.hand.length);
      const chosen = ops.hand.slice(-take);
      const newHand = ops.hand.slice(0, -take);
      const newDeck = [[...chosen].reverse(), ...ops.deck].flat();
      return addLog({ ...state, [opponent]: { ...ops, hand: newHand, deck: newDeck } },
        `${cn(sourceCard)}: opponent placed ${take} hand card(s) on deck bottom.`, 'action');
    }

    case 'FIRE_MAIN_EFFECT': {
      // Use the original card's effect (not the trigger text) so we find the correct clause.
      // resolveTriggerEffect replaces sourceCard.effect with trigger text; _originalCard holds the real card.
      // action.timing carries which timing to re-fire (e.g. '主要', '登場時', 'KO時'); default '主要'.
      const effectText = sourceCard._originalCard?.effect ?? sourceCard.effect ?? '';
      const clauses = parseEffect(effectText);
      const targetTiming = action.timing ?? '主要';
      const mainClause = clauses.find(c => c.timings.includes(targetTiming));
      if (!mainClause) return state;
      const combined = [...mainClause.actions, ...continuation];
      return executeActionSequence(state, owner, combined, sourceCard, effectKey + '_main', fieldPos);
    }

    case 'FREE_EVENT': {
      // Play up to N matching event cards from hand without paying their cost.
      const AUTO_TIMINGS = new Set(['登場時','KO時','攻擊時','對方攻擊時','防禦時','我方回合結束時','觸發器']);
      const ps = state[owner];
      const targets = ps.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.category === 'Event' && matchesFilter(c, action.filter));

      if (!targets.length) return state;

      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_FREE_EVENT',
          indices: targets.map(t => t.i),
          max: action.count,
          autoTimings: [...AUTO_TIMINGS],
        }, fieldPos);
      }
      // AI: pick the first (highest-cost) matching event and play it inline
      const best = [...targets].sort((a, b) => (b.c.cost ?? 0) - (a.c.cost ?? 0))[0];
      let s = addLog({
        ...state,
        [owner]: { ...ps, hand: ps.hand.filter((_, i) => i !== best.i) },
      }, `${cn(sourceCard)}: free-played ${cn(best.c)}.`, 'action');
      // Inline event effect resolution (mirrors resolveEventEffect from effects.js)
      const evClauses = parseEffect(best.c.effect ?? '');
      for (const clause of evClauses) {
        const isAuto       = clause.timings.some(t => AUTO_TIMINGS.has(t));
        const isContinuous = clause.continuous.length > 0 || clause.passive.length > 0;
        if (isAuto || isContinuous) continue;
        if (clause.condition && !evaluateCondition(s, owner, clause.condition)) continue;
        s = executeActionSequence(s, owner, clause.actions, best.c, best.c.id + '_freeev');
        if (s.pendingEffect) break;
      }
      const sps = s[owner];
      return { ...s, [owner]: { ...sps, trash: [...sps.trash, best.c] } };
    }

    case 'GRANT_KEYWORD': {
      const kwLabel = action.keyword === 'RUSH_CHARS_ONLY'
        ? '速攻：角色'
        : action.keyword + (action.restriction ? '：' + action.restriction : '');
      const patch = {
        justDeployed: false,
        ...(action.restriction === '角色' ? { rushCharOnly: true } : {}),
      };

      // Build the fc-level patch for a non-速攻 keyword grant: append to tempKeywords or opponentTurnEndKeywords
      // "startOfOwnTurn" == "opponent_turn_end" — both mean "cleared at the start of my next turn"
      const kwUntilKey = (action.until === 'opponent_turn_end' || action.until === 'startOfOwnTurn') ? 'opponentTurnEndKeywords' : 'tempKeywords';
      function makeTempPatch(fc) {
        if (action.keyword === '速攻') return patch;
        if (action.keyword === 'RUSH_CHARS_ONLY') return { justDeployed: false, rushCharOnly: true };
        if (action.keyword === 'CANNOT_ATTACK' && action.costMax != null) {
          return { attackCostRestriction: { costMax: action.costMax } };
        }
        return { [kwUntilKey]: [...(fc?.[kwUntilKey] ?? []), action.keyword] };
      }

      // Self-grant: "這張角色卡" → apply directly to fieldPos, no target selection
      if (action.filter?.self) {
        if (!fieldPos) return state;
        const ps = state[owner];
        const kwLogSuffix = action.until === 'opponent_turn_end' ? ' (until end of opponent\'s turn).' : ' this turn.';
        if (fieldPos.target === 'leader') {
          return addLog(
            { ...state, [owner]: { ...ps, leader: { ...ps.leader, ...makeTempPatch(ps.leader) } } },
            `${cn(sourceCard)} gained 【${kwLabel}】${kwLogSuffix}`, 'action'
          );
        }
        const newChars = ps.characterArea.map((fc, i) =>
          i === fieldPos.target ? { ...fc, ...makeTempPatch(fc) } : fc
        );
        return addLog(
          { ...state, [owner]: { ...ps, characterArea: newChars } },
          `${cn(sourceCard)} gained 【${kwLabel}】${kwLogSuffix}`, 'action'
        );
      }

      // Leader-targeted grant: apply keyword directly to own leader without prompting
      if (action.filter?.category === 'Leader') {
        const ps = state[owner];
        if (!matchesFilter(ps.leader?.card, action.filter)) return state;
        const newTempKws = [...(ps.leader?.tempKeywords ?? []), action.keyword];
        return addLog(
          { ...state, [owner]: { ...ps, leader: { ...ps.leader, tempKeywords: newTempKws } } },
          `${cn(sourceCard)}: own leader gained 【${action.keyword}】 this turn.`, 'action'
        );
      }

      // Filter-based: player picks which matching character gets the keyword
      if (action.filter) {
        const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
        const tps = state[targetOwner];
        const targets = tps.characterArea
          .map((fc, i) => ({ fc, i }))
          .filter(({ fc }) => matchesFilter(fc.card, action.filter, fc));
        if (!targets.length) return state;

        // Mass grant (action.all): apply to every matching character without prompting
        if (action.all) {
          const newChars = tps.characterArea.map((fc, i) =>
            targets.some(t => t.i === i) ? { ...fc, ...makeTempPatch(fc) } : fc
          );
          return executeActionSequence(
            addLog(
              { ...state, [targetOwner]: { ...tps, characterArea: newChars } },
              `${cn(sourceCard)}: all Characters gained 【${kwLabel}】 until next turn.`, 'action'
            ),
            owner, continuation, sourceCard, effectKey, fieldPos
          );
        }

        if (shouldPrompt(owner, state)) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_GRANT_KEYWORD_TARGET',
            targetOwner,
            keyword: kwLabel,
            indices: targets.map(t => t.i),
            max: action.count ?? 1,
          }, fieldPos);
        }
        // AI: pick first match
        const aiTarget = targets[0];
        const newChars = tps.characterArea.map((fc, i) =>
          i === aiTarget.i ? { ...fc, ...makeTempPatch(fc) } : fc
        );
        return addLog(
          { ...state, [targetOwner]: { ...tps, characterArea: newChars } },
          `${cn(sourceCard)}: gave 【${kwLabel}】 to ${cn(tps.characterArea[aiTarget.i].card)}.`, 'action'
        );
      }

      // Fallback: self-grant to fieldPos card (used by grantKwActions, e.g. 速攻：角色)
      if (!fieldPos) return state;
      const ps = state[owner];
      if (fieldPos.target === 'leader') {
        return addLog(
          { ...state, [owner]: { ...ps, leader: { ...ps.leader, ...patch } } },
          `${cn(sourceCard)} gained 【${kwLabel}】 this turn.`, 'action'
        );
      }
      const newChars = ps.characterArea.map((fc, i) =>
        i === fieldPos.target ? { ...fc, ...patch } : fc
      );
      return addLog(
        { ...state, [owner]: { ...ps, characterArea: newChars } },
        `${cn(sourceCard)} gained 【${kwLabel}】 this turn.`, 'action'
      );
    }

    case 'CHOOSE_GRANT_KEYWORD': {
      if (!fieldPos) return state;
      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_KEYWORD_TO_GRANT',
          keywords: action.keywords,
          until: action.until,
        }, fieldPos);
      }
      const aiKw = action.keywords.includes('雙重攻擊') ? '雙重攻擊' : action.keywords[0];
      const untilKey = action.until === 'opponent_turn_end' ? 'opponentTurnEndKeywords' : 'tempKeywords';
      const ps = state[owner];
      if (fieldPos.target === 'leader') {
        return addLog(
          { ...state, [owner]: { ...ps, leader: { ...ps.leader, [untilKey]: [...(ps.leader[untilKey] ?? []), aiKw] } } },
          `${cn(sourceCard)} gained 【${aiKw}】 (until end of opponent's turn).`, 'action'
        );
      }
      const newChars = ps.characterArea.map((fc, i) =>
        i === fieldPos.target ? { ...fc, [untilKey]: [...(fc[untilKey] ?? []), aiKw] } : fc
      );
      return addLog(
        { ...state, [owner]: { ...ps, characterArea: newChars } },
        `${cn(sourceCard)} gained 【${aiKw}】 (until end of opponent's turn).`, 'action'
      );
    }

    case 'CHOOSE_ONE': {
      if (!shouldPrompt(owner, state)) {
        // AI (non-pvp): picks the first option and runs it inline; outer continuation runs via loop
        const opt = action.options[0];
        if (!opt) return state;
        return executeActionSequence(state, owner, opt.actions, sourceCard, effectKey, fieldPos);
      }
      const enOptionLabels = [];
      if (sourceCard?.enEffect) {
        const enClauses = parseEffectEN(sourceCard.enEffect);
        const enChooseOne = enClauses.flatMap(c => c.actions ?? []).find(a => a.type === 'CHOOSE_ONE');
        enChooseOne?.options?.forEach((opt, i) => { enOptionLabels[i] = opt.label; });
      }
      return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
        type: 'CHOOSE_ONE_OPTION',
        options: action.options.map((opt, i) => ({ key: i, label: opt.label, enLabel: enOptionLabels[i] ?? null })),
      }, fieldPos);
    }

    case 'REVEAL_TOP_DECK':
      return addLog(state, `${cn(sourceCard)}: reveal top ${action.count} card(s) from ${action.owner ?? 'self'} deck.`, 'action');

    case 'DON_RETURN_FROM_FIELD': {
      const ps = state[owner];
      const isActive = d => d.state === 'active';
      const available = action.stateFilter === 'active'
        ? ps.costArea.filter(isActive).length
        : ps.costArea.length;
      const toReturn = Math.min(action.count ?? 1, available);
      const newCostArea = [...ps.costArea];
      const returned = [];
      for (let i = newCostArea.length - 1; i >= 0 && returned.length < toReturn; i--) {
        if (action.stateFilter !== 'active' || isActive(newCostArea[i])) {
          returned.push(...newCostArea.splice(i, 1));
        }
      }
      const newDonDeck = [...ps.donDeck, ...returned.map(d => ({ ...d, state: 'active' }))];
      const afterReturn = addLog(
        { ...state, [owner]: { ...ps, costArea: newCostArea, donDeck: newDonDeck } },
        `${cn(sourceCard)}: returned ${returned.length} DON!! to deck.`, 'action'
      );
      return returned.length > 0 ? fireDonReturnEffects(afterReturn, owner, returned.length) : afterReturn;
    }

    case 'LOOK_ARRANGE_LIFE': {
      const targetOwner = action.targetOwner === 'opponent' ? opponent : owner;
      const ps = state[targetOwner];
      if (!ps.lifeArea.length) return addLog(state, `${cn(sourceCard)}: no life cards to arrange.`, 'action');
      if (!shouldPrompt(owner, state)) {
        return addLog(state, `${cn(sourceCard)}: looked at life cards and kept order.`, 'action');
      }
      return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
        type: 'CHOOSE_ARRANGE_LIFE',
        targetOwner,
        lifeCards: [...ps.lifeArea],
        indices: [],
        max: ps.lifeArea.length,
        orderMode: true,
      }, fieldPos);
    }

    case 'EXTRA_TURN':
      return addLog({ ...state, extraTurn: (state.extraTurn ?? 0) + 1 }, `${cn(sourceCard)}: gain an extra turn!`, 'action');

    case 'BLOCK_EFFECT':
      return addLog(state, `${cn(sourceCard)}: opponent cannot activate effects (${action.until}).`, 'action');

    case 'CONDITIONAL_DEPLOY': {
      const lifeCard = state.lastRevealedLifeCard;
      if (!lifeCard) return executeActionSequence(
        { ...state, lastRevealedLifeCard: null },
        owner, continuation, sourceCard, effectKey, fieldPos
      );
      // Filter check: if a filter is specified, the revealed card must match to allow deploy.
      if (action.filter && !matchesFilter(lifeCard, action.filter)) {
        return addLog(
          { ...state, lastRevealedLifeCard: null },
          `${cn(sourceCard)}: revealed ${cn(lifeCard)} — does not match deploy condition.`, 'action'
        );
      }
      const ps = state[owner];
      const lifeIdx = ps.lifeArea.findIndex(c => c === lifeCard || c.id === lifeCard.id);
      if (lifeIdx === -1) return executeActionSequence(
        { ...state, lastRevealedLifeCard: null },
        owner, continuation, sourceCard, effectKey, fieldPos
      );
      const deployState = action.deployState ?? 'active';
      if (action.isOptional && shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_DEPLOY_FROM_LIFE',
          lifeCard,
          lifeIdx,
          deployState,
        }, fieldPos);
      }
      // AI or non-optional: deploy
      return execDeployFromLife(state, owner, lifeIdx, lifeCard, deployState, sourceCard, continuation, fieldPos);
    }

    case 'DON_EQUALIZE_EOT':
      return addLog(state, `${cn(sourceCard)}: DON!! equalization scheduled at end of turn.`, 'action');

    case 'WIN_GAME':
      return addLog({ ...state, gameOver: true, winner: owner }, `${cn(sourceCard)}: ${owner} wins the game!`, 'action');

    case 'DECLARE_COST':
      return addLog(state, `${cn(sourceCard)}: declare any cost.`, 'action');

    case 'SELECT_TARGET':
      return addLog(state, `${cn(sourceCard)}: selected target card(s) for conditional follow-up.`, 'action');

    case 'COPY_POWER_FROM_TARGET':
      return addLog(state, `${cn(sourceCard)}: base power set to match selected target's power (${action.until}).`, 'action');

    case 'COPY_POWER_FROM_ATTACKER': {
      const atkPower = state.battle?.atkPower ?? 0;
      const selfBasePower = sourceCard.power ?? 0;
      const delta = atkPower - selfBasePower;
      const s = addPowerMod(state, owner, fieldPos?.target ?? 'leader', delta, 'turn');
      return addLog(s, `${cn(sourceCard)}: base power becomes ${atkPower} (matching attacker) until end of turn.`, 'action');
    }

    case 'SWAP_BASE_POWER': {
      const swapPs = state[owner];
      if (action.leaderTarget) {
        // Card specifies leader + 1 character: leader is fixed, player chooses the character.
        const charTargets = swapPs.characterArea.map((fc, i) => ({ index: i, card: fc.card, zone: 'character' }));
        if (charTargets.length < 1) return state;
        if (shouldPrompt(owner, state)) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_SWAP_POWER_TARGET',
            leaderTarget: true,
            targets: charTargets,
            max: 1,
          }, fieldPos);
        }
        // AI: pick first character
        const charT = charTargets[0];
        const leaderPower = swapPs.leader.card.power ?? 0;
        const charPower = charT.card.power ?? 0;
        let s = addPowerMod(state, owner, 'leader', charPower - leaderPower, action.until);
        s = addPowerMod(s, owner, charT.index, leaderPower - charPower, action.until);
        return addLog(s, `${cn(sourceCard)}: swapped base power of Leader (${leaderPower}) and ${cn(charT.card)} (${charPower}) until end of battle.`, 'action');
      }
      const swapTargets = [];
      swapPs.characterArea.forEach((fc, i) => {
        if (matchesFilter(fc.card, action.filter, fc))
          swapTargets.push({ index: i, card: fc.card, zone: 'character' });
      });
      if (swapTargets.length < 2) return state;
      if (shouldPrompt(owner, state)) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_SWAP_POWER_TARGET',
          targets: swapTargets,
          max: 2,
        }, fieldPos);
      }
      // AI: pick first two
      const [tA, tB] = swapTargets;
      const pA = tA.card.power ?? 0;
      const pB = tB.card.power ?? 0;
      let s = addPowerMod(state, owner, tA.index, pB - pA, action.until);
      s = addPowerMod(s, owner, tB.index, pA - pB, action.until);
      return addLog(s, `${cn(sourceCard)}: swapped base power of ${cn(tA.card)} (${pA}) and ${cn(tB.card)} (${pB}) until end of turn.`, 'action');
    }

    case 'OPPONENT_HAND_TO_DECK': {
      const ops = state[opponent];
      const newDeck = action.shuffle
        ? [...ops.deck, ...ops.hand].sort(() => Math.random() - 0.5)
        : [...ops.deck, ...ops.hand];
      return addLog({ ...state, [opponent]: { ...ops, hand: [], deck: newDeck } }, `${cn(sourceCard)}: opponent returned all hand cards to deck.`, 'action');
    }

    case 'FORCE_ATTACK_TARGET':
      return addLog(state, `${cn(sourceCard)}: opponent must attack ${action.targetName}.`, 'action');

    case 'BLOCK_LIFE_TO_HAND': {
      const ps = state[owner];
      return addLog(
        { ...state, [owner]: { ...ps, lifeToHandBlocked: true } },
        `${cn(sourceCard)}: cannot add life cards to hand via own effects this turn.`,
        'action'
      );
    }

    case 'HAND_PLAY_LOCK': {
      const ps = state[owner];
      return addLog(
        { ...state, [owner]: { ...ps, handPlayLocked: true } },
        `${cn(sourceCard)}: cannot play cards from hand this turn.`, 'action'
      );
    }

    case 'DRAW_LOCK':
      return addLog(state, `${cn(sourceCard)}: cannot draw cards by own effects this turn.`, 'action');

    case 'REVEAL_LIFE_TOP':
      return addLog(state, `${cn(sourceCard)}: reveal up to ${action.count} card(s) from top of life zone.`, 'action');

    case 'DEPLOY_RESTED_PASSIVE':
      return addLog(state, `${cn(sourceCard)}: own characters enter play in rest state.`, 'action');

    case 'FLIP_LIFE_FACE_DOWN': {
      const ps = state[owner];
      let flipped = 0;
      const newLife = ps.lifeArea.map(lc => {
        if (flipped < (action.count ?? 1) && lc.faceUp) { flipped++; return { ...lc, faceUp: false }; }
        return lc;
      });
      return addLog({ ...state, [owner]: { ...ps, lifeArea: newLife } }, `${cn(sourceCard)}: flipped ${flipped} life card(s) face-down.`, 'action');
    }

    case 'ALTERNATE_NAMES':
      return state; // static rule read from card.effect by getAlternateNames(); no runtime action needed

    case 'CONDITIONAL': {
      // Mid-effect conditional: run nested actions only when the condition is met.
      if (!action.condition || evaluateCondition(state, owner, action.condition)) {
        return executeActionSequence(state, owner, [...(action.actions ?? []), ...continuation],
          sourceCard, effectKey, fieldPos);
      }
      return executeActionSequence(state, owner, [...(action.elseActions ?? []), ...continuation],
        sourceCard, effectKey, fieldPos);
    }

    case 'SELF_KO': {
      if (!fieldPos || fieldPos.target === 'leader') return state;
      const selfIdx = fieldPos.target;
      const ps = state[owner];
      const fc = ps.characterArea[selfIdx];
      if (!fc) return state;
      const returnedDon = Array.from({ length: fc.attachedDon }, (_, i) =>
        ({ ...makeDon(`self-ko-${i}`), state: 'rest' })
      );
      return addLog(appendFlash({
        ...state,
        [owner]: {
          ...ps,
          characterArea: ps.characterArea.filter((_, i) => i !== selfIdx),
          powerMods: shiftModsAfterRemoval(ps.powerMods ?? [], selfIdx),
          costMods:  shiftModsAfterRemoval(ps.costMods  ?? [], selfIdx),
          trash: [...ps.trash, fc.card],
          costArea: [...ps.costArea, ...returnedDon],
        },
      }, fc.card, 'KO'), `${cn(sourceCard)} was K.O.'d by its own effect!`, 'action');
    }

    case 'NULL_EFFECT': {
      if (action.targetOwner === 'opponent' && action.until === 'nextOppTurn') {
        const ops = state[opponent];
        return addLog(
          { ...state, [opponent]: { ...ops, onPlayBlocked: true } },
          `${cn(sourceCard)}: opponent's 【On Play】 effects are blocked until end of their next turn.`,
          'action'
        );
      }
      return addLog(state, `${cn(sourceCard)}: nullified effects of target card(s).`, 'action');
    }

    case 'REVEAL_DECK': {
      const ps = state[owner];
      if (!ps.deck.length) return state;
      const count = action.count ?? 1;
      const matchingIndices = [];
      for (let i = 0; i < ps.deck.length && matchingIndices.length < count; i++) {
        if (matchesFilter(ps.deck[i], action.filter)) matchingIndices.push(i);
      }
      if (!matchingIndices.length)
        return addLog(state, `${cn(sourceCard)}: no matching cards found in deck.`, 'action');
      const taken = matchingIndices.map(i => ps.deck[i]);
      const newDeck = ps.deck.filter((_, i) => !matchingIndices.includes(i));
      const s1 = { ...state, [owner]: { ...ps, deck: newDeck, hand: [...ps.hand, ...taken] } };
      const s2 = shouldPrompt(owner, state)
        ? taken.reduce((acc, c) => appendFlash(acc, c, 'REVEAL'), s1)
        : s1;
      return addLog(s2, `${cn(sourceCard)}: revealed ${taken.map(c => cn(c)).join(', ')} from deck and added to hand.`, 'action');
    }

    case 'SHUFFLE_DECK': {
      const target = action.owner === 'opponent' ? opponent : owner;
      const ps2 = state[target];
      const shuffled = [...ps2.deck].sort(() => Math.random() - 0.5);
      return addLog({ ...state, [target]: { ...ps2, deck: shuffled } }, `${cn(sourceCard)}: shuffled deck.`, 'action');
    }

    default:
      return state;
  }
}

// ─── Execute a sequence of actions ───────────────────────────────────────────

export function executeActionSequence(state, owner, actions, sourceCard, effectKey, fieldPos = null) {
  let s = state;
  for (let i = 0; i < actions.length; i++) {
    if (s.pendingEffect || s.pendingReplace) break;
    s = executeAction(s, owner, actions[i], sourceCard, effectKey,
      actions.slice(i + 1), fieldPos);
  }
  return s;
}

// ─── Resolve Interactive Choice ───────────────────────────────────────────────

export function resolveEffectChoice(state, { selectedIndices, selectedZone }) {
  const pe = state.pendingEffect;
  if (!pe) return state;

  const { owner, sourceCard, effectKey, action, continuation, choices, fieldPos, markUsedOnConfirm } = pe;
  let s = { ...state, pendingEffect: null };

  switch (choices.type) {

    case 'CHOOSE_KO_TARGET':
      for (const idx of selectedIndices.slice(0, action.count ?? 1))
        s = execKO(s, choices.targetOwner, idx, sourceCard.name);
      break;

    case 'CHOOSE_CONDITIONAL_KO_TARGET': {
      const idx = selectedIndices[0];
      if (idx === undefined) break;
      const fc = s[choices.targetOwner].characterArea[idx];
      if (!fc) break;
      if (fc.card.cost === fc.attachedDon) {
        s = execKO(s, choices.targetOwner, idx, sourceCard.name);
      } else {
        s = addLog(s, `${cn(sourceCard)}: condition not met — ${cn(fc.card)} has cost ${fc.card.cost} but ${fc.attachedDon} DON!! attached.`, 'action');
      }
      break;
    }

    case 'CHOOSE_KO_OR_DISCARD_HAND': {
      // selectedIndices[0] is an index into the combined [fieldTargets..., handIndices...] list
      const sel = selectedIndices[0];
      if (sel === undefined) break;
      const nField = choices.fieldTargets.length;
      if (sel < nField) {
        s = execKO(s, owner, choices.fieldTargets[sel].charIndex, sourceCard.name);
      } else {
        const handIdx = choices.handIndices[sel - nField];
        const ps = s[owner];
        const card = ps.hand[handIdx];
        s = addLog({
          ...s,
          [owner]: { ...ps, hand: ps.hand.filter((_, i) => i !== handIdx), trash: [...ps.trash, card] },
        }, `${cn(sourceCard)}: discarded ${cn(card)} from hand.`, 'action');
      }
      break;
    }

    case 'CHOOSE_RETURN_HAND_TARGET': {
      // selectedIndices are indices into choices.targets (not characterArea indices).
      // Sort by descending charIndex within the same owner to avoid shift after each removal.
      const toReturn = selectedIndices.slice(0, choices.max)
        .map(i => choices.targets[i])
        .filter(Boolean)
        .sort((a, b) => a.owner === b.owner ? b.charIndex - a.charIndex : 0);
      for (const t of toReturn) {
        s = execReturnHand(s, t.owner, t.charIndex, sourceCard.name);
        if (s.pendingEffect) {
          // Leave-field replacement triggered. Preserve the outer continuation so it
          // still runs after the replacement resolves (confirm path: fold into pendingEffect;
          // decline path: store context in pendingLeaveField).
          if (continuation.length > 0) {
            const outerCtx = { actions: continuation, owner, sourceCard, effectKey, fieldPos };
            s = {
              ...s,
              pendingEffect: {
                ...s.pendingEffect,
                continuation: [...s.pendingEffect.continuation, ...continuation],
              },
              ...(s.pendingLeaveField && {
                pendingLeaveField: { ...s.pendingLeaveField, returnHandContinuation: outerCtx },
              }),
            };
          }
          break;
        }
      }
      break;
    }

    case 'CHOOSE_ADD_TO_HAND_TARGET': {
      if (choices.zone === 'trash') {
        // Sort descending so later removals don't shift earlier indices
        const sorted = [...selectedIndices].slice(0, choices.max).sort((a, b) => b - a);
        for (const idx of sorted) {
          const currentPs = s[choices.sourceOwner];
          const card = currentPs.trash[idx];
          if (!card) continue;
          s = addLog({
            ...s,
            [choices.sourceOwner]: {
              ...currentPs,
              trash: currentPs.trash.filter((_, i) => i !== idx),
              hand:  [...currentPs.hand, card],
            },
          }, `${cn(sourceCard)}: moved ${cn(card)} from trash to hand.`, 'action');
        }
      } else if (choices.zone === 'field') {
        const toReturn = selectedIndices.slice(0, choices.max)
          .map(i => choices.targets[i])
          .filter(Boolean)
          .sort((a, b) => a.owner === b.owner ? b.charIndex - a.charIndex : 0);
        for (const t of toReturn)
          s = execReturnHand(s, t.owner, t.charIndex, sourceCard.name);
      }
      break;
    }

    case 'CHOOSE_REST_TARGET': {
      // Cancel: undo the once-per-turn mark and abort continuation entirely
      if (selectedIndices === 'CANCEL') {
        const ps = s[owner];
        const newEffectUsed = { ...(ps.effectUsed ?? {}) };
        delete newEffectUsed[effectKey];
        return { ...s, [owner]: { ...ps, effectUsed: newEffectUsed } };
      }
      let donRestedCount = 0;
      if (choices.targets) {
        // New all-zone format: selectedIndices are indices into choices.targets
        for (const si of selectedIndices.slice(0, choices.max)) {
          const t = choices.targets[si];
          if (!t) continue;
          if (t.zone === 'don') donRestedCount++;
          s = execRestTarget(s, choices.targetOwner, t, sourceCard.name, action.lockNextRefresh);
        }
      } else {
        // Legacy character-index format
        for (const idx of selectedIndices.slice(0, choices.max)) {
          const tps = s[choices.targetOwner];
          const newChars = tps.characterArea.map((fc, i) =>
            i === idx ? { ...fc, state: 'rest', ...(action.lockNextRefresh ? { refreshLocked: true } : {}) } : fc
          );
          s = addLog({ ...s, [choices.targetOwner]: { ...tps, characterArea: newChars } },
            `${cn(tps.characterArea[idx].card)} rested${action.lockNextRefresh ? ' (locked next refresh)' : ''}.`, 'action');
        }
      }
      if (donRestedCount > 0 && continuation.some(a => a.type === 'POWER_MOD_PER_DON_RESTED')) {
        const updatedCont = continuation.map(a =>
          a.type === 'POWER_MOD_PER_DON_RESTED' ? { ...a, totalDelta: donRestedCount * a.delta } : a
        );
        if (!s.pendingReplace && !s.pendingEffect)
          return executeActionSequence(s, owner, updatedCont, sourceCard, effectKey, fieldPos);
      }
      break;
    }

    case 'CHOOSE_UNREST_TARGET': {
      const kwUntilKey2 = action.grantKeywordUntil === 'opponent_turn_end' ? 'opponentTurnEndKeywords' : 'tempKeywords';
      for (const si of selectedIndices.slice(0, choices.max)) {
        const t = choices.targets[si];
        if (!t) continue;
        const tps = s[choices.targetOwner];
        if (t.zone === 'leader') {
          const kwPatch = action.grantKeywords?.length ? { [kwUntilKey2]: [...(tps.leader[kwUntilKey2] ?? []), ...action.grantKeywords] } : {};
          s = addLog(
            { ...s, [choices.targetOwner]: { ...tps, leader: { ...tps.leader, state: 'active', ...kwPatch } } },
            `${cn(tps.leader.card)} activated.`, 'action'
          );
        } else {
          s = addLog({
            ...s,
            [choices.targetOwner]: { ...tps, characterArea: tps.characterArea.map((fc, i) => {
              if (i !== t.index) return fc;
              const kwArr = action.grantKeywords?.length ? { [kwUntilKey2]: [...(fc[kwUntilKey2] ?? []), ...action.grantKeywords] } : {};
              return { ...fc, state: 'active', ...kwArr };
            }) },
          }, `${cn(tps.characterArea[t.index].card)} activated.`, 'action');
          // Apply power mod to the unrested character (e.g. OP01-003 Luffy +1000 this turn)
          if (action.powerMod) {
            s = addPowerMod(s, choices.targetOwner, t.index, action.powerMod.delta, action.powerMod.until);
          }
        }
      }
      break;
    }

    case 'CHOOSE_REFRESH_LOCK_TARGET': {
      for (const si of selectedIndices.slice(0, choices.max)) {
        const t = choices.targets[si];
        if (!t) continue;
        const tps = s[choices.targetOwner];
        if (t.zone === 'leader') {
          s = addLog({
            ...s,
            [choices.targetOwner]: { ...tps, leader: { ...tps.leader, refreshLocked: true } },
          }, `${cn(tps.leader.card)}: will not refresh next turn.`, 'action');
        } else if (t.zone === 'don') {
          s = addLog({
            ...s,
            [choices.targetOwner]: { ...tps, costArea: tps.costArea.map(d =>
              d._donId === t.donId ? { ...d, refreshLocked: true } : d
            ) },
          }, `DON!!: will not refresh next turn.`, 'action');
        } else {
          s = addLog({
            ...s,
            [choices.targetOwner]: { ...tps, characterArea: tps.characterArea.map((fc, i) =>
              i === t.index ? { ...fc, refreshLocked: true } : fc
            ) },
          }, `${cn(tps.characterArea[t.index].card)}: will not refresh next turn.`, 'action');
        }
      }
      break;
    }

    case 'CHOOSE_PREVENT_REST_TARGET': {
      for (const idx of selectedIndices.slice(0, choices.max)) {
        const tps = s[choices.targetOwner];
        s = addLog({
          ...s,
          [choices.targetOwner]: { ...tps, characterArea: tps.characterArea.map((fc, i) =>
            i === idx ? { ...fc, restLocked: true } : fc
          ) },
        }, `${cn(tps.characterArea[idx].card)}: cannot be rested until end of next turn.`, 'action');
      }
      break;
    }

    case 'CHOOSE_ATTACK_LOCK_TARGET': {
      for (const idx of selectedIndices.slice(0, choices.max)) {
        const tps = s[choices.targetOwner];
        s = addLog({
          ...s,
          [choices.targetOwner]: { ...tps, characterArea: tps.characterArea.map((fc, i) =>
            i === idx ? { ...fc, attackLocked: true } : fc
          ) },
        }, `${cn(tps.characterArea[idx].card)}: cannot attack until end of opponent's turn.`, 'action');
      }
      break;
    }

    case 'CHOOSE_DEPLOY_FROM_TRASH': {
      s = { ...s, _lastDeployedCount: 0 };
      let deployedNames = [];
      const deployIndices = choices.uniqueName
        ? [...selectedIndices].sort((a, b) => b - a).filter(idx => {
            const name = s[choices.sourceOwner].trash[idx]?.name;
            if (deployedNames.includes(name)) return false;
            deployedNames.push(name);
            return true;
          }).slice(0, choices.max)
        : [...selectedIndices].sort((a, b) => b - a).slice(0, choices.max);
      for (const idx of deployIndices) {
        const currentPs = s[choices.sourceOwner];
        if (currentPs.characterArea.length >= 5) {
          s = {
            ...s,
            pendingReplace: {
              type: 'DEPLOY_FROM_TRASH',
              owner: choices.sourceOwner,
              card: currentPs.trash[idx],
              trashIndex: idx,
              continuation,
              effectKey,
              sourceCard,
            },
          };
          return s;
        }
        s = execDeployFromTrash(s, choices.sourceOwner, idx, sourceCard.name);
      }
      break;
    }

    case 'CHOOSE_FIELD_FOR_LIFE': {
      const ftlCharIdx = choices.indices[selectedIndices[0]];
      if (ftlCharIdx === undefined) break;
      const ftlPs = s[owner];
      const ftlFc = ftlPs.characterArea[ftlCharIdx];
      if (!ftlFc) break;
      const ftlNewChars = ftlPs.characterArea.filter((_, i) => i !== ftlCharIdx);
      const ftlCurFU = ftlPs.lifeAreaFaceUp ?? ftlPs.lifeArea.map(() => false);
      s = addLog({
        ...s,
        [owner]: {
          ...ftlPs,
          characterArea: ftlNewChars,
          powerMods: shiftModsAfterRemoval(ftlPs.powerMods ?? [], ftlCharIdx),
          costMods:  shiftModsAfterRemoval(ftlPs.costMods  ?? [], ftlCharIdx),
          lifeArea: [...ftlPs.lifeArea, ftlFc.card],
          lifeAreaFaceUp: [...ftlCurFU, choices.faceUp ?? true],
        },
      }, `${cn(sourceCard)}: placed ${cn(ftlFc.card)} face-up into life.`, 'action');
      break;
    }

    case 'CHOOSE_TRASH_FOR_LIFE_OR_FIELD': {
      const trashIdx = selectedIndices[0];
      if (trashIdx === undefined) break;
      const srcZonePool = choices.sourceZone === 'hand' ? s[choices.sourceOwner].hand : s[choices.sourceOwner].trash;
      const chosenCard = srcZonePool[trashIdx];
      if (!chosenCard) break;
      // Ask player: deploy to field OR add face-up to life top
      return setPendingEffect(s, owner, sourceCard, effectKey, action, continuation, {
        type: 'CHOOSE_TRASH_CARD_DEST',
        sourceOwner: choices.sourceOwner,
        sourceZone: choices.sourceZone,
        trashIndex: trashIdx,
        faceUp: choices.faceUp,
        cardName: chosenCard.name,
      }, fieldPos);
    }

    case 'CHOOSE_TRASH_CARD_DEST': {
      const destIdx = selectedIndices[0];
      if (destIdx === undefined) break;
      const ps = s[choices.sourceOwner];
      const fromHand = choices.sourceZone === 'hand';
      const srcPool = fromHand ? ps.hand : ps.trash;
      const card = srcPool[choices.trashIndex];
      if (!card) break;
      if (destIdx === 0) {
        // Add face-up to top of life deck
        const newPool = srcPool.filter((_, i) => i !== choices.trashIndex);
        const curFU = ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false);
        s = addLog({
          ...s,
          [choices.sourceOwner]: {
            ...ps,
            ...(fromHand ? { hand: newPool } : { trash: newPool }),
            lifeArea: [...ps.lifeArea, card],
            lifeAreaFaceUp: [...curFU, choices.faceUp ?? false],
          },
        }, `${cn(sourceCard)}: added ${cn(card)} face-up to top of life.`, 'action');
      } else {
        // Deploy to field
        s = fromHand
          ? execDeploy(s, choices.sourceOwner, choices.trashIndex, sourceCard.name)
          : execDeployFromTrash(s, choices.sourceOwner, choices.trashIndex, sourceCard.name);
      }
      break;
    }

    case 'CHOOSE_DEPLOY_FROM_HAND': {
      s = { ...s, _lastDeployedCount: 0 };
      for (const idx of [...selectedIndices].sort((a, b) => b - a).slice(0, choices.max)) {
        const currentPs = s[choices.sourceOwner];
        const deployingCard = currentPs.hand[idx];
        // Stage cards always go to stageArea — skip the character-area-full check
        if (currentPs.characterArea.length >= 5 && deployingCard?.category !== 'Stage') {
          // Field is full and it's a human deploy — ask which character to replace
          s = {
            ...s,
            pendingReplace: {
              type: 'DEPLOY',
              owner: choices.sourceOwner,
              card: deployingCard,
              handIndex: idx,
              continuation,
              effectKey,
              sourceCard,
            },
          };
          return s;
        }
        s = execDeploy(s, choices.sourceOwner, idx, sourceCard.name, choices.deployState ?? 'active');
        // Queue on-play trigger — drained after continuation settles in applyResolveEffectChoice
        s = { ...s, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card: deployingCard, owner: choices.sourceOwner }] };
      }
      break;
    }

    case 'CHOOSE_DEPLOY_FROM_HAND_OR_TRASH': {
      if (selectedZone === 'hand') {
        for (const idx of [...selectedIndices].sort((a, b) => b - a).slice(0, choices.max)) {
          const currentPs = s[choices.sourceOwner];
          if (currentPs.characterArea.length >= 5) {
            s = {
              ...s,
              pendingReplace: {
                type: 'DEPLOY',
                owner: choices.sourceOwner,
                card: currentPs.hand[idx],
                handIndex: idx,
                continuation,
                effectKey,
                sourceCard,
              },
            };
            return s;
          }
          const deployedCard = currentPs.hand[idx];
          s = execDeploy(s, choices.sourceOwner, idx, sourceCard.name);
          s = { ...s, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card: deployedCard, owner: choices.sourceOwner }] };
        }
      } else {
        // from trash
        let deployedNames = [];
        const deployIndices = choices.uniqueName
          ? [...selectedIndices].sort((a, b) => b - a).filter(idx => {
              const name = s[choices.sourceOwner].trash[idx]?.name;
              if (deployedNames.includes(name)) return false;
              deployedNames.push(name);
              return true;
            }).slice(0, choices.max)
          : [...selectedIndices].sort((a, b) => b - a).slice(0, choices.max);
        for (const idx of deployIndices) {
          const currentPs = s[choices.sourceOwner];
          if (currentPs.characterArea.length >= 5) {
            s = {
              ...s,
              pendingReplace: {
                type: 'DEPLOY_FROM_TRASH',
                owner: choices.sourceOwner,
                card: currentPs.trash[idx],
                trashIndex: idx,
                continuation,
                effectKey,
                sourceCard,
              },
            };
            return s;
          }
          s = execDeployFromTrash(s, choices.sourceOwner, idx, sourceCard.name);
        }
      }
      break;
    }

    case 'CHOOSE_DISCARD': {
      const sorted = [...selectedIndices].sort((a, b) => b - a);
      const ps = s[owner];

      if (choices.fromZone === 'field') {
        // Remove chosen characters from the character area and send to trash
        let ps2 = ps;
        for (const idx of sorted) {
          const fc = ps2.characterArea[idx];
          if (!fc) continue;
          const returnedDon = Array.from({ length: fc.attachedDon ?? 0 }, (_, k) =>
            ({ ...makeDon(`trash-field-res-${idx}-${k}`), state: 'rest' })
          );
          ps2 = {
            ...ps2,
            characterArea: ps2.characterArea.filter((_, i) => i !== idx),
            powerMods: shiftModsAfterRemoval(ps2.powerMods ?? [], idx),
            costMods:  shiftModsAfterRemoval(ps2.costMods  ?? [], idx),
            trash:    [...ps2.trash, fc.card],
            costArea: [...ps2.costArea, ...returnedDon],
          };
        }
        s = addLog(appendFlash({ ...s, [owner]: ps2 }, ps2.trash[ps2.trash.length - 1], 'DISCARD'),
          `Trashed ${sorted.length} character(s) from field.`, 'action');
        break;
      }

      let hand = [...ps.hand], trash = [...ps.trash];
      for (const idx of sorted) { trash.push(hand[idx]); hand.splice(idx, 1); }
      s = addLog(appendFlash({ ...s, [owner]: { ...ps, hand, trash } }, trash[trash.length - 1], 'DISCARD'),
        `Discarded ${sorted.length} card(s).`, 'action');
      const compTrait = leaderDiscardCompensationTrait(s, owner);
      if (sorted.length && compTrait && (sourceCard?.types ?? []).some(t => t.includes(compTrait)))
        s = execDraw(s, owner, sorted.length, s[owner].leader.card.name);
      break;
    }

    case 'CHOOSE_HAND_TO_DECK': {
      const ps = s[owner];
      const take = Math.min(choices.max, selectedIndices.length);
      const sorted = [...selectedIndices].sort((a, b) => b - a).slice(0, take);
      const chosen = sorted.map(i => ps.hand[i]);
      let hand = [...ps.hand];
      for (const idx of sorted) hand.splice(idx, 1);
      s = addLog({ ...s, [owner]: { ...ps, hand, lastReturnedToDeckCount: take } },
        `Placed ${take} hand card(s) on deck.`, 'action');
      // Pipe into SEARCH_ORDER so player can arrange cards and choose top or bottom
      return setPendingEffect(s, owner, sourceCard, effectKey, action, continuation, {
        type: 'SEARCH_ORDER',
        remaining: chosen,
        canPlaceOnTop: choices.canPlaceOnTop,
      }, fieldPos);
    }

    case 'CHOOSE_DISCARD_FREE': {
      // Player chose 0 or more cards to discard (selectedIndices may be empty = skip).
      const sorted = [...selectedIndices].sort((a, b) => b - a);
      const ps = s[owner];
      let hand = [...ps.hand], trash = [...ps.trash];
      for (const idx of sorted) { trash.push(hand[idx]); hand.splice(idx, 1); }
      s = addLog(
        { ...s, [owner]: { ...ps, hand, trash, lastDiscardCount: sorted.length } },
        sorted.length ? `Discarded ${sorted.length} card(s).` : `Skipped discard.`, 'action'
      );
      break;
    }

    case 'SEARCH_PICK': {
      const ps      = s[owner];
      const allowed = choices.eligibleIndices ?? choices.revealed.map((_, i) => i);
      const validPicks = selectedIndices
        .filter(i => allowed.includes(i))
        .slice(0, choices.take);
      const taken     = validPicks.map(i => choices.revealed[i]);
      const remaining = choices.revealed.filter((_, i) => !validPicks.includes(i));
      const deckBase  = ps.deck.slice(0, -choices.revealed.length); // deck with revealed slots removed

      // When the effect requires 公開 (reveal), flash each taken card and name it in the log.
      const addRevealFlashes = st => choices.reveal
        ? taken.reduce((acc, card) => appendFlash(acc, card, 'REVEAL'), st)
        : st;
      const pickLog = choices.reveal && taken.length > 0
        ? `${cn(sourceCard)}: revealed ${taken.map(c => cn(c)).join(', ')}.`
        : null;

      if (choices.remainderToTrash) {
        s = addLog(addRevealFlashes({
          ...s,
          [owner]: { ...ps, hand: [...ps.hand, ...taken], deck: deckBase, trash: [...ps.trash, ...remaining] },
        }), pickLog ?? `Picked ${taken.length} card(s) — rest sent to trash.`, 'action');
        break;
      }

      if (choices.destination === 'life') {
        const curFU = ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false);
        const destState = {
          ...s,
          [owner]: {
            ...ps,
            deck: deckBase,
            lifeArea: [...ps.lifeArea, ...taken],
            lifeAreaFaceUp: [...curFU, ...taken.map(() => choices.faceUp ?? true)],
          },
        };
        if (remaining.length > 1) {
          s = addLog(addRevealFlashes({
            ...destState,
            pendingEffect: { owner, sourceCard, effectKey, action, continuation,
              choices: { type: 'SEARCH_ORDER', remaining, canPlaceOnTop: false } },
          }), pickLog ?? `Added ${taken.length} card(s) face-up to life — arrange the rest for the bottom of deck.`, 'action');
          return s;
        }
        const newDeck = [...remaining, ...deckBase];
        s = addLog(addRevealFlashes({ ...destState, [owner]: { ...destState[owner], deck: newDeck } }),
          pickLog ?? `Added ${taken.length} card(s) face-up to life.`, 'action');
        break;
      }

      if (remaining.length > 1 || (remaining.length === 1 && choices.canPlaceOnTop)) {
        // Let the player arrange remaining cards; canPlaceOnTop lets them choose top or bottom
        const orderHint = choices.canPlaceOnTop
          ? `Picked ${taken.length} card(s) — arrange the rest (top or bottom of deck).`
          : `Picked ${taken.length} card(s) — arrange the rest for the bottom of the deck.`;
        s = addLog(addRevealFlashes({
          ...s,
          [owner]: { ...ps, hand: [...ps.hand, ...taken], deck: deckBase },
          pendingEffect: { owner, sourceCard, effectKey, action, continuation,
            choices: { type: 'SEARCH_ORDER', remaining, canPlaceOnTop: choices.canPlaceOnTop ?? false } },
        }), pickLog ?? orderHint, 'action');
        return s;
      }

      // 0 or 1 remaining without top-or-bottom choice — goes straight to bottom
      const newDeck = [...remaining, ...deckBase];
      s = addLog(addRevealFlashes({ ...s, [owner]: { ...ps, deck: newDeck, hand: [...ps.hand, ...taken] } }),
        pickLog ?? `Picked ${taken.length} card(s).`, 'action');
      break;
    }

    case 'SEARCH_ORDER': {
      // Sentinel: -1 appended to selectedIndices means "place on top of deck"
      const placeOnTop  = choices.canPlaceOnTop && selectedIndices[selectedIndices.length - 1] === -1;
      const orderIdx    = placeOnTop ? selectedIndices.slice(0, -1) : selectedIndices;
      const ps          = s[owner];
      const tapOrder    = orderIdx.map(i => choices.remaining[i]);
      const ordered     = [...tapOrder].reverse(); // tap[0]=drawn first → reversed = deck-order
      const newDeck     = placeOnTop
        ? [...ps.deck, ...ordered]   // append → top of deck (ordered[last] = topmost)
        : [...ordered, ...ps.deck];  // prepend → bottom of deck
      // Cards here are private info (deck-look leftovers or hand cards) — no flash.
      s = addLog({ ...s, [owner]: { ...ps, deck: newDeck } },
        `Placed ${ordered.length} cards on deck ${placeOnTop ? 'top' : 'bottom'}.`, 'action');
      break;
    }

    case 'CHOOSE_POWER_TARGET': {
      const selIdx = selectedIndices[0];
      if (selIdx !== undefined) {
        const t = choices.targets[selIdx];
        if (t) {
          const target = t.zone === 'leader' ? 'leader' : t.index;
          const modOpts = action.setToZero ? { setToZero: true } : {};
          const effectiveDelta = action.totalDelta ?? action.delta ?? 0;
          const chooseLog = action.setToZero
            ? `Power set to 0 applied.`
            : `Power ${effectiveDelta > 0 ? '+' : ''}${effectiveDelta} applied.`;
          s = addLog(
            addPowerMod(s, choices.targetOwner, target, effectiveDelta, action.until, modOpts),
            chooseLog, 'action'
          );
          if (action.grantKeyword) s = applyTempKeyword(s, choices.targetOwner, t, action.grantKeyword);
        }
      }
      break;
    }

    case 'CHOOSE_SWAP_POWER_TARGET': {
      if (choices.leaderTarget) {
        // Leader is fixed; player chose 1 character.
        const charT = choices.targets[selectedIndices[0]];
        if (charT) {
          const leaderPower = s[owner].leader.card.power ?? 0;
          const charPower = charT.card.power ?? 0;
          s = addPowerMod(s, owner, 'leader', charPower - leaderPower, action.until);
          s = addPowerMod(s, owner, charT.index, leaderPower - charPower, action.until);
          s = addLog(s, `Swapped base power: Leader now ${charPower}, ${cn(charT.card)} now ${leaderPower} until end of battle.`, 'action');
        }
      } else if (selectedIndices.length >= 2) {
        const [idxA, idxB] = selectedIndices;
        const tA = choices.targets[idxA];
        const tB = choices.targets[idxB];
        if (tA && tB) {
          const pA = tA.card.power ?? 0;
          const pB = tB.card.power ?? 0;
          s = addPowerMod(s, owner, tA.index, pB - pA, action.until);
          s = addPowerMod(s, owner, tB.index, pA - pB, action.until);
          s = addLog(s, `Swapped base power: ${cn(tA.card)} now ${pB}, ${cn(tB.card)} now ${pA} until end of turn.`, 'action');
        }
      }
      break;
    }

    case 'CHOOSE_COST_TARGET': {
      const idx = selectedIndices[0];
      if (idx !== undefined) {
        s = addLog(
          addCostMod(s, choices.targetOwner, idx, action.delta, action.until),
          `Cost ${action.delta > 0 ? '+' : ''}${action.delta} applied.`, 'action'
        );
      }
      break;
    }

    case 'CHOOSE_COST_SET_TARGET': {
      const idx = selectedIndices[0];
      if (idx !== undefined) {
        const targetCard = s[choices.targetOwner].characterArea[idx].card;
        const delta = action.targetCost - (targetCard.cost ?? 0);
        s = addLog(
          addCostMod(s, choices.targetOwner, idx, delta, action.until),
          `Cost set to ${action.targetCost} on ${cn(targetCard)}.`, 'action'
        );
      }
      break;
    }

    case 'CHOOSE_REVEAL_CARDS': {
      const revealedCards = selectedIndices.slice(0, choices.count).map(i => s[owner].hand[i]);
      s = addLog(s, `${cn(sourceCard)}: revealed ${revealedCards.map(c => cn(c)).join(', ')}.`, 'action');
      break; // cards stay in hand; continuation (draw + discard) runs below
    }

    case 'CHOOSE_REVEAL_HAND': {
      // Player selected which cards from hand to reveal (stay in hand)
      const ps = s[owner];
      const picked = selectedIndices.slice(0, choices.max).map(i => ps.hand[i]).filter(Boolean);
      if (!picked.length) break;
      s = picked.reduce((acc, card) => appendFlash(acc, card, 'REVEAL'), s);
      s = addLog(s, `${cn(sourceCard)}: revealed ${picked.map(c => cn(c)).join(', ')}.`, 'action');
      if (choices.deployCount > 0) {
        return setPendingEffect(s, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_DEPLOY_REVEALED',
          revealed: picked,
          deployCount: choices.deployCount,
          restIfCostLte: choices.restIfCostLte ?? null,
        }, fieldPos);
      }
      break;
    }

    case 'CHOOSE_DEPLOY_REVEALED': {
      // Player selected which revealed card(s) to deploy active; rest auto-deploy rested if cost ≤ threshold
      const { revealed, deployCount, restIfCostLte } = choices;
      const pickedIdx = selectedIndices.slice(0, deployCount);
      const pickedCards = pickedIdx.map(i => revealed[i]).filter(Boolean);
      const restCards = revealed.filter((_, i) => !pickedIdx.includes(i));

      for (const card of pickedCards) {
        const handIdx = s[owner].hand.indexOf(card);
        if (handIdx >= 0) {
          const dc = card;
          if (s[owner].characterArea.length >= 5) {
            s = { ...s, pendingReplace: { type: 'DEPLOY', owner, card: dc, handIndex: handIdx, continuation, effectKey, sourceCard } };
            return s;
          }
          s = execDeploy(s, owner, handIdx, sourceCard.name, 'active');
          s = { ...s, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card: dc, owner }] };
        }
      }
      for (const card of restCards) {
        if (restIfCostLte !== null && (card.cost ?? 0) <= restIfCostLte) {
          const handIdx = s[owner].hand.indexOf(card);
          if (handIdx >= 0) {
            const dc = card;
            s = execDeploy(s, owner, handIdx, sourceCard.name, 'rest');
            s = { ...s, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card: dc, owner }] };
          }
        }
      }
      break;
    }

    case 'CONFIRM_OPTIONAL_ACTIVATION':
      if (selectedIndices.length === 0) {
        if (s.pendingKOReplacement) {
          // Player chose NOT to replace the KO — apply it now
          const pkr = s.pendingKOReplacement;
          s = { ...s, pendingKOReplacement: null };
          const defPs = s[pkr.targetOwner];
          s = addLog({
            ...s,
            [pkr.targetOwner]: {
              ...defPs,
              characterArea: defPs.characterArea.filter((_, i) => i !== pkr.targetIndex),
              powerMods: shiftModsAfterRemoval(defPs.powerMods ?? [], pkr.targetIndex),
              costMods:  shiftModsAfterRemoval(defPs.costMods  ?? [], pkr.targetIndex),
              trash: [...defPs.trash, pkr.koCard],
              costArea: [...defPs.costArea, ...pkr.returnedDon],
            },
          }, `${pkr.koCard.name} was KO'd!`, 'battle');
          // Queue KO-timing effects for RESOLVE_EFFECT_CHOICE to drain
          s = { ...s, pendingKOEffects: [...(s.pendingKOEffects ?? []), { card: pkr.koCard, owner: pkr.targetOwner }] };
        }
        if (s.pendingLeaveField) {
          // Player chose NOT to use the leave-field replacement — execute the original removal
          const plf = s.pendingLeaveField;
          s = { ...s, pendingLeaveField: null };
          if (plf.context === 'KO') {
            const defPs = s[plf.targetOwner];
            s = addLog({
              ...s,
              [plf.targetOwner]: {
                ...defPs,
                characterArea: defPs.characterArea.filter((_, i) => i !== plf.targetIndex),
                powerMods: shiftModsAfterRemoval(defPs.powerMods ?? [], plf.targetIndex),
                costMods:  shiftModsAfterRemoval(defPs.costMods  ?? [], plf.targetIndex),
                trash: [...defPs.trash, plf.koCard],
                costArea: [...defPs.costArea, ...plf.returnedDon],
              },
            }, `${plf.koCard.name} was KO'd!`, 'battle');
            s = { ...s, pendingKOEffects: [...(s.pendingKOEffects ?? []), { card: plf.koCard, owner: plf.targetOwner }] };
          } else if (plf.context === 'RETURN_HAND') {
            const tps = s[plf.targetOwner];
            const fc  = tps.characterArea[plf.targetIndex];
            if (fc) {
              const retDon = Array.from({ length: fc.attachedDon ?? 0 }, (_, k) =>
                ({ _donId: `rh-plf-${k}`, state: 'rest' })
              );
              s = addLog(appendFlash({
                ...s,
                [plf.targetOwner]: {
                  ...tps,
                  characterArea: tps.characterArea.filter((_, i) => i !== plf.targetIndex),
                  powerMods: shiftModsAfterRemoval(tps.powerMods ?? [], plf.targetIndex),
                  costMods:  shiftModsAfterRemoval(tps.costMods  ?? [], plf.targetIndex),
                  hand:     [...tps.hand, fc.card],
                  costArea: [...tps.costArea, ...retDon],
                },
              }, fc.card, 'RETURN_HAND'), `${plf.sourceName}: returned ${fc.card.name} to hand.`, 'action');
            }
            // Resume outer continuation (e.g. UNREST) that was deferred by the leave-field prompt
            if (plf.returnHandContinuation && !s.pendingEffect && !s.pendingReplace) {
              const { actions, owner: rOwner, sourceCard: rCard, effectKey: rKey, fieldPos: rPos } = plf.returnHandContinuation;
              s = executeActionSequence(s, rOwner, actions, rCard, rKey, rPos);
            }
          } else if (plf.context === 'ADD_TO_LIFE') {
            const tps = s[plf.targetOwner];
            const fc  = tps.characterArea[plf.targetIndex];
            if (fc) {
              const retDon = Array.from({ length: fc.attachedDon ?? 0 }, (_, k) =>
                ({ _donId: `atl-plf-${k}`, state: 'rest' })
              );
              const lps = s[plf.lifeOwner];
              const curFaceUp = lps.lifeAreaFaceUp ?? lps.lifeArea.map(() => false);
              s = addLog(appendFlash({
                ...s,
                [plf.targetOwner]: {
                  ...tps,
                  characterArea: tps.characterArea.filter((_, i) => i !== plf.targetIndex),
                  powerMods: shiftModsAfterRemoval(tps.powerMods ?? [], plf.targetIndex),
                  costMods:  shiftModsAfterRemoval(tps.costMods  ?? [], plf.targetIndex),
                  costArea: [...tps.costArea, ...retDon],
                },
                [plf.lifeOwner]:   { ...lps, lifeArea: [fc.card, ...lps.lifeArea], lifeAreaFaceUp: [false, ...curFaceUp] },
              }, fc.card, 'ADD_LIFE'), `${plf.sourceName}: added ${fc.card.name} to life.`, 'action');
            }
          } else if (plf.context === 'BOTTOM_DECK') {
            const tps = s[plf.targetOwner];
            const fc  = tps.characterArea[plf.targetIndex];
            if (fc) {
              const retDon = Array.from({ length: fc.attachedDon ?? 0 }, (_, k) =>
                ({ _donId: `bd-plf-${k}`, state: 'rest' })
              );
              s = addLog(appendFlash({
                ...s,
                [plf.targetOwner]: {
                  ...tps,
                  characterArea: tps.characterArea.filter((_, i) => i !== plf.targetIndex),
                  powerMods: shiftModsAfterRemoval(tps.powerMods ?? [], plf.targetIndex),
                  costMods:  shiftModsAfterRemoval(tps.costMods  ?? [], plf.targetIndex),
                  deck: [fc.card, ...tps.deck],
                  costArea: [...tps.costArea, ...retDon],
                },
              }, fc.card, 'BOTTOM_DECK'), `${plf.sourceName}: sent ${fc.card.name} to bottom of deck.`, 'action');
            }
          }
        }
        return s; // player skipped — drop cost + effect
      }
      // Player confirmed — KO is prevented; clear the pending replacement records
      if (s.pendingKOReplacement) s = { ...s, pendingKOReplacement: null };
      if (s.pendingLeaveField)    s = { ...s, pendingLeaveField: null };
      if (markUsedOnConfirm) s = markEffectUsedLocal(s, owner, effectKey);
      if (action.donReturn) {
        // Pay the don cost now that the player confirmed activation
        const ps = s[owner];
        const opts = buildDonReturnOptions(ps);
        if (opts.length < action.donReturn) break; // can't afford — skip
        return setPendingEffect(s, owner, sourceCard, effectKey,
          { type: 'CHOOSE_DON_RETURN', count: action.donReturn },
          continuation,
          { type: 'CHOOSE_DON_RETURN', count: action.donReturn, options: opts },
          fieldPos
        );
      }
      break; // player confirmed — continuation (cost → effect) runs below

    case 'CHOOSE_DON_UNREST': {
      const ps          = s[owner];
      const toActivate  = selectedIndices.slice(0, choices.max).map(i => choices.options[i]);
      const activateIds = new Set(toActivate.map(d => d._donId));
      s = addLog({
        ...s,
        [owner]: { ...ps, costArea: ps.costArea.map(d => activateIds.has(d._donId) ? { ...d, state: 'active' } : d) },
      }, `Activated ${toActivate.length} DON!!.`, 'action');
      break;
    }

    case 'CHOOSE_DON_ATTACH_TARGET': {
      const maxTargets = choices.maxTargets ?? 1;
      const targetIndices = selectedIndices.slice(0, maxTargets);
      if (!targetIndices.length) break;
      for (const targetIdx of targetIndices) {
        const target = choices.targets[targetIdx];
        if (!target) continue;
        const targetOwner = choices.donFromTargetOwner
          ? (target.owner ?? owner)
          : (choices.targetOwner ?? owner);
        const donPool = s[targetOwner].costArea.filter(d => !choices.donState || d.state === choices.donState);
        const dons = donPool.slice(0, choices.count);
        if (dons.length) s = execAttachDon(s, targetOwner, target, dons);
      }
      break;
    }

    case 'CHOOSE_HAND_TO_LIFE': {
      const sorted    = [...selectedIndices].sort((a, b) => b - a).slice(0, choices.count);
      const ps        = s[owner];
      const moved     = sorted.map(i => ps.hand[i]);
      const newFaceUp = [...(ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false)), ...Array(moved.length).fill(false)];
      s = addLog({
        ...s,
        [owner]: {
          ...ps,
          hand:           ps.hand.filter((_, i) => !sorted.includes(i)),
          lifeArea:       [...ps.lifeArea, ...moved],
          lifeAreaFaceUp: newFaceUp,
        },
      }, `Moved ${moved.length} card(s) to life.`, 'action');
      break;
    }

    case 'CHOOSE_DON_RETURN': {
      const selected = selectedIndices.slice(0, choices.count).map(i => choices.options[i]);
      s = applyDonReturnSelection(s, owner, selected);
      break;
    }

    case 'CHOOSE_REDIRECT_ATTACK_TARGET': {
      const tgt = choices.targets[selectedIndices[0]];
      if (tgt !== undefined) s = applyRedirectAttack(s, owner, tgt);
      break;
    }

    case 'CHOOSE_BOTTOM_DECK_TARGET': {
      if (choices.fromTrash) {
        const tps = s[choices.targetOwner];
        let chosen, chosenIdxSet;
        if (choices.orderMode) {
          // selectedIndices are trash indices in tap order (tap[0] = drawn first from group)
          const tapOrder = selectedIndices.slice(0, choices.max ?? 1);
          if (!tapOrder.length) break;
          chosen = tapOrder.map(i => tps.trash[i]);
          chosenIdxSet = new Set(tapOrder);
          // reverse so tap[0] ends up at deck end (drawn first from bottom group)
          s = addLog(appendFlash({
            ...s,
            [choices.targetOwner]: {
              ...tps,
              trash: tps.trash.filter((_, i) => !chosenIdxSet.has(i)),
              deck: [...tps.deck, ...[...chosen].reverse()],
            },
          }, chosen[chosen.length - 1], 'BOTTOM_DECK'), `Placed ${chosen.length} card(s) from trash at bottom of deck.`, 'action');
        } else {
          const sorted = [...selectedIndices].sort((a, b) => a - b).slice(0, choices.max ?? 1);
          chosen = sorted.map(i => tps.trash[i]);
          chosenIdxSet = new Set(sorted);
          s = addLog(appendFlash({
            ...s,
            [choices.targetOwner]: {
              ...tps,
              trash: tps.trash.filter((_, i) => !chosenIdxSet.has(i)),
              deck: [...tps.deck, ...chosen],
            },
          }, chosen[chosen.length - 1], 'BOTTOM_DECK'), `Placed ${chosen.length} card(s) from trash at bottom of deck.`, 'action');
        }
      } else {
        for (const idx of selectedIndices.slice(0, choices.max ?? 1)) {
          const tps = s[choices.targetOwner];
          const fc = tps.characterArea[idx];
          if (!fc) continue;
          const returnedDon = Array.from({ length: fc.attachedDon }, (_, i) =>
            ({ _donId: `don-bd-${i}-${Math.random()}`, state: 'rest' })
          );
          const bdPs = s[choices.targetOwner];
          s = addLog(appendFlash({
            ...s,
            [choices.targetOwner]: {
              ...bdPs,
              characterArea: bdPs.characterArea.filter((_, i) => i !== idx),
              powerMods: shiftModsAfterRemoval(bdPs.powerMods ?? [], idx),
              costMods:  shiftModsAfterRemoval(bdPs.costMods  ?? [], idx),
              deck: [fc.card, ...bdPs.deck],
              costArea: [...bdPs.costArea, ...returnedDon],
            },
          }, fc.card, 'BOTTOM_DECK'), `${cn(fc.card)} placed at bottom of deck.`, 'action');
        }
      }
      break;
    }

    case 'CHOOSE_GRANT_KEYWORD_TARGET': {
      const targetIdx = selectedIndices[0];
      if (targetIdx === undefined) break;
      const charIdx = choices.indices[targetIdx];
      const kwLabel = action.keyword === 'RUSH_CHARS_ONLY'
        ? '速攻：角色'
        : action.keyword + (action.restriction ? '：' + action.restriction : '');
      const tps = s[choices.targetOwner];
      const fc = tps.characterArea[charIdx];
      if (!fc) break;
      const fcPatch = action.keyword === '速攻'
        ? { justDeployed: false, ...(action.restriction === '角色' ? { rushCharOnly: true } : {}) }
        : action.keyword === 'RUSH_CHARS_ONLY'
          ? { justDeployed: false, rushCharOnly: true }
          : { tempKeywords: [...(fc.tempKeywords ?? []), action.keyword] };
      const newChars = tps.characterArea.map((c, i) => i === charIdx ? { ...c, ...fcPatch } : c);
      s = addLog(
        { ...s, [choices.targetOwner]: { ...tps, characterArea: newChars } },
        `${cn(sourceCard)}: gave 【${kwLabel}】 to ${cn(fc.card)}.`, 'action'
      );
      break;
    }

    case 'CHOOSE_KEYWORD_TO_GRANT': {
      const chosenKw = choices.keywords[selectedIndices[0]];
      if (!chosenKw) break;
      const untilKey = choices.until === 'opponent_turn_end' ? 'opponentTurnEndKeywords' : 'tempKeywords';
      const ps = s[owner];
      if (fieldPos?.target === 'leader') {
        s = addLog(
          { ...s, [owner]: { ...ps, leader: { ...ps.leader, [untilKey]: [...(ps.leader[untilKey] ?? []), chosenKw] } } },
          `${cn(sourceCard)} gained 【${chosenKw}】 (until end of opponent's turn).`, 'action'
        );
      } else if (fieldPos?.target !== undefined) {
        const idx = fieldPos.target;
        const newChars = ps.characterArea.map((fc, i) =>
          i === idx ? { ...fc, [untilKey]: [...(fc[untilKey] ?? []), chosenKw] } : fc
        );
        s = addLog(
          { ...s, [owner]: { ...ps, characterArea: newChars } },
          `${cn(sourceCard)} gained 【${chosenKw}】 (until end of opponent's turn).`, 'action'
        );
      }
      break;
    }

    case 'CHOOSE_FREE_EVENT': {
      // Player chose up to choices.max event cards to play for free.
      const AUTO_TIMINGS2 = new Set(choices.autoTimings ?? []);
      const sorted = [...selectedIndices].sort((a, b) => b - a).slice(0, choices.max);
      for (const idx of sorted) {
        const ps2 = s[owner];
        const card2 = ps2.hand[idx];
        if (!card2) continue;
        s = addLog(
          { ...s, [owner]: { ...ps2, hand: ps2.hand.filter((_, i) => i !== idx) } },
          `${cn(sourceCard)}: free-played ${cn(card2)}.`, 'action'
        );
        // Inline event effect resolution
        const evClauses2 = parseEffect(card2.effect ?? '');
        for (const clause of evClauses2) {
          const isAuto2 = clause.timings.some(t => AUTO_TIMINGS2.has(t));
          const isCont2 = clause.continuous.length > 0 || clause.passive.length > 0;
          if (isAuto2 || isCont2) continue;
          if (clause.condition && !evaluateCondition(s, owner, clause.condition)) continue;
          s = executeActionSequence(s, owner, clause.actions, card2, card2.id + '_freeev');
          if (s.pendingEffect) break;
        }
        const sps2 = s[owner];
        s = { ...s, [owner]: { ...sps2, trash: [...sps2.trash, card2] } };
        if (s.pendingEffect) break;
      }
      break;
    }

    case 'CHOOSE_ADD_TO_LIFE': {
      // selectedIndices: indices into choices.targets; last element may be -2 (bottom sentinel)
      const lastIdx   = selectedIndices.at(-1);
      const position  = lastIdx === -2 ? 'bottom' : 'top';
      const cardIdxs  = selectedIndices.filter(i => i >= 0).slice(0, choices.count ?? 1);
      const chosen    = cardIdxs.map(i => choices.targets[i]).filter(Boolean);

      // Step 1: snapshot card data in selection order BEFORE any index shifts.
      // Selection order = placement order: first selected lands furthest from top,
      // last selected lands on top (i.e. revealed first on damage).
      const selectionOrdered = chosen.map(({ ownerKey, index, zone }) => {
        const tps = s[ownerKey];
        const resolvedZone = zone ?? (choices.sourceZone === 'hand' ? 'hand' : 'character');
        if (resolvedZone === 'hand')  return { ownerKey, index, zone: 'hand',  card: tps.hand[index],  fc: null };
        if (resolvedZone === 'trash') return { ownerKey, index, zone: 'trash', card: tps.trash[index], fc: null };
        const fc = tps.characterArea[index];
        return { ownerKey, index, zone: 'character', card: fc?.card ?? null, fc };
      }).filter(t => t.card);

      // Step 2: remove from source zones in reverse-index order to avoid index shifts.
      const removalSorted = [...selectionOrdered].sort((a, b) =>
        a.ownerKey === b.ownerKey ? b.index - a.index : 0
      );
      for (const { ownerKey, index, zone, fc } of removalSorted) {
        const tps = s[ownerKey];
        if (zone === 'hand') {
          s = { ...s, [ownerKey]: { ...tps, hand: tps.hand.filter((_, i) => i !== index) } };
        } else if (zone === 'trash') {
          s = { ...s, [ownerKey]: { ...tps, trash: tps.trash.filter((_, i) => i !== index) } };
        } else {
          if (!fc) continue;
          const returnedDon = Array.from({ length: fc.attachedDon ?? 0 }, (_, k) =>
            ({ _donId: `don-atl-res-${k}-${Math.random()}`, state: 'rest' })
          );
          s = { ...s, [ownerKey]: {
            ...tps,
            characterArea: tps.characterArea.filter((_, i) => i !== index),
            powerMods: shiftModsAfterRemoval(tps.powerMods ?? [], index),
            costMods:  shiftModsAfterRemoval(tps.costMods  ?? [], index),
            costArea: [...tps.costArea, ...returnedDon],
          }};
        }
      }

      // Step 3: add to life in selection order so first-selected goes in first (below),
      // last-selected goes in last (on top / revealed first).
      for (const { ownerKey, card } of selectionOrdered) {
        const lifeOwnerKey = choices.targetOwner === 'opponent' ? opp(owner)
                           : choices.targetOwner === 'holder'   ? ownerKey
                           : owner;
        const lps   = s[lifeOwnerKey];
        const curFU = lps.lifeAreaFaceUp ?? lps.lifeArea.map(() => false);
        const placing = choices.faceUp ?? false;
        if (position === 'bottom') {
          s = addLog(appendFlash({ ...s, [lifeOwnerKey]: {
            ...lps, lifeArea: [card, ...lps.lifeArea], lifeAreaFaceUp: [placing, ...curFU],
          }}, card, 'ADD_LIFE'), `Moved ${cn(card)} to bottom of life.`, 'action');
        } else {
          s = addLog(appendFlash({ ...s, [lifeOwnerKey]: {
            ...lps, lifeArea: [...lps.lifeArea, card], lifeAreaFaceUp: [...curFU, placing],
          }}, card, 'ADD_LIFE'), `Moved ${cn(card)} to top of life.`, 'action');
        }
      }
      break;
    }

    case 'CHOOSE_LIFE_OPTIONAL': {
      if (selectedIndices.length === 0) {
        // Player declined — skip life take and any actions conditional on it
        const remaining = continuation.filter(a => !a.conditionalOnPrev);
        return executeActionSequence(s, owner, remaining, sourceCard, effectKey, fieldPos);
      }
      // Player accepted — proceed with life take
      if (action.choosePosition && (choices.targetOwner === PLAYER.HUMAN || s.pvpMode)) {
        return setPendingEffect(s, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_LIFE_TO_HAND_POSITION',
          targetOwner: choices.targetOwner,
        }, fieldPos);
      }
      const lifeOwnerKey2 = choices.targetOwner;
      const ps2 = s[lifeOwnerKey2];
      const take2 = Math.min(action.count ?? 1, ps2.lifeArea.length);
      if (take2) {
        const taken2   = ps2.lifeArea.slice(-take2);
        const newLife2 = ps2.lifeArea.slice(0, -take2);
        const newFU2   = (ps2.lifeAreaFaceUp ?? ps2.lifeArea.map(() => false)).slice(0, -take2);
        s = addLog({
          ...s,
          [lifeOwnerKey2]: { ...ps2, lifeArea: newLife2, lifeAreaFaceUp: newFU2, hand: [...ps2.hand, ...taken2] },
        }, `${cn(sourceCard)}: moved ${take2} life card(s) to hand.`, 'action');
        s = fireLifeLeaveEffects(s, lifeOwnerKey2);
      }
      break;
    }

    case 'CHOOSE_LIFE_TO_HAND_POSITION': {
      const fromBottom = selectedIndices[0] === -2;
      const lifeOwnerKey = choices.targetOwner;
      const ps = s[lifeOwnerKey];
      const take = Math.min(action.count ?? 1, ps.lifeArea.length);
      if (take) {
        let taken, newLife, newFaceUp;
        if (fromBottom) {
          taken     = ps.lifeArea.slice(0, take);
          newLife   = ps.lifeArea.slice(take);
          newFaceUp = (ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false)).slice(take);
        } else {
          taken     = ps.lifeArea.slice(-take);
          newLife   = ps.lifeArea.slice(0, -take);
          newFaceUp = (ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false)).slice(0, -take);
        }
        const s1 = addLog({
          ...s,
          [lifeOwnerKey]: { ...ps, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, hand: [...ps.hand, ...taken] },
        }, `Moved life card from ${fromBottom ? 'bottom' : 'top'} to hand.`, 'action');
        s = fireLifeLeaveEffects(s1, lifeOwnerKey);
      }
      break;
    }

    case 'CHOOSE_ONE_OPTION': {
      const optIdx = selectedIndices[0];
      if (optIdx === undefined) break;
      const chosenOpt = action.options[optIdx];
      if (!chosenOpt) break;
      // Merge chosen option's actions with outer continuation so nested effects chain correctly
      s = executeActionSequence(s, owner, [...chosenOpt.actions, ...continuation], sourceCard, effectKey, fieldPos);
      return s;
    }

    case 'CHOOSE_TRASH_RECYCLE': {
      if (selectedIndices.length < choices.count) break;
      const ps = s[owner];
      const chosenSet = new Set(selectedIndices.slice(0, choices.count));
      const chosen = ps.trash.filter((_, i) => chosenSet.has(i));
      const newTrash = ps.trash.filter((_, i) => !chosenSet.has(i));
      const newDeck = [...ps.deck, ...chosen].sort(() => Math.random() - 0.5);
      s = addLog({ ...s, [owner]: { ...ps, trash: newTrash, deck: newDeck } },
        `${cn(sourceCard)}: returned ${chosen.length} card(s) from trash to deck and shuffled.`, 'action');
      break;
    }

    case 'CHOOSE_AUTO_KO_IN_BATTLE': {
      const confirmed = selectedIndices.length > 0;
      if (!confirmed) break;

      const { targetOwner: koTargetOwner, targetIndex: koTargetIdx, selfIndex } = choices;

      // KO the opponent's character they battled with
      s = execKO(s, koTargetOwner, koTargetIdx, cn(sourceCard));
      if (s.pendingEffect) break;

      // KO the source card itself
      const freshPs = s[owner];
      const selfFC = freshPs.characterArea[selfIndex];
      if (selfFC) {
        const returnedDon = Array.from({ length: selfFC.attachedDon }, (_, i) =>
          ({ ...makeDon(`auto-ko-self-${i}`), state: 'rest' })
        );
        s = addLog(appendFlash({
          ...s,
          [owner]: {
            ...freshPs,
            characterArea: freshPs.characterArea.filter((_, i) => i !== selfIndex),
            powerMods: shiftModsAfterRemoval(freshPs.powerMods ?? [], selfIndex),
            costMods:  shiftModsAfterRemoval(freshPs.costMods  ?? [], selfIndex),
            trash: [...freshPs.trash, selfFC.card],
            costArea: [...freshPs.costArea, ...returnedDon],
          },
        }, selfFC.card, 'KO'), `${cn(sourceCard)} was also K.O.'d!`, 'action');
      }
      return s;
    }

    case 'CHOOSE_DEPLOY_FROM_LIFE': {
      const { lifeCard, lifeIdx, deployState } = choices;
      if (selectedIndices.length > 0) {
        // Player chose to deploy — run continuation (e.g. POWER_MOD) only on deploy
        return execDeployFromLife(s, owner, lifeIdx, lifeCard, deployState ?? 'active', sourceCard, continuation, fieldPos);
      }
      // Player declined
      s = { ...s, lastRevealedLifeCard: null };
      s = addLog(s, `${cn(sourceCard)}: chose not to deploy ${cn(lifeCard)}.`, 'action');
      return s; // skip continuation
    }

    case 'CHOOSE_ARRANGE_LIFE': {
      const targetOwner = choices.targetOwner;
      const ps = s[targetOwner];
      const lifeCards = choices.lifeCards;
      if (!selectedIndices.length) break;
      const tapOrder = selectedIndices.map(i => lifeCards[i]);
      // tap[0] = card player wants on top; lifeArea[last] = top, so reverse
      const newLifeArea = [...tapOrder].reverse();
      const newFaceUp = new Array(newLifeArea.length).fill(false);
      s = addLog({
        ...s,
        [targetOwner]: { ...ps, lifeArea: newLifeArea, lifeAreaFaceUp: newFaceUp },
      }, `${cn(sourceCard)}: arranged life cards in new order.`, 'action');
      break;
    }

    default:
      break;
  }

  if (s.pendingReplace || s.pendingEffect) return s;
  return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
}

// ─── Pending-effect helper ────────────────────────────────────────────────────

function setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, choices, fieldPos = null) {
  return { ...state, pendingEffect: { owner, sourceCard, effectKey, action, continuation, choices, fieldPos } };
}

// ─── Primitive helpers ────────────────────────────────────────────────────────

// Duplicated from effects.js to avoid circular imports — keeps all don-option
// logic accessible without importing back into effectActions.
function buildDonReturnOptions(ps) {
  const opts = [];
  for (const d of ps.costArea) opts.push({ source: 'cost', donId: d._donId, state: d.state });
  for (let i = 0; i < (ps.leader?.attachedDon ?? 0); i++) opts.push({ source: 'leader', slot: i });
  for (let ci = 0; ci < ps.characterArea.length; ci++)
    for (let i = 0; i < ps.characterArea[ci].attachedDon; i++)
      opts.push({ source: 'character', charIndex: ci, slot: i });
  return opts;
}

function applyRedirectAttack(state, owner, target) {
  const { battle } = state;
  if (!battle) return state;
  const ps = state[owner];
  const isLeader   = target.zone === 'leader';
  const newDefPower = isLeader
    ? (ps.leader.card?.power ?? 0)
    : (ps.characterArea[target.index]?.card?.power ?? 0);
  const targetName = isLeader
    ? (ps.leader.card?.name ?? 'Leader')
    : (ps.characterArea[target.index]?.card?.name ?? 'Character');
  return addLog({
    ...state,
    battle: {
      ...battle,
      targetZone:  isLeader ? 'leader' : 'character',
      targetIndex: isLeader ? undefined : target.index,
      defPower:    newDefPower,
    },
  }, `Attack redirected to ${targetName} (${newDefPower}).`, 'battle');
}

function execRestTarget(state, owner, target, sourceName, lockNextRefresh = false) {
  const ps = state[owner];
  if (target.zone === 'leader') {
    return addLog(
      { ...state, [owner]: { ...ps, leader: { ...ps.leader, state: 'rest', ...(lockNextRefresh ? { refreshLocked: true } : {}) } } },
      `${sourceName}: ${cn(ps.leader.card)} rested${lockNextRefresh ? ' (locked next refresh)' : ''}.`, 'action'
    );
  }
  if (target.zone === 'character') {
    const restedCard = ps.characterArea[target.index].card;
    const s = addLog({
      ...state,
      [owner]: { ...ps, characterArea: ps.characterArea.map((fc, i) =>
        i === target.index ? { ...fc, state: 'rest', ...(lockNextRefresh ? { refreshLocked: true } : {}) } : fc
      )},
    }, `${sourceName}: ${cn(restedCard)} rested${lockNextRefresh ? ' (locked next refresh)' : ''}.`, 'action');
    return fireOnRestEffect(s, owner, restedCard, { target: target.index });
  }
  if (target.zone === 'stage') {
    return addLog(
      { ...state, [owner]: { ...ps, stageArea: { ...ps.stageArea, state: 'rest' } } },
      `${sourceName}: ${cn(ps.stageArea.card)} rested.`, 'action'
    );
  }
  if (target.zone === 'don') {
    return addLog({
      ...state,
      [owner]: { ...ps, costArea: ps.costArea.map(d =>
        d._donId === target.donId ? { ...d, state: 'rest' } : d
      )},
    }, `${sourceName}: DON!! rested.`, 'action');
  }
  return state;
}

function execKO(state, targetOwner, charIndex, sourceName) {
  const tps  = state[targetOwner];
  const koFC = tps.characterArea[charIndex];
  if (!koFC) return state;

  const returnedDon = Array.from({ length: koFC.attachedDon }, (_, i) =>
    ({ ...makeDon(`ko-eff-${i}`), state: 'rest' })
  );
  const pendingKOEffects = koFC.card?.effect?.includes('KO時')
    ? [...(state.pendingKOEffects ?? []), { card: koFC.card, owner: targetOwner }]
    : state.pendingKOEffects;
  return addLog(appendFlash({
    ...state,
    ...(pendingKOEffects?.length ? { pendingKOEffects } : {}),
    // Signal that a character was removed by effect so 自己角色效果離場時 can fire
    pendingOwnCharRemovedFor: state.activePlayer ?? state.pendingOwnCharRemovedFor,
    [targetOwner]: {
      ...tps,
      characterArea: tps.characterArea.filter((_, i) => i !== charIndex),
      powerMods: shiftModsAfterRemoval(tps.powerMods ?? [], charIndex),
      costMods:  shiftModsAfterRemoval(tps.costMods  ?? [], charIndex),
      trash:    [...tps.trash, koFC.card],
      costArea: [...tps.costArea, ...returnedDon],
    },
  }, koFC.card, 'KO'), `${sourceName}: KO'd ${cn(koFC.card)}.`, 'action');
}

// Check if the character at charIndex has a 離場時 replacement and apply it.
// leaveContext is stored as pendingLeaveField so the CONFIRM_OPTIONAL_ACTIVATION decline
// handler can execute the original removal if the player says no.
// Returns { type: 'HUMAN_PENDING'|'AI_REPLACED', state } or null (no replacement applies).
function checkLeaveFieldReplacement(state, targetOwner, charIndex, leaveContext) {
  const ps = state[targetOwner];
  const fc = ps.characterArea?.[charIndex];
  if (!fc?.card?.effect) return null;

  const clauses = parseEffect(fc.card.effect);
  const clause = clauses.find(c => c.timings?.includes('離場時') && c.isReplacement);
  if (!clause) return null;

  const effectKey = `${fc.card.id}_${charIndex}_離場時`;
  if (ps.effectUsed?.[effectKey]) return null;
  if (clause.condition && !evaluateCondition(state, targetOwner, clause.condition)) return null;

  if (targetOwner === PLAYER.HUMAN || state.pvpMode) {
    const costDescription = '廢棄1張手牌';
    return {
      type: 'HUMAN_PENDING',
      state: {
        ...state,
        waitingFor: targetOwner,
        pendingLeaveField: leaveContext,
        pendingEffect: {
          owner: targetOwner,
          sourceCard: fc.card,
          effectKey,
          fieldPos: { target: charIndex },
          markUsedOnConfirm: clause.oncePerTurn ?? false,
          action: { type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription },
          continuation: clause.actions,
          choices: { type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription },
        },
      },
    };
  }

  // AI: execute the cost actions; detect success by hand size change
  const handBefore = state[targetOwner].hand.length;
  const result = executeActionSequence(state, targetOwner, clause.actions, fc.card, effectKey, { target: charIndex });
  if (result[targetOwner].hand.length >= handBefore) return null; // cost payment failed (no hand cards)

  const rps = result[targetOwner];
  const marked = clause.oncePerTurn
    ? { ...result, [targetOwner]: { ...rps, effectUsed: { ...(rps.effectUsed ?? {}), [effectKey]: true } } }
    : result;
  return { type: 'AI_REPLACED', state: marked };
}

function execReturnHand(state, targetOwner, charIndex, sourceName) {
  const tps = state[targetOwner];
  const fc  = tps.characterArea[charIndex];
  if (!fc) return state;

  const replace = checkLeaveFieldReplacement(
    state, targetOwner, charIndex,
    { context: 'RETURN_HAND', targetOwner, targetIndex: charIndex, sourceName }
  );
  if (replace) return replace.state;

  const returnedDon = Array.from({ length: fc.attachedDon }, (_, i) =>
    ({ ...makeDon(`rh-${charIndex}-${i}`), state: 'rest' })
  );
  return addLog(appendFlash({
    ...state,
    // Signal that a character was removed by effect so 自己角色效果離場時 can fire
    pendingOwnCharRemovedFor: state.activePlayer ?? state.pendingOwnCharRemovedFor,
    // Track colors of the returned card so a subsequent DEPLOY can enforce a different-color filter
    _lastReturnedColors: fc.card.colors ?? [],
    [targetOwner]: {
      ...tps,
      characterArea: tps.characterArea.filter((_, i) => i !== charIndex),
      powerMods: shiftModsAfterRemoval(tps.powerMods ?? [], charIndex),
      costMods:  shiftModsAfterRemoval(tps.costMods  ?? [], charIndex),
      hand:     [...tps.hand, fc.card],
      costArea: [...tps.costArea, ...returnedDon],
    },
  }, fc.card, 'RETURN_HAND'), `${sourceName}: returned ${cn(fc.card)} to hand.`, 'action');
}

function findLowestPowerIndex(characterArea) {
  let idx = 0;
  for (let i = 1; i < characterArea.length; i++) {
    if ((characterArea[i].card?.power ?? 0) < (characterArea[idx].card?.power ?? 0)) idx = i;
  }
  return idx;
}

function execDeploy(state, owner, handIndex, sourceName, deployState = 'active') {
  const ps   = state[owner];
  const card = ps.hand[handIndex];
  if (!card) return state;

  // Stage cards go to stageArea; existing stage is sent to trash
  if (card.category === 'Stage') {
    const newTrash = ps.stageArea ? [...ps.trash, ps.stageArea.card] : ps.trash;
    return addLog({
      ...state,
      [owner]: {
        ...ps,
        hand: ps.hand.filter((_, i) => i !== handIndex),
        stageArea: { card, state: deployState, attachedDon: 0, justDeployed: false },
        trash: newTrash,
      },
    }, `${sourceName}: deployed stage ${cn(card)}.`, 'action');
  }

  if (ps.characterArea.length >= 5) {
    // AI: auto-replace lowest-power character. Human case is handled upstream.
    const lowestIdx  = findLowestPowerIndex(ps.characterArea);
    const replaceFC  = ps.characterArea[lowestIdx];
    const returnedDon = Array.from({ length: replaceFC.attachedDon }, (_, i) =>
      ({ ...makeDon(`rpl-${i}`), state: 'rest' })
    );
    const newChars = ps.characterArea.map((fc, i) =>
      i === lowestIdx
        ? { card, state: deployState, attachedDon: 0, justDeployed: !hasRush(card), ...(hasCharacterRushOnly(card) && { rushCharOnly: true }) }
        : fc
    );
    const r1 = addLog({
      ...state,
      pendingOpponentDeployTrigger: state.pendingOpponentDeployTrigger ?? { card, deployOwner: owner, isViaCharEffect: true },
      [owner]: {
        ...ps,
        hand: ps.hand.filter((_, i) => i !== handIndex),
        characterArea: newChars,
        trash: [...ps.trash, replaceFC.card],
        costArea: [...ps.costArea, ...returnedDon],
      },
    }, `${sourceName}: deployed ${cn(card)}, replacing ${cn(replaceFC.card)}.`, 'action');
    return { ...r1, _lastDeployedCount: (r1._lastDeployedCount ?? 0) + 1 };
  }

  const fieldCard = { card, state: deployState, attachedDon: 0, justDeployed: !hasRush(card), ...(hasCharacterRushOnly(card) && { rushCharOnly: true }) };
  const r2 = addLog({
    ...state,
    pendingOpponentDeployTrigger: state.pendingOpponentDeployTrigger ?? { card, deployOwner: owner, isViaCharEffect: true },
    [owner]: {
      ...ps,
      hand: ps.hand.filter((_, i) => i !== handIndex),
      characterArea: [...ps.characterArea, fieldCard],
    },
  }, `${sourceName}: deployed ${cn(card)}.`, 'action');
  return { ...r2, _lastDeployedCount: (r2._lastDeployedCount ?? 0) + 1 };
}

function execDeployFromTrash(state, owner, trashIndex, sourceName, deployState = 'active') {
  const ps = state[owner];
  const card = ps.trash[trashIndex];
  if (!card) return state;

  // Stage cards go to stageArea; existing stage is sent to trash
  if (card.category === 'Stage') {
    const trashWithoutCard = ps.trash.filter((_, i) => i !== trashIndex);
    const newTrash = ps.stageArea ? [...trashWithoutCard, ps.stageArea.card] : trashWithoutCard;
    const s = addLog({
      ...state,
      [owner]: {
        ...ps,
        trash: newTrash,
        stageArea: { card, state: deployState, attachedDon: 0, justDeployed: false },
      },
    }, `${sourceName}: deployed stage ${cn(card)} from trash.`, 'action');
    return { ...s, _lastDeployedCount: (s._lastDeployedCount ?? 0) + 1 };
  }

  const justDeployed = deployState === 'active' ? !hasRush(card) : false;
  const fieldCard = { card, state: deployState, attachedDon: 0, justDeployed, ...(deployState === 'active' && hasCharacterRushOnly(card) && { rushCharOnly: true }) };

  let s;
  if (ps.characterArea.length >= 5) {
    const lowestIdx = findLowestPowerIndex(ps.characterArea);
    const replaceFC = ps.characterArea[lowestIdx];
    const returnedDon = Array.from({ length: replaceFC.attachedDon }, (_, i) =>
      ({ ...makeDon(`rpl-${i}`), state: 'rest' })
    );
    s = addLog({
      ...state,
      [owner]: {
        ...ps,
        characterArea: ps.characterArea.map((fc, i) => i === lowestIdx ? fieldCard : fc),
        trash: [...ps.trash.filter((_, i) => i !== trashIndex), replaceFC.card],
        costArea: [...ps.costArea, ...returnedDon],
      },
    }, `${sourceName}: deployed ${cn(card)} from trash, replacing ${cn(replaceFC.card)}.`, 'action');
  } else {
    s = addLog({
      ...state,
      [owner]: {
        ...ps,
        trash: ps.trash.filter((_, i) => i !== trashIndex),
        characterArea: [...ps.characterArea, fieldCard],
      },
    }, `${sourceName}: deployed ${cn(card)} from trash.`, 'action');
  }
  return { ...s, _lastDeployedCount: (s._lastDeployedCount ?? 0) + 1, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card, owner }] };
}

function execDeployFromLife(state, owner, lifeIdx, lifeCard, deployState, sourceCard, continuation, fieldPos) {
  const ps = state[owner];
  const newLife = ps.lifeArea.filter((_, i) => i !== lifeIdx);
  const newFaceUp = (ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false)).filter((_, i) => i !== lifeIdx);
  const justDeployed = deployState === 'active' ? !hasRush(lifeCard) : false;
  const fc = { card: lifeCard, state: deployState, attachedDon: 0, justDeployed };
  let s = addLog(
    appendFlash({
      ...state,
      lastRevealedLifeCard: null,
      [owner]: { ...ps, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, characterArea: [...ps.characterArea, fc] },
    }, lifeCard, 'DEPLOY'),
    `${cn(sourceCard)}: deployed ${cn(lifeCard)} from life for free!`, 'action'
  );
  s = { ...s, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card: lifeCard, owner }] };
  return executeActionSequence(s, owner, continuation, sourceCard, null, fieldPos);
}

function execDraw(state, owner, count, sourceName) {
  let s = state, drawn = 0;
  for (let i = 0; i < count; i++) {
    const ps = s[owner];
    if (!ps.deck.length) break;
    const card = ps.deck[ps.deck.length - 1];
    s = { ...s, [owner]: { ...ps, deck: ps.deck.slice(0, -1), hand: [...ps.hand, card] } };
    drawn++;
  }
  return drawn ? addLog(s, `${sourceName}: drew ${drawn} card(s).`, 'action') : s;
}

// ─── DON!! Attach ─────────────────────────────────────────────────────────────

function execAttachDon(state, owner, target, dons) {
  const ps      = state[owner];
  const donIds  = new Set(dons.map(d => d._donId));
  const newCostArea = ps.costArea.filter(d => !donIds.has(d._donId));
  let newLeader = ps.leader;
  let newChars  = ps.characterArea;
  let targetName;

  if (target.zone === 'leader') {
    newLeader  = { ...ps.leader, attachedDon: ps.leader.attachedDon + dons.length };
    targetName = cn(ps.leader.card) ?? 'Leader';
  } else {
    newChars   = ps.characterArea.map((fc, i) =>
      i === target.index ? { ...fc, attachedDon: fc.attachedDon + dons.length } : fc
    );
    targetName = cn(ps.characterArea[target.index]?.card) ?? 'character';
  }

  return addLog({
    ...state,
    [owner]: { ...ps, costArea: newCostArea, leader: newLeader, characterArea: newChars },
  }, `Attached ${dons.length} DON!! to ${targetName}.`, 'action');
}

// ─── DON!! Return ─────────────────────────────────────────────────────────────

export function applyDonReturnSelection(state, owner, selectedOptions) {
  const ps = state[owner];
  let newCostArea      = [...ps.costArea];
  let newLeaderDon     = ps.leader.attachedDon;
  const newCharArea    = ps.characterArea.map(fc => ({ ...fc }));
  const returned       = [];

  for (const opt of selectedOptions) {
    if (opt.source === 'cost') {
      const idx = newCostArea.findIndex(d => d._donId === opt.donId);
      if (idx >= 0) returned.push(...newCostArea.splice(idx, 1));
    } else if (opt.source === 'leader') {
      if (newLeaderDon > 0) {
        newLeaderDon--;
        returned.push({ _donId: `don-ret-ldr-${Math.random()}`, state: 'active' });
      }
    } else if (opt.source === 'character') {
      const fc = newCharArea[opt.charIndex];
      if (fc && fc.attachedDon > 0) {
        fc.attachedDon--;
        returned.push({ _donId: `don-ret-chr-${opt.charIndex}-${Math.random()}`, state: 'active' });
      }
    }
  }

  const afterReturn = addLog({
    ...state,
    [owner]: {
      ...ps,
      costArea:      newCostArea,
      leader:        { ...ps.leader, attachedDon: newLeaderDon },
      characterArea: newCharArea,
      donDeck:       [...ps.donDeck, ...returned.map(d => ({ ...d, state: 'active' }))],
    },
  }, `Returned ${returned.length} DON!!.`, 'action');

  return returned.length > 0 ? fireDonReturnEffects(afterReturn, owner, returned.length) : afterReturn;
}
