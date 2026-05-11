import React from 'react';
import ReactDOM from 'react-dom';
import { getSafeImageUrl } from '../../../utils/cardHelpers';

const PREVIEW_W = 200;
const PREVIEW_H = Math.round(PREVIEW_W * 1.4);

export default function CardPreview({ card, x, y }) {
  if (!card) return null;

  let left = x + 20;
  let top  = y - PREVIEW_H / 2;

  if (left + PREVIEW_W > window.innerWidth  - 8) left = x - PREVIEW_W - 20;
  if (top < 8)                                    top  = 8;
  if (top + PREVIEW_H > window.innerHeight - 8)  top  = window.innerHeight - PREVIEW_H - 8;

  return ReactDOM.createPortal(
    <div
      className="fixed pointer-events-none drop-shadow-2xl"
      style={{ left, top, zIndex: 999 }}
    >
      <img
        src={getSafeImageUrl(card)}
        alt={card.name}
        className="rounded-xl border border-white/20"
        style={{ width: PREVIEW_W, height: PREVIEW_H, objectFit: 'cover' }}
        onError={e => { e.target.src = '/back.png'; }}
      />
    </div>,
    document.body
  );
}
