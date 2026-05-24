import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';

const TYPE_STYLES = {
  info:   'text-slate-400',
  action: 'text-blue-400',
  battle: 'text-orange-400',
  damage: 'text-red-400',
  phase:  'text-emerald-400 font-black',
};

// Matches card IDs like OP11-041, ST01-001, EB01-001, P-001
const CARD_ID_RE = /\b([A-Z]{1,3}\d*-\d{3,4})\b/g;

function LogEntry({ text, typeClass, onHoverCard }) {
  const parts = [];
  let last = 0;
  let match;
  CARD_ID_RE.lastIndex = 0;

  while ((match = CARD_ID_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const id = match[1];
    parts.push(
      <span
        key={match.index}
        className="underline decoration-dotted cursor-pointer"
        onMouseEnter={() => onHoverCard(id)}
        onMouseLeave={() => onHoverCard(null)}
      >
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <div className={`leading-relaxed mb-0.5 ${typeClass}`}>
      {parts}
    </div>
  );
}

export default function GameLog({ log = [], isOpen, onToggle }) {
  const bottomRef = useRef(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length, isOpen]);

  const handleCopy = useCallback(() => {
    const text = log.map(e => e.text).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [log]);

  return (
    <div className="flex-shrink-0 border-t border-slate-800 bg-slate-950">
      {/* Toggle bar */}
      <div className="w-full flex items-center justify-between px-3 py-1 text-[10px] text-slate-500">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 hover:text-slate-300 transition-colors"
        >
          <span className="font-bold tracking-widest uppercase">Game Log</span>
          <span>{isOpen ? '▼' : '▲'}</span>
        </button>
        <button
          onClick={handleCopy}
          className="hover:text-slate-300 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Log entries */}
      {isOpen && (
        <div className="h-24 overflow-y-auto px-3 pb-2 text-[10px] font-mono">
          {log.map(entry => (
            <LogEntry
              key={entry.id}
              text={entry.text}
              typeClass={TYPE_STYLES[entry.type] || 'text-slate-400'}
              onHoverCard={setHoveredId}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Card preview overlay */}
      {hoveredId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <img
            src={getSafeImageUrl({ id: hoveredId })}
            alt={hoveredId}
            className="w-48 rounded-xl shadow-2xl border-2 border-slate-600"
            onError={e => { e.target.src = cardBackImg; }}
          />
        </div>
      )}
    </div>
  );
}
