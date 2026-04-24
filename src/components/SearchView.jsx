// src/components/SearchView.jsx
import React from "react";
import { useTranslation } from "react-i18next";
import "../i18n/config";

import CardWrapper from "./CardWrapper";
import QuickController from "./QuickController";
import MarketRibbon from "./MarketRibbon";
import PriceInput from "./PriceInput";
import { getSafeImageUrl } from "../utils/cardHelpers";
import sortedTypes from "../data/sorted_types.json";

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

  setSelectedColors,
  colorMap,
  categoryMap,
  rarityMap,
  toggleRarity,
  attributeMap,
  toggleAttribute,

  selectedCosts,
  setSelectedCosts,
}) => {
  const activeList = isMarketMode ? marketList : deckList;
  const currentTotal = Object.values(activeList).reduce((a, b) => a + b, 0);
  const { t, i18n } = useTranslation();
  const langCode = i18n.language.split("-")[0];

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* LEFT COLUMN: Sidebar (Search & Filters) */}
      <aside className="w-full lg:w-80 flex-shrink-0">
        {/* 1. max-h-[calc(100vh-2rem)]: Limits height to the screen minus some padding
            2. overflow-y-auto: Allows scrolling ONLY if the content is too tall
            3. scrollbar-hide: Keeps it looking clean (requires a small CSS utility)
        */}
        <div className="sticky top-6 flex flex-col gap-2 max-h-[calc(100vh-3rem)] overflow-y-auto pr-2 scrollbar-hide custom-sidebar-scroll">
          <section className="bg-slate-900/50 border border-slate-800 pt-3 px-5 pb-5 rounded-2xl backdrop-blur-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-blue-400 text-sm font-black uppercase tracking-widest">
                {t("basic_search", "基本搜尋")}
              </h3>
              <button
                onClick={resetFilters}
                title={t("reset_filters", "重置搜尋 Reset Filters")}
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
              {t("keywords", "關鍵字")}
            </p>
            <input
              type="text"
              placeholder={t(
                "search_placeholder",
                "魯夫, >=5, >6000, +1000, 防禦",
              )}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm mb-4 focus:border-blue-500 outline-none transition-colors"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {/* COLORS FILTER */}
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-widest">
              {t("colors_label", "顏色")}
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setSelectedColors([])}
                className={`px-2 py-1 rounded text-[12px] font-bold border transition-all active:scale-95 ${
                  selectedColors.length === 0
                    ? "bg-indigo-600 border-indigo-400 text-white shadow-[0_0_10px_rgba(79,70,229,0.4)]"
                    : "bg-indigo-900/20 border-indigo-900/40 text-indigo-400/60 hover:bg-indigo-600/30"
                }`}
              >
                {t("all", "所有")}
              </button>

              {Object.entries(colorMap).map(([id, label]) => {
                const isSelected = selectedColors.includes(id);

                // Style Mapping: [Inactive Dull Style] vs [Active Vivid Style]
                const colorStyles = {
                  red: isSelected
                    ? "bg-red-600 border-red-400 text-white shadow-[0_0_10px_rgba(220,38,38,0.4)]"
                    : "bg-red-950/20 border-red-900/30 text-red-500/50 hover:bg-red-900/40",

                  green: isSelected
                    ? "bg-emerald-600 border-emerald-400 text-white shadow-[0_0_10px_rgba(16,185,129,0.4)]"
                    : "bg-emerald-950/20 border-emerald-900/30 text-emerald-500/50 hover:bg-emerald-900/40",

                  blue: isSelected
                    ? "bg-blue-600 border-blue-400 text-white shadow-[0_0_10px_rgba(37,99,235,0.4)]"
                    : "bg-blue-950/20 border-blue-900/30 text-blue-500/50 hover:bg-blue-900/40",

                  purple: isSelected
                    ? "bg-purple-600 border-purple-400 text-white shadow-[0_0_10px_rgba(147,51,234,0.4)]"
                    : "bg-purple-950/20 border-purple-900/30 text-purple-500/50 hover:bg-purple-900/40",

                  black: isSelected
                    ? "bg-slate-900 border-slate-500 text-white shadow-[0_0_10px_rgba(255,255,255,0.1)]"
                    : "bg-slate-950/40 border-slate-800 text-slate-600 hover:bg-slate-900/60",

                  yellow: isSelected
                    ? "bg-yellow-500 border-yellow-300 text-black shadow-[0_0_10px_rgba(234,179,8,0.4)]"
                    : "bg-yellow-900/10 border-yellow-900/30 text-yellow-600/50 hover:bg-yellow-900/30",

                  multi: isSelected
                    ? "bg-gradient-to-br from-red-500 via-blue-500 to-yellow-500 border-white text-white shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                    : "bg-slate-800/40 border-slate-700 text-slate-500 hover:bg-slate-700/60",
                };

                return (
                  <button
                    key={id}
                    onClick={() => toggleColor(id)}
                    className={`px-2 py-1 rounded text-[13px] font-bold border transition-all duration-300 active:scale-90 ${
                      colorStyles[id] || "bg-slate-700 text-slate-400"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {/* COST FILTER */}
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-widest">
              {t("cost_label", "費用 (Cost)")}
            </p>
            <div className="flex flex-wrap gap-2 mb-6">
              {/* All Button */}
              {/* All Button */}
              <button
                onClick={() => setSelectedCosts([])}
                className={`w-9 h-9 flex items-center justify-center rounded-full text-[12px] font-bold border transition-all active:scale-90 ${
                  selectedCosts.length === 0
                    ? "bg-indigo-600 border-indigo-400 text-white shadow-[0_0_10px_rgba(79,70,229,0.4)]"
                    : "bg-indigo-900/20 border-indigo-900/40 text-indigo-400/60 hover:bg-indigo-600/30"
                }`}
              >
                {t("all", "All")}
              </button>

              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                const isSelected = selectedCosts.includes(num);
                return (
                  <button
                    key={num}
                    onClick={() => {
                      if (selectedCosts.includes(num)) {
                        setSelectedCosts(
                          selectedCosts.filter((c) => c !== num),
                        );
                      } else {
                        setSelectedCosts([...selectedCosts, num]);
                      }
                    }}
                    className={`w-9 h-9 flex items-center justify-center rounded-full text-[13px] font-bold border transition-all duration-300 active:scale-90 ${
                      isSelected
                        ? "bg-blue-600 border-blue-400 text-white shadow-[0_0_10px_rgba(37,99,235,0.4)]"
                        : "bg-slate-800/40 border-slate-700 text-slate-500/50 hover:bg-slate-700 hover:text-slate-300"
                    }`}
                  >
                    {num}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-widest">
              {t("expansion_packs", "收錄卡包")}
            </p>
            <select
              // Force string comparison: "554115" === "554115"
              value={String(filterPackId)}
              onChange={(e) => setFilterPackId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm cursor-pointer mb-6 focus:border-blue-500 outline-none text-white"
            >
              <option value="all">{t("all_packs", "所有卡包")}</option>

              {sortedPackList.map((pack) => {
                // If the title is just the code, show it.
                // Otherwise, show the Title first, then the Code in parentheses.
                const displayLabel =
                  pack.code === pack.title ? pack.code : `${pack.title}`;

                return (
                  <option key={pack.id} value={String(pack.id)}>
                    {displayLabel}
                  </option>
                );
              })}
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
                  {t("hide_reprint", "隱藏再錄卡")}
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
                  {t("hide_alt_art", "隱藏異圖卡")}
                </span>
              </label>
            </div>
          </section>

          <section className="bg-slate-900/50 border border-slate-800 p-5 rounded-2xl backdrop-blur-md">
            <h3 className="text-purple-400 text-sm font-black uppercase tracking-widest mb-4">
              {t("advanced_search", "進階搜尋")}
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
                  {showAdvanced
                    ? t("hide_advanced", "隱藏進階搜尋")
                    : t("show_advanced", "進階搜尋")}
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
                          {t("type_filter", "特徵篩選")}
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
                        {/* Dropdown 1 */}
                        <select
                          value={filterType1}
                          onChange={(e) => setFilterType1(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm cursor-pointer focus:border-blue-500 outline-none transition-colors text-white"
                        >
                          <option value="all">{t("all", "所有")}</option>
                          {sortedTypes.map((type) => (
                            <option key={`t1-${type}`} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>

                        {/* Dropdown 2 */}
                        <select
                          value={filterType2}
                          onChange={(e) => setFilterType2(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm cursor-pointer focus:border-blue-500 outline-none transition-colors text-white"
                        >
                          <option value="all">{t("all", "所有")}</option>
                          {sortedTypes.map((type) => (
                            <option key={`t2-${type}`} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                    {/* 2. CATEGORY */}
                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest">
                      {t("card_category", "卡牌種類")}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setFilterCategory("all")}
                        className={`px-3 py-1 rounded text-[12px] font-bold border transition-all ${
                          filterCategory === "all"
                            ? "bg-indigo-600 border-indigo-400 text-white"
                            : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600"
                        }`}
                      >
                        {t("all", "所有")}
                      </button>
                      {Object.entries(categoryMap).map(([id, label]) => (
                        <button
                          key={id}
                          onClick={() => setFilterCategory(id)}
                          className={`px-3 py-1 rounded text-[12px] font-bold border transition-all active:scale-95 ${
                            filterCategory === id
                              ? "bg-blue-600 border-blue-400 text-white"
                              : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* 3. RARITY */}
                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest mt-6 border-t border-slate-700 pt-4">
                      {t("rarity", "稀有度 (多選)")}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setSelectedRarity([])}
                        className={`px-2 py-1 rounded text-[12px] font-bold border transition-all ${
                          selectedRarity.length === 0
                            ? "bg-indigo-600 border-indigo-400 text-white"
                            : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600"
                        }`}
                      >
                        {t("all", "所有")}
                      </button>
                      {Object.entries(rarityMap).map(([id, label]) => (
                        <button
                          key={id}
                          onClick={() => toggleRarity(id)}
                          className={`px-2 py-1 rounded text-[12px] font-bold border transition-all active:scale-95 ${
                            selectedRarity.includes(id)
                              ? "bg-blue-600 border-blue-400 text-white"
                              : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* 4. KEYWORDS */}
                    <div className="flex items-center justify-between border-t border-slate-700 pt-4 mt-6">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                        {t("keyword_filter", "關鍵字過濾")}
                      </span>
                      <button
                        onClick={() => setIsExcludeMode(!isExcludeMode)}
                        className={`flex items-center gap-2 px-3 py-1 my-1 rounded-full border transition-all text-[11px] font-bold ${
                          isExcludeMode
                            ? "bg-red-500/20 border-red-500/50 text-red-400"
                            : "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${isExcludeMode ? "bg-red-500 animate-pulse" : "bg-emerald-500"}`}
                        ></span>
                        {isExcludeMode
                          ? t("exclude_mode", "排除模式")
                          : t("include_mode", "包含模式")}
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {quickKeywords.map((k) => {
                        const isSelected = selectedKeywords.includes(k);
                        const baseStyle = getKeywordStyle(k);

                        return (
                          <button
                            key={k}
                            onClick={() => toggleKeyword(k)}
                            className={`text-[13px] transition-all border shadow-sm rounded ${
                              isSelected
                                ? `${baseStyle} border-white/40 scale-105`
                                : "bg-slate-700/50 border-slate-600 text-slate-400 hover:border-slate-500 px-2 py-1"
                            }`}
                            style={
                              isSelected &&
                              baseStyle &&
                              baseStyle.includes("clip-path")
                                ? {
                                    // Extract the value from a string like "bg-orange [clip-path:polygon(...)]"
                                    clipPath: baseStyle
                                      .split("clip-path:")[1]
                                      ?.split("]")[0],
                                  }
                                : {}
                            }
                          >
                            {/* Remove the brackets for a cleaner button look */}
                            {k.replace(/【|】|\[|\]/g, "")}
                          </button>
                        );
                      })}
                    </div>

                    {/* 5. ATTRIBUTES */}
                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 mt-6 border-t border-slate-700 pt-4 tracking-widest">
                      {t("attributes_label", "屬性 / Attributes")}
                    </h3>

                    <div className="flex flex-wrap gap-2">
                      {/* All Button */}
                      <button
                        onClick={() => setSelectedAttributes([])}
                        className={`px-3 py-1 rounded text-[12px] font-bold border transition-all ${
                          selectedAttributes.length === 0
                            ? "bg-indigo-600 border-indigo-400 text-white"
                            : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600"
                        }`}
                      >
                        {t("all", "所有")}
                      </button>

                      {Object.entries(attributeMap).map(([id, label]) => {
                        const isSelected = selectedAttributes.includes(id);

                        // Style mapping matching the physical card icons
                        const attrStyles = {
                          strike:
                            "bg-yellow-500 border-yellow-300 text-white shadow-[0_0_8px_rgba(234,179,8,0.3)]",
                          slash:
                            "bg-blue-500 border-blue-300 text-white shadow-[0_0_8px_rgba(59,130,246,0.3)]",
                          special:
                            "bg-purple-600 border-purple-400 text-white shadow-[0_0_8px_rgba(147,51,234,0.3)]",
                          ranged:
                            "bg-red-600 border-red-400 text-white shadow-[0_0_8px_rgba(220,38,38,0.3)]",
                          wisdom:
                            "bg-emerald-600 border-emerald-400 text-white shadow-[0_0_8px_rgba(16,185,129,0.3)]",
                        };

                        return (
                          <button
                            key={id}
                            onClick={() => toggleAttribute(id)}
                            className={`px-3 py-1 rounded text-[12px] font-bold border transition-all active:scale-95 ${
                              isSelected
                                ? attrStyles[id] ||
                                  "bg-blue-600 border-blue-400 text-white"
                                : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600 hover:border-slate-500"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 mt-6 border-t border-slate-700 pt-4 tracking-widest">
                      {t("block_icons", "擴張記號 / Block")}
                    </h3>

                    <div className="flex flex-wrap gap-2">
                      {/* Standard Regulation Preset Button */}
                      <button
                        onClick={() =>
                          setSelectedBlocks(["1_legal", "2", "3", "4", "5"])
                        }
                        className={`px-2 py-1 rounded text-[12px] font-bold border transition-all active:scale-95 ${
                          selectedBlocks.length === 5 &&
                          ["1_legal", "2", "3", "4", "5"].every((b) =>
                            selectedBlocks.includes(b),
                          )
                            ? "bg-amber-600 border-amber-400 text-white shadow-[0_0_10px_rgba(245,158,11,0.3)]"
                            : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600"
                        }`}
                      >
                        {t("standard_reg", "標準賽制")}
                      </button>

                      {["all", "1", "1_legal", "2", "3", "4", "5"].map(
                        (blockKey) => {
                          const labels = {
                            all: t("all", "所有"),
                            1: "1",
                            "1_legal": "1 (視為4）",
                            2: "2",
                            3: "3",
                            4: "4",
                            5: "5",
                          };

                          const isSelected =
                            (blockKey === "all" &&
                              selectedBlocks.length === 0) ||
                            selectedBlocks.includes(blockKey);

                          return (
                            <button
                              key={blockKey}
                              onClick={() => {
                                if (blockKey === "all") {
                                  setSelectedBlocks([]);
                                } else {
                                  if (selectedBlocks.includes(blockKey)) {
                                    setSelectedBlocks(
                                      selectedBlocks.filter(
                                        (item) => item !== blockKey,
                                      ),
                                    );
                                  } else {
                                    // Remove 'all' if selecting a specific block
                                    setSelectedBlocks([
                                      ...selectedBlocks.filter(
                                        (b) => b !== "all",
                                      ),
                                      blockKey,
                                    ]);
                                  }
                                }
                              }}
                              className={`px-2 py-1 rounded text-[12px] font-bold border transition-all active:scale-95 min-w-[36px] ${
                                isSelected
                                  ? blockKey === "all"
                                    ? "bg-indigo-600 border-indigo-400 text-white"
                                    : "bg-blue-600 border-blue-400 text-white"
                                  : "bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600 hover:border-slate-500"
                              }`}
                            >
                              {labels[blockKey]}
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
              {t("search_results", "搜尋結果 / Results")}:{" "}
              <span className="text-white">{filteredCards.length}</span>
            </p>
            <p className="text-[10px] lg:text-xs font-bold text-slate-500">
              {isMarketMode
                ? t("selected_qty", "已選數量 / Selected:")
                : t("deck_progress", "牌組進度 / Progress:")}
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
            const activeCount = isMarketMode
              ? marketList[card.id] || 0
              : deckList[card.id] || 0;

            return (
              <CardWrapper
                key={card.id}
                card={card}
                isCompact={true} // Add this to match your list style
                isMarketMode={isMarketMode} // Pass this so it knows when to hide names for export
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
                {/* ONLY pass the action UI here. CardWrapper already handles the ID and Name */}
                <div className="w-full flex justify-center pb-1">
                  {appMode === "MARKETPLACE" && isMarketMode ? (
                    <PriceInput
                      cardId={card.id}
                      marketData={marketData}
                      onUpdatePrice={updatePrice}
                    />
                  ) : (
                    <QuickController
                      card={card}
                      count={activeCount}
                      onAdd={(c) => updateDeckCount(c, 1)}
                      onRemove={(c) => updateDeckCount(c, -1)}
                    />
                  )}
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
