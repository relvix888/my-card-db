import React from "react";

const ImportView = ({
  cards,
  topDecksData,
  getSafeImageUrl,
  generateMetaDeck,
  deckInput,
  setDeckInput,
  handleImportDeckCode,
  setAppMode,
}) => {
  return (
    <div className="max-w-7xl mx-auto w-full px-4 py-8 space-y-6 animate-in fade-in zoom-in-95 duration-300">
      <header className="mb-10 font-bold text-center text-xl sm:text-left">
        今日想砌咩Deck?
      </header>
      {/* OPTION A: AUTO-BUILD (Meta Decks) */}
      <div className="p-6 bg-slate-900/80 border border-slate-700 rounded-2xl shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-4 bg-purple-500 rounded-full" />
            A餐: 今期流行
          </h3>
          <span className="text-[10px] font-bold px-2 py-1 bg-purple-500/10 text-purple-400 rounded border border-purple-500/20">
            熱門領航
          </span>
        </div>

        {/* Scrollable Leader Map */}
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide px-2">
          {cards
            .filter(
              (c) =>
                (c.category === "Leader" || c.category === "領航") &&
                topDecksData[c.id.toUpperCase()],
            )
            .sort(
              (a, b) =>
                (topDecksData[b.id.toUpperCase()]?.count || 0) -
                (topDecksData[a.id.toUpperCase()]?.count || 0),
            )
            .map((leader) => (
              <div
                key={leader.id}
                onClick={() => generateMetaDeck(leader)}
                className="group relative flex-shrink-0 cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <div className="w-24 sm:w-32 aspect-[2.5/3.5] rounded-lg overflow-hidden border-2 border-transparent group-hover:border-amber-500 shadow-lg">
                  <img
                    src={getSafeImageUrl(leader)}
                    alt={leader.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-200 bg-amber-600 text-black text-[10px] font-bold px-3 py-1 rounded shadow-xl whitespace-nowrap z-20">
                  組建 {leader.name} 牌組
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* OPTION B: MANUAL IMPORT */}
      <div className="p-6 bg-slate-900/80 border border-slate-700 rounded-2xl shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-4 bg-blue-500 rounded-full" />
            B餐: 抄人Deck
          </h3>
          <span className="text-[10px] font-bold px-2 py-1 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">
            上載代碼
          </span>
        </div>

        <div className="space-y-4">
          <textarea
            className="w-full h-40 bg-slate-950 border border-slate-700 rounded-xl p-4 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-slate-200 transition-all placeholder:text-slate-600 resize-none"
            placeholder={`在此貼上...
1xOP15-058
3xOP12-071
4xOP15-061
4xOP15-066
...`}
            value={deckInput}
            onChange={(e) => setDeckInput(e.target.value)}
          />

          <button
            onClick={() => {
              handleImportDeckCode(deckInput);
              setAppMode("DECK");
              setDeckInput("");
            }}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black text-sm tracking-widest transition-all shadow-lg active:scale-[0.98] uppercase"
          >
            上載 / Upload
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportView;
