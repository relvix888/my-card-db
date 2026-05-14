import { PLAYER, MAX_CHARACTERS } from './constants';
import {
  applyPlayCharacter, applyAttachDon, applyActivateMain,
  applyDeclareAttack, applyPlayCounter, canAfford, calcPower, activeDonCount,
} from './gameState';
import { rankCardsForTurn } from '../../../utils/cardRanker';
import { hasOnAttack, fcHasBlocker, fcHasDoubleAtk, fcHasBanish, fcEffectiveHasBlocker, getActivatedMainStatus } from './effects';

const AI = PLAYER.AI;
const HUMAN = PLAYER.HUMAN;

const MAGIC_NUMBERS      = [7000, 5000]; // power thresholds that force specific counter costs
const COUNTER_HOLD_DON   = 2;            // DON!! reserved when a counter Event is in hand
const SAFE_LIFE_COUNT    = 3;            // life count at/above which taking any hit is fine
const LOW_HAND_THRESHOLD = 2;            // opponent hand size at/below which counter hold is waived
const RESTED_TARGET_POWER_THRESHOLD = 5000; // min power for a rested character to be worth attacking

// A rested enemy is only worth attacking if it poses a real threat:
//   - it has a Blocker keyword (can intercept a future attack)
//   - it has an Activate-Main effect (can activate again next turn)
//   - its power meets the threshold (threatening enough to leave alive)
// Weak vanilla characters should be ignored so attackers pressure the leader instead.
function isWorthyRestTarget(fc, defPow) {
  if (fcHasBlocker(fc)) return true;
  const effect = fc.card?.effect ?? '';
  if (effect.includes('啟動主要') || effect.includes('起動メイン')) return true;
  return defPow >= RESTED_TARGET_POWER_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Build a simple AI deck from the card database
// ---------------------------------------------------------------------------

export function buildAiDeck(allCards) {
  // Pick a random leader from available leaders (prefer single-color for simplicity)
  const leaders = allCards.filter(c => c.category === 'Leader' && !c.id?.includes('_p'));
  const leader  = leaders[Math.floor(Math.random() * leaders.length)] || leaders[0];
  if (!leader) return { leader: null, deck: [] };

  const leaderColors = new Set(leader.colors || []);

  // Eligible: matches leader color, 50-card main deck, max 4 copies
  const eligible = allCards.filter(c =>
    c.category !== 'Leader' &&
    !c.id?.includes('_p') &&
    (c.colors || []).some(col => leaderColors.has(col))
  );

  // Build deck: prioritize characters, then events, fill to 50
  const deck = [];
  const counts = {};

  // Sort by power desc (AI prefers strong characters)
  const sorted = [...eligible].sort((a, b) => (b.power ?? 0) - (a.power ?? 0));

  for (const card of sorted) {
    if (deck.length >= 50) break;
    const base = card.id.replace(/_p\d+$/, '');
    counts[base] = counts[base] || 0;
    if (counts[base] < 4) {
      deck.push(card);
      counts[base]++;
    }
  }

  // Pad to 50 if needed (repeat first eligible cards)
  let i = 0;
  while (deck.length < 50 && sorted.length > 0) {
    const card = sorted[i % sorted.length];
    const base = card.id.replace(/_p\d+$/, '');
    if ((counts[base] || 0) < 4) {
      deck.push(card);
      counts[base] = (counts[base] || 0) + 1;
    }
    i++;
    if (i > sorted.length * 4) break; // safety
  }

  return { leader, deck };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A "seeker" is a Character whose effect searches the deck for a trait-specific card.
// Signature text: 從自己的卡組上面查看R張卡片，公開最多1張擁有《X》特徵的卡片，並加入手牌
function isSeeker(card) {
  const eff = card.effect ?? '';
  return eff.includes('擁有《') && eff.includes('特徵的卡片，並加入手牌');
}

// Body Power Rule: cards with power < 3000 are Defensive Only — never play in main phase.
// Archetype Exception: +2000 counter cards can only be played if they are seekers.
function isPlayableAsCharacter(card) {
  if ((card.power ?? 0) < 3000) return false;
  if ((card.counter ?? 0) >= 2000) return isSeeker(card);
  return true;
}

// True when the hand contains an Event card playable during the counter step (【反擊】timing).
function hasCounterEvent(hand) {
  return hand.some(c => c.category === 'Event' && (c.effect ?? '').includes('反擊'));
}

// ---------------------------------------------------------------------------
// DON!! Attachment — prioritised spending
// ---------------------------------------------------------------------------

// Pushes ATTACH_DON actions and returns an updated sim.
// Priority 1 (play high-cost characters) is already resolved by planMainPhase step 1,
// which plays all affordable characters before this function is called.
function planDonAttachment(sim, actions) {
  if (activeDonCount(sim[AI].costArea) === 0) return sim;

  // Priority 3: hold DON!! for counter Events (waived when opponent hand is nearly empty)
  const opponentHandLow = sim[HUMAN].hand.length <= LOW_HAND_THRESHOLD;
  const holdAmount = (!opponentHandLow && hasCounterEvent(sim[AI].hand)) ? COUNTER_HOLD_DON : 0;
  let budget = Math.max(0, activeDonCount(sim[AI].costArea) - holdAmount);

  if (budget <= 0) return sim;

  // Priority 2: attach DON!! to reach magic numbers (highest first)
  for (const magic of MAGIC_NUMBERS) {
    if (budget <= 0) break;
    for (let ci = 0; ci < sim[AI].characterArea.length; ci++) {
      if (budget <= 0) break;
      const fc = sim[AI].characterArea[ci];
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

  // Priority 2.5: boost attacking characters to offensive thresholds above opponent leader power.
  // Each +2000 above the leader's base forces the opponent to spend one more counter card from hand.
  if (budget > 0) {
    const humanLeaderPow = sim[HUMAN].leader.card.power ?? 0;
    for (let ci = 0; ci < sim[AI].characterArea.length; ci++) {
      if (budget <= 0) break;
      const fc = sim[AI].characterArea[ci];
      if (fc.state !== 'active' || fc.justDeployed || fc.attackLocked) continue;
      const curPow = (fc.card.power ?? 0) + fc.attachedDon * 1000;
      const k = Math.max(1, Math.ceil((curPow - humanLeaderPow + 1) / 2000));
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

  // Default: attach remaining budget to the character with the highest total power
  while (budget > 0 && activeDonCount(sim[AI].costArea) > 0 && sim[AI].characterArea.length > 0) {
    const chars = sim[AI].characterArea;
    const best  = chars.reduce((bi, fc, i) => {
      const p  = (fc.card.power ?? 0) + fc.attachedDon * 1000;
      const pb = (chars[bi].card.power ?? 0) + chars[bi].attachedDon * 1000;
      return p > pb ? i : bi;
    }, 0);
    actions.push({ type: 'ATTACH_DON', targetZone: 'character', targetIndex: best });
    sim = applyAttachDon(sim, { targetZone: 'character', targetIndex: best });
    budget--;
  }

  // Fallback: attach remaining budget to the leader when no characters can receive it
  while (budget > 0 && activeDonCount(sim[AI].costArea) > 0) {
    actions.push({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1 });
    sim = applyAttachDon(sim, { targetZone: 'leader', targetIndex: -1 });
    budget--;
  }

  return sim;
}

// ---------------------------------------------------------------------------
// Board State Evaluation — used by simulation-based candidate search
// ---------------------------------------------------------------------------

// Score the current game state from AI's perspective (higher = better for AI).
// Considers life gap, board power balance, active-character count, and hand size.
function evalBoardState(state) {
  if (state.winner === AI)    return  10000;
  if (state.winner === HUMAN) return -10000;

  const ai    = state[AI];
  const human = state[HUMAN];

  // Life gap: more AI life remaining relative to opponent's = better buffer.
  // Opponent losing life faster = closer to AI winning.
  const lifeScore = (ai.lifeArea.length - human.lifeArea.length) * 15;

  // Board power balance normalised to ±N per 2000 power unit.
  const aiPow    = ai.characterArea.reduce((s, fc) => s + (fc.card.power ?? 0) + fc.attachedDon * 1000, 0);
  const humanPow = human.characterArea.reduce((s, fc) => s + (fc.card.power ?? 0) + fc.attachedDon * 1000, 0);
  const boardScore = (aiPow - humanPow) / 2000;

  // Active (un-rested) character advantage: bodies that can attack or block next turn.
  const aiActive    = ai.characterArea.filter(fc => fc.state === 'active').length;
  const humanActive = human.characterArea.filter(fc => fc.state === 'active').length;
  const activeScore = (aiActive - humanActive) * 1.5;

  // Hand size as a lightweight resource proxy.
  const handScore = (ai.hand.length - human.hand.length) * 0.3;

  return lifeScore + boardScore + activeScore + handScore;
}

// Simulate playing the card at handIndex, then run DON attachment on the trial
// state and return the resulting board evaluation score.
// Uses a throwaway action buffer so the caller's actions array is not modified.
function trialPlayScore(sim, handIndex) {
  const trial = applyPlayCharacter(sim, { handIndex });
  const dummy = [];
  return evalBoardState(planDonAttachment(trial, dummy));
}

// ---------------------------------------------------------------------------
// AI Decision Engine
// ---------------------------------------------------------------------------

// Returns an array of actions for the AI to take in sequence.
// Each action is dispatched with a delay in the React layer.
function planMainPhase(state) {
  const actions = [];
  let sim = { ...state }; // simulate state to plan ahead

  // 1. Play characters — simulation-based candidate search each step.
  //    The top SIMULATION_CANDIDATES by cost/score are each trialled by simulating
  //    play + DON attachment and scoring the resulting board state. The candidate
  //    with the highest trial score is selected, catching cases where the most
  //    expensive card is not the best contextual play (e.g. a rush body when the
  //    opponent has one life remaining beats a 7-cost vanilla that cannot attack yet).
  const SIMULATION_CANDIDATES = 4;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ps = sim[AI];
    if (ps.characterArea.length >= MAX_CHARACTERS || ps.deployBlockedThisTurn) break;

    const available = activeDonCount(ps.costArea);
    const ranked = rankCardsForTurn(ps.hand, available);
    const playable = ranked.filter(r =>
      (r.category === 'Character' || r.category === '角色') &&
      isPlayableAsCharacter(r) &&
      canAfford(ps.costArea, r.cost ?? 0),
    );
    if (!playable.length) break;

    const candidates = playable
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.score - a.score)
      .slice(0, SIMULATION_CANDIDATES);

    let bestHandIndex = -1;
    let bestTrialScore = -Infinity;
    for (const cand of candidates) {
      const idx = ps.hand.findIndex(c => c.id === cand.id);
      if (idx === -1) continue;
      const score = trialPlayScore(sim, idx);
      if (score > bestTrialScore) {
        bestTrialScore = score;
        bestHandIndex  = idx;
      }
    }
    if (bestHandIndex === -1) break;

    actions.push({ type: 'PLAY_CHARACTER', handIndex: bestHandIndex });
    sim = applyPlayCharacter(sim, { handIndex: bestHandIndex });
  }

  // 1.5: Activate leader's main-phase ability if available (e.g. Enel's DON!! spike).
  //      Must run after character deployment so DON!! can attach to a freshly played body.
  //      Only activate when the effect resolves cleanly (no interactive state for human/AI).
  {
    const status = getActivatedMainStatus(
      sim[AI].leader.card, sim[AI], sim, AI, { target: 'leader' }
    );
    if (status?.available) {
      const trialSim = applyActivateMain(sim, { zone: 'leader', index: -1 });
      if (!trialSim.pendingEffect && !trialSim.pendingReplace && !trialSim.pendingTrigger) {
        actions.push({ type: 'ACTIVATE_MAIN', zone: 'leader', index: -1 });
        sim = trialSim;
        if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
      }
    }
  }

  // 2. Attach DON!! with prioritised spending (magic numbers → hold for counters → default)
  sim = planDonAttachment(sim, actions);

  // No attacks are allowed on turn 1 — skip steps 3 and 4 to avoid dispatching
  // no-op DECLARE_ATTACKs that return the same state reference and stall the AI loop.
  if (state.turn === 1) { actions.push({ type: 'END_TURN' }); return actions; }

  // Lethal opportunity detection (shared by steps 3 and 4).
  // When human has 0 life, count AI attacks that beat the bare leader power vs the
  // human's +2000-counter capacity.  If more attacks beat the leader than the human
  // can counter, the opponent cannot defend every attack — commit every winning strike.
  const humanAtZeroLife = sim[HUMAN].lifeArea.length === 0;
  let isLethal = false;
  if (humanAtZeroLife) {
    const leaderDefPow        = calcPower(sim[HUMAN].leader, AI, HUMAN, sim);
    const humanCounterSlots   = sim[HUMAN].hand.filter(c => (c.counter ?? 0) >= 2000).length;
    const winningCharAttacks  = sim[AI].characterArea.filter(
      fc => fc.state === 'active' && !fc.justDeployed && !fc.attackLocked
         && calcPower(fc, AI, AI, sim) > leaderDefPow
    ).length;
    const leaderWins = sim[AI].leader.state === 'active'
      && calcPower(sim[AI].leader, AI, AI, sim) > leaderDefPow;
    isLethal = (winningCharAttacks + (leaderWins ? 1 : 0)) > humanCounterSlots;
  }

  // 3. Attack with each active character.
  //    Target assignment uses minimum-force matching: sort rested enemies weakest-first
  //    and pair each with the weakest capable attacker, so strong characters are freed to
  //    pressure the leader instead of overkilling low-power rested targets.
  //    Among characters targeting the leader, attack order is weakest-first to drain
  //    opponent counters before the heavier strikes land.
  {
    const characterAttackers = sim[AI].characterArea
      .map((fc, i) => ({ fc, i, atkPow: calcPower(fc, AI, AI, sim) }))
      .filter(({ fc }) => fc.state === 'active' && !fc.justDeployed && !fc.attackLocked)
      .sort((a, b) => a.atkPow - b.atkPow);  // weakest first

    // Pre-assign: weakest enemy to weakest capable attacker (skip low-value rested chars)
    const restedEnemies = humanAtZeroLife ? [] : sim[HUMAN].characterArea
      .map((hfc, idx) => ({ hfc, idx, defPow: calcPower(hfc, AI, HUMAN, sim) }))
      .filter(({ hfc, defPow }) => hfc.state === 'rest' && isWorthyRestTarget(hfc, defPow))
      .sort((a, b) => a.defPow - b.defPow);   // weakest first

    const targetFor = new Map();  // characterArea index -> human characterArea index
    const usedAttackers = new Set();
    for (const enemy of restedEnemies) {
      for (const atk of characterAttackers) {
        if (usedAttackers.has(atk.i)) continue;
        if (atk.atkPow >= enemy.defPow) {
          targetFor.set(atk.i, enemy.idx);
          usedAttackers.add(atk.i);
          break;
        }
      }
    }

    for (const { fc, i, atkPow } of characterAttackers) {
      const assignedIdx = targetFor.get(i);
      const attackAction = assignedIdx !== undefined
        ? { type: 'DECLARE_ATTACK', attackerZone: 'character', attackerIndex: i, targetOwner: HUMAN, targetZone: 'character', targetIndex: assignedIdx }
        : { type: 'DECLARE_ATTACK', attackerZone: 'character', attackerIndex: i, targetOwner: HUMAN, targetZone: 'leader', targetIndex: -1 };

      const defTarget = assignedIdx !== undefined
        ? sim[HUMAN].characterArea[assignedIdx]
        : sim[HUMAN].leader;
      const defPow = defTarget ? calcPower(defTarget, AI, HUMAN, sim) : 0;
      if (atkPow < defPow && !hasOnAttack(fc.card) && !isLethal) continue;

      actions.push(attackAction);
      sim = applyDeclareAttack(sim, attackAction);
      if (sim.winner) break;
    }
  }

  // 4. Leader attacks LAST — after characters have drained counters and baited trigger reveals.
  //    Using the leader as a finisher (not an opener) is the standard competitive approach.
  {
    const ps = sim[AI];
    if (ps.leader.state === 'active') {
      const atkPow = calcPower(ps.leader, AI, AI, sim);
      const hasAttackEffect = hasOnAttack(ps.leader.card);

      // Prefer attacking rested characters for board advantage, but only when it is a
      // winning (or on-attack) battle.  If no rested target is viable, fall back to
      // attacking the human's leader directly — ties go to the attacker in this engine,
      // so an equal-power leader strike always forces the opponent to spend a counter card.
      let attackAction = null;

      if (!humanAtZeroLife) {
        const restedTargets = sim[HUMAN].characterArea
          .map((hfc, idx) => ({ hfc, idx, defPow: calcPower(hfc, AI, HUMAN, sim) }))
          .filter(({ hfc, defPow }) => hfc.state === 'rest' && isWorthyRestTarget(hfc, defPow));
        for (const { idx, defPow: restCharPow } of restedTargets) {
          if (atkPow >= restCharPow || hasAttackEffect) {
            attackAction = { type: 'DECLARE_ATTACK', attackerZone: 'leader', attackerIndex: -1, targetOwner: HUMAN, targetZone: 'character', targetIndex: idx };
            break;
          }
        }
      }

      // No viable rested-character target — try the human's leader directly
      if (!attackAction) {
        const humanLeaderPow = calcPower(sim[HUMAN].leader, AI, HUMAN, sim);
        if (atkPow >= humanLeaderPow || hasAttackEffect || isLethal) {
          attackAction = { type: 'DECLARE_ATTACK', attackerZone: 'leader', attackerIndex: -1, targetOwner: HUMAN, targetZone: 'leader', targetIndex: -1 };
        }
      }

      if (attackAction) {
        actions.push(attackAction);
        sim = applyDeclareAttack(sim, attackAction);
        if (sim.winner) { actions.push({ type: 'END_TURN' }); return actions; }
      }
    }
  }

  actions.push({ type: 'END_TURN' });
  return actions;
}

// AI decides whether to block during human's attack.
// Returns { type: 'USE_BLOCKER', blockerIndex } or { type: 'SKIP_BLOCK' }.
export function aiDecideBlock(state) {
  const battle = state.battle;
  if (!battle) return { type: 'SKIP_BLOCK' };

  const aiPs = state[AI];
  const atkPow = battle.atkPower;

  // Collect all usable blockers with their computed power
  const blockers = [];
  for (let i = 0; i < aiPs.characterArea.length; i++) {
    const fc = aiPs.characterArea[i];
    if (!fcEffectiveHasBlocker(fc, AI, state.activePlayer, state) || fc.state !== 'active') continue;
    blockers.push({ i, pow: calcPower(fc, battle.attackerOwner, AI, state) });
  }
  if (!blockers.length) return { type: 'SKIP_BLOCK' };

  // Tier 1: use the weakest blocker that wins outright — preserves stronger blockers for later
  const winners = blockers.filter(b => b.pow > atkPow);
  if (winners.length) {
    const weakest = winners.reduce((a, b) => b.pow < a.pow ? b : a);
    return { type: 'USE_BLOCKER', blockerIndex: weakest.i };
  }

  const attackWouldSucceed = atkPow > battle.defPower;
  if (!attackWouldSucceed) return { type: 'SKIP_BLOCK' };

  const weakestBlocker   = blockers.reduce((a, b) => b.pow < a.pow ? b : a);
  const strongestBlocker = blockers.reduce((a, b) => b.pow > a.pow ? b : a); // used by Tier 2

  // Tier 1.5: attacker has Double Attack or Banish — both keywords make a successful hit
  // disproportionately punishing (two life cards taken, or life card trashed with no trigger).
  // Use the weakest blocker to redirect the attack and preserve stronger blockers for later.
  const attackerFC = battle.attackerZone === 'leader'
    ? state[battle.attackerOwner].leader
    : state[battle.attackerOwner].characterArea[battle.attackerIndex];
  if (fcHasDoubleAtk(attackerFC) || fcHasBanish(attackerFC)) {
    return { type: 'USE_BLOCKER', blockerIndex: weakestBlocker.i };
  }

  // Tier 2: sacrificial block — the attack would succeed and not blocking means AI life
  // will drop to ≤ 1 (i.e. current life ≤ 2).  Intercept with the strongest blocker to
  // redirect the hit away from the leader and stay in the game.
  if (battle.targetZone === 'leader' && aiPs.lifeArea.length <= 2) {
    return { type: 'USE_BLOCKER', blockerIndex: strongestBlocker.i };
  }

  return { type: 'SKIP_BLOCK' };
}

// AI decides whether to play counter cards.
// Returns { type: 'PLAY_COUNTER', handIndex } or { type: 'SKIP_COUNTER' }.
export function aiDecideCounter(state) {
  const battle = state.battle;
  if (!battle) return { type: 'SKIP_COUNTER' };

  const aiPs = state[AI];
  const gap  = battle.atkPower - battle.defPower;

  // 1. Already defending — defender wins only when defPower > atkPower (tie goes to attacker).
  if (gap < 0) return { type: 'SKIP_COUNTER' };

  // 2. Lethality: this hit removes the last life — must defend or accept the loss.
  const isLethal = battle.targetZone === 'leader' && aiPs.lifeArea.length <= 1;

  // 3. Decide whether to bother countering based on what is being attacked.
  if (battle.targetZone === 'leader') {
    // Life-economy rule: let leader hits through while life is plentiful — each hit
    // draws a card from the life area, so taking it freely is net-neutral card-wise.
    if (!isLethal && aiPs.lifeArea.length >= SAFE_LIFE_COUNT) {
      return { type: 'SKIP_COUNTER' };
    }
  } else {
    // Character defence: attacking a character yields no free card draw — the body is
    // simply KO'd. Only spend a counter card if the character is worth saving.
    const targetFc = aiPs.characterArea[battle.targetIndex];
    const humanLeaderPower = state[HUMAN].leader?.card?.power ?? 0;
    // Counter efficiency: cost to defend NOW vs counter opponent needs next turn if the
    // character survives and attacks their leader. If defending is the cheaper side, do it.
    const opponentNextGap = Math.max(0, battle.defPower - humanLeaderPower);
    const isWorthDefending =
      (targetFc?.card.power ?? 0) >= 5000 ||  // can threaten leader without Don investment
      hasOnAttack(targetFc?.card) ||           // has on-attack trigger value
      gap < opponentNextGap;                   // defending costs less than opponent countering next turn
    if (!isWorthDefending) return { type: 'SKIP_COUNTER' };
  }

  // 4. Efficiency: use the smallest standard counter card that flips the result.
  //    Tie-break by cost (lowest cost first) to preserve expensive cards for the main phase.
  const counterCards = aiPs.hand
    .map((card, i) => ({ card, i }))
    .filter(({ card }) => (card.counter ?? 0) > 0)
    .sort((a, b) => {
      const diff = a.card.counter - b.card.counter;
      if (diff !== 0) return diff;
      return (a.card.cost ?? 0) - (b.card.cost ?? 0);
    });
  const efficient = counterCards.find(({ card }) => card.counter > gap);
  if (efficient) return { type: 'PLAY_COUNTER', handIndex: efficient.i };

  // Lethal fallback: no single card flips the gap, but stacking multiple cards might.
  // Play the largest available counter so each re-trigger chips away at the gap.
  if (isLethal && counterCards.length > 0) {
    const totalCounterPower = counterCards.reduce((sum, { card }) => sum + (card.counter ?? 0), 0);
    if (totalCounterPower > gap) {
      return { type: 'PLAY_COUNTER', handIndex: counterCards[counterCards.length - 1].i };
    }
  }

  // 5. Event counter cards (【反擊】timing) — simulate each affordable one, cheapest first.
  //    Pick the first that actually flips the battle result.
  const eventCounters = aiPs.hand
    .map((card, i) => ({ card, i }))
    .filter(({ card }) =>
      card.category === 'Event' &&
      (card.effect ?? '').includes('反擊') &&
      canAfford(aiPs.costArea, card.cost ?? 0)
    )
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
// Returns an array of timed action sequences.
// ---------------------------------------------------------------------------

export function getAiTurnActions(state) {
  // Auto-phases (REFRESH/DRAW/DON_PHASE) are already dispatched by the
  // useEffect in PracticeView. This queue only covers the main phase.
  return planMainPhase(state);
}
