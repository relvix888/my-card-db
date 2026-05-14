import React from 'react';

const DON_IMG = '/don.png';

// Just the DON!! deck stack — the cost area is rendered separately in PlayerField
export default function DonArea({ donDeck = [], isOpponent, onDonClick }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className="relative w-14 h-20"
        title={`DON!! deck: ${donDeck.length} remaining`}
      >
        {/* Depth shadow cards */}
        {donDeck.length > 2 && (
          <div className="absolute inset-0 rounded-lg border border-teal-800 bg-teal-950"
               style={{ transform: 'translate(3px, 3px)' }} />
        )}
        {donDeck.length > 1 && (
          <div className="absolute inset-0 rounded-lg border border-teal-700 bg-teal-950"
               style={{ transform: 'translate(1.5px, 1.5px)' }} />
        )}
        <img
          src={DON_IMG}
          alt="DON!! deck"
          className="absolute inset-0 w-full h-full object-cover rounded-lg border border-teal-500 shadow"
          onError={e => { e.target.style.display = 'none'; }}
        />
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30">
          <span className="bg-slate-900/70 text-white text-sm font-black px-1.5 py-0.5 rounded">{donDeck.length}</span>
        </div>
      </div>
      <span className="text-[7px] text-teal-600 font-bold uppercase tracking-wide">DON!!</span>
    </div>
  );
}
