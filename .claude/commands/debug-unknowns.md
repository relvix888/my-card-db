---
name: debug-unknowns
description: Find every card in a set whose effect text fails to parse (UNKNOWN keyword from cardRanker), then deep-debug each one. Skips no-effect cards.
Usage: /debug-unknowns <SET-ID>
Example: /debug-unknowns OP15
---

## What to do

The user wants to find and debug all cards in set **$ARGUMENTS** whose effect text the parser cannot handle.

A card is flagged when `scoreCard()` (`src/utils/cardRanker.js`) emits an `UNKNOWN` action keyword for a card that **actually has effect text**. Cards with no effect (empty or `"-"`) also yield UNKNOWN but that is expected — the finder script already excludes them, so every card it returns is a genuine parser gap.

### Step 1 — Identify the UNKNOWN-effect cards

Run the finder script:

```bash
node --loader /Users/rexchan/my-card-db/scripts/esm-loader.js \
  /Users/rexchan/my-card-db/scripts/find-unknown-effects.mjs $ARGUMENTS
```

- If it prints `no cards with unparseable effects` → report that the set is clean and stop.
- Otherwise it prints each flagged card's ID, name, and effect text, plus a final `IDs:` line. Collect those IDs.

To get the IDs as a machine-readable list (e.g. to drive a loop), append `--json`:

```bash
node --loader /Users/rexchan/my-card-db/scripts/esm-loader.js \
  /Users/rexchan/my-card-db/scripts/find-unknown-effects.mjs $ARGUMENTS --json
```

### Step 2 — Debug each flagged card

For **each** flagged card ID, run the full **debug-card** procedure (see `.claude/commands/debug-card.md`):

- **Step 0** — `node scripts/audit-effects.js <CARD-ID>` for fast triage.
  - ⚠️ The audit uses the bilingual/EN parser, which sometimes parses a clause that the CN-only `parseEffect` (what `scoreCard`/`cardRanker` use) reports as UNKNOWN. If the audit says "no issues" but the finder flagged the card, **parse the CN effect directly** to expose the real gap:
    ```bash
    node --input-type=module -e '
    import("/Users/rexchan/my-card-db/src/components/practice/engine/effectParser.js").then(m => {
      console.log(JSON.stringify(m.parseEffect(`PASTE_CN_EFFECT`), null, 2));
    })'
    ```
- **Steps 1–5** — look up CN+EN data, parse, audit each action type across `effectParser.js` / `effectActions.js` / `EffectModal.jsx`, check `gameState.js` timing wiring and phase-transition flags.

Run the per-card investigations concurrently where the cards are independent.

### Step 3 — Consolidated report

Produce one report for the whole set:

1. **Summary**: `SET-ID — N cards have unparseable effects.`
2. **Per-card table**:

   | Card ID | Name | UNKNOWN clause (raw) | Action it should become | Suggested fix (file · function) |
   |---------|------|----------------------|-------------------------|---------------------------------|

3. For each card, note whether the fix is a **simple regex addition** (action type + handler already exist) or a **new mechanic** (needs a new action type, handler, and possibly an `EffectModal` case).

Do **not** apply fixes unless the user asks — this command diagnoses. Offer to implement the fixes, ordered simplest-first.
