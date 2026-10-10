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
globalThis.fetch = async (u) => {
  u = String(u); fetched.push(u);
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

console.log(`\n${n} passed`);
process.exit(0);
