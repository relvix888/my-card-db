import React from 'react';
import { useTranslation } from 'react-i18next';
import { PLAYER } from '../engine/constants';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';

export default function MulliganScreen({ state: S, dispatch: D, onClose }) {
  const humanFirst = S.firstPlayer === PLAYER.HUMAN;
  const { i18n } = useTranslation();
  const isChinese = i18n.language.split('-')[0] !== 'en';

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col z-50" style={{ height: '100dvh' }}>
      {/* Back button */}
      <div className="flex items-center px-4 pt-3 pb-1 flex-shrink-0">
        <button onClick={onClose} className="text-slate-400 hover:text-white text-sm font-bold">← Back</button>
      </div>

      {/* Top 50%: Leader images */}
      <div className="flex flex-shrink-0" style={{ height: '50%' }}>
        {/* Human leader — left */}
        <div className="flex-1 relative overflow-hidden bg-slate-900">
          <img
            src={S.human.leader?.card ? getSafeImageUrl(S.human.leader.card) : cardBackImg}
            alt="Your Leader"
            className="w-full h-full object-contain"
            onError={e => { e.target.src = cardBackImg; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
          <div className={`absolute bottom-3 left-0 right-0 flex justify-center`}>
            <span className={`text-sm font-black px-4 py-1.5 rounded-full shadow-lg ${humanFirst ? 'bg-emerald-500 text-white shadow-emerald-500/40' : 'bg-slate-600 text-slate-200'}`}>
              {humanFirst ? (isChinese ? '先攻' : 'Going First') : (isChinese ? '後攻' : 'Going Second')}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px bg-slate-700 flex-shrink-0" />

        {/* AI leader — right */}
        <div className="flex-1 relative overflow-hidden bg-slate-900">
          <img
            src={S.ai.leader?.card ? getSafeImageUrl(S.ai.leader.card) : cardBackImg}
            alt="Opponent Leader"
            className="w-full h-full object-contain"
            onError={e => { e.target.src = cardBackImg; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
          <div className={`absolute bottom-3 left-0 right-0 flex justify-center`}>
            <span className={`text-sm font-black px-4 py-1.5 rounded-full shadow-lg ${!humanFirst ? 'bg-emerald-500 text-white shadow-emerald-500/40' : 'bg-slate-600 text-slate-200'}`}>
              {!humanFirst ? (isChinese ? '先攻' : 'Going First') : (isChinese ? '後攻' : 'Going Second')}
            </span>
          </div>
        </div>
      </div>

      {/* Middle ~56%: 5 starting hand cards */}
      <div className="flex-1 flex items-center justify-center gap-2 px-3 py-4">
        {S.human.hand.map((card, i) => (
          <div
            key={`${card.id}-${i}`}
            className="flex-1 relative rounded-xl overflow-hidden shadow-lg border border-slate-700"
            style={{ maxWidth: '19%', aspectRatio: '2/3' }}
          >
            <img
              src={getSafeImageUrl(card)}
              alt={card.name}
              className="w-full h-full object-cover"
              onError={e => { e.target.src = cardBackImg; }}
            />
            <div className="absolute top-1 left-1 bg-slate-900/80 text-white text-[9px] font-black px-1 rounded">
              {card.cost ?? '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Buttons */}
      <div className="flex gap-3 px-4 pb-8 pt-2 flex-shrink-0">
        <button
          onClick={() => D({ type: 'MULLIGAN_REDRAW' })}
          className="flex-1 py-4 bg-orange-700 hover:bg-orange-600 text-white font-black text-sm rounded-2xl active:scale-95 transition-all"
        >
          {isChinese ? '重洗' : 'Mulligan (Redraw 5)'}
        </button>
        <button
          onClick={() => D({ type: 'MULLIGAN_KEEP' })}
          className="flex-1 py-4 bg-emerald-700 hover:bg-emerald-600 text-white font-black text-sm rounded-2xl active:scale-95 transition-all"
        >
          {isChinese ? '可以開始' : 'Keep Hand'}
        </button>
      </div>
    </div>
  );
}
