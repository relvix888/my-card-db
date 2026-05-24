import React from 'react';

export default function WaitingBanner({ visible }) {
  if (!visible) return null;
  return (
    <div className="absolute top-12 left-0 right-0 z-30 flex justify-center pointer-events-none">
      <div className="bg-slate-800/90 border border-slate-600 rounded-xl px-4 py-2 text-slate-300 text-xs font-bold animate-pulse">
        Waiting for opponent...
      </div>
    </div>
  );
}
