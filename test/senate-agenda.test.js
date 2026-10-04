#!/usr/bin/env node
//
// Contract test for lib/senate-agenda.js -- reading a Democratic Caucus schedule post.
//
// WHY THIS EXISTS
// The posts are hand-written and the Worker's parser dropped things silently: a measure whose
// calendar number is followed by a stray " ," (H.R. 2347, H.R. 9340, S.J.Res. 197), a convening
// time in "stand adjourned" rather than "stands adjourned", and a title that ran across a line
// break and swallowed the next measure. test/senate-schedule-posts.json holds six posts
// verbatim from the feed (23 to 30 September and the pro forma post naming 9 November), the
// shapes the parser has had to survive. Do not tidy them. No network, no dependencies.

const assert = require('assert');
const A = require('../lib/senate-agenda.js');
const posts = require('./senate-schedule-posts.json');
const by = (re) => A.parse(posts.find((p) => re.test(p.title)).body);

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const key = (r) => r.measures.map((m) => `${m.calendarNo} ${m.measure}`);

ok('a stray comma after the calendar number does not lose the measure (pro forma post, H.R. 2347)', () => {
  const r = by(/Pro Forma/);
  assert.deepStrictEqual(key(r), ['453 H.R.2347']);
  assert.strictEqual(r.measures[0].title, 'Survivor Justice Tax Prevention Act');
});

ok('"stand adjourned until" gives the convening time and date', () => {
  const r = by(/Pro Forma/);
  assert.strictEqual(r.conveneTime, '3:00pm');
  assert.strictEqual(r.conveneDate, 'Monday, November 9, 2026');
  assert.strictEqual(r.voteTime, '5:30pm');
});

ok('the comma on either side of the bill number, and a joint resolution (29 September)', () => {
  assert.deepStrictEqual(key(by(/September 29/)), ['456 S.J.Res.197', '548 H.R.7008', '684 H.R.9340']);
});

ok('a title ends at its line and does not swallow the next measure', () => {
  const r = by(/September 29/);
  for (const m of r.measures) assert.ok(!/[\n\u0000-\u001f]/.test(m.title), `${m.measure}: ${JSON.stringify(m.title)}`);
  assert.strictEqual(r.measures.find((m) => m.measure === 'H.R.7008').title, 'Stop Insider Trading Act');
});

ok('the posts that already parsed still do, with the same times', () => {
  assert.deepStrictEqual(key(by(/September 30/)), ['548 H.R.7008', '684 H.R.9340']);
  assert.strictEqual(by(/September 30/).conveneTime, '10:15am');
  for (const re of [/September 28/, /September 24/, /September 23/]) assert.deepStrictEqual(key(by(re)), ['449 S.4668']);
  assert.strictEqual(by(/September 28/).conveneTime, '3:00pm');
  assert.strictEqual(by(/September 24/).conveneTime, '10:00am');
});

ok('a post that names no convening time gives none, not a guess', () => {
  const r = by(/September 29/);
  assert.strictEqual(r.conveneTime, null);
  assert.strictEqual(r.conveneDate, null);
});

ok('text that is not a post gives nothing', () => {
  const r = A.parse('');
  assert.deepStrictEqual(r.measures, []);
  assert.strictEqual(r.conveneTime, null);
});

console.log(`\n${n} passed`);
