import { useState } from "react";
import { useTranslation } from "react-i18next";

const ImportView = ({
  cards,
  topDecksData,
  prevMetaData,
  ggDecksData,
  officialDecksData,
  getSafeImageUrl,
  generateMetaDeck,
  deckInput,
  setDeckInput,
  handleImportDeckCode,
  setAppMode,
}) => {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const [deckSource, setDeckSource] = useState("topdecks");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedColors, setSelectedColors] = useState([]);

  const colorMap = {
    red: t("colors.red"),
    green: t("colors.green"),
    blue: t("colors.blue"),
    purple: t("colors.purple"),
    black: t("colors.black"),
    yellow: t("colors.yellow"),
  };

  const toggleColor = (color) =>
    setSelectedColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color],
    );

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedColors([]);
  };
  const hasFilters = searchTerm.trim() !== "" || selectedColors.length > 0;

  const COLOR_STYLES = {
    red: {
      on: "bg-red-600 border-red-400 text-white shadow-[0_0_10px_rgba(220,38,38,0.4)]",
      off: "bg-red-950/20 border-red-900/30 text-red-500/50 hover:bg-red-900/40",
    },
    green: {
      on: "bg-emerald-600 border-emerald-400 text-white shadow-[0_0_10px_rgba(16,185,129,0.4)]",
      off: "bg-emerald-950/20 border-emerald-900/30 text-emerald-500/50 hover:bg-emerald-900/40",
    },
    blue: {
      on: "bg-blue-600 border-blue-400 text-white shadow-[0_0_10px_rgba(37,99,235,0.4)]",
      off: "bg-blue-950/20 border-blue-900/30 text-blue-500/50 hover:bg-blue-900/40",
    },
    purple: {
      on: "bg-purple-600 border-purple-400 text-white shadow-[0_0_10px_rgba(147,51,234,0.4)]",
      off: "bg-purple-950/20 border-purple-900/30 text-purple-500/50 hover:bg-purple-900/40",
    },
    black: {
      on: "bg-slate-900 border-slate-500 text-white shadow-[0_0_10px_rgba(255,255,255,0.1)]",
      off: "bg-slate-950/40 border-slate-800 text-slate-600 hover:bg-slate-900/60",
    },
    yellow: {
      on: "bg-yellow-500 border-yellow-300 text-black shadow-[0_0_10px_rgba(234,179,8,0.4)]",
      off: "bg-yellow-900/10 border-yellow-900/30 text-yellow-600/50 hover:bg-yellow-900/30",
    },
  };

  // Returns true if a leader card passes the active search + color filters
  const passesFilter = (leader, extraText = "") => {
    if (selectedColors.length > 0) {
      const lc = (leader?.colors || []).map((c) => c.toLowerCase());
      if (!selectedColors.some((sc) => lc.includes(sc))) return false;
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      const name = (leader?.name || "").toLowerCase();
      const id = (leader?.id || "").toLowerCase();
      const extra = extraText.toLowerCase();
      if (!name.includes(q) && !id.includes(q) && !extra.includes(q))
        return false;
    }
    return true;
  };

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
        topDecksData[c.id.toUpperCase()] &&
        passesFilter(c),
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
        ggDecksData[c.id.toUpperCase()] &&
        passesFilter(c),
    )
    .sort((a, b) => {
      const dateA = ggDecksData[a.id.toUpperCase()]?.event_date || "";
      const dateB = ggDecksData[b.id.toUpperCase()]?.event_date || "";
      return dateB.localeCompare(dateA);
    });

  const prevMetaLeaders = cards
    .filter(
      (c) =>
        (c.category === "Leader" || c.category === "領航") &&
        prevMetaData[c.id.toUpperCase()] &&
        passesFilter(c),
    )
    .sort(
      (a, b) =>
        (prevMetaData[b.id.toUpperCase()]?.count || 0) -
        (prevMetaData[a.id.toUpperCase()]?.count || 0),
    );

  const officialDeckLabel = (leaderCard) => {
    const colors = (leaderCard.colors || []).map((c) =>
      t(`colors.${c.toLowerCase()}`),
    );
    const colorStr = isEn ? colors.join("/") : colors.join("");
    return isEn
      ? `(${colorStr}) ${leaderCard.name}`
      : `(${colorStr})${leaderCard.name}`;
  };

  const handleOfficialDeckClick = (entry) => {
    handleImportDeckCode(entry.deck);
    setAppMode("DECK");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Build list of official deck entries enriched with the correct leader card.
  // The scraper's heuristic for `entry.leader` can be wrong, so we prefer
  // matching by category (Leader / 領航) within the deck card list first.
  const officialEntries = (officialDecksData || [])
    .map((entry) => {
      const deckIds = new Set(
        entry.deck.split(",").map((s) => s.replace(/^\d+x/, "").toUpperCase()),
      );
      const isLeaderCard = (c) =>
        c.category === "Leader" || c.category === "領航";

      // Prefer a card that is both in the deck AND categorised as a leader
      let leaderCard = cards.find(
        (c) => deckIds.has(c.id.toUpperCase()) && isLeaderCard(c),
      );
      // Fall back to the stored entry.leader regardless of category
      if (!leaderCard) {
        leaderCard = cards.find(
          (c) => c.id.toUpperCase() === entry.leader.toUpperCase(),
        );
      }

      if (!leaderCard) return null;
      if (!passesFilter(leaderCard, entry.name || "")) return null;
      return { ...entry, leaderCard };
    })
    .filter(Boolean);

  const isGG = deckSource === "gumgum";
  const isOfficial = deckSource === "official";
  const isPrevMeta = deckSource === "prevmeta";

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
              style={{
                backgroundColor: isOfficial
                  ? "#d97706"
                  : isGG
                    ? "#0d9488"
                    : isPrevMeta
                      ? "#64748b"
                      : "#a855f7",
              }}
            />
            {t("meta_section")}
          </h3>
          <span
            className="text-[10px] font-bold px-2 py-1 rounded border transition-colors duration-200"
            style={
              isOfficial
                ? { background: "rgba(217,119,6,0.1)",   color: "#fbbf24", borderColor: "rgba(217,119,6,0.2)" }
                : isGG
                  ? { background: "rgba(13,148,136,0.1)", color: "#2dd4bf", borderColor: "rgba(13,148,136,0.2)" }
                  : isPrevMeta
                    ? { background: "rgba(100,116,139,0.1)", color: "#94a3b8", borderColor: "rgba(100,116,139,0.2)" }
                    : { background: "rgba(168,85,247,0.1)", color: "#c084fc", borderColor: "rgba(168,85,247,0.2)" }
            }
          >
            {isOfficial
              ? isEn ? "Official" : "Bandai官方"
              : isGG
                ? t("latest_event")
                : isPrevMeta
                  ? isEn ? "Prev Meta" : "前代環境"
                  : t("hot_leaders")}
          </span>
        </div>

        {/* Source tabs */}
        <div className="flex gap-2 mb-5">
          {[
            { key: "topdecks", label: t("topdecks_source"),              color: "#7c3aed" },
            { key: "gumgum",   label: t("gumgum_source"),                color: "#0d9488" },
            { key: "prevmeta", label: isEn ? "Prev Meta" : "前代環境",   color: "#64748b" },
            { key: "official", label: isEn ? "Official" : "官方推薦",    color: "#d97706" },
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

        {/* Search + Clear */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={
              isEn ? "Search by leader name or ID…" : "搜尋領航名稱或ID…"
            }
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-sm focus:border-blue-500 outline-none transition-colors text-slate-200 placeholder:text-slate-600"
          />
          <button
            onClick={clearFilters}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
              hasFilters
                ? "bg-slate-700 hover:bg-slate-600 text-white border-slate-500"
                : "bg-slate-800/50 text-slate-600 border-slate-700 cursor-default"
            }`}
          >
            {isEn ? "Clear" : "清除"}
          </button>
        </div>

        {/* Color filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setSelectedColors([])}
            className={`px-2 py-1 rounded text-[12px] font-bold border transition-all active:scale-95 ${
              selectedColors.length === 0
                ? "bg-indigo-600 border-indigo-400 text-white shadow-[0_0_10px_rgba(79,70,229,0.4)]"
                : "bg-indigo-900/20 border-indigo-900/40 text-indigo-400/60 hover:bg-indigo-600/30"
            }`}
          >
            {isEn ? "All" : "所有"}
          </button>
          {Object.entries(colorMap).map(([id, label]) => {
            const isSelected = selectedColors.includes(id);
            const s = COLOR_STYLES[id] || {
              on: "bg-slate-700 text-white border-slate-500",
              off: "bg-slate-800 text-slate-400 border-slate-700",
            };
            return (
              <button
                key={id}
                onClick={() => toggleColor(id)}
                className={`px-2 py-1 rounded text-[13px] font-bold border transition-all duration-300 active:scale-90 ${isSelected ? s.on : s.off}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Scrollable Leader Gallery */}
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide px-2">
          {isOfficial
            ? officialEntries.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => handleOfficialDeckClick(entry)}
                  className="group relative flex-shrink-0 cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
                >
                  <div
                    className="w-24 sm:w-32 aspect-[2.5/3.5] rounded-lg overflow-hidden border-2 border-transparent shadow-lg transition-colors duration-150"
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.borderColor = "#d97706")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.borderColor = "transparent")
                    }
                  >
                    <img
                      src={getSafeImageUrl(entry.leaderCard)}
                      alt={entry.name || entry.leaderCard.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div
                    className="absolute left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-200 text-black text-[10px] font-bold px-3 py-1 rounded shadow-xl whitespace-nowrap z-20"
                    style={{ bottom: "-0.5rem", backgroundColor: "#d97706" }}
                  >
                    {officialDeckLabel(entry.leaderCard)}
                  </div>
                </div>
              ))
            : (isPrevMeta ? prevMetaLeaders : isGG ? ggLeaders : topdecksLeaders).map((leader) => (
                <div
                  key={leader.id}
                  onClick={() => {
                    if (isGG) { handleGGLeaderClick(leader); return; }
                    if (isPrevMeta) {
                      const entry = prevMetaData[leader.id.toUpperCase()];
                      const deck = typeof entry === "object" ? entry.deck : entry;
                      if (deck) { handleImportDeckCode(deck); setAppMode("DECK"); window.scrollTo({ top: 0, behavior: "smooth" }); }
                      return;
                    }
                    generateMetaDeck(leader);
                  }}
                  className="group relative flex-shrink-0 cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
                >
                  <div
                    className="w-24 sm:w-32 aspect-[2.5/3.5] rounded-lg overflow-hidden border-2 border-transparent shadow-lg transition-colors duration-150"
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.borderColor = isPrevMeta
                        ? "#64748b"
                        : isGG
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
                      backgroundColor: isPrevMeta ? "#64748b" : isGG ? "#0d9488" : "#d97706",
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
