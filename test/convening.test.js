#!/usr/bin/env node
//
// lib/convening.js: reading a convening time and saying whether it has passed. The House Calendar and the
// Senate caucus schedule spell the time differently; both must read the same, and an unreadable time must
// never be reported as passed. No network.

const assert = require('assert');
const C = require('../lib/convening.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
// Eastern time. 5 October 2026 is EDT (UTC-4).
const at = (h, m = 0, day = 5) => new Date(Date.UTC(2026, 9, day, h + 4, m));

ok('the House and Senate spellings read the same', () => {
  for (const [t, min] of [['9 A.M.', 540], ['10:30 A.M.', 630], ['12 NOON', 720], ['3:00pm', 900], ['4:30 p.m.', 990], ['12:00am', 0], ['12 P.M.', 720]]) {
    assert.strictEqual(C.minutes(t), min, t);
  }
});

ok('format gives the House form, and returns what it cannot read', () => {
  assert.strictEqual(C.format('3:00pm'), '3 P.M.');
  assert.strictEqual(C.format('10:30 a.m.'), '10:30 A.M.');
  assert.strictEqual(C.format('12 NOON'), '12 NOON');
  assert.strictEqual(C.format('12:00pm'), '12 NOON');
  assert.strictEqual(C.format('12:30pm'), '12:30 P.M.');
  assert.strictEqual(C.format('12:00am'), '12 A.M.');
  assert.strictEqual(C.format('sometime'), 'sometime');
  assert.strictEqual(C.format(null), '');
});

ok('isoDate reads the Senate schedule\'s date', () => {
  assert.strictEqual(C.isoDate('Monday, November 9, 2026'), '2026-11-09');
  assert.strictEqual(C.isoDate('Monday, October 5, 2026'), '2026-10-05');
  assert.strictEqual(C.isoDate('nonsense'), null);
});

ok('hasMet: before the hour, at it, and after it, on the day', () => {
  assert.strictEqual(C.hasMet('2026-10-05', '4:30 P.M.', at(11, 40)), false);
  assert.strictEqual(C.hasMet('2026-10-05', '4:30 P.M.', at(16, 30)), true);
  assert.strictEqual(C.hasMet('2026-10-05', '4:30 P.M.', at(16, 29)), false);
  assert.strictEqual(C.hasMet('2026-10-05', '12 NOON', at(23, 59)), true);
});

ok('hasMet: an earlier date has met, a later one has not', () => {
  assert.strictEqual(C.hasMet('2026-10-04', '11 P.M.', at(0, 1)), true);
  assert.strictEqual(C.hasMet('2026-10-06', '12:01 A.M.', at(23, 59)), false);
});

ok('hasMet: an unreadable time is never "met"', () => {
  assert.strictEqual(C.hasMet('2026-10-04', 'later', at(12)), false);
  assert.strictEqual(C.hasMet('2026-10-05', null, at(12)), false);
});

ok('the day rolls at Eastern midnight, not UTC', () => {
  // 02:00 UTC on the 6th is 10 p.m. Eastern on the 5th
  assert.strictEqual(C.today(new Date(Date.UTC(2026, 9, 6, 2, 0))), '2026-10-05');
});

console.log(`\n${n} passed`);
