import React from 'react';
import FieldCardSlot from './FieldCardSlot';
import DonArea from './DonArea';
import { getSafeImageUrl } from '../../../utils/cardHelpers';
import { evaluateContinuousPower, evaluateGlobalContinuousPower, evaluateCharBasePowerOverride, evaluateLeaderBasePowerOverride } from '../engine/effects';

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
  onDonCardClick,
  onTrashClick,
  donPendingIds,
  donReturnMode,
  donReturnOptions,
  selectedDonReturnIndices,
  onCostDonReturnClick,
  revealed = false,
}) {
  const { leader, characterArea = [], stageArea, lifeArea = [], lifeAreaFaceUp = [], costArea = [], donDeck = [], trash = [] } = playerState;

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
  const small = false;

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
    <div className={`flex ${isOpponent ? 'flex-row-reverse' : ''} gap-1 overflow-x-auto scrollbar-hide bg-slate-900/40 rounded-lg border border-slate-700 px-1.5 py-1`}>
      {characterArea.map((fc, i) => {
        const charAttached = fc.attachedDon ?? 0;
        const charSelected = selectedCharDonCounts[i] ?? 0;
        const charHasReturnable = donReturnMode && donReturnOptions?.some(o => o.source === 'character' && o.charIndex === i);
        const charBaseOverride = state ? evaluateCharBasePowerOverride(fc, activePlayer, owner, state) : null;
        const charBaseDelta = charBaseOverride !== null ? charBaseOverride - (fc.card.power ?? 0) : 0;
        const charPowerModDelta = (playerState.powerMods ?? [])
          .filter(m => m.target === i)
          .reduce((sum, m) => sum + m.delta, 0)
          + (state ? evaluateContinuousPower(fc, activePlayer, owner, state) : 0)
          + (state ? evaluateGlobalContinuousPower(fc, activePlayer, owner, state) : 0)
          + charBaseDelta;
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

  // ── Leader / Stage shared props ────────────────────────────────────────────
  const leaderAttached = leader?.attachedDon ?? 0;
  const leaderHasReturnable = donReturnMode && donReturnOptions?.some(o => o.source === 'leader');
  const leaderBaseOverride = state && leader ? evaluateLeaderBasePowerOverride(leader, activePlayer, owner, state) : null;
  const leaderBaseDelta = leaderBaseOverride !== null ? leaderBaseOverride - (leader.card.power ?? 0) : 0;
  const leaderPowerModDelta = (playerState.powerMods ?? [])
    .filter(m => m.target === 'leader')
    .reduce((sum, m) => sum + m.delta, 0)
    + (state && leader ? evaluateContinuousPower(leader, activePlayer, owner, state) : 0)
    + (state && leader ? evaluateGlobalContinuousPower(leader, activePlayer, owner, state) : 0)
    + leaderBaseDelta;

  // ── Deck widget (top row, right side) ─────────────────────────────────────
  const DeckWidget = (
    <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
      <div className={`relative ${small ? 'w-12 h-16' : 'w-14 h-20'} rounded-lg overflow-hidden border border-slate-600`}>
        {playerState.deck.length > 0 ? (
          <>
            <img
              src={revealed ? getSafeImageUrl(playerState.deck[playerState.deck.length - 1]) : '/images/card_back.png'}
              alt="Deck"
              className="w-full h-full object-cover"
              onError={e => { e.target.src = '/images/card_back.png'; }}
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
  );

  // ── 8. Life stack (landscape-rotated cards, aligned to bottom of CharRow) ──
  // Each card is a portrait image rotated 90° inside a landscape-sized container.
  // lcW = portrait width = rotated visual height; lcH = portrait height = rotated visual width.
  const lcW = small ? 48 : 56;  // px — matches FieldCardSlot portrait width (w-12 / w-14)
  const lcH = small ? 64 : 80;  // px — matches FieldCardSlot portrait height (h-16 / h-20)
  const lcOffset = small ? 7 : 8;  // px each card fans upward
  const lifeStackHeight = lifeArea.length === 0 ? lcW : lcW + Math.max(0, lifeArea.length - 1) * lcOffset;

  const LifeStack = (
    <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
      {lifeArea.length === 0 ? (
        <div
          className="rounded-lg border-2 border-dashed border-slate-700 flex items-center justify-center"
          style={{ width: lcH, height: lcW }}
        >
          <span className="text-[10px] text-slate-600 font-bold">0</span>
        </div>
      ) : (
        <div className="relative flex-shrink-0" style={{ width: lcH, height: lifeStackHeight }}>
          {lifeArea.map((card, i) => {
            const isFaceUp = revealed || lifeAreaFaceUp[i] === true;
            return (
              <div
                key={i}
                className="absolute overflow-hidden rounded-lg border border-slate-600 shadow"
                style={{ width: lcH, height: lcW, left: 0, bottom: i * lcOffset, zIndex: i }}
              >
                <img
                  src={isFaceUp ? getSafeImageUrl(card) : '/images/card_back.png'}
                  alt="Life card"
                  className="object-cover"
                  style={{
                    width: lcW,
                    height: lcH,
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%) rotate(90deg)',
                  }}
                  onError={e => { e.target.src = '/images/card_back.png'; }}
                />
              </div>
            );
          })}
          <span
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ zIndex: lifeArea.length + 1 }}
          >
            <span className="bg-slate-900/70 text-white text-sm font-black px-1.5 py-0.5 rounded">
              {lifeArea.length}
            </span>
          </span>
        </div>
      )}
      <span className="text-[8px] text-rose-400 font-bold">LIFE·{lifeArea.length}</span>
    </div>
  );

  // ── Top row: Life + Characters + Deck (bottom-aligned, mirrored for opponent)
  const TopRow = (
    <div className="flex gap-1 items-end">
      {isOpponent ? DeckWidget : LifeStack}
      <div className="flex-1 min-w-0">{CharRow}</div>
      {isOpponent ? LifeStack : DeckWidget}
    </div>
  );

  // ── Bottom row elements (extracted so opponent can reverse the order) ───────
  const DonDeckEl = (
    <DonArea donDeck={donDeck} isOpponent={isOpponent} />
  );

  const pendingSelectedDonIndices = (() => {
    if (!donPendingIds?.size || isOpponent) return new Set();
    const indices = new Set();
    for (let i = 0; i < costArea.length; i++) {
      if (donPendingIds.has(costArea[i]._donId)) indices.add(i);
    }
    return indices;
  })();

  const DonCostEl = (
    <div
      className="flex-1 relative bg-slate-900/40 rounded-lg border border-slate-700"
      style={{ height: '5rem' }}
    >
      {costArea.map((don, i) => {
        const isActive = don.state === 'active';
        const returnOptIdx = donReturnMode && donReturnOptions
          ? donReturnOptions.findIndex(o => o.source === 'cost' && o.donId === don._donId)
          : -1;
        const isSelectedForReturn = returnOptIdx >= 0 && selectedDonReturnIndices?.includes(returnOptIdx);
        const isReturnable = returnOptIdx >= 0;
        const isSelectedForAttach = pendingSelectedDonIndices.has(i);
        const clickable = donReturnMode ? (!isOpponent && isReturnable) : (!isOpponent && isActive);
        return (
          <div
            key={don._donId || i}
            className={`absolute ${clickable ? 'cursor-pointer active:scale-95' : ''}`}
            style={{
              ...(isOpponent ? { right: `${i * 30}px` } : { left: `${i * 30}px` }),
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
                ? (!isOpponent && isReturnable ? (e) => { e.stopPropagation(); onCostDonReturnClick?.(don._donId); } : undefined)
                : (!isOpponent && isActive ? (e) => { e.stopPropagation(); onDonCardClick?.(don._donId); } : undefined)
            }
          >
            <img
              src={DON_IMG}
              alt="DON!!"
              className={`object-cover rounded shadow-md ${
                isSelectedForReturn
                  ? 'border-2 border-red-400 ring-1 ring-red-400'
                  : isSelectedForAttach
                    ? 'border-2 border-yellow-400 ring-1 ring-yellow-400'
                    : (isActive && !isOpponent ? 'border-2 border-teal-400' : 'border border-teal-600')
              }`}
              style={{ width: '3.5rem', height: '5rem' }}
              onError={e => { e.target.style.display = 'none'; }}
            />
            {isSelectedForReturn && (
              <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-white font-black text-[10px] bg-red-600/80 rounded px-0.5">↩</span>
              </span>
            )}
            {isSelectedForAttach && (
              <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-white font-black text-[10px] bg-yellow-600/80 rounded px-0.5">✓</span>
              </span>
            )}
          </div>
        );
      })}
      {costArea.length > 0 && (
        <span
          className="absolute text-sm font-black text-white bg-slate-900/80 px-1.5 py-0.5 rounded"
          style={{
            ...(isOpponent ? { right: `${costArea.length * 30 + 8}px` } : { left: `${costArea.length * 30 + 8}px` }),
            top: '50%', transform: 'translateY(-50%)', whiteSpace: 'nowrap', zIndex: 20,
          }}
        >
          {activeDonCount}/{costArea.length}
        </span>
      )}
    </div>
  );

  const LeaderEl = (
    <div className="relative flex-shrink-0">
      <FieldCardSlot
        fieldCard={leader}
        isSelected={selectedZone === 'leader' && owner === 'human'}
        isAttacker={isAttacker('leader', -1)}
        isTargetable={isTarget('leader', -1) || (targetableChars && targetableChars.has('leader')) || (donReturnMode && leaderHasReturnable)}
        isSmall={false}
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
  );

  const StageEl = (
    <FieldCardSlot
      fieldCard={stageArea}
      label="STAGE"
      isSmall={false}
      empty={!stageArea}
      onClick={onStageClick}
    />
  );

  const TrashEl = (
    <div
      className="flex flex-col items-center gap-0.5 cursor-pointer flex-shrink-0"
      onClick={() => onTrashClick?.()}
      title={`Trash: ${trash.length} cards`}
    >
      <div className="relative w-14 h-20 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden">
        {trash.length > 0 ? (
          <>
            <img
              src={getSafeImageUrl(trash[trash.length - 1])}
              alt="Trash"
              className="w-full h-full object-cover opacity-70"
              onError={e => { e.target.src = '/images/card_back.png'; }}
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="bg-slate-900/70 text-white text-sm font-black px-1.5 py-0.5 rounded">
                {trash.length}
              </span>
            </span>
          </>
        ) : (
          <span className="text-[8px] text-slate-600 font-bold">0</span>
        )}
      </div>
      <span className="text-[8px] text-slate-400 font-bold">TRASH·{trash.length}</span>
    </div>
  );

  // Opponent mirrors the order: Trash | Stage | Leader | DON cost | DON deck
  const BottomRow = (
    <div className="flex items-center gap-1.5">
      {isOpponent
        ? <>{TrashEl}{StageEl}{LeaderEl}{DonCostEl}{DonDeckEl}</>
        : <>{DonDeckEl}{DonCostEl}{LeaderEl}{StageEl}{TrashEl}</>
      }
    </div>
  );

  // ── Opponent face-down hand ────────────────────────────────────────────────
  const OpponentHand = isOpponent && (
    <div className="flex gap-1 overflow-x-auto scrollbar-hide py-0.5">
      {playerState.hand.length === 0 ? (
        <span className="text-[9px] text-slate-600 font-bold">No cards in hand</span>
      ) : revealed ? (
        playerState.hand.map((card, i) => (
          <img
            key={i}
            src={getSafeImageUrl(card)}
            alt={card.name}
            className="w-14 h-20 flex-shrink-0 rounded-lg border border-slate-500 object-cover shadow"
            onError={e => { e.target.src = '/images/card_back.png'; }}
          />
        ))
      ) : (
        Array.from({ length: playerState.hand.length }).map((_, i) => (
          <div key={i} className="w-14 h-20 flex-shrink-0 rounded-lg bg-slate-800 border border-slate-700" />
        ))
      )}
    </div>
  );

  // ── Final layout ───────────────────────────────────────────────────────────
  if (isOpponent) {
    return (
      <div className="flex flex-col gap-1 px-2 pt-1 pb-0.5">
        {OpponentHand}
        {BottomRow}
        {TopRow}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-2 pt-0.5 pb-1">
      {TopRow}
      {BottomRow}
    </div>
  );
}
