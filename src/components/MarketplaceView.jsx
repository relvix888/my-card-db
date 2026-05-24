import React, { useRef } from "react";
import html2canvas from "html2canvas";

import CardWrapper from "./CardWrapper";
import MarketRibbon from "./MarketRibbon";
import LeaderBanner from "./LeaderBanner";
import QuickController from "./QuickController";
import { BLOCK_1_EXCEPTIONS } from "../data/rotation";
import { BANNED_LIST } from "../data/rotation";
import { RESTRICTED_PAIRS } from "../data/rotation";
import { useTranslation } from "react-i18next";
import "../i18n/config";

const MarketplaceView = ({
  orderedDeck,
  setSelectedCard,
  marketData,
  toggleMarketType,
  updatePrice,
  selectedLeader,
  totalDeckCount,
  setDeckList,
  generateMarketShareUrl,
  deckValuation,
  bulkUpdateRarity,
  deckList,
  deckTableData,
  setIsMarketMode,
  isMarketMode,
  legalityWarning,
  dataIntegrityWarning,
  marketList,
  setMarketList,
  updateDeckCount, // Add this if you added the +/- buttons
  cards,
  copySimFormat, // Add this for the "Copy Sim Format" button
}) => {
  const { t, i18n } = useTranslation();
  const langCode = i18n.language.split("-")[0];
  // 1. SAFE DATA FALLBACK (Prevents the 'undefined' crash in all sub-components)
  const integrity = React.useMemo(
    () =>
      dataIntegrityWarning || {
        hasIssue: false,
        missingData: [],
        missingPrices: [],
      },
    [dataIntegrityWarning],
  );
  const marketCaptureRef = useRef(null);

  const handleShareImage = async () => {
    if (!marketCaptureRef.current) return;

    // 1. Get ALL elements we want to hide
    const exportHeader = marketCaptureRef.current.querySelector(
      ".export-only-header",
    );
    const names =
      marketCaptureRef.current.querySelectorAll(".export-hide-name");
    const uiElements =
      marketCaptureRef.current.querySelectorAll(".export-hide-ui");
    const infoAreas =
      marketCaptureRef.current.querySelectorAll(".bg-slate-900\\/80");
    const exportTexts =
      marketCaptureRef.current.querySelectorAll(".export-only-text");

    // 2. APPLY HIDE
    if (exportHeader) exportHeader.classList.remove("hidden");

    names.forEach((el) => (el.style.display = "none")); // Kill the name
    uiElements.forEach((el) => (el.style.display = "none")); // Kill the buttons/inputs

    exportTexts.forEach((el) => {
      el.classList.remove("hidden"); // Show the Price badge
      el.classList.add("block");
    });

    // Shrink the dark box container to remove the "ghost" gap
    infoAreas.forEach((el) => {
      el.style.height = "30px"; // Only enough space for the ID
    });

    try {
      const canvas = await html2canvas(marketCaptureRef.current, {
        useCORS: true,
        scale: 3,
        backgroundColor: "#020617",
        windowWidth: 480,
      });

      const link = document.createElement("a");
      link.download = `market-list.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      console.error("Capture failed:", err);
    } finally {
      // 3. RESTORE EVERYTHING
      if (exportHeader) exportHeader.classList.add("hidden");
      names.forEach((el) => (el.style.display = ""));
      uiElements.forEach((el) => (el.style.display = ""));
      infoAreas.forEach((el) => (el.style.height = ""));
      exportTexts.forEach((el) => {
        el.classList.add("hidden");
        el.classList.remove("block");
      });
    }
  };

  const displayCards = React.useMemo(() => {
    const activeList = isMarketMode ? marketList : deckList;

    return (
      Object.entries(activeList || {})
        .map(([id, count]) => {
          const baseId = id.split("_")[0];
          const cardData = (cards || []).find((c) => c.id === baseId);

          return {
            displayId: id,
            card: cardData,
            count,
          };
        })
        .filter((item) => item.card)
        // --- ADD THIS SORT LOGIC ---
        .sort((a, b) => {
          // 1. Check if either card is a Leader
          const isALeader = a.card.category === "Leader";
          const isBLeader = b.card.category === "Leader";

          // 2. If A is a leader and B isn't, A comes first (-1)
          if (isALeader && !isBLeader) return -1;
          // 3. If B is a leader and A isn't, B comes first (1)
          if (!isALeader && isBLeader) return 1;

          // 4. Otherwise, maintain existing order (or sort by ID)
          return 0;
        })
    );
  }, [isMarketMode, marketList, deckList, cards]);

  const PriceSummaryCard = () => (
    <div className="bg-slate-800/50 border border-blue-500/30 rounded-xl p-3 backdrop-blur-sm shadow-xl">
      <div className="flex flex-col gap-3">
        {/* Header & Total */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col min-w-0">
            <h2 className="text-slate-500 text-[10px] font-black uppercase tracking-widest leading-none mb-1 truncate">
              {isMarketMode ? "單卡總值 Valuation" : "牌組總值 Valuation"}
            </h2>
            {/* <span className="text-slate-500 font-medium italic text-[9px] leading-none">
              ≈ ¥{deckValuation.totalJPY.toLocaleString()} JPY
            </span> */}
          </div>

          {/* Right Side: Price + Clear Button */}
          <div className="flex items-center gap-2 ml-auto">
            <div className="text-right">
              <span className="text-xl font-black text-white tracking-tight leading-none whitespace-nowrap">
                HK$ {deckValuation.totalHKD.toLocaleString()}
              </span>
            </div>

            {/* Clear Basket Button - Only in Single (Market) Mode */}
            {isMarketMode && Object.keys(marketList || {}).length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm("確定要清空單卡清單嗎？")) {
                    setMarketList({});
                  }
                }}
                className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-500 transition-all active:scale-90 flex-shrink-0"
                title="清空清單 Clear Basket"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4"
                >
                  <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Stats & Actions Row - ONLY SHOW IN DECK MODE */}
        {!isMarketMode && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-700/50">
            {/* Action 1: Max Rarity */}
            <button
              onClick={() => bulkUpdateRarity("MAX")}
              className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/50 text-amber-500 py-1.5 rounded-lg text-xs font-black uppercase transition-all active:scale-95"
            >
              ✨ {t("max_rarity", "我玩異畫 / MAX PARALLEL")}
            </button>

            {/* Action 2: Basic Rarity */}
            <button
              onClick={() => bulkUpdateRarity("BASIC")}
              className="bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600 text-slate-400 py-1.5 rounded-lg text-xs font-black uppercase transition-all active:scale-95"
            >
              ↩️ {t("basic_rarity", "普畫算數 / BASIC")}
            </button>
            {/* Stat 1: Cards */}
            <div className="flex items-center justify-center gap-2 px-2 py-1.5 bg-slate-900/80 rounded-lg border border-slate-700/50">
              <span className="text-[8px] text-slate-500 font-bold uppercase">
                {t("card_count", "卡數 / CARDS")}
              </span>
              <span className="font-bold text-blue-400 text-xs">
                {Object.values(deckList || {}).reduce((a, b) => a + b, 0)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="w-full pb-20 px-0 lg:px-4">
      {/* 1. MOBILE ONLY: Summary at top */}
      <div className="block lg:hidden mb-6">
        <PriceSummaryCard />
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* --- LEFT SIDEBAR (Desktop Only) --- */}
        <aside className="hidden lg:flex w-80 flex-shrink-0 sticky top-6 flex-col gap-6">
          <PriceSummaryCard />

          {/* Detailed Table (Desktop) */}
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
            <div className="scrollbar-hide">
              <table className="w-full text-left border-collapse">
                {/* 1. Table Header: Define 4 Clear Columns */}
                <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-700">
                  <tr className="text-slate-400 text-[9px] uppercase tracking-widest">
                    <th className="px-3 py-3 font-bold">{t("market_card_col")}</th>
                    <th className="px-3 py-3 font-bold text-right">{t("market_unit_price")}</th>
                    <th className="px-3 py-3 font-bold text-center">{t("market_qty")}</th>
                    <th className="px-3 py-3 font-bold text-right">{t("market_total")}</th>
                  </tr>
                </thead>

                {/* 2. Table Body: 4-Column Row */}
                <tbody className="divide-y divide-slate-700/50">
                  {(deckTableData || []).map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-blue-500/5 transition-colors group border-b border-slate-800/50 last:border-0"
                    >
                      {/* Col 1: ID & Name */}
                      <td className="px-3 py-3">
                        <div className="flex flex-col min-w-0">
                          <span className="text-[9px] font-mono text-blue-400 leading-none mb-1">
                            {item.id}
                          </span>
                          <span className="text-[11px] font-medium text-slate-200 truncate max-w-[100px]">
                            {item.name}
                          </span>
                        </div>
                      </td>

                      {/* Col 2: Unit Price */}
                      <td className="px-3 py-3 text-[11px] text-right font-mono text-slate-400">
                        {item.unitPrice === 0
                          ? "--"
                          : `$${item.unitPrice.toLocaleString()}`}
                      </td>

                      {/* Col 3: Quantity */}
                      <td className="px-3 py-3 text-[11px] text-center font-bold text-amber-500 font-mono">
                        x{item.quantity}
                      </td>

                      {/* Col 4: Total Price for this Card */}
                      <td className="px-3 py-3 text-[11px] text-right font-bold text-white whitespace-nowrap font-mono">
                        {item.totalPrice === 0
                          ? "--"
                          : `$${item.totalPrice.toLocaleString()}`}
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* 3. Sticky Grand Total Footer: Spanning across columns */}
                <tfoot className="sticky bottom-0 z-10 bg-slate-900 border-t-2 border-blue-500/50 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
                  <tr className="bg-slate-900">
                    {" "}
                    {/* Use a solid bg here so rows don't bleed through */}
                    <td colSpan="2" className="px-3 py-4">
                      <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">
                        {isMarketMode ? t("market_bulk_total") : t("market_grand_total")}
                      </span>
                    </td>
                    <td colSpan="2" className="px-3 py-4 text-right">
                      <div className="flex flex-col items-end">
                        <span className="text-sm font-black text-white">
                          HK$ {deckValuation.totalHKD.toLocaleString()}
                        </span>
                        <span className="text-[9px] text-slate-500 italic">
                          ≈ ¥{deckValuation.totalJPY.toLocaleString()} JPY
                        </span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <button
            onClick={generateMarketShareUrl}
            className="px-6 py-2 rounded-xl flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/40 group active:scale-95 text-white font-bold"
            title={t("share_price")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 640 640"
              className="w-5 h-5 text-white transition-transform group-hover:rotate-12"
              fill="currentColor"
            >
              <path d="M448 256c-10.6 0-20.9 1.9-30.4 5.4L214.7 150.2c.2-2 .3-4.1 .3-6.2c0-35.3-28.7-64-64-64s-64 28.7-64 64s28.7 64 64 64c10.6 0 20.9-1.9 30.4-5.4L385.3 313.8c-.2 2-.3 4.1-.3 6.2s.1 4.2 .3 6.2L181.3 430.6c-9.5-3.5-19.8-5.4-30.4-5.4c-35.3 0-64 28.7-64 64s28.7 64 64 64s64-28.7 64-64c0-2.1-.1-4.2-.3-6.2L417.6 383.4c9.5 3.5 19.8 5.4 30.4 5.4c35.3 0 64-28.7 64-64s-28.7-64-64-64z" />
            </svg>
            <span className="font-bold text-xs tracking-wide text-white whitespace-nowrap">
              {t("share_price")}
            </span>
          </button>
          <button
            onClick={copySimFormat}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg transition-all active:scale-95 group"
            title="Copy for OPTCGSim / Joel's Bike"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 text-emerald-400 group-hover:rotate-12 transition-transform"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="import ClipboardIcon from your library or use this path: M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <span className="text-xs font-bold text-slate-200 uppercase tracking-tight">
              {t("copy_sim", "Sim 格式")}
            </span>
          </button>
          {/* 
          <button
            onClick={handleShareImage}
            className="px-4 py-2 rounded-lg flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg transition-all active:scale-95"
            title="下載價格圖片 (PNG)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002-2z"
              />
            </svg>
            下載圖片
          </button>
          */}
        </aside>

        {/* --- MAIN GRID SECTION --- */}
        <main className="flex-1 min-w-0 space-y-6 w-full">
          {/* MOVE THE INTEGRITY BANNER HERE */}
          {integrity.hasIssue && (
            <div className="overflow-hidden bg-slate-900 border border-amber-500/30 rounded-2xl shadow-xl animate-in fade-in slide-in-from-top-2">
              <div className="bg-amber-600 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-black">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-4 h-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    Price Validation / 價格檢查
                  </span>
                </div>
              </div>

              <div className="p-4 space-y-3">
                {/* Section 1: Unknown Cards */}
                {integrity.missingData.length > 0 && (
                  <div>
                    <p className="text-amber-500 text-[11px] font-bold uppercase mb-1">
                      {t("card_not_found")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {integrity.missingData.map((id) => (
                        <span
                          key={id}
                          className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/40 rounded text-[9px] font-mono text-amber-500"
                        >
                          {id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section 2: Missing Prices */}
                {integrity.missingPrices.length > 0 && (
                  <div>
                    <p className="text-slate-400 text-[11px] font-bold uppercase mb-1">
                      ⚠️ 沒有價格:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {integrity.missingPrices.slice(0, 10).map((id) => (
                        <span
                          key={id}
                          className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-[9px] font-mono text-slate-500"
                        >
                          {id}
                        </span>
                      ))}
                      {integrity.missingPrices.length > 10 && (
                        <span className="text-[9px] text-slate-600 self-center">
                          ...及其他
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 1. Only show LeaderBanner if NOT in Market Mode */}
          {!isMarketMode && (
            <LeaderBanner
              selectedLeader={selectedLeader}
              totalDeckCount={totalDeckCount}
              onClearDeck={() => setDeckList({})}
            />
          )}

          {/* 2. Optional: Add a simple title for Bulk Mode instead */}
          {isMarketMode && (
            <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 p-4 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <h2 className="text-sm font-black uppercase tracking-widest text-white">
                  單卡價錢
                </h2>
              </div>
            </div>
          )}
          {/* --- 1. The Wrapper (Capture Area) --- */}
          <div
            id="market-capture-area"
            ref={marketCaptureRef}
            className="p-4 bg-slate-950 rounded-2xl"
          >
            {/* --- 2. The Export-Only Logo (Visible only in PNG) --- */}
            <div className="hidden export-only-header mb-8 flex items-center justify-between gap-4 border-b border-slate-800 pb-6">
              <div className="flex items-center gap-4">
                <h1 className="flex-shrink-0">
                  <img
                    src="/logo512.png"
                    alt="齊齊砌"
                    className="h-20 w-auto object-contain"
                  />
                </h1>
                <div>
                  <h3 className="text-xl md:text-2xl font-black text-white italic tracking-tighter">
                    CHEI CHEI <span className="text-blue-500">CHEI</span>
                  </h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                    OPCG Marketplace - 市場清單
                  </p>
                </div>
              </div>
              <div className="text-right text-[11px] text-slate-600 font-mono">
                {new Date().toLocaleDateString("zh-HK")}
              </div>
            </div>

            {/* --- 3. Your Existing Conditional Logic --- */}
            {displayCards.length > 0 ? (
              <div className="grid grid-cols-5 sm:grid-cols-6 gap-x-1 md:gap-x-2 gap-y-1">
                {displayCards.map(({ card, count, displayId }) => {
                  // Determine if this specific card is the one missing from the DB
                  const isMissing = integrity.missingData.includes(displayId);

                  // Use a fallback for the card object if data is missing
                  const safeCard = card || {
                    id: displayId,
                    name: "Unknown Card",
                  };

                  return (
                    <CardWrapper
                      key={displayId}
                      card={{ ...card, id: displayId }}
                      isCompact={true}
                      isMarketMode={isMarketMode} // <-- Pass the state down here
                      onClick={() =>
                        setSelectedCard({ ...card, id: displayId })
                      }
                      badge={
                        <>
                          <MarketRibbon
                            cardId={displayId}
                            marketData={marketData}
                            onToggle={toggleMarketType}
                          />

                          {/* 1. PRICE INPUT (UI) & PRICE BADGE (PNG) STACK */}
                          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] z-40">
                            {/* TEXTBOX: Only visible in Web UI */}
                            <div className="export-hide-ui">
                              <textarea
                                placeholder="Price"
                                value={marketData[displayId]?.price || ""}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  updatePrice(displayId, e.target.value)
                                }
                                /* If the price string contains a newline, use 2 rows, otherwise 1 */
                                rows={
                                  (marketData[displayId]?.price || "").includes(
                                    "\n",
                                  )
                                    ? 2
                                    : 1
                                }
                                className="w-full bg-slate-900/90 border border-amber-500/50 rounded text-center text-[10px] py-0.5 px-1 text-white font-mono outline-none shadow-xl resize-none block backdrop-blur-sm transition-all"
                                onKeyDown={(e) => {
                                  // Optional: Prevent adding more than one enter if you only want 2 rows max
                                  if (
                                    e.key === "Enter" &&
                                    (
                                      marketData[displayId]?.price || ""
                                    ).includes("\n")
                                  ) {
                                    e.preventDefault();
                                  }
                                }}
                              />
                            </div>

                            {/* PRICE TEXT: Only visible in PNG Export */}
                            <div className="hidden export-only-text bg-blue-600 text-white font-black text-[10px] py-1 rounded shadow-lg border border-blue-400 text-center">
                              ${marketData[displayId]?.price || "—"}
                            </div>
                          </div>

                          {isMissing && (
                            <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center z-30 border-2 border-dashed border-amber-500/50">
                              <span className="text-[10px] font-black text-amber-500 uppercase">
                                No Data
                              </span>
                            </div>
                          )}

                          {/* 2. THE COUNTER (Yellow Circle) */}
                          {count > 0 && (
                            <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 z-20">
                              <div className="bg-amber-500 text-black font-black font-mono text-[10px] px-2 py-0.5 rounded-full shadow-lg border border-amber-300/50">
                                {count}
                              </div>
                            </div>
                          )}
                        </>
                      }
                    >
                      {/* The Bottom Info Area now only contains the ID/Name and Controller */}
                      <div className="flex flex-col w-full px-1 pb-1 gap-1">
                        {/* Card Name/ID are handled inside CardWrapper logic automatically */}

                        {/* Controller (Hidden in PNG) */}
                        <div className="flex justify-center w-full export-hide-ui">
                          <QuickController
                            card={{ ...card, id: displayId }}
                            count={count}
                            onAdd={(c) => updateDeckCount(c, 1)}
                            onRemove={(c) => updateDeckCount(c, -1)}
                            hideCount={true}
                          />
                        </div>
                      </div>
                    </CardWrapper>
                  );
                })}
              </div>
            ) : (
              <div className="py-20 text-center border-2 border-dashed border-slate-800 rounded-2xl">
                <p className="text-slate-500 font-bold italic">
                  {isMarketMode ? "沒有任何單卡" : "牌組目前為空"}
                </p>
              </div>
            )}
          </div>

          {/* MOBILE ONLY: Detailed Table at bottom */}
          <div className="block lg:hidden mt-8 space-y-6">
            <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
              {/* Added max-height and overflow to allow the footer to stick within the table box */}
              <div className="max-h-[60vh] overflow-y-auto scrollbar-hide">
                <table className="w-full text-left border-collapse">
                  {/* 1. Table Header: Define 4 Clear Columns */}
                  <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-700">
                    <tr className="text-slate-400 text-[9px] uppercase tracking-widest">
                      <th className="px-3 py-3 font-bold">{t("market_card_col")}</th>
                      <th className="px-3 py-3 font-bold text-right">
                        單價 ($)
                      </th>
                      <th className="px-3 py-3 font-bold text-center">{t("market_qty")}</th>
                      <th className="px-3 py-3 font-bold text-right">{t("market_total")}</th>
                    </tr>
                  </thead>

                  {/* 2. Table Body: 4-Column Row */}
                  <tbody className="divide-y divide-slate-700/50">
                    {(deckTableData || []).map((item) => (
                      <tr
                        key={item.id}
                        className="hover:bg-blue-500/5 transition-colors group border-b border-slate-800/50 last:border-0"
                      >
                        {/* Col 1: ID & Name */}
                        <td className="px-3 py-3">
                          <div className="flex flex-col min-w-0">
                            <span className="text-[9px] font-mono text-blue-400 leading-none mb-1">
                              {item.id}
                            </span>
                            <span className="text-[11px] font-medium text-slate-200 truncate max-w-[100px]">
                              {item.name}
                            </span>
                          </div>
                        </td>

                        {/* Col 2: Unit Price */}
                        <td className="px-3 py-3 text-[11px] text-right font-mono text-slate-400">
                          {item.unitPrice === 0
                            ? "--"
                            : `$${item.unitPrice.toLocaleString()}`}
                        </td>

                        {/* Col 3: Quantity */}
                        <td className="px-3 py-3 text-[11px] text-center font-bold text-amber-500 font-mono">
                          x{item.quantity}
                        </td>

                        {/* Col 4: Total Price for this Card */}
                        <td className="px-3 py-3 text-[11px] text-right font-bold text-white whitespace-nowrap font-mono">
                          {item.totalPrice === 0
                            ? "--"
                            : `$${item.totalPrice.toLocaleString()}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  {/* 3. Sticky Grand Total Footer: Spanning across columns */}
                  <tfoot className="sticky bottom-0 z-10 bg-slate-900 border-t-2 border-blue-500/50">
                    <tr className="bg-blue-500/10">
                      <td colSpan="2" className="px-3 py-4">
                        <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">
                          {isMarketMode
                            ? "Bulk Total 總計"
                            : "Grand Total 總計"}
                        </span>
                      </td>
                      <td colSpan="2" className="px-3 py-4 text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-sm font-black text-white">
                            HK$ {deckValuation.totalHKD.toLocaleString()}
                          </span>
                          <span className="text-[9px] text-slate-500 italic">
                            ≈ ¥{deckValuation.totalJPY.toLocaleString()} JPY
                          </span>
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="flex justify-end mb-4">
              <button
                onClick={generateMarketShareUrl}
                className="px-6 py-4 rounded-xl flex items-center justify-center gap-3 bg-emerald-600 text-white font-bold text-xs transition-all active:scale-95"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 640 640"
                  className="w-5 h-5 text-white transition-transform group-hover:rotate-12"
                  fill="currentColor"
                >
                  <path d="M448 256c-10.6 0-20.9 1.9-30.4 5.4L214.7 150.2c.2-2 .3-4.1 .3-6.2c0-35.3-28.7-64-64-64s-64 28.7-64 64s28.7 64 64 64c10.6 0 20.9-1.9 30.4-5.4L385.3 313.8c-.2 2-.3 4.1-.3 6.2s.1 4.2 .3 6.2L181.3 430.6c-9.5-3.5-19.8-5.4-30.4-5.4c-35.3 0-64 28.7-64 64s28.7 64 64 64s64-28.7 64-64c0-2.1-.1-4.2-.3-6.2L417.6 383.4c9.5 3.5 19.8 5.4 30.4 5.4c35.3 0 64-28.7 64-64s-28.7-64-64-64z" />
                </svg>
                {t("share_price")}
              </button>
              <button
                onClick={copySimFormat}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg transition-all active:scale-95 group"
                title="Copy for OPTCGSim"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 text-emerald-400 group-hover:rotate-12 transition-transform"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                  />
                </svg>
                <span className="text-xs font-bold text-slate-200 uppercase tracking-tight">
                  {t("copy_sim", "Sim 格式")}
                </span>
              </button>
              {/* 
              <button
                onClick={handleShareImage}
                className="px-4 py-2 rounded-lg flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg transition-all active:scale-95"
                title="下載價格圖片 (PNG)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002-2z"
                  />
                </svg>
                下載圖片
              </button>
              */}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default MarketplaceView;
