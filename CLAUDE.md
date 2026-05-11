# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Project Overview

A One Piece TCG database web app in Traditional Chinese. Features include a meta deck builder (auto-generates optimised 50-card lists from recent tournament results), marketplace view (price overlay on card art), card search, and PNG export for social sharing.

---

# Commands

### Frontend

```bash
npm start          # dev server (localhost:3000)
npm run build      # production build → build/
npm test           # Jest/RTL test suite
firebase deploy    # deploy build/ to Firebase Hosting
```

### Python Pipeline

All Python scripts use the `.venv` virtualenv (Python 3.14). Run from the project root:

```bash
source .venv/bin/activate

# Meta decks — onepiecetopdecks.com pipeline
python pipeline/collect/deck_scraper.py
python pipeline/transform/deck_normaliser.py   # normalise informal leader names to card IDs
python pipeline/transform/deck_autobuilder.py  # → src/data/deck_final.json

# Meta decks — gumgum.gg pipeline
python pipeline/collect/deck_scraper_gg.py     # → pipeline/data/deck_raw_gg.db
python pipeline/transform/deck_gg_autobuilder.py  # → src/data/deck_gg_final.json

# Prices
python pipeline/collect/price_scraper.py       # → pipeline/data/price_raw.json
python pipeline/transform/price_transformer.py # → src/data/price_final.json

# Q&A
node pipeline/collect/qanda_scraper.js         # then move output → src/data/master_qa.json
```

### Card Database (new set release)

```bash
vega pull all                     # fetch new pack JSON from Bandai API
# move JSON to opc-uploader/data
cd opc-uploader && node upload.js # push to Firestore
```

---

# Architecture

## Frontend (`src/`)

`App.js` is the central god component. It owns all global state (active view, current deck, card DB loaded from Firestore, selected prices) and passes props down to four view components:

| Component         | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `DeckView`        | Meta deck browser; renders suggested lists from `deck_final.json` / `deck_gg_final.json` |
| `MarketplaceView` | Card art grid with price ribbons overlaid; drives PNG export via `html2canvas`           |
| `SearchView`      | Keyword/attribute search across the full card DB                                         |
| `ImportView`      | Paste-in decklist parser                                                                 |

Card data is **not bundled** — it is fetched at runtime from **Firestore** (anonymous auth via Firebase). `App.js` calls `onSnapshot` on the cards collection and holds the result in state.

Card images are served from **Cloudinary** (`getSafeImageUrl` in `src/utils/cardHelpers.js`):

```
https://res.cloudinary.com/dbc9yrfpw/image/upload/f_auto,q_auto/v1/opc-images/{CARD_ID}.png
```

**i18n:** Traditional Chinese (`zh`) is the default; English (`en`) is supported. Strings live in `src/i18n/zh.json` and `src/i18n/en.json`, wired via `react-i18next`.

**Rotation rules** (`src/data/rotation.js`) export three constants consumed by `App.js` to filter illegal cards: `BANNED_LIST`, `RESTRICTED_PAIRS`, and `BLOCK_1_EXCEPTIONS`.

## Data Pipeline

Two parallel pipelines produce meta deck JSON:

```
onepiecetopdecks.com → deck_scraper.py → deck_raw.db
                     → deck_normaliser.py   (maps informal names e.g. "G Zoro" → OP12-020)
                     → deck_autobuilder.py  → src/data/deck_final.json

gumgum.gg            → deck_scraper_gg.py  → deck_raw_gg.db  (20 most recent decks, all event types)
                     → deck_gg_autobuilder.py → src/data/deck_gg_final.json
```

`deck_gg_autobuilder.py` aggregates up to 5 decks per leader: cards are ranked by appearance frequency × average quantity, then filled greedily to 50 cards.

Prices flow: `price_scraper.py` (yuyu-tei.jp) → `pipeline/data/price_raw.json` → `price_transformer.py` → `src/data/price_final.json`.

## Card ID Format

- Standard cards: `OP01-001`, `ST01-001`, `EB01-001`, `PRB01-001`
- Parallel art suffix: `OP01-001_p1`
- Reprint suffix: `OP01-001_r`
- Pack IDs differ by region: `zh = 554xxx`, `en = 556xxx`, `ja = 550xxx`

The `deck_normaliser.py` `ID_MAP` must be updated whenever new leader nicknames appear in onepiecetopdecks.com data.

---

# Battle Mode (Practice Simulator)

**Entry point:** `src/components/practice/PracticeView.jsx`
**Rules reference:** `/Users/rexchan/opc-rules-vault/opc rules vault/wiki/concepts/`

The battle mode is a single-player practice simulator. The human plays their own deck against a greedy AI opponent that mirrors the human's deck (independently shuffled). State is managed with `useReducer` — all transitions are pure functions in the engine files.

---

## Engine Files

| File | Role |
|------|------|
| `engine/constants.js` | PHASE, BATTLE_STEP, PLAYER enums; DON_PER_TURN, MAX_CHARACTERS, etc. |
| `engine/effectParser.js` | Parses card effect text (Traditional Chinese, `<br>`-delimited) into structured clause objects |
| `engine/effectActions.js` | Pure state mutations for all 10 action types; interactive choices set `pendingEffect` |
| `engine/effects.js` | Timing-based resolvers (on-play, on-attack, on-block, trigger, event, end-of-turn); continuous power evaluation |
| `engine/gameState.js` | All phase/battle state transitions as pure reducer actions; central `gameReducer` |
| `engine/aiPlayer.js` | Greedy AI: plays highest-cost affordable characters, attaches DON!!, attacks, ends turn |

---

## State Shape

```js
GameState {
  phase: 'refresh'|'draw'|'don'|'main'
  firstPlayer, activePlayer, waitingFor: 'human'|'ai'
  turn: number
  winner: null | 'human'|'ai'
  mulligan: 'pending'|'done'
  human: PlayerState
  ai:    PlayerState
  battle: BattleState | null
  pendingTrigger: TriggerState | null   // life card with Trigger revealed
  pendingEffect:  EffectState  | null   // interactive effect awaiting human choice
  log: LogEntry[]
}

PlayerState {
  leader:        FieldCard          // { card, state: 'active'|'rest', attachedDon: number }
  hand:          Card[]
  deck:          Card[]             // index 0 = bottom, last = top
  donDeck:       Don[]
  costArea:      Don[]              // active/rest DON!! tokens
  characterArea: FieldCard[]        // max 5
  stageArea:     FieldCard | null
  lifeArea:      Card[]             // last = top (revealed first on damage)
  trash:         Card[]
  powerMods:     PowerMod[]         // [{ target: 'leader'|charIndex, delta, until: 'turn'|'battle' }]
  effectUsed:    {}                 // { [effectKey]: true } — once-per-turn tracking; cleared on Refresh
}

BattleState {
  step: 'block'|'counter'|'damage'
  attackerOwner, attackerZone, attackerIndex
  targetOwner,   targetZone,   targetIndex
  atkPower, defPower
  blockerUsed: boolean
}
```

---

## Turn Structure

```
REFRESH  → unrest all cards, return attached DON!!, clear effectUsed + turn powerMods
DRAW     → draw 1 card (skipped for first player's turn 1)
DON!!    → gain 2 DON!! (1 on turn 1 for first player)
MAIN     → play cards, attach DON!!, declare attacks (repeatable)
END TURN → fire 【我方回合結束時】 effects, clear justDeployed, switch active player
```

### Battle Sequence (within MAIN)
```
1. DECLARE_ATTACK  → attacker rests; 【攻擊時】 fires; atkPower / defPower computed
2. BLOCK step      → defender may activate one Blocker (【防禦】); blocker becomes new target
3. COUNTER step    → defender may play counter cards from hand (repeat until SKIP_COUNTER)
4. DAMAGE step     → if atkPower ≥ defPower: deal damage or KO character
5. Battle ends     → clear 'battle'-duration powerMods
```

---

## Effect System

### Parsing (`effectParser.js`)

Each `<br>`-separated block of effect text becomes a **clause**:
```js
Clause {
  timings:      string[]   // ['登場時', '攻擊時', '啟動主要', ...]
  continuous:   string[]   // ['對方回合中', '我方回合中']
  passive:      string[]   // ['速攻', '防禦', '雙重攻擊', '消失']
  donGate:      number|null  // 【咚‼×N】 — N+ DON!! must be attached
  donReturn:    number|null  // 咚‼-N: return N DON!! to DON!! deck as cost
  oncePerTurn:  boolean
  isReplacement: boolean
  condition:    Condition|null  // parsed 若...時 clause
  actions:      Action[]
}
```

### Action Types (`effectActions.js`)

| Type | Params | Behaviour |
|------|--------|-----------|
| DRAW | count | Draw N cards |
| KO | count, filter | KO up to N matching characters; human picks target (EffectModal) |
| REST | filter | Rest up to N matching cards; human picks target |
| POWER_MOD | delta, until, filter | ±N power for 'turn'/'battle'; `continuous` handled in calcPower |
| DEPLOY | count, filter | Deploy matching card from hand for free; human picks |
| DISCARD | count, filter | Discard N matching cards; human picks |
| SEARCH | look, take, filter | Reveal top N, take up to N matching; human picks |
| SELF_DEPLOY | — | Deploy this card from life area (Trigger only) |
| RETURN_HAND | filter | Return field card to hand |
| ADD_TO_HAND | filter | Add cards to hand |

### Interactive Effect Flow

```
effect fires → human must choose target
  → state.pendingEffect = { owner, sourceCard, action, continuation, choices }
  → EffectModal shown (EffectModal.jsx)
  → human picks → RESOLVE_EFFECT_CHOICE dispatched
  → choice applied → continuation actions executed
  → (may set another pendingEffect for multi-step choices)
```

The AI auto-resolves all choices greedily (highest-power target for KO; highest-cost card for deploy) without going through `pendingEffect`.

### Continuous Power Effects

Passive power bonuses (e.g. +3000 during opponent's turn with matching leader trait) are **not stored in powerMods**. They are computed dynamically in `calcPower` via `evaluateContinuousPower()` in `effects.js`, which re-evaluates clause conditions against the current game state on every power check.

### Power Calculation

```js
calcPower(fieldCard, activePlayer, owner, state?)
  = card.power
  + (activePlayer === owner ? attachedDon × 1000 : 0)
  + sum(playerState.powerMods where target matches)
  + evaluateContinuousPower(fieldCard, activePlayer, owner, state)
```

---

## UI Components (`components/`)

| Component | Role |
|-----------|------|
| `PracticeView.jsx` | Root; owns `useReducer`; drives AI via `useEffect` |
| `PlayerField.jsx` | Renders leader, character area, DON!! area, stage, trash for one player |
| `HandArea.jsx` | Scrollable hand strip |
| `PhaseBar.jsx` | Phase indicator + Skip Block / Skip Counter / End Turn buttons |
| `BattleOverlay.jsx` | Shows atkPower vs defPower during battle |
| `TriggerModal.jsx` | Activate / Add to Hand choice when a Trigger life card is revealed |
| `EffectModal.jsx` | Card picker for interactive effect choices (KO, REST, DEPLOY, DISCARD, SEARCH) |
| `ActionMenu.jsx` | Context menu for selected hand cards (Deploy, Activate Event, Counter) |
| `TrashModal.jsx` | View trash pile |
| `GameLog.jsx` | Collapsible action log |

---

## Not Yet Implemented

- **Replacement effects** (`替換成` / `即將`): intercept "about to leave" events (e.g. OP15-003 避免 KO by discarding instead)
- **ATTACH_DON effects**: activated effects that move DON!! between cards
- **ADD_TO_LIFE**: effects that place cards into the life area
- **Multi-branch effects** (`下列其中一項`): choose one of N sub-effects
- **Opponent-turn activated effects**: 【啟動主要】 usable on opponent's turn

Before implementing any of the above, query the rules wiki at `/Users/rexchan/opc-rules-vault/opc rules vault/wiki/concepts/` for timing rules and edge cases.
