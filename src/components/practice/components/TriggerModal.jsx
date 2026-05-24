import React from 'react';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';

export default function TriggerBar({ trigger, onResolve }) {
  if (!trigger) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto flex flex-col gap-3 px-5 py-4 bg-yellow-950/95 border border-yellow-500/70 rounded-2xl shadow-2xl shadow-yellow-900/60 backdrop-blur-sm max-w-xs w-full mx-4">
        {/* Title */}
        <p className="text-yellow-400 font-black text-sm uppercase tracking-widest text-center">
          ⚡ Trigger!
        </p>

        {/* Body: thumbnail + effect text */}
        <div className="flex items-start gap-3">
          <img
            src={getSafeImageUrl(trigger.lifeCard)}
            alt={trigger.lifeCard.name}
            className="w-14 h-20 rounded object-cover border border-yellow-400/60 flex-shrink-0"
            onError={e => { e.target.src = cardBackImg; }}
          />
          <p className="text-yellow-200 text-[11px] leading-snug">{trigger.lifeCard.trigger}</p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => onResolve(true)}
            className="flex-1 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-xs rounded-lg active:scale-95 transition-all"
          >
            Activate
          </button>
          <button
            onClick={() => onResolve(false)}
            className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs rounded-lg active:scale-95 transition-all"
          >
            {trigger.cardAlreadyInZone ? 'Decline' : 'To Hand'}
          </button>
        </div>
      </div>
    </div>
  );
}
