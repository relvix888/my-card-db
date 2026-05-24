import React, { useState } from 'react';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';

export default function PreGameAbilityScreen({ state: S, dispatch: D, onClose, myRole }) {
  const [selectedStageIndex, setSelectedStageIndex] = useState(null);

  const owner = S.preGameAbilityOwner ?? 'human';
  const ownerPs = S[owner];
  const stageCards = ownerPs.deck
    .map((card, i) => ({ card, deckIndex: i }))
    .filter(({ card }) => card.category === 'Stage');

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col z-50">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <button onClick={onClose} className="text-slate-400 hover:text-white text-sm font-bold">← Back</button>
        <span className="text-slate-300 font-black text-sm tracking-wide">Leader Ability</span>
        <span className="w-16" />
      </div>

      <div className="flex items-center gap-3 px-4 pb-3">
        <img
          src={ownerPs.leader?.card ? getSafeImageUrl(ownerPs.leader.card) : cardBackImg}
          alt="Leader"
          className="w-10 h-14 object-cover rounded-lg border border-slate-600"
          onError={e => { e.target.src = cardBackImg; }}
        />
        <div>
          <p className="text-white font-black text-sm">{ownerPs.leader?.card?.name}</p>
          <p className="text-slate-400 text-xs">Before drawing your opening hand</p>
        </div>
      </div>

      <div className="px-4 pb-3">
        <p className="text-yellow-300 text-xs font-bold text-center">
          You may place 1 Stage card from your deck into your Stage area for free.
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-center px-4">
        {stageCards.length === 0 ? (
          <p className="text-slate-500 text-sm text-center">No Stage cards in deck.</p>
        ) : (
          <>
            <p className="text-slate-400 text-xs font-bold mb-3 text-center">
              Stage cards in deck ({stageCards.length})
            </p>
            <div className="flex gap-2 justify-center overflow-x-auto pb-2 flex-wrap">
              {stageCards.map(({ card, deckIndex }) => (
                <div
                  key={`${card.id}-${deckIndex}`}
                  className="flex-shrink-0 relative cursor-pointer"
                  onClick={() => setSelectedStageIndex(prev => prev === deckIndex ? null : deckIndex)}
                >
                  <img
                    src={getSafeImageUrl(card)}
                    alt={card.name}
                    className={`w-16 rounded-xl object-cover border-2 shadow-lg transition-all ${
                      selectedStageIndex === deckIndex
                        ? 'border-yellow-400 scale-105'
                        : 'border-slate-600'
                    }`}
                    style={{ height: '5.5rem' }}
                    onError={e => { e.target.src = cardBackImg; }}
                  />
                  <div className="absolute top-1 left-1 bg-slate-900/80 text-white text-[9px] font-black px-1 rounded">
                    {card.cost ?? '—'}
                  </div>
                  {selectedStageIndex === deckIndex && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-yellow-400/20">
                      <span className="text-yellow-300 text-2xl font-black drop-shadow">✓</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex gap-3 px-4 pb-8 pt-4">
        <button
          onClick={() => {
            setSelectedStageIndex(null);
            D({ type: 'LEADER_PRE_GAME_STAGE', cardIndex: null });
          }}
          className="flex-1 py-4 bg-slate-700 hover:bg-slate-600 text-white font-black text-sm rounded-2xl active:scale-95 transition-all"
        >
          Skip
        </button>
        <button
          onClick={() => {
            if (selectedStageIndex == null) return;
            D({ type: 'LEADER_PRE_GAME_STAGE', cardIndex: selectedStageIndex });
            setSelectedStageIndex(null);
          }}
          disabled={selectedStageIndex == null}
          className={`flex-1 py-4 text-white font-black text-sm rounded-2xl active:scale-95 transition-all ${
            selectedStageIndex != null
              ? 'bg-yellow-600 hover:bg-yellow-500'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          Place for Free
        </button>
      </div>
    </div>
  );
}
