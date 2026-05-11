import React, { useEffect, useState } from 'react';

export default function AttackArrow({ battle }) {
  const [coords, setCoords] = useState(null);

  useEffect(() => {
    if (!battle?.targetZone) { setCoords(null); return; }

    function measure() {
      const atkEl = document.querySelector('[data-battle-role="attacker"]');
      const tgtEl = document.querySelector('[data-battle-role="target"]');
      if (!atkEl || !tgtEl) { setCoords(null); return; }

      const ar = atkEl.getBoundingClientRect();
      const tr = tgtEl.getBoundingClientRect();

      setCoords({
        x1: ar.left + ar.width / 2,
        y1: ar.top,
        x2: tr.left + tr.width / 2,
        y2: tr.top + tr.height,
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
  const curvePath = `M ${x1} ${y1} Q ${mx + 30} ${my} ${x2} ${y2}`;

  return (
    <svg
      className="fixed inset-0 pointer-events-none"
      style={{ width: '100vw', height: '100vh', zIndex: 45 }}
    >
      <defs>
        <marker id="atk-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#f97316" opacity="0.9" />
        </marker>
      </defs>
      <path
        d={curvePath}
        stroke="#f97316"
        strokeWidth="2.5"
        fill="none"
        opacity="0.85"
        strokeDasharray="8 4"
        markerEnd="url(#atk-arrow)"
      />
    </svg>
  );
}
