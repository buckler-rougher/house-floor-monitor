#!/usr/bin/env node
// lib/privileged-notices.js. The rows are written to the shape of the Clerk's floor record (an upper-case heading, " - ", a sentence); the names and
// numbers are made up, so they are checked for how they are read, not for what happened.
const assert = require('assert');
const PN = require('../lib/privileged-notices.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const row = (date, time, description) => ({ description, pubDate: `${date}T${time}:00.000Z` });
const NOTICE = 'NOTIFICATION OF INTENT TO OFFER RESOLUTION - Mr. Smith notified the House of his intent to offer a resolution as a question of the privileges of the House.';
const day = (date, ...items) => ({ date, items });

ok('a notice and nothing since: noticed, zero days passed', () => {
  const [a] = PN.build([day('2026-11-09', row('2026-11-09', '14:00', NOTICE))]);
  assert.strictEqual(a.member, 'Smith');
  assert.strictEqual(a.noticeDate, '2026-11-09');
  assert.strictEqual(a.days, 0);
  assert.strictEqual(a.state, 'noticed');
  assert.ok(!/^NOTIFICATION/.test(a.text));
});

ok('days the House met after the notice count, days it did not do not, pro forma days do', () => {
  const [a] = PN.build([
    day('2026-11-09', row('2026-11-09', '14:00', NOTICE)),
    day('2026-11-10', row('2026-11-10', '12:00', 'The House convened for a pro forma session.')),
    day('2026-11-11'),
  ]);
  assert.strictEqual(a.days, 1);
  assert.strictEqual(a.state, 'noticed');
});

ok('the second legislative day is due; the third with nothing is lapsed', () => {
  const meet = (d) => day(d, row(d, '12:00', 'The House convened.'));
  const base = [day('2026-11-09', row('2026-11-09', '14:00', NOTICE)), meet('2026-11-10'), meet('2026-11-11')];
  assert.strictEqual(PN.build(base)[0].state, 'due');
  assert.strictEqual(PN.build([...base, meet('2026-11-12')])[0].state, 'lapsed');
});

ok('called up, then tabled: the resolution, its title and the outcome', () => {
  const [a] = PN.build([
    day('2026-11-09', row('2026-11-09', '14:00', NOTICE)),
    day('2026-11-10',
      row('2026-11-10', '15:00', 'Considered as privileged matter. H. Res. 1500 — Impeaching an officer of the United States for high crimes'),
      row('2026-11-10', '15:40', 'On motion to table Agreed to by recorded vote: 215 - 205'),
    ),
  ]);
  assert.strictEqual(a.id, 'H. Res. 1500');
  assert.strictEqual(a.title, 'Impeaching an officer of the United States for high crimes');
  assert.strictEqual(a.outcome, 'Tabled 215-205');
  assert.strictEqual(a.state, 'resolved');
});

ok('called up and not yet decided: considered', () => {
  const [a] = PN.build([
    day('2026-11-09', row('2026-11-09', '14:00', NOTICE)),
    day('2026-11-10', row('2026-11-10', '15:00', 'Considered as privileged matter. H. Res. 1500 — A resolution')),
  ]);
  assert.strictEqual(a.state, 'considered');
  assert.strictEqual(a.outcome, null);
});

ok('two notices are answered in order; the newest notice is first', () => {
  const other = NOTICE.replace('Smith', 'Jones');
  const out = PN.build([
    day('2026-11-09', row('2026-11-09', '14:00', NOTICE), row('2026-11-09', '14:30', other)),
    day('2026-11-10', row('2026-11-10', '15:00', 'Considered as privileged matter. H. Res. 1501 — A resolution about one thing')),
  ]);
  assert.deepStrictEqual(out.map((x) => [x.member, x.state]), [['Jones', 'noticed'], ['Smith', 'considered']]);
});

ok('a member named with a state (two of one surname) is kept whole', () => {
  const [a] = PN.build([day('2026-11-09', row('2026-11-09', '14:00', NOTICE.replace('Smith', 'Green of Texas')))]);
  assert.strictEqual(a.member, 'Green of Texas');
});

ok('no notices, no days: nothing', () => {
  assert.deepStrictEqual(PN.build([]), []);
  assert.deepStrictEqual(PN.build([day('2026-11-09', row('2026-11-09', '14:00', 'The House convened.'))]), []);
});

ok('a discharge motion announcement is its own kind, names its measure, and is not answered by a privileged-matter row', () => {
  const dis = 'NOTIFICATION OF INTENT TO OFFER RESOLUTION - Mr. Jones notified the House of his intent to offer a motion to discharge the Committee on Rules from further consideration of &lt;a target=&quot;_blank&quot; href=&quot;https://www.congress.gov/bill/119th-congress/house-resolution/1247&quot;&gt;H. Res. 1247&lt;/a&gt; pursuant to clause 2(c) of rule XV. The Chair announced that the House will entertain the gentleman&#x27;s motion within two legislative days.';
  const out = PN.build([day('2026-11-09', row('2026-11-09', '14:00', dis), row('2026-11-09', '14:10', NOTICE)), day('2026-11-10', row('2026-11-10', '15:00', 'Considered as privileged matter. H. Res. 1500 \u2014 A resolution'))]);
  const d = out.find((x) => x.kind === 'discharge');
  assert.strictEqual(d.bill, 'H.Res. 1247');
  assert.strictEqual(d.member, 'Jones');
  assert.ok(!/</.test(d.text));
  assert.strictEqual(d.state, 'noticed');
  assert.strictEqual(out.find((x) => x.kind === 'resolution').state, 'considered');
});

console.log(`${n} passed`);
