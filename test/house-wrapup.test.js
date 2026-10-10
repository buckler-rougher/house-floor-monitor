#!/usr/bin/env node
//
// lib/house-wrapup.js: what the House did on a day, from the Clerk's entries and the roll log. The Clerk's adjournment entries are verbatim from
// its feed (4 and 5 October 2026 and 3 September, the shapes seen); no network.

const assert = require('assert');
const W = require('../lib/house-wrapup.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const etDay = (d) => d.toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const day = '09/03/2026';
const adjourn = { description: 'The Speaker announced that the House do now adjourn pursuant to clause 13 of Rule I. The next meeting is scheduled for 10:00 a.m. on September 4, 2026.', pubDate: '2026-09-03T17:05:53.000Z' };
const other = { description: 'The Chair laid before the House a communication from the Clerk.', pubDate: '2026-09-03T14:30:00.000Z' };
const log = (roll, at) => ({ roll: String(roll), question: 'H R 1 - On Passage', totals: { yeas: 220, nays: 200 }, updatedAt: at });

ok('the adjournment is the entry that says so, and the next meeting is the Clerk\'s own words, not a date it builds', () => {
  const r = W.summarize({ items: [adjourn, other], rollLog: [], day, etDay });
  assert.strictEqual(r.adjourned.at, Date.parse('2026-09-03T17:05:53.000Z'));
  assert.strictEqual(r.adjourned.next, '10:00 a.m. on September 4, 2026');
});

ok('an adjournment with no next-meeting sentence still says when it adjourned, and nothing is made up for the next meeting', () => {
  const r = W.summarize({ items: [{ description: 'The House adjourned.', pubDate: '2026-09-03T20:00:00.000Z' }], rollLog: [], day, etDay });
  assert.ok(r.adjourned);
  assert.strictEqual(r.adjourned.next, null);
});

ok('no adjournment entry gives none', () => {
  assert.strictEqual(W.summarize({ items: [other], rollLog: [], day, etDay }).adjourned, null);
  assert.strictEqual(W.summarize({ items: [], rollLog: [], day, etDay }).adjourned, null);
});

ok('only the votes logged on that day, in roll order (an evening vote at 10 p.m. Eastern is still that day)', () => {
  const r = W.summarize({
    items: [adjourn],
    rollLog: [log(290, '2026-09-04T02:00:00.000Z'), log(287, '2026-09-03T16:00:00.000Z'), log(280, '2026-09-02T16:00:00.000Z'), log(288, '2026-09-03T18:00:00.000Z')],
    day, etDay,
  });
  assert.deepStrictEqual(r.votes.map((v) => v.roll), ['287', '288', '290']);
});

ok('an entry with no time is not placed on any day', () => {
  assert.deepStrictEqual(W.summarize({ items: [], rollLog: [{ roll: '1' }, null], day, etDay }).votes, []);
});

console.log(`\n${n} passed`);
