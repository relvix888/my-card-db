/**
 * effectActions.js
 * Condition evaluation, card-filter matching, and action execution.
 * All functions are pure: (state, ...) → newState.
 * Interactive effects set state.pendingEffect instead of resolving immediately.
 */

import { PLAYER } from './constants';
import { parseEffect } from './effectParser';

// ─── Internal helpers (duplicated to avoid circular imports with gameState.js) ─

function addLog(state, text, type = 'info') {
  return { ...state, log: [...(state.log ?? []), { text, type, id: Date.now() + Math.random() }] };
}

function makeDon(tag) {
  return { _donId: `don-eff-${tag}-${Math.random()}`, state: 'active' };
}

function opp(owner) {
  return owner === PLAYER.HUMAN ? PLAYER.AI : PLAYER.HUMAN;
}

// ─── Condition Evaluator ──────────────────────────────────────────────────────

/**
 * Return true when the parsed condition is currently met.
 * @param {object} state  full game state
 * @param {string} owner  card controller ('human'|'ai')
 * @param {object} cond   condition from effectParser.parseCondition
 */
export function evaluateCondition(state, owner, cond) {
  if (!cond) return true;

  const condOwner = cond.owner === 'opponent' ? opp(owner) : owner;
  const ps = state[condOwner];

  switch (cond.subject) {
    case 'leader': {
      const leader = ps?.leader?.card;
      if (!leader) return false;
      if (cond.multiColor) {
        if ((leader.colors?.length ?? 0) <= 1) return false;
      }
      if (cond.trait && cond.predicate === 'has') {
        if (!(leader.types ?? []).some(t => t.includes(cond.trait))) return false;
      } else if (cond.name) {
        if (leader.name !== cond.name) return false;
      }
      // Compound: also require no other character named X on own field
      if (cond.noOther) {
        const count = (state[owner]?.characterArea ?? [])
          .filter(fc => fc.card.name === cond.noOther).length;
        if (count > 1) return false; // > 1 means there's another copy besides this card
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
      if (cond.name)
        return chars.some(fc => fc.card.name === cond.name);
      if (cond.power !== undefined)
        return chars.some(fc =>
          cond.powerOp === 'gte'
            ? (fc.card.power ?? 0) >= cond.power
            : (fc.card.power ?? 0) <= cond.power
        );
      if (cond.cost !== undefined)
        return chars.some(fc =>
          cond.costOp === 'gte'
            ? (fc.card.cost ?? 0) >= cond.cost
            : (fc.card.cost ?? 0) <= cond.cost
        );
      return true;
    }
    case 'don_field': {
      // Total DON!! in play: cost area + attached to leader/characters
      const fieldDon = (ps?.costArea?.length ?? 0)
        + (ps?.leader?.attachedDon ?? 0)
        + (ps?.characterArea ?? []).reduce((s, fc) => s + fc.attachedDon, 0);
      if (cond.count !== undefined)
        return cond.countOp === 'gte' ? fieldDon >= cond.count : fieldDon <= cond.count;
      return true;
    }
    case 'don': {
      const total = (ps?.costArea?.length ?? 0)
        + (ps?.leader?.attachedDon ?? 0)
        + (ps?.characterArea ?? []).reduce((s, fc) => s + fc.attachedDon, 0);
      if (cond.count !== undefined)
        return cond.countOp === 'gte' ? total >= cond.count : total <= cond.count;
      return true;
    }
    case 'life': {
      const life = ps?.lifeArea?.length ?? 0;
      if (cond.count !== undefined)
        return cond.countOp === 'gte' ? life >= cond.count : life <= cond.count;
      return true;
    }
    case 'hand': {
      const handSize = ps?.hand?.length ?? 0;
      if (cond.count !== undefined)
        return cond.countOp === 'gte' ? handSize >= cond.count : handSize <= cond.count;
      return true;
    }
    case 'trash': {
      const trashSize = ps?.trash?.length ?? 0;
      if (cond.count !== undefined)
        return cond.countOp === 'gte' ? trashSize >= cond.count : trashSize <= cond.count;
      return true;
    }
    default:
      return true;
  }
}

// ─── Card Filter Matcher ──────────────────────────────────────────────────────

/**
 * Returns true when a card matches the filter criteria.
 * @param {object} card    raw card object (card.category, card.types, etc.)
 * @param {object} filter  from parseCardFilter()
 * @param {object} [fc]    FieldCard wrapper (for state/donAttached checks)
 * @param {number} [power] current power value (for power comparisons)
 */
export function matchesFilter(card, filter, fc = null, power = null) {
  if (!filter || !Object.keys(filter).length) return true;

  if (filter.orCategories) {
    if (!filter.orCategories.includes(card.category)) return false;
  } else if (filter.category && card.category !== filter.category) {
    if (!(filter.includesLeader && card.category === 'Leader')) return false;
  }
  if (filter.trait         && !(card.types ?? []).some(t => t === filter.trait))                                        return false;
  if (filter.traits        && !filter.traits.some(trait => (card.types ?? []).some(t => t === trait)))                 return false;
  if (filter.traitContains && !(card.types ?? []).some(t => t.includes(filter.traitContains)))                         return false;
  if (filter.traitsContains && !filter.traitsContains.some(trait => (card.types ?? []).some(t => t.includes(trait)))) return false;
  if (filter.name  && card.name !== filter.name) return false;
  if (filter.excludeName && card.name === filter.excludeName) return false;

  if (filter.cost !== undefined) {
    const c = card.cost ?? 0;
    if (filter.costOp === 'gte' ? c < filter.cost : c > filter.cost) return false;
  }
  if (filter.power !== undefined && power !== null) {
    if (filter.powerOp === 'gte' ? power < filter.power : power > filter.power) return false;
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
  if (filter.color && !(card.colors ?? []).includes(filter.color)) return false;
  return true;
}

// ─── Power Mod Helpers ────────────────────────────────────────────────────────

// target: 'leader' | charIndex (number)
function addPowerMod(state, targetOwner, target, delta, until) {
  const ps = state[targetOwner];
  return {
    ...state,
    [targetOwner]: { ...ps, powerMods: [...(ps.powerMods ?? []), { target, delta, until }] },
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
  if (state.activePlayer !== owner) return state;
  const ps = state[owner];
  let s = state;
  const timing = '咚‼卡被放回時';

  function fireForCard(card, s2, fieldPos) {
    if (!card?.effect) return s2;
    for (const clause of parseEffect(card.effect)) {
      if (!clause.timings.includes(timing)) continue;
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

    case 'CONFIRM_OPTIONAL_ACTIVATION':
      if (owner !== PLAYER.HUMAN) return state; // AI: no-op, loop continues to cost actions
      return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
        type: 'CONFIRM_OPTIONAL_ACTIVATION',
        costDescription: action.costDescription,
      }, fieldPos);

    case 'DRAW':
      return execDraw(state, owner, action.count, sourceCard.name);

    case 'SELF_DEPLOY': {
      const ps = state[owner];
      if (ps.characterArea.length >= 5) return state;
      const fieldCard = { card: sourceCard, state: 'active', attachedDon: 0, justDeployed: false };
      return addLog({
        ...state,
        [owner]: { ...ps, characterArea: [...ps.characterArea, fieldCard] },
      }, `${sourceCard.name} deployed via trigger.`, 'action');
    }

    case 'POWER_MOD': {
      if (action.until === 'continuous') return state; // evaluated dynamically in calcPower

      if (action.filter?.self) {
        if (!fieldPos) return state;
        return addLog(
          addPowerMod(state, owner, fieldPos.target, action.delta, action.until),
          `${sourceCard.name}: ${action.delta > 0 ? '+' : ''}${action.delta} power (${action.until}).`, 'action'
        );
      }

      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const tps = state[targetOwner];
      const targets = [];
      if (action.filter?.includesLeader && matchesFilter(tps.leader?.card, action.filter))
        targets.push({ zone: 'leader', index: -1, card: tps.leader.card });
      tps.characterArea.forEach((fc, i) => {
        if (matchesFilter(fc.card, action.filter, fc))
          targets.push({ zone: 'character', index: i, card: fc.card });
      });

      if (!targets.length) return state;

      const effectiveCount = action.count ?? 1;
      const applyMod = (s, t) =>
        addPowerMod(s, targetOwner, t.zone === 'leader' ? 'leader' : t.index, action.delta, action.until);

      // Mass power mod: apply to all matched targets without prompting
      if (effectiveCount >= targets.length) {
        let s = state;
        const names = [];
        for (const t of targets) {
          s = applyMod(s, t);
          names.push(t.card.name);
        }
        return addLog(s,
          `${sourceCard.name}: ${action.delta > 0 ? '+' : ''}${action.delta} to ${names.join(', ')} (${action.until}).`,
          'action');
      }

      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_POWER_TARGET',
          targetOwner,
          targets: targets.map(t => ({ zone: t.zone, index: t.index })),
          max: effectiveCount,
        }, fieldPos);
      }
      // AI: pick first match
      return addLog(
        applyMod(state, targets[0]),
        `${sourceCard.name}: power ${action.delta > 0 ? '+' : ''}${action.delta} on ${targets[0].card.name} (${action.until}).`, 'action'
      );
    }

    case 'COST_MOD': {
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
          names.push(fc.card.name);
        }
        return addLog(s,
          `${sourceCard.name}: cost ${action.delta > 0 ? '+' : ''}${action.delta} on ${names.join(', ')} (${action.until}).`,
          'action');
      }

      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_COST_TARGET',
          targetOwner,
          indices: targets.map(t => t.i),
          max: effectiveCount,
        }, fieldPos);
      }
      return addLog(
        addCostMod(state, targetOwner, targets[0].i, action.delta, action.until),
        `${sourceCard.name}: cost ${action.delta > 0 ? '+' : ''}${action.delta} on ${tps.characterArea[targets[0].i].card.name} (${action.until}).`, 'action'
      );
    }

    case 'REST': {
      // Self-rest: automatically rest the source card (no player choice needed)
      if (action.filter?.self) {
        if (!fieldPos) return state;
        const tps = state[owner];
        if (fieldPos.target === 'leader') {
          return addLog(
            { ...state, [owner]: { ...tps, leader: { ...tps.leader, state: 'rest' } } },
            `${sourceCard.name}: rested itself.`, 'action'
          );
        }
        if (fieldPos.target === 'stage') {
          return addLog(
            { ...state, [owner]: { ...tps, stageArea: { ...tps.stageArea, state: 'rest' } } },
            `${sourceCard.name}: rested itself.`, 'action'
          );
        }
        const idx = fieldPos.target;
        const newChars = tps.characterArea.map((fc, i) =>
          i === idx ? { ...fc, state: 'rest' } : fc
        );
        return addLog(
          { ...state, [owner]: { ...tps, characterArea: newChars } },
          `${sourceCard.name}: rested itself.`, 'action'
        );
      }

      // DON!! rest: rest N active DON!! cards from the cost area (DONs are identical, no player choice needed)
      if (action.filter?.cardType === 'don') {
        const tps = state[owner];
        const needed = action.count ?? 1;
        const activeDon = tps.costArea.filter(d => d.state === 'active');
        if (activeDon.length < needed) return state;
        const toRest = new Set(activeDon.slice(0, needed).map(d => d._donId));
        return addLog({
          ...state,
          [owner]: { ...tps, costArea: tps.costArea.map(d => toRest.has(d._donId) ? { ...d, state: 'rest' } : d) },
        }, `${sourceCard.name}: rested ${needed} DON!!.`, 'action');
      }

      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const tps = state[targetOwner];
      const targets = tps.characterArea
        .map((fc, i) => ({ fc, i }))
        .filter(({ fc }) => matchesFilter(fc.card, action.filter, fc));

      if (!targets.length) return state;

      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_REST_TARGET',
          targetOwner,
          indices: targets.map(t => t.i),
          max: action.count ?? 1,
        }, fieldPos);
      }
      // AI: rest first target
      const newChars = tps.characterArea.map((fc, i) =>
        i === targets[0].i ? { ...fc, state: 'rest' } : fc
      );
      return addLog({
        ...state,
        [targetOwner]: { ...tps, characterArea: newChars },
      }, `${sourceCard.name}: ${tps.characterArea[targets[0].i].card.name} rested.`, 'action');
    }

    case 'REFRESH_LOCK': {
      const targetOwner = opponent;
      const tps = state[targetOwner];
      const targets = tps.characterArea
        .map((fc, i) => ({ fc, i }))
        .filter(({ fc }) => matchesFilter(fc.card, action.filter, fc));

      if (!targets.length) break;

      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_REFRESH_LOCK_TARGET',
          targetOwner,
          indices: targets.map(t => t.i),
          max: action.count ?? 1,
        }, fieldPos);
      }
      // AI: lock first N targets
      let s = state;
      for (const { i } of targets.slice(0, action.count ?? 1)) {
        const tps2 = s[targetOwner];
        s = addLog({
          ...s,
          [targetOwner]: { ...tps2, characterArea: tps2.characterArea.map((fc, idx) =>
            idx === i ? { ...fc, refreshLocked: true } : fc
          ) },
        }, `${tps2.characterArea[i].card.name}: will not refresh next turn.`, 'action');
      }
      return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'KO': {
      const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const tps = state[targetOwner];
      const targets = tps.characterArea
        .map((fc, i) => ({
          fc, i,
          // Use effective power (base + powerMods) so post-POWER_MOD thresholds are correct
          power: (fc.card.power ?? 0) + (tps.powerMods ?? [])
            .filter(m => m.target === i)
            .reduce((acc, m) => acc + m.delta, 0),
        }))
        .filter(({ fc, power }) => matchesFilter(fc.card, action.filter, fc, power));

      if (!targets.length) return state;

      const effectiveCount = action.count ?? 1;

      // Mass KO: remove all matched targets without prompting (KO from highest index to preserve earlier indices)
      if (effectiveCount >= targets.length) {
        let s = state;
        for (const { i } of [...targets].sort((a, b) => b.i - a.i)) {
          s = execKO(s, targetOwner, i, sourceCard.name);
        }
        return s;
      }

      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_KO_TARGET',
          targetOwner,
          indices: targets.map(t => t.i),
          max: effectiveCount,
        }, fieldPos);
      }
      // AI: KO highest-power target
      const best = [...targets].sort((a, b) => b.power - a.power)[0];
      return execKO(state, targetOwner, best.i, sourceCard.name);
    }

    case 'RETURN_HAND': {
      // Self-bounce: filter.self = true means "this card" (the activating card itself)
      if (action.filter?.self && fieldPos?.zone === 'character') {
        return execReturnHand(state, owner, fieldPos.index, sourceCard.name);
      }

      // Build candidate target list from one or both sides
      const filterNoMeta = { ...action.filter, owner: undefined, zone: undefined, self: undefined };
      const sides =
        action.filter?.owner === 'opponent' ? [opponent] :
        action.filter?.owner === 'self'     ? [owner]    : [owner, opponent];

      const targets = [];
      for (const p of sides) {
        state[p].characterArea.forEach((fc, i) => {
          if (matchesFilter(fc.card, filterNoMeta, fc, fc.card.power ?? 0))
            targets.push({ owner: p, charIndex: i });
        });
      }

      if (!targets.length) return state;

      const effectiveCount = Math.min(action.count ?? 1, targets.length);

      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_RETURN_HAND_TARGET',
          targets,
          max: effectiveCount,
        }, fieldPos);
      }

      // AI: prefer bouncing opponent's highest-cost character; fall back to own lowest-power
      const opponentTargets = targets.filter(t => t.owner === opponent);
      const pool = opponentTargets.length ? opponentTargets : targets;
      const pick = [...pool].sort((a, b) =>
        opponentTargets.length
          ? (state[b.owner].characterArea[b.charIndex].card.cost ?? 0) - (state[a.owner].characterArea[a.charIndex].card.cost ?? 0)
          : (state[a.owner].characterArea[a.charIndex].card.power ?? 0) - (state[b.owner].characterArea[b.charIndex].card.power ?? 0)
      )[0];
      return execReturnHand(state, pick.owner, pick.charIndex, sourceCard.name);
    }

    case 'DEPLOY': {
      const srcOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const ps = state[srcOwner];
      if (ps.characterArea.length >= 5) return state;
      const fromTrash = action.filter?.zone === 'trash';
      const pool = fromTrash ? ps.trash : ps.hand;

      const targets = pool
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => matchesFilter(c, action.filter));

      if (!targets.length) return state;

      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: fromTrash ? 'CHOOSE_DEPLOY_FROM_TRASH' : 'CHOOSE_DEPLOY_FROM_HAND',
          sourceOwner: srcOwner,
          indices: targets.map(t => t.i),
          max: action.count ?? 1,
        }, fieldPos);
      }
      // AI: deploy highest-cost match
      const best = [...targets].sort((a, b) => (b.c.cost ?? 0) - (a.c.cost ?? 0))[0];
      if (fromTrash) return execDeployFromTrash(state, srcOwner, best.i, sourceCard.name);
      return execDeploy(state, srcOwner, best.i, sourceCard.name);
    }

    case 'DISCARD': {
      const ps = state[owner];
      const targets = ps.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => matchesFilter(c, action.filter));

      if (!targets.length) return state;

      if (owner === PLAYER.HUMAN && targets.length >= action.count) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_DISCARD',
          indices: targets.map(t => t.i),
          count: action.count,
        }, fieldPos);
      }
      // AI or only one choice: discard lowest-cost
      const sorted = [...targets].sort((a, b) => (a.c.cost ?? 0) - (b.c.cost ?? 0));
      const toDiscard = sorted.slice(0, action.count);
      const discardSet = new Set(toDiscard.map(t => t.i));
      return addLog({
        ...state,
        [owner]: {
          ...ps,
          hand:  ps.hand.filter((_, i) => !discardSet.has(i)),
          trash: [...ps.trash, ...toDiscard.map(t => t.c)],
        },
      }, `${sourceCard.name}: discarded ${toDiscard.length} card(s).`, 'action');
    }

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

      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_DISCARD_FREE',
          indices: targets.map(t => t.i),
        }, fieldPos);
      }
      // AI: discard all eligible cards to maximise power boost
      const discardSet = new Set(targets.map(t => t.i));
      return addLog({
        ...state,
        [owner]: {
          ...ps,
          hand:  ps.hand.filter((_, i) => !discardSet.has(i)),
          trash: [...ps.trash, ...targets.map(t => t.c)],
          lastDiscardCount: targets.length,
        },
      }, `${sourceCard.name}: discarded ${targets.length} card(s).`, 'action');
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
        `${sourceCard.name}: +${action.delta * count} power (${action.until}).`, 'action'
      );
    }

    case 'REGISTER_ON_EVENT_TRIGGER': {
      // Stores a per-turn trigger that fires when the player plays a matching event card.
      const ps = state[owner];
      return {
        ...state,
        [owner]: {
          ...ps,
          onEventTriggers: [
            ...(ps.onEventTriggers ?? []),
            { filter: action.filter, actions: action.triggerActions, sourceCard, effectKey },
          ],
        },
      };
    }

    case 'SEARCH': {
      const ps = state[owner];
      if (!ps.deck.length) return state;

      const revealed  = ps.deck.slice(-action.look).reverse(); // top first
      const deckBase  = ps.deck.slice(0, -action.look);

      // Reorder-only: look at top N, arrange, place on top or bottom — no cards taken
      if (action.take === 0 && action.reorder) {
        if (owner === PLAYER.HUMAN) {
          return setPendingEffect(
            { ...state, [owner]: { ...ps, deck: deckBase } },
            owner, sourceCard, effectKey, action, continuation,
            { type: 'SEARCH_ORDER', remaining: revealed, canPlaceOnTop: action.canPlaceOnTop ?? false },
            fieldPos
          );
        }
        // AI: put cards back on top in original order
        return addLog({ ...state, [owner]: { ...ps, deck: [...deckBase, ...revealed.slice().reverse()] } },
          `${sourceCard.name}: reordered top ${action.look} cards.`, 'action');
      }

      const nextIsTrash = continuation[0]?.type === 'REMAINDER_TO_TRASH';
      const remainCont  = nextIsTrash ? continuation.slice(1) : continuation;

      if (owner === PLAYER.HUMAN) {
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
        }, fieldPos);
      }
      // AI: take matching, put rest on bottom or trash depending on flag
      const matching = revealed.filter(c => matchesFilter(c, action.filter)).slice(0, action.take);
      const rest     = revealed.filter(c => !matching.includes(c));
      return addLog({
        ...state,
        [owner]: {
          ...ps,
          deck: nextIsTrash ? deckBase : [...rest.reverse(), ...deckBase],
          hand: [...ps.hand, ...matching],
          trash: nextIsTrash ? [...ps.trash, ...rest] : ps.trash,
        },
      }, `${sourceCard.name}: searched, added ${matching.length} card(s).`, 'action');
    }

    case 'REMAINDER_TO_TRASH':
      return state; // consumed by the preceding SEARCH action; no-op if reached directly

    case 'DECK_TO_TRASH': {
      const ps = state[owner];
      const count = Math.min(action.count, ps.deck.length);
      if (!count) return state;
      const milled = ps.deck.slice(-count);
      return addLog({
        ...state,
        [owner]: { ...ps, deck: ps.deck.slice(0, -count), trash: [...ps.trash, ...milled] },
      }, `${sourceCard.name}: sent ${count} card(s) from deck top to trash.`, 'action');
    }

    case 'ATTACH_DON': {
      const ps = state[owner];
      const donPool = ps.costArea.filter(d => !action.donState || d.state === action.donState);
      if (!donPool.length) return state;

      // Gather valid targets (leader + characters matching filter)
      const targets = [];
      if (matchesFilter(ps.leader.card, action.filter))
        targets.push({ zone: 'leader', index: -1 });
      ps.characterArea.forEach((fc, i) => {
        if (matchesFilter(fc.card, action.filter, fc)) targets.push({ zone: 'character', index: i });
      });
      if (!targets.length) return state;

      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_DON_ATTACH_TARGET',
          targets,
          donState: action.donState,
          count: action.count ?? 1,
        }, fieldPos);
      }
      // AI: prefer highest-power character, then leader
      const best = targets.reduce((a, b) => {
        const pw = t => t.zone === 'leader'
          ? (ps.leader.card?.power ?? 0)
          : (ps.characterArea[t.index]?.card?.power ?? 0);
        return pw(b) > pw(a) ? b : a;
      });
      return execAttachDon(state, owner, best, donPool.slice(0, action.count ?? 1));
    }

    case 'FLIP_LIFE_FACE_UP': {
      const ps = state[owner];
      if (!ps.lifeArea?.length) return state;
      const topIdx   = ps.lifeArea.length - 1;
      const oldFaceUp = ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false);
      if (oldFaceUp[topIdx]) return state;
      const newFaceUp = oldFaceUp.map((v, i) => i === topIdx ? true : v);
      return addLog(
        { ...state, [owner]: { ...ps, lifeAreaFaceUp: newFaceUp } },
        `${sourceCard.name}: top life card flipped face up.`, 'action'
      );
    }

    case 'LIFE_TO_HAND': {
      const targetOwner = action.targetOwner === 'opponent' ? opponent : owner;
      const ps   = state[targetOwner];
      const take = Math.min(action.count ?? 1, ps.lifeArea.length);
      if (!take) return state;
      const taken     = ps.lifeArea.slice(-take);
      const newLife   = ps.lifeArea.slice(0, -take);
      const newFaceUp = (ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false)).slice(0, -take);
      const s1 = addLog({
        ...state,
        [targetOwner]: { ...ps, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, hand: [...ps.hand, ...taken] },
      }, `${sourceCard.name}: moved ${take} life card(s) to hand.`, 'action');
      return fireLifeLeaveEffects(s1, targetOwner);
    }

    case 'LIFE_TO_TRASH': {
      const ps      = state[owner];
      const take    = Math.min(action.count ?? 1, ps.lifeArea.length);
      if (!take) return state;
      const trashed   = ps.lifeArea.slice(-take);
      const newLife   = ps.lifeArea.slice(0, -take);
      const newFaceUp = (ps.lifeAreaFaceUp ?? ps.lifeArea.map(() => false)).slice(0, -take);
      return addLog({
        ...state,
        [owner]: { ...ps, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, trash: [...ps.trash, ...trashed] },
      }, `${sourceCard.name}: trashed ${take} life card(s) (no trigger).`, 'action');
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
        if (srcOwner === PLAYER.HUMAN) {
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
        }, `${sourceCard.name}: moved ${best.c.name} from trash to hand.`, 'action');
      }

      if (zone === 'field') {
        const filterNoZone = { ...action.filter, zone: undefined, self: undefined };
        const targets = [];
        state[srcOwner].characterArea.forEach((fc, i) => {
          if (matchesFilter(fc.card, filterNoZone, fc)) targets.push({ owner: srcOwner, charIndex: i });
        });
        if (!targets.length) return state;
        const effectiveCount = Math.min(count, targets.length);
        if (srcOwner === PLAYER.HUMAN) {
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
        }, `${sourceCard.name}: moved ${take} life card(s) to hand.`, 'action');
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
        }, `${sourceCard.name}: moved ${matching.length} card(s) from deck to hand.`, 'action');
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
      return addLog({
        ...state,
        [targetOwner]: { ...ps, deck: newDeck, lifeArea: newLife, lifeAreaFaceUp: newFaceUp },
      }, `${sourceCard.name}: added ${take} card(s) from deck to life.`, 'action');
    }

    case 'HAND_TO_LIFE': {
      const ps = state[owner];
      const targets = ps.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => matchesFilter(c, action.filter));

      if (!targets.length) return state;

      if (owner === PLAYER.HUMAN) {
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
      }, `${sourceCard.name}: moved ${moved.length} hand card(s) to life.`, 'action');
    }

    case 'ADD_TO_LIFE': {
      const srcOwner = action.filter?.owner === 'opponent' ? opponent : owner;
      const ps       = state[srcOwner];
      let targets;
      if (action.sourceZone === 'hand') {
        targets = ps.hand
          .map((c, i) => ({ c, i, ownerKey: srcOwner }))
          .filter(({ c }) => matchesFilter(c, action.filter));
      } else {
        targets = ps.characterArea
          .map((fc, i) => ({ c: fc.card, i, ownerKey: srcOwner, fc }))
          .filter(({ c, fc }) => matchesFilter(c, action.filter, fc));
        // For 持有者 effects with no owner filter, also consider opponent's field
        if (!action.filter?.owner) {
          const oppPsLocal = state[opponent];
          const oppTargets = oppPsLocal.characterArea
            .map((fc, i) => ({ c: fc.card, i, ownerKey: opponent, fc }))
            .filter(({ c, fc }) => matchesFilter(c, action.filter, fc));
          targets = [...targets, ...oppTargets];
        }
      }
      if (!targets.length) return state;

      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_ADD_TO_LIFE',
          targets:       targets.map(t => ({ ownerKey: t.ownerKey, index: t.i })),
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
        if (action.sourceZone === 'hand') {
          card = tps.hand[t.i];
          s = { ...s, [t.ownerKey]: { ...tps, hand: tps.hand.filter((_, i) => i !== t.i) } };
        } else {
          const fc = tps.characterArea[t.i];
          card = fc.card;
          const returnedDon = Array.from({ length: fc.attachedDon ?? 0 }, (_, k) =>
            ({ _donId: `don-atl-${k}-${Math.random()}`, state: 'rest' })
          );
          s = { ...s, [t.ownerKey]: {
            ...tps,
            characterArea: tps.characterArea.filter((_, i) => i !== t.i),
            costArea: [...tps.costArea, ...returnedDon],
          }};
        }
        const lps = s[lifeOwnerKey];
        const curFaceUp = lps.lifeAreaFaceUp ?? lps.lifeArea.map(() => false);
        const placing   = action.faceUp ?? false;
        if (action.position === 'bottom') {
          s = addLog({ ...s, [lifeOwnerKey]: {
            ...lps, lifeArea: [card, ...lps.lifeArea], lifeAreaFaceUp: [placing, ...curFaceUp],
          }}, `${sourceCard.name}: moved ${card.name} to bottom of life.`, 'action');
        } else {
          s = addLog({ ...s, [lifeOwnerKey]: {
            ...lps, lifeArea: [...lps.lifeArea, card], lifeAreaFaceUp: [...curFaceUp, placing],
          }}, `${sourceCard.name}: moved ${card.name} to top of life.`, 'action');
        }
      }
      return s;
    }

    case 'OPPONENT_DON_REST_DEFERRED': {
      const prev = state[opponent].pendingDonRest ?? 0;
      return addLog(
        { ...state, [opponent]: { ...state[opponent], pendingDonRest: prev + action.count } },
        `${sourceCard.name}: opponent must rest ${action.count} DON!! at start of their main phase.`, 'action'
      );
    }

    case 'UNREST_DON': {
      const ps       = state[owner];
      const restDons = ps.costArea.filter(d => d.state === 'rest');
      if (!restDons.length) return state;

      if (owner === PLAYER.HUMAN) {
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
      }, `${sourceCard.name}: activated ${toActivate.length} DON!!.`, 'action');
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
            `${sourceCard.name}: activated itself.`, 'action'
          );
        }
        if (fieldPos.target === 'stage') {
          return addLog(
            { ...state, [targetOwner]: { ...tps, stageArea: { ...tps.stageArea, state: 'active' } } },
            `${sourceCard.name}: activated itself.`, 'action'
          );
        }
        const idx = fieldPos.target;
        return addLog({
          ...state,
          [targetOwner]: { ...tps, characterArea: tps.characterArea.map((fc, i) =>
            i === idx ? { ...fc, state: 'active' } : fc
          ) },
        }, `${sourceCard.name}: activated itself.`, 'action');
      }

      // Leader-only target (no includesLeader): activate it directly, no choice needed
      if (action.filter?.category === 'Leader' && !action.filter?.includesLeader) {
        if (!tps.leader?.card || !matchesFilter(tps.leader.card, action.filter)) return state;
        return addLog(
          { ...state, [targetOwner]: { ...tps, leader: { ...tps.leader, state: 'active' } } },
          `${sourceCard.name}: ${tps.leader.card.name} activated.`, 'action'
        );
      }

      // Character (or character+leader) target: gather rested candidates
      const candidates = [];
      if (action.filter?.includesLeader && tps.leader?.card && tps.leader.state === 'rest' &&
          matchesFilter(tps.leader.card, action.filter)) {
        candidates.push({ zone: 'leader', index: -1 });
      }
      tps.characterArea.forEach((fc, i) => {
        if (fc.state === 'rest' && matchesFilter(fc.card, action.filter, fc))
          candidates.push({ zone: 'character', index: i });
      });

      if (!candidates.length) return state;

      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_UNREST_TARGET',
          targetOwner,
          targets: candidates,
          max: action.count ?? 1,
        }, fieldPos);
      }
      // AI: activate first N rested candidates
      let s = state;
      for (const t of candidates.slice(0, action.count ?? 1)) {
        const tps2 = s[targetOwner];
        if (t.zone === 'leader') {
          s = addLog(
            { ...s, [targetOwner]: { ...tps2, leader: { ...tps2.leader, state: 'active' } } },
            `${sourceCard.name}: ${tps2.leader.card.name} activated.`, 'action'
          );
        } else {
          s = addLog({
            ...s,
            [targetOwner]: { ...tps2, characterArea: tps2.characterArea.map((fc, i) =>
              i === t.index ? { ...fc, state: 'active' } : fc
            ) },
          }, `${sourceCard.name}: ${tps2.characterArea[t.index].card.name} activated.`, 'action');
        }
      }
      return executeActionSequence(s, owner, continuation, sourceCard, effectKey, fieldPos);
    }

    case 'ADD_DON_FROM_DECK': {
      const ps = state[owner];
      const take = Math.min(action.count, ps.donDeck.length);
      if (take === 0) return state;
      const gained = ps.donDeck.slice(-take).map(d => ({ ...d, state: 'active' }));
      const newDeck = ps.donDeck.slice(0, -take);
      return addLog({
        ...state,
        [owner]: { ...ps, donDeck: newDeck, costArea: [...ps.costArea, ...gained] },
      }, `${sourceCard.name}: Added ${take} active DON!! from DON!! deck.`, 'action');
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
      if (owner === PLAYER.HUMAN) {
        return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
          type: 'CHOOSE_REDIRECT_ATTACK_TARGET',
          targets,
        }, fieldPos);
      }
      // AI: pick the highest-power eligible target
      const best = targets.reduce((a, b) => {
        const pw = t => t.zone === 'leader'
          ? (ps.leader.card?.power ?? 0)
          : (ps.characterArea[t.index]?.card?.power ?? 0);
        return pw(b) > pw(a) ? b : a;
      });
      return applyRedirectAttack(state, owner, best);
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

        if (owner === PLAYER.HUMAN) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_BOTTOM_DECK_TARGET',
            targetOwner,
            fromTrash: true,
            indices: targets.map(t => t.i),
            max: action.count ?? 1,
          }, fieldPos);
        }
        // AI: pick up to count cards and place at bottom in arbitrary order
        const take = Math.min(action.count ?? 1, targets.length);
        const chosen = targets.slice(0, take);
        const chosenIdxSet = new Set(chosen.map(t => t.i));
        return addLog({
          ...state,
          [targetOwner]: {
            ...tps,
            trash: tps.trash.filter((_, i) => !chosenIdxSet.has(i)),
            deck: [...tps.deck, ...chosen.map(t => t.c)],
          },
        }, `${sourceCard.name}: placed ${take} card(s) from trash at bottom of deck.`, 'action');
      }

      const targets = tps.characterArea
        .map((fc, i) => ({ fc, i, power: fc.card.power ?? 0 }))
        .filter(({ fc, power }) => matchesFilter(fc.card, action.filter, fc, power));

      if (!targets.length) return state;

      if (owner === PLAYER.HUMAN) {
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
      const bestFC = tps.characterArea[best.i];
      const returnedDon = Array.from({ length: bestFC.attachedDon }, (_, i) =>
        ({ ...makeDon(`bd-${i}`), state: 'rest' })
      );
      return addLog({
        ...state,
        [targetOwner]: {
          ...tps,
          characterArea: tps.characterArea.filter((_, i) => i !== best.i),
          deck: [bestFC.card, ...tps.deck],
          costArea: [...tps.costArea, ...returnedDon],
        },
      }, `${sourceCard.name}: ${bestFC.card.name} placed at bottom of deck.`, 'action');
    }

    case 'HAND_TO_DECK': {
      const ps = state[owner];
      if (!ps.hand.length) return state;
      const handIndices = ps.hand.map((_, i) => i);

      if (owner === PLAYER.HUMAN) {
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
      return addLog({ ...state, [owner]: { ...ps, hand: newHand, deck: newDeck } },
        `${sourceCard.name}: placed ${take} hand card(s) on deck.`, 'action');
    }

    case 'FIRE_MAIN_EFFECT': {
      const clauses = parseEffect(sourceCard.effect ?? '');
      const mainClause = clauses.find(c => c.timings.includes('主要'));
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

      if (owner === PLAYER.HUMAN) {
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
      }, `${sourceCard.name}: free-played ${best.c.name}.`, 'action');
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
      const kwLabel = action.keyword + (action.restriction ? '：' + action.restriction : '');
      const patch = {
        justDeployed: false,
        ...(action.restriction === '角色' ? { rushCharOnly: true } : {}),
      };

      // Filter-based: player picks which matching character gets the keyword
      if (action.filter) {
        const targetOwner = action.filter?.owner === 'opponent' ? opponent : owner;
        const tps = state[targetOwner];
        const targets = tps.characterArea
          .map((fc, i) => ({ fc, i }))
          .filter(({ fc }) => matchesFilter(fc.card, action.filter, fc));
        if (!targets.length) return state;
        if (owner === PLAYER.HUMAN) {
          return setPendingEffect(state, owner, sourceCard, effectKey, action, continuation, {
            type: 'CHOOSE_GRANT_KEYWORD_TARGET',
            targetOwner,
            keyword: kwLabel,
            indices: targets.map(t => t.i),
            max: action.count ?? 1,
          }, fieldPos);
        }
        // AI: pick first match
        const newChars = tps.characterArea.map((fc, i) =>
          i === targets[0].i ? { ...fc, ...patch } : fc
        );
        return addLog(
          { ...state, [targetOwner]: { ...tps, characterArea: newChars } },
          `${sourceCard.name}: gave 【${kwLabel}】 to ${tps.characterArea[targets[0].i].card.name}.`, 'action'
        );
      }

      // Fallback: self-grant to fieldPos card (existing behaviour for cards like 速攻：角色)
      if (!fieldPos) return state;
      const ps = state[owner];
      if (fieldPos.target === 'leader') {
        return addLog(
          { ...state, [owner]: { ...ps, leader: { ...ps.leader, ...patch } } },
          `${sourceCard.name} gained 【${kwLabel}】 this turn.`, 'action'
        );
      }
      const newChars = ps.characterArea.map((fc, i) =>
        i === fieldPos.target ? { ...fc, ...patch } : fc
      );
      return addLog(
        { ...state, [owner]: { ...ps, characterArea: newChars } },
        `${sourceCard.name} gained 【${kwLabel}】 this turn.`, 'action'
      );
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

export function resolveEffectChoice(state, { selectedIndices }) {
  const pe = state.pendingEffect;
  if (!pe) return state;

  const { owner, sourceCard, effectKey, action, continuation, choices, fieldPos } = pe;
  let s = { ...state, pendingEffect: null };

  switch (choices.type) {

    case 'CHOOSE_KO_TARGET':
      for (const idx of selectedIndices.slice(0, action.count ?? 1))
        s = execKO(s, choices.targetOwner, idx, sourceCard.name);
      break;

    case 'CHOOSE_RETURN_HAND_TARGET': {
      // selectedIndices are indices into choices.targets (not characterArea indices).
      // Sort by descending charIndex within the same owner to avoid shift after each removal.
      const toReturn = selectedIndices.slice(0, choices.max)
        .map(i => choices.targets[i])
        .filter(Boolean)
        .sort((a, b) => a.owner === b.owner ? b.charIndex - a.charIndex : 0);
      for (const t of toReturn)
        s = execReturnHand(s, t.owner, t.charIndex, sourceCard.name);
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
          }, `${sourceCard.name}: moved ${card.name} from trash to hand.`, 'action');
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
      for (const idx of selectedIndices.slice(0, choices.max)) {
        const tps = s[choices.targetOwner];
        const newChars = tps.characterArea.map((fc, i) =>
          i === idx ? { ...fc, state: 'rest' } : fc
        );
        s = addLog({ ...s, [choices.targetOwner]: { ...tps, characterArea: newChars } },
          `${tps.characterArea[idx].card.name} rested.`, 'action');
      }
      break;
    }

    case 'CHOOSE_UNREST_TARGET': {
      for (const si of selectedIndices.slice(0, choices.max)) {
        const t = choices.targets[si];
        if (!t) continue;
        const tps = s[choices.targetOwner];
        if (t.zone === 'leader') {
          s = addLog(
            { ...s, [choices.targetOwner]: { ...tps, leader: { ...tps.leader, state: 'active' } } },
            `${tps.leader.card.name} activated.`, 'action'
          );
        } else {
          s = addLog({
            ...s,
            [choices.targetOwner]: { ...tps, characterArea: tps.characterArea.map((fc, i) =>
              i === t.index ? { ...fc, state: 'active' } : fc
            ) },
          }, `${tps.characterArea[t.index].card.name} activated.`, 'action');
        }
      }
      break;
    }

    case 'CHOOSE_REFRESH_LOCK_TARGET': {
      for (const idx of selectedIndices.slice(0, choices.max)) {
        const tps = s[choices.targetOwner];
        s = addLog({
          ...s,
          [choices.targetOwner]: { ...tps, characterArea: tps.characterArea.map((fc, i) =>
            i === idx ? { ...fc, refreshLocked: true } : fc
          ) },
        }, `${tps.characterArea[idx].card.name}: will not refresh next turn.`, 'action');
      }
      break;
    }

    case 'CHOOSE_DEPLOY_FROM_TRASH': {
      for (const idx of [...selectedIndices].sort((a, b) => b - a).slice(0, choices.max)) {
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

    case 'CHOOSE_DEPLOY_FROM_HAND': {
      for (const idx of [...selectedIndices].sort((a, b) => b - a).slice(0, choices.max)) {
        const currentPs = s[choices.sourceOwner];
        if (currentPs.characterArea.length >= 5) {
          // Field is full and it's a human deploy — ask which character to replace
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
        s = execDeploy(s, choices.sourceOwner, idx, sourceCard.name);
      }
      break;
    }

    case 'CHOOSE_DISCARD': {
      const sorted = [...selectedIndices].sort((a, b) => b - a);
      const ps = s[owner];
      let hand = [...ps.hand], trash = [...ps.trash];
      for (const idx of sorted) { trash.push(hand[idx]); hand.splice(idx, 1); }
      s = addLog({ ...s, [owner]: { ...ps, hand, trash } },
        `Discarded ${sorted.length} card(s).`, 'action');
      break;
    }

    case 'CHOOSE_HAND_TO_DECK': {
      const ps = s[owner];
      const take = Math.min(choices.max, selectedIndices.length);
      const sorted = [...selectedIndices].sort((a, b) => b - a).slice(0, take);
      const chosen = sorted.map(i => ps.hand[i]);
      let hand = [...ps.hand];
      for (const idx of sorted) hand.splice(idx, 1);
      s = addLog({ ...s, [owner]: { ...ps, hand } },
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

      if (choices.remainderToTrash) {
        s = addLog({
          ...s,
          [owner]: { ...ps, hand: [...ps.hand, ...taken], deck: deckBase, trash: [...ps.trash, ...remaining] },
        }, `Picked ${taken.length} card(s) — rest sent to trash.`, 'action');
        break;
      }

      if (remaining.length > 1) {
        // Let the player arrange the remaining cards before sending to bottom
        s = addLog({
          ...s,
          [owner]: { ...ps, hand: [...ps.hand, ...taken], deck: deckBase },
          pendingEffect: { owner, sourceCard, effectKey, action, continuation,
            choices: { type: 'SEARCH_ORDER', remaining } },
        }, `Picked ${taken.length} card(s) — arrange the rest for the bottom of the deck.`, 'action');
        return s;
      }

      // 0 or 1 remaining — no ordering needed; goes straight to bottom
      const newDeck = [...remaining, ...deckBase];
      s = addLog({ ...s, [owner]: { ...ps, deck: newDeck, hand: [...ps.hand, ...taken] } },
        `Picked ${taken.length} card(s).`, 'action');
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
          s = addLog(
            addPowerMod(s, choices.targetOwner, target, action.delta, action.until),
            `Power ${action.delta > 0 ? '+' : ''}${action.delta} applied.`, 'action'
          );
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

    case 'CONFIRM_OPTIONAL_ACTIVATION':
      if (selectedIndices.length === 0) return s; // player skipped — drop cost + effect
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
      const targetIdx = selectedIndices[0];
      if (targetIdx === undefined) break;
      const target  = choices.targets[targetIdx];
      const ps      = s[owner];
      const donPool = ps.costArea.filter(d => !choices.donState || d.state === choices.donState);
      const dons    = donPool.slice(0, choices.count);
      if (dons.length && target) s = execAttachDon(s, owner, target, dons);
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
        // Place selected trash cards at the bottom of the deck in chosen order
        const sorted = [...selectedIndices].sort((a, b) => a - b).slice(0, choices.max ?? 1);
        const tps = s[choices.targetOwner];
        const chosen = sorted.map(i => tps.trash[i]);
        const chosenIdxSet = new Set(sorted);
        s = addLog({
          ...s,
          [choices.targetOwner]: {
            ...tps,
            trash: tps.trash.filter((_, i) => !chosenIdxSet.has(i)),
            deck: [...tps.deck, ...chosen],
          },
        }, `Placed ${chosen.length} card(s) from trash at bottom of deck.`, 'action');
      } else {
        for (const idx of selectedIndices.slice(0, choices.max ?? 1)) {
          const tps = s[choices.targetOwner];
          const fc = tps.characterArea[idx];
          if (!fc) continue;
          const returnedDon = Array.from({ length: fc.attachedDon }, (_, i) =>
            ({ _donId: `don-bd-${i}-${Math.random()}`, state: 'rest' })
          );
          s = addLog({
            ...s,
            [choices.targetOwner]: {
              ...s[choices.targetOwner],
              characterArea: s[choices.targetOwner].characterArea.filter((_, i) => i !== idx),
              deck: [fc.card, ...s[choices.targetOwner].deck],
              costArea: [...s[choices.targetOwner].costArea, ...returnedDon],
            },
          }, `${fc.card.name} placed at bottom of deck.`, 'action');
        }
      }
      break;
    }

    case 'CHOOSE_GRANT_KEYWORD_TARGET': {
      const targetIdx = selectedIndices[0];
      if (targetIdx === undefined) break;
      const charIdx = choices.indices[targetIdx];
      const kwLabel = action.keyword + (action.restriction ? '：' + action.restriction : '');
      const patch = {
        justDeployed: false,
        ...(action.restriction === '角色' ? { rushCharOnly: true } : {}),
      };
      const tps = s[choices.targetOwner];
      const fc = tps.characterArea[charIdx];
      if (!fc) break;
      const newChars = tps.characterArea.map((c, i) => i === charIdx ? { ...c, ...patch } : c);
      s = addLog(
        { ...s, [choices.targetOwner]: { ...tps, characterArea: newChars } },
        `${sourceCard.name}: gave 【${kwLabel}】 to ${fc.card.name}.`, 'action'
      );
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
          `${sourceCard.name}: free-played ${card2.name}.`, 'action'
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

      // Process in reverse charIndex order within each owner to avoid index shift after removal
      const sorted = [...chosen].sort((a, b) =>
        a.ownerKey === b.ownerKey ? b.index - a.index : 0
      );
      for (const { ownerKey, index } of sorted) {
        const lifeOwnerKey = choices.targetOwner === 'opponent' ? opp(owner)
                           : choices.targetOwner === 'holder'   ? ownerKey
                           : owner;
        let card;
        const tps = s[ownerKey];
        if (choices.sourceZone === 'hand') {
          card = tps.hand[index];
          s = { ...s, [ownerKey]: { ...tps, hand: tps.hand.filter((_, i) => i !== index) } };
        } else {
          const fc = tps.characterArea[index];
          if (!fc) continue;
          card = fc.card;
          const returnedDon = Array.from({ length: fc.attachedDon ?? 0 }, (_, k) =>
            ({ _donId: `don-atl-res-${k}-${Math.random()}`, state: 'rest' })
          );
          s = { ...s, [ownerKey]: {
            ...tps,
            characterArea: tps.characterArea.filter((_, i) => i !== index),
            costArea: [...tps.costArea, ...returnedDon],
          }};
        }
        const lps     = s[lifeOwnerKey];
        const curFU   = lps.lifeAreaFaceUp ?? lps.lifeArea.map(() => false);
        const placing = choices.faceUp ?? false;
        if (position === 'bottom') {
          s = addLog({ ...s, [lifeOwnerKey]: {
            ...lps, lifeArea: [card, ...lps.lifeArea], lifeAreaFaceUp: [placing, ...curFU],
          }}, `Moved ${card.name} to bottom of life.`, 'action');
        } else {
          s = addLog({ ...s, [lifeOwnerKey]: {
            ...lps, lifeArea: [...lps.lifeArea, card], lifeAreaFaceUp: [...curFU, placing],
          }}, `Moved ${card.name} to top of life.`, 'action');
        }
      }
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

function execKO(state, targetOwner, charIndex, sourceName) {
  const tps  = state[targetOwner];
  const koFC = tps.characterArea[charIndex];
  if (!koFC) return state;

  const returnedDon = Array.from({ length: koFC.attachedDon }, (_, i) =>
    ({ ...makeDon(`ko-eff-${i}`), state: 'rest' })
  );
  return addLog({
    ...state,
    [targetOwner]: {
      ...tps,
      characterArea: tps.characterArea.filter((_, i) => i !== charIndex),
      trash:    [...tps.trash, koFC.card],
      costArea: [...tps.costArea, ...returnedDon],
    },
  }, `${sourceName}: KO'd ${koFC.card.name}.`, 'action');
}

function execReturnHand(state, targetOwner, charIndex, sourceName) {
  const tps = state[targetOwner];
  const fc  = tps.characterArea[charIndex];
  if (!fc) return state;
  const returnedDon = Array.from({ length: fc.attachedDon }, (_, i) =>
    ({ ...makeDon(`rh-${charIndex}-${i}`), state: 'rest' })
  );
  return addLog({
    ...state,
    [targetOwner]: {
      ...tps,
      characterArea: tps.characterArea.filter((_, i) => i !== charIndex),
      hand:     [...tps.hand, fc.card],
      costArea: [...tps.costArea, ...returnedDon],
    },
  }, `${sourceName}: returned ${fc.card.name} to hand.`, 'action');
}

function findLowestPowerIndex(characterArea) {
  let idx = 0;
  for (let i = 1; i < characterArea.length; i++) {
    if ((characterArea[i].card?.power ?? 0) < (characterArea[idx].card?.power ?? 0)) idx = i;
  }
  return idx;
}

function execDeploy(state, owner, handIndex, sourceName) {
  const ps   = state[owner];
  const card = ps.hand[handIndex];
  if (!card) return state;

  if (ps.characterArea.length >= 5) {
    // AI: auto-replace lowest-power character. Human case is handled upstream.
    const lowestIdx  = findLowestPowerIndex(ps.characterArea);
    const replaceFC  = ps.characterArea[lowestIdx];
    const returnedDon = Array.from({ length: replaceFC.attachedDon }, (_, i) =>
      ({ ...makeDon(`rpl-${i}`), state: 'rest' })
    );
    const newChars = ps.characterArea.map((fc, i) =>
      i === lowestIdx
        ? { card, state: 'active', attachedDon: 0, justDeployed: !(card.effect?.includes('速攻')) }
        : fc
    );
    return addLog({
      ...state,
      [owner]: {
        ...ps,
        hand: ps.hand.filter((_, i) => i !== handIndex),
        characterArea: newChars,
        trash: [...ps.trash, replaceFC.card],
        costArea: [...ps.costArea, ...returnedDon],
      },
    }, `${sourceName}: deployed ${card.name}, replacing ${replaceFC.card.name}.`, 'action');
  }

  const fieldCard = { card, state: 'active', attachedDon: 0, justDeployed: !(card.effect?.includes('速攻')) };
  return addLog({
    ...state,
    [owner]: {
      ...ps,
      hand: ps.hand.filter((_, i) => i !== handIndex),
      characterArea: [...ps.characterArea, fieldCard],
    },
  }, `${sourceName}: deployed ${card.name}.`, 'action');
}

function execDeployFromTrash(state, owner, trashIndex, sourceName) {
  const ps = state[owner];
  const card = ps.trash[trashIndex];
  if (!card) return state;

  if (ps.characterArea.length >= 5) {
    const lowestIdx = findLowestPowerIndex(ps.characterArea);
    const replaceFC = ps.characterArea[lowestIdx];
    const returnedDon = Array.from({ length: replaceFC.attachedDon }, (_, i) =>
      ({ ...makeDon(`rpl-${i}`), state: 'rest' })
    );
    const newChars = ps.characterArea.map((fc, i) =>
      i === lowestIdx
        ? { card, state: 'active', attachedDon: 0, justDeployed: !(card.effect?.includes('速攻')) }
        : fc
    );
    return addLog({
      ...state,
      [owner]: {
        ...ps,
        characterArea: newChars,
        trash: [...ps.trash.filter((_, i) => i !== trashIndex), replaceFC.card],
        costArea: [...ps.costArea, ...returnedDon],
      },
    }, `${sourceName}: deployed ${card.name} from trash, replacing ${replaceFC.card.name}.`, 'action');
  }

  const fieldCard = { card, state: 'active', attachedDon: 0, justDeployed: !(card.effect?.includes('速攻')) };
  const s = addLog({
    ...state,
    [owner]: {
      ...ps,
      trash: ps.trash.filter((_, i) => i !== trashIndex),
      characterArea: [...ps.characterArea, fieldCard],
    },
  }, `${sourceName}: deployed ${card.name} from trash.`, 'action');
  return { ...s, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card, owner }] };
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
    targetName = ps.leader.card?.name ?? 'Leader';
  } else {
    newChars   = ps.characterArea.map((fc, i) =>
      i === target.index ? { ...fc, attachedDon: fc.attachedDon + dons.length } : fc
    );
    targetName = ps.characterArea[target.index]?.card?.name ?? 'character';
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
