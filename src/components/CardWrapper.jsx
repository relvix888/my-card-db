import React from "react";

import { getSafeImageUrl } from "../utils/cardHelpers";

const CardWrapper = ({
  card,
  children,
  badge,
  isCompact = false,
  onClick,
  isMarketMode,
}) => {
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
        className={`relative flex flex-col items-center bg-slate-900/80 ${
          isCompact ? "p-1.5 pt-1" : "p-3"
        }`}
        /* Fixed height ensures all cards in a row are identical */
        style={{ height: isCompact ? "75px" : "100px" }}
      >
        {/* Layer 1: Card ID */}
        <p className="w-full text-center text-[8px] sm:text-[9px] text-slate-500 font-mono font-bold leading-none mb-1">
          {card.id}
        </p>

        {/* Layer 2: Card Name */}
        <h4
          className={`
            w-full text-center font-bold text-[10px] sm:text-[11px] leading-tight text-slate-100 line-clamp-2 overflow-hidden
            ${isMarketMode ? "export-hide-name" : ""} 
          `}
        >
          {card.name}
        </h4>

        {/* Layer 3: Action Area (QuickController) */}
        {/* Absolute positioning "pins" this to the bottom of the CardWrapper info area */}
        <div className="absolute bottom-1 left-0 w-full flex justify-center export-hide-ui">
          {children}
        </div>
      </div>
    </div>
  );
};

export default CardWrapper;
