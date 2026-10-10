#!/usr/bin/env node
//
// lib/house-wrapup.js: when the House met and adjourned, from the Clerk's floor entries. The entries are verbatim from its feed (9 October 2026, a pro
// forma day, and 3 September); no network.

const assert = require('assert');
const W = require('../lib/house-wrapup.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const adjourn = { description: 'The Speaker announced that the House do now adjourn pursuant to clause 13 of Rule I. The next meeting is scheduled for 1:30 p.m. on October 13, 2026.', pubDate: '2026-10-09T16:32:57.000Z' };
const convene = { description: 'The House convened, starting a new legislative day.', pubDate: '2026-10-09T16:30:00.000Z' };
const pledge = { description: 'PLEDGE OF ALLEGIANCE - The Chair led the House in reciting the Pledge of Allegiance to the Flag.', pubDate: '2026-10-09T16:32:02.000Z' };

ok('the House convened is the entry that says so, and the adjournment the one that says that', () => {
  const r = W.summarize({ items: [adjourn, pledge, convene] });
  assert.strictEqual(r.convened.at, Date.parse('2026-10-09T16:30:00.000Z'));
  assert.strictEqual(r.convened.entry, convene);
  assert.strictEqual(r.adjourned.at, Date.parse('2026-10-09T16:32:57.000Z'));
  assert.strictEqual(r.adjourned.entry, adjourn);
});

ok('the next meeting is the Clerk\'s own words, read through the full stops in "p.m.", not a date it builds', () => {
  assert.strictEqual(W.summarize({ items: [adjourn] }).adjourned.next, '1:30 p.m. on October 13, 2026');
});

ok('an adjournment with no next-meeting sentence still says when it adjourned, and nothing is made up', () => {
  const r = W.summarize({ items: [{ description: 'The House adjourned.', pubDate: '2026-09-03T20:00:00.000Z' }] });
  assert.ok(r.adjourned);
  assert.strictEqual(r.adjourned.next, null);
});

ok('a day that has not ended has no adjournment, and one with no convening entry has no convened time', () => {
  const r = W.summarize({ items: [pledge, convene] });
  assert.strictEqual(r.adjourned, null);
  assert.strictEqual(W.summarize({ items: [adjourn, pledge] }).convened, null);
  assert.deepStrictEqual(W.summarize({ items: [] }), { convened: null, adjourned: null });
  assert.deepStrictEqual(W.summarize({}), { convened: null, adjourned: null });
});

ok('with two convenings in a day the first is when it met', () => {
  const second = { description: 'The House convened, returning from a recess.', pubDate: '2026-10-09T20:00:00.000Z' };
  assert.strictEqual(W.summarize({ items: [second, convene] }).convened.at, Date.parse('2026-10-09T16:30:00.000Z'));
});

console.log(`\n${n} passed`);
