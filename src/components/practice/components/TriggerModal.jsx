import React from 'react';
import { getSafeImageUrl } from '../../../utils/cardHelpers';

export default function TriggerBar({ trigger, onResolve }) {
  if (!trigger) return null;

  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-3 py-2 bg-yellow-950/80 border-y border-yellow-500/60">
      {/* Badge */}
      <span className="text-yellow-400 font-black text-[10px] uppercase tracking-widest whitespace-nowrap">
        ⚡ Trigger!
      </span>

      {/* Card thumbnail */}
      <img
        src={getSafeImageUrl(trigger.lifeCard)}
        alt={trigger.lifeCard.name}
        className="w-8 h-11 rounded object-cover border border-yellow-400/60 flex-shrink-0"
        onError={e => { e.target.src = '/images/card_back.png'; }}
      />

      {/* Card info */}
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold text-[10px] truncate">{trigger.lifeCard.name}</p>
        <p className="text-yellow-300 text-[9px] leading-tight line-clamp-2">{trigger.lifeCard.trigger}</p>
      </div>

      {/* Actions */}
      <button
        onClick={() => onResolve(true)}
        className="flex-shrink-0 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-[10px] rounded-lg active:scale-95 transition-all"
      >
        Activate
      </button>
      <button
        onClick={() => onResolve(false)}
        className="flex-shrink-0 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white font-bold text-[10px] rounded-lg active:scale-95 transition-all"
      >
        To Hand
      </button>
    </div>
  );
}
