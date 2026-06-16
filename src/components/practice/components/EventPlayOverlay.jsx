import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';

function actionColor(actionType, delta) {
  if (actionType === 'KO' || actionType === 'CONDITIONAL_KO') return '#ef4444';
  if (actionType === 'REST')     return '#f97316';
  if (actionType === 'COST_MOD') return '#3b82f6';
  if (actionType === 'POWER_MOD' || actionType === 'POWER_SET')
    return (delta ?? 0) >= 0 ? '#22c55e' : '#f43f5e';
  return '#a78bfa';
}

const MARKER_IDS = ['red', 'orange', 'green', 'pink', 'blue', 'purple'];
const MARKER_COLORS = { red: '#ef4444', orange: '#f97316', green: '#22c55e', pink: '#f43f5e', blue: '#3b82f6', purple: '#a78bfa' };

function closestMarker(color) {
  const entries = Object.entries(MARKER_COLORS);
  return entries.reduce((best, [id, c]) => {
    const dist = Math.abs(parseInt(color.slice(1), 16) - parseInt(c.slice(1), 16));
    return dist < best.dist ? { id, dist } : best;
  }, { id: 'red', dist: Infinity }).id;
}

export default function EventPlayOverlay({ eventOverlay }) {
  const [coords, setCoords] = useState([]);
  const [fading, setFading] = useState(false);
  const prevId = useRef(null);

  useEffect(() => {
    if (!eventOverlay?.card) {
      setCoords([]);
      setFading(false);
      prevId.current = null;
      return;
    }

    setFading(false);
    prevId.current = eventOverlay.card.id;

    function measure() {
      let x1 = window.innerWidth / 2;
      let y1 = window.innerHeight / 2;
      if (eventOverlay.sourceSelector) {
        const srcEl = document.querySelector(eventOverlay.sourceSelector);
        if (srcEl) {
          const sr = srcEl.getBoundingClientRect();
          x1 = sr.left + sr.width / 2;
          y1 = sr.top + sr.height / 2;
        }
      }
      const next = [];
      for (const t of (eventOverlay.targets ?? [])) {
        const sel = t.zone === 'leader'
          ? `[data-field-card="${t.owner}-leader"]`
          : t.fcId
            ? `[data-field-card-fcid="${t.fcId}"]`
            : `[data-field-card="${t.owner}-character-${t.index}"]`;
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        next.push({
          x1, y1,
          x2: r.left + r.width / 2,
          y2: r.top + r.height / 2,
          color: actionColor(t.actionType, t.delta),
          label: t.label ?? '',
        });
      }
      setCoords(next);
    }

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [eventOverlay]);

  // Fade out just before the overlay is cleared (driven by PracticeView's 1500ms timer)
  useEffect(() => {
    if (!eventOverlay?.card) return;
    const t = setTimeout(() => setFading(true), 1500);
    return () => clearTimeout(t);
  }, [eventOverlay]);

  if (!eventOverlay?.card) return null;

  const imgSrc = getSafeImageUrl(eventOverlay.card);

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center pointer-events-none"
      style={{ zIndex: 150, opacity: fading ? 0 : 1, transition: 'opacity 300ms ease-out' }}
    >
      <div className="absolute inset-0 bg-black/50" />

      {/* Targeting lines */}
      {coords.length > 0 && (
        <svg className="absolute inset-0" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          <defs>
            {MARKER_IDS.map(id => (
              <marker
                key={id}
                id={`evt-tip-${id}`}
                markerWidth="8" markerHeight="6"
                refX="7" refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill={MARKER_COLORS[id]} opacity="0.95" />
              </marker>
            ))}
          </defs>
          {coords.map((c, i) => {
            const markerId = closestMarker(c.color);
            const mx = (c.x1 + c.x2) / 2;
            const my = (c.y1 + c.y2) / 2 - 30;
            return (
              <g key={i}>
                <path
                  d={`M ${c.x1} ${c.y1} Q ${mx} ${my} ${c.x2} ${c.y2}`}
                  stroke={c.color}
                  strokeWidth="2.5"
                  fill="none"
                  opacity="0.9"
                  strokeDasharray="8 4"
                  markerEnd={`url(#evt-tip-${markerId})`}
                />
                {c.label && (
                  <text
                    x={mx}
                    y={my - 8}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={c.color}
                    fontSize="12"
                    fontWeight="bold"
                    style={{ filter: 'drop-shadow(0 0 3px rgba(0,0,0,0.9))' }}
                  >
                    {c.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {/* Event card image */}
      <div className="relative flex flex-col items-center">
        <img
          src={imgSrc}
          alt={eventOverlay.card.name}
          className="rounded-xl shadow-2xl border-2 border-purple-400/60"
          style={{ height: Math.round(window.innerHeight * 0.28), width: 'auto', objectFit: 'contain' }}
          onError={e => { e.target.src = cardBackImg; }}
        />
        <div className="mt-2 bg-purple-600/90 text-white font-black rounded-full px-3 py-0.5 text-sm shadow-lg border border-white/30 flex items-center gap-1.5">
          <span>✨</span>
          <span>Event</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
