import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';
import { formatEffectText } from '../../../utils/formatEffect';

const ATTR_ZH = { slash: '斬', strike: '打', ranged: '射', special: '特', wisdom: '知' };
const ATTR_EN = { slash: 'Slash', strike: 'Strike', ranged: 'Ranged', special: 'Special', wisdom: 'Wisdom' };

function DetailPanel({ card }) {
  const { i18n } = useTranslation();
  const isEn = i18n.language.startsWith('en');
  const ATTR_MAP = isEn ? ATTR_EN : ATTR_ZH;
  const displayName    = isEn ? (card.enName ?? card.name)    : card.name;
  const effectText     = isEn ? (card.enEffect ?? card.effect) : card.effect;
  const triggerText    = isEn ? (card.enTrigger ?? card.trigger) : card.trigger;
  const langCode       = isEn ? 'en' : 'zh';
  const effectHtml  = effectText  ? formatEffectText(effectText.replace(/<br\s*\/?>/gi, '<br/>'), langCode)  : null;
  const triggerHtml = triggerText ? formatEffectText(triggerText.replace(/<br\s*\/?>/gi, '<br/>'), langCode) : null;
  const rawTypes    = isEn ? (card.enTypes ?? card.types) : card.types;
  const typeDisplay = Array.isArray(rawTypes) ? rawTypes.join(' / ') : rawTypes;
  const cardId      = card.id ? card.id.replace(/_p\d+$/, '') : null;

  return (
    <div
      className="flex gap-3 bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-3"
      style={{ maxWidth: 440, minWidth: 280 }}
    >
      {/* Card image */}
      <img
        src={getSafeImageUrl(card)}
        alt={card.name}
        className="rounded-lg flex-shrink-0 object-cover self-start"
        style={{ width: 100, height: 140 }}
        onError={e => { e.target.src = cardBackImg; }}
      />
      {/* Stats */}
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <p className="text-white font-black text-sm truncate">{displayName}</p>
        {cardId && (
          <p className="text-slate-500 text-xs font-mono flex items-center gap-1.5 flex-wrap">
            <span>{cardId}</span>
            {card.cost != null && <><span className="text-slate-600">|</span><span className="text-slate-300">{card.cost}</span></>}
            {card.power != null && <><span className="text-slate-600">|</span><span className="text-slate-400">{card.power.toLocaleString()}</span></>}
            {card.counter != null && <><span className="text-slate-600">|</span><span className="text-yellow-500">+{card.counter.toLocaleString()}</span></>}
            {card.attributes?.length > 0 && <><span className="text-slate-600">|</span><span className="text-cyan-400">{card.attributes.map(a => ATTR_MAP[a.toLowerCase()] ?? a).join('/')}</span></>}
          </p>
        )}
        {typeDisplay && <p className="text-slate-300 text-xs mt-0.5">{typeDisplay}</p>}
        {effectHtml && (
          <div
            className="mt-1 bg-slate-800/60 rounded p-1.5 text-xs text-slate-300 leading-snug overflow-y-auto"
            style={{ maxHeight: 160 }}
            dangerouslySetInnerHTML={{ __html: effectHtml }}
          />
        )}
        {triggerHtml && (
          <div
            className="mt-1 bg-yellow-900/30 border border-yellow-700/40 rounded p-1.5 text-xs text-yellow-200 leading-snug overflow-y-auto"
            style={{ maxHeight: 80 }}
            dangerouslySetInnerHTML={{ __html: triggerHtml }}
          />
        )}
      </div>
    </div>
  );
}

// Desktop: always pinned to top-centre of screen
function DesktopOverlay({ card }) {
  return ReactDOM.createPortal(
    <div className="fixed top-2 left-0 right-0 flex justify-center pointer-events-none z-[999]">
      <div className="drop-shadow-2xl">
        <DetailPanel card={card} />
      </div>
    </div>,
    document.body
  );
}

// Mobile: pinned to top of screen, no backdrop so action menu below stays usable
function MobileModal({ card, onClose }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        // Keep open when tapping buttons or other interactive UI (e.g. ActionMenu)
        if (e.target.closest('button, [role="button"]')) return;
        onClose();
      }
    };
    // Small delay so the triggering touch doesn't immediately close the panel
    const timer = setTimeout(() => {
      document.addEventListener('touchstart', handler, true);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('touchstart', handler, true);
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div className="fixed top-2 left-0 right-0 z-[999] flex justify-center px-3 pointer-events-none">
      <div ref={panelRef} className="relative pointer-events-auto">
        <DetailPanel card={card} />
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-700 border border-slate-500 text-white text-xs font-black flex items-center justify-center shadow-lg"
        >
          ×
        </button>
      </div>
    </div>,
    document.body
  );
}

/**
 * CardDetailOverlay
 * - Desktop (x+y provided): positioned panel near cursor, triggered by onMouseMove
 * - Mobile (no x/y, onClose provided): centred modal, triggered by long-press
 */
export default function CardDetailOverlay({ card, x, y, onClose }) {
  if (!card) return null;
  if (x != null && y != null) return <DesktopOverlay card={card} />;
  return <MobileModal card={card} onClose={onClose} />;
}
