import React from "react";
import CardWrapper from "./CardWrapper";
import QuickController from "./QuickController";
import LeaderBanner from "./LeaderBanner";
import PlayCurve from "./PlayCurve";
import { SimpleBarChart, SimplePieChart } from "./Charts";
import { BLOCK_1_EXCEPTIONS } from "../data/rotation";
import { BANNED_LIST } from "../data/rotation";
import { RESTRICTED_PAIRS } from "../data/rotation";

const DeckView = ({
  orderedDeck,
  selectedLeader,
  totalDeckCount,
  setDeckList,
  setSelectedCard,
  updateDeckCount,
  generateShareUrl,
  isMarketMode,
  legalityWarning,
  // --- ANALYSIS PROPS ---
  deckAnalysis,
  showCurve,
  setShowCurve,
  firstCurveTurns,
  setFirstCurveTurns,
  secondCurveTurns,
  setSecondCurveTurns,
  cards,
  deckList,
  getSafeImageUrl,
  hoveredTrait,
  setHoveredTrait,
  marketList,
  setMarketList,
  ...props
}) => {
  return (
    <div className="w-full">
      {/* 1: Warning if viewing Deck while in Market Mode */}
      {isMarketMode && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="text-amber-400 font-black text-sm uppercase tracking-tight">
                目前處於「單卡模式」，建議切換回「牌組模式」以構築牌組。
              </p>
              <p className="text-slate-400 text-xs">
                點擊加減按鈕將會更新您的市場清單，而非此處看到的牌組。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2. NEW: Block 1 Legality Warning (Tournament Rule) */}
      {legalityWarning?.hasIssue && (
        <div className="mb-6 overflow-hidden bg-slate-900 border border-rose-500/30 rounded-2xl shadow-2xl">
          <div className="bg-rose-600 px-4 py-2 flex items-center gap-2">
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
            <span className="text-[10px] font-black text-white uppercase tracking-widest">
              Deck Validation / 牌組檢查
            </span>
          </div>
          <div className="p-4 space-y-3">
            {/* Missing Data Warning (Amber/Yellow to signify missing info) */}
            {legalityWarning.missingIds.length > 0 && (
              <p className="text-amber-500 text-xs font-bold flex items-center gap-2">
                ⚠️ 沒有資料: 以下卡號不在資料庫中，無法顯示圖片。
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {/* Highlight IDs */}
              {legalityWarning.missingIds.map((id) => (
                <span
                  key={id}
                  className="px-2 py-0.5 bg-amber-500/20 border border-amber-500/40 rounded text-[9px] font-mono text-amber-500"
                >
                  {id}
                </span>
              ))}
            </div>

            {/* Legality Messages */}
            {legalityWarning.messages
              .filter((m) => !m.includes("找不到"))
              .map((msg, i) => (
                <p
                  key={i}
                  className="text-rose-400 text-xs font-bold flex items-start gap-2"
                >
                  <span className="mt-1 w-1 h-1 rounded-full bg-rose-500 shrink-0" />
                  {msg}
                </p>
              ))}

            <div className="flex flex-wrap gap-2 pt-1">
              {/* Highlight IDs */}
              {legalityWarning.illegalIds.map((id) => (
                <span
                  key={id}
                  className="px-2 py-0.5 bg-rose-500/20 border border-rose-500/40 rounded text-[9px] font-mono text-rose-500"
                >
                  {id}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 3. Leader Banner */}
      <LeaderBanner
        selectedLeader={selectedLeader}
        totalDeckCount={totalDeckCount}
        onClearDeck={() => setDeckList({})}
      />

      {/* 4. Card Grid */}
      {orderedDeck.length > 0 ? (
        <div className="grid grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-x-1 md:gap-x-2 gap-y-1">
          {orderedDeck.map(({ card, count }) => {
            const safeCard = card || {
              id: "UNKNOWN",
              name: "Missing Card Data",
              category: "Character",
            };

            const isMissing = !card;
            const isIllegal =
              !isMissing &&
              ((card.block_number === 1 &&
                !BLOCK_1_EXCEPTIONS.includes(card.id)) ||
                BANNED_LIST.includes(card.id) ||
                legalityWarning.illegalIds.includes(card.id));

            return (
              <CardWrapper
                key={card.id}
                card={card}
                isCompact={true}
                className="mb-0"
                onClick={() => setSelectedCard(card)}
                badge={
                  <>
                    {/* Top Warning Badge */}
                    {isMissing && (
                      <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center p-2 text-center z-30">
                        <span className="text-[10px] font-black text-rose-500 leading-tight">
                          No Card Data
                          <br />
                          無資料
                        </span>
                      </div>
                    )}
                    {isIllegal && (
                      <div className="absolute top-1 right-1 bg-rose-600 text-white text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded shadow-lg uppercase animate-pulse z-20">
                        警告
                      </div>
                    )}

                    {/* NEW: Counter Badge at Bottom Center of Image */}
                    {count > 0 && (
                      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-20">
                        <div className="bg-indigo-600 text-white font-black font-mono text-xs md:text-xs px-2 py-0.5 rounded-full shadow-[0_0_10px_rgba(37,99,235,0.5)] border border-blue-400/50">
                          {count}
                        </div>
                      </div>
                    )}
                  </>
                }
              >
                {/* Bottom Action: Only the +/- Controls */}
                <div className="w-full flex justify-center">
                  <QuickController
                    card={card}
                    count={count}
                    onAdd={(c) => updateDeckCount(c, 1)}
                    onRemove={(c) => updateDeckCount(c, -1)}
                    hideCount={true} // New prop to hide the center number
                  />
                </div>
              </CardWrapper>
            );
          })}
        </div>
      ) : (
        <div className="py-20 text-center border-2 border-dashed border-slate-800 rounded-2xl">
          <p className="text-slate-500 font-bold">
            目前牌組為空，請切換到資料庫添加卡片。
          </p>
        </div>
      )}

      {/* 1. Share Button */}
      <div className="flex justify-end mb-4">
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
          <span className="font-bold text-sm tracking-wide text-white whitespace-nowrap">
            分享牌組策略
          </span>
        </button>
      </div>

      {/* 4. DECK ANALYSIS SECTION */}
      {deckAnalysis && (
        <section className="w-full pt-12 border-t border-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="flex items-center gap-2 mb-8">
            <div className="h-6 w-1.5 bg-blue-500 rounded-full"></div>
            <h3 className="text-xl font-black uppercase tracking-widest text-white">
              牌組分析 (Deck Analysis)
            </h3>
          </div>

          {/* --- WRAPPER FOR EQUAL SPACING --- */}
          <div className="flex flex-col gap-6">
            {/* Strategy / Play Curve */}
            <div className="bg-slate-900/30 rounded-2xl p-6 border border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-black text-slate-400 uppercase tracking-tighter">
                    策略規劃 / Play Curve
                  </h2>
                  <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-mono">
                    BETA
                  </span>
                </div>
                <button
                  onClick={() => setShowCurve(!showCurve)}
                  className="text-xs font-bold px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all border border-slate-700 uppercase active:scale-95"
                >
                  {showCurve ? "隱藏表格 Hide" : "顯示表格 Show"}
                </button>
              </div>

              {showCurve && (
                <div className="space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
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
                          deckList={deckList}
                        />
                        <PlayCurve
                          title="後攻 (Second)"
                          turns={secondCurveTurns}
                          setTurns={setSecondCurveTurns}
                          defaultTurns={[2, 4, 6, 8, 10]}
                          availableCards={cardsInDeck}
                          getSafeImageUrl={getSafeImageUrl}
                          deckList={deckList}
                        />
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Charts & Stats Grid */}
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

              <div className="grid grid-cols-3 gap-3">
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
                <div className="flex flex-col gap-2">
                  <StatBox
                    title="平均反擊 / Avg"
                    value={`+${deckAnalysis.avgCounter.toLocaleString()}`}
                    color="emerald"
                  />
                  {/* <StatBox
                  title="2k比例 / 2k%"
                  value={`${deckAnalysis.twokCounter}%`}
                  color="emerald"
                /> */}
                  <StatBox
                    title="反擊比例 / Counter%"
                    value={`${deckAnalysis.counterQualityScore}%`}
                    color="emerald"
                  />
                  <div className="p-2 bg-blue-500/10 border border-emerald-500/20 rounded-lg">
                    <span className="text-[10px] font-bold text-emerald-400/60 uppercase">
                      防禦 / Blockers
                    </span>
                    <div className="text-xs font-black text-emerald-500">
                      {deckAnalysis.blockerCount} /{" "}
                      {deckAnalysis.totalNonLeader}
                    </div>
                    <div className="w-full h-1 bg-slate-900 rounded-full mt-2 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{
                          width: `${(deckAnalysis.blockerCount / deckAnalysis.totalNonLeader) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Types Table */}
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-visible">
              <div className="p-4 border-b border-slate-700 bg-slate-800/30">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  特徵統計 / Types Statistics
                </h4>
              </div>
              <table className="w-full text-sm text-left">
                <tbody className="divide-y divide-slate-700/50">
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
                        <td className="px-6 py-4 font-bold text-slate-200">
                          <div className="relative">
                            {type}
                            {hoveredTrait === type && (
                              <div
                                className={`absolute left-0 z-[100] w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-3 animate-in fade-in zoom-in duration-200 pointer-events-none ${isLastFew ? "bottom-full mb-2" : "top-full mt-1"}`}
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
                        <td className="px-6 py-4 text-right font-mono font-bold text-blue-400">
                          {data.count}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="inline-flex items-center gap-3">
                            <span className="text-[10px] text-slate-500 font-bold">
                              {Math.round(
                                (data.count / deckAnalysis.totalNonLeader) *
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
        </section>
      )}
    </div>
  );
};

// Simple helper component for the small stat boxes
const StatBox = ({ title, value, color }) => (
  <div
    className={`flex flex-col px-2 py-1.5 bg-blue-500/10 border border-${color}-500/20 rounded-lg min-w-0`}
  >
    <span
      className={`text-[10px] font-bold text-${color}-400/60 uppercase tracking-tighter leading-tight mb-1`}
    >
      {title}
    </span>
    <span className="text-xs font-semibold truncate text-white">{value}</span>
  </div>
);

export default DeckView;
