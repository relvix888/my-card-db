import { useState, useRef, useEffect } from 'react';

export function useFlashQueue(cardFlashQueue, dispatch) {
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
    flashTimerRef.current = setTimeout(advanceFlash, 1350);
  }

  useEffect(() => {
    if (!cardFlashQueue?.length) return;
    localFlashQueue.current.push(...cardFlashQueue);
    dispatch({ type: 'CONSUME_FLASH_QUEUE' });
    if (!activeFlashRef.current) {
      advanceFlash();
    }
  }, [cardFlashQueue?.length]); // eslint-disable-line

  return { flashItem };
}
