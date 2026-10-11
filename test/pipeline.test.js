#!/usr/bin/env node
//
// lib/pipeline.js: where a bill is waiting, from its type and latest action. The wordings are the real latest actions found by scanning all 17,000 bills of the 119th Congress on
// 12 October 2026. No network.

const assert = require('assert');
const P = require('../lib/pipeline.js');
const SC = require('../lib/pipeline.js').classify;

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const c = (type, a) => SC({ type, a });

ok('reported by a committee and waiting for the floor: a House bill on the Union or House Calendar, with its calendar number', () => {
  assert.deepStrictEqual(c('HR', 'Placed on the Union Calendar, Calendar No. 739.'), { board: 'house', col: 'calendar', tag: null, cal: 739 });
  assert.deepStrictEqual(c('HJRES', 'Placed on the House Calendar, Calendar No. 12.'), { board: 'house', col: 'calendar', tag: null, cal: 12 });
  assert.strictEqual(c('S', 'Placed on the Union Calendar, Calendar No. 5.'), null, 'a Senate bill is never on the House\'s calendars');
});

ok('on the Senate\'s calendar: any bill, by its origin, with the number; "Read the second time" or "Received in the Senate" before it does not matter', () => {
  assert.deepStrictEqual(c('S', 'Placed on Senate Legislative Calendar under General Orders. Calendar No. 686.'), { board: 'senate', col: 'calendar', tag: 'senate-bill', cal: 686 });
  assert.deepStrictEqual(c('HR', 'Read the second time. Placed on Senate Legislative Calendar under General Orders. Calendar No. 455.'), { board: 'senate', col: 'calendar', tag: 'house-bill', cal: 455 });
  assert.deepStrictEqual(c('HR', 'Received in the Senate. Read twice. Placed on Senate Legislative Calendar under General Orders. Calendar No. 12.'), { board: 'senate', col: 'calendar', tag: 'house-bill', cal: 12 });
  assert.deepStrictEqual(c('SJRES', 'Placed on Senate Legislative Calendar under General Orders. Calendar No. 9.').board, 'senate');
});

ok('from the House: received and not acted on, in the Senate, and Senate bills the House amended', () => {
  assert.deepStrictEqual(c('HR', 'Received in the Senate and Read twice and referred to the Committee on Homeland Security and Governmental Affairs.'), { board: 'senate', col: 'from', tag: 'house-bill', cal: null });
  assert.deepStrictEqual(c('HR', 'Received in the Senate.'), { board: 'senate', col: 'from', tag: 'house-bill', cal: null });
  assert.deepStrictEqual(c('S', 'Passed House with an amendment.'), { board: 'senate', col: 'from', tag: 'amended', cal: null });
});

ok('from the Senate: Senate bills the House has received, and House bills the Senate passed with an amendment (the House has to concur)', () => {
  assert.deepStrictEqual(c('S', 'Referred to the House Committee on Natural Resources.'), { board: 'house', col: 'from', tag: 'senate-bill', cal: null });
  assert.deepStrictEqual(c('S', 'Received in the House.'), { board: 'house', col: 'from', tag: 'senate-bill', cal: null });
  assert.deepStrictEqual(c('S', 'Held at the desk.'), { board: 'house', col: 'from', tag: 'senate-bill', cal: null }, 'where a Senate-passed bill sits in the House: 163 of them');
  assert.deepStrictEqual(c('SJRES', 'Held at the desk.').board, 'house');
  assert.strictEqual(c('HR', 'Held at the desk.'), null, 'a House bill held at the desk is the Senate\'s, and is not read');
  assert.deepStrictEqual(c('HR', 'Message on Senate action sent to the House.'), { board: 'house', col: 'from', tag: 'amended', cal: null });
  assert.deepStrictEqual(c('HR', 'Passed Senate with an amendment by Unanimous Consent. (consideration: CR S5297-5)'), { board: 'house', col: 'from', tag: 'amended', cal: null });
  assert.deepStrictEqual(c('HR', 'Passed Senate with an amendment and an amendment to the Title by Unanimous Consent.').tag, 'amended');
});

ok('everything else is nowhere: a bill still in its first chamber, a motion, a vote, a resolution type, no action', () => {
  for (const [t, a] of [['HR', 'Referred to the House Committee on Energy and Commerce.'], ['S', 'Read twice and referred to the Committee on Finance.'], ['S', 'Considered by Senate (Message from the House considered).'],
    ['S', 'Motion to proceed to consideration of the House message to accompany S. 1318 rejected in Senate by Yea-Nay Vote.'], ['HRES', 'Placed on the Union Calendar, Calendar No. 3.'], ['HR', ''], ['HR', null]]) assert.strictEqual(c(t, a), null, `${t}: ${a}`);
  assert.strictEqual(SC(null), null);
});

console.log(`\n${n} passed`);
