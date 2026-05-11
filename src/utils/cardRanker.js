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

export const EFFECT_KEYWORDS = [
  // For ability keywords (速攻, 防禦, 雙重攻擊, 消失, 防禦不可) only score when the
  // keyword appears as the card's own ability: 【KEYWORD】 at the start of a line,
  // after another 】, or preceded by 獲得.  Any other occurrence (e.g. 無法發動【防禦】)
  // is a reference to an opponent's ability and must not score.
  { pattern: /(?:^|】|獲得)【雙重攻擊/, score: 3.0, label: "雙重攻擊" },
  { pattern: /使最多.*?張.*?角色卡登場/, score: 3.0, label: "登場" },
  {
    pattern: /使最多.*?張自己.*?角色卡，以休息狀態登場/,
    score: 2.5,
    label: "休息狀態登場",
  },
  { pattern: /(?:^|】|獲得)【速攻/, score: 3.0, label: "速攻" },
  { pattern: /KO最多.*?張/, score: 3.0, label: "KO", quantify: /最多(\d+)張/ },
  { pattern: /KO全數/, score: 4.0, label: "KO全數" },
  { pattern: /造成對手.*?傷害/, score: 3.0, label: "對手受傷" },
  { pattern: /(?:^|】|獲得)【防禦不可/, score: 2.5, label: "防禦不可" },
  { pattern: /(?:^|】|獲得)【防禦(?!不可)/, score: 2.5, label: "防禦" },
  { pattern: /角色卡放置在持有者的卡組下面/, score: 2.5, label: "放回卡組底" },
  {
    pattern: /將最多.*?張.*?角色卡放回.*?手牌/,
    score: 2.0,
    label: "彈回手牌",
    quantify: /最多(\d+)張/,
  },
  { pattern: /無法進行攻擊/, score: 2.0, label: "無法進行攻擊" },
  { pattern: /無法為活動狀態/, score: 2.0, label: "無法為活動狀態" },
  { pattern: /(?:^|】|獲得)【消失/, score: 2.0, label: "消失" },
  {
    pattern: /可以攻擊對手活動狀態的角色卡/,
    score: 2.0,
    label: "攻擊對手活動狀態",
  },
  { pattern: /抽.*?張卡片/, score: 2.0, label: "抽卡", quantify: /(\d+)張/ },
  { pattern: /不會因對手的效果而離開場上/, score: 2.0, label: "效果保護" },
  { pattern: /力量值減至/, score: 2.0, label: "力量值減至" },
  { pattern: /加入生命值區上面/, score: 2.0, label: "加入生命值" },
  { pattern: /效果無效/, score: 2.0, label: "效果無效" },
  // 力量值+ / 力量值- are scored context-awarely in CONTEXT_AWARE_KEYWORDS, not here
  { pattern: /原本的力量值變更成/, score: 1.5, label: "原本力量值變更" },
  { pattern: /附加.*?咚/, score: 1.5, label: "附加咚卡" },
  {
    pattern: /從咚‼卡組追加最多.*?張/,
    score: 1.5,
    label: "追加咚卡",
    quantify: /最多(\d+)張/,
  },
  {
    pattern: /因對手的效果即將離開場上時，可以替換成/,
    score: 1.5,
    label: "替換保護",
  },
  {
    pattern: /可以替換成將這張角色卡置為休息狀態/,
    score: 1.5,
    label: "替換成休息狀態",
  },
  { pattern: /查看/, score: 1.0, label: "查看" },
  { pattern: /加入手牌/, score: 1.0, label: "加入手牌" },
  { pattern: /置為活動狀態/, score: 1.0, label: "置為活動狀態" },

  { pattern: /放到卡組下面/, score: 0.5, label: "放到卡組底" },
  { pattern: /放回咚‼卡組時/, score: 0.5, label: "放回咚卡組" },
];

// Thresholds are per-Don (score / cost), so they represent value efficiency
export const TIER_THRESHOLDS = { S: 3.0, A: 1.8, B: 1.0 };

// Keywords whose value depends on whether the target is the opponent or the player's own card.
// opponentScore: effect targets opponent (好); selfScore: targets own card (壞 or neutral);
// ambiguousScore: no clear ownership marker in the line.
export const CONTEXT_AWARE_KEYWORDS = [
  {
    pattern: /力量值[-－]\d*/,
    quantify: /[-－](\d+)/,
    quantifyDivisor: 1000,
    opponentScore: 1.5,
    selfScore: -1.5,
    ambiguousScore: 0.5,
    opponentLabel: "力量值-（對手）",
    selfLabel: "力量值-（自己）",
    ambiguousLabel: "力量值-",
  },
  {
    pattern: /力量值[+＋]\d*/,
    quantify: /[+＋](\d+)/,
    quantifyDivisor: 1000,
    opponentScore: -0.5,
    selfScore: 1.5,
    ambiguousScore: 1.5,
    opponentLabel: "力量值+（對手）",
    selfLabel: "力量值+（自己）",
    ambiguousLabel: "力量值+",
  },
  {
    pattern: /置為休息狀態/,
    opponentScore: 2.0,
    selfScore: -1.0,
    ambiguousScore: 1.5,
    opponentLabel: "置為休息狀態（對手）",
    selfLabel: "置為休息狀態（自己）",
    ambiguousLabel: "置為休息狀態",
  },
  {
    pattern: /放置在廢棄區/,
    opponentScore: 1.5,
    selfScore: -1.5,
    ambiguousScore: 0.5,
    opponentLabel: "放置在廢棄區（對手）",
    selfLabel: "放置在廢棄區（自己）",
    ambiguousLabel: "放置在廢棄區",
  },
  {
    pattern: /費用[+＋]\d*/,
    quantify: /[+＋](\d+)/,
    opponentScore: 1.5,
    selfScore: -1.5,
    ambiguousScore: 0.5,
    opponentLabel: "費用+（對手）",
    selfLabel: "費用+（自己）",
    ambiguousLabel: "費用+",
  },
  {
    pattern: /費用[-－]\d*/,
    quantify: /[-－](\d+)/,
    opponentScore: -1.0,
    selfScore: 1.0,
    ambiguousScore: 0.5,
    opponentLabel: "費用-（對手）",
    selfLabel: "費用-（自己）",
    ambiguousLabel: "費用-",
  },
  {
    pattern: /廢棄.*?張/,
    quantify: /(\d+)張/,
    opponentScore: 1.5,
    selfScore: -1.5,
    ambiguousScore: 0.5,
    opponentLabel: "廢棄（對手）",
    selfLabel: "廢棄（自己）",
    ambiguousLabel: "廢棄",
  },
  {
    pattern: /無法置為休息狀態/,
    opponentScore: -1.0,
    selfScore: 1.5,
    ambiguousScore: 1.5,
    opponentLabel: "無法置為休息狀態（對手）",
    selfLabel: "無法置為休息狀態（自己）",
    ambiguousLabel: "無法置為休息狀態",
  },
];

// Extracts a numeric multiplier from a matched string.
// quantify: regex with one capture group for the number.
// divisor: normalise units (e.g. 1000 for power values so +2000 → 2).
// Returns 1 (neutral) when no number is found.
const getQuantifier = (matchedStr, quantify, divisor = 1) => {
  if (!quantify) return 1;
  const m = matchedStr.match(quantify);
  if (!m) return 1;
  const n = parseInt(m[1], 10);
  return isNaN(n) ? 1 : n / divisor;
};

// Keywords that appear BEFORE ： as an activation cost — penalise them
const ACTIVATION_COST_PENALTIES = [
  { pattern: /廢棄/, penalty: 1.5 },
  { pattern: /放置在廢棄區/, penalty: 1.5 },
  { pattern: /咚.*?-(\d+)/, penalty: 1.5 },
  { pattern: /咚!!-1/, penalty: 1.0 },
  { pattern: /可將這張角色卡置為休息狀態/, penalty: 1.0 },
  { pattern: /可以公開/, penalty: 1.0 },
];

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
    breakdown.counter = (card.counter || 0) / 1000;
  }

  const scoreText = (text, multiplier = 1) => {
    for (const kw of EFFECT_KEYWORDS) {
      const matches = text.match(new RegExp(kw.pattern.source, "g"));
      if (!matches) continue;
      if (!breakdown.matchedKeywords.includes(kw.label))
        breakdown.matchedKeywords.push(kw.label);
      let total = 0;
      for (const m of matches)
        total += kw.score * getQuantifier(m, kw.quantify);
      breakdown.effect += total * multiplier;
    }
  };

  // Strip remaining HTML tags, parenthetical notes, and normalise seeker pattern.
  const cleanLine = (text) =>
    text
      .replace(/<[^>]+>/g, "")
      .replace(/[（(][^（(）)]*[）)]/g, "")
      .replace(
        /查看[\d零一二三四五六七八九十]*張卡片[\s\S]*?加入手牌[\s\S]*?放到卡組下面[^。]*/g,
        "加入手牌",
      );

  // Score one line: anything before ： is activation cost, anything after is the effect.
  const scoreLine = (line, multiplier = 1) => {
    const text = cleanLine(line);
    if (!text.trim()) return;
    const colonIdx = text.search(/[：:]/);
    const costText = colonIdx !== -1 ? text.slice(0, colonIdx) : "";
    const mainText = colonIdx !== -1 ? text.slice(colonIdx + 1) : text;

    scoreText(mainText, multiplier);

    // Context-aware keywords: value depends on whether the target is opponent or own card.
    const isOpponent = /對手|對方/.test(mainText);
    const isSelf = /自己|這張/.test(mainText);

    for (const kw of CONTEXT_AWARE_KEYWORDS) {
      const matches = mainText.match(new RegExp(kw.pattern.source, "g"));
      if (!matches) continue;
      const pts = isOpponent
        ? kw.opponentScore
        : isSelf
          ? kw.selfScore
          : kw.ambiguousScore;
      const label = isOpponent
        ? kw.opponentLabel
        : isSelf
          ? kw.selfLabel
          : kw.ambiguousLabel;
      let total = 0;
      for (const m of matches)
        total += pts * getQuantifier(m, kw.quantify, kw.quantifyDivisor);
      breakdown.effect += total * multiplier;
      if (!breakdown.matchedKeywords.includes(label))
        breakdown.matchedKeywords.push(label);
    }

    for (const { pattern, penalty } of ACTIVATION_COST_PENALTIES) {
      const matches = costText.match(new RegExp(pattern.source, "g"));
      if (matches) breakdown.effect -= penalty * matches.length * multiplier;
    }
  };

  const scoreEffect = (html) => {
    if (card.category === "Event" || card.category === "事件") {
      // For events, extract the 【主要】 section from plain text first,
      // then score it as a single block (no line-split needed).
      const plain = html.replace(/<[^>]+>/g, "");
      const mainMatch = plain.match(/【主要】([\s\S]*?)(?=【反擊】|$)/);
      if (mainMatch) scoreLine(mainMatch[1]);
    } else {
      // Split on <br> so each ability line is evaluated independently.
      // A cost clause (text before ：) on line 2 must not swallow line 1's effects.
      html.split(/<br\s*\/?>/i).forEach((line) => scoreLine(line));
    }
  };

  if (card.effect) {
    scoreEffect(card.effect);
  }

  // Trigger effects are ignored: they only activate when the card is in the life area
  // and hit by an opponent's attack — not a benefit of playing the card from hand.

  const rawTotal = breakdown.power + breakdown.counter + breakdown.effect;
  // Normalise by cost so high-cost cards with many abilities don't dominate low-cost efficient cards.
  // Math.max(1, cost) guards against cost-0 stage cards.
  const score = Math.round((rawTotal / Math.max(1, card.cost)) * 10) / 10;

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
