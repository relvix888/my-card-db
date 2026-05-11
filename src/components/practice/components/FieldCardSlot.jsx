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

  const { card, state: cardState, attachedDon, justDeployed } = fieldCard;
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
      {/* DON!! cards peeking from the bottom edge — behind the main card */}
      {attachedDon > 0 && (
        <div
          className="absolute bottom-0 left-0 right-0 flex justify-center"
          style={{ zIndex: 0 }}
        >
          {Array.from({ length: attachedDon }).map((_, i) => (
            <img
              key={i}
              src={DON_IMG}
              alt="DON!!"
              className="object-cover rounded-sm border border-teal-500"
              style={{
                width: isSmall ? '1.4rem' : '1.6rem',
                height: isSmall ? '2rem' : '2.2rem',
                marginLeft: i > 0 ? (isSmall ? '-16px' : '-18px') : 0,
                zIndex: i,
                marginBottom: isSmall ? '-12px' : '-14px',
              }}
              onError={e => { e.target.style.display = 'none'; }}
            />
          ))}
        </div>
      )}

      {/* Card image — sits on top of DON!! cards */}
      <div
        className={`relative rounded-lg border-2 overflow-hidden shadow-lg ${borderClass} ${isSelected || isTargetable || isAttacker ? 'shadow-lg' : ''}`}
        style={{
          transform: isRested ? 'rotate(90deg)' : 'none',
          transformOrigin: 'center center',
          transition: 'transform 0.2s ease',
          position: 'relative',
          zIndex: 1,
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
