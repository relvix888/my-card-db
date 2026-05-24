// Keyword detection helpers and effect resolvers.
// Keyword detectors read card.effect text (fast string checks, no parsing).
// Resolvers use effectParser + effectActions for full structured execution.

import { PLAYER } from './constants';
import { parseEffect, parseEffectForCard } from './effectParser';
import { evaluateCondition, executeActionSequence, applyDonReturnSelection, matchesFilter } from './effectActions';

// Maps CN timing strings to their EN equivalents so resolvers that pass a CN
// timing constant still match EN-parsed clauses (which carry the EN timing string).
const TIMING_EN = {
  '登場時':         'On Play',
  'KO時':           'On K.O.',
  '攻擊時':         'When Attacking',
  '對方攻擊時':     'On Your Opponent\'s Attack',
  '防禦時':         'On Block',
  '我方回合結束時': 'End of Your Turn',
  '我方回合開始時': 'At the Start of Your Turn',
  '觸發器':         'Trigger',
  '啟動主要':       'Activate: Main',
  '主要':           'Main',
  '反擊':           'Counter',
};

/** Returns true if a clause's timings array includes timing OR its EN alias. */
function timingIncludes(clauseTimings, timing) {
  if (clauseTimings.includes(timing)) return true;
  const en = TIMING_EN[timing];
  return en ? clauseTimings.includes(en) : false;
}

function addLog(state, text, type = 'info') {
  return { ...state, log: [...(state.log ?? []), { text, type, id: Date.now() + Math.random() }] };
}

function cn(card) {
  if (!card) return '?';
  const id = card.id?.replace(/_p\d+$/, '') ?? '';
  return id ? `${id} ${card.name}` : (card.name ?? '?');
}

const ACTIVATED_TIMINGS = new Set(['啟動主要', '起動メイン', 'Activate: Main']);

// ─── Passive keyword detectors ────────────────────────────────────────────────

export function hasKeyword(card, keyword) {
  if (!card?.effect) return false;
  return card.effect.includes(keyword);
}

// Returns keywords the card has via unconditional passive (header keywords, no condition clause).
// Use this for static checks where state is unavailable (e.g. deploy-time Rush → justDeployed).
export const hasRush         = (card) => {
  if (!card?.effect) return false;
  const clauses = parseEffectForCard(card);
  return clauses.some(c => c.passive.some(k => k === '速攻' || k === 'Rush' || k.startsWith('速攻：') || k.startsWith('Rush:')) && !c.condition);
};
export const hasCharacterRushOnly = (card) => {
  if (!card?.effect) return false;
  const clauses = parseEffectForCard(card);
  return clauses.some(c =>
    (c.passive.includes('速攻：角色') || c.passive.includes('Rush: Character')) && !c.passive.includes('速攻') && !c.passive.includes('Rush') && !c.condition
  );
};
export const hasBlocker   = (card) => {
  if (!card?.effect) return false;
  const clauses = parseEffectForCard(card);
  return clauses.some(c => !c.condition && (c.passive.includes('防禦') || c.passive.includes('ブロッカー') || c.passive.includes('Blocker')));
};
export const hasDoubleAtk = (card) => {
  if (!card?.effect) return false;
  const clauses = parseEffectForCard(card);
  return clauses.some(c => !c.condition && (c.passive.includes('雙重攻擊') || c.passive.includes('ダブルアタック') || c.passive.includes('Double Attack')));
};
export const hasBanish    = (card) => {
  if (!card?.effect) return false;
  const clauses = parseEffectForCard(card);
  return clauses.some(c => !c.condition && (c.passive.includes('消失') || c.passive.includes('バニッシュ') || c.passive.includes('Banish')));
};
const cardHasUnblock      = (card) => {
  if (!card?.effect) return false;
  const clauses = parseEffectForCard(card);
  return clauses.some(c => !c.condition && (c.passive.includes('防禦不可') || c.passive.includes('Unblockable')));
};
export const hasOnAttack = (card) => {
  if (!card?.effect) return false;
  const clauses = parseEffectForCard(card);
  return clauses.some(c =>
    c.timings.includes('攻擊時') ||
    c.timings.includes('アタック時') ||
    c.timings.includes('When Attacking')
  );
};
export const hasActivatedMain = (card) => hasKeyword(card, '啟動主要') || hasKeyword(card, '起動メイン') || hasKeyword(card, '[Activate: Main]');

// fieldCard-aware keyword checks — also consider tempKeywords granted this turn
export function fcHasKeyword(fc, keyword) {
  if (!fc) return false;
  if (fc.tempKeywords?.includes(keyword)) return true;
  if (fc.opponentTurnEndKeywords?.includes(keyword)) return true;
  return hasKeyword(fc.card, keyword);
}
// Use parser-based hasBlocker (checks passive[] from parseEffect) rather than naive
// string search, because "防禦" can appear in timing text (e.g. "或【防禦】時") and
// would produce false positives. Still check tempKeywords/opponentTurnEndKeywords for
// dynamically granted Blocker.
export const fcHasBlocker = (fc) => {
  if (!fc) return false;
  if (fc.tempKeywords?.includes('防禦') || fc.tempKeywords?.includes('ブロッカー') || fc.tempKeywords?.includes('Blocker')) return true;
  if (fc.opponentTurnEndKeywords?.includes('防禦') || fc.opponentTurnEndKeywords?.includes('ブロッカー') || fc.opponentTurnEndKeywords?.includes('Blocker')) return true;
  return hasBlocker(fc.card);
};
// Includes continuous conditional grants (e.g. "gains Blocker while life ≤ 1")
export function fcEffectiveHasBlocker(fc, owner, activePlayer, state) {
  if (fcHasBlocker(fc)) return true;
  const kws = evaluateContinuousKeywords(fc, activePlayer, owner, state);
  return kws.has('防禦') || kws.has('ブロッカー') || kws.has('Blocker');
}
export const fcHasDoubleAtk = (fc) => fcHasKeyword(fc, '雙重攻擊') || fcHasKeyword(fc, 'ダブルアタック') || fcHasKeyword(fc, 'Double Attack');
export const fcHasBanish    = (fc) => fcHasKeyword(fc, '消失') || fcHasKeyword(fc, 'バニッシュ') || fcHasKeyword(fc, 'Banish');
export const fcHasUnblock   = (fc) => {
  if (!fc) return false;
  if (fc.tempKeywords?.includes('防禦不可') || fc.tempKeywords?.includes('Unblockable') || fc.opponentTurnEndKeywords?.includes('防禦不可') || fc.opponentTurnEndKeywords?.includes('Unblockable')) return true;
  return cardHasUnblock(fc.card);
};
// Rush: full rush (can attack leader); CharRush: character-only rush
export const fcHasRush = (fc) => {
  if (!fc) return false;
  if (fc.tempKeywords?.includes('速攻') || fc.tempKeywords?.includes('Rush') || fc.opponentTurnEndKeywords?.includes('速攻') || fc.opponentTurnEndKeywords?.includes('Rush')) return true;
  return hasRush(fc.card) && !hasCharacterRushOnly(fc.card);
};
export const fcHasCharRushOnly = (fc) => {
  if (!fc) return false;
  if (fcHasRush(fc)) return false;
  if (fc.rushCharOnly) return true;
  if (fc.tempKeywords?.includes('速攻：角色') || fc.tempKeywords?.includes('Rush: Character') || fc.opponentTurnEndKeywords?.includes('速攻：角色') || fc.opponentTurnEndKeywords?.includes('Rush: Character')) return true;
  return hasCharacterRushOnly(fc.card);
};

// Checks if fc effectively has double attack, including keywords granted by other field cards.
export function fcEffectiveHasDoubleAtk(fc, activePlayer, owner, state) {
  if (fcHasDoubleAtk(fc)) return true;
  if (!state) return false;
  const kws = evaluateExternalContinuousKeywords(fc, activePlayer, owner, state);
  return kws.has('雙重攻擊') || kws.has('ダブルアタック') || kws.has('Double Attack');
}

export function leaderHasDeployRestPassive(state, player) {
  const leader = state[player]?.leader;
  if (!leader?.card?.effect) return false;
  const clauses = parseEffectForCard(leader.card);
  return clauses.some(c =>
    c.timings.length === 0 &&
    c.actions.some(a => a.type === 'DEPLOY_RESTED_PASSIVE')
  );
}

// Returns the required trait string if the player's leader has a DISCARD_DRAW_COMPENSATION
// passive, else null. Used by effectActions to fire a compensation draw after any discard
// caused by a card that carries the matching trait.
export function leaderDiscardCompensationTrait(state, player) {
  const leader = state[player]?.leader;
  if (!leader?.card?.effect) return null;
  const clauses = parseEffectForCard(leader.card);
  for (const c of clauses) {
    for (const a of c.actions) {
      if (a.type === 'DISCARD_DRAW_COMPENSATION') return a.trait;
    }
  }
  return null;
}

/**
 * Returns the set of keywords a field card currently has from conditional continuous grants
 * (e.g. "gains Rush while 6+ DON!! in play"). Re-evaluated each time against current state.
 */
export function evaluateContinuousKeywords(fieldCard, activePlayer, owner, state) {
  if (!fieldCard?.card?.effect) return new Set();
  const clauses = parseEffectForCard(fieldCard.card);
  const keywords = new Set();
  for (const clause of clauses) {
    const isAuto = clause.timings.some(t =>
      ['登場時','KO時','攻擊時','對方攻擊時','防禦時','我方回合結束時',
       '觸發器','啟動主要','主要','反擊','起動メイン',
       'On Play','On K.O.','When Attacking','On Your Opponent\'s Attack','On Block','End of Your Turn',
       'Trigger','Activate: Main','Main','Counter'].includes(t));
    if (isAuto || clause.passive.length > 0) continue;
    if ((clause.continuous.includes('對方回合中') || clause.continuous.includes("Opponent's Turn")) && activePlayer === owner) continue;
    if ((clause.continuous.includes('我方回合中') || clause.continuous.includes('Your Turn')) && activePlayer !== owner) continue;
    if (clause.donGate !== null && (fieldCard.attachedDon ?? 0) < clause.donGate) continue;
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
  const effectKeyZH = fieldTarget != null
    ? `${card.id}_${fieldTarget}_啟動主要`
    : `${card.id}_啟動主要`;
  const effectKeyEN = fieldTarget != null
    ? `${card.id}_${fieldTarget}_Activate: Main`
    : `${card.id}_Activate: Main`;
  if (playerState.effectUsed?.[effectKeyZH] || playerState.effectUsed?.[effectKeyEN])
    return { available: false, hint: 'Already used this turn' };

  const clauses  = parseEffectForCard(card);
  const clause   = clauses.find(c =>
    c.timings.includes('啟動主要') || c.timings.includes('起動メイン') || c.timings.includes('Activate: Main')
  );
  if (!clause) return { available: true, hint: 'Activate effect' };

  if (clause.donGate) {
    const fc = fieldPos && fullState && owner ? getFieldCard(fullState, owner, fieldPos) : null;
    const attached = fc?.attachedDon ?? 0;
    if (attached < clause.donGate)
      return { available: false, hint: `Needs ${clause.donGate} DON!! attached to this card` };
  }

  if (clause.donReturn) {
    const ps = playerState;
    const totalDon = (ps.costArea?.length ?? 0)
      + (ps.leader?.attachedDon ?? 0)
      + (ps.characterArea ?? []).reduce((n, fc) => n + (fc.attachedDon ?? 0), 0);
    if (totalDon < clause.donReturn)
      return { available: false, hint: `Needs ${clause.donReturn} DON!! anywhere (not enough)` };
  }

  if (clause.donRest) {
    const activeDon = (playerState.costArea ?? []).filter(d => d.state === 'active').length;
    if (activeDon < clause.donRest)
      return { available: false, hint: `Needs ${clause.donRest} active DON!! (rest cost)` };
  }

  // REST-based DON!! cost (e.g. "rest N DON!!" as activation cost, separate from donReturn)
  const donRestCost = clause.actions
    .flat()
    .filter(a => a.type === 'REST' && a.filter?.cardType === 'don')
    .reduce((sum, a) => sum + (a.count ?? 1), 0);
  if (donRestCost > 0) {
    const activeDon = (playerState.costArea ?? []).filter(d => d.state === 'active').length;
    if (activeDon < donRestCost)
      return { available: false, hint: `Needs ${donRestCost} active DON!!` };
  }

  if (clause.condition && fullState && owner) {
    const fc = fieldPos ? getFieldCard(fullState, owner, fieldPos) : null;
    if (!evaluateCondition(fullState, owner, clause.condition, fc))
      return { available: false, hint: 'Condition not met' };
  }

  // FLIP_LIFE_FACE_UP precondition: mirrors the guard in resolveAtTiming (line 216).
  // Effect can't activate when life zone is empty or the top card is already face-up.
  if (fullState && owner) {
    const requiresFlipLife = clause.actions.flat().some(a => a.type === 'FLIP_LIFE_FACE_UP');
    if (requiresFlipLife) {
      const ps = fullState[owner];
      const lifeLen = ps?.lifeArea?.length ?? 0;
      const faceUpArr = ps?.lifeAreaFaceUp ?? [];
      if (lifeLen === 0 || faceUpArr[lifeLen - 1])
        return { available: false, hint: 'No face-down life card to flip' };
    }
  }

  // Check hand-discard cost (e.g. "廢棄1張自己的手牌" as activation cost).
  // If the hand can't cover the cost, block activation — otherwise the DISCARD
  // silently no-ops and the AI loops infinitely re-activating the effect.
  const handDiscardCost = clause.actions
    .flat()
    .filter(a => a.type === 'DISCARD' && a.filter?.zone === 'hand' && a.filter?.owner === 'self')
    .reduce((sum, a) => sum + (a.count ?? 1), 0);
  if (handDiscardCost > 0 && (playerState.hand?.length ?? 0) < handDiscardCost)
    return { available: false, hint: `Needs ${handDiscardCost} hand card(s) to discard` };

  const hints = [];
  if (clause.donGate)   hints.push(`Needs ${clause.donGate} DON!! attached`);
  if (clause.donReturn) hints.push(`return ${clause.donReturn} DON!!`);
  if (clause.donRest)   hints.push(`rest ${clause.donRest} DON!!`);
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
function resolveAtTiming(card, state, owner, timing, fieldPos = null, koCard = null) {
  if (!card?.effect) return state;
  const clauses = parseEffectForCard(card);
  let s = state;

  for (let ci = 0; ci < clauses.length; ci++) {
    const clause = clauses[ci];
    if (!timingIncludes(clause.timings, timing)) continue;

    // KO-watch context: koCard is the card that was KO'd.
    // Only fire clauses with a matching koFilter; skip self-KO clauses (no koFilter).
    if (koCard !== null) {
      if (!clause.koFilter) continue;
      if (!matchesFilter(koCard, clause.koFilter, null, koCard.power ?? null)) continue;
    }

    const isActivated = clause.timings.some(t => ACTIVATED_TIMINGS.has(t));
    const fieldCard = fieldPos ? getFieldCard(s, owner, fieldPos) : null;

    // DON!! gate: card must have N DON!! already attached (prerequisite, not a consumed cost)
    if (clause.donGate !== null) {
      if (!fieldCard || fieldCard.attachedDon < clause.donGate) continue;
    }

    // Turn-restricted triggered effects: 【我方回合中】/【對方回合中】 qualifier on a non-activated timing
    if (!isActivated) {
      if (clause.continuous.includes('我方回合中') && s.activePlayer !== owner) continue;
      if (clause.continuous.includes('對方回合中') && s.activePlayer === owner) continue;
    }

    // If effect requires flipping top life face-up, skip when all target positions already face-up or no life
    if (clause.actions.some(a => a.type === 'FLIP_LIFE_FACE_UP')) {
      const ps = s[owner];
      const lifeLen = ps.lifeArea?.length ?? 0;
      if (!lifeLen) continue;
      const faceUpArr = ps.lifeAreaFaceUp ?? [];
      const flipCount = clause.actions.find(a => a.type === 'FLIP_LIFE_FACE_UP')?.count ?? 1;
      const topN = Math.min(flipCount, lifeLen);
      const allAlreadyFaceUp = Array.from({ length: topN }, (_, k) => lifeLen - 1 - k)
        .every(i => faceUpArr[i] === true);
      if (allAlreadyFaceUp) continue;
    }

    // Condition check
    if (clause.condition && !evaluateCondition(s, owner, clause.condition, fieldCard)) continue;

    // Once-per-turn guard — include field position so duplicate copies of the same
    // card each track their own usage independently.
    // For clauses with multiple timings (e.g. "KO時/受到傷害時"), use the first timing
    // as the canonical key so the once-per-turn limit applies across all timings.
    const fieldTarget = fieldPos != null ? fieldPos.target : null;
    const canonicalTiming = clause.timings[0] ?? timing;
    const effectKey = fieldTarget != null
      ? `${card.id}_${fieldTarget}_${canonicalTiming}`
      : `${card.id}_${canonicalTiming}`;
    if (clause.oncePerTurn) {
      if (s[owner]?.effectUsed?.[effectKey]) continue;
      // For optional effects that prompt the human, defer marking until confirmed.
      const willPromptPlayer = (owner === PLAYER.HUMAN || state.pvpMode) && !ACTIVATED_TIMINGS.has(timing)
        && (clause.isOptional || clause.donReturn);
      if (!willPromptPlayer) s = markEffectUsed(s, owner, effectKey);
    }

    // For activated effects (啟動主要) that are not already explicitly oncePerTurn,
    // enforce once-per-activation in the simulation: mark effectUsed so the AI
    // cannot re-activate the same clause within one turn and create infinite loops
    // (e.g. via hand-discard costs that silently no-op, or DRAW effects that
    // keep replenishing the hand).
    if (!clause.oncePerTurn && ACTIVATED_TIMINGS.has(timing)) {
      if (s[owner]?.effectUsed?.[effectKey]) continue;
      s = markEffectUsed(s, owner, effectKey);
    }

    // DON!! return cost
    if (clause.donReturn) {
      // For all non-activated timings, give the human a chance to opt in before
      // paying the cost — 咚‼-N： costs are always optional in OPTC rules.
      if ((owner === PLAYER.HUMAN || state.pvpMode) && !ACTIVATED_TIMINGS.has(timing)) {
        s = {
          ...s,
          pendingEffect: {
            owner,
            sourceCard: card,
            effectKey,
            fieldPos,
            timing,
            markUsedOnConfirm: clause.oncePerTurn,
            action: { type: 'CONFIRM_OPTIONAL_ACTIVATION', donReturn: clause.donReturn },
            continuation: clause.actions.filter(a => a.type !== 'CONFIRM_OPTIONAL_ACTIVATION'),
            choices: {
              type: 'CONFIRM_OPTIONAL_ACTIVATION',
              costDescription: `咚‼ -${clause.donReturn}`,
              clauseRaw: clause.raw ?? '',
              timing,
            },
          },
        };
        break;
      }
      s = returnDon(s, owner, clause.donReturn, card, effectKey, clause.actions, fieldPos);
      if (!s) { s = state; continue; } // can't pay — skip this clause
      if (s.pendingEffect) break;      // human: waiting for selection
    }

    // ②③④ etc. activation cost: rest N DON!! in the cost area (they refresh next turn).
    // Distinct from donReturn (which permanently removes DON from play).
    if (clause.donRest) {
      const activeDon = (s[owner].costArea ?? []).filter(d => d.state === 'active');
      if (activeDon.length < clause.donRest) { s = state; continue; } // can't pay
      const toRestIds = new Set(activeDon.slice(0, clause.donRest).map(d => d._donId));
      s = {
        ...s,
        [owner]: {
          ...s[owner],
          costArea: s[owner].costArea.map(d => toRestIds.has(d._donId) ? { ...d, state: 'rest' } : d),
        },
      };
    }

    // Non-don optional effect (可：…): ask the player before paying the action cost.
    // Falls through so the sibling-folding block below can append subsequent clauses
    // (e.g. EB03-055 clause 2 DECK_TO_LIFE) into the continuation before breaking.
    if (clause.isOptional && !clause.donReturn && (owner === PLAYER.HUMAN || state.pvpMode) && !ACTIVATED_TIMINGS.has(timing)) {
      // Affordability pre-check: if the cost includes a fixed DON!! rest (e.g. ➀) that
      // the player can't pay, skip silently — can't activate without paying the cost.
      const donCostAction = clause.actions.find(
        a => a.type === 'REST' && a.filter?.cardType === 'don' &&
             (!a.filter?.owner || a.filter?.owner === 'self') && a.count !== Infinity
      );
      if (donCostAction) {
        const needed = donCostAction.count ?? 1;
        if ((s[owner].costArea ?? []).filter(d => d.state === 'active').length < needed) continue;
      }
      const costText = (clause.raw ?? '')
        .replace(/【[^】]+】/g, '')
        .replace(/^\//, '')
        .replace(/^可/, '')
        .split('：')[0]
        .trim();
      s = {
        ...s,
        pendingEffect: {
          owner,
          sourceCard: card,
          effectKey,
          fieldPos,
          timing,
          markUsedOnConfirm: clause.oncePerTurn,
          action: { type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription: costText || '可' },
          continuation: clause.actions.filter(a => a.type !== 'CONFIRM_OPTIONAL_ACTIVATION'),
          choices: {
            type: 'CONFIRM_OPTIONAL_ACTIVATION',
            costDescription: costText || '可',
            clauseRaw: clause.raw ?? '',
            timing,
          },
        },
      };
    }

    if (!s.pendingEffect) {
      // AI affordability pre-check: same DON!! cost check that guards the human modal.
      // Without this the REST-don action silently no-ops and the loop continues to the
      // effect body, giving the AI a free activation.
      if (clause.isOptional && !clause.donReturn) {
        const donCostAction = clause.actions.find(
          a => a.type === 'REST' && a.filter?.cardType === 'don' &&
               (!a.filter?.owner || a.filter?.owner === 'self') && a.count !== Infinity
        );
        if (donCostAction) {
          const needed = donCostAction.count ?? 1;
          if ((s[owner].costArea ?? []).filter(d => d.state === 'active').length < needed) continue;
        }
      }
      s = { ...s, _lastDeployedCount: 0 };
      s = executeActionSequence(s, owner, clause.actions, card, effectKey, fieldPos);
    }

    if (s.pendingEffect) {
      // Stamp the timing onto pendingEffect so EffectModal can show the right title.
      if (!s.pendingEffect.timing) {
        s = { ...s, pendingEffect: { ...s.pendingEffect, timing } };
      }
      // Fold remaining sibling clauses into the pendingEffect continuation so they
      // still run after the player resolves this choice.
      // Conditional clauses are wrapped in CONDITIONAL_EXEC so their condition is
      // re-evaluated against the post-resolution state (e.g. after a REST applies).
      const tailActions = [];
      for (let ri = ci + 1; ri < clauses.length; ri++) {
        const rem = clauses[ri];
        if (!timingIncludes(rem.timings, timing)) continue;
        if (rem.condition) {
          tailActions.push({ type: 'CONDITIONAL_EXEC', condition: rem.condition, actions: rem.actions });
        } else {
          tailActions.push(...rem.actions);
        }
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
  if (state[owner]?.onPlayBlocked) return state;

  // Passive leader rule: if the owner's leader has a BLOCK_EFFECT targeting self,
  // all of the owner's own 登場時 effects are suppressed (e.g. OP09-081).
  const leaderCard = state[owner]?.leader?.card;
  if (leaderCard && leaderCard !== card && leaderCard.effect) {
    const leaderClauses = parseEffectForCard(leaderCard);
    if (leaderClauses.some(c =>
      c.actions.some(a => a.type === 'BLOCK_EFFECT' && a.targetOwner === 'self')
    )) return state;
  }

  const ps  = state[owner];
  const idx = ps.characterArea.findIndex(fc => fc.card === card);
  const fieldPos = idx >= 0 ? { target: idx }
    : ps.leader.card === card ? { target: 'leader' }
    : ps.stageArea?.card === card ? { target: 'stage' }
    : null;
  return resolveAtTiming(card, state, owner, '登場時', fieldPos);
}

export function resolveOnAttackEffect(card, state, owner, attackerZone, attackerIndex) {
  const fieldPos = { target: attackerZone === 'leader' ? 'leader' : attackerIndex };
  return resolveAtTiming(card, state, owner, '攻擊時', fieldPos);
}

export function resolveOnOpponentAttackEffect(card, state, owner, fieldPos = { target: 'leader' }) {
  return resolveAtTiming(card, state, owner, '對方攻擊時', fieldPos);
}

export function resolveOnBlockEffect(card, state, owner, blockerIndex) {
  return resolveAtTiming(card, state, owner, '防禦時', { target: blockerIndex });
}

export function resolveActivatedMainEffect(card, state, owner, zone, index) {
  const fieldPos = { target: zone === 'leader' ? 'leader' : zone === 'stage' ? 'stage' : index };
  let s = resolveAtTiming(card, state, owner, '啟動主要', fieldPos);
  if (s === state) s = resolveAtTiming(card, state, owner, '起動メイン', fieldPos);
  if (s === state) s = resolveAtTiming(card, state, owner, 'Activate: Main', fieldPos);
  return s;
}

// Fire the non-deployer player's leader "對手角色登場時" clauses after the opponent deploys a character.
// deployOwner: the player who just deployed; isViaCharEffect: true when deployed via a character card's effect.
export function resolveOnOpponentCharDeployEffect(deployedCard, state, deployOwner, isViaCharEffect) {
  const reactor = deployOwner === PLAYER.HUMAN ? PLAYER.AI : PLAYER.HUMAN;
  const leader = state[reactor]?.leader;
  if (!leader?.card?.effect) return state;

  const clauses = parseEffectForCard(leader.card);
  let s = state;

  for (const clause of clauses) {
    if (!clause.timings.includes('對手角色登場時')) continue;

    // Check the deploy trigger condition: cost threshold OR deployed via character effect
    const tc = clause.oppDeployTriggerCond;
    if (tc) {
      const costOk = tc.costMin !== undefined && (deployedCard.cost ?? 0) >= tc.costMin;
      const effOk  = tc.orViaCharEffect && isViaCharEffect;
      if (!costOk && !effOk) continue;
    }

    const effectKey = `${leader.card.id}_leader_對手角色登場時`;
    if (clause.oncePerTurn && s[reactor]?.effectUsed?.[effectKey]) continue;

    // Optional (可以發動): prompt the human reactor; AI always activates
    if (clause.isOptional && (reactor === PLAYER.HUMAN || s.pvpMode)) {
      if (clause.oncePerTurn) s = markEffectUsed(s, reactor, effectKey);
      return {
        ...s,
        pendingEffect: {
          owner: reactor,
          sourceCard: leader.card,
          effectKey,
          fieldPos: { target: 'leader' },
          timing: '對手角色登場時',
          markUsedOnConfirm: false,
          action: { type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription: '可' },
          continuation: clause.actions,
          choices: {
            type: 'CONFIRM_OPTIONAL_ACTIVATION',
            costDescription: '可',
            clauseRaw: clause.raw ?? '',
            timing: '對手角色登場時',
          },
        },
      };
    }

    // AI reactor or mandatory: execute immediately
    if (clause.oncePerTurn) s = markEffectUsed(s, reactor, effectKey);
    s = executeActionSequence(s, reactor, clause.actions, leader.card, effectKey, { target: 'leader' });
    if (s.pendingEffect) break;
  }

  return s;
}

export function resolveOnKOEffect(card, state, owner) {
  return resolveAtTiming(card, state, owner, 'KO時');
}

// Fire KO-replacement effects on the owner's leader BEFORE a character is KO'd.
// Uses timing "KO替換時" so it doesn't interfere with post-KO watch effects.
// e.g. OP12-061: "when your 「托拉法爾加・羅」 is about to be KO'd, you can add 1 life to hand instead"
export function resolveLeaderKOReplacementEffect(koCard, state, owner, koCardIndex = null) {
  const leader = state[owner]?.leader;
  if (!leader?.card?.effect) return state;
  const clauses = parseEffectForCard(leader.card);

  // Explicit KO替換時 timing (e.g. OP14-016)
  if (clauses.some(c => c.timings.includes('KO替換時') && c.koFilter && matchesFilter(koCard, c.koFilter))) {
    return resolveAtTiming(leader.card, state, owner, 'KO替換時', { target: 'leader' }, koCard);
  }

  // Opponent-turn passive replacement: isReplacement + continuous["對方回合中"] + power condition
  // e.g. OP05-001 Sabo: "if your character with 5000+ power would be KO'd, may give it -1000 instead"
  if (koCardIndex !== null && state.activePlayer !== owner) {
    for (const clause of clauses) {
      if (!clause.isReplacement || !clause.continuous.includes('對方回合中')) continue;
      if (!clause.condition) continue;
      const cond = clause.condition;
      if (cond.subject !== 'characters') continue;
      if (cond.power !== undefined) {
        const koPow = koCard.power ?? 0;
        const met = cond.powerOp === 'gte' ? koPow >= cond.power
                  : cond.powerOp === 'lte' ? koPow <= cond.power
                  : koPow === cond.power;
        if (!met) continue;
      }
      const effectKey = `${leader.card.id}_leader_KO替換時`;
      if (clause.oncePerTurn && state[owner]?.effectUsed?.[effectKey]) continue;
      if (clause.donGate !== null && (leader.attachedDon ?? 0) < clause.donGate) continue;

      const effectActions = clause.actions.filter(a => a.type !== 'CONFIRM_OPTIONAL_ACTIVATION');
      const koFieldPos = { target: koCardIndex };

      if (owner === PLAYER.HUMAN || state.pvpMode) {
        const costText = (clause.raw ?? '').replace(/【[^】]+】/g, '').replace(/^可/, '').split('：')[0].trim();
        return {
          ...state,
          waitingFor: owner,
          pendingEffect: {
            owner,
            sourceCard: leader.card,
            effectKey,
            fieldPos: koFieldPos,
            markUsedOnConfirm: clause.oncePerTurn,
            action: { type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription: costText },
            continuation: effectActions,
            choices: { type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription: costText, clauseRaw: clause.raw ?? '' },
          },
        };
      }

      // AI: auto-execute
      let s = clause.oncePerTurn ? markEffectUsed(state, owner, effectKey) : { ...state };
      s = executeActionSequence(s, owner, effectActions, leader.card, effectKey, koFieldPos);
      return { ...s, leaderKOPreventionApplied: true };
    }
  }

  return state;
}

// Fire 自己角色效果離場時 on the owner's leader when a character is removed from
// the field by an effect (KO or RETURN_HAND) during their own turn.
export function resolveLeaderOwnCharRemovedEffect(state, owner) {
  if (state.activePlayer !== owner) return state;
  const leader = state[owner]?.leader;
  if (!leader?.card?.effect) return state;
  return resolveAtTiming(leader.card, state, owner, '自己角色效果離場時', { target: 'leader' });
}

// Fire a character's own 離場時 replacement before it leaves the field (KO, bounce, add-to-life, etc.).
// Returns the pre-removal state with pendingEffect set (human must confirm), or with the cost
// already paid (AI auto-resolved). Caller detects success by checking pendingEffect or hand length.
export function resolveCharacterLeaveFieldEffect(card, fieldPos, state, owner) {
  if (!card?.effect) return state;
  const clauses = parseEffectForCard(card);
  const clause = clauses.find(c => c.timings.includes('離場時') && c.isReplacement);
  if (!clause) return state;

  const effectKey = fieldPos?.target != null
    ? `${card.id}_${fieldPos.target}_離場時`
    : `${card.id}_離場時`;

  if (state[owner]?.effectUsed?.[effectKey]) return state;
  if (clause.condition && !evaluateCondition(state, owner, clause.condition)) return state;

  if (owner === PLAYER.HUMAN || state.pvpMode) {
    const costDescription = '廢棄1張手牌';
    return {
      ...state,
      waitingFor: owner,
      pendingEffect: {
        owner,
        sourceCard: card,
        effectKey,
        fieldPos,
        markUsedOnConfirm: clause.oncePerTurn,
        action: { type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription },
        continuation: clause.actions,
        choices: { type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription, costDescriptionEn: 'Discard 1 hand card' },
      },
    };
  }

  // AI: auto-execute the cost actions; caller checks hand length to detect success
  const result = executeActionSequence(state, owner, clause.actions, card, effectKey, fieldPos);
  if (result === state) return state;
  return clause.oncePerTurn ? markEffectUsed(result, owner, effectKey) : result;
}

// Fire KO-watch effects on the owner's leader when a character is KO'd.
// koWatchOwner: 'self' = only clauses watching own chars, 'opponent' = only clauses watching opponent chars, null = any (default).
// e.g. OP14-041: "when your 《九蛇海賊團》 character with power 5000+ is KO'd, ..."
// e.g. OP03-076: "when opponent's character is KO'd during your turn, unrest this leader"
export function resolveLeaderKOWatchEffect(koCard, state, owner, koWatchOwner = null) {
  const ps = state[owner];
  const leader = ps.leader;
  if (!leader?.card?.effect) return state;
  const clauses = parseEffectForCard(leader.card);
  const hasRelevant = clauses.some(c => {
    if (!c.timings.includes('KO時') || !c.koFilter) return false;
    if (koWatchOwner === 'opponent' && c.koFilter?.owner !== 'opponent') return false;
    if (koWatchOwner === 'self' && c.koFilter?.owner === 'opponent') return false;
    // Respect continuous constraints.
    const opponentTurnOnly = c.continuous.includes('對方回合中') || c.continuous.includes("Opponent's Turn");
    if (opponentTurnOnly && state.activePlayer === owner) return false;
    const ourTurnOnly = c.continuous.includes('我方回合中') || c.continuous.includes("Your Turn");
    if (ourTurnOnly && state.activePlayer !== owner) return false;
    return true;
  });
  if (!hasRelevant) return state;
  return resolveAtTiming(leader.card, state, owner, 'KO時', { target: 'leader' }, koCard);
}

// Fire KO-watch effects on the watcher's field characters when the opponent's character is KO'd.
// Also fires the watcher's leader if it has an opponent-KO-watch clause (e.g. OP01-061 Kaido).
export function resolveOpponentKOWatchEffect(koCard, state, watcherOwner) {
  const ps = state[watcherOwner];
  let s = state;

  // Check leader for opponent-KO watch effects
  if (ps.leader?.card?.effect) {
    const leaderClauses = parseEffectForCard(ps.leader.card);
    const hasLeaderWatch = leaderClauses.some(c => {
      if (!c.timings.includes('KO時') || c.koFilter?.owner !== 'opponent' || c.isReplacement) return false;
      const ourTurnOnly = c.continuous.includes('我方回合中') || c.continuous.includes("Your Turn");
      if (ourTurnOnly && s.activePlayer !== watcherOwner) return false;
      const oppTurnOnly = c.continuous.includes('對方回合中') || c.continuous.includes("Opponent's Turn");
      if (oppTurnOnly && s.activePlayer === watcherOwner) return false;
      return true;
    });
    if (hasLeaderWatch) {
      s = resolveAtTiming(ps.leader.card, s, watcherOwner, 'KO時', { target: 'leader' }, koCard);
      if (s.pendingEffect || s.pendingReplace) return s;
    }
  }

  for (let i = 0; i < ps.characterArea.length; i++) {
    const fc = ps.characterArea[i];
    if (!fc?.card?.effect) continue;
    const clauses = parseEffectForCard(fc.card);
    if (!clauses.some(c => c.timings.includes('KO時') && c.koFilter?.owner === 'opponent' && !c.isReplacement)) continue;
    s = resolveAtTiming(fc.card, s, watcherOwner, 'KO時', { target: i }, koCard);
    if (s.pendingEffect || s.pendingReplace) break;
  }
  return s;
}

// Fire 受到傷害時 effects on the defending leader when a life card is taken as damage.
// Also fires the KO-watch half of dual "受到傷害時或...KO時" clauses via the shared timing.
export function resolveOnDamageTakenEffect(leaderCard, state, owner) {
  return resolveAtTiming(leaderCard, state, owner, '受到傷害時', { target: 'leader' });
}

// Fire 造成傷害時 effects on the attacking card when its attack successfully deals life damage.
// card may be the leader or a character; fieldPos identifies the attacker's slot.
export function resolveOnDealDamageEffect(card, state, owner, zone, index) {
  const fieldPos = { target: zone === 'leader' ? 'leader' : index };
  return resolveAtTiming(card, state, owner, '造成傷害時', fieldPos);
}

export function resolveOnLifeZeroEffect(card, state, owner) {
  return resolveAtTiming(card, state, owner, '生命值卡變成0張時', { target: 'leader' });
}

export function resolveTriggerEffect(card, state, owner) {
  if (card?.trigger) {
    return resolveAtTiming({ ...card, effect: card.trigger, _originalCard: card }, state, owner, '觸發器');
  }
  return resolveAtTiming(card, state, owner, '觸發器');
}

export function resolveEventEffect(card, state, owner) {
  if (!card?.effect) return state;
  const clauses = parseEffectForCard(card);
  let s = state;

  for (const clause of clauses) {
    // Events fire all non-passive, non-continuous clauses except 反擊 (counter-step only)
    const isAuto       = clause.timings.some(t => ['登場時','KO時','攻擊時','對方攻擊時','防禦時','我方回合結束時','觸發器','On Play','On K.O.','When Attacking',"On Your Opponent's Attack",'On Block','End of Your Turn','Trigger'].includes(t));
    const isContinuous = clause.continuous.length > 0 || clause.passive.length > 0;
    // Skip counter-only clauses (主要/反擊 dual-timing clauses still fire here)
    const isCounter    = (clause.timings.includes('反擊') || clause.timings.includes('Counter')) && !clause.timings.includes('主要') && !clause.timings.includes('Main');
    // Skip pre-play self cost reduction clauses (already evaluated by getSelfCondHandCostDelta before charging DON!!)
    const isSelfHandCost = !clause.timings.length && clause.actions.every(
      a => a.type === 'COST_MOD' && a.until === 'continuous' && a.filter?.self
    );
    if (isAuto || isContinuous || isCounter || isSelfHandCost) continue;

    if (clause.condition && !evaluateCondition(s, owner, clause.condition)) continue;

    const effectKey = `${card.id}_event`;

    if (clause.donReturn) {
      s = returnDon(s, owner, clause.donReturn, card, effectKey, clause.actions, null);
      if (!s) { s = state; continue; }
      if (s.pendingEffect) break;
    }

    if (!s.pendingEffect) {
      s = executeActionSequence(s, owner, clause.actions, card, effectKey);
    }
    if (s.pendingEffect) break;
  }
  return s;
}

// Fire 「對手發動事件卡或【防禦】時」 on all of owner's field cards that have this timing.
// Called when the opponent (non-owner) plays an event card or uses a blocker.
// Cumulative within a turn: each trigger invocation fires independently.
export function resolveOpponentEventOrCounterEffect(state, owner) {
  const TIMING = '對手發動事件卡或防禦時';
  const ps = state[owner];
  let s = state;

  if (ps.leader?.card?.effect?.includes('對手發動事件卡或')) {
    s = resolveAtTiming(ps.leader.card, s, owner, TIMING, { target: 'leader' });
    if (s.pendingEffect) return s;
  }

  for (let i = 0; i < (ps.characterArea?.length ?? 0); i++) {
    const fc = ps.characterArea[i];
    if (!fc?.card?.effect?.includes('對手發動事件卡或')) continue;
    s = resolveAtTiming(fc.card, s, owner, TIMING, { target: i });
    if (s.pendingEffect) break;
  }

  return s;
}

// Fire 「自己發動事件卡時」 on the event-activating player's leader and field cards.
// Respects continuous: ['對方回合中'] — only fires when it's the opponent's turn (activePlayer !== owner).
export function resolveSelfEventActivateEffect(state, owner) {
  const TIMING = '自己發動事件卡時';
  const ps = state[owner];
  let s = state;

  const checkCard = (card, fieldPos) => {
    if (!card?.effect?.includes('發動事件卡')) return s;
    const clauses = parseEffectForCard(card);
    for (const clause of clauses) {
      if (!clause.timings.includes(TIMING)) continue;
      // Skip if restricted to opponent's turn but it's currently owner's turn
      const opponentTurnOnly = clause.continuous.includes('對方回合中') || clause.continuous.includes("Opponent's Turn");
      if (opponentTurnOnly && s.activePlayer === owner) continue;
      s = resolveAtTiming(card, s, owner, TIMING, fieldPos);
      if (s.pendingEffect) return s;
    }
    return s;
  };

  s = checkCard(ps.leader?.card, { target: 'leader' });
  if (s.pendingEffect) return s;

  for (let i = 0; i < (ps.characterArea?.length ?? 0); i++) {
    const fc = ps.characterArea[i];
    if (!fc?.card) continue;
    s = checkCard(fc.card, { target: i });
    if (s.pendingEffect) break;
  }

  return s;
}

// Fire '咚‼附加時' on the active player's leader when a DON!! is attached to any friendly card.
// Applies only during the owner's turn (continuous '我方回合中' is guaranteed by call site).
export function resolveOnDonAttachTrigger(state, owner) {
  const leader = state[owner]?.leader;
  if (!leader?.card?.effect) return state;
  return resolveAtTiming(leader.card, state, owner, '咚‼附加時', { target: 'leader' });
}

// Fire '自己使無效果角色卡登場時' on the deploying player's leader when they deploy a character
// that has no base effect text (原本沒有效果).
export function resolveOnSelfNoEffectCharDeployEffect(deployedCard, state, owner) {
  const effect = deployedCard?.effect;
  if (effect && effect.trim() !== '' && effect.trim() !== '-') return state;
  const leader = state[owner]?.leader;
  if (!leader?.card?.effect) return state;
  return resolveAtTiming(leader.card, state, owner, '自己使無效果角色卡登場時', { target: 'leader' });
}

// Fire '自己角色登場時' on the deploying player's leader when they deploy any character.
// Respects continuous: ['對方回合中'] — only fires when it's the opponent's turn (activePlayer !== owner).
export function resolveOnSelfAnyCharDeployEffect(deployedCard, state, owner) {
  const TIMING = '自己角色登場時';
  const leader = state[owner]?.leader;
  if (!leader?.card?.effect) return state;
  const clauses = parseEffectForCard(leader.card);
  let s = state;
  for (const clause of clauses) {
    if (!clause.timings.includes(TIMING)) continue;
    const opponentTurnOnly = clause.continuous.includes('對方回合中') || clause.continuous.includes("Opponent's Turn");
    if (opponentTurnOnly && s.activePlayer === owner) continue;
    const ourTurnOnly = clause.continuous.includes('我方回合中') || clause.continuous.includes("Your Turn");
    if (ourTurnOnly && s.activePlayer !== owner) continue;
    s = resolveAtTiming(leader.card, s, owner, TIMING, { target: 'leader' });
    if (s.pendingEffect) break;
  }
  return s;
}

// Fire '咚‼卡被放回時' on the active player's leader when DON!! cards are returned to the deck.
// Called from applyRefresh (attached DON!! returned) and after donReturn cost payments.
export function resolveOnDonReturnTrigger(state, owner) {
  const leader = state[owner]?.leader;
  if (!leader?.card?.effect) return state;
  return resolveAtTiming(leader.card, state, owner, '咚‼卡被放回時', { target: 'leader' });
}

export function resolveCounterEffect(card, state, owner) {
  if (!card?.effect) return state;
  const clauses = parseEffectForCard(card);
  let s = state;
  for (const clause of clauses) {
    if (!clause.timings.includes('反擊') && !clause.timings.includes('Counter')) continue;
    if (clause.condition && !evaluateCondition(s, owner, clause.condition)) continue;
    const effectKey = `${card.id}_counter`;
    s = executeActionSequence(s, owner, clause.actions, card, effectKey);
    if (s.pendingEffect) break;
  }
  return s;
}

// ─── EOT effect ordering helpers ─────────────────────────────────────────────

function getEotSources(state, owner) {
  const ps = state[owner];
  const sources = [];
  const hasEot = (card) => {
    if (!card?.effect) return false;
    return parseEffectForCard(card).some(cl => timingIncludes(cl.timings, '我方回合結束時'));
  };
  if (hasEot(ps.leader?.card)) sources.push({ target: 'leader', card: ps.leader.card });
  for (let i = 0; i < ps.characterArea.length; i++) {
    if (hasEot(ps.characterArea[i]?.card)) sources.push({ target: i, card: ps.characterArea[i].card });
  }
  if (ps.stageArea && hasEot(ps.stageArea.card)) sources.push({ target: 'stage', card: ps.stageArea.card });
  return sources;
}

function makeEotOrderPending(state, owner, sources) {
  return {
    ...state,
    pendingEffect: {
      owner,
      sourceCard: sources[0].card,
      effectKey: '__eot_order__',
      action: { type: 'CHOOSE_EOT_EFFECT_ORDER' },
      continuation: [],
      choices: { type: 'CHOOSE_EOT_EFFECT_ORDER', sources },
      fieldPos: null,
    },
  };
}

export function resolveEotEffectChoice(state, pickedIndex) {
  const pe = state.pendingEffect;
  if (!pe || pe.choices?.type !== 'CHOOSE_EOT_EFFECT_ORDER') return state;

  const { owner, choices } = pe;
  const { sources } = choices;
  const picked = sources[pickedIndex];
  if (!picked) return state;
  const rest = sources.filter((_, i) => i !== pickedIndex);

  let s = { ...state, pendingEffect: null };
  if (rest.length > 0) s = { ...s, pendingEotSources: { owner, remaining: rest } };

  s = resolveAtTiming(picked.card, s, owner, '我方回合結束時', { target: picked.target });

  if (!s.pendingEffect && s.pendingEotSources?.remaining?.length) s = resumeEotSequence(s);

  return s;
}

export function resumeEotSequence(state) {
  const peos = state.pendingEotSources;
  if (!peos || !peos.remaining.length) return { ...state, pendingEotSources: null };

  const { owner, remaining } = peos;
  const s = { ...state, pendingEotSources: null };

  if (remaining.length === 1) {
    return resolveAtTiming(remaining[0].card, s, owner, '我方回合結束時', { target: remaining[0].target });
  }

  return makeEotOrderPending(s, owner, remaining);
}

export function resolveOnTurnStartEffects(state, owner) {
  const ps = state[owner];
  let s = state;
  s = resolveAtTiming(ps.leader.card, s, owner, '我方回合開始時', { target: 'leader' });
  if (s.pendingEffect) return s;
  for (let i = 0; i < ps.characterArea.length; i++) {
    if (s.pendingEffect) break;
    s = resolveAtTiming(s[owner].characterArea[i]?.card, s, owner, '我方回合開始時', { target: i });
  }
  if (!s.pendingEffect && ps.stageArea) {
    s = resolveAtTiming(ps.stageArea.card, s, owner, '我方回合開始時', { target: 'stage' });
  }
  return s;
}

export function resolveEndOfTurnEffects(state, owner) {
  let s = state;

  // Consume any deferred end-of-turn DON!! activation (e.g. OP14-031 "這回合結束時").
  if (s[owner].pendingDonUnrestEot) {
    const count = s[owner].pendingDonUnrestEot;
    s = { ...s, [owner]: { ...s[owner], pendingDonUnrestEot: 0 } };
    const restDons = s[owner].costArea.filter(d => d.state === 'rest');
    if (restDons.length) {
      const toActivate = restDons.slice(0, count);
      const activateIds = new Set(toActivate.map(d => d._donId));
      s = addLog({
        ...s,
        [owner]: { ...s[owner], costArea: s[owner].costArea.map(d => activateIds.has(d._donId) ? { ...d, state: 'active' } : d) },
      }, `End of turn: activated ${toActivate.length} DON!!.`, 'action');
    }
  }

  // Return any characters flagged willBottomDeckAtEndOfTurn to the bottom of the deck.
  const returners = s[owner].characterArea.filter(fc => fc.willBottomDeckAtEndOfTurn);
  if (returners.length) {
    const returnedDon = returners.flatMap(fc =>
      Array.from({ length: fc.attachedDon }, (_, i) =>
        ({ _donId: `eot-don-${i}-${Math.random()}`, state: 'rest' })
      )
    );
    s = {
      ...s,
      [owner]: {
        ...s[owner],
        characterArea: s[owner].characterArea.filter(fc => !fc.willBottomDeckAtEndOfTurn),
        deck: [...returners.map(fc => fc.card), ...s[owner].deck],
        costArea: [...s[owner].costArea, ...returnedDon],
      },
    };
    for (const fc of returners) {
      s = addLog(s, `${cn(fc.card)} returned to bottom of deck.`, 'action');
    }
  }

  // If the human player has 2+ EOT effect sources, prompt for trigger order.
  if (owner === PLAYER.HUMAN || state.pvpMode) {
    const sources = getEotSources(s, owner);
    if (sources.length >= 2) return makeEotOrderPending(s, owner, sources);
  }

  const ps = s[owner];
  s = resolveAtTiming(ps.leader.card, s, owner, '我方回合結束時', { target: 'leader' });
  for (let i = 0; i < ps.characterArea.length; i++) {
    if (s.pendingEffect) break;
    s = resolveAtTiming(s[owner].characterArea[i]?.card, s, owner, '我方回合結束時', { target: i });
  }
  if (!s.pendingEffect && ps.stageArea) {
    s = resolveAtTiming(ps.stageArea.card, s, owner, '我方回合結束時', { target: 'stage' });
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
  'On Play','On K.O.','When Attacking','On Your Opponent\'s Attack','On Block','End of Your Turn',
  'Trigger','Activate: Main','Main','Counter',
]);

export function evaluateContinuousPower(fieldCard, activePlayer, owner, state) {
  if (!fieldCard?.card?.effect) return 0;
  const clauses = parseEffectForCard(fieldCard.card);
  let bonus = 0;

  for (const clause of clauses) {
    if (clause.timings.some(t => AUTO_TIMINGS.has(t)) || clause.passive.length > 0) continue;
    if (clause.isReplacement) continue; // replacement/substitution effects are not continuous power modifiers

    if ((clause.continuous.includes('對方回合中') || clause.continuous.includes("Opponent's Turn")) && activePlayer === owner) continue;
    if ((clause.continuous.includes('我方回合中') || clause.continuous.includes('Your Turn')) && activePlayer !== owner) continue;

    // DON!! gate: check against this card's attached DON!!
    if (clause.donGate !== null && (fieldCard.attachedDon ?? 0) < clause.donGate) continue;

    if (clause.condition && !evaluateCondition(state, owner, clause.condition)) continue;

    for (const action of clause.actions) {
      if (action.type === 'POWER_MOD' && action.filter?.self) {
        if (action.perTrashCount) {
          const trashSize = state?.[owner]?.trash?.length ?? 0;
          bonus += Math.floor(trashSize / action.perTrashCount) * action.delta;
        } else {
          bonus += action.delta;
        }
      } else if (action.type === 'POWER_PER_DON_RESTED' && action.filter?.self) {
        const restedDon = (state?.[owner]?.costArea ?? []).filter(d => d.state === 'rest').length;
        bonus += Math.floor(restedDon / action.perCount) * action.delta;
      } else if (
        action.type === 'POWER_MOD' &&
        action.until === 'continuous' &&
        action.filter?.includesLeader &&
        fieldCard.card?.category === 'Leader' &&
        matchesFilter(fieldCard.card, action.filter, fieldCard)
      ) {
        // Board-wide "leader + all characters" effect on the leader itself.
        // evaluateGlobalContinuousPower skips source === target (leader→leader),
        // so the leader must claim its own portion of the bonus here.
        // matchesFilter ensures the leader's name/trait/etc. actually matches the filter.
        bonus += action.delta;
      }
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
    const clauses = parseEffectForCard(srcFC.card);

    for (const clause of clauses) {
      if (clause.timings.some(t => AUTO_TIMINGS.has(t)) || clause.passive.length > 0) continue;

      if ((clause.continuous.includes('對方回合中') || clause.continuous.includes("Opponent's Turn")) && activePlayer === owner) continue;
      if ((clause.continuous.includes('我方回合中') || clause.continuous.includes('Your Turn')) && activePlayer !== owner) continue;

      // DON!! gate: check against the source card's attached DON!!
      if (clause.donGate !== null && (srcFC.attachedDon ?? 0) < clause.donGate) continue;

      if (clause.condition && !evaluateCondition(state, owner, clause.condition)) continue;

      for (const action of clause.actions) {
        if (action.type !== 'POWER_MOD' || action.until !== 'continuous') continue;
        if (action.filter?.self) continue; // self-targeting handled by evaluateContinuousPower
        if (action.filter?.owner === 'opponent') continue; // cross-side effects handled by the loop below
        if (matchesFilter(targetFC.card, action.filter, targetFC)) bonus += action.delta;
      }
    }
  }

  // Also check the other player's sources for cross-side continuous effects
  // (e.g. leader with "opponent's characters get -2000 during opponent's turn")
  const srcOwner = owner === PLAYER.HUMAN ? PLAYER.AI : PLAYER.HUMAN;
  const otherPs = state[srcOwner];
  const otherSources = [otherPs?.leader, ...(otherPs?.characterArea ?? [])];
  for (const srcFC of otherSources) {
    if (!srcFC?.card?.effect) continue;
    const clauses = parseEffectForCard(srcFC.card);
    for (const clause of clauses) {
      if (clause.timings.some(t => AUTO_TIMINGS.has(t)) || clause.passive.length > 0) continue;
      if ((clause.continuous.includes('對方回合中') || clause.continuous.includes("Opponent's Turn")) && activePlayer === srcOwner) continue;
      if ((clause.continuous.includes('我方回合中') || clause.continuous.includes('Your Turn')) && activePlayer !== srcOwner) continue;
      if (clause.donGate !== null && (srcFC.attachedDon ?? 0) < clause.donGate) continue;
      if (clause.condition && !evaluateCondition(state, srcOwner, clause.condition)) continue;
      for (const action of clause.actions) {
        if (action.type !== 'POWER_MOD' || action.until !== 'continuous') continue;
        if (action.filter?.owner !== 'opponent') continue; // only effects targeting the other side
        if (matchesFilter(targetFC.card, action.filter, targetFC)) bonus += action.delta;
      }
    }
  }

  return bonus;
}

/**
 * Returns keywords granted to targetFC by OTHER field cards' continuous effects
 * (e.g. "all your 「X」 characters gain 【Double Attack】").
 */
export function evaluateExternalContinuousKeywords(targetFC, activePlayer, owner, state) {
  if (!state) return new Set();
  const ps = state[owner];
  const keywords = new Set();
  const sources = [ps.leader, ...(ps.characterArea ?? [])];
  for (const srcFC of sources) {
    if (!srcFC?.card?.effect || srcFC === targetFC) continue;
    const clauses = parseEffectForCard(srcFC.card);
    for (const clause of clauses) {
      if (clause.timings.some(t => AUTO_TIMINGS.has(t)) || clause.passive.length > 0) continue;
      if ((clause.continuous.includes('對方回合中') || clause.continuous.includes("Opponent's Turn")) && activePlayer === owner) continue;
      if ((clause.continuous.includes('我方回合中') || clause.continuous.includes('Your Turn')) && activePlayer !== owner) continue;
      if (clause.condition && !evaluateCondition(state, owner, clause.condition)) continue;
      for (const action of clause.actions) {
        if (action.type !== 'GRANT_KEYWORD' || action.filter?.self) continue;
        if (matchesFilter(targetFC.card, action.filter, targetFC)) keywords.add(action.keyword);
      }
    }
  }
  return keywords;
}

/**
 * Returns a base power override for a leader card if any character card's
 * continuous SET_BASE_POWER effect applies (e.g. EB04-003).
 * Returns null when no override is active.
 */
export function evaluateLeaderBasePowerOverride(leaderFC, activePlayer, owner, state) {
  if (!state) return null;
  const ps = state[owner];
  let override = null;

  for (const srcFC of ps.characterArea ?? []) {
    if (!srcFC?.card?.effect) continue;
    const clauses = parseEffectForCard(srcFC.card);
    for (const clause of clauses) {
      if (clause.timings.some(t => AUTO_TIMINGS.has(t)) || clause.passive.length > 0) continue;
      if ((clause.continuous.includes('對方回合中') || clause.continuous.includes("Opponent's Turn")) && activePlayer === owner) continue;
      if ((clause.continuous.includes('我方回合中') || clause.continuous.includes('Your Turn')) && activePlayer !== owner) continue;
      if (clause.donGate !== null && (srcFC.attachedDon ?? 0) < clause.donGate) continue;
      if (clause.condition && !evaluateCondition(state, owner, clause.condition)) continue;
      for (const action of clause.actions) {
        if (action.type !== 'SET_BASE_POWER') continue;
        if (action.filter?.self) continue; // self-targeting means "this character", not the leader
        if (action.opponentTurnOnly && activePlayer === owner) continue;
        if (matchesFilter(leaderFC.card, action.filter)) override = action.value;
      }
    }
  }
  return override;
}

/**
 * Returns a base power override for a character card if any field card's
 * continuous SET_BASE_POWER effect (category: Character) applies (e.g. OP13-084).
 * Returns null when no override is active.
 */
export function evaluateCharBasePowerOverride(targetFC, activePlayer, owner, state) {
  if (!state) return null;
  const ps = state[owner];
  let override = null;

  const sources = [ps.leader, ...(ps.characterArea ?? [])];
  for (const srcFC of sources) {
    if (!srcFC?.card?.effect) continue;
    const clauses = parseEffectForCard(srcFC.card);
    for (const clause of clauses) {
      if (clause.timings.some(t => AUTO_TIMINGS.has(t)) || clause.passive.length > 0) continue;
      if ((clause.continuous.includes('對方回合中') || clause.continuous.includes("Opponent's Turn")) && activePlayer === owner) continue;
      if ((clause.continuous.includes('我方回合中') || clause.continuous.includes('Your Turn')) && activePlayer !== owner) continue;
      if (clause.donGate !== null && (srcFC.attachedDon ?? 0) < clause.donGate) continue;
      if (clause.condition && !evaluateCondition(state, owner, clause.condition)) continue;
      for (const action of clause.actions) {
        if (action.type === 'SET_BASE_POWER') {
          if (action.filter?.self) {
            if (srcFC === targetFC) override = action.value;
          } else if (action.filter?.category === 'Character' && matchesFilter(targetFC.card, action.filter)) {
            override = action.value;
          }
        } else if (action.type === 'COPY_POWER_FROM_LEADER' && action.filter?.self && srcFC === targetFC) {
          const leaderCard = action.source === 'opponentLeader'
            ? state[owner === 'p1' ? 'p2' : 'p1']?.leader?.card
            : ps.leader?.card;
          if (leaderCard) override = leaderCard.power ?? 0;
        }
      }
    }
  }
  return override;
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
    ? cn(ps.leader.card)
    : cn(ps.characterArea[fieldPos.target]?.card);

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

/**
 * Called at the end of a character-vs-character battle (both survived, i.e. attack failed).
 * If the participating character (fc) has AUTO_KO_IN_BATTLE with DON!! gate met,
 * offer the human player the optional choice to K.O. the opponent's character (and self-KO).
 * AI always skips to avoid self-KO.
 */
export function resolveAutoKOInBattle(fc, fcIndex, state, owner, targetOwner, targetIndex) {
  const card = fc?.card;
  if (!card?.effect) return state;

  const clauses = parseEffectForCard(card);
  const clause = clauses.find(c =>
    c.actions.some(a => a.type === 'GRANT_KEYWORD' && a.keyword === 'AUTO_KO_IN_BATTLE') &&
    (c.donGate === null || (fc.attachedDon ?? 0) >= c.donGate)
  );
  if (!clause) return state;

  const targetPS = state[targetOwner];
  const targetFC = targetPS?.characterArea[targetIndex];
  if (!targetFC) return state;

  const effectKey = `${card.id}_${fcIndex}_AUTO_KO_IN_BATTLE`;
  if (state[owner]?.effectUsed?.[effectKey]) return state;

  if (owner === PLAYER.HUMAN || state.pvpMode) {
    return {
      ...state,
      waitingFor: owner,
      pendingEffect: {
        owner,
        sourceCard: card,
        effectKey,
        fieldPos: { target: fcIndex },
        action: { type: 'CHOOSE_AUTO_KO_IN_BATTLE' },
        continuation: [],
        choices: {
          type: 'CHOOSE_AUTO_KO_IN_BATTLE',
          targetOwner,
          targetIndex,
          targetCard: targetFC.card,
          selfIndex: fcIndex,
        },
      },
    };
  }

  // AI: skip — don't self-KO
  return state;
}

// Returns new state (human → pendingEffect, AI → reduced) or null when unpayable.
function returnDon(state, owner, count, card, effectKey, continuation, fieldPos = null) {
  const ps   = state[owner];
  const opts = buildDonReturnOptions(ps);
  if (opts.length < count) return null;

  if (owner === PLAYER.HUMAN || state.pvpMode) {
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
  const afterReturn = applyDonReturnSelection(state, owner, autoSelectDon(opts, count, ps));
  return resolveOnDonReturnTrigger(afterReturn, owner);
}
