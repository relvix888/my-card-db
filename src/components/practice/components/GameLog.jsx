import React, { useEffect, useRef } from 'react';

const TYPE_STYLES = {
  info:   'text-slate-400',
  action: 'text-blue-400',
  battle: 'text-orange-400',
  damage: 'text-red-400',
  phase:  'text-emerald-400 font-black',
};

export default function GameLog({ log = [], isOpen, onToggle }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length]);

  return (
    <>
      {/* Toggle button — top-right, below the back-button header */}
      <button
        onClick={onToggle}
        className="fixed top-11 right-3 z-40 w-8 h-8 rounded-full bg-slate-800 border border-slate-600 text-slate-300 text-xs font-bold shadow-lg flex items-center justify-center"
      >
        📜
      </button>

      {/* Right-side slide-in panel */}
      {isOpen && (
        <div className="fixed top-0 right-0 bottom-0 z-40 w-64 bg-slate-950/97 border-l border-slate-700 overflow-y-auto px-3 py-2 text-[10px] font-mono flex flex-col">
          <div className="flex items-center justify-between mb-2 pb-1 border-b border-slate-700">
            <span className="text-slate-400 font-bold text-[11px]">Game Log</span>
            <button onClick={onToggle} className="text-slate-500 hover:text-white text-base leading-none">×</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {log.map(entry => (
              <div key={entry.id} className={`leading-relaxed mb-0.5 ${TYPE_STYLES[entry.type] || 'text-slate-400'}`}>
                {entry.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </>
  );
}
