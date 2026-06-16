// Throwaway validation: drive OP12-061 as the GUEST(AI) seat (so aiPlayer.planMainPhase runs it)
// against a passive opponent, and count how often the AI activates the leader's -2 Law discount
// and then actually plays a Law at the reduced cost. Validates the planSafeMode/planSurvivalMode fix.
import {
  createInitialState, gameReducer, getEffectiveCost,
} from '../src/components/practice/engine/gameState.js';
import { getAiTurnActions } from '../src/components/practice/engine/aiPlayer.js';
import { PHASE, PLAYER, BATTLE_STEP } from '../src/components/practice/engine/constants.js';
import { readFileSync, readdirSync } from 'fs';

const DIRS = ['/Users/rexchan/opc-uploader/data', '/Users/rexchan/opc-uploader/data/ZH'];
function loadAllCards() {
  const byId = new Map();
  for (const dir of DIRS) {
    let files; try { files = readdirSync(dir).filter(f => f.startsWith('cards_') && f.endsWith('.json')); } catch { continue; }
    for (const f of files) for (const c of JSON.parse(readFileSync(`${dir}/${f}`, 'utf-8'))) byId.set(c.id, c);
  }
  return byId;
}
const cardById = loadAllCards();
const deckJson = JSON.parse(readFileSync('src/data/deck_final.json', 'utf-8'));
function buildDeck(entry) {
  const all = [];
  for (const e of entry.deck.split(',')) {
    const [n, id] = e.trim().split('x');
    const card = cardById.get(id?.trim());
    if (card) for (let i = 0; i < parseInt(n); i++) all.push(card);
  }
  return { leader: all.find(c => c.category === 'Leader'), cards: all.filter(c => c.category !== 'Leader') };
}
const test = buildDeck(deckJson['OP12-061']);
// passive opponent: any other valid deck
const oppEntry = Object.entries(deckJson).find(([id]) => id !== 'OP12-061' &&
  buildDeck(deckJson[id]).leader && buildDeck(deckJson[id]).cards.length >= 10)[1];
const opp = buildDeck(oppEntry);

const isLaw = c => (c?.enName === 'Trafalgar Law') || /羅/.test(c?.name ?? '');
const AI = PLAYER.GUEST, HUMAN = PLAYER.HOST;

let games = 0, lawPlays = 0, discountedLawPlays = 0, activations = 0, aiTurns = 0;
const discountedByTurn = {};

for (let g = 0; g < 8; g++) {
  // HOST = opponent (passive), GUEST = OP12-061 (AI under test)
  let state = createInitialState(opp.leader, opp.cards, test.leader, test.cards);
  state = gameReducer(state, { type: 'MULLIGAN_KEEP' });
  if (state.preGameAbility) state = gameReducer(state, { type: 'LEADER_PRE_GAME_STAGE', cardIndex: null });
  games++;
  let steps = 2000, stuck = 0, lastKey = '';
  let aiQueue = [];
  let leaderActivatedThisTurn = false;

  while (!state.winner && steps-- > 0) {
    const key = `${state.phase}|${state.activePlayer}|${state.turn}|${state.battle?.step ?? '-'}|${!!state.pendingEffect}|${!!state.pendingTrigger}|${!!state.pendingReplace}`;
    if (key === lastKey) { if (++stuck > 12) break; } else { stuck = 0; lastKey = key; }

    if (state.pendingEffect) {
      const ch = state.pendingEffect;
      const items = ch.items ?? ch.targets ?? ch.fieldTargets ?? [];
      const max = ch.maxSelect ?? ch.max ?? 1;
      const sel = Array.from({ length: Math.min(max, items.length) }, (_, i) => i);
      try { state = gameReducer(state, { type: 'RESOLVE_EFFECT_CHOICE', selectedIndices: sel, selectedZone: ch.zone ?? null }); }
      catch { try { state = gameReducer(state, { type: 'RESOLVE_EFFECT_CHOICE', selectedIndices: [] }); } catch { break; } }
      continue;
    }
    if (state.pendingReplace) { try { state = gameReducer(state, { type: 'RESOLVE_REPLACE', replaceIndex: 0 }); } catch { break; } continue; }
    if (state.pendingTrigger) { try { state = gameReducer(state, { type: 'RESOLVE_TRIGGER', activate: true }); } catch { break; } continue; }
    if (state.battle) {
      // passive: skip block/counter, resolve damage
      const step = state.battle.step;
      const act = step === BATTLE_STEP.BLOCK ? { type: 'SKIP_BLOCK' }
        : step === BATTLE_STEP.COUNTER ? { type: 'SKIP_COUNTER' }
        : { type: 'RESOLVE_DAMAGE' };
      try { state = gameReducer(state, act); } catch { break; }
      continue;
    }
    if (state.mulligan === 'pending') { state = gameReducer(state, { type: 'MULLIGAN_KEEP' }); continue; }
    if (state.phase === PHASE.REFRESH) { state = gameReducer(state, { type: 'REFRESH' }); leaderActivatedThisTurn = false; continue; }
    if (state.phase === PHASE.DRAW)    { state = gameReducer(state, { type: 'DRAW' }); continue; }
    if (state.phase === PHASE.DON)     { state = gameReducer(state, { type: 'DON_PHASE' }); continue; }
    if (state.phase === PHASE.MAIN) {
      if (state.activePlayer === AI) {
        if (!aiQueue.length) { aiTurns++; try { aiQueue.push(...getAiTurnActions(state)); } catch { aiQueue = [{ type: 'END_TURN' }]; } }
        if (!aiQueue.length) { state = gameReducer(state, { type: 'END_TURN' }); continue; }
        const action = aiQueue.shift();
        if (action.type === 'ACTIVATE_MAIN' && action.zone === 'leader') { activations++; leaderActivatedThisTurn = true; }
        if (action.type === 'PLAY_CHARACTER') {
          const card = state[AI].hand[action.handIndex];
          if (isLaw(card)) {
            lawPlays++;
            const baseCost = card.cost ?? 0;
            const effCost = getEffectiveCost(card, state[AI].handCostMods);
            if (effCost < baseCost) { discountedLawPlays++; discountedByTurn[state.turn] = (discountedByTurn[state.turn] ?? 0) + 1; }
          }
        }
        try { state = gameReducer(state, action); } catch { aiQueue = []; }
        if (action.type === 'END_TURN') aiQueue = [];
        continue;
      } else {
        // passive opponent: end turn immediately
        state = gameReducer(state, { type: 'END_TURN' });
        aiQueue = [];
        continue;
      }
    }
    break;
  }
}

console.log(JSON.stringify({ games, aiTurns, leaderActivations: activations, lawPlays, discountedLawPlays, discountedByTurn }, null, 2));
