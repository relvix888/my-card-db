import { fireDonReturnEffects } from './effectActions';
import { PLAYER } from './constants';

// Regression test: 咚‼卡被放回時 must fire for Character-owned effects (e.g. ST34-001),
// not just Leader-owned ones. A prior implementation (resolveOnDonReturnTrigger in
// effects.js) only checked state[owner].leader.card, silently skipping any Character
// on the field with this timing.
test('fireDonReturnEffects fires a Character-owned 咚‼卡被放回時 trigger', () => {
  const st34001 = {
    id: 'ST34-001',
    effect: '【我方回合中】【每回合1次】自己場上的咚‼卡被放回咚‼卡組時，若自己的領航卡擁有《BIG MOM海賊團》特徵時，從咚‼卡組追加最多2張休息狀態的咚‼卡。',
  };
  const leader = { card: { id: 'DUMMY-LEADER', effect: '', types: ['BIG MOM海賊團'] } };

  const state = {
    activePlayer: PLAYER.HOST,
    [PLAYER.HOST]: {
      leader,
      characterArea: [{ card: st34001 }],
      effectUsed: {},
      costArea: [],
      donDeck: [{ state: 'active' }, { state: 'active' }],
    },
  };

  const result = fireDonReturnEffects(state, PLAYER.HOST, 1);
  expect(result[PLAYER.HOST].effectUsed['ST34-001_咚‼卡被放回時']).toBe(true);
  expect(result[PLAYER.HOST].costArea.length).toBe(2);
});
