/**
 * useDevToolsReducer
 * Wraps useReducer and connects it to the Redux DevTools Extension.
 * Supports time-travel (jump to any prior action) by dispatching LOAD_STATE.
 * Falls back to plain useReducer when the extension is not installed.
 */
import { useReducer, useEffect, useRef } from 'react';

export function useDevToolsReducer(reducer, initialState, name = 'GameState') {
  // Track the most-recently dispatched action so we can send it to DevTools
  // alongside the resulting state in the post-render effect.
  const pendingAction = useRef({ type: '@@INIT' });
  const devTools      = useRef(null);

  // Wrap the reducer so we capture the action before React calls it.
  function wrappedReducer(state, action) {
    pendingAction.current = action;
    return reducer(state, action);
  }

  const [state, rawDispatch] = useReducer(wrappedReducer, initialState);

  // Connect to the extension on mount; clean up on unmount.
  useEffect(() => {
    const ext = window.__REDUX_DEVTOOLS_EXTENSION__;
    if (!ext) return;

    devTools.current = ext.connect({
      name,
      features: { jump: true, skip: false, reorder: false },
    });
    devTools.current.init(initialState);

    const unsubscribe = devTools.current.subscribe((msg) => {
      if (msg.type !== 'DISPATCH') return;

      // Time-travel: DevTools asks us to restore a previous state snapshot.
      if (
        msg.payload.type === 'JUMP_TO_ACTION' ||
        msg.payload.type === 'JUMP_TO_STATE'
      ) {
        try {
          rawDispatch({ type: 'LOAD_STATE', state: JSON.parse(msg.state) });
        } catch {
          // ignore malformed state
        }
      }

      // Commit: reset the DevTools baseline to the current state.
      if (msg.payload.type === 'COMMIT') {
        devTools.current?.init(state);
      }
    });

    return () => {
      unsubscribe?.();
      ext.disconnect?.();
      devTools.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After every state update send the action + state snapshot to DevTools.
  useEffect(() => {
    devTools.current?.send(pendingAction.current, state);
  }, [state]);

  return [state, rawDispatch];
}
