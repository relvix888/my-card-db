import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { getSafeImageUrl } from '../../../utils/cardHelpers';

const LABEL_CONFIG = {
  KO:            { symbol: '☠',  text: 'KO',           bg: 'bg-red-600/90' },
  BOTTOM_DECK:   { symbol: '⬇',  text: 'Bottom Deck',  bg: 'bg-slate-600/90' },
  TOP_DECK:      { symbol: '⬆',  text: 'Top of Deck',  bg: 'bg-slate-600/90' },
  RETURN_HAND:   { symbol: '↩',  text: 'Return',        bg: 'bg-amber-500/90' },
  ADD_LIFE:      { symbol: '❤',  text: 'Add to Life',   bg: 'bg-emerald-600/90' },
  LIFE_TO_TRASH: { symbol: '🗑', text: '→ Trash',       bg: 'bg-red-700/90' },
  DECK_TO_LIFE:  { symbol: '❤',  text: '→ Life',        bg: 'bg-emerald-600/90' },
  DRAW:          { symbol: '🎴', text: 'Draw',           bg: 'bg-blue-600/90' },
  PLAY_CHARACTER:{ symbol: '⚔',  text: 'Deploy',        bg: 'bg-violet-600/90' },
  PLAY_STAGE:    { symbol: '🏝', text: 'Stage',          bg: 'bg-amber-600/90' },
  PLAY_EVENT:    { symbol: '✨', text: 'Event',          bg: 'bg-purple-600/90' },
  COUNTER:       { symbol: '🛡', text: 'Counter',        bg: 'bg-cyan-600/90' },
  DISCARD:       { symbol: '🗑', text: 'Discard',        bg: 'bg-red-600/90' },
  LIFE_TO_HAND:  { symbol: '🤲', text: 'Life → Hand',   bg: 'bg-teal-600/90' },
};

const LABEL_FLOW = {
  DRAW:          { from: 'deck',      to: 'hand'      },
  PLAY_CHARACTER:{ from: 'hand',      to: 'character' },
  PLAY_STAGE:    { from: 'hand',      to: 'stage'     },
  PLAY_EVENT:    { from: 'hand',      to: 'trash'     },
  COUNTER:       { from: 'hand',      to: 'trash'     },
  DISCARD:       { from: 'hand',      to: 'trash'     },
  KO:            { from: 'character', to: 'trash'     },
  ADD_LIFE:      { from: 'hand',      to: 'life'      },
  LIFE_TO_TRASH: { from: 'life',      to: 'trash'     },
  LIFE_TO_HAND:  { from: 'life',      to: 'hand'      },
  DECK_TO_LIFE:  { from: 'deck',      to: 'life'      },
  BOTTOM_DECK:   { from: 'hand',      to: 'deck'      },
  TOP_DECK:      { from: 'hand',      to: 'deck'      },
  RETURN_HAND:   { from: 'character', to: 'hand'      },
};

const ZONE_CONFIG = {
  deck:      { label: 'Deck',  icon: '🃏', bg: 'bg-slate-600' },
  hand:      { label: 'Hand',  icon: '✋', bg: 'bg-blue-700'  },
  character: { label: 'Field', icon: '⚔', bg: 'bg-violet-700' },
  stage:     { label: 'Stage', icon: '🏝', bg: 'bg-amber-700' },
  life:      { label: 'Life',  icon: '❤', bg: 'bg-emerald-700' },
  trash:     { label: 'Trash', icon: '🗑', bg: 'bg-red-700'   },
};

export default function CardFlashOverlay({ flashItem }) {
  const [display, setDisplay] = useState(null);

  useEffect(() => {
    if (!flashItem?.card) return;
    setDisplay({ card: flashItem.card, counterBonus: flashItem.counterBonus ?? null, label: flashItem.label ?? null, faceDown: flashItem.faceDown ?? false, fading: false });
    const fadeOut = setTimeout(() => setDisplay(d => d ? { ...d, fading: true } : d), 1000);
    const hide    = setTimeout(() => setDisplay(null), 1300);
    return () => { clearTimeout(fadeOut); clearTimeout(hide); };
  }, [flashItem?.id]); // eslint-disable-line

  if (!display) return null;

  const labelCfg = display.label ? LABEL_CONFIG[display.label] : null;
  const flow = display.label ? LABEL_FLOW[display.label] : null;
  const imgSrc = display.faceDown ? '/images/card_back.png' : getSafeImageUrl(display.card);

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center pointer-events-none"
      style={{ zIndex: 200, opacity: display.fading ? 0 : 1, transition: 'opacity 300ms ease-out' }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative flex flex-col items-center">
        <img
          src={imgSrc}
          alt={display.faceDown ? 'Card' : display.card.name}
          className="rounded-2xl shadow-2xl border-2 border-white/40"
          style={{ height: '52vh', width: 'auto', objectFit: 'contain' }}
          onError={e => { e.target.src = '/images/card_back.png'; }}
        />
        {display.counterBonus && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-600/90 text-white font-black rounded-full px-4 py-1 text-xl shadow-lg border border-white/30 whitespace-nowrap">
            +{display.counterBonus.toLocaleString()}
          </div>
        )}
        {labelCfg && !display.counterBonus && (
          <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${labelCfg.bg} text-white font-black rounded-full px-4 py-1 text-xl shadow-lg border border-white/30 whitespace-nowrap flex items-center gap-2`}>
            <span>{labelCfg.symbol}</span>
            <span>{labelCfg.text}</span>
          </div>
        )}
        {flow && (
          <div className="flex items-center gap-2 mt-3">
            <span className={`${ZONE_CONFIG[flow.from].bg} text-white text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow`}>
              <span>{ZONE_CONFIG[flow.from].icon}</span>
              <span>{ZONE_CONFIG[flow.from].label}</span>
            </span>
            <span className="text-white/80 text-sm font-bold">→</span>
            <span className={`${ZONE_CONFIG[flow.to].bg} text-white text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow`}>
              <span>{ZONE_CONFIG[flow.to].icon}</span>
              <span>{ZONE_CONFIG[flow.to].label}</span>
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
