// The pure parts of functions/_middleware.js (the live description for search results). The file is an ES module for Cloudflare Pages, so it is read as text and evaluated here.
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../functions/_middleware.js', 'utf8').replace(/export async function onRequest/, 'async function onRequest');
const { parseNextMeeting, descriptionFromProceedings, billDescription } = new Function(src + '\nreturn { parseNextMeeting, descriptionFromProceedings, billDescription };')();
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

// A bill's preview line (17 November 2026): H.R. 9600's said "Placed on the Union Calendar" (Congress.gov, 29 October) on the day its yeas and nays were ordered, with a doubled full stop.
const raskin = { id: 'H.R. 9600', latestAction: 'Placed on the Union Calendar, Calendar No. 757.', latestActionDate: '2026-10-29', sponsor: { name: 'Jamie Raskin', party: 'D', state: 'MD' } };
ok('the site\'s floor status leads, then the sponsor, with no em dash', () => assert.strictEqual(billDescription(raskin, { status: 'roll-call', latestAction: 'Recorded vote requested \u2014 postponed' }, false), 'Recorded vote requested, postponed. Sponsor: Rep. Jamie Raskin (D-MD). Monitoring the House Floor'));
ok('a scheduled bill says so, rather than Congress.gov\'s older line', () => assert.strictEqual(billDescription(raskin, { status: 'scheduled', latestAction: 'Scheduled for consideration' }, false), 'Scheduled for consideration. Sponsor: Rep. Jamie Raskin (D-MD). Monitoring the House Floor'));
ok('a bill not on this week\'s list uses Congress.gov\'s line, dated the site\'s way, with one full stop', () => assert.strictEqual(billDescription(raskin, null, false), 'Latest action (29 Oct 2026): Placed on the Union Calendar, Calendar No. 757. Sponsor: Rep. Jamie Raskin (D-MD). Monitoring the House Floor'));
ok('a Senate bill names a Sen. and the Senate', () => assert.strictEqual(billDescription({ id: 'S. 7', latestAction: 'Read twice.', sponsor: { name: 'A. Senator', party: 'R', state: 'TX' } }, null, true), 'Latest action: Read twice. Sponsor: Sen. A. Senator (R-TX). Monitoring the Senate Floor'));
ok('no sponsor, no action: just the site', () => assert.strictEqual(billDescription({ id: 'H.R. 1' }, null, false), 'Monitoring the House Floor'));
console.log(`\n${n} passed`);
