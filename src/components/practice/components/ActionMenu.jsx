import React from 'react';
import { useTranslation } from 'react-i18next';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';
import { formatEffectText } from '../../../utils/formatEffect';

// Context menu that appears when a card in hand is selected.
// Shows valid actions for the card in the current game state.
export default function ActionMenu({ card, actions, onAction, onClose }) {
  const { i18n } = useTranslation();
  const isEn = i18n.language.startsWith('en');
  if (!card) return null;

  const displayName   = isEn ? (card.enName ?? card.name)     : card.name;
  const displayEffect = isEn ? (card.enEffect ?? card.effect) : card.effect;
  const langCode      = isEn ? 'en' : 'zh';

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
    <div data-action-menu className="fixed bottom-32 left-0 right-0 z-50 px-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Card preview */}
        <div className="flex items-center gap-3 p-3 border-b border-slate-700">
          <img
            src={getSafeImageUrl(card)}
            alt={displayName}
            className="w-12 h-16 rounded-lg object-cover border border-slate-600"
            onError={e => { e.target.src = cardBackImg; }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-sm truncate">{displayName}</p>
            <p className="text-slate-400 text-xs">{card.category}</p>
            {displayEffect && (
              <p
                className="text-slate-300 text-xs mt-1 line-clamp-3"
                dangerouslySetInnerHTML={{ __html: formatEffectText(displayEffect.replace(/<br\s*\/?>/gi, ' '), langCode) }}
              />
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
    </>
  );
}
