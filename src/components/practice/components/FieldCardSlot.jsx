import React, { useState, useRef, useEffect } from 'react';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';
import { donImg } from '../../../utils/images';
import CardDetailOverlay from './CardDetailOverlay';
import CardPreview from './CardPreview';

const DON_IMG = donImg;

export default function FieldCardSlot({
  fieldCard,
  label,
  isSelected,
  isTargetable,
  isAttacker,
  isEffectHighlight = false,
  isEligibleBlocker = false,
  isSmall,
  onClick,
  empty,
  activePlayer,
  owner,
  battleRole,
  powerModDelta = 0,
  costModDelta = 0,
  hasDoubleAtk = false,
  hasRush = false,
  hasCharRush = false,
  hasBlocker = false,
  hasBanish = false,
  hasUnblock = false,
  disableStats = false,
}) {
  const [previewPos, setPreviewPos] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const isTouching = useRef(false);
  const touchTriggered = useRef(false);

  useEffect(() => {
    if (disableStats) {
      setMobileDetail(false);
      setPreviewPos(null);
    }
  }, [disableStats]);

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

  const { card, state: cardState, attachedDon, justDeployed, attackLocked, refreshLocked, restLocked, willBottomDeckAtEndOfTurn, tempKeywords, opponentTurnEndKeywords } = fieldCard;
  const hasKoProtect = tempKeywords?.includes('MASS_EFFECT_KO_PROTECTION') || opponentTurnEndKeywords?.includes('MASS_EFFECT_KO_PROTECTION');
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

  const borderClass = isEffectHighlight   ? 'border-orange-400 shadow-orange-400/60'
                    : isSelected          ? 'border-blue-400 shadow-blue-400/50'
                    : isAttacker          ? 'border-yellow-400 shadow-yellow-400/50'
                    : isTargetable        ? 'border-green-400 shadow-green-400/50'
                    : isEligibleBlocker   ? 'border-orange-500 shadow-orange-500/50'
                    : 'border-slate-600';

  return (
    <div
      className={`relative cursor-pointer select-none transition-transform active:scale-95 ${w}`}
      data-battle-role={battleRole || undefined}
      onClick={() => {
        if (touchTriggered.current && !disableStats) setMobileDetail(prev => !prev);
        else setMobileDetail(false);
        touchTriggered.current = false;
        onClick?.();
      }}
      onMouseMove={e => { if (!isTouching.current && !disableStats) setPreviewPos({ x: e.clientX, y: e.clientY }); }}
      onMouseLeave={() => setPreviewPos(null)}
      onTouchStart={() => {
        isTouching.current = true;
        touchTriggered.current = true;
      }}
      onTouchEnd={() => { setTimeout(() => { isTouching.current = false; }, 300); }}
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
        className={`relative rounded-lg border-2 overflow-hidden shadow-lg ${borderClass} ${isEffectHighlight || isSelected || isTargetable || isAttacker || isEligibleBlocker ? 'shadow-lg' : ''}`}
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
          onError={e => { e.target.src = cardBackImg; }}
        />
        {justDeployed && (
          <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center">
            <span className="text-[8px] font-black text-slate-300">Sick</span>
          </div>
        )}
        {/* Status lock badges */}
        {(attackLocked || refreshLocked || restLocked || willBottomDeckAtEndOfTurn || hasKoProtect) && (
          <div className="absolute top-0.5 left-0.5 flex flex-col gap-0.5 z-10 pointer-events-none">
            {attackLocked            && <span className="text-[7px] font-black px-0.5 py-px rounded bg-red-700/90    text-white leading-tight">NO ATK</span>}
            {refreshLocked           && <span className="text-[7px] font-black px-0.5 py-px rounded bg-violet-700/90 text-white leading-tight">NO ↺</span>}
            {restLocked              && <span className="text-[7px] font-black px-0.5 py-px rounded bg-orange-700/90 text-white leading-tight">NO REST</span>}
            {willBottomDeckAtEndOfTurn && <span className="text-[7px] font-black px-0.5 py-px rounded bg-cyan-700/90   text-white leading-tight">↩ EOT</span>}
            {hasKoProtect            && <span className="text-[7px] font-black px-0.5 py-px rounded bg-emerald-600/90 text-white leading-tight">NO KO</span>}
          </div>
        )}
        {/* Bottom-left badge: DON count */}
        {attachedDon > 0 && (
          <div className="absolute bottom-0.5 left-0.5 z-10 pointer-events-none">
            <span className="text-[7px] font-black px-0.5 py-px rounded bg-teal-600/90 text-white leading-tight">
              +{attachedDon}
            </span>
          </div>
        )}
        {/* Keyword overlay strip */}
        {(hasDoubleAtk || hasRush || hasCharRush || hasBlocker || hasBanish || hasUnblock) && (
          <div className="absolute bottom-0 inset-x-0 z-10 pointer-events-none flex flex-wrap justify-center gap-px p-px bg-slate-900/50">
            {hasDoubleAtk && <span className="text-[6px] font-black px-0.5 rounded bg-yellow-400/90 text-black leading-tight">2x</span>}
            {hasRush      && <span className="text-[6px] font-black px-0.5 rounded bg-green-500/90  text-black leading-tight">Rush</span>}
            {hasCharRush  && <span className="text-[6px] font-black px-0.5 rounded bg-green-700/90  text-white leading-tight">R:Chr</span>}
            {hasBlocker   && <span className="text-[6px] font-black px-0.5 rounded bg-blue-500/90   text-white leading-tight">Block</span>}
            {hasBanish    && <span className="text-[6px] font-black px-0.5 rounded bg-red-600/90    text-white leading-tight">Banish</span>}
            {hasUnblock   && <span className="text-[6px] font-black px-0.5 rounded bg-purple-600/90 text-white leading-tight">Unblk</span>}
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

      {previewPos && <CardDetailOverlay card={card} x={previewPos.x} y={previewPos.y} />}
      {mobileDetail && <CardDetailOverlay card={card} onClose={() => setMobileDetail(false)} />}
    </div>
  );
}
