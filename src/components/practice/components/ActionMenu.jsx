import React from 'react';
import { getSafeImageUrl } from '../../../utils/cardHelpers';

// Context menu that appears when a card in hand is selected.
// Shows valid actions for the card in the current game state.
export default function ActionMenu({ card, actions, onAction, onClose }) {
  if (!card) return null;

  return (
    <div className="fixed bottom-32 left-0 right-0 z-50 px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Card preview */}
        <div className="flex items-center gap-3 p-3 border-b border-slate-700">
          <img
            src={getSafeImageUrl(card)}
            alt={card.name}
            className="w-12 h-16 rounded-lg object-cover border border-slate-600"
            onError={e => { e.target.src = '/images/card_back.png'; }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-sm truncate">{card.name}</p>
            <p className="text-slate-400 text-[10px]">
              {card.category} · Cost {card.cost ?? '—'} · Power {card.power?.toLocaleString() ?? '—'}
            </p>
            {card.effect && (
              <p className="text-slate-500 text-[9px] mt-1 line-clamp-2">{card.effect.replace(/<br>/g, ' ')}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none p-1">×</button>
        </div>

        {/* Actions */}
        <div className="flex flex-col divide-y divide-slate-800">
          {actions.map(action => (
            <button
              key={action.label}
              onClick={() => { onAction(action); onClose(); }}
              disabled={action.disabled}
              className={`
                flex items-center gap-3 px-4 py-3 text-left transition-colors
                ${action.disabled
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-white hover:bg-slate-800 active:bg-slate-700'}
              `}
            >
              <span className="text-lg">{action.icon}</span>
              <div>
                <p className="text-sm font-bold">{action.label}</p>
                {action.hint && <p className="text-[10px] text-slate-500">{action.hint}</p>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
