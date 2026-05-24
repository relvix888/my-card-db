/**
 * effectParser.js
 * Tokenises card effect text (Traditional Chinese, <br>-separated blocks)
 * into structured clause objects used by effectActions.js.
 */

// Maps ①-⑨ (U+2460–U+2468) and ➀-➄ (U+2780–U+2784) to their integer values.
function circledCharToInt(ch) {
  const code = ch.codePointAt(0);
  if (code >= 0x2460 && code <= 0x2468) return code - 0x2460 + 1;
  if (code >= 0x2780 && code <= 0x2784) return code - 0x2780 + 1;
  return null;
}

const TIMING_KW = new Set([
  "登場時",
  "KO時",
  "攻擊時",
  "對方攻擊時",
  "防禦時",
  "我方回合開始時",
  "我方回合結束時",
  "觸發器",
  "受到傷害時",
  "造成傷害時",
  // English equivalents
  "On Play",
  "On K.O.",
  "When Attacking",
  "On Your Opponent's Attack",
  "On Block",
  "End of Your Turn",
  "Trigger",
]);
const ACTIVATED_KW = new Set(["啟動主要", "主要", "反擊", "起動メイン", "Activate: Main", "Main", "Counter"]);
const CONTINUOUS_KW = new Set(["對方回合中", "我方回合中", "Opponent's Turn", "Your Turn"]);
const PASSIVE_KW = new Set(["速攻", "防禦", "防禦不可", "雙重攻擊", "消失", "Rush", "Rush: Character", "Blocker", "Unblockable", "Double Attack", "Banish"]);

// Normalise DON!! text to canonical ‼ (U+203C).
// Handles every common iOS-emoji workaround: bare !!, !! with a zero-width char between,
// and ‼ followed by a variation-selector or zero-width char.
const _ZW_CLASS = "​‌‍⁠­﻿︎️";
const DOUBLE_BANG_RE = new RegExp(`![${_ZW_CLASS}]?!`, "g"); // !! or !<zw>! → ‼
const POST_BANG_RE = new RegExp(`‼[${_ZW_CLASS}]`, "g"); // ‼<zw>       → ‼

function normalizeDon(text) {
  return text.replace(DOUBLE_BANG_RE, "‼").replace(POST_BANG_RE, "‼");
}

/**
 * Parse a card's effect string into an array of clause objects.
 * @param {string} text  card.effect (HTML, <br>-delimited)
 * @returns {Clause[]}
 */
export function parseEffect(text) {
  if (!text) return [];
  const blocks = normalizeDon(text).split("<br>");

  // Coalesce "選擇下列其中一項" trigger block + following ・-prefixed option lines
  const clauses = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i].trim();
    if (b.includes("選擇下列其中一項")) {
      const optionBlocks = [];
      let j = i + 1;
      while (j < blocks.length) {
        const ob = blocks[j].trim();
        if (ob.startsWith("・") || ob.startsWith("•")) {
          optionBlocks.push(ob);
          j++;
        } else {
          break;
        }
      }
      if (optionBlocks.length >= 2) {
        const result = parseChooseOneBlock(b, optionBlocks);
        if (result)
          clauses.push(...(Array.isArray(result) ? result : [result]));
        i = j;
        continue;
      }
    }
    // Skip entire parenthetical clarification blocks — e.g. Rush notes, damage notes,
    // trigger-no-activation reminders. These are always rule text, never active effects.
    if (b.startsWith("(") && b.endsWith(")")) {
      i++;
      continue;
    }
    const result = parseBlock(blocks[i]);
    if (result) clauses.push(...(Array.isArray(result) ? result : [result]));
    i++;
  }
  return clauses;
}

function parseChooseOneBlock(headerBlock, optionBlocks) {
  const s = headerBlock.trim();
  if (!s) return null;

  const keywords = [];
  const kwRe = /【([^】]+)】/g;
  let m;
  while ((m = kwRe.exec(s)) !== null) keywords.push(m[1]);
  const enKwRe = /\[([^\]]+)\]/g;
  while ((m = enKwRe.exec(s)) !== null) keywords.push(m[1]);

  const timings = keywords.filter((k) => TIMING_KW.has(k));
  const activated = keywords.filter((k) => ACTIVATED_KW.has(k));
  const donGateM = s.match(/咚‼×(\d)/);
  const donGate = donGateM ? parseInt(donGateM[1]) : null;
  const donRetM = s.match(/咚‼-(\d+)(?:\([^)]+\))?[：:,，]/);
  const donReturn = donRetM ? parseInt(donRetM[1]) : null;
  const oncePerTurn = keywords.includes("每回合1次") || keywords.includes("Once Per Turn");

  const options = optionBlocks.map((ob) => {
    const rawText = ob.replace(/^[・•]\s*/, "").trim();
    return {
      label: rawText.replace(/。$/, ""),
      actions: parseSentences(rawText),
    };
  });

  return {
    timings: [...timings, ...activated],
    continuous: [],
    passive: [],
    donGate,
    donReturn,
    donReturnMinCount: null,
    oncePerTurn,
    isReplacement: false,
    isOptional: false,
    condition: null,
    conditionRaw: null,
    raw: s,
    actions: [{ type: "CHOOSE_ONE", options }],
  };
}

function parseBlock(raw) {
  const s = raw.trim();
  if (!s) return null;

  const keywords = [];
  const kwRe = /【([^】]+)】/g;
  let m;
  while ((m = kwRe.exec(s)) !== null) keywords.push(m[1]);
  const enKwRe = /\[([^\]]+)\]/g;
  while ((m = enKwRe.exec(s)) !== null) keywords.push(m[1]);

  // Keywords that appear in 未持有【X】 (filter condition), 獲得【X】 (grant target),
  // or 持有【X】 (has-ability filter) are not timings/passives of this card itself
  const negatedKws = new Set(
    [...s.matchAll(/未持有【([^】]+)】/g)].map((m) => m[1]),
  );
  const grantedKws = new Set(
    [...s.matchAll(/獲得【([^】]+)】/g)].map((m) => m[1].split("：")[0]),
  );
  // Also capture or-chain keywords after 獲得【A】: 獲得【A】或【B】或【C】 → add B, C
  for (const m of s.matchAll(/獲得【[^】]+】((?:或【[^】]+】)+)/g)) {
    for (const om of m[1].matchAll(/【([^】]+)】/g)) {
      grantedKws.add(om[1].split("：")[0]);
    }
  }
  // EN: "gains [Keyword]" / "gains [Keyword] during this turn" — keyword is granted, not intrinsic
  for (const gm of s.matchAll(/gains \[([^\]]+)\]/g)) {
    grantedKws.add(gm[1]);
  }
  const allOwnedKws = new Set(
    [...s.matchAll(/持有【([^】]+)】/g)].map((m) => m[1]),
  );
  const ownedKws = new Set([...allOwnedKws].filter((k) => !negatedKws.has(k)));
  // Keywords inside 無法發動【X】 (opponent cannot activate X) are not this card's own passives
  const noActivateKws = new Set(
    [...s.matchAll(/無法發動【([^】]+)】/g)].map((m) => m[1]),
  );
  // Keywords inside 或【X】時 (opponent-OR trigger condition, e.g. "或【防禦】時") are not this card's own passives
  const orTimingKws = new Set(
    [...s.matchAll(/或【([^】]+)】時/g)].map((m) => m[1]),
  );
  // Keywords referenced in "的【X】效果無效" (naming which timing is negated, e.g. OP09-081) are not this card's own timings
  const effectNulledKws = new Set(
    [...s.matchAll(/的【([^】]+)】效果無效/g)].map((m) => m[1]),
  );
  const timings = keywords.filter(
    (k) => TIMING_KW.has(k) && !negatedKws.has(k) && !ownedKws.has(k) && !effectNulledKws.has(k),
  );
  // Detect body-text event triggers that appear outside 【】 brackets
  // "我方回合開始時" — leader cards write this as plain text (guard against duration form "開始前")
  if (s.includes("我方回合開始時") && !s.includes("我方回合開始前")) timings.push("我方回合開始時");
  if (s.includes("生命值卡離開時")) timings.push("生命值卡離開時");
  if (s.includes("生命值卡變成0張時")) timings.push("生命值卡變成0張時");
  if (s.includes("置為休息狀態時")) timings.push("置為休息狀態時");
  // "...角色卡遭到KO時，" — KO-watch trigger on a filtered set of own characters
  const koWatchM = s.match(/(.+?角色卡)遭到KO時[，,、]/);
  if (koWatchM) timings.push("KO時");
  // "受到傷害時或...角色卡遭到KO時" — dual OR condition; push both timings
  if (koWatchM && s.includes("受到傷害時或")) timings.push("受到傷害時");
  // "自己的「NAME」即將遭到KO時，" — named-card replacement effect (fires before the KO)
  const koWatchNameM = s.match(/自己的「([^」]+)」即將遭到KO時[，,]/);
  if (koWatchNameM) timings.push("KO替換時");
  // "這張角色卡即將離開場上時" — character self-leave-field replacement (KO, bounce, add-to-life, bottom-deck, etc.)
  if (s.includes("這張角色卡即將離開場上時")) timings.push("離場時");
  // Detect reactive DON!! return trigger: "N張以上...咚‼卡被放回咚‼卡組時，"
  // Handles both orderings: "N張以上自己場上的咚‼卡" and "自己場上N張以上的咚‼卡" (e.g. OP09-061)
  const donReturnTriggerM = s.match(
    /(?:(\d+)張以上自己場上|自己場上(\d+)張以上)的咚‼卡被放回咚‼卡組時[，,]/,
  );
  if (donReturnTriggerM) timings.push("咚‼卡被放回時");
  // "這張領航卡攻擊對手的領航卡時" — plain-text 攻擊時 variant on leader cards
  const leaderAttackLeaderM = s.includes("這張領航卡攻擊對手的領航卡時");
  if (leaderAttackLeaderM) timings.push("攻擊時");
  // "這張領航卡攻擊時或遭受攻擊時" — dual timing: fires when leader attacks OR is attacked (e.g. OP03-001)
  const leaderAttackOrBeAttackedM = s.includes("這張領航卡攻擊時或遭受攻擊時");
  if (leaderAttackOrBeAttackedM) { timings.push("攻擊時"); timings.push("對方攻擊時"); }
  // "造成對手生命值傷害時" — fires on the attacker when their card's attack deals damage to opponent's life (e.g. OP03-040 Nami, OP03-041)
  const dealDamageM = s.includes("造成對手生命值傷害時");
  if (dealDamageM) timings.push("造成傷害時");
  // "對手攻擊時" — body-text reactive trigger on opponent's attack (leader cards like OP09-001)
  if (s.includes("對手攻擊時")) timings.push("對方攻擊時");
  // "對手發動事件卡或【防禦】時" — opponent plays event card or uses Counter
  const opponentEventOrCounterM = s.includes("對手發動事件卡或");
  if (opponentEventOrCounterM) timings.push("對手發動事件卡或防禦時");
  // "對手使角色卡登場時" — when opponent plays a character (with optional cost/effect qualifier)
  let oppDeployTriggerCond = null;
  if (s.includes("對手使角色卡登場時") || (s.includes("對手使") && s.includes("角色卡登場時")) || s.includes("對手因角色卡的效果使角色卡登場時")) {
    timings.push("對手角色登場時");
    const deployTrigCostM = s.match(/對手使原本費用(\d+)以上的角色卡登場時/);
    const viaCharEff = s.includes("對手因角色卡的效果使角色卡登場時");
    if (deployTrigCostM || viaCharEff)
      oppDeployTriggerCond = { ...(deployTrigCostM && { costMin: Number(deployTrigCostM[1]) }), ...(viaCharEff && { orViaCharEffect: true }) };
  }
  // "角色卡因為自己的效果離開場上時" — when own char leaves by own effect
  if (s.includes("角色卡因為自己的效果離開場上時")) timings.push("自己角色效果離場時");
  // "自己場上的咚‼卡被放回咚‼卡組時" or "場上的咚‼卡被放回咚‼卡組時" or "因為自己的效果" variant — DON returned trigger (no count guard)
  if ((s.includes("自己場上的咚‼卡被放回咚‼卡組時") || s.includes("場上的咚‼卡被放回咚‼卡組時") || s.includes("自己場上的咚‼卡因為自己的效果被放回咚‼卡組時")) && !donReturnTriggerM) timings.push("咚‼卡被放回時");
  // "這張領航卡或自己的角色卡附加咚‼卡時" — when this leader or any friendly char is given a DON!!
  const donAttachTriggerM = s.includes("這張領航卡或自己的角色卡附加咚‼卡時");
  if (donAttachTriggerM) timings.push("咚‼附加時");
  // "使自己原本沒有效果的角色卡從手牌中登場時" — when player deploys a no-base-effect character from hand
  const selfDeployNoEffectM = s.includes("使自己原本沒有效果的角色卡從手牌中登場時");
  if (selfDeployNoEffectM) timings.push("自己使無效果角色卡登場時");
  // "自己的角色卡登場時" — when player deploys any character (leader reaction)
  const selfAnyCharDeployM = !selfDeployNoEffectM && s.includes("自己的角色卡登場時");
  if (selfAnyCharDeployM) timings.push("自己角色登場時");
  // "自己發動事件卡時" — when self plays event card
  if (s.includes("自己發動事件卡時")) timings.push("自己發動事件卡時");
  // "對手發動或事件卡時" — alternate phrasing for opponent event/counter
  if (s.includes("對手發動或事件卡時")) timings.push("對手發動事件卡或防禦時");
  const activated = keywords.filter((k) => ACTIVATED_KW.has(k));
  const continuous = keywords.filter((k) => CONTINUOUS_KW.has(k));
  const passive = keywords.filter((k) => {
    const base = k.split("：")[0];
    return (
      (PASSIVE_KW.has(k) || PASSIVE_KW.has(base)) &&
      !negatedKws.has(k) &&
      !grantedKws.has(k) &&
      !ownedKws.has(k) &&
      !noActivateKws.has(k) &&
      !orTimingKws.has(k)
    );
  });

  // Detect GRANT_KEYWORD: 獲得【keyword：restriction】 where the bracket is stripped from
  // rawActionText before parseSentence sees it — must be captured here.
  const grantKwActions = keywords
    .filter((k) => {
      const base = k.split("：")[0];
      return (
        PASSIVE_KW.has(base) && !PASSIVE_KW.has(k) && s.includes(`獲得【${k}】`)
      );
    })
    .map((k) => {
      const parts = k.split("：");
      return {
        type: "GRANT_KEYWORD",
        keyword: parts[0],
        restriction: parts[1] ?? null,
        until: s.includes("在這個回合") ? "turn" : null,
      };
    });

  // Or-chain CHOOSE_GRANT_KEYWORD: "...獲得【A】或【B】或【C】" — player picks one keyword to grant to self
  const grantOrChainM = s.match(/獲得【([^】]+)】((?:或【[^】]+】)+)/);
  const grantOrChainAction = (() => {
    if (!grantOrChainM) return null;
    const allKws = [
      grantOrChainM[1],
      ...[...grantOrChainM[2].matchAll(/【([^】]+)】/g)].map((m) => m[1]),
    ].map((k) => k.split("：")[0]);
    if (!allKws.every((k) => PASSIVE_KW.has(k))) return null;
    const until = s.includes("在這個回合")
      ? "turn"
      : s.includes("在下一個對手回合結束前")
        ? "opponent_turn_end"
        : null;
    return {
      type: "CHOOSE_GRANT_KEYWORD",
      keywords: allKws,
      filter: { self: true },
      until,
    };
  })();

  // 【咚‼×N】 → N+ DON!! must be attached to enable this effect
  const donGateM = s.match(/咚‼×(\d)/);
  const donGate = donGateM ? parseInt(donGateM[1]) : null;

  // 咚‼-N(...)：→ return N DON!! to DON!! deck as activation cost
  // Parenthetical "(可將自己場上的咚‼卡依指定的數量放回咚‼卡組)" is optional flavour text
  const donRetM = s.match(/咚‼-(\d+)(?:\([^)]+\))?[：:,，]/);
  const donReturn = donRetM ? parseInt(donRetM[1]) : null;
  // ②(...)： format — rest N DON!! in cost area (they refresh next turn; NOT returned to deck)
  const circledCostM = !donRetM ? s.match(/([①②③④⑤⑥⑦⑧⑨➀➁➂➃➄])\s*(?:\([^)]+\))?[：:,，]/) : null;
  const donRest = circledCostM ? circledCharToInt(circledCostM[1]) : null;
  // Minimum DON!! count for the reactive "被放回咚‼卡組時" trigger
  // Group 1 = count-first order ("N張以上自己場上"), group 2 = field-first order ("自己場上N張以上")
  const donReturnMinCount = donReturnTriggerM
    ? parseInt(donReturnTriggerM[1] ?? donReturnTriggerM[2])
    : null;

  // "因這張領航卡的效果而沒有抽卡片" = leader draw-once-per-turn semantics (e.g. OP01-062 Crocodile)
  const oncePerTurn = keywords.includes("每回合1次") || keywords.includes("Once Per Turn")
    || s.includes("因這張領航卡的效果而沒有抽卡片");
  const isReplacement = s.includes("替換成") || s.includes("即將");
  // Detect optional-cost pattern: 可/可以 appears before ：
  const colonPosRaw = s.indexOf("：");
  const isOptional =
    s.includes("可以") ||
    (colonPosRaw >= 0 && s.includes("可") && s.indexOf("可") < colonPosRaw);

  // Condition: 若...時[，,]
  const condM = s.match(/若(.+?)時[，,]/);
  const condition = condM ? parseCondition(condM[1]) : null;
  // "手牌在N張以下" — hand-size pre-condition outside the 若...時 brackets (e.g. OP01-062 Crocodile)
  const handMaxM = s.match(/手牌在(\d+)張以下/);
  if (handMaxM && condition) condition.handMax = parseInt(handMaxM[1]);

  // Build raw action text (before stripping condition).
  // Protect 【X】 brackets that appear inside filter conditions (未持有【X】, 獲得【X】)
  // so parseSentence can still read them after the global strip of section-header brackets.
  const rawActionText = s
    .replace(/未持有【([^】]+)】/g, "未持有￹$1￺") // protect negated-keyword filter
    .replace(/獲得【([^】]+)】/g, "獲得￹$1￺") // protect grant-keyword target
    .replace(/持有【([^】]+)】/g, "持有￹$1￺") // protect has-ability filter
    .replace(/或【([^】]+)】時/g, "或￹$1￺時") // protect OR-timing refs (e.g. "或【防禦】時")
    .replace(/【[^】]+】/g, "") // strip remaining section headers
    .replace(/未持有￹([^￺]+)￺/g, "未持有【$1】") // restore
    .replace(/獲得￹([^￺]+)￺/g, "獲得【$1】") // restore
    .replace(/持有￹([^￺]+)￺/g, "持有【$1】") // restore
    .replace(/或￹([^￺]+)￺時/g, "或【$1】時") // restore
    .replace(/咚‼-\d+(?:\([^)]+\))?[：:,，]/, "")
    .replace(/[①②③④⑤⑥⑦⑧⑨➀➁➂➃➄]\s*(?:\([^)]+\))?[：:]/, "")
    .replace(/^\//, "") // strip leading / from dual-timing syntax e.g. 【攻擊時】/【對方攻擊時】
    .replace(/可以/g, "")
    .trim();

  // Strip body-text timing phrases that are already captured in timings[] before
  // the pre/post condition split — otherwise the preamble lands in preCondActions
  // as an UNKNOWN action, consumes the once-per-turn lock, and blocks the real action.
  let strippedActionText = rawActionText;
  if (s.includes("我方回合開始時") && !s.includes("我方回合開始前"))
    strippedActionText = strippedActionText
      .replace(/我方回合開始時[，,]\s*可以發動[。]?\s*/, "")
      .trim();
  if (s.includes("生命值卡離開時"))
    strippedActionText = strippedActionText
      .replace(/生命值卡離開時[，,]\s*發動[。]?/, "")
      .trim();
  if (s.includes("生命值卡變成0張時"))
    strippedActionText = strippedActionText
      .replace(/自己的生命值卡變成0張時[，,]/, "")
      .trim();
  if (donReturnTriggerM)
    strippedActionText = strippedActionText
      .replace(/(?:\d+張以上自己場上|自己場上\d+張以上)的咚‼卡被放回咚‼卡組時[，,]/, "")
      .trim();
  if (s.includes("自己場上的咚‼卡被放回咚‼卡組時") || s.includes("場上的咚‼卡被放回咚‼卡組時") || s.includes("自己場上的咚‼卡因為自己的效果被放回咚‼卡組時"))
    strippedActionText = strippedActionText
      .replace(/(?:自己)?場上的咚‼卡因為自己的效果被放回咚‼卡組時[，,]\s*/, "")
      .replace(/(?:自己)?場上的咚‼卡被放回咚‼卡組時[，,]\s*/, "")
      .trim();
  if (donAttachTriggerM)
    strippedActionText = strippedActionText
      .replace(/這張領航卡或自己的角色卡附加咚‼卡時[，,]\s*/, "")
      .trim();
  if (selfDeployNoEffectM)
    strippedActionText = strippedActionText
      .replace(/使自己原本沒有效果的角色卡從手牌中登場時[，,]\s*/, "")
      .trim();
  if (selfAnyCharDeployM)
    strippedActionText = strippedActionText
      .replace(/自己的角色卡登場時[，,]\s*/, "")
      .trim();
  if (s.includes("置為休息狀態時"))
    strippedActionText = strippedActionText
      .replace(/這張角色卡置為休息狀態時[，,]/, "")
      .trim();
  if (koWatchM)
    strippedActionText = strippedActionText
      .replace(/^.+?角色卡遭到KO時[、,，](?:或因[^，。]+時[，,])?\s*(?:可以發動[。\s]*)?\s*/, "")
      .trim();
  if (leaderAttackLeaderM)
    strippedActionText = strippedActionText
      .replace(/這張領航卡攻擊對手的領航卡時[，,]\s*/, "")
      .trim();
  if (leaderAttackOrBeAttackedM)
    strippedActionText = strippedActionText
      .replace(/這張領航卡攻擊時或遭受攻擊時[，,]\s*/, "")
      .trim();
  if (dealDamageM)
    strippedActionText = strippedActionText
      .replace(/(?:因為這張(?:領航卡|角色卡)的攻擊，而)?造成對手生命值傷害時[，,]\s*/, "")
      .trim();
  if (opponentEventOrCounterM)
    strippedActionText = strippedActionText
      .replace(/對手發動事件卡或【防禦】時[，,]\s*/, "")
      .trim();

  // If the entire action text (after keyword stripping) is a parenthetical, it's a rule
  // clarification note — e.g. "(若這張卡片造成傷害時，觸發器不會發動且...)" on Banish cards.
  // But if the block carries passive keywords (e.g. 【速攻：角色】), keep the clause.
  if (strippedActionText.startsWith("(") && strippedActionText.endsWith(")")) {
    if (passive.length === 0) return null;
    strippedActionText = "";
  }

  // Detect mid-block condition: condition appears after some unconditional content.
  // When found, split into preCondActions (no condition) + postCondActions (with condition)
  // so that unconditional actions like ATTACH_DON aren't skipped when the condition fails.
  let preCondActions = [];
  let preCondText = "";
  let actionText = strippedActionText;
  if (condM) {
    const condIdx = strippedActionText.indexOf(condM[0]);
    if (condIdx > 0) {
      const preText = strippedActionText
        .slice(0, condIdx)
        .replace(/[之後，,\s]+$/, "")
        .trim();
      preCondText = preText;
      if (preText) {
        // Activation-cost pattern: "COST：REVEAL" — split at "：" so they parse as separate actions.
        if (preText.includes("：")) {
          const ci = preText.indexOf("：");
          preCondActions = [
            ...parseSentences(preText.slice(0, ci).trim()),
            ...parseSentences(preText.slice(ci + 1).trim()),
          ];
        } else {
          preCondActions = parseSentences(preText);
        }
      }
      actionText = strippedActionText.slice(condIdx + condM[0].length).trim();
    } else {
      actionText = strippedActionText.replace(condM[0], "").trim();
    }
  }

  // Build post-condition actions, handling optional cost (：) split.
  // Find the first ： that is outside 【】 brackets — colons inside bracket names
  // (e.g. 【速攻：角色】) are part of keyword qualifiers, not cost separators.
  const colonIdx = (() => {
    let depth = 0;
    for (let i = 0; i < actionText.length; i++) {
      const ch = actionText[i];
      if (ch === "【") depth++;
      else if (ch === "】") depth--;
      else if (ch === "：" && depth === 0) return i;
    }
    return -1;
  })();
  let postCondActions;
  if (colonIdx >= 0) {
    const costText = actionText.slice(0, colonIdx).trim();
    const effectText = actionText.slice(colonIdx + 1).trim();
    const costParsed = parseSentences(costText);
    const effectParsed = parseSentences(effectText);
    if (isOptional && costText) {
      postCondActions = [
        { type: "CONFIRM_OPTIONAL_ACTIVATION", costDescription: costText },
        ...costParsed,
        ...effectParsed,
      ];
    } else {
      postCondActions = [...costParsed, ...effectParsed];
    }
  } else {
    postCondActions = parseSentences(actionText);
  }

  if (grantKwActions.length) {
    const existingKws = new Set(
      postCondActions
        .filter((a) => a.type === "GRANT_KEYWORD")
        .map((a) => a.keyword),
    );
    postCondActions = [
      ...postCondActions,
      ...grantKwActions.filter((a) => !existingKws.has(a.keyword)),
    ];
  }
  if (grantOrChainAction) {
    // Remove any single GRANT_KEYWORD that parseSentence picked up for the first option in the chain
    postCondActions = postCondActions.filter(
      (a) =>
        !(
          a.type === "GRANT_KEYWORD" &&
          a.filter?.self &&
          grantOrChainAction.keywords.includes(a.keyword)
        ),
    );
    postCondActions = [...postCondActions, grantOrChainAction];
  }

  // Build koFilter from the captured text, stripping keyword brackets and any cost preamble
  // that appears before '：' (e.g. "可以廢棄2張自己的手牌：對手的角色卡" → "對手的角色卡").
  let _koFilterRaw = koWatchM ? koWatchM[1].replace(/【[^】]+】/g, "").trim() : "";
  if (_koFilterRaw.includes("：")) _koFilterRaw = _koFilterRaw.split("：").pop().trim();
  const koFilter = koWatchM
    ? parseCardFilter(_koFilterRaw)
    : koWatchNameM
      ? parseCardFilter(`自己的「${koWatchNameM[1]}」`)
      : null;

  // If the text before the KO trigger contains an optional discard cost ("可以廢棄N張自己的手牌："),
  // record it so we can prepend CONFIRM_OPTIONAL_ACTIVATION + DISCARD to the final actions.
  let koWatchDiscardCost = null;
  if (koWatchM) {
    const _preCostRaw = koWatchM[1].replace(/【[^】]+】/g, "").trim();
    if (_preCostRaw.includes("：")) {
      const _costPart = _preCostRaw.split("：")[0].trim();
      const _discardM = _costPart.match(/廢棄(\d+)張自己的手牌/);
      if (_discardM) koWatchDiscardCost = parseInt(_discardM[1]);
    }
  }

  const baseClause = {
    timings: [...timings, ...activated],
    continuous,
    passive,
    donGate,
    donReturn,
    donRest,
    donReturnMinCount,
    oncePerTurn,
    isReplacement,
    isOptional,
    koFilter,
    oppDeployTriggerCond,
    raw: s,
  };

  // 若...發動...事件卡時 — convert to a REGISTER_ON_EVENT_TRIGGER action so the engine
  // registers a per-turn watcher instead of performing a static condition check.
  if (condition?.subject === "event_play") {
    const triggerFilter = { category: "Event" };
    if (condition.cost !== undefined) {
      triggerFilter.cost = condition.cost;
      triggerFilter.costOp = condition.costOp;
    }
    return {
      ...baseClause,
      condition: null,
      conditionRaw: condM?.[0] ?? null,
      actions: [
        {
          type: "REGISTER_ON_EVENT_TRIGGER",
          filter: triggerFilter,
          triggerActions: postCondActions,
        },
      ],
    };
  }

  // "選擇X → 若選擇的卡片攻擊時 → 對手無法發動【防禦】": merge the blocker ban into the
  // POWER_MOD as grantKeyword so the engine can apply it to whichever target was chosen.
  if (
    condM?.[1] === "選擇的卡片攻擊" &&
    preCondActions.some((a) => a.type === "POWER_MOD") &&
    postCondActions.some((a) => a.type === "BLOCK_EFFECT")
  ) {
    const mergedPre = preCondActions.map((a) =>
      a.type === "POWER_MOD" ? { ...a, grantKeyword: "防禦不可" } : a,
    );
    return {
      ...baseClause,
      condition: null,
      conditionRaw: null,
      actions: mergedPre,
    };
  }

  // For activated abilities (啟動主要/起動メイン), the pre-condition actions are the
  // unconditional part of the effect. Merging them into one clause (sharing effectKey)
  // prevents double activation tracking. The conditional tail is wrapped in a CONDITIONAL
  // action so only that part is gated by the condition at runtime.
  if (
    preCondActions.length > 0 &&
    baseClause.timings.length > 0 &&
    baseClause.timings.every((t) => t === "啟動主要" || t === "起動メイン")
  ) {
    // If the conditional body text contains "。之後，" and the tail (after the break)
    // parses exclusively to DRAW actions, the tail is unconditional — it always fires
    // when the activated effect is used, regardless of whether the condition was met.
    // Example: "若life≤2，KO費用4以下。之後，抽1張卡片。" → KO is conditional, DRAW is not.
    // Only split on DRAW tails to avoid affecting search/reveal cleanup patterns
    // (e.g. "。之後，將其餘卡片放到卡組下面") which remain inside the conditional.
    let conditionalBody = postCondActions;
    let unconditionalDrawTail = [];
    if (condition && actionText) {
      const tailBreak = actionText.match(/。之後[，,]/);
      if (tailBreak) {
        const tailText = actionText.slice(tailBreak.index + tailBreak[0].length).trim();
        const tailActions = parseSentences(tailText);
        if (tailActions.length > 0 && tailActions.every((a) => a.type === "DRAW")) {
          const condBodyText = actionText.slice(0, tailBreak.index + 1).trim();
          conditionalBody = parseSentences(condBodyText);
          unconditionalDrawTail = tailActions;
        }
      }
    }
    const conditionalTail =
      condition && conditionalBody.length > 0
        ? [{ type: "CONDITIONAL", condition, actions: conditionalBody }]
        : conditionalBody;
    return {
      ...baseClause,
      condition: null,
      conditionRaw: condM?.[0] ?? null,
      actions: [...preCondActions, ...conditionalTail, ...unconditionalDrawTail],
    };
  }

  // "可以DISCARD。若有執行此動作時，EFFECT" — optional discard with conditional follow-up.
  // e.g. OP15-020: "可以廢棄2張手牌。若有執行此動作時，KO最多1張對手力量值0以下的角色卡"
  // Unconditional actions (power mods etc.) fire first; CONFIRM_OPTIONAL_ACTIVATION gates
  // the discard + effect. If player skips, both discard and follow-up are dropped.
  if (
    isOptional &&
    condM?.[1]?.includes("執行此動作") &&
    preCondActions.length > 0 &&
    postCondActions.length > 0
  ) {
    let discardIdx = -1;
    for (let i = preCondActions.length - 1; i >= 0; i--) {
      if (preCondActions[i].type === "DISCARD") {
        discardIdx = i;
        break;
      }
    }
    if (discardIdx >= 0) {
      const before = preCondActions.slice(0, discardIdx);
      const discardAction = preCondActions[discardIdx];
      const after = preCondActions.slice(discardIdx + 1);
      return {
        ...baseClause,
        condition: null,
        conditionRaw: condM?.[0] ?? null,
        actions: [
          ...before,
          {
            type: "CONFIRM_OPTIONAL_ACTIVATION",
            costDescription: `廢棄${discardAction.count}張手牌`,
          },
          discardAction,
          ...after,
          ...postCondActions,
        ],
      };
    }
  }

  // "選擇最多N張對手休息狀態的角色卡。若選擇的角色卡費用與已附加在該角色卡的咚‼卡張數一樣時，KO該張角色卡"
  // → single CONDITIONAL_KO: player picks from opponent's rested chars; KO fires only if cost == attachedDon
  if (
    preCondActions.length > 0 &&
    /選擇最多\d+張對手休息狀態的角色卡/.test(preCondText) &&
    condM?.[1]?.includes('選擇的角色卡費用與已附加在該角色卡的咚‼卡張數一樣')
  ) {
    const countM = preCondText.match(/選擇最多(\d+)張/);
    return {
      ...baseClause,
      condition: null,
      conditionRaw: condM?.[0] ?? null,
      actions: [{
        type: 'CONDITIONAL_KO',
        filter: { owner: 'opponent', category: 'Character', state: 'rest' },
        count: countM ? parseInt(countM[1]) : 1,
        condition: 'costEqualsDon',
      }],
    };
  }

  // If there are pre-condition actions, check whether this is an "optional cost: conditional
  // effect" pattern (可以COST：若CONDITION，EFFECT). The colon marks the activation cost, so
  // the whole block must be a single clause gated by CONFIRM_OPTIONAL_ACTIVATION — otherwise
  // the player could get the conditional effect without paying the cost.
  if (preCondActions.length > 0) {
    if (isOptional && condition && preCondText.endsWith("：")) {
      const costDesc = preCondText.slice(0, -1).trim();
      const conditionalTail =
        postCondActions.length > 0
          ? [{ type: "CONDITIONAL", condition, actions: postCondActions }]
          : [];
      return {
        ...baseClause,
        condition: null,
        conditionRaw: condM?.[0] ?? null,
        actions: [
          { type: "CONFIRM_OPTIONAL_ACTIVATION", costDescription: costDesc, ...(donReturn ? { donReturn } : {}) },
          ...preCondActions,
          ...conditionalTail,
        ],
      };
    }
    // "ACTION → 若該張角色卡的力量值在N以下時，即KO該張角色卡"
    // "該張" = "that card" (the selected target), not self. The condition prefix was
    // stripped before parseSentence saw "即KO該張角色卡", causing it to mis-fire as
    // SELF_KO. Re-emit the KO as a proper KO action with a power filter instead.
    const condPowerKoM = condition?.raw?.match(/該張角色卡的力量值在(\d+)以下/);
    if (condPowerKoM && postCondActions.length === 1 && postCondActions[0].type === 'SELF_KO') {
      return [
        {
          ...baseClause,
          condition: null,
          conditionRaw: null,
          actions: preCondActions,
        },
        {
          ...baseClause,
          condition: null,
          conditionRaw: condM?.[0] ?? null,
          actions: [{
            type: 'KO',
            count: 1,
            filter: {
              owner: 'opponent',
              zone: 'field',
              category: 'Character',
              power: parseInt(condPowerKoM[1]),
              powerOp: 'lte',
            },
          }],
        },
      ];
    }

    // "選擇最多N張...角色卡，並KO → 若CONDITION → 替換成費用M以下的角色卡"
    // Collapse into one clause with a CONDITIONAL KO so the base and upgraded cost thresholds
    // are mutually exclusive (not both applied when the condition is met).
    const preSelectKoM = preCondText.match(/選擇最多(\d+)張(對手[^，]+角色卡)，並KO/);
    if (preSelectKoM && actionText.includes('替換成對手費用') && actionText.includes('以下的角色卡')) {
      const postReplaceM = actionText.match(/替換成(對手費用\d+以下的角色卡)/);
      if (postReplaceM) {
        const baseFilter = parseCardFilter(preSelectKoM[2]);
        const upgradedFilter = parseCardFilter(postReplaceM[1]);
        const count = parseInt(preSelectKoM[1]);
        return {
          ...baseClause,
          condition: null,
          conditionRaw: condM?.[0] ?? null,
          isReplacement: false,
          actions: [{
            type: 'CONDITIONAL',
            condition,
            actions: [{ type: 'KO', count, filter: upgradedFilter }],
            elseActions: [{ type: 'KO', count, filter: baseFilter }],
          }],
        };
      }
    }

    // Default: emit two clauses so the engine runs the unconditional part regardless
    // of whether the condition is satisfied.
    return [
      {
        ...baseClause,
        condition: null,
        conditionRaw: null,
        actions: preCondActions,
      },
      {
        ...baseClause,
        condition,
        conditionRaw: condM?.[0] ?? null,
        actions: postCondActions,
      },
    ];
  }

  const finalActions = koWatchDiscardCost
    ? [
        { type: "CONFIRM_OPTIONAL_ACTIVATION", costDescription: `廢棄${koWatchDiscardCost}張手牌` },
        { type: "DISCARD", count: koWatchDiscardCost, filter: { owner: "self", zone: "hand" } },
        ...postCondActions,
      ]
    : postCondActions;

  // FIRE_MAIN_EFFECT timing injection: 【xxx】 brackets are stripped before parseSentence sees
  // the text, so recover the target timing from this clause's timings or activated keywords
  // (e.g. ['觸發器','登場時'] → '登場時'; activated ['主要'] → '主要').
  const injectFireTiming = (actions) => actions.map(a => {
    if (a.type !== 'FIRE_MAIN_EFFECT' || a.timing) return a;
    const target = [...timings, ...activated].find(t => t !== '觸發器');
    return target ? { ...a, timing: target } : a;
  });

  return {
    ...baseClause,
    condition,
    conditionRaw: condM?.[0] ?? null,
    actions: injectFireTiming(finalActions),
  };
}

// ─── Condition Parser ─────────────────────────────────────────────────────────

function parseCondition(text) {
  const c = { raw: text };

  // "該張卡片是費用N的「NAME」" — the last revealed life card
  const revealedCardM = text.match(/該張卡片是費用(\d+)的「([^」]+)」/);
  if (revealedCardM)
    return { raw: text, subject: "lastRevealedCard", cost: parseInt(revealedCardM[1]), name: revealedCardM[2] };

  if (text.includes("自己")) c.owner = "self";
  else if (text.includes("對手") || text.includes("對方")) c.owner = "opponent";

  // Bare "登場" — "if the preceding deploy actually happened" (若登場時，...)
  if (text.trim() === "登場") {
    return { raw: text, subject: "lastDeployed" };
  }

  if (text.includes("發動") && text.includes("事件卡")) {
    // "發動原本費用N以上的事件卡" — reactive event-play trigger condition
    c.subject = "event_play";
    const costM2 = text.match(/費用(\d+)(以下|以上)/);
    if (costM2) {
      c.cost = parseInt(costM2[1]);
      c.costOp = costM2[2] === "以上" ? "gte" : "lte";
    }
  } else if (text.includes("領航卡")) {
    c.subject = "leader";
    if (text.includes("多種顏色")) c.multiColor = true;
    // Compound: "自己的領航卡有多種顏色、對手的場上有N張以上咚‼卡"
    const oppDonM = text.match(/對手的場上有(\d+)張以上咚‼/);
    if (oppDonM) c.oppDonField = { count: parseInt(oppDonM[1]), countOp: "gte" };
  } else if (text.includes("這張角色卡登場的回合")) {
    c.subject = "self_justDeployed";
  } else if (text.includes("角色卡")) {
    c.subject = "characters";
    if (text.includes("休息狀態")) c.rested = true;
    const compoundCostM = text.match(/費用(\d+)或(\d+)(以上|以下)/);
    if (compoundCostM) {
      c.costAlts = [
        { op: "eq", val: parseInt(compoundCostM[1]) },
        {
          op: compoundCostM[3] === "以上" ? "gte" : "lte",
          val: parseInt(compoundCostM[2]),
        },
      ];
    } else {
      const costM3 = text.match(/費用(\d+)(以下|以上)/);
      if (costM3) {
        c.cost = parseInt(costM3[1]);
        c.costOp = costM3[2] === "以上" ? "gte" : "lte";
      } else {
        // Exact cost: "費用N" without direction qualifier (e.g. "費用0的角色卡")
        const exactCostM = text.match(/費用(\d+)的/);
        if (exactCostM) {
          c.cost = parseInt(exactCostM[1]);
          c.costOp = "lte"; // lte 0 == exact 0 for non-negative costs; for higher values treat as eq via lte+gte
        }
      }
    }
  } else if (text.includes("場上") && text.includes("咚‼")) {
    c.subject = "don_field";
    const donFieldCountM = text.match(/有(\d+)張/);
    if (donFieldCountM) { c.count = parseInt(donFieldCountM[1]); c.countOp = "gte"; }
    if (text.includes("對手場上") && (text.includes("少於等於") || text.includes("以下")))
      c.compareToOppDon = true;
  } else if (text.includes("咚‼")) {
    c.subject = "don";
    if (text.includes("活動狀態")) c.state = "active";
  } else if (text.includes("生命值") && text.includes("手牌") && text.includes("合計")) c.subject = "lifeAndHand";
  else if (text.includes("生命值")) c.subject = "life";
  else if (text.includes("手牌")) c.subject = "hand";
  else if (
    text.includes("休息狀態") &&
    text.includes("卡片") &&
    !text.includes("角色卡")
  ) {
    // "自己休息狀態的卡片有N張以上" — all field cards (leader + chars + stage + DON!!)
    c.subject = "rested_field_cards";
    c.rested = true;
  } else if (text.includes("廢棄區")) {
    c.subject = "trash";
    if (text.includes("事件卡")) c.category = "Event";
    else if (text.includes("角色卡")) c.category = "Character";
  } else if (text.includes("卡組")) {
    c.subject = "deck";
    const deckCountM = text.match(/卡組(\d+)張/);
    if (deckCountM) {
      c.count = parseInt(deckCountM[1]);
      c.countOp = "eq";
    }
  }

  // Bare count with no zone keyword — sub-clause of a trash-count conditional header
  // ("若有N張以上時" without repeating "廢棄區"). In OPTCG this pattern exclusively
  // means the owner's trash pile count.
  if (!c.subject && /有\d+張(以上|以下)/.test(text)) c.subject = "trash";
  if (!c.subject && text.includes("場上") && !text.includes("咚‼"))
    c.subject = "characters";

  // Turn number: "第N回合之後的回合" — own turn N or later
  const turnMinM = text.match(/第(\d+)回合之後的回合/);
  if (turnMinM) {
    c.subject = "my_turn_count";
    c.turnMin = parseInt(turnMinM[1]);
  }

  const allTraitMs = [...text.matchAll(/[《『]([^》』]+)[》』]/g)];
  if (allTraitMs.length === 1) {
    c.trait = allTraitMs[0][1];
  } else if (allTraitMs.length > 1) {
    // OR condition: "《A》或《B》特徵" — store all as array
    c.traits = allTraitMs.map((m) => m[1]);
  }
  // "場上沒有自己其他的角色卡「NAME」" — extract before name matching so the
  // name is not also stored in c.name (which would be misread as a leader name check)
  const noOtherM = text.match(/沒有(?:自己其他的角色卡|其他的)「([^」]+)」/);
  if (noOtherM) c.noOther = noOtherM[1];
  const noOtherNames = noOtherM ? new Set([noOtherM[1]]) : new Set();
  const allNameMs = [...text.matchAll(/「([^」]+)」/g)].filter(
    (m) => !noOtherNames.has(m[1]),
  );
  if (allNameMs.length === 1) c.name = allNameMs[0][1];
  else if (allNameMs.length > 1) c.names = allNameMs.map((m) => m[1]);

  const attrMap = {
    斬: "Slash",
    打: "Strike",
    射: "Ranged",
    特: "Special",
    知: "Wisdom",
  };
  const attrCondM = text.match(/\(([^)]+)\)屬性/);
  if (attrCondM && attrMap[attrCondM[1]]) c.attribute = attrMap[attrCondM[1]];

  // Compound "= 0 OR ≥ N" form (e.g. "為0張、或有3張以上") — must check before generic regexes
  const zeroOrGteM = text.match(/為(\d+)張[、,]?(?:或是?(?:自己的場上)?(?:有)?)?(\d+)張以上/);
  if (zeroOrGteM && zeroOrGteM[1] === "0") {
    c.count = parseInt(zeroOrGteM[2]);
    c.countOp = "zeroOrGte";
  }

  // Count comparison: 在N張以下/以上 or 有N張以上
  const cntM = !zeroOrGteM && text.match(/(?:在|有)(\d+)張(以下|以上)/);
  if (cntM) {
    c.count = parseInt(cntM[1]);
    c.countOp = cntM[2] === "以上" ? "gte" : "lte";
  }
  // "沒有N張" — "fewer than N" treated as at most N-1
  const noneCountM = !zeroOrGteM && !cntM && text.match(/沒有(\d+)張/);
  if (noneCountM) {
    c.count = parseInt(noneCountM[1]) - 1;
    c.countOp = "lte";
  }
  // "為N張" — exact count (e.g. "若自己的生命值卡為0張時")
  const exactCountM = !zeroOrGteM && !cntM && !noneCountM && text.match(/為(\d+)張/);
  if (exactCountM) {
    c.count = parseInt(exactCountM[1]);
    c.countOp = "eq";
  }

  // Power threshold: 力量值N以上/以下 (e.g. "對手力量值8000以上的角色卡")
  const powerThreshM = text.match(/力量值(\d+)(以下|以上)/);
  if (powerThreshM) {
    c.power = parseInt(powerThreshM[1]);
    c.powerOp = powerThreshM[2] === "以上" ? "gte" : "lte";
  } else {
    // Exact power match: 力量值N (no 以上/以下 qualifier)
    const powerExactM = text.match(/力量值(\d+)/);
    if (powerExactM) {
      c.power = parseInt(powerExactM[1]);
      c.powerOp = "eq";
    }
  }

  if (text.includes("只有")) c.predicate = "only";
  else if (text.includes("擁有")) c.predicate = "has";
  else if (text.includes("沒有")) c.predicate = "none";

  return c;
}

// ─── Action Parser ────────────────────────────────────────────────────────────

function parseSentences(text) {
  // Merge "選擇對手休息的領航卡和最多N張角色卡。選擇的卡片在下一個對手的重整階段無法為活動狀態"
  // into a single sentence so parseSentence can emit both REFRESH_LOCKs atomically.
  text = text.replace(
    /選擇對手休息的領航卡和最多(\d+)張角色卡。選擇的卡片在下一個對手的重整階段無法為活動狀態/,
    (_, n) => `選擇對手休息的領航卡和最多${n}張角色卡在下一個對手的重整階段無法為活動狀態`,
  );
  return text
    .split(/[。；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      // "公開...手牌...，並以...加入生命值區" — keep as one sentence so ADD_TO_LIFE can see source zone
      if (s.includes("公開") && s.includes("手牌") && s.includes("生命值區")) {
        return [s];
      }
      // ADD_DON + SEARCH compound: "從咚‼卡組追加...，並從...查看N張..."
      // The general 查看 guard below would keep this whole string as one sentence,
      // corrupting the SEARCH filter with DON!! tokens from the first clause.
      if (s.includes("咚‼卡組追加") && s.includes("查看")) {
        const parts = s
          .split(/，並(?=從自己的卡組(?:上面)?查看)/)
          .map((p) => p.trim())
          .filter(Boolean);
        if (parts.length >= 2) return parts;
      }
      // Split compound action chains joined by ，並 (e.g. "抽2張，並廢棄1張")
      // but NOT search sentences where ，並加入手牌 is part of the SEARCH result description
      if (s.includes("，並") && !s.includes("查看")) {
        // Also split on ，再 before 將卡組洗牌 so "並X，再將卡組洗牌" emits SHUFFLE_DECK
        const sep = s.includes("，再將卡組洗牌")
          ? /，(?:並|再(?=將卡組洗牌))/
          : /，並/;
        return s
          .split(sep)
          .map((p) => p.trim())
          .filter(Boolean);
      }
      // REST + 該張角色卡 REFRESH_LOCK: keep as one sentence so parseSentence can fold
      // the lock into the REST action and apply it to the same specific character.
      // Split "廢棄N張...，將...置為休息狀態" compound cost (discard + self-rest)
      // so the DISCARD action is not swallowed by the REST regex.
      // Handles both ，將 and 、將 as cost separators.
      if (
        s.includes("廢棄") &&
        (s.includes("，將") || s.includes("、將")) &&
        s.includes("置為休息狀態")
      ) {
        return s
          .split(/[，、](?=將)/)
          .map((p) => p.trim())
          .filter(Boolean);
      }
      // Split "抽N張，將N張...生命值區...廢棄" (draw + trash life) compound joined by ，將
      if (
        s.includes("，將") &&
        s.includes("生命值區") &&
        (s.includes("廢棄") || s.includes("廢棄區"))
      ) {
        return s
          .split(/，(?=將)/)
          .map((p) => p.trim())
          .filter(Boolean);
      }
      // Split "原本的力量值變更成N、費用+N" compound (power-set + cost-mod joined by 、)
      if (s.includes("原本的力量值變更成") && s.includes("、費用")) {
        return s
          .split(/、(?=費用)/)
          .map((p) => p.trim())
          .filter(Boolean);
      }
      // Split "獲得【keyword】、費用+N" compound (grant-keyword + cost-mod joined by 、)
      if (s.includes("獲得【") && s.includes("】、費用")) {
        return s
          .split(/、(?=費用)/)
          .map((p) => p.trim())
          .filter(Boolean);
      }
      // Split "獲得【keyword】、力量值+N" compound (grant-keyword + power-mod joined by 、)
      // e.g. "這張角色卡獲得【防禦】、力量值+2000"
      if (s.includes("獲得【") && s.includes("】、力量值")) {
        return s
          .split(/、(?=力量值)/)
          .map((p) => p.trim())
          .filter(Boolean);
      }
      // Split two distinct POWER_MODs on different targets joined by 、
      // e.g. "自己的領航卡...力量值+3000、最多1張對手的角色卡...力量值-8000"
      if (
        s.includes("、") &&
        (s.match(/力量值[+＋\-－]\d+/g) ?? []).length >= 2
      ) {
        const parts = s
          .split("、")
          .map((p) => p.trim())
          .filter(Boolean);
        if (
          parts.length >= 2 &&
          parts.every((p) => /力量值[+＋\-－]\d+/.test(p))
        ) {
          return parts;
        }
      }
      // Strip circled-number DON rest explanation annotations (e.g. "➁(可將費用區...置為休息狀態),")
      // These are mechanical footnote markers on the card, not actionable sentences.
      const circledAnnotM = s.match(/^[①②③④⑤⑥⑦⑧⑨➀➁➂➃➄]\s*(?:\([^)]+\))[，,]?\s*/);
      if (circledAnnotM) {
        const stripped = s.slice(circledAnnotM[0].length).trim();
        return stripped ? [stripped] : [];
      }
      // Split "抽N張...，最多N張...在這個回合，獲得【keyword】" into DRAW + GRANT_KEYWORD.
      // The DRAW regex fires on the whole sentence and swallows the grant-keyword clause.
      if (s.includes("在這個回合，獲得【") && /抽\d+張/.test(s) && /，最多\d+張/.test(s)) {
        const parts = s.split(/，(?=最多\d+張)/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) return parts;
      }
      // Split "將N張...卡組上面...廢棄區，使最多N張...登場" into DECK_TO_TRASH + DEPLOY.
      // Without this, the DEPLOY regex fires first on the whole compound sentence and
      // the mill step is silently dropped.
      if (/將\d+張.*卡組上面.*廢棄/.test(s) && /，使.+登場/.test(s)) {
        const parts = s.split(/，(?=使.+登場)/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) return parts;
      }
      // Split "...卡組下面，使...登場" into BOTTOM_DECK + DEPLOY.
      // Without this, the DEPLOY regex fires first and the BOTTOM_DECK step is dropped.
      if (/卡組下面/.test(s) && /，使.+登場/.test(s)) {
        const parts = s.split(/，(?=使.+登場)/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) return parts;
      }
      return [s];
    })
    .flatMap((s) => {
      const r = parseSentence(s);
      return Array.isArray(r) ? r : r ? [r] : [];
    })
    .reduce((acc, action) => {
      // Merge SELECT_LEADER_AND_CHAR + SWAP_BASE_POWER: leader is fixed, player picks 1 character.
      if (
        acc.length > 0 &&
        acc[acc.length - 1].type === "SELECT_LEADER_AND_CHAR" &&
        action.type === "SWAP_BASE_POWER"
      ) {
        acc[acc.length - 1] = { ...action, leaderTarget: true };
      // Merge SELECT_TARGET + SWAP_BASE_POWER: pass the filter and count through to the swap action.
      } else if (
        acc.length > 0 &&
        acc[acc.length - 1].type === "SELECT_TARGET" &&
        action.type === "SWAP_BASE_POWER"
      ) {
        const prev = acc[acc.length - 1];
        acc[acc.length - 1] = { ...action, filter: prev.filter, count: prev.count };
      } else {
        acc.push(action);
      }
      return acc;
    }, []);
}

function parseSentence(s) {
  // Replacement-effect sentences ("抽X張...則替換成...") are not yet implemented.
  // Return null so the base draw is not double-fired by the trailing 則替換成 branch.
  if (s.includes("則替換成")) return null;

  // Strip leading "之後，" / "之後，在這個回合，" sequential connectors (grammatical only, no semantic content)
  s = s.replace(/^之後[，,]\s*/, "").trim();

  // Strip "若有執行此動作時" conditional prefix and mark resulting action
  const conditionalOnPrev = s.includes("若有執行此動作時");
  if (conditionalOnPrev) s = s.replace(/^若有執行此動作時[，,]?\s*/, "").trim();

  // "若自己的手牌在N張以下時，ACTION" — hand-size guard inside a CHOOSE_ONE option.
  // parseSentence normally strips the prefix and loses the condition; wrap in CONDITIONAL_EXEC instead.
  const handCondM = s.match(/^若自己的手牌在(\d+)張以下時[，,]\s*/);
  if (handCondM) {
    const limit = parseInt(handCondM[1]);
    const inner = parseSentence(s.slice(handCondM[0].length).trim());
    if (inner) return { type: "CONDITIONAL_EXEC", condition: { subject: "hand", count: limit, countOp: "lte" }, actions: [inner] };
  }

  // DISCARD_DRAW_COMPENSATION — leader passive: draw equal to cards discarded by a trait card's effect
  // e.g. OP12-040: 因自己擁有《海軍》特徵的卡片效果而廢棄自己手牌中的卡片時，抽取與廢棄卡片相同數量的卡片
  const discardCompM = s.match(
    /因自己擁有《(.+?)》特徵的卡片效果而廢棄自己手牌中的卡片時，抽取與廢棄卡片相同數量的卡片/,
  );
  if (discardCompM)
    return { type: "DISCARD_DRAW_COMPENSATION", trait: discardCompM[1] };

  // DRAW
  const drawM = s.match(/抽(\d+)?張/);
  if (drawM) return { type: "DRAW", count: parseInt(drawM[1] ?? "1") };

  // SELF_DEPLOY_FROM_TRASH — "使這張角色卡從廢棄區中登場" / "以休息狀態登場"
  const selfDeployTrashM = s.match(
    /使這張角色卡從廢棄區(以休息狀態)?(?:中)?登場/,
  );
  if (selfDeployTrashM)
    return {
      type: "SELF_DEPLOY_FROM_TRASH",
      deployState: selfDeployTrashM[1] ? "rest" : "active",
    };

  // SELF_DEPLOY (trigger: this card deploys itself)
  if (s.includes("使這張卡片登場") || s.includes("使這張卡進場"))
    return { type: "SELF_DEPLOY" };

  // DUAL DEPLOY from trash — "使...費用N以下和費用M的...最多各K張登場"
  // e.g. "使自己廢棄區中擁有包含『B・W』特徵、費用4以下和費用1的角色卡最多各1張登場"
  const dualTrashDeployM = s.match(
    /使(.+?廢棄區.+?)費用(\d+)(以下)?和費用(\d+)(的.+?)?最多各(\d+)張登場/,
  );
  if (dualTrashDeployM) {
    const base = dualTrashDeployM[1]; // "自己廢棄區中擁有包含『B・W』特徵、"
    const cost1 = dualTrashDeployM[2]; // "4"
    const op1 = dualTrashDeployM[3] ?? ""; // "以下" or ""
    const cost2 = dualTrashDeployM[4]; // "1"
    const suffix = dualTrashDeployM[5] ?? ""; // "的角色卡"
    const count = parseInt(dualTrashDeployM[6]); // 1
    return [
      {
        type: "DEPLOY",
        count,
        filter: parseCardFilter(base + "費用" + cost1 + op1 + suffix),
      },
      {
        type: "DEPLOY",
        count,
        filter: parseCardFilter(base + "費用" + cost2 + suffix),
      },
    ];
  }

  // Compound: "將...角色卡全數放置在廢棄區、並使最多N張...登場" — KO all own characters first, then deploy from trash
  const fullKoThenDeployM = s.match(
    /將(.+角色卡)全數放置在廢棄區[、，,]並使最多(\d+)?張(.+?)(?:的卡片)?登場/,
  );
  if (fullKoThenDeployM)
    return [
      {
        type: "KO",
        count: Infinity,
        filter: parseCardFilter(fullKoThenDeployM[1]),
      },
      {
        type: "DEPLOY",
        count: parseInt(fullKoThenDeployM[2] ?? "1"),
        filter: parseCardFilter(fullKoThenDeployM[3]),
      },
    ];

  // DEPLOY from hand
  const deployM = s.match(/使最多(\d+)?張(.+?)(?:的卡片)?登場/);
  if (deployM) {
    const deployFilter = parseCardFilter(deployM[2]);
    if (deployM[2].includes("不同顏色")) deployFilter.differentColorFromLastReturned = true;
    return { type: "DEPLOY", count: parseInt(deployM[1] ?? "1"), filter: deployFilter };
  }

  // KO
  const koAllM = s.match(/KO全數(.+)/);
  if (koAllM)
    return { type: "KO", count: Infinity, filter: parseCardFilter(koAllM[1]) };
  const koM = s.match(/KO最多(\d+)?張(.+)/);
  if (koM)
    return {
      type: "KO",
      count: parseInt(koM[1] ?? "1"),
      filter: parseCardFilter(koM[2]),
    };
  const koExactM = s.match(/KO(\d+)張(.+)/);
  if (koExactM)
    return {
      type: "KO",
      count: parseInt(koExactM[1]),
      filter: parseCardFilter(koExactM[2]),
    };

  // Conditional KO based on the target's cost — "若該張角色卡的費用在N以下時，即KO該張角色卡"
  // "That card" refers to the character targeted by the preceding action (e.g. NULL_EFFECT).
  // Approximated as KO 1 opponent field character with cost ≤ N.
  const condKoCostM = s.match(
    /若該張角色卡的費用在(\d+)以下時[，,]即KO該張角色卡/,
  );
  if (condKoCostM)
    return {
      type: "KO",
      count: 1,
      filter: {
        owner: "opponent",
        zone: "field",
        category: "Character",
        costMax: parseInt(condKoCostM[1]),
      },
    };

  // Deferred opponent DON!! rest: "在下一個對手主要階段開始時，對手將N張...咚‼卡置為休息狀態"
  const deferredDonRestM = s.match(
    /在下一個對手主要階段開始時[，,]對手將(\d+)張.+?咚‼卡置為休息狀態/,
  );
  if (deferredDonRestM) {
    return {
      type: "OPPONENT_DON_REST_DEFERRED",
      count: parseInt(deferredDonRestM[1]),
    };
  }

  // GRANT_KEYWORD (named chars + self) — "自己全數的「X」和這張角色卡獲得【keyword】"
  // Must come before selfGrantM because selfGrantM also matches this pattern (it contains 這張).
  const grantNameSelfM = s.match(
    /自己全數的「([^」]+)」和這張(?:角色卡|卡片)[^。]*?獲得【([^】]+)】/,
  );
  if (grantNameSelfM) {
    const kwFull = grantNameSelfM[2];
    const kwBase = kwFull.split("：")[0];
    if (PASSIVE_KW.has(kwFull) || PASSIVE_KW.has(kwBase)) {
      const restriction = kwFull.includes("：") ? kwFull.split("：")[1] : null;
      const until = s.includes("在這個回合") ? "turn" : null;
      return [
        {
          type: "GRANT_KEYWORD",
          keyword: kwBase,
          restriction,
          filter: { category: "Character", name: grantNameSelfM[1] },
          until,
        },
        {
          type: "GRANT_KEYWORD",
          keyword: kwBase,
          restriction,
          filter: { self: true },
          until,
        },
      ];
    }
  }

  // Self GRANT_KEYWORD: "這張角色卡獲得【keyword】" or "這張角色卡，在這個回合，獲得【keyword：restriction】"
  const selfGrantM = s.match(/這張(?:角色卡|卡片)?[^。]*?獲得【([^】]+)】/);
  if (selfGrantM) {
    const kwFull = selfGrantM[1];
    const kwBase = kwFull.split("：")[0];
    if (PASSIVE_KW.has(kwFull) || PASSIVE_KW.has(kwBase)) {
      return {
        type: "GRANT_KEYWORD",
        keyword: kwBase,
        restriction: kwFull.includes("：") ? kwFull.split("：")[1] : null,
        filter: { self: true },
        until: s.includes("在這個回合")
          ? "turn"
          : s.includes("在下一個對手回合結束前") || s.includes("在下一個對手結束階段結束前")
            ? "opponent_turn_end"
            : null,
      };
    }
  }

  // Compound DON!! rest + self-rest: "將N張...咚‼卡和這張角色卡置為休息狀態" (DON first)
  // Must be checked before the general REST regex (which would merge both into one filter).
  const compoundDonSelfRestM = s.match(
    /將(\d+)張(.+?咚‼卡)和這張(?:角色)?卡置為休息狀態/,
  );
  if (compoundDonSelfRestM) {
    return [
      {
        type: "REST",
        count: parseInt(compoundDonSelfRestM[1]),
        filter: parseCardFilter(compoundDonSelfRestM[2]),
      },
      { type: "REST", count: 1, filter: { self: true } },
    ];
  }

  // Compound self-rest + DON!! rest: "將這張卡片和N張...咚‼卡置為休息狀態"
  // Must be checked before the general REST regex (which would merge both into one filter).
  const compoundSelfDonRestM = s.match(/將這張卡片和(\d+)張(.+?)置為休息狀態/);
  if (compoundSelfDonRestM) {
    return [
      { type: "REST", count: 1, filter: { self: true } },
      {
        type: "REST",
        count: parseInt(compoundSelfDonRestM[1]),
        filter: parseCardFilter(compoundSelfDonRestM[2]),
      },
    ];
  }

  // REST + REFRESH_LOCK combined: "將...置為休息狀態，該張角色卡在下一個(對手的)重整階段無法為活動狀態"
  // Fold the lock into the REST action so the exact same character that is rested gets locked
  // (not all currently-rested characters).
  if (s.includes("置為休息狀態") && s.includes("該張角色卡") && s.includes("重整階段無法為活動狀態")) {
    const restLockM = s.match(/將(.+?)置為休息狀態，該張角色卡在下一個(?:對手的)?重整階段無法為活動狀態/);
    if (restLockM) {
      const sub = restLockM[1];
      const cntM = sub.match(/^(\d+)張/) ?? sub.match(/(?:合計)?最多(\d+)張/);
      const count = sub.includes("任意張數") ? Infinity : (cntM ? parseInt(cntM[1]) : 1);
      return { type: "REST", count, filter: parseCardFilter(sub), lockNextRefresh: true };
    }
  }

  // REST (global match handles compound costs like "rest DON!! AND rest this card")
  const restMatches = [...s.matchAll(/將(.+?)置為休息狀態/g)];
  if (restMatches.length) {
    const acts = restMatches.map((m) => {
      const cntM = m[1].match(/^(\d+)張/) ?? m[1].match(/(?:合計)?最多(\d+)張/);
      const count = m[1].includes("任意張數")
        ? Infinity
        : cntM
          ? parseInt(cntM[1])
          : 1;
      return {
        type: "REST",
        count,
        filter: parseCardFilter(m[1]),
        ...(s.startsWith("可") ? { isOptional: true } : {}),
      };
    });
    return acts.length === 1 ? acts[0] : acts;
  }

  // ATTACK_LOCK — opponent characters cannot attack until end of next opponent end phase
  const attackLockM = s.match(
    /最多(\d+)?張(.+?)在下一個對手結束階段結束前，無法進行攻擊/,
  );
  if (attackLockM) {
    const count = attackLockM[1] ? parseInt(attackLockM[1]) : 1;
    return {
      type: "ATTACK_LOCK",
      count,
      filter: parseCardFilter(attackLockM[2].replace(/[，,]\s*$/, "")),
    };
  }

  // ATTACK_LOCK this turn — "最多N張對手活動狀態的角色卡，在這個回合，無法進行攻擊"
  const attackLockThisTurnM = s.match(
    /最多(\d+)?張(.+?)[，,]在這個回合[，,]無法進行攻擊/,
  );
  if (attackLockThisTurnM)
    return {
      type: "ATTACK_LOCK",
      count: attackLockThisTurnM[1] ? parseInt(attackLockThisTurnM[1]) : 1,
      filter: parseCardFilter(attackLockThisTurnM[2].replace(/[，,]\s*$/, "")),
      until: "turn",
    };

  // ATTACK_LOCK this turn (selected) — "被選擇的角色卡，在這個回合，無法進行攻擊"
  if (s.includes("被選擇的角色卡") && s.includes("在這個回合") && s.includes("無法進行攻擊"))
    return { type: "ATTACK_LOCK", count: 1, filter: { owner: "opponent", category: "Character" }, until: "turn" };

  // ATTACK_LOCK selected — "在下一個對手回合結束前，被選擇的角色卡無法進行攻擊"
  if (s.includes("被選擇的角色卡") && s.includes("無法進行攻擊"))
    return { type: "ATTACK_LOCK", count: 1, filter: { owner: "opponent", category: "Character" }, until: "nextOppTurn" };

  // ATTACK_LOCK until own turn start — "最多N張對手費用N以下的角色卡，到下一個我方回合開始前，無法進行攻擊"
  const attackLockOwnTurnStartM = s.match(
    /最多(\d+)?張(.+?)到下一個我方回合開始前[，,]?無法進行攻擊/,
  );
  if (attackLockOwnTurnStartM)
    return {
      type: "ATTACK_LOCK",
      count: attackLockOwnTurnStartM[1] ? parseInt(attackLockOwnTurnStartM[1]) : 1,
      filter: parseCardFilter(attackLockOwnTurnStartM[2].replace(/[，,]\s*$/, "")),
      until: "startOfOwnTurn",
    };

  // ATTACK_LOCK cost-range chars (e.g. cost 2 and cost 3 cannot attack) — return NULL_EFFECT (no contiguous range filter)
  if (/費用\d+和\d+的角色卡全數[，,]無法進行攻擊/.test(s))
    return { type: "NULL_EFFECT" };

  // PREVENT_REST — opponent's characters cannot be rested until end of opponent's next turn
  const preventRestM = s.match(
    /最多(\d+)?張(.+?)在下一個(?:對手結束階段結束前|對手回合結束前)，無法置為休息狀態/,
  );
  if (preventRestM) {
    const count = preventRestM[1] ? parseInt(preventRestM[1]) : 1;
    return {
      type: "PREVENT_REST",
      count,
      filter: parseCardFilter(preventRestM[2].replace(/[，,]\s*$/, "")),
    };
  }

  // REFRESH_LOCK — "該張角色卡在下一個...重整階段無法為活動狀態"
  // "That character" refers to the one just rested by a preceding REST action.
  // Filter by state:'rest' so the lock applies to whichever character was rested.
  if (/^該張角色卡在下一個(?:對手的)?重整階段無法為活動狀態/.test(s)) {
    return {
      type: "REFRESH_LOCK",
      count: Infinity,
      filter: { owner: "opponent", category: "Character", state: "rest" },
    };
  }

  // REFRESH_LOCK — opponent's rested characters cannot become active in next opponent refresh phase
  // "全數" variant: all matching targets (no player choice)
  // REFRESH_LOCK compound (Foxy-style): merged sentence from parseSentences pre-processing.
  // "選擇對手休息的領航卡和最多N張角色卡在下一個對手的重整階段無法為活動狀態"
  // → auto-lock rested leader + player picks up to N opponent characters.
  const foxyLockM = s.match(/選擇對手休息的領航卡和最多(\d+)張角色卡在下一個對手的重整階段無法為活動狀態/);
  if (foxyLockM)
    return [
      { type: "REFRESH_LOCK", count: 1, filter: { owner: "opponent", includesLeader: true, state: "rest" } },
      { type: "REFRESH_LOCK", count: parseInt(foxyLockM[1]), filter: { owner: "opponent", category: "Character" } },
    ];

  const refreshLockAllM = s.match(
    /(.+?)全數[，,]在下一個對手的重整階段無法為活動狀態/,
  );
  if (refreshLockAllM) {
    return {
      type: "REFRESH_LOCK",
      count: Infinity,
      filter: parseCardFilter(refreshLockAllM[1].replace(/[，,]\s*$/, "")),
    };
  }
  // "最多N張" variant: player chooses up to N targets
  const refreshLockM = s.match(
    /最多(\d+)?張(.+?)在下一個(?:對手的)?重整階段無法為活動狀態/,
  );
  if (refreshLockM) {
    const count = refreshLockM[1] ? parseInt(refreshLockM[1]) : 1;
    return {
      type: "REFRESH_LOCK",
      count,
      filter: parseCardFilter(refreshLockM[2].replace(/[，,]\s*$/, "")),
    };
  }

  // UNREST all own chars with trait at end of this turn — "這個回合結束時，自己擁有《X》特徵的角色卡全數，置為活動狀態"
  const eotUnrestAllM = s.match(/這個?回合結束時[，,](.+?角色卡全數)[，,]置為活動狀態/);
  if (eotUnrestAllM)
    return { type: "UNREST", count: Infinity, filter: parseCardFilter(eotUnrestAllM[1]) };

  // REFRESH_LOCK on self — "這張角色卡，在下一個自己的重整階段無法為活動狀態"
  if (s.includes("這張角色卡") && s.includes("在下一個自己的重整階段無法為活動狀態"))
    return { type: "REFRESH_LOCK", count: 1, filter: { self: true } };

  // REFRESH_LOCK for both sides — "費用N以下的角色卡全數，在雙方的重整階段無法為活動狀態"
  if (s.includes("雙方的重整階段無法為活動狀態")) {
    const filterM = s.match(/^(.+?)全數[，,]/);
    return { type: "REFRESH_LOCK", count: Infinity, filter: filterM ? parseCardFilter(filterM[1]) : {} };
  }

  // REFRESH_LOCK on selected cards — "選擇的角色卡，在下一個自己的重整階段無法為活動狀態"
  if (s.includes("選擇的角色卡") && s.includes("重整階段無法為活動狀態"))
    return { type: "REFRESH_LOCK", count: Infinity, filter: { owner: "self", category: "Character" } };

  // REFRESH_LOCK on previously selected targets — "選擇的卡片在下一個對手的重整階段無法為活動狀態"
  if (s.includes("選擇的卡片") && s.includes("重整階段無法為活動狀態"))
    return { type: "REFRESH_LOCK", count: Infinity, filter: { owner: "opponent" } };

  // UNREST_DON deferred to end of this turn: "這回合結束時，將最多N張...咚‼卡置為活動狀態"
  if (
    s.startsWith("這回合結束時") &&
    /將最多(\d+)?張.{0,6}咚‼.{0,4}置為活動狀態/.test(s)
  ) {
    const cntM = s.match(/最多(\d+)?張/);
    return {
      type: "UNREST_DON_END_OF_TURN",
      count: parseInt(cntM?.[1] ?? "1"),
    };
  }

  // UNREST_DON — set rested DON!! cards in cost area to active
  // "全數" variant: activate ALL rested DON!! (no player choice)
  if (/將.{0,6}咚‼.{0,4}全數置為活動狀態/.test(s)) {
    return { type: "UNREST_DON", count: null };
  }
  const unrestDonM = s.match(/將最多(\d+)?張.{0,6}咚‼.{0,4}置為活動狀態/);
  if (unrestDonM) {
    const cntM = s.match(/最多(\d+)?張/);
    return { type: "UNREST_DON", count: parseInt(cntM?.[1] ?? "1") };
  }

  // LOCK_DON_UNREST_BY_CHAR — "使用角色卡的效果無法將咚‼卡置為活動狀態"
  if (/無法將.{0,8}咚‼.{0,4}置為活動狀態/.test(s) && s.includes("角色卡")) {
    return { type: "LOCK_DON_UNREST_BY_CHAR" };
  }

  // UNREST field card
  const unrestM = s.match(/將(.+?)置為活動狀態/);
  if (unrestM) {
    // Split compound targets joined by 和 (e.g. "1張CharacterCard和1張DON!!card，置為活動狀態")
    const targets = unrestM[1]
      .split(/和(?=最多)/)
      .map((t) => t.replace(/[，。]\s*$/, "").trim());
    if (targets.length > 1) {
      return targets.map((t) => {
        if (/咚‼/.test(t)) {
          const cntM = t.match(/最多(\d+)?張/);
          return { type: "UNREST_DON", count: parseInt(cntM?.[1] ?? "1") };
        }
        const cntM = t.match(/最多(\d+)?張/);
        return {
          type: "UNREST",
          count: cntM ? parseInt(cntM[1] ?? "1") : 1,
          filter: parseCardFilter(t),
        };
      });
    }
    const cntM = unrestM[1].match(/最多(\d+)?張/);
    const count = cntM ? parseInt(cntM[1] ?? "1") : 1;
    const unrestAction = { type: "UNREST", count, filter: parseCardFilter(unrestM[1]) };
    // "置為活動狀態、且...在下一個對手回合結束前，獲得【KEYWORD】" — grant keyword to the chosen target
    const trailText = s.slice((unrestM.index ?? 0) + unrestM[0].length);
    const trailKwM = trailText.match(/獲得【([^】]+)】/);
    if (trailKwM) {
      unrestAction.grantKeywords = [trailKwM[1]];
      unrestAction.grantKeywordUntil = (trailText.includes("在下一個對手回合結束前") || trailText.includes("下一個對手結束")) ? "opponent_turn_end" : "turn";
    }
    // "且該張卡片，在這個回合，力量值+N" — power boost to the unrested card this turn
    const trailPowerM = trailText.match(/力量值[+＋](\d+)/);
    if (trailPowerM) {
      unrestAction.powerMod = { delta: parseInt(trailPowerM[1]), until: "turn" };
    }
    return unrestAction;
  }

  // POWER_MOD_BY_LIFE_COST — "公開的卡片每有費用N，...力量值+M" — must be checked before POWER_MOD
  // e.g. OP15-119: "公開的卡片每有費用1，這張角色卡，在這個回合，力量值+1000"
  if (
    s.includes("公開的卡片") &&
    s.includes("每有費用") &&
    s.includes("力量值")
  ) {
    const perCostM = s.match(/每有費用(\d+)/);
    const amtM = s.match(/力量值[+＋](\d+)/);
    if (perCostM && amtM)
      return {
        type: "POWER_MOD_BY_LIFE_COST",
        perCost: parseInt(perCostM[1]),
        amountPerCost: parseInt(amtM[1]),
        until: s.includes("在這場對戰中") ? "battle" : "turn",
      };
  }

  // POWER_MOD_PER_DON_RESTED — "每有N張...咚‼卡，TARGET，在這場對戰中，力量值+M" — must be checked before POWER_MOD
  // e.g. OP13-001: "每有1張休息狀態的咚‼卡，這張領航卡或最多1張擁有《草帽一行人》特徵的角色卡，在這場對戰中，力量值+2000"
  if (s.includes("每有") && s.includes("咚‼") && s.includes("力量值")) {
    const perDonM = s.match(
      /每有(\d+)張[^，]*咚‼[^，]*[，,](.+?)[，,]在這場對戰中[，,]力量值([+＋\-－]\d+)/,
    );
    if (perDonM) {
      const perDon = parseInt(perDonM[1]);
      const delta = parseInt(perDonM[3].replace("＋", "+").replace("－", "-"));
      const targetText = perDonM[2];
      const traitM = targetText.match(/擁有《([^》]+)》特徵/);
      return {
        type: "POWER_MOD_PER_DON_RESTED",
        perDon,
        delta,
        until: "battle",
        filter: {
          owner: "self",
          ...(targetText.includes("角色卡") ? { category: "Character" } : {}),
          ...(targetText.includes("領航卡") ? { includesLeader: true } : {}),
          ...(traitM ? { trait: traitM[1] } : {}),
        },
      };
    }
  }

  // POWER_PER_DISCARD — "每廢棄1張卡片，力量值+N" — must be checked before POWER_MOD
  if (s.includes("每廢棄") && s.includes("力量值")) {
    const perM = s.match(/力量值[+＋](\d+)/);
    if (perM)
      return {
        type: "POWER_PER_DISCARD",
        delta: parseInt(perM[1]),
        until: s.includes("在這場對戰中") ? "battle" : "turn",
      };
  }

  // COST_MOD — "最多N張...費用M以下/以上...，...費用±K"
  // Handles targets where the filter contains 以下/以上, which blocks the generic COST_MOD guard.
  const filteredCostModM = s.match(
    /最多(\d+)?張(.+?費用\d+(?:以上|以下).+?)，(?:[^，]*，)?費用([+＋\-－]\d+)/,
  );
  if (filteredCostModM) {
    const rawDelta = filteredCostModM[3].replace("＋", "+").replace("－", "-");
    const until = s.includes("在這個回合") ? "turn"
      : s.includes("在這場對戰中") ? "battle"
      : s.includes("在下一個對手回合結束前") ? "opponent_turn_end"
      : "continuous";
    return {
      type: "COST_MOD",
      delta: parseInt(rawDelta),
      until,
      count: filteredCostModM[1] ? parseInt(filteredCostModM[1]) : 1,
      filter: parseCardFilter(filteredCostModM[2].trim()),
    };
  }

  // COST_MOD (board-wide) — "對手的角色卡全數費用-N" / "自己費用N以上擁有《X》特徵的角色卡全數費用+N"
  // parseCardFilter handles costMin/costMax from 以上/以下 inside the filter text.
  const costModAllM = s.match(/^(.+?)全數費用([+＋\-－]\d+)/);
  if (costModAllM) {
    const rawDelta = costModAllM[2].replace("＋", "+").replace("－", "-");
    const delta = parseInt(rawDelta);
    const until = s.includes("在這個回合")
      ? "turn"
      : s.includes("在這場對戰中")
        ? "battle"
        : "continuous";
    return {
      type: "COST_MOD",
      delta,
      until,
      count: Infinity,
      filter: parseCardFilter(costModAllM[1].trim()),
    };
  }

  // COST_MOD — e.g. "最多1張自己的角色卡，在下一個對手回合結束前，費用+2"
  const costM = s.match(/費用([+＋\-－]\d+)/);
  if (costM && !s.includes("以下") && !s.includes("以上")) {
    const rawDelta = costM[1].replace("＋", "+").replace("－", "-");
    const delta = parseInt(rawDelta);
    const until = s.includes("在這個回合")
      ? "turn"
      : s.includes("在這場對戰中")
        ? "battle"
        : s.includes("在下一個對手回合結束前")
          ? "opponent_turn_end"
          : "continuous";
    const tgtM = s.match(/最多(\d+)?張(.+?)(?:，在|的費用|費用)/);
    const filterText = tgtM ? tgtM[2] : null;
    const count = tgtM?.[1] ? parseInt(tgtM[1]) : 1;
    return {
      type: "COST_MOD",
      delta,
      until,
      count,
      filter: filterText ? parseCardFilter(filterText) : { self: true },
    };
  }

  // COPY_POWER_FROM_TARGET — "這張角色卡原本的力量值，在這個回合，變成和選擇的角色卡的力量值相同"
  // Used after SELECT_TARGET; sets this card's base power equal to the selected target's power for the turn.
  if (
    s.includes("原本的力量值") &&
    s.includes("變成和選擇的角色卡的力量值相同")
  )
    return {
      type: "COPY_POWER_FROM_TARGET",
      until: s.includes("在這個回合") ? "turn" : null,
    };

  // SWAP_BASE_POWER — "在這個回合，交換選擇的角色卡的原本力量值"
  // Used after SELECT_TARGET count=2; swaps base power of the two selected characters for the turn.
  if (s.includes("交換選擇的角色卡的原本力量值"))
    return { type: "SWAP_BASE_POWER", until: "turn" };

  // SET_BASE_POWER opponent-turn only — "在對方的回合，自己的領航卡原本的力量值變更成N"
  const setLeaderPowerOppTurnM = s.match(
    /在對方的回合[，,]自己的領航卡原本的力量值變更成(\d+)/,
  );
  if (setLeaderPowerOppTurnM)
    return {
      type: "SET_BASE_POWER",
      value: parseInt(setLeaderPowerOppTurnM[1]),
      filter: { category: "Leader" },
      opponentTurnOnly: true,
    };

  // SET_BASE_POWER — "自己擁有《X》特徵的領航卡，原本的力量值變更成N"
  const setBasePowerM = s.match(
    /自己擁有《([^》]+)》特徵的領航卡，原本的力量值變更成(\d+)/,
  );
  if (setBasePowerM)
    return {
      type: "SET_BASE_POWER",
      value: parseInt(setBasePowerM[2]),
      filter: { category: "Leader", trait: setBasePowerM[1] },
    };

  // SET_BASE_POWER (characters) — "自己擁有《X》特徵的角色卡全數原本的力量值變更成N"
  const setBaseCharPowerM = s.match(
    /自己擁有《([^》]+)》特徵的角色卡全數原本的力量值變更成(\d+)/,
  );
  if (setBaseCharPowerM)
    return {
      type: "SET_BASE_POWER",
      value: parseInt(setBaseCharPowerM[2]),
      filter: { category: "Character", trait: setBaseCharPowerM[1] },
    };

  // SET_BASE_POWER (self only) — "這張角色卡原本的力量值變更成N"
  const setSelfBasePowerM = s.match(/^這張角色卡原本的力量值變更成(\d+)$/);
  if (setSelfBasePowerM)
    return {
      type: "SET_BASE_POWER",
      value: parseInt(setSelfBasePowerM[1]),
      filter: { self: true },
    };

  // SET_BASE_POWER (named chars + self) — "自己全數的「X」和這張角色卡，原本的力量值變更成N"
  const setBaseNameSelfM = s.match(
    /自己全數的「([^」]+)」和這張角色卡[，,]原本的力量值變更成(\d+)/,
  );
  if (setBaseNameSelfM)
    return [
      {
        type: "SET_BASE_POWER",
        value: parseInt(setBaseNameSelfM[2]),
        filter: { category: "Character", name: setBaseNameSelfM[1] },
      },
      {
        type: "SET_BASE_POWER",
        value: parseInt(setBaseNameSelfM[2]),
        filter: { category: "Character", self: true },
      },
    ];

  // POWER_SET_ZERO — "最多N張{filter}，在這個回合，力量值減至0"
  const powerZeroM = s.match(/力量值減至0/);
  if (powerZeroM) {
    const tgtM = s.match(/最多(\d+)?張(.+?)(?:，在|的力量)/);
    const filterText = tgtM ? tgtM[2] : null;
    return {
      type: "POWER_MOD",
      setToZero: true,
      until: s.includes("在這個回合") ? "turn" : "continuous",
      count: tgtM ? parseInt(tgtM[1] ?? "1") : 1,
      filter: filterText ? parseCardFilter(filterText) : { self: true },
    };
  }

  // POWER_MOD dual target — "自己的「NAME」和自己擁有《TRAIT》特徵的角色卡全數，TIME，力量值+N"
  // 「NAME」 includes leader and character (includesLeader:true); 角色卡全數 is Character only.
  const powerModDualM = s.match(
    /^自己的「([^」]+)」和自己擁有《([^》]+)》特徵的角色卡全數[，,].+?力量值([+\-＋－]\d+)/,
  );
  if (powerModDualM) {
    const name = powerModDualM[1];
    const trait = powerModDualM[2];
    const delta = parseInt(
      powerModDualM[3].replace("＋", "+").replace("－", "-"),
    );
    const until = s.includes("在這個回合")
      ? "turn"
      : s.includes("在這場對戰中")
        ? "battle"
        : s.includes("在下一個對手回合結束前") ||
            s.includes("在下一個對手結束階段結束前") ||
            s.includes("到下一個我方回合開始前")
          ? "opponent_turn_end"
          : "continuous";
    return [
      {
        type: "POWER_MOD",
        delta,
        until,
        count: Infinity,
        filter: { owner: "self", name, includesLeader: true },
      },
      {
        type: "POWER_MOD",
        delta,
        until,
        count: Infinity,
        filter: { owner: "self", category: "Character", trait },
      },
    ];
  }

  // Leader named-target: grant keyword + power mod in one sentence
  // e.g. "自己的領航卡「魯西」，在這個回合，獲得【雙重攻擊】，力量值+3000"
  const leaderNameGrantPowerM = s.match(
    /^((?:自己|對手|對方)的?領航卡「([^」]+)」)，在這個回合，獲得【([^】]+)】，力量值([+＋\-－]\d+)/,
  );
  if (leaderNameGrantPowerM) {
    const filter = parseCardFilter(leaderNameGrantPowerM[1]);
    const keyword = leaderNameGrantPowerM[3];
    const delta = parseInt(
      leaderNameGrantPowerM[4].replace("＋", "+").replace("－", "-"),
    );
    return [
      { type: "GRANT_KEYWORD", keyword, filter, until: "turn" },
      { type: "POWER_MOD", delta, until: "turn", filter },
    ];
  }

  // POWER_MOD scaled by trash size — "廢棄區中每有N張卡片，...力量值+M"
  // e.g. OP09-086: "自己廢棄區中每有4張卡片，這張角色卡，力量值+1000"
  if (s.includes("廢棄區中每有") && s.includes("力量值")) {
    const perTrashM = s.match(/廢棄區中每有(\d+)張卡片/);
    const amtM = s.match(/力量值([+＋\-－]\d+)/);
    if (perTrashM && amtM) {
      const delta = parseInt(amtM[1].replace("＋", "+").replace("－", "-"));
      return {
        type: "POWER_MOD",
        delta,
        until: "continuous",
        filter: { self: true },
        perTrashCount: parseInt(perTrashM[1]),
      };
    }
  }

  // POWER_MOD_PER_SELF_DON — "每附加N張咚‼卡在該張角色卡，TARGET，力量值±M"
  // e.g. OP15-008: per DON!! attached to this card, all opponent characters get -1000 this turn
  if (s.includes("每附加") && s.includes("咚‼") && s.includes("該張角色卡") && s.includes("力量值")) {
    const perDonM = s.match(/每附加(\d+)張咚‼卡在該張角色卡/);
    const deltaM = s.match(/力量值([+\-＋－]\d+)/);
    if (perDonM && deltaM) {
      const perDon = parseInt(perDonM[1]);
      const delta = parseInt(deltaM[1].replace("＋", "+").replace("－", "-"));
      const until = s.includes("在這個回合") ? "turn" : s.includes("在這場對戰中") ? "battle" : "continuous";
      const allTgtM = s.match(/，(.+?全數)[，,]/);
      return {
        type: "POWER_MOD_PER_SELF_DON",
        perDon,
        delta,
        until,
        filter: allTgtM ? parseCardFilter(allTgtM[1]) : { owner: "opponent", category: "Character" },
      };
    }
  }

  // Replacement effect that targets the owner's leader — "替換成自己的領航卡，在這個回合，力量值-N"
  // e.g. OP14-016: opponent's turn substitution that gives leader -2000 instead of removing a character
  const leaderReplacementPmM = s.match(/替換成(?:自己的?)?領航卡，在這個回合，力量值([+\-＋－]\d+)/);
  if (leaderReplacementPmM) {
    const delta = parseInt(leaderReplacementPmM[1].replace("＋", "+").replace("－", "-"));
    return { type: "POWER_MOD", delta, until: "turn", filter: { includesLeader: true, owner: "self" } };
  }

  // POWER_MOD — e.g. "這張角色卡的力量值+3000" or "最多1張對手的角色卡…力量值-1000"
  // Also matches full-width ＋／－ (e.g. "力量值＋3000")
  const powerM = s.match(/力量值([+\-＋－]\d+)/);
  if (powerM) {
    const delta = parseInt(powerM[1].replace("＋", "+").replace("－", "-"));
    const until = s.includes("在這個回合")
      ? "turn"
      : s.includes("在這場對戰中")
        ? "battle"
        : s.includes("在下一個對手回合結束前") ||
            s.includes("在下一個對手結束階段結束前") ||
            s.includes("到下一個我方回合開始前")
          ? "opponent_turn_end"
          : "continuous";
    const tgtM = s.match(/最多(\d+)?張(.+?)(?:，在|的力量|力量值)/);
    // Detect "all" target first: "對手的角色卡全數" or "自己的領航卡和角色卡全數" (no 最多X張 prefix)
    const allTgtM = !tgtM ? s.match(/^(.+?全數)/) : null;
    // Detect explicit leader target without 最多 prefix, e.g. "自己的領航卡，在這場對戰中"
    const leaderTgtM =
      !tgtM && !allTgtM ? s.match(/^((?:自己|對手|對方)的?領航卡)/) : null;
    const filterText = tgtM
      ? tgtM[2]
      : allTgtM
        ? allTgtM[1]
        : leaderTgtM
          ? leaderTgtM[1]
          : null;
    const pmFilter = filterText ? parseCardFilter(filterText) : { self: true };
    // A name-only filter (「NAME」 with no category) targets any card with that name,
    // including the leader — mirror the explicit includesLeader:true used in the dual-target path.
    if ((pmFilter.name || pmFilter.names) && !pmFilter.category) pmFilter.includesLeader = true;
    return {
      type: "POWER_MOD",
      delta,
      until,
      filter: pmFilter,
      ...(allTgtM ? { count: Infinity } : tgtM?.[1] ? { count: parseInt(tgtM[1]) } : {}),
      ...(conditionalOnPrev ? { conditionalOnPrev: true } : {}),
    };
  }

  // REORDER — look at top N cards, arrange, put back on top OR bottom (no cards taken)
  const reorderM = s.match(/查看(\d+)張/);
  if (reorderM && s.includes("上面或下面") && !s.includes("加入手牌")) {
    return {
      type: "SEARCH",
      look: parseInt(reorderM[1]),
      take: 0,
      reorder: true,
      canPlaceOnTop: true,
      filter: {},
    };
  }

  // SEARCH top N of deck
  const searchM = s.match(/查看(\d+)張/);
  if (searchM) {
    const takeM = s.match(/最多(\d+)?張/);
    return {
      type: "SEARCH",
      look: parseInt(searchM[1]),
      take: parseInt(takeM?.[1] ?? "1"),
      filter: parseCardFilter(s),
      ...(s.includes("公開") ? { reveal: true } : {}),
      ...(s.includes("加入生命值區") ? { destination: 'life', faceUp: true } : {}),
    };
  }

  // DISCARD_EQUAL_TO_DRAW — "依抽取的卡片張數廢棄自己的手牌"
  if (s.includes("依抽取的卡片張數") && s.includes("廢棄")) {
    return {
      type: "DISCARD_EQUAL_TO_DRAW",
      filter: { owner: "self", zone: "hand" },
    };
  }

  // DISCARD any number (任意張數) — must be checked before fixed-count DISCARD
  if (s.includes("任意張數") && s.includes("廢棄")) {
    return { type: "DISCARD_FREE", filter: parseCardFilter(s) };
  }

  // DISCARD from hand
  const discardM = s.match(/廢棄(?:最多)?(\d+)?張/);
  if (discardM)
    return {
      type: "DISCARD",
      count: parseInt(discardM[1] ?? "1"),
      ...(s.includes("最多") ? { isOptional: true } : {}),
      filter: parseCardFilter(s),
    };

  // LIFE_TO_HAND — must be checked before ADD_TO_HAND (both match 加入手牌)
  // Also matches "加入持有者的手牌" where the owner marker sits between 加入 and 手牌
  if (
    s.includes("生命值區") &&
    (s.includes("加入手牌") || s.includes("持有者的手牌"))
  ) {
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)?張/);
    const targetOwner =
      s.includes("對手") || s.includes("對方") ? "opponent" : "self";
    return {
      type: "LIFE_TO_HAND",
      count: parseInt(cntM?.[1] ?? "1"),
      targetOwner,
      ...(s.includes("上面或下面") ? { choosePosition: true } : {}),
      ...(s.includes("可") ? { isOptional: true } : {}),
      ...(conditionalOnPrev ? { conditionalOnPrev: true } : {}),
    };
  }

  // TRASH_TO_LIFE_OR_FIELD — "將最多N張...廢棄區中...角色卡，以正面朝上加入生命值區上面或使其登場"
  const trashToLifeOrFieldM = s.match(
    /將最多(\d+)?張(.+?)，以正面朝上加入生命值區上面或使其登場/,
  );
  if (trashToLifeOrFieldM)
    return {
      type: "TRASH_TO_LIFE_OR_FIELD",
      count: parseInt(trashToLifeOrFieldM[1] ?? "1"),
      filter: parseCardFilter(trashToLifeOrFieldM[2]),
      faceUp: true,
    };

  // HAND_OR_TRASH_TO_LIFE — "將最多N張...手牌或廢棄區中...角色卡，以正面朝上加入自己的生命值區上面"
  // Must precede LIFE_TO_TRASH which misfires when 廢棄區 is the source and 生命值區 the destination.
  const handOrTrashToLifeM = s.match(/將最多(\d+)張(.+?)，以正面朝上加入(?:自己的)?生命值區上面/);
  if (handOrTrashToLifeM) {
    return {
      type: "ADD_TO_LIFE",
      count: parseInt(handOrTrashToLifeM[1]),
      filter: parseCardFilter(handOrTrashToLifeM[2]),
      sourceZone: "handOrTrash",
      faceUp: true,
      position: "top",
      targetOwner: "self",
    };
  }

  // LIFE_TO_TRASH — life card goes directly to trash
  if ((s.includes("生命值區") || s.includes("生命值卡")) && (s.includes("廢棄") || s.includes("廢棄區"))) {
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)?張/);
    const targetOwner =
      s.includes("對手") || s.includes("對方") ? "opponent" : "self";
    const isAll = s.includes("全數");
    const faceUpOnly = s.includes("正面朝上");
    return {
      type: "LIFE_TO_TRASH",
      count: isAll ? Infinity : parseInt(cntM?.[1] ?? "1"),
      targetOwner,
      ...(faceUpOnly ? { faceUpOnly: true } : {}),
    };
  }

  // RETURN_HAND — bounce a character (or stage) from field back to its owner's hand.
  // Strip the destination phrase "放回持有者的手牌" so that 持有者 (→ owner=self) and
  // 手牌 (→ zone=hand) don't corrupt the source-card filter.
  if (s.includes("放回持有者的手牌")) {
    const srcText = s.split("放回持有者的手牌")[0];
    const maxM = srcText.match(/最多(\d+)張/);
    const exactM = !maxM ? srcText.match(/[將及](\d+)張/) : null;
    const count = srcText.includes("全數")
      ? Infinity
      : parseInt(maxM?.[1] ?? exactM?.[1] ?? "1");
    const filterText = srcText
      .replace(/將?(?:最多\d+張|\d+張|全數)/g, "")
      .trim();
    // "對手將...放回持有者的手牌" — opponent is the grammatical subject, so opponent chooses
    const chooser = srcText.trimStart().startsWith("對手")
      ? "opponent"
      : "self";
    const action = {
      type: "RETURN_HAND",
      count,
      filter: parseCardFilter(filterText),
    };
    if (chooser === "opponent") action.chooser = "opponent";
    return action;
  }
  // ADD_TO_HAND — "無法" variants are prevention modifiers, not executable moves
  if (s.includes("加入手牌") && !s.includes("無法")) {
    // Take only the text before 加入手牌 as the source description so that
    // zone detection in parseCardFilter sees the source zone, not the destination.
    const srcText = s
      .split("加入手牌")[0]
      .replace(/[，,]$/, "")
      .trim();
    const countM = srcText.match(/最多(\d+)張/) ?? srcText.match(/[將](\d+)張/);
    return {
      type: "ADD_TO_HAND",
      count: parseInt(countM?.[1] ?? "1"),
      filter: parseCardFilter(srcText),
    };
  }

  // ATTACH_DON — separate DON!! state (applies to the DON!! card) from target card filter
  if (s.includes("附加") && s.includes("咚‼")) {
    const donStateM = s.match(/張(?:持有者|對手|自己)?(休息|活動)狀態的咚‼/);
    const donState = donStateM
      ? donStateM[1] === "休息"
        ? "rest"
        : "active"
      : null;

    // "各N張" means N DON!! each to every target listed after 在 (split on 和)
    const eachM = s.match(/附加最多各(\d+)張/);
    if (eachM) {
      const count = parseInt(eachM[1]);
      const targetM = s.match(/在(.+)$/);
      if (targetM) {
        const parts = targetM[1].split(/和(?=\d?張?(?:自己|對手|對方)(?:全數)?的)/);
        if (parts.length >= 2) {
          return parts.map((t) => ({
            type: "ATTACH_DON",
            count,
            eachTarget: true,
            donState,
            filter: parseCardFilter(t.trim()),
          }));
        }
        // "最多N張" before target = attach to up to N separate targets
        const maxTargetsM = targetM[1].match(/^最多(\d+)張/);
        if (maxTargetsM) {
          return {
            type: "ATTACH_DON",
            count,
            isUpTo: true,
            donState,
            maxTargets: parseInt(maxTargetsM[1]),
            filter: parseCardFilter(targetM[1].replace(/^最多\d+張/, '').trim()),
          };
        }
      }
    }

    // Use only the target part (after 在) so parseCardFilter doesn't pick up 咚‼ and set cardType:"don"
    const targetM = s.match(/在(.+)$/);
    const filterText = targetM
      ? targetM[1]
      : donState
        ? s.replace(/休息狀態的|活動狀態的/, "")
        : s;
    // "持有者" before 咚‼ means "whoever owns the target card" — targets span both sides.
    // Matches both "持有者休息/活動狀態的咚‼" and "持有者費用區的咚‼" (cost-area don from target owner).
    const donFromTargetOwner = /張持有者(?:(?:休息|活動)狀態|費用區)的咚‼/.test(s);
    const isUpTo = /附加(?:合計)?最多/.test(s);
    return {
      type: "ATTACH_DON",
      count: parseInt(s.match(/附加(?:合計)?最多各?(\d+)張/)?.[1] ?? "1"),
      ...(isUpTo && { isUpTo: true }),
      donState,
      ...(donFromTargetOwner && { donSource: "targetOwner" }),
      filter: parseCardFilter(filterText),
    };
  }

  // FLIP_LIFE_FACE_UP — e.g. "將2張自己生命值區上面的卡片翻成正面朝上"
  if (s.includes("翻成正面朝上")) {
    const flipCntM = s.match(/將(\d+)張.*翻成正面朝上/);
    return { type: "FLIP_LIFE_FACE_UP", count: flipCntM ? parseInt(flipCntM[1]) : 1 };
  }

  // SELF_TO_TRASH — "將這張角色卡放置在廢棄區" as activation cost; not a KO
  if (
    s.includes("這張角色卡") &&
    (s.includes("放置在廢棄區") || s.includes("放置到廢棄區"))
  )
    return { type: "SELF_TO_TRASH" };

  // KO_OR_DISCARD_HAND — "將1張自己擁有《X》特徵的角色卡、或自己的手牌放置到廢棄區"
  // Player chooses: KO a matching field character, OR discard a hand card
  const koOrDiscardHandM = s.match(
    /將(.+?角色卡)[、，,]或(.+?手牌)放置到廢棄區/,
  );
  if (koOrDiscardHandM)
    return {
      type: "KO_OR_DISCARD_HAND",
      filter: parseCardFilter(koOrDiscardHandM[1]),
    };

  // DECK_TO_TRASH — "將N張卡組上面的卡片放置(在/到)廢棄區" — mill top N cards from own deck to trash
  const deckToTrashM = s.match(/將(\d+)張.*卡組上面.*(?:廢棄|到廢棄)/);
  if (deckToTrashM)
    return { type: "DECK_TO_TRASH", count: parseInt(deckToTrashM[1]) };

  // REMAINDER_TO_TRASH — "其餘卡片放到廢棄區" — put SEARCH leftovers in trash (consumed by SEARCH handler)
  if (s.includes("其餘") && s.includes("廢棄"))
    return { type: "REMAINDER_TO_TRASH" };

  // "其餘卡片...放到卡組下面/上面" — consumed by the SEARCH handler via SEARCH_ORDER.
  // When the effect allows top-or-bottom placement, emit a sentinel so SEARCH_PICK
  // can pass canPlaceOnTop: true to the queued SEARCH_ORDER step.
  if (s.includes("其餘") && (s.includes("卡組") || s.includes("下面")))
    return s.includes("上面或下面") ? { type: "REMAINDER_TOP_OR_BOTTOM" } : null;

  // OPP_HAND_TO_DECK — "對手將N張自身的手牌依任意順序放置在卡組下面" (opponent chooses N cards to send to deck bottom)
  if (
    s.includes("對手") &&
    s.includes("手牌") &&
    s.includes("放置在卡組") &&
    s.includes("下面")
  ) {
    const cntM = s.match(/(\d+)張/);
    return { type: "OPP_HAND_TO_DECK", count: parseInt(cntM?.[1] ?? "1") };
  }

  // HAND_TO_DECK — "將N張自己的手牌...放到/放置在卡組上面或下面"
  if (
    s.includes("手牌") &&
    (s.includes("放到卡組") || s.includes("放置在卡組")) &&
    (s.includes("上面") || s.includes("下面"))
  ) {
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)張/);
    return {
      type: "HAND_TO_DECK",
      count: parseInt(cntM?.[1] ?? "1"),
      canPlaceOnTop: s.includes("上面"),
      isOptional: s.includes("可"),
    };
  }

  // BOTTOM_DECK — e.g. "將最多1張對手力量值6000以下的角色卡放置在持有者的卡組下面"
  if ((s.includes("卡組下面") || s.includes("放到卡組")) && s.includes("下")) {
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)張/);
    // Strip destination phrase so parseCardFilter only sees the source card spec
    const srcText = s
      .replace(/放置在.+/, "")
      .replace(/放置到.+/, "")
      .replace(/放到卡組.+/, "")
      .replace(/放到持有者的卡組.+/, "")
      .trim();
    const filter = parseCardFilter(srcText);
    // When no explicit owner marker (自己/對手) in the source text, default to opponent —
    // field→bottom-deck effects without a self-qualifier always target opponent's characters.
    if (!filter.owner) filter.owner = "opponent";
    return {
      type: "BOTTOM_DECK",
      count: parseInt(cntM?.[1] ?? "1"),
      filter,
    };
  }

  // DECK_TO_LIFE — top of deck → top of life (must precede ADD_TO_LIFE)
  if ((s.includes("卡組") || s.includes("牌組")) && s.includes("生命值區")) {
    const cntM =
      s.match(/將(?:最多)?(\d+)張/) ??
      s.match(/最多(\d+)?張/) ??
      s.match(/(\d+)?張/);
    return { type: "DECK_TO_LIFE", count: parseInt(cntM?.[1] ?? "1") };
  }

  // ADD_TO_LIFE from hand — "公開N張手牌中..., 並以...加入生命值區" (reveal + add to life compound)
  if (s.includes("公開") && s.includes("手牌") && s.includes("生命值區")) {
    const destM = s.match(
      /(以(正面|背面)朝上)?(放入|加入)(自己的|對手的|持有者的)?生命值區(上面或下面|上面|下面)/,
    );
    const faceUp = destM?.[2] === "正面";
    const posText = destM?.[5] ?? "上面";
    const position =
      posText === "上面或下面"
        ? "choice"
        : posText === "下面"
          ? "bottom"
          : "top";
    const twText = destM?.[4];
    const targetOwner =
      twText === "對手的"
        ? "opponent"
        : twText === "持有者的"
          ? "holder"
          : "self";
    const srcText = s
      .replace(
        /(以(正面|背面)朝上)?(放入|加入)(自己的|對手的|持有者的)?生命值區(上面或下面|上面|下面)?/,
        "",
      )
      .trim();
    const filter = parseCardFilter(srcText);
    delete filter.zone;
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)張/);
    return {
      type: "ADD_TO_LIFE",
      filter,
      count: parseInt(cntM?.[1] ?? "1"),
      sourceZone: "hand",
      targetOwner,
      position,
      faceUp,
    };
  }

  // HAND_TO_LIFE — hand card → top of life (must precede ADD_TO_LIFE)
  if (s.includes("手牌") && s.includes("生命值區")) {
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)?張/);
    return {
      type: "HAND_TO_LIFE",
      count: parseInt(cntM?.[1] ?? "1"),
      filter: parseCardFilter(s),
    };
  }

  // ADD_TO_LIFE — move a character card from field/hand to life area
  if (s.includes("生命值區") && (s.includes("放入") || s.includes("加入"))) {
    const destM = s.match(
      /(以(正面|背面)朝上)?(放入|加入)(自己的|對手的|持有者的)?生命值區(上面或下面|上面|下面)?/,
    );
    const faceUp = destM?.[2] === "正面";
    const posText = destM?.[5] ?? "上面";
    const position =
      posText === "上面或下面"
        ? "choice"
        : posText === "下面"
          ? "bottom"
          : "top";
    const twText = destM?.[4];
    const targetOwner =
      twText === "對手的"
        ? "opponent"
        : twText === "持有者的"
          ? "holder"
          : "self";
    const srcText = s
      .replace(
        /(以(正面|背面)朝上)?(放入|加入)(自己的|對手的|持有者的)?生命值區(上面或下面|上面|下面)?/,
        "",
      )
      .trim();
    const filter = parseCardFilter(srcText);
    delete filter.zone;
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)張/);
    return {
      type: "ADD_TO_LIFE",
      filter,
      count: parseInt(cntM?.[1] ?? "1"),
      sourceZone: "characterArea",
      targetOwner,
      position,
      faceUp,
    };
  }

  // SELECT_LEADER_AND_CHAR — "選擇自己的領航卡和N張自己的角色卡"
  // Used before SWAP_BASE_POWER when the swap always involves the leader + 1 character.
  const leaderAndCharM = s.match(/選擇自己的領航卡和(\d+)張自己的角色卡/);
  if (leaderAndCharM)
    return { type: "SELECT_LEADER_AND_CHAR", count: parseInt(leaderAndCharM[1]) };

  // REDIRECT_ATTACK_TARGET — "選擇自己的領航卡或...《trait》特徵的角色卡"
  const redirectM = s.match(/選擇自己的領航卡或.*?《([^》]+)》特徵/);
  if (redirectM) return { type: "REDIRECT_ATTACK_TARGET", trait: redirectM[1] };
  // Companion sentence "攻擊的對象變更為選擇的卡片" is handled by REDIRECT_ATTACK_TARGET above
  if (s.includes("攻擊的對象變更")) return null;

  // FREE_EVENT — "發動最多N張...事件卡" — play event card(s) from hand without paying cost
  const freeEventM = s.match(/發動最多(\d+)?張/);
  if (freeEventM && s.includes("事件卡") && !s.includes("這張卡片的")) {
    return {
      type: "FREE_EVENT",
      count: parseInt(freeEventM[1] ?? "1"),
      filter: parseCardFilter(s),
    };
  }

  // FIRE_MAIN_EFFECT — "發動這張卡片的效果" (trigger re-fires this card's named-timing effect)
  // Timing is injected by parseBlock after clause assembly, since 【xxx】 brackets are stripped here.
  if (s.includes("發動這張卡片的") && s.includes("效果"))
    return { type: "FIRE_MAIN_EFFECT" };

  // GRANT_KEYWORD with "without keyword" filter
  // e.g. "最多1張自己未持有【攻擊時】效果的角色卡，在這個回合，獲得【速攻】"
  const grantWithoutM = s.match(
    /最多(\d+)?張(.*?)未持有【([^】]+)】效果的角色卡[，,].*?獲得【([^】]+)】/,
  );
  if (grantWithoutM) {
    return {
      type: "GRANT_KEYWORD",
      keyword: grantWithoutM[4],
      count: parseInt(grantWithoutM[1] ?? "1"),
      until: s.includes("在這個回合") ? "turn" : null,
      filter: {
        ...parseCardFilter(grantWithoutM[2]),
        zone: "field",
        category: "Character",
        withoutKeyword: grantWithoutM[3],
      },
    };
  }

  // ADD_DON_FROM_DECK — 從咚‼卡組追加最多N張(活動|休息)狀態的咚‼卡
  // Also matches 再追加最多N張... where "from don deck" is implied by context
  const addDonDeckM = s.match(
    /(?:從(?:自己的)?咚‼卡組追加|再追加)最多(\d+)張(活動|休息)狀態的咚‼卡/,
  );
  if (addDonDeckM)
    return {
      type: "ADD_DON_FROM_DECK",
      count: parseInt(addDonDeckM[1]),
      donState: addDonDeckM[2] === "休息" ? "rest" : "active",
    };

  // BLOCK_DEPLOY — "在這個回合，自己無法使角色卡登場" (optionally: "在自己場上")
  if (/無法使角色卡(?:在自己場上)?登場/.test(s))
    return { type: "BLOCK_DEPLOY", category: "Character", until: "turn" };

  // DEAL_DAMAGE — "造成對手N傷害" — deal N damage to opponent's life
  const dealDmgM = s.match(/造成對手(\d+)傷害/);
  if (dealDmgM)
    return {
      type: "DEAL_DAMAGE",
      count: parseInt(dealDmgM[1]),
      targetOwner: "opponent",
    };

  // REVEAL_LIFE — "公開(最多)N張自己生命值區上面的卡片"
  // Compound form: "公開...生命值區...，若該張卡片是{filter}時，也可登場" emits both REVEAL_LIFE and CONDITIONAL_DEPLOY.
  const revealLifeM = s.match(/公開(?:最多)?(\d+)張自己生命值區上面的卡片/);
  if (revealLifeM) {
    const revealAction = { type: "REVEAL_LIFE", count: parseInt(revealLifeM[1]) };
    if (s.includes("也可") && s.includes("登場")) {
      const condDeployAction = { type: "CONDITIONAL_DEPLOY", isOptional: true, deployState: s.includes("休息") ? "rest" : "active" };
      // "費用N的「CardName」" — exact named-card match
      const namedM = s.match(/費用(\d+)的「([^」]+)」/);
      if (namedM) condDeployAction.filter = { category: "Character", cost: parseInt(namedM[1]), costOp: "eq", name: namedM[2] };
      // "費用N以下擁有《Trait》特徵角色卡" — trait + cost≤N match
      const traitCostM = s.match(/費用(\d+)以下擁有《([^》]+)》特徵角色卡/);
      if (traitCostM) condDeployAction.filter = { category: "Character", cost: parseInt(traitCostM[1]), costOp: "lte", trait: traitCostM[2] };
      return [revealAction, condDeployAction];
    }
    return revealAction;
  }

  // REVEAL_HAND_CARDS — "公開N張...手牌中..." (character card, event card, or trait-filtered cards)
  if (s.includes("手牌")) {
    const revealHandCharM = s.match(/公開(\d+)張(.+?)的角色卡/);
    if (revealHandCharM)
      return {
        type: "REVEAL_HAND_CARDS",
        count: parseInt(revealHandCharM[1]),
        filter: parseCardFilter(revealHandCharM[2] + "的角色卡"),
      };
    const revealHandEventM = s.match(/公開(\d+)張(.+?)的?事件卡/);
    if (revealHandEventM)
      return {
        type: "REVEAL_HAND_CARDS",
        count: parseInt(revealHandEventM[1]),
        filter: { category: "Event", ...parseCardFilter(revealHandEventM[2]) },
      };
    const revealHandTraitM = s.match(/公開(\d+)張(.+?擁有.+?特徵.+?)的?卡片/);
    if (revealHandTraitM)
      return {
        type: "REVEAL_HAND_CARDS",
        count: parseInt(revealHandTraitM[1]),
        filter: parseCardFilter(revealHandTraitM[2]),
      };
  }

  // DON_EQUALIZE_EOT — "將咚‼卡放回咚卡組，使自己場上的咚‼卡和對手場上的咚‼卡張數一樣"
  if (s.includes("使自己場上的咚‼卡和對手場上的咚‼卡張數一樣"))
    return { type: "DON_EQUALIZE_EOT" };

  // OPPONENT_DON_RETURN — "對手將N張自身場上的咚‼卡放回咚‼卡組"
  const oppDonRetM = s.match(/對手將(\d+)張自身場上的咚‼卡放回咚‼卡組/);
  if (oppDonRetM)
    return {
      type: "OPPONENT_DON_REST_DEFERRED",
      count: parseInt(oppDonRetM[1]),
      isReturn: true,
    };

  // HAND_COST_MOD with trait/cost filter — "使自己手牌中費用N以上擁有《X》特徵的角色卡登場的支付費用減少N"
  const costModDeployM = s.match(
    /使自己手牌中費用(\d+)(以上|以下)擁有《([^》]+)》特徵的角色卡登場的支付費用減少(\d+)/,
  );
  if (costModDeployM) {
    const dir = costModDeployM[2];
    const cost = parseInt(costModDeployM[1]);
    return {
      type: "HAND_COST_MOD",
      delta: -parseInt(costModDeployM[4]),
      filter: {
        owner: "self",
        category: "Character",
        trait: costModDeployM[3],
        ...(dir === '以上' ? { costMin: cost } : { costMax: cost }),
      },
      until: "turn",
    };
  }

  // HAND_COST_MOD with name/cost filter — "使自己手牌中費用N以上的「X」登場的支付費用減少N"
  const handCostModNameM = s.match(
    /使自己手牌中費用(\d+)(以上|以下)的「([^」]+)」登場的支付費用減少(\d+)/,
  );
  if (handCostModNameM) {
    const dir = handCostModNameM[2];
    const cost = parseInt(handCostModNameM[1]);
    return {
      type: "HAND_COST_MOD",
      delta: -parseInt(handCostModNameM[4]),
      filter: {
        name: handCostModNameM[3],
        ...(dir === "以上" ? { costMin: cost } : { costMax: cost }),
      },
      until: "turn",
    };
  }

  // SELF_EFFECT_NULL — "自己的效果無效" (self-debuff, rare)
  if (s.includes("自己的效果無效"))
    return { type: "BLOCK_EFFECT", targetOwner: "self", until: "turn" };

  // SELECT target card (standalone, no action — marks target for conditional follow-up)
  const selectOnlyM = s.match(/選擇(?:最多)?(\d+)?張(.+?)角色卡(?:$|[。，])/);
  if (
    selectOnlyM &&
    !s.includes("登場") &&
    !s.includes("KO") &&
    !s.includes("廢棄") &&
    !s.includes("休息") &&
    !s.includes("活動") &&
    !s.includes("手牌")
  )
    return {
      type: "SELECT_TARGET",
      count: parseInt(selectOnlyM[1] ?? "1"),
      filter: parseCardFilter(selectOnlyM[2] + "角色卡"),
    };

  // CONDITIONAL_DEPLOY — "也可登場" / "也可以休息狀態登場" / "也休息狀態登場" (deploy revealed card)
  if (s.includes("也可") && s.includes("登場"))
    return {
      type: "CONDITIONAL_DEPLOY",
      deployState: s.includes("休息") ? "rest" : "active",
      isOptional: true,
    };
  if (s.includes("也休息狀態登場"))
    return { type: "CONDITIONAL_DEPLOY", deployState: "rest", isOptional: true };

  // OPPONENT_HAND_TO_DECK — "對手將自身的手牌全部放回卡組並洗牌"
  if (
    s.includes("對手") &&
    s.includes("手牌") &&
    s.includes("放回卡組") &&
    s.includes("洗牌")
  )
    return { type: "OPPONENT_HAND_TO_DECK", shuffle: true };

  // HAND_TO_DECK with reorder — "將N張自己的手牌任意變換排列順序放置在卡組上面或下面"
  const handReorderM = s.match(/將(\d+)張自己的手牌任意變換排列順序放置在卡組/);
  if (handReorderM)
    return {
      type: "HAND_TO_DECK",
      count: parseInt(handReorderM[1]),
      reorder: true,
      position: s.includes("下面") ? "bottom" : "top",
    };

  // DISCARD_FIELD_CHAR — "可將N張自己的角色卡放置在廢棄區" (as activation cost or effect)
  const discardFieldM = s.match(/可?將(\d+)張自己的角色卡放置在廢棄區/);
  if (discardFieldM)
    return {
      type: "DISCARD",
      count: parseInt(discardFieldM[1]),
      filter: { owner: "self", category: "Character", zone: "field" },
      isOptional: s.includes("可"),
    };

  // LOOK_ARRANGE_LIFE_ALL — "查看自己全數的生命值卡，將N張放置在自己卡組上面，並將生命值卡依任意順序放置"
  const lookAllLifeM = s.match(/查看自己全數的生命值卡/);
  if (lookAllLifeM)
    return {
      type: "LOOK_ARRANGE_LIFE",
      count: null,
      targetOwner: "self",
      allCards: true,
    };

  // WIN_GAME — "自己將遊戲獲勝" / "自己將獲勝而非輸掉遊戲"
  if (s.includes("自己將") && (s.includes("獲勝") || s.includes("遊戲獲勝")))
    return { type: "WIN_GAME" };

  // DECLARE_COST — "聲明任意的費用" (declare an arbitrary cost)
  if (s.includes("聲明任意的費用")) return { type: "DECLARE_COST" };

  // Dual-select from trash — "選擇自己廢棄區中最多N張費用N以下的角色卡，和最多N張費用N以下的角色卡"
  const dualSelectTrashM = s.match(
    /選擇自己廢棄區中最多(\d+)張(.+?)，和最多(\d+)張(.+?)角色卡/,
  );
  if (dualSelectTrashM)
    return {
      type: "SELECT_TARGET",
      groups: [
        {
          count: parseInt(dualSelectTrashM[1]),
          filter: parseCardFilter(dualSelectTrashM[2] + "的角色卡"),
          zone: "trash",
        },
        {
          count: parseInt(dualSelectTrashM[3]),
          filter: parseCardFilter(dualSelectTrashM[4] + "的角色卡"),
          zone: "trash",
        },
      ],
    };

  // Deploy-N-rest-others — "使其中N張登場，其餘卡片以休息狀態登場"
  const deployNRestM = s.match(/使其中(\d+)張登場，其餘卡片以休息狀態登場/);
  if (deployNRestM)
    return {
      type: "DEPLOY",
      count: parseInt(deployNRestM[1]),
      restRemainder: true,
      source: "selected",
    };

  // KO dual char+stage — "KO對手最多N張力量值N以下的角色卡和最多N張費用N以下的舞台卡"
  const koCharStageM = s.match(
    /KO對手最多(\d+)張力量值(\d+)以下的角色卡和最多(\d+)張費用(\d+)以下的舞台卡/,
  );
  if (koCharStageM)
    return [
      { type: "KO", count: parseInt(koCharStageM[1]), filter: { owner: "opponent", category: "Character", powerMax: parseInt(koCharStageM[2]) } },
      { type: "KO", count: parseInt(koCharStageM[3]), filter: { owner: "opponent", category: "Stage", costMax: parseInt(koCharStageM[4]) } },
    ];

  // KO dual — "KO對手最多N張費用N以下的角色卡和最多N張費用N以下的角色卡"
  const koDualM = s.match(/KO對手最多(\d+)張(.+?)和最多(\d+)張(.+?)角色卡/);
  if (koDualM)
    return [
      {
        type: "KO",
        count: parseInt(koDualM[1]),
        filter: parseCardFilter(koDualM[2] + "的角色卡"),
      },
      {
        type: "KO",
        count: parseInt(koDualM[3]),
        filter: parseCardFilter(koDualM[4] + "的角色卡"),
      },
    ];

  // POWER_MOD self until next own turn start — "這張角色卡，到下一個我方回合開始前，力量+N"
  const powerTillOwnTurnM = s.match(
    /這張角色卡[，,]到下一個我方回合開始前[，,]力量[值]?[+＋](\d+)/,
  );
  if (powerTillOwnTurnM)
    return {
      type: "POWER_MOD",
      delta: parseInt(powerTillOwnTurnM[1]),
      until: "startOfOwnTurn",
      filter: { self: true },
    };

  // Skip timing-declaration sentences (body-text trigger preamble, not an action)
  if (
    s.endsWith("，發動") ||
    s === "對手發動時" ||
    s === "對手攻擊時，發動" ||
    s === "對手使角色卡登場時" ||
    s === "角色卡因為自己的效果離開場上時" ||
    s === "自己場上的咚‼卡被放回咚‼卡組時" ||
    s === "自己發動事件卡時" ||
    s.startsWith("自己的角色卡全數，在這個回合") // timing-scope fragment
  )
    return null;

  // GRANT_KEYWORD on up to N cards this turn — "最多N張(filter)，在這個回合，獲得【keyword】"
  const grantCountM = s.match(/最多(\d+)?張(.+?)在這個回合，獲得【([^】]+)】/);
  if (grantCountM && PASSIVE_KW.has(grantCountM[3]))
    return {
      type: "GRANT_KEYWORD",
      keyword: grantCountM[3],
      count: parseInt(grantCountM[1] ?? "1"),
      filter: parseCardFilter(grantCountM[2].replace(/[，,]\s*$/, "")),
      until: "turn",
    };

  // GRANT_KEYWORD on all matching cards this turn (no count prefix) — "FILTER，在這個回合，獲得【keyword】"
  const grantAllM = s.match(/^(.+?)，在這個回合，獲得【([^】]+)】$/);
  if (grantAllM && PASSIVE_KW.has(grantAllM[2]))
    return {
      type: "GRANT_KEYWORD",
      keyword: grantAllM[2],
      count: Infinity,
      filter: parseCardFilter(grantAllM[1]),
      until: "turn",
    };

  // FIELD_TO_LIFE — "將最多N張...，以正面朝上放置在持有者的生命值區上面或下面"
  const fieldToLifeM = s.match(
    /將最多(\d+)張(.+?)，以正面朝上放置在持有者的生命值區上面或下面/,
  );
  if (fieldToLifeM)
    return {
      type: "FIELD_TO_LIFE",
      count: parseInt(fieldToLifeM[1]),
      filter: parseCardFilter(fieldToLifeM[2]),
      faceUp: true,
      choosePosition: true,
    };

  // KO broad — "將最多N張對手費用N以下的角色卡放置在/到廢棄區"
  const koPlaceTrashM = s.match(/將最多(\d+)張(.+?)放置(?:在|到)廢棄區/);
  if (koPlaceTrashM)
    return {
      type: "KO",
      count: parseInt(koPlaceTrashM[1]),
      filter: parseCardFilter(koPlaceTrashM[2].replace(/[，,]\s*$/, "")),
    };

  // Skip orphan time-scope fragments that result from condition splits
  if (
    s === "在這個回合" ||
    s === "之後" ||
    s === "之後，在這個回合" ||
    s === "➀" ||
    s === "・" ||
    s === "①"
  )
    return null;

  // BLOCK_LIFE_TO_HAND — "自己無法以自己的效果將生命值卡加入手牌"
  if (s.includes("無法以自己的效果將生命值卡加入手牌"))
    return { type: "BLOCK_LIFE_TO_HAND", until: "turn" };

  // HAND_PLAY_LOCK — "自己無法使用手牌中的卡片" — cannot play cards from hand this turn
  // Matches with or without leading "之後，在這個回合，" connector phrase
  if (s.includes("無法使用手牌中的卡片"))
    return {
      type: "HAND_PLAY_LOCK",
      until: s.includes("在這個回合") ? "turn" : null,
    };

  // DRAW_LOCK — "自己無法以自己的效果抽取卡片" — cannot draw cards by own effects this turn
  // Matches with or without leading "之後，在這個回合，" connector phrase
  if (s.includes("無法以自己的效果抽取卡片"))
    return {
      type: "DRAW_LOCK",
      until: s.includes("在這個回合") ? "turn" : null,
    };

  // REVEAL_LIFE_TOP — "公開最多N張自己生命值區上面的卡片" (opponent reactive trigger context)
  const revealLifeTopM = s.match(/公開最多(\d+)張自己生命值區上面的卡片/);
  if (revealLifeTopM)
    return { type: "REVEAL_LIFE_TOP", count: parseInt(revealLifeTopM[1]) };

  // DEPLOY_RESTED_PASSIVE — leader passive: own character cards enter play in rest state
  if (s.includes("自己的角色卡以休息狀態登場"))
    return { type: "DEPLOY_RESTED_PASSIVE" };

  // NULL_EFFECT — "效果無效" for opponent cards (effect nullification)
  const nullEffectCombM = s.match(
    /最多(\d+)張(.+?)在下一個對手回合結束前，效果無效、而且該張角色卡無法進行攻擊/,
  );
  if (nullEffectCombM)
    return [
      {
        type: "NULL_EFFECT",
        count: parseInt(nullEffectCombM[1]),
        filter: parseCardFilter(nullEffectCombM[2].replace(/[，,]\s*$/, "")),
        until: "nextOppTurn",
      },
      {
        type: "ATTACK_LOCK",
        count: parseInt(nullEffectCombM[1]),
        filter: parseCardFilter(nullEffectCombM[2].replace(/[，,]\s*$/, "")),
        until: "nextOppTurn",
      },
    ];

  const nullEffectM = s.match(/最多(\d+)張(.+?)在這個回合，效果無效/);
  if (nullEffectM)
    return {
      type: "NULL_EFFECT",
      count: parseInt(nullEffectM[1]),
      filter: parseCardFilter(nullEffectM[2].replace(/[，,]\s*$/, "")),
      until: "turn",
    };

  const nullEffectOppM = s.match(/在下一個對手回合結束前，對手的效果無效/);
  if (nullEffectOppM)
    return {
      type: "NULL_EFFECT",
      targetOwner: "opponent",
      until: "nextOppTurn",
    };

  // SHUFFLE_DECK — "將卡組洗牌"
  if (s.includes("將卡組洗牌") || s.includes("卡組洗牌"))
    return { type: "SHUFFLE_DECK", owner: "self" };

  // FLIP_LIFE_FACE_DOWN — "可將N張自己生命值區上面的卡片翻成/置為背面朝上" / "全數翻成背面朝上"
  if (s.includes("生命值卡全數翻成背面朝上") || s.includes("生命值卡全數置為背面朝上"))
    return { type: "FLIP_LIFE_FACE_DOWN", count: Infinity };
  const flipFaceDownM = s.match(
    /可?將(\d+)張自己(?:正面朝上的)?生命值卡?(?:區上面的卡片)?(?:翻成|置為)背面朝上/,
  );
  if (flipFaceDownM)
    return { type: "FLIP_LIFE_FACE_DOWN", count: parseInt(flipFaceDownM[1]) };

  // GRANT_KEYWORD for rush-chars-only — "在登場的回合即可攻擊角色卡"
  const rushCharsM = s.match(/(.+?)在登場的回合即可攻擊角色卡/);
  if (rushCharsM)
    return {
      type: "GRANT_KEYWORD",
      keyword: "RUSH_CHARS_ONLY",
      filter: parseCardFilter(rushCharsM[1].replace(/[，,]\s*$/, "")),
    };

  // ATTACK_LOCK with name exclusion — "最多N張對手除了「X」以外的角色卡，在下一個對手回合結束前，無法進行攻擊"
  const attackLockExclM = s.match(
    /最多(\d+)張(.+?)除了「([^」]+)」以外的(.+?)在下一個對手回合結束前，無法進行攻擊/,
  );
  if (attackLockExclM)
    return {
      type: "ATTACK_LOCK",
      count: parseInt(attackLockExclM[1]),
      filter: parseCardFilter(attackLockExclM[4].replace(/[，,]\s*$/, "")),
      excludeName: attackLockExclM[3],
    };

  // ATTACK_LOCK for opponent leader/rested cards until next opponent end — "N張對手...在下一個對手回合結束前，無法進行攻擊"
  const attackLockOppM = s.match(
    /最多(\d+)張(.+?)在下一個對手回合結束前，無法進行攻擊/,
  );
  if (attackLockOppM)
    return {
      type: "ATTACK_LOCK",
      count: parseInt(attackLockOppM[1]),
      filter: parseCardFilter(attackLockOppM[2].replace(/[，,]\s*$/, "")),
      until: "nextOppTurn",
    };

  // FORCE_ATTACK_TARGET — "對手只能攻擊角色卡「X」"
  const forceTargetM = s.match(/對手只能攻擊角色卡「([^」]+)」/);
  if (forceTargetM)
    return { type: "FORCE_ATTACK_TARGET", targetName: forceTargetM[1] };

  // GRANT_KEYWORD RUSH_ACTIVE_CHARS for own cards — "N張...在這個回合，攻擊活動狀態的角色卡"
  const grantRushActiveM = s.match(
    /最多(\d+)張(.+?)在這個回合，攻擊活動狀態的角色卡/,
  );
  if (grantRushActiveM)
    return {
      type: "GRANT_KEYWORD",
      keyword: "RUSH_ACTIVE_CHARS",
      count: parseInt(grantRushActiveM[1]),
      filter: parseCardFilter(grantRushActiveM[2].replace(/[，,]\s*$/, "")),
      until: "turn",
    };

  // GRANT_KEYWORD for attribute-conditional battle protection — "在和擁有(X)屬性的...對戰中，不會遭到KO"
  const attrProtectM = s.match(
    /在和(?:未?擁有)?[（(]?(.+?)[）)]?屬性的.+?對戰中[，,]不會遭到KO/,
  );
  if (attrProtectM)
    return {
      type: "GRANT_KEYWORD",
      keyword: `INDESTRUCTIBLE_VS_${attrProtectM[1]}`,
      filter: { self: true },
    };

  // Mass GRANT_KEYWORD protection — "自己的角色卡全數，到下一個我方回合開始前，不會因效果而遭到KO"
  if (s.includes("不會因效果而遭到KO") && s.includes("角色卡全數"))
    return {
      type: "GRANT_KEYWORD",
      keyword: "MASS_EFFECT_KO_PROTECTION",
      filter: { owner: "self", category: "Character" },
      until: "startOfOwnTurn",
      all: true,
    };

  // REVEAL_TOP_DECK — "公開自己卡組最上面的卡片" (no count = 1)
  if (s.match(/公開自己卡組最上面的卡片/))
    return { type: "REVEAL_TOP_DECK", count: 1, owner: "self" };

  // REVEAL_TOP_DECK — "公開N張自己卡組上面的卡片"
  const revealTopM = s.match(/公開(\d+)張自己卡組上面的卡片/);
  if (revealTopM)
    return {
      type: "REVEAL_TOP_DECK",
      count: parseInt(revealTopM[1]),
      owner: "self",
    };

  // REVEAL_TOP_DECK (opponent deck) — "公開N張對手卡組上面的卡片"
  const revealOppTopM = s.match(/公開(\d+)張對手卡組上面的卡片/);
  if (revealOppTopM)
    return {
      type: "REVEAL_TOP_DECK",
      count: parseInt(revealOppTopM[1]),
      owner: "opponent",
    };

  // DON_RETURN_FROM_FIELD — optional "return N+ own DON!! to DON!! deck" cost/activation
  const donRetFieldM = s.match(/可將(\d+)張以上自己場上的咚‼卡放回咚‼卡組/);
  if (donRetFieldM)
    return {
      type: "DON_RETURN_FROM_FIELD",
      count: parseInt(donRetFieldM[1]),
      minCount: true,
    };

  const donRetActiveM = s.match(/可將(\d+)張自己活動狀態的咚‼卡放回咚‼卡組/);
  if (donRetActiveM)
    return {
      type: "DON_RETURN_FROM_FIELD",
      count: parseInt(donRetActiveM[1]),
      stateFilter: "active",
    };

  const donRetFieldExactM = s.match(
    /替換成將(\d+)張自己場上的咚‼卡放回咚‼卡組/,
  );
  if (donRetFieldExactM)
    return {
      type: "DON_RETURN_FROM_FIELD",
      count: parseInt(donRetFieldExactM[1]),
      isReplacement: true,
    };

  // LOOK_ARRANGE_LIFE — "查看最多N張自己或對手生命值區上面的卡片，並放置在生命值區的上面或下面"
  const lookLifeM = s.match(
    /查看最多(\d+)張(.+?)生命值區上面的卡片，並放置在生命值區的上面或下面/,
  );
  if (lookLifeM) {
    const both = lookLifeM[2].includes("對手");
    return {
      type: "LOOK_ARRANGE_LIFE",
      count: parseInt(lookLifeM[1]),
      targetOwner: both ? "both" : "self",
    };
  }

  // EXTRA_TURN — "在這個回合之後獲得追加我方回合"
  if (s.includes("獲得追加我方回合")) return { type: "EXTRA_TURN" };

  // BLOCK_DEPLOY with cost threshold — "無法使原本費用N以上的角色卡登場"
  const blockDeployCostM = s.match(
    /無法使原本費用(\d+)(以上|以下)的角色卡登場/,
  );
  if (blockDeployCostM) {
    const n = parseInt(blockDeployCostM[1]);
    const op = blockDeployCostM[2] === "以上" ? "gte" : "lte";
    return {
      type: "BLOCK_DEPLOY",
      category: "Character",
      costThreshold: n,
      costOp: op,
      until: "turn",
    };
  }

  // BLOCK_EFFECT — opponent cannot activate effects (during battle or this turn)
  if (s.includes("對手") && s.includes("無法發動"))
    return {
      type: "BLOCK_EFFECT",
      targetOwner: "opponent",
      until: s.includes("這場對戰") ? "battle" : "turn",
    };

  // Mass protection of opponent's characters from self's own effects — "對手的角色卡全數，不會因自己的效果而離開場上"
  if (s.includes("不會因自己的效果而離開場上") && s.includes("對手的角色卡"))
    return { type: "NULL_EFFECT" };

  // Trash-count conditional header — "依照自己廢棄區中的卡片張數，適用下列效果"
  if (s.includes("廢棄區中的卡片張數") && s.includes("適用下列效果"))
    return { type: "NULL_EFFECT" };

  // GRANT_KEYWORD for passive protective/attack abilities expressed in body text

  // INDESTRUCTIBLE_VS_LEADER — "在與領航卡的對戰中不會遭到KO" / "在和領航卡對戰中，不會遭到KO"
  if (s.includes("與領航卡的對戰中不會遭到KO") || (s.includes("和領航卡對戰中") && s.includes("不會遭到KO")))
    return { type: "GRANT_KEYWORD", keyword: "INDESTRUCTIBLE_VS_LEADER", filter: { self: true } };

  if (s.includes("在對戰中不會遭到KO"))
    return {
      type: "GRANT_KEYWORD",
      keyword: "INDESTRUCTIBLE_IN_BATTLE",
      filter: { self: true },
    };
  if (s.includes("不會因對手的效果而離開場上"))
    return {
      type: "GRANT_KEYWORD",
      keyword: "EFFECT_LEAVE_PROTECTION",
      filter: { self: true },
    };
  // INDESTRUCTIBLE_BY_EFFECT with state:active + baseCost filter — "自己活動狀態原本費用N的角色卡，不會因效果而遭到KO"
  const activeBaseCostKoProtM = s.match(/自己活動狀態原本費用(\d+)的角色卡，不會因效果而遭到KO/);
  if (activeBaseCostKoProtM)
    return {
      type: "GRANT_KEYWORD",
      keyword: "INDESTRUCTIBLE_BY_EFFECT",
      filter: { owner: "self", category: "Character", state: "active", baseCost: parseInt(activeBaseCostKoProtM[1]) },
    };
  if (
    s.includes("不會因效果而遭到KO") &&
    (s.includes("這張角色卡") || s.includes("這張卡片"))
  )
    return {
      type: "GRANT_KEYWORD",
      keyword: "INDESTRUCTIBLE_BY_EFFECT",
      filter: { self: true },
    };
  // EFFECT_KO_PROTECTION on own chars with excludeName (also covers trait filter variant)
  const excludeNameKoProtM = s.match(
    /自己除了「([^」]+)」以外(?:費用(\d+)以下)?(?:擁有《([^》]+)》特徵)?的角色卡，不會因(?:對手的)?效果而遭到KO/,
  );
  if (excludeNameKoProtM) {
    const f = { owner: "self", category: "Character", excludeName: excludeNameKoProtM[1] };
    if (excludeNameKoProtM[2]) f.costMax = parseInt(excludeNameKoProtM[2]);
    if (excludeNameKoProtM[3]) f.types = [excludeNameKoProtM[3]];
    return { type: "GRANT_KEYWORD", keyword: "EFFECT_KO_PROTECTION", filter: f };
  }
  // "除了「X」以外自己費用N以下擁有《X》特徵的角色卡，不會因效果而遭到KO" (reverse word order)
  const excludeNameKoProtM2 = s.match(
    /除了「([^」]+)」以外自己費用(\d+)以下(?:擁有《([^》]+)》特徵)?的角色卡，不會因(?:對手的)?效果而遭到KO/,
  );
  if (excludeNameKoProtM2) {
    const f = { owner: "self", category: "Character", excludeName: excludeNameKoProtM2[1], costMax: parseInt(excludeNameKoProtM2[2]) };
    if (excludeNameKoProtM2[3]) f.types = [excludeNameKoProtM2[3]];
    return { type: "GRANT_KEYWORD", keyword: "EFFECT_KO_PROTECTION", filter: f };
  }
  // EFFECT_KO_PROTECTION on all own chars until next own turn — "自己的角色卡全數，在下一個對手回合結束前，不會因對手的效果而遭到KO"
  if (s.includes("角色卡全數") && s.includes("不會因對手的效果而遭到KO"))
    return {
      type: "GRANT_KEYWORD",
      keyword: "EFFECT_KO_PROTECTION",
      filter: { owner: "self", category: "Character" },
      count: Infinity,
      until: "nextOppTurn",
    };
  // EFFECT_KO_PROTECTION on own chars by power until next own turn — "在下一個對手回合結束前，自己原本力量值N以下的角色卡全數，不會因對手的效果而遭到KO"
  const powerLimitKoProtM = s.match(/自己原本力量值(\d+)以下的角色卡全數，不會因對手的效果而遭到KO/);
  if (powerLimitKoProtM)
    return {
      type: "GRANT_KEYWORD",
      keyword: "EFFECT_KO_PROTECTION",
      filter: { owner: "self", category: "Character", powerMax: parseInt(powerLimitKoProtM[1]) },
      count: Infinity,
      until: "nextOppTurn",
    };
  if (
    s.includes("不會因對手的效果而遭到KO") &&
    (s.includes("這張角色卡") || s.includes("這張卡片"))
  )
    return {
      type: "GRANT_KEYWORD",
      keyword: "EFFECT_KO_PROTECTION",
      filter: { self: true },
    };
  // INDESTRUCTIBLE_THIS_TURN on target — "該張角色卡，在這個回合，不會遭到KO"
  if (s.includes("該張角色卡") && s.includes("在這個回合") && s.includes("不會遭到KO"))
    return { type: "GRANT_KEYWORD", keyword: "INDESTRUCTIBLE_THIS_TURN", filter: { owner: "self", category: "Character" }, until: "turn" };
  // INDESTRUCTIBLE_IN_BATTLE on selected — "被選擇的角色卡，在這場對戰中，不會遭到KO"
  if (s.includes("被選擇的角色卡") && s.includes("在這場對戰中") && s.includes("不會遭到KO"))
    return { type: "GRANT_KEYWORD", keyword: "INDESTRUCTIBLE_IN_BATTLE", filter: { owner: "self", category: "Character" } };
  // NO_REST_BY_OPP_EFFECT — "這張角色卡不會因對手的效果置為休息狀態"
  if (s.includes("不會因對手的效果置為休息狀態"))
    return { type: "GRANT_KEYWORD", keyword: "NO_REST_BY_OPP_EFFECT", filter: { self: true } };
  // INDESTRUCTIBLE vs non-special attribute — "這張角色卡不會因未擁有(特)屬性的角色卡效果而遭到KO"
  if (s.includes("不會因未擁有") && s.includes("屬性") && s.includes("效果而遭到KO"))
    return { type: "GRANT_KEYWORD", keyword: "INDESTRUCTIBLE_VS_NON_SPECIAL", filter: { self: true } };
  // INDESTRUCTIBLE vs opponent chars by power — "這張角色卡不會因對手原本力量值N以下的角色卡效果而遭到KO"
  const indestructVsPowerM = s.match(/不會因對手原本力量值(\d+)以下的角色卡效果而遭到KO/);
  if (indestructVsPowerM)
    return { type: "GRANT_KEYWORD", keyword: "INDESTRUCTIBLE_VS_LOW_POWER", powerThreshold: parseInt(indestructVsPowerM[1]), filter: { self: true } };
  // INDESTRUCTIBLE_THIS_TURN (self) — "這張角色卡不會遭到KO"
  if ((s.includes("這張角色卡") || s.includes("這張卡片")) && s.includes("不會遭到KO"))
    return { type: "GRANT_KEYWORD", keyword: "INDESTRUCTIBLE", filter: { self: true } };

  if (
    s.includes("這張角色卡攻擊對手活動狀態的角色卡") ||
    s.includes("可以攻擊對手活動狀態的角色卡") ||
    s.includes("這張角色卡攻擊活動狀態的角色卡") ||
    s.includes("可以攻擊活動狀態的角色卡") ||
    (s.includes("這張角色卡") && s.includes("攻擊對手活動狀態的角色卡")) ||
    (s.includes("這張角色卡") && s.includes("攻擊活動狀態的角色卡"))
  )
    return {
      type: "GRANT_KEYWORD",
      keyword: "RUSH_ACTIVE_CHARS",
      filter: { self: true },
    };

  // GRANT_KEYWORD COUNTER on named own character — "自己的「X」獲得【防禦】"
  const namedCharGrantM = s.match(/自己的「([^」]+)」獲得【([^】]+)】/);
  if (namedCharGrantM && PASSIVE_KW.has(namedCharGrantM[2]))
    return {
      type: "GRANT_KEYWORD",
      keyword: namedCharGrantM[2],
      filter: { owner: "self", name: namedCharGrantM[1] },
    };

  // GRANT_KEYWORD COUNTER with excludeName and trait — "最多N張自己除了「X」以外擁有包含『X』特徵的角色卡，...獲得【防禦】"
  const grantExcludeTraitM = s.match(
    /最多(\d+)張(.+?)除了「([^」]+)」以外(.+?)在下一個對手結束階段結束前，獲得【([^】]+)】/,
  );
  if (grantExcludeTraitM && PASSIVE_KW.has(grantExcludeTraitM[5]))
    return {
      type: "GRANT_KEYWORD",
      keyword: grantExcludeTraitM[5],
      count: parseInt(grantExcludeTraitM[1]),
      filter: { ...parseCardFilter(grantExcludeTraitM[2] + grantExcludeTraitM[4]), excludeName: grantExcludeTraitM[3] },
      until: "nextOppTurnEnd",
    };

  // GRANT_KEYWORD on own chars this turn (Rank 44 alt phrasing) handled above by RUSH_ACTIVE_CHARS
  // NULL for leader-only battle-no-KO (Rank 5 conditional negation)
  if (s.includes("這個效果即無效") && (s.includes("若場上有角色卡") || s.includes("若場上有")))
    return { type: "NULL_EFFECT" };

  // POWER_MOD copy opponent leader power — "到下一個我方回合開始前，力量值變成和對手的領航卡相同"
  if (s.includes("力量值變成和對手的領航卡") || s.includes("力量值，變成和對手的領航卡") || s.includes("力量值，在這個回合，變成和對手的領航卡") || (s.includes("變成和對手的領航卡") && s.includes("力量")))
    return { type: "COPY_POWER_FROM_LEADER", source: "opponentLeader", filter: { self: true } };

  // COPY_POWER from opponent leader always (permanent) — "原本的力量值，變成和自己的領航卡的原本力量值相同"
  if (s.includes("變成和自己的領航卡的原本力量值相同"))
    return { type: "COPY_POWER_FROM_LEADER", source: "ownLeader", filter: { self: true } };

  // COPY_POWER during battle — "變成和對手進行攻擊的領航卡或角色卡的力量值相同"
  if (s.includes("變成和對手進行攻擊的") && s.includes("力量值相同"))
    return { type: "COPY_POWER_FROM_ATTACKER", filter: { self: true } };

  // POWER_PER_DON_RESTED — "自己每有N張休息狀態的咚‼卡，這張角色卡，力量+N"
  const powerPerDonRestedM = s.match(/每有(\d+)張休息狀態的咚‼卡[，,].+力量[值]?[+＋](\d+)/);
  if (powerPerDonRestedM)
    return {
      type: "POWER_PER_DON_RESTED",
      perCount: parseInt(powerPerDonRestedM[1]),
      delta: parseInt(powerPerDonRestedM[2]),
      filter: { self: true },
    };

  // POWER_SET on own leader — "自己的領航卡，在下一個對手回合結束前，原本的力量值變更成N"
  const leaderPowerSetM = s.match(
    /自己(?:擁有《([^》]+)》特徵)?的領航卡[，,]在下一個對手(?:結束階段結束|回合結束)前[，,]原本的力量值變更成(\d+)/,
  );
  if (leaderPowerSetM)
    return {
      type: "POWER_SET",
      power: parseInt(leaderPowerSetM[2]),
      filter: { owner: "self", category: "Leader", ...(leaderPowerSetM[1] ? { traits: [leaderPowerSetM[1]] } : {}) },
      until: "nextOppTurnEnd",
    };

  // RETURN_HAND any count — "將自己場上任意張數的角色卡放回手牌"
  if (s.includes("任意張數") && s.includes("放回手牌"))
    return { type: "RETURN_HAND", count: Infinity, filter: { owner: "self", category: "Character" } };

  // POWER_SET own leader reversed order — "在下一個對手回合結束前，自己的領航卡原本的力量值變更成N"
  const leaderPowerSetRevM = s.match(
    /在下一個對手(?:結束階段結束|回合結束)前[，,]自己(?:擁有《([^》]+)》特徵)?的領航卡原本的力量值變更成(\d+)/,
  );
  if (leaderPowerSetRevM)
    return {
      type: "POWER_SET",
      power: parseInt(leaderPowerSetRevM[2]),
      filter: { owner: "self", category: "Leader", ...(leaderPowerSetRevM[1] ? { traits: [leaderPowerSetRevM[1]] } : {}) },
      until: "nextOppTurnEnd",
    };

  // AUTO_KO_IN_BATTLE — "這張角色卡和對手的角色卡對戰且對戰結束時，也KO對戰的對手角色卡"
  if (s.includes("對戰且對戰結束時") && s.includes("KO對戰的對手角色卡"))
    return { type: "GRANT_KEYWORD", keyword: "AUTO_KO_IN_BATTLE", filter: { self: true } };

  // DEPLOY_REVEALED_PICK — "使公開卡片的其中N張登場，若另1張為費用M以下時以休息狀態登場"
  const deployRevealedPickM = s.match(/使公開卡片的其中(\d+)張登場[，,]若另1張為費用(\d+)以下時以休息狀態登場/);
  if (deployRevealedPickM)
    return { type: "DEPLOY_REVEALED_PICK", deployCount: parseInt(deployRevealedPickM[1]), restIfCostLte: parseInt(deployRevealedPickM[2]) };

  // Complex conditional DEPLOY from reveal (other patterns) — return NULL_EFFECT
  if (s.includes("使公開卡片的其中") && s.includes("登場"))
    return { type: "NULL_EFFECT" };

  // SELF_KO — "KO這張角色卡" or "KO該張角色卡" or "即KO該張角色卡"
  if ((s.includes("KO這張角色卡") || s.includes("KO該張角色卡") || s === "KO") && !s.includes("不會"))
    return { type: "SELF_KO" };

  // KO own chars as cost — "KO自己費用N以下擁有《X》特徵任意張數的角色卡" / "KO除了這張角色卡以外N張自己的角色卡"
  const koSelfCostM = s.match(/KO自己費用(\d+)以下(.+?)任意張數的角色卡/);
  if (koSelfCostM)
    return { type: "KO", count: Infinity, filter: parseCardFilter("自己費用" + koSelfCostM[1] + "以下" + koSelfCostM[2] + "的角色卡"), isOptional: true };
  const koSelfExclM = s.match(/KO除了這張角色卡以外(\d+)張自己的角色卡/);
  if (koSelfExclM)
    return { type: "KO", count: parseInt(koSelfExclM[1]), filter: { owner: "self", category: "Character" } };

  // "將公開的(手牌)卡片放置在卡組上面" — place the revealed hand card on top of deck
  if (s.includes("公開的卡片") && s.includes("放置在卡組上面"))
    return { type: "HAND_TO_DECK", count: 1, canPlaceOnTop: true };

  // DRAW to hand size N — "抽取卡片使自己的手牌有N張"
  const drawToSizeM = s.match(/抽取卡片使自己的手牌有(\d+)張/);
  if (drawToSizeM)
    return { type: "DRAW_TO_SIZE", targetSize: parseInt(drawToSizeM[1]) };

  // DRAW based on cards returned to deck — "依放回卡組的卡片張數抽卡片" / "依放到卡組的卡片張數抽卡片"
  if ((s.includes("依放回卡組") || s.includes("依放到卡組")) && s.includes("抽卡片"))
    return { type: "DRAW_PER_RETURNED" };

  // HAND_TO_DECK all — "將自己的手牌全部放回卡組"
  if (s.includes("手牌全部放回卡組") || s.includes("手牌全數放回卡組"))
    return { type: "HAND_TO_DECK", count: Infinity, canPlaceOnTop: false };

  // DISCARD_ALL — "廢棄自己全數手牌" / "廢棄自己的手牌使手牌只有N張" / "雙方各自廢棄自身的手牌使手牌只有N張"
  const discardToSizeM = s.match(/廢棄.{0,3}手牌使手牌只有(\d+)張/);
  if (discardToSizeM)
    return { type: "DISCARD_TO_SIZE", targetSize: parseInt(discardToSizeM[1]) };
  if (s.includes("廢棄自己全數手牌") || s.includes("廢棄自己的手牌"))
    return { type: "DISCARD", count: Infinity, filter: { zone: "hand", owner: "self" } };

  // OPPONENT_ADD_DON — "對手從咚‼卡組追加N張活動狀態的咚‼卡"
  const oppAddDonM = s.match(/對手從咚‼卡組追加(\d+)張活動狀態的咚‼卡/);
  if (oppAddDonM)
    return { type: "OPPONENT_ADD_DON", count: parseInt(oppAddDonM[1]) };

  // SELF_TO_TRASH for stage card — "將這張舞台卡放置在廢棄區"
  if (s.includes("這張舞台卡") && s.includes("放置在廢棄區"))
    return { type: "SELF_TO_TRASH" };

  // DEPLOY named chars from hand multiple — "使自己手牌中費用N的「X」和「X」...最多各N張登場"
  if (s.includes("手牌中費用") && s.includes("最多各") && s.includes("登場"))
    return { type: "NULL_EFFECT" };

  // DEPLOY_REVEALED_PICK — "使公開卡片的其中N張登場，若另1張為費用M以下時以休息狀態登場"
  // REVEAL from hand with complex filter — "公開最多N張自己手牌中除了「X」以外擁有《X》特徵費用N以下的角色卡"
  const revealHandM = s.match(/公開最多(\d+)張自己(?:手牌中)?(.+?角色卡)/);
  if (revealHandM)
    return { type: "REVEAL_HAND", count: parseInt(revealHandM[1]), filter: parseCardFilter("自己手牌中" + revealHandM[2]) };

  // REVEAL from deck (named card) — "公開最多N張自己卡組中的「X」"
  const revealDeckNamedM = s.match(/公開最多(\d+)張自己卡組中的「([^」]+)」/);
  if (revealDeckNamedM)
    return { type: "REVEAL_DECK", count: parseInt(revealDeckNamedM[1]), filter: { owner: "self", name: revealDeckNamedM[2] } };

  // REVEAL hand (all) — "公開手牌" / "公開"
  if (s === "公開手牌" || s === "公開") return { type: "REVEAL_HAND", count: Infinity, filter: { owner: "self", zone: "hand" } };

  // NULL timing fragments and orphan condition clauses
  if (s === "廢棄") return null;
  if (s === "KO") return null;
  if (s === "發動") return null;
  if (s.includes("對手發動或事件卡時")) return null;
  if (s.includes("自己發動事件卡時") && s.includes("手牌在") && s.includes("以下")) return null;
  if (s.includes("使自己原本沒有效果的角色卡從手牌中登場時")) return null;
  if (s.includes("手牌中這張卡片無法以效果登場")) return { type: "NULL_EFFECT" };

  // DECK_TO_TRASH mirroring discard count — "將自己卡組上面、和廢棄卡片相同張數的卡片放置在廢棄區"
  if (s.includes("和廢棄卡片相同張數") && s.includes("卡組上面"))
    return { type: "DECK_TO_TRASH", count: 1, mirrorDiscard: true };

  // TRASH own chars by power as optional cost — "可將N張自己力量值N以上紅色的角色卡放置到廢棄區"
  const trashOwnByPowerM = s.match(/可將(\d+)張自己力量值(\d+)以上(.+?)角色卡放置(?:在|到)廢棄區/);
  if (trashOwnByPowerM)
    return {
      type: "KO",
      count: parseInt(trashOwnByPowerM[1]),
      filter: parseCardFilter("自己力量值" + trashOwnByPowerM[2] + "以上" + trashOwnByPowerM[3] + "角色卡"),
      isOptional: true,
    };
  // "可將N張自己擁有包含『X』特徵的角色卡放置到廢棄區"
  const trashOwnByTraitM = s.match(/可將(\d+)張自己(?:擁有包含『([^』]+)』特徵)?的角色卡放置(?:在|到)廢棄區/);
  if (trashOwnByTraitM)
    return {
      type: "KO",
      count: parseInt(trashOwnByTraitM[1]),
      filter: parseCardFilter("自己" + (trashOwnByTraitM[2] ? "擁有包含『" + trashOwnByTraitM[2] + "』特徵" : "") + "的角色卡"),
      isOptional: true,
    };

  // COST_SET on effectless chars this turn — "將最多N張對手原本沒有效果的角色卡，在這個回合，費用降為N"
  const costSetM = s.match(/最多(\d+)張對手原本沒有效果的角色卡[，,]在這個回合[，,]費用降為(\d+)/);
  if (costSetM)
    return { type: "COST_SET", count: parseInt(costSetM[1]), targetCost: parseInt(costSetM[2]), filter: { owner: "opponent", category: "Character", noEffect: true }, until: "turn" };

  // DEPLOY named char from trash — "使N張自己廢棄區中的「X」登場"
  const deployTrashNamedM = s.match(/使(\d+)張自己廢棄區中的「([^」]+)」登場/);
  if (deployTrashNamedM)
    return { type: "DEPLOY", count: parseInt(deployTrashNamedM[1]), filter: { owner: "self", zone: "trash", name: deployTrashNamedM[2] } };

  // DEPLOY named char from hand — "使N張自己手牌中的「X」登場"
  const deployHandNamedM = s.match(/使(\d+)張自己手牌中的「([^」]+)」登場/);
  if (deployHandNamedM)
    return { type: "DEPLOY", count: parseInt(deployHandNamedM[1]), filter: { owner: "self", zone: "hand", name: deployHandNamedM[2] } };

  // SELF_DEPLOY_FROM_TRASH alternate — "使廢棄區中的這張角色卡，以休息狀態登場"
  if (s.includes("廢棄區中的這張角色卡") && s.includes("登場"))
    return { type: "SELF_DEPLOY_FROM_TRASH", deployState: s.includes("休息狀態") ? "rest" : "active" };
  // On KO by opponent → self-redeploy from trash — "這張角色卡因對手的效果遭到KO時，使廢棄區中的這張角色卡，以休息狀態登場"
  if (s.includes("因對手的效果遭到KO時") && s.includes("登場"))
    return { type: "SELF_DEPLOY_FROM_TRASH", deployState: s.includes("休息狀態") ? "rest" : "active" };

  // TRASH to end of turn — "這回合結束時，將N張自己擁有《X》特徵的角色卡放置到廢棄區"
  const eotTrashM = s.match(/這回合結束時[，,]將(\d+)張(.+?)放置(?:在|到)廢棄區/);
  if (eotTrashM)
    return { type: "KO", count: parseInt(eotTrashM[1]), filter: parseCardFilter(eotTrashM[2]), until: "endOfTurn" };

  // CANNOT_ATTACK_LEADER — "在這個回合，自己無法攻擊領航卡"
  if (s.includes("無法攻擊領航卡"))
    return { type: "GRANT_KEYWORD", keyword: "CANNOT_ATTACK_LEADER", filter: { self: true }, until: "turn" };

  // NEGATE_EFFECTS on own leader + non-trait chars — "自己的領航卡和未擁有包含『X』特徵的角色卡全數，效果無效"
  if (s.includes("效果無效") && s.includes("自己的領航卡") && s.includes("全數"))
    return { type: "NULL_EFFECT" };
  // NEGATE_EFFECTS on all opponent cards — "對手的領航卡和角色卡全數，在這個回合，效果無效"
  if (s.includes("效果無效") && s.includes("對手的領航卡") && s.includes("全數"))
    return { type: "NULL_EFFECT" };

  // UNREST own chars with trait — "最多N張自己費用N以下擁有《X》特徵的角色卡，置為活動狀態"
  const unrestOwnCharsM = s.match(/最多(\d+)張(.+?)[，,]置為活動狀態/);
  if (unrestOwnCharsM && !s.includes("咚‼"))
    return { type: "UNREST", count: parseInt(unrestOwnCharsM[1]), filter: parseCardFilter(unrestOwnCharsM[2]) };

  // OPPONENT_CHOOSE_HAND — "自己的手牌讓對手選擇N張" (opponent discards N from your hand)
  const oppChooseHandM = s.match(/自己的手牌讓對手選擇(\d+)張/);
  if (oppChooseHandM)
    return { type: "DISCARD", count: parseInt(oppChooseHandM[1]), filter: { owner: "self", zone: "hand" }, chooser: "opponent" };

  // SELECT opponent hand — "選擇對手的N張手牌" / "選擇最多N張對手休息狀態的角色卡"
  const selectOppHandM = s.match(/選擇(?:最多)?(\d+)張對手(?:休息狀態的角色卡|的手牌)/) ||
    s.match(/選擇對手的(\d+)張手牌/);
  if (selectOppHandM) {
    const count = parseInt(selectOppHandM[1]);
    if (s.includes("手牌")) return { type: "DISCARD", count, filter: { owner: "opponent", zone: "hand" }, chooser: "self" };
    return { type: "NULL_EFFECT" };
  }

  // DEPLOY trash (range) — "使最多N張自己廢棄區中力量值N至N擁有《X》特徵的角色卡，以休息狀態登"
  const deployTrashRangeM = s.match(/使最多(\d+)張自己廢棄區中力量值(\d+)至(\d+)(.+?)登/);
  if (deployTrashRangeM)
    return {
      type: "DEPLOY",
      count: parseInt(deployTrashRangeM[1]),
      filter: parseCardFilter("自己廢棄區" + deployTrashRangeM[4]),
      deployState: s.includes("休息狀態") ? "rest" : "active",
    };

  // ON_EFFECT_DISCARD — "因效果而廢棄自己手牌時，這張角色卡，在這個回合，效果無效" (self-conditional)
  if (s.includes("因效果而廢棄自己手牌時")) return { type: "NULL_EFFECT" };

  // ON_REST_BY_OPP — "這張角色卡因對手的效果置為休息狀態時，可將N張自己場上的咚‼卡放回咚‼卡組"
  if (s.includes("因對手的效果置為休息狀態時") && s.includes("咚‼卡放回"))
    return { type: "NULL_EFFECT" };

  // SELF_DAMAGE — "自己將受到N傷害"
  const selfDamageM = s.match(/自己將受到(\d+)傷害/);
  if (selfDamageM)
    return { type: "SELF_DAMAGE", count: parseInt(selfDamageM[1]) };

  // REMAINDER_TOP_OR_BOTTOM alt — "將該張卡片放置在卡組上面或下面"
  if (s.includes("放置在卡組上面或下面") || s.includes("放置到卡組上面或下面"))
    return { type: "REMAINDER_TOP_OR_BOTTOM" };

  // OPP_CHOOSE_REPLACE — "選擇對手費用N以下的角色卡則替換成對手費用N以下的角色卡"
  if (s.includes("替換成對手費用") && s.includes("以下的角色卡"))
    return { type: "NULL_EFFECT" };

  // FIELD_TO_LIFE (opponent chars to opp life) — "將最多N張/將N張...以正面朝上放置在對手的生命值區上面或下面"
  const fieldToOppLifeM = s.match(/將(?:最多)?(\d+)張(.+?)，以正面朝上放置在對手的生命值區上面或下面/);
  if (fieldToOppLifeM)
    return {
      type: "FIELD_TO_LIFE",
      count: parseInt(fieldToOppLifeM[1]),
      filter: parseCardFilter(fieldToOppLifeM[2]),
      faceUp: true,
      targetOwner: "opponent",
      choosePosition: true,
    };

  // TRASH_RECYCLE — "可將N張自己廢棄區中的卡片放回卡組並洗牌"
  const trashRecycleM = s.match(/可將(\d+)張自己廢棄區中的卡片放回卡組並洗牌/);
  if (trashRecycleM)
    return { type: "TRASH_RECYCLE", count: parseInt(trashRecycleM[1]), isOptional: true };

  // DEPLOY trash range — already above; also handle "以休息狀態登場" cut-off case
  // EFFECT_LOCK self this turn — "這張角色卡，在這個回合，效果無效"
  if ((s.includes("這張角色卡") || s.includes("被選擇的角色卡")) && s.includes("在這個回合") && s.includes("效果無效"))
    return { type: "NULL_EFFECT" };

  // DON!! return timing fragment — "自己場上的咚‼卡因為自己的效果被放回咚‼卡組時"
  if (s.includes("咚‼卡被放回咚‼卡組時") || s.includes("咚‼卡因為自己的效果被放回咚‼卡組時"))
    return null;

  // GRANT_KEYWORD on own chars until next opponent end — "自己的角色卡全數，在下一個對手回合結束前，不會因對手的效果而遭到KO"
  if (s.includes("角色卡全數") && s.includes("在下一個對手回合結束前") && s.includes("在這個回合"))
    return { type: "NULL_EFFECT" };

  // SELF_ATTACK_LOCK with cost threshold — "無法攻擊對手原本費用N以下的角色卡"
  const cannotAttackCostM = s.match(/無法攻擊對手原本費用(\d+)以下的角色卡/);
  if (
    (s.includes("這張領航卡") || s.includes("這張角色卡")) &&
    cannotAttackCostM
  ) {
    return {
      type: "GRANT_KEYWORD",
      keyword: "CANNOT_ATTACK",
      costMax: Number(cannotAttackCostM[1]),
      filter: { self: true },
    };
  }
  // SELF_ATTACK_LOCK — "這張領航卡無法攻擊" / "這張角色卡無法進行攻擊"
  if (
    (s.includes("這張領航卡") || s.includes("這張角色卡")) &&
    (s.includes("無法攻擊") || s.includes("無法進行攻擊"))
  )
    return {
      type: "GRANT_KEYWORD",
      keyword: "CANNOT_ATTACK",
      filter: { self: true },
    };

  // ALTERNATE_NAMES — "在規則上，這張卡片的卡片名稱也可視為「X」和「Y」"
  const altNamesM = s.match(
    /在規則上，這張卡片的卡片名稱也可視為(「[^」]+」(?:和「[^」]+」)*)/,
  );
  if (altNamesM) {
    const names = [...altNamesM[1].matchAll(/「([^」]+)」/g)].map((m) => m[1]);
    return { type: "ALTERNATE_NAMES", names };
  }

  // Deck-building / rules-text annotations — not in-game actions
  if (s.startsWith("在規則上")) return null;

  // Parenthetical rule clarifications (Rush note, damage-value note, etc.) — not in-game actions
  if (s.startsWith("(") && s.endsWith(")")) return null;

  return { type: "UNKNOWN", raw: s };
}

// ─── Card Filter Parser (also exported for effectActions) ─────────────────────

export function parseCardFilter(text) {
  if (!text) return {};
  const f = {};

  if (text.includes("對手") || text.includes("對方")) f.owner = "opponent";
  else if (text.includes("自己") || text.includes("持有者")) f.owner = "self";

  if (text.includes("手牌") && text.includes("廢棄區"))
    f.zone = "hand_or_trash";
  else if (text.includes("手牌")) f.zone = "hand";
  else if (text.includes("卡組")) f.zone = "deck";
  else if (text.includes("廢棄區")) f.zone = "trash";
  else if (text.includes("生命值") && !text.includes("生命值卡張數以下")) f.zone = "life";
  else if (
    text.includes("場上") ||
    text.includes("角色卡") ||
    text.includes("領航卡")
  )
    f.zone = "field";

  // "「X」或事件卡" / "事件卡或「X」" — named card OR event card (OR condition)
  const nameOrEventM =
    text.match(/「([^」]+)」或事件卡/) || text.match(/事件卡或「([^」]+)」/);
  if (nameOrEventM) {
    f.orFilters = [{ name: nameOrEventM[1] }, { category: "Event" }];
  }

  if (!f.orFilters) {
    if (text.includes("角色卡") && text.includes("領航卡")) {
      f.category = "Character";
      f.includesLeader = true; // leader or character
    } else if (text.includes("事件卡") && text.includes("舞台卡")) {
      f.orCategories = ["Event", "Stage"];
    } else if (text.includes("角色卡")) f.category = "Character";
    else if (text.includes("事件卡")) f.category = "Event";
    else if (text.includes("舞台卡")) f.category = "Stage";
    else if (text.includes("領航卡")) f.category = "Leader";
  }

  // Dynamic cost bound: "費用數值在對手的生命值卡張數以下" — cost ≤ opponent's current life count, resolved at runtime
  if (text.includes("費用數值在對手的生命值卡張數以下") || text.includes("費用數值在對方的生命值卡張數以下")) {
    f.maxCostByOpponentLifeCount = true;
  }

  // Dynamic cost bound: "費用數值在自己場上的咚卡張數以下" — resolved at runtime from costArea.length
  if (text.includes("費用數值在自己場上的咚") && text.includes("以下")) {
    f.maxCostByFieldDonCount = true;
  } else if (!f.maxCostByOpponentLifeCount) {
    const costRangeM = text.match(/費用(\d+)至(\d+)/);
    if (costRangeM) {
      f.costMin = parseInt(costRangeM[1]);
      f.costMax = parseInt(costRangeM[2]);
    } else {
      const costM = text.match(/費用(\d+)(以下|以上)?/);
      if (costM) {
        f.cost = parseInt(costM[1]);
        f.costOp = costM[2] === "以上" ? "gte" : costM[2] === "以下" ? "lte" : "eq";
      }
    }
  }
  const powerM = text.match(/力量值(\d+)(以下|以上)?/);
  if (powerM) {
    f.power = parseInt(powerM[1]);
    f.powerOp =
      powerM[2] === "以上" ? "gte" : powerM[2] === "以下" ? "lte" : "eq";
  }

  if (text.includes("卡片名稱不同")) f.uniqueName = true;

  // 《X》 = exact trait match; 『X』 = contains match (e.g. 前B・W satisfies 『B・W』)
  const exactTraits = [...text.matchAll(/《([^》]+)》/g)].map((m) => m[1]);
  const containsTraits = [...text.matchAll(/『([^』]+)』/g)].map((m) => m[1]);
  if (exactTraits.length === 1) f.trait = exactTraits[0];
  else if (exactTraits.length > 1) f.traits = exactTraits;
  if (containsTraits.length === 1) f.traitContains = containsTraits[0];
  else if (containsTraits.length > 1) f.traitsContains = containsTraits;

  // "擁有《TRAIT》特徵或(ATTR)屬性" → OR: trait OR attribute (e.g. ST12-003)
  if (!f.orFilters && f.trait) {
    const traitOrAttrM = text.match(/擁有《([^》]+)》特徵或\(([^)]+)\)屬性/);
    if (traitOrAttrM) {
      const _attrMap = {
        斬: "Slash",
        打: "Strike",
        射: "Ranged",
        特: "Special",
        知: "Wisdom",
      };
      const attrName = _attrMap[traitOrAttrM[2]];
      if (attrName) {
        f.orFilters = [{ trait: traitOrAttrM[1] }, { attribute: attrName }];
        delete f.trait;
      }
    }
  }

  // "擁有《TRAIT》特徵的角色卡或「NAME」" → OR: (char with trait + cost constraint) OR (named char)
  if (!f.orFilters) {
    const traitOrNameM = text.match(
      /擁有《([^》]+)》特徵的角色卡或「([^」]+)」/,
    );
    if (traitOrNameM) {
      const costBranch = {};
      if (f.maxCostByFieldDonCount) {
        costBranch.maxCostByFieldDonCount = true;
        delete f.maxCostByFieldDonCount;
      }
      if (f.cost !== undefined) {
        costBranch.cost = f.cost;
        costBranch.costOp = f.costOp;
        delete f.cost;
        delete f.costOp;
      }
      f.orFilters = [
        { category: "Character", trait: traitOrNameM[1], ...costBranch },
        { category: "Character", name: traitOrNameM[2] },
      ];
      delete f.category;
      delete f.trait;
    }
  }

  const excludeNameM = text.match(/除了「(.+?)」以外/);
  if (excludeNameM) f.excludeName = excludeNameM[1].replace(/‼/g, "!!");
  const allNamesM = !excludeNameM && !f.orFilters
    ? [...text.matchAll(/「([^」]+)」/g)].map(m => m[1])
    : [];
  if (allNamesM.length === 1) f.name = allNamesM[0];
  else if (allNamesM.length > 1) f.names = allNamesM;

  // DON!! attached condition: 已附加N張以上咚‼卡
  const donM = text.match(/已附加(\d+)?張?以上?咚‼卡|已附加咚‼卡/);
  if (donM) f.donAttached = donM[1] ? parseInt(donM[1]) : 1;

  // DON!! card type (e.g. "1張自己的咚‼卡" as a REST/cost target)
  // Exclude the "費用數值在自己場上的咚‼卡張數以下" phrase — that's a cost bound, not a DON!! target
  const donCheckText = text.replace(/費用數值在自己場上的咚‼卡張數以下/, "");
  if (donCheckText.includes("咚‼") && !text.includes("已附加"))
    f.cardType = "don";

  // "this card" self-reference — distinguish exclusion ("除了這張...以外") from targeting ("這張")
  if (text.includes("除了這張") && text.includes("以外")) f.excludeSelf = true;
  else if (text.includes("這張")) f.self = true;

  if (text.includes("休息狀態")) f.state = "rest";
  else if (text.includes("活動狀態")) f.state = "active";

  const ownedAbilityM = text.match(/持有【([^】]+)】/);
  if (ownedAbilityM) f.hasAbility = ownedAbilityM[1];

  // "「NAME」或擁有《TRAIT》特徵" → OR: named card OR trait card (e.g. OP15-101)
  if (!f.orFilters && f.name && f.trait) {
    const nameOrTraitM = text.match(/「([^」]+)」或擁有《([^》]+)》特徵/);
    if (nameOrTraitM) {
      f.orFilters = [{ name: nameOrTraitM[1] }, { trait: nameOrTraitM[2] }];
      delete f.name;
      delete f.trait;
    }
  }

  // "擁有《TRAIT》特徵或持有【ABILITY】" → OR: trait OR hasAbility (e.g. OP05-002 Belo Betty)
  if (!f.orFilters && f.trait && f.hasAbility) {
    const traitOrAbilityM = text.match(/擁有《([^》]+)》特徵或持有【([^】]+)】/);
    if (traitOrAbilityM) {
      const baseFilter = { category: f.category, owner: f.owner };
      if (!baseFilter.category) delete baseFilter.category;
      if (!baseFilter.owner) delete baseFilter.owner;
      f.orFilters = [
        { ...baseFilter, trait: traitOrAbilityM[1] },
        { ...baseFilter, hasAbility: traitOrAbilityM[2] },
      ];
      delete f.trait;
      delete f.hasAbility;
    }
  }

  const colorMap = {
    紫色: "Purple",
    紅色: "Red",
    藍色: "Blue",
    黑色: "Black",
    綠色: "Green",
    黃色: "Yellow",
  };
  for (const [zh, en] of Object.entries(colorMap)) {
    if (text.includes(zh)) {
      f.color = en;
      break;
    }
  }

  // OR condition: "擁有(X)屬性的卡片或[color]的[category]" — both branches must be preserved
  const attrMap2 = {
    斬: "Slash",
    打: "Strike",
    射: "Ranged",
    特: "Special",
    知: "Wisdom",
  };
  const attrOrM = text.match(
    /擁有\(([^)]+)\)屬性的卡片或([紫紅藍黑綠黃]色)的(事件卡|角色卡|舞台卡)/,
  );
  if (attrOrM) {
    const attrName = attrMap2[attrOrM[1]];
    const colorName = colorMap[attrOrM[2]];
    const catName = { 事件卡: "Event", 角色卡: "Character", 舞台卡: "Stage" }[
      attrOrM[3]
    ];
    if (attrName && colorName && catName) {
      f.orFilters = [
        { attribute: attrName },
        { category: catName, color: colorName },
      ];
      delete f.category;
      delete f.color;
    }
  }

  return f;
}

// ─── English Effect Parser ────────────────────────────────────────────────────
// Parses English (EN) card effect text into the same clause/action objects
// produced by the CN parser, enabling EN-first parsing in the practice engine.
// All action types (DRAW, KO, REST, POWER_MOD, DEPLOY, …) are identical —
// only the text patterns differ. The downstream engine (effectActions, gameState)
// is 100% language-agnostic and requires no changes.

/** Parse a signed power/cost delta from EN text ("−2000", "+1000", "-3000"). */
function parseENDelta(str) {
  return parseInt(str.replace(/,/g, '').replace('−', '-').replace('?', '-'));
}

/**
 * Extract a card filter object from an EN descriptive phrase.
 * Produces the same filter schema as parseCardFilter() (CN).
 */
function parseCardFilterEN(text) {
  if (!text) return {};
  const f = {};

  // --- Owner ---
  if (/\byour opponent'?s?\b/i.test(text)) f.owner = 'opponent';
  else if (/\b(your|owner'?s?)\b/i.test(text)) f.owner = 'self';

  // --- Zone ---
  if (/\bfrom your hand\b|\bin your hand\b/i.test(text)) f.zone = 'hand';
  else if (/\bfrom (?:the top of )?(?:your|their|the) deck\b/i.test(text)) f.zone = 'deck';
  else if (/\bfrom (?:your|their) trash\b/i.test(text)) f.zone = 'trash';
  else if (/\bLife cards?\b/i.test(text)) f.zone = 'life';

  // --- Category ---
  if (/\bLeader\b.*\bCharacter\b|\bCharacter\b.*\bor\b.*\bLeader\b/i.test(text)) {
    f.category = 'Character'; f.includesLeader = true;
  } else if (/\bCharacters?\b|\bCharacter cards?\b/i.test(text)) {
    f.category = 'Character';
  } else if (/\bEvents?\b|\bEvent cards?\b/i.test(text)) {
    f.category = 'Event';
  } else if (/\bStages?\b|\bStage cards?\b/i.test(text)) {
    f.category = 'Stage';
  } else if (/\bLeader(?:\s+cards?)?\b/i.test(text)) {
    f.category = 'Leader';
  }

  // --- Trait: {TraitName} ---
  const traits = [...text.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
  if (traits.length === 1) f.trait = traits[0];
  else if (traits.length > 1) f.traits = traits;

  // --- Cost ---
  // Dynamic cost bound: cost ≤ number of DON!! cards on field (resolved at runtime)
  if (/equal to or less than the number of DON(?:!!|‼) cards? on (?:your|their) field/i.test(text)) {
    f.maxCostByFieldDonCount = true;
  }
  const costLeM = text.match(/(?:with (?:a )?cost of |cost )(\d+) or less/i);
  const costGeM = text.match(/(?:with (?:a )?cost of |cost )(\d+) or more/i);
  if (!f.maxCostByFieldDonCount) {
    if (costLeM)      { f.cost = parseInt(costLeM[1]); f.costOp = 'lte'; }
    else if (costGeM) { f.cost = parseInt(costGeM[1]); f.costOp = 'gte'; }
  }

  // --- Power ---
  const powerLeM = text.match(/(\d[\d,]*) power or less/i);
  const powerGeM = text.match(/(\d[\d,]*) power or more/i);
  if (powerLeM)      { f.power = parseInt(powerLeM[1].replace(/,/g, '')); f.powerOp = 'lte'; }
  else if (powerGeM) { f.power = parseInt(powerGeM[1].replace(/,/g, '')); f.powerOp = 'gte'; }

  // --- Named card [CardName] — exclude keyword brackets ---
  const SKIP_BRACKETS = new Set([
    ...TIMING_KW, ...ACTIVATED_KW, ...CONTINUOUS_KW, ...PASSIVE_KW,
    'Once Per Turn', 'DON!! x1', 'DON!! x2', 'DON!! x3', 'DON!! x4',
    'DON!! x5', 'DON!! x6', 'DON!! x7', 'DON!! x8', 'DON!! x9',
    'DON‼ x1', 'DON‼ x2', 'DON‼ x3', 'DON‼ x4',
    'DON‼ x5', 'DON‼ x6', 'DON‼ x7', 'DON‼ x8', 'DON‼ x9',
    'Rush: Character',
  ]);
  const nameMs = [...text.matchAll(/\[([^\]]+)\]/g)]
    .map(m => m[1])
    .filter(n => !SKIP_BRACKETS.has(n) && !/DON(?:!!|‼) ?x?\d/i.test(n) && !/Once Per/i.test(n));
  if (nameMs.length === 1) f.name = nameMs[0];
  else if (nameMs.length > 1) f.names = nameMs;

  // "[CardName] or {TraitName} type" → OR filter (e.g. OP15-101: reveal [Mont Blanc Noland] or {Shandian Warrior})
  if (!f.orFilters && f.name && f.trait) {
    const nameOrTraitM = text.match(/\[([^\]]+)\] or \{([^}]+)\}/i);
    if (nameOrTraitM && !SKIP_BRACKETS.has(nameOrTraitM[1])) {
      f.orFilters = [{ name: nameOrTraitM[1] }, { trait: nameOrTraitM[2] }];
      delete f.name;
      delete f.trait;
    }
  }

  // --- Attribute: <Slash>, <Strike>, etc. ---
  const attrM = text.match(/<([^>]+)>(?:\s+attribute)?/i);
  if (attrM) f.attribute = attrM[1];

  // --- State ---
  if (/\brested\b/i.test(text)) f.state = 'rest';
  else if (/\bactive\b/i.test(text) && !/\bset.+as active\b/i.test(text)) f.state = 'active';

  // --- DON!! card target (not DON!! deck, and not a dynamic cost bound referencing DON!! count) ---
  if (/DON(?:!!|‼)/i.test(text) && !/DON(?:!!|‼) deck/i.test(text) && !f.maxCostByFieldDonCount) f.cardType = 'don';

  // --- Self / exclude-self ---
  if (/\bother than this\b/i.test(text)) f.excludeSelf = true;
  else if (/\bthis (?:Character|Leader|card|Stage)\b/i.test(text)) f.self = true;

  return f;
}

/**
 * Parse an EN "If <condition>" clause into the condition object format
 * that evaluateCondition() in effectActions.js understands.
 */
function parseConditionEN(text) {
  if (!text) return null;
  const c = { raw: text };

  // "your Leader's type includes {X}" / "your Leader has the {X} type" / "your Leader is [Name]"
  if (/\byour Leader'?s?\b/i.test(text)) {
    c.subject = 'leader'; c.owner = 'self'; c.predicate = 'has';
    const traitM = text.match(/\{([^}]+)\}/);
    if (traitM) c.trait = traitM[1];
    const nameM = [...text.matchAll(/\[([^\]]+)\]/g)]
      .map(m => m[1])
      .find(n => !TIMING_KW.has(n) && !PASSIVE_KW.has(n));
    if (nameM) { c.name = nameM; c.predicate = 'is'; }
    return c;
  }

  // "your opponent's Leader's type includes {X}"
  if (/\byour opponent'?s?\b.*\bLeader\b/i.test(text)) {
    c.subject = 'leader'; c.owner = 'opponent'; c.predicate = 'has';
    const traitM = text.match(/\{([^}]+)\}/);
    if (traitM) c.trait = traitM[1];
    return c;
  }

  // "you have [N or more] {X} type Characters"
  if (/\byou have\b.*\bCharacter\b/i.test(text) || /\byour.+Characters\b/i.test(text)) {
    c.subject = 'characters'; c.owner = 'self'; c.predicate = 'has';
    const traitM = text.match(/\{([^}]+)\}/);
    if (traitM) c.trait = traitM[1];
    const countM = text.match(/(\d+) or (?:more|fewer|less)/i);
    if (countM) { c.count = parseInt(countM[1]); c.countOp = /more/i.test(text) ? 'gte' : 'lte'; }
    return c;
  }

  // "you have N or fewer cards in your hand" / "your opponent has N or more cards in their hand"
  if (/\bhand\b/i.test(text)) {
    c.subject = 'hand';
    c.owner = /\byour opponent\b/i.test(text) ? 'opponent' : 'self';
    const countM = text.match(/(\d+) or (?:more|fewer|less)/i);
    if (countM) { c.count = parseInt(countM[1]); c.countOp = /more/i.test(text) ? 'gte' : 'lte'; }
    return c;
  }

  // "you have N or more cards in your trash" / "your opponent has N or more cards in their trash"
  if (/\btrash\b/i.test(text)) {
    c.subject = 'trash';
    c.owner = /\byour opponent\b/i.test(text) ? 'opponent' : 'self';
    const countM = text.match(/(\d+) or (?:more|fewer|less)/i);
    if (countM) { c.count = parseInt(countM[1]); c.countOp = /more/i.test(text) ? 'gte' : 'lte'; }
    return c;
  }

  // "you have N or fewer Life cards" / "N or fewer cards in your Life"
  if (/\bLife cards?\b/i.test(text)) {
    c.subject = 'life'; c.owner = 'self';
    const countM = text.match(/(\d+) or (?:more|fewer|less)/i);
    if (countM) { c.count = parseInt(countM[1]); c.countOp = /more/i.test(text) ? 'gte' : 'lte'; }
    return c;
  }

  // "you have N or more DON!! cards on your field" / "your opponent has N or more DON!! cards"
  if (/\bDON(?:!!|‼)\b/i.test(text)) {
    c.subject = 'don_field';
    c.owner = /\byour opponent\b/i.test(text) ? 'opponent' : 'self';
    const countM = text.match(/(\d+) or (?:more|fewer|less)/i);
    if (countM) { c.count = parseInt(countM[1]); c.countOp = /more/i.test(text) ? 'gte' : 'lte'; }
    return c;
  }

  return c;
}

/**
 * Parse a single EN action sentence into an action object (same types as CN parser).
 * Receives the text AFTER keyword brackets have been stripped by parseBlockEN.
 */
function parseSentenceEN(s) {
  // Strip leading "/" (from dual-timing blocks like "[Main]/[Counter]")
  s = s.replace(/^\/+/, '').trim();
  // Strip any remaining leading [keyword] brackets not caught at block level
  s = s.replace(/^(?:\[[^\]]+\]\s*)+/, '').trim();
  // Strip sequential connector
  s = s.replace(/^Then,\s*/i, '').trim();
  // Strip trailing period and whitespace
  s = s.replace(/\.\s*$/, '').trim();
  // Strip parenthetical DON!! deck explanation at end of sentence
  s = s.replace(/\s*\(You may return the specified number of DON(?:!!|‼) cards from your field to your DON(?:!!|‼) deck\.?\)/gi, '').trim();
  // Normalize first letter to uppercase so all patterns can use literal caps
  if (s.length > 0) s = s.charAt(0).toUpperCase() + s.slice(1);

  if (!s) return null;

  // "…instead" replacement-clause remnants → null op
  if (/\binstead\b/i.test(s)) return { type: 'NULL_EFFECT' };
  // "K.O. it" / "Place the revealed card at the bottom" — contextual refs
  if (/^Place the revealed card/i.test(s)) return null;
  // "Draw cards equal to the number you returned" — variable draw (complex)
  if (/^Draw cards equal to the number/i.test(s)) return { type: 'NULL_EFFECT' };
  // "can (also) attack..." — attack-permission effects (not yet implemented)
  if (/can (?:also )?attack/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Your opponent returns N DON!! card from their field to their DON!! deck"
  if (/^Your opponent returns? (?:up to )?(\d+) DON(?:!!|‼) cards? from their field/i.test(s)) return { type: 'NULL_EFFECT' };

  // Strip sentence-level "You may " prefix so underlying patterns can match
  // (block-level optM only catches "You may X: Y" with a colon)
  if (/^You may /i.test(s)) {
    s = s.slice('You may '.length).trim();
    if (s.length > 0) s = s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Handle continuation "If X, action" conditions that survive after parseSentencesEN splits
  // (block-level ifCondM only strips the first condition; later ". Then, If…" sentences land here)
  const sentenceCondM = s.match(/^If (.+?), (?=[A-Za-z])/);
  if (sentenceCondM) {
    s = s.slice(sentenceCondM[0].length).trim();
    if (s.length > 0) s = s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ── DRAW ──
  // "Draw N and trash M cards from your hand" (compound)
  const drawTrashM = s.match(/^[Dd]raw (\d+) cards? and trash (\d+) cards? from your hand/i);
  if (drawTrashM) return [
    { type: 'DRAW', count: parseInt(drawTrashM[1]) },
    { type: 'DISCARD', count: parseInt(drawTrashM[2]), filter: { owner: 'self', zone: 'hand' } },
  ];
  const drawM = s.match(/^[Dd]raw (\d+) cards?/i);
  if (drawM) return { type: 'DRAW', count: parseInt(drawM[1]) };
  // "Draw up to N cards" — treat up-to as exact
  const drawUpToM = s.match(/^[Dd]raw up to (\d+) cards?/i);
  if (drawUpToM) return { type: 'DRAW', count: parseInt(drawUpToM[1]) };
  // "Draw cards so that you have N cards in your hand" / "Draw card(s) so that you have N"
  const drawToHandM = s.match(/^[Dd]raw cards?\(?s?\)? so that you have (\d+) cards?/i);
  if (drawToHandM) return { type: 'DRAW', count: parseInt(drawToHandM[1]) };
  // "Your opponent draws N cards" → non-implementable, suppress
  if (/^Your opponent draws? \d+/i.test(s)) return { type: 'NULL_EFFECT' };

  // ── K.O. ──
  const koAllM = s.match(/^K\.O\. all of (your (?:opponent'?s? )?)(.+)/i);
  if (koAllM) return { type: 'KO', count: Infinity, filter: parseCardFilterEN(koAllM[1] + koAllM[2]) };
  // "K.O. all Characters/rested Characters with a cost of N or less" (no owner prefix — opponent implied)
  const koAllNoOwnerM = s.match(/^K\.O\. all (?!of )(?:(rested|active) )?(Characters?|Leaders?|cards?)(.*)$/i);
  if (koAllNoOwnerM) {
    const stateQual = koAllNoOwnerM[1] ? (koAllNoOwnerM[1].toLowerCase() === 'rested' ? 'rested' : 'active') : null;
    const f = parseCardFilterEN("your opponent's " + koAllNoOwnerM[2] + koAllNoOwnerM[3]);
    if (stateQual) f.state = stateQual;
    return { type: 'KO', count: Infinity, filter: f };
  }

  // "K.O. all Characters other than this Character" — self-excluded mass KO
  const koAllExcludeM = s.match(/^K\.O\. all (.+?) (?:other than this (?:Character|card)|except this (?:Character|card))/i);
  if (koAllExcludeM) return { type: 'KO', count: Infinity,
    filter: { ...parseCardFilterEN('your opponent\'s ' + koAllExcludeM[1]), excludeSelf: true } };

  const koUpToM = s.match(/^K\.O\. up to (?:a total of )?(\d+) of (your (?:opponent'?s? )?)(.*)/i);
  if (koUpToM) return { type: 'KO', count: parseInt(koUpToM[1]), filter: parseCardFilterEN(koUpToM[2] + koUpToM[3]) };

  // "K.O. up to N Character/card" (no "of your") — opponent target implied
  const koUpToNoOwnerM = s.match(/^K\.O\. (?:up to )?(\d+) (?!of )((?:Character|Leader|Stage|card).+)/i);
  if (koUpToNoOwnerM) return { type: 'KO', count: parseInt(koUpToNoOwnerM[1]),
    filter: parseCardFilterEN('your opponent\'s ' + koUpToNoOwnerM[2]) };

  const koNM = s.match(/^K\.O\. (\d+) of (your (?:opponent'?s? )?)(.*)/i);
  if (koNM) return { type: 'KO', count: parseInt(koNM[1]), filter: parseCardFilterEN(koNM[2] + koNM[3]) };

  // ── POWER_MOD (Give +/-N power) ──
  const giveAllPwrM = s.match(/^Give all of (your (?:opponent'?s? )?)(.+?) ([+−\-?][\d,]+) power/i);
  if (giveAllPwrM) {
    return { type: 'POWER_MOD', delta: parseENDelta(giveAllPwrM[3]), count: Infinity,
      filter: parseCardFilterEN(giveAllPwrM[1] + giveAllPwrM[2]) };
  }

  const givePwrM = s.match(/^Give (?:up to (?:a total of )?)?(\d+) of (your (?:opponent'?s? )?)(.+?) ([+−\-?][\d,]+) power/i);
  if (givePwrM) {
    return { type: 'POWER_MOD', delta: parseENDelta(givePwrM[4]), count: parseInt(givePwrM[1]),
      filter: parseCardFilterEN(givePwrM[2] + givePwrM[3]) };
  }

  // ── COST_MOD (Give +/-N cost) ──
  const giveCostAllM = s.match(/^Give all of (your (?:opponent'?s? )?)(.+?) ([+−\-]\d+) cost/i);
  if (giveCostAllM) {
    return { type: 'COST_MOD', delta: parseENDelta(giveCostAllM[3]), count: Infinity,
      filter: parseCardFilterEN(giveCostAllM[1] + giveCostAllM[2]) };
  }

  const giveCostM = s.match(/^Give (?:up to (\d+) of )?(your (?:opponent'?s? )?)(.+?) ([+−\-]\d+) cost/i);
  if (giveCostM) {
    return { type: 'COST_MOD', delta: parseENDelta(giveCostM[4]),
      count: giveCostM[1] ? parseInt(giveCostM[1]) : Infinity,
      filter: parseCardFilterEN(giveCostM[2] + giveCostM[3]) };
  }

  // "Up to N of your X gains +N cost until..." pattern
  const upToCostM = s.match(/^Up to (\d+) of (your (?:opponent'?s? )?)(.+?) gains? ([+−\-]\d+) cost/i);
  if (upToCostM) {
    return { type: 'COST_MOD', delta: parseENDelta(upToCostM[4]), count: parseInt(upToCostM[1]),
      filter: parseCardFilterEN(upToCostM[2] + upToCostM[3]) };
  }
  const allGainCostM = s.match(/^All of (your (?:opponent'?s? )?)(.+?) gains? ([+−\-]\d+) cost/i);
  if (allGainCostM) {
    return { type: 'COST_MOD', delta: parseENDelta(allGainCostM[3]), count: Infinity,
      filter: parseCardFilterEN(allGainCostM[1] + allGainCostM[2]) };
  }
  // "The cost of playing {X} type Character cards [with a cost of N or more] is/will be reduced by N"
  const typePlayCostReduceM = s.match(/^The cost of playing (.+?) (?:cards?|Characters?) (?:\w+ .+?)? ?(?:is |will be )?(?:reduced|lowered) by (\d+)/i);
  if (typePlayCostReduceM) return { type: 'COST_MOD', delta: -parseInt(typePlayCostReduceM[2]),
    filter: parseCardFilterEN(typePlayCostReduceM[1]) };
  // "Give blue Events in your hand −N cost" — hand cost mod
  const colorHandCostM = s.match(/^Give (\w+) (?:Events?|Characters?|Stages?) in your hand ([+−\-]\d+) cost/i);
  if (colorHandCostM) return { type: 'HAND_COST_MOD', delta: parseENDelta(colorHandCostM[2]), filter: { zone: 'hand' } };

  // ── POWER_MOD (Up to N gain, All gain) ──
  const upToPwrM = s.match(/^Up to (?:a total of )?(\d+) of (your (?:opponent'?s? )?)(.+?) gains? ([+−\-?][\d,]+) power/i);
  if (upToPwrM) {
    return { type: 'POWER_MOD', delta: parseENDelta(upToPwrM[4]), count: parseInt(upToPwrM[1]),
      filter: parseCardFilterEN(upToPwrM[2] + upToPwrM[3]) };
  }
  // "Up to N {trait} type X on your field gains +N power" — no "of your" prefix
  const upToPwrNoOfM = s.match(/^Up to (\d+) (.+?) gains? ([+−\-?][\d,]+) power/i);
  if (upToPwrNoOfM) {
    return { type: 'POWER_MOD', delta: parseENDelta(upToPwrNoOfM[3]), count: parseInt(upToPwrNoOfM[1]),
      filter: parseCardFilterEN('your ' + upToPwrNoOfM[2]) };
  }

  const allPwrM = s.match(/^All of (your (?:opponent'?s? )?)(.+?) gains? ([+−\-?][\d,]+) power/i);
  if (allPwrM) {
    return { type: 'POWER_MOD', delta: parseENDelta(allPwrM[3]), count: Infinity,
      filter: parseCardFilterEN(allPwrM[1] + allPwrM[2]) };
  }
  // "All of your red Characters ... gain [Keyword]" — GRANT_KEYWORD on all matching
  const allGainsKwM = s.match(/^All of (your (?:opponent'?s? )?)(.+?) (?:other than this (?:Character|card) )?gains? \[([^\]]+)\]/i);
  if (allGainsKwM) {
    const kw = allGainsKwM[3]; const kwBase = kw.split(':')[0].trim();
    if (PASSIVE_KW.has(kw) || PASSIVE_KW.has(kwBase)) {
      const until = /during this (?:turn|battle)/i.test(s) ? 'turn' : null;
      const excludeSelf = /other than this (?:Character|card)/i.test(s);
      const f = parseCardFilterEN(allGainsKwM[1] + allGainsKwM[2]);
      if (excludeSelf) f.excludeSelf = true;
      return { type: 'GRANT_KEYWORD', keyword: kwBase,
        restriction: kw.includes(':') ? kw.split(':')[1].trim() : null,
        count: Infinity, filter: f, until };
    }
    return { type: 'NULL_EFFECT' }; // mass keyword grant for unknown keyword
  }

  // ── POWER_MOD / GRANT_KEYWORD on self ──
  const selfGainsPwrM = s.match(/^This (?:Leader|Character|card) gains? ([+−\-?][\d,]+) power/i);
  if (selfGainsPwrM) {
    return { type: 'POWER_MOD', delta: parseENDelta(selfGainsPwrM[1]), count: 1, filter: { self: true } };
  }

  // "Give this Leader/Character -N power" (explicit Give targeting self)
  const giveThisPwrM = s.match(/^Give this (?:Leader|Character|card) ([+−\-?][\d,]+) power/i);
  if (giveThisPwrM) {
    return { type: 'POWER_MOD', delta: parseENDelta(giveThisPwrM[1]), count: 1, filter: { self: true } };
  }

  // "Your Leader and all of your Characters gain +N power" (includes conditional "that do not have a type")
  const leaderAndAllPwrM = s.match(/^Your Leader and all of your (.+?) gains? ([+−\-?][\d,]+) power/i);
  if (leaderAndAllPwrM) {
    return { type: 'POWER_MOD', delta: parseENDelta(leaderAndAllPwrM[2]), count: Infinity,
      filter: { owner: 'self' } };
  }
  // "Your Leader and all of your Characters that do not have a type ... have their effects negated"
  if (/^Your Leader and all of your .+? have their effects negated/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Your [NamedCard] and all your Characters with a type including 'X' gain +N power"
  const namedLeaderAndAllPwrM = s.match(/^Your \[[^\]]+\] and all (?:of )?your (.+?) gains? ([+−\-?][\d,]+) power/i);
  if (namedLeaderAndAllPwrM) return { type: 'POWER_MOD', delta: parseENDelta(namedLeaderAndAllPwrM[2]), count: Infinity, filter: { owner: 'self' } };

  // ── COST_MOD on self ──
  const selfGainsCostM = s.match(/^This (?:Leader|Character|card) gains? ([+−\-]\d+) cost/i);
  if (selfGainsCostM) {
    return { type: 'COST_MOD', delta: parseENDelta(selfGainsCostM[1]), count: 1, filter: { self: true } };
  }

  // ── HAND_COST_MOD ("give this card in your hand -N cost") ──
  const handCostM = s.match(/^Give this card in your hand ([+−\-]\d+) cost/i);
  if (handCostM) return { type: 'HAND_COST_MOD', delta: parseENDelta(handCostM[1]), filter: { self: true } };

  const selfGainsKwM = s.match(/^[Tt]his (?:Leader|Character|card) gains? \[([^\]]+)\]/i);
  if (selfGainsKwM) {
    const kw = selfGainsKwM[1];
    const kwBase = kw.split(':')[0].trim();
    if (PASSIVE_KW.has(kw) || PASSIVE_KW.has(kwBase)) {
      const until = /during this (?:turn|battle)/i.test(s) ? 'turn'
        : /until the start of (?:your )?next turn/i.test(s) ? 'opponent_turn_end' : null;
      return { type: 'GRANT_KEYWORD', keyword: kwBase,
        restriction: kw.includes(':') ? kw.split(':')[1].trim() : null,
        filter: { self: true }, until };
    }
  }

  // ── GRANT_KEYWORD on "Your X Leader/Character gains [Keyword]" or "Your [CardName] gains [Keyword]" ──
  const yourLeaderGainsKwM = s.match(/^Your (?:.+? )?(?:Leader|Character|(?:\[[^\]]+\])) gains? \[([^\]]+)\]/i);
  if (yourLeaderGainsKwM) {
    const kw = yourLeaderGainsKwM[1]; const kwBase = kw.split(':')[0].trim();
    if (PASSIVE_KW.has(kw) || PASSIVE_KW.has(kwBase)) {
      const until = /during this (?:turn|battle)/i.test(s) ? 'turn' : null;
      return { type: 'GRANT_KEYWORD', keyword: kwBase,
        restriction: kw.includes(':') ? kw.split(':')[1].trim() : null,
        filter: { owner: 'self' }, until };
    }
    return { type: 'NULL_EFFECT' }; // unknown keyword on named card
  }

  // ── GRANT_KEYWORD on "Up to N X gains [Keyword]" ──
  const upToKwM = s.match(/^Up to (?:a total of )?(\d+) (?:of )?(.+?) gains? \[([^\]]+)\]/i);
  if (upToKwM) {
    const kw = upToKwM[3]; const kwBase = kw.split(':')[0].trim();
    if (PASSIVE_KW.has(kw) || PASSIVE_KW.has(kwBase)) {
      const until = /during this (?:turn|battle)/i.test(s) ? 'turn'
        : /until the (?:start|end) of/i.test(s) ? 'opponent_turn_end' : null;
      return { type: 'GRANT_KEYWORD', keyword: kwBase, count: parseInt(upToKwM[1]),
        filter: parseCardFilterEN('your ' + upToKwM[2]), until };
    }
    return { type: 'NULL_EFFECT' };
  }

  // ── GRANT_KEYWORD (Give N of your X [Keyword]) ──
  const giveKwM = s.match(/^Give (?:up to (\d+) of )?(.+?) \[([^\]]+)\]/i);
  if (giveKwM) {
    const kw = giveKwM[3];
    const kwBase = kw.split(':')[0].trim();
    if (PASSIVE_KW.has(kw) || PASSIVE_KW.has(kwBase)) {
      const until = /during this (?:turn|battle)/i.test(s) ? 'turn' : null;
      return { type: 'GRANT_KEYWORD', keyword: kwBase,
        restriction: kw.includes(':') ? kw.split(':')[1].trim() : null,
        count: giveKwM[1] ? parseInt(giveKwM[1]) : 1,
        filter: parseCardFilterEN(giveKwM[2]), until };
    }
  }

  // "Give up to N [of your/opponent's] rested DON!! cards" — ATTACH_DON not yet implemented
  if (/^Give (?:up to )?(?:\d+ of (?:your|their) (?:opponent'?s? )?)?\d* ?rested DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Give (?:up to )?\d+ (?:of (?:your|their) (?:opponent'?s? )?)?rested DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Give your Leader and all of your Characters up to N rested DON!! card each" — multi-target ATTACH_DON
  const giveEachM = s.match(/^Give (.+?) and ((?:all (?:of )?)?(?:your|their|opponent'?s?) .+?) up to (\d+) rested DON(?:!!|‼) card each/i);
  if (giveEachM) {
    const count = parseInt(giveEachM[3]);
    return [
      { type: 'ATTACH_DON', count, eachTarget: true, donState: 'rest', filter: parseCardFilterEN(giveEachM[1]) },
      { type: 'ATTACH_DON', count, eachTarget: true, donState: 'rest', filter: parseCardFilterEN(giveEachM[2]) },
    ];
  }
  // "Give your Leader and N Character up to N rested DON!!" — multi-target ATTACH_DON
  if (/^Give (?:your|their) .+? (?:up to )?\d+ rested DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };
  // Broad catch: any remaining "Give ... rested/currently given DON!!" pattern (ATTACH_DON or DON redistribution)
  if (/^Give .+? (?:rested|currently given) DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Give (?:up to )?\d+ (?:total )?of your currently given DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Give up to \d+ of your currently given DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };

  // ── REST ──
  // "Rest DON!! card(s) and optionally this Character"
  const restDonSelfM = s.match(/^Rest (\d+) of your DON(?:!!|‼) cards? and you may rest this (?:Leader|Character|card)/i);
  if (restDonSelfM) return [
    { type: 'REST', count: parseInt(restDonSelfM[1]), filter: { owner: 'self', cardType: 'don' } },
    { type: 'REST', count: 1, filter: { self: true }, isOptional: true },
  ];

  const restUpToM = s.match(/^Rest up to (?:a total of )?(\d+) of (your (?:opponent'?s? )?)(.+)/i);
  if (restUpToM) return { type: 'REST', count: parseInt(restUpToM[1]), filter: parseCardFilterEN(restUpToM[2] + restUpToM[3]) };

  const restNM = s.match(/^Rest (\d+) of (your (?:opponent'?s? )?)(.+)/i);
  if (restNM) return { type: 'REST', count: parseInt(restNM[1]), filter: parseCardFilterEN(restNM[2] + restNM[3]) };

  // "Rest all of your opponent's Characters"
  const restAllM = s.match(/^Rest all (?:of )?(your (?:opponent'?s? )?)(.+)/i);
  if (restAllM) return { type: 'REST', count: Infinity, filter: parseCardFilterEN(restAllM[1] + restAllM[2]) };

  if (/^Rest this (?:Leader|Character|card)/i.test(s)) return { type: 'REST', count: 1, filter: { self: true } };

  const restDonM = s.match(/^[Rr]est (\d+) of your DON(?:!!|‼)/i);
  if (restDonM) return { type: 'REST', count: parseInt(restDonM[1]), filter: { owner: 'self', cardType: 'don' } };

  // ── DEPLOY / Play ──
  // "Play up to N X from your hand/trash/deck [with additional constraints]"
  // Group 4 captures optional suffix (e.g. "with a cost equal to or less than the number of DON!! cards on your field")
  const playUpToM = s.match(/^Play up to (\d+) (.+?) from your (hand|trash|deck)(.*)?/i);
  if (playUpToM) return { type: 'DEPLOY', count: parseInt(playUpToM[1]),
    filter: parseCardFilterEN(playUpToM[2] + ' from your ' + playUpToM[3] + (playUpToM[4] ?? '')) };

  // Self-deploy (from trash or hand)
  if (/^Play this (?:(?:Character|Leader|Stage|Event) )?card(?:s)?.*\bfrom your trash\b.*\brested\b/i.test(s))
    return { type: 'SELF_DEPLOY_FROM_TRASH', deployState: 'rest' };
  if (/^Play this (?:(?:Character|Leader|Stage|Event) )?card(?:s)?.*\bfrom your trash\b/i.test(s))
    return { type: 'SELF_DEPLOY_FROM_TRASH' };
  if (/^Play this (?:(?:Character|Leader|Stage|Event) )?card.*\brested\b/i.test(s))
    return { type: 'SELF_DEPLOY', deployState: 'rest' };
  if (/^Play this (?:(?:Character|Leader|Stage|Event) )?card/i.test(s)) return { type: 'SELF_DEPLOY' };

  // ── SEARCH / Look ──
  const searchRevealM = s.match(/^Look at (?:up to )?(\d+) cards? from the top of your deck[;,]?\s*reveal up to (?:a total of )?(\d+) (.+?) and add (?:it|them) to your hand/i);
  if (searchRevealM) return { type: 'SEARCH', look: parseInt(searchRevealM[1]),
    take: parseInt(searchRevealM[2]), filter: parseCardFilterEN(searchRevealM[3]), addToHand: true };

  const searchAddM = s.match(/^Look at (?:up to )?(\d+) cards? from the top of your deck[;,]?\s*add up to (?:a total of )?(\d+) (.+?) to your hand/i);
  if (searchAddM) return { type: 'SEARCH', look: parseInt(searchAddM[1]),
    take: parseInt(searchAddM[2]), filter: parseCardFilterEN(searchAddM[3]), addToHand: true };

  const lookTopM = s.match(/^Look at (?:up to )?(\d+) cards? from the top of (?:your|their) deck/i);
  if (lookTopM) return { type: 'LOOK_TOP', count: parseInt(lookTopM[1]) };
  // "Look at N card from the top of your opponent's deck" — peek at opponent's deck (NULL_EFFECT for now)
  if (/^Look at (?:up to )?\d+ cards? from the top of (?:your )?opponent'?s? deck/i.test(s)) return { type: 'NULL_EFFECT' };

  // ── KO / Trash from field ──
  // "Trash up to N of your opponent's X" — field removal is semantically KO
  const koTrashAllFieldM = s.match(/^Trash all of (your (?:opponent'?s? )?)(.+)/i);
  if (koTrashAllFieldM && !/from (?:your|their) hand/i.test(koTrashAllFieldM[0]) && !/from the top/i.test(koTrashAllFieldM[0])) {
    return { type: 'KO', count: Infinity, filter: parseCardFilterEN(koTrashAllFieldM[1] + koTrashAllFieldM[2]) };
  }
  const koTrashFieldM = s.match(/^Trash (?:up to )?(\d+) of (your (?:opponent'?s? )?)(.+)/i);
  if (koTrashFieldM && !/from (?:your|their) hand/i.test(koTrashFieldM[0]) && !/from the top/i.test(koTrashFieldM[0]) && !/from (?:your|their|the) Life/i.test(koTrashFieldM[0])) {
    return { type: 'KO', count: parseInt(koTrashFieldM[1]), filter: parseCardFilterEN(koTrashFieldM[2] + koTrashFieldM[3]) };
  }

  // ── DISCARD / Trash from hand / Life ──
  const trashHandM = s.match(/^Trash (?:up to )?(\d+) cards? from your hand/i);
  if (trashHandM) return { type: 'DISCARD', count: parseInt(trashHandM[1]), filter: { owner: 'self', zone: 'hand' } };

  const trashDeckM = s.match(/^Trash (?:up to )?(\d+) cards? from the top of your deck/i);
  if (trashDeckM) return { type: 'DECK_TO_TRASH', count: parseInt(trashDeckM[1]) };

  // "Trash up to N card from the top of your/opponent's Life cards"
  const trashLifeM = s.match(/^Trash (?:up to )?(\d+) cards? from the top of (?:your|their|your opponent'?s?) Life cards?/i);
  if (trashLifeM) {
    const isOpp = /opponent/i.test(trashLifeM[0]);
    return { type: 'LIFE_TO_TRASH', count: parseInt(trashLifeM[1]), filter: { owner: isOpp ? 'opponent' : 'self' } };
  }

  // ── HAND_TO_LIFE (add from hand to Life area) ──
  const handToLifeM = s.match(/^Add (?:up to )?(\d+) cards? from your hand to the (?:top|bottom|top or bottom) of (?:your|their) Life cards?/i);
  if (handToLifeM) return { type: 'HAND_TO_LIFE', count: parseInt(handToLifeM[1]) };

  // ── FIELD_TO_LIFE (add field card to Life area — "owner's", opponent's, or unspecified) ──
  // Note: addDeckToLifeM and HAND_TO_LIFE patterns run first and take priority
  const fieldToLifeM = s.match(/^Add (?:up to )?(\d+) (.+?) to the (?:top|bottom|top or bottom) of (?:the owner'?s?|your|their|your opponent'?s?) Life cards?/i);
  if (fieldToLifeM && !/from (?:your|their|the top of)/i.test(fieldToLifeM[2])) {
    return { type: 'FIELD_TO_LIFE', count: parseInt(fieldToLifeM[1]), filter: parseCardFilterEN(fieldToLifeM[2]) };
  }

  // ── LOOK_ARRANGE_LIFE (look at life card and place at top/bottom) ──
  const lookLifeM = s.match(/^Look at (?:up to )?(\d+) cards? from the top of (?:your|their) (?:or (?:your|their) opponent'?s? )?Life cards?/i);
  if (lookLifeM) return { type: 'LOOK_ARRANGE_LIFE', count: parseInt(lookLifeM[1]) };
  // "Look at all your Life cards" / "Look at all of your Life cards and place them back"
  if (/^Look at all (?:of )?(?:your|their) Life cards?/i.test(s))
    return { type: 'LOOK_ARRANGE_LIFE', count: Infinity };

  // ── FLIP_LIFE (turn Life card face-up/down) ──
  const flipLifeUpM = s.match(/^(?:You may )?turn (?:up to )?(\d+) cards? from the top of (?:your|their) Life cards? face-up/i);
  if (flipLifeUpM) return { type: 'FLIP_LIFE_FACE_UP', count: parseInt(flipLifeUpM[1]) };
  // "Turn all of your Life cards face-down"
  if (/^Turn all (?:of )?(?:your|their) Life cards? face-down/i.test(s)) return { type: 'FLIP_LIFE_FACE_DOWN', count: Infinity };
  const flipLifeDownM = s.match(/^(?:You may )?turn (?:up to )?(\d+) cards? from the top of (?:your|their) Life cards? face-down/i);
  if (flipLifeDownM) return { type: 'FLIP_LIFE_FACE_DOWN', count: parseInt(flipLifeDownM[1]) };

  // ── ADD TO HAND ──
  const addLifeM = s.match(/^Add (?:up to )?(\d+) cards? from (?:the (?:top|bottom|top or bottom) of )?(?:your|their|your opponent'?s?) Life cards? to (?:the owner'?s?|your|their) hand/i);
  if (addLifeM) return { type: 'ADD_TO_HAND', count: parseInt(addLifeM[1]), from: 'life' };

  const addTrashM = s.match(/^Add up to (\d+) (.+?) from your trash to (?:your|their) hand/i);
  if (addTrashM) return { type: 'ADD_TO_HAND', count: parseInt(addTrashM[1]),
    from: 'trash', filter: parseCardFilterEN(addTrashM[2]) };

  const addDonDeckM = s.match(/^Add (?:up to )?(\d+) DON(?:!!|‼) card.* from your DON(?:!!|‼) deck/i);
  if (addDonDeckM) return { type: 'ADD_DON_FROM_DECK', count: parseInt(addDonDeckM[1]), donState: /set it as active/i.test(s) ? 'active' : 'rest' };
  const addDonM = s.match(/^Add (?:up to )?(\d+) DON(?:!!|‼) card/i);
  if (addDonM) return { type: 'ADD_DON', count: parseInt(addDonM[1]) };

  // ── DON!! RETURN FROM FIELD ──
  const donReturnFieldM = s.match(/^Return (?:up to )?(\d+) DON(?:!!|‼) cards? from your field to your DON(?:!!|‼) deck/i);
  if (donReturnFieldM) return { type: 'DON_RETURN_FROM_FIELD', count: parseInt(donReturnFieldM[1]) };

  // ── OPPONENT HAND TO DECK (opponent places hand card at bottom/top of deck) ──
  // "Your opponent returns all cards in their hand to their deck"
  if (/^Your opponent returns? all cards? in their hand to (?:the (?:top|bottom) of )?their deck/i.test(s))
    return { type: 'OPP_HAND_TO_DECK', count: Infinity };
  const oppHandToDeckM = s.match(/^Your opponent places? (?:up to )?(\d+) cards? from (?:the top of )?their hand/i);
  if (oppHandToDeckM) return { type: 'OPP_HAND_TO_DECK', count: parseInt(oppHandToDeckM[1]) };
  // "Your opponent places N of their Characters at the bottom of their/owner's deck" — BOTTOM_DECK for opponent
  const oppPlaceCharDeckM = s.match(/^Your opponent places? (?:up to )?(\d+) (?:of )?(?:their|the opponent'?s?) (.+?) at the bottom of (?:their|the owner'?s?) deck/i);
  if (oppPlaceCharDeckM) return { type: 'BOTTOM_DECK', count: parseInt(oppPlaceCharDeckM[1]),
    filter: parseCardFilterEN("your opponent's " + oppPlaceCharDeckM[2]) };
  // "Your opponent places N cards from their trash at the bottom of their deck" — not implemented
  if (/^Your opponent places? \d+ cards? from (?:the top of )?their trash/i.test(s)) return { type: 'NULL_EFFECT' };

  // ── DISCARD from opponent's hand ──
  const oppDiscardM = s.match(/^Trash (\d+) cards? from your opponent'?s? hand/i);
  if (oppDiscardM) return { type: 'DISCARD', count: parseInt(oppDiscardM[1]), filter: { owner: 'opponent', zone: 'hand' } };

  // lowercase "add" continuation (after "; ")
  const addLowerM = s.match(/^add up to (\d+) (.+?) to your hand/i);
  if (addLowerM) return { type: 'ADD_TO_HAND', count: parseInt(addLowerM[1]),
    from: 'trash', filter: parseCardFilterEN(addLowerM[2]) };

  // ── RETURN TO HAND ──
  if (/^Return this (?:Leader|Character|card) to (?:the owner'?s?|your) hand/i.test(s))
    return { type: 'RETURN_HAND', count: 1, filter: { self: true } };

  const returnAllM = s.match(/^Return all of (?:your|their) (.+?) to (?:the (?:owner'?s?|their)|your) hand/i);
  if (returnAllM) return { type: 'RETURN_HAND', count: Infinity, filter: parseCardFilterEN('your ' + returnAllM[1]) };

  const returnUpToM = s.match(/^Return up to (\d+) (.+?) to (?:the (?:owner'?s?|their)|your) hand/i);
  if (returnUpToM) return { type: 'RETURN_HAND', count: parseInt(returnUpToM[1]),
    filter: parseCardFilterEN(returnUpToM[2]) };

  // ── UNREST (Set as active) ──
  // "Set this Character as active" / "Set up to N of your X as active"
  if (/^Set this (?:Leader|Character|card) as active/i.test(s)) return { type: 'UNREST', count: 1, filter: { self: true } };
  // "Set your [Name] Leader / {X} type Leader as active"
  if (/^Set your .+? Leader as active/i.test(s)) return { type: 'UNREST', count: 1, filter: { owner: 'self', cardType: 'leader' } };
  // "Set up to N {X} type Character ... as active" (no "of" between count and type)
  const setTypeCountActiveM = s.match(/^Set (?:up to )?(\d+) (\{[^}]+\}.+?) as active/i);
  if (setTypeCountActiveM && !/DON(?:!!|‼)/i.test(setTypeCountActiveM[2]))
    return { type: 'UNREST', count: parseInt(setTypeCountActiveM[1]), filter: parseCardFilterEN('your ' + setTypeCountActiveM[2]) };
  // "Set up to N of your {X} type Characters and up to N of your DON!! cards as active" — compound UNREST+DON_ACTIVE
  const setCharAndDonActiveM = s.match(/^Set up to (\d+) of your (.+?) and up to (\d+) of your DON(?:!!|‼) cards? as active/i);
  if (setCharAndDonActiveM) return [
    { type: 'UNREST', count: parseInt(setCharAndDonActiveM[1]), filter: parseCardFilterEN('your ' + setCharAndDonActiveM[2]) },
    { type: 'DON_ACTIVE', count: parseInt(setCharAndDonActiveM[3]) },
  ];
  const setActiveM = s.match(/^Set up to (\d+) of (?:your (?:opponent'?s? )?)?(.+?) (?:with .+? )?as active/i);
  if (setActiveM && !/DON(?:!!|‼)/i.test(setActiveM[2])) {
    return { type: 'UNREST', count: parseInt(setActiveM[1]), filter: parseCardFilterEN(setActiveM[2]) };
  }

  // ── DON!! ACTIVE (Set as active) ──
  const donActiveUpToM = s.match(/^Set up to (\d+) of your DON(?:!!|‼) cards? as active/i);
  if (donActiveUpToM) return { type: 'DON_ACTIVE', count: parseInt(donActiveUpToM[1]) };
  const donActiveNM = s.match(/^Set (\d+) of your DON(?:!!|‼) cards? as active/i);
  if (donActiveNM) return { type: 'DON_ACTIVE', count: parseInt(donActiveNM[1]) };
  if (/^Set all of your DON(?:!!|‼) cards? as active/i.test(s)) return { type: 'DON_ACTIVE', count: Infinity };

  // ── BOTTOM_DECK (Place at the bottom) ──
  const placeBottomM = s.match(/^Place up to (\d+) (.+?) at the bottom of (?:your|their|the owner'?s?) deck/i);
  if (placeBottomM) return { type: 'BOTTOM_DECK', count: parseInt(placeBottomM[1]), filter: parseCardFilterEN(placeBottomM[2]) };

  // ── ADD_TO_LIFE (deck or field → Life) ──
  const addDeckToLifeM = s.match(/^Add (?:up to )?(\d+) cards? from the top of (?:your|their) deck to the top of (?:your|their) Life cards?/i);
  if (addDeckToLifeM) return { type: 'ADD_TO_LIFE', count: parseInt(addDeckToLifeM[1]), from: 'deck' };

  // "Your {X} or {Y} type Leaders and Characters gains +N power" — multi-trait all POWER_MOD
  const yourTraitAllPwrM = s.match(/^Your (.+?) (?:Leaders? and Characters?|Characters? and Leaders?) gains? ([+−\-?][\d,]+) power/i);
  if (yourTraitAllPwrM) {
    return { type: 'POWER_MOD', delta: parseENDelta(yourTraitAllPwrM[2]), count: Infinity,
      filter: parseCardFilterEN('your ' + yourTraitAllPwrM[1]) };
  }

  // ── POWER_MOD for Leader (plain-text target, not "this Leader") — also "{X} type Leader" ──
  const leaderGainsPwrM = s.match(/^Your (?:.+? )?Leader gains? ([+−\-?][\d,]+) power/i);
  if (leaderGainsPwrM) return {
    type: 'POWER_MOD', delta: parseENDelta(leaderGainsPwrM[1]), count: 1,
    filter: { owner: 'self', cardType: 'leader' },
  };

  // ── REVEAL (top of deck or Life) ──
  const revealTopM = s.match(/^Reveal (?:up to )?(\d+) cards? from the top of (?:your|their) deck/i);
  if (revealTopM) return { type: 'REVEAL_TOP_DECK', count: parseInt(revealTopM[1]) };
  const revealLifeM = s.match(/^Reveal (?:up to )?(\d+) cards? from the top of (?:your|their) Life cards?/i);
  if (revealLifeM) return { type: 'REVEAL_LIFE', count: parseInt(revealLifeM[1]) };

  // ── OPPONENT DISCARD ──
  const oppTrashHandM = s.match(/^[Yy]our opponent trashes? (\d+) cards? from (?:the top of )?their hand/i);
  if (oppTrashHandM) return { type: 'DISCARD', count: parseInt(oppTrashHandM[1]), filter: { owner: 'opponent', zone: 'hand' } };

  // ── SHUFFLE DECK ──
  if (/shuffle (?:your|their) deck/i.test(s)) return { type: 'SHUFFLE_DECK' };

  // ── ATTACK_LOCK ──
  const attackLockM = s.match(/^Up to (\d+) of (your (?:opponent'?s? )?)(.+?) cannot attack/i);
  if (attackLockM) return { type: 'ATTACK_LOCK', count: parseInt(attackLockM[1]),
    filter: parseCardFilterEN(attackLockM[2] + attackLockM[3]) };

  // ── REFRESH_LOCK (will not become active next Refresh Phase) ──
  // "All of your opponent's rested Characters with a cost of N or less will not become active"
  const refreshLockAllM = s.match(/^All of (your (?:opponent'?s? )?)(?:rested )?(.+?) will not become active/i);
  if (refreshLockAllM) return { type: 'REFRESH_LOCK', count: Infinity, filter: parseCardFilterEN(refreshLockAllM[1] + refreshLockAllM[2]) };
  const refreshLockM = s.match(/^Up to (?:a total of )?(\d+) of (your (?:opponent'?s? )?)(.+?) will not become active/i);
  if (refreshLockM) return { type: 'REFRESH_LOCK', count: parseInt(refreshLockM[1]),
    filter: parseCardFilterEN(refreshLockM[2] + refreshLockM[3]) };
  // "This Character will not become active in your next Refresh Phase"
  if (/^This (?:Character|Leader|card) will not become active/i.test(s))
    return { type: 'REFRESH_LOCK', count: 1, filter: { self: true } };

  // ── PREVENT_REST (cannot be rested) ──
  const preventRestM = s.match(/^Up to (\d+) of (your (?:opponent'?s? )?)(.+?) cannot be rested/i);
  if (preventRestM) return { type: 'PREVENT_REST', count: parseInt(preventRestM[1]),
    filter: parseCardFilterEN(preventRestM[2] + preventRestM[3]) };
  // "This Character cannot be rested by your opponent's effects"
  if (/^This (?:Character|Leader|card) cannot be rested/i.test(s))
    return { type: 'PREVENT_REST', count: 1, filter: { self: true } };

  // ── POWER_SET (set power/cost to a specific value) ──
  // "Set the base power of all of your X to N"
  const powerSetAllM = s.match(/^Set the (?:base )?power of all of (your (?:opponent'?s? )?)(.+?) to (\d[\d,]*)/i);
  if (powerSetAllM) return { type: 'POWER_SET', count: Infinity, target: parseInt(powerSetAllM[3].replace(/,/g, '')), filter: parseCardFilterEN(powerSetAllM[1] + powerSetAllM[2]) };
  const powerSetM = s.match(/^Set the (?:base )?power of (?:up to )?(\d+) of (your (?:opponent'?s? )?)(.+?) to (\d[\d,]*)/i);
  if (powerSetM) return { type: 'POWER_SET', count: parseInt(powerSetM[1]),
    target: parseInt(powerSetM[4].replace(/,/g, '')),
    filter: parseCardFilterEN(powerSetM[2] + powerSetM[3]) };
  if (/^Set the cost of (?:up to )?\d+ of .+? to \d+/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Your Leader's base power becomes N" / "Your {X} type Leader's base power becomes N"
  const leaderPowerBecomesM = s.match(/^Your (?:.+? )?Leader'?s? base power becomes (\d[\d,]*)/i);
  if (leaderPowerBecomesM) return { type: 'POWER_SET', count: 1,
    target: parseInt(leaderPowerBecomesM[1].replace(/,/g, '')),
    filter: { owner: 'self', category: 'Leader' } };

  // ── ALTERNATE NAMES ──
  const altNamesM = s.match(/treat this card'?s? name as \[([^\]]+)\](?:\s+and \[([^\]]+)\])?/i);
  if (altNamesM) return { type: 'ALTERNATE_NAMES', names: [altNamesM[1], altNamesM[2]].filter(Boolean) };

  // ── NULL / no-op ──
  if (s.startsWith('(') && s.endsWith(')')) return null;
  if (/^Under the rules/i.test(s)) return null;
  // Search remainder: "place the rest at the top/bottom of your deck" / "trash the rest"
  if (/^place the rest/i.test(s)) return null;
  if (/^trash the rest/i.test(s)) return null;
  if (/^Also treat this card'?s? name/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^This Character can (?:also )?attack/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^K\.O\. it\b/i.test(s)) return { type: 'NULL_EFFECT' }; // contextual ref to prev action
  if (/^This effect can be activated when/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^You cannot play (?:Character|Event|Stage) cards/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Trash cards from the top of your Life/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/cannot activate(?: up to \d+| the)?(?: a)? \[Blocker\]/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Negate the effect/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^None of your .+ can be K\.O\.'?d/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/cannot be K\.O\.'?d by effects/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Give this (?:Character|Leader|card) up to \d+ rested DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };
  // Revealed card continuation — "That card gains +N power" refers to a previously revealed card
  if (/^That card gains/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Choose a cost and reveal N card" — complex deck-check mechanic
  if (/^Choose a cost and reveal/i.test(s)) return { type: 'NULL_EFFECT' };
  // Power copy effects ("becomes the same power as" / "becomes the same base power as")
  if (/becomes the same (?:base )?power as/i.test(s) || (/becomes the same as/i.test(s) && /base power/i.test(s))) return { type: 'NULL_EFFECT' };
  // Damage trigger remainder
  if (/^Rest up to a total of/i.test(s)) {
    const totalRestM = s.match(/^Rest up to a total of (\d+) of (your (?:opponent'?s? )?)(.+)/i);
    if (totalRestM) return { type: 'REST', count: parseInt(totalRestM[1]), filter: parseCardFilterEN(totalRestM[2] + totalRestM[3]) };
  }

  // ── EXTRA_TURN ──
  if (/^Take an extra turn/i.test(s)) return { type: 'EXTRA_TURN' };

  // "Place this Character at the bottom of the owner's/your deck" (self bottom-deck)
  if (/^Place this (?:Character|card) at the bottom of (?:the owner'?s?|your|their) deck/i.test(s))
    return { type: 'BOTTOM_DECK', count: 1, filter: { self: true } };
  // "Place all of your X except this Character at the bottom of your deck"
  const placeAllButSelfM = s.match(/^Place all of your (.+?) (?:except this (?:Character|card) )?at the bottom of (?:your|their|the owner'?s?) deck/i);
  if (placeAllButSelfM) return { type: 'BOTTOM_DECK', count: Infinity,
    filter: { ...parseCardFilterEN('your ' + placeAllButSelfM[1]), excludeSelf: /except this/i.test(s) } };
  // "Place N card from your hand at the top or bottom of your deck"
  const placeHandTopBottomM = s.match(/^Place (\d+) cards? from your hand at the top or bottom of (?:your|their) deck/i);
  if (placeHandTopBottomM) return { type: 'REMAINDER_TOP_OR_BOTTOM', count: parseInt(placeHandTopBottomM[1]) };
  // "Your opponent returns N of their Characters to the owner's/their hand" — RETURN_HAND on opponent cards
  const oppReturnsM = s.match(/^Your opponent returns? (?:up to )?(\d+) of their (.+?) to (?:the owner'?s?|their|your) hand/i);
  if (oppReturnsM) return { type: 'RETURN_HAND', count: parseInt(oppReturnsM[1]), filter: parseCardFilterEN("your opponent's " + oppReturnsM[2]) };
  // "Trash all cards from your hand"
  if (/^Trash all cards? from your hand/i.test(s)) return { type: 'DISCARD', count: Infinity, filter: { owner: 'self', zone: 'hand' } };
  // "Trash cards from your hand until you have N cards"
  const trashToSizeM = s.match(/^Trash cards? from your hand until you have (\d+) cards?/i);
  if (trashToSizeM) return { type: 'DISCARD_TO_SIZE', targetSize: parseInt(trashToSizeM[1]) };
  // "You take N damage"
  const selfDamageM = s.match(/^You take (\d+) damage/i);
  if (selfDamageM) return { type: 'SELF_DAMAGE', count: parseInt(selfDamageM[1]) };
  // "Give −N power during this turn to up to N of your opponent's Characters" — inverted power mod syntax
  const givePwrInvM = s.match(/^Give ([+−\-][\d,]+) power (?:during this (?:turn|battle) )?to (?:up to )?(\d+) of (your (?:opponent'?s? )?)(.+)/i);
  if (givePwrInvM) return { type: 'POWER_MOD', delta: parseENDelta(givePwrInvM[1]), count: parseInt(givePwrInvM[2]), filter: parseCardFilterEN(givePwrInvM[3] + givePwrInvM[4]) };
  if (/^You cannot play cards/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^You cannot play any (?:Character|Event|Stage) cards/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Your Character cards are played rested/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Your Leader gains \+\d+ power for each/i.test(s)) return { type: 'NULL_EFFECT' };
  // Protection / lock effects not yet implemented
  if (/cannot be K\.O\.'?d/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/cannot be removed from the field/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/cannot attack/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/cannot add Life cards to your hand/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^You may trash this (?:Character|card) instead/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^You may trash \d+ card/i.test(s) && /instead/i.test(s)) return { type: 'NULL_EFFECT' };
  // Lowercase "add" continuation after semicolons for DON!! transfer
  if (/^Add (?:up to )?\d+ rested DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };

  // ── Misc NULL_EFFECT (effects not implemented in engine) ──
  // Effect negation
  if (/^This (?:Character|Leader|card)'?s? effect is negated/i.test(s)) return { type: 'NULL_EFFECT' };
  // DON!! set-active lock
  if (/cannot set DON(?:!!|‼) cards? as active/i.test(s)) return { type: 'NULL_EFFECT' };
  // Opponent-activated effects
  if (/^Your opponent (?:must|cannot)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^When your opponent activates (?:an Event|a \[Blocker\]|\[Blocker\])/i.test(s)) return { type: 'NULL_EFFECT' };
  // ATTACH_DON effects (give/select rested DON!! to characters)
  if (/give (?:up to )?\d+ (?:rested )?DON(?:!!|‼)(?! card.*from)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Select (?:up to )?\d+ of (?:your|their) .+?, and give/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Select N of your Characters. Change the attack target..."
  if (/change the attack target/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Trash this Stage" / "Trash this Character at the end of this turn"
  if (/^Trash this (?:Stage|Character|Leader|card)/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Trash all your face-up Life cards"
  if (/^Trash all (?:your|of your|their) (?:face-up )?Life cards?/i.test(s)) return { type: 'NULL_EFFECT' };
  // Scaled draw ("draw cards equal to", "draw for each")
  if (/^Draw (?:cards?|a card) (?:equal to|for each)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Draw cards? so that you have the same/i.test(s)) return { type: 'NULL_EFFECT' };
  // Trash same number as
  if (/^Trash the same number/i.test(s)) return { type: 'NULL_EFFECT' };
  // Return from trash with specific activation
  if (/^Play \d+ \[/i.test(s)) return { type: 'NULL_EFFECT' }; // "Play N [CardName] from your trash"
  if (/^Activate (?:this|up to)/i.test(s)) return { type: 'NULL_EFFECT' };
  // Replacement "When your number of Life cards becomes N"
  if (/^When (?:your|the) (?:number of Life|Life cards? (?:count|number))/i.test(s)) return { type: 'NULL_EFFECT' };
  // "At the end of this turn/battle, ..." — deferred effects
  if (/^At the end of this (?:turn|battle),/i.test(s)) return { type: 'NULL_EFFECT' };
  // "If you do, [action]" — conditional continuation sentence
  if (/^If you do,/i.test(s)) return { type: 'NULL_EFFECT' };
  // "When you draw a card outside of your Draw Phase" trigger remnants
  if (/^When you draw a card outside/i.test(s)) return { type: 'NULL_EFFECT' };
  // "When a [Trigger] activates..." — complex meta-trigger not implemented
  if (/^When a \[Trigger\] activates/i.test(s)) return { type: 'NULL_EFFECT' };
  // "When your opponent activates [Blocker] or an Event" — block-level, also null for individual
  if (/^When your opponent activates/i.test(s)) return { type: 'NULL_EFFECT' };
  // "When this Character becomes rested" — trigger remnants at sentence level
  if (/^When this (?:Character|Leader|card) becomes rested/i.test(s)) return { type: 'NULL_EFFECT' };
  // "You and your opponent trash cards from your hand" — mutual effect
  if (/^You and your opponent trash/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Activate this card's [Main] effect"
  if (/^Activate this card'?s? \[Main\] effect/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Apply each of the following effects based on..."
  if (/^Apply each of the following/i.test(s)) return { type: 'NULL_EFFECT' };
  // Bullet-level conditional sentences (leftover from choose-one or apply-each blocks)
  if (/^• /i.test(s)) return { type: 'NULL_EFFECT' };
  // "Deal N damage to your opponent" — not a standard game mechanic (custom/manga)
  if (/^Deal \d+ damage to your opponent/i.test(s)) return { type: 'NULL_EFFECT' };
  // "When you activate an Event, [draw|you may...]" — complex trigger
  if (/^When you activate an Event/i.test(s)) return { type: 'NULL_EFFECT' };
  // "When you play a Character with no base effect" — complex condition
  if (/^When you play a Character with no base/i.test(s)) return { type: 'NULL_EFFECT' };
  // "When a Character is K.O.'d" — cross-player trigger not implemented
  if (/^When (?:a|any) Character is K\.O\.'?d/i.test(s)) return { type: 'NULL_EFFECT' };
  // "When a card is added to your hand from your Life" — life-add trigger
  if (/^When a card is added to your hand from/i.test(s)) return { type: 'NULL_EFFECT' };
  // "When this Leader attacks or is attacked" — leader-attack trigger
  if (/^When this (?:Leader|Character|card) (?:attacks|is attacked)/i.test(s)) return { type: 'NULL_EFFECT' };
  // "When your opponent's Character is K.O.'d / returned to hand"
  if (/^When your opponent'?s? (?:Character|Leader|card) is (?:K\.O\.'?d|returned)/i.test(s)) return { type: 'NULL_EFFECT' };
  // "This Character and up to N of your Leader gain..." — multi-target self+leader
  if (/^This Character and (?:up to )?\d+ of your Leader/i.test(s)) return { type: 'NULL_EFFECT' };
  // "All Characters with cost N or less do not become..." — global effect
  if (/^All Characters with a cost of \d+ or less do not/i.test(s)) return { type: 'NULL_EFFECT' };
  // "If the number of DON!! cards on your field is equal to..." — complex condition remnant
  if (/^If the number of DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Place the opponent's Character you battled with..." — contextual battle reference
  if (/^Place the opponent'?s? (?:Character|Leader|card) you battled/i.test(s)) return { type: 'NULL_EFFECT' };
  // "K.O. the opponent's Character you battled with" — contextual battle reference
  if (/^K\.O\. the opponent'?s? (?:Character|Leader|card) you battled/i.test(s)) return { type: 'NULL_EFFECT' };
  // "The next time you play..." — deferred trigger
  if (/^The next time you (?:play|use|activate)/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Your opponent may return N of their active DON!! cards to their deck"
  if (/^Your opponent (?:may )?(?:return|rest) \d+ of their/i.test(s)) return { type: 'NULL_EFFECT' };
  // "Return N of your Characters to your hand" — plain "N of your" with no "up to"
  const returnNM = s.match(/^Return (\d+) of (your (?:opponent'?s? )?)(.+?) to (?:the (?:owner'?s?|their)|your) hand/i);
  if (returnNM) return { type: 'RETURN_HAND', count: parseInt(returnNM[1]),
    filter: parseCardFilterEN(returnNM[2] + returnNM[3]) };
  // "Add this Character card from your trash to your hand" — ADD_TO_HAND self from trash
  if (/^Add this (?:Character|Leader|Stage|Event|card) card? from your trash to (?:your|their) hand/i.test(s))
    return { type: 'ADD_TO_HAND', count: 1, from: 'trash', filter: { self: true } };
  // "Add this Character card to your hand" (from field/unspecified)
  if (/^Add this (?:Character|Leader|Stage|Event|card) card? to (?:your|their) hand/i.test(s))
    return { type: 'RETURN_HAND', count: 1, filter: { self: true } };
  // "Place all cards in your hand at the bottom of your deck"
  if (/^Place all cards? in your hand at the bottom of/i.test(s))
    return { type: 'BOTTOM_DECK', count: Infinity, filter: { owner: 'self', zone: 'hand' } };
  // "Place N card from your hand at the bottom of your deck"
  const placeHandBottomM = s.match(/^Place (\d+) cards? from your hand at the bottom of (?:your|their) deck/i);
  if (placeHandBottomM) return { type: 'BOTTOM_DECK', count: parseInt(placeHandBottomM[1]),
    filter: { owner: 'self', zone: 'hand' } };
  // "Place all Characters with a cost of N or less at the bottom of the owner's deck"
  const placeAllCostBottomM = s.match(/^Place all (?:Characters?|cards?) with a cost of (\d+) or less/i);
  if (placeAllCostBottomM) return { type: 'BOTTOM_DECK', count: Infinity,
    filter: { maxCost: parseInt(placeAllCostBottomM[1]) } };
  // "Place up to N of your opponent's Characters with cost N or less at bottom/top-or-bottom of their deck"
  const placeOppCostBottomM = s.match(/^Place (?:up to )?(\d+) of (your (?:opponent'?s? )?)(.+?) at the (?:top or )?bottom/i);
  if (placeOppCostBottomM) return { type: 'BOTTOM_DECK', count: parseInt(placeOppCostBottomM[1]),
    filter: parseCardFilterEN(placeOppCostBottomM[2] + placeOppCostBottomM[3]) };
  // HTML entity leftovers (e.g., "&lt;Strike&gt;") — match-relevant but not parseable
  if (/&lt;/.test(s)) return { type: 'NULL_EFFECT' };
  // "You may add N card from the top of your Life cards" (variant form already handled as addLifeM, but catches misses)
  const addLifeToHandM = s.match(/^(?:You may )?[Aa]dd (?:up to )?(\d+) cards? from (?:the top of )?(?:your|their) Life cards? to (?:your|their|the owner'?s?) hand/i);
  if (addLifeToHandM) return { type: 'ADD_TO_HAND', count: parseInt(addLifeToHandM[1]), from: 'life' };
  // "Return any number of Characters on your field to the owner's hand"
  if (/^Return any number of (?:Characters?|cards?) (?:on your field|from your field)/i.test(s))
    return { type: 'RETURN_HAND', count: Infinity, filter: { owner: 'self', category: 'Character' } };
  // "Set all of your {X} type Characters as active"
  const setAllTypeActiveM = s.match(/^Set all of your (.+?) (?:Characters?|Leaders?) as active/i);
  if (setAllTypeActiveM) return { type: 'UNREST', count: Infinity, filter: parseCardFilterEN('your ' + setAllTypeActiveM[1]) };
  // Scaled effects and complex multi-branch effects → NULL_EFFECT
  if (/^(?:This )?Character(?:'?s)? (?:gains?|becomes?)/i.test(s) && /\d+.*power/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Trash any number of/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^(?:You can trash|You may trash)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Return any number/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Place any number/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Select (?:up to )?\d+ (?:of|\{)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Choose (?:up to )?\d+/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Reveal (?:up to )?\d+/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Add up to \d+ .+? from (?:your|their) (?:trash|deck|hand)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Trash \d+ cards? from (?:the top of )?(?:your|their) (?:deck|Life)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Up to \d+ of (?:your|their) .+? (?:Leader or|Leaders? and) Characters? gain/i.test(s)) return { type: 'NULL_EFFECT' };
  // Opponent-choice and opponent-initiated effects
  if (/^Your opponent chooses? (?:\d+|one) (?:cards?|of their)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Your opponent may trash \d+ cards? from the top of their Life/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Your opponent may add \d+ DON(?:!!|‼) cards? from their DON(?:!!|‼) deck/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Your opponent adds? \d+ cards? from (?:the top of |their Life|their DON)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Your opponent rests? \d+ of their (?:active )?DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Your opponent places? \d+ Events? from their trash/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Your opponent (?:may )?(?:return|rest) \d+ of their active/i.test(s)) return { type: 'NULL_EFFECT' };
  // DON!! manipulation not yet implemented
  if (/^When this (?:Leader|Character|card) or \d+ of your .+? is given a DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^When you deal damage to your opponent'?s? Life/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^If you have any DON(?:!!|‼) cards? on your field/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Set this (?:Character|card) or up to \d+ of your DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Rest any number of your DON(?:!!|‼)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Give (?:up to )?\d+ DON(?:!!|‼) cards? from your opponent'?s? cost area/i.test(s)) return { type: 'NULL_EFFECT' };
  // Trigger-based conditions not implemented as clauses
  if (/^When you take damage or your Character/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^When you play a Character,/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^When one of your .+? type Characters .+? is K\.O\.'?d/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^When a card is removed from (?:your|their|your opponent'?s?) (?:or your opponent'?s? )?Life/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^When your (?:Character|Leader|\{[^}]+\} type Character) (?:with a type including|is removed from the field)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^When a (?:Character|card|Leader) is removed from the field/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^When this (?:Character|Leader|card) is K\.O\.'?d by your opponent/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^When a card is trashed from your hand by/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^At the end of a battle/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^And this (?:Character|card) was played on this turn/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Place the \d+ Character played by this effect/i.test(s)) return { type: 'NULL_EFFECT' };
  // Effect / on-play negation
  if (/^Your (?:opponent'?s? )?\[On Play\] effects? (?:are|is) negated/i.test(s)) return { type: 'NULL_EFFECT' };
  // Complex state/condition effects not implemented
  if (/^You cannot draw cards using your own effects/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^This card in your hand cannot be played by effects/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^This effect can be activated at the start of/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^You have \d+ or less Life cards and your opponent/i.test(s)) return { type: 'NULL_EFFECT' };
  // Complex battle/KO effects
  if (/^K\.O\. any number of your/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^K\.O\. or rest (?:up to )?\d+/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Select your opponent'?s? rested (?:Leader|Character)/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^The selected (?:Character|cards?) will not become active/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^Give (?:up to )?\d+ each of .+? Leader and Character/i.test(s)) return { type: 'NULL_EFFECT' };
  // Power/base power copy or swap
  if (/^All of your \[[^\]]+\] cards' base power and this/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/^All of your .+? type Character cards without a Counter/i.test(s)) return { type: 'NULL_EFFECT' };
  if (/Swap the base power/i.test(s)) return { type: 'NULL_EFFECT' };
  // Activate main effect of event
  if (/^Activate the \[/i.test(s)) return { type: 'NULL_EFFECT' };

  return { type: 'UNKNOWN', raw: s };
}

/** Split an EN action text block into individual action sentences and parse each. */
function parseSentencesEN(text) {
  if (!text) return [];
  // Strip DON!! deck parenthetical explanation before splitting
  let t = text.replace(/\s*\(You may return the specified number of DON(?:!!|‼) cards from your field to your DON(?:!!|‼) deck\.?\)/gi, '').trim();
  // Split on ". Then, " and ". If you do, " sentence boundaries
  const parts = t.split(/\.\s+(?=(?:Then,|If you do,)\s)/i);
  return parts.flatMap(part => {
    part = part.trim().replace(/\.\s*$/, '').trim();
    if (!part) return [];
    const r = parseSentenceEN(part);
    return Array.isArray(r) ? r : r ? [r] : [];
  });
}

/** Parse a single EN effect block (one <br>-delimited segment) into a clause object. */
function parseBlockEN(raw) {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith('(') && s.endsWith(')')) return null;

  // Extract all [keyword] brackets
  const keywords = [...s.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);

  // Keywords that appear in filter positions ("a [Blocker] Character") are not intrinsic passives
  const filterKws = new Set(
    [...s.matchAll(/\ba \[([^\]]+)\] (?:Character|Leader|card)/gi)].map(m => m[1])
  );
  // Keywords granted to a target ("gains [X]") are not intrinsic passives of this card
  const grantedKws = new Set(
    [...s.matchAll(/gains? \[([^\]]+)\]/gi)].map(m => m[1])
  );

  const timings  = keywords.filter(k => TIMING_KW.has(k)    && !grantedKws.has(k) && !filterKws.has(k));
  const activated= keywords.filter(k => ACTIVATED_KW.has(k) && !grantedKws.has(k));
  const continuous=keywords.filter(k => CONTINUOUS_KW.has(k));
  const passive  = keywords.filter(k => {
    const base = k.split(':')[0].trim();
    return (PASSIVE_KW.has(k) || PASSIVE_KW.has(base)) && !grantedKws.has(k) && !filterKws.has(k);
  });

  const oncePerTurn = keywords.some(k => /^Once Per Turn$/i.test(k));

  // DON!! gate: [DON!! x2] → donGate = 2
  const donGateKw = keywords.find(k => /^DON(?:!!|‼) x(\d+)$/i.test(k));
  const donGate = donGateKw ? parseInt(donGateKw.match(/\d+/)[0]) : null;

  // Strip leading [keyword] brackets and "/" separators from action text (handles "[A]/[B] ..." patterns)
  let actionText = s.replace(/^(?:\/?\s*\[[^\]]+\]\s*)*\/?/, '').trim();

  // Strip DON!! return cost notation: "DON!! -N (...): " or "DON!! −N (...): " (parenthetical optional)
  const donReturnM = actionText.match(/^DON(?:!!|‼) ?[-−](\d+)\s*(?:\([^)]+\))?[,:\s]+/i);
  const donReturn = donReturnM ? parseInt(donReturnM[1]) : null;
  if (donReturnM) actionText = actionText.slice(donReturnM[0].length).trim();

  // Strip ① ② etc. DON!! rest cost prefix (circled number = rest that many DON, not return to deck)
  const costSymbolM = actionText.match(/^([①②③④⑤⑥⑦⑧⑨➀➁➂➃➄])\s*(?:\([^)]+\))?[:,]?\s*/);
  const donRest = costSymbolM ? circledCharToInt(costSymbolM[1]) : null;
  if (costSymbolM) actionText = actionText.slice(costSymbolM[0].length).trim();

  // Detect "When a DON!! card on your field is returned to your DON!! deck, [action]" — plain-text trigger
  const donReturnedM = actionText.match(/^When a DON(?:!!|‼) card on your field is returned to your DON(?:!!|‼) deck(?:\s+by\s+.+?)?,\s+(.+)/i);
  if (donReturnedM) {
    timings.push('咚‼卡被放回時');
    actionText = donReturnedM[1].trim();
  }

  // Detect "When this Leader or 1 of your Characters is given a DON!! card, [action]" — DON!! attach trigger
  const donAttachEN = actionText.match(/^When this Leader or (?:\d+ of )?your Characters? is given a DON(?:!!|‼) card,\s+(.+)/i);
  if (donAttachEN) {
    timings.push('咚‼附加時');
    actionText = donAttachEN[1].trim();
  }

  // Detect "When you play a Character with no base effect from your hand, [action]" — self-deploy trigger
  const selfDeployNoEffectEN = actionText.match(/^When you play a Character with no base effect from your hand,\s+(.+)/i);
  if (selfDeployNoEffectEN) {
    timings.push('自己使無效果角色卡登場時');
    actionText = selfDeployNoEffectEN[1].trim();
  }

  // Detect "When this Character is K.O.'d [by …], [action]" — self-KO trigger (plain text)
  const selfKoTriggerM = actionText.match(/^When this (?:Character|card) is K\.O\.'?d(?:[^,]*)?,\s+(.+)/i);
  if (selfKoTriggerM) {
    timings.push('KO時');
    actionText = selfKoTriggerM[1].trim();
  }

  // Detect "When this Character's attack deals damage to your opponent('s Life), [action]" — damage trigger
  const dealDamageTriggerM = actionText.match(/^When this (?:Character|Leader|card)'?s? attack deals damage to your opponent'?s?(?:\s+Life)?,\s+(.+)/i);
  if (dealDamageTriggerM) {
    timings.push('造成傷害時');
    actionText = dealDamageTriggerM[1].trim();
  }

  // Detect "When N or more DON!! cards on your field are returned to your DON!! deck, [action]"
  const donReturnedCountM = actionText.match(/^When (\d+) or more DON(?:!!|‼) cards? on your field are returned to your DON(?:!!|‼) deck,\s+(.+)/i);
  if (donReturnedCountM) {
    timings.push('咚‼卡被放回時');
    actionText = donReturnedCountM[2].trim();
  }

  // Detect "When a card is trashed from your hand by an effect, [action]" — hand-trash trigger
  const handTrashTriggerM = actionText.match(/^When a card is trashed from your hand by (?:an |your (?:opponent'?s? )?)?effect,\s+(.+)/i);
  if (handTrashTriggerM) {
    timings.push('手牌廢棄時');
    actionText = handTrashTriggerM[1].trim();
  }

  // Detect "When this Character battles and K.O.'s your opponent's Character, [action]" — on-battle-KO trigger
  const battleKoTriggerM = actionText.match(/^When this (?:Character|Leader|card) battles and K\.O\.'?s your opponent'?s? (?:Character|Leader|card)[^,]*,\s+(.+)/i);
  if (battleKoTriggerM) {
    timings.push('攻擊時'); // fires during the attack that results in KO
    actionText = battleKoTriggerM[1].trim();
  }

  // Detect "At the end of a battle in which this Character battles, [action]" — end-of-battle trigger
  const endBattleTriggerM = actionText.match(/^At the end of a battle in which this (?:Character|Leader|card) battles[^,]*,\s+(.+)/i);
  if (endBattleTriggerM) {
    timings.push('攻擊時');
    actionText = endBattleTriggerM[1].trim();
  }

  // Detect "When this Character becomes rested, [action]" — rest trigger
  const selfRestedTriggerM = actionText.match(/^When this (?:Character|Leader|card) becomes rested[^,]*,\s+(.+)/i);
  if (selfRestedTriggerM) {
    timings.push('休息時');
    actionText = selfRestedTriggerM[1].trim();
  }

  // Detect "When your opponent plays a Character, [action]" — opponent-play trigger
  const oppPlayTriggerM = actionText.match(/^When your opponent plays? (?:a |an )?(?:Character|card)[^,]*,\s+(.+)/i);
  if (oppPlayTriggerM) {
    timings.push('對手登場時');
    actionText = oppPlayTriggerM[1].trim();
  }

  // Detect optional-activation cost: "You may [cost]: [action]"
  // Must run BEFORE ifCondM so "You may X: If Y, Z" correctly strips both layers
  let isOptional = false;
  let optCostActions = [];
  let optCostDescription = null;
  const optM = actionText.match(/^You may (.+?): (.+)/i);
  if (optM) {
    isOptional = true;
    optCostDescription = optM[1];
    optCostActions = parseSentencesEN(optM[1]);
    actionText = optM[2];
  }

  // Detect EN "If ..., [action]" condition at start of action text
  // Runs after optM so "You may X: If Y, Z" correctly sees the "If Y" part
  let condition = null;
  let conditionRaw = null;
  const ifCondM = actionText.match(/^If (.+?), (?=[A-Za-z])/);
  if (ifCondM) {
    conditionRaw = ifCondM[0];
    condition = parseConditionEN(ifCondM[1]);
    actionText = actionText.slice(ifCondM[0].length).trim();
  }

  const rawActions = parseSentencesEN(actionText);
  const actions = optCostDescription
    ? [{ type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription: optCostDescription }, ...optCostActions, ...rawActions]
    : rawActions;
  if (actions.length === 0 && passive.length === 0 && timings.length === 0 && activated.length === 0)
    return null;

  return {
    timings: [...timings, ...activated],
    continuous,
    passive,
    donGate,
    donReturn,
    donRest,
    donReturnMinCount: null,
    oncePerTurn,
    isReplacement: false,
    isOptional,
    condition,
    conditionRaw,
    raw: s,
    actions,
  };
}

/** Parse EN "Choose one of the following" block. */
function parseChooseOneBlockEN(headerBlock, optionBlocks) {
  const s = headerBlock.trim();
  const keywords = [...s.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
  const timings  = keywords.filter(k => TIMING_KW.has(k));
  const activated= keywords.filter(k => ACTIVATED_KW.has(k));
  const donGateKw= keywords.find(k => /^DON(?:!!|‼) x\d+$/i.test(k));
  const donGate  = donGateKw ? parseInt(donGateKw.match(/\d+/)[0]) : null;
  const oncePerTurn = keywords.some(k => /^Once Per Turn$/i.test(k));
  const options  = optionBlocks.map(ob => {
    const rawText = ob.replace(/^[•·\-]\s*/, '').trim();
    return { label: rawText, actions: parseSentencesEN(rawText) };
  });
  return {
    timings: [...timings, ...activated], continuous: [], passive: [],
    donGate, donReturn: null, donReturnMinCount: null, oncePerTurn,
    isReplacement: false, isOptional: false, condition: null, conditionRaw: null,
    raw: s, actions: [{ type: 'CHOOSE_ONE', options }],
  };
}

/**
 * Top-level EN effect parser — the EN equivalent of parseEffect().
 * Accepts EN card.effect text and returns clause objects identical in schema
 * to what parseEffect() produces from CN text.
 */
export function parseEffectEN(text) {
  if (!text || text.trim() === '-') return [];
  // Normalize curly/smart apostrophes → straight ASCII apostrophe so all patterns work uniformly
  text = text.replace(/[\u2018\u2019\u201a\u201b]/g, "'");
  // Normalize en dash (U+2013) → hyphen-minus so numeric delta patterns work uniformly
  text = text.replace(/\u2013/g, '-');
  const blocks = normalizeDon(text).split(/<br\s*\/?>/i);
  const clauses = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i].trim();
    if (b.startsWith('(') && b.endsWith(')')) { i++; continue; }
    if (/(?:Your opponent )?[Cc]hooses? one(?: of the following)?[:\.]?$/i.test(b)) {
      const optionBlocks = [];
      let j = i + 1;
      while (j < blocks.length) {
        const ob = blocks[j].trim();
        if (ob.startsWith('•') || ob.startsWith('·') || ob.startsWith('-') || ob.startsWith('・')) {
          optionBlocks.push(ob); j++;
        } else break;
      }
      if (optionBlocks.length >= 2) {
        const result = parseChooseOneBlockEN(b, optionBlocks);
        if (result) clauses.push(result);
        i = j; continue;
      }
    }
    const result = parseBlockEN(blocks[i]);
    if (result) clauses.push(...(Array.isArray(result) ? result : [result]));
    i++;
  }
  return clauses;
}

/**
 * Parse effect for a card, preferring EN if enEffect is available.
 * Drop-in replacement for parseEffect(card.effect) in effects.js.
 */
export function parseEffectForCard(card) {
  const effect = card?.effect ?? '';
  if (!effect) return [];
  // EN effect text uses ASCII [ ] brackets; CN uses fullwidth 【 】
  const isEN = effect.includes('[') && !effect.includes('【');
  return isEN ? parseEffectEN(effect) : parseEffect(effect);
}

// ─── End of EN Parser ─────────────────────────────────────────────────────────

// Parses a Chinese card effect and attaches the aligned English clause text to
// each returned clause as `_enText`. Useful for debug sessions where the English
// effect is available as semantic ground truth for validating parsed actions.
export function parseEffectBilingual(cnText, enText) {
  const clauses = parseEffect(cnText);
  if (!enText || enText.trim() === "-") return clauses;

  // Mirror the same block-splitting logic used in parseEffect:
  // split on <br>, drop pure-parenthetical clarification blocks.
  const enBlocks = enText
    .split(/<br\s*\/?>/i)
    .map((b) => b.replace(/^\s*\(.*?\)\s*$/, "").trim())
    .filter(Boolean);

  clauses.forEach((clause, i) => {
    clause._enText = enBlocks[i] ?? null;
  });

  return clauses;
}
