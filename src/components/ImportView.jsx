import { useState } from "react";
import { useTranslation } from "react-i18next";

const ImportView = ({
  cards,
  topDecksData,
  ggDecksData,
  getSafeImageUrl,
  generateMetaDeck,
  deckInput,
  setDeckInput,
  handleImportDeckCode,
  setAppMode,
}) => {
  const { t } = useTranslation();
  const [deckSource, setDeckSource] = useState("topdecks");

  const handleGGLeaderClick = (leader) => {
    const entry = ggDecksData[leader.id.toUpperCase()];
    if (entry?.deck) {
      handleImportDeckCode(entry.deck);
      setAppMode("DECK");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const topdecksLeaders = cards
    .filter(
      (c) =>
        (c.category === "Leader" || c.category === "領航") &&
        topDecksData[c.id.toUpperCase()],
    )
    .sort(
      (a, b) =>
        (topDecksData[b.id.toUpperCase()]?.count || 0) -
        (topDecksData[a.id.toUpperCase()]?.count || 0),
    );

  const ggLeaders = cards
    .filter(
      (c) =>
        (c.category === "Leader" || c.category === "領航") &&
        ggDecksData[c.id.toUpperCase()],
    )
    .sort((a, b) => {
      const dateA = ggDecksData[a.id.toUpperCase()]?.event_date || "";
      const dateB = ggDecksData[b.id.toUpperCase()]?.event_date || "";
      return dateB.localeCompare(dateA);
    });

  const isGG = deckSource === "gumgum";

  return (
    <div className="max-w-7xl mx-auto w-full px-4 py-8 space-y-6 animate-in fade-in zoom-in-95 duration-300">
      <header className="mb-10 font-bold text-center text-xl sm:text-left">
        {t("import_title")}
      </header>

      {/* OPTION A: AUTO-BUILD (Meta Decks) */}
      <div className="p-6 bg-slate-900/80 border border-slate-700 rounded-2xl shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
            <span
              className="w-1.5 h-4 rounded-full transition-colors duration-200"
              style={{ backgroundColor: isGG ? "#0d9488" : "#a855f7" }}
            />
            {t("meta_section")}
          </h3>
          <span
            className="text-[10px] font-bold px-2 py-1 rounded border transition-colors duration-200"
            style={
              isGG
                ? {
                    background: "rgba(13,148,136,0.1)",
                    color: "#2dd4bf",
                    borderColor: "rgba(13,148,136,0.2)",
                  }
                : {
                    background: "rgba(168,85,247,0.1)",
                    color: "#c084fc",
                    borderColor: "rgba(168,85,247,0.2)",
                  }
            }
          >
            {isGG ? t("latest_event") : t("hot_leaders")}
          </span>
        </div>

        {/* Source tabs */}
        <div className="flex gap-2 mb-5">
          {[
            { key: "topdecks", label: t("topdecks_source"), color: "#7c3aed" },
            { key: "gumgum", label: t("gumgum_source"), color: "#0d9488" },
          ].map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => setDeckSource(key)}
              style={{
                padding: "4px 14px",
                borderRadius: 20,
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 12,
                background: deckSource === key ? color : "#1e293b",
                color: deckSource === key ? "#fff" : "#64748b",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Scrollable Leader Gallery */}
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide px-2">
          {(isGG ? ggLeaders : topdecksLeaders).map((leader) => (
              <div
                key={leader.id}
                onClick={() =>
                  isGG ? handleGGLeaderClick(leader) : generateMetaDeck(leader)
                }
                className="group relative flex-shrink-0 cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <div
                  className="w-24 sm:w-32 aspect-[2.5/3.5] rounded-lg overflow-hidden border-2 border-transparent shadow-lg transition-colors duration-150"
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor = isGG
                      ? "#0d9488"
                      : "#f59e0b")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.borderColor = "transparent")
                  }
                >
                  <img
                    src={getSafeImageUrl(leader)}
                    alt={leader.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>

                {/* Hover tooltip */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-200 text-black text-[10px] font-bold px-3 py-1 rounded shadow-xl whitespace-nowrap z-20"
                  style={{
                    bottom: "-0.5rem",
                    backgroundColor: isGG ? "#0d9488" : "#d97706",
                  }}
                >
                  {t("build_deck_tooltip", { name: leader.name })}
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
            {t("copy_section")}
          </h3>
          <span className="text-[10px] font-bold px-2 py-1 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">
            {t("upload_code")}
          </span>
        </div>

        <div className="space-y-4">
          <textarea
            className="w-full h-40 bg-slate-950 border border-slate-700 rounded-xl p-4 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none text-slate-200 transition-all placeholder:text-slate-600 resize-none"
            placeholder={`${t("paste_here")}
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
            {t("upload_btn")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportView;
