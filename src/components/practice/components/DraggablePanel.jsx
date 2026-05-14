import React, { useState, useRef, useEffect, useCallback } from 'react';

export default function DraggablePanel({ children }) {
  const [pos, setPos] = useState(null); // null = bottom-anchored; { x, y } = free float
  const dragging = useRef(null);
  const panelRef = useRef(null);

  const handleMove = useCallback((e) => {
    if (!dragging.current) return;
    if (e.cancelable) e.preventDefault();
    const { clientX: cx, clientY: cy } = e.touches ? e.touches[0] : e;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - 320, dragging.current.ox + cx - dragging.current.sx)),
      y: Math.max(0, Math.min(window.innerHeight - 80,  dragging.current.oy + cy - dragging.current.sy)),
    });
  }, []);

  const handleUp = useCallback(() => { dragging.current = null; }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [handleMove, handleUp]);

  function startDrag(e) {
    if (e.cancelable) e.preventDefault();
    const { clientX: cx, clientY: cy } = e.touches ? e.touches[0] : e;
    const rect = panelRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    dragging.current = { sx: cx, sy: cy, ox: rect.left, oy: rect.top };
  }

  const dragHandle = (
    <div
      onMouseDown={startDrag}
      onTouchStart={startDrag}
      className="flex justify-center items-center py-1.5 cursor-grab active:cursor-grabbing bg-slate-950 border-b border-slate-800 select-none"
      title="Drag to move"
    >
      <div className="w-8 h-1 bg-slate-600 rounded-full" />
    </div>
  );

  if (pos) {
    return (
      <div className="fixed z-50 w-80" style={{ left: pos.x, top: pos.y }}>
        <div ref={panelRef} className="pointer-events-auto w-full rounded-2xl overflow-hidden shadow-2xl">
          {dragHandle}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div ref={panelRef} className="pointer-events-auto w-full max-w-sm rounded-t-2xl overflow-hidden shadow-2xl">
        {dragHandle}
        {children}
      </div>
    </div>
  );
}
