#!/usr/bin/env node
//
// The Worker's /api/committee-meetings and /api/discharge-petitions, against a mocked Clerk (no network). What is pinned: the committee scan finds the
// next day with anything on and says which day, and a page that is not the calendar is an error rather than an empty day; the petition counts come from
// each petition's own page, a petition that reached 218 is read once and never again, and a bad date is a 400.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from '../worker.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');
const dayPage = read('committee-day.html'), emptyPage = read('committee-empty-day.html');

// the committee calendar: 16 September has meetings, 17 September answers with something that is not the calendar, every other day is empty
// the petitions: five, numbered 1 to 5, with these many signatures; the list pages are made from the real entry in test/discharge-list.html
const SIGNERS = { 1: 218, 2: 217, 3: 100, 4: 5, 5: 0 };
const entry = read('discharge-list.html').split(/(?=Discharge Petition No\. \d+)/)[1];
const listPage = (nums, page) => `<nav class="library-pagination_v0"><div>1 - 10 of 5 Results</div><ul>${[1, 2, 3].map((p) => `<li><a aria-label="page ${p} of 3 pages">${p}</a></li>`).join('')}</ul></nav>`
  + nums.map((n) => entry.replace(/Discharge Petition No\. \d+/, `Discharge Petition No. ${n}`).replace(/2025120211/g, `20250000${n}0`)).join('');
const sigPage = (n) => `<tbody id="member-signatures">${Array.from({ length: SIGNERS[n] }, (_, i) => `<tr><td data-label="No.">${i + 1}.</td><td><span style="display:none;">11/${String(1 + (i % 28)).padStart(2, '0')}/2025 00:00:00</span></td></tr>`).join('')}</tbody>`;

let fetched = [];
let calendarDown = false;
let discoveryOn = false;
globalThis.fetch = async (u) => {
  u = String(u); fetched.push(u);
  const cal = u.match(/CCAL-119hcal-(\d{4}-\d\d-\d\d)-pt(\d)\.htm/);
  if (cal) {
    // the House Calendars: every day answers with the 16 September page (legislative day 123) but 15 September (122); part 6 is the discharge calendar
    if (calendarDown) return new Response('<html>Not a calendar</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    const body = cal[2] === '6' ? read('discharge-calendar-one.htm') : read(cal[1] === '2026-09-15' ? 'house-calendar/2026-09-15.htm' : 'house-calendar/2026-09-16.htm');
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
  if (u.includes('/committee/house/hsap00/bills')) {
    // the committee's bills as Congress.gov lists them: no titles, a relationship type; the regular bills are "Reported Original Measure"
    if (!discoveryOn) return new Response('{}', { status: 404 });
    const e = (number, relationshipType = 'Reported Original Measure') => ({ congress: 119, type: 'HR', number: String(number), relationshipType, actionDate: '2026-05-01T12:00:00Z', updateDate: '2026-06-01T00:00:00Z', url: `https://api.congress.gov/v3/bill/119/hr/${number}?format=json` });
    return new Response(JSON.stringify({ 'committee-bills': { bills: [8646, 8845, 9022, 9495, 9310, 9170, 9010, 100].map((n) => e(n)).concat([e(7, 'Referred To')]), count: 9 }, pagination: { count: 9 } }), { status: 200 });
  }
  const ap = u.match(/api\.congress\.gov\/v3\/bill\/119\/hr\/(\d+)(\/actions)?\?/);
  if (ap) {
    // the twelve appropriations bills: 8646 passed the House, 8845 only reported, 9495 is unknown to Congress.gov, the rest are introduced
    const n = ap[1];
    if (n === '9495' && !discoveryOn) return new Response('{}', { status: 404 });
    if (ap[2]) {
      const acts = n === '8646' ? [{ actionDate: '2026-06-08', type: 'Floor', text: 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 215 - 210 (Roll no. 301).' }, { actionDate: '2026-05-20', type: 'Committee', text: 'Reported (Amended) by the Committee on Appropriations. H. Rept. 119-1.' }]
        : n === '8845' ? [{ actionDate: '2026-05-15', type: 'Committee', text: 'Reported by the Committee on Appropriations. H. Rept. 119-2.' }] : [{ actionDate: '2026-05-01', type: 'IntroReferral', text: 'Introduced in House' }];
      return new Response(JSON.stringify({ actions: acts }), { status: 200 });
    }
    const TITLES = { 8646: 'Agriculture, Rural Development, Food and Drug Administration, and Related Agencies Appropriations Act, 2027', 8845: 'Commerce, Justice, Science, and Related Agencies Appropriations Act, 2027', 9022: 'Energy and Water Development and Related Agencies Appropriations Act, 2027', 9495: 'Department of Defense Appropriations Act, 2027', 9310: 'Department of Homeland Security Appropriations Act, 2027', 9170: 'Transportation, Housing and Urban Development, and Related Agencies Appropriations Act, 2027', 9010: 'Making appropriations for the Legislative Branch for the fiscal year ending September 30, 2027, and for other purposes.', 100: 'Department of Defense Appropriations Act, 2028', 7: 'Continuing Appropriations Act, 2027' };
    return new Response(JSON.stringify({ bill: { title: (discoveryOn && TITLES[n]) || `Appropriations Act ${n}`, latestAction: { actionDate: '2026-06-08', text: n === '8646' ? 'Received in the Senate.' : 'Placed on the Union Calendar' }, laws: [] } }), { status: 200 });
  }
  const apDay = u.match(/ByDay\.aspx\?DayID=(0420|0421|0422|0423|0424)2026/);
  if (apDay) {
    const row = (id, title, committee) => `<tr><td><a href="ByEvent.aspx?EventID=${id}">${title}</a><br/><span class="text-tiny">${committee}</span></td><td><span class="text-small">9:00 AM</span></td><td><span class="text-small">2359 RHOB</span></td></tr>`;
    const rows = { '0421': row(119215, 'Fiscal Year 2027 Military Construction, Veterans Affairs, and Related Agencies Bill, Fiscal Year 2027 Financial Services and General Government Bill', 'Committee on Appropriations'),
      '0422': row(119187, 'Budget Hearing - Department of Commerce', 'Subcommittee on Commerce, Justice, Science, and Related Agencies (Committee on Appropriations)'),
      '0423': row(119233, 'Fiscal Year 2027 Agriculture, Rural Development, Food and Drug Administration, and Related Agencies Bill', 'Subcommittee on Agriculture, Rural Development, Food and Drug Administration, and Related Agencies (Committee on Appropriations)') + row(119231, 'Fiscal Year 2027 National Security, Department of State, and Related Programs Bill', 'Subcommittee on National Security, Department of State, and Related Programs (Committee on Appropriations)') }[apDay[1]] || '';
    return new Response(`<table id="MainContent_GridViewMeetings"><tbody>${rows || '<tr><td>No meetings found.</td></tr>'}</tbody></table>`, { status: 200 });
  }
  const evA = u.match(/ByEvent\.aspx\?EventID=(119215|119233|119231)/);
  if (evA) {
    const sub = evA[1] !== '119215';
    return new Response(`<div id="previewPanel"><div class="well"><h1>Markup of Fiscal Year 2027 Bill<small class="text-tiny"><blockquote><p>${sub ? 'Subcommittee on Agriculture (Committee on Appropriations)' : 'Committee on Appropriations'}<br></p></blockquote></small></h1></div><div class="meeting-date"><p class="meetingTime">Thursday (9:00 AM)</p></div><blockquote class="location"><strong>H-140</strong><br> Washington, D.C. </blockquote><h2>Support Documents</h2><ul class="unstyled"><li>FY27 – ${sub ? 'Subcommittee' : ''} Roll Call Votes\n[<a target="_blank" href="http://docs.house.gov/meetings/AP/AP00/2026/${evA[1]}/votes.pdf">PDF</a>]</li></ul><p class="lastUpdated">First Published: x<br>Last Updated: y</p></div></div><div class="button-row">`, { status: 200 });
  }
  const ev = u.match(/ByEvent\.aspx\?EventID=(\d+)/);
  if (ev) return new Response(ev[1] === '119559' ? read('committee-event-hearing.html') : '<html>Service unavailable</html>', { status: 200 });
  const day = u.match(/ByDay\.aspx\?DayID=(\d{8})/);
  if (day) return new Response(day[1] === '09162026' ? dayPage : day[1] === '09172026' ? '<html>Service unavailable</html>' : emptyPage, { status: 200 });
  if (u.includes('/DischargePetition/DischargePetitions')) {
    const page = Number((u.match(/Page=(\d)/) || [, 1])[1]);
    return new Response(listPage({ 1: [1, 2], 2: [3, 4], 3: [5] }[page], page), { status: 200 });
  }
  const pet = u.match(/DischargePetition\/20250000(\d)0$/);
  if (pet) return new Response(sigPage(Number(pet[1])), { status: 200 });
  return new Response('', { status: 404 });
};
const store = new Map();
const env = { HLS_CACHE: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async () => {} } };
const get = async (path) => {
  fetched = [];
  const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/' + path), env);
  return { status: r.status, body: await r.json(), fetched: [...fetched] };
};

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('a day with meetings returns them, from the Clerk\'s table', async () => {
  const r = await get('committee-meetings?date=' + encodeURIComponent('09/16/2026'));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.date, '09/16/2026');
  assert.strictEqual(r.body.events.length, 3);
  assert.ok(r.body.table.includes('EventID=119566'));
});

await ok('scan looks forward for the next day with meetings and says which day it found', async () => {
  const r = await get('committee-meetings?date=' + encodeURIComponent('09/14/2026') + '&scan=1');
  assert.strictEqual(r.body.asked, '09/14/2026');
  assert.strictEqual(r.body.date, '09/16/2026');
  assert.strictEqual(r.body.events.length, 3);
  assert.strictEqual(r.fetched.length, 3, 'the 14th, the 15th, the 16th');
});

await ok('a week with nothing on is an empty answer for the last day looked at, not an error', async () => {
  const r = await get('committee-meetings?date=' + encodeURIComponent('10/09/2026') + '&scan=1');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.events, []);
  assert.strictEqual(r.fetched.length, 7);
});

await ok('a page that is not the calendar is an error, and a bad date is a 400', async () => {
  assert.strictEqual((await get('committee-meetings?date=' + encodeURIComponent('09/17/2026'))).status, 502);
  assert.strictEqual((await get('committee-meetings?date=2026-09-16')).status, 400);
  assert.strictEqual((await get('committee-meetings?date=' + encodeURIComponent('13/45/2026'))).status, 400);
});

await ok('each petition\'s count is the rows of its own page, with the number needed', async () => {
  const r = await get('discharge-petitions');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.needed, 218);
  assert.deepStrictEqual(r.body.petitions.map((p) => [p.number, p.signatures]), [[1, 218], [2, 217], [3, 100], [4, 5], [5, 0]]);
  assert.ok(r.body.petitions[0].block.includes('Discharge Petition No. 1'));
  assert.strictEqual(r.fetched.filter((u) => /DischargePetition\/2025/.test(u)).length, 5);
});

await ok('a petition that reached 218 is not read again; the open ones are, once the cache has gone', async () => {
  const real = Date.now;
  Date.now = () => real() + 11 * 60 * 1000;   // past the ten-minute cache
  try {
    SIGNERS[2] = 218;                         // the Clerk's page for petition 2 now has the number
    const r = await get('discharge-petitions');
    const pages = r.fetched.filter((u) => /DischargePetition\/2025/.test(u)).map((u) => u.match(/0000(\d)0/)[1]);
    assert.deepStrictEqual(pages.sort(), ['2', '3', '4', '5'], 'petition 1 had 218 and is not fetched');
    assert.strictEqual(r.body.petitions.find((p) => p.number === 2).signatures, 218);
    // and now petition 2 is finished too
    Date.now = () => real() + 22 * 60 * 1000;
    const again = await get('discharge-petitions');
    assert.deepStrictEqual(again.fetched.filter((u) => /DischargePetition\/2025/.test(u)).map((u) => u.match(/0000(\d)0/)[1]).sort(), ['3', '4', '5']);
  } finally { Date.now = real; }
});

await ok('the signers of one petition: every row of its page, with party, seat and date; a bad id is a 400', async () => {
  const r = await get('discharge-petition?id=202500002' + '0');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.count, 218);
  assert.strictEqual(r.body.signers.length, 218);
  assert.strictEqual(r.body.signers[0].n, 1);
  assert.strictEqual((await get('discharge-petition?id=abc')).status, 400);
  assert.strictEqual((await get('discharge-petition')).status, 400);
});

await ok('the discharge calendar: the newest sitting day\'s legislative day, and how many days each pending motion has waited', async () => {
  const r = await get('discharge-calendar');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.legislativeDay, 123);
  assert.deepStrictEqual(r.body.pending.map((m) => [m.number, m.entered, m.enteredLegislativeDay, m.elapsed]), [[22, '2026-09-15', 122, 1]]);
  assert.ok(r.body.table.includes('H. Res. 1247'));
});

await ok('no calendar to be found is an error, not "nothing pending"', async () => {
  calendarDown = true; store.clear();   // the answer above is cached, in memory too: ask after it has expired
  const real = Date.now;
  Date.now = () => real() + 30 * 60 * 1000;
  try { assert.strictEqual((await get('discharge-calendar')).status, 502); } finally { calendarDown = false; Date.now = real; }
});

await ok('a meeting\'s own page: its witnesses; a page that is not a meeting is an error, and a bad id a 400', async () => {
  const r = await get('committee-event?id=119559');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.witnesses.length, 6);
  assert.strictEqual(r.body.url, 'https://docs.house.gov/Committee/Calendar/ByEvent.aspx?EventID=119559');
  assert.strictEqual((await get('committee-event?id=119999')).status, 502);
  assert.strictEqual((await get('committee-event?id=abc')).status, 400);
});

await ok('appropriations, when discovery finds nothing: the written FY2027 twelve, with their stages; a bill Congress.gov does not know is listed, not dropped', async () => {
  const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/appropriations'), { ...env, CONGRESS_API_KEY: 'test' });
  const b = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(b.bills.length, 12);
  assert.deepStrictEqual([b.fiscalYear, b.listSource], [2027, 'written list (discovery found nothing)']);
  const by = Object.fromEntries(b.bills.map((x) => [x.id, x]));
  assert.deepStrictEqual([by['H.R. 8646'].stage, by['H.R. 8646'].housePassed, by['H.R. 8646'].latestAction], [3, '2026-06-08', 'Received in the Senate.']);
  assert.strictEqual(by['H.R. 8845'].stage, 2);
  assert.deepStrictEqual([by['H.R. 9495'].known, by['H.R. 9495'].stage, by['H.R. 9495'].latestAction], [false, 0, null]);
  assert.strictEqual(by['H.R. 8646'].url, 'https://www.congress.gov/bill/119th-congress/house-bill/8646');
});

await ok('appropriations, found by the committee\'s reported original measures: the newest fiscal year with six subcommittees (one FY2028 bill does not take over); a bill only referred to the committee is not one', async () => {
  discoveryOn = true; store.clear();
  const real = Date.now;
  Date.now = () => real() + 3 * 3600 * 1000;
  try {
    const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/appropriations'), { ...env, CONGRESS_API_KEY: 'test' });
    const b = await r.json();
    assert.deepStrictEqual([b.fiscalYear, b.listSource, b.bills.length], [2027, 'Congress.gov committee bills (reported original measures)', 7]);
    assert.deepStrictEqual([b.discovery.listed, b.discovery.originals, b.discovery.records], [9, 8, 8]);
    assert.deepStrictEqual(b.bills.map((x) => x.short), ['Agriculture', 'Commerce, Justice, Science', 'Defense', 'Energy and Water', 'Homeland Security', 'Legislative Branch', 'Transportation, HUD']);
  } finally { discoveryOn = false; Date.now = real; }
});

await ok('appropriations markups: read a range a day at a time, the markups kept (two bills in one meeting listed for both, a hearing left out), with each meeting\'s roll call votes; the range read comes back', async () => {
  const r = await get('appropriations-markups?fy=2027&from=2026-04-20&to=2026-04-24');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.events.map((e) => [e.date, e.kind, e.shorts, e.id]), [
    ['2026-04-21', 'full', ['Military Construction, VA', 'Financial Services'], '119215'],
    ['2026-04-23', 'subcommittee', ['Agriculture'], '119233'],
    ['2026-04-23', 'subcommittee', ['State, National Security'], '119231'],
  ]);
  assert.strictEqual(r.body.events[1].docs.votes, 'https://docs.house.gov/meetings/AP/AP00/2026/119233/votes.pdf');
  assert.deepStrictEqual([r.body.scannedFrom, r.body.scannedTo, r.body.complete], ['2026-04-20', '2026-04-24', true]);
  assert.strictEqual((await get('appropriations-markups?fy=2027&from=2026-04-20')).status, 400);
  assert.strictEqual((await get('appropriations-markups?fy=2027&from=2024-01-01&to=2026-04-24')).status, 400);
});

console.log(`\n${n} passed`);
process.exit(0);
