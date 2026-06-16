import React, { useEffect, useState, useRef } from 'react';
import { PHASE, BATTLE_STEP, PLAYER } from './engine/constants';
import { gameReducer, createInitialState, canAfford } from './engine/gameState';
import { aiDecideBlock, aiDecideCounter, getAiTurnActions } from './engine/aiPlayer';
import { getLeaderProfile } from './engine/leaderProfiles';
import { hasRush, hasActivatedMain, getActivatedMainStatus, evaluateContinuousKeywords, fcEffectiveHasBlocker, getEffectiveCounter } from './engine/effects';
import { matchesFilter, getSelfCondHandCostDelta } from './engine/effectActions';
import { useFlashQueue } from './hooks/useFlashQueue';

import PlayerField    from './components/PlayerField';
import HandArea       from './components/HandArea';
import PhaseBar, { PHASE_LABELS, PHASE_COLORS } from './components/PhaseBar';
import TriggerBar     from './components/TriggerModal';
import DonReturnBar   from './components/DonReturnBar';
import EffectModal    from './components/EffectModal';
import GameLog        from './components/GameLog';
import TrashModal     from './components/TrashModal';
import AiDeckPicker   from './components/AiDeckPicker';
import AttackArrow       from './components/AttackArrow';
import RedirectArrow     from './components/RedirectArrow';
import StateSimulator    from './components/StateSimulator';
import NewWindowPortal   from './components/NewWindowPortal';
import CardFlashOverlay  from './components/CardFlashOverlay';
import EventPlayOverlay  from './components/EventPlayOverlay';
import MulliganScreen    from './components/MulliganScreen';
import PreGameAbilityScreen from './components/PreGameAbilityScreen';
import { useDevToolsReducer } from './hooks/useDevToolsReducer';
import WaitingBanner from '../pvp/WaitingBanner';

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
  if (action.type === 'LOAD_STATE') return action.state;
  if (action.type === 'REORDER_HAND') {
    const { owner, fromIndex, toIndex } = action;
    const ps = state[owner];
    const newHand = [...ps.hand];
    const [card] = newHand.splice(fromIndex, 1);
    newHand.splice(toIndex, 0, card);
    return { ...state, [owner]: { ...ps, hand: newHand } };
  }
  return gameReducer(state, action);
}

const AI_ACTION_DELAY_MS = 700; // pause between AI actions for readability
const AI_COUNTER_DELAY_MS = 1200; // longer delay so each counter card flash completes (flash lasts 1200ms)
const AI_FIELD_PLAY_DELAY_MS = 1200; // matches flash duration so human can track the card placed

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
function checkViewport() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    isPortrait: h > w && w < 900,
    isCompact:  h < 500,
  };
}

export default function PracticeView({ deckList, selectedLeader, cards, onClose, pvpMode = false, pvpGameHook, myRole = PLAYER.HOST, ggDecksData = {}, officialDecksData = [], prevMetaData = {} }) {
  const [logOpen, setLogOpen]     = useState(false);
  const [trashView, setTrashView] = useState(null); // null | 'host' | 'guest'
  const [simOpen, setSimOpen]     = useState(false);
  const [passiveAi, setPassiveAi] = useState(false);
  const [pvpMyMulliganDone, setPvpMyMulliganDone] = useState(false);

  const [viewport, setViewport] = useState(checkViewport);
  useEffect(() => {
    const handler = () => setViewport(checkViewport());
    // orientationchange fires before dimensions update on iOS — use longer defer
    const orientationHandler = () => setTimeout(handler, 200);
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', orientationHandler);
    // visualViewport is more reliable than resize on iOS Safari
    window.visualViewport?.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', orientationHandler);
      window.visualViewport?.removeEventListener('resize', handler);
    };
  }, []);
  const { isCompact } = viewport;

  // UI selection state
  const [selectedHandIndex, setSelectedHandIndex]     = useState(null);
  const [selectedFieldCard, setSelectedFieldCard]     = useState(null); // { zone, index }
  const [pendingAttackSrc, setPendingAttackSrc]       = useState(null); // { zone, index }
  const [pendingDonIds, setPendingDonIds]             = useState(new Set());
  const [selectedDonReturnIndices, setSelectedDonReturnIndices] = useState([]);
  const [effectHoveredKey, setEffectHoveredKey]       = useState(null);

  const aiActionQueue       = useRef([]);
  const aiLastWasFieldPlay  = useRef(false);
  const actionJournalRef    = useRef([]);
  const initialStateRef  = useRef(null);
  const handScrollRef    = useRef(null);

  const [localGs, localGd] = useDevToolsReducer(rootReducer, null, 'OPC-Practice');
  const [_gs, _gd] = pvpMode ? pvpGameHook : [localGs, localGd];

  const S = _gs;
  // Wrap dispatch to track guest mulligan completion locally and record the hidden game journal
  function D(action) {
    if (action.type === 'START_GAME') {
      initialStateRef.current  = action.initialState;
      actionJournalRef.current = [];
    } else {
      actionJournalRef.current.push({ action, timestamp: Date.now() });
    }
    _gd(action);
    if (pvpMode && myRole === PLAYER.GUEST &&
        (action.type === 'MULLIGAN_KEEP' || action.type === 'MULLIGAN_REDRAW')) {
      setPvpMyMulliganDone(true);
    }
  }

  function handleBugReport() {
    const report = {
      reportedAt:    new Date().toISOString(),
      initialState:  initialStateRef.current,
      actionJournal: actionJournalRef.current,
      currentState:  S,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `bug-report-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const { flashItem } = useFlashQueue(S?.cardFlashQueue, D, myRole);
  const fieldFlashFcId = (flashItem?.label === 'PLAY_CHARACTER' || flashItem?.label === 'PLAY_STAGE')
    ? flashItem.fieldFcId ?? null : null;
  const donFlashItem = (flashItem?.label === 'DON_GAIN' || flashItem?.label === 'DON_ACTIVATE')
    ? flashItem : null;

  // ── On-play overlay: activate after field-dim flash ends ──────────────────
  const prevFieldFlashRef = useRef(null);
  useEffect(() => {
    const prev = prevFieldFlashRef.current;
    prevFieldFlashRef.current = fieldFlashFcId;
    if (!prev || fieldFlashFcId) return; // only on falsy transition
    if (S?.pendingOnPlayOverlay) {
      D({ type: 'ACTIVATE_ON_PLAY_OVERLAY' });
    }
  }, [fieldFlashFcId]); // eslint-disable-line

  // ── Event play overlay — auto-clear after 1500 ms ─────────────────────────
  useEffect(() => {
    if (!S?.eventOverlay) return;
    const t = setTimeout(() => D({ type: 'CLEAR_EVENT_OVERLAY' }), 1800);
    return () => clearTimeout(t);
  }, [S?.eventOverlay]); // eslint-disable-line

  // ── Auto-advance AI turn ───────────────────────────────────────────────────
  useEffect(() => {
    if (pvpMode) return; // PvP: no AI auto-play; human controls both sides
    if (!S || S.winner) return;
    if (S.mulligan === 'pending') return;
    if (S.waitingFor !== PLAYER.GUEST) return;
    if (S.pendingEffect && (S.pendingEffect.choices?.promptPlayer ?? S.pendingEffect.owner) !== PLAYER.GUEST) return;

    // Auto-advance automatic phases
    if (S.phase === PHASE.REFRESH)  { D({ type: 'REFRESH' });   return; }
    if (S.phase === PHASE.DRAW)     { D({ type: 'DRAW' });      return; }
    if (S.phase === PHASE.DON)      { D({ type: 'DON_PHASE' }); return; }

    // Battle steps where AI is defending (human attacked)
    if (S.battle?.step === BATTLE_STEP.BLOCK && S.waitingFor === PLAYER.GUEST) {
      const decision = aiDecideBlock(S);
      const timer = setTimeout(() => D(decision), AI_ACTION_DELAY_MS);
      return () => clearTimeout(timer);
    }
    if (S.battle?.step === BATTLE_STEP.COUNTER && S.waitingFor === PLAYER.GUEST) {
      const decision = aiDecideCounter(S);
      const delay = decision.type === 'PLAY_COUNTER' ? AI_COUNTER_DELAY_MS : AI_ACTION_DELAY_MS;
      const timer = setTimeout(() => D(decision), delay);
      return () => clearTimeout(timer);
    }
    if (S.battle?.step === BATTLE_STEP.DAMAGE && S.waitingFor === PLAYER.GUEST) {
      const timer = setTimeout(() => D({ type: 'RESOLVE_DAMAGE' }), AI_ACTION_DELAY_MS);
      return () => clearTimeout(timer);
    }

    // AI auto-resolves interactive effect choices
    if ((S.pendingEffect?.choices?.promptPlayer ?? S.pendingEffect?.owner) === PLAYER.GUEST) {
      let selectedIndices = [];
      // CHOOSE_DEPLOY_FROM_TRASH: use the leader's trashDeployPriority to pick the best target
      if (S.pendingEffect.choices?.type === 'CHOOSE_DEPLOY_FROM_TRASH') {
        const _lp  = getLeaderProfile(S[PLAYER.GUEST]?.leader?.card?.id);
        const _pri = _lp?.trashDeployPriority ?? [];
        if (_pri.length) {
          const _src   = S.pendingEffect.choices.sourceOwner;
          const _trash = S[_src]?.trash ?? [];
          const _valid = new Set(S.pendingEffect.choices.indices ?? []);
          const _base  = id => (id ?? '').replace(/_p\d+$/, '').replace(/_r$/, '');
          for (const pid of _pri) {
            const idx = _trash.findIndex((c, i) => _base(c.id) === pid && _valid.has(i));
            if (idx !== -1) { selectedIndices = [idx]; break; }
          }
        }
      }
      const timer = setTimeout(() => D({ type: 'RESOLVE_EFFECT_CHOICE', selectedIndices }), AI_ACTION_DELAY_MS);
      return () => clearTimeout(timer);
    }

    // Passive AI: skip the entire main phase, immediately end turn
    if (passiveAi && S.phase === PHASE.MAIN && S.activePlayer === PLAYER.GUEST) {
      const timer = setTimeout(() => D({ type: 'END_TURN' }), AI_ACTION_DELAY_MS);
      return () => clearTimeout(timer);
    }

    // AI main phase — execute queued actions
    if (S.phase === PHASE.MAIN && S.activePlayer === PLAYER.GUEST) {
      if (aiActionQueue.current.length === 0) {
        aiActionQueue.current = getAiTurnActions(S);
      }

      // Stale-queue guard: if the planned action would be silently rejected by the
      // reducer (same state reference returned → no re-render → deadlock), rebuild with the
      // current board. This covers:
      //   DECLARE_ATTACK: invalid attacker (rested/locked by on-play effect) or KO'd target
      //   PLAY_CHARACTER: on-play effects mutate the hand (add/discard cards), shifting indices
      //     and/or exhausting DON, leaving the planned handIndex pointing at the wrong or
      //     unaffordable card.
      const peek = aiActionQueue.current[0];
      if (peek?.type === 'DECLARE_ATTACK') {
        let stale = false;
        const guestPs = S[S.activePlayer];
        if (peek.attackerZone === 'character') {
          // If we have a stable _fcId, resolve the current index first — in-flight KOs
          // can shift the characterArea array so the planned index points to the wrong card.
          if (peek._attackerFcId) {
            const realIdx = guestPs?.characterArea.findIndex(fc => fc._fcId === peek._attackerFcId);
            if (realIdx === -1) {
              stale = true; // intended attacker was KO'd since planning — re-plan
            } else {
              peek.attackerIndex = realIdx; // fix the index before the staleness check below
            }
          }
          if (!stale) {
            const atkFC = guestPs?.characterArea[peek.attackerIndex];
            if (!atkFC || atkFC.state !== 'active' || (atkFC.justDeployed && !evaluateContinuousKeywords(atkFC, S.activePlayer, S.activePlayer, S).has('速攻') && !atkFC.tempKeywords?.includes('速攻') && !atkFC.tempKeywords?.includes('Rush')) || atkFC.attackLocked || atkFC.restLocked) stale = true;
          }
        } else if (peek.attackerZone === 'leader') {
          if (guestPs?.leader?.state !== 'active') stale = true;
        }
        if (!stale && peek.targetZone === 'character') {
          const tgt = S[peek.targetOwner]?.characterArea[peek.targetIndex];
          // Leaders with reactivateAfterCharBattle intentionally target active chars — skip rest check.
          const leaderReactivating = peek.attackerZone === 'leader' && S[S.activePlayer]?.leader?.reactivateAfterCharBattle;
          if (!tgt || (!leaderReactivating && tgt.state !== 'rest')) stale = true;
        }
        if (stale) aiActionQueue.current = getAiTurnActions(S);
      }
      if (peek?.type === 'PLAY_CHARACTER' || peek?.type === 'PLAY_STAGE' || peek?.type === 'PLAY_EVENT') {
        const guestPs = S[PLAYER.GUEST];
        const card = guestPs?.hand[peek.handIndex];
        if (!card || !canAfford(guestPs.costArea, card.cost) || guestPs?.handPlayLocked) {
          aiActionQueue.current = getAiTurnActions(S);
        }
      }
      if (peek?.type === 'ACTIVATE_MAIN' && peek.zone === 'character') {
        const guestPs = S[PLAYER.GUEST];
        const fc = guestPs?.characterArea[peek.index];
        // Rebuild queue if character is gone OR activation is no longer available (e.g. wrong card
        // was deployed due to hand-order shift, effect already used, or condition no longer met).
        const status = fc ? getActivatedMainStatus(fc.card, guestPs, S, PLAYER.GUEST, { target: peek.index }) : null;
        if (!status?.available) aiActionQueue.current = getAiTurnActions(S);
      }
      if (peek?.type === 'ATTACH_DON') {
        // Rebuild queue if there are no active DON!! — applyAttachDon would be a no-op,
        // and without this guard the AI freezes because a no-op dispatch used to return
        // the same state reference, preventing React from re-rendering.
        const guestPs = S[PLAYER.GUEST];
        const hasActiveDon = (guestPs?.costArea ?? []).some(d => d.state === 'active');
        if (!hasActiveDon) aiActionQueue.current = getAiTurnActions(S);
      }

      const next = aiActionQueue.current.shift();
      if (!next) return;

      // Track whether the action was dispatched before cleanup fires.
      // CONSUME_FLASH_QUEUE (from useFlashQueue) changes S without advancing
      // the AI's intended sequence, canceling this timer prematurely. By putting
      // the action back when it wasn't dispatched yet, the next effect run
      // re-schedules it so it actually executes.
      const delay = aiLastWasFieldPlay.current ? AI_FIELD_PLAY_DELAY_MS : AI_ACTION_DELAY_MS;
      let dispatched = false;
      const timer = setTimeout(() => {
        dispatched = true;
        aiLastWasFieldPlay.current = next.type === 'PLAY_CHARACTER' || next.type === 'PLAY_STAGE';
        D(next);
      }, delay);
      return () => { clearTimeout(timer); if (!dispatched) aiActionQueue.current.unshift(next); };
    }
  }, [S, passiveAi]); // eslint-disable-line

  // Clear AI queue and any open field menus on turn change
  useEffect(() => {
    if (S?.activePlayer === PLAYER.HOST) {
      aiActionQueue.current = [];
    }
    setSelectedFieldCard(null);
  }, [S?.activePlayer]); // eslint-disable-line

  // ── Auto-advance human early phases (Refresh → Draw → DON) ──────────────
  useEffect(() => {
    if (!S || S.winner) return;
    if (S.mulligan === 'pending') return;
    if (S.waitingFor !== PLAYER.HOST || S.activePlayer !== PLAYER.HOST) return;
    if (S.pendingEffect) return; // wait for player to resolve any pending effect first

    const actionMap = {
      [PHASE.REFRESH]: 'REFRESH',
      [PHASE.DRAW]:    'DRAW',
      [PHASE.DON]:     'DON_PHASE',
    };
    const action = actionMap[S.phase];
    if (!action) return;

    // In PvP the host runs these locally without Firestore writes — no delay needed.
    // In practice mode keep the 400ms so AI moves are readable.
    const timer = setTimeout(() => D({ type: action }), pvpMode ? 0 : 400);
    return () => clearTimeout(timer);
  }, [S]); // eslint-disable-line

  // ── PvP host: auto-advance early phases for guest (AI) side ──────────────
  // The guest never dispatches REFRESH/DRAW/DON — host handles them for both sides.
  useEffect(() => {
    if (!pvpMode || myRole !== PLAYER.HOST) return;
    if (!S || S.winner) return;
    if (S.mulligan === 'pending') return;
    if (S.waitingFor !== PLAYER.GUEST) return;
    if (S.pendingEffect) return; // wait for any pending effect to resolve first

    const actionMap = {
      [PHASE.REFRESH]: 'REFRESH',
      [PHASE.DRAW]:    'DRAW',
      [PHASE.DON]:     'DON_PHASE',
    };
    const action = actionMap[S.phase];
    if (!action) return;

    // No delay — these phases are invisible to the guest until MAIN anyway.
    const timer = setTimeout(() => D({ type: action }), 0);
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
  const donReturnMode = S?.pendingEffect?.action?.type === 'CHOOSE_DON_RETURN' && S?.pendingEffect?.owner === myRole;
  useEffect(() => {
    if (!donReturnMode) setSelectedDonReturnIndices([]);
  }, [donReturnMode]); // eslint-disable-line

  if (!S) {
    if (pvpMode) {
      // PvP: game state comes from Firestore — show loading until it arrives
      return (
        <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50">
          <p className="text-slate-400 text-sm animate-pulse">Connecting to game...</p>
        </div>
      );
    }
    return (
      <AiDeckPicker
        cards={cards}
        ggDecksData={ggDecksData}
        officialDecksData={officialDecksData}
        prevMetaData={prevMetaData}
        onSelect={({ deckStr, leaderId }) => {
          const hostCards = expandDeck(deckList || {}, cards || []).filter(c => c.category !== 'Leader');
          if (!selectedLeader || hostCards.length < 10) return;
          const aiDeckList = parseDeckString(deckStr);
          const guestCards    = expandDeck(aiDeckList, cards || []).filter(c => c.category !== 'Leader');
          const guestLeader   = (cards || []).find(c => c.id === leaderId) ?? null;
          D({ type: 'START_GAME', initialState: createInitialState(selectedLeader, hostCards, guestLeader, guestCards) });
        }}
        onClose={onClose}
      />
    );
  }

  if (S.preGameAbility === 'STAGE_SEARCH' && (!pvpMode || myRole === S.preGameAbilityOwner)) {
    return <PreGameAbilityScreen state={S} dispatch={D} onClose={onClose} myRole={myRole} />;
  }

  // Mulligan: show until this player has decided.
  // In PvP mode, guest tracks their own mulligan locally (pvpMyMulliganDone).
  const showMulligan = pvpMode
    ? (myRole === PLAYER.HOST ? S.mulligan === 'pending' : (S.mulligan === 'pending' && !pvpMyMulliganDone))
    : S.mulligan === 'pending';

  if (showMulligan) {
    // Guest sees their own hand (ai side), so we swap the perspective for MulliganScreen
    const mulliganViewState = (pvpMode && myRole === PLAYER.GUEST) ? {
      ...S,
      host: S.guest,
      guest: S.host,
      firstPlayer: S.firstPlayer === PLAYER.HOST ? PLAYER.GUEST : PLAYER.HOST,
    } : S;
    return <MulliganScreen state={mulliganViewState} dispatch={D} onClose={onClose} />;
  }

  // ── Derived UI state ───────────────────────────────────────────────────────
  // In PvP mode the guest plays the 'guest' engine side — swap perspective so their
  // side always renders at the bottom and they see their own hand.
  const guestPerspective = pvpMode && myRole === PLAYER.GUEST;
  const myPs       = guestPerspective ? S.guest    : S.host;
  const opponentPs = guestPerspective ? S.host : S.guest;
  const myOwner       = guestPerspective ? PLAYER.GUEST    : PLAYER.HOST;
  const opponentOwner = guestPerspective ? PLAYER.HOST : PLAYER.GUEST;
  // Keep legacy aliases so unchanged code below compiles without modification
  const hostPs = myPs;
  const guestPs    = opponentPs;

  const isMyTurn  = S.activePlayer === myOwner;
  const isMyInput = S.waitingFor   === myOwner;
  const inBattle  = !!S.battle;
  const inBlock   = inBattle && S.battle.step === BATTLE_STEP.BLOCK;
  const inCounter = inBattle && S.battle.step === BATTLE_STEP.COUNTER;
  const humanIsCountering = inCounter && S.battle?.targetOwner === myOwner && isMyInput;

  const effectHighlight = (() => {
    if (effectHoveredKey === null) return null;
    if (S.pendingReplace && !S.pendingEffect) {
      return { zone: 'character', index: effectHoveredKey, targetOwner: S.pendingReplace.owner };
    }
    const choices = S.pendingEffect?.choices;
    if (choices?.type === 'CHOOSE_GRANT_KEYWORD_TARGET') {
      if (effectHoveredKey === 'leader') return { zone: 'leader', targetOwner: choices.targetOwner };
      return { zone: 'character', index: effectHoveredKey, targetOwner: choices.targetOwner };
    }
    const targets = choices?.targets;
    const t = targets?.[effectHoveredKey] ?? null;
    if (!t) return null;
    const targetOwner = t.ownerKey ?? t.owner ?? choices?.targetOwner ?? S.pendingEffect?.owner ?? null;
    return { ...t, targetOwner };
  })();

  const selectedHandCard = selectedHandIndex !== null ? myPs.hand[selectedHandIndex] : null;

  const handCostDeltas = myPs.hand.map(card =>
    (myPs.handCostMods ?? []).reduce((sum, mod) =>
      (!mod.filter || matchesFilter(card, mod.filter)) ? sum + mod.delta : sum, 0)
    + getSelfCondHandCostDelta(card, S, myOwner)
  );

  // Build action menu for selected hand card
  function buildHandActions(card, index) {
    if (!card || !isMyInput) return [];
    const actions = [];

    if (card.category === 'Character' && isMyTurn && S.phase === PHASE.MAIN && !inBattle) {
      const effectiveCost = Math.max(0, (card.cost ?? 0) + (handCostDeltas[index] ?? 0));
      const affordable = canAfford(myPs.costArea, effectiveCost);
      const fieldFull  = hostPs.characterArea.length >= 5;
      actions.push({
        label: 'Play Character',
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
      const affordable = canAfford(myPs.costArea, effectiveCost);
      actions.push({
        label: 'Play Stage',
        icon: '🏝',
        disabled: !affordable,
        hint: `Cost ${effectiveCost}`,
        action: () => D({ type: 'PLAY_STAGE', handIndex: index }),
      });
    }

    const isCounterOnlyEvent = card.category === 'Event' &&
      (card.effect?.includes('【反擊】') || card.effect?.includes('[Counter]')) &&
      !card.effect?.includes('【主要】') && !card.effect?.includes('[Main]');
    if (card.category === 'Event' && isMyTurn && S.phase === PHASE.MAIN && !inBattle && !isCounterOnlyEvent) {
      const effectiveCost = Math.max(0, (card.cost ?? 0) + (handCostDeltas[index] ?? 0));
      const affordable = canAfford(myPs.costArea, effectiveCost);
      actions.push({
        label: 'Play Event',
        icon: '✨',
        disabled: !affordable,
        hint: `Cost ${effectiveCost}`,
        action: () => D({ type: 'PLAY_EVENT', handIndex: index }),
      });
    }

    if (isMyInput && inCounter && S.battle.targetOwner === myOwner) {
      const effCounter = getEffectiveCounter(card, S, myOwner);
      if (effCounter > 0) {
        actions.push({
          label: `Activate +${effCounter.toLocaleString()}`,
          icon: '🛡',
          disabled: false,
          hint: `Boost defender by ${effCounter.toLocaleString()}`,
          action: () => D({ type: 'PLAY_COUNTER', handIndex: index }),
        });
      } else if (card.category === 'Event' && (card.effect?.includes('【反擊】') || card.effect?.includes('[Counter]'))) {
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
    const ps = hostPs;
    const fc = zone === 'leader' ? ps.leader : zone === 'stage' ? ps.stageArea : ps.characterArea[index];
    if (!fc) return [];
    const { card } = fc;
    const actions = [];

    // Attack — Rush from unconditional keyword OR from a currently-met conditional grant
    const continuousKws = evaluateContinuousKeywords(fc, S.activePlayer, myOwner, S);
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
      const status = getActivatedMainStatus(card, ps, S, myOwner, fieldPos);
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
        ? hostPs.leader?.card
        : selectedFieldCard.zone === 'stage'
          ? hostPs.stageArea?.card
          : hostPs.characterArea[selectedFieldCard.index]?.card)
    : null;
  const fieldActions = selectedFieldCard ? buildFieldActions(selectedFieldCard.zone, selectedFieldCard.index) : [];

  // Characters targetable for attack (opponent's rested characters, or active if attacker has RUSH_ACTIVE_CHARS)
  const pendingAttackerFC = pendingAttackSrc
    ? (pendingAttackSrc.zone === 'leader' ? hostPs.leader : hostPs.characterArea[pendingAttackSrc.index])
    : null;
  const attackerCanHitActive = !!pendingAttackerFC?.tempKeywords?.includes('RUSH_ACTIVE_CHARS');
  const attackableAiChars = new Set(
    guestPs.characterArea.map((fc, i) => (fc.state === 'rest' || attackerCanHitActive) ? i : -1).filter(i => i >= 0)
  );

  function handleMyLeaderClick() {
    // Block step: clicking own leader tries to use it as a blocker
    if (inBlock && S.battle.targetOwner === myOwner && S.waitingFor === myOwner) {
      if (fcEffectiveHasBlocker(myPs.leader, myOwner, S.activePlayer, S) && myPs.leader?.state === 'active' && !myPs.leader?.blockerDisabled) {
        D({ type: 'USE_BLOCKER', blockerIndex: 'leader' });
      }
      return;
    }
    // In attack mode the leader is a potential attacker-swap, not an info select
    if (attackMode) return;
    setSelectedFieldCard({ zone: 'leader', index: -1 });
    setSelectedHandIndex(null);
    setPendingAttackSrc(null);
  }

  function handleMyCharacterClick(i) {
    // Block step: clicking own character tries to use it as a blocker
    if (inBlock && S.battle.targetOwner === myOwner && S.waitingFor === myOwner) {
      if (fcEffectiveHasBlocker(myPs.characterArea[i], myOwner, S.activePlayer, S) && myPs.characterArea[i]?.state === 'active' && !myPs.characterArea[i]?.blockerDisabled) {
        D({ type: 'USE_BLOCKER', blockerIndex: i });
      }
      return;
    }

    // DON mode: attach selected DON to this character
    if (pendingDonIds.size > 0 && isMyTurn && isMyInput && S.phase === PHASE.MAIN && !inBattle) {
      D({ type: 'ATTACH_DON', targetZone: 'character', targetIndex: i, count: pendingDonIds.size });
      setPendingDonIds(new Set());
      return;
    }

    // Always select the character to show its info + available actions in the status bar
    // (buildFieldActions handles which actions are valid for the current game state)
    setSelectedFieldCard({ zone: 'character', index: i });
    setSelectedHandIndex(null);
    setPendingAttackSrc(null);
  }

  function handleAiLeaderClick() {
    if (!pendingAttackSrc || !isMyTurn || !isMyInput) return;
    const attackerFC = pendingAttackSrc.zone === 'leader'
      ? hostPs.leader
      : hostPs.characterArea[pendingAttackSrc.index];
    if (attackerFC?.rushCharOnly) return; // Rush: Character only — cannot target leader
    D({ type: 'DECLARE_ATTACK', attackerZone: pendingAttackSrc.zone, attackerIndex: pendingAttackSrc.index, targetOwner: opponentOwner, targetZone: 'leader', targetIndex: -1 });
    setPendingAttackSrc(null);
  }

  function handleAiCharacterClick(i) {
    if (!isMyInput) return;

    if (pendingAttackSrc && isMyTurn) {
      const tgtState = guestPs.characterArea[i]?.state;
      if (tgtState === 'rest' || (tgtState === 'active' && attackerCanHitActive)) {
        D({ type: 'DECLARE_ATTACK', attackerZone: pendingAttackSrc.zone, attackerIndex: pendingAttackSrc.index, targetOwner: opponentOwner, targetZone: 'character', targetIndex: i });
        setPendingAttackSrc(null);
      }
      return;
    }
  }

  function handleDonAreaClick() {
    if (!isMyTurn || !isMyInput || S.phase !== PHASE.MAIN || inBattle) return;
    const activeDons = hostPs.costArea.filter(d => d.state === 'active');
    if (activeDons.length === 0) return;
    const nextCount = pendingDonIds.size >= activeDons.length ? 0 : pendingDonIds.size + 1;
    setPendingDonIds(new Set(activeDons.slice(0, nextCount).map(d => d._donId)));
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
  const humanWon = S.winner === myOwner;

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden z-50 select-none">
    <div className="absolute inset-0 flex flex-col overflow-y-auto"
      onClick={() => { if (donMode) setPendingDonIds(new Set()); }}
    >
      <WaitingBanner visible={pvpMode && !!S && S.waitingFor !== myRole} />
      {fieldFlashFcId && (
        <div className="absolute inset-0 bg-black/60 pointer-events-none" style={{ zIndex: 10 }} />
      )}
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
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${S.activePlayer === myOwner ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
              {S.activePlayer === myOwner ? 'Your Turn' : "Opp's Turn"}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${PHASE_COLORS[S.phase]} text-white`}>
              {PHASE_LABELS[S.phase]}
            </span>
            {(attackMode || donMode) && (
              <span className="text-[10px] text-slate-400 font-mono">
                {attackMode ? '⚔ Select target' : `🟢 ${pendingDonIds.size} DON!!`}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          {!pvpMode && (
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
          )}
          {!gameOver && (
            <button
              onClick={() => { if (window.confirm('Concede this game?')) D({ type: 'CONCEDE', player: myOwner }); }}
              title="Concede — opponent wins"
              className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-600 hover:text-red-400 hover:border-red-800 transition-colors"
            >
              Concede
            </button>
          )}
          <button
            onClick={handleBugReport}
            title="Download hidden game log for bug reporting"
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-600 hover:text-red-400 hover:border-red-800 transition-colors"
          >
            Bug
          </button>
          <span className="text-[10px] text-slate-600">Turn {S.turn}</span>
        </div>
      </div>

      {/* Opponent's field (top) */}
      <div className="flex-shrink-0">
        <div className="flex items-center justify-end px-3 py-0.5 bg-slate-900/40">
          <span className="text-[11px] font-bold text-slate-300">
            Opp hand: <span className="text-white">{guestPs.hand.length}</span>
          </span>
        </div>
        <PlayerField
          playerState={opponentPs}
          isOpponent
          battle={S.battle}
          activePlayer={S.activePlayer}
          owner={opponentOwner}
          state={S}
          targetableChars={attackMode ? attackableAiChars : null}
          onLeaderClick={handleAiLeaderClick}
          onCharacterClick={handleAiCharacterClick}
          onTrashClick={() => setTrashView('guest')}
          effectHighlight={effectHighlight}
          revealed={gameOver || S.devRevealOpponent}
          isCompact={isCompact}
          disableStats={attackMode || donMode || (inBattle && !inBlock && !inCounter)}
          fieldFlashFcId={fieldFlashFcId}
          donFlashItem={donFlashItem?.donOwner === opponentOwner ? donFlashItem : null}
        />
      </div>

      {/* Phase bar + battle info + card status */}
      <PhaseBar
        state={S}
        onEndTurn={() => D({ type: 'END_TURN' })}
        onSkipBlock={() => D({ type: 'SKIP_BLOCK' })}
        onSkipCounter={() => D({ type: 'SKIP_COUNTER' })}
        onUnblock={() => D({ type: 'UNBLOCK' })}
        myRole={myOwner}
        selectedCard={selectedHandCard || fieldCardForMenu}
        cardActions={selectedHandCard ? handActions : fieldCardForMenu ? fieldActions : []}
        onAction={a => a.action()}
        onClearCard={() => { setSelectedHandIndex(null); setSelectedFieldCard(null); }}
        lastAiAction={S?.activePlayer !== myOwner
          ? (S?.log ?? []).filter(e => e.type === 'action' || e.type === 'battle').at(-1) ?? null
          : null}
      />
<AttackArrow battle={S.battle} />
<RedirectArrow battle={S.battle} />

      {/* My field (bottom) */}
      <div className="flex-shrink-0">
        <PlayerField
          playerState={myPs}
          isOpponent={false}
          battle={S.battle}
          activePlayer={S.activePlayer}
          owner={myOwner}
          state={S}
          selectedZone={pendingAttackSrc?.zone ?? selectedFieldCard?.zone}
          selectedIndex={pendingAttackSrc?.index ?? selectedFieldCard?.index}
          onLeaderClick={donReturnMode ? handleLeaderDonReturn : (donMode ? handleLeaderDonTarget : handleMyLeaderClick)}
          onCharacterClick={donReturnMode ? handleCharDonReturn : handleMyCharacterClick}
          onStageClick={() => {
            if (!isMyTurn || !isMyInput || S.phase !== PHASE.MAIN || inBattle) return;
            setSelectedFieldCard({ zone: 'stage', index: 0 });
          }}
          onDonAreaClick={handleDonAreaClick}
          onTrashClick={() => setTrashView('host')}
          donPendingIds={pendingDonIds}
          donReturnMode={donReturnMode}
          donReturnOptions={donReturnOptions}
          selectedDonReturnIndices={selectedDonReturnIndices}
          onCostDonReturnClick={handleCostDonReturnClick}
          effectHighlight={effectHighlight}
          revealed={gameOver}
          isCompact={isCompact}
          disableStats={attackMode || donMode || (inBattle && !inBlock && !inCounter)}
          fieldFlashFcId={fieldFlashFcId}
          donFlashItem={donFlashItem?.donOwner === myOwner ? donFlashItem : null}
        />
      </div>

      {/* Hand */}
      <div className="flex-none border-t border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between px-3 pt-1">
          <span className="text-[11px] font-bold text-slate-300">
            Your hand: <span className="text-white">{myPs.hand.length}</span>
          </span>
          <div className="flex gap-1">
            <button
              className="w-6 h-6 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs leading-none"
              onClick={() => handScrollRef.current?.scrollBy({ left: -140, behavior: 'smooth' })}
            >‹</button>
            <button
              className="w-6 h-6 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs leading-none"
              onClick={() => handScrollRef.current?.scrollBy({ left: 140, behavior: 'smooth' })}
            >›</button>
          </div>
        </div>
        <HandArea
          hand={myPs.hand}
          costDeltas={handCostDeltas}
          effectiveCounters={myPs.hand.map(c => getEffectiveCounter(c, S, myOwner))}
          selectedIndex={selectedHandIndex}
          isCompact={isCompact}
          scrollRef={handScrollRef}
          disableStats={attackMode || donMode || (inBattle && !inBlock && !inCounter)}
          onCardClick={(i) => {
            setPendingAttackSrc(null);
            setPendingDonIds(new Set());
            setSelectedFieldCard(null);
            setSelectedHandIndex(prev => prev === i ? null : i);
          }}
          highlightIndices={
            inCounter && S.battle?.targetOwner === myOwner
              ? myPs.hand.map((c, i) =>
                  (getEffectiveCounter(c, S, myOwner) > 0 || (c.category === 'Event' && (c.effect?.includes('【反擊】') || c.effect?.includes('[Counter]')))) ? i : -1
                ).filter(i => i >= 0)
              : []
          }
          onReorder={(from, to) => D({ type: 'REORDER_HAND', owner: myOwner, fromIndex: from, toIndex: to })}
        />
      </div>

      <DonReturnBar
        pendingEffect={donReturnMode ? S.pendingEffect : null}
        selectedCount={selectedDonReturnIndices.length}
      />

      <TriggerBar
        trigger={S.pendingTrigger?.owner === myOwner ? S.pendingTrigger : null}
        onResolve={(activate) => D({ type: 'RESOLVE_TRIGGER', activate })}
      />

      <GameLog log={S.log} isOpen={logOpen} onToggle={() => setLogOpen(v => !v)} />

      {/* Overlays */}
      <EffectModal
        pendingEffect={donReturnMode || (S.pendingEffect?.choices?.promptPlayer ?? S.pendingEffect?.owner) !== myOwner ? null : S.pendingEffect}
        pendingReplace={S.pendingReplace?.owner !== myOwner ? null : S.pendingReplace}
        state={S}
        onResolve={(selectedIndices, meta) => { setEffectHoveredKey(null); D({ type: 'RESOLVE_EFFECT_CHOICE', selectedIndices, ...meta }); }}
        onReplace={(replaceIndex) => D({ type: 'RESOLVE_REPLACE', replaceIndex })}
        onHoverTarget={setEffectHoveredKey}
      />

      {/* State Simulator toggle button (dev/debug — hidden in PvP mode) */}
      {!pvpMode && (
        <>
          <button
            onClick={() => setSimOpen(v => !v)}
            title="State Simulator (Redux DevTools)"
            className="fixed bottom-3 right-3 z-40 w-8 h-8 rounded-full bg-purple-700/80 hover:bg-purple-600 text-white text-xs font-black shadow-lg flex items-center justify-center transition-colors"
          >
            ⚙
          </button>
          {simOpen && S && (
            <NewWindowPortal title="State Simulator" onClose={() => setSimOpen(false)}>
              <StateSimulator
                gameState={S}
                allCards={cards}
                dispatch={D}
                onClose={() => setSimOpen(false)}
                passiveAi={passiveAi}
                onTogglePassiveAi={() => setPassiveAi(v => !v)}
                standalone
              />
            </NewWindowPortal>
          )}
        </>
      )}

      {trashView && (
        <TrashModal
          trash={trashView === 'host' ? hostPs.trash : guestPs.trash}
          label={trashView === 'host' ? 'Your' : "Opponent's"}
          onClose={() => setTrashView(null)}
        />
      )}

      <CardFlashOverlay flashItem={flashItem} />
      <EventPlayOverlay eventOverlay={S?.eventOverlay} />
    </div>
    </div>
  );
}
