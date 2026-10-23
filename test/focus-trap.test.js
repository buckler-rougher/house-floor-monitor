#!/usr/bin/env node
// lib/focus-trap.js `next`: which control a Tab press moves to inside a dialog.
const assert = require('assert');
const T = require('../lib/focus-trap.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const [a, b, c] = ['a', 'b', 'c'];
const out = 'outside';

ok('in the middle the browser carries on by itself', () => {
  assert.strictEqual(T.next([a, b, c], b, false), null);
  assert.strictEqual(T.next([a, b, c], b, true), null);
});
ok('Tab on the last control wraps to the first, Shift+Tab on the first wraps to the last', () => {
  assert.strictEqual(T.next([a, b, c], c, false), a);
  assert.strictEqual(T.next([a, b, c], a, true), c);
});
ok('focus that has strayed outside is pulled back in, to the end the direction heads for', () => {
  assert.strictEqual(T.next([a, b, c], out, false), a);
  assert.strictEqual(T.next([a, b, c], out, true), c);
});
ok('one control only: it wraps onto itself; no controls: nothing to do', () => {
  assert.strictEqual(T.next([a], a, false), a);
  assert.strictEqual(T.next([a], a, true), a);
  assert.strictEqual(T.next([], a, false), null);
  assert.strictEqual(T.next(null, a, false), null);
});
console.log(`\n${n} passed`);
