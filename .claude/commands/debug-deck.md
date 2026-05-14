---
name: debug-deck
description: Debug all card effects in a deck by leader card ID.
Usage: /debug-deck <leader-card-id>
Example: /debug-deck EB02-010
---

## What to do

The user wants to debug the deck led by **$ARGUMENTS**.

### Step 0 — Run the deck audit (fast triage)

```bash
node /Users/rexchan/my-card-db/scripts/audit-effects.js --deck $ARGUMENTS
```

**Read the output carefully:**
- If it prints `✓ No parser/handler issues found across this deck.` → the deck is clean at the parser/handler level. Inform the user and stop.
- If it prints `Deck not found` → the leader ID is not in `deck_final.json`. Report this and stop.
- If it lists `✗ Issues: N cards` → note each affected card ID and its issues, then continue to Step 1.

---

### Step 1 — Deep dive on each issue card

For every card listed under `✗ Issues`, run the full single-card debug flow from `debug-card.md` (Steps 1–6). Specifically:

1. Run `node /Users/rexchan/my-card-db/scripts/audit-effects.js <CARD-ID>` for the verbose single-card report.
2. For any `UNKNOWN` action, locate the effect text in the card data and check `effectParser.js` (`/Users/rexchan/my-card-db/src/components/practice/engine/effectParser.js`) for a missing regex in `parseSentence()`.
3. For any `MISSING_HANDLER`, check `effectActions.js` (`/Users/rexchan/my-card-db/src/components/practice/engine/effectActions.js`) for the missing `case` in `executeAction()` and a corresponding `resolveEffectChoice` / `EffectModal.jsx` entry.

You do not need to deep-dive cards that are clean — focus only on the issue cards.

---

### Step 2 — Report findings

Summarise all issues across the deck:

1. **Deck**: leader card ID, total unique cards, cards with issues vs. clean
2. **Issue cards**: for each affected card — name, issue type, specific action or raw text
3. **Patterns**: if multiple cards share the same `UNKNOWN` raw text or `MISSING_HANDLER` type, call it out — one fix may unblock several cards
4. **Suggested fixes**: for each distinct issue, the minimal change needed (file, function, what to add)

If all issue cards share a common root cause (e.g. the same missing handler), lead with that.
