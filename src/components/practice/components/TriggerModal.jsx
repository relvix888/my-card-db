import React from 'react';
import { DetailPanel } from './CardDetailOverlay';

export default function TriggerBar({ trigger, onResolve }) {
  if (!trigger) return null;

  const card = trigger.lifeCard;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center pointer-events-none gap-2 px-4">

      <div className="pointer-events-auto drop-shadow-2xl">
        <DetailPanel card={card} flashTrigger />
      </div>

      <div className="pointer-events-auto flex flex-col gap-3 px-5 py-4 bg-yellow-950/95 border border-yellow-500/70 rounded-2xl shadow-2xl shadow-yellow-900/60 backdrop-blur-sm max-w-xs w-full">
        <p className="text-yellow-400 font-black text-sm uppercase tracking-widest text-center">
          ⚡ Trigger!
        </p>
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
