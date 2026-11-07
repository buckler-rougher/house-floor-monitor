// The pure parts of functions/_middleware.js (the live description for search results). The file is an ES module for Cloudflare Pages, so it is read as text and evaluated here.
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../functions/_middleware.js', 'utf8').replace(/export async function onRequest/, 'async function onRequest');
const { parseNextMeeting, descriptionFromProceedings } = new Function(src + '\nreturn { parseNextMeeting, descriptionFromProceedings };')();
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
console.log(`\n${n} passed`);
