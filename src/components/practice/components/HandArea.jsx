import React, { useState, useRef, useEffect } from 'react';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';
import CardDetailOverlay from './CardDetailOverlay';
import CardPreview from './CardPreview';

export default function HandArea({ hand = [], costDeltas = [], selectedIndex, onCardClick, highlightIndices, isCompact = false, disableStats = false, onReorder, scrollRef }) {
  const [preview, setPreview] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const isTouching = useRef(false);
  const touchTriggered = useRef(false);
  const isDragging = useRef(false);
  const suppressNextClick = useRef(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const containerRef = useRef(null);

  useEffect(() => {
    if (selectedIndex === null) setMobileDetail(null);
  }, [selectedIndex]);

  // Non-passive touchmove listener so we can preventDefault during drag to block scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => { if (isDragging.current) e.preventDefault(); };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, []);

  const cardW = isCompact ? 'w-11' : 'w-14';
  const cardH = isCompact ? 'h-16' : 'h-20';

  function getCardIndexFromClientX(clientX) {
    if (!containerRef.current) return null;
    const cards = containerRef.current.querySelectorAll('[data-hand-index]');
    let closest = null;
    let closestDist = Infinity;
    cards.forEach(el => {
      const rect = el.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const dist = Math.abs(center - clientX);
      if (dist < closestDist) { closestDist = dist; closest = parseInt(el.dataset.handIndex); }
    });
    return closest;
  }

  if (hand.length === 0) {
    return (
      <div className="h-16 flex items-center justify-center text-slate-600 text-xs font-bold">
        Hand is empty
      </div>
    );
  }

  return (
    <div ref={(el) => { containerRef.current = el; if (scrollRef) scrollRef.current = el; }} className="flex gap-1.5 overflow-x-auto px-2 py-2 scrollbar-hide snap-x">
      {hand.map((card, i) => {
        const isSelected    = selectedIndex === i;
        const isHighlighted = highlightIndices?.includes(i);
        const costDelta     = costDeltas[i] ?? 0;
        const isDragged     = dragIndex === i;
        const isDropTarget  = dragOverIndex === i && dragIndex !== null && dragIndex !== i;

        return (
          <div
            key={`${card.id}-${i}`}
            data-hand-index={i}
            draggable
            className={`
              relative flex-shrink-0 snap-start cursor-pointer select-none transition-transform
              ${isSelected && !isDragged ? '-translate-y-3' : ''}
              ${isDragged ? 'opacity-40 scale-95' : ''}
              ${isDropTarget ? 'scale-105' : ''}
            `}
            // ── Desktop HTML5 drag ──────────────────────────────────────────
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDragIndex(i);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverIndex !== i) setDragOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== i) onReorder?.(dragIndex, i);
              setDragIndex(null);
              setDragOverIndex(null);
            }}
            onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
            // ── Mobile touch drag ───────────────────────────────────────────
            onTouchStart={(e) => {
              isTouching.current = true;
              isDragging.current = false;
              touchStartX.current = e.touches[0].clientX;
              touchStartY.current = e.touches[0].clientY;
              if (!disableStats) touchTriggered.current = true;
            }}
            onTouchMove={(e) => {
              const dx = e.touches[0].clientX - touchStartX.current;
              const dy = e.touches[0].clientY - touchStartY.current;
              // Enter drag mode on horizontal movement
              if (!isDragging.current && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                isDragging.current = true;
                touchTriggered.current = false;
                setDragIndex(i);
              }
              if (isDragging.current) {
                const target = getCardIndexFromClientX(e.touches[0].clientX);
                if (target !== null && target !== dragOverIndex) setDragOverIndex(target);
              }
            }}
            onTouchEnd={() => {
              setTimeout(() => { isTouching.current = false; }, 300);
              if (isDragging.current) {
                if (dragOverIndex !== null && dragOverIndex !== i) onReorder?.(i, dragOverIndex);
                setDragIndex(null);
                setDragOverIndex(null);
                isDragging.current = false;
                touchTriggered.current = false;
                suppressNextClick.current = true;
              }
            }}
            // ── Click / hover ───────────────────────────────────────────────
            onClick={() => {
              if (suppressNextClick.current) { suppressNextClick.current = false; return; }
              if (touchTriggered.current) { setMobileDetail(card); touchTriggered.current = false; }
              onCardClick(i);
            }}
            onMouseMove={e => { if (!isTouching.current && !disableStats) setPreview({ card, x: e.clientX, y: e.clientY }); }}
            onMouseLeave={() => setPreview(null)}
          >
            <div className={`
              ${cardW} ${cardH} rounded-lg border-2 overflow-hidden shadow-lg
              ${isDropTarget ? 'border-blue-300 border-dashed shadow-blue-300/50' : ''}
              ${isSelected && !isDragged && !isDropTarget ? 'border-blue-400 shadow-blue-400/50' : ''}
              ${isHighlighted && !isSelected && !isDropTarget ? 'border-yellow-400 shadow-yellow-400/40' : ''}
              ${!isSelected && !isHighlighted && !isDropTarget ? 'border-slate-600' : ''}
            `}>
              <img
                src={getSafeImageUrl(card)}
                alt={card.name}
                className="w-full h-full object-cover"
                onError={e => { e.target.src = cardBackImg; }}
              />
            </div>
            <div className="absolute top-0.5 left-0.5 bg-slate-900/80 text-white text-[9px] font-black px-1 rounded">
              {card.cost ?? '—'}
            </div>
            {costDelta !== 0 && (
              <div className={`absolute top-0.5 right-0.5 text-white text-[9px] font-black px-1 rounded ${costDelta > 0 ? 'bg-red-600/90' : 'bg-green-600/90'}`}>
                {costDelta > 0 ? `+${costDelta}` : `${costDelta}`}
              </div>
            )}
            {card.counter > 0 && (
              <div className="absolute bottom-0.5 right-0.5 bg-emerald-700/90 text-white text-[8px] font-bold px-1 rounded">
                +{(card.counter / 1000).toFixed(0)}k
              </div>
            )}
          </div>
        );
      })}
      {preview && <CardDetailOverlay card={preview.card} x={preview.x} y={preview.y} />}
      {mobileDetail && <CardDetailOverlay card={mobileDetail} onClose={() => setMobileDetail(null)} />}
    </div>
  );
}
