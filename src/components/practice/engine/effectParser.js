/**
 * effectParser.js
 * Tokenises card effect text (Traditional Chinese, <br>-separated blocks)
 * into structured clause objects used by effectActions.js.
 */

const TIMING_KW     = new Set(['登場時','KO時','攻擊時','對方攻擊時','防禦時','我方回合結束時','觸發器']);
const ACTIVATED_KW  = new Set(['啟動主要','主要','反擊','起動メイン']);
const CONTINUOUS_KW = new Set(['對方回合中','我方回合中']);
const PASSIVE_KW    = new Set(['速攻','防禦','防禦不可','雙重攻擊','消失']);

// Normalise DON!! text to canonical ‼ (U+203C).
// Handles every common iOS-emoji workaround: bare !!, !! with a zero-width char between,
// and ‼ followed by a variation-selector or zero-width char.
const _ZW_CLASS = '​‌‍⁠­﻿︎️';
const DOUBLE_BANG_RE = new RegExp(`![${_ZW_CLASS}]?!`, 'g');  // !! or !<zw>! → ‼
const POST_BANG_RE   = new RegExp(`‼[${_ZW_CLASS}]`, 'g'); // ‼<zw>       → ‼

function normalizeDon(text) {
  return text.replace(DOUBLE_BANG_RE, '‼').replace(POST_BANG_RE, '‼');
}

/**
 * Parse a card's effect string into an array of clause objects.
 * @param {string} text  card.effect (HTML, <br>-delimited)
 * @returns {Clause[]}
 */
export function parseEffect(text) {
  if (!text) return [];
  return normalizeDon(text).split('<br>').flatMap(block => {
    const result = parseBlock(block);
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  });
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
  const negatedKws = new Set([...s.matchAll(/未持有【([^】]+)】/g)].map(m => m[1]));
  const grantedKws = new Set([...s.matchAll(/獲得【([^】]+)】/g)].map(m => m[1].split('：')[0]));
  const allOwnedKws = new Set([...s.matchAll(/持有【([^】]+)】/g)].map(m => m[1]));
  const ownedKws   = new Set([...allOwnedKws].filter(k => !negatedKws.has(k)));
  const timings    = keywords.filter(k => TIMING_KW.has(k) && !negatedKws.has(k));
  // Detect body-text event triggers that appear outside 【】 brackets
  if (s.includes('生命值卡離開時')) timings.push('生命值卡離開時');
  // Detect reactive DON!! return trigger: "N張以上...咚‼卡被放回咚‼卡組時，"
  const donReturnTriggerM = s.match(/(\d+)張以上自己場上的咚‼卡被放回咚‼卡組時[，,]/);
  if (donReturnTriggerM) timings.push('咚‼卡被放回時');
  const activated  = keywords.filter(k => ACTIVATED_KW.has(k));
  const continuous = keywords.filter(k => CONTINUOUS_KW.has(k));
  const passive    = keywords.filter(k => PASSIVE_KW.has(k) && !negatedKws.has(k) && !grantedKws.has(k) && !ownedKws.has(k));

  // Detect GRANT_KEYWORD: 獲得【keyword：restriction】 where the bracket is stripped from
  // rawActionText before parseSentence sees it — must be captured here.
  const grantKwActions = keywords
    .filter(k => {
      const base = k.split('：')[0];
      return PASSIVE_KW.has(base) && !PASSIVE_KW.has(k) && s.includes(`獲得【${k}】`);
    })
    .map(k => {
      const parts = k.split('：');
      return {
        type: 'GRANT_KEYWORD',
        keyword: parts[0],
        restriction: parts[1] ?? null,
        until: s.includes('在這個回合') ? 'turn' : null,
      };
    });

  // 【咚‼×N】 → N+ DON!! must be attached to enable this effect
  const donGateM  = s.match(/咚‼×(\d)/);
  const donGate   = donGateM ? parseInt(donGateM[1]) : null;

  // 咚‼-N(...)：→ return N DON!! to DON!! deck as activation cost
  // Parenthetical "(可將自己場上的咚‼卡依指定的數量放回咚‼卡組)" is optional flavour text
  const donRetM   = s.match(/咚‼-(\d)(?:\([^)]+\))?[：:]/);
  const donReturn = donRetM ? parseInt(donRetM[1]) : null;
  // Minimum DON!! count for the reactive "被放回咚‼卡組時" trigger
  const donReturnMinCount = donReturnTriggerM ? parseInt(donReturnTriggerM[1]) : null;

  const oncePerTurn   = keywords.includes('每回合1次');
  const isReplacement = s.includes('替換成') || s.includes('即將');
  // Detect optional-cost pattern: 可/可以 appears before ：
  const colonPosRaw = s.indexOf('：');
  const isOptional  = s.includes('可以') ||
    (colonPosRaw >= 0 && s.includes('可') && s.indexOf('可') < colonPosRaw);

  // Condition: 若...時[，,]
  const condM     = s.match(/若(.+?)時[，,]/);
  const condition = condM ? parseCondition(condM[1]) : null;

  // Build raw action text (before stripping condition).
  // Protect 【X】 brackets that appear inside filter conditions (未持有【X】, 獲得【X】)
  // so parseSentence can still read them after the global strip of section-header brackets.
  const rawActionText = s
    .replace(/未持有【([^】]+)】/g, '未持有￹$1￺')  // protect negated-keyword filter
    .replace(/獲得【([^】]+)】/g, '獲得￹$1￺')        // protect grant-keyword target
    .replace(/持有【([^】]+)】/g, '持有￹$1￺')        // protect has-ability filter
    .replace(/【[^】]+】/g, '')                                  // strip remaining section headers
    .replace(/未持有￹([^￺]+)￺/g, '未持有【$1】') // restore
    .replace(/獲得￹([^￺]+)￺/g, '獲得【$1】')     // restore
    .replace(/持有￹([^￺]+)￺/g, '持有【$1】')     // restore
    .replace(/咚‼-\d(?:\([^)]+\))?[：:]/, '')
    .replace(/^\//, '')          // strip leading / from dual-timing syntax e.g. 【攻擊時】/【對方攻擊時】
    .replace(/可以/g, '')
    .trim();

  // Detect mid-block condition: condition appears after some unconditional content.
  // When found, split into preCondActions (no condition) + postCondActions (with condition)
  // so that unconditional actions like ATTACH_DON aren't skipped when the condition fails.
  let preCondActions = [];
  let actionText = rawActionText;
  if (condM) {
    const condIdx = rawActionText.indexOf(condM[0]);
    if (condIdx > 0) {
      const preText = rawActionText.slice(0, condIdx)
        .replace(/[之後，,\s]+$/, '').trim();
      if (preText) preCondActions = parseSentences(preText);
      actionText = rawActionText.slice(condIdx + condM[0].length).trim();
    } else {
      actionText = rawActionText.replace(condM[0], '').trim();
    }
  }

  // Strip body-text timing phrases now that they're captured in timings[]
  if (s.includes('生命值卡離開時')) actionText = actionText.replace(/生命值卡離開時[，,]\s*發動[。]?/, '').trim();
  if (donReturnTriggerM) actionText = actionText.replace(/\d+張以上自己場上的咚‼卡被放回咚‼卡組時[，,]/, '').trim();

  // Build post-condition actions, handling optional cost (：) split
  const colonIdx  = actionText.indexOf('：');
  let postCondActions;
  if (colonIdx >= 0) {
    const costText   = actionText.slice(0, colonIdx).trim();
    const effectText = actionText.slice(colonIdx + 1).trim();
    const costParsed   = parseSentences(costText);
    const effectParsed = parseSentences(effectText);
    if (isOptional && costText) {
      postCondActions = [
        { type: 'CONFIRM_OPTIONAL_ACTIVATION', costDescription: costText },
        ...costParsed,
        ...effectParsed,
      ];
    } else {
      postCondActions = [...costParsed, ...effectParsed];
    }
  } else {
    postCondActions = parseSentences(actionText);
  }

  if (grantKwActions.length) postCondActions = [...postCondActions, ...grantKwActions];

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
    raw: s,
  };

  // 若...發動...事件卡時 — convert to a REGISTER_ON_EVENT_TRIGGER action so the engine
  // registers a per-turn watcher instead of performing a static condition check.
  if (condition?.subject === 'event_play') {
    const triggerFilter = { category: 'Event' };
    if (condition.cost !== undefined) {
      triggerFilter.cost = condition.cost;
      triggerFilter.costOp = condition.costOp;
    }
    return {
      ...baseClause,
      condition: null,
      conditionRaw: condM?.[0] ?? null,
      actions: [{ type: 'REGISTER_ON_EVENT_TRIGGER', filter: triggerFilter, triggerActions: postCondActions }],
    };
  }

  // If there are pre-condition actions, emit two clauses so the engine can run
  // the unconditional part regardless of whether the condition is satisfied.
  if (preCondActions.length > 0) {
    return [
      { ...baseClause, condition: null, conditionRaw: null, actions: preCondActions },
      { ...baseClause, condition, conditionRaw: condM?.[0] ?? null, actions: postCondActions },
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

  if (text.includes('自己'))                               c.owner = 'self';
  else if (text.includes('對手') || text.includes('對方')) c.owner = 'opponent';

  if      (text.includes('發動') && text.includes('事件卡')) {
    // "發動原本費用N以上的事件卡" — reactive event-play trigger condition
    c.subject = 'event_play';
    const costM2 = text.match(/費用(\d+)(以下|以上)/);
    if (costM2) { c.cost = parseInt(costM2[1]); c.costOp = costM2[2] === '以上' ? 'gte' : 'lte'; }
  }
  else if (text.includes('領航卡')) {
    c.subject = 'leader';
    if (text.includes('多種顏色')) c.multiColor = true;
  }
  else if (text.includes('角色卡')) {
    c.subject = 'characters';
    const costM3 = text.match(/費用(\d+)(以下|以上)/);
    if (costM3) { c.cost = parseInt(costM3[1]); c.costOp = costM3[2] === '以上' ? 'gte' : 'lte'; }
  }
  else if (text.includes('場上') && text.includes('咚‼')) c.subject = 'don_field';
  else if (text.includes('咚‼'))     c.subject = 'don';
  else if (text.includes('生命值'))  c.subject = 'life';
  else if (text.includes('手牌'))    c.subject = 'hand';
  else if (text.includes('廢棄區'))  c.subject = 'trash';

  const traitM = text.match(/[《『]([^》』]+)[》』]/); if (traitM) c.trait = traitM[1];
  const nameM  = text.match(/「([^」]+)」/); if (nameM)  c.name  = nameM[1];

  // Count comparison: 在N張以下/以上 or 有N張以上
  const cntM = text.match(/(?:在|有)(\d+)張(以下|以上)/);
  if (cntM) { c.count = parseInt(cntM[1]); c.countOp = cntM[2] === '以上' ? 'gte' : 'lte'; }

  // Power threshold: 力量值N以上/以下 (e.g. "對手力量值8000以上的角色卡")
  const powerThreshM = text.match(/力量值(\d+)(以下|以上)/);
  if (powerThreshM) { c.power = parseInt(powerThreshM[1]); c.powerOp = powerThreshM[2] === '以上' ? 'gte' : 'lte'; }

  if      (text.includes('只有'))  c.predicate = 'only';
  else if (text.includes('擁有'))  c.predicate = 'has';
  else if (text.includes('沒有'))  c.predicate = 'none';

  // Compound: "場上沒有自己其他的角色卡「NAME」" — secondary "no other character named X" check
  const noOtherM = text.match(/沒有自己其他的角色卡「([^」]+)」/);
  if (noOtherM) c.noOther = noOtherM[1];

  return c;
}

// ─── Action Parser ────────────────────────────────────────────────────────────

function parseSentences(text) {
  return text
    .split(/[。；]/)
    .map(s => s.trim())
    .filter(Boolean)
    .flatMap(s => {
      // "公開...手牌...，並以...加入生命值區" — keep as one sentence so ADD_TO_LIFE can see source zone
      if (s.includes('公開') && s.includes('手牌') && s.includes('生命值區')) {
        return [s];
      }
      // Split compound action chains joined by ，並 (e.g. "抽2張，並廢棄1張")
      // but NOT search sentences where ，並加入手牌 is part of the SEARCH result description
      if (s.includes('，並') && !s.includes('查看')) {
        return s.split(/，並/).map(p => p.trim()).filter(Boolean);
      }
      // Split "廢棄N張...，將...置為休息狀態" compound cost (discard + self-rest)
      // so the DISCARD action is not swallowed by the REST regex
      if (s.includes('廢棄') && s.includes('，將') && s.includes('置為休息狀態')) {
        return s.split(/，(?=將)/).map(p => p.trim()).filter(Boolean);
      }
      return [s];
    })
    .flatMap(s => {
      const r = parseSentence(s);
      return Array.isArray(r) ? r : r ? [r] : [];
    });
}

function parseSentence(s) {
  // DRAW
  const drawM = s.match(/抽(\d+)?張/);
  if (drawM) return { type: 'DRAW', count: parseInt(drawM[1] ?? '1') };

  // SELF_DEPLOY (trigger: this card deploys itself)
  if (s.includes('使這張卡片登場') || s.includes('使這張卡進場'))
    return { type: 'SELF_DEPLOY' };

  // DUAL DEPLOY from trash — "使...費用N以下和費用M的...最多各K張登場"
  // e.g. "使自己廢棄區中擁有包含『B・W』特徵、費用4以下和費用1的角色卡最多各1張登場"
  const dualTrashDeployM = s.match(/使(.+?廢棄區.+?)費用(\d+)(以下)?和費用(\d+)(的.+?)?最多各(\d+)張登場/);
  if (dualTrashDeployM) {
    const base   = dualTrashDeployM[1]; // "自己廢棄區中擁有包含『B・W』特徵、"
    const cost1  = dualTrashDeployM[2]; // "4"
    const op1    = dualTrashDeployM[3] ?? ''; // "以下" or ""
    const cost2  = dualTrashDeployM[4]; // "1"
    const suffix = dualTrashDeployM[5] ?? ''; // "的角色卡"
    const count  = parseInt(dualTrashDeployM[6]); // 1
    return [
      { type: 'DEPLOY', count, filter: parseCardFilter(base + '費用' + cost1 + op1 + suffix) },
      { type: 'DEPLOY', count, filter: parseCardFilter(base + '費用' + cost2 + suffix) },
    ];
  }

  // DEPLOY from hand
  const deployM = s.match(/使最多(\d+)?張(.+?)(?:的卡片)?登場/);
  if (deployM) return {
    type: 'DEPLOY', count: parseInt(deployM[1] ?? '1'),
    filter: parseCardFilter(deployM[2]),
  };

  // KO
  const koAllM = s.match(/KO全數(.+)/);
  if (koAllM) return { type: 'KO', count: Infinity, filter: parseCardFilter(koAllM[1]) };
  const koM = s.match(/KO最多(\d+)?張(.+)/);
  if (koM) return {
    type: 'KO', count: parseInt(koM[1] ?? '1'),
    filter: parseCardFilter(koM[2]),
  };
  const koExactM = s.match(/KO(\d+)張(.+)/);
  if (koExactM) return {
    type: 'KO', count: parseInt(koExactM[1]),
    filter: parseCardFilter(koExactM[2]),
  };

  // Deferred opponent DON!! rest: "在下一個對手主要階段開始時，對手將N張...咚‼卡置為休息狀態"
  const deferredDonRestM = s.match(/在下一個對手主要階段開始時[，,]對手將(\d+)張.+?咚‼卡置為休息狀態/);
  if (deferredDonRestM) {
    return { type: 'OPPONENT_DON_REST_DEFERRED', count: parseInt(deferredDonRestM[1]) };
  }

  // Self GRANT_KEYWORD: "這張角色卡獲得【keyword】" — conditional inline grant (e.g. Rush when 6+ DON!!)
  const selfGrantM = s.match(/這張(?:角色卡|卡片)?獲得【([^】]+)】/);
  if (selfGrantM && PASSIVE_KW.has(selfGrantM[1])) {
    return { type: 'GRANT_KEYWORD', keyword: selfGrantM[1], filter: { self: true },
             until: s.includes('在這個回合') ? 'turn' : null };
  }

  // REST (global match handles compound costs like "rest DON!! AND rest this card")
  const restMatches = [...s.matchAll(/將(.+?)置為休息狀態/g)];
  if (restMatches.length) {
    const acts = restMatches.map(m => {
      const cntM = m[1].match(/^(\d+)張/);
      const count = cntM ? parseInt(cntM[1]) : 1;
      return { type: 'REST', count, filter: parseCardFilter(m[1]) };
    });
    return acts.length === 1 ? acts[0] : acts;
  }

  // REFRESH_LOCK — opponent's rested characters cannot become active in next opponent refresh phase
  const refreshLockM = s.match(/最多(\d+)?張(.+?)在下一個對手的重整階段無法為活動狀態/);
  if (refreshLockM) {
    const count = refreshLockM[1] ? parseInt(refreshLockM[1]) : 1;
    return { type: 'REFRESH_LOCK', count, filter: parseCardFilter(refreshLockM[2].replace(/[，,]\s*$/, '')) };
  }

  // UNREST_DON — set rested DON!! cards in cost area to active
  const unrestDonM = s.match(/將最多(\d+)?張.{0,6}咚‼.{0,4}置為活動狀態/);
  if (unrestDonM) {
    const cntM = s.match(/最多(\d+)?張/);
    return { type: 'UNREST_DON', count: parseInt(cntM?.[1] ?? '1') };
  }

  // UNREST field card
  const unrestM = s.match(/將(.+?)置為活動狀態/);
  if (unrestM) {
    const cntM = unrestM[1].match(/最多(\d+)?張/);
    const count = cntM ? parseInt(cntM[1] ?? '1') : 1;
    return { type: 'UNREST', count, filter: parseCardFilter(unrestM[1]) };
  }

  // POWER_PER_DISCARD — "每廢棄1張卡片，力量值+N" — must be checked before POWER_MOD
  if (s.includes('每廢棄') && s.includes('力量值')) {
    const perM = s.match(/力量值[+＋](\d+)/);
    if (perM) return {
      type: 'POWER_PER_DISCARD',
      delta: parseInt(perM[1]),
      until: s.includes('在這場對戰中') ? 'battle' : 'turn',
    };
  }

  // COST_MOD — e.g. "最多1張自己的角色卡，在下一個對手回合結束前，費用+2"
  const costM = s.match(/費用([+＋\-－]\d+)/);
  if (costM && !s.includes('以下') && !s.includes('以上')) {
    const rawDelta = costM[1].replace('＋', '+').replace('－', '-');
    const delta = parseInt(rawDelta);
    const until = s.includes('在這個回合') ? 'turn'
                : s.includes('在這場對戰中') ? 'battle'
                : s.includes('在下一個對手回合結束前') ? 'opponent_turn_end'
                : 'continuous';
    const tgtM = s.match(/最多(\d+)?張(.+?)(?:，在|的費用|費用)/);
    const filterText = tgtM ? tgtM[2] : null;
    const count = tgtM?.[1] ? parseInt(tgtM[1]) : 1;
    return {
      type: 'COST_MOD', delta, until, count,
      filter: filterText ? parseCardFilter(filterText) : { self: true },
    };
  }

  // POWER_MOD — e.g. "這張角色卡的力量值+3000" or "最多1張對手的角色卡…力量值-1000"
  const powerM = s.match(/力量值([+-]\d+)/);
  if (powerM) {
    const delta = parseInt(powerM[1]);
    const until = s.includes('在這個回合') ? 'turn'
                : s.includes('在這場對戰中') ? 'battle'
                : s.includes('在下一個對手回合結束前') ? 'opponent_turn_end'
                : 'continuous';
    const tgtM  = s.match(/最多(\d+)?張(.+?)(?:，在|的力量|力量值)/);
    // Detect "all" target first: "對手的角色卡全數" or "自己的領航卡和角色卡全數" (no 最多X張 prefix)
    const allTgtM    = !tgtM ? s.match(/^(.+?全數)/) : null;
    // Detect explicit leader target without 最多 prefix, e.g. "自己的領航卡，在這場對戰中"
    const leaderTgtM = (!tgtM && !allTgtM) ? s.match(/^((?:自己|對手|對方)的?領航卡)/) : null;
    const filterText = tgtM ? tgtM[2] : allTgtM ? allTgtM[1] : leaderTgtM ? leaderTgtM[1] : null;
    return {
      type: 'POWER_MOD', delta, until,
      filter: filterText ? parseCardFilter(filterText) : { self: true },
      ...(allTgtM ? { count: Infinity } : {}),
    };
  }

  // REORDER — look at top N cards, arrange, put back on top OR bottom (no cards taken)
  const reorderM = s.match(/查看(\d+)張/);
  if (reorderM && s.includes('上面或下面') && !s.includes('加入手牌')) {
    return { type: 'SEARCH', look: parseInt(reorderM[1]), take: 0, reorder: true, canPlaceOnTop: true, filter: {} };
  }

  // SEARCH top N of deck
  const searchM = s.match(/查看(\d+)張/);
  if (searchM) {
    const takeM = s.match(/最多(\d+)?張/);
    return {
      type: 'SEARCH', look: parseInt(searchM[1]),
      take: parseInt(takeM?.[1] ?? '1'),
      filter: parseCardFilter(s),
    };
  }

  // DISCARD any number (任意張數) — must be checked before fixed-count DISCARD
  if (s.includes('任意張數') && s.includes('廢棄')) {
    return { type: 'DISCARD_FREE', filter: parseCardFilter(s) };
  }

  // DISCARD from hand
  const discardM = s.match(/廢棄(\d+)?張/);
  if (discardM) return {
    type: 'DISCARD', count: parseInt(discardM[1] ?? '1'),
    filter: parseCardFilter(s),
  };

  // LIFE_TO_HAND — must be checked before ADD_TO_HAND (both match 加入手牌)
  // Also matches "加入持有者的手牌" where the owner marker sits between 加入 and 手牌
  if (s.includes('生命值區') && (s.includes('加入手牌') || s.includes('持有者的手牌'))) {
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)?張/);
    const targetOwner = (s.includes('對手') || s.includes('對方')) ? 'opponent' : 'self';
    return { type: 'LIFE_TO_HAND', count: parseInt(cntM?.[1] ?? '1'), targetOwner };
  }

  // LIFE_TO_TRASH — life card goes directly to trash (no trigger)
  if (s.includes('生命值區') && (s.includes('廢棄') || s.includes('廢棄區'))) {
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)?張/);
    return { type: 'LIFE_TO_TRASH', count: parseInt(cntM?.[1] ?? '1') };
  }

  // RETURN_HAND — bounce a character (or stage) from field back to its owner's hand.
  // Strip the destination phrase "放回持有者的手牌" so that 持有者 (→ owner=self) and
  // 手牌 (→ zone=hand) don't corrupt the source-card filter.
  if (s.includes('放回持有者的手牌')) {
    const srcText = s.split('放回持有者的手牌')[0];
    const maxM  = srcText.match(/最多(\d+)張/);
    const exactM = !maxM ? srcText.match(/[將及](\d+)張/) : null;
    const count  = srcText.includes('全數') ? Infinity : parseInt(maxM?.[1] ?? exactM?.[1] ?? '1');
    const filterText = srcText.replace(/將?(?:最多\d+張|\d+張|全數)/g, '').trim();
    return { type: 'RETURN_HAND', count, filter: parseCardFilter(filterText) };
  }
  // ADD_TO_HAND — "無法" variants are prevention modifiers, not executable moves
  if (s.includes('加入手牌') && !s.includes('無法')) {
    // Take only the text before 加入手牌 as the source description so that
    // zone detection in parseCardFilter sees the source zone, not the destination.
    const srcText = s.split('加入手牌')[0].replace(/[，,]$/, '').trim();
    const countM = srcText.match(/最多(\d+)張/) ?? srcText.match(/[將](\d+)張/);
    return {
      type: 'ADD_TO_HAND',
      count: parseInt(countM?.[1] ?? '1'),
      filter: parseCardFilter(srcText),
    };
  }

  // ATTACH_DON — separate DON!! state (applies to the DON!! card) from target card filter
  if (s.includes('附加') && s.includes('咚‼')) {
    const donStateM = s.match(/張(休息|活動)狀態的咚‼/);
    const donState  = donStateM ? (donStateM[1] === '休息' ? 'rest' : 'active') : null;
    const filterText = donState ? s.replace(/休息狀態的|活動狀態的/, '') : s;
    return {
      type: 'ATTACH_DON',
      count: parseInt(s.match(/附加最多(\d+)?張/)?.[1] ?? '1'),
      donState,
      filter: parseCardFilter(filterText),
    };
  }

  // FLIP_LIFE_FACE_UP — e.g. "將1張自己生命值區上面的卡片翻成正面朝上"
  if (s.includes('翻成正面朝上'))
    return { type: 'FLIP_LIFE_FACE_UP' };

  // DECK_TO_TRASH — "將N張自己卡組上面的卡片放置在廢棄區" — mill top N cards from own deck to trash
  const deckToTrashM = s.match(/將(\d+)張.+卡組上面.+廢棄/);
  if (deckToTrashM) return { type: 'DECK_TO_TRASH', count: parseInt(deckToTrashM[1]) };

  // REMAINDER_TO_TRASH — "其餘卡片放到廢棄區" — put SEARCH leftovers in trash (consumed by SEARCH handler)
  if (s.includes('其餘') && s.includes('廢棄')) return { type: 'REMAINDER_TO_TRASH' };

  // "其餘卡片...放到卡組下面/上面" — describes putting SEARCH leftovers at the bottom in order,
  // which is already handled by the SEARCH_ORDER interactive step. Skip entirely.
  if (s.includes('其餘') && (s.includes('卡組') || s.includes('下面'))) return null;

  // HAND_TO_DECK — "將N張自己的手牌...放到卡組上面或下面" (player picks N hand cards, arranges, places top or bottom)
  if (s.includes('手牌') && s.includes('放到卡組') && (s.includes('上面') || s.includes('下面'))) {
    const cntM = s.match(/(\d+)張/) ?? s.match(/最多(\d+)?張/);
    return {
      type: 'HAND_TO_DECK',
      count: parseInt(cntM?.[1] ?? '1'),
      canPlaceOnTop: s.includes('上面'),
    };
  }

  // BOTTOM_DECK — e.g. "將最多1張對手力量值6000以下的角色卡放置在持有者的卡組下面"
  if ((s.includes('卡組下面') || s.includes('放到卡組')) && s.includes('下')) {
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)張/);
    // Strip destination phrase so parseCardFilter only sees the source card spec
    const srcText = s.replace(/放置在.+/, '').replace(/放到卡組.+/, '').trim();
    return {
      type: 'BOTTOM_DECK',
      count: parseInt(cntM?.[1] ?? '1'),
      filter: parseCardFilter(srcText),
    };
  }

  // DECK_TO_LIFE — top of deck → top of life (must precede ADD_TO_LIFE)
  if ((s.includes('卡組') || s.includes('牌組')) && s.includes('生命值區')) {
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)?張/);
    return { type: 'DECK_TO_LIFE', count: parseInt(cntM?.[1] ?? '1') };
  }

  // ADD_TO_LIFE from hand — "公開N張手牌中..., 並以...加入生命值區" (reveal + add to life compound)
  if (s.includes('公開') && s.includes('手牌') && s.includes('生命值區')) {
    const destM = s.match(/(以(正面|背面)朝上)?(放入|加入)(自己的|對手的|持有者的)?生命值區(上面或下面|上面|下面)/);
    const faceUp    = destM?.[2] === '正面';
    const posText   = destM?.[5] ?? '上面';
    const position  = posText === '上面或下面' ? 'choice' : posText === '下面' ? 'bottom' : 'top';
    const twText    = destM?.[4];
    const targetOwner = twText === '對手的' ? 'opponent' : twText === '持有者的' ? 'holder' : 'self';
    const srcText   = s.replace(/(以(正面|背面)朝上)?(放入|加入)(自己的|對手的|持有者的)?生命值區(上面或下面|上面|下面)?/, '').trim();
    const filter    = parseCardFilter(srcText);
    delete filter.zone;
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)張/);
    return { type: 'ADD_TO_LIFE', filter, count: parseInt(cntM?.[1] ?? '1'),
             sourceZone: 'hand', targetOwner, position, faceUp };
  }

  // HAND_TO_LIFE — hand card → top of life (must precede ADD_TO_LIFE)
  if (s.includes('手牌') && s.includes('生命值區')) {
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)?張/);
    return { type: 'HAND_TO_LIFE', count: parseInt(cntM?.[1] ?? '1'), filter: parseCardFilter(s) };
  }

  // ADD_TO_LIFE — move a character card from field/hand to life area
  if (s.includes('生命值區') && (s.includes('放入') || s.includes('加入'))) {
    const destM = s.match(/(以(正面|背面)朝上)?(放入|加入)(自己的|對手的|持有者的)?生命值區(上面或下面|上面|下面)?/);
    const faceUp    = destM?.[2] === '正面';
    const posText   = destM?.[5] ?? '上面';
    const position  = posText === '上面或下面' ? 'choice' : posText === '下面' ? 'bottom' : 'top';
    const twText    = destM?.[4];
    const targetOwner = twText === '對手的' ? 'opponent' : twText === '持有者的' ? 'holder' : 'self';
    const srcText   = s.replace(/(以(正面|背面)朝上)?(放入|加入)(自己的|對手的|持有者的)?生命值區(上面或下面|上面|下面)?/, '').trim();
    const filter    = parseCardFilter(srcText);
    delete filter.zone;
    const cntM = s.match(/最多(\d+)?張/) ?? s.match(/(\d+)張/);
    return { type: 'ADD_TO_LIFE', filter, count: parseInt(cntM?.[1] ?? '1'),
             sourceZone: 'characterArea', targetOwner, position, faceUp };
  }

  // REDIRECT_ATTACK_TARGET — "選擇自己的領航卡或...《trait》特徵的角色卡"
  const redirectM = s.match(/選擇自己的領航卡或.*?《([^》]+)》特徵/);
  if (redirectM) return { type: 'REDIRECT_ATTACK_TARGET', trait: redirectM[1] };
  // Companion sentence "攻擊的對象變更為選擇的卡片" is handled by REDIRECT_ATTACK_TARGET above
  if (s.includes('攻擊的對象變更')) return null;

  // FREE_EVENT — "發動最多N張...事件卡" — play event card(s) from hand without paying cost
  const freeEventM = s.match(/發動最多(\d+)?張/);
  if (freeEventM && s.includes('事件卡') && !s.includes('這張卡片的')) {
    return { type: 'FREE_EVENT', count: parseInt(freeEventM[1] ?? '1'), filter: parseCardFilter(s) };
  }

  // FIRE_MAIN_EFFECT — "發動這張卡片的【主要】效果" (trigger re-fires this card's main effect)
  if (s.includes('發動這張卡片的') && s.includes('效果'))
    return { type: 'FIRE_MAIN_EFFECT' };

  // GRANT_KEYWORD with "without keyword" filter
  // e.g. "最多1張自己未持有【攻擊時】效果的角色卡，在這個回合，獲得【速攻】"
  const grantWithoutM = s.match(/最多(\d+)?張(.*?)未持有【([^】]+)】效果的角色卡[，,].*?獲得【([^】]+)】/);
  if (grantWithoutM) {
    return {
      type: 'GRANT_KEYWORD',
      keyword: grantWithoutM[4],
      count: parseInt(grantWithoutM[1] ?? '1'),
      until: s.includes('在這個回合') ? 'turn' : null,
      filter: {
        ...parseCardFilter(grantWithoutM[2]),
        zone: 'field',
        category: 'Character',
        withoutKeyword: grantWithoutM[3],
      },
    };
  }

  // ADD_DON_FROM_DECK — 從咚‼卡組追加最多N張活動狀態的咚‼卡
  const addDonDeckM = s.match(/從咚‼卡組追加最多(\d+)張活動狀態的咚‼卡/);
  if (addDonDeckM) return { type: 'ADD_DON_FROM_DECK', count: parseInt(addDonDeckM[1]) };

  return { type: 'UNKNOWN', raw: s };
}

// ─── Card Filter Parser (also exported for effectActions) ─────────────────────

export function parseCardFilter(text) {
  if (!text) return {};
  const f = {};

  if      (text.includes('對手') || text.includes('對方')) f.owner = 'opponent';
  else if (text.includes('自己') || text.includes('持有者')) f.owner = 'self';

  if      (text.includes('手牌'))     f.zone = 'hand';
  else if (text.includes('卡組'))     f.zone = 'deck';
  else if (text.includes('廢棄區'))   f.zone = 'trash';
  else if (text.includes('生命值'))   f.zone = 'life';
  else if (text.includes('場上') || text.includes('角色卡') || text.includes('領航卡'))
    f.zone = 'field';

  if (text.includes('角色卡') && text.includes('領航卡')) {
    f.category = 'Character'; f.includesLeader = true;   // leader or character
  } else if (text.includes('事件卡') && text.includes('舞台卡')) {
    f.orCategories = ['Event', 'Stage'];
  } else if (text.includes('角色卡'))  f.category = 'Character';
    else if (text.includes('事件卡'))  f.category = 'Event';
    else if (text.includes('舞台卡'))  f.category = 'Stage';
    else if (text.includes('領航卡'))  f.category = 'Leader';

  const costM  = text.match(/費用(\d+)(以下|以上)?/);
  if (costM)  { f.cost  = parseInt(costM[1]);  f.costOp  = costM[2]  === '以上' ? 'gte' : 'lte'; }
  const powerM = text.match(/力量值(\d+)(以下|以上)?/);
  if (powerM) { f.power = parseInt(powerM[1]); f.powerOp = powerM[2] === '以上' ? 'gte' : 'lte'; }

  // 《X》 = exact trait match; 『X』 = contains match (e.g. 前B・W satisfies 『B・W』)
  const exactTraits    = [...text.matchAll(/《([^》]+)》/g)].map(m => m[1]);
  const containsTraits = [...text.matchAll(/『([^』]+)』/g)].map(m => m[1]);
  if (exactTraits.length === 1)    f.trait         = exactTraits[0];
  else if (exactTraits.length > 1) f.traits        = exactTraits;
  if (containsTraits.length === 1)    f.traitContains  = containsTraits[0];
  else if (containsTraits.length > 1) f.traitsContains = containsTraits;
  const excludeNameM = text.match(/除了「([^」]+)」以外/);
  if (excludeNameM) f.excludeName = excludeNameM[1];
  const nameM = text.match(/「([^」]+)」/);
  if (nameM && !excludeNameM) f.name = nameM[1];

  // DON!! attached condition: 已附加N張以上咚‼卡
  const donM = text.match(/已附加(\d+)?張?以上?咚‼卡|已附加咚‼卡/);
  if (donM) f.donAttached = donM[1] ? parseInt(donM[1]) : 1;

  // DON!! card type (e.g. "1張自己的咚‼卡" as a REST/cost target)
  if (text.includes('咚‼') && !text.includes('已附加')) f.cardType = 'don';

  // "this card" self-reference (e.g. "這張角色卡" in activation costs)
  if (text.includes('這張')) f.self = true;

  if      (text.includes('休息狀態'))  f.state = 'rest';
  else if (text.includes('活動狀態')) f.state = 'active';

  const ownedAbilityM = text.match(/持有【([^】]+)】/);
  if (ownedAbilityM) f.hasAbility = ownedAbilityM[1];

  const colorMap = { '紫色': 'Purple', '紅色': 'Red', '藍色': 'Blue', '黑色': 'Black', '綠色': 'Green', '黃色': 'Yellow' };
  for (const [zh, en] of Object.entries(colorMap)) {
    if (text.includes(zh)) { f.color = en; break; }
  }

  return f;
}
