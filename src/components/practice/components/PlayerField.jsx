import React from 'react';
import FieldCardSlot from './FieldCardSlot';
import DonArea from './DonArea';
import { getSafeImageUrl } from '../../../utils/cardHelpers';
import { evaluateContinuousPower, evaluateGlobalContinuousPower } from '../engine/effects';

const DON_IMG = '/don.png';

export default function PlayerField({
  playerState,
  isOpponent,
  battle,
  activePlayer,
  owner,
  state,
  selectedZone,
  selectedIndex,
  targetableChars,
  onLeaderClick,
  onCharacterClick,
  onStageClick,
  onDonAreaClick,
  onTrashClick,
  donReturnMode,
  donReturnOptions,
  selectedDonReturnIndices,
  onCostDonReturnClick,
}) {
  const { leader, characterArea = [], stageArea, lifeArea = [], costArea = [], donDeck = [], trash = [] } = playerState;

  const isInBattle    = !!battle;
  const attackerOwner = battle?.attackerOwner;
  const attackerZone  = battle?.attackerZone;
  const attackerIndex = battle?.attackerIndex;
  const targetOwner   = battle?.targetOwner;
  const targetZone    = battle?.targetZone;
  const targetIndex   = battle?.targetIndex;

  function isAttacker(zone, index) {
    return isInBattle && attackerOwner === owner && attackerZone === zone && attackerIndex === index;
  }
  function isTarget(zone, index) {
    return isInBattle && targetOwner === owner && targetZone === zone && targetIndex === index;
  }

  const activeDonCount = costArea.filter(d => d.state === 'active').length;
  const small = isOpponent;

  // How many attached don from each source are selected for return
  const selectedLeaderDonCount = donReturnMode && donReturnOptions
    ? donReturnOptions.filter((o, i) => o.source === 'leader' && selectedDonReturnIndices?.includes(i)).length
    : 0;
  const selectedCharDonCounts = donReturnMode && donReturnOptions
    ? characterArea.map((_, ci) =>
        donReturnOptions.filter((o, i) => o.source === 'character' && o.charIndex === ci && selectedDonReturnIndices?.includes(i)).length
      )
    : [];

  // ── 1. Character area ──────────────────────────────────────────────────────
  const CharRow = (
    <div className="flex gap-1 overflow-x-auto scrollbar-hide bg-slate-900/40 rounded-lg border border-slate-700 px-1.5 py-1">
      {characterArea.map((fc, i) => {
        const charAttached = fc.attachedDon ?? 0;
        const charSelected = selectedCharDonCounts[i] ?? 0;
        const charHasReturnable = donReturnMode && donReturnOptions?.some(o => o.source === 'character' && o.charIndex === i);
        const charPowerModDelta = (playerState.powerMods ?? [])
          .filter(m => m.target === i)
          .reduce((sum, m) => sum + m.delta, 0)
          + (state ? evaluateContinuousPower(fc, activePlayer, owner, state) : 0)
          + (state ? evaluateGlobalContinuousPower(fc, activePlayer, owner, state) : 0);
        const charCostModDelta = (playerState.costMods ?? [])
          .filter(m => m.target === i)
          .reduce((sum, m) => sum + m.delta, 0);
        return (
          <div key={`${fc.card.id}-${i}`} className="relative flex-shrink-0">
            <FieldCardSlot
              fieldCard={fc}
              isSelected={selectedZone === 'character' && selectedIndex === i && owner === 'human'}
              isAttacker={isAttacker('character', i)}
              isTargetable={(targetableChars && targetableChars.has(i)) || isTarget('character', i) || (donReturnMode && charHasReturnable)}
              isSmall={small}
              activePlayer={activePlayer}
              owner={owner}
              powerModDelta={charPowerModDelta}
              costModDelta={charCostModDelta}
              battleRole={isAttacker('character', i) ? 'attacker' : isTarget('character', i) ? 'target' : undefined}
              onClick={() => onCharacterClick?.(i)}
            />
            {donReturnMode && charAttached > 0 && (
              <span className="absolute top-0.5 left-0.5 z-20 bg-red-700/90 text-white text-[8px] font-black px-1 rounded pointer-events-none">
                {charSelected > 0 ? `↩${charSelected}/` : ''}{charAttached}
              </span>
            )}
          </div>
        );
      })}
      {Array.from({ length: Math.max(0, 5 - characterArea.length) }).map((_, i) => (
        <FieldCardSlot key={`empty-${i}`} empty label="" isSmall={small} />
      ))}
    </div>
  );

  // ── 2/3. Leader + Stage + Deck row ─────────────────────────────────────────
  const leaderAttached = leader?.attachedDon ?? 0;
  const leaderHasReturnable = donReturnMode && donReturnOptions?.some(o => o.source === 'leader');
  const leaderPowerModDelta = (playerState.powerMods ?? [])
    .filter(m => m.target === 'leader')
    .reduce((sum, m) => sum + m.delta, 0)
    + (state && leader ? evaluateContinuousPower(leader, activePlayer, owner, state) : 0)
    + (state && leader ? evaluateGlobalContinuousPower(leader, activePlayer, owner, state) : 0);
  const LeaderRow = (
    <div className="flex items-center gap-1.5">
      {/* 2. Leader */}
      <div className="relative flex-shrink-0">
        <FieldCardSlot
          fieldCard={leader}
          isSelected={selectedZone === 'leader' && owner === 'human'}
          isAttacker={isAttacker('leader', -1)}
          isTargetable={isTarget('leader', -1) || (targetableChars && targetableChars.has('leader')) || (donReturnMode && leaderHasReturnable)}
          isSmall={small}
          activePlayer={activePlayer}
          owner={owner}
          powerModDelta={leaderPowerModDelta}
          battleRole={isAttacker('leader', -1) ? 'attacker' : isTarget('leader', -1) ? 'target' : undefined}
          onClick={() => onLeaderClick?.()}
        />
        {donReturnMode && leaderAttached > 0 && (
          <span className="absolute top-0.5 left-0.5 z-20 bg-red-700/90 text-white text-[8px] font-black px-1 rounded pointer-events-none">
            {selectedLeaderDonCount > 0 ? `↩${selectedLeaderDonCount}/` : ''}{leaderAttached}
          </span>
        )}
      </div>
      {/* 3. Stage */}
      <FieldCardSlot
        fieldCard={stageArea}
        label="STAGE"
        isSmall={small}
        empty={!stageArea}
        onClick={onStageClick}
      />
      <div className="flex-1" />
      {/* 4. Deck */}
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
        <div className={`relative ${small ? 'w-12 h-16' : 'w-14 h-20'} rounded-lg overflow-hidden border border-slate-600`}>
          {playerState.deck.length > 0 ? (
            <>
              <img
                src="/back.png"
                alt="Deck"
                className="w-full h-full object-cover"
                onError={e => { e.target.style.display = 'none'; }}
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="bg-slate-900/70 text-white text-sm font-black px-1.5 py-0.5 rounded">
                  {playerState.deck.length}
                </span>
              </span>
            </>
          ) : (
            <div className="w-full h-full bg-slate-800 flex items-center justify-center">
              <span className="text-slate-600 font-black text-sm">0</span>
            </div>
          )}
        </div>
        <span className="text-[8px] text-slate-400 font-bold">DECK·{playerState.deck.length}</span>
      </div>
    </div>
  );

  // ── 8. Life column (spans both CharRow + LeaderRow) ────────────────────────
  const LifeAndMain = (
    <div className="flex gap-1 items-stretch">
      {/* Life column stretches to fill the height of the right section */}
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
        <div className={`flex-1 ${small ? 'w-10' : 'w-12'} relative`} style={{ minHeight: '3.5rem' }}>
          {lifeArea.length === 0 ? (
            <div className="absolute inset-0 rounded-lg border-2 border-dashed border-slate-700 flex items-center justify-center">
              <span className="text-[10px] text-slate-600 font-bold">0</span>
            </div>
          ) : (
            <>
              {lifeArea.map((_, i) => (
                <img
                  key={i}
                  src="/back.png"
                  alt="Life card"
                  className="absolute w-full rounded-lg border border-slate-600 shadow object-cover"
                  style={{
                    height: small ? '3rem' : '3.5rem',
                    bottom: `${i * 7}px`,
                    left: 0,
                    zIndex: i,
                  }}
                  onError={e => { e.target.style.display = 'none'; }}
                />
              ))}
              <span
                className="absolute bg-rose-700/90 text-white text-[9px] font-black px-1 rounded"
                style={{ top: '2px', right: '2px', zIndex: lifeArea.length + 1 }}
              >
                {lifeArea.length}
              </span>
            </>
          )}
        </div>
        <span className="text-[8px] text-rose-400 font-bold">LIFE·{lifeArea.length}</span>
      </div>

      {/* Right section: char area + leader/stage/deck */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        {isOpponent ? (
          <>
            {LeaderRow}
            {CharRow}
          </>
        ) : (
          <>
            {CharRow}
            {LeaderRow}
          </>
        )}
      </div>
    </div>
  );

  // ── 6/7/5. DON cost area + DON deck + Trash row ────────────────────────────
  const DonRow = (
    <div className="flex items-center gap-1.5">
      {/* 7. DON!! deck */}
      <DonArea donDeck={donDeck} isOpponent={isOpponent} onDonClick={onDonAreaClick} />

      {/* 6. DON!! cost area */}
      <div
        className="flex-1 relative bg-slate-900/40 rounded-lg border border-slate-700"
        style={{ height: '3.5rem' }}
      >
        {costArea.map((don, i) => {
          const isActive = don.state === 'active';
          const returnOptIdx = donReturnMode && donReturnOptions
            ? donReturnOptions.findIndex(o => o.source === 'cost' && o.donId === don._donId)
            : -1;
          const isSelectedForReturn = returnOptIdx >= 0 && selectedDonReturnIndices?.includes(returnOptIdx);
          const isReturnable = returnOptIdx >= 0;
          const clickable = donReturnMode ? (!isOpponent && isReturnable) : (!isOpponent && isActive);
          return (
            <div
              key={don._donId || i}
              className={`absolute ${clickable ? 'cursor-pointer active:scale-95' : ''}`}
              style={{
                left: `${i * 20}px`,
                top: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                transform: don.state === 'rest' ? 'rotate(90deg) translateY(4px)' : 'none',
                transition: 'transform 0.2s ease',
                opacity: donReturnMode ? 1 : (don.state === 'rest' ? 0.5 : 1),
                zIndex: i,
              }}
              onClick={
                donReturnMode
                  ? (!isOpponent && isReturnable ? () => onCostDonReturnClick?.(don._donId) : undefined)
                  : (!isOpponent && isActive ? onDonAreaClick : undefined)
              }
            >
              <img
                src={DON_IMG}
                alt="DON!!"
                className={`object-cover rounded shadow-md ${
                  isSelectedForReturn
                    ? 'border-2 border-red-400 ring-1 ring-red-400'
                    : (isActive && !isOpponent ? 'border-2 border-teal-400' : 'border border-teal-600')
                }`}
                style={{ width: '2rem', height: '2.8rem' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
              {isSelectedForReturn && (
                <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-white font-black text-[10px] bg-red-600/80 rounded px-0.5">↩</span>
                </span>
              )}
            </div>
          );
        })}
        {costArea.length > 0 && (
          <span
            className="absolute text-[9px] font-bold text-teal-400"
            style={{ left: `${costArea.length * 20 + 8}px`, top: '50%', transform: 'translateY(-50%)', whiteSpace: 'nowrap', zIndex: 20 }}
          >
            {activeDonCount}/{costArea.length}
          </span>
        )}
      </div>

      {/* 5. Trash */}
      <div
        className="flex flex-col items-center gap-0.5 cursor-pointer flex-shrink-0"
        onClick={() => onTrashClick?.()}
        title={`Trash: ${trash.length} cards`}
      >
        <div className={`relative ${small ? 'w-10 h-14' : 'w-12 h-16'} rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden`}>
          {trash.length > 0 ? (
            <>
              <img
                src={getSafeImageUrl(trash[trash.length - 1])}
                alt="Trash"
                className="w-full h-full object-cover opacity-70"
                onError={e => { e.target.src = '/images/card_back.png'; }}
              />
              <span className="absolute text-xs font-black text-white drop-shadow-lg bg-black/50 px-1 rounded">
                {trash.length}
              </span>
            </>
          ) : (
            <span className="text-[8px] text-slate-600 font-bold">0</span>
          )}
        </div>
        <span className="text-[8px] text-slate-400 font-bold">TRASH·{trash.length}</span>
      </div>
    </div>
  );

  // ── Opponent face-down hand ────────────────────────────────────────────────
  const OpponentHand = isOpponent && (
    <div className="flex gap-1 overflow-x-auto scrollbar-hide py-0.5">
      {playerState.hand.length === 0 ? (
        <span className="text-[9px] text-slate-600 font-bold">No cards in hand</span>
      ) : (
        Array.from({ length: playerState.hand.length }).map((_, i) => (
          <div key={i} className="w-8 h-11 flex-shrink-0 rounded-md bg-slate-800 border border-slate-700" />
        ))
      )}
    </div>
  );

  // ── Final layout ───────────────────────────────────────────────────────────
  if (isOpponent) {
    return (
      <div className="flex flex-col gap-1 px-2 pt-1 pb-0.5">
        {OpponentHand}
        {DonRow}
        {LifeAndMain}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-2 pt-0.5 pb-1">
      {LifeAndMain}
      {DonRow}
    </div>
  );
}
