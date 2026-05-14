import React, { useState, useMemo } from "react";
import { rankCardsForTurn } from "../utils/cardRanker";

const TIER_STYLES = {
  S: "bg-amber-400 text-black",
  A: "bg-blue-500 text-white",
  B: "bg-slate-600 text-white",
  C: "bg-slate-800 text-slate-400",
};

export default function TurnAdvisor({ orderedDeck }) {
  const [selectedTurn, setSelectedTurn] = useState(3);
  const [expandedId, setExpandedId] = useState(null);

  const deckCards = useMemo(
    () => orderedDeck.map(({ card }) => card).filter(Boolean),
    [orderedDeck],
  );

  const rankedCards = useMemo(
    () => rankCardsForTurn(deckCards, selectedTurn),
    [deckCards, selectedTurn],
  );

  return (
    <div className="bg-slate-900/30 rounded-2xl p-6 border border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black text-slate-400 uppercase tracking-tighter">
            出牌建議 / Turn Advisor
          </h2>
          <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-mono">
            BETA
          </span>
        </div>
        <span className="text-[10px] text-slate-600 font-mono">
          {rankedCards.length} 張可出
        </span>
      </div>

      {/* Turn selector */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <span className="text-[10px] text-slate-500 font-black uppercase tracking-tight shrink-0">
          回合
        </span>
        <div className="flex gap-1 flex-wrap">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTurn(t)}
              className={`w-7 h-7 rounded text-xs font-black transition-all active:scale-95 ${
                selectedTurn === t
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-slate-600 font-mono ml-1">
          咚!! ≤ {selectedTurn}
        </span>
      </div>

      {/* Tier legend */}
      <div className="flex gap-3 mb-4">
        {Object.entries(TIER_STYLES).map(([tier, style]) => (
          <div key={tier} className="flex items-center gap-1">
            <span
              className={`w-5 h-5 rounded text-[10px] font-black flex items-center justify-center ${style}`}
            >
              {tier}
            </span>
            <span className="text-[10px] text-slate-600">
              {tier === "S"
                ? "≥3.0"
                : tier === "A"
                  ? "1.8–3"
                  : tier === "B"
                    ? "1.0–1.8"
                    : "<1.0"}
            </span>
          </div>
        ))}
      </div>

      {/* Card list */}
      {rankedCards.length === 0 ? (
        <p className="text-slate-600 text-sm text-center py-8">
          此回合沒有可出的卡片
        </p>
      ) : (
        <div className="space-y-2">
          {rankedCards.map((card) => (
            <div
              key={card.id}
              className="rounded-xl border border-slate-800 bg-slate-950/50 overflow-hidden cursor-pointer hover:border-slate-700 transition-colors"
              onClick={() =>
                setExpandedId(expandedId === card.id ? null : card.id)
              }
            >
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Tier badge */}
                <span
                  className={`w-6 h-6 rounded text-[10px] font-black flex items-center justify-center shrink-0 ${TIER_STYLES[card.tier]}`}
                >
                  {card.tier}
                </span>

                {/* Card info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white truncate">
                      {card.name}
                    </span>
                    <span className="text-[10px] font-mono text-slate-600 shrink-0">
                      {card.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-slate-500">
                      費用 {card.cost}
                    </span>
                    {card.power != null && (
                      <span className="text-xs text-slate-500">
                        力量 {card.power.toLocaleString()}
                      </span>
                    )}
                    {card.counter != null && (
                      <span className="text-xs text-emerald-600 font-bold">
                        反擊 +{card.counter.toLocaleString()}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-600 uppercase">
                      {card.category}
                    </span>
                  </div>
                  {card.breakdown.matchedKeywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {card.breakdown.matchedKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded font-mono"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Score + expand indicator */}
                <div className="text-right shrink-0 flex flex-col items-end gap-1">
                  <div className="text-lg font-black text-white leading-none">
                    {card.score}
                  </div>
                  <div className="text-[10px] text-slate-600 uppercase">
                    score
                  </div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`w-3 h-3 text-slate-600 transition-transform ${expandedId === card.id ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </div>

              {/* Expanded score breakdown */}
              {expandedId === card.id && (
                <div className="px-4 pb-3 pt-2 border-t border-slate-800/60 grid grid-cols-2 gap-x-6 gap-y-1 animate-in fade-in duration-150">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">力量效率</span>
                    <span
                      className={
                        card.breakdown.power >= 0
                          ? "text-green-400"
                          : "text-red-400"
                      }
                    >
                      {card.breakdown.power >= 0 ? "+" : ""}
                      {card.breakdown.power.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">反擊值</span>
                    <span className="text-emerald-400">
                      +{card.breakdown.counter.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">技能分</span>
                    <span className="text-blue-400">
                      +{card.breakdown.effect.toFixed(1)}
                    </span>
                  </div>
                  {card.breakdown.donEfficiency !== 0 && (
                    <div className="flex justify-between text-xs col-span-2">
                      <span className="text-slate-500">咚!!效率</span>
                      <span className="text-amber-400">
                        {card.breakdown.donEfficiency.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
