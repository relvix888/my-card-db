import React from "react";
import CardWrapper from "./CardWrapper";
import MarketRibbon from "./MarketRibbon";
import LeaderBanner from "./LeaderBanner";
import QuickController from "./QuickController";
import { BLOCK_1_EXCEPTIONS } from "../data/rotation";
import { BANNED_LIST } from "../data/rotation";
import { RESTRICTED_PAIRS } from "../data/rotation";

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
}) => {
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
              ✨ 我玩異畫
            </button>

            {/* Action 2: Basic Rarity */}
            <button
              onClick={() => bulkUpdateRarity("BASIC")}
              className="bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600 text-slate-400 py-1.5 rounded-lg text-xs font-black uppercase transition-all active:scale-95"
            >
              ↩️ 普畫算數
            </button>
            {/* Stat 1: Cards */}
            <div className="flex items-center justify-center gap-2 px-2 py-1.5 bg-slate-900/80 rounded-lg border border-slate-700/50">
              <span className="text-[8px] text-slate-500 font-bold uppercase">
                卡數
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
            <div className="max-h-[50vh] overflow-y-auto scrollbar-hide">
              <table className="w-full text-left border-collapse">
                {/* 1. Table Header: Define 4 Clear Columns */}
                <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-700">
                  <tr className="text-slate-400 text-[9px] uppercase tracking-widest">
                    <th className="px-3 py-3 font-bold">卡牌 (Card)</th>
                    <th className="px-3 py-3 font-bold text-right">單價 ($)</th>
                    <th className="px-3 py-3 font-bold text-center">數量</th>
                    <th className="px-3 py-3 font-bold text-right">總計</th>
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
                        {isMarketMode ? "Bulk Total 總計" : "Grand Total 總計"}
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
            className="w-full px-6 py-4 rounded-xl transition-all flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 shadow-lg active:scale-95"
          >
            <span className="font-bold text-xs tracking-wide text-white uppercase">
              分享市場報價
            </span>
          </button>
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
                      ⚠️ 找不到卡牌資料:
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
                    className="mb-0"
                    onClick={() => setSelectedCard({ ...card, id: displayId })}
                    badge={
                      <>
                        {/* 1. The Market Type Ribbon (Left/Top) */}
                        <MarketRibbon
                          cardId={displayId}
                          marketData={marketData}
                          onToggle={toggleMarketType}
                        />

                        {/* Visual Alert for Missing Data directly on the card */}
                        {isMissing && (
                          <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center z-30 border-2 border-dashed border-amber-500/50">
                            <span className="text-[18px]">❓</span>
                            <span className="text-[10px] font-black text-amber-500 mt-1 uppercase">
                              No Data
                            </span>
                          </div>
                        )}

                        {/* 2. The Counter (Bottom Center of Image) */}
                        {count > 0 && (
                          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-20">
                            <div className="bg-amber-500 text-black font-black font-mono text-xs md:text-xs px-2 py-0.5 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.4)] border border-amber-300/50">
                              {count}
                            </div>
                          </div>
                        )}
                      </>
                    }
                  >
                    <div className="flex flex-col gap-0 px-0 pb-0">
                      {/* Price Input Area */}
                      <textarea
                        placeholder="Price"
                        value={marketData[displayId]?.price || ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updatePrice(displayId, e.target.value)}
                        rows={2}
                        className="w-full bg-slate-950 border border-slate-800 rounded text-center text-[10px] p-1 text-white font-mono outline-none focus:border-amber-500 resize-none"
                      />

                      {/* Plus/Minus Buttons only */}
                      <div className="flex justify-center">
                        <QuickController
                          card={{ ...card, id: displayId }}
                          count={count}
                          onAdd={(c) => updateDeckCount(c, 1)}
                          onRemove={(c) => updateDeckCount(c, -1)}
                          hideCount={true} // Reusing the hideCount logic
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

          {/* MOBILE ONLY: Detailed Table at bottom */}
          <div className="block lg:hidden mt-8 space-y-6">
            <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
              {/* Added max-height and overflow to allow the footer to stick within the table box */}
              <div className="max-h-[60vh] overflow-y-auto scrollbar-hide">
                <table className="w-full text-left border-collapse">
                  {/* 1. Table Header: Define 4 Clear Columns */}
                  <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-700">
                    <tr className="text-slate-400 text-[9px] uppercase tracking-widest">
                      <th className="px-3 py-3 font-bold">卡牌 (Card)</th>
                      <th className="px-3 py-3 font-bold text-right">
                        單價 ($)
                      </th>
                      <th className="px-3 py-3 font-bold text-center">數量</th>
                      <th className="px-3 py-3 font-bold text-right">總計</th>
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
                className="px-6 py-4 rounded-xl flex items-center justify-center gap-3 bg-emerald-600 text-white font-bold"
              >
                分享市場報價
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default MarketplaceView;
