import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import deckFinalData from '../../../data/deck_final.json';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';

const COLOR_ORDER = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];

const SORT_MODES = [
  { key: 'popularity', label: 'Popular' },
  { key: 'number',     label: 'Number'  },
  { key: 'color',      label: 'Color'   },
];

export default function AiDeckPicker({ cards, onSelect, onClose }) {
  const { i18n } = useTranslation();
  const isEn = i18n.language.startsWith('en');
  const [selected, setSelected] = useState(null);
  const [sortBy, setSortBy] = useState('popularity');

  const deckEntries = useMemo(() =>
    Object.entries(deckFinalData).map(([key, val]) => ({
      key,
      deckStr: val.deck,
      count: val.count ?? 0,
      leader: cards?.find(c => c.id === key) ?? null,
    })),
  [cards]);

  const sortedEntries = useMemo(() => {
    const entries = [...deckEntries];
    if (sortBy === 'popularity') {
      entries.sort((a, b) => b.count - a.count);
    } else if (sortBy === 'number') {
      entries.sort((a, b) => a.key.localeCompare(b.key));
    } else if (sortBy === 'color') {
      entries.sort((a, b) => {
        const ca = (a.leader?.colors?.[0] ?? '').toLowerCase();
        const cb = (b.leader?.colors?.[0] ?? '').toLowerCase();
        const ia = COLOR_ORDER.indexOf(ca);
        const ib = COLOR_ORDER.indexOf(cb);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
    }
    return entries;
  }, [deckEntries, sortBy]);

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

      {/* Sort bar */}
      <div className="flex gap-1.5 px-3 py-2 border-b border-slate-800">
        {SORT_MODES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSortBy(key)}
            className={`flex-1 py-1 rounded-lg text-[11px] font-bold transition-all
              ${sortBy === key
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Deck grid */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="grid grid-cols-3 gap-3">
          {sortedEntries.map(({ key, leader }) => {
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
                <div className="relative w-full overflow-hidden bg-slate-800" style={{ height: '5rem' }}>
                  <img
                    src={leader ? getSafeImageUrl(leader) : cardBackImg}
                    alt={leader?.name ?? key}
                    className="absolute"
                    style={{ width: '160%', left: '50%', transform: 'translateX(-50%) translateY(-10%)' }}
                    onError={e => { e.target.src = cardBackImg; }}
                  />
                </div>
                <div className="w-full bg-slate-900 px-1 py-1.5">
                  <p className="text-white text-[9px] font-bold truncate text-center leading-tight">
                    {(isEn ? (leader?.enName ?? leader?.name) : leader?.name) ?? key}
                  </p>
                  <p className="text-slate-500 text-[8px] text-center mt-0.5">{key}</p>
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
            ? `Challenge ${(isEn ? (selectedEntry.leader?.enName ?? selectedEntry.leader?.name) : selectedEntry.leader?.name) ?? selected}`
            : 'Select an opponent deck'}
        </button>
      </div>
    </div>
  );
}
