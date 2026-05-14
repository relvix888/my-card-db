import React, { useState } from 'react';
import { getSafeImageUrl } from '../../../utils/cardHelpers';

export default function TrashModal({ trash = [], label, onClose }) {
  const [hoveredCard, setHoveredCard] = useState(null);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex flex-col"
      onClick={onClose}
    >
      <div
        className="flex-1 flex flex-col max-h-full overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 bg-slate-950 border-b border-slate-800 flex-shrink-0">
          <span className="text-white font-black text-sm">{label} Trash — {trash.length} card{trash.length !== 1 ? 's' : ''}</span>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold leading-none px-2"
          >
            ×
          </button>
        </div>

        {/* Middle: enlarged card preview */}
        <div className="flex-1 flex items-center justify-center px-4">
          {hoveredCard ? (
            <img
              src={getSafeImageUrl(hoveredCard)}
              alt={hoveredCard.name}
              className="rounded-2xl shadow-2xl object-contain border-2 border-slate-400"
              style={{ maxHeight: '100%', maxWidth: '55%' }}
              onError={e => { e.target.src = '/images/card_back.png'; }}
            />
          ) : (
            <p className="text-slate-600 text-sm select-none">Hover a card to preview</p>
          )}
        </div>

        {/* Card grid */}
        <div className="flex-shrink-0 max-h-48 overflow-y-auto p-3 border-t border-slate-800">
          {trash.length === 0 ? (
            <div className="flex items-center justify-center h-16 text-slate-500 text-sm font-bold">
              No cards in trash
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(4rem, 1fr))' }}>
              {[...trash].reverse().map((card, i) => (
                <div
                  key={`${card.id}-${i}`}
                  className="flex flex-col items-center gap-0.5"
                  onMouseEnter={() => setHoveredCard(card)}
                  onMouseLeave={() => setHoveredCard(null)}
                  onTouchStart={() => setHoveredCard(card)}
                  onTouchEnd={() => setHoveredCard(null)}
                >
                  <img
                    src={getSafeImageUrl(card)}
                    alt={card.name}
                    className="w-16 rounded-lg object-cover border border-slate-700 hover:border-slate-300 shadow cursor-pointer transition-all"
                    style={{ height: '5.5rem' }}
                    onError={e => { e.target.src = '/images/card_back.png'; }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
