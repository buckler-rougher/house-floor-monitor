#!/usr/bin/env node
// lib/clamp-list.js `clampPx`: how tall the clip is (the first `keep` items whole and a slice of the next), or null when nothing needs clipping.
const assert = require('assert');
const C = require('../lib/clamp-list.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('keep items whole and show a slice of the next: the top of item `keep` plus the peek', () => {
  assert.strictEqual(C.clampPx([0, 170, 340, 510, 680], 3, 56, 900), 510 + 56);
  assert.strictEqual(C.clampPx([0, 170, 340], 1, 56, 900), 170 + 56);
});
ok('never more than the list is tall', () => {
  assert.strictEqual(C.clampPx([0, 40, 80], 1, 56, 90), 90);
});
ok('keep or fewer items: nothing to clip', () => {
  assert.strictEqual(C.clampPx([0, 170, 340], 3, 56, 500), null);
  assert.strictEqual(C.clampPx([], 3), null);
  assert.strictEqual(C.clampPx(null, 3), null);
});
console.log(`\n${n} passed`);
