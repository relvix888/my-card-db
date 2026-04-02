import React from "react";

const PriceInput = ({ cardId, marketData, onUpdatePrice }) => {
  // Priority: 1. Manual price user typed, 2. Scraped HKD from site, 3. Empty string
  const displayValue =
    marketData[cardId]?.price || marketData[cardId]?.hkd || "";

  return (
    <div className="absolute bottom-2 left-0 right-0 px-2 pointer-events-auto">
      <div className="relative group">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-500 font-bold">
          HK$
        </span>
        <input
          type="text"
          placeholder="價格..."
          value={displayValue}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdatePrice(cardId, e.target.value)}
          className="
            w-full bg-slate-950/90 border border-slate-700 rounded 
            text-center text-xs py-1 pl-6 pr-1 text-amber-400 font-mono 
            outline-none focus:border-amber-500 focus:bg-slate-900 
            transition-all shadow-lg
          "
        />
      </div>
    </div>
  );
};

export default PriceInput;
