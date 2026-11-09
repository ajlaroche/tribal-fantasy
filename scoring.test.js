// Run with: node scoring.test.js
const assert = require('node:assert/strict');
const { scoreEpisode, winnerPoints, standings } = require('./scoring.js');

const scoring = { boot: 5, immunity: 3, idol: 2, safe: 1, winner: 15, winnerChangePenalty: 1, winnerMin: 5 };
const castaways = [
  { id: 1, name: 'Ari', tribe: 'Sela', status: 'out' },
  { id: 2, name: 'Bo', tribe: 'Sela', status: 'in' },
  { id: 3, name: 'Cy', tribe: 'Lumo', status: 'winner' },
];
const episodes = [
  { number: 7, scored: true, results: { votedOut: [1], immunity: ['t:Lumo'], idolPlayed: false } },
  { number: 8, scored: true, results: { votedOut: [2], immunity: ['c:3'], idolPlayed: true } },
  { number: 9, scored: false, results: null },
];

// Hand calculation, manager A:
//  ep7: boot Ari ✓ 5, immunity Lumo ✓ 3, idol no ✓ 2, safe Cy ✓ 1 = 11
//  ep8: boot Cy ✗ 0, immunity Cy ✓ 3, idol no ✗ 0, safe Bo ✗ (Bo out) 0 = 3
//  winner Cy with 2 changes = 15 - 2 = 13   → total 27, 5/8 correct
const picks = [
  { manager_id: 'A', episode: 7, boot: 1, immunity: 't:Lumo', idol: false, safe: 3 },
  { manager_id: 'A', episode: 8, boot: 3, immunity: 'c:3', idol: false, safe: 2 },
  { manager_id: 'B', episode: 7, boot: 2, immunity: 't:Sela', idol: true, safe: 1 },
];
const winnerPicks = [
  { manager_id: 'A', castaway_id: 3, changes: 2 },
  { manager_id: 'B', castaway_id: 2, changes: 0 },
];

assert.equal(scoreEpisode(picks[0], episodes[0], scoring).total, 11);
assert.equal(scoreEpisode(picks[1], episodes[1], scoring).total, 3);
assert.equal(scoreEpisode(picks[0], episodes[2], scoring), null, 'unscored episode → null');
assert.equal(scoreEpisode(undefined, episodes[0], scoring).total, 0, 'no pick → 0');

assert.equal(winnerPoints(winnerPicks[0], castaways, scoring), 13);
assert.equal(winnerPoints({ castaway_id: 3, changes: 40 }, castaways, scoring), 5, 'floored at winnerMin');
assert.equal(winnerPoints(winnerPicks[1], castaways, scoring), 0);

const table = standings({
  managers: [{ id: 'A', name: 'Antony' }, { id: 'B', name: 'Bea' }],
  picks, episodes, castaways, winnerPicks, scoring,
});
assert.equal(table[0].name, 'Antony');
assert.equal(table[0].total, 27);
assert.equal(table[0].correct, 5);
assert.equal(table[0].attempted, 8);
assert.equal(table[0].lastWeek, 3);
assert.equal(table[1].total, 0, 'Bea missed everything and skipped ep 8');
assert.equal(table[1].rank, 2);

console.log('scoring tests passed');
