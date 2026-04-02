import React from "react";

import { getSafeImageUrl } from "../utils/cardHelpers";

const CardWrapper = ({ card, children, badge, isCompact = false, onClick }) => {
  return (
    <div
      onClick={onClick}
      className={`
        bg-slate-800 border border-slate-700 
        hover:border-blue-500 transition-all cursor-pointer group shadow-sm 
        relative flex flex-col h-full
        ${isCompact ? "rounded-md md:rounded-xl" : "rounded-xl"}
      `}
    >
      {/* 1. TOP: Image Section */}
      <div className="aspect-[2.5/3.5] relative overflow-hidden bg-slate-950 flex-shrink-0">
        <img
          src={getSafeImageUrl(card)}
          alt={card.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
        />
        {badge} {/* Ribbons stay on the image */}
        {card.category === "Leader" && (
          <div className="absolute top-2 left-2 z-10 bg-purple-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-md">
            領航
          </div>
        )}
      </div>

      {/* 2. BOTTOM: Information & Action Area */}
      <div
        className={`flex flex-col items-center flex-grow bg-slate-900/80 ${
          isCompact ? "p-1.5 pt-1" : "p-3"
        }`}
      >
        {/* Layer 1: Card ID - Added text-center */}
        <p className="w-full text-center text-[8px] sm:text-[9px] text-slate-500 font-mono font-bold tracking-tighter leading-none mb-0.5">
          {card.id}
        </p>

        {/* Layer 2: Card Name - Added text-center and w-full */}
        <h4 className="w-full text-center font-bold text-[10px] sm:text-[11px] leading-tight truncate text-slate-100 group-hover:text-blue-300 transition-colors mb-2">
          {card.name}
        </h4>

        {/* Layer 3: Action Area (QuickController) */}
        <div className="mt-auto flex justify-center w-full">{children}</div>
      </div>
    </div>
  );
};

export default CardWrapper;
