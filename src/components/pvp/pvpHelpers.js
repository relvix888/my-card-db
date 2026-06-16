import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { shuffle } from '../practice/engine/gameState';
import { STARTING_HAND } from '../practice/engine/constants';

const APP_ID = 'one-piece-card-db';

export function getRoomRef(db, gameCode) {
  return doc(db, 'artifacts', APP_ID, 'public', 'data', 'pvpRooms', gameCode);
}

export function generateGameCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function createRoomDoc(db, gameCode, hostUid) {
  await setDoc(getRoomRef(db, gameCode), {
    gameCode,
    status: 'waiting',
    createdAt: serverTimestamp(),
    hostUid,
    guestUid: null,
    hostDeck: null,
    guestDeck: null,
    hostMulligan: null,
    guestMulligan: null,
    gameState: null,
    pendingAction: null,
    pendingActionSeq: 0,
    winner: null,
  });
}

export async function joinRoomDoc(db, gameCode, guestUid) {
  await updateDoc(getRoomRef(db, gameCode), {
    guestUid,
    status: 'deckSubmit',
  });
}

export async function submitDeck(db, gameCode, role, deckPayload) {
  const field = role === 'host' ? 'hostDeck' : 'guestDeck';
  await updateDoc(getRoomRef(db, gameCode), { [field]: deckPayload });
}

// Recursively replace undefined with null so Firestore accepts the object
export function sanitizeForFirestore(obj) {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  const out = {};
  for (const key of Object.keys(obj)) {
    out[key] = sanitizeForFirestore(obj[key]);
  }
  return out;
}

// Apply guest's mulligan decision to the shared game state (called by host)
export function applyGuestMulligan(state, decision) {
  if (decision === 'keep') {
    return { ...state, mulligan: 'done' };
  }
  // redraw
  const ps = state.guest;
  const combined = shuffle([...ps.deck, ...ps.hand]);
  return {
    ...state,
    mulligan: 'done',
    guest: {
      ...ps,
      hand: combined.slice(0, STARTING_HAND),
      deck: combined.slice(STARTING_HAND),
    },
  };
}
