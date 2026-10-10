#!/usr/bin/env node
//
// The Worker's /api/senate/bill against Congress.gov payloads (test/congress/*.json: S. 4668, a
// Senate bill, and H.R. 7008, a House bill the Senate also opens). Pins what the Senate bill modal
// now draws beyond sponsor, support and summary: the committees as objects with a chamber (so a
// Senate committee does not get a House seal), the reporting committee and its vote, the report PDF,
// the White House memo, and the action's source. No network: fetch is the mock.
//
// The committee and action files are EXCERPTS of real responses (the values exactly as Congress.gov
// returned them); S. 4668's record, summaries and cosponsors are whole.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const f = (n) => readFileSync(join(here, 'congress', n), 'utf8');

const { default: worker } = await import('../worker.js');

let failSummaries = false;
let sap = '<a href="https://www.whitehouse.gov/wp-content/uploads/2026/06/H.R.-7008-SAP.pdf">H.R. 7008 — Stop Insider Trading Act (June 4, 2026)</a>';
let asked = [];
globalThis.fetch = async (u) => {
  u = String(u); asked.push(u);
  const m = u.match(/api\.congress\.gov\/v3\/bill\/119\/(s|hr)\/(\d+)(\/[a-z]+)?\?/);
  if (m) {
    // H.R. 7009 is H.R. 7008's payloads under another number, so a test can ask for a bill the
    // Worker has not cached (it holds each for a day, which is the point of it).
    const num = m[1] === 'hr' && (m[2] === '7009' || m[2] === '7010') ? '7008' : m[2];
    if (failSummaries && m[2] === '7010' && m[3] === '/committees') return new Response('', { status: 500 });
    const name = `${m[1]}-${num}-${(m[3] || '/record').slice(1)}.json`;
    try { return new Response(f(name), { status: 200 }); } catch { return new Response('{}', { status: 404 }); }
  }
  if (u.includes('whitehouse.gov/omb')) return new Response(sap, { status: 200 });
  return new Response('', { status: 404 });
};
const get = async (id) => {
  const r = await worker.fetch(new Request(`https://api.evanhollander.org/senate-floor/api/senate/bill?id=${encodeURIComponent(id)}`), { CONGRESS_API_KEY: 'test' });
  return { status: r.status, body: await r.json() };
};

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('a Senate bill: its committee is a Senate object, reported with no invented tally', async () => {
  const { status, body: b } = await get('S. 4668');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(b.committees, [{ name: 'Commerce, Science, and Transportation Committee', chamber: 'Senate', systemCode: 'sscm00' }]);
  assert.strictEqual(b.committeeReport, 'Reported by Committee');
  assert.strictEqual(b.committeeReportDate, '2026-06-18');
  assert.strictEqual(b.committeeReportUrl, null, 'reported without a written report: no PDF to link');
  assert.strictEqual(b.sapUrl, null);
  assert.strictEqual(b.actionSource, 'congress');
  assert.deepStrictEqual([b.textVersionType, b.textVersionDate], ['Engrossed in Senate', '2026-09-28'], 'the newest text version on the /text answer');
  assert.match(b.textVersionUrl, /^https:\/\/www\.congress\.gov\/119\/bills\/s4668\/BILLS-119s4668es\.pdf$/);
  assert.strictEqual(b.cboCostEstimateUrl, 'https://www.cbo.gov/publication/62630', 'the newest CBO estimate on the Congress.gov record');
  assert.ok(b.cboCostEstimateTitle.startsWith('S. 4668, Protect College Sports Act of 2026 - As reported by the Senate Committee on Commerce'));
});

await ok('the existing fields are still there', async () => {
  const { body: b } = await get('S. 4668');
  assert.strictEqual(b.id, 'S. 4668');
  assert.ok(b.title && b.sponsor && b.sponsor.bioguide && b.support && b.summary && b.congressUrl && b.govinfoPdf, 'a field the modal reads is gone');
  assert.strictEqual(b.cosponsorCount, 9);
});

await ok('a House bill the Senate opens: the markup tally, the report PDF, the White House memo', async () => {
  const { body: b } = await get('H.R. 7008');
  assert.deepStrictEqual(b.committees, [{ name: 'House Administration Committee', chamber: 'House', systemCode: 'hshm00' }]);
  assert.strictEqual(b.committeeReport, 'Reported by Committee 7 – 4');
  assert.strictEqual(b.committeeReportDate, '2026-01-14');
  assert.strictEqual(b.committeeReportUrl, 'https://www.congress.gov/119/crpt/hrpt479/CRPT-119hrpt479.pdf');
  assert.strictEqual(b.committeeReportCitation, 'H. Rept. 119-479');
  assert.strictEqual(b.sapUrl, 'https://www.whitehouse.gov/wp-content/uploads/2026/06/H.R.-7008-SAP.pdf');
});

await ok('the memo is found however the id is spaced', async () => {
  for (const id of ['H.R. 7008', 'H.R.7008', 'HR 7008']) {
    const { status, body } = await get(id);
    if (status !== 200) continue;                    // an id the endpoint will not parse is a 400, not a missing memo
    assert.ok(body.sapUrl, `no memo for ${id}`);
  }
});

await ok('the memo list being down costs the link, not the bill', async () => {
  const wh = globalThis.fetch;
  globalThis.fetch = async (u, o) => String(u).includes('whitehouse.gov') ? new Response('', { status: 503 }) : wh(u, o);
  const { status, body } = await get('H.R. 7009');        // not cached yet, unlike 7008
  globalThis.fetch = wh;
  assert.strictEqual(status, 200);
  assert.strictEqual(body.sapUrl, null);
  assert.strictEqual(body.committeeReport, 'Reported by Committee 7 – 4');
  assert.strictEqual(body.committeeReportUrl, 'https://www.congress.gov/119/crpt/hrpt479/CRPT-119hrpt479.pdf');
});

await ok('a section that cannot be read (a 500 from Congress.gov) leaves that section empty; the modal still opens, and the answer is not kept', async () => {
  failSummaries = true;
  const first = await get('H.R. 7010');
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.title.length > 0, true);
  assert.deepStrictEqual(first.body.committees, []);
  failSummaries = false;
  const second = await get('H.R. 7010');
  assert.ok(second.body.committees.length > 0, 'read again, not served from a kept degraded answer');
});

console.log(`\n${n} passed`);
process.exit(0);
