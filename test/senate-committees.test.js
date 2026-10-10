#!/usr/bin/env node
//
// lib/senate-committees.js and lib/senate-treaties.js: what the Worker makes of Congress.gov's committee-meeting and treaty records. The record is a real
// one (a Judiciary nominations hearing of 30 September 2026, trimmed) and the treaty record of 119-2.
// No network.

const assert = require('assert');
const SC = require('../lib/senate-committees.js');
const ST = require('../lib/senate-treaties.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

const hearing = {
  chamber: 'Senate', congress: 119, eventId: '338781', date: '2026-09-30T14:15:00Z', meetingStatus: 'Scheduled', type: 'Open Hearing',
  committees: [{ name: 'Senate Judiciary', systemCode: 'ssju00' }, { name: 'Senate Judiciary', systemCode: 'ssju00' }],
  location: { building: 'Hart Senate Office Building', room: '216' },
  meetingDocuments: [{ description: 'Peter M. Mansfield, of Louisiana, to be United States District Judge', documentType: 'Generic Document' }],
  title: 'Hearings to examine the nominations of  Lee Philip Rudofsky, of Arkansas, to be United States Circuit Judge',
  videos: [{ name: 'x', url: 'https://www.congress.gov/event/119th-Congress/senate-event/338781' }, { name: 'x', url: 'https://www.senate.gov/isvp/?comm=judiciary&filename=judiciary093026' }],
};

ok('a meeting becomes its Eastern day and clock, the committee without "Senate", the room with its building, a Senate video link and a Congress.gov page', () => {
  const e = SC.shape(hearing);
  assert.strictEqual(e.day, '2026-09-30');
  assert.strictEqual(e.time, '10:15 AM', 'the record is UTC, the Senate meets in Eastern');
  assert.strictEqual(e.committee, 'Judiciary', 'listed twice by the API, named once');
  assert.strictEqual(e.location, 'Hart 216');
  assert.strictEqual(e.type, 'Hearing');
  assert.strictEqual(e.video, 'https://www.senate.gov/isvp/?comm=judiciary&filename=judiciary093026');
  assert.strictEqual(e.url, 'https://www.congress.gov/event/119th-Congress/senate-event/338781');
  assert.strictEqual(e.title.includes('  '), false, 'whitespace collapsed');
  assert.strictEqual(e.docs.length, 1);
});

ok('a closed hearing says so and has no video; a subcommittee keeps its whole name; a record with no date is nothing', () => {
  const e = SC.shape({ ...hearing, eventId: '9', type: 'Closed Hearing', videos: [], committees: [{ name: 'Senate Armed Services Subcommittee on Strategic Forces' }] });
  assert.strictEqual(e.closed, true);
  assert.strictEqual(e.video, null);
  assert.strictEqual(e.committee, 'Armed Services Subcommittee on Strategic Forces');
  assert.strictEqual(SC.shape({ ...hearing, date: undefined }), null);
  assert.strictEqual(SC.shape(null), null);
});

ok('pick: the first day from today with a meeting, all of that day\'s meetings, in time order; nothing within the week is null', () => {
  const m = (id, date) => SC.shape({ ...hearing, eventId: id, date });
  const list = [m('3', '2026-10-14T18:00:00Z'), m('1', '2026-10-13T14:00:00Z'), m('2', '2026-10-13T19:00:00Z'), m('0', '2026-10-09T14:00:00Z'), m('9', '2026-10-30T14:00:00Z')];
  const r = SC.pick(list, '2026-10-10', 7);
  assert.strictEqual(r.day, '2026-10-13');
  assert.deepStrictEqual(r.events.map((e) => e.id), ['1', '2']);
  assert.strictEqual(SC.pick(list, '2026-10-15', 7), null, 'only the 30th is later, and it is not within a week');
  assert.strictEqual(SC.pick([], '2026-10-10', 7), null);
});

ok('a canceled meeting is kept and carries its status', () => {
  assert.strictEqual(SC.shape({ ...hearing, meetingStatus: 'Canceled' }).status, 'Canceled');
});

const treaty = [{
  congressReceived: 119, number: 2, suffix: '', topic: 'Taxation', transmittedDate: '2026-09-14T00:00:00Z', resolutionText: null, inForceDate: null,
  countriesParties: [{ name: 'Croatia' }],
  titles: [{ title: 'The Convention ... formal', titleType: 'Treaty - Formal Title' }, { title: 'Tax Convention with Croatia and Protocol', titleType: 'Treaty - Short Title' }],
}];
const referral = [{ actionDate: '2026-09-14', type: 'IntroReferral', text: 'Received in the Senate and referred to the Committee on Foreign Relations by unanimous consent removing the injunction of secrecy.', committee: { name: 'Foreign Relations Committee' } }];

ok('a treaty referred to committee is pending, under its short title, with the action that placed it', () => {
  const t = ST.shape(treaty, referral);
  assert.strictEqual(t.id, 'Treaty Doc. 119-2');
  assert.strictEqual(t.title, 'Tax Convention with Croatia and Protocol');
  assert.deepStrictEqual(t.parties, ['Croatia']);
  assert.strictEqual(t.received, '2026-09-14');
  assert.strictEqual(t.pending, true);
  assert.strictEqual(t.latest.committee, 'Foreign Relations Committee');
});

ok('a treaty with a resolution of ratification, a date in force, or a withdrawal is not pending', () => {
  assert.strictEqual(ST.shape([{ ...treaty[0], resolutionText: 'Resolved ...' }], referral).pending, false);
  assert.strictEqual(ST.shape([{ ...treaty[0], inForceDate: '2027-01-01' }], referral).pending, false);
  const done = [...referral, { actionDate: '2026-10-01', text: 'Resolution of ratification agreed to in Senate by Yea-Nay Vote. 82 - 15.' }];
  assert.strictEqual(ST.shape(treaty, done).pending, false);
  assert.strictEqual(ST.shape(treaty, [...referral, { actionDate: '2026-10-02', text: 'Withdrawn by the President.' }]).pending, false);
  assert.strictEqual(ST.shape(null, []), null);
});

console.log(`\n${n} passed`);
