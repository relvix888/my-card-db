import { parseEffect } from "../components/practice/engine/effectParser";

export const POWER_BASELINE = {
  1: 2000,
  2: 3000,
  3: 4000,
  4: 5000,
  5: 6000,
  6: 7000,
  7: 8000,
  8: 9000,
  9: 10000,
  10: 11000,
};

// Thresholds are calibrated for the sqrt-compressed cost normalization.
export const TIER_THRESHOLDS = { S: 2.0, A: 1.2, B: 0.7 };

const PASSIVE_KEYWORD_SCORES = {
  速攻: 3.0,
  雙重攻擊: 3.0,
  防禦: 2.5,
  防禦不可: 2.5,
  消失: 2.0,
};

// Maps effectParser action types to a score function (action, owner) => number.
// owner: 'self' | 'opponent' | null (from action.filter?.owner)
// Unlisted action types fall back to 0.5.
// NOTE: effectParser uses `delta` (not `amount`) for POWER_MOD magnitude.
const ACTION_SCORES = {
  DRAW: (a) => 2.0 * (a.count ?? 1),
  SEARCH: (a) => 2.0 + 0.5 * (a.take ?? 1),
  KO: (a) => 2.5 + 0.5 * Math.max(0, (a.count ?? 1) - 1),
  // Scale deploy value with the cost of what's deployed: higher-cost targets are stronger.
  DEPLOY: (a) => {
    const cost = a.filter?.cost;
    return cost != null ? Math.min(5.0, 1.5 + cost * 0.25) : 3.0;
  },
  SELF_DEPLOY: () => 2.0,
  SELF_DEPLOY_FROM_TRASH: () => 2.5,
  CONDITIONAL_DEPLOY: () => 2.0,
  SELF_TO_TRASH: () => -2.0, // sacrificing self is a significant board-presence cost
  CONFIRM_OPTIONAL_ACTIVATION: () => 0,
  DISCARD: (a, owner) =>
    owner === "opponent" ? 1.5 * (a.count ?? 1) : -1.5 * (a.count ?? 1),
  DISCARD_FREE: (a, owner) => (owner === "opponent" ? 2.0 : -0.5),
  DISCARD_FIELD_CHAR: (a, owner) => (owner === "opponent" ? 2.0 : -1.0),
  DISCARD_EQUAL_TO_DRAW: () => -0.5,
  POWER_MOD: (a, owner) => {
    // effectParser stores the magnitude as `delta`; `setToZero` is a separate flag.
    if (a.setToZero) return owner === "opponent" ? 4.0 : -3.0;
    if (a.delta == null) return 1.0; // unknown magnitude — modest positive fallback
    const raw = Math.abs(a.delta / 1000);
    if (owner === "opponent")
      return a.delta < 0 ? raw * 1.0 : -raw * 0.5;
    return a.delta > 0 ? raw * 1.0 : -raw * 1.0;
  },
  SET_BASE_POWER: () => 1.5,
  COPY_POWER_FROM_TARGET: () => 1.5,
  REST: (a, owner) => (owner === "opponent" ? 2.0 : -1.0),
  UNREST: (a, owner) => (owner === "self" ? 1.5 : -0.5),
  UNREST_DON: () => 1.0,
  GRANT_KEYWORD: (a) => PASSIVE_KEYWORD_SCORES[a.keyword] ?? 1.0,
  DEAL_DAMAGE: (a) => 2.0 * (a.count ?? 1),
  BLOCK_EFFECT: () => 2.0,
  NULL_EFFECT: () => 2.0,
  ATTACK_LOCK: (a, owner) => (owner === "opponent" ? 1.5 : -1.0),
  // Preventing opponent characters from resting = they can't attack (same value as ATTACK_LOCK).
  PREVENT_REST: (a, owner) => (owner === "opponent" ? 1.5 : -1.0),
  REFRESH_LOCK: (a, owner) => (owner === "opponent" ? 1.5 : -1.0),
  BLOCK_DEPLOY: () => 2.0,
  BLOCK_LIFE_TO_HAND: () => 1.5,
  HAND_PLAY_LOCK: (a, owner) => (owner === "opponent" ? 2.0 : -1.5),
  DRAW_LOCK: (a, owner) => (owner === "opponent" ? 1.5 : -1.0),
  COST_MOD: (a, owner) => (owner === "opponent" ? 1.5 : -0.5),
  HAND_COST_MOD: () => 1.0,
  HAND_COUNTER_MOD: () => 2.0,
  ATTACH_DON: (a) => 1.0 * (a.count ?? 1),
  ADD_DON_FROM_DECK: (a) => 1.0 * (a.count ?? 1),
  OPPONENT_DON_RETURN: (a) => 1.5 * (a.count ?? 1),
  ADD_TO_HAND: (a) => 2.0 * (a.count ?? 1),
  ADD_TO_LIFE: () => 2.0,
  LIFE_TO_HAND: () => 1.0,
  HAND_TO_DECK: (a, owner) => (owner === "opponent" ? 1.5 : -0.5),
  HAND_TO_LIFE: () => 1.5,
  DECK_TO_TRASH: () => 0.5,
  FIELD_TO_LIFE: () => 1.0,
  TRASH_TO_LIFE_OR_FIELD: () => 1.5,
  FREE_EVENT: () => 2.5,
  FLIP_LIFE_FACE_UP: () => 1.0,
  LOOK_ARRANGE_LIFE: () => 1.0,
  REVEAL_LIFE: () => 0.5,
  OPPONENT_HAND_TO_DECK: () => 2.0,
  REDIRECT_ATTACK_TARGET: () => 1.5,
  INDESTRUCTIBLE_IN_BATTLE: () => 2.0,
  INDESTRUCTIBLE_BY_EFFECT: () => 2.0,
  FIRE_MAIN_EFFECT: () => 1.5,
  SELECT_TARGET: () => 0.5,
};

// Score a single parsed action, recursing into CONDITIONAL nested actions.
function scoreAction(action, matchedKeywords) {
  const owner = action.filter?.owner ?? null;
  // CONDITIONAL wraps guarded actions; score them at a discount based on how restrictive
  // the condition is. Leader-trait conditions only fire in specific decks (steep discount).
  if (action.type === "CONDITIONAL" && action.actions) {
    const isLeaderCond = action.condition?.subject === "leader";
    const condMult = isLeaderCond ? 0.4 : 0.6;
    return (
      action.actions.reduce(
        (sum, a) => sum + scoreAction(a, matchedKeywords),
        0,
      ) * condMult
    );
  }
  const scorer = ACTION_SCORES[action.type];
  const base = scorer ? scorer(action, owner) : 0.5;
  if (base > 0) matchedKeywords.push(action.type);
  return base;
}

function scoreEffectFromParsed(clauses) {
  let total = 0;
  const matchedKeywords = [];

  for (const clause of clauses) {
    // Each recognized timing has an individual weight. When a clause carries multiple
    // timings (e.g. 【登場時】/【KO時】) the weights are summed so every firing opportunity
    // contributes — 登場時(1.0) + KO時(0.3) = 1.3× instead of stopping at the first match.
    const TIMING_WEIGHT = {
      登場時: 1.0, 啟動主要: 1.0,
      觸發器: 0.5,
      攻擊時: 0.8, 對方攻擊時: 0.7,
      KO時: 0.3, 受到傷害時: 0.5,
    };
    let timingMult;
    if (clause.activated?.includes("反擊")) {
      timingMult = 0.1; // counter-step only, never played from hand
    } else {
      const timings = clause.timings ?? [];
      // Sum weights for every timing present; unrecognized timings default to 1.0.
      timingMult = timings.length === 0
        ? 1.0
        : timings.reduce((s, t) => s + (TIMING_WEIGHT[t] ?? 1.0), 0);
    }
    // 我方/對方回合中 live in clause.continuous and compound multiplicatively.
    if (clause.continuous?.includes("我方回合中")) timingMult *= 0.65;
    else if (clause.continuous?.includes("對方回合中")) timingMult *= 0.65;

    // Activation costs reduce the net value of the clause.
    // Leader-trait conditions (若領航卡擁有X特徵) restrict the card to specific decks
    // and carry a steeper penalty than generic conditions.
    let activationPenalty = 0;
    if (clause.donReturn) activationPenalty += 0.5 * clause.donReturn;
    if (clause.donGate) activationPenalty += 0.2 * clause.donGate;
    if (clause.oncePerTurn) activationPenalty += 0.2;
    if (clause.condition) {
      activationPenalty += clause.condition.subject === "leader" ? 0.6 : 0.3;
    }

    let clauseScore = 0;
    for (const action of clause.actions ?? []) {
      clauseScore += scoreAction(action, matchedKeywords);
    }

    // Passive keywords are on the clause itself, not inside actions.
    for (const kw of clause.passive ?? []) {
      clauseScore += PASSIVE_KEYWORD_SCORES[kw] ?? 1.0;
      matchedKeywords.push(kw);
    }

    total += (clauseScore - activationPenalty) * timingMult;
  }

  return { effectScore: total, matchedKeywords };
}

export function scoreCard(card) {
  const breakdown = {
    power: 0,
    counter: 0,
    effect: 0,
    matchedKeywords: [],
  };

  if (card.power != null && card.cost > 0) {
    const baseline = POWER_BASELINE[card.cost] ?? card.cost * 1000 + 1000;
    breakdown.power = (card.power - baseline) / 1000;
  }

  // For character cards: 2k-counter cards are still playable in many decks;
  // a modest penalty reflects the held-as-counter opportunity cost, not a hard veto.
  if (card.category === "Character" || card.category === "角色") {
    if (card.counter === 2000) breakdown.counter = -1.0;
    else if (card.counter === 1000) breakdown.counter = 0;
    else breakdown.counter = 1.0;
  } else {
    breakdown.counter = 0; // counter value is spent at the counter step, irrelevant to main-phase play
  }

  if (card.effect) {
    const clauses = parseEffect(card.effect);
    const { effectScore, matchedKeywords } = scoreEffectFromParsed(clauses);
    breakdown.effect = effectScore;
    breakdown.matchedKeywords = matchedKeywords;
  }

  const rawTotal = breakdown.power + breakdown.counter + breakdown.effect;
  // Normalise by a sqrt-compressed cost so the range between cost-1 and cost-10 cards is
  // ~4× rather than 10× (linear /cost). Formula: 1 + √(cost - 1):
  //   cost-1 → ÷1.00  cost-4 → ÷1.73  cost-7 → ÷2.45  cost-10 → ÷3.00
  // Events are one-shot (no board presence); the 0.60× discount reflects that.
  const isEvent = card.category === "Event" || card.category === "事件";
  const costNorm = 1 + Math.sqrt(Math.max(0, (card.cost ?? 1) - 1));
  const score =
    Math.round(
      (rawTotal / costNorm) * (isEvent ? 0.6 : 1.0) * 10,
    ) / 10;

  let tier = "C";
  if (score >= TIER_THRESHOLDS.S) tier = "S";
  else if (score >= TIER_THRESHOLDS.A) tier = "A";
  else if (score >= TIER_THRESHOLDS.B) tier = "B";

  return { score, tier, breakdown };
}

function applyTier(score) {
  if (score >= TIER_THRESHOLDS.S) return "S";
  if (score >= TIER_THRESHOLDS.A) return "A";
  if (score >= TIER_THRESHOLDS.B) return "B";
  return "C";
}

export function rankCardsForTurn(deckCards, availableDon) {
  return deckCards
    .filter(
      (c) =>
        c.category !== "Leader" &&
        c.category !== "領航" &&
        c.cost <= availableDon,
    )
    .map((c) => {
      const { score: baseScore, breakdown } = scoreCard(c);
      const gap = availableDon - c.cost;
      // Gap 0 or 1 is ideal: the card costs exactly the available Don, or one less
      // (the previous turn had two fewer Don so cost-N was unplayable then).
      // Each extra Don wasted beyond that adds a 0.3 penalty.
      const donEfficiency = gap <= 1 ? 0 : -((gap - 1) * 0.3);
      const score = Math.round((baseScore + donEfficiency) * 10) / 10;
      return {
        ...c,
        score,
        tier: applyTier(score),
        breakdown: { ...breakdown, donEfficiency },
      };
    })
    .sort((a, b) => b.score - a.score);
}
