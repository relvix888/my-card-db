// Keyword detection helpers and effect resolvers.
// Keyword detectors read card.effect text (fast string checks, no parsing).
// Resolvers use effectParser + effectActions for full structured execution.

import { PLAYER } from './constants';
import { parseEffect } from './effectParser';
import { evaluateCondition, executeActionSequence, applyDonReturnSelection, matchesFilter } from './effectActions';

function addLog(state, text, type = 'info') {
  return { ...state, log: [...(state.log ?? []), { text, type, id: Date.now() + Math.random() }] };
}

function cn(card) {
  if (!card) return '?';
  const id = card.id?.replace(/_p\d+$/, '') ?? '';
  return id ? `${id} ${card.name}` : (card.name ?? '?');
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
  return clauses.some(c => c.passive.some(k => k === '速攻' || k.startsWith('速攻：')) && !c.condition);
};
export const hasCharacterRushOnly = (card) => {
  if (!card?.effect) return false;
  const clauses = parseEffect(card.effect);
  return clauses.some(c =>
    c.passive.includes('速攻：角色') && !c.passive.includes('速攻') && !c.condition
  );
};
export const hasBlocker      = (card) => hasKeyword(card, '防禦') || hasKeyword(card, 'ブロッカー');
export const hasDoubleAtk    = (card) => hasKeyword(card, '雙重攻擊') || hasKeyword(card, 'ダブルアタック');
export const hasBanish       = (card) => hasKeyword(card, '消失') || hasKeyword(card, 'バニッシュ');
export const hasOnAttack     = (card) => hasKeyword(card, '攻擊時') || hasKeyword(card, 'アタック時');
export const hasActivatedMain = (card) => hasKeyword(card, '啟動主要') || hasKeyword(card, '起動メイン');

// fieldCard-aware keyword checks — also consider tempKeywords granted this turn
export function fcHasKeyword(fc, keyword) {
  if (!fc) return false;
  if (fc.tempKeywords?.includes(keyword)) return true;
  return hasKeyword(fc.card, keyword);
}
export const fcHasBlocker   = (fc) => fcHasKeyword(fc, '防禦') || fcHasKeyword(fc, 'ブロッカー');
// Includes continuous conditional grants (e.g. "gains Blocker while life ≤ 1")
export function fcEffectiveHasBlocker(fc, owner, activePlayer, state) {
  if (fcHasBlocker(fc)) return true;
  const kws = evaluateContinuousKeywords(fc, activePlayer, owner, state);
  return kws.has('防禦') || kws.has('ブロッカー');
}
export const fcHasDoubleAtk = (fc) => fcHasKeyword(fc, '雙重攻擊') || fcHasKeyword(fc, 'ダブルアタック');
export const fcHasBanish    = (fc) => fcHasKeyword(fc, '消失') || fcHasKeyword(fc, 'バニッシュ');
export const fcHasUnblock   = (fc) => fcHasKeyword(fc, '防禦不可');

export function leaderHasDeployRestPassive(state, player) {
  const leader = state[player]?.leader;
  if (!leader?.card?.effect) return false;
  const clauses = parseEffect(leader.card.effect);
  return clauses.some(c =>
    c.timings.length === 0 &&
    c.actions.some(a => a.type === 'DEPLOY_RESTED_PASSIVE')
  );
}

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
    if (!evaluateCondition(fullState, owner, clause.condition))
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
function resolveAtTiming(card, state, owner, timing, fieldPos = null, koCard = null) {
  if (!card?.effect) return state;
  const clauses = parseEffect(card.effect);
  let s = state;

  for (let ci = 0; ci < clauses.length; ci++) {
    const clause = clauses[ci];
    if (!clause.timings.includes(timing)) continue;

    // KO-watch context: koCard is the card that was KO'd.
    // Only fire clauses with a matching koFilter; skip self-KO clauses (no koFilter).
    if (koCard !== null) {
      if (!clause.koFilter) continue;
      if (!matchesFilter(koCard, clause.koFilter, null, koCard.power ?? null)) continue;
    }

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
      // For optional effects that prompt the human, defer marking until confirmed.
      const willPromptHuman = owner === PLAYER.HUMAN && !ACTIVATED_TIMINGS.has(timing)
        && (clause.isOptional || clause.donReturn);
      if (!willPromptHuman) s = markEffectUsed(s, owner, effectKey);
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

    // DON!! attach cost (activated effects only): attach N active DON!! from cost area to this card
    if (clause.donGate !== null && isActivated && fieldPos) {
      const paid = attachDonFromCostArea(s, owner, fieldPos, clause.donGate);
      if (!paid) { s = state; continue; }
      s = paid;
    }

    // DON!! return cost
    if (clause.donReturn) {
      // For all non-activated timings, give the human a chance to opt in before
      // paying the cost — 咚‼-N： costs are always optional in OPTC rules.
      if (owner === PLAYER.HUMAN && !ACTIVATED_TIMINGS.has(timing)) {
        s = {
          ...s,
          pendingEffect: {
            owner,
            sourceCard: card,
            effectKey,
            fieldPos,
            markUsedOnConfirm: clause.oncePerTurn,
            action: { type: 'CONFIRM_OPTIONAL_ACTIVATION', donReturn: clause.donReturn },
            continuation: clause.actions.filter(a => a.type !== 'CONFIRM_OPTIONAL_ACTIVATION'),
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

    // Non-don optional effect (可：…): ask the player before paying the action cost.
    // Falls through so the sibling-folding block below can append subsequent clauses
    // (e.g. EB03-055 clause 2 DECK_TO_LIFE) into the continuation before breaking.
    if (clause.isOptional && !clause.donReturn && owner === PLAYER.HUMAN && !ACTIVATED_TIMINGS.has(timing)) {
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
          markUsedOnConfirm: clause.oncePerTurn,
          action: { type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription: costText || '可' },
          continuation: clause.actions.filter(a => a.type !== 'CONFIRM_OPTIONAL_ACTIVATION'),
          choices: {
            type: 'CONFIRM_OPTIONAL_ACTIVATION',
            costDescription: costText || '可',
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
      s = executeActionSequence(s, owner, clause.actions, card, effectKey, fieldPos);
    }

    if (s.pendingEffect) {
      // Fold remaining sibling clauses into the pendingEffect continuation so they
      // still run after the player resolves this choice.
      // Conditional clauses are wrapped in CONDITIONAL_EXEC so their condition is
      // re-evaluated against the post-resolution state (e.g. after a REST applies).
      const tailActions = [];
      for (let ri = ci + 1; ri < clauses.length; ri++) {
        const rem = clauses[ri];
        if (!rem.timings.includes(timing)) continue;
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
  // Try the Chinese keyword first, then the Japanese variant
  let s = resolveAtTiming(card, state, owner, '啟動主要', fieldPos);
  if (s === state) s = resolveAtTiming(card, state, owner, '起動メイン', fieldPos);
  return s;
}

export function resolveOnKOEffect(card, state, owner) {
  return resolveAtTiming(card, state, owner, 'KO時');
}

// Fire KO-replacement effects on the owner's leader BEFORE a character is KO'd.
// Uses timing "KO替換時" so it doesn't interfere with post-KO watch effects.
// e.g. OP12-061: "when your 「托拉法爾加・羅」 is about to be KO'd, you can add 1 life to hand instead"
export function resolveLeaderKOReplacementEffect(koCard, state, owner) {
  const leader = state[owner]?.leader;
  if (!leader?.card?.effect) return state;
  const clauses = parseEffect(leader.card.effect);
  if (!clauses.some(c => c.timings.includes('KO替換時') && c.koFilter && matchesFilter(koCard, c.koFilter))) return state;
  return resolveAtTiming(leader.card, state, owner, 'KO替換時', { target: 'leader' }, koCard);
}

// Fire a character's own 離場時 replacement before it leaves the field (KO, bounce, add-to-life, etc.).
// Returns the pre-removal state with pendingEffect set (human must confirm), or with the cost
// already paid (AI auto-resolved). Caller detects success by checking pendingEffect or hand length.
export function resolveCharacterLeaveFieldEffect(card, fieldPos, state, owner) {
  if (!card?.effect) return state;
  const clauses = parseEffect(card.effect);
  const clause = clauses.find(c => c.timings.includes('離場時') && c.isReplacement);
  if (!clause) return state;

  const effectKey = fieldPos?.target != null
    ? `${card.id}_${fieldPos.target}_離場時`
    : `${card.id}_離場時`;

  if (state[owner]?.effectUsed?.[effectKey]) return state;
  if (clause.condition && !evaluateCondition(state, owner, clause.condition)) return state;

  if (owner === PLAYER.HUMAN) {
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
        choices: { type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription },
      },
    };
  }

  // AI: auto-execute the cost actions; caller checks hand length to detect success
  const result = executeActionSequence(state, owner, clause.actions, card, effectKey, fieldPos);
  if (result === state) return state;
  return clause.oncePerTurn ? markEffectUsed(result, owner, effectKey) : result;
}

// Fire KO-watch effects on the owner's leader when a character is KO'd.
// e.g. OP14-041: "when your 《九蛇海賊團》 character with power 5000+ is KO'd, ..."
export function resolveLeaderKOWatchEffect(koCard, state, owner) {
  const ps = state[owner];
  const leader = ps.leader;
  if (!leader?.card?.effect) return state;
  const clauses = parseEffect(leader.card.effect);
  if (!clauses.some(c => c.timings.includes('KO時') && c.koFilter)) return state;
  return resolveAtTiming(leader.card, state, owner, 'KO時', { target: 'leader' }, koCard);
}

// Fire KO-watch effects on the watcher's field characters when the opponent's character is KO'd.
// e.g. EB04-044: "when opponent's character is KO'd during your turn, draw 1"
export function resolveOpponentKOWatchEffect(koCard, state, watcherOwner) {
  const ps = state[watcherOwner];
  let s = state;
  for (let i = 0; i < ps.characterArea.length; i++) {
    const fc = ps.characterArea[i];
    if (!fc?.card?.effect) continue;
    const clauses = parseEffect(fc.card.effect);
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
  const clauses = parseEffect(card.effect);
  let s = state;

  for (const clause of clauses) {
    // Events fire all non-passive, non-continuous clauses except 反擊 (counter-step only)
    const isAuto       = clause.timings.some(t => ['登場時','KO時','攻擊時','對方攻擊時','防禦時','我方回合結束時','觸發器'].includes(t));
    const isContinuous = clause.continuous.length > 0 || clause.passive.length > 0;
    // Skip counter-only clauses (主要/反擊 dual-timing clauses still fire here)
    const isCounter    = clause.timings.includes('反擊') && !clause.timings.includes('主要');
    if (isAuto || isContinuous || isCounter) continue;

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
    const clauses = parseEffect(srcFC.card.effect);
    for (const clause of clauses) {
      if (clause.timings.some(t => AUTO_TIMINGS.has(t)) || clause.passive.length > 0) continue;
      if (clause.continuous.includes('對方回合中') && activePlayer === owner) continue;
      if (clause.continuous.includes('我方回合中') && activePlayer !== owner) continue;
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
    const clauses = parseEffect(srcFC.card.effect);
    for (const clause of clauses) {
      if (clause.timings.some(t => AUTO_TIMINGS.has(t)) || clause.passive.length > 0) continue;
      if (clause.continuous.includes('對方回合中') && activePlayer === owner) continue;
      if (clause.continuous.includes('我方回合中') && activePlayer !== owner) continue;
      if (clause.donGate !== null && (srcFC.attachedDon ?? 0) < clause.donGate) continue;
      if (clause.condition && !evaluateCondition(state, owner, clause.condition)) continue;
      for (const action of clause.actions) {
        if (action.type !== 'SET_BASE_POWER') continue;
        if (action.filter?.self) {
          // Self-targeting (with or without category): source card must be the target card
          if (srcFC === targetFC) override = action.value;
        } else if (action.filter?.category === 'Character' && matchesFilter(targetFC.card, action.filter)) {
          override = action.value;
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
