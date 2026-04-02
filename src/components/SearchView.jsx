// src/components/SearchView.jsx
import React from "react";
import CardWrapper from "./CardWrapper";
import QuickController from "./QuickController";
import MarketRibbon from "./MarketRibbon";
import PriceInput from "./PriceInput";
import { getSafeImageUrl } from "../utils/cardHelpers";

const SearchView = ({
  filteredCards,
  setSelectedCard,
  deckList,
  marketList,
  isMarketMode,
  updateDeckCount,
  appMode,
  marketData,
  toggleMarketType,
  updatePrice,
  totalDeckCount,
  searchTerm,
  setSearchTerm,
  filterPackId,
  setFilterPackId,
  sortedPackList,
  hideReprint,
  setHideReprint,
  hidePromo,
  setHidePromo,
  resetFilters,

  // Advanced Search Toggle
  showAdvanced,
  setShowAdvanced,

  // Logic & Types
  typeLogic,
  setTypeLogic,
  filterType1,
  setFilterType1,
  filterType2,
  setFilterType2,
  typeOptions,

  // Categorization
  filterCategory,
  setFilterCategory,
  selectedColors,
  toggleColor,
  selectedRarity,
  setSelectedRarity,

  // Attributes & Keywords
  selectedAttributes,
  setSelectedAttributes,
  selectedKeywords,
  toggleKeyword,
  quickKeywords,
  getKeywordStyle,

  // Blocks & Exclude Mode
  selectedBlocks,
  setSelectedBlocks,
  isExcludeMode,
  setIsExcludeMode,
}) => {
  const activeList = isMarketMode ? marketList : deckList;
  const currentTotal = Object.values(activeList).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* LEFT COLUMN: Sidebar (Search & Filters) */}
      <aside className="w-full lg:w-80 flex-shrink-0">
        {/* 1. max-h-[calc(100vh-2rem)]: Limits height to the screen minus some padding
            2. overflow-y-auto: Allows scrolling ONLY if the content is too tall
            3. scrollbar-hide: Keeps it looking clean (requires a small CSS utility)
        */}
        <div className="sticky top-6 flex flex-col gap-3 max-h-[calc(100vh-3rem)] overflow-y-auto pr-2 scrollbar-hide custom-sidebar-scroll">
          <section className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl backdrop-blur-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-blue-400 text-sm font-black uppercase tracking-widest">
                基本搜尋
              </h3>
              <button
                onClick={resetFilters}
                title="重置搜尋 Reset Filters"
                className="
                  p-1.5
                  bg-red-950/30 hover:bg-red-600 
                  text-red-500 hover:text-white
                  rounded-lg border border-red-900/50 hover:border-red-500
                  transition-all duration-200
                  group active:scale-90
                "
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 640 640"
                  className="w-3.5 h-3.5"
                  fill="currentColor"
                >
                  <path d="M129.9 292.5C143.2 199.5 223.3 128 320 128C373 128 421 149.5 455.8 184.2C456 184.4 456.2 184.6 456.4 184.8L464 192L416.1 192C398.4 192 384.1 206.3 384.1 224C384.1 241.7 398.4 256 416.1 256L544.1 256C561.8 256 576.1 241.7 576.1 224L576.1 96C576.1 78.3 561.8 64 544.1 64C526.4 64 512.1 78.3 512.1 96L512.1 149.4L500.8 138.7C454.5 92.6 390.5 64 320 64C191 64 84.3 159.4 66.6 283.5C64.1 301 76.2 317.2 93.7 319.7C111.2 322.2 127.4 310 129.9 292.6zM573.4 356.5C575.9 339 563.7 322.8 546.3 320.3C528.9 317.8 512.6 330 510.1 347.4C496.8 440.4 416.7 511.9 320 511.9C267 511.9 219 490.4 184.2 455.7C184 455.5 183.8 455.3 183.6 455.1L176 447.9L223.9 447.9C241.6 447.9 255.9 433.6 255.9 415.9C255.9 398.2 241.6 383.9 223.9 383.9L96 384C87.5 384 79.3 387.4 73.3 393.5C67.3 399.6 63.9 407.7 64 416.3L65 543.3C65.1 561 79.6 575.2 97.3 575C115 574.8 129.2 560.4 129 542.7L128.6 491.2L139.3 501.3C185.6 547.4 249.5 576 320 576C449 576 555.7 480.6 573.4 356.5z" />
                </svg>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-widest">
              關鍵字
            </p>
            <input
              type="text"
              placeholder="魯夫, >=5, >6000, +1000, 防禦"
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
            <div className="flex flex-row gap-3">
              {" "}
              {/* Container to hold both buttons */}
              <label className="flex flex-1 items-center gap-2 cursor-pointer p-2 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors">
                <input
                  type="checkbox"
                  checked={hideReprint}
                  onChange={(e) => setHideReprint(e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-500"
                />
                <span className="text-xs font-bold text-slate-300 whitespace-nowrap">
                  隱藏再錄卡
                </span>
              </label>
              <label className="flex flex-1 items-center gap-2 cursor-pointer p-2 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors">
                <input
                  type="checkbox"
                  checked={hidePromo}
                  onChange={(e) => setHidePromo(e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-500"
                />
                <span className="text-xs font-bold text-slate-300 whitespace-nowrap">
                  隱藏異圖卡
                </span>
              </label>
            </div>
          </section>

          <section className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl backdrop-blur-md">
            <h3 className="text-purple-400 text-sm font-black uppercase tracking-widest mb-4">
              進階搜尋
            </h3>
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
                      {/* Header Row: Label + Compact Toggle */}
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-widest">
                          特徵篩選
                        </p>

                        <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700 shadow-inner">
                          <button
                            onClick={() => setTypeLogic("AND")}
                            className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
                              typeLogic === "AND"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-500 hover:text-slate-300"
                            }`}
                          >
                            AND
                          </button>
                          <button
                            onClick={() => setTypeLogic("OR")}
                            className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
                              typeLogic === "OR"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "text-slate-500 hover:text-slate-300"
                            }`}
                          >
                            OR
                          </button>
                        </div>
                      </div>

                      {/* Side-by-Side Dropdowns */}
                      <div className="grid grid-cols-2 gap-3">
                        <select
                          value={filterType1}
                          onChange={(e) => setFilterType1(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm cursor-pointer focus:border-blue-500 outline-none transition-colors"
                        >
                          {typeOptions.map((opt) => (
                            <option key={`t1-${opt}`} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>

                        <select
                          value={filterType2}
                          onChange={(e) => setFilterType2(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm cursor-pointer focus:border-blue-500 outline-none transition-colors"
                        >
                          {typeOptions.map((opt) => (
                            <option key={`t2-${opt}`} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
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
                          "普通 (C)": "bg-blue-600 border-blue-400 text-white", // C
                          "不普通 (UC)":
                            "bg-blue-600 border-blue-400 text-white", // UC
                          "稀有 (R)": "bg-blue-600 border-blue-400 text-white", // R
                          "超級稀有 (SR)":
                            "bg-blue-600 border-blue-400 text-white", // SR (Gold)
                          "絕密稀有 (SEC)":
                            "bg-blue-600 border-blue-400 text-white", // SEC (Purple/Secret)
                          "特殊卡 (SP)":
                            "bg-blue-600 border-blue-400 text-white", // Special (Holofoil look)
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

                    <div className="flex items-center justify-between border-t border-slate-700 pt-4 mt-6">
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
                          {isExcludeMode ? "排除模式 (NOT)" : "包含模式 (HAS)"}
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
                      {["所有", "1", "1 (Legal)", "2", "3", "4"].map(
                        (block) => {
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
                                  // If clicking a specific block, remove '所有' and toggle the selection
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
                                    : block === "1 (Legal)"
                                      ? "bg-emerald-600 border-emerald-400 text-white shadow-[0_0_10px_rgba(52,211,153,0.3)]"
                                      : "bg-blue-600 border-blue-400 text-white"
                                  : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600 hover:border-slate-500"
                              }`}
                            >
                              {block}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
          {/* Extra bottom padding to ensure the last filter isn't cut off */}
          <div className="h-6 shrink-0" />
        </div>
      </aside>

      {/* RIGHT COLUMN: Results Grid */}
      <main className="flex-1 min-w-0">
        {/* Stats Summary Bar - Dynamically updates based on Mode */}
        <div className="flex justify-between items-center mb-2 lg:mb-4 px-3 py-2 bg-slate-900/40 rounded-xl border border-slate-800/50 backdrop-blur-sm shadow-lg">
          <div className="flex items-center gap-2">
            <div
              className={`h-1.5 w-1.5 rounded-full ${isMarketMode ? "bg-amber-500 animate-pulse" : "bg-blue-500"}`}
            ></div>
            <p className="text-[10px] lg:text-xs font-black uppercase tracking-widest text-slate-400">
              {isMarketMode ? "市場清單 Market Mode" : "牌組模式 Deck Mode"}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <p className="text-[10px] lg:text-xs font-bold text-slate-500">
              搜尋結果:{" "}
              <span className="text-white">{filteredCards.length}</span>
            </p>
            <p className="text-[10px] lg:text-xs font-bold text-slate-500">
              {isMarketMode ? "已選數量:" : "牌組進度:"}
              <span
                className={`ml-1 font-black ${
                  !isMarketMode && totalDeckCount === 51
                    ? "text-green-400"
                    : "text-blue-400"
                }`}
              >
                {/* If in Market Mode, we show total count of marketList, else 51-card progress */}
                {isMarketMode
                  ? Object.values(marketList || {}).reduce((a, b) => a + b, 0)
                  : `${totalDeckCount} / 51`}
              </span>
            </p>
          </div>
        </div>

        {/* The Grid - Optimized for MacBook & Mobile */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 md:gap-6">
          {filteredCards.map((card) => {
            // Determine which count to show based on the mode
            const activeCount = isMarketMode
              ? marketList[card.id] || 0
              : deckList[card.id] || 0;

            return (
              <CardWrapper
                key={card.id}
                card={card}
                onClick={() => setSelectedCard(card)}
                badge={
                  appMode === "MARKETPLACE" && (
                    <MarketRibbon
                      cardId={card.id}
                      marketData={marketData}
                      onToggle={toggleMarketType}
                    />
                  )
                }
              >
                {/* BOTTOM AREA: Name + Controller (Stacked to avoid overlap) */}
                <div className="absolute bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-md border-t border-white/10 p-1.5 flex flex-col gap-1 transition-all">
                  {/* A. Card Name & ID - Centered Horizontally */}
                  <div className="flex flex-col items-center justify-center w-full px-1 text-center">
                    {/* Card ID */}
                    <span className="text-[9px] font-mono font-bold text-blue-400 leading-none mb-0.5">
                      {card.id}
                    </span>

                    {/* Card Name */}
                    <span className="text-[10px] font-black text-slate-100 truncate leading-tight w-full">
                      {card.name}
                    </span>
                  </div>

                  {/* B. Controller Row (Buttons or Price Input) */}
                  <div className="flex justify-center w-full">
                    {appMode === "MARKETPLACE" && isMarketMode ? (
                      /* Marketplace Price Input */
                      <PriceInput
                        cardId={card.id}
                        marketData={marketData}
                        onUpdatePrice={updatePrice}
                      />
                    ) : (
                      /* Standard +/- Controller */
                      <QuickController
                        card={card}
                        count={activeCount}
                        onAdd={(c) => updateDeckCount(c, 1)}
                        onRemove={(c) => updateDeckCount(c, -1)}
                      />
                    )}
                  </div>
                </div>
              </CardWrapper>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export default SearchView;
