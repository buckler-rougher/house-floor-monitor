// The pure parts of functions/_middleware.js (the live description for search results). The file is an ES module for Cloudflare Pages, so it is read as text and evaluated here.
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../functions/_middleware.js', 'utf8').replace(/export async function onRequest/, 'async function onRequest');
const { parseNextMeeting, descriptionFromProceedings, billDescription, procedureOf, weekKey } = new Function(src + '\nreturn { parseNextMeeting, descriptionFromProceedings, billDescription, procedureOf, weekKey };')();
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const adj = (when) => `The Speaker announced that the House do now adjourn pursuant to clause 13 of Rule I. The next meeting is scheduled for ${when}.`;
ok('the Clerk\'s sentence becomes the site\'s date and time format, EST in November', () => assert.strictEqual(parseNextMeeting(adj('12:00 p.m. on November 9, 2026')), 'Monday, 09 Nov 2026 at 12:00 PM EST'));
ok('EDT in summer, a padded hour, minutes kept', () => assert.strictEqual(parseNextMeeting(adj('9:30 a.m. on July 14, 2026')), 'Tuesday, 14 Jul 2026 at 09:30 AM EDT'));
ok('an hour with no minutes', () => assert.strictEqual(parseNextMeeting(adj('2 p.m. on September 8, 2026')), 'Tuesday, 08 Sep 2026 at 02:00 PM EDT'));
ok('a sentence of another shape is null, never a guess', () => { for (const t of ['The House met', '', null, adj('noon on November 9, 2026'), adj('25:00 p.m. on November 9, 2026'), adj('1:00 p.m. on Smarch 9, 2026')]) assert.strictEqual(parseNextMeeting(t), null, String(t)); });
ok('an adjournment entry gives the description', () => assert.strictEqual(descriptionFromProceedings([{ description: adj('12:00 p.m. on November 9, 2026') }]), "The House is adjourned and next meets Monday, 09 Nov 2026 at 12:00 PM EST. Live floor video, votes, bills, and the Clerk's record, from public sources."));
ok('anything else keeps the page\'s own description', () => { for (const v of [null, [], [{ description: 'The House met at 10:00 a.m.' }], [{ description: 'adjourned' }], { items: [] }]) assert.strictEqual(descriptionFromProceedings(v), null); });
ok('the description has no em dash and fits a result', () => assert(descriptionFromProceedings([{ description: adj('12:00 p.m. on November 9, 2026') }]).length <= 160));

// A bill's preview line (17 November 2026): the sponsor, the committee, the start of the summary, and nothing that changes with the floor (a status or latest action would be wrong by the next vote).
const raskin = { id: 'H.R. 9600', title: 'Common Sense 250 Act of 2026', sponsor: { name: 'Jamie Raskin', party: 'D', state: 'MD' }, committees: [{ name: 'Natural Resources Committee' }],
  summary: 'Common Sense 250 Act of 2026 This bill requires the monument honoring Thomas Paine to be located in Area 1 of the National Mall. Thomas Paine was a philosopher.' };
ok('sponsor, committee, the first sentence of the summary without the repeated title', () => assert.strictEqual(billDescription(raskin, false), 'Sponsor: Rep. Jamie Raskin (D-MD). Natural Resources Committee. This bill requires the monument honoring Thomas Paine to be located in Area 1 of the National Mall. Monitoring the House Floor'));
ok('a long first sentence is cut at a word with an ellipsis', () => { const d = billDescription({ ...raskin, summary: 'This bill ' + 'word '.repeat(80) + 'end.' }, false); assert(d.length <= 280, String(d.length)); assert(/word\.\.\. Monitoring the House Floor$/.test(d), d); });
ok('a Senate bill names a Sen. and the Senate', () => assert.strictEqual(billDescription({ id: 'S. 7', title: 'T', summary: 'Does a thing.', sponsor: { name: 'A. Senator', party: 'R', state: 'TX' } }, true), 'Sponsor: Sen. A. Senator (R-TX). Does a thing. Monitoring the Senate Floor'));
ok('no sponsor, committee or summary: just the site', () => assert.strictEqual(billDescription({ id: 'H.R. 1' }, false), 'Monitoring the House Floor'));
ok('no status, no latest action, no em dash in any description', () => { const d = billDescription({ ...raskin, latestAction: 'Recorded vote requested \u2014 postponed' }, false); assert(!/postponed|\u2014|Latest action/.test(d)); });
const week = { suspensionBills: [{ id: 'H.R. 9600' }], ruleBills: [{ id: 'H.R. 1' }], mayBeConsideredBills: [{ id: 'H.R. 5' }], alsoOnFloorBills: [{ id: 'H.R. 7' }] };
ok('the procedure badge is only for the three the modal labels', () => { assert.strictEqual(procedureOf(week, 'H.R. 9600'), 'UNDER SUSPENSION'); assert.strictEqual(procedureOf(week, 'HR 1'), 'SUBJECT TO A RULE'); assert.strictEqual(procedureOf(week, 'H.R. 5'), 'MAY BE CONSIDERED'); assert.strictEqual(procedureOf(week, 'H.R. 7'), null); assert.strictEqual(procedureOf(null, 'H.R. 1'), null); });
ok('the week key is the Monday, Eastern, and the page\'s copy agrees with the middleware\'s on every day of a year', () => {
  const U = require('../lib/util.js');
  assert.strictEqual(weekKey(new Date('2026-11-17T21:00:00Z')), '20261116');   // a Tuesday
  assert.strictEqual(weekKey(new Date('2026-11-16T04:30:00Z')), '20261109');   // 11:30 PM Sunday Eastern is last week
  assert.strictEqual(weekKey(new Date('2026-11-16T05:30:00Z')), '20261116');   // 12:30 AM Monday Eastern is this one
  assert.strictEqual(weekKey(new Date('2026-11-22T20:00:00Z')), '20261116');   // a Sunday belongs to the week before it
  for (let t = Date.UTC(2026, 0, 1, 3); t < Date.UTC(2027, 0, 1); t += 6 * 3600_000) assert.strictEqual(U.weekKey(new Date(t)), weekKey(new Date(t)));
});
console.log(`\n${n} passed`);
