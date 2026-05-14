import React from 'react';
import { getSafeImageUrl } from '../../../utils/cardHelpers';

export default function DonReturnBar({ pendingEffect, selectedCount }) {
  if (!pendingEffect || pendingEffect.action?.type !== 'CHOOSE_DON_RETURN') return null;

  const { sourceCard, choices } = pendingEffect;
  const total = choices?.count ?? 0;
  const remaining = total - selectedCount;

  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-3 py-2 bg-teal-950/80 border-y border-teal-500/60">
      {/* Badge */}
      <span className="text-teal-300 font-black text-[10px] uppercase tracking-widest whitespace-nowrap">
        ↩ Return DON!!
      </span>

      {/* Source card thumbnail */}
      {sourceCard && (
        <img
          src={getSafeImageUrl(sourceCard)}
          alt={sourceCard.name}
          className="w-8 h-11 rounded object-cover border border-teal-400/60 flex-shrink-0"
          onError={e => { e.target.src = '/images/card_back.png'; }}
        />
      )}

      {/* Instruction */}
      <div className="flex-1 min-w-0">
        {sourceCard && (
          <p className="text-white font-bold text-[10px] truncate">{sourceCard.name}</p>
        )}
        <p className="text-teal-300 text-[10px]">
          {remaining > 0
            ? `Select ${remaining} more DON!! to return (${selectedCount}/${total})`
            : `${total}/${total} selected — confirm by selecting the last one`}
        </p>
        <p className="text-slate-400 text-[9px] leading-tight mt-0.5">
          Tap a DON!! in cost area, or tap your leader / a character with attached DON!!
        </p>
      </div>

      {/* Progress pip indicators */}
      <div className="flex gap-1 flex-shrink-0">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-full border ${
              i < selectedCount
                ? 'bg-teal-400 border-teal-400'
                : 'bg-transparent border-teal-600'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
