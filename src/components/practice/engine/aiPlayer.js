import { PLAYER, MAX_CHARACTERS } from './constants';
import { getLeaderProfile } from './leaderProfiles';
import {
  applyPlayCharacter, applyPlayStage, applyAttachDon, applyActivateMain,
  applyDeclareAttack, applyPlayCounter, canAfford, calcPower, activeDonCount,
} from './gameState';
import { rankCardsForTurn } from '../../../utils/cardRanker';
import {
  hasOnAttack, hasBlocker, fcHasBlocker, fcEffectiveHasDoubleAtk, fcHasBanish,
  fcEffectiveHasBlocker, getActivatedMainStatus, evaluateContinuousKeywords,
  hasRush,
} from './effects';

const AI    = PLAYER.AI;
const HUMAN = PLAYER.HUMAN;

const MAGIC_NUMBERS                 = [7000, 5000];
const COUNTER_HOLD_DON              = 2;
const SAFE_LIFE_COUNT               = 3;
const LOW_HAND_THRESHOLD            = 2;
const RESTED_TARGET_POWER_THRESHOLD = 5000;
const EARLY_GAME_TURNS              = 3;  // turns 1–N use curve-based deployment
const MIN_HEALTHY_HAND              = 5;  // don't counter non-lethal hits when hand would drop below this

function charCanAttack(fc, sim) {
  if (fc.restLocked) return false;
  if (!fc.justDeployed) return true;
  return evaluateContinuousKeywords(fc, AI, AI, sim).has('速攻');
}

function isWorthyRestTarget(fc, defPow) {
  if (fcHasBlocker(fc)) return true;
  const effect = fc.card?.effect ?? '';
  if (effect.includes('啟動主要') || effect.includes('起動メイン') || effect.includes('[Activate: Main]')) return true;
  return defPow >= RESTED_TARGET_POWER_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Build a simple AI deck from the card database
// ---------------------------------------------------------------------------

export function buildAiDeck(allCards) {
  const leaders = allCards.filter(c => c.category === 'Leader' && !c.id?.includes('_p'));
  const leader  = leaders[Math.floor(Math.random() * leaders.length)] || leaders[0];
  if (!leader) return { leader: null, deck: [] };

  const leaderColors = new Set(leader.colors || []);
  const eligible = allCards.filter(c =>
    c.category !== 'Leader' &&
    !c.id?.includes('_p') &&
    (c.colors || []).some(col => leaderColors.has(col))
  );

  const deck   = [];
  const counts = {};
  const sorted = [...eligible].sort((a, b) => (b.power ?? 0) - (a.power ?? 0));

  for (const card of sorted) {
    if (deck.length >= 50) break;
    const base = card.id.replace(/_p\d+$/, '');
    counts[base] = counts[base] || 0;
    if (counts[base] < 4) { deck.push(card); counts[base]++; }
  }

  let i = 0;
  while (deck.length < 50 && sorted.length > 0) {
    const card = sorted[i % sorted.length];
    const base = card.id.replace(/_p\d+$/, '');
    if ((counts[base] || 0) < 4) { deck.push(card); counts[base] = (counts[base] || 0) + 1; }
    i++;
    if (i > sorted.length * 4) break;
  }

  return { leader, deck };
}

// ---------------------------------------------------------------------------
// Card-type helpers
// ---------------------------------------------------------------------------

function isSeeker(card) {
  const eff = card.effect ?? '';
  return (eff.includes('擁有《') && eff.includes('特徵的卡片，並加入手牌')) ||
    (eff.includes('Look at') && eff.includes('from the top of your deck'));
}

function isActivateMainSeeker(card) {
  const eff = card?.effect ?? '';
  return isSeeker(card) && (eff.includes('啟動主要') || eff.includes('[Activate: Main]'));
}

function isPlayableAsCharacter(card) {
  if ((card.counter ?? 0) >= 2000) return isSeeker(card);
  return true;
}

function isCounterEventCard(card) {
  return card.category === 'Event' &&
    ((card.effect ?? '').includes('反擊') || (card.enEffect ?? '').includes('[Counter]'));
}

function hasCounterEvent(hand) {
  return hand.some(isCounterEventCard);
}

// Checks whether a card's effect targets an opponent character for removal
// (KO, REST, or bounce). Used to identify high-value rush cards in survival mode.
function hasOpponentRemovalEffect(card) {
  const eff          = (card.effect ?? '') + (card.enEffect ?? '');
  const targetsOpp   = eff.includes('對手') || eff.includes('對方') ||
    eff.includes("opponent's") || eff.includes('your opponent');
  const hasRemoval   = eff.includes('KO') || eff.includes('消除') ||
    eff.includes('橫置') || eff.includes('返回手牌') || eff.includes('Bounce') ||
    eff.includes('Rest ');
  return targetsOpp && hasRemoval;
}

// ---------------------------------------------------------------------------
// DON!! Attachment — prioritised spending
// maxBudget caps the amount of active DON the function may attach.
// ---------------------------------------------------------------------------

function planDonAttachment(sim, actions, maxBudget = Infinity, { preferLeader = false } = {}) {
  let activeDon = Math.min(activeDonCount(sim[AI].costArea), maxBudget);
  if (activeDon === 0) return sim;

  // Priority 2a: enable leader attack
  if (sim[AI].leader.state === 'active') {
    const humanLeaderBasePow = calcPower(sim[HUMAN].leader, AI, HUMAN, sim);
    const leaderCurPow       = (sim[AI].leader.card.power ?? 0) + sim[AI].leader.attachedDon * 1000;
    if (leaderCurPow < humanLeaderBasePow) {
      const needed = Math.ceil((humanLeaderBasePow - leaderCurPow) / 1000);
      if (needed <= activeDon) {
        for (let d = 0; d < needed; d++) {
          actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
          sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
        }
        activeDon = Math.min(activeDonCount(sim[AI].costArea), maxBudget);
      }
    }
  }

  // Priority 3: hold DON!! for counter events
  const opponentHandLow = sim[HUMAN].hand.length <= LOW_HAND_THRESHOLD;
  const leaderReserve   = getLeaderProfile(sim[AI].leader.card?.id)?.donReserve ?? 0;
  const holdAmount      = ((!opponentHandLow && hasCounterEvent(sim[AI].hand)) ? COUNTER_HOLD_DON : 0) + leaderReserve;
  let   budget          = Math.max(0, activeDon - holdAmount);

  if (budget <= 0) return sim;

  // Leader-specific override: when no character was played this turn, route all
  // spare DON to the leader rather than the character magic-number / default loops.
  if (preferLeader) {
    while (budget > 0 && activeDonCount(sim[AI].costArea) > 0) {
      actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
      sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
      budget--;
    }
    return sim;
  }

  // Priority 2: attach to reach magic numbers
  for (const magic of MAGIC_NUMBERS) {
    if (budget <= 0) break;
    for (let ci = 0; ci < sim[AI].characterArea.length; ci++) {
      if (budget <= 0) break;
      const fc     = sim[AI].characterArea[ci];
      if (fc.justDeployed) continue;
      const curPow = (fc.card.power ?? 0) + fc.attachedDon * 1000;
      if (curPow >= magic) continue;
      const needed = (magic - curPow) / 1000;
      if (!Number.isInteger(needed) || needed <= 0 || needed > budget) continue;
      for (let d = 0; d < needed; d++) {
        actions.push({ type: 'ATTACH_DON', targetZone: 'character', targetIndex: ci });
        sim = applyAttachDon(sim, { targetZone: 'character', targetIndex: ci });
        budget--;
      }
    }
  }

  // Priority 2.5: boost attacking characters above the opponent leader power threshold
  if (budget > 0 && sim.turn > EARLY_GAME_TURNS) {
    const humanLeaderPow = sim[HUMAN].leader.card?.power ?? 0;
    for (let ci = 0; ci < sim[AI].characterArea.length; ci++) {
      if (budget <= 0) break;
      const fc = sim[AI].characterArea[ci];
      if (fc.state !== 'active' || !charCanAttack(fc, sim) || fc.attackLocked) continue;
      const curPow = (fc.card.power ?? 0) + fc.attachedDon * 1000;
      const k      = Math.max(1, Math.ceil((curPow - humanLeaderPow + 1) / 2000));
      const target = humanLeaderPow + k * 2000;
      const needed = (target - curPow) / 1000;
      if (needed <= 0 || !Number.isInteger(needed) || needed > budget) continue;
      for (let d = 0; d < needed; d++) {
        actions.push({ type: 'ATTACH_DON', targetZone: 'character', targetIndex: ci });
        sim = applyAttachDon(sim, { targetZone: 'character', targetIndex: ci });
        budget--;
      }
    }
  }

  // Default: highest-power non-justDeployed character
  while (budget > 0 && activeDonCount(sim[AI].costArea) > 0 &&
         sim[AI].characterArea.some(fc => !fc.justDeployed)) {
    const chars = sim[AI].characterArea;
    const pool  = chars.map((fc, i) => ({ fc, i })).filter(({ fc }) => !fc.justDeployed);
    const best  = pool.reduce((b, cur) => {
      const p  = (cur.fc.card.power ?? 0) + cur.fc.attachedDon * 1000;
      const pb = (b.fc.card.power  ?? 0) + b.fc.attachedDon  * 1000;
      return p > pb ? cur : b;
    }).i;
    actions.push({ type: 'ATTACH_DON', targetZone: 'character', targetIndex: best });
    sim = applyAttachDon(sim, { targetZone: 'character', targetIndex: best });
    budget--;
  }

  // Fallback: leader
  while (budget > 0 && activeDonCount(sim[AI].costArea) > 0) {
    actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
    sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
    budget--;
  }

  return sim;
}

// ---------------------------------------------------------------------------
// Board State Evaluation
// ---------------------------------------------------------------------------

function evalBoardState(state) {
  if (state.winner === AI)    return  10000;
  if (state.winner === HUMAN) return -10000;

  const ai    = state[AI];
  const human = state[HUMAN];

  const lifeScore  = (ai.lifeArea.length - human.lifeArea.length) * 15;
  const aiPow      = ai.characterArea.reduce((s, fc) => s + (fc.card.power ?? 0) + fc.attachedDon * 1000, 0);
  const humanPow   = human.characterArea.reduce((s, fc) => s + (fc.card.power ?? 0) + fc.attachedDon * 1000, 0);
  const boardScore = (aiPow - humanPow) / 2000;
  const aiActive   = ai.characterArea.filter(fc => fc.state === 'active').length;
  const humanActive = human.characterArea.filter(fc => fc.state === 'active').length;
  const activeScore = (aiActive - humanActive) * 1.5;
  const handScore  = (ai.hand.length - human.hand.length) * 0.3;

  return lifeScore + boardScore + activeScore + handScore;
}

function trialPlayScore(sim, handIndex) {
  const trial = applyPlayCharacter(sim, { handIndex });
  const dummy = [];
  return evalBoardState(planDonAttachment(trial, dummy));
}

// ---------------------------------------------------------------------------
// Assessment helpers
// ---------------------------------------------------------------------------

// Returns true if AI can deal lethal damage to the human this turn.
function canKillHuman(sim) {
  const humanLife = sim[HUMAN].lifeArea.length;

  if (humanLife === 0) {
    // At zero life any winning hit ends the game; check if we have more winning
    // attacks than the human has free counter cards.
    const leaderDefPow      = calcPower(sim[HUMAN].leader, AI, HUMAN, sim);
    const humanCounterSlots = sim[HUMAN].hand.filter(c => (c.counter ?? 0) >= 2000).length;
    const winningChars      = sim[AI].characterArea.filter(
      fc => fc.state === 'active' && charCanAttack(fc, sim) && !fc.attackLocked
         && calcPower(fc, AI, AI, sim) > leaderDefPow
    ).length;
    const leaderWins = sim[AI].leader.state === 'active' &&
      calcPower(sim[AI].leader, AI, AI, sim) > leaderDefPow;
    return (winningChars + (leaderWins ? 1 : 0)) > humanCounterSlots;
  }

  const activeChars  = sim[AI].characterArea.filter(
    fc => fc.state === 'active' && charCanAttack(fc, sim) && !fc.attackLocked
  ).length;
  const leaderActive = sim[AI].leader.state === 'active' ? 1 : 0;

  // Rush characters deployable this turn (cheapest-first greedy)
  let donLeft    = activeDonCount(sim[AI].costArea);
  let boardSlots = MAX_CHARACTERS - sim[AI].characterArea.length;
  let rushExtra  = 0;
  for (const rc of [...sim[AI].hand]
    .filter(c => c.category === 'Character' && hasRush(c))
    .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))) {
    if (rushExtra >= boardSlots) break;
    const cost = rc.cost ?? 0;
    if (donLeft >= cost) { donLeft -= cost; rushExtra++; }
  }

  const totalAttacks  = activeChars + leaderActive + rushExtra;
  const humanBlockers = sim[HUMAN].characterArea.filter(
    fc => fc.state === 'active' && !fc.justDeployed &&
          fcEffectiveHasBlocker(fc, HUMAN, AI, sim)
  ).length;

  // Kill requires draining all N life cards (N hits) PLUS one final winning blow at 0 life.
  return Math.max(0, totalAttacks - humanBlockers) >= humanLife + 1;
}

// Returns true if the human can kill AI on their very next turn and AI lacks the
// counter capacity to survive.
function humanCanKillAiNextTurn(sim) {
  const aiLife = sim[AI].lifeArea.length;

  // All human chars refresh at the start of their turn — count every char + leader
  const humanAttacks = sim[HUMAN].characterArea.length + 1;

  // AI blockers currently active (they stay active between our turn end and human turn start)
  const aiBlockers = sim[AI].characterArea.filter(
    fc => fc.state === 'active' && fcEffectiveHasBlocker(fc, AI, HUMAN, sim)
  ).length;

  const netDamage = Math.max(0, humanAttacks - aiBlockers);
  // Kill requires netDamage > aiLife (drain N life + 1 winning blow at 0); safe if netDamage <= aiLife
  if (netDamage <= aiLife) return false;

  // Stop enough attacks so that remaining hits <= aiLife (no longer enough to kill)
  const attacksToStop    = netDamage - aiLife;
  const freeCounters     = sim[AI].hand.filter(c => (c.counter ?? 0) >= 2000).length;
  const eventCounters    = sim[AI].hand.filter(
    c => isCounterEventCard(c) && canAfford(sim[AI].costArea, c.cost ?? 0)
  ).length;
  return (freeCounters + eventCounters) < attacksToStop;
}

// ---------------------------------------------------------------------------
// Shared helpers — called from multiple branch planners
// ---------------------------------------------------------------------------

// Play any stage card in hand (skips OP13-079 leader and when stage is occupied).
function playStageIfAvailable(sim, actions) {
  const aiLeaderId = sim[AI].leader.card?.id?.replace(/_p\d+$/, '');
  if (aiLeaderId === 'OP13-079' || sim[AI].stageArea) return sim;

  for (let hi = sim[AI].hand.length - 1; hi >= 0; hi--) {
    const stageCard = sim[AI].hand[hi];
    if (stageCard.category !== 'Stage') continue;
    if (!canAfford(sim[AI].costArea, stageCard.cost ?? 0)) continue;
    const preActiveDon = activeDonCount(sim[AI].costArea);
    const stageCost    = stageCard.cost ?? 0;
    actions.push({ type: 'PLAY_STAGE', handIndex: hi });
    sim = applyPlayStage(sim, { handIndex: hi });
    if (sim.winner) return sim;
    const expectedActive = preActiveDon - stageCost;
    let   extraConsumed  = expectedActive - activeDonCount(sim[AI].costArea);
    if (extraConsumed > 0 || sim.pendingEffect || sim.pendingReplace || sim.pendingTrigger) {
      let toRestore = Math.max(0, extraConsumed);
      const corrected = toRestore > 0
        ? sim[AI].costArea.map(d => {
            if (toRestore > 0 && d.state === 'rest') { toRestore--; return { ...d, state: 'active' }; }
            return d;
          })
        : sim[AI].costArea;
      sim = { ...sim, [AI]: { ...sim[AI], costArea: corrected },
        pendingEffect: null, pendingReplace: null, pendingTrigger: null };
    }
  }
  return sim;
}

// Activate leader and character Activate:Main abilities if they resolve cleanly.
function activateMainAbilities(sim, actions) {
  const leaderStatus = getActivatedMainStatus(
    sim[AI].leader.card, sim[AI], sim, AI, { target: 'leader' }
  );
  if (leaderStatus?.available) {
    const trial = applyActivateMain(sim, { zone: 'leader', index: -1 });
    if (!trial.pendingEffect && !trial.pendingReplace && !trial.pendingTrigger) {
      actions.push({ type: 'ACTIVATE_MAIN', zone: 'leader', index: -1 });
      sim = trial;
      if (sim.winner) return sim;
    }
  }
  for (let ci = 0; ci < sim[AI].characterArea.length; ci++) {
    const fc     = sim[AI].characterArea[ci];
    const status = getActivatedMainStatus(fc.card, sim[AI], sim, AI, { target: ci });
    if (!status?.available) continue;
    const trial  = applyActivateMain(sim, { zone: 'character', index: ci });
    if (trial === sim || trial.pendingEffect || trial.pendingReplace || trial.pendingTrigger) continue;
    actions.push({ type: 'ACTIVATE_MAIN', zone: 'character', index: ci });
    sim = trial;
    if (sim.winner) return sim;
  }
  return sim;
}

// Dispatch all character + leader attacks.
// leaderOnlyMode: skip character targeting — all attackers go straight to human leader.
function dispatchAttacks(sim, actions, { leaderOnlyMode = false } = {}) {
  const humanAtZeroLife = sim[HUMAN].lifeArea.length === 0;

  let isLethal = false;
  if (humanAtZeroLife) {
    const leaderDefPow      = calcPower(sim[HUMAN].leader, AI, HUMAN, sim);
    const humanCounterSlots = sim[HUMAN].hand.filter(c => (c.counter ?? 0) >= 2000).length;
    const winningChars      = sim[AI].characterArea.filter(
      fc => fc.state === 'active' && charCanAttack(fc, sim) && !fc.attackLocked
         && calcPower(fc, AI, AI, sim) > leaderDefPow
    ).length;
    const leaderWins = sim[AI].leader.state === 'active' &&
      calcPower(sim[AI].leader, AI, AI, sim) > leaderDefPow;
    isLethal = (winningChars + (leaderWins ? 1 : 0)) > humanCounterSlots;
  }

  const characterAttackers = sim[AI].characterArea
    .map((fc, i) => ({ fc, i, atkPow: calcPower(fc, AI, AI, sim) }))
    .filter(({ fc }) => fc.state === 'active' && charCanAttack(fc, sim) && !fc.attackLocked)
    .sort((a, b) => a.atkPow - b.atkPow);

  const restedEnemies = (humanAtZeroLife || leaderOnlyMode) ? [] :
    sim[HUMAN].characterArea
      .map((hfc, idx) => ({ hfc, idx, defPow: calcPower(hfc, AI, HUMAN, sim) }))
      .filter(({ hfc, defPow }) => hfc.state === 'rest' && isWorthyRestTarget(hfc, defPow))
      .sort((a, b) => b.defPow - a.defPow);

  const targetFor          = new Map();
  const usedAttackers      = new Set();
  const assignedTargetIdxs = new Set();

  for (const enemy of restedEnemies) {
    for (const atk of characterAttackers) {
      if (usedAttackers.has(atk.i)) continue;
      if (atk.atkPow >= enemy.defPow) {
        targetFor.set(atk.i, enemy.idx);
        usedAttackers.add(atk.i);
        assignedTargetIdxs.add(enemy.idx);
        break;
      }
    }
  }

  if (!humanAtZeroLife && !leaderOnlyMode) {
    const weakHumanTargets = sim[HUMAN].characterArea
      .map((hfc, idx) => ({ hfc, idx, defPow: calcPower(hfc, AI, HUMAN, sim) }))
      .filter(({ hfc, idx, defPow }) =>
        hfc.state === 'rest' && defPow < 5000 && !assignedTargetIdxs.has(idx))
      .sort((a, b) => b.defPow - a.defPow);
    for (const enemy of weakHumanTargets) {
      for (const atk of characterAttackers) {
        if (usedAttackers.has(atk.i)) continue;
        if (atk.atkPow >= 5000) continue;
        if (atk.atkPow < enemy.defPow) continue;
        if (isActivateMainSeeker(atk.fc.card)) continue;
        if (fcHasBlocker(atk.fc)) continue;
        targetFor.set(atk.i, enemy.idx);
        usedAttackers.add(atk.i);
        assignedTargetIdxs.add(enemy.idx);
        break;
      }
    }
  }

  const allAttacks        = [];
  const attackedEnemyIdxs = new Set();

  for (const { fc, i, atkPow } of characterAttackers) {
    const assignedIdx = targetFor.get(i);
    const action = assignedIdx !== undefined
      ? { type: 'DECLARE_ATTACK', attackerZone: 'character', attackerIndex: i,
          targetOwner: HUMAN, targetZone: 'character', targetIndex: assignedIdx }
      : { type: 'DECLARE_ATTACK', attackerZone: 'character', attackerIndex: i,
          targetOwner: HUMAN, targetZone: 'leader', targetIndex: -1 };
    const defTarget = assignedIdx !== undefined ? sim[HUMAN].characterArea[assignedIdx] : sim[HUMAN].leader;
    const defPow    = defTarget ? calcPower(defTarget, AI, HUMAN, sim) : 0;
    if (atkPow < defPow && !hasOnAttack(fc.card) && !isLethal) continue;
    if (assignedIdx !== undefined) attackedEnemyIdxs.add(assignedIdx);
    allAttacks.push({ action, atkPow });
  }

  const leaderContKws = evaluateContinuousKeywords(sim[AI].leader, AI, AI, sim);
  if (sim[AI].leader.state === 'active' && !leaderContKws.has('CANNOT_ATTACK')) {
    const leaderPow  = calcPower(sim[AI].leader, AI, AI, sim);
    let   leaderAct  = null;

    if (!humanAtZeroLife && !leaderOnlyMode) {
      const restedTargets = sim[HUMAN].characterArea
        .map((hfc, idx) => ({ hfc, idx, defPow: calcPower(hfc, AI, HUMAN, sim) }))
        .filter(({ hfc, idx, defPow }) =>
          hfc.state === 'rest' && !attackedEnemyIdxs.has(idx) && isWorthyRestTarget(hfc, defPow))
        .sort((a, b) => b.defPow - a.defPow);
      for (const { idx, defPow: rcp } of restedTargets) {
        if (leaderPow >= rcp) {
          leaderAct = { type: 'DECLARE_ATTACK', attackerZone: 'leader', attackerIndex: -1,
            targetOwner: HUMAN, targetZone: 'character', targetIndex: idx };
          break;
        }
      }
    }

    if (!leaderAct) {
      leaderAct = { type: 'DECLARE_ATTACK', attackerZone: 'leader', attackerIndex: -1,
        targetOwner: HUMAN, targetZone: 'leader', targetIndex: -1 };
    }
    allAttacks.push({ action: leaderAct, atkPow: leaderPow });
  }

  const targetKey = ({ action: a }) => `${a.targetOwner}:${a.targetZone}:${a.targetIndex}`;
  allAttacks.sort((a, b) => {
    if (targetKey(a) !== targetKey(b)) return 0;
    return a.atkPow - b.atkPow;
  });

  for (const { action } of allAttacks) {
    actions.push(action);
    sim = applyDeclareAttack(sim, action);
    if (sim.winner) break;
  }

  return sim;
}

// Deploy a rush character from hand and immediately attack.
// preferLeader=true → always target human leader.
// preferLeader=false → target the weakest rested human char the rush char can beat, else leader.
function deployRushAndAttack(sim, actions, cardId, preferLeader = false) {
  const handIndex = sim[AI].hand.findIndex(c => c.id === cardId);
  if (handIndex === -1) return sim;
  if (!canAfford(sim[AI].costArea, sim[AI].hand[handIndex].cost ?? 0)) return sim;
  if (sim[AI].characterArea.length >= MAX_CHARACTERS) return sim;

  actions.push({ type: 'PLAY_CHARACTER', handIndex });
  sim = applyPlayCharacter(sim, { handIndex });
  if (sim.winner) return sim;

  // The newly deployed character is always appended to the end of characterArea
  const charIndex = sim[AI].characterArea.length - 1;
  const fc        = sim[AI].characterArea[charIndex];
  if (!fc || !charCanAttack(fc, sim)) return sim;

  const charPow = calcPower(fc, AI, AI, sim);

  let targetZone  = 'leader';
  let targetIndex = -1;

  if (!preferLeader) {
    const restedChars = sim[HUMAN].characterArea
      .map((hfc, idx) => ({ hfc, idx, defPow: calcPower(hfc, AI, HUMAN, sim) }))
      .filter(({ hfc }) => hfc.state === 'rest')
      .sort((a, b) => b.defPow - a.defPow);
    const bestTarget = restedChars.find(({ defPow }) => charPow >= defPow);
    if (bestTarget) {
      targetZone  = 'character';
      targetIndex = bestTarget.idx;
    }
  }

  const attackAction = {
    type: 'DECLARE_ATTACK', attackerZone: 'character', attackerIndex: charIndex,
    targetOwner: HUMAN, targetZone, targetIndex,
  };
  actions.push(attackAction);
  sim = applyDeclareAttack(sim, attackAction);
  return sim;
}

// ---------------------------------------------------------------------------
// BRANCH 1: Early game (turns 1–EARLY_GAME_TURNS) — curve presence
// ---------------------------------------------------------------------------

function planEarlyGame(sim, actions, state) {
  sim = playStageIfAvailable(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Play at most one character per attempt; prefer exact-DON-cost match for the curve,
  // then fall back to highest-cost affordable character.
  for (let attempt = 0; attempt < 3; attempt++) {
    const ps        = sim[AI];
    if (ps.characterArea.length >= MAX_CHARACTERS || ps.deployBlockedThisTurn || ps.handPlayLocked) break;

    const available = activeDonCount(ps.costArea);
    const ranked    = rankCardsForTurn(ps.hand, available);
    const playable  = ranked.filter(r => {
      if (r.category !== 'Character') return false;
      if (!isPlayableAsCharacter(r)) return false;
      if (!canAfford(ps.costArea, r.cost ?? 0)) return false;
      if (ps.deployBlockCost) {
        const { threshold, op } = ps.deployBlockCost;
        const c = r.cost ?? 0;
        if (op === 'gte' && c >= threshold) return false;
        if (op === 'lte' && c <= threshold) return false;
      }
      return true;
    });
    if (!playable.length) break;

    // Exact-cost match (spends all DON in one play — ideal on-curve body)
    const exactMatch = playable.filter(r => (r.cost ?? 0) === available);
    const pool       = exactMatch.length ? exactMatch : playable;
    const maxCost    = Math.max(...pool.map(r => r.cost ?? 0));
    const topTier    = pool.filter(r => (r.cost ?? 0) === maxCost);

    let bestIdx = ps.hand.findIndex(c => c.id === topTier[0].id);
    if (topTier.length > 1) {
      let best = -Infinity;
      for (const cand of topTier) {
        const idx   = ps.hand.findIndex(c => c.id === cand.id);
        const score = trialPlayScore(sim, idx);
        if (score > best) { best = score; bestIdx = idx; }
      }
    }
    if (bestIdx === -1) break;

    actions.push({ type: 'PLAY_CHARACTER', handIndex: bestIdx });
    sim = applyPlayCharacter(sim, { handIndex: bestIdx });
    if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  }

  {
    const lp            = getLeaderProfile(sim[AI].leader.card?.id);
    const justPlayedChar = sim[AI].characterArea.some(fc => fc.justDeployed);
    sim = planDonAttachment(sim, actions, Infinity, {
      preferLeader: !!(lp?.preferLeaderAttach && !justPlayedChar),
    });
  }
  sim = activateMainAbilities(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  if (state.turn === 1) { actions.push({ type: 'END_TURN' }); return actions; }

  sim = dispatchAttacks(sim, actions);
  actions.push({ type: 'END_TURN' });
  return actions;
}

// ---------------------------------------------------------------------------
// BRANCH 2: Kill mode — maximum attack output to close out the game
// ---------------------------------------------------------------------------

function planKillMode(sim, actions, state) {
  sim = playStageIfAvailable(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Identify rush chars to deploy this turn (cheapest first, up to board limit)
  const rushToPlay = [];
  {
    let donLeft    = activeDonCount(sim[AI].costArea);
    let boardSlots = MAX_CHARACTERS - sim[AI].characterArea.length;
    for (const rc of [...sim[AI].hand]
      .filter(c => c.category === 'Character' && hasRush(c) && isPlayableAsCharacter(c))
      .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))) {
      if (rushToPlay.length >= boardSlots) break;
      const cost = rc.cost ?? 0;
      if (donLeft >= cost) { donLeft -= cost; rushToPlay.push(rc.id); }
    }
  }

  // Kill-optimised DON attachment: no counter hold; push each attacker above the
  // opponent's counter threshold (+k*2000 over human leader power).
  {
    const humanLeaderPow = sim[HUMAN].leader.card?.power ?? 0;
    // Reserve DON for the planned rush plays
    const reservedForRush = rushToPlay.reduce((sum, id) => {
      const c = sim[AI].hand.find(c => c.id === id);
      return sum + (c?.cost ?? 0);
    }, 0);
    let budget = Math.max(0, activeDonCount(sim[AI].costArea) - reservedForRush);

    for (let ci = 0; ci < sim[AI].characterArea.length && budget > 0; ci++) {
      const fc = sim[AI].characterArea[ci];
      if (fc.state !== 'active' || !charCanAttack(fc, sim) || fc.attackLocked) continue;
      const curPow = (fc.card.power ?? 0) + fc.attachedDon * 1000;
      const k      = Math.max(1, Math.ceil((curPow - humanLeaderPow + 1) / 2000));
      const target = humanLeaderPow + k * 2000;
      const needed = (target - curPow) / 1000;
      if (needed <= 0 || !Number.isInteger(needed) || needed > budget) continue;
      for (let d = 0; d < needed; d++) {
        actions.push({ type: 'ATTACH_DON', targetZone: 'character', targetIndex: ci });
        sim = applyAttachDon(sim, { targetZone: 'character', targetIndex: ci });
        budget--;
      }
    }
    // Remaining DON → leader
    while (budget > 0 && activeDonCount(sim[AI].costArea) > 0) {
      actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
      sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
      budget--;
    }
  }

  sim = activateMainAbilities(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  if (state.turn === 1) { actions.push({ type: 'END_TURN' }); return actions; }

  // All existing attackers go straight to human leader
  sim = dispatchAttacks(sim, actions, { leaderOnlyMode: true });
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Deploy each planned rush char and immediately attack the leader
  for (const cardId of rushToPlay) {
    sim = deployRushAndAttack(sim, actions, cardId, true);
    if (sim.winner) break;
  }

  actions.push({ type: 'END_TURN' });
  return actions;
}

// ---------------------------------------------------------------------------
// BRANCH 3: Survival mode — reduce human attack count and preserve AI life
// ---------------------------------------------------------------------------

function planSurvivalMode(sim, actions) {
  sim = playStageIfAvailable(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Reserve DON for counter events: hold at least max(COUNTER_HOLD_DON, cheapest event cost)
  const cheapestEventCost = sim[AI].hand
    .filter(isCounterEventCard)
    .reduce((min, c) => Math.min(min, c.cost ?? 0), Infinity);
  const leaderReserve = getLeaderProfile(sim[AI].leader.card?.id)?.donReserve ?? 0;
  const holdDon       = (isFinite(cheapestEventCost)
    ? Math.max(COUNTER_HOLD_DON, cheapestEventCost)
    : COUNTER_HOLD_DON) + leaderReserve;

  // Minimal DON attachment: only boost leader to enable its attack
  {
    const leaderBasePow  = (sim[AI].leader.card?.power ?? 0) + sim[AI].leader.attachedDon * 1000;
    const humanLeaderPow = calcPower(sim[HUMAN].leader, AI, HUMAN, sim);
    let   budget         = Math.max(0, activeDonCount(sim[AI].costArea) - holdDon);
    if (sim[AI].leader.state === 'active' && leaderBasePow < humanLeaderPow && budget > 0) {
      const needed  = Math.ceil((humanLeaderPow - leaderBasePow) / 1000);
      const canGive = Math.min(needed, budget);
      for (let d = 0; d < canGive; d++) {
        actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
        sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
        budget--;
      }
    }
  }

  sim = activateMainAbilities(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Attack with existing board — prioritises rested human chars to shrink their board
  sim = dispatchAttacks(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Deploy rush chars (attack immediately) and non-rush chars with removal effects
  // (on-play KO/REST/RETURN_HAND reduces human board; blockers handled separately below).
  {
    let donLeft    = activeDonCount(sim[AI].costArea);
    let boardSlots = MAX_CHARACTERS - sim[AI].characterArea.length;
    const removalCandidates = [...sim[AI].hand]
      .filter(c => c.category === 'Character' && isPlayableAsCharacter(c) &&
        (hasRush(c) || hasOpponentRemovalEffect(c)) && canAfford(sim[AI].costArea, c.cost ?? 0))
      // Rush chars first (immediate board impact), then non-rush; within each group cheapest first
      .sort((a, b) => {
        const aRush = hasRush(a) ? 0 : 1;
        const bRush = hasRush(b) ? 0 : 1;
        if (aRush !== bRush) return aRush - bRush;
        return (a.cost ?? 0) - (b.cost ?? 0);
      });
    for (const rc of removalCandidates) {
      if (boardSlots <= 0) break;
      const cost = rc.cost ?? 0;
      if (donLeft - cost < holdDon) continue;
      donLeft -= cost;
      boardSlots--;
      if (hasRush(rc)) {
        sim = deployRushAndAttack(sim, actions, rc.id, false);
      } else {
        const hi = sim[AI].hand.findIndex(c => c.id === rc.id);
        if (hi === -1) continue;
        actions.push({ type: 'PLAY_CHARACTER', handIndex: hi });
        sim = applyPlayCharacter(sim, { handIndex: hi });
      }
      if (sim.winner) break;
    }
  }
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Deploy blocker characters (don't attack — preserve them for blocking next turn)
  {
    let donLeft    = activeDonCount(sim[AI].costArea);
    let boardSlots = MAX_CHARACTERS - sim[AI].characterArea.length;
    for (const bc of [...sim[AI].hand]
      .filter(c => c.category === 'Character' && fcHasBlocker({ card: c }) &&
        isPlayableAsCharacter(c) && canAfford(sim[AI].costArea, c.cost ?? 0))
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))) {  // highest-cost blockers first
      if (boardSlots <= 0) break;
      const cost = bc.cost ?? 0;
      if (donLeft - cost < holdDon) continue;
      const hi = sim[AI].hand.findIndex(c => c.id === bc.id);
      if (hi === -1) continue;
      donLeft -= cost;
      boardSlots--;
      actions.push({ type: 'PLAY_CHARACTER', handIndex: hi });
      sim = applyPlayCharacter(sim, { handIndex: hi });
      if (sim.winner) break;
    }
  }

  actions.push({ type: 'END_TURN' });
  return actions;
}

// ---------------------------------------------------------------------------
// BRANCH 4: Safe mode — pre-plan plays, attach DON to existing board, then execute
// ---------------------------------------------------------------------------

function planSafeMode(sim, actions, state) {
  sim = playStageIfAvailable(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // ── Phase 1: Pre-plan (simulation only — no dispatched actions) ────────────

  const leaderDonReserve = (() => {
    const leader    = sim[AI].leader;
    if (leader.state !== 'active') return 0;
    const humanPow  = sim[HUMAN].leader.card?.power ?? 0;
    const leaderPow = leader.card?.power ?? 0;
    if (leaderPow >= humanPow) return 0;
    return Math.ceil((humanPow - leaderPow) / 1000) + 1;
  })();

  const rushPlan    = [];  // card IDs planned to play as rush deployments
  const nonRushPlan = [];  // card IDs planned to play as non-rush expansions

  // Simulate rush char selection (cheapest first)
  {
    let donLeft    = activeDonCount(sim[AI].costArea);
    let boardSlots = MAX_CHARACTERS - sim[AI].characterArea.length;
    for (const rc of [...sim[AI].hand]
      .filter(c => c.category === 'Character' && hasRush(c) && isPlayableAsCharacter(c))
      .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))) {
      if (rushPlan.length >= boardSlots) break;
      const cost = rc.cost ?? 0;
      if (donLeft >= cost) { donLeft -= cost; rushPlan.push(rc.id); }
    }
  }

  // Simulate non-rush char selection (highest-cost greedy, same logic as before)
  {
    let mockSim = sim;
    // Advance mock sim past the planned rush plays to get accurate remaining DON
    for (const id of rushPlan) {
      const hi = mockSim[AI].hand.findIndex(c => c.id === id);
      if (hi === -1) continue;
      mockSim = applyPlayCharacter(mockSim, { handIndex: hi });
      if (mockSim.pendingEffect || mockSim.pendingReplace || mockSim.pendingTrigger)
        mockSim = { ...mockSim, pendingEffect: null, pendingReplace: null, pendingTrigger: null };
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const ps        = mockSim[AI];
      if (ps.characterArea.length >= MAX_CHARACTERS || ps.deployBlockedThisTurn || ps.handPlayLocked) break;
      const available    = activeDonCount(ps.costArea);
      const ranked       = rankCardsForTurn(ps.hand, available);
      const basePlayable = ranked.filter(r => {
        if (r.category !== 'Character') return false;
        if (!isPlayableAsCharacter(r)) return false;
        if (hasRush(r)) return false;  // already captured in rushPlan
        if (!canAfford(ps.costArea, r.cost ?? 0)) return false;
        if (ps.deployBlockCost) {
          const { threshold, op } = ps.deployBlockCost;
          const c = r.cost ?? 0;
          if (op === 'gte' && c >= threshold) return false;
          if (op === 'lte' && c <= threshold) return false;
        }
        return true;
      });
      let playable = basePlayable.filter(r => available - (r.cost ?? 0) >= leaderDonReserve);
      if (!playable.length) playable = basePlayable;
      if (!playable.length) break;

      const maxCost = Math.max(...playable.map(r => r.cost ?? 0));
      const topTier = playable.filter(r => (r.cost ?? 0) === maxCost);
      let   bestIdx = mockSim[AI].hand.findIndex(c => c.id === topTier[0].id);
      if (topTier.length > 1) {
        let best = -Infinity;
        for (const cand of topTier) {
          const idx   = mockSim[AI].hand.findIndex(c => c.id === cand.id);
          const score = trialPlayScore(mockSim, idx);
          if (score > best) { best = score; bestIdx = idx; }
        }
      }
      if (bestIdx === -1) break;

      const chosenCard = mockSim[AI].hand[bestIdx];
      nonRushPlan.push(chosenCard.id);
      mockSim = applyPlayCharacter(mockSim, { handIndex: bestIdx });
      if (mockSim.pendingEffect || mockSim.pendingReplace || mockSim.pendingTrigger)
        mockSim = { ...mockSim, pendingEffect: null, pendingReplace: null, pendingTrigger: null };
    }
  }

  // ── Phase 2: Execute ───────────────────────────────────────────────────────

  // 2a: Attach DON to existing board — budget = activeDon minus planned play costs minus hold
  {
    const totalPlannedCost = [...rushPlan, ...nonRushPlan].reduce((sum, id) => {
      const c = sim[AI].hand.find(c => c.id === id);
      return sum + (c?.cost ?? 0);
    }, 0);
    const opponentHandLow = sim[HUMAN].hand.length <= LOW_HAND_THRESHOLD;
    const leaderReserve   = getLeaderProfile(sim[AI].leader.card?.id)?.donReserve ?? 0;
    const counterHold     = ((!opponentHandLow && hasCounterEvent(sim[AI].hand)) ? COUNTER_HOLD_DON : 0) + leaderReserve;
    const donForAttach    = Math.max(0, activeDonCount(sim[AI].costArea) - totalPlannedCost - counterHold);
    if (donForAttach > 0) {
      const lp = getLeaderProfile(sim[AI].leader.card?.id);
      sim = planDonAttachment(sim, actions, donForAttach, {
        preferLeader: !!(lp?.preferLeaderAttach && totalPlannedCost === 0),
      });
    }
  }

  // 2b: Activate main abilities
  sim = activateMainAbilities(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  if (state.turn === 1) { actions.push({ type: 'END_TURN' }); return actions; }

  // 2c: Attack with existing board (weakest first)
  sim = dispatchAttacks(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // 2d: Deploy each rush char and immediately attack
  for (const cardId of rushPlan) {
    sim = deployRushAndAttack(sim, actions, cardId, false);
    if (sim.winner) break;
  }
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // 2e: Deploy non-rush characters (no attack this turn)
  for (const cardId of nonRushPlan) {
    const hi = sim[AI].hand.findIndex(c => c.id === cardId);
    if (hi === -1) continue;
    const card = sim[AI].hand[hi];
    if (!canAfford(sim[AI].costArea, card.cost ?? 0)) continue;
    if (sim[AI].characterArea.length >= MAX_CHARACTERS) break;
    if (sim[AI].deployBlockedThisTurn || sim[AI].handPlayLocked) break;
    actions.push({ type: 'PLAY_CHARACTER', handIndex: hi });
    sim = applyPlayCharacter(sim, { handIndex: hi });
    if (sim.winner) break;
  }

  actions.push({ type: 'END_TURN' });
  return actions;
}

// ---------------------------------------------------------------------------
// Main phase router — selects the appropriate branch for the current situation
// ---------------------------------------------------------------------------

function planMainPhase(state) {
  const actions = [];
  let   sim     = { ...state };

  if (state.turn <= EARLY_GAME_TURNS) return planEarlyGame(sim, actions, state);
  if (canKillHuman(sim))              return planKillMode(sim, actions, state);
  if (humanCanKillAiNextTurn(sim))    return planSurvivalMode(sim, actions);
  return planSafeMode(sim, actions, state);
}

// ---------------------------------------------------------------------------
// Reactive: AI decides whether to block during human's attack
// ---------------------------------------------------------------------------

export function aiDecideBlock(state) {
  const battle = state.battle;
  if (!battle) return { type: 'SKIP_BLOCK' };

  const aiPs   = state[AI];
  const atkPow = battle.atkPower;

  const blockers = [];
  for (let i = 0; i < aiPs.characterArea.length; i++) {
    const fc = aiPs.characterArea[i];
    if (!fcEffectiveHasBlocker(fc, AI, state.activePlayer, state) || fc.state !== 'active') continue;
    blockers.push({ i, pow: calcPower(fc, battle.attackerOwner, AI, state) });
  }
  if (fcEffectiveHasBlocker(aiPs.leader, AI, state.activePlayer, state) && aiPs.leader?.state === 'active') {
    blockers.push({ i: 'leader', pow: calcPower(aiPs.leader, battle.attackerOwner, AI, state) });
  }
  if (!blockers.length) return { type: 'SKIP_BLOCK' };

  // Tier 1: weakest blocker that wins outright
  const winners = blockers.filter(b => b.pow > atkPow);
  if (winners.length) {
    const weakest = winners.reduce((a, b) => b.pow < a.pow ? b : a);
    return { type: 'USE_BLOCKER', blockerIndex: weakest.i };
  }

  const attackWouldSucceed = atkPow > battle.defPower;
  if (!attackWouldSucceed) return { type: 'SKIP_BLOCK' };

  const weakestBlocker = blockers.reduce((a, b) => b.pow < a.pow ? b : a);

  // Tier 1.5: Double Attack / Banish — disproportionately punishing, sacrifice weakest blocker
  const attackerFC = battle.attackerZone === 'leader'
    ? state[battle.attackerOwner].leader
    : state[battle.attackerOwner].characterArea[battle.attackerIndex];
  if (fcEffectiveHasDoubleAtk(attackerFC, state.activePlayer, battle.attackerOwner, state) ||
      fcHasBanish(attackerFC)) {
    return { type: 'USE_BLOCKER', blockerIndex: weakestBlocker.i };
  }

  // Tier 2: sacrificial block when life ≤ 2 — sacrifice the weakest blocker to stay
  // in the game while preserving stronger blockers for future attacks.
  if (battle.targetZone === 'leader' && aiPs.lifeArea.length <= 2) {
    return { type: 'USE_BLOCKER', blockerIndex: weakestBlocker.i };
  }

  return { type: 'SKIP_BLOCK' };
}

// ---------------------------------------------------------------------------
// Reactive: AI decides whether to play counter cards
// ---------------------------------------------------------------------------

export function aiDecideCounter(state) {
  const battle = state.battle;
  if (!battle) return { type: 'SKIP_COUNTER' };

  const aiPs = state[AI];
  const gap  = battle.atkPower - battle.defPower;

  if (gap < 0) return { type: 'SKIP_COUNTER' };

  const isLethal = battle.targetZone === 'leader' && aiPs.lifeArea.length <= 1;

  if (battle.targetZone === 'leader') {
    if (!isLethal && aiPs.lifeArea.length >= SAFE_LIFE_COUNT) {
      return { type: 'SKIP_COUNTER' };
    }
  } else {
    const targetFc        = aiPs.characterArea[battle.targetIndex];
    const humanLeaderPow  = state[HUMAN].leader?.card?.power ?? 0;
    const opponentNextGap = Math.max(0, battle.defPower - humanLeaderPow);
    const isWorthDefending =
      (targetFc?.card.power ?? 0) >= 5000 ||
      hasOnAttack(targetFc?.card) ||
      gap < opponentNextGap;
    if (!isWorthDefending) return { type: 'SKIP_COUNTER' };

    // Priority check: count remaining human attacks and available counters.
    // If we can't cover every remaining attack, only spend here when this character
    // is at least as valuable (by base power) as any other rested character still
    // at risk — save counters for the highest-power targets first.
    const remainingHumanAttacks =
      state[HUMAN].characterArea.filter(fc => fc.state === 'active').length +
      (state[HUMAN].leader.state === 'active' ? 1 : 0);

    if (remainingHumanAttacks > 0) {
      const totalCounterCards = aiPs.hand.filter(c =>
        (c.counter ?? 0) >= 2000 || isCounterEventCard(c)
      ).length;
      // Counter-scarce: fewer counters than remaining attacks (can't cover everything)
      if (totalCounterCards <= remainingHumanAttacks) {
        const currentTargetPow  = targetFc?.card?.power ?? 0;
        const maxOtherRestedPow = aiPs.characterArea
          .filter((fc, i) => fc.state === 'rest' && i !== battle.targetIndex)
          .reduce((max, fc) => Math.max(max, fc.card?.power ?? 0), 0);
        if (currentTargetPow < maxOtherRestedPow) {
          return { type: 'SKIP_COUNTER' };
        }
      }
    }
  }

  // Hand-size guard: countering spends a card from hand. If playing one counter
  // would leave fewer than MIN_HEALTHY_HAND cards, skip — the hand is already lean
  // and we need those cards for future plays and counters this turn.
  // Exception: lethal hits must be countered regardless of hand size.
  if (!isLethal && aiPs.hand.length <= MIN_HEALTHY_HAND) {
    return { type: 'SKIP_COUNTER' };
  }

  const isBlockerChar = (card) => card.category === 'Character' && hasBlocker(card);

  const counterCards = aiPs.hand
    .map((card, i) => ({ card, i }))
    .filter(({ card }) => (card.counter ?? 0) > 0)
    .sort((a, b) => {
      // Blocker characters are more valuable deployed on the field — use them last
      const aB = isBlockerChar(a.card) ? 1 : 0;
      const bB = isBlockerChar(b.card) ? 1 : 0;
      if (aB !== bB) return aB - bB;
      // Smallest counter value first; lowest cost as tiebreaker (higher cost = higher play value)
      const diff = a.card.counter - b.card.counter;
      if (diff !== 0) return diff;
      return (a.card.cost ?? 0) - (b.card.cost ?? 0);
    });

  const efficient = counterCards.find(({ card }) => card.counter > gap);
  if (efficient) return { type: 'PLAY_COUNTER', handIndex: efficient.i };

  if (isLethal && counterCards.length > 0) {
    const total = counterCards.reduce((sum, { card }) => sum + (card.counter ?? 0), 0);
    if (total > gap) {
      // Play highest-counter non-blocker first so blockers are spent only if unavoidable
      const nonBlockers = counterCards.filter(({ card }) => !isBlockerChar(card));
      const pool    = nonBlockers.length ? nonBlockers : counterCards;
      const largest = pool.reduce((a, b) => (b.card.counter ?? 0) > (a.card.counter ?? 0) ? b : a);
      return { type: 'PLAY_COUNTER', handIndex: largest.i };
    }
  }

  const eventCounters = aiPs.hand
    .map((card, i) => ({ card, i }))
    .filter(({ card }) =>
      card.category === 'Event' &&
      ((card.effect ?? '').includes('反擊') || (card.enEffect ?? '').includes('[Counter]')) &&
      canAfford(aiPs.costArea, card.cost ?? 0))
    .sort((a, b) => (a.card.cost ?? 0) - (b.card.cost ?? 0));

  for (const { i } of eventCounters) {
    const trial = applyPlayCounter(state, { handIndex: i });
    if (trial === state || !trial.battle) continue;
    if (trial.battle.defPower > trial.battle.atkPower) {
      return { type: 'PLAY_COUNTER', handIndex: i };
    }
  }

  return { type: 'SKIP_COUNTER' };
}

// ---------------------------------------------------------------------------
// AI Turn Runner — called from useEffect in PracticeView
// ---------------------------------------------------------------------------

export function getAiTurnActions(state) {
  return planMainPhase(state);
}
