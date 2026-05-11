import React, { useState } from 'react';
import { getSafeImageUrl } from '../../../utils/cardHelpers';
import CardPreview from './CardPreview';

export default function TrashModal({ trash = [], label, onClose }) {
  const [preview, setPreview] = useState(null); // { card, x, y }

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

        {/* Card grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {trash.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm font-bold">
              No cards in trash
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(4rem, 1fr))' }}>
              {[...trash].reverse().map((card, i) => (
                <div
                  key={`${card.id}-${i}`}
                  className="flex flex-col items-center gap-0.5"
                  onMouseMove={e => setPreview({ card, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setPreview(null)}
                >
                  <img
                    src={getSafeImageUrl(card)}
                    alt={card.name}
                    className="w-16 rounded-lg object-cover border border-slate-700 shadow cursor-pointer"
                    style={{ height: '5.5rem' }}
                    onError={e => { e.target.src = '/images/card_back.png'; }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {preview && <CardPreview card={preview.card} x={preview.x} y={preview.y} />}
    </div>
  );
}
