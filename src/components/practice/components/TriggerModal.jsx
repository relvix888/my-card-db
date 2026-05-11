import React from 'react';
import { getSafeImageUrl } from '../../../utils/cardHelpers';

export default function TriggerModal({ trigger, onResolve }) {
  if (!trigger) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6">
      <div className="bg-slate-900 border border-yellow-500/50 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="bg-yellow-600 px-4 py-2 flex items-center gap-2">
          <span className="text-white font-black text-sm uppercase tracking-widest">⚡ Trigger!</span>
        </div>

        {/* Life card */}
        <div className="flex flex-col items-center gap-3 p-6">
          <img
            src={getSafeImageUrl(trigger.lifeCard)}
            alt={trigger.lifeCard.name}
            className="w-24 h-32 rounded-xl object-cover border-2 border-yellow-400 shadow-lg shadow-yellow-400/30"
            onError={e => { e.target.src = '/images/card_back.png'; }}
          />
          <div className="text-center">
            <p className="text-white font-black">{trigger.lifeCard.name}</p>
            <p className="text-yellow-400 text-sm mt-1">{trigger.lifeCard.trigger}</p>
          </div>
        </div>

        {/* Choices */}
        <div className="flex gap-3 p-4 border-t border-slate-700">
          <button
            onClick={() => onResolve(true)}
            className="flex-1 py-3 bg-yellow-600 hover:bg-yellow-500 text-white font-black text-sm rounded-xl active:scale-95 transition-all"
          >
            Activate Trigger
          </button>
          <button
            onClick={() => onResolve(false)}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm rounded-xl active:scale-95 transition-all"
          >
            Add to Hand
          </button>
        </div>
      </div>
    </div>
  );
}
