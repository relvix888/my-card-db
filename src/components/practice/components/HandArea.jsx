import React, { useState } from 'react';
import { getSafeImageUrl } from '../../../utils/cardHelpers';
import CardPreview from './CardPreview';

// Player's hand — scrollable row of face-up cards.
export default function HandArea({ hand = [], costDeltas = [], selectedIndex, onCardClick, highlightIndices }) {
  const [preview, setPreview] = useState(null); // { card, x, y }

  if (hand.length === 0) {
    return (
      <div className="h-20 flex items-center justify-center text-slate-600 text-xs font-bold">
        Hand is empty
      </div>
    );
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto px-2 py-2 scrollbar-hide snap-x">
      {hand.map((card, i) => {
        const isSelected   = selectedIndex === i;
        const isHighlighted = highlightIndices?.includes(i);
        const costDelta = costDeltas[i] ?? 0;
        return (
          <div
            key={`${card.id}-${i}`}
            className={`
              relative flex-shrink-0 snap-start cursor-pointer select-none
              transition-transform active:scale-95
              ${isSelected ? '-translate-y-3' : ''}
            `}
            onClick={() => onCardClick(i)}
            onMouseMove={e => setPreview({ card, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setPreview(null)}
          >
            <div className={`
              w-14 h-20 rounded-lg border-2 overflow-hidden shadow-lg
              ${isSelected   ? 'border-blue-400 shadow-blue-400/50'   : ''}
              ${isHighlighted && !isSelected ? 'border-yellow-400 shadow-yellow-400/40' : ''}
              ${!isSelected && !isHighlighted ? 'border-slate-600' : ''}
            `}>
              <img
                src={getSafeImageUrl(card)}
                alt={card.name}
                className="w-full h-full object-cover"
                onError={e => { e.target.src = '/images/card_back.png'; }}
              />
            </div>
            {/* Cost badge */}
            <div className="absolute top-0.5 left-0.5 bg-slate-900/80 text-white text-[9px] font-black px-1 rounded">
              {card.cost ?? '—'}
            </div>
            {/* Cost modifier badge */}
            {costDelta !== 0 && (
              <div className={`absolute top-0.5 right-0.5 text-white text-[9px] font-black px-1 rounded ${costDelta > 0 ? 'bg-red-600/90' : 'bg-green-600/90'}`}>
                {costDelta > 0 ? `+${costDelta}` : `${costDelta}`}
              </div>
            )}
            {/* Counter badge */}
            {card.counter > 0 && (
              <div className="absolute bottom-0.5 right-0.5 bg-emerald-700/90 text-white text-[8px] font-bold px-1 rounded">
                +{(card.counter / 1000).toFixed(0)}k
              </div>
            )}
          </div>
        );
      })}
      {preview && <CardPreview card={preview.card} x={preview.x} y={preview.y} />}
    </div>
  );
}
