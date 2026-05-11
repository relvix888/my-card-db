// Keyword detection helpers and effect resolvers.
// Keyword detectors read card.effect text (fast string checks, no parsing).
// Resolvers use effectParser + effectActions for full structured execution.

import { PLAYER } from './constants';
import { parseEffect } from './effectParser';
import { evaluateCondition, executeActionSequence, applyDonReturnSelection, matchesFilter } from './effectActions';

function addLog(state, text, type = 'info') {
  return { ...state, log: [...(state.log ?? []), { text, type, id: Date.now() + Math.random() }] };
}

const ACTIVATED_TIMINGS = new Set(['啟動主要', '起動メイン']);

// ─── Passive keyword detectors ────────────────────────────────────────────────

export function hasKeyword(card, keyword) {
  if (!card?.effect) return false;
  return card.effect.includes(keyword);
}

// Returns keywords the card has via unconditional passive (header keywords, no condition clause).
// Use this for static checks where state is unavailable (e.g. deploy-time Rush → justDeployed).
export const hasRush         = (card) => {
  if (!card?.effect) return false;
  const clauses = parseEffect(card.effect);
  return clauses.some(c => c.passive.includes('速攻') && !c.condition);
};
export const hasBlocker      = (card) => hasKeyword(card, '防禦') || hasKeyword(card, 'ブロッカー');
export const hasDoubleAtk    = (card) => hasKeyword(card, '雙重攻擊') || hasKeyword(card, 'ダブルアタック');
export const hasBanish       = (card) => hasKeyword(card, '消失') || hasKeyword(card, 'バニッシュ');
export const hasOnAttack     = (card) => hasKeyword(card, '攻擊時') || hasKeyword(card, 'アタック時');
export const hasActivatedMain = (card) => hasKeyword(card, '啟動主要') || hasKeyword(card, '起動メイン');

/**
 * Returns the set of keywords a field card currently has from conditional continuous grants
 * (e.g. "gains Rush while 6+ DON!! in play"). Re-evaluated each time against current state.
 */
export function evaluateContinuousKeywords(fieldCard, activePlayer, owner, state) {
  if (!fieldCard?.card?.effect) return new Set();
  const clauses = parseEffect(fieldCard.card.effect);
  const keywords = new Set();
  for (const clause of clauses) {
    const isAuto = clause.timings.some(t =>
      ['登場時','KO時','攻擊時','對方攻擊時','防禦時','我方回合結束時',
       '觸發器','啟動主要','主要','反擊','起動メイン'].includes(t));
    if (isAuto || clause.passive.length > 0) continue;
    if (clause.continuous.includes('對方回合中') && activePlayer === owner) continue;
    if (clause.continuous.includes('我方回合中') && activePlayer !== owner) continue;
    if (clause.condition && !evaluateCondition(state, owner, clause.condition)) continue;
    for (const action of clause.actions)
      if (action.type === 'GRANT_KEYWORD' && action.filter?.self)
        keywords.add(action.keyword);
  }
  return keywords;
}

/**
 * Returns { available: boolean, hint: string } for an Activate:Main action.
 * Checks once-per-turn usage and DON!! return cost affordability.
 */
export function getActivatedMainStatus(card, playerState, fullState = null, owner = null, fieldPos = null) {
  if (!hasActivatedMain(card)) return null;

  const fieldTarget = fieldPos != null ? fieldPos.target : null;
  const effectKey = fieldTarget != null
    ? `${card.id}_${fieldTarget}_啟動主要`
    : `${card.id}_啟動主要`;
  if (playerState.effectUsed?.[effectKey])
    return { available: false, hint: 'Already used this turn' };

  const clauses  = parseEffect(card.effect ?? '');
  const clause   = clauses.find(c =>
    c.timings.includes('啟動主要') || c.timings.includes('起動メイン')
  );
  if (!clause) return { available: true, hint: 'Activate effect' };

  if (clause.donGate) {
    const activeDon = (playerState.costArea ?? []).filter(d => d.state === 'active').length;
    if (activeDon < clause.donGate)
      return { available: false, hint: `Needs ${clause.donGate} active DON!! to attach` };
  }

  if (clause.donReturn) {
    const ps = playerState;
    const totalDon = (ps.costArea?.length ?? 0)
      + (ps.leader?.attachedDon ?? 0)
      + (ps.characterArea ?? []).reduce((n, fc) => n + (fc.attachedDon ?? 0), 0);
    if (totalDon < clause.donReturn)
      return { available: false, hint: `Needs ${clause.donReturn} DON!! anywhere (not enough)` };
  }

  if (clause.condition && fullState && owner) {
    if (!evaluateCondition(fullState, owner, clause.condition))
      return { available: false, hint: 'Condition not met' };
  }

  const hints = [];
  if (clause.donGate)   hints.push(`attach ${clause.donGate} DON!!`);
  if (clause.donReturn) hints.push(`return ${clause.donReturn} DON!!`);
  return {
    available: true,
    hint: hints.length ? `Cost: ${hints.join(', ')}` : 'Activate effect',
  };
}

export function counterValue(card) {
  return card?.counter || 0;
}

export function hasTrigger(card) {
  return !!(card?.trigger);
}

// Enel special rule: DON!! deck is 6 cards.
export function leaderDonDeckSize(leader) {
  if (!leader) return 10;
  const id = leader.id?.replace('_p1', '').replace('_p2', '');
  if (id === 'OP15-058') return 6;
  return 10;
}

// ─── Internal: resolve clauses matching a timing keyword ─────────────────────

/**
 * @param {object}  card       raw card
 * @param {object}  state      game state
 * @param {string}  owner      'human'|'ai'
 * @param {string}  timing     e.g. '登場時', '攻擊時', '觸發器'
 * @param {object}  [fieldPos] { target: 'leader'|number } — card's field index
 */
function resolveAtTiming(card, state, owner, timing, fieldPos = null) {
  if (!card?.effect) return state;
  const clauses = parseEffect(card.effect);
  let s = state;

  for (let ci = 0; ci < clauses.length; ci++) {
    const clause = clauses[ci];
    if (!clause.timings.includes(timing)) continue;

    const isActivated = clause.timings.some(t => ACTIVATED_TIMINGS.has(t));

    // DON!! gate (non-activated) OR attach-cost affordability check (activated)
    if (clause.donGate !== null) {
      if (isActivated) {
        const activeDon = (s[owner].costArea ?? []).filter(d => d.state === 'active').length;
        if (activeDon < clause.donGate) continue;
      } else {
        const fp = fieldPos ? getFieldCard(s, owner, fieldPos) : null;
        if (!fp || fp.attachedDon < clause.donGate) continue;
      }
    }

    // If effect requires flipping top life face-up, skip when already face-up or no life
    if (clause.actions.some(a => a.type === 'FLIP_LIFE_FACE_UP')) {
      const ps = s[owner];
      const lifeLen = ps.lifeArea?.length ?? 0;
      const faceUpArr = ps.lifeAreaFaceUp ?? [];
      if (lifeLen === 0 || faceUpArr[lifeLen - 1]) continue;
    }

    // Condition check
    if (clause.condition && !evaluateCondition(s, owner, clause.condition)) continue;

    // Once-per-turn guard — include field position so duplicate copies of the same
    // card each track their own usage independently.
    const fieldTarget = fieldPos != null ? fieldPos.target : null;
    const effectKey = fieldTarget != null
      ? `${card.id}_${fieldTarget}_${timing}`
      : `${card.id}_${timing}`;
    if (clause.oncePerTurn) {
      if (s[owner]?.effectUsed?.[effectKey]) continue;
      s = markEffectUsed(s, owner, effectKey);
    }

    // DON!! attach cost (activated effects only): attach N active DON!! from cost area to this card
    if (clause.donGate !== null && isActivated && fieldPos) {
      const paid = attachDonFromCostArea(s, owner, fieldPos, clause.donGate);
      if (!paid) { s = state; continue; }
      s = paid;
    }

    // DON!! return cost
    if (clause.donReturn) {
      // For reactive timings (對方攻擊時), give the human a chance to opt in before
      // paying the cost — the player sees a confirm prompt first, then selects don.
      if (owner === PLAYER.HUMAN && timing === '對方攻擊時') {
        s = {
          ...s,
          pendingEffect: {
            owner,
            sourceCard: card,
            effectKey,
            fieldPos,
            action: { type: 'CONFIRM_OPTIONAL_ACTIVATION', donReturn: clause.donReturn },
            continuation: clause.actions,
            choices: {
              type: 'CONFIRM_OPTIONAL_ACTIVATION',
              costDescription: `咚‼ -${clause.donReturn}`,
            },
          },
        };
        break;
      }
      s = returnDon(s, owner, clause.donReturn, card, effectKey, clause.actions, fieldPos);
      if (!s) { s = state; continue; } // can't pay — skip this clause
      if (s.pendingEffect) break;      // human: waiting for selection
    }

    if (!s.pendingEffect) {
      s = executeActionSequence(s, owner, clause.actions, card, effectKey, fieldPos);
    }

    if (s.pendingEffect) {
      // Fold remaining sibling clauses (condition-checked) into the pendingEffect
      // continuation so they still run after the player resolves this choice.
      const tailActions = [];
      for (let ri = ci + 1; ri < clauses.length; ri++) {
        const rem = clauses[ri];
        if (!rem.timings.includes(timing)) continue;
        if (rem.condition && !evaluateCondition(s, owner, rem.condition)) continue;
        tailActions.push(...rem.actions);
      }
      if (tailActions.length) {
        s = {
          ...s,
          pendingEffect: {
            ...s.pendingEffect,
            continuation: [...s.pendingEffect.continuation, ...tailActions],
          },
        };
      }
      break;
    }
  }

  return s;
}

// ─── Public effect resolvers ──────────────────────────────────────────────────

export function resolveOnPlayEffect(card, state, owner) {
  const ps  = state[owner];
  const idx = ps.characterArea.findIndex(fc => fc.card === card);
  const fieldPos = idx >= 0 ? { target: idx }
    : ps.leader.card === card ? { target: 'leader' } : null;
  return resolveAtTiming(card, state, owner, '登場時', fieldPos);
}

export function resolveOnAttackEffect(card, state, owner, attackerZone, attackerIndex) {
  const fieldPos = { target: attackerZone === 'leader' ? 'leader' : attackerIndex };
  return resolveAtTiming(card, state, owner, '攻擊時', fieldPos);
}

export function resolveOnOpponentAttackEffect(card, state, owner) {
  return resolveAtTiming(card, state, owner, '對方攻擊時', { target: 'leader' });
}

export function resolveOnBlockEffect(card, state, owner, blockerIndex) {
  return resolveAtTiming(card, state, owner, '防禦時', { target: blockerIndex });
}

export function resolveActivatedMainEffect(card, state, owner, zone, index) {
  const fieldPos = { target: zone === 'leader' ? 'leader' : zone === 'stage' ? 'stage' : index };
  // Try the Chinese keyword first, then the Japanese variant
  let s = resolveAtTiming(card, state, owner, '啟動主要', fieldPos);
  if (s === state) s = resolveAtTiming(card, state, owner, '起動メイン', fieldPos);
  return s;
}

export function resolveOnKOEffect(card, state, owner) {
  return resolveAtTiming(card, state, owner, 'KO時');
}

export function resolveTriggerEffect(card, state, owner) {
  return resolveAtTiming(card, state, owner, '觸發器');
}

export function resolveEventEffect(card, state, owner) {
  if (!card?.effect) return state;
  const clauses = parseEffect(card.effect);
  let s = state;

  for (const clause of clauses) {
    // Events fire all non-passive, non-continuous clauses except 反擊 (counter-step only)
    const isAuto       = clause.timings.some(t => ['登場時','KO時','攻擊時','對方攻擊時','防禦時','我方回合結束時','觸發器'].includes(t));
    const isContinuous = clause.continuous.length > 0 || clause.passive.length > 0;
    const isCounter    = clause.timings.includes('反擊');
    if (isAuto || isContinuous || isCounter) continue;

    if (clause.condition && !evaluateCondition(s, owner, clause.condition)) continue;

    const effectKey = `${card.id}_event`;
    s = executeActionSequence(s, owner, clause.actions, card, effectKey);
    if (s.pendingEffect) break;
  }
  return s;
}

export function resolveCounterEffect(card, state, owner) {
  if (!card?.effect) return state;
  const clauses = parseEffect(card.effect);
  let s = state;
  for (const clause of clauses) {
    if (!clause.timings.includes('反擊')) continue;
    const effectKey = `${card.id}_counter`;
    s = executeActionSequence(s, owner, clause.actions, card, effectKey);
    if (s.pendingEffect) break;
  }
  return s;
}

export function resolveEndOfTurnEffects(state, owner) {
  const ps = state[owner];
  let s = state;

  s = resolveAtTiming(ps.leader.card, s, owner, '我方回合結束時', { target: 'leader' });
  for (let i = 0; i < ps.characterArea.length; i++) {
    if (s.pendingEffect) break;
    s = resolveAtTiming(ps.characterArea[i].card, s, owner, '我方回合結束時', { target: i });
  }
  return s;
}

// ─── Continuous power bonus (called from calcPower) ───────────────────────────

/**
 * Compute extra power from a field card's own continuous/conditional effects.
 * e.g. OP15-050: +3000 while "Kelly Funk" is on field.
 *      OP15-051: +3000 during opponent's turn with "Dressrosa" leader.
 */
const AUTO_TIMINGS = new Set([
  '登場時','KO時','攻擊時','對方攻擊時','防禦時','我方回合結束時','觸發器',
  '啟動主要','主要','反擊','起動メイン',
]);

export function evaluateContinuousPower(fieldCard, activePlayer, owner, state) {
  if (!fieldCard?.card?.effect) return 0;
  const clauses = parseEffect(fieldCard.card.effect);
  let bonus = 0;

  for (const clause of clauses) {
    if (clause.timings.some(t => AUTO_TIMINGS.has(t)) || clause.passive.length > 0) continue;

    if (clause.continuous.includes('對方回合中') && activePlayer === owner) continue;
    if (clause.continuous.includes('我方回合中') && activePlayer !== owner) continue;

    // DON!! gate: check against this card's attached DON!!
    if (clause.donGate !== null && (fieldCard.attachedDon ?? 0) < clause.donGate) continue;

    if (clause.condition && !evaluateCondition(state, owner, clause.condition)) continue;

    for (const action of clause.actions) {
      if (action.type === 'POWER_MOD' && action.filter?.self)
        bonus += action.delta;
    }
  }

  return bonus;
}

/**
 * Sum power bonuses granted TO targetFC by other field cards' continuous effects.
 * Handles board-wide boosts like "all your leader and characters get +1000".
 */
export function evaluateGlobalContinuousPower(targetFC, activePlayer, owner, state) {
  if (!state) return 0;
  const ps = state[owner];
  let bonus = 0;

  const sources = [ps.leader, ...(ps.characterArea ?? [])];
  for (const srcFC of sources) {
    if (!srcFC?.card?.effect || srcFC === targetFC) continue;
    const clauses = parseEffect(srcFC.card.effect);

    for (const clause of clauses) {
      if (clause.timings.some(t => AUTO_TIMINGS.has(t)) || clause.passive.length > 0) continue;

      if (clause.continuous.includes('對方回合中') && activePlayer === owner) continue;
      if (clause.continuous.includes('我方回合中') && activePlayer !== owner) continue;

      // DON!! gate: check against the source card's attached DON!!
      if (clause.donGate !== null && (srcFC.attachedDon ?? 0) < clause.donGate) continue;

      if (clause.condition && !evaluateCondition(state, owner, clause.condition)) continue;

      for (const action of clause.actions) {
        if (action.type !== 'POWER_MOD' || action.until !== 'continuous') continue;
        if (action.filter?.self) continue; // self-targeting handled by evaluateContinuousPower
        if (matchesFilter(targetFC.card, action.filter, targetFC)) bonus += action.delta;
      }
    }
  }

  return bonus;
}

// ─── Private utilities ────────────────────────────────────────────────────────

function markEffectUsed(state, owner, effectKey) {
  const ps = state[owner];
  return {
    ...state,
    [owner]: { ...ps, effectUsed: { ...(ps.effectUsed ?? {}), [effectKey]: true } },
  };
}

function getFieldCard(state, owner, fieldPos) {
  const ps = state[owner];
  if (fieldPos.target === 'leader') return ps.leader;
  return ps.characterArea[fieldPos.target] ?? null;
}

// Remove N active DON!! from cost area and attach them to the field card at fieldPos.
// Returns null when there aren't enough active DON!!.
function attachDonFromCostArea(state, owner, fieldPos, count) {
  const ps = state[owner];
  const actives = ps.costArea.filter(d => d.state === 'active');
  if (actives.length < count) return null;

  const toAttach  = actives.slice(0, count);
  const attachIds = new Set(toAttach.map(d => d._donId));
  const newCostArea = ps.costArea.filter(d => !attachIds.has(d._donId));

  let newLeader  = ps.leader;
  let newChars   = ps.characterArea;
  const cardName = fieldPos.target === 'leader'
    ? (ps.leader.card?.name ?? 'Leader')
    : (ps.characterArea[fieldPos.target]?.card?.name ?? 'card');

  if (fieldPos.target === 'leader') {
    newLeader = { ...ps.leader, attachedDon: ps.leader.attachedDon + count };
  } else {
    newChars = ps.characterArea.map((fc, i) =>
      i === fieldPos.target ? { ...fc, attachedDon: fc.attachedDon + count } : fc
    );
  }

  return addLog({
    ...state,
    [owner]: { ...ps, costArea: newCostArea, leader: newLeader, characterArea: newChars },
  }, `Attached ${count} DON!! to ${cardName}.`, 'action');
}

// Build flat list of every DON!! card currently in play (cost area + attached).
function buildDonReturnOptions(ps) {
  const opts = [];
  for (const d of ps.costArea)
    opts.push({ source: 'cost', donId: d._donId, state: d.state });
  for (let i = 0; i < (ps.leader?.attachedDon ?? 0); i++)
    opts.push({ source: 'leader', slot: i });
  for (let ci = 0; ci < ps.characterArea.length; ci++)
    for (let i = 0; i < ps.characterArea[ci].attachedDon; i++)
      opts.push({ source: 'character', charIndex: ci, slot: i });
  return opts;
}

// AI priority: rested cost → active cost → weakest-character → leader.
function autoSelectDon(opts, count, ps) {
  const sorted = [
    ...opts.filter(o => o.source === 'cost' && o.state === 'rest'),
    ...opts.filter(o => o.source === 'cost' && o.state === 'active'),
    ...opts
      .filter(o => o.source === 'character')
      .sort((a, b) =>
        (ps.characterArea[a.charIndex]?.card?.power ?? 0) -
        (ps.characterArea[b.charIndex]?.card?.power ?? 0)
      ),
    ...opts.filter(o => o.source === 'leader'),
  ];
  return sorted.slice(0, count);
}

// Returns new state (human → pendingEffect, AI → reduced) or null when unpayable.
function returnDon(state, owner, count, card, effectKey, continuation, fieldPos = null) {
  const ps   = state[owner];
  const opts = buildDonReturnOptions(ps);
  if (opts.length < count) return null;

  if (owner === PLAYER.HUMAN) {
    return {
      ...state,
      pendingEffect: {
        owner,
        sourceCard: card,
        effectKey,
        fieldPos,
        action: { type: 'CHOOSE_DON_RETURN', count },
        continuation,
        choices: { type: 'CHOOSE_DON_RETURN', count, options: opts },
      },
    };
  }
  return applyDonReturnSelection(state, owner, autoSelectDon(opts, count, ps));
}
