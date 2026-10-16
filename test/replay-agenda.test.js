#!/usr/bin/env node
// lib/replay-agenda.js on the Clerk's log and roll calls for 16 September 2026 (dev/fixtures/replay): each debate is a row that says WHAT (the measure and its official title),
// how it came to the floor, and how it came out, with the roll call that settled it even when the vote came hours later.
const assert = require('assert');
const A = require('../lib/replay-agenda.js');
const p = require('../dev/fixtures/replay/proceedings-20260916.json');
const r = require('../dev/fixtures/replay/rolls-20260916.json');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

// the Clerk's time for a roll is when it opened; the agenda is given when it closed, so any time after its debate will do
const rolls = (r.rolls || []).map((x) => { const m = /(\d+):(\d+) (AM|PM)/.exec(x.time); return { ...x, ms: Date.UTC(2026, 8, 16, (+m[1] % 12) + (m[3] === 'PM' ? 12 : 0) + 4, +m[2]) }; });
const rows = A.build(p.items, rolls);
const by = (re) => rows.find((x) => re.test(x.title));

ok('the day runs from the gavel to the adjournment, oldest first', () => {
  assert.strictEqual(rows[0].kind, 'gavel');
  assert.strictEqual(rows[rows.length - 1].kind, 'adjourn');
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].ms >= rows[i - 1].ms);
});

ok('a suspension debate: the bill, its official title, the length, and how it came to the floor and out', () => {
  const x = by(/^H\.R\. 1342/);
  assert.strictEqual(x.kind, 'debate');
  assert.ok(x.title.includes('To prohibit discrimination based on political affiliation in granting disaster assistance'));
  assert.ok(/^Forty minutes of debate/.test(x.detail) && /suspension of the rules/.test(x.detail));
  assert.strictEqual(x.outcome, 'Agreed to by voice vote');
});

ok('a debate whose vote came later carries that roll call', () => {
  const x = by(/^H\.R\. 9576/);
  assert.strictEqual(x.vote.roll, '309');
  assert.ok(/^Passed, 352–72 \(roll 309\)/.test(x.outcome));
  assert.ok(/One hour of debate/.test(x.detail) && /Under/.test(x.detail));
});

ok('a joint resolution is a measure, not a rule; a title goes to the measure named just before it', () => {
  const x = by(/^H\.J\. Res\. 213/);
  assert.ok(x && /congressional disapproval/.test(x.title));
  assert.strictEqual(x.vote.roll, '311');
  const senate = by(/^Senate amendments to H\.R\. 5334/);
  assert.ok(senate && !/Fraud Enforcement/.test(senate.title), 'H. Res. 1530 and H.R. 5334 are in one entry; the title in the next entry is not theirs');
});

ok('a debate that ended by voice vote says so; one settled by a roll call does not', () => {
  assert.strictEqual(by(/^H\.R\. 1342/).voice, true);
  assert.strictEqual(by(/^H\.R\. 9576/).voice, false);
});

ok('a notification of intent to offer a resolution is a speech; other capitalised headings are rows of their own', () => {
  const rs = A.build([{ timestamp: 1, description: 'The House convened, starting a new legislative day.' }, { timestamp: 2, description: 'NOTIFICATION OF INTENT TO OFFER RESOLUTION - Mr. Green (TX) gave notice of his intent to offer a resolution.' }, { timestamp: 3, description: 'MOMENT OF SILENCE - The House observed a moment of silence.' }], []);
  assert.deepStrictEqual(rs.map((x) => x.kind), ['gavel', 'speech', 'other']);
  assert.strictEqual(rs[1].title, 'Notification of intent to offer resolution');
  assert.strictEqual(rs[2].title, 'Moment of silence');
});

ok('a roll call no debate accounts for is a row of its own', () => {
  const x = rows.find((y) => y.kind === 'vote');
  assert.ok(x && x.vote && /9340/.test(x.title));
});

ok('every row can be found by its measure number however it is typed', () => {
  const x = by(/^H\.R\. 9497/);
  assert.ok(x.find.replace(/[^a-z0-9]+/g, '').includes('hr9497'));
});

ok('a morning-hour debate is a speech hour, with the hyphen the Clerk writes', () => {
  const rs = A.build([{ timestamp: 1, description: 'The House convened, starting a new legislative day.' }, { timestamp: 2, description: 'MORNING-HOUR DEBATE - The House proceeded with morning-hour debate.' }, { timestamp: 3, description: 'ONE-MINUTE SPEECHES - The House proceeded with one minute speeches.' }], []);
  assert.deepStrictEqual(rs.map((x) => x.kind), ['gavel', 'speech', 'speech']);
  assert.strictEqual(rs[1].title, 'Morning-hour debate');
});

console.log(`replay-agenda: ${n} passed`);
