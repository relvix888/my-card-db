---
name: debug-card
description: Debug a specific card's effect implementation in the game engine.
Usage: /debug-card <card-id>
Example: /debug-card EB03-053
---

## What to do

The user wants to debug card **$ARGUMENTS**.

### Step 0 — Run the audit script (fast triage)

Run this first — it replaces Steps 1–3 for the common case:

```bash
node /Users/rexchan/my-card-db/scripts/audit-effects.js $ARGUMENTS
```

**Read the output carefully:**
- If it prints `✓ No parser/handler issues found.` → skip to Step 4 (timing wiring). The card's parser and handler chain is already complete.
- If it prints `UNKNOWN` actions or `✗ NO HANDLER` → note the issue(s) and continue to Steps 1–3 only for those specific actions.
- If it prints `Card not found` → fall through to Step 1 to verify the card ID.

This single command covers what Steps 1–3 check manually. Only proceed to the full steps below when the audit script surfaces an issue that needs investigation.

---

### Step 1 — Look up the card data

Use the Agent tool with `subagent_type: "haiku"` to find the card. Pass this exact prompt to the sub-agent:

> Search for card "$ARGUMENTS" in `/Users/rexchan/opc-uploader/data/cards_*.json`. Each file is a JSON array of card objects. Run this bash command to find it:
>
> ```bash
> python3 -c "
> import json, glob, sys
> target = '$ARGUMENTS'.strip()
> for path in sorted(glob.glob('/Users/rexchan/opc-uploader/data/cards_*.json')):
>     with open(path) as f:
>         cards = json.load(f)
>     for c in cards:
>         if c.get('id','').upper() == target.upper():
>             print(json.dumps(c, ensure_ascii=False, indent=2))
>             sys.exit(0)
> print('Card not found:', target)
> "
> ```
>
> Return the full JSON exactly as printed, or "Card not found: $ARGUMENTS" if missing.

Use the card data returned by the sub-agent. If not found, stop and report the card is missing from the data files.

Show the full card data, especially `effect` and `trigger`. Copy the `effect` string exactly for Step 2.

### Step 2 — Parse the effect text

Run the effectParser against the card's exact `effect` text using Node.js:

```bash
node --input-type=module << 'JSEOF'
import { parseEffect } from '/Users/rexchan/my-card-db/src/components/practice/engine/effectParser.js';
const effect = `PASTE_EFFECT_TEXT_HERE`;
const result = parseEffect(effect);
console.log(JSON.stringify(result, null, 2));
JSEOF
```

Replace `PASTE_EFFECT_TEXT_HERE` with the actual `effect` field from Step 1 (keep the backtick delimiters). Show the full parsed output.

**Immediately flag any `"type": "UNKNOWN"` action** — this means the parser has no regex for that effect sentence and the action will silently no-op in the engine.

Also check these fields on every parsed clause:

- `donGate`: should be non-null if the effect text contains `咚‼×N`
- `isOptional`: should be `true` if the effect text contains `可` before `：`
- `REST` actions: must have `count` field (e.g. `"count": 2`) — if missing, DON!! cost will rest wrong number
- `oncePerTurn`: should be `true` if text contains `每回合1次`

### Step 3 — Audit each action type

For every action in the parsed output, verify the full implementation chain across four files:

#### 3a — effectParser.js

`/Users/rexchan/my-card-db/src/components/practice/engine/effectParser.js`

In `parseSentence()`, is there a regex that emits this action type? Check that all numeric parameters (`count`, `delta`, `cost`, etc.) are extracted — not just the filter. A common mistake is parsing the filter correctly but omitting the count (e.g. REST with `count: 2` vs just `filter`).

#### 3b — effectActions.js

`/Users/rexchan/my-card-db/src/components/practice/engine/effectActions.js`

- Is there a `case 'ACTION_TYPE':` in `executeAction()`?
- If the action triggers a player choice, does it call `setPendingEffect()` with a `CHOOSE_*` type?
- Is there a matching `case 'CHOOSE_*':` in `resolveEffectChoice()`?
- Does the handler correctly read `action.count` (not hardcoding 1)?

#### 3c — EffectModal.jsx

`/Users/rexchan/my-card-db/src/components/practice/components/EffectModal.jsx`

For every `CHOOSE_*` type the action produces, is there a matching `case 'CHOOSE_*':` that sets `title`, `subtitle`, `maxSelect`, `canSkip`, and `items`? Missing UI cases cause the modal to silently show nothing.

#### 3d — effects.js timing wiring

`/Users/rexchan/my-card-db/src/components/practice/engine/effects.js`

Is the timing keyword handled by a `resolveOn*` function that is exported and called from `gameState.js`?

### Step 4 — Check gameState.js wiring

For each timing in the card's parsed clauses, verify it's wired up in `gameState.js` (`/Users/rexchan/my-card-db/src/components/practice/engine/gameState.js`):

- `登場時` → `resolveOnPlayEffect` called after deploying?
- `KO時` → `resolveOnKOEffect` called after KO?
- `攻擊時` → `resolveOnAttackEffect` called during attack?
- `防禦時` → `resolveOnBlockEffect` called during block?
- `我方回合結束時` → `resolveEndOfTurnEffects` called?
- `觸發器` → `resolveTriggerEffect` called from trigger resolution?
- `啟動主要` / `起動メイン` → `resolveActivatedMainEffect` called from action menu?
- Event card (no timing keyword) → `resolveEventEffect` called when card is played?

### Step 5 — Check phase-transition effects

Some effects persist across turns by setting a flag on a field card (e.g. `refreshLocked`, `powerMods`). For any effect that should last until a future phase, verify that the relevant phase function in `gameState.js` reads and clears that flag:

- Effects that prevent refresh → `applyRefresh` must skip activating flagged characters
- Turn-duration power mods → `clearPowerMods(state, p, 'turn')` called in `applyRefresh`
- Once-per-turn limits → `effectUsed` cleared in `applyRefresh`

If a flag is set by `executeAction` but never read in any phase function, the effect silently expires without firing.

### Step 6 — Report findings

Summarise:

1. **Card**: name, category, cost, power, effect text
2. **Parsed clauses**: list each clause with its timing, actions (including all numeric fields), donGate, isOptional
3. **Action coverage** — for each action type:
   | Action | Parsed ✓/✗ | Count/params correct ✓/✗ | executeAction case ✓/✗ | CHOOSE\_ handler ✓/✗ | EffectModal case ✓/✗ |
   |--------|-----------|--------------------------|------------------------|----------------------|----------------------|
4. **Timing wiring**: each timing keyword — resolver exists ✓/✗, called from gameState ✓/✗
5. **Phase-transition effects**: any flags set — read in phase function ✓/✗, cleared correctly ✓/✗
6. **Issues found**: list each bug with the specific file and line/function
7. **Suggested fix**: for each issue, the minimal change needed (file, function, what to add/change)

If the card has a `trigger` field, also check that `hasTrigger()` and `resolveTriggerEffect()` would handle it correctly.
