/**
 * effectParser.js
 * Tokenises card effect text (Traditional Chinese, <br>-separated blocks)
 * into structured clause objects used by effectActions.js.
 */

const TIMING_KW = new Set([
  "登場時",
  "KO時",
  "攻擊時",
  "對方攻擊時",
  "防禦時",
  "我方回合結束時",
  "觸發器",
  "受到傷害時",
]);
const ACTIVATED_KW = new Set(["啟動主要", "主要", "反擊", "起動メイン"]);
const CONTINUOUS_KW = new Set(["對方回合中", "我方回合中"]);
const PASSIVE_KW = new Set(["速攻", "防禦", "防禦不可", "雙重攻擊", "消失"]);

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
    if (b.startsWith("(") && b.endsWith(")")) { i++; continue; }
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

  const timings = keywords.filter((k) => TIMING_KW.has(k));
  const activated = keywords.filter((k) => ACTIVATED_KW.has(k));
  const donGateM = s.match(/咚‼×(\d)/);
  const donGate = donGateM ? parseInt(donGateM[1]) : null;
  const oncePerTurn = keywords.includes("每回合1次");

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
    donReturn: null,
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

  // Keywords that appear in 未持有【X】 (filter condition), 獲得【X】 (grant target),
  // or 持有【X】 (has-ability filter) are not timings/passives of this card itself
  const negatedKws = new Set(
    [...s.matchAll(/未持有【([^】]+)】/g)].map((m) => m[1]),
  );
  const grantedKws = new Set(
    [...s.matchAll(/獲得【([^】]+)】/g)].map((m) => m[1].split("：")[0]),
  );
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
  const timings = keywords.filter(
    (k) => TIMING_KW.has(k) && !negatedKws.has(k),
  );
  // Detect body-text event triggers that appear outside 【】 brackets
  if (s.includes("生命值卡離開時")) timings.push("生命值卡離開時");
  if (s.includes("生命值卡變成0張時")) timings.push("生命值卡變成0張時");
  if (s.includes("置為休息狀態時")) timings.push("置為休息狀態時");
  // "...角色卡遭到KO時，" — KO-watch trigger on a filtered set of own characters
  const koWatchM = s.match(/(.+?角色卡)遭到KO時[，,]/);
  if (koWatchM) timings.push("KO時");
  // "受到傷害時或...角色卡遭到KO時" — dual OR condition; push both timings
  if (koWatchM && s.includes("受到傷害時或")) timings.push("受到傷害時");
  // "自己的「NAME」即將遭到KO時，" — named-card replacement effect (fires before the KO)
  const koWatchNameM = s.match(/自己的「([^」]+)」即將遭到KO時[，,]/);
  if (koWatchNameM) timings.push("KO替換時");
  // "這張角色卡即將離開場上時" — character self-leave-field replacement (KO, bounce, add-to-life, bottom-deck, etc.)
  if (s.includes("這張角色卡即將離開場上時")) timings.push("離場時");
  // Detect reactive DON!! return trigger: "N張以上...咚‼卡被放回咚‼卡組時，"
  const donReturnTriggerM = s.match(
    /(\d+)張以上自己場上的咚‼卡被放回咚‼卡組時[，,]/,
  );
  if (donReturnTriggerM) timings.push("咚‼卡被放回時");
  // "這張領航卡攻擊對手的領航卡時" — plain-text 攻擊時 variant on leader cards
  const leaderAttackLeaderM = s.includes("這張領航卡攻擊對手的領航卡時");
  if (leaderAttackLeaderM) timings.push("攻擊時");
  // "對手發動事件卡或【防禦】時" — opponent plays event card or uses Counter
  const opponentEventOrCounterM = s.includes("對手發動事件卡或");
  if (opponentEventOrCounterM) timings.push("對手發動事件卡或防禦時");
  const activated = keywords.filter((k) => ACTIVATED_KW.has(k));
  const continuous = keywords.filter((k) => CONTINUOUS_KW.has(k));
  const passive = keywords.filter((k) => {
    const base = k.split("：")[0];
    return (PASSIVE_KW.has(k) || PASSIVE_KW.has(base)) &&
      !negatedKws.has(k) &&
      !grantedKws.has(k) &&
      !ownedKws.has(k) &&
      !noActivateKws.has(k) &&
      !orTimingKws.has(k);
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

  // 【咚‼×N】 → N+ DON!! must be attached to enable this effect
  const donGateM = s.match(/咚‼×(\d)/);
  const donGate = donGateM ? parseInt(donGateM[1]) : null;

  // 咚‼-N(...)：→ return N DON!! to DON!! deck as activation cost
  // Parenthetical "(可將自己場上的咚‼卡依指定的數量放回咚‼卡組)" is optional flavour text
  const donRetM = s.match(/咚‼-(\d+)(?:\([^)]+\))?[：:]/);
  const donReturn = donRetM ? parseInt(donRetM[1]) : null;
  // Minimum DON!! count for the reactive "被放回咚‼卡組時" trigger
  const donReturnMinCount = donReturnTriggerM
    ? parseInt(donReturnTriggerM[1])
    : null;

  const oncePerTurn = keywords.includes("每回合1次");
  const isReplacement = s.includes("替換成") || s.includes("即將");
  // Detect optional-cost pattern: 可/可以 appears before ：
  const colonPosRaw = s.indexOf("：");
  const isOptional =
    s.includes("可以") ||
    (colonPosRaw >= 0 && s.includes("可") && s.indexOf("可") < colonPosRaw);

  // Condition: 若...時[，,]
  const condM = s.match(/若(.+?)時[，,]/);
  const condition = condM ? parseCondition(condM[1]) : null;

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
    .replace(/咚‼-\d+(?:\([^)]+\))?[：:]/, "")
    .replace(/^\//, "") // strip leading / from dual-timing syntax e.g. 【攻擊時】/【對方攻擊時】
    .replace(/可以/g, "")
    .trim();

  // Strip body-text timing phrases that are already captured in timings[] before
  // the pre/post condition split — otherwise the preamble lands in preCondActions
  // as an UNKNOWN action, consumes the once-per-turn lock, and blocks the real action.
  let strippedActionText = rawActionText;
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
      .replace(/\d+張以上自己場上的咚‼卡被放回咚‼卡組時[，,]/, "")
      .trim();
  if (s.includes("置為休息狀態時"))
    strippedActionText = strippedActionText
      .replace(/這張角色卡置為休息狀態時[，,]/, "")
      .trim();
  if (koWatchM)
    strippedActionText = strippedActionText
      .replace(/^.+?角色卡遭到KO時[，,]\s*/, "")
      .trim();
  if (leaderAttackLeaderM)
    strippedActionText = strippedActionText
      .replace(/這張領航卡攻擊對手的領航卡時[，,]\s*/, "")
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
  let actionText = strippedActionText;
  if (condM) {
    const condIdx = strippedActionText.indexOf(condM[0]);
    if (condIdx > 0) {
      const preText = strippedActionText
        .slice(0, condIdx)
        .replace(/[之後，,\s]+$/, "")
        .trim();
      if (preText) preCondActions = parseSentences(preText);
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
    const existingKws = new Set(postCondActions.filter(a => a.type === "GRANT_KEYWORD").map(a => a.keyword));
    postCondActions = [...postCondActions, ...grantKwActions.filter(a => !existingKws.has(a.keyword))];
  }

  const koFilter = koWatchM
    ? parseCardFilter(koWatchM[1].replace(/【[^】]+】/g, "").trim())
    : koWatchNameM
    ? parseCardFilter(`自己的「${koWatchNameM[1]}」`)
    : null;

  const baseClause = {
    timings: [...timings, ...activated],
    continuous,
    passive,
    donGate,
    donReturn,
    donReturnMinCount,
    oncePerTurn,
    isReplacement,
    isOptional,
    koFilter,
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
    condM?.[1] === '選擇的卡片攻擊' &&
    preCondActions.some(a => a.type === 'POWER_MOD') &&
    postCondActions.some(a => a.type === 'BLOCK_EFFECT')
  ) {
    const mergedPre = preCondActions.map(a =>
      a.type === 'POWER_MOD' ? { ...a, grantKeyword: '防禦不可' } : a
    );
    return { ...baseClause, condition: null, conditionRaw: null, actions: mergedPre };
  }

  // For activated abilities (啟動主要/起動メイン), the pre-colon actions are the
  // activation cost, not a separate unconditional clause. Merging cost+effect into
  // one clause prevents the effectKey set by the cost clause from blocking the
  // effect body (e.g. OP06-098: REST DON + REST Stage → DEPLOY from trash).
  if (
    preCondActions.length > 0 &&
    baseClause.timings.length > 0 &&
    baseClause.timings.every(t => t === '啟動主要' || t === '起動メイン')
  ) {
    return {
      ...baseClause,
      condition,
      conditionRaw: condM?.[0] ?? null,
      actions: [...preCondActions, ...postCondActions],
    };
  }

  // If there are pre-condition actions, emit two clauses so the engine can run
  // the unconditional part regardless of whether the condition is satisfied.
  if (preCondActions.length > 0) {
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

  return {
    ...baseClause,
    condition,
    conditionRaw: condM?.[0] ?? null,
    actions: postCondActions,
  };
}

// ─── Condition Parser ─────────────────────────────────────────────────────────

function parseCondition(text) {
  const c = { raw: text };

  if (text.includes("自己")) c.owner = "self";
  else if (text.includes("對手") || text.includes("對方")) c.owner = "opponent";

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
      }
    }
  } else if (text.includes("場上") && text.includes("咚‼"))
    c.subject = "don_field";
  else if (text.includes("咚‼")) {
    c.subject = "don";
    if (text.includes("活動狀態")) c.state = "active";
  }
  else if (text.includes("生命值")) c.subject = "life";
  else if (text.includes("手牌")) c.subject = "hand";
  else if (text.includes("休息狀態") && text.includes("卡片") && !text.includes("角色卡")) {
    // "自己休息狀態的卡片有N張以上" — count rested field cards, not trash
    c.subject = "characters";
    c.rested = true;
  }
  else if (text.includes("廢棄區")) c.subject = "trash";

  // Bare count with no zone keyword — sub-clause of a trash-count conditional header
  // ("若有N張以上時" without repeating "廢棄區"). In OPTCG this pattern exclusively
  // means the owner's trash pile count.
  if (!c.subject && /有\d+張(以上|以下)/.test(text)) c.subject = "trash";

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
    c.traits = allTraitMs.map(m => m[1]);
  }
  // "場上沒有自己其他的角色卡「NAME」" — extract before name matching so the
  // name is not also stored in c.name (which would be misread as a leader name check)
  const noOtherM = text.match(/沒有自己其他的角色卡「([^」]+)」/);
  if (noOtherM) c.noOther = noOtherM[1];
  const noOtherNames = noOtherM ? new Set([noOtherM[1]]) : new Set();
  const allNameMs = [...text.matchAll(/「([^」]+)」/g)].filter(m => !noOtherNames.has(m[1]));
  if (allNameMs.length === 1) c.name = allNameMs[0][1];
  else if (allNameMs.length > 1) c.names = allNameMs.map(m => m[1]);

  const attrMap = {
    斬: "Slash",
    打: "Strike",
    射: "Ranged",
    特: "Special",
    知: "Wisdom",
  };
  const attrCondM = text.match(/\(([^)]+)\)屬性/);
  if (attrCondM && attrMap[attrCondM[1]]) c.attribute = attrMap[attrCondM[1]];

  // Count comparison: 在N張以下/以上 or 有N張以上
  const cntM = text.match(/(?:在|有)(\d+)張(以下|以上)/);
  if (cntM) {
    c.count = parseInt(cntM[1]);
    c.countOp = cntM[2] === "以上" ? "gte" : "lte";
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
  return text
    .split(/[。；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      // "公開...手牌...，並以...加入生命值區" — keep as one sentence so ADD_TO_LIFE can see source zone
      if (s.includes("公開") && s.includes("手牌") && s.includes("生命值區")) {
        return [s];
      }
      // Split compound action chains joined by ，並 (e.g. "抽2張，並廢棄1張")
      // but NOT search sentences where ，並加入手牌 is part of the SEARCH result description
      if (s.includes("，並") && !s.includes("查看")) {
        return s
          .split(/，並/)
          .map((p) => p.trim())
          .filter(Boolean);
      }
      // Split "廢棄N張...，將...置為休息狀態" compound cost (discard + self-rest)
      // so the DISCARD action is not swallowed by the REST regex
      if (
        s.includes("廢棄") &&
        s.includes("，將") &&
        s.includes("置為休息狀態")
      ) {
        return s
          .split(/，(?=將)/)
          .map((p) => p.trim())
          .filter(Boolean);
      }
      // Split "原本的力量值變更成N、費用+N" compound (power-set + cost-mod joined by 、)
      if (s.includes("原本的力量值變更成") && s.includes("、費用")) {
        return s.split(/、(?=費用)/).map((p) => p.trim()).filter(Boolean);
      }
      return [s];
    })
    .flatMap((s) => {
      const r = parseSentence(s);
      return Array.isArray(r) ? r : r ? [r] : [];
    });
}

function parseSentence(s) {
  // Strip leading "之後，" / "之後，在這個回合，" sequential connectors (grammatical only, no semantic content)
  s = s.replace(/^之後[，,]\s*/, '').trim();

  // Strip "若有執行此動作時" conditional prefix and mark resulting action
  const conditionalOnPrev = s.includes("若有執行此動作時");
  if (conditionalOnPrev) s = s.replace(/^若有執行此動作時[，,]?\s*/, "").trim();

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
  if (deployM)
    return {
      type: "DEPLOY",
      count: parseInt(deployM[1] ?? "1"),
      filter: parseCardFilter(deployM[2]),
    };

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
  const condKoCostM = s.match(/若該張角色卡的費用在(\d+)以下時[，,]即KO該張角色卡/);
  if (condKoCostM)
    return {
      type: "KO",
      count: 1,
      filter: { owner: "opponent", zone: "field", category: "Character", costMax: parseInt(condKoCostM[1]) },
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
        until: s.includes("在這個回合") ? "turn" : null,
      };
    }
  }

  // Compound DON!! rest + self-rest: "將N張...咚‼卡和這張角色卡置為休息狀態" (DON first)
  // Must be checked before the general REST regex (which would merge both into one filter).
  const compoundDonSelfRestM = s.match(/將(\d+)張(.+?咚‼卡)和這張(?:角色)?卡置為休息狀態/);
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

  // REST (global match handles compound costs like "rest DON!! AND rest this card")
  const restMatches = [...s.matchAll(/將(.+?)置為休息狀態/g)];
  if (restMatches.length) {
    const acts = restMatches.map((m) => {
      const cntM = m[1].match(/^(\d+)張/) ?? m[1].match(/(?:合計)?最多(\d+)張/);
      const count = m[1].includes("任意張數") ? Infinity : cntM ? parseInt(cntM[1]) : 1;
      return { type: "REST", count, filter: parseCardFilter(m[1]), ...(s.startsWith("可") ? { isOptional: true } : {}) };
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

  // REFRESH_LOCK — opponent's rested characters cannot become active in next opponent refresh phase
  // "全數" variant: all matching targets (no player choice)
  const refreshLockAllM = s.match(/(.+?)全數[，,]在下一個對手的重整階段無法為活動狀態/);
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

  // UNREST_DON deferred to end of this turn: "這回合結束時，將最多N張...咚‼卡置為活動狀態"
  if (s.startsWith('這回合結束時') && /將最多(\d+)?張.{0,6}咚‼.{0,4}置為活動狀態/.test(s)) {
    const cntM = s.match(/最多(\d+)?張/);
    return { type: "UNREST_DON_END_OF_TURN", count: parseInt(cntM?.[1] ?? "1") };
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
    const targets = unrestM[1].split(/和(?=最多)/).map(t => t.replace(/[，。]\s*$/, '').trim());
    if (targets.length > 1) {
      return targets.map(t => {
        if (/咚‼/.test(t)) {
          const cntM = t.match(/最多(\d+)?張/);
          return { type: 'UNREST_DON', count: parseInt(cntM?.[1] ?? '1') };
        }
        const cntM = t.match(/最多(\d+)?張/);
        return { type: 'UNREST', count: cntM ? parseInt(cntM[1] ?? '1') : 1, filter: parseCardFilter(t) };
      });
    }
    const cntM = unrestM[1].match(/最多(\d+)?張/);
    const count = cntM ? parseInt(cntM[1] ?? "1") : 1;
    return { type: "UNREST", count, filter: parseCardFilter(unrestM[1]) };
  }

  // POWER_MOD_BY_LIFE_COST — "公開的卡片每有費用N，...力量值+M" — must be checked before POWER_MOD
  // e.g. OP15-119: "公開的卡片每有費用1，這張角色卡，在這個回合，力量值+1000"
  if (s.includes("公開的卡片") && s.includes("每有費用") && s.includes("力量值")) {
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
    const perDonM = s.match(/每有(\d+)張[^，]*咚‼[^，]*[，,](.+?)[，,]在這場對戰中[，,]力量值([+＋\-－]\d+)/);
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

  // COST_MOD (board-wide) — "對手的角色卡全數費用-N" (no 最多N張 prefix, applies to all matching)
  const costModAllM = s.match(/^(.+?)全數費用([+＋\-－]\d+)/);
  if (costModAllM && !s.includes("以下") && !s.includes("以上")) {
    const rawDelta = costModAllM[2].replace('＋', '+').replace('－', '-');
    const delta = parseInt(rawDelta);
    const until = s.includes('在這個回合') ? 'turn' : s.includes('在這場對戰中') ? 'battle' : 'continuous';
    return { type: 'COST_MOD', delta, until, count: Infinity, filter: parseCardFilter(costModAllM[1].trim()) };
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
  if (s.includes("原本的力量值") && s.includes("變成和選擇的角色卡的力量值相同"))
    return { type: "COPY_POWER_FROM_TARGET", until: s.includes("在這個回合") ? "turn" : null };

  // SET_BASE_POWER opponent-turn only — "在對方的回合，自己的領航卡原本的力量值變更成N"
  const setLeaderPowerOppTurnM = s.match(/在對方的回合[，,]自己的領航卡原本的力量值變更成(\d+)/);
  if (setLeaderPowerOppTurnM)
    return { type: 'SET_BASE_POWER', value: parseInt(setLeaderPowerOppTurnM[1]), filter: { category: 'Leader' }, opponentTurnOnly: true };

  // SET_BASE_POWER — "自己擁有《X》特徵的領航卡，原本的力量值變更成N"
  const setBasePowerM = s.match(/自己擁有《([^》]+)》特徵的領航卡，原本的力量值變更成(\d+)/);
  if (setBasePowerM) return { type: 'SET_BASE_POWER', value: parseInt(setBasePowerM[2]), filter: { category: 'Leader', trait: setBasePowerM[1] } };

  // SET_BASE_POWER (characters) — "自己擁有《X》特徵的角色卡全數原本的力量值變更成N"
  const setBaseCharPowerM = s.match(/自己擁有《([^》]+)》特徵的角色卡全數原本的力量值變更成(\d+)/);
  if (setBaseCharPowerM) return { type: 'SET_BASE_POWER', value: parseInt(setBaseCharPowerM[2]), filter: { category: 'Character', trait: setBaseCharPowerM[1] } };

  // SET_BASE_POWER (self only) — "這張角色卡原本的力量值變更成N"
  const setSelfBasePowerM = s.match(/^這張角色卡原本的力量值變更成(\d+)$/);
  if (setSelfBasePowerM) return { type: 'SET_BASE_POWER', value: parseInt(setSelfBasePowerM[1]), filter: { self: true } };

  // SET_BASE_POWER (named chars + self) — "自己全數的「X」和這張角色卡，原本的力量值變更成N"
  const setBaseNameSelfM = s.match(/自己全數的「([^」]+)」和這張角色卡[，,]原本的力量值變更成(\d+)/);
  if (setBaseNameSelfM) return [
    { type: 'SET_BASE_POWER', value: parseInt(setBaseNameSelfM[2]), filter: { category: 'Character', name: setBaseNameSelfM[1] } },
    { type: 'SET_BASE_POWER', value: parseInt(setBaseNameSelfM[2]), filter: { category: 'Character', self: true } },
  ];

  // POWER_SET_ZERO — "最多N張{filter}，在這個回合，力量值減至0"
  const powerZeroM = s.match(/力量值減至0/);
  if (powerZeroM) {
    const tgtM = s.match(/最多(\d+)?張(.+?)(?:，在|的力量)/);
    const filterText = tgtM ? tgtM[2] : null;
    return {
      type: "POWER_MOD",
      setToZero: true,
      until: s.includes('在這個回合') ? 'turn' : 'continuous',
      count: tgtM ? parseInt(tgtM[1] ?? '1') : 1,
      filter: filterText ? parseCardFilter(filterText) : { self: true },
    };
  }

  // POWER_MOD dual target — "自己的「NAME」和自己擁有《TRAIT》特徵的角色卡全數，TIME，力量值+N"
  // 「NAME」 includes leader and character (includesLeader:true); 角色卡全數 is Character only.
  const powerModDualM = s.match(/^自己的「([^」]+)」和自己擁有《([^》]+)》特徵的角色卡全數[，,].+?力量值([+\-＋－]\d+)/);
  if (powerModDualM) {
    const name = powerModDualM[1];
    const trait = powerModDualM[2];
    const delta = parseInt(powerModDualM[3].replace('＋', '+').replace('－', '-'));
    const until = s.includes('在這個回合') ? 'turn'
      : s.includes('在這場對戰中') ? 'battle'
      : s.includes('在下一個對手回合結束前') || s.includes('在下一個對手結束階段結束前') ? 'opponent_turn_end'
      : 'continuous';
    return [
      { type: 'POWER_MOD', delta, until, count: Infinity, filter: { owner: 'self', name, includesLeader: true } },
      { type: 'POWER_MOD', delta, until, count: Infinity, filter: { owner: 'self', category: 'Character', trait } },
    ];
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
            s.includes("在下一個對手結束階段結束前")
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
    return {
      type: "POWER_MOD",
      delta,
      until,
      filter: filterText ? parseCardFilter(filterText) : { self: true },
      ...(allTgtM ? { count: Infinity } : {}),
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
    };
  }

  // DISCARD_EQUAL_TO_DRAW — "依抽取的卡片張數廢棄自己的手牌"
  if (s.includes("依抽取的卡片張數") && s.includes("廢棄")) {
    return { type: "DISCARD_EQUAL_TO_DRAW", filter: { owner: "self", zone: "hand" } };
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

  // LIFE_TO_TRASH — life card goes directly to trash
  if (s.includes("生命值區") && (s.includes("廢棄") || s.includes("廢棄區"))) {
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)?張/);
    const targetOwner =
      s.includes("對手") || s.includes("對方") ? "opponent" : "self";
    return {
      type: "LIFE_TO_TRASH",
      count: parseInt(cntM?.[1] ?? "1"),
      targetOwner,
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
    return { type: "RETURN_HAND", count, filter: parseCardFilter(filterText) };
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
    const donStateM = s.match(/張(休息|活動)狀態的咚‼/);
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
        const parts = targetM[1].split(/和(?=\d?張?(?:自己|對手|對方)的)/);
        if (parts.length >= 2) {
          return parts.map((t) => ({
            type: "ATTACH_DON",
            count,
            donState,
            filter: parseCardFilter(t.trim()),
          }));
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
    return {
      type: "ATTACH_DON",
      count: parseInt(s.match(/附加最多各?(\d+)張/)?.[1] ?? "1"),
      donState,
      filter: parseCardFilter(filterText),
    };
  }

  // FLIP_LIFE_FACE_UP — e.g. "將1張自己生命值區上面的卡片翻成正面朝上"
  if (s.includes("翻成正面朝上")) return { type: "FLIP_LIFE_FACE_UP" };

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

  // "其餘卡片...放到卡組下面/上面" — describes putting SEARCH leftovers at the bottom in order,
  // which is already handled by the SEARCH_ORDER interactive step. Skip entirely.
  if (s.includes("其餘") && (s.includes("卡組") || s.includes("下面")))
    return null;

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
      .replace(/放到卡組.+/, "")
      .trim();
    return {
      type: "BOTTOM_DECK",
      count: parseInt(cntM?.[1] ?? "1"),
      filter: parseCardFilter(srcText),
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

  // FIRE_MAIN_EFFECT — "發動這張卡片的【主要】效果" (trigger re-fires this card's main effect)
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

  // REVEAL_LIFE — "公開最多N張自己生命值區上面的卡片"
  const revealLifeM = s.match(/公開最多(\d+)張自己生命值區上面的卡片/);
  if (revealLifeM)
    return { type: "REVEAL_LIFE", count: parseInt(revealLifeM[1]) };

  // REVEAL_HAND_CARDS — "公開N張...手牌中..." (character card, event card, or trait-filtered cards)
  if (s.includes("手牌")) {
    const revealHandCharM = s.match(/公開(\d+)張(.+?)的角色卡/);
    if (revealHandCharM)
      return { type: "REVEAL_HAND_CARDS", count: parseInt(revealHandCharM[1]), filter: parseCardFilter(revealHandCharM[2] + "的角色卡") };
    const revealHandEventM = s.match(/公開(\d+)張(.+?)的?事件卡/);
    if (revealHandEventM)
      return { type: "REVEAL_HAND_CARDS", count: parseInt(revealHandEventM[1]), filter: { category: "Event", ...parseCardFilter(revealHandEventM[2]) } };
    const revealHandTraitM = s.match(/公開(\d+)張(.+?擁有.+?特徵.+?)的?卡片/);
    if (revealHandTraitM)
      return { type: "REVEAL_HAND_CARDS", count: parseInt(revealHandTraitM[1]), filter: parseCardFilter(revealHandTraitM[2]) };
  }

  // DON_EQUALIZE_EOT — "將咚‼卡放回咚卡組，使自己場上的咚‼卡和對手場上的咚‼卡張數一樣"
  if (s.includes("使自己場上的咚‼卡和對手場上的咚‼卡張數一樣")) return { type: "DON_EQUALIZE_EOT" };

  // OPPONENT_DON_RETURN — "對手將N張自身場上的咚‼卡放回咚‼卡組"
  const oppDonRetM = s.match(/對手將(\d+)張自身場上的咚‼卡放回咚‼卡組/);
  if (oppDonRetM) return { type: "OPPONENT_DON_REST_DEFERRED", count: parseInt(oppDonRetM[1]), isReturn: true };

  // COST_MOD with trait/cost filter — "使自己手牌中費用N以上擁有《X》特徵的角色卡登場的支付費用減少N"
  const costModDeployM = s.match(/使自己手牌中費用(\d+)(以上|以下)擁有《([^》]+)》特徵的角色卡登場的支付費用減少(\d+)/);
  if (costModDeployM)
    return { type: "COST_MOD", delta: -parseInt(costModDeployM[4]), filter: { owner: "self", category: "Character", trait: costModDeployM[3] }, until: "turn" };

  // HAND_COST_MOD with name/cost filter — "使自己手牌中費用N以上的「X」登場的支付費用減少N"
  const handCostModNameM = s.match(/使自己手牌中費用(\d+)(以上|以下)的「([^」]+)」登場的支付費用減少(\d+)/);
  if (handCostModNameM) {
    const dir = handCostModNameM[2];
    const cost = parseInt(handCostModNameM[1]);
    return {
      type: "HAND_COST_MOD",
      delta: -parseInt(handCostModNameM[4]),
      filter: { name: handCostModNameM[3], ...(dir === '以上' ? { costMin: cost } : { costMax: cost }) },
      until: "turn",
    };
  }

  // SELF_EFFECT_NULL — "自己的效果無效" (self-debuff, rare)
  if (s.includes("自己的效果無效")) return { type: "BLOCK_EFFECT", targetOwner: "self", until: "turn" };

  // SELECT target card (standalone, no action — marks target for conditional follow-up)
  const selectOnlyM = s.match(/選擇(?:最多)?(\d+)?張(.+?)角色卡(?:$|[。，])/);
  if (selectOnlyM && !s.includes("登場") && !s.includes("KO") && !s.includes("廢棄") && !s.includes("休息") && !s.includes("活動") && !s.includes("手牌"))
    return { type: "SELECT_TARGET", count: parseInt(selectOnlyM[1] ?? "1"), filter: parseCardFilter(selectOnlyM[2] + "角色卡") };

  // CONDITIONAL_DEPLOY — "也可登場" / "也可以休息狀態登場" / "也休息狀態登場" (deploy revealed card)
  if (s.includes("也可") && s.includes("登場"))
    return { type: "CONDITIONAL_DEPLOY", deployState: s.includes("休息") ? "rest" : "active" };
  if (s.includes("也休息狀態登場"))
    return { type: "CONDITIONAL_DEPLOY", deployState: "rest" };

  // OPPONENT_HAND_TO_DECK — "對手將自身的手牌全部放回卡組並洗牌"
  if (s.includes("對手") && s.includes("手牌") && s.includes("放回卡組") && s.includes("洗牌"))
    return { type: "OPPONENT_HAND_TO_DECK", shuffle: true };

  // HAND_TO_DECK with reorder — "將N張自己的手牌任意變換排列順序放置在卡組上面或下面"
  const handReorderM = s.match(/將(\d+)張自己的手牌任意變換排列順序放置在卡組/);
  if (handReorderM) return { type: "HAND_TO_DECK", count: parseInt(handReorderM[1]), reorder: true, position: s.includes("下面") ? "bottom" : "top" };

  // DISCARD_FIELD_CHAR — "可將N張自己的角色卡放置在廢棄區" (as activation cost or effect)
  const discardFieldM = s.match(/可?將(\d+)張自己的角色卡放置在廢棄區/);
  if (discardFieldM) return { type: "DISCARD", count: parseInt(discardFieldM[1]), filter: { owner: "self", category: "Character", zone: "field" }, isOptional: s.includes("可") };

  // LOOK_ARRANGE_LIFE_ALL — "查看自己全數的生命值卡，將N張放置在自己卡組上面，並將生命值卡依任意順序放置"
  const lookAllLifeM = s.match(/查看自己全數的生命值卡/);
  if (lookAllLifeM) return { type: "LOOK_ARRANGE_LIFE", count: null, targetOwner: "self", allCards: true };

  // WIN_GAME — "自己將遊戲獲勝" / "自己將獲勝而非輸掉遊戲"
  if (s.includes("自己將") && (s.includes("獲勝") || s.includes("遊戲獲勝"))) return { type: "WIN_GAME" };

  // DECLARE_COST — "聲明任意的費用" (declare an arbitrary cost)
  if (s.includes("聲明任意的費用")) return { type: "DECLARE_COST" };

  // Dual-select from trash — "選擇自己廢棄區中最多N張費用N以下的角色卡，和最多N張費用N以下的角色卡"
  const dualSelectTrashM = s.match(/選擇自己廢棄區中最多(\d+)張(.+?)，和最多(\d+)張(.+?)角色卡/);
  if (dualSelectTrashM)
    return {
      type: "SELECT_TARGET",
      groups: [
        { count: parseInt(dualSelectTrashM[1]), filter: parseCardFilter(dualSelectTrashM[2] + "的角色卡"), zone: "trash" },
        { count: parseInt(dualSelectTrashM[3]), filter: parseCardFilter(dualSelectTrashM[4] + "的角色卡"), zone: "trash" },
      ],
    };

  // Deploy-N-rest-others — "使其中N張登場，其餘卡片以休息狀態登場"
  const deployNRestM = s.match(/使其中(\d+)張登場，其餘卡片以休息狀態登場/);
  if (deployNRestM) return { type: "DEPLOY", count: parseInt(deployNRestM[1]), restRemainder: true, source: "selected" };

  // KO dual — "KO對手最多N張費用N以下的角色卡和最多N張費用N以下的角色卡"
  const koDualM = s.match(/KO對手最多(\d+)張(.+?)和最多(\d+)張(.+?)角色卡/);
  if (koDualM)
    return [
      { type: "KO", count: parseInt(koDualM[1]), filter: parseCardFilter(koDualM[2] + "的角色卡") },
      { type: "KO", count: parseInt(koDualM[3]), filter: parseCardFilter(koDualM[4] + "的角色卡") },
    ];

  // POWER_MOD self until next own turn start — "這張角色卡，到下一個我方回合開始前，力量+N"
  const powerTillOwnTurnM = s.match(/這張角色卡[，,]到下一個我方回合開始前[，,]力量[值]?[+＋](\d+)/);
  if (powerTillOwnTurnM) return { type: "POWER_MOD", delta: parseInt(powerTillOwnTurnM[1]), until: "startOfOwnTurn", filter: { self: true } };

  // Skip timing-declaration sentences (body-text trigger preamble, not an action)
  if (s.endsWith("，發動") || s === "對手發動時" || s === "對手攻擊時，發動") return null;

  // GRANT_KEYWORD on up to N cards this turn — "最多N張(filter)，在這個回合，獲得【keyword】"
  const grantCountM = s.match(/最多(\d+)?張(.+?)在這個回合，獲得【([^】]+)】/);
  if (grantCountM && PASSIVE_KW.has(grantCountM[3]))
    return { type: "GRANT_KEYWORD", keyword: grantCountM[3], count: parseInt(grantCountM[1] ?? "1"), filter: parseCardFilter(grantCountM[2].replace(/[，,]\s*$/, "")), until: "turn" };

  // GRANT_KEYWORD on all matching cards this turn (no count prefix) — "FILTER，在這個回合，獲得【keyword】"
  const grantAllM = s.match(/^(.+?)，在這個回合，獲得【([^】]+)】$/);
  if (grantAllM && PASSIVE_KW.has(grantAllM[2]))
    return { type: "GRANT_KEYWORD", keyword: grantAllM[2], count: Infinity, filter: parseCardFilter(grantAllM[1]), until: "turn" };

  // FIELD_TO_LIFE — "將最多N張...，以正面朝上放置在持有者的生命值區上面或下面"
  const fieldToLifeM = s.match(/將最多(\d+)張(.+?)，以正面朝上放置在持有者的生命值區上面或下面/);
  if (fieldToLifeM)
    return { type: "FIELD_TO_LIFE", count: parseInt(fieldToLifeM[1]), filter: parseCardFilter(fieldToLifeM[2]), faceUp: true, choosePosition: true };

  // KO broad — "將最多N張對手費用N以下的角色卡放置在廢棄區"
  const koPlaceTrashM = s.match(/將最多(\d+)張(.+?)放置在廢棄區/);
  if (koPlaceTrashM)
    return { type: "KO", count: parseInt(koPlaceTrashM[1]), filter: parseCardFilter(koPlaceTrashM[2].replace(/[，,]\s*$/, "")) };

  // Skip orphan time-scope fragments that result from condition splits
  if (s === "在這個回合" || s === "之後" || s === "之後，在這個回合" || s === "➀" || s === "・" || s === "①") return null;

  // BLOCK_LIFE_TO_HAND — "自己無法以自己的效果將生命值卡加入手牌"
  if (s.includes("無法以自己的效果將生命值卡加入手牌")) return { type: "BLOCK_LIFE_TO_HAND", until: "turn" };

  // HAND_PLAY_LOCK — "自己無法使用手牌中的卡片" — cannot play cards from hand this turn
  // Matches with or without leading "之後，在這個回合，" connector phrase
  if (s.includes("無法使用手牌中的卡片")) return { type: "HAND_PLAY_LOCK", until: s.includes("在這個回合") ? "turn" : null };

  // DRAW_LOCK — "自己無法以自己的效果抽取卡片" — cannot draw cards by own effects this turn
  // Matches with or without leading "之後，在這個回合，" connector phrase
  if (s.includes("無法以自己的效果抽取卡片")) return { type: "DRAW_LOCK", until: s.includes("在這個回合") ? "turn" : null };

  // REVEAL_LIFE_TOP — "公開最多N張自己生命值區上面的卡片" (opponent reactive trigger context)
  const revealLifeTopM = s.match(/公開最多(\d+)張自己生命值區上面的卡片/);
  if (revealLifeTopM) return { type: "REVEAL_LIFE_TOP", count: parseInt(revealLifeTopM[1]) };

  // DEPLOY_RESTED_PASSIVE — leader passive: own character cards enter play in rest state
  if (s.includes("自己的角色卡以休息狀態登場")) return { type: "DEPLOY_RESTED_PASSIVE" };

  // NULL_EFFECT — "效果無效" for opponent cards (effect nullification)
  const nullEffectCombM = s.match(/最多(\d+)張(.+?)在下一個對手回合結束前，效果無效、而且該張角色卡無法進行攻擊/);
  if (nullEffectCombM)
    return [
      { type: "NULL_EFFECT", count: parseInt(nullEffectCombM[1]), filter: parseCardFilter(nullEffectCombM[2].replace(/[，,]\s*$/, "")), until: "nextOppTurn" },
      { type: "ATTACK_LOCK", count: parseInt(nullEffectCombM[1]), filter: parseCardFilter(nullEffectCombM[2].replace(/[，,]\s*$/, "")), until: "nextOppTurn" },
    ];

  const nullEffectM = s.match(/最多(\d+)張(.+?)在這個回合，效果無效/);
  if (nullEffectM) return { type: "NULL_EFFECT", count: parseInt(nullEffectM[1]), filter: parseCardFilter(nullEffectM[2].replace(/[，,]\s*$/, "")), until: "turn" };

  const nullEffectOppM = s.match(/在下一個對手回合結束前，對手的效果無效/);
  if (nullEffectOppM) return { type: "NULL_EFFECT", targetOwner: "opponent", until: "nextOppTurn" };

  // SHUFFLE_DECK — "將卡組洗牌"
  if (s.includes("將卡組洗牌") || s.includes("卡組洗牌")) return { type: "SHUFFLE_DECK", owner: "self" };

  // FLIP_LIFE_FACE_DOWN — "可將N張自己生命值區上面的卡片翻成背面朝上"
  const flipFaceDownM = s.match(/可?將(\d+)張自己(?:正面朝上的)?生命值卡?(?:區上面的卡片)?翻成背面朝上/);
  if (flipFaceDownM) return { type: "FLIP_LIFE_FACE_DOWN", count: parseInt(flipFaceDownM[1]) };

  // GRANT_KEYWORD for rush-chars-only — "在登場的回合即可攻擊角色卡"
  const rushCharsM = s.match(/(.+?)在登場的回合即可攻擊角色卡/);
  if (rushCharsM) return { type: "GRANT_KEYWORD", keyword: "RUSH_CHARS_ONLY", filter: parseCardFilter(rushCharsM[1].replace(/[，,]\s*$/, "")) };

  // ATTACK_LOCK with name exclusion — "最多N張對手除了「X」以外的角色卡，在下一個對手回合結束前，無法進行攻擊"
  const attackLockExclM = s.match(/最多(\d+)張(.+?)除了「([^」]+)」以外的(.+?)在下一個對手回合結束前，無法進行攻擊/);
  if (attackLockExclM)
    return { type: "ATTACK_LOCK", count: parseInt(attackLockExclM[1]), filter: parseCardFilter(attackLockExclM[4].replace(/[，,]\s*$/, "")), excludeName: attackLockExclM[3] };

  // ATTACK_LOCK for opponent leader/rested cards until next opponent end — "N張對手...在下一個對手回合結束前，無法進行攻擊"
  const attackLockOppM = s.match(/最多(\d+)張(.+?)在下一個對手回合結束前，無法進行攻擊/);
  if (attackLockOppM)
    return { type: "ATTACK_LOCK", count: parseInt(attackLockOppM[1]), filter: parseCardFilter(attackLockOppM[2].replace(/[，,]\s*$/, "")), until: "nextOppTurn" };

  // FORCE_ATTACK_TARGET — "對手只能攻擊角色卡「X」"
  const forceTargetM = s.match(/對手只能攻擊角色卡「([^」]+)」/);
  if (forceTargetM) return { type: "FORCE_ATTACK_TARGET", targetName: forceTargetM[1] };

  // GRANT_KEYWORD RUSH_ACTIVE_CHARS for own cards — "N張...在這個回合，攻擊活動狀態的角色卡"
  const grantRushActiveM = s.match(/最多(\d+)張(.+?)在這個回合，攻擊活動狀態的角色卡/);
  if (grantRushActiveM)
    return { type: "GRANT_KEYWORD", keyword: "RUSH_ACTIVE_CHARS", count: parseInt(grantRushActiveM[1]), filter: parseCardFilter(grantRushActiveM[2].replace(/[，,]\s*$/, "")), until: "turn" };

  // GRANT_KEYWORD for attribute-conditional battle protection — "在和擁有(X)屬性的...對戰中，不會遭到KO"
  const attrProtectM = s.match(/在和(?:未?擁有)?[（(]?(.+?)[）)]?屬性的.+?對戰中[，,]不會遭到KO/);
  if (attrProtectM) return { type: "GRANT_KEYWORD", keyword: `INDESTRUCTIBLE_VS_${attrProtectM[1]}`, filter: { self: true } };

  // Mass GRANT_KEYWORD protection — "自己的角色卡全數，到下一個我方回合開始前，不會因效果而遭到KO"
  if (s.includes("不會因效果而遭到KO") && s.includes("角色卡全數")) return { type: "GRANT_KEYWORD", keyword: "MASS_EFFECT_KO_PROTECTION", filter: { owner: "self", category: "Character" }, until: "startOfOwnTurn" };

  // REVEAL_TOP_DECK — "公開N張自己卡組上面的卡片"
  const revealTopM = s.match(/公開(\d+)張自己卡組上面的卡片/);
  if (revealTopM) return { type: "REVEAL_TOP_DECK", count: parseInt(revealTopM[1]), owner: "self" };

  // REVEAL_TOP_DECK (opponent deck) — "公開N張對手卡組上面的卡片"
  const revealOppTopM = s.match(/公開(\d+)張對手卡組上面的卡片/);
  if (revealOppTopM) return { type: "REVEAL_TOP_DECK", count: parseInt(revealOppTopM[1]), owner: "opponent" };

  // DON_RETURN_FROM_FIELD — optional "return N+ own DON!! to DON!! deck" cost/activation
  const donRetFieldM = s.match(/可將(\d+)張以上自己場上的咚‼卡放回咚‼卡組/);
  if (donRetFieldM) return { type: "DON_RETURN_FROM_FIELD", count: parseInt(donRetFieldM[1]), minCount: true };

  const donRetActiveM = s.match(/可將(\d+)張自己活動狀態的咚‼卡放回咚‼卡組/);
  if (donRetActiveM) return { type: "DON_RETURN_FROM_FIELD", count: parseInt(donRetActiveM[1]), stateFilter: "active" };

  const donRetFieldExactM = s.match(/替換成將(\d+)張自己場上的咚‼卡放回咚‼卡組/);
  if (donRetFieldExactM) return { type: "DON_RETURN_FROM_FIELD", count: parseInt(donRetFieldExactM[1]), isReplacement: true };

  // LOOK_ARRANGE_LIFE — "查看最多N張自己或對手生命值區上面的卡片，並放置在生命值區的上面或下面"
  const lookLifeM = s.match(/查看最多(\d+)張(.+?)生命值區上面的卡片，並放置在生命值區的上面或下面/);
  if (lookLifeM) {
    const both = lookLifeM[2].includes("對手");
    return { type: "LOOK_ARRANGE_LIFE", count: parseInt(lookLifeM[1]), targetOwner: both ? "both" : "self" };
  }

  // EXTRA_TURN — "在這個回合之後獲得追加我方回合"
  if (s.includes("獲得追加我方回合")) return { type: "EXTRA_TURN" };

  // BLOCK_DEPLOY with cost threshold — "無法使原本費用N以上的角色卡登場"
  const blockDeployCostM = s.match(/無法使原本費用(\d+)(以上|以下)的角色卡登場/);
  if (blockDeployCostM) {
    const n = parseInt(blockDeployCostM[1]);
    const op = blockDeployCostM[2] === "以上" ? "gte" : "lte";
    return { type: "BLOCK_DEPLOY", category: "Character", costThreshold: n, costOp: op, until: "turn" };
  }

  // BLOCK_EFFECT — opponent cannot activate effects (during battle or this turn)
  if (s.includes("對手") && s.includes("無法發動")) return { type: "BLOCK_EFFECT", targetOwner: "opponent", until: s.includes("這場對戰") ? "battle" : "turn" };

  // Mass protection of opponent's characters from self's own effects — "對手的角色卡全數，不會因自己的效果而離開場上"
  if (s.includes("不會因自己的效果而離開場上") && s.includes("對手的角色卡")) return { type: "NULL_EFFECT" };

  // Trash-count conditional header — "依照自己廢棄區中的卡片張數，適用下列效果"
  if (s.includes("廢棄區中的卡片張數") && s.includes("適用下列效果")) return { type: "NULL_EFFECT" };

  // GRANT_KEYWORD for passive protective/attack abilities expressed in body text
  if (s.includes("在對戰中不會遭到KO")) return { type: "GRANT_KEYWORD", keyword: "INDESTRUCTIBLE_IN_BATTLE", filter: { self: true } };
  if (s.includes("不會因對手的效果而離開場上")) return { type: "GRANT_KEYWORD", keyword: "EFFECT_LEAVE_PROTECTION", filter: { self: true } };
  if (s.includes("不會因效果而遭到KO") && (s.includes("這張角色卡") || s.includes("這張卡片"))) return { type: "GRANT_KEYWORD", keyword: "INDESTRUCTIBLE_BY_EFFECT", filter: { self: true } };
  if (s.includes("不會因對手的效果而遭到KO") && (s.includes("這張角色卡") || s.includes("這張卡片"))) return { type: "GRANT_KEYWORD", keyword: "EFFECT_KO_PROTECTION", filter: { self: true } };
  if ((s.includes("這張角色卡攻擊對手活動狀態的角色卡") || s.includes("可以攻擊對手活動狀態的角色卡"))) return { type: "GRANT_KEYWORD", keyword: "RUSH_ACTIVE_CHARS", filter: { self: true } };

  // SELF_ATTACK_LOCK — "這張領航卡無法攻擊" / "這張角色卡無法進行攻擊"
  if ((s.includes("這張領航卡") || s.includes("這張角色卡")) && (s.includes("無法攻擊") || s.includes("無法進行攻擊"))) return { type: "GRANT_KEYWORD", keyword: "CANNOT_ATTACK", filter: { self: true } };

  // ALTERNATE_NAMES — "在規則上，這張卡片的卡片名稱也可視為「X」和「Y」"
  const altNamesM = s.match(/在規則上，這張卡片的卡片名稱也可視為(「[^」]+」(?:和「[^」]+」)*)/);
  if (altNamesM) {
    const names = [...altNamesM[1].matchAll(/「([^」]+)」/g)].map(m => m[1]);
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
  else if (text.includes("生命值")) f.zone = "life";
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

  // Dynamic cost bound: "費用數值在自己場上的咚卡張數以下" — resolved at runtime from costArea.length
  if (text.includes("費用數值在自己場上的咚") && text.includes("以下")) {
    f.maxCostByFieldDonCount = true;
  } else {
    const costRangeM = text.match(/費用(\d+)至(\d+)/);
    if (costRangeM) {
      f.costMin = parseInt(costRangeM[1]);
      f.costMax = parseInt(costRangeM[2]);
    } else {
      const costM = text.match(/費用(\d+)(以下|以上)?/);
      if (costM) {
        f.cost = parseInt(costM[1]);
        f.costOp = costM[2] === "以上" ? "gte" : "lte";
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

  // "擁有《TRAIT》特徵的角色卡或「NAME」" → OR: (char with trait + cost constraint) OR (named char)
  if (!f.orFilters) {
    const traitOrNameM = text.match(/擁有《([^》]+)》特徵的角色卡或「([^」]+)」/);
    if (traitOrNameM) {
      const costBranch = {};
      if (f.maxCostByFieldDonCount) { costBranch.maxCostByFieldDonCount = true; delete f.maxCostByFieldDonCount; }
      if (f.cost !== undefined) { costBranch.cost = f.cost; costBranch.costOp = f.costOp; delete f.cost; delete f.costOp; }
      f.orFilters = [
        { category: 'Character', trait: traitOrNameM[1], ...costBranch },
        { category: 'Character', name: traitOrNameM[2] },
      ];
      delete f.category;
      delete f.trait;
    }
  }

  const excludeNameM = text.match(/除了「(.+?)」以外/);
  if (excludeNameM) f.excludeName = excludeNameM[1].replace(/‼/g, "!!");
  const nameM = text.match(/「([^」]+)」/);
  if (nameM && !excludeNameM && !f.orFilters) f.name = nameM[1];

  // DON!! attached condition: 已附加N張以上咚‼卡
  const donM = text.match(/已附加(\d+)?張?以上?咚‼卡|已附加咚‼卡/);
  if (donM) f.donAttached = donM[1] ? parseInt(donM[1]) : 1;

  // DON!! card type (e.g. "1張自己的咚‼卡" as a REST/cost target)
  // Exclude the "費用數值在自己場上的咚‼卡張數以下" phrase — that's a cost bound, not a DON!! target
  const donCheckText = text.replace(/費用數值在自己場上的咚‼卡張數以下/, '');
  if (donCheckText.includes("咚‼") && !text.includes("已附加")) f.cardType = "don";

  // "this card" self-reference — distinguish exclusion ("除了這張...以外") from targeting ("這張")
  if (text.includes("除了這張") && text.includes("以外")) f.excludeSelf = true;
  else if (text.includes("這張")) f.self = true;

  if (text.includes("休息狀態")) f.state = "rest";
  else if (text.includes("活動狀態")) f.state = "active";

  const ownedAbilityM = text.match(/持有【([^】]+)】/);
  if (ownedAbilityM) f.hasAbility = ownedAbilityM[1];

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
    打擊: "Strike",
    射程: "Ranged",
    特殊: "Special",
    知慧: "Wisdom",
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
