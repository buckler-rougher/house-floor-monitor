#!/usr/bin/env node
//
// Contract test for lib/house-calendar.js -- the House Calendar's front page for a sitting day.
//
// WHY THIS EXISTS
// The page is fixed-width text from GPO, and govinfo answers a day with no package with an HTML
// error page that is not a 404, so "is this a calendar?" has to be answered by reading it. The
// seven pages in test/house-calendar/ are verbatim (July 22, and Sept 2, 3, 14, 15, 16, 17 of
// 2026), chosen for the variants: Monday and Tuesday meet for morning-hour debate, Thursday has no
// suspensions, a day has two orders, one has a postponed vote, three have none. Do not tidy them.
// No network.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const HC = require('../lib/house-calendar.js');
const page = (d) => fs.readFileSync(path.join(__dirname, 'house-calendar', `${d}.htm`), 'utf8');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('Wednesday 16 September: legislative day 123, meets at 9 A.M., suspensions, no morning hour', () => {
  const r = HC.parse(page('2026-09-16'));
  assert.strictEqual(r.legislativeDay, 123);
  assert.strictEqual(r.calendarDay, 123);
  assert.strictEqual(r.date, 'Wednesday, September 16, 2026');
  assert.strictEqual(r.meetsAt, '9 A.M.');
  assert.strictEqual(r.suspensions, true);
  assert.strictEqual(r.morningHour, false);
});

ok('Monday and Tuesday meet for morning-hour debate; the other days do not', () => {
  const by = (d) => HC.parse(page(d)).morningHour;
  assert.deepStrictEqual(['2026-09-14', '2026-09-15', '2026-09-02'].map(by), [true, true, true]);
  assert.deepStrictEqual(['2026-09-16', '2026-09-17', '2026-09-03', '2026-07-22'].map(by), [false, false, false, false]);
});

ok('every shape of the meeting time: noon, a half hour, morning', () => {
  assert.strictEqual(HC.parse(page('2026-09-14')).meetsAt, '12 NOON');
  assert.strictEqual(HC.parse(page('2026-09-17')).meetsAt, '10:30 A.M.');
  assert.strictEqual(HC.parse(page('2026-07-22')).meetsAt, '11 A.M.');
});

ok('a day without suspensions says so (Thursday)', () => {
  assert.strictEqual(HC.parse(page('2026-09-17')).suspensions, false);
  assert.strictEqual(HC.parse(page('2026-09-03')).suspensions, false);
});

ok('the legislative day counts up with the sittings', () => {
  const days = ['2026-09-02', '2026-09-03', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'].map((d) => HC.parse(page(d)).legislativeDay);
  assert.deepStrictEqual(days, [116, 117, 121, 122, 123, 124]);
});

ok('16 September has two orders, the hour of meeting and a postponed roll call vote, read whole', () => {
  const { orders } = HC.parse(page('2026-09-16'));
  assert.deepStrictEqual(orders, [
    { kind: 'meeting', label: 'HOUR OF MEETING',
      text: 'On motion of Mr. Gill of Texas, by unanimous consent, Ordered, That when the House adjourns Tuesday, Sept. 15, 2026, it adjourn to meet at 9 a.m. on Wednesday, Sept. 16, 2026. (Agreed to Sept. 15, 2026.)' },
    { kind: 'postponed-vote', label: 'POSTPONED ROLL CALL VOTE - H.R. 9340, AS AMENDED',
      text: 'Pursuant to clause 8, Rule XX, the Speaker postponed until a time to be announced the roll call vote on motion to suspend the rules and pass H.R. 9340, as amended, which was ordered on Tuesday, September 15, 2026. (Agreed to Sept. 15, 2026.)' },
  ]);
});

ok('one order that names several votes is one order, not four', () => {
  const { orders } = HC.parse(page('2026-09-15'));
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].kind, 'postponed-vote');
  assert.ok(/H\.R\. 2978, as amended; H\.R\. 8278, as amended; and H\.R\. 4646, as amended; and agreeing to H\.Con\.Res\. 93/.test(orders[0].text), orders[0].text);
  assert.ok(orders[0].text.endsWith('(Agreed to Sept. 14, 2026.)'));
});

ok('a day with no orders has none: an empty list, not "unknown"', () => {
  for (const d of ['2026-09-02', '2026-09-14', '2026-09-17']) assert.deepStrictEqual(HC.parse(page(d)).orders, [], d);
});

ok('the standing special-order policy and morning-hour rule are not read as orders', () => {
  for (const d of ['2026-09-16', '2026-09-03', '2026-07-22']) {
    for (const o of HC.parse(page(d)).orders) assert.ok(!/special-order speeches|morning-hour debate/i.test(o.text), o.text);
  }
});

ok('the standing orders are kept: special-order speeches, morning-hour debate, daily hours', () => {
  for (const d of ['2026-09-16', '2026-09-02', '2026-07-22', '2026-09-17']) {
    const s = HC.parse(page(d)).standing;
    assert.deepStrictEqual(s.map((e) => e.kind), ['special-order-speeches', 'morning-hour', 'hour-of-meeting'], d);
  }
});

ok('the special-order policy is five paragraphs, whole, in the House\'s words', () => {
  const so = HC.parse(page('2026-09-16')).standing[0];
  assert.strictEqual(so.label, 'SPECIAL ORDER SPEECHES');
  assert.strictEqual(so.paragraphs.length, 5);
  assert.ok(/^The Speaker's policy with regard to special-order speeches announced on February 11, 1994/.test(so.paragraphs[0]));
  assert.ok(/up to 4 hours/.test(so.paragraphs[0]));
  assert.ok(/10 o'clock in the evening/.test(so.paragraphs[0]));
  assert.ok(/more than one special-order speech per week/.test(so.paragraphs[2]));
  assert.ok(!so.paragraphs.some((p) => /MORNING HOUR|\(Agreed to/.test(p)), 'must stop at its own end');
});

ok('typeset quotes become curly quotes', () => {
  const so = HC.parse(page('2026-09-16')).standing[0];
  assert.ok(so.paragraphs[3].includes('\u201ccrawl\u201d'), so.paragraphs[3]);
  assert.ok(!so.paragraphs.join(' ').includes("''"));
});

ok('the morning-hour rule and the hours of meeting end with their own "Agreed to"', () => {
  const [, mh, hm] = HC.parse(page('2026-09-16')).standing;
  assert.ok(/^That during the second session of the 119th Congress/.test(mh.paragraphs[0]));
  assert.ok(/\(Agreed to Jan\. 6, 2026\.\)$/.test(mh.paragraphs[0]));
  assert.ok(/9 a\.m\. on all other days of the week/.test(hm.paragraphs[0]));
  assert.strictEqual(hm.label, 'DAILY HOURS OF MEETING');
});

ok('a page with no standing section has standing null, with the rest still read', () => {
  const r = HC.parse(page('2026-09-16').replace(/^SPECIAL ORDER\b/gm, 'SOMETHING ELSE'));
  assert.strictEqual(r.standing, null);
});

ok('a page that is not a calendar is null, never a guess', () => {
  assert.strictEqual(HC.parse('<html><body><h1>Package not found</h1></body></html>'), null);
  assert.strictEqual(HC.parse(''), null);
  assert.strictEqual(HC.parse(null), null);
  assert.strictEqual(HC.parse(undefined), null);
});

ok('a calendar whose orders section cannot be read says "unknown" for orders only', () => {
  const broken = page('2026-09-16').replace(/^SPECIAL ORDER\b/gm, 'SOMETHING ELSE');
  const r = HC.parse(broken);
  assert.strictEqual(r.legislativeDay, 123);
  assert.strictEqual(r.meetsAt, '9 A.M.');
  assert.strictEqual(r.orders, null);
});

console.log(`\n${n} passed`);
