#!/usr/bin/env node
// lib/segmented.js: a repeated press means nothing for a sort and means "back to All" for a filter (other than All itself).
const assert = require('assert');
const S = require('../lib/segmented.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('a sort: another option is taken, the same one again stays, however often', () => {
  assert.strictEqual(S.next('sort', 'close', 'new'), 'new');
  let v = 'new';
  for (let i = 0; i < 3; i++) v = S.next('sort', v, 'new');
  assert.strictEqual(v, 'new');
});
ok('a filter: another option is taken, the same one again goes back to All, All stays All', () => {
  assert.strictEqual(S.next('filter', 'all', 'D'), 'D');
  assert.strictEqual(S.next('filter', 'D', 'R'), 'R');
  assert.strictEqual(S.next('filter', 'D', 'D'), 'all');
  assert.strictEqual(S.next('filter', 'all', 'all'), 'all');
});
ok('the "All" value can be anything (an empty string in the signers list)', () => {
  assert.strictEqual(S.next('filter', 'D', 'D', ''), '');
  assert.strictEqual(S.next('filter', '', '', ''), '');
  assert.strictEqual(S.next('filter', '', 'R', ''), 'R');
});
console.log(`\n${n} passed`);
