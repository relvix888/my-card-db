import React, { useState } from 'react';
import { PLAYER } from '../engine/constants';
import { getSafeImageUrl } from '../../../utils/cardHelpers';

export default function MulliganScreen({ state: S, dispatch: D, onClose }) {
  const [hoveredCard, setHoveredCard] = useState(null);

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col z-50">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <button onClick={onClose} className="text-slate-400 hover:text-white text-sm font-bold">← Back</button>
        <div className="flex flex-col items-center">
          <span className={`text-2xl font-black tracking-tight ${S.firstPlayer === PLAYER.HUMAN ? 'text-emerald-400' : 'text-orange-400'}`}>
            {S.firstPlayer === PLAYER.HUMAN ? 'You Go First!' : 'Opponent Goes First'}
          </span>
          <span className="text-slate-500 text-xs mt-0.5">Opening Hand</span>
        </div>
        <span className="w-16" />
      </div>

      <div className="flex items-center gap-3 px-4 pb-3">
        <img
          src={S.human.leader?.card ? getSafeImageUrl(S.human.leader.card) : '/images/card_back.png'}
          alt="Leader"
          className="w-10 h-14 object-cover rounded-lg border border-slate-600"
          onError={e => { e.target.src = '/images/card_back.png'; }}
        />
        <div>
          <p className="text-white font-black text-sm">{S.human.leader?.card?.name}</p>
          <p className="text-slate-400 text-xs">Life: {S.human.lifeArea?.length ?? '—'} · Deck: {S.human.deck.length}</p>
        </div>
      </div>

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

      <div className="px-4 pb-2">
        <p className="text-slate-400 text-xs font-bold mb-2 text-center">Your 5-card starting hand</p>
        <div className="flex gap-2 justify-center overflow-x-auto pb-1">
          {S.human.hand.map((card, i) => (
            <div
              key={`${card.id}-${i}`}
              className="flex-shrink-0 relative cursor-pointer"
              onMouseEnter={() => setHoveredCard(card)}
              onMouseLeave={() => setHoveredCard(null)}
              onTouchStart={() => setHoveredCard(card)}
              onTouchEnd={() => setHoveredCard(null)}
            >
              <img
                src={getSafeImageUrl(card)}
                alt={card.name}
                className="w-16 rounded-xl object-cover border-2 border-slate-600 shadow-lg hover:border-slate-300 transition-all"
                style={{ height: '5.5rem' }}
                onError={e => { e.target.src = '/images/card_back.png'; }}
              />
              <div className="absolute top-1 left-1 bg-slate-900/80 text-white text-[9px] font-black px-1 rounded">
                {card.cost ?? '—'}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 px-4 pb-8 pt-3">
        <button
          onClick={() => D({ type: 'MULLIGAN_REDRAW' })}
          className="flex-1 py-4 bg-orange-700 hover:bg-orange-600 text-white font-black text-sm rounded-2xl active:scale-95 transition-all"
        >
          Mulligan (Redraw 5)
        </button>
        <button
          onClick={() => D({ type: 'MULLIGAN_KEEP' })}
          className="flex-1 py-4 bg-emerald-700 hover:bg-emerald-600 text-white font-black text-sm rounded-2xl active:scale-95 transition-all"
        >
          Keep Hand
        </button>
      </div>
    </div>
  );
}
