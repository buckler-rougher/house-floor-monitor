const assert = require('assert');
const { compute } = require('../lib/live-title.js');
const base = 'Monitoring the House Floor';
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
ok('nothing known yet: the plain name', () => { assert.strictEqual(compute({ base, status: 'Loading...' }), base); assert.strictEqual(compute({ base }), base); });
ok('adjourned: the status, no dot', () => assert.strictEqual(compute({ base, classes: ['recess-mode'], status: 'House adjourned' }), 'House adjourned | ' + base));
ok('a mode with a label gets a dot and the label', () => assert.strictEqual(compute({ base, classes: ['debate-mode'], status: 'In debate' }), '\u25CF Debate | ' + base));
ok('a vote underway names the roll call', () => assert.strictEqual(compute({ base, classes: [], status: 'Voting', voteNo: '295' }), '\u25CF Vote underway: roll call 295 | ' + base));
ok('a vote panel with no number yet falls back to the status', () => assert.strictEqual(compute({ base, classes: [], status: 'House in session', voteNo: '--' }), 'House in session | ' + base));
ok('a mode class beats a stale vote number', () => assert.strictEqual(compute({ base, classes: ['prayer-mode'], voteNo: '295' }), '\u25CF Prayer | ' + base));
ok('the Senate calls', () => {
  const b = 'Monitoring the Senate Floor';
  assert.strictEqual(compute({ base: b, classes: ['senate-call-vote'] }), '\u25CF Roll call vote | ' + b);
  assert.strictEqual(compute({ base: b, classes: ['senate-call-quorum'] }), '\u25CF Quorum call | ' + b);
});
ok('the debug all-mode and unknown modes do not invent a label', () => assert.strictEqual(compute({ base, classes: ['all-mode', 'weird-mode'], status: 'House in session' }), 'House in session | ' + base));
ok('no em dash in any title', () => assert(!/\u2014/.test(compute({ base, classes: ['recess-mode'], status: 'House adjourned' }))));
console.log(`\n${n} passed`);
