#!/usr/bin/env node
//
// Contract test for lib/senate-modes.js -- the Senate's prayer and pledge modes, read off
// rolling captions. The wordings are unconfirmed against a real caption (see the lib), so
// what is pinned here is the behaviour around them: start, hold, end, ceiling, and the
// cooldown that stops a phrase still in the caption window from restarting a finished mode.

const assert = require('assert');
const M = require('../lib/senate-modes.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const S = 1000;

ok('nothing heard is no mode', () => {
  assert.strictEqual(M.current(M.empty(), 0), null);
  assert.strictEqual(M.current(M.feed(M.empty(), 'THE SENATOR FROM OHIO IS RECOGNIZED.', 0), 0), null);
});

ok('the prayer starts on the chair, holds, and ends on amen', () => {
  let s = M.feed(M.empty(), 'THE CHAPLAIN, DR. SOMEONE, OFFERED THE FOLLOWING PRAYER:', 0);
  assert.strictEqual(M.current(s, 1 * S), 'prayer');
  s = M.feed(s, 'LET US PRAY. ETERNAL GOD ...', 5 * S);
  assert.strictEqual(M.current(s, 60 * S), 'prayer');
  s = M.feed(s, 'IN YOUR NAME WE PRAY. AMEN.', 120 * S);
  assert.strictEqual(M.current(s, 125 * S), 'prayer', 'held for a moment after amen');
  assert.strictEqual(M.current(s, 131 * S), null);
});

ok('the pledge text is the pledge', () => {
  let s = M.feed(M.empty(), 'I PLEDGE ALLEGIANCE TO THE FLAG OF THE UNITED STATES', 0);
  assert.strictEqual(M.current(s, 2 * S), 'pledge');
  s = M.feed(s, 'ONE NATION UNDER GOD, INDIVISIBLE, WITH LIBERTY AND JUSTICE FOR ALL.', 20 * S);
  assert.strictEqual(M.current(s, 25 * S), 'pledge');
  assert.strictEqual(M.current(s, 31 * S), null);
});

ok('the pledge takes over from a prayer that has not ended', () => {
  let s = M.feed(M.empty(), 'LET US PRAY.', 0);
  s = M.feed(s, 'I PLEDGE ALLEGIANCE TO THE FLAG', 60 * S);
  assert.strictEqual(M.current(s, 61 * S), 'pledge');
});

ok('a missed closing phrase cannot strand the board', () => {
  const p = M.feed(M.empty(), 'LET US PRAY.', 0);
  assert.strictEqual(M.current(p, 6 * 60 * S - 1), 'prayer');
  assert.strictEqual(M.current(p, 6 * 60 * S), null);
  const g = M.feed(M.empty(), 'I PLEDGE ALLEGIANCE', 0);
  assert.strictEqual(M.current(g, 91 * S), null);
});

ok('the same words still rolling past do not restart a finished mode', () => {
  let s = M.feed(M.empty(), 'I PLEDGE ALLEGIANCE TO THE FLAG ... JUSTICE FOR ALL.', 0);
  assert.strictEqual(s.endedAt, 0, 'start and end in one cue: the end is read on the NEXT cue');
  s = M.feed(s, 'I PLEDGE ALLEGIANCE TO THE FLAG ... JUSTICE FOR ALL.', 1 * S);
  assert.strictEqual(M.current(s, 20 * S), null);
  s = M.settle(s, 20 * S);
  assert.strictEqual(s.mode, null);
  s = M.feed(s, 'I PLEDGE ALLEGIANCE TO THE FLAG ... JUSTICE FOR ALL.', 30 * S);
  assert.strictEqual(M.current(s, 31 * S), null, 'inside the cooldown');
  s = M.feed(s, 'I PLEDGE ALLEGIANCE TO THE FLAG', 10 * 60 * S);
  assert.strictEqual(M.current(s, 10 * 60 * S + 1), 'pledge', 'a real pledge the next day starts');
});

ok('amen in the middle of a speech is not a prayer ending', () => {
  const s = M.feed(M.empty(), 'AMEN, SAID THE SENATOR FROM TEXAS.', 0);
  assert.strictEqual(M.current(s, 1 * S), null);
  assert.strictEqual(s.endedAt, 0);
});

console.log(`\n${n} passed`);
