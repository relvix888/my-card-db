import React, { useState, useEffect, useMemo, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
} from "firebase/firestore";
import CardQA from "./components/CardQA"; // Import the component

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "one-piece-card-db";

// --- 卡包數據對照表 (已按 PRB -> EB -> OP -> ST -> 其他 順序排列) ---
const packData = {
  554302: {
    id: "554302",
    raw_title: "高級補充包 ONE PIECE CARD THE BEST vol.2【PRB-02】",
  },
  554301: {
    id: "554301",
    raw_title: "高級補充包 ONE PIECE CARD THE BEST【PRB-01】",
  },
  554204: { id: "554204", raw_title: "特殊補充包 EGGHEAD CRISIS【EB-04】" },
  554203: {
    id: "554203",
    raw_title: "特殊補充包 ONE PIECE Heroines Edition【EB-03】",
  },
  554202: {
    id: "554202",
    raw_title: "特殊補充包 Anime 25th collection【EB-02】",
  },
  554201: { id: "554201", raw_title: "特殊補充包 回憶收藏【EB-01】" },
  554115: { id: "554115", raw_title: "補充包 神之島的冒險【OP-15】" },
  554114: { id: "554114", raw_title: "補充包 蒼海的七傑【OP-14】" },
  554113: { id: "554113", raw_title: "補充包 傳承的意志【OP-13】" },
  554112: { id: "554112", raw_title: "補充包 師徒的情義【OP-12】" },
  554111: { id: "554111", raw_title: "補充包 神速之拳【OP-11】" },
  554110: { id: "554110", raw_title: "補充包 王族血脈【OP-10】" },
  554109: { id: "554109", raw_title: "補充包 新世界的皇帝【OP-09】" },
  554108: { id: "554108", raw_title: "補充包 兩位傳奇【OP-08】" },
  554107: { id: "554107", raw_title: "補充包 500年後的未來【OP-07】" },
  554106: { id: "554106", raw_title: "補充包 雙壁的霸者【OP-06】" },
  554105: { id: "554105", raw_title: "補充包 新時代的主角【OP-05】" },
  554104: { id: "554104", raw_title: "補充包 陰謀王國【OP-04】" },
  554103: { id: "554103", raw_title: "補充包 強大的敵人【OP-03】" },
  554102: { id: "554102", raw_title: "補充包 頂點決戰【OP-02】" },
  554101: { id: "554101", raw_title: "補充包 ROMANCE DAWN【OP-01】" },
  554029: { id: "554029", raw_title: "起始牌組 EGGHEAD【ST-29】" },
  554028: { id: "554028", raw_title: "起始牌組 綠黃 大和【ST-28】" },
  554027: { id: "554027", raw_title: "起始牌組 黑 馬歇爾・D・汀奇【ST-27】" },
  554026: { id: "554026", raw_title: "起始牌組 紫黑 蒙其・D・魯夫【ST-26】" },
  554025: { id: "554025", raw_title: "起始牌組 藍 巴其【ST-25】" },
  554024: { id: "554024", raw_title: "起始牌組 綠 珠寶・波妮【ST-24】" },
  554023: { id: "554023", raw_title: "起始牌組 紅 傑克【ST-23】" },
  554022: { id: "554022", raw_title: "起始牌組 艾斯&紐蓋特【ST-22】" },
  554021: { id: "554021", raw_title: "起始牌組EX GEAR5【ST-21】" },
  554020: { id: "554020", raw_title: "起始牌組 黃 夏洛特・卡塔克利【ST-20】" },
  554019: { id: "554019", raw_title: "起始牌組 黑 斯摩格【ST-19】" },
  554018: { id: "554018", raw_title: "起始牌組 紫 蒙其・D・魯夫【ST-18】" },
  554017: {
    id: "554017",
    raw_title: "起始牌組 藍 唐吉訶德・多佛朗明哥【ST-17】",
  },
  554016: { id: "554016", raw_title: "起始牌組 綠 美音【ST-16】" },
  554015: { id: "554015", raw_title: "起始牌組 紅 艾德華・紐蓋特【ST-15】" },
  554014: { id: "554014", raw_title: "起始牌組 3D2Y【ST-14】" },
  554013: { id: "554013", raw_title: "究極牌組 三兄弟的情誼【ST-13】" },
  554012: { id: "554012", raw_title: "起始牌組 索隆&香吉士【ST-12】" },
  554011: { id: "554011", raw_title: "起始牌組 Side 美音【ST-11】" },
  554010: { id: "554010", raw_title: "究極牌組 “三船長”集結【ST-10】" },
  554009: { id: "554009", raw_title: "起始牌組 Side 大和【ST-09】" },
  554008: { id: "554008", raw_title: "起始牌組 Side 蒙其・D・魯夫【ST-08】" },
  554007: { id: "554007", raw_title: "起始牌組 BIG MOM海賊團【ST-07】" },
  554006: { id: "554006", raw_title: "起始牌組 海軍【ST-06】" },
  554005: {
    id: "554005",
    raw_title: "起始牌組 ONE PIECE FILM edition【ST-05】",
  },
  554004: { id: "554004", raw_title: "起始牌組 百獸海賊團【ST-04】" },
  554003: { id: "554003", raw_title: "起始牌組 王下七武海【ST-03】" },
  554002: { id: "554002", raw_title: "起始牌組 最可怕世代【ST-02】" },
  554001: { id: "554001", raw_title: "起始牌組 草帽一行人【ST-01】" },
  554701: { id: "554701", raw_title: "家庭牌組套裝" },
  554901: { id: "554901", raw_title: "推廣卡" },
  554801: { id: "554801", raw_title: "限定商品收錄卡牌" },
};

// --- 強制顯示順序列表 (解決 JS 對數字 Key 的自動升序問題) ---
const packOrder = [
  "554302",
  "554301", // PRB
  "554204",
  "554203",
  "554202",
  "554201", // EB
  "554115",
  "554114",
  "554113",
  "554112",
  "554111",
  "554110",
  "554109",
  "554108",
  "554107",
  "554106",
  "554105",
  "554104",
  "554103",
  "554102",
  "554101", // OP
  "554029",
  "554028",
  "554027",
  "554026",
  "554025",
  "554024",
  "554023",
  "554022",
  "554021",
  "554020",
  "554019",
  "554018",
  "554017",
  "554016",
  "554015",
  "554014",
  "554013",
  "554012",
  "554011",
  "554010",
  "554009",
  "554008",
  "554007",
  "554006",
  "554005",
  "554004",
  "554003",
  "554002",
  "554001", // ST
  "554701",
  "554901",
  "554801", // Others
];

const rules = [
  {
    keywords: [
      "【主要】",
      "【啟動主要】",
      "【攻擊時】",
      "【對方攻擊時】",
      "【KO時】",
      "【我方回合中】",
      "【對方回合中】",
      "【我方回合結束時】",
      "【登場時】",
    ],
    style:
      "bg-blue-600 text-white px-1 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block",
  },
  {
    keywords: ["【每回合1次】"],
    style:
      "bg-red-600 text-white px-1 py-0.5 rounded-full text-[13px] leading-tight font-bold mx-0.5 inline-block",
  },
  {
    keywords: ["【反擊】"],
    style:
      "bg-red-600 text-white px-1 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block",
  },
  {
    keywords: [
      "【速攻】",
      "【防禦】",
      "【速攻：角色】",
      "【防禦不可】",
      "【雙重攻擊】",
      "【消失】",
    ],
    style:
      "bg-orange-500 text-white px-1 py-0.5 text-[13px] leading-tight font-bold mx-0.5 inline-block [clip-path:polygon(10%_0%,_90%_0%,_100%_50%,_90%_100%,_10%_100%,_0%_50%)]",
  },
  {
    keywords: [
      "【咚‼×1】",
      "【咚‼×2】",
      "【咚‼×3】",
      "【咚‼×4】",
      "【咚‼×5】",
      "【咚‼×6】",
      "【咚‼×7】",
      "【咚‼×8】",
      "【咚‼×9】",
      "【咚‼×10】",
    ],
    style:
      "bg-slate-900 text-white px-1 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block [clip-path:polygon(10%_0%,_90%_0%,_100%_10%,_100%_90%,_90%_100%,_10%_100%,_0%_90%,_0%_10%)]",
  },
  {
    keywords: ["【觸發器】"],
    style:
      "bg-yellow-200 text-black pl-0 pr-2 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block [clip-path:polygon(0%_0%,_100%_0%,_85%_100%,_0%_100%)]",
  },
];

const PlayCurve = ({
  title,
  turns,
  setTurns,
  availableCards,
  getSafeImageUrl,
  defaultTurns,
}) => {
  const handleClearAll = () => {
    if (window.confirm(`確定要清空 ${title} 的所有設定嗎？`)) {
      // Create a fresh blank state for this specific curve
      const reset = defaultTurns.map((don) => ({
        don,
        slots: [null, null, null, null, null],
        operators: ["or", "or", "or", "or"],
      }));
      setTurns(reset);
    }
  };

  const updateTurnDon = (index, val) => {
    const newTurns = [...turns];
    newTurns[index].don = parseInt(val);
    setTurns(newTurns);
  };

  const updateSlot = (turnIdx, slotIdx, cardId) => {
    const newTurns = [...turns];
    // Normalize empty string to null for consistent data
    const normalizedId = cardId === "" ? null : cardId;
    newTurns[turnIdx].slots[slotIdx] = normalizedId;

    // Clear children if parent is removed
    if (!normalizedId) {
      for (let i = slotIdx + 1; i < 5; i++) {
        newTurns[turnIdx].slots[i] = null;
        newTurns[turnIdx].operators[i - 1] = "or";
      }
    }
    setTurns(newTurns);
  };

  const updateOp = (turnIdx, opIdx, op) => {
    const newTurns = [...turns];
    newTurns[turnIdx].operators[opIdx] = op;
    setTurns(newTurns);
  };

  return (
    <div className="mb-6 w-full">
      {/* Header with Title and Clear Button */}
      <div className="flex justify-between items-center mb-2 px-1">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <span
            className={`w-1 h-3 ${title.includes("先") ? "bg-orange-500" : "bg-sky-500"}`}
          />
          {title}
        </h3>
        <button
          onClick={handleClearAll}
          className="text-[9px] font-bold text-rose-500/70 hover:text-rose-400 uppercase tracking-tighter border border-rose-500/20 px-2 py-0.5 rounded transition-colors"
        >
          Clear All
        </button>
      </div>

      <div className="grid grid-cols-5 gap-1 sm:gap-2 w-full">
        {turns.map((turn, tIdx) => (
          <div
            key={tIdx}
            className="bg-slate-900/60 border border-slate-800 rounded-lg p-1 sm:p-2 flex flex-col gap-1 sm:gap-2"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-1">
              <span className="text-[8px] font-bold text-slate-500">D!</span>
              <select
                value={turn.don}
                onChange={(e) => updateTurnDon(tIdx, e.target.value)}
                className="bg-transparent text-white text-[9px] rounded outline-none border-none appearance-none cursor-pointer"
              >
                {[...Array(10)].map((_, i) => (
                  <option key={i + 1} value={i + 1} className="bg-slate-900">
                    {i + 1}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col items-center">
              {[0, 1, 2, 3, 4].map((sIdx) => {
                // Use a helper to check if the previous slot is "truly" empty
                const prevSlotValue = turn.slots[sIdx - 1];
                const isPrevOccupied =
                  prevSlotValue !== null && prevSlotValue !== "";

                // Logic: Always show first 3. Show 4th if 3rd is occupied. Show 5th if 4th is occupied.
                const isVisible = sIdx < 2 || isPrevOccupied;

                if (!isVisible) return null;

                const cardId = turn.slots[sIdx];
                const card = availableCards.find((c) => c.id === cardId);

                const isStacked =
                  sIdx > 0 && turn.operators[sIdx - 1] === "with";
                const isFree = sIdx > 0 && turn.operators[sIdx - 1] === "free";
                const isAnyCombo = isStacked || isFree;

                return (
                  <React.Fragment key={sIdx}>
                    <div
                      className={`
            relative w-full transition-all duration-300
            /* Responsive overlap for iPhone & Desktop */
            ${isAnyCombo ? "-mt-[70%] z-10" : "z-0"}
            ${isAnyCombo ? "rotate-1 translate-x-0.5" : ""}
          `}
                    >
                      <div
                        className={`
              relative aspect-[2.5/3.5] rounded-lg border-2 shadow-md overflow-hidden
              ${cardId ? "border-slate-700" : "border-dashed border-slate-800 bg-slate-950/40"}
              ${isStacked ? "border-sky-500 ring-1 ring-sky-500/30" : ""}
              ${isFree ? "border-amber-500 ring-1 ring-amber-500/30" : ""}
            `}
                      >
                        {cardId ? (
                          <>
                            <img
                              src={getSafeImageUrl(card)}
                              className="w-full h-full object-cover"
                              alt=""
                            />
                            {isFree && (
                              <div className="absolute top-1 right-1 bg-amber-500 text-[8px] font-black text-black px-1 rounded-sm uppercase shadow-sm">
                                FREE
                              </div>
                            )}
                            {isStacked && (
                              <div className="absolute top-1 right-1 bg-sky-500 text-[8px] font-black text-white px-1 rounded-sm uppercase shadow-sm">
                                COMBO
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-800 text-[10px] font-bold">
                            SLOT {sIdx + 1}
                          </div>
                        )}

                        <select
                          value={cardId || ""}
                          onChange={(e) =>
                            updateSlot(tIdx, sIdx, e.target.value)
                          }
                          className="absolute inset-0 w-full h-full opacity-0 z-30 cursor-pointer"
                        >
                          <option value="">移除卡片 (Remove)</option>
                          {availableCards.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.cost}c | {c.id} {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Operator Selector - Only show if current card is filled AND we aren't at the max slot */}
                    {sIdx < 4 && cardId && (
                      <div
                        className={`relative z-40 -my-1 transition-opacity duration-300 ${turn.operators[sIdx] !== "or" ? "opacity-30 hover:opacity-100" : "opacity-100"}`}
                      >
                        <select
                          value={turn.operators[sIdx]}
                          onChange={(e) => updateOp(tIdx, sIdx, e.target.value)}
                          className={`
                text-[7px] font-black px-2 py-0.5 rounded-full border shadow-sm uppercase tracking-tighter cursor-pointer
                ${
                  turn.operators[sIdx] === "with"
                    ? "bg-sky-600 border-sky-400 text-white"
                    : turn.operators[sIdx] === "free"
                      ? "bg-amber-600 border-amber-400 text-white"
                      : turn.operators[sIdx] === "and"
                        ? "bg-emerald-600 border-emerald-400 text-white"
                        : "bg-slate-800 border-slate-700 text-white"
                }
              `}
                        >
                          <option value="or">OR</option>
                          <option value="and">AND</option>
                          <option value="with">COMBO</option>
                          <option value="free">FREE</option>
                        </select>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const initialTurns = (dons) =>
  dons.map((don) => ({
    don,
    slots: Array(5).fill(null),
    operators: Array(4).fill("or"),
  }));

// --- 輔助函數：取得基礎 ID (處理 _px 或 _rx 後綴) ---
const getBaseId = (id) => {
  if (!id) return "";
  return id.split(/_[pr]\d+$/i)[0].toUpperCase();
};

const SimpleBarChart = ({ data, labels, title, color = "bg-blue-500" }) => {
  const maxVal = Math.max(...data, 1);
  return (
    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 h-full flex flex-col">
      <h4 className="text-xs font-bold text-slate-400 mb-6 uppercase tracking-widest">
        {title}
      </h4>
      <div className="flex items-end gap-1.5 h-32 mt-auto">
        {data.map((val, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col items-center group relative h-full justify-end"
          >
            <span className="text-[10px] font-black text-slate-300 mb-1">
              {val}
            </span>
            <div
              className={`w-full ${color} rounded-t transition-all duration-700 ease-out`}
              style={{
                height: `${(val / maxVal) * 80}%`,
                minHeight: val > 0 ? "4px" : "0px",
              }}
            />
            <span className="text-[10px] text-slate-500 mt-2 font-mono font-bold">
              {labels[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const SimplePieChart = ({ data, labels, title }) => {
  const total = data.reduce((a, b) => a + b, 0);
  const colorHex = ["#3b82f6", "#a855f7", "#10b981", "#f59e0b"];
  const colorsBg = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-emerald-500",
    "bg-amber-500",
  ];
  let cumulative = 0;
  const gradientParts = data.map((val, i) => {
    const start = (cumulative / total) * 100;
    cumulative += val;
    const end = (cumulative / total) * 100;
    return `${colorHex[i % colorHex.length]} ${start}% ${end}%`;
  });
  const gradient =
    total > 0 ? `conic-gradient(${gradientParts.join(", ")})` : `transparent`;
  return (
    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 h-full">
      <h4 className="text-xs font-bold text-slate-400 mb-6 uppercase tracking-widest">
        {title}
      </h4>
      <div className="flex items-center gap-6">
        <div
          className="relative w-24 h-24 rounded-full border-4 border-slate-700 flex items-center justify-center bg-slate-900/50 shadow-inner flex-shrink-0"
          style={{ background: gradient }}
        >
          <div className="absolute inset-2 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700/50 shadow-lg">
            <span className="text-xl font-black text-white">{total}</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          {data.map((val, i) => (
            <div key={i} className="flex flex-col text-[11px]">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${colorsBg[i % colorsBg.length]}`}
                  ></div>
                  <span className="text-slate-300 font-medium">
                    {labels[i]}
                  </span>
                </div>
                <span className="font-bold text-slate-400">{val}</span>
              </div>
              <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className={`h-full ${colorsBg[i % colorsBg.length]}`}
                  style={{
                    width: total > 0 ? `${(val / total) * 100}%` : "0%",
                  }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [cards, setCards] = useState([]);
  const [user, setUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [isExcludeMode, setIsExcludeMode] = useState(false);
  const [selectedColors, setSelectedColors] = useState([]);
  const [selectedRarity, setSelectedRarity] = useState([]);
  const [filterCategory, setFilterCategory] = useState("所有");
  const [selectedAttributes, setSelectedAttributes] = useState([]);
  const [filterType1, setFilterType1] = useState("所有");
  const [filterType2, setFilterType2] = useState("所有");
  const [typeLogic, setTypeLogic] = useState("AND"); // 'AND' 或 'OR'
  const [filterPackId, setFilterPackId] = useState("554115"); // 新增卡包篩選狀態
  const [hideReprint, setHideReprint] = useState(true); // 新增：隱藏再錄卡狀態
  const [selectedBlocks, setSelectedBlocks] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isImportingDeck, setIsImportingDeck] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [deckInput, setDeckInput] = useState("");
  const [selectedCard, setSelectedCard] = useState(null);
  const [appMode, setAppMode] = useState("SEARCH");
  const [deckList, setDeckList] = useState({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [marketData, setMarketData] = useState({});
  const [firstCurveTurns, setFirstCurveTurns] = useState(
    initialTurns([1, 3, 5, 7, 9]),
  );
  const [secondCurveTurns, setSecondCurveTurns] = useState(
    initialTurns([2, 4, 6, 8, 10]),
  );
  const [showCurve, setShowCurve] = useState(true);
  const [selectedLeader, setSelectedLeader] = useState(null);

  const typeOptions = [
    "所有",
    "草帽一行人",
    "海軍",
    "超新星",
    "王下七武海",
    "FILM",
    "四皇",
    "和之國",
    "多雷斯羅薩",
    "白鬍子海賊團",
    "BIG MOM海賊團",
    "革命軍",
    "唐吉訶德海賊團",
    "東方藍",
    "百獸海賊團",
    "蛋頭",
    "空島",
    "動物",
    "魚人族",
    "哈特海賊團",
    "B・W",
    "恐怖三桅帆船海賊團",
    "紅髮海賊團",
    "純毛族",
    "推進城",
    "阿拉巴斯坦王國",
    "基德海賊團",
    "龐克哈薩特",
    "黑鬍子海賊團",
    "九蛇海賊團",
    "魚人島",
    "紅鞘九人眾",
    "賓什莫克家",
    "光月家",
    "人魚族",
    "波妮海賊團",
    "太陽海賊團",
    "ODYSSEY",
    "W7",
    "巨人族",
    "CP0",
    "CP9",
    "科學家",
    "天龍人",
    "杰爾馬66",
    "SWORD",
    "羅傑海賊團",
    "十字公會",
    "磁鼓王國",
    "SMILE",
    "香朵拉的戰士",
    "弗克西海賊團",
    "音樂",
    "五老星",
    "CROSS GUILD",
    "白鬍子海賊團旗下",
    "前B・W",
    "西凱阿爾王國",
    "前羅傑海賊團",
    "克利克海賊團",
    "歡樂友人",
    "火戰車海賊團",
    "GC",
    "哥雅王國",
    "巴特俱樂部",
    "惡龍海賊團",
    "巴其海賊團",
    "貌美海賊團",
    "多雷古海賊團",
    "黑貓海賊團",
    "亞馬遜百合",
    "海賊王",
    "霍金斯海賊團",
    "神官",
    "山賊",
    "前海軍",
    "杰爾馬王國",
    "加亞島",
    "GRAN TESORO",
    "新魚人海賊團",
    "海王類",
    "ONAIR海賊團",
    "新海軍",
    "破戒僧海賊團",
    "歐哈拉",
    "頓達塔族",
    "佛夏村",
    "熾天使",
    "格列佛海賊團",
    "生物兵器",
    "金獅子海賊團",
    "海賊萬博會",
    "八寶水軍",
    "西摩志基村",
    "前洛克斯海賊團",
    "前白鬍子海賊團",
    "獄卒獸",
    "狙擊島",
    "世界政府",
    "科学者",
    "新巨兵海賊團",
    "黑炭家",
    "佛朗基家族",
    "魯魯西亞王國",
    "明月族",
    "原白鬍子海賊團",
    "黑桃海賊團",
    "飛魚騎士",
    "亞爾麗塔海賊團",
    "倫巴海賊團",
    "猿山聯合軍",
    "洛克斯海賊團",
    "巴其海賊團船長",
    "多雷斯羅薩",
    "恐怖三桅帆船海賊團",
    "時光旅詩",
    "貝拉密海賊團",
    "聖地馬力喬亞",
    "月",
    "原倫巴海賊團",
    "福爾夏特島",
    "？",
    "翻滾海賊團",
    "祭典島",
    "造船町",
    "飛行海賊團",
    "布魯賈姆海賊團",
    "前CP9",
    "前惡龍海賊團",
    "前Ｂ・Ｗ",
    "蒙加羅王國",
    "巴其宅急便",
    "原羅傑海賊團",
    "阿奇諾家族",
    "冒牌草帽一行人",
    "妖精",
    "前倫巴海賊團",
    "阿爾凱米",
    "托雷傑海賊團",
    "CP8",
    "瓦爾德海賊團",
    "CP6",
    "CP7",
    "疫災",
    "羔羊之家",
    "圓蛋糕島",
    "普羅丹斯王國",
    "甲羅海賊團",
    "衛伯之母",
    "長環長島",
    "記者",
    "桃鬍子海賊團",
    "福連伯斯",
    "巴鐵利拉",
    "邪惡黑組織",
    "磁鼓王國",
    "新聞記者",
    "被害者協會",
    "辛朵莉影子的主人",
    "波音列島",
    "Monsters",
    "獄卒獣",
    "約塔瑪利亞大船團",
    "阿斯卡島",
    "追逐草帽大冒險",
    "撲克牌海賊團",
    "機關島",
    "原惡龍海賊團",
    "新魚人海賊団",
    "艾拉德哥海賊團",
    "王冠島",
    "原洛克斯海賊團",
    "植物學者",
    "ボニー海賊団",
    "スリラーバーク海賊団",
    "黑鬍子海賊團傘下",
    "褐鬍子海賊團",
    "前翻滾海賊團",
    "前BIG MOM海賊團",
    "元B・W",
    "約瑪利亞大船團",
    "宇宙海賊",
    "溫泉島",
    "植物學家",
    "水母海賊團",
    "嘉斯帕德海賊團",
  ];

  const quickKeywords = [
    "【登場時】",
    "【啟動主要】",
    "【每回合1次】",
    "【攻擊時】",
    "【我方回合中】",
    "【我方回合結束時】",
    "【反擊】",
    "【對方攻擊時】",
    "【對方回合中】",
    "【KO時】",
    "【觸發器】",
    "【速攻】",
    "【速攻：角色】",
    "【防禦】",
    "【防禦不可】",
    "【雙重攻擊】",
    "【消失】",
    "沒有效果",
  ];

  const colorMap = {
    紅色: "Red",
    綠色: "Green",
    藍色: "Blue",
    紫色: "Purple",
    黑色: "Black",
    黃色: "Yellow",
  };
  const categoryMap = {
    領航卡: "Leader",
    角色卡: "Character",
    事件卡: "Event",
    舞台卡: "Stage",
  };
  const rarityMap = {
    "領航卡 (L)": "Leader",
    "普通 (C)": "Common",
    "不普通 (UC)": "Uncommon",
    "稀有 (R)": "Rare",
    "超級稀有 (SR)": "SuperRare",
    "絕密稀有 (SEC)": "SecretRare",
    "特殊卡 (SP)": "Special",
  };
  const attributeMap = {
    打: "Strike",
    斬: "Slash",
    特: "Special",
    射: "Ranged",
    知: "Wisdom",
  };

  // 使用 packOrder 生成最終顯示的清單
  const sortedPackList = useMemo(() => {
    return packOrder.map((id) => packData[id]).filter((p) => p !== undefined);
  }, []);

  const defaultFilters = {
    searchTerm: "",
    selectedKeywords: [],
    isExcludeMode: false,
    selectedColors: [],
    selectedRarity: [],
    filterCategory: "所有",
    filterType1: "所有",
    filterType2: "所有",
    typeLogic: "AND",
    filterPackId: "554115",
    hideReprint: false,
    showCurve: false,
  };

  const resetFilters = () => {
    setSearchTerm(defaultFilters.searchTerm);
    setSelectedKeywords(defaultFilters.selectedKeywords);
    setIsExcludeMode(defaultFilters.isExcludeMode);
    setSelectedColors(defaultFilters.selectedColors);
    setSelectedRarity(defaultFilters.selectedRarity);
    setFilterCategory(defaultFilters.filterCategory);
    setFilterType1(defaultFilters.filterType1);
    setFilterType2(defaultFilters.filterType2);
    setTypeLogic(defaultFilters.typeLogic);
    setFilterPackId(defaultFilters.filterPackId);
    setHideReprint(defaultFilters.hideReprint);
    setShowCurve(defaultFilters.showCurve);

    // Optional: also clear selected card detail view if you want full reset
    // setSelectedCard(null);
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        // We removed the check for __initial_auth_token
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth error:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const cardsRef = collection(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      "cards",
    );
    const unsubscribe = onSnapshot(
      cardsRef,
      (snapshot) => {
        const cardData = snapshot.docs.map((doc) => ({
          ...doc.data(),
          id: doc.id,
        }));
        setCards(cardData);
      },
      (err) => console.error("Firestore error:", err),
    );
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    setIsImportingDeck(false);
    // Optional: also clear the input
    setDeckInput("");
  }, [appMode]);

  useEffect(() => {
    // 1. Get IDs of all cards currently in the deckList
    const cardIdsInDeck = Object.keys(deckList);

    // 2. Look through the cards data to find which one is the Leader
    const leaderCard = cards.find(
      (card) => cardIdsInDeck.includes(card.id) && card.category === "Leader", // Match exactly what's in your updateDeckCount
    );

    // 3. Debugging (Optional: Remove this once it works)
    if (leaderCard) {
      console.log("Found Leader:", leaderCard.name, leaderCard.id);
    }

    // 4. Update the visual state
    setSelectedLeader(leaderCard || null);
  }, [deckList, cards]);

  // 計算特定基礎 ID 在牌組中的總數 (用於處理異圖合併)
  const getBaseIdCount = useCallback(
    (cardId) => {
      const baseId = getBaseId(cardId);
      return Object.entries(deckList).reduce((total, [id, count]) => {
        return getBaseId(id) === baseId ? total + count : total;
      }, 0);
    },
    [deckList],
  );

  // 1. Generate the URL from the deckList object
  const generateShareUrl = () => {
    const entries = Object.entries(deckList);
    if (entries.length === 0) return alert("牌組是空的！");

    try {
      const deckString = entries
        .map(([id, count]) => `${count}x${id}`)
        .join(",");

      // Updated for 5 slots and 4 operators
      const serializeCurve = (curve) => {
        return curve
          .map((t) => {
            const slots = t.slots.map((s) => s || "none").join("|");
            const ops = t.operators.join("|");
            return `${slots}:${ops}`;
          })
          .join(",");
      };

      const fullData = {
        d: deckString,
        c1: serializeCurve(firstCurveTurns),
        c2: serializeCurve(secondCurveTurns),
      };

      // Use encodeURIComponent to handle the longer, more complex string safely
      const encodedData = btoa(encodeURIComponent(JSON.stringify(fullData)));
      const shareUrl = `${window.location.origin}${window.location.pathname}?deckData=${encodedData}`;

      navigator.clipboard.writeText(shareUrl).then(() => {
        alert("牌組策略連結已複製！");
      });
    } catch (e) {
      console.error("Share Error:", e);
    }
  };

  const generateMarketShareUrl = () => {
    const entries = Object.entries(deckList);
    if (entries.length === 0) return alert("市場列表是空的！");

    try {
      // 1. Create a simple deck string: "4xOP01-001,2xOP01-002"
      const deckString = entries
        .map(([id, count]) => `${count}x${id}`)
        .join(",");

      // 2. Create the market string: "ID:TypeNum:Price"
      const marketString = Object.entries(marketData)
        .map(([id, data]) => {
          const typeNum = data.type === "BUY" ? 0 : 1;
          return `${id}:${typeNum}:${data.price || 0}`;
        })
        .join(",");

      const marketDataObj = {
        d: deckString,
        m: marketString,
      };

      // 3. SAFE ENCODING for Chinese characters
      const jsonString = JSON.stringify(marketDataObj);
      const encodedData = btoa(encodeURIComponent(jsonString));

      const shareUrl = `${window.location.origin}${window.location.pathname}?marketData=${encodedData}`;

      navigator.clipboard.writeText(shareUrl).then(() => {
        alert("市場報價連結已複製！ / Market link copied!");
      });
    } catch (err) {
      console.error("Market Share Error:", err);
      alert("生成連結失敗。");
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deckDataParam = params.get("deckData");
    const marketDataParam = params.get("marketData");

    // Only run once cards are loaded from Firebase/Data source
    if (cards.length === 0) return;

    // Helper function to process the "4xID,1xID" string format
    const importDeckList = (deckStr) => {
      const newList = {};
      deckStr.split(",").forEach((pair) => {
        const [count, id] = pair.split("x");
        if (id && count) {
          newList[id] = parseInt(count, 10);
        }
      });
      setDeckList(newList);
    };

    try {
      // --- CASE 1: DECK & PLAYCURVE IMPORT ---
      // Inside your useEffect for [cards]
      if (deckDataParam) {
        // Use decodeURIComponent to match the new share function
        const decoded = JSON.parse(decodeURIComponent(atob(deckDataParam)));

        if (decoded.d) importDeckList(decoded.d);

        const deserializeCurve = (str, defaults) => {
          if (!str)
            return defaults.map((don) => ({
              don,
              slots: Array(5).fill(null),
              operators: Array(4).fill("or"),
            }));

          return str.split(",").map((turnStr, i) => {
            const [slotsPart, opsPart] = turnStr.split(":");

            // Split and pad slots to exactly 5
            let slots = slotsPart
              .split("|")
              .map((s) => (s === "none" ? null : s));
            while (slots.length < 5) slots.push(null);

            // Split and pad operators to exactly 4
            let ops = opsPart ? opsPart.split("|") : [];
            while (ops.length < 4) ops.push("or");

            return {
              don: defaults[i],
              slots: slots.slice(0, 5),
              operators: ops.slice(0, 4),
            };
          });
        };

        if (decoded.c1)
          setFirstCurveTurns(deserializeCurve(decoded.c1, [1, 3, 5, 7, 9]));
        if (decoded.c2)
          setSecondCurveTurns(deserializeCurve(decoded.c2, [2, 4, 6, 8, 10]));

        setAppMode("DECK");
      }
      // --- CASE 2: MARKETPLACE & PRICE IMPORT ---
      if (marketDataParam) {
        // We use decodeURIComponent because the share function encoded it to support Chinese characters
        const decoded = JSON.parse(decodeURIComponent(atob(marketDataParam)));

        // Import the cards into the deck
        if (decoded.d) importDeckList(decoded.d);

        // Import the market prices and types (WTB/WTS)
        if (decoded.m) {
          const newMarket = {};
          decoded.m.split(",").forEach((item) => {
            const [id, typeNum, price] = item.split(":");
            if (id) {
              newMarket[id] = {
                type: typeNum === "0" ? "BUY" : "SELL",
                price: price,
              };
            }
          });
          setMarketData(newMarket);
        }

        setAppMode("MARKETPLACE");
      }

      // Clean up the URL after processing so refreshing doesn't reset user changes
      if (deckDataParam || marketDataParam) {
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );
      }
    } catch (error) {
      console.error("Import Error Details:", error);
    }
  }, [cards]); // Dependency array: triggers when cards are loaded

  // 更新卡牌數量的核心邏輯 (包含 Leader、4 張限制及異圖合併)
  const updateDeckCount = useCallback(
    (card, delta) => {
      setDeckList((prev) => {
        const currentCount = prev[card.id] || 0;
        const newCount = currentCount + delta;

        // 減少數量
        if (delta < 0) {
          if (newCount <= 0) {
            const newState = { ...prev };
            delete newState[card.id];
            return newState;
          }
          return { ...prev, [card.id]: newCount };
        }

        // 增加數量規則
        // 1. Leader 限制: 整個牌組只能有一個
        if (card.category === "Leader") {
          const newState = { ...prev };
          // 移除目前所有的 Leader
          Object.keys(newState).forEach((id) => {
            const c = cards.find((item) => item.id === id);
            if (c && c.category === "Leader") delete newState[id];
          });
          newState[card.id] = 1;
          return newState;
        }

        // 2. 其他卡牌限制最多 4 張 (包含異圖合併計數)
        const baseTotal = getBaseIdCount(card.id);
        if (baseTotal >= 4) return prev;

        return { ...prev, [card.id]: newCount };
      });
    },
    [cards, getBaseIdCount],
  );

  const deckAnalysis = useMemo(() => {
    const deckEntries = Object.entries(deckList)
      .map(([id, count]) => ({
        card: cards.find((c) => c.id === id),
        count,
      }))
      .filter((item) => item.card && item.card.category !== "Leader");

    const totalNonLeader = deckEntries.reduce(
      (acc, curr) => acc + curr.count,
      0,
    );
    if (totalNonLeader === 0) return null;

    const costs = Array(11).fill(0);

    deckEntries.forEach((item) => {
      // 1. If item.card.cost is null, treat it as "0"
      // 2. Using the ?? (nullish coalescing) operator is the cleanest way
      const rawCost = item.card.cost ?? "0";

      const c = parseInt(rawCost, 10);

      if (!isNaN(c)) {
        // Math.max/min ensures we stay within the 0-10 index range
        const index = Math.min(Math.max(c, 0), 10);
        costs[index] += item.count;
      }
    });

    const categories = { Character: 0, Event: 0, Stage: 0 };
    deckEntries.forEach((item) => {
      if (categories[item.card.category] !== undefined) {
        categories[item.card.category] += item.count;
      }
    });

    const counters = { 0: 0, 1000: 0, 2000: 0 };
    deckEntries.forEach((item) => {
      const cntVal = parseInt(item.card.counter);
      const key = isNaN(cntVal) || cntVal === 0 ? "0" : String(cntVal);
      if (counters[key] !== undefined) counters[key] += item.count;
      else counters["0"] += item.count;
    });

    // NEW: Calculate Weighted Average
    const totalCounterValue = counters["1000"] * 1000 + counters["2000"] * 2000;
    const avgCounter = Math.round(totalCounterValue / totalNonLeader);
    const twokCounter = Math.round((counters["2000"] / totalNonLeader) * 100);
    // NEW: Calculate Quality Score (Percentage of cards with +1000 or +2000)
    const cardsWithCounter = counters["1000"] + counters["2000"];
    const counterQualityScore = Math.round(
      (cardsWithCounter / totalNonLeader) * 100,
    );

    const typesMap = {};
    deckEntries.forEach((item) => {
      item.card.types?.forEach((t) => {
        if (!typesMap[t]) {
          typesMap[t] = { count: 0, cards: [] };
        }
        typesMap[t].count += item.count;
        // Store the card and its count for the hover list
        typesMap[t].cards.push({
          id: item.card.id,
          name: item.card.name,
          count: item.count,
        });
      });
    });

    // Change the sort comparison from b[1].count to b[1].cards.length
    const sortedTypes = Object.entries(typesMap).sort((a, b) => {
      // 1. Primary sort: Number of unique card types (descending)
      const diff = b[1].cards.length - a[1].cards.length;

      // 2. Secondary sort: If lengths are equal, sort by total quantity (descending)
      if (diff === 0) return b[1].count - a[1].count;

      return diff;
    });

    let blockerCount = 0;

    deckEntries.forEach((item) => {
      const effect = item.card.effect || "";

      // Regular Expression Explanation:
      // ^【防禦】          -> Matches if it starts with the keyword
      // |                 -> OR
      // <br>【防禦】       -> Matches if it follows a line break
      const isTrueBlocker = /^【防禦】|<br>【防禦】/.test(effect);

      if (isTrueBlocker) {
        blockerCount += item.count;
      }
    });

    return {
      costs,
      categories,
      counters,
      avgCounter,
      twokCounter,
      counterQualityScore,
      sortedTypes,
      totalNonLeader,
      blockerCount,
    };
  }, [deckList, cards]);

  const [hoveredTrait, setHoveredTrait] = useState(null);

  const toggleKeyword = (keyword) => {
    setSelectedKeywords((prev) =>
      prev.includes(keyword)
        ? prev.filter((k) => k !== keyword)
        : [...prev, keyword],
    );
  };

  const toggleColor = (color) => {
    if (color === "所有") {
      setSelectedColors([]);
      return;
    }
    setSelectedColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color],
    );
  };

  const handleImport = async () => {
    if (!jsonInput || !user) {
      alert("Please paste JSON and ensure you are logged in!");
      return;
    }
    try {
      const data = JSON.parse(jsonInput);
      const cardsArray = Array.isArray(data) ? data : [data];
      setIsImporting(true);
      for (const card of cardsArray) {
        await setDoc(
          doc(db, "artifacts", appId, "public", "data", "cards", card.id),
          card,
        );
      }
      setJsonInput("");
      setIsImporting(false);
      alert("Upload Successful!"); // <--- Add this
    } catch (err) {
      console.error("Import error:", err);
      setIsImporting(false);
      alert("Upload Failed: " + err.message); // <--- Add this
    }
  };

  const handleImportDeckCode = () => {
    if (!deckInput) return;
    const lines = deckInput.split("\n");
    const newDeck = {};
    lines.forEach((line) => {
      const match = line.trim().match(/^(\d+)x([\w-]+)$/);
      if (match) {
        const count = parseInt(match[1], 10);
        const cardId = match[2];
        newDeck[cardId] = (newDeck[cardId] || 0) + count;
      }
    });
    setDeckList(newDeck);
    setIsImportingDeck(false);
    setDeckInput("");
  };

  /**
   * 修正後的圖片路徑邏輯
   * 根據使用者提供的正確網域：asia-tc.onepiece-cardgame.com
   */
  const getSafeImageUrl = (card) => {
    if (!card) return "";

    const targetDomain = "https://asia-tc.onepiece-cardgame.com";

    // 1. 如果有 img_full_url，將其 domain 替換成正確的 asia-tc
    if (card.img_full_url) {
      if (card.img_full_url.includes("onepiece-cardgame.com")) {
        return card.img_full_url.replace(/https?:\/\/[^\/]+/, targetDomain);
      }
      return card.img_full_url;
    }

    // 2. 如果只有相對路徑 img_url (例如 ../images/...)
    if (card.img_url && card.img_url.includes("images/cardlist/")) {
      const pathOnly = card.img_url.substring(card.img_url.indexOf("images/"));
      return `${targetDomain}/${pathOnly}`;
    }

    // 3. 兜底方案：利用 ID 構造
    if (card.id) {
      return `${targetDomain}/images/cardlist/card/${card.id}.png`;
    }

    return "https://via.placeholder.com/300x420?text=No+Image";
  };

  const parseNumericFilter = (term) => {
    const match = term.match(/^([><]=?|=)?(\d+)$/);
    return match
      ? { operator: match[1] || "=", value: parseInt(match[2], 10) }
      : null;
  };

  const compare = (cardValue, filter) => {
    const val = parseInt(cardValue, 10);
    if (isNaN(val)) return false;
    switch (filter.operator) {
      case ">":
        return val > filter.value;
      case "<":
        return val < filter.value;
      case ">=":
        return val >= filter.value;
      case "<=":
        return val <= filter.value;
      case "=":
        return val === filter.value;
      default:
        return val === filter.value;
    }
  };

  const filteredCards = useMemo(() => {
    const conditions = searchTerm.split(/[,，]/).filter((c) => c.trim() !== "");
    return cards.filter((card) => {
      // 再錄卡過濾邏輯：ID 結尾包含 _p 或 _r 加數字
      if (hideReprint) {
        if (card.id && /_[pr]\d+$/i.test(card.id)) {
          return false;
        }
      }

      const matchesSearch = conditions.every((cond) => {
        const term = cond.toLowerCase().trim();

        const counterMatch = term.match(/^\+(\d+)$/);
        if (counterMatch) {
          const targetCounter = parseInt(counterMatch[1], 10);
          const cardCounter =
            card.counter === null || card.counter === undefined
              ? 0
              : parseInt(card.counter, 10);
          return cardCounter === targetCounter;
        }

        const nf = parseNumericFilter(term);
        if (term === "0")
          return card.counter === 0 || card.cost === 0 || card.power === 0;
        if (nf) {
          if (nf.value <= 15) return compare(card.cost, nf);
          return compare(card.power, nf);
        }
        return (
          (card.name || "").toLowerCase().includes(term) ||
          (card.id || "").toLowerCase().includes(term) ||
          (card.effect || "").toLowerCase().includes(term) ||
          (card.types && card.types.some((t) => t.toLowerCase().includes(term)))
        );
      });

      //const matchesKeywords = selectedKeywords.every(k => (card.effect || '').includes(k) || (card.trigger || '').includes(k));

      const matchesKeywords =
        selectedKeywords.length === 0
          ? true
          : isExcludeMode
            ? selectedKeywords.every((k) => {
                // Special Case: Excluding "No Effect" means showing only cards WITH effects
                if (k === "沒有效果") {
                  return card.effect !== "-" || card.trigger !== null;
                }
                // Standard Exclusion
                return (
                  !(card.effect || "").includes(k) &&
                  !(card.trigger || "").includes(k)
                );
              })
            : selectedKeywords.every((k) => {
                // Special Case: Finding "No Effect" cards
                if (k === "沒有效果") {
                  return card.effect === "-" && card.trigger === null;
                }
                // Standard Inclusion
                return (
                  (card.effect || "").includes(k) ||
                  (card.trigger || "").includes(k)
                );
              });

      let matchesColor = true;
      if (selectedColors.length > 0) {
        if (selectedColors.includes("多色")) {
          matchesColor = card.colors?.length > 1;
        } else {
          const mappedColors = selectedColors.map((c) => colorMap[c]);
          matchesColor = card.colors?.some((c) => mappedColors.includes(c));
        }
      }

      let matchesRarity = true;
      // Only filter if there are selections AND '所有' is not the only selection
      if (selectedRarity.length > 0 && !selectedRarity.includes("所有")) {
        const mappedRarities = selectedRarity.map((r) => rarityMap[r]);
        matchesRarity = mappedRarities.includes(card.rarity);
      }

      let matchesCategory =
        filterCategory === "所有"
          ? true
          : card.category === categoryMap[filterCategory];

      // 特徵篩選邏輯 (雙下拉選單 + AND/OR)
      let matchesType = true;
      const type1Active = filterType1 !== "所有";
      const type2Active = filterType2 !== "所有";

      if (type1Active && type2Active) {
        const hasT1 = card.types?.includes(filterType1);
        const hasT2 = card.types?.includes(filterType2);
        matchesType = typeLogic === "AND" ? hasT1 && hasT2 : hasT1 || hasT2;
      } else if (type1Active) {
        matchesType = card.types?.includes(filterType1);
      } else if (type2Active) {
        matchesType = card.types?.includes(filterType2);
      }

      // 卡包篩選邏輯
      let matchesPack =
        filterPackId === "所有"
          ? true
          : String(card.pack_id) === String(filterPackId);

      const matchesAttribute =
        selectedAttributes.length === 0 || selectedAttributes.includes("所有")
          ? true
          : selectedAttributes.some((selectedAttrLabel) => {
              const englishValue = attributeMap[selectedAttrLabel]; // e.g., "Ranged"

              // Since card.attributes is an array: ["Ranged"]
              // We check if the array contains our mapped value
              return (
                card.attributes &&
                card.attributes.some(
                  (cardAttr) =>
                    cardAttr.trim().toLowerCase() ===
                    (englishValue || "").toLowerCase(),
                )
              );
            });

      const matchesBlock =
        selectedBlocks.length === 0 || selectedBlocks.includes("所有")
          ? true
          : selectedBlocks.some((block) => {
              // Convert the button label (string) to a number for exact comparison
              const blockNum = parseInt(block, 10);
              return card.block_number === blockNum;
            });

      return (
        matchesSearch &&
        matchesKeywords &&
        matchesColor &&
        matchesRarity &&
        matchesCategory &&
        matchesType &&
        matchesPack &&
        matchesAttribute &&
        matchesBlock &&
        matchesBlock
      );
    });
  }, [
    cards,
    searchTerm,
    selectedKeywords,
    isExcludeMode,
    selectedColors,
    selectedRarity,
    filterCategory,
    filterType1,
    filterType2,
    typeLogic,
    filterPackId,
    hideReprint,
    selectedAttributes,
    selectedBlocks,
  ]);

  // DECK CARDS (ONLY THOSE IN DECKLIST)
  const deckBuildingCards = useMemo(() => {
    return Object.keys(deckList)
      .map((id) => cards.find((c) => c.id === id))
      .filter((c) => !!c); // Ensure card exists in DB
  }, [deckList, cards]);

  // NAVIGATION LOGIC FOR MODAL
  const activeCardsList = useMemo(() => {
    return appMode === "DECK" ? deckBuildingCards : filteredCards;
  }, [appMode, deckBuildingCards, filteredCards]);

  const navigateCard = useCallback(
    (direction) => {
      if (!selectedCard) return;
      const currentIndex = activeCardsList.findIndex(
        (c) => c.id === selectedCard.id,
      );
      if (currentIndex === -1) return;

      let nextIndex = currentIndex + direction;
      if (nextIndex < 0) nextIndex = activeCardsList.length - 1;
      if (nextIndex >= activeCardsList.length) nextIndex = 0;

      setSelectedCard(activeCardsList[nextIndex]);
    },
    [selectedCard, activeCardsList],
  );

  // --- 效果文字格式化渲染邏輯 ---
  const renderFormattedEffect = (text) => {
    if (!text) return null;

    // 預處理換行與移除 HTML 標籤
    const plainText = text.replace(/<br>/g, "\n");

    // 定義各類別關鍵字與其對應樣式
    // const rules = [
    //   {
    //     keywords: ["【主要】", "【啟動主要】", "【攻擊時】","【對方攻擊時】", "【KO時】", "【我方回合中】", "【對方回合中】", "【我方回合結束時】", "【登場時】"],
    //     style: "bg-blue-600 text-white px-0 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block"
    //   },
    //   {
    //     keywords: ["【每回合1次】"],
    //     style: "bg-red-600 text-white px-0 py-0.5 rounded-full text-[13px] leading-tight font-bold mx-0.5 inline-block"
    //   },
    //   {
    //     keywords: ["【反擊】"],
    //     style: "bg-red-600 text-white px-0 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block"
    //   },
    //   {
    //     keywords: ["【速攻】", "【防禦】", "【速攻：角色】", "【防禦不可】", "【雙重攻擊】", "【消失】"],
    //     style: "bg-orange-500 text-white px-0 py-0.5 text-[13px] leading-tight font-bold mx-0.5 inline-block [clip-path:polygon(10%_0%,_90%_0%,_100%_50%,_90%_100%,_10%_100%,_0%_50%)]"
    //   },
    //   {
    //     keywords: ["【咚‼×1】", "【咚‼×2】", "【咚‼×3】", "【咚‼×4】", "【咚‼×5】", "【咚‼×6】", "【咚‼×7】", "【咚‼×8】", "【咚‼×9】", "【咚‼×10】"],
    //     style: "bg-slate-900 text-white px-0 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block [clip-path:polygon(10%_0%,_90%_0%,_100%_10%,_100%_90%,_90%_100%,_10%_100%,_0%_90%,_0%_10%)]"
    //   },
    //   {
    //     keywords: ["【觸發器】"],
    //     style: "bg-yellow-200 text-black pl-0 pr-2 py-0.5 rounded text-[13px] leading-tight font-bold mx-0.5 inline-block [clip-path:polygon(0%_0%,_100%_0%,_85%_100%,_0%_100%)]"
    //   }
    // ];

    const allKeywords = rules.flatMap((r) => r.keywords);
    const keywordRegexPart = allKeywords
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");

    // REFINED REGEX:
    // 1. Static Keywords
    // 2. The specific !! symbols
    // 3. The Bold Pattern: Grabs non-bracket text followed by optional parens and a colon
    const regex = new RegExp(
      `(${keywordRegexPart}|!!|‼|[^\\s\\n【】(]+(?:\\([^)]*\\))?[:：])`,
      "g",
    );

    const parts = plainText.split(regex);

    return parts.map((part, index) => {
      if (!part) return null;

      // A. Handle Keyword Boxes (【...】)
      const rule = rules.find((r) => r.keywords.includes(part));
      if (rule) {
        const subParts = part.split(/(‼|!!)/g);
        return (
          <span key={index} className={rule.style}>
            {subParts.map((sub, i) =>
              sub === "‼" || sub === "!!" ? (
                <span key={i} className="inline-flex">
                  <span>!</span>
                  <span>!</span>
                </span>
              ) : (
                sub
              ),
            )}
          </span>
        );
      }

      // B. Handle !! or ‼ marks (Standalone)
      if (part === "!!" || part === "‼") {
        return (
          <span key={index} className="inline-flex">
            <span>!</span>
            <span>!</span>
          </span>
        );
      }

      // C. Handle the Bold Text (Text ending in : or ：)
      if (/[：:]$/.test(part) && !part.startsWith("【")) {
        const match = part.match(/^([^()]+)(\([^)]*\))?([:：])$/);

        if (match) {
          const [_, mainText, parens, colon] = match;
          return (
            <span key={index}>
              {/* 1. Bold White Text (Main Cost) */}
              <span className="font-bold text-white">
                {mainText.split(/(‼|!!)/g).map((s, i) =>
                  s === "‼" || s === "!!" ? (
                    <span key={i} className="inline-flex">
                      <span>!</span>
                      <span>!</span>
                    </span>
                  ) : (
                    s
                  ),
                )}
              </span>

              {/* 2. Parentheses: NOW FIXES !! INSIDE TOO */}
              {parens && (
                <span className="font-normal">
                  {parens.split(/(‼|!!)/g).map((s, i) =>
                    s === "‼" || s === "!!" ? (
                      <span key={i} className="inline-flex">
                        <span>!</span>
                        <span>!</span>
                      </span>
                    ) : (
                      s
                    ),
                  )}
                </span>
              )}

              {/* 3. The Colon */}
              <span className="font-bold text-white">{colon}</span>
            </span>
          );
        }
      }

      // D. Normal text (This is where the text AFTER the colon now lives)
      return <span key={index}>{part}</span>;
    });
  };

  // const navigateCard = useCallback((direction) => {
  //   if (!selectedCard) return;
  //   const currentIndex = filteredCards.findIndex(c => c.id === selectedCard.id);
  //   if (currentIndex === -1) return;
  //   const nextIndex = currentIndex + direction;
  //   if (nextIndex >= 0 && nextIndex < filteredCards.length) {
  //     setSelectedCard(filteredCards[nextIndex]);
  //   }
  // }, [selectedCard, filteredCards]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!selectedCard) return;
      if (e.key === "ArrowLeft") navigateCard(-1);
      if (e.key === "ArrowRight") navigateCard(1);
      if (e.key === "Escape") setSelectedCard(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCard, navigateCard]);

  const totalDeckCount = useMemo(
    () => Object.values(deckList).reduce((a, b) => a + b, 0),
    [deckList],
  );

  // from Grok 20260306: This useMemo creates an ordered list of cards in the deck, ensuring the Leader is always first, followed by other cards sorted by cost (or any other chosen strategy). This makes the deck display more intuitive and consistent.
  const orderedDeck = useMemo(() => {
    // Convert deckList to array of { card, count }
    const entries = Object.entries(deckList)
      .map(([id, count]) => ({
        card: cards.find((c) => c.id === id),
        count: Number(count), // ensure number
      }))
      .filter((item) => item.card); // safety: skip if card not found

    // Find Leader (only 1 exists)
    const leader = entries.find((item) => item.card.category === "Leader");

    // Rest (non-Leaders)
    const nonLeaders = entries.filter(
      (item) => item.card.category !== "Leader",
    );

    // Optional: Sort non-Leaders (pick one strategy below)
    // Strategy 1: By cost (ascending) — common for TCG mana curves
    // nonLeaders.sort((a, b) => {
    //   const costA = parseInt(a.card.cost ?? '0', 10);
    //   const costB = parseInt(b.card.cost ?? '0', 10);
    //   return costA - costB;
    // });

    // Strategy 2: By card ID (alphabetical/numerical) — for consistent exports
    // nonLeaders.sort((a, b) => a.card.id.localeCompare(b.card.id));

    // Strategy 3: By category then cost (e.g. Character > Event > Stage)
    // nonLeaders.sort((a, b) => {
    //   const catOrder = { Character: 0, Event: 1, Stage: 2 };
    //   const catA = catOrder[a.card.category] ?? 3;
    //   const catB = catOrder[b.card.category] ?? 3;
    //   if (catA !== catB) return catA - catB;
    //   return parseInt(a.card.cost ?? '0') - parseInt(b.card.cost ?? '0');
    // });

    // Leader ALWAYS first
    return leader ? [leader, ...nonLeaders] : nonLeaders;
  }, [deckList, cards]);

  const updatePrice = (id, price) => {
    setMarketData((prev) => ({
      ...prev,
      [id]: { ...prev[id], price },
    }));
  };

  const toggleMarketType = (id) => {
    setMarketData((prev) => ({
      ...prev,
      [id]: { ...prev[id], type: prev[id]?.type === "BUY" ? "SELL" : "BUY" },
    }));
  };

  // 獨立組件：卡片快速控制面板
  const QuickController = ({ card, isDeckMode = false }) => {
    if (appMode === "MARKETPLACE") return null;

    const count = deckList[card.id] || 0;
    const baseTotal = getBaseIdCount(card.id);
    const isLeader = card.category === "Leader";
    const canAdd = isLeader ? count === 0 : baseTotal < 4;

    return (
      <div
        className={`
        flex items-center bg-black/80 backdrop-blur-md 
        rounded-full border border-white/20 
        p-1.5 sm:p-2
        opacity-80 group-hover:opacity-100 
        transition-opacity duration-200 shadow-lg
        ${
          isDeckMode
            ? "" // no absolute positioning in deck mode
            : "absolute bottom-3 left-1/2 -translate-x-1/2 z-20"
        }
      `}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => updateDeckCount(card, -1)}
          className="w-4 h-4 flex items-center justify-center text-white hover:bg-white/20 rounded-full transition-colors font-bold text-lg"
        >
          −
        </button>

        <span
          className={`
          px-2.5 text-sm font-black min-w-[28px] text-center
          ${count > 0 ? "text-yellow-300" : "text-white"}
        `}
        >
          {count}
        </span>

        <button
          onClick={() => updateDeckCount(card, 1)}
          disabled={!canAdd}
          className={`
          w-4 h-4 flex items-center justify-center text-white hover:bg-white/20 rounded-full transition-colors font-bold text-lg
          ${!canAdd ? "opacity-40 cursor-not-allowed" : ""}
        `}
        >
          +
        </button>
      </div>
    );
  };

  // this is for the format matching for the keyword badges in the card effect text. It checks if the keyword exists in the rules and returns the corresponding style. If not found, it defaults to a standard blue badge style.
  const getKeywordStyle = (keyword) => {
    if (keyword === "沒有效果")
      return "bg-slate-600 border-slate-400 text-white px-1 py-0.5 rounded";
    const match = rules.find((r) => r.keywords.includes(keyword));
    // If found, we use its style. If not, we default to the standard blue.
    return match ? match.style : "bg-blue-600 text-white px-1 py-0.5 rounded";
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-8 font-sans flex flex-col">
      <header
        className="
        max-w-7xl mx-auto w-full mb-8 
        border-b border-slate-800 pb-4
      "
      >
        <div
          className="
          flex flex-row flex-nowrap 
          items-center justify-between 
          gap-4 sm:gap-6 md:gap-8
        "
        >
          {/* Left: title */}
          <h1
            className="
                text-lg sm:text-2xl md:text-3xl lg:text-4xl 
                font-bold bg-gradient-to-r from-yellow-400 to-red-500 
                bg-clip-text text-transparent 
                tracking-tight uppercase
                leading-tight
                flex-shrink-1 min-w-0
          "
          >
            One Piece卡牌卡表
          </h1>

          {/* Right: all three buttons in one row */}
          <div
            className="
            flex items-center gap-3 sm:gap-4 lg:gap-6 
            flex-shrink-0 ml-auto
          "
          >
            <button
              onClick={() => setAppMode("SEARCH")}
              className={`
                px-3 py-2 rounded-md text-sm font-bold transition-all
                flex items-center justify-center
                ${
                  appMode === "SEARCH"
                    ? "bg-blue-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                }
              `}
              title="卡牌搜尋" // ← tooltip when hovering
              aria-label="卡牌搜尋" // ← accessibility
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 640 640"
                className={`
                  w-5 h-5               // adjust size as needed
                  ${appMode === "SEARCH" ? "text-white" : "text-slate-400 group-hover:text-slate-200"}
                `}
                fill="currentColor" // makes it inherit the button's text color
              >
                <path d="M480 272C480 317.9 465.1 360.3 440 394.7L566.6 521.4C579.1 533.9 579.1 554.2 566.6 566.7C554.1 579.2 533.8 579.2 521.3 566.7L394.7 440C360.3 465.1 317.9 480 272 480C157.1 480 64 386.9 64 272C64 157.1 157.1 64 272 64C386.9 64 480 157.1 480 272zM272 416C351.5 416 416 351.5 416 272C416 192.5 351.5 128 272 128C192.5 128 128 192.5 128 272C128 351.5 192.5 416 272 416z" />
              </svg>
            </button>
            <button
              onClick={() => setAppMode("DECK")}
              className={`
                px-3 py-2 rounded-md transition-all
                flex items-center justify-center
                ${
                  appMode === "DECK"
                    ? "bg-blue-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                }
              `}
              title="製作牌組" // tooltip on hover
              aria-label="製作牌組" // accessibility
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 640 640"
                className={`
                  w-5 h-5
                  ${appMode === "DECK" ? "text-white" : "text-slate-400 group-hover:text-slate-200"}
                `}
                fill="currentColor"
              >
                <path d="M246.9 82.3L271 67.8C292.6 54.8 317.3 48 342.5 48C379.3 48 414.7 62.6 440.7 88.7L504.6 152.6C519.6 167.6 528 188 528 209.2L528 240.1L547.7 259.8L547.7 259.8C563.3 244.2 588.6 244.2 604.3 259.8C620 275.4 619.9 300.7 604.3 316.4L540.3 380.4C524.7 396 499.4 396 483.7 380.4C468 364.8 468.1 339.5 483.7 323.8L464 304L433.1 304C411.9 304 391.5 295.6 376.5 280.6L327.4 231.5C312.4 216.5 304 196.1 304 174.9L304 162.2C304 151 298.1 140.5 288.5 134.8L246.9 109.8C236.5 103.6 236.5 88.6 246.9 82.4zM50.7 466.7L272.8 244.6L363.3 335.1L141.2 557.2C116.2 582.2 75.7 582.2 50.7 557.2C25.7 532.2 25.7 491.7 50.7 466.7z" />
              </svg>
            </button>

            <button
              onClick={() => setAppMode("MARKETPLACE")}
              className={`
                px-3 py-2 rounded-md transition-all flex items-center justify-center
                ${
                  appMode === "MARKETPLACE"
                    ? "bg-blue-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                }
              `}
              title="交易模式 / Marketplace"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 640 640"
                className="w-5 h-5"
                fill="currentColor"
              >
                <path d="M0 80C0 53.5 21.5 32 48 32h96c26.5 0 48 21.5 48 48v400c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V80zm224 0c0-26.5 21.5-48 48-48h96c26.5 0 48 21.5 48 48v400c0 26.5-21.5 48-48 48h-96c-26.5 0-48-21.5-48-48V80zm224 0c0-26.5 21.5-48 48-48h96c26.5 0 48 21.5 48 48v400c0 26.5-21.5 48-48 48h-96c-26.5 0-48-21.5-48-48V80z" />
              </svg>
            </button>
          </div>
          <div className="flex gap-2">
            {["DECK", "MARKETPLACE"].includes(appMode) && (
              <button
                onClick={() => setIsImportingDeck(!isImportingDeck)}
                className={`
                  px-3 py-2 rounded-lg transition-colors
                  flex items-center justify-center
                  bg-indigo-600 hover:bg-indigo-500
                  shadow-lg shadow-indigo-900/20
                `}
                title="導入牌組代碼" // tooltip on hover
                aria-label="導入牌組代碼" // for screen readers
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 640 640"
                  className="w-5 h-5 text-white" // white to match the indigo background
                  fill="currentColor"
                >
                  <path d="M342.6 73.4C330.1 60.9 309.8 60.9 297.3 73.4L169.3 201.4C156.8 213.9 156.8 234.2 169.3 246.7C181.8 259.2 202.1 259.2 214.6 246.7L288 173.3L288 384C288 401.7 302.3 416 320 416C337.7 416 352 401.7 352 384L352 173.3L425.4 246.7C437.9 259.2 458.2 259.2 470.7 246.7C483.2 234.2 483.2 213.9 470.7 201.4L342.7 73.4zM160 416C160 398.3 145.7 384 128 384C110.3 384 96 398.3 96 416L96 480C96 533 139 576 192 576L448 576C501 576 544 533 544 480L544 416C544 398.3 529.7 384 512 384C494.3 384 480 398.3 480 416L480 480C480 497.7 465.7 512 448 512L192 512C174.3 512 160 497.7 160 480L160 416z" />
                </svg>
              </button>
            )}
            {/* Hide the data management button for now, as it's more of an admin feature and might confuse regular users. We can reintroduce it later with proper access control. */}
            {/* <button onClick={() => setIsImporting(!isImporting)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-sm font-medium border border-slate-600 whitespace-nowrap">管理數據</button> */}
          </div>
        </div>
      </header>

      {isImporting && (
        <div className="max-w-7xl mx-auto w-full mb-8 p-6 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl animate-in zoom-in-95 duration-200">
          <h3 className="text-sm font-bold mb-3 text-slate-300">
            導入卡牌 JSON 數據
          </h3>
          <textarea
            className="w-full h-40 bg-slate-900 border border-slate-600 rounded-lg p-3 font-mono text-sm mb-4 focus:border-blue-500 outline-none"
            placeholder="貼上 JSON 數據..."
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
          />
          <button
            onClick={handleImport}
            className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold transition-colors"
          >
            確認匯入
          </button>
        </div>
      )}

      {isImportingDeck && (
        <div className="max-w-7xl mx-auto w-full mb-8 p-6 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl animate-in zoom-in-95 duration-200">
          <h3 className="text-sm font-bold mb-3 text-slate-300">
            導入牌組 (格式: 1xEB03-001)
          </h3>
          <textarea
            className="w-full h-40 bg-slate-900 border border-slate-600 rounded-lg p-3 font-mono text-sm mb-4 focus:border-blue-500 outline-none"
            placeholder="1xEB03-001&#10;3xOP01-006..."
            value={deckInput}
            onChange={(e) => setDeckInput(e.target.value)}
          />
          <button
            onClick={handleImportDeckCode}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold transition-colors"
          >
            解析並導入
          </button>
        </div>
      )}

      <main className="max-w-7xl mx-auto w-full flex flex-col md:flex-row gap-8 flex-grow">
        {appMode === "SEARCH" ? (
          <>
            <aside className="w-full md:w-64 space-y-6">
              {/* Clear Filters Button */}
              <div className="flex justify-end mb-4">
                <button
                  onClick={resetFilters}
                  className="
                    px-2 py-1 
                    bg-red-800 hover:bg-red-600 
                    text-slate-200 hover:text-white
                    rounded-lg border border-red-800
                    text-sm font-medium transition-colors
                    flex items-center gap-2
                  "
                >
                  {/* <span>清空所有篩選</span> */}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 640 640"
                    className="w-5 h-5 text-white"
                    fill="currentColor"
                  >
                    <path d="M129.9 292.5C143.2 199.5 223.3 128 320 128C373 128 421 149.5 455.8 184.2C456 184.4 456.2 184.6 456.4 184.8L464 192L416.1 192C398.4 192 384.1 206.3 384.1 224C384.1 241.7 398.4 256 416.1 256L544.1 256C561.8 256 576.1 241.7 576.1 224L576.1 96C576.1 78.3 561.8 64 544.1 64C526.4 64 512.1 78.3 512.1 96L512.1 149.4L500.8 138.7C454.5 92.6 390.5 64 320 64C191 64 84.3 159.4 66.6 283.5C64.1 301 76.2 317.2 93.7 319.7C111.2 322.2 127.4 310 129.9 292.6zM573.4 356.5C575.9 339 563.7 322.8 546.3 320.3C528.9 317.8 512.6 330 510.1 347.4C496.8 440.4 416.7 511.9 320 511.9C267 511.9 219 490.4 184.2 455.7C184 455.5 183.8 455.3 183.6 455.1L176 447.9L223.9 447.9C241.6 447.9 255.9 433.6 255.9 415.9C255.9 398.2 241.6 383.9 223.9 383.9L96 384C87.5 384 79.3 387.4 73.3 393.5C67.3 399.6 63.9 407.7 64 416.3L65 543.3C65.1 561 79.6 575.2 97.3 575C115 574.8 129.2 560.4 129 542.7L128.6 491.2L139.3 501.3C185.6 547.4 249.5 576 320 576C449 576 555.7 480.6 573.4 356.5z" />
                  </svg>
                </button>
              </div>

              <div className="bg-slate-800 px-6 py-4 rounded-xl border border-slate-700 shadow-lg">
                <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest">
                  搜尋條件
                </h3>
                <input
                  type="text"
                  placeholder="名稱/編號/效果/>5/<=6000/+1000/ 用,分隔"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm mb-4 focus:border-blue-500 outline-none transition-colors"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-widest">
                  收錄卡包
                </p>
                <select
                  value={filterPackId}
                  onChange={(e) => setFilterPackId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm cursor-pointer mb-6 focus:border-blue-500 outline-none"
                >
                  <option value="所有">所有卡包</option>
                  {sortedPackList.map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {pack.raw_title}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 cursor-pointer mb-6 p-2 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors">
                  <input
                    type="checkbox"
                    checked={hideReprint}
                    onChange={(e) => setHideReprint(e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-500"
                  />
                  <span className="text-xs font-bold text-slate-300">
                    隱藏異圖和再錄卡
                  </span>
                </label>
              </div>

              <div className="space-y-4">
                {/* Advanced Search Toggle Button */}
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className={`w-full py-2.5 px-4 rounded-xl flex items-center justify-between transition-all font-bold text-sm ${
                    showAdvanced
                      ? "bg-slate-700 border-slate-500 text-white shadow-inner"
                      : "bg-indigo-600/20 border-indigo-500/50 text-indigo-400 hover:bg-indigo-600/30"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{showAdvanced ? "󱊄" : "󰍉"}</span>
                    {showAdvanced ? "隱藏進階搜尋" : "進階搜尋"}
                  </div>
                  <span
                    className={`transition-transform duration-300 ${showAdvanced ? "rotate-180" : ""}`}
                  >
                    ▼
                  </span>
                </button>

                {/* Advanced Filters Container */}
                {showAdvanced && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="bg-slate-800 pt-4 pb-6 px-6 rounded-xl border border-slate-700 shadow-lg">
                      <div className="space-y-3">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-widest">
                          特徵篩選
                        </p>
                        <select
                          value={filterType1}
                          onChange={(e) => setFilterType1(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm cursor-pointer focus:border-blue-500 outline-none"
                        >
                          {typeOptions.map((opt) => (
                            <option key={`t1-${opt}`} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        <div className="flex justify-center items-center gap-2 py-1">
                          <button
                            onClick={() => setTypeLogic("AND")}
                            className={`flex-1 text-[10px] py-1 rounded-l border ${typeLogic === "AND" ? "bg-blue-600 border-blue-400 text-white" : "bg-slate-700 border-slate-600 text-slate-500"}`}
                          >
                            AND
                          </button>
                          <button
                            onClick={() => setTypeLogic("OR")}
                            className={`flex-1 text-[10px] py-1 rounded-r border ${typeLogic === "OR" ? "bg-blue-600 border-blue-400 text-white" : "bg-slate-700 border-slate-600 text-slate-500"}`}
                          >
                            OR
                          </button>
                        </div>
                        <select
                          value={filterType2}
                          onChange={(e) => setFilterType2(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm cursor-pointer mb-4 focus:border-blue-500 outline-none"
                        >
                          {typeOptions.map((opt) => (
                            <option key={`t2-${opt}`} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="bg-slate-800 pt-4 pb-6 px-6 rounded-xl border border-slate-700 shadow-lg">
                      {/* Toggle Header */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                          關鍵字過濾
                        </span>

                        <div className="flex-wrap gap-1.5 mb-3">
                          <button
                            onClick={() => setIsExcludeMode(!isExcludeMode)}
                            className={`flex items-center gap-2 px-3 py-1 my-1 rounded-full border transition-all text-[11px] font-bold ${
                              isExcludeMode
                                ? "bg-red-500/20 border-red-500/50 text-red-400"
                                : "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full animate-pulse ${isExcludeMode ? "bg-red-500" : "bg-emerald-500"}`}
                            ></span>
                            {isExcludeMode
                              ? "排除模式 (NOT)"
                              : "包含模式 (HAS)"}
                          </button>
                        </div>
                      </div>

                      <div className="flex-wrap gap-1.5">
                        {quickKeywords.map((k) => {
                          const isSelected = selectedKeywords.includes(k);
                          const baseStyle = getKeywordStyle(k);

                          return (
                            <button
                              key={k}
                              onClick={() => toggleKeyword(k)}
                              className={`text-[13px] transition-all border shadow-sm ${
                                isSelected
                                  ? `${baseStyle} border-white/40 scale-105`
                                  : "bg-slate-700/50 border-slate-600 text-slate-400 hover:border-slate-500 rounded px-2 py-1"
                              }`}
                              /* We use a specific style for the clip-path to ensure it renders correctly on buttons */
                              style={
                                isSelected && baseStyle.includes("clip-path")
                                  ? {
                                      clipPath: baseStyle
                                        .split("clip-path:")[1]
                                        .split("]")[0],
                                    }
                                  : {}
                              }
                            >
                              {k.replace(/【|】/g, "")}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                      <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest">
                        顏色 (多選)
                      </h3>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {[
                          "所有",
                          "紅色",
                          "綠色",
                          "藍色",
                          "紫色",
                          "黑色",
                          "黃色",
                          "多色",
                        ].map((c) => {
                          const isSelected =
                            (c === "所有" && selectedColors.length === 0) ||
                            selectedColors.includes(c);

                          const colorMap = {
                            紅色: "bg-red-600 border-red-400 text-white",
                            綠色: "bg-emerald-600 border-emerald-400 text-white",
                            藍色: "bg-blue-600 border-blue-400 text-white",
                            紫色: "bg-purple-600 border-purple-400 text-white",
                            黑色: "bg-slate-950 border-slate-500 text-white",
                            黃色: "bg-yellow-500 border-yellow-300 text-black",
                            多色: "bg-gradient-to-br from-red-500 via-blue-500 to-yellow-500 border-white/50 text-white",
                            所有: "bg-indigo-600 border-indigo-400 text-white",
                          };

                          return (
                            <button
                              key={c}
                              onClick={() => toggleColor(c)}
                              className={`px-2 py-1 rounded text-[13px] font-bold border transition-all ${
                                isSelected
                                  ? colorMap[c] // Use the dynamic color from our map
                                  : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600"
                              }`}
                            >
                              {c}
                            </button>
                          );
                        })}
                      </div>

                      {/* <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest mt-6 border-t border-slate-700 pt-4">卡片類別</h3>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {['所有', '領航卡', '角色卡', '事件卡', '舞台卡'].map(cat => (
                    <label key={cat} className="flex items-center gap-1.5 cursor-pointer text-sm group whitespace-nowrap">
                      <input 
                        type="radio" 
                        name="category"
                        checked={filterCategory === cat} 
                        onChange={() => setFilterCategory(cat)} 
                        className="w-3.5 h-3.5 accent-blue-500 cursor-pointer" 
                      />
                      <span className={`transition-colors ${
                        filterCategory === cat 
                          ? 'text-blue-400 font-bold' 
                          : 'text-slate-400 group-hover:text-slate-200'
                      }`}>
                        {cat}
                      </span>
                    </label>
                  ))}
                </div> */}

                      <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest mt-6 border-t border-slate-700 pt-4">
                        卡牌種類
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {["所有", "領航卡", "角色卡", "事件卡", "舞台卡"].map(
                          (cat) => {
                            // Toggle logic: If "所有" is selected, filterCategory is '所有'
                            const isSelected = filterCategory === cat;

                            const categoryColorMap = {
                              所有: "bg-indigo-600 border-indigo-400 text-white",
                              領航卡: "bg-blue-600 border-blue-400 text-white",
                              角色卡: "bg-blue-600 border-blue-400 text-white",
                              事件卡: "bg-blue-600 border-blue-400 text-white",
                              舞台卡: "bg-blue-600 border-blue-400 text-white",
                            };

                            return (
                              <button
                                key={cat}
                                onClick={() => setFilterCategory(cat)}
                                className={`px-3 py-1 rounded text-[12px] font-bold border transition-all active:scale-95 ${
                                  isSelected
                                    ? categoryColorMap[cat]
                                    : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600 hover:border-slate-500"
                                }`}
                              >
                                {cat}
                              </button>
                            );
                          },
                        )}
                      </div>

                      <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest mt-6 border-t border-slate-700 pt-4">
                        稀有度 (多選)
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {[
                          "所有",
                          "領航卡 (L)",
                          "普通 (C)",
                          "不普通 (UC)",
                          "稀有 (R)",
                          "超級稀有 (SR)",
                          "絕密稀有 (SEC)",
                          "特殊卡 (SP)",
                        ].map((rar) => {
                          const isSelected =
                            (rar === "所有" && selectedRarity.length === 0) ||
                            selectedRarity.includes(rar);

                          const rarityColorMap = {
                            所有: "bg-indigo-600 border-indigo-400 text-white",
                            "領航卡 (L)":
                              "bg-blue-500 border-blue-300 text-white", // L
                            "普通 (C)":
                              "bg-blue-600 border-blue-400 text-white", // C
                            "不普通 (UC)":
                              "bg-blue-600 border-blue-400 text-white", // UC
                            "稀有 (R)":
                              "bg-blue-600 border-blue-400 text-white", // R
                            "超級稀有 (SR)":
                              "bg-blue-600 border-blue-400 text-white", // SR (Gold)
                            "絕密稀有 (SEC)":
                              "bg-blue-600 border-blue-400 text-white", // SEC (Purple/Secret)
                            "特殊卡 (SP)":
                              "bg-blue-600 border-blue-400 text-white", // Special (Holofoil look)
                            // '領航卡 (L)': 'bg-red-700 border-red-500 text-white', // L
                            // '普通 (C)': 'bg-slate-400 border-slate-400 text-white', // C
                            // '不普通 (UC)': 'bg-slate-500 border-slate-400 text-white', // UC
                            // '稀有 (R)': 'bg-slate-600 border-slate-400 text-white', // R
                            // '超級稀有 (SR)': 'bg-slate-700 border-slate-400 text-white', // SR (Gold)
                            // '絕密稀有 (SEC)': 'bg-amber-600 border-amber-400 text-white shadow-[0_0_10px_rgba(251,191,36,0.3)]', // SEC (Purple/Secret)
                            // '特殊卡 (SP)': 'bg-gradient-to-r from-yellow-400 via-white to-yellow-400 border-slate-300 text-slate-900 font-black', // Special (Holofoil look)
                          };

                          return (
                            <button
                              key={rar}
                              onClick={() => {
                                if (rar === "所有") {
                                  setSelectedRarity([]);
                                } else {
                                  if (selectedRarity.includes(rar)) {
                                    setSelectedRarity(
                                      selectedRarity.filter(
                                        (item) => item !== rar,
                                      ),
                                    );
                                  } else {
                                    setSelectedRarity([
                                      ...selectedRarity.filter(
                                        (item) => item !== "所有",
                                      ),
                                      rar,
                                    ]);
                                  }
                                }
                              }}
                              className={`px-2 py-1 rounded text-[12px] font-bold border transition-all active:scale-95 ${
                                isSelected
                                  ? rarityColorMap[rar]
                                  : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600 hover:border-slate-500"
                              }`}
                            >
                              {rar}
                            </button>
                          );
                        })}
                      </div>

                      {/* <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg"> */}
                      <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 mt-6 border-t border-slate-700 pt-4">
                        屬性
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {["所有", "打", "斬", "特", "射", "知"].map((attr) => {
                          const isSelected =
                            (attr === "所有" &&
                              selectedAttributes.length === 0) ||
                            selectedAttributes.includes(attr);

                          return (
                            <button
                              key={attr}
                              onClick={() => {
                                if (attr === "所有") {
                                  setSelectedAttributes([]);
                                } else {
                                  if (selectedAttributes.includes(attr)) {
                                    setSelectedAttributes(
                                      selectedAttributes.filter(
                                        (item) => item !== attr,
                                      ),
                                    );
                                  } else {
                                    setSelectedAttributes([
                                      ...selectedAttributes.filter(
                                        (item) => item !== "所有",
                                      ),
                                      attr,
                                    ]);
                                  }
                                }
                              }}
                              className={`px-3 py-1 rounded text-[12px] font-bold border transition-all active:scale-95 ${
                                isSelected
                                  ? attr === "所有"
                                    ? "bg-indigo-600 border-indigo-400 text-white"
                                    : "bg-blue-600 border-blue-400 text-white"
                                  : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600 hover:border-slate-500"
                              }`}
                            >
                              {attr}
                            </button>
                          );
                        })}
                      </div>

                      <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 mt-6 border-t border-slate-700 pt-4">
                        擴張記號
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {["所有", "1", "2", "3", "4"].map((block) => {
                          const isSelected =
                            (block === "所有" && selectedBlocks.length === 0) ||
                            selectedBlocks.includes(block);

                          return (
                            <button
                              key={block}
                              onClick={() => {
                                if (block === "所有") {
                                  setSelectedBlocks([]);
                                } else {
                                  if (selectedBlocks.includes(block)) {
                                    setSelectedBlocks(
                                      selectedBlocks.filter(
                                        (item) => item !== block,
                                      ),
                                    );
                                  } else {
                                    setSelectedBlocks([
                                      ...selectedBlocks.filter(
                                        (item) => item !== "所有",
                                      ),
                                      block,
                                    ]);
                                  }
                                }
                              }}
                              className={`px-2 py-1 rounded text-[12px] font-bold border transition-all active:scale-95 min-w-[32px] ${
                                isSelected
                                  ? block === "所有"
                                    ? "bg-indigo-600 border-indigo-400 text-white"
                                    : "bg-blue-600 border-blue-400 text-white"
                                  : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600 hover:border-slate-500"
                              }`}
                            >
                              {block}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </aside>

            <section className="flex-1">
              <p className="text-xs text-slate-400 mb-4 px-1 font-bold flex justify-between">
                <span>
                  符合條件:{" "}
                  <span className="text-blue-400">{filteredCards.length}</span>{" "}
                  張卡片
                </span>
                <span>
                  牌組總計:{" "}
                  <span
                    className={
                      totalDeckCount === 51
                        ? "text-green-400"
                        : "text-slate-300"
                    }
                  >
                    {totalDeckCount} / 51
                  </span>
                </span>
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredCards.map((card) => (
                  <div
                    key={card.id}
                    onClick={() => setSelectedCard(card)}
                    className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 hover:border-blue-500 hover:shadow-[0_0_20px_rgba(37,99,235,0.2)] transition-all cursor-pointer group shadow-sm relative"
                  >
                    <div className="aspect-[2.5/3.5] relative overflow-hidden bg-slate-950">
                      <img
                        src={getSafeImageUrl(card)}
                        alt={card.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                      {appMode !== "MARKETPLACE" && (
                        <QuickController
                          card={card}
                          isDeckMode={appMode === "DECK"}
                        />
                      )}

                      {appMode === "MARKETPLACE" && (
                        <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
                          <div
                            className={`absolute top-0 right-0 px-8 py-1 mt-4 -mr-8 rotate-45 text-[10px] font-black text-white shadow-md pointer-events-auto cursor-pointer transition-colors ${marketData[card.id]?.type === "BUY" ? "bg-emerald-500" : "bg-rose-600"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMarketType(card.id);
                            }}
                          >
                            {marketData[card.id]?.type === "BUY"
                              ? "WTB / 收"
                              : "WTS / 賣"}
                          </div>
                          <div className="absolute bottom-2 left-0 right-0 px-2 pointer-events-auto">
                            <input
                              type="text"
                              placeholder="價格..."
                              value={marketData[card.id]?.price || ""}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                updatePrice(card.id, e.target.value)
                              }
                              className="w-full bg-slate-900/95 border border-slate-700 rounded text-center text-xs py-1 text-white font-mono outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-[10px] text-slate-500 font-mono font-bold">
                        {card.id}
                      </p>
                      <h4 className="font-bold text-sm truncate text-slate-100 group-hover:text-blue-300 transition-colors">
                        {card.name}
                      </h4>
                    </div>
                    {/* Bottom section: card ID + QuickController */}
                    {/* <div className="
                      px-3 py-2 flex items-center justify-between 
                      bg-slate-900/80 border-t border-slate-700
                    "> */}
                    {/* Left: card ID – takes available space */}
                    {/* <p className="text-[10px] md:text-xs font-mono font-bold text-slate-400 tracking-tight">
                        {card.id}
                      <h4 className="font-bold text-sm truncate text-slate-100 group-hover:text-blue-300 transition-colors">
                        {card.name}
                      </h4>
                      </p> */}

                    {/* Right: QuickController – smaller & doesn't stretch */}
                    {/* <QuickController card={card} isDeckMode={appMode === 'DECK'} /> */}
                    {/* </div> */}
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section className="w-full">
            <div
              className={`relative mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center p-6 rounded-2xl border transition-all duration-500 overflow-hidden group shadow-xl ${
                selectedLeader
                  ? "border-slate-700/50"
                  : "border-dashed border-sky-500/30 bg-slate-800/40"
              }`}
              style={
                selectedLeader
                  ? {
                      backgroundImage: `url(${getSafeImageUrl(selectedLeader)})`,
                      backgroundSize: "110% auto",
                      backgroundPosition: "center 10%", // Shifted slightly to show the character face better
                      backgroundRepeat: "no-repeat",
                    }
                  : {}
              }
            >
              {/* Overlay - Using a gradient to protect text but show the art */}
              {selectedLeader && (
                <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/40 to-transparent transition-all duration-500 group-hover:from-slate-950/80" />
              )}

              {/* Content Section */}
              <div className="relative z-10">
                {selectedLeader ? (
                  <>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tighter">
                      製作牌組{" "}
                      <span className="text-sky-400 font-mono text-sm ml-2">
                        {selectedLeader.name}
                      </span>
                    </h2>
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-sm text-slate-300">
                        總張數：
                        <span
                          className={`font-black ml-1 ${totalDeckCount === 51 ? "text-green-400" : "text-red-400"}`}
                        >
                          {totalDeckCount} / 51
                        </span>
                      </p>
                      <div className="h-1 w-1 rounded-full bg-slate-600" />
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        {selectedLeader.id}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="text-xl font-bold text-sky-400 flex items-center gap-2">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                          clipRule="evenodd"
                        />
                      </svg>
                      尚未選擇領袖 (Select a Leader)
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                      請先從卡片列表中點擊「領袖卡」以開始編輯您的牌組。
                    </p>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="relative z-10 w-full sm:w-auto mt-4 sm:mt-0 flex gap-2">
                {selectedLeader && (
                  <button
                    onClick={() => setDeckList({})}
                    className="flex-1 sm:flex-none text-[10px] font-black text-red-400 hover:text-red-300 hover:bg-red-950/40 border border-red-900/50 rounded-lg transition-all uppercase tracking-widest px-4 py-2"
                  >
                    清空牌組 (Clear)
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2 md:gap-4 mb-2">
              {orderedDeck.map(({ card, count }) => (
                <div
                  key={card.id}
                  onClick={() => setSelectedCard(card)}
                  className="
                    bg-slate-800 rounded-md md:rounded-xl 
                    overflow-hidden border border-slate-700 
                    hover:border-indigo-500 transition-all 
                    cursor-pointer group relative shadow-lg
                    flex flex-col
                  "
                >
                  <div className="aspect-[2.5/3.5] relative overflow-hidden bg-slate-950">
                    <img
                      src={getSafeImageUrl(card)}
                      alt={card.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />

                    {appMode === "MARKETPLACE" && (
                      /* Badge - Anchored to Top Right */
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMarketType(card.id);
                        }}
                        className={`
                          absolute top-0 right-0 z-30
                          px-2 py-1 rounded-bl-md
                          shadow-md cursor-pointer pointer-events-auto
                          flex flex-col items-center justify-center
                          transition-colors duration-200
                          ${marketData[card.id]?.type === "BUY" ? "bg-emerald-500" : "bg-rose-600"}
                        `}
                      >
                        <span className="text-[7px] sm:text-[9px] font-black text-white uppercase leading-none tracking-tighter">
                          {marketData[card.id]?.type === "BUY" ? "WTB" : "WTS"}
                        </span>
                        <span className="text-[8px] sm:text-[10px] font-bold text-white leading-none mt-0.5">
                          {marketData[card.id]?.type === "BUY" ? "收" : "賣"}
                        </span>

                        {/* Price Input - Compacted for mobile */}
                        {/* <div className="absolute bottom-3 left-0 right-0 px-0.5 pointer-events-auto">
                            <input
                              type="text"
                              placeholder="價格"
                              value={marketData[card.id]?.price || ""}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                updatePrice(card.id, e.target.value)
                              }
                              className="
                              w-full bg-slate-950/80 border border-slate-700/50 rounded-sm
                              text-center text-[8px] sm:text-[10px] py-0
                              h-4 sm:h-5 text-white font-mono outline-none focus:border-blue-500
                            "
                            />
                          </div> */}
                      </div>
                    )}
                  </div>

                  {/* Leader indicator - still at top-left of image */}
                  {card.category === "Leader" && (
                    <div className="absolute top-2 left-2 z-10 bg-purple-600/90 text-white text-xs font-bold px-2 py-0.5 rounded shadow-md">
                      領航
                    </div>
                  )}

                  {/* Optional count badge - top-right of image */}
                  {/* {count > 1 && (
                    <div className="absolute top-2 right-2 z-10 bg-blue-600/90 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-md">
                      ×{count}
                    </div>
                  )} */}

                  {/* Bottom section – now handles dynamic Row 2 */}
                  <div className="bg-slate-900/80 border-t border-slate-700">
                    {/* Row 1: Card ID – Always visible */}
                    <div className="px-1 pt-2 pb-1 text-center md:text-left">
                      <p className="text-[10px] md:text-xs font-mono font-bold text-slate-400 tracking-tight whitespace-nowrap">
                        {card.id}
                      </p>
                    </div>

                    {/* Row 2: Dynamic Content (QuickController vs Price Input) */}
                    <div className="px-2 pb-2.5 flex justify-center">
                      {appMode === "MARKETPLACE" ? (
                        /* Marketplace Mode: Price Input appears here instead of on the image */
                        <div className="w-full px-1">
                          <textarea
                            type="text"
                            placeholder="價格"
                            value={marketData[card.id]?.price || ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              updatePrice(card.id, e.target.value)
                            }
                            rows={2}
                            className="
                              w-full bg-slate-950 border border-slate-700 rounded-sm
                              text-center text-[9px] sm:text-[10px] p-1
                              min-h-[34px] max-h-[50px]
                              text-white font-mono outline-none focus:border-blue-500
                              shadow-inner resize-none overflow-hidden
                              leading-tight flex items-center justify-center
                            "
                          />
                        </div>
                      ) : (
                        /* Deck Mode: QuickController appears here */
                        <QuickController
                          card={card}
                          isDeckMode={appMode === "DECK"}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {orderedDeck.length === 0 && (
                <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-800 rounded-2xl">
                  <p className="text-slate-500 font-bold">
                    目前牌組為空，請切換到資料庫添加卡片。
                  </p>
                </div>
              )}
            </div>

            <div className="mt-1 mb-2 pt-8 border-t border-slate-700/50">
              <div className="flex flex-col items-center gap-3">
                {appMode === "DECK" && (
                  <button
                    onClick={generateShareUrl}
                    className="w-full sm:w-auto px-6 py-3 rounded-xl transition-all flex items-center justify-center gap-3 bg-sky-600 hover:bg-sky-500 shadow-lg shadow-sky-900/40 group active:scale-95"
                    title="生成分享連結 / Share Deck & Curve"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 640 640"
                      className="w-5 h-5 text-white transition-transform group-hover:rotate-12"
                      fill="currentColor"
                    >
                      <path d="M448 256c-10.6 0-20.9 1.9-30.4 5.4L214.7 150.2c.2-2 .3-4.1 .3-6.2c0-35.3-28.7-64-64-64s-64 28.7-64 64s28.7 64 64 64c10.6 0 20.9-1.9 30.4-5.4L385.3 313.8c-.2 2-.3 4.1-.3 6.2s.1 4.2 .3 6.2L181.3 430.6c-9.5-3.5-19.8-5.4-30.4-5.4c-35.3 0-64 28.7-64 64s28.7 64 64 64s64-28.7 64-64c0-2.1-.1-4.2-.3-6.2L417.6 383.4c9.5 3.5 19.8 5.4 30.4 5.4c35.3 0 64-28.7 64-64s-28.7-64-64-64z" />
                    </svg>
                    <span className="font-bold text-sm tracking-wide text-white">
                      分享牌組策略
                    </span>
                  </button>
                )}

                {/* MARKETPLACE MODE SHARE */}
                {appMode === "MARKETPLACE" && (
                  <button
                    onClick={generateMarketShareUrl}
                    className="w-full sm:w-auto px-6 py-3 rounded-xl transition-all flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/40 group active:scale-95"
                    title="分享報價連結 / Share Market Prices"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 512 512"
                      className="w-5 h-5 text-white transition-transform group-hover:-rotate-12"
                      fill="currentColor"
                    >
                      <path d="M345 39.1L472.9 167c9.4 9.4 9.4 24.6 0 33.9L207.9 465.9c-9.4 9.4-24.6 9.4-33.9 0l-132-132c-9.4-9.4-9.4-24.6 0-33.9L311.1 31c9.4-9.4 24.6-9.4 33.9 0zM112 192a48 48 0 1 0 0-96 48 48 0 1 0 0 96z" />
                    </svg>
                    <span className="font-bold text-sm tracking-wide text-white">
                      分享市場報價
                    </span>
                  </button>
                )}
                <p className="text-[11px] text-slate-500 font-medium">
                  點擊複製專屬連結，其他人點擊連結即可查看此牌組
                </p>
              </div>
            </div>

            {deckAnalysis && appMode !== "MARKETPLACE" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-4 w-1 bg-blue-500 rounded-full"></div>
                  <h3 className="text-lg font-bold uppercase tracking-widest">
                    牌組分析
                  </h3>
                </div>

                <div className="mt-8 px-2 sm:px-4">
                  {/* Header / Toggle Row */}
                  <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xs font-black text-slate-400 uppercase tracking-tighter">
                        策略規劃 / Play Curve
                      </h2>
                      <span className="text-[10px] text-slate-500 font-mono">
                        BETA
                      </span>
                    </div>

                    <button
                      onClick={() => setShowCurve(!showCurve)}
                      className="text-[10px] font-bold px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700 uppercase"
                    >
                      {showCurve ? "隱藏表格 Hide" : "顯示表格 Show"}
                    </button>
                  </div>

                  {/* Collapsible Content */}
                  {showCurve && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
                      {(() => {
                        const cardsInDeck = Object.keys(deckList)
                          .map((id) => cards.find((c) => c.id === id))
                          .filter(Boolean);

                        return (
                          <>
                            <PlayCurve
                              title="先攻 (First)"
                              turns={firstCurveTurns}
                              setTurns={setFirstCurveTurns}
                              defaultTurns={[1, 3, 5, 7, 9]}
                              availableCards={cardsInDeck}
                              getSafeImageUrl={getSafeImageUrl}
                            />

                            <PlayCurve
                              title="後攻 (Second)"
                              turns={secondCurveTurns}
                              setTurns={setSecondCurveTurns}
                              defaultTurns={[2, 4, 6, 8, 10]}
                              availableCards={cardsInDeck}
                              getSafeImageUrl={getSafeImageUrl}
                            />
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <SimpleBarChart
                    title="費用分佈 / Cost Distribution"
                    labels={[
                      "0",
                      "1",
                      "2",
                      "3",
                      "4",
                      "5",
                      "6",
                      "7",
                      "8",
                      "9",
                      "10+",
                    ]}
                    data={deckAnalysis.costs}
                  />
                  <SimplePieChart
                    title="卡片類別 / Category"
                    labels={["角色卡", "事件卡", "舞台卡"]}
                    data={[
                      deckAnalysis.categories.Character,
                      deckAnalysis.categories.Event,
                      deckAnalysis.categories.Stage,
                    ]}
                  />
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {/* Left Side: Bar Chart (Spans 2 columns) */}
                    <div className="col-span-2">
                      <SimpleBarChart
                        title="反擊值 / Counter"
                        labels={["+0", "+1,000", "+2,000"]}
                        data={[
                          deckAnalysis.counters["0"],
                          deckAnalysis.counters["1000"],
                          deckAnalysis.counters["2000"],
                        ]}
                        color="bg-emerald-500"
                      />
                    </div>

                    {/* Right Side: Stacked Info Boxes (Occupies 1 column) */}
                    <div className="flex flex-col gap-2 sm:gap-3">
                      {/* Box 1: Average Counter */}
                      <div className="flex-1 flex flex-col px-2 py-1.5 bg-blue-500/10 border border-emerald-500/20 rounded-lg min-w-0">
                        <span
                          className="
                          text-xs sm:text-xs lg:text-sm 
                          font-bold text-emerald-400/60 uppercase tracking-tighter leading-none mb-1
                        "
                        >
                          卡牌平均反擊值 /<br /> Card Avg Counter
                        </span>
                        <span className="text-xs sm:text-sm font-semibold truncate mt-auto">
                          +{deckAnalysis.avgCounter.toLocaleString()}
                        </span>
                      </div>

                      {/* Box 1a: 2k Counter */}
                      <div className="flex-1 flex flex-col px-2 py-1.5 bg-blue-500/10 border border-emerald-500/20 rounded-lg min-w-0">
                        <span
                          className="
                          text-xs sm:text-xs lg:text-sm 
                          font-bold text-emerald-400/60 uppercase tracking-tighter leading-none mb-1
                        "
                        >
                          2000反擊值比例 /<br /> 2k Counter %
                        </span>
                        <span className="text-xs sm:text-sm font-semibold truncate mt-auto">
                          {deckAnalysis.twokCounter}%
                        </span>
                      </div>

                      {/* Box 2: Counter Percentage */}
                      <div className="flex-1 flex flex-col px-2 py-1.5 bg-blue-500/10 border border-emerald-500/20 rounded-lg min-w-0">
                        <span
                          className="
                          text-xs sm:text-xs lg:text-sm 
                          font-bold text-emerald-400/60 uppercase tracking-tighter leading-none mb-1
                        "
                        >
                          牌組反擊比例 /<br /> Deck Counter %
                        </span>
                        <span className="text-xs sm:text-sm font-semibold truncate mt-auto">
                          {deckAnalysis.counterQualityScore}%
                        </span>
                      </div>

                      {/* Add this inside your analysis grid or near your stats */}
                      <div className="flex-1 flex flex-col px-2 py-1.5 bg-blue-500/10 border border-emerald-500/20 rounded-lg min-w-0">
                        <span
                          className="
                          text-xs sm:text-xs lg:text-sm 
                          font-bold text-emerald-400/60 uppercase tracking-tighter leading-none mb-1
                        "
                        >
                          防禦 / Blockers
                        </span>
                        <div className="flex items-baseline gap-1">
                          <span className="text-xs font-black text-emerald-500">
                            {deckAnalysis.blockerCount}
                          </span>
                          <span className="text-xs text-slate-500">
                            / {deckAnalysis.totalNonLeader}
                          </span>
                        </div>
                        {/* Visual progress bar */}
                        <div className="w-full h-1 bg-slate-900 rounded-full mt-3 overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all duration-500"
                            style={{
                              width: `${(deckAnalysis.blockerCount / deckAnalysis.totalNonLeader) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-visible">
                  <div className="p-4 border-b border-slate-700 bg-slate-800/30">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                      特徵統計 / Types Statistics
                    </h4>
                  </div>
                  <div className="w-full overflow-visible">
                    <table className="w-full text-sm text-left">
                      <tbody className="divide-y divide-slate-700/50">
                        {/* We map through sortedTypes. 'type' is the name, 'data' is the object {count, cards} */}
                        {deckAnalysis.sortedTypes.map(([type, data], index) => {
                          const isLastFew =
                            index > deckAnalysis.sortedTypes.length - 4;
                          return (
                            <tr
                              key={type}
                              className="hover:bg-slate-700/30 transition-colors cursor-help relative"
                              onMouseEnter={() => setHoveredTrait(type)}
                              onMouseLeave={() => setHoveredTrait(null)}
                            >
                              {/* --- TRAIT NAME COLUMN (Where your provided code lives) --- */}
                              <td className="px-6 py-4 font-bold text-slate-200">
                                <div className="relative">
                                  {type}

                                  {/* HOVER POPOVER */}
                                  {hoveredTrait === type && (
                                    <div
                                      className={`
                                    absolute left-0 z-[100] w-64 
                                    bg-slate-900 border border-slate-700 
                                    rounded-lg shadow-2xl p-3 
                                    animate-in fade-in zoom-in duration-200 
                                    pointer-events-none
                                    ${isLastFew ? "bottom-full mb-2" : "top-full mt-1"}
                                  `}
                                    >
                                      <ul className="space-y-1.5">
                                        {data.cards.map((c, idx) => (
                                          <li
                                            key={idx}
                                            className="flex justify-between items-start text-[11px] gap-2 border-b border-white/5 pb-1 last:border-0"
                                          >
                                            <div className="flex flex-col min-w-0">
                                              <span className="text-[9px] text-slate-500 font-mono leading-none mb-0.5">
                                                {c.id}
                                              </span>
                                              <span className="text-slate-200 truncate leading-tight">
                                                {c.name}
                                              </span>
                                            </div>
                                            <span className="text-blue-400 font-mono font-bold shrink-0">
                                              x{c.count}
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              </td>

                              {/* --- TOTAL QUANTITY COLUMN --- */}
                              <td className="px-6 py-4 text-right font-mono font-bold text-blue-400">
                                {data.count}
                              </td>

                              {/* --- PERCENTAGE COLUMN --- */}
                              <td className="px-6 py-4 text-right">
                                <div className="inline-flex items-center gap-3">
                                  <span className="text-[10px] text-slate-500 font-bold">
                                    {Math.round(
                                      (data.count /
                                        deckAnalysis.totalNonLeader) *
                                        100,
                                    )}
                                    %
                                  </span>
                                  <div className="w-24 h-1.5 bg-slate-950 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-600 rounded-full"
                                      style={{
                                        width: `${(data.count / deckAnalysis.totalNonLeader) * 100}%`,
                                      }}
                                    ></div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="max-w-7xl mx-auto w-full mt-12 py-8 border-t border-slate-800 text-center">
        <p className="text-xs text-slate-500 leading-relaxed">
          All information on this site is copyrighted by ©Eiichiro Oda/Shueisha,
          Toei Animation and Bandai Namco.
        </p>
        <p className="text-[10px] text-slate-600 mt-2 uppercase tracking-widest font-bold">
          One Piece卡表
        </p>
      </footer>

      {selectedCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/95 backdrop-blur-md"
          onClick={() => setSelectedCard(null)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigateCard(-1);
            }}
            className="absolute left-1 md:left-6 z-[70] w-12 h-24 md:w-16 md:h-16 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-r-xl md:rounded-full transition-all border border-white/10 text-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigateCard(1);
            }}
            className="absolute right-1 md:right-6 z-[70] w-12 h-24 md:w-16 md:h-16 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-l-xl md:rounded-full transition-all border border-white/10 text-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>

          <div
            className="bg-slate-800 w-full md:max-w-4xl h-full md:h-auto md:max-h-[90vh] overflow-y-auto rounded-none md:rounded-2xl p-6 md:p-10 flex flex-col md:flex-row gap-8 relative border border-slate-700 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedCard(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-transform hover:scale-110 z-[80]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            <div className="w-full md:w-5/12 flex-shrink-0 flex justify-center">
              <img
                src={getSafeImageUrl(selectedCard)}
                className="rounded-xl shadow-2xl w-full max-w-[320px] md:max-w-none border border-slate-700 object-contain h-auto self-start"
                alt={selectedCard.name}
              />
            </div>
            <div className="w-full md:w-7/12 space-y-3 text-left">
              <div className="flex justify-between items-start gap-">
                <div className="flex-1 min-w-0">
                  {/* Header Row: ID and Color Circles on the same line */}
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-blue-500 font-mono font-bold tracking-widest text-xs leading-none">
                      {selectedCard.id}
                    </span>
                    <div className="flex gap-1.5">
                      {selectedCard.colors?.map((c) => (
                        <span
                          key={c}
                          className="w-2.5 h-2.5 rounded-full border border-white/20 shadow-sm"
                          style={{ backgroundColor: c.toLowerCase() }}
                        ></span>
                      ))}
                    </div>
                  </div>

                  {/* Card Name */}
                  <h2 className="text-2xl md:text-4xl font-black leading-tight text-white break-words">
                    {selectedCard.name}
                  </h2>
                </div>

                {/* Quantity Box - Stays on the far right */}
                <div className="flex flex-col items-end flex-shrink-0">
                  <div className="flex gap-1.5 md:gap-2">
                    <button
                      onClick={() => updateDeckCount(selectedCard, -1)}
                      className="w-9 h-9 md:w-10 md:h-10 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center justify-center font-bold text-xl"
                    >
                      -
                    </button>
                    <div className="w-9 h-9 md:w-10 md:h-10 bg-white text-black rounded-lg flex items-center justify-center font-black text-sm md:text-base">
                      {deckList[selectedCard.id] || 0}
                    </div>
                    <button
                      onClick={() => updateDeckCount(selectedCard, 1)}
                      disabled={
                        (selectedCard.category === "Leader" &&
                          deckList[selectedCard.id] === 1) ||
                        (selectedCard.category !== "Leader" &&
                          getBaseIdCount(selectedCard.id) >= 4)
                      }
                      className={`w-9 h-9 md:w-10 md:h-10 bg-indigo-600 hover:bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-xl disabled:opacity-30 disabled:cursor-not-allowed`}
                    >
                      +
                    </button>
                  </div>
                  {/* <p className="text-[10px] text-slate-500 mt-1 font-bold uppercase tracking-widest">Quantity</p> */}
                </div>
              </div>

              {/* Card Effect and Trigger */}
              <div className="bg-slate-700/50 p-2 rounded-xl border-l-4 border-blue-500">
                {/* <p className="text-[10px] text-slate-400 uppercase font-bold mb-2 tracking-widest">效果說明 / Effect</p> */}
                <div className="text-sm leading-relaxed text-slate-100 whitespace-pre-wrap font-medium">
                  {renderFormattedEffect(selectedCard.effect) || "無效果內容"}
                </div>
              </div>
              {selectedCard.trigger && (
                <div className="bg-yellow-900/20 p-2 mt-0.5 rounded-xl border-l-4 border-yellow-500">
                  {/* <p className="text-[10px] text-yellow-500 uppercase font-bold mb-2 tracking-widest">觸發效果 / Trigger</p> */}
                  <div className="text-sm leading-relaxed text-yellow-100 font-medium whitespace-pre-wrap">
                    {renderFormattedEffect(selectedCard.trigger)}
                  </div>
                </div>
              )}

              <div>
                <div className="flex flex-wrap gap-2">
                  {selectedCard.types?.map((t) => (
                    <span
                      key={t}
                      className="px-3 py-1 bg-blue-900/30 text-blue-300 border border-blue-500/30 rounded-md text-sm font-bold"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Inside your card detail modal or sidebar */}
              <div className="card-info">
                <CardQA currentCardId={selectedCard.id} />
              </div>

              {selectedCard.pack_id && packData[selectedCard.pack_id] && (
                <p className="text-xs text-slate-400 mt-2">
                  收錄於：{packData[selectedCard.pack_id].raw_title}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
