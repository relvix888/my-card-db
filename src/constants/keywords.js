export const KEYWORD_MAP = {
  main: { zh: "【主要】", en: "[Main]" },
  activate_main: { zh: "【啟動主要】", en: "[Activate: Main]" },
  when_attacking: { zh: "【攻擊時】", en: "[When Attacking]" },
  on_block: { zh: "【防禦時】", en: "[On Block]" },
  on_your_opponents_attack: { zh: "【對方攻擊時】", en: "[On Your Opponent's Attack]" },
  on_ko: { zh: "【KO時】", en: "[On K.O.]" },
  your_turn: { zh: "【我方回合中】", en: "[Your Turn]" },
  opponents_turn: { zh: "【對方回合中】", en: "[Opponent's Turn]" },
  end_of_your_turn: { zh: "【我方回合結束時】", en: "[End of Your Turn]" },
  on_play: { zh: "【登場時】", en: "[On Play]" },
  once_per_turn: { zh: "【每回合1次】", en: "[Once Per Turn]" },
  counter: { zh: "【反擊】", en: "[Counter]" },
  rush: { zh: "【速攻】", en: "[Rush]" },
  blocker: { zh: "【防禦】", en: "[Blocker]" },
  rush_character: { zh: "【速攻：角色】", en: "[Rush: Character]" },
  unblockable: { zh: "【防禦不可】", en: "[Unblockable]" },
  double_attack: { zh: "【雙重攻擊】", en: "[Double Attack]" },
  banish: { zh: "【消失】", en: "[Banish]" },
  trigger: { zh: "【觸發器】", en: "[Trigger]" },
  don_x1: { zh: "【咚‼×1】", en: "[DON!! x1]" },
  don_x2: { zh: "【咚‼×2】", en: "[DON!! x2]" },
  don_x3: { zh: "【咚‼×3】", en: "[DON!! x3]" },
  don_x4: { zh: "【咚‼×4】", en: "[DON!! x4]" },
  don_x5: { zh: "【咚‼×5】", en: "[DON!! x5]" },
  don_x6: { zh: "【咚‼×6】", en: "[DON!! x6]" },
  don_x7: { zh: "【咚‼×7】", en: "[DON!! x7]" },
  don_x8: { zh: "【咚‼×8】", en: "[DON!! x8]" },
  don_x9: { zh: "【咚‼×9】", en: "[DON!! x9]" },
  don_x10: { zh: "【咚‼×10】", en: "[DON!! x10]" },
};

export const KEYWORD_RULES = [
  {
    ids: [
      "main", "activate_main", "when_attacking", "on_block",
      "on_your_opponents_attack", "on_ko", "your_turn", "opponents_turn",
      "end_of_your_turn", "on_play",
    ],
    style: "bg-blue-600 text-white px-1 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block",
  },
  {
    ids: ["once_per_turn"],
    style: "bg-red-600 text-white px-1 py-0.5 rounded-full text-[13px] leading-tight font-bold mx-0.5 inline-block",
  },
  {
    ids: ["counter"],
    style: "bg-red-600 text-white px-1 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block",
  },
  {
    ids: ["rush", "blocker", "rush_character", "unblockable", "double_attack", "banish"],
    style: "bg-orange-500 text-white px-1 py-0.5 text-[13px] leading-tight font-bold mx-0.5 inline-block [clip-path:polygon(10%_0%,_90%_0%,_100%_50%,_90%_100%,_10%_100%,_0%_50%)]",
  },
  {
    ids: ["don_x1", "don_x2", "don_x3", "don_x4", "don_x5", "don_x6", "don_x7", "don_x8", "don_x9", "don_x10"],
    style: "bg-slate-900 text-white px-1 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block [clip-path:polygon(10%_0%,_90%_0%,_100%_10%,_100%_90%,_90%_100%,_10%_100%,_0%_90%,_0%_10%)]",
  },
  {
    ids: ["trigger"],
    style: "bg-yellow-200 text-black pl-0 pr-2 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block [clip-path:polygon(0%_0%,_100%_0%,_85%_100%,_0%_100%)]",
  },
];

export const formatEffectText = (text, langCode) => {
  if (!text) return "";
  let formatted = text;

  KEYWORD_RULES.forEach((rule) => {
    rule.ids.forEach((id) => {
      const word = KEYWORD_MAP[id]?.[langCode];
      if (word) {
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escapedWord, "g");
        formatted = formatted.replace(regex, `<span class="${rule.style}">${word}</span>`);
      }
    });
  });

  return formatted;
};
