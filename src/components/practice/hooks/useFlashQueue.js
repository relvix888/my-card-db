import { useState, useRef, useEffect } from 'react';

export function useFlashQueue(cardFlashQueue, dispatch, myRole = null) {
  const localFlashQueue = useRef([]);
  const activeFlashRef  = useRef(null);
  const flashTimerRef   = useRef(null);
  const [flashItem, setFlashItem] = useState(null);

  function advanceFlash() {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (localFlashQueue.current.length === 0) {
      activeFlashRef.current = null;
      setFlashItem(null);
      return;
    }
    const item = localFlashQueue.current.shift();
    activeFlashRef.current = item;
    setFlashItem(item);
    flashTimerRef.current = setTimeout(advanceFlash, 1200);
  }

  useEffect(() => {
    if (!cardFlashQueue?.length) return;
    // Filter out flashes tagged for a specific player that isn't the current viewer.
    const visible = myRole
      ? cardFlashQueue.filter(f => !f.forPlayer || f.forPlayer === myRole)
      : cardFlashQueue;
    localFlashQueue.current.push(...visible);
    dispatch({ type: 'CONSUME_FLASH_QUEUE' });
    if (!activeFlashRef.current && visible.length > 0) {
      advanceFlash();
    }
  }, [cardFlashQueue?.length]); // eslint-disable-line

  return { flashItem };
}
