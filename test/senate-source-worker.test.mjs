#!/usr/bin/env node
//
// The Worker's Senate source-popover routes (/senate/stages-source, /senate/nominations-source, /senate/session-days-source):
// each cuts a Senate XML file to what its panel shows, and passes the Senate's own elements through as raw text. Synthetic XML
// in the Senate's real shapes; no network (fetch is the mock, HLS_CACHE a Map).

import assert from 'node:assert';

const { default: worker } = await import('../worker.js');

const votes = (list) => `<?xml version="1.0"?><vote_summary><congress>119</congress><session>2</session><congress_year>2026</congress_year><votes>${
  list.map(([n, issue, question, result, title]) => `<vote><vote_number>${String(n).padStart(5, '0')}</vote_number><vote_date>30-Sep</vote_date><issue>${issue}</issue><question>${question}</question><result>${result}</result><vote_tally><yeas>50</yeas><nays>40</nays></vote_tally><title>${title}</title></vote>`).join('')
}</votes></vote_summary>`;
// 69 measures with one on-chain vote each (roll calls 1-69), then H.R. 70 with two (71, 72): the panel shows the newest 50 roll calls
const menu = votes([
  [72, 'H.R. 70', 'On Passage of the Bill', 'Passed', 'Passage of H.R. 70; A bill'],
  [71, 'H.R. 70', 'On the Motion to Proceed', 'Agreed to', 'Motion to Proceed to H.R. 70; A bill'],
  ...Array.from({ length: 69 }, (_, i) => [69 - i, `S. ${69 - i}`, 'On the Motion to Proceed', 'Agreed to', `Motion to Proceed to S. ${69 - i}; A bill`]),
]);

const nom = (pn, cal, reported) => `<Nomination xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Civilian="Y"><NominationDisplayNumber>PN${pn}-1</NominationDisplayNumber><ReportingStageDate>${reported}</ReportingStageDate><ReportingDescription><![CDATA[Someone ${pn}]]></ReportingDescription>${cal ? `<ExecutiveCalendarNumber>${cal}</ExecutiveCalendarNumber>` : ''}</Nomination>`;
const noms = (list) => `<?xml version="1.0"?><Nominations><Congress>119</Congress><SessionNumber>2</SessionNumber>${list.join('')}</Nominations>`;
const confirmed = noms(Array.from({ length: 60 }, (_, i) => nom(100 + i, null, `2026-0${1 + Math.floor(i / 10)}-${String(10 + (i % 10)).padStart(2, '0')}`)));

const schedule = `<?xml version="1.0"?><CongressSessionDayConvenings Congress="119" FileType="SessionDays" SessionNumber="2">${
  ['2026-01-05', '2026-09-10', '2026-09-15', '2026-12-01'].map((d) => `<LegislativeDay LegislativeDayDate="${d}T00:00:00-04:00"><SessionDay><ConveneDate>${d}T12:00:00-04:00</ConveneDate></SessionDay></LegislativeDay>`).join('')
}</CongressSessionDayConvenings>`;
const annual = `<?xml version="1.0"?><schedule><title>Tentative ${new Date().getFullYear()} Legislative Schedule</title><approvedDate>2025-11-21</approvedDate><dates>${
  [['2026-01-19', '2026-01-23'], ['2026-09-14', '2026-09-18'], ['2026-11-23', '2026-11-27']].map(([b, e]) => `<date><beginDate>${b}</beginDate><endDate>${e}</endDate><action>State Work Period</action><note/></date>`).join('')
}</dates></schedule>`;

const files = {
  'vote_menu_119_2.xml': menu, 'floor_schedule.xml': schedule,
  'NomCivilianConfirmed.xml': confirmed, 'NomNonCivilianConfirmed.xml': noms([]),
  'NomCivilianPendingCalendar.xml': noms([nom(1, '10', '2026-08-01'), nom(2, '12', '2026-08-02'), nom(3, null, '2026-08-03')]),
  'NomNonCivilianPendingCalendar.xml': noms([nom(4, '11', '2026-08-04')]),
};
globalThis.fetch = async (u) => {
  u = String(u);
  const name = u.split('/').pop();
  const body = /^\d{4}_schedule\.xml$/.test(name) ? annual : files[name];
  return body ? new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml' } }) : new Response('', { status: 404 });
};
const store = new Map();
const env = { HLS_CACHE: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async () => {} } };
const call = async (p) => { const r = await worker.fetch(new Request('https://api.evanhollander.org/senate-floor/api/' + p), env); return { status: r.status, body: await r.json() }; };

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('stages: only the votes on the measures on show, as the Senate wrote them', async () => {
  const { status, body } = await call('senate/stages-source');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.congress, '119');
  assert.strictEqual(body.total, 71);
  assert.ok(body.votes.length > 0 && body.votes.length < body.total, 'cut to the window, not the whole file');
  assert.ok(body.votes.every((v) => v.startsWith('<vote>') && v.endsWith('</vote>')));
  assert.ok(body.votes.some((v) => v.includes('<issue>H.R. 70</issue>')) && body.votes.filter((v) => v.includes('H.R. 70')).length === 2, 'both votes on a measure travel together');
});

await ok('nominations: a pending stage lists all of it, merged from both files and in the panel order, uncalendared ones left out', async () => {
  const { body } = await call('senate/nominations-source?stage=calendar');
  assert.strictEqual(body.total, 3);
  assert.deepStrictEqual(body.entries.map((e) => e.match(/PN(\d+)-1/)[1]), ['2', '4', '1'], 'newest calendar number first');
  assert.strictEqual(body.files.length, 2);
  assert.ok(body.entries[0].includes('xmlns:xsi'), 'raw: the client strips the declaration');
});

await ok('nominations: a finished stage lists the newest 40, newest report date first', async () => {
  const { body } = await call('senate/nominations-source?stage=confirmed');
  assert.strictEqual(body.total, 60);
  assert.strictEqual(body.entries.length, 40);
  const dates = body.entries.map((e) => e.match(/<ReportingStageDate>([^<]*)/)[1]);
  assert.deepStrictEqual(dates, [...dates].sort().reverse());
});

await ok('nominations: an unknown stage is a 400', async () => {
  assert.strictEqual((await call('senate/nominations-source?stage=nope')).status, 400);
});

await ok('session days: the days and the recess periods that touch the range, and no others', async () => {
  const { body } = await call('senate/session-days-source?from=2026-09-01&to=2026-09-30');
  assert.strictEqual(body.floor.total, 4);
  assert.strictEqual(body.floor.days.length, 2);
  assert.ok(body.floor.root.startsWith('<CongressSessionDayConvenings'));
  assert.strictEqual(body.annual.total, 3);
  assert.strictEqual(body.annual.dates.length, 1);
  assert.ok(body.annual.dates[0].includes('2026-09-14'));
});

await ok('session days: a range that is not dates is a 400', async () => {
  assert.strictEqual((await call('senate/session-days-source?from=a&to=b')).status, 400);
});

console.log(n + ' passed');
