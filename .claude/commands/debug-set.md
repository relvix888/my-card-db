---
name: debug-set
description: Batch-debug all cards in a set. Runs fast triage across every non-promo card, then deep-dives on problem cards only.
Usage: /debug-set <SET-ID>
Example: /debug-set ST30
---

## What to do

The user wants to debug all cards in set **$ARGUMENTS**.

### Step 0 — Two-layer triage

Run **both** scripts. The first catches parser/handler registration gaps; the second actually deploys each card in a headless game engine and checks state mutations.

```bash
# Layer 1 — static audit (parser output + handler registration)
node /Users/rexchan/my-card-db/scripts/audit-effects.js --set $ARGUMENTS

# Layer 2 — runtime simulation (deploy card, auto-resolve, verify state delta)
node --loader /Users/rexchan/my-card-db/scripts/esm-loader.js \
  /Users/rexchan/my-card-db/scripts/simulate-cards.js --set $ARGUMENTS
```

**What each layer catches:**

| Layer | Catches | Misses |
|-------|---------|--------|
| Static audit | UNKNOWN action types, missing handlers | Wrong counts, bad timing wiring, broken modal cases, orphaned flags |
| Runtime simulation | Engine crashes, wrong state delta (DRAW count, KO target), stuck interactive effects | Battle-step effects (counter/block), named-filter mods with no test targets |

**Reading the output:**
- Both layers report `0 cards need attention` → all clean. Report the combined clean card list and stop.
- Any card flagged by **either** layer → collect those IDs. Continue to Steps 1–5 for those cards **only**.

Simulation failure types:
- `EXCEPTION` — engine crashed while executing the card effect
- `NO_STATE_CHANGE` — effect resolver returned identical state (timing not wired, or effect silently no-ops)
- `WRONG_COUNT` — DRAW/KO/REST produced wrong number of changes
- `INTERACTIVE_STUCK` — `pendingEffect` set but auto-resolver could not clear it (missing modal/resolver case)

---

### Steps 1–5 — Deep-dive on problem cards

For each card ID from the issue list, run the full **debug-card.md** Steps 1–5:

- **Step 1** — Look up CN + EN card data and display effects aligned by clause
- **Step 2** — Parse the effect bilingual and flag any `UNKNOWN` actions or bad field values
- **Step 3** — Audit each action type across `effectParser.js`, `effectActions.js`, `EffectModal.jsx`
- **Step 4** — Check `gameState.js` timing wiring for each clause timing keyword
- **Step 5** — Check phase-transition flags (`refreshLocked`, `powerMods`, `effectUsed`, etc.)

Run these steps concurrently for independent cards where possible to save time.

---

### Step 6 — Report

Produce a consolidated report with:

1. **Set summary**: `SET-ID — X of Y cards clean. Z cards need attention.`

2. **Per-card issue table** (one row per problem card):

   | Card ID | Name | Issues | Suggested Fix |
   |---------|------|--------|---------------|
   | ST30-005 | ... | UNKNOWN action in clause 1 | Add regex to parseSentence for "..." |

3. **Clean card list**: compact ID list of all passing cards.

4. **Manual check reminder**: Timing wiring and phase-transition flags for problem cards require the fixes above; timing wiring for clean cards still requires manual check per debug-card.md Steps 4–5.
