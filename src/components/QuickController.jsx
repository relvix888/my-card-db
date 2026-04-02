import React from "react";

const QuickController = ({
  card,
  count,
  onAdd,
  onRemove,
  hideCount = false,
}) => {
  return (
    <div className="flex items-center bg-slate-950/90 backdrop-blur-md border border-slate-700/50 rounded-lg shadow-xl overflow-hidden h-7 ring-1 ring-white/5">
      {/* Minus Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          // FIXED: Pass the full card object, not just card.id
          onRemove(card);
        }}
        className="w-7 h-full flex items-center justify-center hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors active:scale-90"
        title="減少"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            d="M20 12H4"
          />
        </svg>
      </button>

      {/* Conditional Count Display (Legacy support) */}
      {!hideCount && (
        <div className="w-7 flex items-center justify-center border-x border-slate-700/50 bg-slate-950">
          <span className="text-[11px] font-black font-mono text-blue-400">
            {count}
          </span>
        </div>
      )}

      {/* Plus Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          // Sending the full card object
          onAdd(card);
        }}
        className="w-7 h-full flex items-center justify-center hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 transition-colors active:scale-90"
        title="增加"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0M12 8v8M8 12h8"
            strokeWidth={0} // Using a simpler + if preferred, but keeping your path style:
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            d="M12 4v16m8-8H4"
          />
        </svg>
      </button>
    </div>
  );
};

export default QuickController;
