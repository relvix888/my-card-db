import { useReducer, useEffect, useRef, useState, useCallback } from 'react';
import { onSnapshot, updateDoc, setDoc, increment } from 'firebase/firestore';
import { PLAYER } from '../engine/constants';
import { getRoomRef, sanitizeForFirestore } from '../../pvp/pvpHelpers';

/**
 * Firebase-synced game state hook for online PvP.
 *
 * Host (myRole === 'host'):
 *   - Owns the reducer; runs every action locally
 *   - Writes full game state to Firestore after every state change
 *   - Reads pendingAction from Firestore and applies guest actions
 *
 * Guest (myRole === 'guest'):
 *   - Also owns a local reducer for instant optimistic UI updates
 *   - Writes desired actions to pendingAction field; host applies them authoritatively
 *   - Reconciles local state with Firestore on every snapshot (corrects any divergence)
 *
 * Returns [gameState, dispatch] — same interface as useReducer.
 *
 * @param {string} gameId - the 6-char room code
 * @param {'host'|'guest'} myRole
 * @param {import('firebase/firestore').Firestore} db
 * @param {Function} reducer - root reducer (must handle START_GAME, _PVP_GUEST_MULLIGAN)
 */
export function usePvpGame(gameId, myRole, db, reducer) {
  const isHost = myRole === PLAYER.HOST;
  const roomRef = getRoomRef(db, gameId);

  // Both host and guest run a local reducer for instant UI updates.
  // Guest initializes via LOAD_STATE from the first Firestore snapshot.
  const [localState, rawDispatch] = useReducer(reducer, null);

  // Guest mulligan decision received from Firestore (triggers effect below)
  const [guestMulliganDecision, setGuestMulliganDecision] = useState(null);
  // Prevent applying the same pendingAction twice (monotonic seq)
  const lastAppliedSeq = useRef(0);
  // One-shot guard so we don't apply guest mulligan twice
  const guestMulliganApplied = useRef(false);
  // One-shot: host loads initial game state from Firestore exactly once
  const initialStateLoaded = useRef(false);
  // Skip write-back for the LOAD_STATE dispatch (state came from Firestore, no need to write it back)
  const skipNextWriteBack = useRef(false);
  // Host: when true, include pendingAction:null in the next gameState write (atomic clear)
  const pendingActionToClear = useRef(false);
  // Guest: true while we have a pendingAction in Firestore that the host hasn't processed yet
  const hasPendingAction = useRef(false);

  // ── Host: write state to Firestore after every local state change ──────────
  useEffect(() => {
    if (!isHost || !localState) return;
    if (skipNextWriteBack.current) { skipNextWriteBack.current = false; return; }

    // Atomically clear pendingAction alongside the new gameState so the guest never
    // sees { pendingAction: null, gameState: OLD } — both fields land in one write.
    const extraFields = pendingActionToClear.current ? { pendingAction: null } : {};
    pendingActionToClear.current = false;
    setDoc(roomRef, { gameState: sanitizeForFirestore(localState), ...extraFields }, { merge: true });
  }, [localState]); // eslint-disable-line

  // ── Host: apply guest mulligan once BOTH sides are done ───────────────────
  useEffect(() => {
    if (!isHost) return;
    if (guestMulliganApplied.current) return;
    if (!guestMulliganDecision) return;
    if (localState?.mulligan !== 'done') return; // wait for host to finish mulliganing

    guestMulliganApplied.current = true;
    rawDispatch({ type: '_PVP_GUEST_MULLIGAN', decision: guestMulliganDecision });
    updateDoc(roomRef, { status: 'playing' });
  }, [localState?.mulligan, guestMulliganDecision, isHost]); // eslint-disable-line

  // ── Host: watch Firestore for guest actions + mulligan decision ───────────
  useEffect(() => {
    if (!isHost) return;
    return onSnapshot(roomRef, (snap) => {
      const data = snap.data();
      if (!data) return;

      // Load initial game state from Firestore the first time the host enters the game
      if (!initialStateLoaded.current && data.gameState) {
        initialStateLoaded.current = true;
        skipNextWriteBack.current = true; // state came from Firestore — no need to echo it back
        rawDispatch({ type: 'LOAD_STATE', state: data.gameState });
      }

      // Apply guest's pending action (seq guard prevents double-apply).
      // Don't clear pendingAction in a separate updateDoc — instead flag it so the
      // next gameState write includes pendingAction:null atomically (fix #2).
      const seq = data.pendingActionSeq ?? 0;
      if (data.pendingAction && seq > lastAppliedSeq.current) {
        lastAppliedSeq.current = seq;
        rawDispatch(data.pendingAction);
        pendingActionToClear.current = true;
      }

      // Capture guest mulligan decision (effect above applies it when host is ready)
      const gm = data.guestMulligan;
      if (gm && gm !== 'pending' && gm !== 'applied' && !guestMulliganApplied.current) {
        setGuestMulliganDecision(gm);
        updateDoc(roomRef, { guestMulligan: 'applied' });
      }
    });
  }, [isHost]); // eslint-disable-line

  // ── Guest: reconcile local reducer with authoritative Firestore state ──────
  // Replaces the old read-only mirroredState pattern. Guest now runs a local
  // reducer for instant optimistic updates, then corrects via LOAD_STATE when
  // the host's authoritative snapshot arrives.
  useEffect(() => {
    if (isHost) return;
    return onSnapshot(roomRef, (snap) => {
      const data = snap.data();
      const gs = data?.gameState;
      if (!gs) return;

      // Fix #2: while our pendingAction is still in Firestore, the host hasn't echoed
      // our action back yet. Applying this snapshot would roll back our optimistic state.
      // Only skip when WE have a pending action — unrelated host writes should still pass through.
      if (data.pendingAction != null && hasPendingAction.current) return;

      // Host has processed (and cleared) our action — safe to reconcile.
      hasPendingAction.current = false;
      rawDispatch({ type: 'LOAD_STATE', state: gs });
    });
  }, []); // eslint-disable-line

  const dispatch = useCallback((action) => {
    // Intercept guest mulligan — write directly to room doc, not the reducer
    if (!isHost && (action.type === 'MULLIGAN_KEEP' || action.type === 'MULLIGAN_REDRAW')) {
      updateDoc(roomRef, {
        guestMulligan: action.type === 'MULLIGAN_KEEP' ? 'keep' : 'redraw',
      });
      return;
    }

    if (isHost) {
      rawDispatch(action);
      return;
    }

    // Guest: authorize before writing action to Firestore
    const gs = localState;
    if (!gs) return;

    // UI-only: apply locally and never write to Firestore.
    // Writing CONSUME_FLASH_QUEUE to Firestore causes a feedback loop:
    // host applies it → writes full state back → guest snapshot fires → effects re-run → repeat.
    if (action.type === 'CONSUME_FLASH_QUEUE') {
      rawDispatch(action);
      return;
    }

    // Pre-game ability belongs to a specific player — allow regardless of turn order
    const isMyPreGame = action.type === 'LEADER_PRE_GAME_STAGE' && gs.preGameAbilityOwner === myRole;
    // Concede is always allowed regardless of whose turn it is
    const isConcede = action.type === 'CONCEDE' && action.player === myRole;

    const myTurn    = gs.waitingFor === myRole;
    const myEffect  = gs.pendingEffect?.owner === myRole;
    const myTrigger = gs.pendingTrigger?.owner === myRole;
    if (!myTurn && !myEffect && !myTrigger && !isMyPreGame && !isConcede) return;

    // Optimistic local update — guest sees the result instantly before Firestore round-trips
    rawDispatch(action);

    // Mark that we have a pending action in flight so the guest's onSnapshot won't
    // overwrite our optimistic state until the host echoes the result back (fix #2).
    hasPendingAction.current = true;

    // Async: send to Firestore so host can apply it authoritatively and sync back
    updateDoc(roomRef, {
      pendingAction: sanitizeForFirestore(action),
      pendingActionSeq: increment(1),
    });
  }, [isHost, localState, myRole]); // eslint-disable-line

  return [localState, dispatch];
}
