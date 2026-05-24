import React from 'react';
import { usePvpGame } from '../practice/hooks/usePvpGame';
import { applyGuestMulligan } from './pvpHelpers';
import { gameReducer } from '../practice/engine/gameState';
import PracticeView from '../practice/PracticeView';

// Extended root reducer that handles PvP-specific actions
function pvpRootReducer(state, action) {
  if (action.type === 'START_GAME')          return action.initialState;
  if (action.type === 'LOAD_STATE')          return action.state;
  if (action.type === '_PVP_GUEST_MULLIGAN') return applyGuestMulligan(state, action.decision);
  return gameReducer(state, action);
}

/**
 * Thin wrapper that:
 *  1. Creates the usePvpGame hook with the extended reducer
 *  2. Passes [gameState, dispatch] into PracticeView via pvpGameHook
 *
 * Props:
 *   db             - Firestore instance
 *   gameId         - 6-char room code
 *   myRole         - 'human' (host) | 'ai' (guest)
 *   cards          - full card database
 *   deckList       - user's deck (used only to satisfy PracticeView's prop requirement)
 *   selectedLeader - user's leader card
 *   onClose        - callback to exit PvP and return to deck view
 */
export default function PvpGameContainer({ db, gameId, myRole, cards, deckList, selectedLeader, onClose }) {
  const pvpGameHook = usePvpGame(gameId, myRole, db, pvpRootReducer);

  return (
    <PracticeView
      deckList={deckList}
      selectedLeader={selectedLeader}
      cards={cards}
      onClose={onClose}
      pvpMode={true}
      pvpGameHook={pvpGameHook}
      myRole={myRole}
    />
  );
}
