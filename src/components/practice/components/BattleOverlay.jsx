import React from 'react';
import { BATTLE_STEP } from '../engine/constants';

export default function BattleOverlay({ battle, humanState, aiState }) {
  if (!battle) return null;

  const { step, atkPower, defPower, attackerOwner, targetZone } = battle;

  const stepLabel = {
    [BATTLE_STEP.BLOCK]:   'Block Step',
    [BATTLE_STEP.COUNTER]: 'Counter Step',
    [BATTLE_STEP.DAMAGE]:  'Damage Step',
  }[step] || '';

  const attackerName = attackerOwner === 'human' ? 'You' : 'AI';
  const winning = atkPower >= defPower;

  return (
    <div className="px-3 py-2 bg-slate-950/90 border-y border-orange-700/50 flex items-center justify-between">
      <div className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">
        ⚔ {stepLabel}
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-sm font-black ${attackerOwner === 'human' ? 'text-blue-400' : 'text-red-400'}`}>
          {atkPower.toLocaleString()}
        </span>
        <span className="text-slate-500 font-bold">vs</span>
        <span className={`text-sm font-black ${winning ? 'text-slate-400' : 'text-green-400'}`}>
          {defPower.toLocaleString()}
        </span>
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${winning ? 'bg-blue-700 text-white' : 'bg-red-800 text-white'}`}>
          {winning ? (attackerOwner === 'human' ? 'Win' : 'AI Wins') : 'Fail'}
        </span>
      </div>
    </div>
  );
}
