import React from 'react';
import { PHASE, BATTLE_STEP, PLAYER } from '../engine/constants';

const PHASE_LABELS = {
  [PHASE.REFRESH]: 'Refresh',
  [PHASE.DRAW]:    'Draw',
  [PHASE.DON]:     'DON!!',
  [PHASE.MAIN]:    'Main',
  [PHASE.END]:     'End',
};

const PHASE_COLORS = {
  [PHASE.REFRESH]: 'bg-slate-600',
  [PHASE.DRAW]:    'bg-blue-700',
  [PHASE.DON]:     'bg-emerald-700',
  [PHASE.MAIN]:    'bg-red-700',
  [PHASE.END]:     'bg-slate-700',
};

export default function PhaseBar({ state, onEndTurn, onSkipBlock, onSkipCounter }) {
  const { phase, activePlayer, waitingFor, battle, turn } = state;
  const isYourTurn    = activePlayer === PLAYER.HUMAN;
  const isYourInput   = waitingFor   === PLAYER.HUMAN;
  const isMainPhase   = phase === PHASE.MAIN;
  const inBattle      = !!battle;
  const inBlockStep   = inBattle && battle.step === BATTLE_STEP.BLOCK;
  const inCounterStep = inBattle && battle.step === BATTLE_STEP.COUNTER;
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-y border-slate-700 z-10">
      {/* Turn info */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          T{turn}
        </span>
        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${isYourTurn ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
          {isYourTurn ? 'Your Turn' : "AI's Turn"}
        </span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${PHASE_COLORS[phase]} text-white`}>
          {PHASE_LABELS[phase]}
        </span>
        {inBattle && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-700 text-white animate-pulse">
            {inBlockStep ? 'Block?' : inCounterStep ? 'Counter?' : 'Damage'}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {isYourInput && inBlockStep && (
          <button
            onClick={onSkipBlock}
            className="px-3 py-1.5 text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white rounded-lg active:scale-95 transition-all"
          >
            Skip Block
          </button>
        )}
        {isYourInput && inCounterStep && (
          <button
            onClick={onSkipCounter}
            className="px-3 py-1.5 text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white rounded-lg active:scale-95 transition-all"
          >
            Skip Counter
          </button>
        )}
        {isYourTurn && isMainPhase && !inBattle && (
          <button
            onClick={onEndTurn}
            className="px-4 py-1.5 text-xs font-black bg-red-700 hover:bg-red-600 text-white rounded-lg active:scale-95 transition-all uppercase tracking-wide"
          >
            End Turn
          </button>
        )}
      </div>
    </div>
  );
}
