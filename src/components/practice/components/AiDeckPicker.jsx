import React, { useState, useMemo } from 'react';
import deckFinalData from '../../../data/deck_final.json';
import { getSafeImageUrl } from '../../../utils/cardHelpers';

function countNonLeaderCards(deckStr) {
  return deckStr.split(',').reduce((sum, part) => {
    const m = part.match(/^(\d+)x/);
    return sum + (m ? parseInt(m[1]) : 0);
  }, 0) - 1; // subtract the leader copy
}

export default function AiDeckPicker({ cards, onSelect, onClose }) {
  const [selected, setSelected] = useState(null);

  const deckEntries = useMemo(() =>
    Object.entries(deckFinalData).map(([key, val]) => ({
      key,
      deckStr: val.deck,
      leader: cards?.find(c => c.id === key) ?? null,
      cardCount: countNonLeaderCards(val.deck),
    })),
  [cards]);

  const selectedEntry = selected ? deckEntries.find(d => d.key === selected) : null;

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-slate-800">
        <button onClick={onClose} className="text-slate-400 hover:text-white text-sm font-bold">
          ← Back
        </button>
        <span className="text-slate-300 font-black text-sm tracking-wide">Choose Opponent Deck</span>
        <span className="text-xs text-slate-500">{deckEntries.length} decks</span>
      </div>

      {/* Deck grid */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="grid grid-cols-3 gap-3">
          {deckEntries.map(({ key, leader, cardCount }) => {
            const isSelected = selected === key;
            return (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={`relative flex flex-col items-center rounded-xl border-2 overflow-hidden transition-all active:scale-95
                  ${isSelected
                    ? 'border-blue-400 shadow-lg shadow-blue-500/30 scale-105'
                    : 'border-slate-700 opacity-80'
                  }`}
              >
                <img
                  src={leader ? getSafeImageUrl(leader) : '/images/card_back.png'}
                  alt={leader?.name ?? key}
                  className="w-full object-contain bg-slate-800"
                  style={{ height: '5rem' }}
                  onError={e => { e.target.src = '/images/card_back.png'; }}
                />
                <div className="w-full bg-slate-900 px-1 py-1.5">
                  <p className="text-white text-[9px] font-bold truncate text-center leading-tight">
                    {leader?.name ?? key}
                  </p>
                  <p className="text-slate-500 text-[8px] text-center mt-0.5">{cardCount} cards</p>
                </div>
                {isSelected && (
                  <div className="absolute top-1 right-1 bg-blue-600 rounded-full w-5 h-5 flex items-center justify-center shadow">
                    <span className="text-white text-[11px] font-black">✓</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Confirm */}
      <div className="px-4 pb-8 pt-3 border-t border-slate-800">
        <button
          onClick={() => selected && onSelect(selected)}
          disabled={!selected}
          className={`w-full py-4 font-black text-sm rounded-2xl active:scale-95 transition-all
            ${selected
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
        >
          {selectedEntry
            ? `Challenge ${selectedEntry.leader?.name ?? selected}`
            : 'Select an opponent deck'}
        </button>
      </div>
    </div>
  );
}
