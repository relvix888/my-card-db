import {
  PHASE, BATTLE_STEP, PLAYER,
  DON_PER_TURN, FIRST_TURN_DON,
  STARTING_HAND, MAX_CHARACTERS,
} from './constants';
import {
  hasRush, hasCharacterRushOnly, hasTrigger, leaderDonDeckSize,
  resolveOnPlayEffect, resolveOnAttackEffect, resolveOnBlockEffect,
  resolveOnKOEffect, resolveLeaderKOWatchEffect, resolveLeaderKOReplacementEffect, resolveStageKOReplacementEffect, resolveOpponentKOWatchEffect, resolveCharacterLeaveFieldEffect, resolveLeaderOwnCharRemovedEffect, resolveLeaderOwnTraitCharLeaveEffect, resolveTriggerEffect, resolveEventEffect, resolveCounterEffect, resolveSelfEventActivateEffect,
  resolveEndOfTurnEffects, resolveOnTurnStartEffects, resolveEotEffectChoice, resumeEotSequence, resolveActivatedMainEffect, evaluateContinuousPower,
  interceptOnPlayOrder, resolveOnPlayOrderChoice, resumeOnPlayOrderSequence,
  resolveOnOpponentAttackEffect, evaluateContinuousKeywords, evaluateGlobalContinuousPower,
  evaluateLeaderBasePowerOverride, evaluateCharBasePowerOverride, resolveOnLifeZeroEffect, resolveOnLifeLeaveEffect, resolveOnDamageTakenEffect, resolveOnDealDamageEffect,
  fcEffectiveHasDoubleAtk, fcHasBanish, fcHasUnblock, leaderHasDeployRestPassive, leaderHasRushCharsPassive,
  resolveOpponentEventOrCounterEffect, resolveAutoKOInBattle, resolveOnOpponentCharDeployEffect,
  resolveOnDonAttachTrigger, resolveOnSelfNoEffectCharDeployEffect, resolveOnSelfAnyCharDeployEffect,
  getEffectiveCounter, computeEventTargets, computeFieldEffectTargets,
} from './effects';
import { resolveEffectChoice, executeActionSequence, clearPowerMods, clearCostMods, clearHandCostMods, matchesFilter, getSelfCondHandCostDelta, shiftModsAfterRemoval, fireDonReturnEffects } from './effectActions';
import { getLeaderProfile } from './leaderProfiles';

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
  return { card, state: 'active', attachedDon: 0, justDeployed: false, deployedThisTurn: false, _fcId: `fc-${Math.random()}`, ...opts };
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
    donDeckMax: donSize,  // cap: total DON!! in system never exceeds this
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
    handTrashedByEffectThisTurn: false, // true once a hand card is trashed by an effect this turn; cleared on Refresh
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export function createInitialState(hostLeader, hostCards, guestLeader, guestCards) {
  const firstPlayer = Math.random() < 0.5 ? PLAYER.HOST : PLAYER.GUEST;
  const hostLeaderId = hostLeader?.id?.replace('_p1', '').replace('_p2', '');
  const guestLeaderId    = guestLeader?.id?.replace('_p1', '').replace('_p2', '');
  const preGameAbilityOwner =
    hostLeaderId === 'OP13-079' ? PLAYER.HOST :
    guestLeaderId    === 'OP13-079' ? PLAYER.GUEST    : null;
  const preGameAbility = preGameAbilityOwner ? 'STAGE_SEARCH' : null;
  return {
    phase: PHASE.REFRESH,
    firstPlayer,
    activePlayer: firstPlayer,
    waitingFor: firstPlayer,
    turn: 1,
    winner: null,
    mulligan: 'pending', // 'pending' | 'done'
    preGameAbility,      // 'STAGE_SEARCH' | null
    preGameAbilityOwner, // PLAYER.HOST | PLAYER.GUEST | null

    host: buildPlayerState(hostLeader, hostCards),
    guest: buildPlayerState(guestLeader, guestCards),

    devRevealOpponent: false,

    battle: null,
    pendingTrigger: null,
    pendingReplace: null,
    pendingOpponentDeployTrigger: null,
    pendingSelfDeployTrigger: null,
    pendingSelfAnyCharDeployTrigger: null,
    sotEffectsDone: false,

    log: [{ text: 'Game started — choose your starting hand.', type: 'info', id: Date.now() }],
  };
}

// ── Leader Pre-Game Ability ───────────────────────────────────────────────────

export function applyLeaderPreGameStage(state, { cardIndex }) {
  if (state.preGameAbility !== 'STAGE_SEARCH') return state;
  const owner = state.preGameAbilityOwner ?? PLAYER.HOST;
  let s = { ...state, preGameAbility: null, preGameAbilityOwner: null };
  if (cardIndex != null) {
    const ps = s[owner];
    const card = ps.deck[cardIndex];
    if (card && card.category === 'Stage') {
      const newDeck = ps.deck.filter((_, i) => i !== cardIndex);
      s = addLog({
        ...s,
        [owner]: { ...ps, deck: newDeck, stageArea: makeFieldCard(card) },
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
  const ps = state.host;
  // Return hand to deck, shuffle, redraw same number
  const combined = shuffle([...ps.deck, ...ps.hand]);
  const newHand = combined.slice(0, STARTING_HAND);
  const newDeck = combined.slice(STARTING_HAND);
  return addLog({
    ...state,
    mulligan: 'done',
    host: { ...ps, hand: newHand, deck: newDeck },
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
    const setBaseMods = relevantMods.filter(m => m.setBase !== undefined);
    if (setBaseMods.length > 0) {
      // Timed POWER_SET takes priority over continuous SET_BASE_POWER
      base = setBaseMods[setBaseMods.length - 1].setBase;
    } else if (isLeader) {
      const baseOverride = evaluateLeaderBasePowerOverride(fieldCard, activePlayer, owner, state);
      if (baseOverride !== null) base = baseOverride;
    } else {
      const charOverride = evaluateCharBasePowerOverride(fieldCard, activePlayer, owner, state);
      if (charOverride !== null) base = charOverride;
    }
    modBonus = relevantMods.filter(m => m.setBase === undefined).reduce((sum, m) => sum + (m.delta ?? 0), 0);
    modBonus += evaluateContinuousPower(fieldCard, activePlayer, owner, state);
    modBonus += evaluateGlobalContinuousPower(fieldCard, activePlayer, owner, state);
  }

  return base + donBonus + modBonus;
}

// ---------------------------------------------------------------------------
// Win condition
// ---------------------------------------------------------------------------

// Returns true when the player's leader overrides the normal deck-empty loss
// (e.g. OP15-022 Brook: "lose at end of TURN when deck=0", not immediately).
function leaderHasDeckEmptyException(state, player) {
  const effect = state[player]?.leader?.card?.effect ?? '';
  return effect.includes('即使自己的卡組0張卡片，也不會輸掉遊戲');
}

// Returns true when the player's leader flips the deck-empty rule to a WIN instead of a loss
// (e.g. OP03-040 Nami: "when your deck hits 0, you win instead of losing").
function leaderWinsOnDeckEmpty(state, player) {
  const effect = state[player]?.leader?.card?.effect ?? '';
  return effect.includes('自己的卡組為0張卡片時，自己將獲勝');
}

export function checkWinner(state) {
  if (state.host.deck.length === 0) {
    if (leaderWinsOnDeckEmpty(state, PLAYER.HOST)) return PLAYER.HOST;
    if (!leaderHasDeckEmptyException(state, PLAYER.HOST)) return PLAYER.GUEST;
  }
  if (state.guest.deck.length === 0) {
    if (leaderWinsOnDeckEmpty(state, PLAYER.GUEST)) return PLAYER.GUEST;
    if (!leaderHasDeckEmptyException(state, PLAYER.GUEST)) return PLAYER.HOST;
  }
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

export function getEffectiveCost(card, handCostMods) {
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
    const ordered = interceptOnPlayOrder(state, triggers);
    if (ordered) return ordered;
    let s = { ...state, pendingOnPlayTriggers: [] };
    for (const { card, owner } of triggers) {
      s = resolveOnPlayEffect(card, s, owner);
      if (s.pendingEffect || s.pendingReplace) break;
    }
    return drainOnPlayTriggers(s);
  }
  // After on-play triggers are exhausted, fire any opponent-deploy reactive trigger
  // (e.g. OP12-081: "when opponent deploys cost 8+ char, opponent adds 1 life to hand")
  if (!state.pendingEffect && !state.pendingReplace && !state.battle && !state.pendingOnPlayTriggers?.length && state.pendingOpponentDeployTrigger) {
    const trig = state.pendingOpponentDeployTrigger;
    return drainOnPlayTriggers(resolveOnOpponentCharDeployEffect(trig.card, { ...state, pendingOpponentDeployTrigger: null }, trig.deployOwner, trig.isViaCharEffect));
  }
  // Fire self-deploy leader triggers (e.g. OP02-026: when you deploy a no-effect character)
  if (!state.pendingEffect && !state.pendingReplace && !state.battle && !state.pendingOnPlayTriggers?.length && !state.pendingOpponentDeployTrigger && state.pendingSelfDeployTrigger) {
    const trig = state.pendingSelfDeployTrigger;
    return drainOnPlayTriggers(resolveOnSelfNoEffectCharDeployEffect(trig.card, { ...state, pendingSelfDeployTrigger: null }, trig.owner));
  }
  // Fire any-character self-deploy leader triggers (e.g. OP14-041: draw when you deploy any character)
  if (!state.pendingEffect && !state.pendingReplace && !state.battle && !state.pendingOnPlayTriggers?.length && !state.pendingOpponentDeployTrigger && !state.pendingSelfDeployTrigger && state.pendingSelfAnyCharDeployTrigger) {
    const trig = state.pendingSelfAnyCharDeployTrigger;
    return drainOnPlayTriggers(resolveOnSelfAnyCharDeployEffect(trig.card, { ...state, pendingSelfAnyCharDeployTrigger: null }, trig.owner));
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

  // "我方回合開始時" effects fire before cards are unrest.
  // sotEffectsDone prevents re-prompting if the player declines and clicks Refresh again.
  if (!state.sotEffectsDone) {
    const s = resolveOnTurnStartEffects({ ...state, sotEffectsDone: true }, p);
    if (s.pendingEffect) return s;
    state = s;
  }

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

  // Unrest all cost-area DON (skip refreshLocked ones) and add returned attached DON back as active
  const returnDons = Array.from({ length: returnedDon }, (_, i) => makeDon(`ref-ret-${i}`));
  const freshCost  = [
    ...ps.costArea.map(d => d.refreshLocked ? { ...d, state: 'rest', refreshLocked: false } : { ...d, state: 'active' }),
    ...returnDons,
  ];

  // Clear once-per-turn effect limits, turn-duration power mods, and per-turn trigger registrations
  let s = {
    ...state,
    phase: PHASE.DRAW,
    pendingOpponentDeployTrigger: null,
    pendingSelfDeployTrigger: null,
    pendingSelfAnyCharDeployTrigger: null,
    [p]: {
      ...ps,
      leader: freshLeader, characterArea: freshChars,
      stageArea: freshStage, costArea: freshCost,
      effectUsed: {},
      onEventTriggers: [],
      eventsPlayedThisTurn: [],
      lastDiscardCount: 0,
      handTrashedByEffectThisTurn: false,
      deployBlockedThisTurn: false,
      deployBlockCost: null,
      donUnrestByCharLocked: false,
      handPlayLocked: false,
      lifeToHandBlocked: false,
    },
  };
  s = clearPowerMods(s, p, 'turn');
  s = clearPowerMods(s, p, 'opponent_turn_end');
  s = clearPowerMods(s, p, 'startOfOwnTurn'); // "until start of your next turn" — same clearing point as opponent_turn_end
  s = clearCostMods(s, p, 'turn');
  s = clearCostMods(s, p, 'opponent_turn_end');
  s = clearHandCostMods(s, p, 'turn');
  s = clearHandCostMods(s, p, 'next_play');
  s = clearHandCostMods(s, p, 'opponent_turn_end');

  // Clear opponent_turn_end keyword grants on p's field cards (the opponent's turn just ended)
  const refreshedCharsKws = s[p].characterArea.map(fc => ({ ...fc, opponentTurnEndKeywords: [] }));
  const refreshedLeaderKws = { ...s[p].leader, opponentTurnEndKeywords: [] };
  s = { ...s, [p]: { ...s[p], characterArea: refreshedCharsKws, leader: refreshedLeaderKws } };

  // Clear the opponent's onPlayBlocked flag — it was set to last "until end of their next turn"
  // and that turn just ended now that the active player is refreshing.
  const oppPlayer = p === PLAYER.HOST ? PLAYER.GUEST : PLAYER.HOST;
  if (s[oppPlayer]?.onPlayBlocked) {
    s = { ...s, [oppPlayer]: { ...s[oppPlayer], onPlayBlocked: false } };
  }

  s = addLog({ ...s, sotEffectsDone: false }, `Refresh Phase.`, 'phase');
  // Fire '咚‼卡被放回時' if any attached DON!! was returned (e.g. OP02-071 Magellan)
  if (returnedDon > 0) s = fireDonReturnEffects(s, p, returnedDon);
  return s;
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
    if (leaderHasDeckEmptyException(state, p)) {
      // Leader overrides immediate loss — player loses at end of turn instead (handled in applyEndTurn).
      return { ...state, phase: PHASE.DON };
    }
    return { ...state, winner: p === PLAYER.HOST ? PLAYER.GUEST : PLAYER.HOST };
  }

  const drawn = ps.deck[ps.deck.length - 1];
  const baseDrawState = { ...state, phase: PHASE.DON, [p]: { ...ps, hand: [...ps.hand, drawn], deck: ps.deck.slice(0, -1) } };
  return addLog(appendFlash(baseDrawState, drawn, 'DRAW', { forPlayer: p }), `Drew 1 card.`, 'info');
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
  const maxDon = ps.donDeckMax ?? 10;
  const inField = ps.costArea.length
    + (ps.leader?.attachedDon ?? 0)
    + ps.characterArea.reduce((acc, fc) => acc + (fc.attachedDon ?? 0), 0);
  const headroom = Math.max(0, maxDon - inField);
  const gain = isFirstTurn
    ? Math.min(FIRST_TURN_DON, ps.donDeck.length, headroom)
    : Math.min(DON_PER_TURN, ps.donDeck.length, headroom);

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
  const charEffectiveCost = Math.max(0, getEffectiveCost(card, ps.handCostMods) + getSelfCondHandCostDelta(card, state, p));
  if (!canAfford(ps.costArea, charEffectiveCost)) return state;
  if (ps.deployBlockedThisTurn) return state;
  if (ps.deployBlockCost) {
    const { threshold, op } = ps.deployBlockCost;
    const originalCost = card.cost ?? 0;
    if (op === 'gte' && originalCost >= threshold) return state;
    if (op === 'lte' && originalCost <= threshold) return state;
  }
  if (ps.handPlayLocked) return addLog(state, '本回合無法使用手牌中的卡片。', 'info');

  const newCost = spendDon(ps.costArea, charEffectiveCost);
  const newHand = ps.hand.filter((_, i) => i !== handIndex);

  // Consume one-shot "next_play" cost mods that matched this card (e.g. OP12-061).
  const newHandCostMods = (ps.handCostMods ?? []).filter(
    m => !(m.until === 'next_play' && (!m.filter || matchesFilter(card, m.filter)))
  );

  if (ps.characterArea.length >= MAX_CHARACTERS) {
    if (p === PLAYER.GUEST) {
      const lowestIdx  = findLowestPowerIndex(ps.characterArea);
      const replaceFC  = ps.characterArea[lowestIdx];
      const returnedDon = Array.from({ length: replaceFC.attachedDon }, (_, i) =>
        ({ _donId: `don-rpl-${i}-${Math.random()}`, state: 'rest' })
      );
      const enterRestedAI   = leaderHasDeployRestPassive(state, p);
      const isCharRushAI    = hasCharacterRushOnly(card) || leaderHasRushCharsPassive(state, p, card);
      const newCharFCAI = makeFieldCard(card, { justDeployed: !hasRush(card) && !isCharRushAI, deployedThisTurn: true, ...(isCharRushAI && { rushCharOnly: true }), ...(enterRestedAI && { state: 'rest' }) });
      const newChars = ps.characterArea.map((fc, i) => i === lowestIdx ? newCharFCAI : fc);
      const placed = addLog(appendFlash({
        ...state,
        [p]: {
          ...ps, hand: newHand, costArea: [...newCost, ...returnedDon],
          handCostMods: newHandCostMods,
          characterArea: newChars, trash: [...ps.trash, replaceFC.card],
        },
      }, card, 'PLAY_CHARACTER', { fieldFcId: newCharFCAI._fcId }), `AI played ${cn(card)}, replacing ${cn(replaceFC.card)} (Cost ${card.cost ?? 0}).`, 'action');
      const aiReplaceTargets = ['登場時', 'On Play'].flatMap(t => computeFieldEffectTargets(card, placed, p, t));
      const placedAiReplace = aiReplaceTargets.length > 0
        ? { ...placed, pendingOnPlayOverlay: { card, targets: aiReplaceTargets, sourceSelector: `[data-field-card="${p}-character-${lowestIdx}"]` } }
        : placed;
      const afterAiReplace = resolveOnPlayEffect(card, placedAiReplace, p);
      if (!afterAiReplace.pendingEffect && !afterAiReplace.pendingReplace) return drainOnPlayTriggers(afterAiReplace);
      return afterAiReplace;
    }
    // Human: pause and ask which character to replace
    return addLog({
      ...state,
      pendingReplace: { type: 'PLAY_CHARACTER', owner: p, card },
      [p]: { ...ps, hand: newHand, costArea: newCost, handCostMods: newHandCostMods },
    }, `Played ${cn(card)} — choose a character to replace.`, 'action');
  }

  const enterRested = leaderHasDeployRestPassive(state, p);
  const isCharRush  = hasCharacterRushOnly(card) || leaderHasRushCharsPassive(state, p, card);
  const fieldCard = makeFieldCard(card, { justDeployed: !hasRush(card) && !isCharRush, deployedThisTurn: true, ...(isCharRush && { rushCharOnly: true }), ...(enterRested && { state: 'rest' }) });
  const placed = addLog(appendFlash({
    ...state,
    pendingOpponentDeployTrigger: { card, deployOwner: p, isViaCharEffect: false },
    pendingSelfDeployTrigger: { card, owner: p },
    pendingSelfAnyCharDeployTrigger: { card, owner: p },
    [p]: { ...ps, hand: newHand, costArea: newCost, handCostMods: newHandCostMods, characterArea: [...ps.characterArea, fieldCard] },
  }, card, 'PLAY_CHARACTER', { fieldFcId: fieldCard._fcId }), `Played ${cn(card)} (Cost ${card.cost ?? 0}).`, 'action');

  const newCharIndex = ps.characterArea.length;
  const onPlayTargets = ['登場時', 'On Play'].flatMap(t => computeFieldEffectTargets(card, placed, p, t));
  const placedWithPending = onPlayTargets.length > 0
    ? { ...placed, pendingOnPlayOverlay: { card, targets: onPlayTargets, sourceSelector: `[data-field-card="${p}-character-${newCharIndex}"]` } }
    : placed;

  // Drain on-play triggers queued by DEPLOY effects (e.g. OP16-085 deploying OP16-082).
  // Only applies when no pendingEffect; human path drains via RESOLVE_EFFECT_CHOICE.
  const after = resolveOnPlayEffect(card, placedWithPending, p);
  if (!after.pendingEffect && !after.pendingReplace) return drainOnPlayTriggers(after);
  return after;
}

// ── Play Stage ────────────────────────────────────────────────────────────

export function applyPlayStage(state, { handIndex }) {
  const p = state.activePlayer;
  const ps = state[p];
  const card = ps.hand[handIndex];

  if (!card || card.category !== 'Stage') return state;
  if (ps.handPlayLocked) return addLog(state, '本回合無法使用手牌中的卡片。', 'info');
  const stageEffectiveCost = getEffectiveCost(card, ps.handCostMods);
  if (!canAfford(ps.costArea, stageEffectiveCost)) return state;

  const newCost   = spendDon(ps.costArea, stageEffectiveCost);
  const newHand   = ps.hand.filter((_, i) => i !== handIndex);
  const newTrash  = ps.stageArea ? [...ps.trash, ps.stageArea.card] : ps.trash;
  const stageFC   = makeFieldCard(card);

  const placed = addLog(appendFlash({
    ...state,
    [p]: { ...ps, hand: newHand, costArea: newCost, stageArea: stageFC, trash: newTrash },
  }, card, 'PLAY_STAGE', { fieldFcId: stageFC._fcId }), `Played Stage: ${cn(card)}.`, 'action');
  return resolveOnPlayEffect(card, placed, p);
}

// ── Play Event ────────────────────────────────────────────────────────────

export function applyPlayEvent(state, { handIndex }) {
  const p = state.activePlayer;
  const ps = state[p];
  const card = ps.hand[handIndex];

  if (!card || card.category !== 'Event') return state;
  if (ps.handPlayLocked) return addLog(state, '本回合無法使用手牌中的卡片。', 'info');
  const eventEffectiveCost = Math.max(0, getEffectiveCost(card, ps.handCostMods) + getSelfCondHandCostDelta(card, state, p));
  if (!canAfford(ps.costArea, eventEffectiveCost)) return state;

  const newCost  = spendDon(ps.costArea, eventEffectiveCost);
  const newHand  = ps.hand.filter((_, i) => i !== handIndex);

  // Compute targets before resolveEventEffect so KO'd cards are still on the field
  const eventTargets = computeEventTargets(card, { ...state, [p]: { ...ps, hand: newHand, costArea: newCost } }, p);
  const afterCost = addLog({
    ...state,
    [p]: { ...ps, hand: newHand, costArea: newCost, eventsPlayedThisTurn: [...(ps.eventsPlayedThisTurn ?? []), card] },
    eventOverlay: { card, targets: eventTargets },
  }, `Activated Event: ${cn(card)} (Cost ${card.cost ?? 0}).`, 'action');

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

  // Fire 「自己發動事件卡時」 on the event-activating player's leader/field cards (e.g. OP10-003).
  if (!s.pendingEffect) s = resolveSelfEventActivateEffect(s, p);

  // Fire 「對手發動事件卡或【防禦】時」 on the non-active player's field cards (e.g. OP15-119).
  const oppPlayer = p === PLAYER.HOST ? PLAYER.GUEST : PLAYER.HOST;
  if (!s.pendingEffect) s = resolveOpponentEventOrCounterEffect(s, oppPlayer);

  const finalPs = s[p];
  let result = { ...s, [p]: { ...finalPs, trash: [...finalPs.trash, card] } };
  // Drain KO-timing effects queued by the event's KO actions (e.g. OP09-077 KO'ing a
  // character with an [On K.O.] effect). Without this the queue lingers until the next
  // RESOLVE_EFFECT_CHOICE, firing the KO effect at the wrong time.
  if (!result.pendingEffect && !result.pendingReplace && result.pendingKOEffects?.length) {
    const koEffects = result.pendingKOEffects;
    result = { ...result, pendingKOEffects: [] };
    for (const { card: koCard, owner: koOwner, attachedDon: koDon } of koEffects) {
      result = resolveOnKOEffect(koCard, result, koOwner, koDon ?? 0);
      if (!result.pendingEffect && !result.pendingReplace)
        result = resolveLeaderKOWatchEffect(koCard, result, koOwner);
      if (result.pendingEffect || result.pendingReplace) break;
    }
  }
  // Drain on-play triggers queued by DEPLOY effects (e.g. ST22-015 deploying OP13-042).
  // Only applies when AI played the event (no pendingEffect); human path drains via RESOLVE_EFFECT_CHOICE.
  if (!result.pendingEffect) result = drainOnPlayTriggers(result);
  return result;
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

  const targetFC = targetZone === 'leader' ? ps.leader : ps.characterArea[targetIndex];
  const targetName = targetFC ? cn(targetFC.card) : targetZone;
  const afterAttach = addLog({ ...state, [p]: newPs }, `Attached ${attached} DON!! to ${targetName}.`, 'action');
  return resolveOnDonAttachTrigger(afterAttach, p);
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
    [p]: {
      ...ps,
      characterArea: newChars,
      powerMods: shiftModsAfterRemoval(ps.powerMods ?? [], index),
      costMods:  shiftModsAfterRemoval(ps.costMods  ?? [], index),
      trash: [...ps.trash, fc.card],
      costArea: [...ps.costArea, ...returnedDon],
    },
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
  let charContKws = null;
  if (attackerZone === 'leader') {
    if (ps.leader.state !== 'active') return state;
    attackerFC = ps.leader;
    if (evaluateContinuousKeywords(attackerFC, attacker, attacker, state).has('CANNOT_ATTACK')) return state;
  } else {
    attackerFC = ps.characterArea[attackerIndex];
    charContKws = evaluateContinuousKeywords(attackerFC, attacker, attacker, state);
    const hasRushCharsOnly = charContKws.has('RUSH_CHARS_ONLY');
    const blockedByDeploy = attackerFC?.justDeployed && !charContKws.has('速攻') && !hasRushCharsOnly;
    if (!attackerFC || attackerFC.state !== 'active' || blockedByDeploy || charContKws.has('CANNOT_ATTACK') || attackerFC.restLocked || attackerFC.attackLocked) return state;
  }

  // Validate target: leader or rested enemy character
  const defPs = state[targetOwner];
  // Rush: Character — may only attack characters (not leader) on the deploy turn
  const hasRushCharOnlyFlag = attackerFC?.rushCharOnly || (charContKws?.has('RUSH_CHARS_ONLY') ?? false);
  if (targetZone === 'leader' && attackerZone === 'character' && hasRushCharOnlyFlag) return state;
  if (targetZone === 'character') {
    const tgt = defPs.characterArea[targetIndex];
    if (!tgt) return state;
    const canHitActive = attackerFC.tempKeywords?.includes('RUSH_ACTIVE_CHARS');
    if (!canHitActive && tgt.state !== 'rest') return state;
    // Check attack cost restriction (e.g. OP12-020): only applies after the leader has re-stood.
    // While reactivateAfterCharBattle is still true the leader hasn't used its re-stand yet,
    // so the restriction hasn't kicked in — any character is a legal target.
    if (attackerFC.attackCostRestriction && !attackerFC.reactivateAfterCharBattle
        && (tgt.card?.cost ?? 0) <= attackerFC.attackCostRestriction.costMax) return state;
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
      targetCardId: targetZone === 'character' ? defPs2.characterArea[targetIndex]?.card.id ?? null : null,
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
  // If the effect was instant (no human interaction pending), recalculate both
  // defPower and atkPower in case a power mod was applied to either side
  // (e.g. OP15-002 boosts defender; OP13-002 Ace reduces attacker).
  if (!s.pendingEffect && s.battle) {
    // Use s.battle.target* — a REDIRECT_ATTACK_TARGET effect may have changed these during the scan.
    const curTargetOwner = s.battle.targetOwner;
    const curTargetZone  = s.battle.targetZone;
    const curTargetIndex = s.battle.targetIndex;
    const defFC = curTargetZone === 'leader'
      ? s[curTargetOwner].leader
      : s[curTargetOwner].characterArea[curTargetIndex];
    if (defFC) {
      const newDefPower = calcPower(defFC, attacker, curTargetOwner, s);
      if (newDefPower !== s.battle.defPower) {
        s = { ...s, battle: { ...s.battle, defPower: newDefPower } };
      }
    }
    const atkFC = attackerZone === 'leader'
      ? s[attacker].leader
      : s[attacker].characterArea[attackerIndex];
    if (atkFC) {
      const newAtkPower = calcPower(atkFC, attacker, attacker, s);
      if (newAtkPower !== s.battle.atkPower) {
        s = { ...s, battle: { ...s.battle, atkPower: newAtkPower } };
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
  // Leader re-activation after attacking a character (e.g. OP12-020 Zoro).
  if (attackerZone === 'leader' && targetZone === 'character' && s[attacker].leader.reactivateAfterCharBattle) {
    s = { ...s, [attacker]: { ...s[attacker], leader: { ...s[attacker].leader, state: 'active', reactivateAfterCharBattle: false } } };
  }
  return s;
}

// ── Blocker ───────────────────────────────────────────────────────────────

export function applyUseBlocker(state, { blockerIndex }) {
  const battle = state.battle;
  if (!battle || battle.step !== BATTLE_STEP.BLOCK || battle.blockerUsed) return state;

  const defender = battle.targetOwner;
  const defPs = state[defender];

  const isLeaderBlocker = blockerIndex === 'leader';
  const blocker = isLeaderBlocker ? defPs.leader : defPs.characterArea[blockerIndex];
  if (!blocker || blocker.state !== 'active' || blocker.blockerDisabled) return state;

  // Can't use the current attack target as its own Blocker — it's already the target.
  // This prevents a redirect target (e.g. from OP16-080's effect) from being rested
  // by accidentally blocking itself, which would leave it stuck rested for the turn.
  if (isLeaderBlocker && battle.targetZone === 'leader') return state;
  if (!isLeaderBlocker && battle.targetZone === 'character' && blockerIndex === battle.targetIndex) return state;

  let s;
  if (isLeaderBlocker) {
    s = { ...state, [defender]: { ...defPs, leader: { ...defPs.leader, state: 'rest' } } };
    s = resolveOnBlockEffect(blocker.card, s, defender, 'leader');
  } else {
    const newChars = defPs.characterArea.map((fc, i) =>
      i === blockerIndex ? { ...fc, state: 'rest' } : fc
    );
    s = { ...state, [defender]: { ...defPs, characterArea: newChars } };
    s = resolveOnBlockEffect(blocker.card, s, defender, blockerIndex);
  }

  // Fire 「對手發動事件卡或【防禦】時」 on the attacker's field cards (e.g. OP15-119).
  // From the attacker's perspective, the opponent (defender) just used a blocker.
  if (!s.pendingEffect) s = resolveOpponentEventOrCounterEffect(s, battle.attackerOwner);

  const blockerFC = isLeaderBlocker ? s[defender].leader : s[defender].characterArea[blockerIndex];
  const newDefPower = calcPower(blockerFC, battle.attackerOwner, defender, s);
  const atkFC = battle.attackerZone === 'leader'
    ? s[battle.attackerOwner].leader
    : s[battle.attackerOwner].characterArea[battle.attackerIndex];
  const newAtkPower = atkFC ? calcPower(atkFC, battle.attackerOwner, battle.attackerOwner, s) : battle.atkPower;

  return addLog({
    ...s,
    battle: {
      ...battle,
      step: BATTLE_STEP.COUNTER,
      targetZone: isLeaderBlocker ? 'leader' : 'character',
      targetIndex: isLeaderBlocker ? -1 : blockerIndex,
      targetCardId: blockerFC?.card.id ?? null,
      atkPower: newAtkPower,
      defPower: newDefPower,
      blockerUsed: true,
      // save original target so Unblock can restore it
      preBlockTargetZone: battle.targetZone,
      preBlockTargetIndex: battle.targetIndex,
      preBlockTargetCardId: battle.targetCardId ?? null,
      preBlockDefPower: battle.defPower,
      blockerIndex,
    },
  }, `Blocker! ${cn(blocker.card)} intercepts (${newDefPower}).`, 'battle');
}

export function applyUnblock(state) {
  const { battle } = state;
  if (!battle || !battle.blockerUsed) return state;

  const defender = battle.targetOwner;
  const defPs = state[defender];

  // blockerIndex saved explicitly, or fall back to current targetIndex (same value after applyUseBlocker)
  const blockerIdx = battle.blockerIndex ?? battle.targetIndex;
  const blocker = defPs?.characterArea?.[blockerIdx];
  if (!blocker) return state;

  const newChars = defPs.characterArea.map((fc, i) =>
    i === blockerIdx ? { ...fc, state: 'active' } : fc
  );

  // Restore original attack target; fall back to leader if preBlock fields are missing
  const restoredZone  = battle.preBlockTargetZone  ?? 'leader';
  const restoredIndex = battle.preBlockTargetIndex ?? -1;
  const restoredPower = battle.preBlockDefPower
    ?? calcPower(
        restoredZone === 'leader' ? state[defender].leader : state[defender].characterArea[restoredIndex],
        battle.attackerOwner, defender, state
      );

  return addLog({
    ...state,
    waitingFor: defender,
    [defender]: { ...defPs, characterArea: newChars },
    battle: {
      ...battle,
      step: BATTLE_STEP.BLOCK,
      targetZone: restoredZone,
      targetIndex: restoredIndex,
      targetCardId: battle.preBlockTargetCardId ?? null,
      defPower: restoredPower,
      blockerUsed: false,
      blockerIndex: undefined,
      preBlockTargetZone: undefined,
      preBlockTargetIndex: undefined,
      preBlockTargetCardId: undefined,
      preBlockDefPower: undefined,
    },
  }, `Unblocked — ${blocker.card.name} returned to active.`, 'battle');
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

  // Standard counter card — numeric counter bonus (including HAND_COUNTER_MOD passives)
  const effectiveBonus = getEffectiveCounter(card, state, defender);
  if (effectiveBonus > 0) {
    const newHand = defPs.hand.filter((_, i) => i !== handIndex);
    return addLog(appendFlash({
      ...state,
      [defender]: { ...defPs, hand: newHand, trash: [...defPs.trash, card] },
      battle: { ...battle, defPower: battle.defPower + effectiveBonus },
    }, card, 'COUNTER', { counterBonus: effectiveBonus }), `Counter +${effectiveBonus} (${cn(card)}).`, 'battle');
  }

  // Event card with 反擊 timing — must pay DON!! cost
  if (card.category === 'Event' && card.effect?.includes('【反擊】')) {
    const counterEventCost = Math.max(0, (card.cost ?? 0) + getSelfCondHandCostDelta(card, state, defender));
    if (!canAfford(defPs.costArea, counterEventCost)) return state;
    const newCost = spendDon(defPs.costArea, counterEventCost);
    const newHand = defPs.hand.filter((_, i) => i !== handIndex);
    let s = addLog(appendFlash({
      ...state,
      [defender]: { ...defPs, hand: newHand, costArea: newCost },
    }, card, 'COUNTER'), `Counter Event: ${cn(card)} (Cost ${counterEventCost}).`, 'battle');
    s = resolveCounterEffect(card, s, defender);
    const afterPs = s[defender];
    s = { ...s, [defender]: { ...afterPs, trash: [...afterPs.trash, card] } };
    // Fire 「對手發動事件卡或防禦時」 on the attacker's field cards (e.g. OP15-119).
    if (!s.pendingEffect) s = resolveOpponentEventOrCounterEffect(s, battle.attackerOwner);
    // Re-calculate atkPower and defPower so power mods are visible to applyResolveDamage.
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
      const atkFC2 = s.battle.attackerZone === 'leader'
        ? s[s.battle.attackerOwner].leader
        : s[s.battle.attackerOwner].characterArea[s.battle.attackerIndex];
      if (atkFC2) {
        const newAtkPower2 = calcPower(atkFC2, s.battle.attackerOwner, s.battle.attackerOwner, s);
        if (newAtkPower2 !== s.battle.atkPower) {
          s = { ...s, battle: { ...s.battle, atkPower: newAtkPower2 } };
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
    s = clearPowerMods(s, PLAYER.HOST, 'battle');
    s = clearPowerMods(s, PLAYER.GUEST,    'battle');
    return s;
  }

  if (atkPower < defPower) {
    let s = addLog(clearBattleMods({
      ...state,
      battle: null,
      waitingFor: state.activePlayer,
    }), `Attack failed. (${atkPower} < ${defPower})`, 'battle');

    // AUTO_KO_IN_BATTLE: attacker character may optionally K.O. the target character (and self-KO)
    if (battle.attackerZone === 'character' && targetZone === 'character') {
      const attackerFC = s[attackerOwner].characterArea[battle.attackerIndex];
      if (attackerFC) {
        s = resolveAutoKOInBattle(attackerFC, battle.attackerIndex, s, attackerOwner, targetOwner, targetIndex);
      }
    }

    // AUTO_KO_IN_BATTLE: target character (blocker) may optionally K.O. the attacker character (and self-KO)
    if (!s.pendingEffect && targetZone === 'character' && battle.attackerZone === 'character') {
      const targetFC = s[targetOwner].characterArea[targetIndex];
      if (targetFC) {
        s = resolveAutoKOInBattle(targetFC, targetIndex, s, targetOwner, attackerOwner, battle.attackerIndex);
      }
    }

    return s;
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
    const isDoubleAtk = fcEffectiveHasDoubleAtk(attackerFC, state.activePlayer, attackerOwner, state);

    const lifeCard  = defPs.lifeArea[defPs.lifeArea.length - 1];
    const newLife   = defPs.lifeArea.slice(0, -1);
    const newFaceUp = (defPs.lifeAreaFaceUp ?? defPs.lifeArea.map(() => false)).slice(0, -1);

    const humanLife = targetOwner === PLAYER.HOST;
    if (isBanish) {
      // Banish: life card goes to trash, trigger does NOT fire
      const baseBanish = { ...s, battle: null, waitingFor: s.activePlayer, [targetOwner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, trash: [...defPs.trash, lifeCard] } };
      s = addLog(
        humanLife ? appendFlash(baseBanish, lifeCard, 'LIFE_TO_TRASH') : baseBanish,
        `Banish! Life card trashed (no trigger). Life remaining: ${newLife.length}.`, 'damage');
      if (!s.pendingEffect && !s.winner) s = resolveOnLifeLeaveEffect(s);
    } else if (hasTrigger(lifeCard) && (targetOwner === PLAYER.HOST || s.pvpMode)) {
      // Defending player decides whether to activate trigger.
      // Only show the card image to the defender — the attacker learns there is a trigger via the log.
      s = addLog(appendFlash({
        ...s,
        battle: null,
        waitingFor: targetOwner,
        pendingTrigger: {
          owner: targetOwner,
          lifeCard,
          isDoubleAtk: isDoubleAtk && newLife.length > 0,
          postTriggerLife: newLife,
          doubleAtkBattle: (isDoubleAtk && !battle.secondHit && newLife.length > 0)
            ? { ...battle, step: BATTLE_STEP.DAMAGE, defPower: 0, secondHit: true }
            : null,
          attackerOwner,
          attackerZone: battle.attackerZone,
          attackerIndex: battle.attackerIndex,
        },
        [targetOwner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp },
      // Use a neutral TRIGGER flash — destination (hand vs trash) isn't determined until the player chooses.
      }, lifeCard, 'TRIGGER', { forPlayer: targetOwner }), `Life card revealed: ${cn(lifeCard)} — has Trigger!`, 'damage');
    } else {
      // No trigger (or AI): card goes to hand — private info, only show to the defending player.
      const baseNoDmg = { ...s, battle: null, waitingFor: s.activePlayer, [targetOwner]: { ...defPs, lifeArea: newLife, lifeAreaFaceUp: newFaceUp, hand: [...defPs.hand, lifeCard] } };
      s = addLog(
        (humanLife || s.pvpMode) ? appendFlash(baseNoDmg, lifeCard, 'LIFE_TO_HAND', { forPlayer: targetOwner }) : baseNoDmg,
        `Damage! Life → hand. Life remaining: ${newLife.length}.`, 'damage');
      if (!s.pendingEffect && !s.winner) s = resolveOnLifeLeaveEffect(s);

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

    // Fire "造成傷害時" effects on the attacking card (e.g. OP03-040 Nami: mill 1 on damage).
    if (!s.pendingTrigger && !s.winner) {
      const atkCard = battle.attackerZone === 'leader'
        ? s[attackerOwner].leader.card
        : s[attackerOwner].characterArea[battle.attackerIndex]?.card;
      if (atkCard) s = resolveOnDealDamageEffect(atkCard, s, attackerOwner, battle.attackerZone, battle.attackerIndex);
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

    // Re-locate target: a 對方攻擊時 effect may have trashed a character and shifted indices.
    let resolvedTargetIndex = targetIndex;
    if (battle.targetCardId && defPs.characterArea[targetIndex]?.card.id !== battle.targetCardId) {
      resolvedTargetIndex = defPs.characterArea.findIndex(fc => fc.card.id === battle.targetCardId);
    }
    const koFC = defPs.characterArea[resolvedTargetIndex];
    if (!koFC) {
      // Target was already removed by a battle-effect — skip KO, clear battle state.
      return clearBattleMods({ ...s, battle: null, waitingFor: s.activePlayer });
    }

    const returnedDon = Array.from({ length: koFC.attachedDon }, (_, i) =>
      ({ ...makeDon(`ko-${i}`), state: 'rest' })
    );

    // Check for character self leave-field replacement FIRST (e.g. EB04-044: discard to stay)
    const handCountBefore = defPs.hand.length;
    const selfReplaceState = resolveCharacterLeaveFieldEffect(
      koFC.card, { target: resolvedTargetIndex }, { ...s, battle: null, waitingFor: targetOwner }, targetOwner
    );
    if (selfReplaceState.pendingEffect) {
      return {
        ...selfReplaceState,
        pendingLeaveField: { context: 'KO', targetOwner, koCard: koFC.card, targetIndex: resolvedTargetIndex, returnedDon },
      };
    }
    if (selfReplaceState[targetOwner].hand.length < handCountBefore) {
      // AI paid discard cost — KO prevented; clear battle mods and return
      s = clearPowerMods({ ...selfReplaceState, waitingFor: s.activePlayer }, PLAYER.HOST, 'battle');
      s = clearPowerMods(s, PLAYER.GUEST, 'battle');
      s = drainOnPlayTriggers(s);
      const w = checkWinner(s);
      return w ? { ...s, winner: w } : s;
    }

    // Check for leader KO-replacement effect BEFORE applying the KO.
    const lifeCountBefore = defPs.lifeArea.length;
    const preKoState = resolveLeaderKOReplacementEffect(
      koFC.card, { ...s, battle: null, waitingFor: targetOwner }, targetOwner, resolvedTargetIndex
    );
    if (preKoState.pendingEffect) {
      // Human player must decide — store KO info and wait for RESOLVE_EFFECT_CHOICE
      return {
        ...preKoState,
        pendingKOReplacement: { targetOwner, koCard: koFC.card, targetIndex: resolvedTargetIndex, returnedDon },
      };
    }
    if (preKoState[targetOwner].lifeArea.length < lifeCountBefore || preKoState.leaderKOPreventionApplied) {
      // Replacement auto-fired (AI) — KO prevented; clear battle mods and return
      s = clearPowerMods({ ...preKoState, leaderKOPreventionApplied: undefined, waitingFor: s.activePlayer }, PLAYER.HOST, 'battle');
      s = clearPowerMods(s, PLAYER.GUEST, 'battle');
      s = drainOnPlayTriggers(s);
      const w = checkWinner(s);
      return w ? { ...s, winner: w } : s;
    }

    // Check for stage KO-replacement effect (e.g. P-142 Going Merry).
    const preKoStateStage = resolveStageKOReplacementEffect(
      koFC.card, preKoState, targetOwner, resolvedTargetIndex
    );
    if (preKoStateStage.pendingEffect) {
      return {
        ...preKoStateStage,
        pendingKOReplacement: { targetOwner, koCard: koFC.card, targetIndex: resolvedTargetIndex, returnedDon },
      };
    }
    if (preKoStateStage.stageKOPreventionApplied) {
      s = clearPowerMods({ ...preKoStateStage, stageKOPreventionApplied: undefined, waitingFor: s.activePlayer }, PLAYER.HOST, 'battle');
      s = clearPowerMods(s, PLAYER.GUEST, 'battle');
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
        characterArea: defPs.characterArea.filter((_, i) => i !== resolvedTargetIndex),
        powerMods: shiftModsAfterRemoval(defPs.powerMods ?? [], resolvedTargetIndex),
        costMods:  shiftModsAfterRemoval(defPs.costMods  ?? [], resolvedTargetIndex),
        trash: [...defPs.trash, koFC.card],
        costArea: [...defPs.costArea, ...returnedDon],
      },
    }, koFC.card, 'KO'), `${cn(koFC.card)} was KO'd!`, 'battle');

    // Fire KO-timing effects on the KO'd card
    if (koFC.card?.effect?.includes('KO時')) {
      s = resolveOnKOEffect(koFC.card, s, targetOwner, koFC.attachedDon ?? 0);
      s = drainOnPlayTriggers(s);
    }
    // Fire leader KO-watch effects for own-character KOs (e.g. OP14-041: "when your char is KO'd, ...")
    if (!s.pendingEffect) {
      s = resolveLeaderKOWatchEffect(koFC.card, s, targetOwner);
    }
    // Fire leader 我方特徵角色離場時 effects for own-character KOs (e.g. OP16-041 Buggy)
    if (!s.pendingEffect) {
      s = resolveLeaderOwnTraitCharLeaveEffect(koFC.card, s, targetOwner);
    }
    // Fire leader KO-watch effects for opponent-character KOs on the attacker's leader (e.g. OP03-076 Lucci)
    if (!s.pendingEffect) {
      s = resolveLeaderKOWatchEffect(koFC.card, s, attackerOwner, 'opponent');
    }
    // Fire field-character watch effects on the attacker's side (e.g. EB04-044: "when opponent char is KO'd, draw 1")
    if (!s.pendingEffect) {
      s = resolveOpponentKOWatchEffect(koFC.card, s, attackerOwner);
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

  // Fire 受到傷害時 effects after trigger resolution — the damage happened before the
  // trigger pause, so these effects are deferred until now.
  function withDamageTakenEffects(s) {
    let r = runEffectContinuation(s);
    if (!r.pendingTrigger && !r.winner)
      r = resolveOnDamageTakenEffect(r[t.owner].leader.card, r, t.owner);
    // Fire "造成傷害時" on the attacker's card (deferred from trigger path, same as non-trigger path).
    if (!r.pendingTrigger && !r.winner && t.attackerOwner) {
      const atkCard = t.attackerZone === 'leader'
        ? r[t.attackerOwner]?.leader?.card
        : r[t.attackerOwner]?.characterArea?.[t.attackerIndex]?.card;
      if (atkCard) r = resolveOnDealDamageEffect(atkCard, r, t.attackerOwner, t.attackerZone, t.attackerIndex);
    }
    // Fire "生命值卡變成0張時" if life hit zero and trigger deferred it (e.g. OP05-098 Enel).
    if (!r.pendingTrigger && !r.winner && r[t.owner]?.lifeArea?.length === 0)
      r = resolveOnLifeZeroEffect(r[t.owner].leader.card, r, t.owner);
    // Fire "生命值卡離開時" after trigger resolves (deferred from trigger path).
    if (!r.pendingTrigger && !r.winner) r = resolveOnLifeLeaveEffect(r);
    return applyDoubleAtkSecondHit(r);
  }

  if (!activate) {
    // Card already in its final zone (e.g. LIFE_TO_TRASH cost): don't move it again.
    const withCard = t.cardAlreadyInZone
      ? { ...state, pendingTrigger: null, waitingFor: state.activePlayer }
      : { ...state, pendingTrigger: null, waitingFor: state.activePlayer, [t.owner]: { ...ps, hand: [...ps.hand, t.lifeCard] } };
    const withFlash = t.cardAlreadyInZone
      ? withCard
      : appendFlash(withCard, t.lifeCard, 'LIFE_TO_HAND', { forPlayer: t.owner });
    const afterLog = addLog(withFlash,
      t.cardAlreadyInZone
        ? `Trigger declined. ${cn(t.lifeCard)} stays in ${t.cardAlreadyInZone}.`
        : `Trigger declined. ${cn(t.lifeCard)} added to hand.`,
      'info');
    return withDamageTakenEffects(afterLog);
  }

  // During trigger effect resolution the card belongs to no zone (rules).
  // Fire the trigger effect first, then place the card:
  //   - SELF_DEPLOY fired → card went to field, skip trash placement
  //   - cardAlreadyInZone → card was pre-placed by an effect, skip placement
  //   - otherwise → card goes to trash after resolution
  const preEffect = { ...state, pendingTrigger: null, waitingFor: state.activePlayer };
  const afterTrigger = resolveTriggerEffect(t.lifeCard, preEffect, t.owner);

  let afterPlacement;
  let wasDeployed = false;
  if (t.cardAlreadyInZone) {
    afterPlacement = afterTrigger;
  } else {
    const stripSuffix = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r\d*$/, '');
    const lifeId = stripSuffix(t.lifeCard?.id);
    // Count occurrences of lifeId in characterArea before and after trigger resolution.
    // This avoids false positives when a pre-existing copy of the same card is already
    // on the field (e.g. OP16-108 in life via ADD_TO_LIFE while another copy is deployed).
    const preCharCount  = (preEffect[t.owner].characterArea  ?? []).filter(fc => stripSuffix(fc.card?.id) === lifeId).length;
    const afterCharCount = (afterTrigger[t.owner].characterArea ?? []).filter(fc => stripSuffix(fc.card?.id) === lifeId).length;
    const preStageId   = stripSuffix(preEffect[t.owner].stageArea?.card?.id);
    const afterStageId = stripSuffix(afterTrigger[t.owner].stageArea?.card?.id);
    wasDeployed =
      afterCharCount > preCharCount ||
      (afterStageId === lifeId && preStageId !== lifeId);
    afterPlacement = wasDeployed
      ? afterTrigger
      : { ...afterTrigger, [t.owner]: { ...afterTrigger[t.owner], trash: [...afterTrigger[t.owner].trash, t.lifeCard] } };
  }

  // Deployed → neutral TRIGGER flash (card appeared on field); otherwise → LIFE_TO_TRASH
  const activateFlash = (t.cardAlreadyInZone || wasDeployed) ? 'TRIGGER' : 'LIFE_TO_TRASH';
  const afterLog = addLog(appendFlash(afterPlacement, t.lifeCard, activateFlash), `Trigger activated: ${cn(t.lifeCard)}.`, 'action');
  return withDamageTakenEffects(afterLog);
}

// ── Activate: Main ───────────────────────────────────────────────────────────

// Diff two game states to find which field characters were actually affected by an
// Activate:Main effect. Returns targets by _fcId so the overlay finds the right DOM
// element even when character indices shift after a KO.
function diffFieldTargets(preState, postState) {
  const targets = [];
  for (const owner of [PLAYER.HOST, PLAYER.GUEST]) {
    const preChars = preState[owner]?.characterArea ?? [];
    const postChars = postState[owner]?.characterArea ?? [];

    // Removed from field (KO'd or returned to hand)
    preChars.forEach((prefc, origIdx) => {
      if (!postChars.some(fc => fc._fcId === prefc._fcId)) {
        targets.push({ owner, zone: 'character', index: origIdx, fcId: prefc._fcId, actionType: 'KO', label: 'KO' });
      }
    });

    // Modified in place
    postChars.forEach((postfc) => {
      const prefc = preChars.find(fc => fc._fcId === postfc._fcId);
      if (!prefc) return;
      const postIdx = postChars.findIndex(fc => fc._fcId === postfc._fcId);

      if (postfc.state === 'rest' && prefc.state !== 'rest') {
        targets.push({ owner, zone: 'character', index: postIdx, fcId: postfc._fcId, actionType: 'REST', label: 'REST' });
      } else if (postfc.state !== 'rest' && prefc.state === 'rest') {
        targets.push({ owner, zone: 'character', index: postIdx, fcId: postfc._fcId, actionType: 'UNREST', label: 'Activate' });
      } else {
        const preKws = [...(prefc.tempKeywords ?? []), ...(prefc.opponentTurnEndKeywords ?? [])];
        const postKws = [...(postfc.tempKeywords ?? []), ...(postfc.opponentTurnEndKeywords ?? [])];
        const newKw = postKws.find(kw => !preKws.includes(kw));
        if (newKw) {
          targets.push({ owner, zone: 'character', index: postIdx, fcId: postfc._fcId, actionType: 'GRANT_KEYWORD', label: newKw });
        } else if (postfc.blockerDisabled && !prefc.blockerDisabled) {
          targets.push({ owner, zone: 'character', index: postIdx, fcId: postfc._fcId, actionType: 'REST', label: 'NO BLK' });
        }
      }
    });
  }
  return targets.slice(0, 6);
}

function applyActivateOverlay(s, preState) {
  if (!s._activateOverlayMeta) return s;
  const { card, sourceSelector } = s._activateOverlayMeta;
  const targets = diffFieldTargets(preState, s);
  s = { ...s, _activateOverlayMeta: null };
  if (targets.length > 0) s = { ...s, eventOverlay: { card, targets, sourceSelector } };
  return s;
}

export function applyActivateMain(state, { zone, index }) {
  const p = state.activePlayer;
  if (state.phase !== PHASE.MAIN || state.battle) return state;

  const ps = state[p];
  const fc = zone === 'leader' ? ps.leader : zone === 'stage' ? ps.stageArea : ps.characterArea[index];
  if (!fc) return state;

  const stateWithLog = addLog(state, `Activated main effect: ${cn(fc.card)}.`, 'action');

  const sourceSelector = zone === 'leader'
    ? `[data-field-card="${p}-leader"]`
    : `[data-field-card="${p}-character-${index}"]`;

  // Store meta so we can show the overlay after the actual target is chosen (not all eligibles)
  const stateForEffect = { ...stateWithLog, _activateOverlayMeta: { card: fc.card, sourceSelector } };

  let s = resolveActivatedMainEffect(fc.card, stateForEffect, p, zone, index);
  if (s === stateForEffect) return state; // no effect triggered — discard the log entry
  // Drain KO-timing effects queued by any non-interactive KOs during activation
  if (!s.pendingEffect && !s.pendingReplace && s.pendingKOEffects?.length) {
    const koEffects = s.pendingKOEffects;
    s = { ...s, pendingKOEffects: [] };
    for (const { card, owner: koOwner, attachedDon: koDon } of koEffects) {
      s = resolveOnKOEffect(card, s, koOwner, koDon ?? 0);
      if (!s.pendingEffect && !s.pendingReplace)
        s = resolveLeaderKOWatchEffect(card, s, koOwner);
      if (s.pendingEffect || s.pendingReplace) break;
    }
  }
  // Fire 自己角色效果離場時 on the active player's leader if a character was removed by effect
  if (!s.pendingEffect && !s.pendingReplace && s.pendingOwnCharRemovedFor) {
    const removedOwner = s.pendingOwnCharRemovedFor;
    const leaveCard = s.pendingOwnCharLeaveCard ?? null;
    s = { ...s, pendingOwnCharRemovedFor: null, pendingOwnCharLeaveCard: null };
    s = resolveLeaderOwnCharRemovedEffect(s, removedOwner);
    if (!s.pendingEffect && leaveCard) {
      s = resolveLeaderOwnTraitCharLeaveEffect(leaveCard, s, removedOwner);
    }
  }
  // Leader profile: set re-activation flag after leader Activate:Main (e.g. OP12-020).
  // The flag causes the leader to unrest in finalizeBattleDeclaration when it attacks a character.
  if (zone === 'leader' && !s.pendingEffect && !s.pendingReplace) {
    const _lp = getLeaderProfile(s[p]?.leader?.card?.id);
    if (_lp?.leaderReactivateOnCharBattle) {
      s = { ...s, [p]: { ...s[p], leader: { ...s[p].leader, reactivateAfterCharBattle: true } } };
    }
  }
  // Drain on-play triggers queued by KO-effect DEPLOYs that fired during this activation.
  if (!s.pendingEffect && !s.pendingReplace) s = drainOnPlayTriggers(s);
  // Show overlay with the actual resolved target (diff vs pre-effect state)
  if (!s.pendingEffect && !s.pendingReplace) s = applyActivateOverlay(s, stateWithLog);
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
  const isCharRushReplace = hasCharacterRushOnly(card) || leaderHasRushCharsPassive(state, owner, card);
  const newChars = ps.characterArea.map((fc, i) =>
    i === replaceIndex ? makeFieldCard(card, { justDeployed: !hasRush(card) && !isCharRushReplace, deployedThisTurn: true, ...(isCharRushReplace && { rushCharOnly: true }), ...(enterRestedReplace && { state: 'rest' }) }) : fc
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
    s = { ...s, pendingOpponentDeployTrigger: s.pendingOpponentDeployTrigger ?? { card, deployOwner: owner, isViaCharEffect: false } };
    const replaceTargets = ['登場時', 'On Play'].flatMap(t => computeFieldEffectTargets(card, s, owner, t));
    if (replaceTargets.length > 0) {
      s = { ...s, eventOverlay: { card, targets: replaceTargets, sourceSelector: `[data-field-card="${owner}-character-${replaceIndex}"]` } };
    }
    return resolveOnPlayEffect(card, s, owner);
  }
  // DEPLOY / DEPLOY_FROM_TRASH / DEPLOY_FROM_DECK: queue on-play trigger for the replaced-in card
  if (type === 'DEPLOY' || type === 'DEPLOY_FROM_TRASH' || type === 'DEPLOY_FROM_DECK') {
    s = { ...s, pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card, owner }] };
  }
  // DEPLOY: process any remaining cards queued from a multi-deploy effect (e.g. Sengoku leader)
  if (type === 'DEPLOY' && pr.remainingIndices?.length) {
    for (let _ri = 0; _ri < pr.remainingIndices.length; _ri++) {
      const ridx = pr.remainingIndices[_ri];
      const curPs = s[owner];
      const nextCard = curPs.hand[ridx];
      if (!nextCard) continue;
      if (curPs.characterArea.length >= 5 && nextCard.category !== 'Stage') {
        s = {
          ...s,
          pendingReplace: {
            type: 'DEPLOY',
            owner,
            card: nextCard,
            handIndex: ridx,
            remainingIndices: pr.remainingIndices.slice(_ri + 1),
            deployState: pr.deployState,
            continuation: pr.continuation,
            effectKey: pr.effectKey,
            sourceCard: pr.sourceCard,
          },
        };
        return drainOnPlayTriggers(s);
      }
      // Room available (or Stage) — deploy directly
      const depFieldCard = {
        card: nextCard, state: pr.deployState ?? 'active',
        attachedDon: 0, justDeployed: true, deployedThisTurn: true,
        _fcId: `fc-${Math.random()}`,
      };
      const newPs = s[owner];
      s = {
        ...s,
        [owner]: {
          ...newPs,
          hand: newPs.hand.filter((_, i) => i !== ridx),
          characterArea: [...newPs.characterArea, depFieldCard],
        },
        pendingOnPlayTriggers: [...(s.pendingOnPlayTriggers ?? []), { card: nextCard, owner }],
      };
    }
  }
  // DEPLOY / DEPLOY_FROM_TRASH / DEPLOY_FROM_DECK: resume the effect chain that was interrupted
  const afterCont = executeActionSequence(s, owner, pr.continuation, pr.sourceCard, pr.effectKey);
  return drainOnPlayTriggers(afterCont);
}

// ── End Turn ──────────────────────────────────────────────────────────────

export function applyEndTurn(state) {
  const current = state.activePlayer;
  const next    = current === PLAYER.HOST ? PLAYER.GUEST : PLAYER.HOST;
  const newTurn = next === state.firstPlayer ? state.turn + 1 : state.turn;

  const hostLabel = state.playerNames?.host;
  const guestLabel    = state.playerNames?.guest;
  const humanTurn  = hostLabel ? `${hostLabel}'s turn` : 'Your turn';
  const aiTurn     = guestLabel    ? `${guestLabel}'s turn`    : "AI's turn";
  const humanLose  = hostLabel ? `${hostLabel} loses`  : 'You lose';
  const aiLose     = guestLabel    ? `${guestLabel} loses`     : 'AI loses';

  // OP15-022 Brook rule: lose at end of turn if deck is 0 (delayed loss instead of immediate).
  if (leaderHasDeckEmptyException(state, current) && state[current].deck.length === 0) {
    return addLog({ ...state, winner: next }, `Deck is empty — ${current === PLAYER.HOST ? humanLose : aiLose} at end of turn.`, 'phase');
  }

  // Fire end-of-turn effects before switching player
  let s = resolveEndOfTurnEffects(state, current);

  // Clear turn-duration power/cost mods for the player whose turn is ending
  s = clearPowerMods(s, current, 'turn');
  s = clearPowerMods(s, current, 'nextOwnTurnEnd'); // "until end of your next turn" — cleared when owner's own turn ends
  s = clearCostMods(s, current, 'turn');
  s = clearHandCostMods(s, current, 'turn');
  s = clearHandCostMods(s, current, 'next_play');

  // Clear justDeployed, rushCharOnly, restLocked, attackLocked, temp keyword grants, and effectNegated on the current player's characters and leader
  // effectNegated is cleared here because triggers fired by the *opponent* during the active player's turn stamp the flag on s[current]'s cards
  const cleanChars = s[current].characterArea.map(fc => ({ ...fc, justDeployed: false, deployedThisTurn: false, rushCharOnly: false, restLocked: false, attackLocked: false, willBottomDeckAtEndOfTurn: false, willUnrestAtEot: false, tempKeywords: [], tempAttributes: [], attackCostRestriction: null, effectNegated: false }));
  const cleanLeader = { ...s[current].leader, tempKeywords: [], tempAttributes: [], attackCostRestriction: null, reactivateAfterCharBattle: false, effectNegated: false };

  // blockerDisabled expires at end of the active player's turn — clear on the opponent's field
  // Also clear effectNegated on s[next] for the case where the active player's own effects negated the opponent's cards
  const cleanOppChars = s[next].characterArea.map(fc => ({ ...fc, blockerDisabled: false, effectNegated: false, effectNegatedNextOppTurn: false }));
  const cleanOppLeader = { ...s[next].leader, effectNegated: false, effectNegatedNextOppTurn: false };
  return addLog({
    ...s,
    activePlayer: next,
    waitingFor: next,
    phase: PHASE.REFRESH,
    turn: newTurn,
    [current]: { ...s[current], characterArea: cleanChars, leader: cleanLeader },
    [next]: { ...s[next], characterArea: cleanOppChars, leader: cleanOppLeader },
  }, `─── Turn ${newTurn}: ${next === PLAYER.HOST ? humanTurn : aiTurn} ───`, 'phase');
}

// ---------------------------------------------------------------------------
// Central reducer
// ---------------------------------------------------------------------------

export function gameReducer(state, action) {
  if (action.type === 'TOGGLE_REVEAL_OPPONENT') {
    return { ...state, devRevealOpponent: !state.devRevealOpponent };
  }

  if (action.type === 'CONCEDE') {
    const loser = action.player;
    const winner = loser === PLAYER.HOST ? PLAYER.GUEST : PLAYER.HOST;
    return addLog({ ...state, winner }, `${loser === PLAYER.HOST ? 'You conceded' : 'Opponent conceded'}.`, 'phase');
  }

  if (state.winner) return state; // Game over — no more actions

  switch (action.type) {
    case 'REFRESH':          return applyRefresh(state);
    case 'DRAW':             return applyDraw(state);
    case 'DON_PHASE':        return applyDonPhase(state);
    case 'PLAY_CHARACTER':   return applyPlayCharacter(state, action);
    case 'PLAY_STAGE':       return applyPlayStage(state, action);
    case 'PLAY_EVENT':       return applyPlayEvent(state, action);
    case 'ATTACH_DON': {
      const next = applyAttachDon(state, action);
      // Guard: if applyAttachDon returns the same reference (no active DON!! available),
      // return a new object so React re-renders and the AI useEffect re-fires — prevents
      // a permanent AI freeze when the planned DON count diverges from real game state.
      return next === state ? { ...state } : next;
    }
    case 'REMOVE_CHARACTER': return applyRemoveCharacter(state, action);
    case 'DECLARE_ATTACK': {
      const next = applyDeclareAttack(state, action);
      // Guard: if applyDeclareAttack returns the same reference (attacker has CANNOT_ATTACK,
      // is rested, or target is invalid), return a new object so React re-renders and the
      // AI useEffect re-fires — prevents permanent freeze on stale DECLARE_ATTACK actions.
      return next === state ? { ...state } : next;
    }
    case 'USE_BLOCKER':      return applyUseBlocker(state, action);
    case 'UNBLOCK':          return applyUnblock(state);
    case 'SKIP_BLOCK':       return applySkipBlock(state);
    case 'PLAY_COUNTER':     return applyPlayCounter(state, action);
    case 'SKIP_COUNTER':     return applySkipCounter(state);
    case 'RESOLVE_DAMAGE':   return applyResolveDamage(state);
    case 'RESOLVE_TRIGGER':       return drainOnPlayTriggers(applyResolveTrigger(state, action));
    case 'RESOLVE_EFFECT_CHOICE': {
      if (state.pendingEffect?.choices?.type === 'CHOOSE_EOT_EFFECT_ORDER') {
        const pickedIdx = action.selectedIndices?.[0] ?? 0;
        return drainOnPlayTriggers(resolveEotEffectChoice(state, pickedIdx));
      }
      if (state.pendingEffect?.choices?.type === 'CHOOSE_ON_PLAY_ORDER') {
        const pickedIdx = action.selectedIndices?.[0] ?? 0;
        return drainOnPlayTriggers(resolveOnPlayOrderChoice(state, pickedIdx));
      }
      const wasDonReturn = state.pendingEffect?.choices?.type === 'CHOOSE_DON_RETURN';
      const donReturnOwner = state.pendingEffect?.owner;
      const donReturnCount = state.pendingEffect?.choices?.count ?? 0;
      let s = drainOnPlayTriggers(resolveEffectChoice(state, action));
      if (wasDonReturn && !s.pendingEffect) s = fireDonReturnEffects(s, donReturnOwner, donReturnCount);
      // If a pending KO replacement just resolved (confirmed or rejected), clear battle-duration mods.
      if (state.pendingKOReplacement && !s.pendingKOReplacement) {
        s = clearPowerMods(s, PLAYER.HOST, 'battle');
        s = clearPowerMods(s, PLAYER.GUEST, 'battle');
      }
      if (state.pendingLeaveField && !s.pendingLeaveField) {
        s = clearPowerMods(s, PLAYER.HOST, 'battle');
        s = clearPowerMods(s, PLAYER.GUEST, 'battle');
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
      // Fire 自己角色效果離場時 on the active player's leader if a character was removed by effect
      if (!s.pendingEffect && !s.pendingReplace && s.pendingOwnCharRemovedFor) {
        const removedOwner = s.pendingOwnCharRemovedFor;
        const leaveCard = s.pendingOwnCharLeaveCard ?? null;
        s = { ...s, pendingOwnCharRemovedFor: null, pendingOwnCharLeaveCard: null };
        s = resolveLeaderOwnCharRemovedEffect(s, removedOwner);
        if (!s.pendingEffect && leaveCard) {
          s = resolveLeaderOwnTraitCharLeaveEffect(leaveCard, s, removedOwner);
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
      // Recalculate battle atkPower and defPower after 對方攻擊時 interactive effects
      // (power mods may have changed either side — e.g. OP13-002 reduces atkPower).
      if (!s.pendingEffect && !s.pendingBattle && s.battle) {
        const battle = s.battle;
        const defFC  = battle.targetZone === 'leader'
          ? s[battle.targetOwner].leader
          : s[battle.targetOwner].characterArea[battle.targetIndex];
        if (defFC) {
          const newDefPower = calcPower(defFC, battle.attackerOwner, battle.targetOwner, s);
          if (newDefPower !== battle.defPower) {
            s = { ...s, battle: { ...s.battle, defPower: newDefPower } };
          }
        }
        const atkFC = battle.attackerZone === 'leader'
          ? s[battle.attackerOwner].leader
          : s[battle.attackerOwner].characterArea[battle.attackerIndex];
        if (atkFC) {
          const newAtkPower = calcPower(atkFC, battle.attackerOwner, battle.attackerOwner, s);
          if (newAtkPower !== s.battle.atkPower) {
            s = { ...s, battle: { ...s.battle, atkPower: newAtkPower } };
          }
        }
      }
      // Resume remaining EOT effects queued by the ordering prompt.
      if (!s.pendingEffect && !s.pendingReplace && s.pendingEotSources?.remaining?.length) {
        s = resumeEotSequence(s);
      }
      // Resume remaining on-play effects queued by the ordering prompt.
      if (!s.pendingEffect && !s.pendingReplace && s.pendingOnPlaySources?.remaining?.length) {
        s = resumeOnPlayOrderSequence(s);
      }
      // After all pending chains drain outside of an active battle, restore waitingFor to
      // the active player. This prevents a freeze when a replacement/KO effect was prompted
      // to the non-active player (e.g. human declines blocker-KO protection during AI's turn)
      // but nothing in the resolution chain resets waitingFor back to the active player.
      if (!s.pendingEffect && !s.pendingReplace && !s.battle && !s.pendingBattle && !s.pendingTrigger) {
        s = { ...s, waitingFor: s.activePlayer };
      }
      // Show targeting overlay with the actual resolved target for Activate:Main effects
      // that required interactive choices (pendingEffect was set while effect ran).
      if (!s.pendingEffect && !s.pendingReplace && !s.battle) {
        s = applyActivateOverlay(s, state);
      }
      return s;
    }
    case 'RESOLVE_REPLACE':       return applyResolveReplace(state, action);
    case 'ACTIVATE_MAIN': {
      const next = applyActivateMain(state, action);
      // Guard: if applyActivateMain returns the same reference (no effect triggered or
      // precondition failed), return a new object so React re-renders and the AI
      // useEffect re-fires — prevents permanent AI freeze on stale ACTIVATE_MAIN actions.
      return next === state ? { ...state } : next;
    }
    case 'END_TURN':          return applyEndTurn(state);
    case 'MULLIGAN_KEEP':          return applyMulliganKeep(state);
    case 'MULLIGAN_REDRAW':        return applyMulliganRedraw(state);
    case 'LEADER_PRE_GAME_STAGE':  return applyLeaderPreGameStage(state, action);
    case 'CONSUME_FLASH_QUEUE':       return { ...state, cardFlashQueue: [] };
    case 'CLEAR_EVENT_OVERLAY':       return { ...state, eventOverlay: null, pendingOnPlayOverlay: null };
    case 'ACTIVATE_ON_PLAY_OVERLAY':  return { ...state, eventOverlay: state.pendingOnPlayOverlay, pendingOnPlayOverlay: null };
    default:                       return state;
  }
}
