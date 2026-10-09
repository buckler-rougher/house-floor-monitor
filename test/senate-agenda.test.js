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
  const r = A.parse('Following Leader remarks, the Senate will resume consideration of Cal. #449 S.4668, Protect College Sports Act.');
  assert.strictEqual(r.conveneTime, null);
  assert.strictEqual(r.conveneDate, null);
});

ok('"stands adjourned as a further mark of respect ... until 10:00am" (a senator has died) still gives the time and date', () => {
  const r = by(/September 29/);
  assert.strictEqual(r.conveneTime, '10:00am');
  assert.strictEqual(r.conveneDate, 'Tuesday, September 29, 2026');
});

ok('text that is not a post gives nothing', () => {
  const r = A.parse('');
  assert.deepStrictEqual(r.measures, []);
  assert.strictEqual(r.conveneTime, null);
});

// ---- the whole session's posts -----------------------------------------------------------------
// test/senate-schedule-corpus.json is every schedule post the Democratic Caucus made from January to October 2026 (103), verbatim as the
// feed gave them. A backtest over them against the Senate's roll call menu found the old parser reading almost none of their measures
// (dev/backtest-senate-schedule.mjs reruns it). What is pinned here is what it must keep reading. Do not tidy them.
const corpus = require('./senate-schedule-corpus.json');
const post = (re) => A.parse(corpus.find((p) => re.test(p.title)).body);
const on = (re, minutes, done) => { const r = A.onFloor(post(re), { minutes, done }); return r && r.measure; };

ok('every post that is not a pro forma notice gives a convening date (one gives no year, which is the post\'s own omission)', () => {
  const missing = corpus.filter((p) => !/pro forma/i.test(p.title) && !A.parse(p.body).conveneDate).map((p) => p.title);
  assert.deepStrictEqual(missing, ['Schedule for Tuesday, January 6, 2026']);
});

ok('the formats the old parser lost: "Calendar #299, H.R.6938", "House Message with respect to S.1383", a discharge motion, "is possible"', () => {
  assert.deepStrictEqual(post(/January 12, 2026/).measures.map((m) => [m.measure, m.calendarNo, m.role]), [['H.R.6938', 299, 'taken-up']]);
  assert.deepStrictEqual(post(/March 24, 2026/).measures.map((m) => [m.measure, m.role]), [['S.1383', 'taken-up'], ['S.J.Res.116', 'discharge']]);
  const apr = post(/April 15, 2026/).measures.map((m) => [m.measure, m.role]);
  assert.deepStrictEqual(apr, [['S.J.Res.123', 'discharge'], ['S.J.Res.32', 'discharge'], ['S.J.Res.138', 'named'], ['H.J.Res.140', 'possible']]);
});

ok('what the Senate is on: the measure the post says it takes up, not one it only votes on (13 January: H.R.6938 all day, S.J.Res.84 is a vote at 2:15pm)', () => {
  assert.strictEqual(on(/January 13, 2026/, 11 * 60), 'H.R.6938');
  assert.strictEqual(on(/January 13, 2026/, 15 * 60), 'H.R.6938');
  assert.strictEqual(post(/January 13, 2026/).measures.find((m) => m.measure === 'S.J.Res.84').role, 'vote');
});

ok('a timed step switches it (7 August: nominations en bloc, then H.R.5334 "at 11:30am the Senate will proceed")', () => {
  assert.strictEqual(on(/Friday August 7/, 10 * 60 + 30), 'S.Res.817');
  assert.strictEqual(on(/Friday August 7/, 11 * 60 + 45), 'H.R.5334');
});

ok('votes in a row advance as each is disposed of (30 September: H.R.7008, then H.R.9340, then nothing)', () => {
  assert.strictEqual(on(/Wednesday, September 30/, 10 * 60 + 30), 'H.R.7008');
  assert.strictEqual(on(/Wednesday, September 30/, 12 * 60, ['H.R.7008']), 'H.R.9340');
  assert.strictEqual(on(/Wednesday, September 30/, 13 * 60, ['H.R.7008', 'H.R.9340']), null);
});

ok('a day of motions to discharge and morning business names no measure the Senate is on (15 April)', () => {
  assert.strictEqual(on(/April 15, 2026/, 10 * 60 + 30), null);
});

ok('amendments do not change the measure: the bill is named while amendments are voted (24 and 28 September: S.4668)', () => {
  assert.strictEqual(on(/Thursday, September 24/, 10 * 60 + 30), 'S.4668');
  assert.strictEqual(on(/Monday, September 28/, 16 * 60), 'S.4668');
});

ok('a measure is disposed of by a final vote, or by a failed cloture or motion to proceed; an amendment vote disposes of nothing', () => {
  assert.deepStrictEqual(A.disposedBy([{ measure: 'H.R. 7008', stage: 'cloture-mtp', carried: false }]), ['H.R.7008']);
  assert.deepStrictEqual(A.disposedBy([{ measure: 'S. 4668', stage: 'final', carried: true }]), ['S.4668']);
  assert.deepStrictEqual(A.disposedBy([{ measure: 'S. 4668', stage: 'cloture-mtp', carried: true }, { measure: 'S. 4668', stage: 'amendment', carried: false }]), []);
});

console.log(`\n${n} passed`);
