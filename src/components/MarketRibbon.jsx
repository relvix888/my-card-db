import React from "react";

const MarketRibbon = ({ cardId, marketData, onToggle }) => {
  const data = marketData[cardId];
  if (!data) return null;

  const isBuy = data.type === "BUY";

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onToggle(cardId);
      }}
      className={`
    /* Positioned perfectly in the top-right corner */
    absolute top-0 right-0 z-30 
    px-1.5 sm:px-2 py-1 rounded-bl-md
    shadow-lg cursor-pointer pointer-events-auto
    flex flex-col items-center justify-center transition-all duration-200
    hover:brightness-110 active:scale-95
    ${
      marketData[cardId]?.type === "BUY"
        ? "bg-emerald-500 ring-1 ring-emerald-400/50"
        : "bg-rose-600 ring-1 ring-rose-500/50"
    }
  `}
    >
      {/* English Label: WTB/WTS */}
      <span className="text-[7px] sm:text-[8px] font-black text-white uppercase leading-none tracking-tighter opacity-90">
        {marketData[cardId]?.type === "BUY" ? "WTB" : "WTS"}
      </span>

      {/* Chinese Label: 收/賣 */}
      <span className="text-[9px] sm:text-[10px] font-black text-white leading-none mt-0.5">
        {marketData[cardId]?.type === "BUY" ? "收" : "賣"}
      </span>
    </div>
  );
};

export default MarketRibbon;
