# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

# Project Overview

A One Piece TCG database web app in Traditional Chinese. Features: meta deck browser, marketplace (price overlay), card search, PNG export, single-player practice simulator, and online PvP.

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

All Python scripts use `.venv` (Python 3.14). Run from project root:

```bash
source .venv/bin/activate

# Meta decks — onepiecetopdecks.com
python pipeline/collect/deck_scraper.py
python pipeline/transform/deck_normaliser.py   # maps informal leader names to card IDs
python pipeline/transform/deck_autobuilder.py  # → src/data/deck_final.json

# Meta decks — gumgum.gg
python pipeline/collect/deck_scraper_gg.py     # → pipeline/data/deck_raw_gg.db
python pipeline/transform/deck_gg_autobuilder.py  # → src/data/deck_gg_final.json

# Prices
python pipeline/collect/price_scraper.py       # → pipeline/data/price_raw.json
python pipeline/transform/price_transformer.py # → src/data/price_final.json

# Q&A
node pipeline/collect/qanda_scraper.js         # zh; move output → src/data/master_qa.json
node pipeline/collect/qanda_scraper_en.js      # en; move output → src/data/master_qa_en.json
```

### Dev Scripts (`scripts/`)

```bash
node scripts/audit-effects.js      # audit effect parsing coverage across card DB
node scripts/simulate-deck.js      # headless deck simulation (opening hand stats)
node scripts/merge-en.js           # merge English card data into local DB
```

### Card Database (new set release)

```bash
vega pull all                     # fetch new pack JSON from Bandai API
# move JSON to opc-uploader/data
cd opc-uploader && node upload.js # push to Firestore
node pipeline/collect/images_to_cloudinary.js  # upload card images to Cloudinary
```

---

# Architecture

## Frontend (`src/`)

`App.js` is the central god component — owns all global state and routes to view components:

| Component | Purpose |
|-----------|---------|
| `DeckView` | Meta deck browser; `LeaderBanner`, `CardWrapper`, `QuickController`, `PlayCurve`, `Charts` |
| `MarketplaceView` | Card art grid with price ribbons; PNG export via `html2canvas` |
| `SearchView` | Keyword/attribute search across full card DB |
| `ImportView` | Paste-in decklist parser |
| `PracticeView` | Single-player simulator (human vs greedy AI) |
| `OnlinePvpLobby` | Room creation/join via game code |
| `PvpGameContainer` | Real-time 1v1 via Firestore + `usePvpGame` hook |

Card data is fetched at runtime from **Firestore** (anonymous auth). Card images are served from **Cloudinary** (`getSafeImageUrl` in `src/utils/cardHelpers.js`).

**i18n:** Traditional Chinese (`zh`) default; English (`en`) supported via `react-i18next` (`src/i18n/`).

**Rotation rules** (`src/data/rotation.js`): `BANNED_LIST`, `RESTRICTED_PAIRS`, `BLOCK_1_EXCEPTIONS` — consumed by `App.js` to filter illegal cards.

**Card types index** (`src/data/sorted_types.json` / `sorted_types_en.json`): precomputed type lists for filter UI.

## Card ID Format

- Standard: `OP01-001`, `ST01-001`, `EB01-001`, `PRB01-001`
- Parallel art: `OP01-001_p1` · Reprint: `OP01-001_r`
- Pack IDs by region: `zh = 554xxx`, `en = 556xxx`, `ja = 550xxx`

---

# Battle Mode (Practice Simulator)

**Entry point:** `src/components/practice/PracticeView.jsx`  
**Rules reference:** `/Users/rexchan/opc-rules-vault/opc rules vault/wiki/concepts/`

Single-player practice: human vs greedy AI (mirrors human's deck, independently shuffled). All state is managed with `useReducer` — transitions are pure functions in engine files.

## Engine Files (`src/components/practice/engine/`)

| File | Role |
|------|------|
| `constants.js` | PHASE, BATTLE_STEP, PLAYER enums; DON_PER_TURN, MAX_CHARACTERS |
| `effectParser.js` | Parses Traditional Chinese card effect text into clause objects |
| `effectActions.js` | Pure state mutations for all action types; interactive choices set `pendingEffect` |
| `effects.js` | Timing resolvers (on-play, on-attack, on-block, trigger, event, end-of-turn); continuous power |
| `gameState.js` | Phase/battle state transitions; central `gameReducer` |
| `aiPlayer.js` | Greedy AI: plays highest-cost affordable characters, attaches DON!!, attacks, ends turn |

## Practice UI Components (`src/components/practice/components/`)

| Component | Role |
|-----------|------|
| `PracticeView.jsx` | Root; owns `useReducer`; drives AI via `useEffect` |
| `PlayerField.jsx` | Leader + character area + stage + trash for one player |
| `HandArea.jsx` | Scrollable hand strip |
| `DonArea.jsx` | DON!! cost area visualization |
| `DonReturnBar.jsx` | UI for paying DON!! return costs |
| `PhaseBar.jsx` | Phase indicator + Skip Block / Skip Counter / End Turn |
| `BattleOverlay.jsx` | atkPower vs defPower during battle |
| `AttackArrow.jsx` | Animated arrow from attacker to target |
| `TriggerModal.jsx` | Activate / Add to Hand when Trigger life card revealed |
| `EffectModal.jsx` | Card picker for KO / REST / DEPLOY / DISCARD / SEARCH |
| `ActionMenu.jsx` | Context menu for hand cards (Deploy, Event, Counter) |
| `MulliganScreen.jsx` | Opening hand mulligan UI |
| `PreGameAbilityScreen.jsx` | Pre-game ability selection (stage placement, etc.) |
| `AiDeckPicker.jsx` | Pick AI opponent deck before game starts |
| `CardDetailOverlay.jsx` | Tap/click to view full card detail |
| `CardFlashOverlay.jsx` | Flash animation when card is played/triggered |
| `CardPreview.jsx` | Hover preview for hand/field cards |
| `DraggablePanel.jsx` | Draggable floating panel wrapper |
| `NewWindowPortal.jsx` | Renders a React subtree into a new browser window |
| `StateSimulator.jsx` | Dev-only panel for injecting game state mid-session |
| `TrashModal.jsx` | View trash pile |
| `GameLog.jsx` | Collapsible action log |

## Practice Hooks (`src/components/practice/hooks/`)

| Hook | Role |
|------|------|
| `useFlashQueue.js` | Queues card flash animations |
| `useDevToolsReducer.js` | Wraps `useReducer` with dev logging |
| `usePvpGame.js` | Shared game logic for PvP (used by `PvpGameContainer`) |

## Turn Structure

```
REFRESH  → unrest all, return attached DON!!, clear effectUsed + turn powerMods
DRAW     → draw 1 (skipped for first player turn 1)
DON!!    → gain 2 DON!! (1 on turn 1 for first player)
MAIN     → play cards, attach DON!!, declare attacks (repeatable)
END TURN → fire 【我方回合結束時】 effects, clear justDeployed, switch active player
```

Battle sequence (within MAIN): DECLARE_ATTACK → BLOCK → COUNTER → DAMAGE → clear battle powerMods.

## Effect System

`effectParser.js` splits `<br>`-delimited text into **Clause** objects with: `timings`, `continuous`, `passive`, `donGate`, `donReturn`, `oncePerTurn`, `condition`, `actions`.

Action types: `DRAW`, `KO`, `REST`, `POWER_MOD`, `DEPLOY`, `DISCARD`, `SEARCH`, `SELF_DEPLOY`, `RETURN_HAND`, `ADD_TO_HAND`.

Interactive effects set `pendingEffect` → `EffectModal` shown → `RESOLVE_EFFECT_CHOICE` dispatched. AI auto-resolves greedily.

Continuous power bonuses (e.g. +3000 during opponent's turn) are computed dynamically in `calcPower` via `evaluateContinuousPower()` — not stored in `powerMods`.

`src/utils/cardRanker.js` scores cards by effect quality (used by DeckView tier display).

---

# Online PvP (`src/components/pvp/`)

| File | Role |
|------|------|
| `OnlinePvpLobby.jsx` | Create/join room by game code; deck submission |
| `PvpGameContainer.jsx` | Renders shared game UI for real-time 1v1 |
| `WaitingBanner.jsx` | "Waiting for opponent" splash |
| `pvpHelpers.js` | Firestore room helpers: `createRoomDoc`, `joinRoomDoc`, `submitDeck`, `getRoomRef` |

State is persisted in `sessionStorage` (`pvpGameId`, `pvpMyRole`) so page refresh rejoins the same game.

---

# Not Yet Implemented

- **Replacement effects** (`替換成` / `即將`): intercept "about to leave" events
- **ATTACH_DON effects**: activated effects moving DON!! between cards
- **ADD_TO_LIFE**: place cards into life area
- **Multi-branch effects** (`下列其中一項`): choose one of N sub-effects
- **Opponent-turn activated effects**: 【啟動主要】 on opponent's turn

Before implementing any of the above, query the rules wiki at `/Users/rexchan/opc-rules-vault/opc rules vault/wiki/concepts/`.
