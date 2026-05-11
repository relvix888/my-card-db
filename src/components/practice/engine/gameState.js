import {
  PHASE, BATTLE_STEP, PLAYER,
  DON_PER_TURN, FIRST_TURN_DON,
  STARTING_HAND, MAX_CHARACTERS,
} from './constants';
import {
  hasRush, hasDoubleAtk, hasBanish, hasTrigger, leaderDonDeckSize,
  resolveOnPlayEffect, resolveOnAttackEffect, resolveOnBlockEffect,
  resolveOnKOEffect, resolveTriggerEffect, resolveEventEffect, resolveCounterEffect,
  resolveEndOfTurnEffects, resolveActivatedMainEffect, evaluateContinuousPower,
  resolveOnOpponentAttackEffect, evaluateContinuousKeywords, evaluateGlobalContinuousPower,
} from './effects';
import { resolveEffectChoice, executeActionSequence, clearPowerMods, clearCostMods, matchesFilter } from './effectActions';

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
  return {
    phase: PHASE.REFRESH,
    firstPlayer,
    activePlayer: firstPlayer,
    waitingFor: firstPlayer,
    turn: 1,
    winner: null,
    mulligan: 'pending', // 'pending' | 'done'

    human: buildPlayerState(humanLeader, humanCards),
    ai: buildPlayerState(aiLeader, aiCards),

    battle: null,
    pendingTrigger: null,
    pendingReplace: null,

    log: [{ text: 'Game started — choose your starting hand.', type: 'info', id: Date.now() }],
  };
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
  const base     = fieldCard.card?.power ?? 0;
  const donBonus = activePlayer === owner ? fieldCard.attachedDon * 1000 : 0;

  let modBonus = 0;
  if (state) {
    const ps = state[owner];
    const isLeader = fieldCard === ps?.leader;
    const target   = isLeader ? 'leader' : (ps?.characterArea?.indexOf(fieldCard) ?? -1);
    modBonus = (ps?.powerMods ?? [])
      .filter(m => m.target === target)
      .reduce((sum, m) => sum + m.delta, 0);
    modBonus += evaluateContinuousPower(fieldCard, activePlayer, owner, state);
    modBonus += evaluateGlobalContinuousPower(fieldCard, activePlayer, owner, state);
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

function addLog(state, text, type = 'info') {
  return {
    ...state,
    log: [...state.log, { text, type, id: Date.now() + Math.random() }],
  };
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
  const freshLeader = { ...ps.leader, state: 'active', attachedDon: 0 };
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
    },
  };
  s = clearPowerMods(s, p, 'turn');
  s = clearPowerMods(s, p, 'opponent_turn_end');
  s = clearCostMods(s, p, 'turn');
  s = clearCostMods(s, p, 'opponent_turn_end');

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
  return addLog({
    ...state,
    phase: PHASE.DON,
    [p]: { ...ps, hand: [...ps.hand, drawn], deck: ps.deck.slice(0, -1) },
  }, `Drew 1 card.`, 'info');
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
  if (!canAfford(ps.costArea, card.cost)) return state;

  const newCost = spendDon(ps.costArea, card.cost ?? 0);
  const newHand = ps.hand.filter((_, i) => i !== handIndex);

  if (ps.characterArea.length >= MAX_CHARACTERS) {
    if (p === PLAYER.AI) {
      const lowestIdx  = findLowestPowerIndex(ps.characterArea);
      const replaceFC  = ps.characterArea[lowestIdx];
      const returnedDon = Array.from({ length: replaceFC.attachedDon }, (_, i) =>
        ({ _donId: `don-rpl-${i}-${Math.random()}`, state: 'rest' })
      );
      const newChars = ps.characterArea.map((fc, i) =>
        i === lowestIdx ? makeFieldCard(card, { justDeployed: !hasRush(card) }) : fc
      );
      const placed = addLog({
        ...state,
        [p]: {
          ...ps, hand: newHand, costArea: [...newCost, ...returnedDon],
          characterArea: newChars, trash: [...ps.trash, replaceFC.card],
        },
      }, `AI played ${card.name}, replacing ${replaceFC.card.name} (Cost ${card.cost ?? 0}).`, 'action');
      return resolveOnPlayEffect(card, placed, p);
    }
    // Human: pause and ask which character to replace
    return addLog({
      ...state,
      pendingReplace: { type: 'PLAY_CHARACTER', owner: p, card },
      [p]: { ...ps, hand: newHand, costArea: newCost },
    }, `Played ${card.name} — choose a character to replace.`, 'action');
  }

  const fieldCard = makeFieldCard(card, { justDeployed: !hasRush(card) });
  const placed = addLog({
    ...state,
    [p]: { ...ps, hand: newHand, costArea: newCost, characterArea: [...ps.characterArea, fieldCard] },
  }, `Played ${card.name} (Cost ${card.cost ?? 0}).`, 'action');
  return resolveOnPlayEffect(card, placed, p);
}

// ── Play Stage ────────────────────────────────────────────────────────────

export function applyPlayStage(state, { handIndex }) {
  const p = state.activePlayer;
  const ps = state[p];
  const card = ps.hand[handIndex];

  if (!card || card.category !== 'Stage') return state;
  if (!canAfford(ps.costArea, card.cost)) return state;

  const newCost   = spendDon(ps.costArea, card.cost ?? 0);
  const newHand   = ps.hand.filter((_, i) => i !== handIndex);
  const newTrash  = ps.stageArea ? [...ps.trash, ps.stageArea.card] : ps.trash;

  return addLog({
    ...state,
    [p]: { ...ps, hand: newHand, costArea: newCost, stageArea: makeFieldCard(card), trash: newTrash },
  }, `Played Stage: ${card.name}.`, 'action');
}

// ── Play Event ────────────────────────────────────────────────────────────

export function applyPlayEvent(state, { handIndex }) {
  const p = state.activePlayer;
  const ps = state[p];
  const card = ps.hand[handIndex];

  if (!card || card.category !== 'Event') return state;
  if (!canAfford(ps.costArea, card.cost)) return state;

  const newCost  = spendDon(ps.costArea, card.cost ?? 0);
  const newHand  = ps.hand.filter((_, i) => i !== handIndex);

  const afterCost = addLog({
    ...state,
    [p]: { ...ps, hand: newHand, costArea: newCost },
  }, `Activated Event: ${card.name} (Cost ${card.cost ?? 0}).`, 'action');

  const afterEffect = resolveEventEffect(card, afterCost, p);

  // Fire any per-turn on-event triggers registered by cards like OP15-002
  let s = afterEffect;
  for (const trigger of (s[p].onEventTriggers ?? [])) {
    if (matchesFilter(card, trigger.filter)) {
      s = executeActionSequence(s, p, trigger.actions, trigger.sourceCard, trigger.effectKey + '_evt');
      if (s.pendingEffect) break;
    }
  }

  const finalPs = s[p];
  return { ...s, [p]: { ...finalPs, trash: [...finalPs.trash, card] } };
}

// ── Attach DON!! ──────────────────────────────────────────────────────────

export function applyAttachDon(state, { targetZone, targetIndex }) {
  const p = state.activePlayer;
  const ps = state[p];

  const donIdx = ps.costArea.findIndex(d => d.state === 'active');
  if (donIdx === -1) return state;

  const newCost = ps.costArea.filter((_, i) => i !== donIdx);

  let newPs;
  if (targetZone === 'leader') {
    newPs = { ...ps, costArea: newCost, leader: { ...ps.leader, attachedDon: ps.leader.attachedDon + 1 } };
  } else {
    const newChars = ps.characterArea.map((fc, i) =>
      i === targetIndex ? { ...fc, attachedDon: fc.attachedDon + 1 } : fc
    );
    newPs = { ...ps, costArea: newCost, characterArea: newChars };
  }

  return addLog({ ...state, [p]: newPs }, `Attached 1 DON!!.`, 'action');
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
  }, `Sent ${fc.card.name} to trash to make room.`, 'action');
}

// ── Declare Attack ────────────────────────────────────────────────────────

export function applyDeclareAttack(state, { attackerZone, attackerIndex, targetOwner, targetZone, targetIndex }) {
  const attacker = state.activePlayer;
  const ps = state[attacker];

  // Can't attack turn 1 as first player
  if (attacker === state.firstPlayer && state.turn === 1) return state;

  // Validate attacker
  let attackerFC;
  if (attackerZone === 'leader') {
    if (ps.leader.state !== 'active') return state;
    attackerFC = ps.leader;
  } else {
    attackerFC = ps.characterArea[attackerIndex];
    const blockedByDeploy = attackerFC?.justDeployed
      && !evaluateContinuousKeywords(attackerFC, attacker, attacker, state).has('速攻');
    if (!attackerFC || attackerFC.state !== 'active' || blockedByDeploy) return state;
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
      pendingBattle: { attacker, attackerZone, attackerIndex, targetOwner, targetZone, targetIndex, attackerName: attackerFC.card.name },
    };
  }

  return finalizeBattleDeclaration(newState, attacker, attackerZone, attackerIndex, targetOwner, targetZone, targetIndex, attackerFC.card.name);
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
  }, `Attack! ${attackerName} (${atkPower}) → ${targetZone === 'leader' ? 'Leader' : defPs2.characterArea[targetIndex].card.name} (${defPower}).`, 'battle');

  // Check defender's 對方攻擊時 effects (e.g. OP14-060 redirect)
  s = resolveOnOpponentAttackEffect(s[targetOwner].leader.card, s, targetOwner);
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
  }, `Blocker! ${blocker.card.name} intercepts (${newDefPower}).`, 'battle');
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
    return addLog({
      ...state,
      [defender]: { ...defPs, hand: newHand, trash: [...defPs.trash, card] },
      battle: { ...battle, defPower: battle.defPower + bonus },
    }, `Counter +${bonus} (${card.name}).`, 'battle');
  }

  // Event card with 反擊 timing
  if (card.category === 'Event' && card.effect?.includes('【反擊】')) {
    const newHand = defPs.hand.filter((_, i) => i !== handIndex);
    let s = addLog({
      ...state,
      [defender]: { ...defPs, hand: newHand },
    }, `Counter Event: ${card.name}.`, 'battle');
    s = resolveCounterEffect(card, s, defender);
    const afterPs = s[defender];
    return { ...s, [defender]: { ...afterPs, trash: [...afterPs.trash, card] } };
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

    const isBanish    = hasBanish(attackerFC?.card);
    const isDoubleAtk = hasDoubleAtk(attackerFC?.card);

    const lifeCard  = defPs.lifeArea[defPs.lifeArea.length - 1];
    const newLife   = defPs.lifeArea.slice(0, -1);
    const newFaceUp = (defPs.lifeAreaFaceUp ?? defPs.lifeArea.map(() => false)).slice(0, -1);

    if (isBanish) {
      // Banish: life card goes to trash, trigger does NOT fire
      s = addLog({
        ...s,
        battle: null,
        waitingFor: s.activePlayer,
        [targetOwner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, trash: [...defPs.trash, lifeCard] },
      }, `Banish! Life card trashed (no trigger). Life remaining: ${newLife.length}.`, 'damage');
    } else if (hasTrigger(lifeCard) && targetOwner === PLAYER.HUMAN) {
      // Human decides whether to activate trigger
      s = addLog({
        ...s,
        battle: null,
        waitingFor: PLAYER.HUMAN,
        pendingTrigger: {
          owner: targetOwner,
          lifeCard,
          isDoubleAtk: isDoubleAtk && newLife.length > 0,
          postTriggerLife: newLife,
        },
        [targetOwner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp },
      }, `Life card revealed: ${lifeCard.name} — has Trigger!`, 'damage');
    } else {
      // No trigger (or AI): card goes to hand
      s = addLog({
        ...s,
        battle: null,
        waitingFor: s.activePlayer,
        [targetOwner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, hand: [...defPs.hand, lifeCard] },
      }, `Damage! Life → hand. Life remaining: ${newLife.length}.`, 'damage');

      if (isDoubleAtk && newLife.length > 0) {
        // Double Attack: deal second damage immediately
        s = applyResolveDamage({
          ...s,
          battle: { ...battle, step: BATTLE_STEP.DAMAGE, defPower: 0 },
        });
      }
    }

    // Win check: life = 0 AND leader is hit again = win
    // (The rule is: win when life = 0 AND attack succeeds against leader)
    if (s[targetOwner]?.lifeArea?.length === 0 && !s.pendingTrigger) {
      // Next successful attack against this leader = win.
      // Mark the leader as "0 life" — already tracked by lifeArea.length === 0.
    }

  } else {
    // KO the target character
    const defPs = s[targetOwner];
    const koFC  = defPs.characterArea[targetIndex];

    const returnedDon = Array.from({ length: koFC.attachedDon }, (_, i) =>
      ({ ...makeDon(`ko-${i}`), state: 'rest' })
    );

    s = addLog({
      ...s,
      battle: null,
      waitingFor: s.activePlayer,
      [targetOwner]: {
        ...defPs,
        characterArea: defPs.characterArea.filter((_, i) => i !== targetIndex),
        trash: [...defPs.trash, koFC.card],
        costArea: [...defPs.costArea, ...returnedDon],
      },
    }, `${koFC.card.name} was KO'd!`, 'battle');

    // Fire KO-timing effects on the KO'd card
    if (koFC.card?.effect?.includes('KO時')) {
      s = resolveOnKOEffect(koFC.card, s, targetOwner);
    }
  }

  // Clear battle-duration power mods (unless trigger is pending — clear after trigger resolves)
  if (!s.pendingTrigger) s = clearBattleMods(s);

  const winner = checkWinner(s);
  return winner ? { ...s, winner } : s;
}

// ── Resolve Trigger ───────────────────────────────────────────────────────

export function applyResolveTrigger(state, { activate }) {
  const t = state.pendingTrigger;
  if (!t) return state;

  const ps = state[t.owner];

  if (!activate) {
    const withCard = {
      ...state,
      pendingTrigger: null,
      waitingFor: state.activePlayer,
      [t.owner]: { ...ps, hand: [...ps.hand, t.lifeCard] },
    };
    return addLog(withCard, `Trigger declined. ${t.lifeCard.name} added to hand.`, 'info');
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
  return addLog(afterTrigger, `Trigger activated: ${t.lifeCard.name}.`, 'action');
}

// ── Activate: Main ───────────────────────────────────────────────────────────

export function applyActivateMain(state, { zone, index }) {
  const p = state.activePlayer;
  if (state.phase !== PHASE.MAIN || state.battle) return state;

  const ps = state[p];
  const fc = zone === 'leader' ? ps.leader : zone === 'stage' ? ps.stageArea : ps.characterArea[index];
  if (!fc) return state;

  return resolveActivatedMainEffect(fc.card, state, p, zone, index);
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
  const newChars = ps.characterArea.map((fc, i) =>
    i === replaceIndex ? makeFieldCard(card, { justDeployed: !hasRush(card) }) : fc
  );
  const newHand = type === 'DEPLOY'
    ? ps.hand.filter((_, i) => i !== pr.handIndex)
    : ps.hand;
  const newTrash = type === 'DEPLOY_FROM_TRASH'
    ? [...ps.trash.filter((_, i) => i !== pr.trashIndex), replaceFC.card]
    : [...ps.trash, replaceFC.card];

  const s = addLog({
    ...state,
    pendingReplace: null,
    [owner]: {
      ...ps,
      hand: newHand,
      characterArea: newChars,
      trash: newTrash,
      costArea: [...ps.costArea, ...returnedDon],
    },
  }, `Replaced ${replaceFC.card.name} with ${card.name}.`, 'action');

  if (type === 'PLAY_CHARACTER') {
    return resolveOnPlayEffect(card, s, owner);
  }
  // DEPLOY_FROM_TRASH: queue on-play trigger for the replaced-in card
  if (type === 'DEPLOY_FROM_TRASH') {
    s = { ...s, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card, owner }] };
  }
  // DEPLOY / DEPLOY_FROM_TRASH: resume the effect chain that was interrupted
  let afterCont = executeActionSequence(s, owner, pr.continuation, pr.sourceCard, pr.effectKey);
  // If the continuation settled, drain any queued on-play triggers
  if (!afterCont.pendingEffect && !afterCont.pendingReplace && afterCont.pendingOnPlayTriggers?.length) {
    const triggers = afterCont.pendingOnPlayTriggers;
    afterCont = { ...afterCont, pendingOnPlayTriggers: [] };
    for (const { card: trigCard, owner: trigOwner } of triggers) {
      afterCont = resolveOnPlayEffect(trigCard, afterCont, trigOwner);
      if (afterCont.pendingEffect || afterCont.pendingReplace) break;
    }
  }
  return afterCont;
}

// ── End Turn ──────────────────────────────────────────────────────────────

export function applyEndTurn(state) {
  const current = state.activePlayer;
  const next    = current === PLAYER.HUMAN ? PLAYER.AI : PLAYER.HUMAN;
  const newTurn = next === state.firstPlayer ? state.turn + 1 : state.turn;

  // Fire end-of-turn effects before switching player
  let s = resolveEndOfTurnEffects(state, current);

  // Clear justDeployed and rushCharOnly on the current player's characters
  const cleanChars = s[current].characterArea.map(fc => ({ ...fc, justDeployed: false, rushCharOnly: false }));

  return addLog({
    ...s,
    activePlayer: next,
    waitingFor: next,
    phase: PHASE.REFRESH,
    turn: newTurn,
    [current]: { ...s[current], characterArea: cleanChars },
  }, `─── Turn ${newTurn}: ${next === PLAYER.HUMAN ? 'Your turn' : "AI's turn"} ───`, 'phase');
}

// ---------------------------------------------------------------------------
// Central reducer
// ---------------------------------------------------------------------------

export function gameReducer(state, action) {
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
      let s = resolveEffectChoice(state, action);
      // Fire on-play effects for any cards deployed from trash by this choice
      if (!s.pendingEffect && !s.pendingReplace && s.pendingOnPlayTriggers?.length) {
        const triggers = s.pendingOnPlayTriggers;
        s = { ...s, pendingOnPlayTriggers: [] };
        for (const { card, owner: tOwner } of triggers) {
          s = resolveOnPlayEffect(card, s, tOwner);
          if (s.pendingEffect || s.pendingReplace) break;
        }
      }
      // If an on-attack interactive effect just resolved and there's a pending battle,
      // finalize the battle declaration now that the effect is done.
      if (!s.pendingEffect && !s.pendingReplace && s.pendingBattle) {
        const { attacker, attackerZone, attackerIndex, targetOwner, targetZone, targetIndex, attackerName } = s.pendingBattle;
        s = finalizeBattleDeclaration({ ...s, pendingBattle: null }, attacker, attackerZone, attackerIndex, targetOwner, targetZone, targetIndex, attackerName);
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
    case 'MULLIGAN_KEEP':     return applyMulliganKeep(state);
    case 'MULLIGAN_REDRAW':   return applyMulliganRedraw(state);
    default:                  return state;
  }
}
