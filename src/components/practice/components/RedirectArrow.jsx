import React, { useEffect, useState } from 'react';

export default function RedirectArrow({ battle }) {
  const [coords, setCoords] = useState(null);

  useEffect(() => {
    const rf = battle?.redirectedFrom;
    if (!rf) { setCoords(null); return; }

    function measure() {
      const fromSel = rf.zone === 'leader'
        ? `[data-field-card="${rf.owner}-leader"]`
        : `[data-field-card="${rf.owner}-character-${rf.index}"]`;
      const toSel = battle.targetZone === 'leader'
        ? `[data-field-card="${battle.targetOwner}-leader"]`
        : `[data-field-card="${battle.targetOwner}-character-${battle.targetIndex}"]`;

      const fromEl = document.querySelector(fromSel);
      const toEl   = document.querySelector(toSel);
      if (!fromEl || !toEl) { setCoords(null); return; }

      const fr = fromEl.getBoundingClientRect();
      const tr = toEl.getBoundingClientRect();
      setCoords({
        x1: fr.left + fr.width / 2,
        y1: fr.top  + fr.height / 2,
        x2: tr.left + tr.width / 2,
        y2: tr.top  + tr.height / 2,
      });
    }

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [battle]);

  if (!coords) return null;

  const { x1, y1, x2, y2 } = coords;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const curvePath = `M ${x1} ${y1} Q ${mx - 30} ${my} ${x2} ${y2}`;

  return (
    <svg
      className="fixed inset-0 pointer-events-none"
      style={{ width: '100vw', height: '100vh', zIndex: 46 }}
    >
      <defs>
        <marker id="redir-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#eab308" opacity="0.95" />
        </marker>
      </defs>
      <path
        d={curvePath}
        stroke="#eab308"
        strokeWidth="2.5"
        fill="none"
        opacity="0.9"
        strokeDasharray="6 3"
        markerEnd="url(#redir-arrow)"
      />
    </svg>
  );
}
