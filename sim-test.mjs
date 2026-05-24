import { createInitialState, applyPlayCharacter, activeDonCount, calcPower, applyDeclareAttack } from './src/components/practice/engine/gameState.js';
import { getAiTurnActions } from './src/components/practice/engine/aiPlayer.js';
import { PLAYER, PHASE } from './src/components/practice/engine/constants.js';
import { readFileSync, readdirSync } from 'fs';

const allCards = readdirSync('/Users/rexchan/opc-uploader/data')
  .filter(f => f.startsWith('cards_') && f.endsWith('.json'))
  .flatMap(f => JSON.parse(readFileSync('/Users/rexchan/opc-uploader/data/'+f, 'utf-8')));

const op13002 = allCards.find(c => c.id === 'OP13-002');
const op13054 = allCards.find(c => c.id === 'OP13-054');
const humanLeader = allCards.find(c => c.id === 'OP13-003');
const filler = allCards.filter(c => c.category === 'Character' && (c.power ?? 0) >= 4000 && !c.id?.includes('_p')).slice(0, 50);

let state = createInitialState(humanLeader, filler, op13002, filler);

// Set up: AI has 5 active don, op13-054 as first hand card, turn not 1
const ai = state[PLAYER.AI];
const newAi = {
  ...ai,
  costArea: Array.from({length: 5}, (_, i) => ({ _donId: `d${i}`, state: 'active' })),
  hand: [op13054, ...ai.hand.filter(c => c.id !== op13054.id).slice(0, 4)],
};
state = { ...state, [PLAYER.AI]: newAi, phase: PHASE.MAIN, activePlayer: PLAYER.AI, turn: 3 };

console.log('=== SETUP ===');
console.log('AI life:', state[PLAYER.AI].lifeArea.length);
console.log('AI active don:', activeDonCount(state[PLAYER.AI].costArea));
console.log('Human leader:', humanLeader?.name, 'power:', humanLeader?.power, 'id:', humanLeader?.id);
console.log('State human leader:', state[PLAYER.HUMAN].leader.card.name, 'power:', state[PLAYER.HUMAN].leader.card.power);

// Get AI actions
const actions = getAiTurnActions(state);
console.log('\n=== AI ACTIONS ===');
actions.forEach((a, i) => console.log(`${i}: ${JSON.stringify(a)}`));

// Simulate playing op13-054 manually (with 3 life to trigger effect)
const ai2 = { ...state[PLAYER.AI], lifeArea: state[PLAYER.AI].lifeArea.slice(0, 3) };
const state2 = { ...state, [PLAYER.AI]: ai2 };
const afterPlay = applyPlayCharacter(state2, { handIndex: 0 });
console.log('\n=== AFTER PLAY op13-054 ===');
console.log('AI leader attachedDon:', afterPlay[PLAYER.AI].leader.attachedDon);
console.log('AI leader state:', afterPlay[PLAYER.AI].leader.state);
console.log('AI active don:', activeDonCount(afterPlay[PLAYER.AI].costArea));
console.log('AI chars:', afterPlay[PLAYER.AI].characterArea.map(fc => `${fc.card.id} jd=${fc.justDeployed} st=${fc.state}`));
console.log('AI leader atkPow:', calcPower(afterPlay[PLAYER.AI].leader, PLAYER.AI, PLAYER.AI, afterPlay));
console.log('Human leader defPow:', calcPower(afterPlay[PLAYER.HUMAN].leader, PLAYER.AI, PLAYER.HUMAN, afterPlay));
console.log('pendingEffect:', afterPlay.pendingEffect ? JSON.stringify(afterPlay.pendingEffect).slice(0, 100) : 'none');
console.log('pendingReplace:', afterPlay.pendingReplace ? 'set' : 'none');
console.log('battle:', afterPlay.battle ? 'set' : 'none');
