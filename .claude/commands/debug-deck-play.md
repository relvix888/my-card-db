---
name: debug-deck-play
description: Debug a deck by simulating N games and checking which card effects actually fire at runtime.
Usage: /debug-deck-play <leader-card-id>
Example: /debug-deck-play EB02-010
---

## What to do

The user wants to play-test the deck led by **$ARGUMENTS** to verify that each card's effects activate correctly in-game, not just pass static analysis.

---

### Step 0 — Static audit (fast triage)

Run this first to catch any parser/handler gaps before simulating:

```bash
node /Users/rexchan/my-card-db/scripts/audit-effects.js --deck $ARGUMENTS
```

Note any `UNKNOWN` actions or `✗ NO HANDLER` findings. These are static bugs — record them for Step 3.

If it prints `Deck not found` → stop and report the leader ID is not in `deck_final.json`.

---

### Step 1 — Game simulation

Run 5 headless AI-vs-AI games and observe which card effects fire at runtime:

```bash
node --loader /Users/rexchan/my-card-db/scripts/esm-loader.js /Users/rexchan/my-card-db/scripts/simulate-deck.js --deck $ARGUMENTS --games 5
```

**Read the coverage table carefully:**

- **FULLY EXERCISED** — all expected effect timings for this card were observed firing across 5 games. No further check needed.
- **PARTIAL COVERAGE** — some timings fired, others did not. The missed timings may indicate a bug or a timing that just wasn't reached in 5 games (e.g. `KO時` when no KOs occurred).
- **NEVER TRIGGERED** — none of this card's expected timings were observed. Most common reasons:
  - Card was never drawn/played in 5 games (luck — increase `--games` or run again)
  - Card requires a specific board state that didn't arise (e.g. a cost condition, specific character type on field)
  - The effect has a handler bug and silently no-ops when played

**Note:** `防禦時` (counter-step) timings are not tracked by the simulation — they cannot be distinguished from a card being held as a counter. If a card is only shown as "never triggered" because of an untrackable timing, note it but don't flag it as a bug.

If coverage looks low after 5 games, run with `--games 10` to reduce the chance of undrawn cards:

```bash
node --loader /Users/rexchan/my-card-db/scripts/esm-loader.js /Users/rexchan/my-card-db/scripts/simulate-deck.js --deck $ARGUMENTS --games 10
```

---

### Step 2 — Deep-dive on problem cards

For every card that either:
- Had **static issues** from Step 0 (UNKNOWN / MISSING_HANDLER), **or**
- Is in **NEVER TRIGGERED** or **PARTIAL COVERAGE** from Step 1

Run the full single-card debug from `debug-card.md` (Steps 1–6 there). In brief:

1. Run the single-card audit:
   ```bash
   node /Users/rexchan/my-card-db/scripts/audit-effects.js <CARD-ID>
   ```
2. Check `effectParser.js` — is there a regex in `parseSentence()` that emits the correct action type?
3. Check `effectActions.js` — is there a `case 'ACTION_TYPE':` in `executeAction()`?
4. Check `EffectModal.jsx` — is there a matching `case 'CHOOSE_*':` for any interactive choices?
5. Check `effects.js` + `gameState.js` — is the timing keyword wired to a resolver and called from the game loop?

Skip cards where the simulation just didn't draw/play them in time — no action needed unless the static audit also flags them.

---

### Step 3 — Report

Summarise all findings across the deck:

1. **Deck**: leader ID, total unique cards, games simulated
2. **Static issues** (from Step 0): card ID, issue type (UNKNOWN action / MISSING_HANDLER)
3. **Simulation coverage** (from Step 1): copy the FULLY EXERCISED / PARTIAL / NEVER TRIGGERED table
4. **Deep-dive findings** (from Step 2): for each investigated card — which step in the chain is broken, which file needs a fix
5. **Suggested fixes**: for each confirmed bug, the minimal change — file, function, what to add

If multiple cards share the same root cause (e.g. all fail because the same action type is missing from `executeAction()`), lead with that shared fix.
