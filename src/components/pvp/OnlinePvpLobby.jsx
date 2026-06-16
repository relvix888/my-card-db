import React, { useState, useEffect } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import {
  generateGameCode,
  createRoomDoc,
  joinRoomDoc,
  submitDeck,
  getRoomRef,
} from './pvpHelpers';

function expandDeck(deckList, allCards) {
  const out = [];
  for (const [id, count] of Object.entries(deckList)) {
    const card = allCards.find(c => c.id === id);
    if (!card) continue;
    for (let i = 0; i < count; i++) out.push(card);
  }
  return out;
}

/**
 * Lobby UI: Create or Join a PvP room, submit deck, wait for opponent.
 *
 * Props:
 *   db             - Firestore instance
 *   user           - Firebase auth user
 *   cards          - full card database
 *   deckList       - current user's deck { cardId: count }
 *   selectedLeader - current user's leader card object
 *   onGameStart    - callback(gameId, myRole) when both players are ready
 *   onClose        - callback to return to deck view
 */
export default function OnlinePvpLobby({ db, user, cards, deckList, selectedLeader, onGameStart, onClose }) {
  const [tab, setTab]               = useState('create'); // 'create' | 'join'
  const [gameCode, setGameCode]     = useState('');
  const [joinCode, setJoinCode]     = useState('');
  const [myRole, setMyRole]         = useState(null);     // 'host' | 'guest'
  const [roomData, setRoomData]     = useState(null);
  const [deckSubmitted, setDeckSubmitted] = useState(false);
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [playerName, setPlayerName] = useState(selectedLeader?.name ?? '');

  // Subscribe to room updates once we have a code + role
  useEffect(() => {
    if (!gameCode || !myRole) return;
    const ref = getRoomRef(db, gameCode);
    return onSnapshot(ref, (snap) => {
      if (snap.exists()) setRoomData(snap.data());
    });
  }, [gameCode, myRole, db]);

  // Advance to game when both players have submitted decks and host initialized state
  useEffect(() => {
    if (!roomData || !myRole) return;
    if (roomData.status === 'playing' || roomData.status === 'mulliganPhase') {
      onGameStart(gameCode, myRole);
    }
  }, [roomData?.status]); // eslint-disable-line

  // ── Create room ───────────────────────────────────────────────────────────
  async function handleCreate() {
    setError('');
    setLoading(true);
    try {
      const code = generateGameCode();
      await createRoomDoc(db, code, user.uid);
      setGameCode(code);
      setMyRole('host');
    } catch (e) {
      console.error('PvP createRoom error:', e);
      setError(`Failed to create room: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Join room ─────────────────────────────────────────────────────────────
  async function handleJoin() {
    setError('');
    const code = joinCode.trim();
    if (!/^\d{4}$/.test(code)) { setError('Enter a 4-digit game code.'); return; }
    setLoading(true);
    try {
      const ref = doc(db, 'artifacts', 'one-piece-card-db', 'public', 'data', 'pvpRooms', code);
      const snap = await getDoc(ref);
      if (!snap.exists()) { setError('Room not found.'); setLoading(false); return; }
      const data = snap.data();

      // Rejoin: uid matches a player already assigned to this room
      if (user.uid === data.hostUid) {
        setGameCode(code);
        setMyRole('host');
        setLoading(false);
        return;
      }
      if (user.uid === data.guestUid) {
        setGameCode(code);
        setMyRole('guest');
        setLoading(false);
        return;
      }

      if (data.status !== 'waiting') { setError('Room is no longer open.'); setLoading(false); return; }
      if (data.guestUid) { setError('Room already has a second player.'); setLoading(false); return; }
      await joinRoomDoc(db, code, user.uid);
      setGameCode(code);
      setMyRole('guest');
    } catch (e) {
      setError('Failed to join room. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Submit deck ───────────────────────────────────────────────────────────
  async function handleSubmitDeck() {
    if (!selectedLeader) { setError('No leader selected. Build a deck first.'); return; }
    setError('');
    setLoading(true);
    try {
      const deckCards = expandDeck(deckList, cards).filter(c => c.category !== 'Leader');
      const resolvedName = playerName.trim() || selectedLeader?.name || 'Player';
      await submitDeck(db, gameCode, myRole, { leader: selectedLeader, cards: deckCards, playerName: resolvedName });
      setDeckSubmitted(true);

      // If host and both decks are ready, initialize game state
      if (myRole === 'host') {
        const ref = getRoomRef(db, gameCode);
        const snap = await getDoc(ref);
        const data = snap.data();
        if (data.guestDeck) {
          await initializeGame(db, gameCode, selectedLeader, deckCards, data.guestDeck, resolvedName);
        }
        // else: onSnapshot will handle it when guest submits
      }
    } catch (e) {
      setError('Failed to submit deck.');
    } finally {
      setLoading(false);
    }
  }

  // ── Watch for both decks submitted (host side) ────────────────────────────
  useEffect(() => {
    if (myRole !== 'host' || !deckSubmitted || !roomData) return;
    if (roomData.hostDeck && roomData.guestDeck && roomData.status === 'deckSubmit') {
      const deckCards = expandDeck(deckList, cards).filter(c => c.category !== 'Leader');
      const resolvedName = playerName.trim() || selectedLeader?.name || 'Player';
      initializeGame(db, gameCode, selectedLeader, deckCards, roomData.guestDeck, resolvedName);
    }
  }, [roomData?.guestDeck]); // eslint-disable-line

  // ── Render ────────────────────────────────────────────────────────────────
  // Waiting for opponent to join
  if (myRole && !roomData?.guestUid && myRole === 'host') {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center z-50 gap-6">
        <button onClick={onClose} className="absolute top-4 left-4 text-slate-400 hover:text-white text-sm font-bold">← Back</button>
        <p className="text-white text-lg font-bold">Share this code with your opponent:</p>
        <div className="text-4xl font-black tracking-widest text-violet-400 bg-slate-800 px-8 py-4 rounded-2xl border border-violet-500 select-all">
          {gameCode}
        </div>
        <p className="text-slate-400 text-sm animate-pulse">Waiting for opponent to join...</p>
      </div>
    );
  }

  // Both joined — deck submission phase
  if (myRole && (roomData?.guestUid || myRole === 'guest')) {
    const opponentReady = myRole === 'host' ? !!roomData?.guestDeck : !!roomData?.hostDeck;
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center z-50 gap-6">
        <button onClick={onClose} className="absolute top-4 left-4 text-slate-400 hover:text-white text-sm font-bold">← Back</button>
        <p className="text-white text-lg font-bold">Room: <span className="text-violet-400 tracking-widest">{gameCode}</span></p>

        {!deckSubmitted ? (
          <>
            <div className="flex flex-col items-center gap-1 w-72">
              <label className="text-slate-400 text-xs font-bold self-start">Your display name</label>
              <input
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                maxLength={20}
                placeholder={selectedLeader?.name ?? 'Enter your name'}
                className="w-full text-center text-sm font-bold bg-slate-800 border border-slate-600 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="bg-slate-800 rounded-xl p-4 text-center border border-slate-600 w-72">
              <p className="text-slate-300 text-sm mb-1 font-bold">Your deck</p>
              <p className="text-white font-black">{selectedLeader?.name ?? '—'}</p>
              <p className="text-slate-400 text-xs mt-1">{Object.values(deckList).reduce((a,b) => a+b, 0)} cards</p>
            </div>
            <button
              onClick={handleSubmitDeck}
              disabled={loading || !selectedLeader}
              className="px-8 py-3 bg-violet-700 hover:bg-violet-600 text-white font-black rounded-xl disabled:opacity-50 transition-all"
            >
              {loading ? 'Submitting...' : 'Ready — Submit Deck'}
            </button>
          </>
        ) : (
          <div className="text-center">
            <p className="text-emerald-400 font-bold mb-2">✓ Deck submitted</p>
            {opponentReady
              ? <p className="text-emerald-400 text-sm">✓ Opponent ready — starting game...</p>
              : <p className="text-slate-400 text-sm animate-pulse">Waiting for opponent to submit their deck...</p>
            }
          </div>
        )}
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>
    );
  }

  // Initial lobby — create or join
  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center z-50 gap-6">
      <button onClick={onClose} className="absolute top-4 left-4 text-slate-400 hover:text-white text-sm font-bold">← Back</button>
      <p className="text-white text-xl font-black">🌐 Online PvP</p>

      {/* Tabs */}
      <div className="flex rounded-xl overflow-hidden border border-slate-700">
        {['create', 'join'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-6 py-2 text-sm font-bold transition-all ${tab === t ? 'bg-violet-700 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            {t === 'create' ? 'Create Room' : 'Join Room'}
          </button>
        ))}
      </div>

      {tab === 'create' ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-slate-400 text-sm text-center max-w-xs">
            Create a room and share the code with your opponent.
          </p>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-8 py-3 bg-violet-700 hover:bg-violet-600 text-white font-black rounded-xl disabled:opacity-50 transition-all"
          >
            {loading ? 'Creating...' : 'Create Room'}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <p className="text-slate-400 text-sm">Enter the room code from your opponent:</p>
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.replace(/\D/g, ''))}
            maxLength={4}
            placeholder="0000"
            inputMode="numeric"
            className="text-center text-2xl font-black tracking-widest bg-slate-800 border border-slate-600 rounded-xl px-6 py-3 text-white w-48 focus:outline-none focus:border-violet-500"
          />
          <button
            onClick={handleJoin}
            disabled={loading}
            className="px-8 py-3 bg-violet-700 hover:bg-violet-600 text-white font-black rounded-xl disabled:opacity-50 transition-all"
          >
            {loading ? 'Joining...' : 'Join Room'}
          </button>
        </div>
      )}
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}

// ── Initialize game state (host only) ────────────────────────────────────────
async function initializeGame(db, gameCode, hostLeader, hostCards, guestDeckPayload, hostPlayerName) {
  // Lazy import to avoid bundling engine into non-battle routes
  const { createInitialState } = await import('../practice/engine/gameState');
  const { sanitizeForFirestore } = await import('./pvpHelpers');
  const { setDoc } = await import('firebase/firestore');

  const guestCards = guestDeckPayload.cards.filter(c => c.category !== 'Leader');
  const guestLeader = guestDeckPayload.leader;
  const playerNames = {
    host: hostPlayerName  || hostLeader?.name  || 'Host',
    guest:    guestDeckPayload.playerName || guestLeader?.name || 'Guest',
  };

  const initialState = { ...createInitialState(hostLeader, hostCards, guestLeader, guestCards), pvpMode: true, playerNames };

  const ref = getRoomRef(db, gameCode);
  await setDoc(ref, {
    gameState: sanitizeForFirestore(initialState),
    status: 'mulliganPhase',
    hostMulligan: 'pending',
    guestMulligan: 'pending',
  }, { merge: true });
}
