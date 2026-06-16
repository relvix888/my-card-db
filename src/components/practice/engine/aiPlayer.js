import { PLAYER, MAX_CHARACTERS, DON_PER_TURN } from './constants';
import { getLeaderProfile } from './leaderProfiles';
import {
  applyPlayCharacter, applyPlayStage, applyAttachDon, applyActivateMain,
  applyDeclareAttack, applyPlayCounter, applyPlayEvent, canAfford, calcPower, activeDonCount,
  getEffectiveCost,
} from './gameState';
import { rankCardsForTurn } from '../../../utils/cardRanker';
import {
  hasOnAttack, hasBlocker, fcHasBlocker, fcEffectiveHasDoubleAtk, fcHasBanish,
  fcEffectiveHasBlocker, getActivatedMainStatus, evaluateContinuousKeywords,
  hasRush,
} from './effects';

const AI    = PLAYER.GUEST;
const HUMAN = PLAYER.HOST;

// Cost of a hand card after applying active handCostMods (e.g. OP12-061 -2 discount).
const effCost = (card, ps) => getEffectiveCost(card, ps.handCostMods);

const MAGIC_NUMBERS                 = [7000, 5000];
const COUNTER_HOLD_DON              = 2;
const SAFE_LIFE_COUNT               = 3;
const LOW_HAND_THRESHOLD            = 2;
const RESTED_TARGET_POWER_THRESHOLD = 5000;
const EARLY_GAME_TURNS              = 3;  // turns 1–N use curve-based deployment
const MIN_HEALTHY_HAND              = 5;  // don't counter non-lethal hits when hand would drop below this
const BLOCKER_VALUE                 = 5;  // evalBoardState: per net active [Blocker] (a blocker absorbs a hit ≈ a life card)
const UNDER_DEFENSE_PENALTY         = 20; // evalBoardState: per missing defender when out-defended (survival pressure)

const weakestFieldCost = ps => ps.characterArea.length
  ? Math.min(...ps.characterArea.map(fc => fc.card?.cost ?? 0))
  : 0;

function charCanAttack(fc, sim) {
  if (fc.restLocked) return false;
  if (!fc.justDeployed) return true;
  // tempKeywords covers Rush granted by leader triggers (e.g. OP16-079 trash-deploy Rush)
  if (fc.tempKeywords?.includes('速攻') || fc.tempKeywords?.includes('Rush')) return true;
  return evaluateContinuousKeywords(fc, AI, AI, sim).has('速攻');
}

// Like hasRush but also checks conditional Rush clauses (e.g. "gains Rush when leader has
// Egghead type") by evaluating the condition against the current game state.
// Used at planning time so that conditional-Rush cards are placed in rushPlan, not nonRushPlan.
function hasEffectiveRush(card, sim) {
  if (hasRush(card)) return true;
  const fakeFC = { card, attachedDon: 0, justDeployed: true, state: 'active' };
  if (evaluateContinuousKeywords(fakeFC, AI, AI, sim).has('速攻')) return true;
  // On-play self-Rush grants (e.g. OP15-008: "[On Play] ... this Character gains [Rush] during this turn")
  const enEff = card.enEffect ?? '';
  return enEff.includes('[On Play]') && enEff.includes('this Character gains [Rush]');
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

// Characters that boost the leader's power on-play (or via an immediate continuous
// effect) — most valuable when played before attacks so the leader attacks with the boost.
const PRE_ATTACK_CHARACTER_IDS = new Set([
  'OP13-042', // gives rested DON!! to leader + 1 character
  'EB04-007', // [On Play] leader +2000
  'EB04-061', // [On Play] trash 1: leader +2000
  'OP09-013', // [On Play] leader +1000
  'P-107',    // [On Play] (conditional) leader +2000
  'ST23-002', // [On Play] (conditional) leader +2000
  'ST24-004', // [On Play] REST opponent char, then (conditional) leader +2000
  'ST28-004', // [Your Turn] (conditional) leader +1000 continuous
]);

function isPreAttackCharacter(card) {
  const baseId = (card?.id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
  return PRE_ATTACK_CHARACTER_IDS.has(baseId);
}

// Deploys all affordable pre-attack characters from hand before attacks.
// Scans hand directly so cards excluded from Phase-1 planning (e.g. by DON budget
// constraints) are still played at the right time. Clears pendingEffect in the
// simulation — the real game engine resolves on-play effects between queued actions.
function deployPreAttackChars(sim, actions) {
  if (sim[AI].deployBlockedThisTurn || sim[AI].handPlayLocked) return sim;
  let found = true;
  while (found) {
    found = false;
    for (let hi = 0; hi < sim[AI].hand.length; hi++) {
      const card = sim[AI].hand[hi];
      if (!isPreAttackCharacter(card)) continue;
      if (!canAfford(sim[AI].costArea, card.cost ?? 0)) continue;
      if (sim[AI].characterArea.length >= MAX_CHARACTERS && (card.cost ?? 0) <= weakestFieldCost(sim[AI])) continue;
      actions.push({ type: 'PLAY_CHARACTER', handIndex: hi });
      sim = applyPlayCharacter(sim, { handIndex: hi });
      if (sim.pendingEffect || sim.pendingReplace || sim.pendingTrigger)
        sim = { ...sim, pendingEffect: null, pendingReplace: null, pendingTrigger: null };
      if (sim.winner) return sim;
      found = true;
      break; // hand indices shifted — restart scan
    }
  }
  return sim;
}

// Deploy at most one leader-profile priority character BEFORE the leader's Activate:Main fires,
// so the activation can target that freshly-deployed character (e.g. OP16-001 giving Rush to
// OP16-003 Newgate which was just played).  The real game resolves any on-play pendingEffect
// separately; we clear it in the simulation so planning can continue.
function deployPriorityBeforeActivation(sim, actions) {
  const lp = getLeaderProfile(sim[AI].leader.card?.id);
  if (!lp?.deployPriorityBeforeActivation) return sim;
  if (sim[AI].deployBlockedThisTurn || sim[AI].handPlayLocked) return sim;

  const _base = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
  const conds  = lp.cardPlayConditions ?? {};

  for (const prioId of (lp.cardPlayPriority ?? [])) {
    const hi = sim[AI].hand.findIndex(c => _base(c.id) === prioId);
    if (hi === -1) continue;
    const card = sim[AI].hand[hi];
    if (card.category !== 'Character') continue;
    if (!isPlayableAsCharacter(card)) continue;
    if (hasEffectiveRush(card, sim)) continue;
    const cond = conds[prioId] ?? {};
    if (cond.minTotalDon && sim[AI].costArea.length < cond.minTotalDon) continue;
    if (!canAfford(sim[AI].costArea, effCost(card, sim[AI]))) continue;
    if (sim[AI].characterArea.length >= MAX_CHARACTERS && (card.cost ?? 0) <= weakestFieldCost(sim[AI])) continue;

    actions.push({ type: 'PLAY_CHARACTER', handIndex: hi });
    sim = applyPlayCharacter(sim, { handIndex: hi });
    if (sim.pendingEffect || sim.pendingReplace || sim.pendingTrigger)
      sim = { ...sim, pendingEffect: null, pendingReplace: null, pendingTrigger: null };
    break; // one priority card per activation window
  }
  return sim;
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
  const lp             = getLeaderProfile(sim[AI].leader.card?.id);
  const opponentHandLow = sim[HUMAN].hand.length <= LOW_HAND_THRESHOLD;
  const leaderReserve   = lp?.donReserve ?? 0;
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

  // Priority 2b: ensure leader meets its DON!! gate (e.g. OP14-041 needs ≥1 attached).
  // Runs before character magic-number loops so the gate is satisfied every turn.
  {
    const donGate = lp?.leaderDonGate ?? 0;
    const toGate  = Math.max(0, donGate - (sim[AI].leader.attachedDon ?? 0));
    const attach  = Math.min(toGate, budget);
    for (let d = 0; d < attach; d++) {
      actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
      sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
      budget--;
    }
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

// How many DON!! to attach to an attacker with `curPow` to reach an effective threshold.
// killMode: push above humanLeaderPow + k*2000 (counter-proof). safe: magic numbers first.
function donToBoost(curPow, humanLeaderPow, budget, killMode) {
  if (budget <= 0) return 0;
  if (killMode) {
    const k      = Math.max(1, Math.ceil((curPow - humanLeaderPow + 1) / 2000));
    const target = humanLeaderPow + k * 2000;
    const needed = (target - curPow) / 1000;
    return (needed > 0 && Number.isInteger(needed) && needed <= budget) ? needed : 0;
  }
  for (const magic of MAGIC_NUMBERS) {
    if (curPow < magic) {
      const needed = (magic - curPow) / 1000;
      if (Number.isInteger(needed) && needed > 0 && needed <= budget) return needed;
    }
  }
  if (curPow <= humanLeaderPow) {
    const k      = Math.max(1, Math.ceil((curPow - humanLeaderPow + 1) / 2000));
    const target = humanLeaderPow + k * 2000;
    const needed = (target - curPow) / 1000;
    if (needed > 0 && Number.isInteger(needed) && needed <= budget) return needed;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Board State Evaluation
// ---------------------------------------------------------------------------

function evalBoardState(state) {
  if (state.winner === AI)    return  10000;
  if (state.winner === HUMAN) return -10000;

  const ai    = state[AI];
  const human = state[HUMAN];

  const lifeScore  = (ai.lifeArea.length - human.lifeArea.length) * 2;
  // Attached DON returns to the cost area at next refresh — discount it vs permanent character power.
  const aiPow      = ai.characterArea.reduce((s, fc) => s + (fc.card.power ?? 0) + fc.attachedDon * 300, 0);
  const humanPow   = human.characterArea.reduce((s, fc) => s + (fc.card.power ?? 0) + fc.attachedDon * 300, 0);
  const boardScore = (aiPow - humanPow) / 2000;
  const aiActive   = ai.characterArea.filter(fc => fc.state === 'active').length;
  const humanActive = human.characterArea.filter(fc => fc.state === 'active').length;
  const activeScore = (aiActive - humanActive) * 1.5;
  const handScore  = (ai.hand.length - human.hand.length) * 0.3;

  // Active [Blocker] keyword premium — boardScore already counts power; this rewards the
  // keyword's reusable defensive value (and penalises leaving the opponent with blockers).
  const aiBlockers    = ai.characterArea.filter(fc => fc.state === 'active' && fcEffectiveHasBlocker(fc, AI, HUMAN, state)).length;
  const humanBlockers = human.characterArea.filter(fc => fc.state === 'active' && fcEffectiveHasBlocker(fc, HUMAN, AI, state)).length;
  const blockerScore  = (aiBlockers - humanBlockers) * BLOCKER_VALUE;

  // Graded survival pressure — every net defender (life card + active blocker) we are short of the
  // opponent's potential hits is a step toward lethal. Monotonic in aiBlockers, so deploying a
  // blocker that closes the gap raises the score. Counters in hand are deliberately NOT subtracted
  // (errs toward keeping a defensive body on the field).
  const humanThreats  = human.characterArea.length + 1; // chars + leader (kept light vs. the predictor)
  const defenseGap    = Math.max(0, humanThreats - (ai.lifeArea.length + aiBlockers));
  const survivalScore = -defenseGap * UNDER_DEFENSE_PENALTY;

  return lifeScore + boardScore + activeScore + handScore + blockerScore + survivalScore;
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
    .filter(c => c.category === 'Character' && hasEffectiveRush(c, sim))
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

  // All human chars refresh at the start of their turn — count every char + leader, with
  // double-attackers counted twice (each lands two hits).
  const countHits = (fc, owner) => 1 + (fcEffectiveHasDoubleAtk(fc, HUMAN, owner, sim) ? 1 : 0);
  let humanAttacks =
    sim[HUMAN].characterArea.reduce((s, fc) => s + countHits(fc, HUMAN), 0) +
    countHits(sim[HUMAN].leader, HUMAN);

  // Conservative: assume the human deploys more attackers next turn within its projected DON
  // (cheapest-first, bounded by open board slots). Mirrors the rush-deploy loop in canKillHuman.
  {
    let projDon = Math.min(10, sim[HUMAN].costArea.length + DON_PER_TURN);
    let slots   = MAX_CHARACTERS - sim[HUMAN].characterArea.length;
    for (const c of [...sim[HUMAN].hand]
      .filter(c => c.category === 'Character')
      .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))) {
      if (slots <= 0) break;
      const cost = c.cost ?? 0;
      if (projDon >= cost) { projDon -= cost; slots--; humanAttacks += 1; }
    }
  }

  // AI blockers currently active (they stay active between our turn end and human turn start)
  const aiBlockers = sim[AI].characterArea.filter(
    fc => fc.state === 'active' && fcEffectiveHasBlocker(fc, AI, HUMAN, sim)
  ).length;

  const netDamage = Math.max(0, humanAttacks - aiBlockers);
  // Kill requires netDamage > aiLife (drain N life + 1 winning blow at 0); safe if netDamage <= aiLife
  if (netDamage <= aiLife) return false;

  // At 0 life any unblocked attack on the leader ends the game immediately — counter cards
  // in hand cannot prevent that, so always enter survival mode to prioritise deploying blockers.
  if (aiLife === 0 && netDamage > 0) return true;

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
  const guestLeaderId = sim[AI].leader.card?.id?.replace(/_p\d+$/, '');
  if (guestLeaderId === 'OP13-079' || sim[AI].stageArea) return sim;

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

// Returns true if the activation produced a tangible gain over the prior state:
// active DON increased, hand grew, board score improved, or a new handCostMod enables
// a card that's now affordable with the remaining DON post-activation.
// Used to avoid committing activations that paid a cost (rested a card) for no benefit.
function activationHasBenefit(before, after) {
  const donGained  = after[AI].costArea.filter(d => d.state === 'active').length
                   - before[AI].costArea.filter(d => d.state === 'active').length;
  const handGained = after[AI].hand.length - before[AI].hand.length;
  if (donGained > 0 || handGained > 0 || evalBoardState(after) > evalBoardState(before)) return true;

  // A new handCostMod (e.g. OP12-061 Law discount) is only beneficial if it makes a card
  // in hand affordable with the post-activation DON that wasn't affordable without the mod.
  const beforeMods = before[AI].handCostMods ?? [];
  const afterMods  = after[AI].handCostMods ?? [];
  const hasNewMod  = afterMods.some(nm =>
    !beforeMods.some(bm =>
      bm.until === nm.until && bm.delta === nm.delta &&
      JSON.stringify(bm.filter) === JSON.stringify(nm.filter)
    )
  );
  if (hasNewMod) {
    return after[AI].hand.some(c =>
      c.category === 'Character' &&
      canAfford(after[AI].costArea, getEffectiveCost(c, afterMods)) &&
      !canAfford(after[AI].costArea, getEffectiveCost(c, beforeMods))
    );
  }
  return false;
}

// Activate leader and character Activate:Main abilities if they resolve cleanly.
function activateMainAbilities(sim, actions) {
  const leaderStatus = getActivatedMainStatus(
    sim[AI].leader.card, sim[AI], sim, AI, { target: 'leader' }
  );
  if (leaderStatus?.available) {
    const _lp  = getLeaderProfile(sim[AI].leader.card?.id);
    // Guard: skip leader activation until required hand cards are all present
    const _lah = _lp?.leaderActivationRequiresHand;
    const _skipByIdHand = _lah && (() => {
      const norm = id => id?.replace(/_p\d+$/, '').replace(/_r$/, '');
      const inHand = new Set(sim[AI].hand.map(c => norm(c.id)));
      const have = _lah.ids.filter(id => inHand.has(id)).length;
      return have < (_lah.minCount ?? _lah.ids.length);
    })();
    // Guard: skip until N unique-named Admiral characters are in hand (checked by type, not ID)
    const _minUA = _lp?.leaderActivationMinUniqueAdmirals ?? 0;
    const _skipByAdmiralCount = _minUA > 0 && (() => {
      const uniqueAdmiralNames = new Set(
        sim[AI].hand
          .filter(c => c.category === 'Character' &&
            ((c.types ?? []).includes('上將') || (c.enTypes ?? []).includes('Admiral')))
          .map(c => c.name ?? c.id)
      );
      return uniqueAdmiralNames.size < _minUA;
    })();
    // Guard: skip Rush-grant activations when no justDeployed character exists to receive it
    const _skipByNoJustDeployed = !!_lp?.rushGrantJustDeployedOnly &&
      !sim[AI].characterArea.some(fc => fc.justDeployed);
    // Guard: deploy-lock leaders (e.g. OP14-020) whose activation forbids playing Characters for
    // the rest of the turn — defer until no affordable, board-fitting Character remains in hand,
    // so the lock never cancels a planned deployment. Once nothing deployable remains the
    // activation fires; its re-activated DON is then spent on the held-back leader attack.
    const _skipByDeferDeploy = !!_lp?.activateMainAfterDeploy && sim[AI].hand.some(c =>
      c.category === 'Character' &&
      isPlayableAsCharacter(c) &&
      canAfford(sim[AI].costArea, effCost(c, sim[AI])) &&
      (sim[AI].characterArea.length < MAX_CHARACTERS || (c.cost ?? 0) > weakestFieldCost(sim[AI]))
    );
    // Guard: skip leader activation until a Character of at least the required cost is on field.
    // OP14-020's activation only re-stands DON when a cost-5+ Character is present — firing it
    // without one just rests the leader for no payoff.
    const _minFieldCost = _lp?.leaderActivationRequiresFieldCharCost ?? 0;
    const _skipByMinFieldCost = _minFieldCost > 0 &&
      !sim[AI].characterArea.some(fc => (fc.card?.cost ?? 0) >= _minFieldCost);
    const _skipLeader = _skipByIdHand || _skipByAdmiralCount || _skipByNoJustDeployed || _skipByDeferDeploy || _skipByMinFieldCost;
    if (!_skipLeader) {
      const trial = applyActivateMain(sim, { zone: 'leader', index: -1 });
      if (!trial.pendingEffect && !trial.pendingReplace && !trial.pendingTrigger) {
        // Skip if the activation rested the leader or consumed DON without gaining anything.
        // alwaysActivateMain bypasses this check (e.g. EB04-001 debuff is still worth resting for).
        const leaderRested  = sim[AI].leader.state === 'active' && trial[AI].leader.state !== 'active';
        const donConsumed   = activeDonCount(trial[AI].costArea) < activeDonCount(sim[AI].costArea);
        const hasCost       = leaderRested || donConsumed;
        if (!hasCost || _lp?.alwaysActivateMain || activationHasBenefit(sim, trial)) {
          actions.push({ type: 'ACTIVATE_MAIN', zone: 'leader', index: -1 });
          sim = trial;
          if (sim.winner) return sim;
        }
      }
    }
  }
  const _actLp      = getLeaderProfile(sim[AI].leader.card?.id);
  const _actBase    = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
  const _actMinCost = _actLp?.charActivationsMinCost ?? {};
  for (let ci = 0; ci < sim[AI].characterArea.length; ci++) {
    const fc     = sim[AI].characterArea[ci];
    const status = getActivatedMainStatus(fc.card, sim[AI], sim, AI, { target: ci });
    if (!status?.available) continue;
    // Enforce profile-specified minimum effective cost for self-trash activations (e.g. OP16-084 needs cost ≥ 20)
    const _minC = _actMinCost[_actBase(fc.card?.id)] ?? 0;
    if (_minC > 0) {
      const _effC = (fc.card?.cost ?? 0) +
        (sim[AI].costMods ?? []).filter(m => m.target === ci).reduce((s, m) => s + m.delta, 0);
      if (_effC < _minC) continue;
    }
    const trial  = applyActivateMain(sim, { zone: 'character', index: ci });
    if (trial === sim || trial.pendingEffect || trial.pendingReplace || trial.pendingTrigger) continue;
    // Skip if the activation rested an active character without gaining anything.
    const charRested = sim[AI].characterArea[ci]?.state === 'active' && trial[AI].characterArea[ci]?.state !== 'active';
    if (charRested && !activationHasBenefit(sim, trial)) continue;
    actions.push({ type: 'ACTIVATE_MAIN', zone: 'character', index: ci });
    sim = trial;
    if (sim.winner) return sim;
  }
  return sim;
}

// For deploy-lock leaders (saveLeaderAttackForActivation, e.g. OP14-020): the leader's attack was
// held back during the main attack dispatch. Now that deployments are done, fire the deferred
// Activate:Main (re-activating DON) and let the leader swing with that freshly re-activated DON.
// No-op for other leaders.
function activateThenLeaderAttack(sim, actions) {
  const lp = getLeaderProfile(sim[AI].leader.card?.id);
  if (!lp?.saveLeaderAttackForActivation) return sim;
  sim = activateMainAbilities(sim, actions);
  if (sim.winner) return sim;
  const oppLow  = sim[HUMAN].hand.length <= LOW_HAND_THRESHOLD;
  const reserve = lp?.donReserve ?? 0;
  const hold    = ((!oppLow && hasCounterEvent(sim[AI].hand)) ? COUNTER_HOLD_DON : 0) + reserve;
  return dispatchAttacks(sim, actions, { donBudget: Math.max(0, activeDonCount(sim[AI].costArea) - hold) });
}

// Dispatch all character + leader attacks.
// leaderOnlyMode: skip character targeting — all attackers go straight to human leader.
// skipLeaderAttack: omit the leader from this dispatch (used when character attacks fire before a leader activation that rests the leader).
function dispatchAttacks(sim, actions, { leaderOnlyMode = false, donBudget = 0, killMode = false, preferLeader = false, escalate = false, skipLeaderAttack = false } = {}) {
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

  // Pre-allocate DON!! per attacker so target-selection uses expected post-boost power.
  const donAlloc = new Map(); // key: character area index or 'leader', value: amount
  if (donBudget > 0) {
    if (escalate) {
      // Shared setup: gather all potential attackers sorted by base power ascending.
      const humanLeaderDefPow = calcPower(sim[HUMAN].leader, AI, HUMAN, sim);
      const allPotAtks = [
        ...sim[AI].characterArea
          .map((fc, i) => ({ key: i, basePow: calcPower(fc, AI, AI, sim) }))
          .filter(({ key: i }) => {
            const fc = sim[AI].characterArea[i];
            return fc.state === 'active' && charCanAttack(fc, sim) && !fc.attackLocked;
          }),
      ];
      if (sim[AI].leader.state === 'active') {
        allPotAtks.push({ key: 'leader', basePow: calcPower(sim[AI].leader, AI, AI, sim) });
      }
      allPotAtks.sort((a, b) => a.basePow - b.basePow);

      const minTarget  = Math.ceil((humanLeaderDefPow + 1) / 1000) * 1000;
      let   remBudget  = donBudget;

      // If the human has an active blocker, use flat (equal) power for all attacks:
      // the blocker can absorb any one hit, so equal power maximises the cost per
      // counter card the opponent must spend on the remaining attacks.
      const humanHasBlocker = sim[HUMAN].characterArea.some(
        fc => fc.state === 'active' && fcEffectiveHasBlocker(fc, HUMAN, AI, sim)
      );

      if (humanHasBlocker) {
        // Find the highest flat target all attackers can reach within budget.
        let flatTarget = minTarget;
        while (flatTarget <= humanLeaderDefPow + 40000) {
          const needed = allPotAtks.reduce(
            (s, { basePow }) => s + Math.max(0, Math.ceil((flatTarget + 1000 - basePow) / 1000)), 0
          );
          if (needed > donBudget) break;
          flatTarget += 1000;
        }
        for (const { key, basePow } of allPotAtks) {
          const needed = Math.max(0, Math.ceil((flatTarget - basePow) / 1000));
          if (needed > 0 && needed <= remBudget) { donAlloc.set(key, needed); remBudget -= needed; }
        }
      } else {
        // Escalating mode: each attack is +2000 above the previous.
        let prevTarget = minTarget - 2000;
        for (const { key, basePow } of allPotAtks) {
          const target = Math.max(prevTarget + 2000, basePow);
          const needed = Math.ceil(Math.max(0, target - basePow) / 1000);
          if (needed <= remBudget) {
            if (needed > 0) donAlloc.set(key, needed);
            remBudget -= needed;
            prevTarget = basePow + needed * 1000;
          } else {
            if (remBudget > 0) { donAlloc.set(key, remBudget); remBudget = 0; }
            prevTarget = basePow + (donAlloc.get(key) ?? 0) * 1000;
          }
        }
      }

      if (remBudget > 0) donAlloc.set('leader', (donAlloc.get('leader') ?? 0) + remBudget);
    } else if (humanAtZeroLife) {
      // End-game: distribute DON based on whether human has active blockers
      const humanLeaderPow = calcPower(sim[HUMAN].leader, AI, HUMAN, sim);

      const humanBlockerCount = sim[HUMAN].characterArea.filter(fc =>
        fc && fc.state === 'active' && fcEffectiveHasBlocker(fc, HUMAN, AI, sim)
      ).length;

      const _endAtks = [];
      for (let _ci = 0; _ci < sim[AI].characterArea.length; _ci++) {
        const _fc = sim[AI].characterArea[_ci];
        if (!_fc || _fc.state !== 'active' || !charCanAttack(_fc, sim) || _fc.attackLocked) continue;
        _endAtks.push({ key: _ci, basePow: calcPower(_fc, AI, AI, sim), assigned: 0 });
      }
      _endAtks.push({ key: 'leader', basePow: calcPower(sim[AI].leader, AI, AI, sim), assigned: 0 });

      if (humanBlockerCount === 0) {
        // No blockers: all DON to highest-power attacker for the killing blow
        _endAtks.sort((a, b) => b.basePow - a.basePow);
        if (donBudget > 0) donAlloc.set(_endAtks[0].key, donBudget);
      } else {
        // Has blockers: equalise attack powers to maximise human counter card cost
        const _numAtk = _endAtks.length;
        const _totalBase = _endAtks.reduce((s, a) => s + a.basePow, 0);
        const _floorTarget = Math.floor((_totalBase + donBudget * 1000) / _numAtk / 1000) * 1000;
        let _donLeft = donBudget;
        _endAtks.sort((a, b) => a.basePow - b.basePow);
        for (const _atk of _endAtks) {
          const _need = Math.max(0, Math.ceil((_floorTarget - _atk.basePow) / 1000));
          const _give = Math.min(_need, _donLeft);
          _atk.assigned = _give;
          _donLeft -= _give;
        }
        for (const _atk of _endAtks) {
          if (_donLeft <= 0) break;
          _atk.assigned++;
          _donLeft--;
        }
        for (const _atk of _endAtks) {
          if (_atk.assigned > 0) donAlloc.set(_atk.key, _atk.assigned);
        }
      }
    } else {
      const humanLeaderPow = calcPower(sim[HUMAN].leader, AI, HUMAN, sim);
      let remBudget = donBudget;

      // Leader-profile override: pre-allocate exactly 1 DON to priority chars before normal
      // allocation — their DON!!×1 conditional effects make 1 DON far more valuable than the
      // generic magic-number heuristic would recognise (e.g. OP16-054 +3000, OP16-055 match
      // opponent leader power).
      // Cap DON attached to characters whose base printed power is < 5000 at 3 total
      // (base + already attached + about to attach), unless going for lethal.
      const _lethalExempt = killMode || isLethal;
      const _lowPowerDonCap = (fc) => {
        if (_lethalExempt || (fc.card?.power ?? 0) >= 5000) return Infinity;
        return Math.max(0, 3 - (fc.attachedDon ?? 0));
      };

      if (!preferLeader) {
        const _cda1 = getLeaderProfile(sim[AI].leader.card?.id)?.charDonAttach1 ?? [];
        if (_cda1.length > 0) {
          const _cda1Base = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
          for (let _ci = 0; _ci < sim[AI].characterArea.length && remBudget > 0; _ci++) {
            const _fc = sim[AI].characterArea[_ci];
            if (!_fc || _fc.state !== 'active' || !charCanAttack(_fc, sim) || _fc.attackLocked) continue;
            if (!_cda1.includes(_cda1Base(_fc.card?.id))) continue;
            if (!donAlloc.has(_ci) && _lowPowerDonCap(_fc) >= 1) { donAlloc.set(_ci, 1); remBudget -= 1; }
          }
        }
      }

      if (!preferLeader) {
        const potAtks = sim[AI].characterArea
          .map((fc, i) => ({ i, basePow: calcPower(fc, AI, AI, sim) }))
          .filter(({ i }) => {
            const fc = sim[AI].characterArea[i];
            return fc.state === 'active' && charCanAttack(fc, sim) && !fc.attackLocked;
          })
          .sort((a, b) => a.basePow - b.basePow);
        for (const { i, basePow } of potAtks) {
          if (donAlloc.has(i)) continue; // already allocated by charDonAttach1
          const fc = sim[AI].characterArea[i];
          const d = Math.min(donToBoost(basePow, humanLeaderPow, remBudget, killMode), _lowPowerDonCap(fc));
          if (d > 0) { donAlloc.set(i, d); remBudget -= d; }
        }
      }

      const leaderBasePow = calcPower(sim[AI].leader, AI, AI, sim);
      const leaderD = preferLeader ? remBudget : donToBoost(leaderBasePow, humanLeaderPow, remBudget, killMode);
      if (leaderD > 0) { donAlloc.set('leader', leaderD); remBudget -= leaderD; }
      if (remBudget > 0) donAlloc.set('leader', (donAlloc.get('leader') ?? 0) + remBudget);
    }
  }

  const characterAttackers = sim[AI].characterArea
    .map((fc, i) => ({
      fc, i,
      atkPow: calcPower(fc, AI, AI, sim) + (donAlloc.get(i) ?? 0) * 1000,
    }))
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

  // RUSH_ACTIVE_CHARS: assign unused attackers with this keyword to active enemy chars (strongest first).
  if (!humanAtZeroLife && !leaderOnlyMode) {
    const activeHumanTargets = sim[HUMAN].characterArea
      .map((hfc, idx) => ({ hfc, idx, defPow: calcPower(hfc, AI, HUMAN, sim) }))
      .filter(({ hfc, idx }) => hfc.state === 'active' && !assignedTargetIdxs.has(idx))
      .sort((a, b) => b.defPow - a.defPow);
    for (const enemy of activeHumanTargets) {
      for (const atk of characterAttackers) {
        if (usedAttackers.has(atk.i)) continue;
        if (!sim[AI].characterArea[atk.i]?.tempKeywords?.includes('RUSH_ACTIVE_CHARS')) continue;
        if (atk.atkPow <= enemy.defPow) continue; // must win the trade
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
    // Rush: Character cannot attack the leader
    if (fc.rushCharOnly && assignedIdx === undefined) continue;
    const action = assignedIdx !== undefined
      ? { type: 'DECLARE_ATTACK', attackerZone: 'character', attackerIndex: i,
          _attackerFcId: fc._fcId,
          targetOwner: HUMAN, targetZone: 'character', targetIndex: assignedIdx }
      : { type: 'DECLARE_ATTACK', attackerZone: 'character', attackerIndex: i,
          _attackerFcId: fc._fcId,
          targetOwner: HUMAN, targetZone: 'leader', targetIndex: -1 };
    const defTarget = assignedIdx !== undefined ? sim[HUMAN].characterArea[assignedIdx] : sim[HUMAN].leader;
    const defPow    = defTarget ? calcPower(defTarget, AI, HUMAN, sim) : 0;
    // In leaderOnlyMode (kill mode), skip the hasOnAttack bypass: [When Attacking] effects
    // that debuff opponent characters are irrelevant when all attacks target the leader.
    if (atkPow < defPow && (!hasOnAttack(fc.card) || leaderOnlyMode) && !isLethal) continue;
    if (assignedIdx !== undefined) attackedEnemyIdxs.add(assignedIdx);
    allAttacks.push({ action, atkPow });
  }

  const lp = getLeaderProfile(sim[AI].leader.card?.id);
  const leaderContKws = evaluateContinuousKeywords(sim[AI].leader, AI, AI, sim);
  if (!skipLeaderAttack && sim[AI].leader.state === 'active' && !leaderContKws.has('CANNOT_ATTACK')) {
    const leaderPow = calcPower(sim[AI].leader, AI, AI, sim) + (donAlloc.get('leader') ?? 0) * 1000;

    if (lp?.leaderReactivateOnCharBattle && sim[AI].leader.reactivateAfterCharBattle && !leaderOnlyMode) {
      // Zoro-style: attack a valid character first (triggers re-activation via finalizeBattleDeclaration),
      // then attack the opponent leader. No cost restriction on this first attack — attackCostRestriction
      // only applies after the leader re-stands. Rested chars with power ≤ leaderPow are guaranteed KOs.
      if (!humanAtZeroLife) {
        const charTargets = sim[HUMAN].characterArea
          .map((hfc, idx) => ({ hfc, idx, defPow: calcPower(hfc, AI, HUMAN, sim) }))
          .filter(({ hfc, idx }) => !attackedEnemyIdxs.has(idx))
          .sort((a, b) => {
            const aKo = a.hfc.state === 'rest' && a.defPow <= leaderPow;
            const bKo = b.hfc.state === 'rest' && b.defPow <= leaderPow;
            if (aKo !== bKo) return aKo ? -1 : 1;
            return a.defPow - b.defPow;
          });
        if (charTargets.length > 0) {
          const { idx } = charTargets[0];
          attackedEnemyIdxs.add(idx);
          allAttacks.unshift({ action: { type: 'DECLARE_ATTACK', attackerZone: 'leader', attackerIndex: -1,
            targetOwner: HUMAN, targetZone: 'character', targetIndex: idx }, atkPow: leaderPow });
        }
      }
      allAttacks.push({ action: { type: 'DECLARE_ATTACK', attackerZone: 'leader', attackerIndex: -1,
        targetOwner: HUMAN, targetZone: 'leader', targetIndex: -1 }, atkPow: leaderPow });
    } else {
      let leaderAct = null;

      if (!humanAtZeroLife && !leaderOnlyMode) {
        const restedTargets = sim[HUMAN].characterArea
          .map((hfc, idx) => ({ hfc, idx, defPow: calcPower(hfc, AI, HUMAN, sim) }))
          .filter(({ hfc, idx, defPow }) =>
            hfc.state === 'rest' && !attackedEnemyIdxs.has(idx) && isWorthyRestTarget(hfc, defPow))
          .sort((a, b) => b.defPow - a.defPow);
        for (const { idx, defPow: rcp } of restedTargets) {
          // Require strictly greater power — equal-power attacks are trivially countered by
          // any 1000-value card or leader debuff effects (e.g. OP09-001 Shanks −1000).
          if (leaderPow > rcp) {
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
  }

  const targetKey = ({ action: a }) => `${a.targetOwner}:${a.targetZone}:${a.targetIndex}`;
  allAttacks.sort((a, b) => {
    if (targetKey(a) !== targetKey(b)) return 0;
    return a.atkPow - b.atkPow;
  });

  for (const { action } of allAttacks) {
    const isLdr    = action.attackerZone === 'leader';
    const allocKey = isLdr ? 'leader' : action.attackerIndex;
    const allocated = donAlloc.get(allocKey) ?? 0;
    for (let d = 0; d < allocated; d++) {
      if (activeDonCount(sim[AI].costArea) <= 0) { donBudget -= (allocated - d); break; }
      const zone = isLdr ? 'leader' : 'character';
      const idx  = isLdr ? -1 : action.attackerIndex;
      actions.push({ type: 'ATTACH_DON', targetZone: zone, targetIndex: idx });
      sim = applyAttachDon(sim, { targetZone: zone, targetIndex: idx });
      donBudget--;
    }
    donAlloc.delete(allocKey);
    actions.push(action);
    sim = applyDeclareAttack(sim, action);
    if (sim.winner) break;
  }

  // Only dump leftover budget onto the leader if it hasn't attacked yet — attaching DON
  // to a rested leader is useless and produces confusing no-op actions in the log.
  // When the leader attack is deliberately held (skipLeaderAttack, e.g. OP14-020 deferring its
  // swing until after Activate:Main), keep the DON active instead — they're spent on the leader
  // in the later dispatch, and resting them now would starve the activation's rest-cost.
  while (!skipLeaderAttack && donBudget > 0 && activeDonCount(sim[AI].costArea) > 0 && sim[AI].leader.state === 'active') {
    actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
    sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
    donBudget--;
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
  if (sim[AI].characterArea.length >= MAX_CHARACTERS
      && (sim[AI].hand[handIndex]?.cost ?? 0) <= weakestFieldCost(sim[AI])) return sim;

  actions.push({ type: 'PLAY_CHARACTER', handIndex });
  sim = applyPlayCharacter(sim, { handIndex });
  if (sim.winner) return sim;

  // The newly deployed character is always appended to the end of characterArea
  const charIndex = sim[AI].characterArea.length - 1;
  const fc        = sim[AI].characterArea[charIndex];
  if (!fc || !charCanAttack(fc, sim)) return sim;

  // Fire any non-resting Activate:Main on the freshly deployed card before attacking.
  // e.g. OP15-008: "If deployed this turn, give all opponent chars −1000 per DON on target".
  // Must not rest the character (that would block the Rush attack).
  {
    const _status = getActivatedMainStatus(fc.card, sim[AI], sim, AI, { target: charIndex });
    if (_status?.available) {
      const _trial = applyActivateMain(sim, { zone: 'character', index: charIndex });
      if (!_trial.pendingEffect && !_trial.pendingReplace && !_trial.pendingTrigger) {
        const _wouldRest = fc.state === 'active' && _trial[AI].characterArea[charIndex]?.state !== 'active';
        if (!_wouldRest) {
          actions.push({ type: 'ACTIVATE_MAIN', zone: 'character', index: charIndex });
          sim = _trial;
        }
      }
    }
  }
  if (sim.winner) return sim;

  const charPow = calcPower(sim[AI].characterArea[charIndex], AI, AI, sim);

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

  // Skip the attack entirely if the character cannot beat the target — the attack would
  // always fail (resting the character for nothing, no damage dealt).
  const defTarget = targetZone === 'character'
    ? sim[HUMAN].characterArea[targetIndex]
    : sim[HUMAN].leader;
  const defPow = defTarget ? calcPower(defTarget, AI, HUMAN, sim) : 0;
  if (charPow < defPow) return sim;

  const attackAction = {
    type: 'DECLARE_ATTACK', attackerZone: 'character', attackerIndex: charIndex,
    targetOwner: HUMAN, targetZone, targetIndex,
  };
  actions.push(attackAction);
  sim = applyDeclareAttack(sim, attackAction);
  return sim;
}

// ---------------------------------------------------------------------------
// Priority event play — leader-specific main-phase events (e.g. ST22-015 for OP13-002)
// ---------------------------------------------------------------------------

function playPriorityEvents(sim, actions) {
  const lp         = getLeaderProfile(sim[AI].leader.card?.id);
  const priorities = lp?.eventPlayPriority ?? [];
  if (!priorities.length) return sim;

  const ps = sim[AI];
  if (ps.handPlayLocked) return sim;

  const conditions = lp?.eventPlayConditions ?? {};
  const _base = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');

  for (const eventId of priorities) {
    const cond = conditions[eventId] ?? {};

    // If the event deploys a named card, ensure that card is currently in hand.
    if (cond.requiredHandCard) {
      const hasTarget = ps.hand.some(c => _base(c.id) === cond.requiredHandCard);
      if (!hasTarget) continue;
    }

    const handIdx = ps.hand.findIndex(c => _base(c.id) === eventId);
    if (handIdx === -1) continue;
    const card = ps.hand[handIdx];
    if (!canAfford(ps.costArea, card.cost ?? 0)) continue;

    const trial = applyPlayEvent(sim, { handIndex: handIdx });
    if (trial === sim || trial.pendingEffect || trial.pendingReplace || trial.pendingTrigger) continue;
    actions.push({ type: 'PLAY_EVENT', handIndex: handIdx });
    sim = trial;
    if (sim.winner) return sim;
    // Recurse — hand indices shifted; another copy may still be playable.
    return playPriorityEvents(sim, actions);
  }
  return sim;
}

// ---------------------------------------------------------------------------
// Main-phase event play — plays any affordable Event card with a [Main] effect after attacks.
// Counter events are excluded (kept for defensive use during opponent's attacks).
// Safety: the trial simulation gates on pendingEffect — events that require interactive choices
// (e.g. "KO up to 1 opponent character") are automatically skipped.
// Benefit gate: only play when the board strictly improved (draw/KO/REST visible via evalBoardState)
// OR when the opponent's character field changed in any way that evalBoardState doesn't capture
// (e.g. refreshLocked from OP08-036 freeze effects).
// ---------------------------------------------------------------------------

function hasMainEffect(card) {
  const eff   = card.effect   ?? '';
  const enEff = card.enEffect ?? '';
  return eff.includes('主要') || enEff.includes('[Main]');
}

function oppFieldSnapshot(ps) {
  return ps.characterArea.map(fc => ({
    id: fc.card?.id,
    s:  fc.state,
    rl: fc.refreshLocked,
    al: fc.attackLocked,
  }));
}

function playBoardControlEvents(sim, actions) {
  for (let hi = 0; hi < sim[AI].hand.length; hi++) {
    const card = sim[AI].hand[hi];
    if (card.category !== 'Event') continue;
    if (!hasMainEffect(card)) continue;
    if (isCounterEventCard(card)) continue;
    if (!canAfford(sim[AI].costArea, card.cost ?? 0)) continue;
    const trial = applyPlayEvent(sim, { handIndex: hi });
    if (trial === sim || trial.pendingEffect || trial.pendingReplace || trial.pendingTrigger) continue;
    const boardImproved = evalBoardState(trial) > evalBoardState(sim);
    const oppChanged    = JSON.stringify(oppFieldSnapshot(trial[HUMAN])) !==
                          JSON.stringify(oppFieldSnapshot(sim[HUMAN]));
    if (!boardImproved && !oppChanged) continue;
    actions.push({ type: 'PLAY_EVENT', handIndex: hi });
    sim = trial;
    if (sim.winner) return sim;
    hi--;
  }
  return sim;
}

// ---------------------------------------------------------------------------
// Post-attack event play — leader-specific events played AFTER attacks (e.g. OP12-039 for OP12-020)
// ---------------------------------------------------------------------------

function playPostAttackEvents(sim, actions) {
  const lp = getLeaderProfile(sim[AI].leader.card?.id);
  const postEvents = lp?.postAttackEventPlay ?? [];
  if (!postEvents.length) return sim;
  const _base = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
  for (const eventId of postEvents) {
    const handIdx = sim[AI].hand.findIndex(c => _base(c.id) === eventId);
    if (handIdx === -1) continue;
    const card = sim[AI].hand[handIdx];
    if (!canAfford(sim[AI].costArea, card.cost ?? 0)) continue;
    const trial = applyPlayEvent(sim, { handIndex: handIdx });
    if (trial === sim || trial.pendingEffect || trial.pendingReplace || trial.pendingTrigger) continue;
    actions.push({ type: 'PLAY_EVENT', handIndex: handIdx });
    sim = trial;
    if (sim.winner) return sim;
    // After the re-activation event, plan a leader→leader attack.
    const leaderAct = { type: 'DECLARE_ATTACK', attackerZone: 'leader', attackerIndex: -1,
      targetOwner: HUMAN, targetZone: 'leader', targetIndex: -1 };
    actions.push(leaderAct);
    sim = applyDeclareAttack(sim, leaderAct);
    if (sim.winner) return sim;
  }
  return sim;
}

// ---------------------------------------------------------------------------
// End-of-turn: deploy characters with any DON remaining above counter hold
// ---------------------------------------------------------------------------

// Per-card counter-hold override. When a leader discount (handCostMod) makes a cardPlayPriority
// body cheaper than its printed cost, the AI should spend its counter-reserve DON to deploy it:
// the discount is typically single-use ("next_play") and wasting it costs more tempo than holding
// DON for a counter event. Returns 0 (no reserve) for a discounted priority play, else baseHold.
function holdForCard(card, sim, baseHold) {
  if (baseHold <= 0) return baseHold;
  const prios = getLeaderProfile(sim[AI].leader.card?.id)?.cardPlayPriority ?? [];
  if (!prios.length) return baseHold;
  const base = (card?.id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
  if (!prios.includes(base)) return baseHold;
  const discounted = effCost(card, sim[AI]) < (card?.cost ?? 0);
  return discounted ? 0 : baseHold;
}

function deployWithRemainingDon(sim, actions) {
  const lp      = getLeaderProfile(sim[AI].leader.card?.id);
  const oppLow  = sim[HUMAN].hand.length <= LOW_HAND_THRESHOLD;
  const reserve = lp?.donReserve ?? 0;
  const hold    = ((!oppLow && hasCounterEvent(sim[AI].hand)) ? COUNTER_HOLD_DON : 0) + reserve;

  for (let attempt = 0; attempt < MAX_CHARACTERS; attempt++) {
    if (sim[AI].deployBlockedThisTurn || sim[AI].handPlayLocked) break;

    const available = activeDonCount(sim[AI].costArea);
    const _drConds = getLeaderProfile(sim[AI].leader.card?.id)?.cardPlayConditions ?? {};
    const _drBase  = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
    const playable  = sim[AI].hand
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => {
        if (c.category !== 'Character') return false;
        if (!isPlayableAsCharacter(c)) return false;
        if (sim[AI].deployBlockCost) {
          const { threshold, op } = sim[AI].deployBlockCost;
          const cost = c.cost ?? 0;
          if (op === 'gte' && cost >= threshold) return false;
          if (op === 'lte' && cost <= threshold) return false;
        }
        const _cond = _drConds[_drBase(c.id)];
        if (_cond?.minTotalDon && sim[AI].costArea.length < _cond.minTotalDon) return false;
        if (_cond?.requiredOnField && !sim[AI].characterArea.some(fc => _drBase(fc.card?.id) === _cond.requiredOnField)) return false;
        if (_cond?.minOpponentHand && sim[HUMAN].hand.length < _cond.minOpponentHand) return false;
        const cost = effCost(c, sim[AI]);
        return canAfford(sim[AI].costArea, cost) && (available - cost) >= holdForCard(c, sim, hold);
      })
      .sort((a, b) => effCost(b.c, sim[AI]) - effCost(a.c, sim[AI]));

    if (!playable.length) break;
    if (sim[AI].characterArea.length >= MAX_CHARACTERS
        && effCost(playable[0].c, sim[AI]) <= weakestFieldCost(sim[AI])) break;

    const maxCost = effCost(playable[0].c, sim[AI]);
    const topTier = playable.filter(({ c }) => effCost(c, sim[AI]) === maxCost);
    let bestIdx = topTier[0].i;
    if (topTier.length > 1) {
      let best = -Infinity;
      for (const { i } of topTier) {
        const score = trialPlayScore(sim, i);
        if (score > best) { best = score; bestIdx = i; }
      }
    }

    actions.push({ type: 'PLAY_CHARACTER', handIndex: bestIdx });
    sim = applyPlayCharacter(sim, { handIndex: bestIdx });
    if (sim.winner) return sim;
  }
  return sim;
}

// ---------------------------------------------------------------------------
// BRANCH 1: Early game (turns 1–EARLY_GAME_TURNS) — curve presence
// ---------------------------------------------------------------------------

function planEarlyGame(sim, actions, state) {
  const _egLp = getLeaderProfile(sim[AI].leader.card?.id);

  // Some leaders (e.g. OP12-061) need to activate before the stage is played so the
  // discount they set can be used on the same turn (stage would otherwise eat DON first).
  if (_egLp?.activateBeforeStage) {
    sim = activateMainAbilities(sim, actions);
    if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  }

  sim = playStageIfAvailable(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  sim = playPriorityEvents(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Play at most one character per attempt; prefer exact-DON-cost match for the curve,
  // then fall back to highest-cost affordable character.
  for (let attempt = 0; attempt < 3; attempt++) {
    const ps        = sim[AI];
    if (ps.deployBlockedThisTurn || ps.handPlayLocked) break;

    const available = activeDonCount(ps.costArea);
    const ranked    = rankCardsForTurn(ps.hand, available);
    const _ccBase   = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
    const _ccConds  = getLeaderProfile(sim[AI].leader.card?.id)?.cardPlayConditions ?? {};
    const playable  = ranked.filter(r => {
      if (r.category !== 'Character') return false;
      if (!isPlayableAsCharacter(r)) return false;
      if (!canAfford(ps.costArea, effCost(r, ps))) return false;
      if (ps.deployBlockCost) {
        const { threshold, op } = ps.deployBlockCost;
        const c = r.cost ?? 0;
        if (op === 'gte' && c >= threshold) return false;
        if (op === 'lte' && c <= threshold) return false;
      }
      const cond = _ccConds[_ccBase(r.id)];
      if (cond?.minTotalDon && ps.costArea.length < cond.minTotalDon) return false;
      if (cond?.requiredOnField && !ps.characterArea.some(fc => _ccBase(fc.card?.id) === cond.requiredOnField)) return false;
      if (cond?.minOpponentHand && sim[HUMAN].hand.length < cond.minOpponentHand) return false;
      return true;
    });
    if (!playable.length) break;

    // Profile card-play priority: play this card before cost-based selection
    {
      const _pids = getLeaderProfile(sim[AI].leader.card?.id)?.cardPlayPriority ?? [];
      if (_pids.length) {
        const _base = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
        const priCard = playable.find(r => _pids.includes(_base(r.id)));
        if (priCard) {
          const priIdx = ps.hand.findIndex(c => c.id === priCard.id);
          if (priIdx !== -1) {
            actions.push({ type: 'PLAY_CHARACTER', handIndex: priIdx });
            sim = applyPlayCharacter(sim, { handIndex: priIdx });
            if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
            continue;
          }
        }
      }
    }

    // Exact-cost match (spends all DON in one play — ideal on-curve body)
    const exactMatch = playable.filter(r => effCost(r, ps) === available);
    const pool       = exactMatch.length ? exactMatch : playable;
    const maxCost    = Math.max(...pool.map(r => effCost(r, ps)));
    const topTier    = pool.filter(r => effCost(r, ps) === maxCost);

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
    if (ps.characterArea.length >= MAX_CHARACTERS
        && (ps.hand[bestIdx]?.cost ?? 0) <= weakestFieldCost(ps)) break;

    actions.push({ type: 'PLAY_CHARACTER', handIndex: bestIdx });
    sim = applyPlayCharacter(sim, { handIndex: bestIdx });
    if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  }

  {
    const lp      = getLeaderProfile(sim[AI].leader.card?.id);
    const donGate = lp?.leaderDonGate ?? 0;
    if (donGate > 0) {
      const avail  = activeDonCount(sim[AI].costArea);
      const toGate = Math.max(0, donGate - (sim[AI].leader.attachedDon ?? 0));
      const attach = Math.min(toGate, avail);
      for (let d = 0; d < attach; d++) {
        actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
        sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
      }
    }
  }
  sim = deployPriorityBeforeActivation(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  sim = activateMainAbilities(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  if (state.turn === 1) { actions.push({ type: 'END_TURN' }); return actions; }

  {
    const lp             = getLeaderProfile(sim[AI].leader.card?.id);
    const justPlayedChar = sim[AI].characterArea.some(fc => fc.justDeployed);
    const oppLow         = sim[HUMAN].hand.length <= LOW_HAND_THRESHOLD;
    const reserve        = lp?.donReserve ?? 0;
    const hold           = ((!oppLow && hasCounterEvent(sim[AI].hand)) ? COUNTER_HOLD_DON : 0) + reserve;
    sim = dispatchAttacks(sim, actions, {
      donBudget: Math.max(0, activeDonCount(sim[AI].costArea) - hold),
      preferLeader: !!(lp?.preferLeaderAttach && !justPlayedChar),
    });
  }
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  sim = playPostAttackEvents(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  sim = playBoardControlEvents(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  sim = deployWithRemainingDon(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
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
      .filter(c => c.category === 'Character' && hasEffectiveRush(c, sim) && isPlayableAsCharacter(c))
      .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))) {
      if (rushToPlay.length >= boardSlots
          && (rc.cost ?? 0) <= weakestFieldCost(sim[AI])) break;
      const cost = rc.cost ?? 0;
      if (donLeft >= cost) { donLeft -= cost; rushToPlay.push(rc.id); }
    }
  }

  // Reserve DON for rush char plays
  const reservedForRush = rushToPlay.reduce((sum, id) => {
    const c = sim[AI].hand.find(c => c.id === id);
    return sum + (c?.cost ?? 0);
  }, 0);

  // Identify non-rush chars to deploy after attacks using whatever DON remains.
  // Reserved upfront so the kill-DON attachment doesn't consume their budget.
  const nonRushToPlay = [];
  if (!sim[AI].deployBlockedThisTurn && !sim[AI].handPlayLocked) {
    let donLeft    = activeDonCount(sim[AI].costArea) - reservedForRush;
    let boardSlots = MAX_CHARACTERS - sim[AI].characterArea.length - rushToPlay.length;
    for (const card of [...sim[AI].hand]
      .filter(c => c.category === 'Character' && !hasEffectiveRush(c, sim) && isPlayableAsCharacter(c))
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))) {
      if (boardSlots <= 0 && (card.cost ?? 0) <= weakestFieldCost(sim[AI])) break;
      const cost = card.cost ?? 0;
      if (donLeft >= cost) { donLeft -= cost; boardSlots--; nonRushToPlay.push(card.id); }
    }
  }
  const reservedForNonRush = nonRushToPlay.reduce((sum, id) => {
    const c = sim[AI].hand.find(c => c.id === id);
    return sum + (c?.cost ?? 0);
  }, 0);

  sim = deployPriorityBeforeActivation(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  sim = activateMainAbilities(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  {
    const lp      = getLeaderProfile(sim[AI].leader.card?.id);
    const donGate = lp?.leaderDonGate ?? 0;
    if (donGate > 0) {
      const avail  = activeDonCount(sim[AI].costArea);
      const toGate = Math.max(0, donGate - (sim[AI].leader.attachedDon ?? 0));
      const attach = Math.min(toGate, avail);
      for (let d = 0; d < attach; d++) {
        actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
        sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
      }
    }
  }

  if (state.turn === 1) { actions.push({ type: 'END_TURN' }); return actions; }

  // Play pre-attack characters (leader power boosts, rested DON!! givers)
  sim = deployPreAttackChars(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Recompute reserved DON — pre-attack chars may have been played and are no longer in hand
  const _killReservedRush    = rushToPlay.reduce((s, id) => { const c = sim[AI].hand.find(c => c.id === id); return s + (c?.cost ?? 0); }, 0);
  const _killReservedNonRush = nonRushToPlay.reduce((s, id) => { const c = sim[AI].hand.find(c => c.id === id); return s + (c?.cost ?? 0); }, 0);

  // All existing attackers go straight to human leader; DON attached just before each attack,
  // escalating by +2000 per attack so each hit requires a fresh 2000-counter to stop.
  sim = dispatchAttacks(sim, actions, {
    leaderOnlyMode: true,
    donBudget: Math.max(0, activeDonCount(sim[AI].costArea) - _killReservedRush - _killReservedNonRush),
    escalate: true,
  });
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  sim = playPostAttackEvents(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  sim = playBoardControlEvents(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Deploy each planned rush char and immediately attack the leader
  for (const cardId of rushToPlay) {
    sim = deployRushAndAttack(sim, actions, cardId, true);
    if (sim.winner) break;
  }
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Deploy non-rush chars using the DON reserved above — strengthens board for next turn
  // even when the kill attempt is countered.
  for (const cardId of nonRushToPlay) {
    const hi = sim[AI].hand.findIndex(c => c.id === cardId);
    if (hi === -1) continue;
    if (!canAfford(sim[AI].costArea, sim[AI].hand[hi]?.cost ?? 0)) continue;
    if (sim[AI].deployBlockedThisTurn || sim[AI].handPlayLocked) break;
    actions.push({ type: 'PLAY_CHARACTER', handIndex: hi });
    sim = applyPlayCharacter(sim, { handIndex: hi });
    if (sim.winner) break;
  }
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  sim = deployWithRemainingDon(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  actions.push({ type: 'END_TURN' });
  return actions;
}

// ---------------------------------------------------------------------------
// Pre-activation character attacks — for leaders whose [Activate: Main] rests them and
// consumes active DON (e.g. OP16-060 returns 8 DON). Existing characters should attack
// BEFORE the activation fires so they don't lose their attack window.
// The leader is excluded from this dispatch; it will activate (and rest) afterward.
// DON budget for the pre-attacks reserves exactly the amount the activation needs,
// so the activation is still executable after the attacks complete.
// ---------------------------------------------------------------------------

function preActivationCharAttacks(sim, actions) {
  const lp = getLeaderProfile(sim[AI].leader.card?.id);
  if (!lp?.charAttacksBeforeLeaderActivation) return sim;

  const leaderStatus = getActivatedMainStatus(sim[AI].leader.card, sim[AI], sim, AI, { target: 'leader' });
  if (!leaderStatus?.available) return sim;

  // Replicate the admiral-count guard from activateMainAbilities
  const minUA = lp.leaderActivationMinUniqueAdmirals ?? 0;
  if (minUA > 0) {
    const uniqueAdmiralNames = new Set(
      sim[AI].hand
        .filter(c => c.category === 'Character' &&
          ((c.types ?? []).includes('上將') || (c.enTypes ?? []).includes('Admiral')))
        .map(c => c.name ?? c.id)
    );
    if (uniqueAdmiralNames.size < minUA) return sim;
  }

  // Simulate the activation to measure how much active DON it consumes
  const trial = applyActivateMain(sim, { zone: 'leader', index: -1 });
  if (trial.pendingEffect || trial.pendingReplace || trial.pendingTrigger) return sim;

  const leaderRested = sim[AI].leader.state === 'active' && trial[AI].leader.state !== 'active';
  if (!leaderRested) return sim;           // activation doesn't rest leader; no pre-attack needed
  if (!activationHasBenefit(sim, trial)) return sim;

  const donConsumed  = Math.max(0, activeDonCount(sim[AI].costArea) - activeDonCount(trial[AI].costArea));
  const oppLow       = sim[HUMAN].hand.length <= LOW_HAND_THRESHOLD;
  const hold         = ((!oppLow && hasCounterEvent(sim[AI].hand)) ? COUNTER_HOLD_DON : 0) + (lp?.donReserve ?? 0);
  const charDonBudget = Math.max(0, activeDonCount(sim[AI].costArea) - donConsumed - hold);

  return dispatchAttacks(sim, actions, { skipLeaderAttack: true, donBudget: charDonBudget });
}

// ---------------------------------------------------------------------------
// BRANCH 3: Survival mode — reduce human attack count and preserve AI life
// ---------------------------------------------------------------------------

function planSurvivalMode(sim, actions) {
  // See planSafeMode: set the leader's Activate:Main discount before any deploy planning so
  // discount-only-affordable priority cards (e.g. a −2 Law) are deployable this turn.
  if (getLeaderProfile(sim[AI].leader.card?.id)?.activateBeforeStage) {
    sim = activateMainAbilities(sim, actions);
    if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  }

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

  // Characters that can already attack go first, BEFORE a leader activation that would
  // rest the leader and burn its DON cost (e.g. OP16-060 returns 8 DON to deck).
  sim = preActivationCharAttacks(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // For leaders like OP16-001: deploy the key synergy char BEFORE activating so it can receive Rush.
  sim = deployPriorityBeforeActivation(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Activate leader/character Activate:Main abilities before any DON is attached.
  // Must run first: leaders like OP16-060 require N active DON!! in costArea as their
  // activation cost, so attaching even 1 DON first would drop the count below the threshold.
  sim = activateMainAbilities(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Minimal DON attachment: boost leader to strictly beat the human leader if possible
  // Recompute budget after activation — activation may have consumed/added DON.
  let _survivalDonBudget = Math.max(0, activeDonCount(sim[AI].costArea) - holdDon);
  {
    const leaderBasePow  = (sim[AI].leader.card?.power ?? 0) + sim[AI].leader.attachedDon * 1000;
    const humanLeaderPow = calcPower(sim[HUMAN].leader, AI, HUMAN, sim);
    if (sim[AI].leader.state === 'active' && leaderBasePow <= humanLeaderPow && _survivalDonBudget > 0) {
      const needed  = Math.ceil((humanLeaderPow + 1 - leaderBasePow) / 1000);
      const canGive = Math.min(needed, _survivalDonBudget);
      for (let d = 0; d < canGive; d++) {
        actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
        sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
        _survivalDonBudget--;
      }
    }
  }

  // Play pre-attack characters (leader power boosts, rested DON!! givers)
  sim = deployPreAttackChars(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Priority events (e.g. ST22-015 for OP13-002) — in survival mode, noSelfLifeBoost gate
  // detects the imminent-death condition and allows the optional life-take.
  sim = playPriorityEvents(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Deploy one leader-profile priority (non-rush) card when the leader already beats the
  // human leader without any extra DON boost. In this state spare DON above the hold can
  // be spent on a card deployment without sacrificing a meaningful attack: the leader still
  // attacks successfully with its current power, and the deployed body strengthens the board
  // for future turns.  At most one card is deployed here; the normal post-attack paths handle
  // the rest.
  {
    const _slp     = getLeaderProfile(sim[AI].leader.card?.id);
    const _sprioIds = _slp?.cardPlayPriority ?? [];
    if (!sim[AI].deployBlockedThisTurn && !sim[AI].handPlayLocked && _sprioIds.length > 0
        && sim[AI].leader.state === 'active') {
      const _shuman  = calcPower(sim[HUMAN].leader, AI, HUMAN, sim);
      const _sleader = calcPower(sim[AI].leader,   AI, AI,    sim);
      if (_sleader > _shuman) {
        const _sConds    = _slp?.cardPlayConditions ?? {};
        const _sNormId   = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
        for (const prioId of _sprioIds) {
          const hi = sim[AI].hand.findIndex(c => _sNormId(c.id) === prioId);
          if (hi === -1) continue;
          const card = sim[AI].hand[hi];
          if (card.category !== 'Character') continue;
          if (!isPlayableAsCharacter(card)) continue;
          if (hasEffectiveRush(card, sim)) continue; // rush chars handled elsewhere
          const cost = effCost(card, sim[AI]);
          const _sDonSpare = Math.max(0, activeDonCount(sim[AI].costArea) - holdForCard(card, sim, holdDon));
          if (cost > _sDonSpare) continue;
          const cond = _sConds[_sNormId(card.id)];
          if (cond?.minTotalDon && sim[AI].costArea.length < cond.minTotalDon) continue;
          if (cond?.requiredOnField &&
              !sim[AI].characterArea.some(fc => _sNormId(fc.card?.id) === cond.requiredOnField)) continue;
          if (cond?.minOpponentHand && sim[HUMAN].hand.length < cond.minOpponentHand) continue;
          if (sim[AI].characterArea.length >= MAX_CHARACTERS
              && cost <= weakestFieldCost(sim[AI])) break;
          actions.push({ type: 'PLAY_CHARACTER', handIndex: hi });
          sim = applyPlayCharacter(sim, { handIndex: hi });
          if (sim.pendingEffect || sim.pendingReplace || sim.pendingTrigger)
            sim = { ...sim, pendingEffect: null, pendingReplace: null, pendingTrigger: null };
          if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
          break; // one priority card per turn in survival mode
        }
      }
    }
  }

  // Survival priority: deploy defensive blockers BEFORE attacking, so the attack dispatch can't
  // spend the DON we need to put bodies on the field. Deploy cheapest-first up to the number of
  // extra defenders needed to survive next turn (defenseGap); offense gets whatever DON is left.
  // Only reserve counter-event DON when such events actually exist — otherwise a deployed blocker
  // beats holding DON for a counter we can't play. The post-attack loop below mops up extras.
  {
    const _curBlockers = sim[AI].characterArea.filter(
      fc => fc.state === 'active' && fcEffectiveHasBlocker(fc, AI, HUMAN, sim)).length;
    let _defenseGap = Math.max(0,
      (sim[HUMAN].characterArea.length + 1) - (sim[AI].lifeArea.length + _curBlockers));
    const _defHold = hasCounterEvent(sim[AI].hand) ? holdDon : leaderReserve;
    if (_defenseGap > 0 && !sim[AI].deployBlockedThisTurn && !sim[AI].handPlayLocked) {
      let _slots = MAX_CHARACTERS - sim[AI].characterArea.length;
      const _blockers = [...sim[AI].hand]
        .filter(c => c.category === 'Character' && fcHasBlocker({ card: c }) && isPlayableAsCharacter(c))
        .sort((a, b) => effCost(a, sim[AI]) - effCost(b, sim[AI])); // cheapest first: most bodies per DON
      for (const bc of _blockers) {
        if (_defenseGap <= 0 || _slots <= 0) break;
        const cost = effCost(bc, sim[AI]);
        if (!canAfford(sim[AI].costArea, cost)) continue;
        if (activeDonCount(sim[AI].costArea) - cost < _defHold) continue;
        const hi = sim[AI].hand.findIndex(c => c.id === bc.id);
        if (hi === -1) continue;
        actions.push({ type: 'PLAY_CHARACTER', handIndex: hi });
        sim = applyPlayCharacter(sim, { handIndex: hi });
        if (sim.pendingEffect || sim.pendingReplace || sim.pendingTrigger)
          sim = { ...sim, pendingEffect: null, pendingReplace: null, pendingTrigger: null };
        if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
        _defenseGap--; _slots--;
      }
    }
  }

  // Recompute budget after pre-attack plays; pass remaining DON to attacks so characters
  // that need a boost (e.g. leader ties opponent) can still land hits.
  _survivalDonBudget = Math.max(0, activeDonCount(sim[AI].costArea) - holdDon);
  // Attack with existing board — prioritises rested human chars to shrink their board.
  // Deploy-lock leaders (OP14-020) hold the leader's swing for the post-deploy activation below.
  sim = dispatchAttacks(sim, actions, {
    donBudget: _survivalDonBudget,
    skipLeaderAttack: !!getLeaderProfile(sim[AI].leader.card?.id)?.saveLeaderAttackForActivation,
  });
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  sim = playPostAttackEvents(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  sim = playBoardControlEvents(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Deploy rush chars (attack immediately) and non-rush chars with removal effects
  // (on-play KO/REST/RETURN_HAND reduces human board; blockers handled separately below).
  {
    let donLeft    = activeDonCount(sim[AI].costArea);
    let boardSlots = MAX_CHARACTERS - sim[AI].characterArea.length;
    const removalCandidates = [...sim[AI].hand]
      .filter(c => c.category === 'Character' && isPlayableAsCharacter(c) &&
        (hasEffectiveRush(c, sim) || hasOpponentRemovalEffect(c)) && canAfford(sim[AI].costArea, effCost(c, sim[AI])))
      // Rush chars first (immediate board impact), then non-rush; within each group cheapest first
      .sort((a, b) => {
        const aRush = hasEffectiveRush(a, sim) ? 0 : 1;
        const bRush = hasEffectiveRush(b, sim) ? 0 : 1;
        if (aRush !== bRush) return aRush - bRush;
        return effCost(a, sim[AI]) - effCost(b, sim[AI]);
      });
    for (const rc of removalCandidates) {
      if (boardSlots <= 0) break;
      const cost = effCost(rc, sim[AI]);
      if (donLeft - cost < holdForCard(rc, sim, holdDon)) continue;
      donLeft -= cost;
      boardSlots--;
      if (hasEffectiveRush(rc, sim)) {
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
        isPlayableAsCharacter(c) && canAfford(sim[AI].costArea, effCost(c, sim[AI])))
      .sort((a, b) => effCost(b, sim[AI]) - effCost(a, sim[AI]))) {  // highest-cost blockers first
      if (boardSlots <= 0) break;
      const cost = effCost(bc, sim[AI]);
      if (donLeft - cost < holdForCard(bc, sim, holdDon)) continue;
      const hi = sim[AI].hand.findIndex(c => c.id === bc.id);
      if (hi === -1) continue;
      donLeft -= cost;
      boardSlots--;
      actions.push({ type: 'PLAY_CHARACTER', handIndex: hi });
      sim = applyPlayCharacter(sim, { handIndex: hi });
      if (sim.winner) break;
    }
  }
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // Deploy-lock leaders (OP14-020): all deployments are done, so fire the deferred Activate:Main
  // and swing the held-back leader with the re-activated DON.
  sim = activateThenLeaderAttack(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  sim = deployWithRemainingDon(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  actions.push({ type: 'END_TURN' });
  return actions;
}

// ---------------------------------------------------------------------------
// Post-attack character activations — e.g. OP16-098: after attacking, trash itself to
// deploy a cost-8 Yamato from trash with Rush (via OP16-079 leader's trash-deploy Rush grant).
// Returns true when an activation was queued (caller should return actions immediately so the
// pending-effect cascade completes before the AI plans further).
// ---------------------------------------------------------------------------
function postAttackCharActivate(sim, actions) {
  const lp = getLeaderProfile(sim[AI].leader.card?.id);
  const postActivate = lp?.postAttackCharActivations ?? [];
  if (!postActivate.length) return false;
  const _base = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
  for (const cardId of postActivate) {
    const ci = sim[AI].characterArea.findIndex(fc => _base(fc.card?.id) === cardId);
    if (ci === -1) continue;
    const fc = sim[AI].characterArea[ci];
    const status = getActivatedMainStatus(fc.card, sim[AI], sim, AI, { target: ci });
    if (!status?.available) continue;
    actions.push({ type: 'ACTIVATE_MAIN', zone: 'character', index: ci });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// BRANCH 4: Safe mode — pre-plan plays, attach DON to existing board, then execute
// ---------------------------------------------------------------------------

function planSafeMode(sim, actions, state) {
  // Leaders like OP12-061 must set their Activate:Main discount (e.g. −2 to the next Law)
  // BEFORE the deploy planner runs, so cards that only become affordable via the discount are
  // planned and deployed this turn. planEarlyGame's activateBeforeStage handling only covers
  // turns 1–EARLY_GAME_TURNS; mirror it here so the discount isn't applied too late from turn 4 on.
  if (getLeaderProfile(sim[AI].leader.card?.id)?.activateBeforeStage) {
    sim = activateMainAbilities(sim, actions);
    if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  }

  sim = playStageIfAvailable(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  sim = playPriorityEvents(sim, actions);
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
      .filter(c => c.category === 'Character' && hasEffectiveRush(c, sim) && isPlayableAsCharacter(c))
      .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))) {
      if (rushPlan.length >= boardSlots
          && (rc.cost ?? 0) <= weakestFieldCost(sim[AI])) break;
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
      if (ps.deployBlockedThisTurn || ps.handPlayLocked) break;
      const available    = activeDonCount(ps.costArea);
      const ranked       = rankCardsForTurn(ps.hand, available);
      const _preConds = getLeaderProfile(sim[AI].leader.card?.id)?.cardPlayConditions ?? {};
      const _preBase  = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
      const basePlayable = ranked.filter(r => {
        if (r.category !== 'Character') return false;
        if (!isPlayableAsCharacter(r)) return false;
        if (hasEffectiveRush(r, mockSim)) return false;  // already captured in rushPlan
        if (!canAfford(ps.costArea, effCost(r, ps))) return false;
        if (ps.deployBlockCost) {
          const { threshold, op } = ps.deployBlockCost;
          const c = r.cost ?? 0;
          if (op === 'gte' && c >= threshold) return false;
          if (op === 'lte' && c <= threshold) return false;
        }
        const _preCond = _preConds[_preBase(r.id)];
        if (_preCond?.minTotalDon && ps.costArea.length < _preCond.minTotalDon) return false;
        if (_preCond?.requiredOnField && !ps.characterArea.some(fc => _preBase(fc.card?.id) === _preCond.requiredOnField)) return false;
        if (_preCond?.minOpponentHand && sim[HUMAN].hand.length < _preCond.minOpponentHand) return false;
        return true;
      });
      let playable = basePlayable.filter(r => available - effCost(r, ps) >= leaderDonReserve);
      if (!playable.length) playable = basePlayable;
      if (!playable.length) break;

      // Profile card-play priority: prefer this card over cost-based ranking
      const _spids = getLeaderProfile(sim[AI].leader.card?.id)?.cardPlayPriority ?? [];
      const _sbase = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
      const _priCard = _spids.length ? playable.find(r => _spids.includes(_sbase(r.id))) : null;
      let bestIdx;
      if (_priCard) {
        bestIdx = mockSim[AI].hand.findIndex(c => c.id === _priCard.id);
      } else {
        const maxCost = Math.max(...playable.map(r => effCost(r, ps)));
        const topTier = playable.filter(r => effCost(r, ps) === maxCost);
        bestIdx = mockSim[AI].hand.findIndex(c => c.id === topTier[0].id);
        if (topTier.length > 1) {
          let best = -Infinity;
          for (const cand of topTier) {
            const idx   = mockSim[AI].hand.findIndex(c => c.id === cand.id);
            const score = trialPlayScore(mockSim, idx);
            if (score > best) { best = score; bestIdx = idx; }
          }
        }
      }
      if (bestIdx === -1) break;

      const chosenCard = mockSim[AI].hand[bestIdx];
      if (mockSim[AI].characterArea.length >= MAX_CHARACTERS
          && (chosenCard.cost ?? 0) <= weakestFieldCost(mockSim[AI])) break;
      // Score: deploy this card vs use that DON for attack boosts
      const _depDon = activeDonCount(mockSim[AI].costArea) - (chosenCard.cost ?? 0);
      let _depSim   = applyPlayCharacter(mockSim, { handIndex: bestIdx });
      if (_depSim.pendingEffect || _depSim.pendingReplace || _depSim.pendingTrigger)
        _depSim = { ..._depSim, pendingEffect: null, pendingReplace: null, pendingTrigger: null };
      const _scoreA = evalBoardState(planDonAttachment(_depSim, [], _depDon));
      const _scoreB = evalBoardState(planDonAttachment(mockSim, [], activeDonCount(mockSim[AI].costArea)));
      if (_scoreA <= _scoreB) break;

      nonRushPlan.push(chosenCard.id);
      mockSim = _depSim;
    }
  }

  // ── Phase 2: Execute ───────────────────────────────────────────────────────

  // 2a: Leader gate upfront; parameters for interleaved DON attachment during attacks
  const _safeTotalCost = [...rushPlan, ...nonRushPlan].reduce((sum, id) => {
    const c = sim[AI].hand.find(c => c.id === id);
    return sum + (c?.cost ?? 0);
  }, 0);
  {
    const lp      = getLeaderProfile(sim[AI].leader.card?.id);
    const oppLow  = sim[HUMAN].hand.length <= LOW_HAND_THRESHOLD;
    const reserve = lp?.donReserve ?? 0;
    const hold    = ((!oppLow && hasCounterEvent(sim[AI].hand)) ? COUNTER_HOLD_DON : 0) + reserve;
    const donGate = lp?.leaderDonGate ?? 0;
    if (donGate > 0) {
      const avail  = Math.max(0, activeDonCount(sim[AI].costArea) - hold);
      const toGate = Math.max(0, donGate - (sim[AI].leader.attachedDon ?? 0));
      const attach = Math.min(toGate, avail);
      for (let d = 0; d < attach; d++) {
        actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
        sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
      }
    }
  }

  // 2b: Activate main abilities — but first, for leaders that rest on activation and
  // consume active DON (e.g. OP16-060), dispatch character attacks so they fire before
  // the leader burns its DON cost and loses its attack opportunity.
  sim = preActivationCharAttacks(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // For leaders like OP16-001: deploy the key synergy char BEFORE activating so it can receive Rush.
  sim = deployPriorityBeforeActivation(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  sim = activateMainAbilities(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  if (state.turn === 1) { actions.push({ type: 'END_TURN' }); return actions; }

  // 2b.5: Play pre-attack characters (leader power boosts, rested DON!! givers)
  sim = deployPreAttackChars(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // 2c: Attack with existing board, DON!! attached just before each attacker
  {
    const lp      = getLeaderProfile(sim[AI].leader.card?.id);
    const oppLow  = sim[HUMAN].hand.length <= LOW_HAND_THRESHOLD;
    const reserve = lp?.donReserve ?? 0;
    const hold    = ((!oppLow && hasCounterEvent(sim[AI].hand)) ? COUNTER_HOLD_DON : 0) + reserve;
    // Recompute remaining plan cost — pre-attack chars played above are no longer in hand
    const _remainingPlanCost = [...rushPlan, ...nonRushPlan].reduce((s, id) => {
      const c = sim[AI].hand.find(c => c.id === id);
      return s + (c?.cost ?? 0);
    }, 0);
    sim = dispatchAttacks(sim, actions, {
      donBudget: Math.max(0, activeDonCount(sim[AI].costArea) - _remainingPlanCost - hold),
      preferLeader: !!(lp?.preferLeaderAttach && _remainingPlanCost === 0),
      // Deploy-lock leaders (OP14-020): hold the leader's swing until after the post-deploy
      // Activate:Main (step 2g) so it can attack with the re-activated DON.
      skipLeaderAttack: !!lp?.saveLeaderAttackForActivation,
    });
  }
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  sim = playPostAttackEvents(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  sim = playBoardControlEvents(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
  // Post-attack char activations (e.g. OP16-098 trashes itself after attacking to deploy a Rush Yamato)
  if (postAttackCharActivate(sim, actions)) return actions;

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
    if (sim[AI].deployBlockedThisTurn || sim[AI].handPlayLocked) break;
    actions.push({ type: 'PLAY_CHARACTER', handIndex: hi });
    sim = applyPlayCharacter(sim, { handIndex: hi });
    if (sim.winner) break;
  }
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // 2f: Post-deploy activations — e.g. OP16-084 activation after OP16-087 boosts its cost to 20+.
  // Must run after non-rush deploys so the cost boost is already applied.
  sim = activateMainAbilities(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  // 2g: Attack with characters that just gained Rush from post-deploy activations. For deploy-lock
  // leaders (OP14-020) the leader's attack was held back (step 2c); now that the deferred
  // Activate:Main above has re-activated DON, let the held leader swing with that DON budget.
  {
    const lp      = getLeaderProfile(sim[AI].leader.card?.id);
    const oppLow  = sim[HUMAN].hand.length <= LOW_HAND_THRESHOLD;
    const reserve = lp?.donReserve ?? 0;
    const hold    = ((!oppLow && hasCounterEvent(sim[AI].hand)) ? COUNTER_HOLD_DON : 0) + reserve;
    const donBudget = lp?.saveLeaderAttackForActivation
      ? Math.max(0, activeDonCount(sim[AI].costArea) - hold)
      : 0;
    sim = dispatchAttacks(sim, actions, { donBudget });
  }
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }

  sim = deployWithRemainingDon(sim, actions);
  if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
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

  const guestPs   = state[AI];
  const atkPow = battle.atkPower;

  const blockers = [];
  for (let i = 0; i < guestPs.characterArea.length; i++) {
    const fc = guestPs.characterArea[i];
    if (!fcEffectiveHasBlocker(fc, AI, state.activePlayer, state) || fc.state !== 'active' || fc.blockerDisabled) continue;
    blockers.push({ i, pow: calcPower(fc, battle.attackerOwner, AI, state) });
  }
  if (fcEffectiveHasBlocker(guestPs.leader, AI, state.activePlayer, state) && guestPs.leader?.state === 'active') {
    blockers.push({ i: 'leader', pow: calcPower(guestPs.leader, battle.attackerOwner, AI, state) });
  }
  if (!blockers.length) return { type: 'SKIP_BLOCK' };

  // Lookahead: the current attacker has already rested; remaining active human pieces = future attacks.
  const hostPs = state[HUMAN];
  const remainingHumanAttacks =
    hostPs.characterArea.filter(fc => fc.state === 'active').length +
    (hostPs.leader.state === 'active' ? 1 : 0);
  const totalAttacksThisTurn = remainingHumanAttacks + 1; // +1 = current attack in progress

  const isOverwhelmed = totalAttacksThisTurn > (guestPs.lifeArea.length + blockers.length);

  // Conservative counter-capacity estimate (applyPlayCounter requires COUNTER step, not BLOCK).
  // Sums static counter values on all hand cards; dynamic event bonuses are not counted,
  // which deliberately errs on the side of saving blockers.
  const handCounterSum = guestPs.hand.reduce((sum, c) => sum + (c.counter ?? 0), 0);
  const currentGap = Math.max(0, atkPow - battle.defPower);
  const canCounterCurrentAttack = handCounterSum >= currentGap;

  // Tier 0: When the human is launching more attacks than (AI life + AI blockers) can absorb,
  // spending a blocker on a character attack wastes a resource needed for leader protection.
  // Skip if we can counter from hand instead — that saves the character without spending a blocker.
  if (isOverwhelmed && !canCounterCurrentAttack && battle.targetZone === 'character') {
    return { type: 'SKIP_BLOCK' };
  }

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

  // Tier 1.7: When not overwhelmed, sacrifice the weakest blocker to preserve a character
  // whose power exceeds the blocker's (e.g. 1000-power blocker saves a rested 5000-power char).
  // battle.defPower is the target character's calculated power (includes power mods / DON).
  if (!isOverwhelmed && battle.targetZone === 'character' && battle.targetIndex >= 0) {
    if (battle.defPower > weakestBlocker.pow) {
      return { type: 'USE_BLOCKER', blockerIndex: weakestBlocker.i };
    }
  }

  // Tier 2: sacrificial block when life ≤ 2 — sacrifice the weakest blocker to stay
  // in the game while preserving stronger blockers for future attacks.
  if (battle.targetZone === 'leader' && guestPs.lifeArea.length <= 2) {
    return { type: 'USE_BLOCKER', blockerIndex: weakestBlocker.i };
  }

  return { type: 'SKIP_BLOCK' };
}

// ---------------------------------------------------------------------------
// Reactive: AI decides whether to play counter cards
// ---------------------------------------------------------------------------

// Try to play a zero-cost counter event that flips defPower above atkPower.
// Used to bypass the life-guard and hand-size guard, since cost-0 events are
// genuinely free: no DON spent, no play value lost by using them as counters.
function tryFreeEventCounter(state, guestPs) {
  for (let i = 0; i < guestPs.hand.length; i++) {
    const card = guestPs.hand[i];
    if (card.category !== 'Event' || (card.cost ?? 0) !== 0) continue;
    if (!(card.effect ?? '').includes('反擊') && !(card.enEffect ?? '').includes('[Counter]')) continue;
    const trial = applyPlayCounter(state, { handIndex: i });
    if (trial === state || !trial.battle) continue;
    if (trial.battle.defPower > trial.battle.atkPower) return { type: 'PLAY_COUNTER', handIndex: i };
  }
  return null;
}

export function aiDecideCounter(state) {
  const battle = state.battle;
  if (!battle) return { type: 'SKIP_COUNTER' };

  const guestPs = state[AI];
  const gap  = battle.atkPower - battle.defPower;

  if (gap < 0) return { type: 'SKIP_COUNTER' };

  const isLethal = battle.targetZone === 'leader' && guestPs.lifeArea.length <= 1;

  if (battle.targetZone === 'leader') {
    if (!isLethal && guestPs.lifeArea.length >= SAFE_LIFE_COUNT) {
      // Zero-cost events are free — use them even when life is safe
      return tryFreeEventCounter(state, guestPs) ?? { type: 'SKIP_COUNTER' };
    }
  } else {
    const targetFc        = guestPs.characterArea[battle.targetIndex];
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
      const totalCounterCards = guestPs.hand.filter(c =>
        (c.counter ?? 0) >= 2000 || isCounterEventCard(c)
      ).length;
      // Counter-scarce: fewer counters than remaining attacks (can't cover everything)
      if (totalCounterCards <= remainingHumanAttacks) {
        const currentTargetPow  = targetFc?.card?.power ?? 0;
        const maxOtherRestedPow = guestPs.characterArea
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
  // Exception: zero-cost events are free to use as counters (no DON, no play value lost).
  if (!isLethal && guestPs.hand.length <= MIN_HEALTHY_HAND) {
    return tryFreeEventCounter(state, guestPs) ?? { type: 'SKIP_COUNTER' };
  }

  const isBlockerChar = (card) => card.category === 'Character' && hasBlocker(card);

  const counterCards = guestPs.hand
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

  if (isLethal) {
    // Simulate each affordable event counter to measure its power delta.
    const eventCands = guestPs.hand
      .map((card, i) => ({ card, i }))
      .filter(({ card }) =>
        card.category === 'Event' &&
        ((card.effect ?? '').includes('反擊') || (card.enEffect ?? '').includes('[Counter]')) &&
        canAfford(guestPs.costArea, card.cost ?? 0))
      .map(cand => {
        const trial = applyPlayCounter(state, { handIndex: cand.i });
        const delta = (trial === state || !trial.battle) ? 0 : trial.battle.defPower - battle.defPower;
        return { ...cand, delta };
      })
      .filter(c => c.delta > 0)
      .sort((a, b) => (a.card.cost ?? 0) - (b.card.cost ?? 0));  // cheapest first

    const staticTotal = counterCards.reduce((sum, { card }) => sum + (card.counter ?? 0), 0);
    const eventTotal  = eventCands.reduce((sum, c) => sum + c.delta, 0);

    if (staticTotal + eventTotal > gap) {
      // Spend static counters first (highest value), then event counters (cheapest first)
      if (counterCards.length > 0) {
        const nonBlockers = counterCards.filter(({ card }) => !isBlockerChar(card));
        const pool    = nonBlockers.length ? nonBlockers : counterCards;
        const largest = pool.reduce((a, b) => (b.card.counter ?? 0) > (a.card.counter ?? 0) ? b : a);
        return { type: 'PLAY_COUNTER', handIndex: largest.i };
      }
      if (eventCands.length > 0) {
        return { type: 'PLAY_COUNTER', handIndex: eventCands[0].i };
      }
    }
  }

  const eventCounters = guestPs.hand
    .map((card, i) => ({ card, i }))
    .filter(({ card }) =>
      card.category === 'Event' &&
      ((card.effect ?? '').includes('反擊') || (card.enEffect ?? '').includes('[Counter]')) &&
      canAfford(guestPs.costArea, card.cost ?? 0))
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
