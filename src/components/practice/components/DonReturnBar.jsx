import React from 'react';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';
import DraggablePanel from './DraggablePanel';

export default function DonReturnBar({ pendingEffect, selectedCount }) {
  if (!pendingEffect || pendingEffect.action?.type !== 'CHOOSE_DON_RETURN') return null;

  const { sourceCard, choices } = pendingEffect;
  const total = choices?.count ?? 0;
  const remaining = total - selectedCount;

  return (
    <DraggablePanel>
      <div className="bg-slate-900/95 border border-teal-500/40 overflow-hidden pb-safe">
        {/* Header */}
        <div className="bg-teal-700 px-3 py-1.5 flex items-center gap-2">
          <span className="text-white font-black text-xs uppercase tracking-widest whitespace-nowrap">
            ↩ Return DON!!
          </span>
          {sourceCard && (
            <span className="text-teal-200 text-xs truncate ml-auto">{sourceCard.name}</span>
          )}
        </div>

        {/* Body */}
        <div className="flex items-center gap-3 px-3 pt-2.5 pb-3">
          {/* Source card thumbnail */}
          {sourceCard && (
            <img
              src={getSafeImageUrl(sourceCard)}
              alt={sourceCard.name}
              className="w-10 h-14 rounded object-cover border border-teal-400/60 flex-shrink-0"
              onError={e => { e.target.src = cardBackImg; }}
            />
          )}

          {/* Instruction */}
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-sm">
              {remaining > 0
                ? `Select ${remaining} more DON!! to return`
                : 'Confirm by selecting the last one'}
            </p>
            <p className="text-teal-300 text-xs mt-0.5">{selectedCount}/{total} selected</p>
            <p className="text-slate-400 text-[11px] leading-tight mt-1">
              Tap a DON!! in cost area, or tap your leader / a character with attached DON!!
            </p>

            {/* Progress pip indicators */}
            <div className="flex gap-1 mt-2">
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
        </div>
      </div>
    </DraggablePanel>
  );
}
