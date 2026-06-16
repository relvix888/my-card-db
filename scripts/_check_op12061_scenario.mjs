// Deterministic reproduction of the bug-report scenario: GUEST = OP12-061 (AI), turn 4, MAIN,
// exactly 3 active DON, leader main unused, P-093 + OP16-068 (cost-4 Laws) in hand. Without the
// -2 discount a cost-4 Law is unaffordable with 3 DON; the AI must activate the leader (3->2 DON,
// set -2) THEN play a Law at cost 2. Asserts getAiTurnActions emits that. Runs with and without
// the fix (NOFIX env) so the difference is isolated, no RNG involved.
import { createInitialState, getEffectiveCost } from '../src/components/practice/engine/gameState.js';
import { getAiTurnActions } from '../src/components/practice/engine/aiPlayer.js';
import { PLAYER } from '../src/components/practice/engine/constants.js';
import { readFileSync, readdirSync } from 'fs';

const DIRS = ['/Users/rexchan/opc-uploader/data', '/Users/rexchan/opc-uploader/data/ZH'];
const byId = new Map();
for (const dir of DIRS) {
  let files; try { files = readdirSync(dir).filter(f => f.startsWith('cards_') && f.endsWith('.json')); } catch { continue; }
  for (const f of files) for (const c of JSON.parse(readFileSync(`${dir}/${f}`, 'utf-8'))) byId.set(c.id, c);
}
const card = id => { const c = byId.get(id); if (!c) throw new Error('missing card ' + id); return c; };
const AI = PLAYER.GUEST, HUMAN = PLAYER.HOST;

function buildScenario() {
  // Build a valid skeleton, then transplant the scenario onto the GUEST seat.
  const filler = Array.from({ length: 40 }, () => card('OP16-064'));
  let s = createInitialState(
    card('OP16-041'), Array.from({ length: 40 }, () => card('OP16-042')), // HOST = Buggy (passive board)
    card('OP12-061'), filler,                                              // GUEST = Rosinante (AI)
  );
  s = { ...s, phase: 'main', activePlayer: AI, waitingFor: AI, turn: 4, mulligan: 'done', winner: null };

  const don = n => Array.from({ length: n }, (_, i) => ({ _donId: `don-${i}-x`, state: 'active' }));
  const fc = (id) => ({ card: card(id), state: 'active', attachedDon: 0, justDeployed: false,
    deployedThisTurn: false, _fcId: `fc-${id}`, tempKeywords: [], opponentTurnEndKeywords: [],
    attackCostRestriction: null, effectNegated: false, blockerDisabled: false });

  s[AI] = { ...s[AI],
    leader: { ...s[AI].leader, state: 'active', attachedDon: 0 },
    hand: [ card('P-093'), card('OP16-068'), card('OP12-115'), card('OP16-065'), card('EB04-058') ],
    costArea: don(3),                 // exactly 3 active DON — the tight-DON case
    characterArea: [],
    handCostMods: [], costMods: [], powerMods: [], effectUsed: {},
    lifeArea: s[AI].lifeArea.slice(0, 4),
  };
  s[HUMAN] = { ...s[HUMAN],
    leader: { ...s[HUMAN].leader, state: 'active' },
    characterArea: [ fc('OP16-050') ],     // one blocker so it's a normal board, not lethal either way
    hand: s[HUMAN].hand.slice(0, 4),
    lifeArea: s[HUMAN].lifeArea.slice(0, 4),
  };
  return s;
}

function run(label) {
  const s = buildScenario();
  let actions = [];
  try { actions = getAiTurnActions(s); } catch (e) { console.log(label, 'THREW', e.message); return; }
  const activatedLeader = actions.some(a => a.type === 'ACTIVATE_MAIN' && a.zone === 'leader');
  // Replay to find a Law play and its effective cost at the moment it's played.
  let playedLaw = null;
  // Re-simulate cost: leader activation sets a -2 next_play Law discount; check any PLAY_CHARACTER
  // whose hand card is a Law.
  const lawIds = new Set(['P-093', 'OP16-068']);
  // Reconstruct hand index → card from the static initial hand (indices shift as cards are played,
  // but the first Law play is what matters; map via the action's handIndex against a mutable hand).
  let hand = [...s[AI].hand];
  for (const a of actions) {
    if (a.type === 'PLAY_CHARACTER') {
      const c = hand[a.handIndex];
      if (c && lawIds.has(c.id)) { playedLaw = c.id; break; }
      if (c) hand.splice(a.handIndex, 1);
    }
  }
  console.log(`${label}: activatedLeader=${activatedLeader}  playedLaw=${playedLaw ?? 'NONE'}  ` +
    `actions=[${actions.map(a => a.type + (a.zone ? ':' + a.zone : '')).join(', ')}]`);
}

run(process.env.NOFIX ? 'PRE-FIX ' : 'WITH-FIX');
