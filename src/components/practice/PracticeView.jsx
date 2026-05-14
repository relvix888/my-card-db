import React, { useEffect, useState, useRef } from 'react';
import { PHASE, BATTLE_STEP, PLAYER } from './engine/constants';
import { gameReducer, createInitialState, canAfford } from './engine/gameState';
import { aiDecideBlock, aiDecideCounter, getAiTurnActions } from './engine/aiPlayer';
import { hasRush, hasActivatedMain, getActivatedMainStatus, evaluateContinuousKeywords, fcEffectiveHasBlocker } from './engine/effects';
import { matchesFilter } from './engine/effectActions';
import deckFinalData from '../../data/deck_final.json';
import { useFlashQueue } from './hooks/useFlashQueue';

import PlayerField    from './components/PlayerField';
import HandArea       from './components/HandArea';
import PhaseBar       from './components/PhaseBar';
import BattleOverlay  from './components/BattleOverlay';
import ActionMenu     from './components/ActionMenu';
import TriggerBar     from './components/TriggerModal';
import DonReturnBar   from './components/DonReturnBar';
import EffectModal    from './components/EffectModal';
import GameLog        from './components/GameLog';
import TrashModal     from './components/TrashModal';
import AiDeckPicker   from './components/AiDeckPicker';
import AttackArrow       from './components/AttackArrow';
import StateSimulator    from './components/StateSimulator';
import CardFlashOverlay  from './components/CardFlashOverlay';
import MulliganScreen    from './components/MulliganScreen';
import PreGameAbilityScreen from './components/PreGameAbilityScreen';
import { useDevToolsReducer } from './hooks/useDevToolsReducer';

function parseDeckString(str) {
  const out = {};
  for (const part of (str ?? '').split(',')) {
    const m = part.match(/^(\d+)x(.+)$/);
    if (m) out[m[2].trim()] = parseInt(m[1]);
  }
  return out;
}

function rootReducer(state, action) {
  if (action.type === 'START_GAME') return action.initialState;
  // LOAD_STATE: full replacement for DevTools time-travel and state-simulator injection
  if (action.type === 'LOAD_STATE') return action.state;
  return gameReducer(state, action);
}

const AI_ACTION_DELAY_MS = 700; // pause between AI actions for readability
const AI_COUNTER_DELAY_MS = 1400; // longer delay so each counter card flash completes (flash lasts 1300ms)

// ---------------------------------------------------------------------------
// Expand deckList { id: count } into a flat Card[] using the card database
// ---------------------------------------------------------------------------
function expandDeck(deckList, allCards) {
  const out = [];
  for (const [id, count] of Object.entries(deckList)) {
    const card = allCards.find(c => c.id === id);
    if (!card) continue;
    for (let i = 0; i < count; i++) out.push(card);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PracticeView({ deckList, selectedLeader, cards, onClose }) {
  const [logOpen, setLogOpen]     = useState(false);
  const [trashView, setTrashView] = useState(null); // null | 'human' | 'ai'
  const [simOpen, setSimOpen]     = useState(false);

  // UI selection state
  const [selectedHandIndex, setSelectedHandIndex]     = useState(null);
  const [selectedFieldCard, setSelectedFieldCard]     = useState(null); // { zone, index }
  const [pendingAttackSrc, setPendingAttackSrc]       = useState(null); // { zone, index }
  const [pendingDonIds, setPendingDonIds]             = useState(new Set());
  const [selectedDonReturnIndices, setSelectedDonReturnIndices] = useState([]);

  const aiActionQueue = useRef([]);

  const [gs, gd] = useDevToolsReducer(rootReducer, null, 'OPC-Practice');

  // Everything below uses gs/gd
  const S = gs; // game state shorthand
  const D = gd; // dispatch shorthand

  const { flashItem } = useFlashQueue(S?.cardFlashQueue, D);

  // ── Auto-advance AI turn ───────────────────────────────────────────────────
  useEffect(() => {
    if (!S || S.winner) return;
    if (S.mulligan === 'pending') return;
    if (S.waitingFor !== PLAYER.AI) return;
    if (S.pendingEffect && S.pendingEffect.owner !== PLAYER.AI) return;

    // Auto-advance automatic phases
    if (S.phase === PHASE.REFRESH)  { D({ type: 'REFRESH' });   return; }
    if (S.phase === PHASE.DRAW)     { D({ type: 'DRAW' });      return; }
    if (S.phase === PHASE.DON)      { D({ type: 'DON_PHASE' }); return; }

    // Battle steps where AI is defending (human attacked)
    if (S.battle?.step === BATTLE_STEP.BLOCK && S.waitingFor === PLAYER.AI) {
      const decision = aiDecideBlock(S);
      const timer = setTimeout(() => D(decision), AI_ACTION_DELAY_MS);
      return () => clearTimeout(timer);
    }
    if (S.battle?.step === BATTLE_STEP.COUNTER && S.waitingFor === PLAYER.AI) {
      const decision = aiDecideCounter(S);
      const delay = decision.type === 'PLAY_COUNTER' ? AI_COUNTER_DELAY_MS : AI_ACTION_DELAY_MS;
      const timer = setTimeout(() => D(decision), delay);
      return () => clearTimeout(timer);
    }
    if (S.battle?.step === BATTLE_STEP.DAMAGE && S.waitingFor === PLAYER.AI) {
      const timer = setTimeout(() => D({ type: 'RESOLVE_DAMAGE' }), AI_ACTION_DELAY_MS);
      return () => clearTimeout(timer);
    }

    // AI auto-resolves interactive effect choices
    if (S.pendingEffect?.owner === PLAYER.AI) {
      const timer = setTimeout(() => D({ type: 'RESOLVE_EFFECT_CHOICE', selectedIndices: [] }), AI_ACTION_DELAY_MS);
      return () => clearTimeout(timer);
    }

    // AI main phase — execute queued actions
    if (S.phase === PHASE.MAIN && S.activePlayer === PLAYER.AI) {
      if (aiActionQueue.current.length === 0) {
        aiActionQueue.current = getAiTurnActions(S);
      }

      // If the next attack targets a character that was KO'd, the reducer returns the
      // same state reference → no re-render → AI loop deadlocks. Rebuild with fresh state.
      const peek = aiActionQueue.current[0];
      if (peek?.type === 'DECLARE_ATTACK' && peek.targetZone === 'character') {
        const tgt = S[peek.targetOwner]?.characterArea[peek.targetIndex];
        if (!tgt || tgt.state !== 'rest') {
          aiActionQueue.current = getAiTurnActions(S);
        }
      }

      const next = aiActionQueue.current.shift();
      if (!next) return;

      const timer = setTimeout(() => D(next), AI_ACTION_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [S]); // eslint-disable-line

  // Clear AI queue and any open field menus on turn change
  useEffect(() => {
    if (S?.activePlayer === PLAYER.HUMAN) {
      aiActionQueue.current = [];
    }
    setSelectedFieldCard(null);
  }, [S?.activePlayer]); // eslint-disable-line

  // ── Auto-advance human early phases (Refresh → Draw → DON) ──────────────
  useEffect(() => {
    if (!S || S.winner) return;
    if (S.mulligan === 'pending') return;
    if (S.waitingFor !== PLAYER.HUMAN || S.activePlayer !== PLAYER.HUMAN) return;

    const actionMap = {
      [PHASE.REFRESH]: 'REFRESH',
      [PHASE.DRAW]:    'DRAW',
      [PHASE.DON]:     'DON_PHASE',
    };
    const action = actionMap[S.phase];
    if (!action) return;

    const timer = setTimeout(() => D({ type: action }), 400);
    return () => clearTimeout(timer);
  }, [S]); // eslint-disable-line

  // Counter step: do NOT auto-skip — human must choose to counter or skip
  // Block step: also do NOT auto-skip — human must choose to block or skip first

  // ── Damage step: auto-resolve when waitingFor is the attacker ─────────────
  useEffect(() => {
    if (!S || S.winner) return;
    if (S.battle?.step !== BATTLE_STEP.DAMAGE) return;
    if (S.waitingFor !== S.battle.attackerOwner) return;
    const t = setTimeout(() => D({ type: 'RESOLVE_DAMAGE' }), 400);
    return () => clearTimeout(t);
  }, [S?.battle?.step, S?.waitingFor]); // eslint-disable-line

  // Must be computed and hoisted before early returns so the hook count stays constant
  const donReturnMode = S?.pendingEffect?.action?.type === 'CHOOSE_DON_RETURN' && S?.pendingEffect?.owner === PLAYER.HUMAN;
  useEffect(() => {
    if (!donReturnMode) setSelectedDonReturnIndices([]);
  }, [donReturnMode]); // eslint-disable-line

  if (!S) {
    return (
      <AiDeckPicker
        cards={cards}
        onSelect={(deckKey) => {
          const humanCards = expandDeck(deckList || {}, cards || []).filter(c => c.category !== 'Leader');
          if (!selectedLeader || humanCards.length < 10) return;
          const aiDeckList = parseDeckString(deckFinalData[deckKey]?.deck ?? '');
          const aiCards    = expandDeck(aiDeckList, cards || []).filter(c => c.category !== 'Leader');
          const aiLeader   = (cards || []).find(c => c.id === deckKey) ?? null;
          D({ type: 'START_GAME', initialState: createInitialState(selectedLeader, humanCards, aiLeader, aiCards) });
        }}
        onClose={onClose}
      />
    );
  }

  if (S.preGameAbility === 'STAGE_SEARCH') {
    return <PreGameAbilityScreen state={S} dispatch={D} onClose={onClose} />;
  }

  if (S.mulligan === 'pending') {
    return <MulliganScreen state={S} dispatch={D} onClose={onClose} />;
  }

  // ── Derived UI state ───────────────────────────────────────────────────────
  const humanPs  = S.human;
  const aiPs     = S.ai;
  const isMyTurn = S.activePlayer === PLAYER.HUMAN;
  const isMyInput = S.waitingFor  === PLAYER.HUMAN;
  const inBattle  = !!S.battle;
  const inBlock   = inBattle && S.battle.step === BATTLE_STEP.BLOCK;
  const inCounter = inBattle && S.battle.step === BATTLE_STEP.COUNTER;

  const selectedHandCard = selectedHandIndex !== null ? humanPs.hand[selectedHandIndex] : null;

  const handCostDeltas = humanPs.hand.map(card =>
    (humanPs.handCostMods ?? []).reduce((sum, mod) =>
      (!mod.filter || matchesFilter(card, mod.filter)) ? sum + mod.delta : sum, 0)
  );

  // Build action menu for selected hand card
  function buildHandActions(card, index) {
    if (!card || !isMyInput) return [];
    const actions = [];

    if (card.category === 'Character' && isMyTurn && S.phase === PHASE.MAIN && !inBattle) {
      const effectiveCost = Math.max(0, (card.cost ?? 0) + (handCostDeltas[index] ?? 0));
      const affordable = canAfford(humanPs.costArea, effectiveCost);
      const fieldFull  = humanPs.characterArea.length >= 5;
      actions.push({
        label: 'Deploy Character',
        icon: '⚔',
        disabled: !affordable,
        hint: !affordable
          ? `Need ${effectiveCost} DON!!`
          : fieldFull ? `Cost ${effectiveCost} — replaces a character` : `Cost ${effectiveCost}`,
        action: () => D({ type: 'PLAY_CHARACTER', handIndex: index }),
      });
    }

    if (card.category === 'Stage' && isMyTurn && S.phase === PHASE.MAIN && !inBattle) {
      const effectiveCost = Math.max(0, (card.cost ?? 0) + (handCostDeltas[index] ?? 0));
      const affordable = canAfford(humanPs.costArea, effectiveCost);
      actions.push({
        label: 'Deploy Stage',
        icon: '🏝',
        disabled: !affordable,
        hint: `Cost ${effectiveCost}`,
        action: () => D({ type: 'PLAY_STAGE', handIndex: index }),
      });
    }

    if (card.category === 'Event' && isMyTurn && S.phase === PHASE.MAIN && !inBattle) {
      const effectiveCost = Math.max(0, (card.cost ?? 0) + (handCostDeltas[index] ?? 0));
      const affordable = canAfford(humanPs.costArea, effectiveCost);
      actions.push({
        label: 'Activate Event',
        icon: '✨',
        disabled: !affordable,
        hint: `Cost ${effectiveCost}`,
        action: () => D({ type: 'PLAY_EVENT', handIndex: index }),
      });
    }

    if (isMyInput && inCounter && S.battle.targetOwner === PLAYER.HUMAN) {
      if (card.counter > 0) {
        actions.push({
          label: `Counter (+${card.counter.toLocaleString()})`,
          icon: '🛡',
          disabled: false,
          hint: `Boost defender by ${card.counter.toLocaleString()}`,
          action: () => D({ type: 'PLAY_COUNTER', handIndex: index }),
        });
      } else if (card.category === 'Event' && card.effect?.includes('【反擊】')) {
        actions.push({
          label: 'Counter Event (反擊)',
          icon: '🛡',
          disabled: false,
          hint: card.name,
          action: () => D({ type: 'PLAY_COUNTER', handIndex: index }),
        });
      }
    }

    return actions;
  }

  const handActions = buildHandActions(selectedHandCard, selectedHandIndex);

  // Actions for a clicked field card (own character or leader)
  function buildFieldActions(zone, index) {
    if (!isMyTurn || !isMyInput || S.phase !== PHASE.MAIN || inBattle) return [];
    const ps = humanPs;
    const fc = zone === 'leader' ? ps.leader : zone === 'stage' ? ps.stageArea : ps.characterArea[index];
    if (!fc) return [];
    const { card } = fc;
    const actions = [];

    // Attack — Rush from unconditional keyword OR from a currently-met conditional grant
    const continuousKws = evaluateContinuousKeywords(fc, S.activePlayer, PLAYER.HUMAN, S);
    const hasConditionalRush = continuousKws.has('速攻');
    const canAttack = fc.state === 'active'
      && !continuousKws.has('CANNOT_ATTACK')
      && (!fc.justDeployed || hasRush(card) || hasConditionalRush);
    if (zone !== 'stage') actions.push({
      label: 'Attack',
      icon: '⚔',
      disabled: !canAttack,
      hint: !canAttack
        ? (fc.state !== 'active' ? 'Already attacked this turn' : 'Summoning sickness — needs Rush')
        : zone === 'leader' ? 'Attack with Leader' : `Power ${card.power?.toLocaleString() ?? '?'}`,
      action: () => {
        setPendingAttackSrc({ zone, index });
        setSelectedFieldCard(null);
      },
    });

    // Activate: Main
    if (hasActivatedMain(card)) {
      const fieldPos = { target: zone === 'leader' ? 'leader' : zone === 'stage' ? 'stage' : index };
      const status = getActivatedMainStatus(card, ps, S, PLAYER.HUMAN, fieldPos);
      actions.push({
        label: 'Activate: Main',
        icon: '✦',
        disabled: !status?.available,
        hint: status?.hint ?? '',
        action: () => {
          D({ type: 'ACTIVATE_MAIN', zone, index });
          setSelectedFieldCard(null);
        },
      });
    }

    return actions;
  }

  const fieldCardForMenu = selectedFieldCard
    ? (selectedFieldCard.zone === 'leader'
        ? humanPs.leader?.card
        : selectedFieldCard.zone === 'stage'
          ? humanPs.stageArea?.card
          : humanPs.characterArea[selectedFieldCard.index]?.card)
    : null;
  const fieldActions = selectedFieldCard ? buildFieldActions(selectedFieldCard.zone, selectedFieldCard.index) : [];

  // Characters targetable for attack (opponent's rested characters)
  const attackableAiChars = new Set(
    aiPs.characterArea.map((fc, i) => fc.state === 'rest' ? i : -1).filter(i => i >= 0)
  );

  function handleMyLeaderClick() {
    if (!isMyTurn || !isMyInput) return;
    if (S.phase !== PHASE.MAIN || inBattle) return;

    // Open field card menu for leader
    setSelectedFieldCard({ zone: 'leader', index: -1 });
    setSelectedHandIndex(null);
    setPendingAttackSrc(null);
  }

  function handleMyCharacterClick(i) {
    if (!isMyInput) return;

    // Block step: human defending against AI attack
    if (inBlock && S.battle.targetOwner === PLAYER.HUMAN && S.waitingFor === PLAYER.HUMAN) {
      if (fcEffectiveHasBlocker(humanPs.characterArea[i], PLAYER.HUMAN, S.activePlayer, S) && humanPs.characterArea[i]?.state === 'active') {
        D({ type: 'USE_BLOCKER', blockerIndex: i });
      }
      return;
    }

    if (!isMyTurn || S.phase !== PHASE.MAIN || inBattle) return;

    if (pendingDonIds.size > 0) {
      D({ type: 'ATTACH_DON', targetZone: 'character', targetIndex: i, count: pendingDonIds.size });
      setPendingDonIds(new Set());
      return;
    }

    // Open field card menu
    setSelectedFieldCard({ zone: 'character', index: i });
    setSelectedHandIndex(null);
    setPendingAttackSrc(null);
  }

  function handleAiLeaderClick() {
    if (!pendingAttackSrc || !isMyTurn || !isMyInput) return;
    const attackerFC = pendingAttackSrc.zone === 'leader'
      ? humanPs.leader
      : humanPs.characterArea[pendingAttackSrc.index];
    if (attackerFC?.rushCharOnly) return; // Rush: Character only — cannot target leader
    D({ type: 'DECLARE_ATTACK', attackerZone: pendingAttackSrc.zone, attackerIndex: pendingAttackSrc.index, targetOwner: PLAYER.AI, targetZone: 'leader', targetIndex: -1 });
    setPendingAttackSrc(null);
  }

  function handleAiCharacterClick(i) {
    if (!isMyInput) return;

    if (pendingAttackSrc && isMyTurn) {
      if (aiPs.characterArea[i]?.state === 'rest') {
        D({ type: 'DECLARE_ATTACK', attackerZone: pendingAttackSrc.zone, attackerIndex: pendingAttackSrc.index, targetOwner: PLAYER.AI, targetZone: 'character', targetIndex: i });
        setPendingAttackSrc(null);
      }
      return;
    }
  }

  function handleDonCardClick(donId) {
    if (!isMyTurn || !isMyInput || S.phase !== PHASE.MAIN || inBattle) return;
    const isActive = humanPs.costArea.some(d => d._donId === donId && d.state === 'active');
    if (!isActive) return;
    setPendingDonIds(prev => {
      const next = new Set(prev);
      if (next.has(donId)) next.delete(donId); else next.add(donId);
      return next;
    });
    setSelectedHandIndex(null);
    setPendingAttackSrc(null);
  }

  function handleLeaderDonTarget() {
    if (!pendingDonIds.size) return;
    D({ type: 'ATTACH_DON', targetZone: 'leader', targetIndex: -1, count: pendingDonIds.size });
    setPendingDonIds(new Set());
  }

  const donReturnOptions = donReturnMode ? S.pendingEffect.choices.options : null;

  function handleDonReturnClick(optionIndex) {
    const count = S.pendingEffect.choices.count;
    const next = selectedDonReturnIndices.includes(optionIndex)
      ? selectedDonReturnIndices.filter(i => i !== optionIndex)
      : [...selectedDonReturnIndices, optionIndex];
    if (next.length >= count) {
      D({ type: 'RESOLVE_EFFECT_CHOICE', selectedIndices: next.slice(0, count) });
      setSelectedDonReturnIndices([]);
    } else {
      setSelectedDonReturnIndices(next);
    }
  }

  function handleCostDonReturnClick(donId) {
    const optIndex = donReturnOptions.findIndex(o => o.source === 'cost' && o.donId === donId);
    if (optIndex >= 0) handleDonReturnClick(optIndex);
  }

  function handleLeaderDonReturn() {
    const opts = (donReturnOptions || []).map((o, i) => ({ opt: o, index: i })).filter(({ opt }) => opt.source === 'leader');
    const next = opts.find(({ index }) => !selectedDonReturnIndices.includes(index));
    if (next) { handleDonReturnClick(next.index); return; }
    const last = [...opts].reverse().find(({ index }) => selectedDonReturnIndices.includes(index));
    if (last) handleDonReturnClick(last.index);
  }

  function handleCharDonReturn(ci) {
    const opts = (donReturnOptions || []).map((o, i) => ({ opt: o, index: i })).filter(({ opt }) => opt.source === 'character' && opt.charIndex === ci);
    const next = opts.find(({ index }) => !selectedDonReturnIndices.includes(index));
    if (next) { handleDonReturnClick(next.index); return; }
    const last = [...opts].reverse().find(({ index }) => selectedDonReturnIndices.includes(index));
    if (last) handleDonReturnClick(last.index);
  }

  const attackMode  = !!pendingAttackSrc;
  const donMode     = pendingDonIds.size > 0;

  const gameOver = !!S.winner;
  const humanWon = S.winner === PLAYER.HUMAN;

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col overflow-hidden z-50 select-none"
      onClick={() => { if (donMode) setPendingDonIds(new Set()); }}
    >
      {/* Back button / winner banner */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1 bg-slate-950 border-b border-slate-800">
        <button onClick={onClose} className="text-slate-400 hover:text-white text-sm font-bold flex items-center gap-1">
          ← Back
        </button>
        {gameOver ? (
          <span className={`text-sm font-black ${humanWon ? 'text-yellow-400' : 'text-red-400'}`}>
            {humanWon ? '🏆 You Win!' : '💀 You Lost'}
          </span>
        ) : (
          <span className="text-[10px] text-slate-500 font-mono">
            {attackMode ? '⚔ Select target' : donMode ? `🟢 Select target (${pendingDonIds.size} DON!! selected)` : ''}
          </span>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => D({ type: 'TOGGLE_REVEAL_OPPONENT' })}
            title="Reveal opponent hand & life cards (dev)"
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
              S.devRevealOpponent
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                : 'border-slate-700 text-slate-600 hover:text-slate-400'
            }`}
          >
            {S.devRevealOpponent ? 'X-RAY ON' : 'X-RAY'}
          </button>
          <span className="text-[10px] text-slate-600">Turn {S.turn}</span>
        </div>
      </div>

      {/* AI's field (top) */}
      <div className="flex-shrink-0">
        <PlayerField
          playerState={aiPs}
          isOpponent
          battle={S.battle}
          activePlayer={S.activePlayer}
          owner={PLAYER.AI}
          state={S}
          targetableChars={attackMode ? attackableAiChars : null}
          onLeaderClick={handleAiLeaderClick}
          onCharacterClick={handleAiCharacterClick}
          onTrashClick={() => setTrashView('ai')}
          revealed={gameOver || S.devRevealOpponent}
        />
      </div>

      {/* Phase bar + battle info */}
      <PhaseBar
        state={S}
        onEndTurn={() => D({ type: 'END_TURN' })}
        onSkipBlock={() => D({ type: 'SKIP_BLOCK' })}
        onSkipCounter={() => D({ type: 'SKIP_COUNTER' })}
      />
      <BattleOverlay battle={S.battle} humanState={humanPs} aiState={aiPs} />
      <AttackArrow battle={S.battle} />

      {/* Human's field (bottom) */}
      <div className="flex-shrink-0">
        <PlayerField
          playerState={humanPs}
          isOpponent={false}
          battle={S.battle}
          activePlayer={S.activePlayer}
          owner={PLAYER.HUMAN}
          state={S}
          selectedZone={pendingAttackSrc?.zone}
          selectedIndex={pendingAttackSrc?.index}
          onLeaderClick={donReturnMode ? handleLeaderDonReturn : (donMode ? handleLeaderDonTarget : handleMyLeaderClick)}
          onCharacterClick={donReturnMode ? handleCharDonReturn : handleMyCharacterClick}
          onStageClick={() => {
            if (!isMyTurn || !isMyInput || S.phase !== PHASE.MAIN || inBattle) return;
            setSelectedFieldCard({ zone: 'stage', index: 0 });
          }}
          onDonCardClick={handleDonCardClick}
          onTrashClick={() => setTrashView('human')}
          donPendingIds={pendingDonIds}
          donReturnMode={donReturnMode}
          donReturnOptions={donReturnOptions}
          selectedDonReturnIndices={selectedDonReturnIndices}
          onCostDonReturnClick={handleCostDonReturnClick}
          revealed={gameOver}
        />
      </div>

      {/* Hand */}
      <div className="flex-1 overflow-hidden border-t border-slate-800 bg-slate-900/50">
        <HandArea
          hand={humanPs.hand}
          costDeltas={handCostDeltas}
          selectedIndex={selectedHandIndex}
          onCardClick={(i) => {
            setPendingAttackSrc(null);
            setPendingDonIds(new Set());
            setSelectedHandIndex(prev => prev === i ? null : i);
          }}
          highlightIndices={
            inCounter && S.battle?.targetOwner === PLAYER.HUMAN
              ? humanPs.hand.map((c, i) =>
                  (c.counter > 0 || (c.category === 'Event' && c.effect?.includes('【反擊】'))) ? i : -1
                ).filter(i => i >= 0)
              : []
          }
        />
      </div>

      <DonReturnBar
        pendingEffect={donReturnMode ? S.pendingEffect : null}
        selectedCount={selectedDonReturnIndices.length}
      />

      <TriggerBar
        trigger={S.pendingTrigger}
        onResolve={(activate) => D({ type: 'RESOLVE_TRIGGER', activate })}
      />

      <GameLog log={S.log} isOpen={logOpen} onToggle={() => setLogOpen(v => !v)} />

      {/* Overlays */}
      {selectedHandCard && handActions.length > 0 && (
        <ActionMenu
          card={selectedHandCard}
          actions={handActions}
          onAction={a => a.action()}
          onClose={() => setSelectedHandIndex(null)}
        />
      )}

      {fieldCardForMenu && fieldActions.length > 0 && (
        <ActionMenu
          card={fieldCardForMenu}
          actions={fieldActions}
          onAction={a => a.action()}
          onClose={() => setSelectedFieldCard(null)}
        />
      )}

      <EffectModal
        pendingEffect={donReturnMode ? null : S.pendingEffect}
        pendingReplace={S.pendingReplace}
        state={S}
        onResolve={(selectedIndices, meta) => D({ type: 'RESOLVE_EFFECT_CHOICE', selectedIndices, ...meta })}
        onReplace={(replaceIndex) => D({ type: 'RESOLVE_REPLACE', replaceIndex })}
      />

      {/* State Simulator toggle button (dev/debug) */}
      <button
        onClick={() => setSimOpen(v => !v)}
        title="State Simulator (Redux DevTools)"
        className="fixed bottom-3 right-3 z-40 w-8 h-8 rounded-full bg-purple-700/80 hover:bg-purple-600 text-white text-xs font-black shadow-lg flex items-center justify-center transition-colors"
      >
        ⚙
      </button>

      {simOpen && S && (
        <StateSimulator
          gameState={S}
          allCards={cards}
          dispatch={D}
          onClose={() => setSimOpen(false)}
        />
      )}

      {trashView && (
        <TrashModal
          trash={trashView === 'human' ? humanPs.trash : aiPs.trash}
          label={trashView === 'human' ? 'Your' : "Opponent's"}
          onClose={() => setTrashView(null)}
        />
      )}

      <CardFlashOverlay flashItem={flashItem} />
    </div>
  );
}
