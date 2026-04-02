import React from "react";

const PlayCurve = ({
  title,
  turns,
  setTurns,
  availableCards,
  getSafeImageUrl,
  defaultTurns,
  deckList,
}) => {
  const handleClearAll = () => {
    if (window.confirm(`確定要清空 ${title} 的所有設定嗎？`)) {
      // Create a fresh blank state for this specific curve
      const reset = defaultTurns.map((don) => ({
        don,
        slots: [null, null, null, null, null],
        operators: ["or", "or", "or", "or"],
      }));
      setTurns(reset);
    }
  };

  const updateTurnDon = (index, val) => {
    const newTurns = [...turns];
    newTurns[index].don = parseInt(val);
    setTurns(newTurns);
  };

  const updateSlot = (turnIdx, slotIdx, cardId) => {
    const newTurns = [...turns];
    // Normalize empty string to null for consistent data
    const normalizedId = cardId === "" ? null : cardId;
    newTurns[turnIdx].slots[slotIdx] = normalizedId;

    // Clear children if parent is removed
    if (!normalizedId) {
      for (let i = slotIdx + 1; i < 5; i++) {
        newTurns[turnIdx].slots[i] = null;
        newTurns[turnIdx].operators[i - 1] = "or";
      }
    }
    setTurns(newTurns);
  };

  const updateOp = (turnIdx, opIdx, op) => {
    const newTurns = [...turns];
    newTurns[turnIdx].operators[opIdx] = op;
    setTurns(newTurns);
  };

  const handleAutoFill = () => {
    if (!deckList || !availableCards.length) {
      alert("請先匯入牌組！");
      return;
    }

    // 1. Parse IDs and get Card Objects
    let deckCardIds = [];
    if (typeof deckList === "string") {
      const matches = deckList.match(/[A-Z0-9]+-[A-Z0-9]+/gi);
      deckCardIds = matches ? matches.map((id) => id.toUpperCase().trim()) : [];
    } else {
      deckCardIds = Object.keys(deckList).map((id) => id.toUpperCase().trim());
    }

    const deckCards = availableCards.filter((c) => {
      const cardId = c.id.toUpperCase();
      return deckCardIds.some(
        (dId) =>
          cardId === dId || cardId.startsWith(dId) || dId.startsWith(cardId),
      );
    });

    // NEW: Global tracker to ensure a card is only played ONCE in the entire curve
    const globalUsedCardIds = new Set();

    // 2. Map through turns
    const optimizedTurns = turns.map((turn) => {
      let remainingDon = turn.don;
      const turnSlots = [null, null, null, null, null];
      const turnOps = ["or", "or", "or", "or"];
      let currentSlotIdx = 0;

      const findBestCandidate = (currentDon) => {
        return deckCards
          .filter((card) => {
            // --- FILTERS ---
            const cat = (card.category || "").toLowerCase();
            const type = (card.type || "").toLowerCase();
            const desc = (card.description || "").toLowerCase();

            const isLeader = cat.includes("leader") || cat.includes("領航");
            const isEvent = cat.includes("event") || cat.includes("事件");
            const is2KCounter = Number(card.counter) === 2000;
            const isBlocker =
              type.includes("blocker") ||
              type.includes("阻擋者") ||
              desc.includes("blocker");

            // RULE: No duplicates in the whole curve
            if (globalUsedCardIds.has(card.id)) return false;
            if (isLeader || isEvent || is2KCounter) return false;
            if (isBlocker && turn.don <= 4) return false;

            return Number(card.cost) <= currentDon;
          })
          .sort((a, b) => {
            const aCat = (a.category || "").toLowerCase();
            const bCat = (b.category || "").toLowerCase();
            const isAStage =
              aCat.includes("stage") ||
              aCat.includes("地圖") ||
              aCat.includes("場地");
            const isBStage =
              bCat.includes("stage") ||
              bCat.includes("地圖") ||
              bCat.includes("場地");

            // Priority 1: Stage Cards
            if (isAStage && !isBStage) return -1;
            if (!isAStage && isBStage) return 1;

            // Priority 2: Highest Cost
            return Number(b.cost) - Number(a.cost);
          })[0];
      };

      // 3. Fill slots for this turn
      while (remainingDon > 0 && currentSlotIdx < 5) {
        const best = findBestCandidate(remainingDon);

        if (best) {
          turnSlots[currentSlotIdx] = best.id;
          globalUsedCardIds.add(best.id); // Mark as used globally
          remainingDon -= Number(best.cost);

          if (currentSlotIdx > 0) {
            turnOps[currentSlotIdx - 1] = "and";
          }
          currentSlotIdx++;
        } else {
          break;
        }
      }

      return { ...turn, slots: turnSlots, operators: turnOps };
    });

    setTurns(optimizedTurns);
  };

  return (
    <div className="mb-6 w-full">
      {/* Header with Title and Clear Button */}
      <div className="flex justify-between items-center mb-2 px-1">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <span
            className={`w-1 h-3 ${title.includes("先") ? "bg-orange-500" : "bg-sky-500"}`}
          />
          {title}
        </h3>

        <div className="flex gap-2">
          {/* NEW AUTO-FILL BUTTON */}
          <button
            onClick={handleAutoFill}
            className="text-[9px] font-bold text-sky-400 hover:text-sky-300 uppercase tracking-tighter border border-sky-500/20 px-2 py-0.5 rounded transition-colors flex items-center gap-1"
          >
            <span>✨</span> Auto-Fill Curve
          </button>

          <button
            onClick={handleClearAll}
            className="text-[9px] font-bold text-rose-500/70 hover:text-rose-400 uppercase tracking-tighter border border-rose-500/20 px-2 py-0.5 rounded transition-colors"
          >
            Clear All
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1 sm:gap-2 w-full">
        {turns.map((turn, tIdx) => (
          <div
            key={tIdx}
            className="bg-slate-900/60 border border-slate-800 rounded-lg p-1 sm:p-2 flex flex-col gap-1 sm:gap-2"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-1">
              <span className="text-[8px] font-bold text-slate-500">D!</span>
              <select
                value={turn.don}
                onChange={(e) => updateTurnDon(tIdx, e.target.value)}
                className="bg-transparent text-white text-[9px] rounded outline-none border-none appearance-none cursor-pointer"
              >
                {[...Array(10)].map((_, i) => (
                  <option key={i + 1} value={i + 1} className="bg-slate-900">
                    {i + 1}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col items-center">
              {[0, 1, 2, 3, 4].map((sIdx) => {
                // Use a helper to check if the previous slot is "truly" empty
                const prevSlotValue = turn.slots[sIdx - 1];
                const isPrevOccupied =
                  prevSlotValue !== null && prevSlotValue !== "";

                // Logic: Always show first 3. Show 4th if 3rd is occupied. Show 5th if 4th is occupied.
                const isVisible = sIdx < 2 || isPrevOccupied;

                if (!isVisible) return null;

                const cardId = turn.slots[sIdx];
                const card = availableCards.find((c) => c.id === cardId);

                const isStacked =
                  sIdx > 0 && turn.operators[sIdx - 1] === "with";
                const isFree = sIdx > 0 && turn.operators[sIdx - 1] === "free";
                const isAnyCombo = isStacked || isFree;

                return (
                  <React.Fragment key={sIdx}>
                    <div
                      className={`
            relative w-full transition-all duration-300
            /* Responsive overlap for iPhone & Desktop */
            ${isAnyCombo ? "-mt-[70%] z-10" : "z-0"}
            ${isAnyCombo ? "rotate-1 translate-x-0.5" : ""}
          `}
                    >
                      <div
                        className={`
              relative aspect-[2.5/3.5] rounded-lg border-2 shadow-md overflow-hidden
              ${cardId ? "border-slate-700" : "border-dashed border-slate-800 bg-slate-950/40"}
              ${isStacked ? "border-sky-500 ring-1 ring-sky-500/30" : ""}
              ${isFree ? "border-amber-500 ring-1 ring-amber-500/30" : ""}
            `}
                      >
                        {cardId ? (
                          <>
                            <img
                              src={getSafeImageUrl(card)}
                              className="w-full h-full object-cover"
                              alt=""
                            />
                            {isFree && (
                              <div className="absolute top-1 right-1 bg-amber-500 text-[8px] font-black text-black px-1 rounded-sm uppercase shadow-sm">
                                FREE
                              </div>
                            )}
                            {isStacked && (
                              <div className="absolute top-1 right-1 bg-sky-500 text-[8px] font-black text-white px-1 rounded-sm uppercase shadow-sm">
                                COMBO
                              </div>
                            )}
                            {/* New Leader Effect Badge */}
                            {turn.operators[sIdx - 1] === "lead" && (
                              <div className="absolute top-1 right-1 bg-violet-600 text-[8px] font-black text-white px-1 rounded-sm uppercase shadow-lg border border-violet-400">
                                LEAD EF
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-800 text-[10px] font-bold">
                            SLOT {sIdx + 1}
                          </div>
                        )}

                        <select
                          value={cardId || ""}
                          onChange={(e) =>
                            updateSlot(tIdx, sIdx, e.target.value)
                          }
                          className="absolute inset-0 w-full h-full opacity-0 z-30 cursor-pointer"
                        >
                          <option value="">移除卡片 (Remove)</option>
                          {availableCards.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.cost}c | {c.id} {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Operator Selector - Only show if current card is filled AND we aren't at the max slot */}
                    {sIdx < 4 && cardId && (
                      <div
                        className={`relative z-40 -my-1 transition-opacity duration-300 ${turn.operators[sIdx] !== "or" ? "opacity-30 hover:opacity-100" : "opacity-100"}`}
                      >
                        <select
                          value={turn.operators[sIdx]}
                          onChange={(e) => updateOp(tIdx, sIdx, e.target.value)}
                          className={`
                            text-[7px] font-black px-2 py-0.5 rounded-full border shadow-sm uppercase tracking-tighter cursor-pointer transition-all
                                ${
                                  turn.operators[sIdx] === "with"
                                    ? "bg-sky-600 border-sky-400 text-white"
                                    : turn.operators[sIdx] === "free"
                                      ? "bg-amber-600 border-amber-400 text-white"
                                      : turn.operators[sIdx] === "lead"
                                        ? "bg-violet-600 border-violet-400 text-white shadow-[0_0_8px_rgba(139,92,246,0.5)]" // Purple Glow for Leader Effect
                                        : turn.operators[sIdx] === "and"
                                          ? "bg-emerald-600 border-emerald-400 text-white"
                                          : "bg-slate-800 border-slate-700 text-white"
                                }
                              `}
                        >
                          <option value="or">OR</option>
                          <option value="and">AND</option>
                          <option value="with">COMBO</option>
                          <option value="free">FREE</option>
                          <option value="lead">LEAD EF</option>
                        </select>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PlayCurve;
