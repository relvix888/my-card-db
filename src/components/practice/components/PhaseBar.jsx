import React from 'react';
import { useTranslation } from 'react-i18next';
import { PHASE, BATTLE_STEP, PLAYER } from '../engine/constants';

export const PHASE_LABELS = {
  [PHASE.REFRESH]: 'Refresh',
  [PHASE.DRAW]:    'Draw',
  [PHASE.DON]:     'DON!!',
  [PHASE.MAIN]:    'Main',
  [PHASE.END]:     'End',
};

export const PHASE_COLORS = {
  [PHASE.REFRESH]: 'bg-slate-600',
  [PHASE.DRAW]:    'bg-blue-700',
  [PHASE.DON]:     'bg-emerald-700',
  [PHASE.MAIN]:    'bg-red-700',
  [PHASE.END]:     'bg-slate-700',
};

export default function PhaseBar({
  state, onEndTurn, onSkipBlock, onSkipCounter, onUnblock,
  myRole = PLAYER.HUMAN,
  selectedCard, cardActions = [], onAction, onClearCard,
}) {
  const { i18n } = useTranslation();
  const isEn = i18n.language.startsWith('en');
  const getName = (card) => (isEn && card?.enName) ? card.enName : (card?.name ?? '?');

  const { phase, activePlayer, waitingFor, battle } = state;
  const isYourTurn    = activePlayer === myRole;
  const isYourInput   = waitingFor   === myRole;
  const isMainPhase   = phase === PHASE.MAIN;
  const inBattle      = !!battle;
  const inBlockStep   = inBattle && battle.step === BATTLE_STEP.BLOCK;
  const inCounterStep = inBattle && battle.step === BATTLE_STEP.COUNTER;

  const atkCard = inBattle && (battle.attackerZone === 'leader'
    ? state[battle.attackerOwner]?.leader?.card
    : state[battle.attackerOwner]?.characterArea?.[battle.attackerIndex]?.card);
  const defCard = inBattle && (battle.targetZone === 'leader'
    ? state[battle.targetOwner]?.leader?.card
    : state[battle.targetOwner]?.characterArea?.[battle.targetIndex]?.card);
  const atkName = getName(atkCard);
  const defName = getName(defCard);
  const winning = inBattle && battle.atkPower >= battle.defPower;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-y border-slate-700 z-10 min-h-[44px]">
      {/* Left: card name + category OR battle status */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
        {selectedCard ? (
          <>
            <span className="text-white font-black text-xs truncate">{getName(selectedCard)}</span>
            <span className="text-slate-500 text-[10px] flex-shrink-0">·</span>
            <span className="text-slate-400 text-[10px] flex-shrink-0 truncate">
              {isEn
                ? selectedCard.category
                : ({ Leader: '領', Character: '角', Stage: '台', Event: '事' }[selectedCard.category] ?? selectedCard.category)}
            </span>
          </>
        ) : inBattle ? (
          <>
            <span className={`flex items-center gap-1 min-w-0 shrink ${battle.attackerOwner === 'human' ? 'text-blue-400' : 'text-red-400'}`}>
              <span className="truncate text-xs font-black">{atkName}</span>
              <span className="flex-shrink-0 text-xs font-black">{battle.atkPower.toLocaleString()}</span>
            </span>
            <span className="text-slate-500 text-[10px] font-bold flex-shrink-0">vs</span>
            <span className={`flex items-center gap-1 min-w-0 shrink ${winning ? 'text-slate-400' : 'text-green-400'}`}>
              <span className="truncate text-xs font-black">{defName}</span>
              <span className="flex-shrink-0 text-xs font-black">{battle.defPower.toLocaleString()}</span>
            </span>
          </>
        ) : null}
      </div>

      {/* Right: action buttons + dismiss + Skip/EndTurn */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {selectedCard && cardActions.map(action => {
          let activeStyle = 'bg-slate-700 hover:bg-slate-600 text-white active:scale-95';
          if (!action.disabled) {
            if (action.label === 'Attack')
              activeStyle = 'bg-rose-700 hover:bg-rose-600 text-white active:scale-95 animate-pulse shadow-[0_0_10px_2px_rgba(225,29,72,0.6)]';
            else if (action.label === 'Activate: Main')
              activeStyle = 'bg-violet-700 hover:bg-violet-600 text-white active:scale-95 animate-pulse shadow-[0_0_10px_2px_rgba(139,92,246,0.6)]';
            else if (action.label === 'Play Character' || action.label === 'Play Stage' || action.label === 'Play Event')
              activeStyle = 'bg-sky-700 hover:bg-sky-600 text-white active:scale-95 animate-pulse shadow-[0_0_10px_2px_rgba(14,165,233,0.6)]';
            else if (action.label.startsWith('Activate +'))
              activeStyle = 'bg-emerald-700 hover:bg-emerald-600 text-white active:scale-95 animate-pulse shadow-[0_0_10px_2px_rgba(16,185,129,0.6)]';
          }
          return (
            <button
              key={action.label}
              onClick={() => { onAction(action); onClearCard(); }}
              disabled={action.disabled}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-bold rounded-lg transition-all ${
                action.disabled ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : activeStyle
              }`}
              title={action.hint}
            >
              <span>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          );
        })}
        {selectedCard && (
          <button onClick={onClearCard} className="text-slate-500 hover:text-white text-lg leading-none px-1">
            ×
          </button>
        )}
        {isYourInput && inBlockStep && (
          <span className="px-2 py-1 text-[11px] font-bold bg-orange-600 text-white rounded-lg select-none">
            Block?
          </span>
        )}
        {isYourInput && inBlockStep && (
          <button
            onClick={onSkipBlock}
            className="px-2 py-1 text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-white rounded-lg active:scale-95 transition-all animate-pulse"
          >
            Skip
          </button>
        )}
        {isYourInput && inCounterStep && battle?.blockerUsed && (
          <button
            onClick={onUnblock}
            className="px-2 py-1 text-[11px] font-bold bg-slate-600 hover:bg-slate-500 text-white rounded-lg active:scale-95 transition-all"
          >
            Unblock
          </button>
        )}
        {isYourInput && inCounterStep && (
          <button
            onClick={onSkipCounter}
            className="px-2 py-1 text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-white rounded-lg active:scale-95 transition-all animate-pulse"
          >
            Skip
          </button>
        )}
        {isYourTurn && isMainPhase && !inBattle && (
          <button
            onClick={onEndTurn}
            className="px-2 py-1 text-[11px] font-black bg-red-700 hover:bg-red-600 text-white rounded-lg active:scale-95 transition-all uppercase tracking-wide"
          >
            End Turn
          </button>
        )}
      </div>
    </div>
  );
}
