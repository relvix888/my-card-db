import React from "react";

import { getSafeImageUrl } from "../utils/cardHelpers";

const LeaderBanner = ({
  selectedLeader,
  totalDeckCount,
  onClearDeck,
  isEmpty,
}) => {
  return (
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
              backgroundSize: "cover",
              backgroundPosition: "center 15%",
              backgroundRepeat: "no-repeat",
            }
          : {}
      }
    >
      {/* Art Overlay */}
      {selectedLeader && (
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/95 via-transparent to-slate-950/90 transition-all duration-700 group-hover:via-slate-950/10" />
      )}

      {/* Content */}
      <div className="relative z-10">
        {selectedLeader ? (
          <>
            <h2 className="text-2xl font-black text-white uppercase tracking-tighter">
              {selectedLeader.name}
              <span className="text-sky-400 font-mono text-sm ml-2">
                {selectedLeader.id}
              </span>
            </h2>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-sm text-slate-300 font-bold">
                總張數 (Total Cards):
                <span
                  className={`ml-2 ${totalDeckCount === 51 ? "text-green-400" : "text-amber-400"}`}
                >
                  {totalDeckCount} / 51
                </span>
              </p>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold text-sky-400 flex items-center gap-2">
              尚未選擇領航 (No Leader Selected)
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              請從搜尋頁面選擇一張領航卡以開始。
            </p>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="relative z-10 flex gap-3 mt-4 sm:mt-0">
        {selectedLeader && (
          <button
            onClick={onClearDeck}
            className="px-4 py-2 bg-red-950/30 border border-red-900/50 rounded-lg text-[10px] font-black text-red-400 hover:bg-red-900/40 transition-all uppercase tracking-widest"
          >
            清空牌組 (Clear Deck)
          </button>
        )}
      </div>
    </div>
  );
};

export default LeaderBanner;
