import {
  PHASE, BATTLE_STEP, PLAYER,
  DON_PER_TURN, FIRST_TURN_DON,
  STARTING_HAND, MAX_CHARACTERS,
} from './constants';
import {
  hasRush, hasCharacterRushOnly, hasTrigger, leaderDonDeckSize,
  resolveOnPlayEffect, resolveOnAttackEffect, resolveOnBlockEffect,
  resolveOnKOEffect, resolveLeaderKOWatchEffect, resolveLeaderKOReplacementEffect, resolveOpponentKOWatchEffect, resolveCharacterLeaveFieldEffect, resolveTriggerEffect, resolveEventEffect, resolveCounterEffect,
  resolveEndOfTurnEffects, resolveActivatedMainEffect, evaluateContinuousPower,
  resolveOnOpponentAttackEffect, evaluateContinuousKeywords, evaluateGlobalContinuousPower,
  evaluateLeaderBasePowerOverride, evaluateCharBasePowerOverride, resolveOnLifeZeroEffect, resolveOnDamageTakenEffect,
  fcHasDoubleAtk, fcHasBanish, fcHasUnblock, leaderHasDeployRestPassive,
  resolveOpponentEventOrCounterEffect,
} from './effects';
import { resolveEffectChoice, executeActionSequence, clearPowerMods, clearCostMods, clearHandCostMods, matchesFilter } from './effectActions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDon(index) {
  return { _donId: `don-${index}-${Math.random()}`, state: 'active' };
}

function makeFieldCard(card, opts = {}) {
  return { card, state: 'active', attachedDon: 0, justDeployed: false, ...opts };
}

function buildDonDeck(size) {
  return Array.from({ length: size }, (_, i) => makeDon(i));
}

function buildPlayerState(leader, deckCards) {
  const shuffled = shuffle(deckCards);
  const lifeCount = leader.cost ?? 5;

  const hand = shuffled.slice(0, STARTING_HAND);
  const afterHand = shuffled.slice(STARTING_HAND);
  // Life area: first lifeCount cards; index 0 = bottom, last = top (drawn first on damage)
  const lifeArea = afterHand.slice(0, lifeCount);
  const deck = afterHand.slice(lifeCount);

  const donSize = leaderDonDeckSize(leader);

  return {
    leader: makeFieldCard(leader),
    hand,
    deck,
    donDeck: buildDonDeck(donSize),
    costArea: [],       // DON!! cards available to spend
    characterArea: [],  // FieldCard[]  max 5
    stageArea: null,    // FieldCard | null
    lifeArea,           // Card[]
    lifeAreaFaceUp: Array(lifeCount).fill(false), // boolean[] — true = face-up
    trash: [],          // Card[]
    powerMods: [],      // [{ target: 'leader'|charIndex, delta, until: 'turn'|'battle' }]
    costMods: [],       // [{ target: charIndex, delta, until: 'turn'|'battle'|'opponent_turn_end' }]
    handCostMods: [],   // [{ filter, delta, until: 'turn'|'battle'|'opponent_turn_end' }] — modifies play cost of matching hand cards
    effectUsed: {},     // { [effectKey]: true } — once-per-turn tracking; cleared on Refresh
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export function createInitialState(humanLeader, humanCards, aiLeader, aiCards) {
  const firstPlayer = Math.random() < 0.5 ? PLAYER.HUMAN : PLAYER.AI;
  const leaderId = humanLeader?.id?.replace('_p1', '').replace('_p2', '');
  const preGameAbility = leaderId === 'OP13-079' ? 'STAGE_SEARCH' : null;
  return {
    phase: PHASE.REFRESH,
    firstPlayer,
    activePlayer: firstPlayer,
    waitingFor: firstPlayer,
    turn: 1,
    winner: null,
    mulligan: 'pending', // 'pending' | 'done'
    preGameAbility,      // 'STAGE_SEARCH' | null

    human: buildPlayerState(humanLeader, humanCards),
    ai: buildPlayerState(aiLeader, aiCards),

    devRevealOpponent: false,

    battle: null,
    pendingTrigger: null,
    pendingReplace: null,

    log: [{ text: 'Game started — choose your starting hand.', type: 'info', id: Date.now() }],
  };
}

// ── Leader Pre-Game Ability ───────────────────────────────────────────────────

export function applyLeaderPreGameStage(state, { cardIndex }) {
  if (state.preGameAbility !== 'STAGE_SEARCH') return state;
  let s = { ...state, preGameAbility: null };
  if (cardIndex != null) {
    const ps = s.human;
    const card = ps.deck[cardIndex];
    if (card && card.category === 'Stage') {
      const newDeck = ps.deck.filter((_, i) => i !== cardIndex);
      s = addLog({
        ...s,
        human: { ...ps, deck: newDeck, stageArea: makeFieldCard(card) },
      }, `Leader ability: ${cn(card)} placed from deck to stage for free.`, 'action');
    }
  } else {
    s = addLog(s, 'Leader ability: Stage search skipped.', 'info');
  }
  return s;
}

// ── Mulligan ──────────────────────────────────────────────────────────────────

export function applyMulliganKeep(state) {
  if (state.mulligan !== 'pending') return state;
  return addLog({ ...state, mulligan: 'done' }, 'Kept opening hand.', 'info');
}

export function applyMulliganRedraw(state) {
  if (state.mulligan !== 'pending') return state;
  const ps = state.human;
  // Return hand to deck, shuffle, redraw same number
  const combined = shuffle([...ps.deck, ...ps.hand]);
  const newHand = combined.slice(0, STARTING_HAND);
  const newDeck = combined.slice(STARTING_HAND);
  return addLog({
    ...state,
    mulligan: 'done',
    human: { ...ps, hand: newHand, deck: newDeck },
  }, 'Mulligan — new hand drawn.', 'info');
}

// ---------------------------------------------------------------------------
// Power calculation (pure)
// ---------------------------------------------------------------------------

// state is optional — pass it to include powerMods and continuous effect bonuses.
export function calcPower(fieldCard, activePlayer, owner, state = null) {
  if (!fieldCard) return 0;
  let base       = fieldCard.card?.power ?? 0;
  const donBonus = activePlayer === owner ? fieldCard.attachedDon * 1000 : 0;

  let modBonus = 0;
  if (state) {
    const ps = state[owner];
    const isLeader = fieldCard === ps?.leader;
    const target   = isLeader ? 'leader' : (ps?.characterArea?.indexOf(fieldCard) ?? -1);
    const relevantMods = (ps?.powerMods ?? []).filter(m => m.target === target);
    if (relevantMods.some(m => m.setToZero)) return 0;
    modBonus = relevantMods.reduce((sum, m) => sum + m.delta, 0);
    modBonus += evaluateContinuousPower(fieldCard, activePlayer, owner, state);
    modBonus += evaluateGlobalContinuousPower(fieldCard, activePlayer, owner, state);
    if (isLeader) {
      const baseOverride = evaluateLeaderBasePowerOverride(fieldCard, activePlayer, owner, state);
      if (baseOverride !== null) base = baseOverride;
    } else {
      const charOverride = evaluateCharBasePowerOverride(fieldCard, activePlayer, owner, state);
      if (charOverride !== null) base = charOverride;
    }
  }

  return base + donBonus + modBonus;
}

// ---------------------------------------------------------------------------
// Win condition
// ---------------------------------------------------------------------------

export function checkWinner(state) {
  if (state.human.deck.length === 0) return PLAYER.AI;
  if (state.ai.deck.length === 0)    return PLAYER.HUMAN;
  return null;
}

// ---------------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------------

export function activeDonCount(costArea) {
  return costArea.filter(d => d.state === 'active').length;
}

export function canAfford(costArea, cost) {
  return activeDonCount(costArea) >= (cost ?? 0);
}

function getEffectiveCost(card, handCostMods) {
  return Math.max(0, (card.cost ?? 0) + (handCostMods ?? []).reduce(
    (sum, mod) => (!mod.filter || matchesFilter(card, mod.filter)) ? sum + mod.delta : sum, 0
  ));
}

function spendDon(costArea, amount) {
  let remaining = amount;
  return costArea.map(d => {
    if (remaining > 0 && d.state === 'active') {
      remaining--;
      return { ...d, state: 'rest' };
    }
    return d;
  });
}

// ---------------------------------------------------------------------------
// Log helper
// ---------------------------------------------------------------------------

function cn(card) {
  if (!card) return '?';
  const id = card.id?.replace(/_p\d+$/, '') ?? '';
  return id ? `${id} ${card.name}` : (card.name ?? '?');
}

function addLog(state, text, type = 'info') {
  return {
    ...state,
    log: [...state.log, { text, type, id: Date.now() + Math.random() }],
  };
}

let _flashId = 0;
function appendFlash(state, card, label, extra = {}) {
  return {
    ...state,
    cardFlashQueue: [...(state.cardFlashQueue ?? []), { id: ++_flashId, card, label, ...extra }],
  };
}

function drainOnPlayTriggers(state) {
  if (!state.pendingEffect && !state.pendingReplace && !state.battle && state.pendingOnPlayTriggers?.length) {
    const triggers = state.pendingOnPlayTriggers;
    let s = { ...state, pendingOnPlayTriggers: [] };
    for (const { card, owner } of triggers) {
      s = resolveOnPlayEffect(card, s, owner);
      if (s.pendingEffect || s.pendingReplace) break;
    }
    return s;
  }
  return state;
}

// ---------------------------------------------------------------------------
// REDUCER ACTIONS
// Each action function: (state, payload?) => newState
// ---------------------------------------------------------------------------

// ── Refresh Phase (auto) ──────────────────────────────────────────────────

export function applyRefresh(state) {
  const p = state.activePlayer;
  const ps = state[p];

  // Collect DON!! cards back from all attachments
  let returnedDon = ps.leader.attachedDon;
  const freshChars  = ps.characterArea.map(fc => {
    returnedDon += fc.attachedDon;
    // refreshLocked characters stay rested for this refresh; clear the flag
    const newState = fc.refreshLocked ? 'rest' : 'active';
    return { ...fc, state: newState, attachedDon: 0, justDeployed: false, refreshLocked: false };
  });
  const freshLeader = { ...ps.leader, state: ps.leader.refreshLocked ? 'rest' : 'active', attachedDon: 0, refreshLocked: false };
  const freshStage  = ps.stageArea ? { ...ps.stageArea, state: 'active' } : null;

  // Unrest all cost-area DON and add the returned attached ones back as active
  const returnDons = Array.from({ length: returnedDon }, (_, i) => makeDon(`ref-ret-${i}`));
  const freshCost  = [
    ...ps.costArea.map(d => ({ ...d, state: 'active' })),
    ...returnDons,
  ];

  // Clear once-per-turn effect limits, turn-duration power mods, and per-turn trigger registrations
  let s = {
    ...state,
    phase: PHASE.DRAW,
    [p]: {
      ...ps,
      leader: freshLeader, characterArea: freshChars,
      stageArea: freshStage, costArea: freshCost,
      effectUsed: {},
      onEventTriggers: [],
      lastDiscardCount: 0,
      deployBlockedThisTurn: false,
      donUnrestByCharLocked: false,
      handPlayLocked: false,
    },
  };
  s = clearPowerMods(s, p, 'turn');
  s = clearPowerMods(s, p, 'opponent_turn_end');
  s = clearCostMods(s, p, 'turn');
  s = clearCostMods(s, p, 'opponent_turn_end');
  s = clearHandCostMods(s, p, 'turn');
  s = clearHandCostMods(s, p, 'opponent_turn_end');

  return addLog(s, `Refresh Phase.`, 'phase');
}

// ── Draw Phase (auto) ─────────────────────────────────────────────────────

export function applyDraw(state) {
  const p = state.activePlayer;
  const ps = state[p];

  // First player's Turn 1 skips draw
  if (p === state.firstPlayer && state.turn === 1) {
    return { ...state, phase: PHASE.DON };
  }

  if (ps.deck.length === 0) {
    return { ...state, winner: p === PLAYER.HUMAN ? PLAYER.AI : PLAYER.HUMAN };
  }

  const drawn = ps.deck[ps.deck.length - 1];
  const baseDrawState = { ...state, phase: PHASE.DON, [p]: { ...ps, hand: [...ps.hand, drawn], deck: ps.deck.slice(0, -1) } };
  return addLog(
    p === PLAYER.HUMAN ? appendFlash(baseDrawState, drawn, 'DRAW') : baseDrawState,
    `Drew 1 card.`, 'info'
  );
}

// ── DON!! Phase (auto) ────────────────────────────────────────────────────

function applyPendingDonRest(state, p) {
  const pending = state[p].pendingDonRest ?? 0;
  if (!pending) return state;
  const ps = state[p];
  const activeDon = ps.costArea.filter(d => d.state === 'active');
  const toRest = activeDon.slice(0, pending);
  if (!toRest.length) return { ...state, [p]: { ...ps, pendingDonRest: 0 } };
  const toRestIds = new Set(toRest.map(d => d._donId));
  return addLog({
    ...state,
    [p]: {
      ...ps,
      pendingDonRest: 0,
      costArea: ps.costArea.map(d => toRestIds.has(d._donId) ? { ...d, state: 'rest' } : d),
    },
  }, `Opponent effect: ${toRest.length} DON!! rested at main phase start.`, 'action');
}

export function applyDonPhase(state) {
  const p = state.activePlayer;
  const ps = state[p];

  const isFirstTurn = p === state.firstPlayer && state.turn === 1;
  const gain = isFirstTurn
    ? FIRST_TURN_DON
    : Math.min(DON_PER_TURN, ps.donDeck.length);

  if (gain === 0) {
    return applyPendingDonRest({ ...state, phase: PHASE.MAIN, waitingFor: p }, p);
  }

  const gained = ps.donDeck.slice(-gain).map(d => ({ ...d, state: 'active' }));
  const newDonDeck = ps.donDeck.slice(0, -gain);

  return applyPendingDonRest(addLog({
    ...state,
    phase: PHASE.MAIN,
    waitingFor: p,
    [p]: { ...ps, donDeck: newDonDeck, costArea: [...ps.costArea, ...gained] },
  }, `DON!! Phase: gained ${gain} DON!! (${activeDonCount([...ps.costArea, ...gained])} active).`, 'phase'), p);
}

// ── Play Character ────────────────────────────────────────────────────────

function findLowestPowerIndex(characterArea) {
  let idx = 0;
  for (let i = 1; i < characterArea.length; i++) {
    if ((characterArea[i].card?.power ?? 0) < (characterArea[idx].card?.power ?? 0)) idx = i;
  }
  return idx;
}

export function applyPlayCharacter(state, { handIndex }) {
  const p = state.activePlayer;
  const ps = state[p];
  const card = ps.hand[handIndex];

  if (!card || card.category !== 'Character') return state;
  const charEffectiveCost = getEffectiveCost(card, ps.handCostMods);
  if (!canAfford(ps.costArea, charEffectiveCost)) return state;
  if (ps.deployBlockedThisTurn) return state;
  if (ps.handPlayLocked) return state;

  const newCost = spendDon(ps.costArea, charEffectiveCost);
  const newHand = ps.hand.filter((_, i) => i !== handIndex);

  if (ps.characterArea.length >= MAX_CHARACTERS) {
    if (p === PLAYER.AI) {
      const lowestIdx  = findLowestPowerIndex(ps.characterArea);
      const replaceFC  = ps.characterArea[lowestIdx];
      const returnedDon = Array.from({ length: replaceFC.attachedDon }, (_, i) =>
        ({ _donId: `don-rpl-${i}-${Math.random()}`, state: 'rest' })
      );
      const enterRestedAI = leaderHasDeployRestPassive(state, p);
      const newChars = ps.characterArea.map((fc, i) =>
        i === lowestIdx ? makeFieldCard(card, { justDeployed: !hasRush(card), ...(hasCharacterRushOnly(card) && { rushCharOnly: true }), ...(enterRestedAI && { state: 'rest' }) }) : fc
      );
      const placed = addLog(appendFlash({
        ...state,
        [p]: {
          ...ps, hand: newHand, costArea: [...newCost, ...returnedDon],
          characterArea: newChars, trash: [...ps.trash, replaceFC.card],
        },
      }, card, 'PLAY_CHARACTER'), `AI played ${cn(card)}, replacing ${cn(replaceFC.card)} (Cost ${card.cost ?? 0}).`, 'action');
      return resolveOnPlayEffect(card, placed, p);
    }
    // Human: pause and ask which character to replace
    return addLog({
      ...state,
      pendingReplace: { type: 'PLAY_CHARACTER', owner: p, card },
      [p]: { ...ps, hand: newHand, costArea: newCost },
    }, `Played ${cn(card)} — choose a character to replace.`, 'action');
  }

  const enterRested = leaderHasDeployRestPassive(state, p);
  const fieldCard = makeFieldCard(card, { justDeployed: !hasRush(card), ...(hasCharacterRushOnly(card) && { rushCharOnly: true }), ...(enterRested && { state: 'rest' }) });
  const placed = addLog(appendFlash({
    ...state,
    [p]: { ...ps, hand: newHand, costArea: newCost, characterArea: [...ps.characterArea, fieldCard] },
  }, card, 'PLAY_CHARACTER'), `Played ${cn(card)} (Cost ${card.cost ?? 0}).`, 'action');
  return resolveOnPlayEffect(card, placed, p);
}

// ── Play Stage ────────────────────────────────────────────────────────────

export function applyPlayStage(state, { handIndex }) {
  const p = state.activePlayer;
  const ps = state[p];
  const card = ps.hand[handIndex];

  if (!card || card.category !== 'Stage') return state;
  if (ps.handPlayLocked) return state;
  const stageEffectiveCost = getEffectiveCost(card, ps.handCostMods);
  if (!canAfford(ps.costArea, stageEffectiveCost)) return state;

  const newCost   = spendDon(ps.costArea, stageEffectiveCost);
  const newHand   = ps.hand.filter((_, i) => i !== handIndex);
  const newTrash  = ps.stageArea ? [...ps.trash, ps.stageArea.card] : ps.trash;

  const placed = addLog(appendFlash({
    ...state,
    [p]: { ...ps, hand: newHand, costArea: newCost, stageArea: makeFieldCard(card), trash: newTrash },
  }, card, 'PLAY_STAGE'), `Played Stage: ${cn(card)}.`, 'action');
  return resolveOnPlayEffect(card, placed, p);
}

// ── Play Event ────────────────────────────────────────────────────────────

export function applyPlayEvent(state, { handIndex }) {
  const p = state.activePlayer;
  const ps = state[p];
  const card = ps.hand[handIndex];

  if (!card || card.category !== 'Event') return state;
  if (ps.handPlayLocked) return state;
  const eventEffectiveCost = getEffectiveCost(card, ps.handCostMods);
  if (!canAfford(ps.costArea, eventEffectiveCost)) return state;

  const newCost  = spendDon(ps.costArea, eventEffectiveCost);
  const newHand  = ps.hand.filter((_, i) => i !== handIndex);

  const afterCost = addLog(appendFlash({
    ...state,
    [p]: { ...ps, hand: newHand, costArea: newCost },
  }, card, 'PLAY_EVENT'), `Activated Event: ${cn(card)} (Cost ${card.cost ?? 0}).`, 'action');

  const afterEffect = resolveEventEffect(card, afterCost, p);

  // Fire any per-turn on-event triggers registered by cards like OP15-002.
  // Guard: if the event's own effect set a pendingEffect (player choice required),
  // skip triggers — executing them now would be silently dropped by executeActionSequence.
  let s = afterEffect;
  if (!s.pendingEffect) for (const trigger of (s[p].onEventTriggers ?? [])) {
    if (matchesFilter(card, trigger.filter)) {
      s = executeActionSequence(s, p, trigger.actions, trigger.sourceCard, trigger.effectKey + '_evt');
      if (s.pendingEffect) break;
    }
  }

  // Fire 「對手發動事件卡或【防禦】時」 on the non-active player's field cards (e.g. OP15-119).
  const oppPlayer = p === PLAYER.HUMAN ? PLAYER.AI : PLAYER.HUMAN;
  if (!s.pendingEffect) s = resolveOpponentEventOrCounterEffect(s, oppPlayer);

  const finalPs = s[p];
  return { ...s, [p]: { ...finalPs, trash: [...finalPs.trash, card] } };
}

// ── Attach DON!! ──────────────────────────────────────────────────────────

export function applyAttachDon(state, { targetZone, targetIndex, count = 1 }) {
  const p = state.activePlayer;
  const ps = state[p];

  const activeDonIndices = [];
  for (let i = 0; i < ps.costArea.length && activeDonIndices.length < count; i++) {
    if (ps.costArea[i].state === 'active') activeDonIndices.push(i);
  }
  if (activeDonIndices.length === 0) return state;

  const activeSet = new Set(activeDonIndices);
  const attached = activeDonIndices.length;
  const newCost = ps.costArea.filter((_, i) => !activeSet.has(i));

  let newPs;
  if (targetZone === 'leader') {
    newPs = { ...ps, costArea: newCost, leader: { ...ps.leader, attachedDon: ps.leader.attachedDon + attached } };
  } else {
    const newChars = ps.characterArea.map((fc, i) =>
      i === targetIndex ? { ...fc, attachedDon: fc.attachedDon + attached } : fc
    );
    newPs = { ...ps, costArea: newCost, characterArea: newChars };
  }

  return addLog({ ...state, [p]: newPs }, `Attached ${attached} DON!!.`, 'action');
}

// ── Remove 1 Character to make room ──────────────────────────────────────

export function applyRemoveCharacter(state, { index }) {
  const p = state.activePlayer;
  const ps = state[p];
  const fc = ps.characterArea[index];
  if (!fc) return state;

  // Return attached DON!! as rested
  const returnedDon = Array.from({ length: fc.attachedDon }, (_, i) => makeDon(`rmv-${i}`)).map(d => ({ ...d, state: 'rest' }));
  const newChars = ps.characterArea.filter((_, i) => i !== index);

  return addLog({
    ...state,
    [p]: { ...ps, characterArea: newChars, trash: [...ps.trash, fc.card], costArea: [...ps.costArea, ...returnedDon] },
  }, `Sent ${cn(fc.card)} to trash to make room.`, 'action');
}

// ── Declare Attack ────────────────────────────────────────────────────────

export function applyDeclareAttack(state, { attackerZone, attackerIndex, targetOwner, targetZone, targetIndex }) {
  const attacker = state.activePlayer;
  const ps = state[attacker];

  // No player can attack on their own first turn (turn counter = 1 covers both players)
  if (state.turn === 1) return state;

  // Validate attacker
  let attackerFC;
  if (attackerZone === 'leader') {
    if (ps.leader.state !== 'active') return state;
    attackerFC = ps.leader;
    if (evaluateContinuousKeywords(attackerFC, attacker, attacker, state).has('CANNOT_ATTACK')) return state;
  } else {
    attackerFC = ps.characterArea[attackerIndex];
    const contKws = evaluateContinuousKeywords(attackerFC, attacker, attacker, state);
    const blockedByDeploy = attackerFC?.justDeployed && !contKws.has('速攻');
    if (!attackerFC || attackerFC.state !== 'active' || blockedByDeploy || contKws.has('CANNOT_ATTACK') || attackerFC.restLocked || attackerFC.attackLocked) return state;
  }

  // Validate target: leader or rested enemy character
  const defPs = state[targetOwner];
  if (targetZone === 'character') {
    const tgt = defPs.characterArea[targetIndex];
    if (!tgt || tgt.state !== 'rest') return state;
  }

  // Rest the attacker
  let newState = { ...state };
  if (attackerZone === 'leader') {
    newState[attacker] = { ...ps, leader: { ...ps.leader, state: 'rest' } };
  } else {
    const newChars = ps.characterArea.map((fc, i) =>
      i === attackerIndex ? { ...fc, state: 'rest' } : fc
    );
    newState[attacker] = { ...ps, characterArea: newChars };
  }

  // Resolve On-Attack effects before computing battle powers
  const attackerCard = attackerZone === 'leader'
    ? newState[attacker].leader.card
    : newState[attacker].characterArea[attackerIndex].card;
  newState = resolveOnAttackEffect(attackerCard, newState, attacker, attackerZone, attackerIndex);
  if (newState.pendingEffect) {
    // Interactive on-attack effect (e.g. DISCARD choice) — store attack params so the
    // battle can be finalised after the player resolves the effect.
    return {
      ...newState,
      pendingBattle: { attacker, attackerZone, attackerIndex, targetOwner, targetZone, targetIndex, attackerName: cn(attackerFC.card) },
    };
  }

  return finalizeBattleDeclaration(newState, attacker, attackerZone, attackerIndex, targetOwner, targetZone, targetIndex, cn(attackerFC.card));
}

function finalizeBattleDeclaration(state, attacker, attackerZone, attackerIndex, targetOwner, targetZone, targetIndex, attackerName) {
  const atkPower = calcPower(
    attackerZone === 'leader' ? state[attacker].leader : state[attacker].characterArea[attackerIndex],
    attacker, attacker, state
  );
  const defPs2 = state[targetOwner];
  const defPower = calcPower(
    targetZone === 'leader' ? defPs2.leader : defPs2.characterArea[targetIndex],
    attacker, targetOwner, state
  );

  let s = addLog({
    ...state,
    waitingFor: targetOwner,
    pendingOpponentAttackScan: null,
    battle: {
      step: BATTLE_STEP.BLOCK,
      attackerOwner: attacker,
      attackerZone,
      attackerIndex,
      targetOwner,
      targetZone,
      targetIndex,
      atkPower,
      defPower,
      blockerUsed: false,
    },
  }, `Attack! ${attackerName} (${atkPower}) → ${cn(targetZone === 'leader' ? defPs2.leader.card : defPs2.characterArea[targetIndex].card)} (${defPower}).`, 'battle');

  // Check defender's 對方攻擊時 effects — leader first, then stage, then each character card.
  // If any effect needs human interaction (sets pendingEffect), the remaining scan
  // is deferred via pendingOpponentAttackScan so it resumes after the effect resolves.
  s = resolveOnOpponentAttackEffect(s[targetOwner].leader.card, s, targetOwner);
  if (s.pendingEffect) {
    s = { ...s, pendingOpponentAttackScan: { targetOwner, stageScanned: false, nextIndex: 0 } };
  } else {
    if (s[targetOwner].stageArea?.card) {
      s = resolveOnOpponentAttackEffect(s[targetOwner].stageArea.card, s, targetOwner, { target: 'stage' });
      if (s.pendingEffect) {
        s = { ...s, pendingOpponentAttackScan: { targetOwner, stageScanned: true, nextIndex: 0 } };
      }
    }
    if (!s.pendingEffect) {
      const defChars = s[targetOwner].characterArea;
      for (let i = 0; i < defChars.length; i++) {
        if (s.pendingEffect) {
          if (i + 1 < defChars.length)
            s = { ...s, pendingOpponentAttackScan: { targetOwner, stageScanned: true, nextIndex: i + 1 } };
          break;
        }
        s = resolveOnOpponentAttackEffect(defChars[i].card, s, targetOwner, { target: i });
        if (s.pendingEffect) {
          if (i + 1 < defChars.length)
            s = { ...s, pendingOpponentAttackScan: { targetOwner, stageScanned: true, nextIndex: i + 1 } };
          break;
        }
      }
    }
  }
  // If the effect was instant (no human interaction pending), recalculate defPower
  // in case a power mod was applied (e.g. OP15-002 discards for +N*1000).
  if (!s.pendingEffect && s.battle) {
    const defFC = targetZone === 'leader'
      ? s[targetOwner].leader
      : s[targetOwner].characterArea[targetIndex];
    if (defFC) {
      const newDefPower = calcPower(defFC, attacker, targetOwner, s);
      if (newDefPower !== s.battle.defPower) {
        s = { ...s, battle: { ...s.battle, defPower: newDefPower } };
      }
    }
  }
  // 防禦不可: attacker cannot be blocked — skip straight to COUNTER step
  if (!s.pendingEffect && s.battle?.step === BATTLE_STEP.BLOCK) {
    const atkFC = attackerZone === 'leader'
      ? s[attacker].leader
      : s[attacker].characterArea[attackerIndex];
    if (fcHasUnblock(atkFC)) {
      s = { ...s, battle: { ...s.battle, step: BATTLE_STEP.COUNTER } };
    }
  }
  return s;
}

// ── Blocker ───────────────────────────────────────────────────────────────

export function applyUseBlocker(state, { blockerIndex }) {
  const battle = state.battle;
  if (!battle || battle.step !== BATTLE_STEP.BLOCK || battle.blockerUsed) return state;

  const defender = battle.targetOwner;
  const defPs = state[defender];
  const blocker = defPs.characterArea[blockerIndex];
  if (!blocker || blocker.state !== 'active') return state;

  const newChars = defPs.characterArea.map((fc, i) =>
    i === blockerIndex ? { ...fc, state: 'rest' } : fc
  );

  let s = {
    ...state,
    [defender]: { ...defPs, characterArea: newChars },
  };
  s = resolveOnBlockEffect(blocker.card, s, defender, blockerIndex);

  // Fire 「對手發動事件卡或【防禦】時」 on the attacker's field cards (e.g. OP15-119).
  // From the attacker's perspective, the opponent (defender) just used a blocker.
  if (!s.pendingEffect) s = resolveOpponentEventOrCounterEffect(s, battle.attackerOwner);

  const newDefPower = calcPower(s[defender].characterArea[blockerIndex], battle.attackerOwner, defender, s);

  return addLog({
    ...s,
    battle: {
      ...battle,
      step: BATTLE_STEP.COUNTER,
      targetZone: 'character',
      targetIndex: blockerIndex,
      defPower: newDefPower,
      blockerUsed: true,
    },
  }, `Blocker! ${cn(blocker.card)} intercepts (${newDefPower}).`, 'battle');
}

export function applySkipBlock(state) {
  if (!state.battle || state.battle.step !== BATTLE_STEP.BLOCK) return state;
  return { ...state, battle: { ...state.battle, step: BATTLE_STEP.COUNTER } };
}

// ── Counter ───────────────────────────────────────────────────────────────

export function applyPlayCounter(state, { handIndex }) {
  const battle = state.battle;
  if (!battle || battle.step !== BATTLE_STEP.COUNTER) return state;

  const defender = battle.targetOwner;
  const defPs = state[defender];
  const card = defPs.hand[handIndex];
  if (!card) return state;

  // Standard counter card — numeric counter bonus
  if (card.counter) {
    const newHand = defPs.hand.filter((_, i) => i !== handIndex);
    const bonus   = card.counter;
    return addLog(appendFlash({
      ...state,
      [defender]: { ...defPs, hand: newHand, trash: [...defPs.trash, card] },
      battle: { ...battle, defPower: battle.defPower + bonus },
    }, card, 'COUNTER', { counterBonus: bonus }), `Counter +${bonus} (${cn(card)}).`, 'battle');
  }

  // Event card with 反擊 timing — must pay DON!! cost
  if (card.category === 'Event' && card.effect?.includes('【反擊】')) {
    if (!canAfford(defPs.costArea, card.cost ?? 0)) return state;
    const newCost = spendDon(defPs.costArea, card.cost ?? 0);
    const newHand = defPs.hand.filter((_, i) => i !== handIndex);
    let s = addLog(appendFlash({
      ...state,
      [defender]: { ...defPs, hand: newHand, costArea: newCost },
    }, card, 'COUNTER'), `Counter Event: ${cn(card)} (Cost ${card.cost ?? 0}).`, 'battle');
    s = resolveCounterEffect(card, s, defender);
    const afterPs = s[defender];
    s = { ...s, [defender]: { ...afterPs, trash: [...afterPs.trash, card] } };
    // Re-calculate battle.defPower so power mods from the counter effect are visible to applyResolveDamage.
    if (s.battle) {
      const defFC = s.battle.targetZone === 'leader'
        ? s[defender].leader
        : s[defender].characterArea[s.battle.targetIndex];
      if (defFC) {
        const newDefPower = calcPower(defFC, s.battle.attackerOwner, defender, s);
        if (newDefPower !== s.battle.defPower) {
          s = { ...s, battle: { ...s.battle, defPower: newDefPower } };
        }
      }
    }
    return s;
  }

  return state;
}

export function applySkipCounter(state) {
  if (!state.battle || state.battle.step !== BATTLE_STEP.COUNTER) return state;
  // After counter step, resolve damage. waitingFor goes back to attacker (auto).
  return {
    ...state,
    waitingFor: state.battle.attackerOwner,
    battle: { ...state.battle, step: BATTLE_STEP.DAMAGE },
  };
}

// ── Damage Resolution ─────────────────────────────────────────────────────

export function applyResolveDamage(state) {
  const battle = state.battle;
  if (!battle || battle.step !== BATTLE_STEP.DAMAGE) return state;

  const { atkPower, defPower, attackerOwner, targetOwner, targetZone, targetIndex } = battle;

  function clearBattleMods(s) {
    s = clearPowerMods(s, PLAYER.HUMAN, 'battle');
    s = clearPowerMods(s, PLAYER.AI,    'battle');
    return s;
  }

  if (atkPower < defPower) {
    return addLog(clearBattleMods({
      ...state,
      battle: null,
      waitingFor: state.activePlayer,
    }), `Attack failed. (${atkPower} < ${defPower})`, 'battle');
  }

  // Attacker wins
  let s = state;

  if (targetZone === 'leader') {
    const defPs = s[targetOwner];

    if (defPs.lifeArea.length === 0) {
      // Life was already 0 → attacker wins
      return { ...s, battle: null, winner: attackerOwner };
    }

    // Check special keywords on attacker
    const attackerFC = battle.attackerZone === 'leader'
      ? s[attackerOwner].leader
      : s[attackerOwner].characterArea[battle.attackerIndex];

    const isBanish    = fcHasBanish(attackerFC);
    const isDoubleAtk = fcHasDoubleAtk(attackerFC);

    const lifeCard  = defPs.lifeArea[defPs.lifeArea.length - 1];
    const newLife   = defPs.lifeArea.slice(0, -1);
    const newFaceUp = (defPs.lifeAreaFaceUp ?? defPs.lifeArea.map(() => false)).slice(0, -1);

    const humanLife = targetOwner === PLAYER.HUMAN;
    if (isBanish) {
      // Banish: life card goes to trash, trigger does NOT fire
      const baseBanish = { ...s, battle: null, waitingFor: s.activePlayer, [targetOwner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, trash: [...defPs.trash, lifeCard] } };
      s = addLog(
        humanLife ? appendFlash(baseBanish, lifeCard, 'LIFE_TO_TRASH') : baseBanish,
        `Banish! Life card trashed (no trigger). Life remaining: ${newLife.length}.`, 'damage');
    } else if (hasTrigger(lifeCard) && targetOwner === PLAYER.HUMAN) {
      // Human decides whether to activate trigger
      s = addLog(appendFlash({
        ...s,
        battle: null,
        waitingFor: PLAYER.HUMAN,
        pendingTrigger: {
          owner: targetOwner,
          lifeCard,
          isDoubleAtk: isDoubleAtk && newLife.length > 0,
          postTriggerLife: newLife,
          doubleAtkBattle: (isDoubleAtk && !battle.secondHit && newLife.length > 0)
            ? { ...battle, step: BATTLE_STEP.DAMAGE, defPower: 0, secondHit: true }
            : null,
        },
        [targetOwner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp },
      }, lifeCard, 'LIFE_TO_HAND'), `Life card revealed: ${cn(lifeCard)} — has Trigger!`, 'damage');
    } else {
      // No trigger (or AI): card goes to hand
      const baseNoDmg = { ...s, battle: null, waitingFor: s.activePlayer, [targetOwner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, hand: [...defPs.hand, lifeCard] } };
      s = addLog(
        humanLife ? appendFlash(baseNoDmg, lifeCard, 'LIFE_TO_HAND') : baseNoDmg,
        `Damage! Life → hand. Life remaining: ${newLife.length}.`, 'damage');

      if (isDoubleAtk && !battle.secondHit && newLife.length > 0) {
        // Double Attack: deal second damage immediately (secondHit flag prevents further recursion)
        s = applyResolveDamage({
          ...s,
          battle: { ...battle, step: BATTLE_STEP.DAMAGE, defPower: 0, secondHit: true },
        });
      }
    }

    // Fire "受到傷害時" effects on the defending leader (e.g. OP13-002 Ace).
    // Skipped when pendingTrigger is set — the life card hasn't gone to hand yet in that path.
    if (!s.pendingTrigger && !s.winner) {
      s = resolveOnDamageTakenEffect(s[targetOwner].leader.card, s, targetOwner);
    }

    // Win check: life = 0 AND leader is hit again = win
    // (The rule is: win when life = 0 AND attack succeeds against leader)
    if (s[targetOwner]?.lifeArea?.length === 0 && !s.pendingTrigger) {
      // Fire "生命值卡變成0張時" effects on the defending leader (e.g. OP05-098 Enel)
      s = resolveOnLifeZeroEffect(s[targetOwner].leader.card, s, targetOwner);
    }

  } else {
    // KO the target character
    const defPs = s[targetOwner];
    const koFC  = defPs.characterArea[targetIndex];

    const returnedDon = Array.from({ length: koFC.attachedDon }, (_, i) =>
      ({ ...makeDon(`ko-${i}`), state: 'rest' })
    );

    // Check for character self leave-field replacement FIRST (e.g. EB04-044: discard to stay)
    const handCountBefore = defPs.hand.length;
    const selfReplaceState = resolveCharacterLeaveFieldEffect(
      koFC.card, { target: targetIndex }, { ...s, battle: null, waitingFor: targetOwner }, targetOwner
    );
    if (selfReplaceState.pendingEffect) {
      return {
        ...selfReplaceState,
        pendingLeaveField: { context: 'KO', targetOwner, koCard: koFC.card, targetIndex, returnedDon },
      };
    }
    if (selfReplaceState[targetOwner].hand.length < handCountBefore) {
      // AI paid discard cost — KO prevented; clear battle mods and return
      s = clearPowerMods(selfReplaceState, PLAYER.HUMAN, 'battle');
      s = clearPowerMods(s, PLAYER.AI, 'battle');
      s = drainOnPlayTriggers(s);
      const w = checkWinner(s);
      return w ? { ...s, winner: w } : s;
    }

    // Check for leader KO-replacement effect BEFORE applying the KO.
    // Uses "KO替換時" timing so it doesn't re-trigger in the post-KO watch flow.
    const lifeCountBefore = defPs.lifeArea.length;
    const preKoState = resolveLeaderKOReplacementEffect(
      koFC.card, { ...s, battle: null, waitingFor: targetOwner }, targetOwner
    );
    if (preKoState.pendingEffect) {
      // Human player must decide — store KO info and wait for RESOLVE_EFFECT_CHOICE
      return {
        ...preKoState,
        pendingKOReplacement: { targetOwner, koCard: koFC.card, targetIndex, returnedDon },
      };
    }
    if (preKoState[targetOwner].lifeArea.length < lifeCountBefore) {
      // Replacement auto-fired (AI) — KO prevented; clear battle mods and return
      s = clearPowerMods(preKoState, PLAYER.HUMAN, 'battle');
      s = clearPowerMods(s, PLAYER.AI, 'battle');
      s = drainOnPlayTriggers(s);
      const w = checkWinner(s);
      return w ? { ...s, winner: w } : s;
    }

    s = addLog(appendFlash({
      ...s,
      battle: null,
      waitingFor: s.activePlayer,
      [targetOwner]: {
        ...defPs,
        characterArea: defPs.characterArea.filter((_, i) => i !== targetIndex),
        trash: [...defPs.trash, koFC.card],
        costArea: [...defPs.costArea, ...returnedDon],
      },
    }, koFC.card, 'KO'), `${cn(koFC.card)} was KO'd!`, 'battle');

    // Fire KO-timing effects on the KO'd card
    if (koFC.card?.effect?.includes('KO時')) {
      s = resolveOnKOEffect(koFC.card, s, targetOwner);
      s = drainOnPlayTriggers(s);
    }
    // Fire leader KO-watch effects (e.g. OP14-041: "when your 《九蛇海賊團》 char is KO'd, ...")
    if (!s.pendingEffect) {
      s = resolveLeaderKOWatchEffect(koFC.card, s, targetOwner);
    }
    // Fire field-character watch effects on the attacker's side (e.g. EB04-044: "when opponent char is KO'd, draw 1")
    if (!s.pendingEffect) {
      const attackerPlayer = targetOwner === PLAYER.HUMAN ? PLAYER.AI : PLAYER.HUMAN;
      s = resolveOpponentKOWatchEffect(koFC.card, s, attackerPlayer);
    }
  }

  // Clear battle-duration power mods (unless trigger is pending — clear after trigger resolves)
  if (!s.pendingTrigger) s = clearBattleMods(s);

  // Drain any on-play triggers that were deferred while the battle was active
  if (!s.pendingTrigger) s = drainOnPlayTriggers(s);

  const winner = checkWinner(s);
  return winner ? { ...s, winner } : s;
}

// ── Resolve Trigger ───────────────────────────────────────────────────────

export function applyResolveTrigger(state, { activate }) {
  const t = state.pendingTrigger;
  if (!t) return state;

  const ps = state[t.owner];

  // Helper: resume any effect-chain continuation stored by DEAL_DAMAGE
  function runEffectContinuation(s) {
    if (!t.effectContinuation?.length) return s;
    return executeActionSequence(
      s,
      t.effectContinuationOwner,
      t.effectContinuation,
      t.effectContinuationSourceCard,
      t.effectContinuationEffectKey,
      t.effectContinuationFieldPos ?? null,
    );
  }

  function applyDoubleAtkSecondHit(s) {
    if (!t.doubleAtkBattle || s.pendingEffect || s.pendingTrigger) return s;
    return applyResolveDamage({ ...s, battle: t.doubleAtkBattle });
  }

  if (!activate) {
    const withCard = {
      ...state,
      pendingTrigger: null,
      waitingFor: state.activePlayer,
      [t.owner]: { ...ps, hand: [...ps.hand, t.lifeCard] },
    };
    const afterLog = addLog(withCard, `Trigger declined. ${cn(t.lifeCard)} added to hand.`, 'info');
    return applyDoubleAtkSecondHit(runEffectContinuation(afterLog));
  }

  // Event card triggers: card goes to trash when activated (it's consumed like a played event).
  // Other card types (Character, Stage) go to hand.
  const isEvent = t.lifeCard.category === 'Event';
  const withCard = {
    ...state,
    pendingTrigger: null,
    waitingFor: state.activePlayer,
    [t.owner]: isEvent
      ? { ...ps, trash: [...ps.trash, t.lifeCard] }
      : { ...ps, hand: [...ps.hand, t.lifeCard] },
  };
  const afterTrigger = resolveTriggerEffect(t.lifeCard, withCard, t.owner);
  const afterLog = addLog(afterTrigger, `Trigger activated: ${cn(t.lifeCard)}.`, 'action');
  return applyDoubleAtkSecondHit(runEffectContinuation(afterLog));
}

// ── Activate: Main ───────────────────────────────────────────────────────────

export function applyActivateMain(state, { zone, index }) {
  const p = state.activePlayer;
  if (state.phase !== PHASE.MAIN || state.battle) return state;

  const ps = state[p];
  const fc = zone === 'leader' ? ps.leader : zone === 'stage' ? ps.stageArea : ps.characterArea[index];
  if (!fc) return state;

  let s = resolveActivatedMainEffect(fc.card, state, p, zone, index);
  // Drain KO-timing effects queued by any non-interactive KOs during activation
  if (!s.pendingEffect && !s.pendingReplace && s.pendingKOEffects?.length) {
    const koEffects = s.pendingKOEffects;
    s = { ...s, pendingKOEffects: [] };
    for (const { card, owner: koOwner } of koEffects) {
      s = resolveOnKOEffect(card, s, koOwner);
      if (!s.pendingEffect && !s.pendingReplace)
        s = resolveLeaderKOWatchEffect(card, s, koOwner);
      if (s.pendingEffect || s.pendingReplace) break;
    }
  }
  return s;
}

// ── Resolve Replace ──────────────────────────────────────────────────────

export function applyResolveReplace(state, { replaceIndex }) {
  const pr = state.pendingReplace;
  if (!pr) return state;
  const { type, owner, card } = pr;
  const ps = state[owner];
  const replaceFC = ps.characterArea[replaceIndex];
  if (!replaceFC) return state;

  const returnedDon = Array.from({ length: replaceFC.attachedDon }, (_, i) =>
    ({ _donId: `don-rpl-${i}-${Math.random()}`, state: 'rest' })
  );
  const enterRestedReplace = leaderHasDeployRestPassive(state, owner);
  const newChars = ps.characterArea.map((fc, i) =>
    i === replaceIndex ? makeFieldCard(card, { justDeployed: !hasRush(card), ...(hasCharacterRushOnly(card) && { rushCharOnly: true }), ...(enterRestedReplace && { state: 'rest' }) }) : fc
  );
  const newHand = type === 'DEPLOY'
    ? ps.hand.filter((_, i) => i !== pr.handIndex)
    : ps.hand;
  const newTrash = type === 'DEPLOY_FROM_TRASH'
    ? [...ps.trash.filter((_, i) => i !== pr.trashIndex), replaceFC.card]
    : [...ps.trash, replaceFC.card];

  let s = addLog(appendFlash({
    ...state,
    pendingReplace: null,
    [owner]: {
      ...ps,
      hand: newHand,
      characterArea: newChars,
      trash: newTrash,
      costArea: [...ps.costArea, ...returnedDon],
    },
  }, card, null), `Replaced ${cn(replaceFC.card)} with ${cn(card)}.`, 'action');

  if (type === 'PLAY_CHARACTER') {
    return resolveOnPlayEffect(card, s, owner);
  }
  // DEPLOY / DEPLOY_FROM_TRASH: queue on-play trigger for the replaced-in card
  if (type === 'DEPLOY' || type === 'DEPLOY_FROM_TRASH') {
    s = { ...s, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card, owner }] };
  }
  // DEPLOY / DEPLOY_FROM_TRASH: resume the effect chain that was interrupted
  const afterCont = executeActionSequence(s, owner, pr.continuation, pr.sourceCard, pr.effectKey);
  return drainOnPlayTriggers(afterCont);
}

// ── End Turn ──────────────────────────────────────────────────────────────

export function applyEndTurn(state) {
  const current = state.activePlayer;
  const next    = current === PLAYER.HUMAN ? PLAYER.AI : PLAYER.HUMAN;
  const newTurn = next === state.firstPlayer ? state.turn + 1 : state.turn;

  // Fire end-of-turn effects before switching player
  let s = resolveEndOfTurnEffects(state, current);

  // Clear justDeployed, rushCharOnly, restLocked, attackLocked, and temp keyword grants on the current player's characters and leader
  const cleanChars = s[current].characterArea.map(fc => ({ ...fc, justDeployed: false, rushCharOnly: false, restLocked: false, attackLocked: false, willBottomDeckAtEndOfTurn: false, tempKeywords: [] }));
  const cleanLeader = { ...s[current].leader, tempKeywords: [] };

  return addLog({
    ...s,
    activePlayer: next,
    waitingFor: next,
    phase: PHASE.REFRESH,
    turn: newTurn,
    [current]: { ...s[current], characterArea: cleanChars, leader: cleanLeader },
  }, `─── Turn ${newTurn}: ${next === PLAYER.HUMAN ? 'Your turn' : "AI's turn"} ───`, 'phase');
}

// ---------------------------------------------------------------------------
// Central reducer
// ---------------------------------------------------------------------------

export function gameReducer(state, action) {
  if (action.type === 'TOGGLE_REVEAL_OPPONENT') {
    return { ...state, devRevealOpponent: !state.devRevealOpponent };
  }

  if (state.winner) return state; // Game over — no more actions

  switch (action.type) {
    case 'REFRESH':          return applyRefresh(state);
    case 'DRAW':             return applyDraw(state);
    case 'DON_PHASE':        return applyDonPhase(state);
    case 'PLAY_CHARACTER':   return applyPlayCharacter(state, action);
    case 'PLAY_STAGE':       return applyPlayStage(state, action);
    case 'PLAY_EVENT':       return applyPlayEvent(state, action);
    case 'ATTACH_DON':       return applyAttachDon(state, action);
    case 'REMOVE_CHARACTER': return applyRemoveCharacter(state, action);
    case 'DECLARE_ATTACK':   return applyDeclareAttack(state, action);
    case 'USE_BLOCKER':      return applyUseBlocker(state, action);
    case 'SKIP_BLOCK':       return applySkipBlock(state);
    case 'PLAY_COUNTER':     return applyPlayCounter(state, action);
    case 'SKIP_COUNTER':     return applySkipCounter(state);
    case 'RESOLVE_DAMAGE':   return applyResolveDamage(state);
    case 'RESOLVE_TRIGGER':       return applyResolveTrigger(state, action);
    case 'RESOLVE_EFFECT_CHOICE': {
      let s = drainOnPlayTriggers(resolveEffectChoice(state, action));
      // If a pending KO replacement just resolved (confirmed or rejected), clear battle-duration mods.
      if (state.pendingKOReplacement && !s.pendingKOReplacement) {
        s = clearPowerMods(s, PLAYER.HUMAN, 'battle');
        s = clearPowerMods(s, PLAYER.AI, 'battle');
      }
      // Fire KO-timing effects for any cards KO'd during this effect
      if (!s.pendingEffect && !s.pendingReplace && s.pendingKOEffects?.length) {
        const koEffects = s.pendingKOEffects;
        s = { ...s, pendingKOEffects: [] };
        for (const { card, owner: koOwner } of koEffects) {
          s = resolveOnKOEffect(card, s, koOwner);
          if (!s.pendingEffect && !s.pendingReplace)
            s = resolveLeaderKOWatchEffect(card, s, koOwner);
          if (s.pendingEffect || s.pendingReplace) break;
        }
      }
      // If an on-attack interactive effect just resolved and there's a pending battle,
      // finalize the battle declaration now that the effect is done.
      if (!s.pendingEffect && !s.pendingReplace && s.pendingBattle) {
        const { attacker, attackerZone, attackerIndex, targetOwner, targetZone, targetIndex, attackerName } = s.pendingBattle;
        s = finalizeBattleDeclaration({ ...s, pendingBattle: null }, attacker, attackerZone, attackerIndex, targetOwner, targetZone, targetIndex, attackerName);
      }
      // Resume deferred 對方攻擊時 scan (started in finalizeBattleDeclaration but
      // interrupted by an interactive effect).
      if (!s.pendingEffect && !s.pendingReplace && !s.pendingBattle && s.pendingOpponentAttackScan && s.battle) {
        const { targetOwner: scanTarget, stageScanned, nextIndex } = s.pendingOpponentAttackScan;
        s = { ...s, pendingOpponentAttackScan: null };
        if (!stageScanned && s[scanTarget].stageArea?.card) {
          s = resolveOnOpponentAttackEffect(s[scanTarget].stageArea.card, s, scanTarget, { target: 'stage' });
          if (s.pendingEffect) {
            s = { ...s, pendingOpponentAttackScan: { targetOwner: scanTarget, stageScanned: true, nextIndex } };
          }
        }
        if (!s.pendingEffect) {
          const defChars = s[scanTarget].characterArea;
          for (let i = nextIndex; i < defChars.length; i++) {
            if (s.pendingEffect) {
              if (i + 1 < defChars.length)
                s = { ...s, pendingOpponentAttackScan: { targetOwner: scanTarget, stageScanned: true, nextIndex: i + 1 } };
              break;
            }
            s = resolveOnOpponentAttackEffect(defChars[i].card, s, scanTarget, { target: i });
            if (s.pendingEffect) {
              if (i + 1 < defChars.length)
                s = { ...s, pendingOpponentAttackScan: { targetOwner: scanTarget, stageScanned: true, nextIndex: i + 1 } };
              break;
            }
          }
        }
        // When all 對方攻擊時 effects have been shown, run the post-scan checks.
        if (!s.pendingEffect && !s.pendingOpponentAttackScan && s.battle?.step === BATTLE_STEP.BLOCK) {
          const b = s.battle;
          const atkFC = b.attackerZone === 'leader'
            ? s[b.attackerOwner].leader
            : s[b.attackerOwner].characterArea[b.attackerIndex];
          if (fcHasUnblock(atkFC)) {
            s = { ...s, battle: { ...s.battle, step: BATTLE_STEP.COUNTER } };
          }
        }
      }
      // Recalculate battle defPower after 對方攻擊時 interactive effects (power mods may have changed).
      if (!s.pendingEffect && !s.pendingBattle && s.battle) {
        const battle = s.battle;
        const defFC  = battle.targetZone === 'leader'
          ? s[battle.targetOwner].leader
          : s[battle.targetOwner].characterArea[battle.targetIndex];
        if (defFC) {
          const newDefPower = calcPower(defFC, battle.attackerOwner, battle.targetOwner, s);
          if (newDefPower !== battle.defPower) {
            s = { ...s, battle: { ...battle, defPower: newDefPower } };
          }
        }
      }
      return s;
    }
    case 'RESOLVE_REPLACE':       return applyResolveReplace(state, action);
    case 'ACTIVATE_MAIN':         return applyActivateMain(state, action);
    case 'END_TURN':          return applyEndTurn(state);
    case 'MULLIGAN_KEEP':          return applyMulliganKeep(state);
    case 'MULLIGAN_REDRAW':        return applyMulliganRedraw(state);
    case 'LEADER_PRE_GAME_STAGE':  return applyLeaderPreGameStage(state, action);
    case 'CONSUME_FLASH_QUEUE':    return { ...state, cardFlashQueue: [] };
    default:                       return state;
  }
}
