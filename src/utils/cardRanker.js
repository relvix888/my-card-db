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

// Thresholds are per-Don (score / cost), so they represent value efficiency
export const TIER_THRESHOLDS = { S: 3.0, A: 1.8, B: 1.0 };

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
const ACTION_SCORES = {
  DRAW: (a) => 2.0 * (a.count ?? 1),
  SEARCH: (a) => 2.0 + 0.5 * (a.takeCount ?? 1),
  KO: (a) => 2.5 + 0.5 * Math.max(0, (a.count ?? 1) - 1),
  DEPLOY: () => 3.0,
  SELF_DEPLOY: () => 2.0,
  SELF_DEPLOY_FROM_TRASH: () => 2.5,
  CONDITIONAL_DEPLOY: () => 2.0,
  DISCARD: (a, owner) =>
    owner === "opponent" ? 1.5 * (a.count ?? 1) : -1.5 * (a.count ?? 1),
  DISCARD_FREE: (a, owner) => (owner === "opponent" ? 2.0 : -0.5),
  DISCARD_FIELD_CHAR: (a, owner) => (owner === "opponent" ? 2.0 : -1.0),
  DISCARD_EQUAL_TO_DRAW: () => -0.5,
  POWER_MOD: (a, owner) => {
    const raw = Math.abs((a.amount ?? 1000) / 1000);
    if (owner === "opponent")
      return (a.amount ?? 0) < 0 ? raw * 1.0 : -raw * 0.5;
    return (a.amount ?? 0) > 0 ? raw * 1.0 : -raw * 1.0;
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
  PREVENT_REST: (a, owner) => (owner === "self" ? 1.5 : -1.0),
  REFRESH_LOCK: (a, owner) => (owner === "opponent" ? 1.5 : -1.0),
  BLOCK_DEPLOY: () => 2.0,
  BLOCK_LIFE_TO_HAND: () => 1.5,
  HAND_PLAY_LOCK: (a, owner) => (owner === "opponent" ? 2.0 : -1.5),
  DRAW_LOCK: (a, owner) => (owner === "opponent" ? 1.5 : -1.0),
  COST_MOD: (a, owner) => (owner === "opponent" ? 1.5 : -0.5),
  HAND_COST_MOD: () => 1.0,
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

function scoreEffectFromParsed(clauses) {
  let total = 0;
  const matchedKeywords = [];

  for (const clause of clauses) {
    // Effects that only fire when life is hit or the card attacks are worth less
    // when evaluating the value of playing the card from hand.
    let timingMult = 1.0;
    if (clause.activated?.includes("反擊"))
      timingMult = 0.1; // counter-step only, never played from hand
    else if (clause.timings?.includes("觸發器")) timingMult = 0.5;
    else if (clause.timings?.includes("攻擊時")) timingMult = 0.8;
    else if (clause.timings?.includes("對方攻擊時")) timingMult = 0.7;

    // Activation costs reduce the net value of the clause.
    let activationPenalty = 0;
    if (clause.donReturn) activationPenalty += 0.5 * clause.donReturn;
    if (clause.donGate) activationPenalty += 0.2 * clause.donGate;
    if (clause.oncePerTurn) activationPenalty += 0.2;
    if (clause.condition) activationPenalty += 0.3;

    let clauseScore = 0;

    for (const action of clause.actions ?? []) {
      const owner = action.filter?.owner ?? null;
      const scorer = ACTION_SCORES[action.type];
      const base = scorer ? scorer(action, owner) : 0.5;
      if (base > 0) matchedKeywords.push(action.type);
      clauseScore += base;
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

  // For character cards: high counter value means you should hold it as a counter,
  // not play it. Penalise 2k counter, neutral on 1k, reward no-counter cards.
  if (card.category === "Character" || card.category === "角色") {
    if (card.counter === 2000) breakdown.counter = -2.0;
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
  // Normalise by cost so high-cost cards with many abilities don't dominate low-cost efficient cards.
  // Math.max(1, cost) guards against cost-0 stage cards.
  // Events are one-shot (played once, sent to trash) while characters persist on the field —
  // the 0.75× factor partially models that ongoing board presence.
  const isEvent = card.category === "Event" || card.category === "事件";
  const score =
    Math.round(
      (rawTotal / Math.max(1, card.cost)) * (isEvent ? 0.75 : 1.0) * 10,
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
