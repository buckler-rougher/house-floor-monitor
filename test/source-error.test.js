const assert = require('assert');
const SE = require('../lib/source-error.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
ok('names the thing and the source', () => assert.strictEqual(SE.text('floor activity', 'senate'), "Could not load floor activity. The Senate's website did not respond. Check back shortly."));
ok('an unknown source leaves the middle sentence out', () => assert.strictEqual(SE.text('bills', 'nope'), 'Could not load bills. Check back shortly.'));
ok('no raw error words, no em dash, no "board"', () => { for (const k of Object.keys(SE.SOURCES)) { const t = SE.text('details', k); assert(!/fetch|HTTP|—|board/i.test(t), t); } });
console.log(`\n${n} passed`);
