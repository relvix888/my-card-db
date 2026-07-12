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
- The script now shows both CN and EN effects and attaches the aligned EN clause to each UNKNOWN action.
- If it prints `✓ No parser/handler issues found.` → skip to Step 4 (timing wiring). The card's parser and handler chain is already complete.
- If it prints `UNKNOWN` actions or `✗ NO HANDLER` → note the issue(s) **and read the `→ EN:` line** to understand what the UNKNOWN clause should implement. Continue to Steps 1–3 only for those specific actions.
- If it prints `Card not found` → fall through to Step 1 to verify the card ID.

This single command covers what Steps 1–3 check manually. Only proceed to the full steps below when the audit script surfaces an issue that needs investigation.

---

### Step 1 — Look up the card data (CN + EN)

Use the Agent tool with `subagent_type: "haiku"` to find the card. Pass this exact prompt to the sub-agent:

> Search for card "$ARGUMENTS" in both CN and EN data files. Run this bash command:
>
> ```bash
> python3 -c "
> import json, glob, sys
> target = '$ARGUMENTS'.strip()
> cn, en = None, None
> for path in sorted(glob.glob('/Users/rexchan/opc-uploader/data/ZH/cards_*.json')):
>     with open(path) as f:
>         cards = json.load(f)
>     for c in cards:
>         if c.get('id','').upper() == target.upper(): cn = c; break
>     if cn: break
> for path in sorted(glob.glob('/Users/rexchan/opc-uploader/data/EN/cards_*.json')):
>     with open(path) as f:
>         cards = json.load(f)
>     for c in cards:
>         if c.get('id','').upper() == target.upper() and '_p' not in c.get('id',''): en = c; break
>     if en: break
> if cn:
>     print('=== CN ==='); print(json.dumps(cn, ensure_ascii=False, indent=2))
> if en:
>     print('=== EN ==='); print(json.dumps(en, ensure_ascii=False, indent=2))
> if not cn:
>     print('Card not found:', target); sys.exit(1)
> "
> ```
>
> Return the full JSON of both CN and EN cards as printed, or "Card not found: $ARGUMENTS" if the CN card is missing.

Use the card data returned by the sub-agent. If not found, stop and report the card is missing.

**Display both effects aligned by clause** (split on `<br>`) so each CN block is paired with its EN translation:

```
CN [1]: 【速攻：角色】(...)
EN [1]: [Rush: Character] (...)

CN [2]: 【登場時】每有1張自己擁有《海王類》特徵的角色卡，抽1張卡片。之後，依抽取的卡片張數廢棄自己的手牌。
EN [2]: [On Play] Draw a card for each of your {Neptunian} type Characters. Then, trash the same number of cards from your hand.
```

### Step 2 — Parse the effect text

Run `parseEffectBilingual` so each parsed clause carries its aligned EN text (`_enText`) for semantic validation:

```bash
node --input-type=module << 'JSEOF'
import { parseEffectBilingual } from '/Users/rexchan/my-card-db/src/components/practice/engine/effectParser.js';
const cn = `PASTE_CN_EFFECT_HERE`;
const en = `PASTE_EN_EFFECT_HERE`;
const result = parseEffectBilingual(cn, en);
console.log(JSON.stringify(result, null, 2));
JSEOF
```

Replace `PASTE_CN_EFFECT_HERE` / `PASTE_EN_EFFECT_HERE` with the actual `effect` fields from Step 1. If no EN data is available, use `parseEffect` instead and pass only the CN text.

Show the full parsed output. **Immediately flag any `"type": "UNKNOWN"` action** — this means the parser has no regex for that sentence and it will silently no-op in the engine.

Also check these fields on every parsed clause:

- `donGate`: should be non-null if the effect text contains `咚‼×N`
- `isOptional`: should be `true` if the effect text contains `可` before `：`
- `REST` actions: must have `count` field (e.g. `"count": 2`) — if missing, DON!! cost will rest wrong number
- `oncePerTurn`: should be `true` if text contains `每回合1次`
- **`_enText` bilingual checks** (use the EN clause to validate CN parsing):
  - EN says "for each" → `count` must be dynamic/per-filter, **not** a fixed integer
  - EN says "the same number" → count is linked to a previous action result, not fixed
  - EN says "up to N" → action must have `count: N`, not `count: Infinity`
  - EN says `[Rush: Character]` vs `[Rush]` → verify `keyword` is `RUSH_CHARS_ONLY` not `RUSH`

### Step 3 — Audit each action type

For every action in the parsed output, verify the full implementation chain across four files:

#### 3a — effectParser.js

`/Users/rexchan/my-card-db/src/components/practice/engine/effectParser.js`

In `parseSentence()`, is there a regex that emits this action type? Check that all numeric parameters (`count`, `delta`, `cost`, etc.) are extracted — not just the filter. A common mistake is parsing the filter correctly but omitting the count (e.g. REST with `count: 2` vs just `filter`).

For any `UNKNOWN` action: read `_enText` to understand what action type and parameters the regex needs to produce. The EN phrasing is the authoritative description of the intended mechanic.

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

1. **Card**: name, category, cost, power
   - CN effect: (full Chinese effect text)
   - EN effect: (full English effect text)
2. **Parsed clauses**: list each clause with its timing, `_enText`, actions (including all numeric fields), donGate, isOptional
3. **Action coverage** — for each action type:
   | Action | Parsed ✓/✗ | Count/params correct ✓/✗ | executeAction case ✓/✗ | CHOOSE\_ handler ✓/✗ | EffectModal case ✓/✗ |
   |--------|-----------|--------------------------|------------------------|----------------------|----------------------|
4. **Timing wiring**: each timing keyword — resolver exists ✓/✗, called from gameState ✓/✗
5. **Phase-transition effects**: any flags set — read in phase function ✓/✗, cleared correctly ✓/✗
6. **Issues found**: list each bug with the specific file and line/function. For UNKNOWN actions, include the `_enText` and the action type it should become.
7. **Suggested fix**: for each issue, the minimal change needed (file, function, what to add/change)

If the card has a `trigger` field, also check that `hasTrigger()` and `resolveTriggerEffect()` would handle it correctly.
