#!/usr/bin/env node
//
// lib/opening-day.js: which opening-day step the card shows. The entries are the Clerk's real ones for 3 January 2025; the log is newest first. No network.
const assert = require('assert');
const OD = require('../lib/opening-day.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const at = (h, m, s = 0) => Date.parse('2025-01-03T00:00:00-05:00') + (h * 3600 + m * 60 + s) * 1000;
const e = (h, m, description) => ({ description, timestamp: at(h, m) });
const LOG = [
  e(12, 4, 'CERTIFICATION OF ELECTION - The Acting Clerk announced that Certificates of Election covering 435 seats'),
  e(12, 36, 'Call by States Quorum responded: 433 present &lt;a target=&quot;_blank&quot; rel=&quot;vote&quot; href=&quot;http://clerk.house.gov/cgi-bin/vote.asp?year=2025&amp;amp;rollnumber=1&quot;&gt;(Roll no. 1)&lt;/a&gt;.'),
  e(12, 49, 'NOMINATIONS FOR OFFICE OF SPEAKER - Pursuant to law and precedent'),
  e(12, 50, 'APPOINTMENT OF TELLERS - The Acting Clerk announced the appointment'),
  e(14, 36, 'Roll call 2 - Election of the Speaker. Mr. Johnson (LA) 218, Mr. Jeffries 215, and Mr. Emmer 1. Mr. Johnson (LA) was elected Speaker of the House.'),
  e(14, 36, 'COMMITTEE TO ESCORT THE SPEAKER-ELECT - The Acting Clerk appointed a Committee of Members-elect to escort the Speaker-elect into the Chamber and to the Chair.'),
  e(14, 50, 'The Speaker-elect was escorted into the Chamber by the Escort Committee and introduced by Representative-elect Jeffries, Democratic Leader, before assuming the Chair.'),
  e(15, 5, 'ADDRESS BY THE SPEAKER-ELECT - The Speaker-elect addressed the House prior to taking the Oath of Office which will be administered by the Dean of the House, Representative-elect Harold Rogers, Kentucky.'),
  e(15, 26, 'ADMINISTRATION OF THE OATH OF OFFICE - The Dean of the House administered the Oath of Office to the Speaker.'),
];
const upTo = (k) => LOG.slice(0, k).reverse();   // the log as it stood after its first k entries, newest first

ok('the quorum call is shown while it is among the latest entries', () => {
  const p = OD.pick(upTo(2), at(12, 37));
  assert.strictEqual(p.kind, 'QUORUM CALL');
  assert(/433/.test(p.text) && !/&lt;|href/.test(p.text), p.text);
});
ok('the nominations and the tellers have cards of their own, so the quorum call gives way', () => {
  assert.strictEqual(OD.pick(upTo(3), at(12, 50)), null);
  assert.strictEqual(OD.pick(upTo(4), at(12, 55)), null);
});
ok('after the roll: the escort committee, then the escort in, then the address', () => {
  assert.strictEqual(OD.pick(upTo(6), at(14, 40)).kind, 'ESCORT COMMITTEE');
  assert(/escort the Speaker-elect into the Chamber/.test(OD.pick(upTo(6), at(14, 40)).text));
  assert.strictEqual(OD.pick(upTo(7), at(14, 55)).kind, 'SPEAKER-ELECT ESCORTED');
  const a = OD.pick(upTo(8), at(15, 20));
  assert.strictEqual(a.kind, 'ADDRESS BY THE SPEAKER-ELECT');
  assert(/Harold Rogers/.test(a.text));
});
ok('the leadership announcements: both parties shown together, until the oath or a resolution takes over', () => {
  const L = [
    e(15, 38, 'ANNOUNCEMENT OF LEADERSHIP POSTS - Mrs. McClain of Michigan notified the House that, at the direction of the Republican Conference, Mr. Scalise of Louisiana had been elected as Majority Leader.'),
    e(15, 39, 'ANNOUNCEMENT OF LEADERSHIP POSTS - Mr. Aguilar of California notified the House that, at the direction of the Democratic Caucus, Mr. Jeffries of New York had been elected Minority Leader.'),
  ];
  assert(/Scalise/.test(OD.pick([L[0]], at(15, 38, 30)).text));
  const both = OD.pick([L[1], L[0]], at(15, 40));
  assert.strictEqual(both.kind, 'LEADERSHIP POSTS');
  assert(/Scalise/.test(both.text) && /Jeffries/.test(both.text) && both.text.indexOf('Scalise') < both.text.indexOf('Jeffries'), both.text);
  assert.strictEqual(OD.pick([e(15, 41, 'ADMINISTRATION OF THE OATH OF OFFICE - The Speaker administered the Oath of Office to the Officers of the House.'), L[1], L[0]], at(15, 42)), null);
});
ok('the leadership card stays through the resolutions that elect the officers, until their oath', () => {
  const R = [e(15, 39, 'ANNOUNCEMENT OF LEADERSHIP POSTS - Mr. Aguilar notified the House that Mr. Jeffries had been elected Minority Leader.')];
  const more = ['Considered as privileged matter. x', 'On agreeing to the resolution Agreed to by voice vote.', 'Motion to reconsider laid on the table Agreed to without objection.', 'An amendment, offered by Mr. Aguilar, to elect officers of the House.'].map((d, k) => e(15, 40, d));
  const log = more.concat(R);   // newest first
  assert.strictEqual(OD.pick(log, at(15, 40, 30)).kind, 'LEADERSHIP POSTS');
  assert.strictEqual(OD.pick([e(15, 41, 'ADMINISTRATION OF THE OATH OF OFFICE - The Speaker administered the Oath of Office to the Officers of the House.')].concat(log), at(15, 42)), null);
});
ok('the Chaplain named on opening day is its own step, not a prayer', () => {
  const p = OD.pick([e(15, 41, 'Chaplain of the House of Representatives - Pursuant to the provisions of section 208(a) of the Legislative Reorganization Act of 1946, the Chair appointed Reverend Doctor Margaret Grun Kibben to act as and to exercise the duties of the Chaplain of the House of Representatives, effective today.')], at(15, 41, 30));
  assert.strictEqual(p.kind, 'CHAPLAIN APPOINTED');
  assert(/Kibben/.test(p.text));
});
ok('leadership announcements are read into people and posts', () => {
  const g = OD.leadership('Mrs. McClain of Michigan notified the House that, at the direction of the Republican Conference, Mr. Scalise of Louisiana had been elected as Majority Leader and Mr. Emmer of Minnesota had been elected as Majority Whip.');
  assert.strictEqual(g.body, 'Republican Conference');
  assert.deepStrictEqual(g.people, [{ name: 'Scalise', state: 'Louisiana', post: 'Majority Leader' }, { name: 'Emmer', state: 'Minnesota', post: 'Majority Whip' }]);
  const d = OD.leadership('Mr. Aguilar of California notified the House that, at the direction of the Democratic Caucus, Mr. Jeffries of New York had been elected Minority Leader, and that Ms. Clark of Massachusetts had been elected as Minority Whip.');
  assert.deepStrictEqual(d.people.map((x) => x.post), ['Minority Leader', 'Minority Whip']);
  assert.strictEqual(d.people[1].name, 'Clark');
});
ok('the oath takes over from the address', () => assert.strictEqual(OD.pick(upTo(9), at(15, 27)), null));
ok('an old step is not shown: 45 minutes', () => {
  assert.strictEqual(OD.pick(upTo(8), at(15, 5) + 44 * 60000).kind, 'ADDRESS BY THE SPEAKER-ELECT');
  assert.strictEqual(OD.pick(upTo(8), at(15, 5) + 46 * 60000), null);
});
ok('nothing in the log, or none of the steps: nothing', () => {
  assert.strictEqual(OD.pick([], at(12, 0)), null);
  assert.strictEqual(OD.pick(null, at(12, 0)), null);
  assert.strictEqual(OD.pick([e(12, 0, 'House convened')], at(12, 1)), null);
});
console.log(`\n${n} passed`);
