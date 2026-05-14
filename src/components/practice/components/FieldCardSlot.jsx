import React, { useState } from 'react';
import { getSafeImageUrl } from '../../../utils/cardHelpers';
import CardPreview from './CardPreview';

const DON_IMG = '/don.png';

export default function FieldCardSlot({
  fieldCard,
  label,
  isSelected,
  isTargetable,
  isAttacker,
  isSmall,
  onClick,
  empty,
  activePlayer,
  owner,
  battleRole,
  powerModDelta = 0,
  costModDelta = 0,
}) {
  const [previewPos, setPreviewPos] = useState(null);

  if (empty || !fieldCard) {
    return (
      <div
        className={`rounded-lg border-2 border-dashed border-slate-700 flex items-center justify-center ${isSmall ? 'w-12 h-16' : 'w-14 h-20'} text-slate-700 text-[8px] font-bold`}
        data-battle-role={battleRole || undefined}
      >
        {label || ''}
      </div>
    );
  }

  const { card, state: cardState, attachedDon, justDeployed, attackLocked, refreshLocked, restLocked, willBottomDeckAtEndOfTurn } = fieldCard;
  const isRested = cardState === 'rest';
  const imageUrl = getSafeImageUrl(card);
  const w = isSmall ? 'w-12' : 'w-14';
  const h = isSmall ? 'h-16' : 'h-20';

  const basePower   = card.power ?? null;
  const donBonus    = attachedDon * 1000;
  const isMyTurn    = activePlayer && owner && activePlayer === owner;
  const displayPower = basePower !== null
    ? (isMyTurn ? basePower + donBonus + powerModDelta : basePower + powerModDelta)
    : null;

  const borderClass = isSelected   ? 'border-blue-400 shadow-blue-400/50'
                    : isAttacker   ? 'border-yellow-400 shadow-yellow-400/50'
                    : isTargetable ? 'border-green-400 shadow-green-400/50'
                    : 'border-slate-600';

  return (
    <div
      className={`relative cursor-pointer select-none transition-transform active:scale-95 ${w}`}
      data-battle-role={battleRole || undefined}
      onClick={onClick}
      onMouseMove={e => setPreviewPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPreviewPos(null)}
    >
      {/* DON!! cards fanned behind right edge — each shows 15% of its width */}
      {/* Card 0 has highest zIndex (topmost), so each successive card peeks past it */}
      {attachedDon > 0 && Array.from({ length: attachedDon }).map((_, i) => (
        <img
          key={i}
          src={DON_IMG}
          alt="DON!!"
          className="absolute top-0 rounded-sm border border-teal-500 object-cover"
          style={{
            width: isSmall ? '3rem' : '3.5rem',
            height: isSmall ? '4rem' : '5rem',
            left: `${(i + 1) * (isSmall ? 0.45 : 0.525)}rem`,
            zIndex: attachedDon - i,
          }}
          onError={e => { e.target.style.display = 'none'; }}
        />
      ))}

      {/* Card image — sits on top of DON!! cards */}
      <div
        className={`relative rounded-lg border-2 overflow-hidden shadow-lg ${borderClass} ${isSelected || isTargetable || isAttacker ? 'shadow-lg' : ''}`}
        style={{
          transform: isRested ? 'rotate(90deg)' : 'none',
          transformOrigin: 'center center',
          transition: 'transform 0.2s ease',
          position: 'relative',
          zIndex: attachedDon + 2,
        }}
      >
        <img
          src={imageUrl}
          alt={card.name}
          className={`w-full object-cover ${h}`}
          onError={e => { e.target.src = '/images/card_back.png'; }}
        />
        {justDeployed && (
          <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center">
            <span className="text-[8px] font-black text-slate-300">Sick</span>
          </div>
        )}
        {/* Status lock badges */}
        {(attackLocked || refreshLocked || restLocked || willBottomDeckAtEndOfTurn) && (
          <div className="absolute top-0.5 left-0.5 flex flex-col gap-0.5 z-10 pointer-events-none">
            {attackLocked            && <span className="text-[7px] font-black px-0.5 py-px rounded bg-red-700/90    text-white leading-tight">NO ATK</span>}
            {refreshLocked           && <span className="text-[7px] font-black px-0.5 py-px rounded bg-violet-700/90 text-white leading-tight">NO ↺</span>}
            {restLocked              && <span className="text-[7px] font-black px-0.5 py-px rounded bg-orange-700/90 text-white leading-tight">NO REST</span>}
            {willBottomDeckAtEndOfTurn && <span className="text-[7px] font-black px-0.5 py-px rounded bg-cyan-700/90   text-white leading-tight">↩ EOT</span>}
          </div>
        )}
        {/* Cost modifier badge */}
        {costModDelta !== 0 && (
          <div className={`absolute top-0.5 right-0.5 text-white text-[9px] font-black px-1 rounded ${costModDelta > 0 ? 'bg-red-600/90' : 'bg-green-600/90'}`}>
            {costModDelta > 0 ? `+${costModDelta}` : `${costModDelta}`}
          </div>
        )}
      </div>

      {/* Power label */}
      <div className="text-center text-[9px] font-bold mt-0.5 truncate" style={{ position: 'relative', zIndex: 1 }}>
        {displayPower !== null ? (
          <span className={
            powerModDelta < 0 ? 'text-red-400' :
            powerModDelta > 0 ? 'text-green-400' :
            (donBonus > 0 && isMyTurn ? 'text-teal-300' : 'text-slate-300')
          }>
            {displayPower.toLocaleString()}
          </span>
        ) : null}
      </div>

      {previewPos && <CardPreview card={card} x={previewPos.x} y={previewPos.y} />}
    </div>
  );
}
