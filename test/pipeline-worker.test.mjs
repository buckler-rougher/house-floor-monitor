#!/usr/bin/env node
//
// The Worker's /api/pipeline over a mock Congress.gov: every bill of the Congress is read once from a cursor per type (oldest update first, 36 pages a run), the matching ones are kept
// in KV and sorted into the board's two columns newest first, a bill whose record updates to something that no longer matches drops out, and the answer says whether the first fill
// has finished (`complete`). No network.

import assert from 'node:assert';
import worker from '../worker.js';

let calls = [];
// the whole Congress, as the bill lists would hold it: type -> bills
const bills = {
  hr: [
    { type: 'HR', number: '100', title: 'Reported bill', updateDate: '2026-01-01', latestAction: { actionDate: '2026-01-01', text: 'Placed on the Union Calendar, Calendar No. 10.' } },
    { type: 'HR', number: '200', title: 'Passed the House, in the Senate', updateDate: '2026-02-01', latestAction: { actionDate: '2026-02-01', text: 'Received in the Senate and Read twice and referred to the Committee on Finance.' } },
    { type: 'HR', number: '300', title: 'Amended by the Senate', updateDate: '2026-03-01', latestAction: { actionDate: '2026-03-01', text: 'Message on Senate action sent to the House.' } },
    { type: 'HR', number: '350', title: 'An older amended bill', updateDate: '2025-12-01', latestAction: { actionDate: '2025-12-01', text: 'Passed Senate with an amendment by Unanimous Consent.' } },
    { type: 'HR', number: '400', title: 'Still in committee', updateDate: '2026-03-02', latestAction: { actionDate: '2026-03-02', text: 'Referred to the House Committee on Energy and Commerce.' } },
  ],
  s: [
    { type: 'S', number: '10', title: 'Held at the House desk', updateDate: '2026-02-15', latestAction: { actionDate: '2026-02-15', text: 'Held at the desk.' } },
    { type: 'S', number: '20', title: 'On the Senate calendar', updateDate: '2026-01-20', latestAction: { actionDate: '2026-01-20', text: 'Placed on Senate Legislative Calendar under General Orders. Calendar No. 5.' } },
  ],
  hjres: [], sjres: [],
};
let pageCalls = 0;
globalThis.fetch = async (u) => {
  u = String(u);
  const m = u.match(/\/bill\/119\/(hr|s|hjres|sjres)\?/);
  if (!m) return new Response('', { status: 404 });
  calls.push(u.replace(/api_key=[^&]*/, 'api_key=X'));
  pageCalls++;
  const from = (u.match(/fromDateTime=([^&]+)/) || [])[1] || '';
  // the API reads only a full stamp; a bare day with a Z on it is not one
  if (from && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(decodeURIComponent(from))) return new Response('', { status: 400 });
  const list = (bills[m[1]] || []).filter((b) => b.updateDate >= decodeURIComponent(from).slice(0, 10)).sort((a, b) => a.updateDate.localeCompare(b.updateDate));
  const offset = Number((u.match(/offset=(\d+)/) || [])[1] || 0);
  // the real API's pages: 250 a page, `count` the whole list from the cursor
  return new Response(JSON.stringify({ bills: list.slice(offset, offset + 250), pagination: { count: list.length } }), { status: 200 });
};
const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async () => {}, list: async () => ({ keys: [] }) };
const env = { CONGRESS_API_KEY: 'k', HLS_CACHE: kv };
const ask = async (board, e = env) => { const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/pipeline?board=' + board), e); return { status: r.status, body: await r.json() }; };
const realNow = Date.now; let t = realNow(); Date.now = () => t;
const later = () => { t += 3 * 60 * 1000; };

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('a board is required and so is a key', async () => {
  assert.strictEqual((await ask('moon')).status, 400);
  assert.strictEqual((await ask('house', { HLS_CACHE: kv })).status, 503);
});

await ok('the House board: the calendar column is the bill a committee reported (with its number); the from-the-Senate column holds the Senate bill held at the desk and the House bill the Senate amended, tagged', async () => {
  const r = await ask('house');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.complete, true);
  assert.deepStrictEqual(r.body.calendar.map((b) => [b.id, b.cal]), [['H.R. 100', 10]]);
  assert.deepStrictEqual(r.body.from.map((b) => [b.id, b.tag]), [['H.R. 300', 'amended'], ['H.R. 350', 'amended'], ['S. 10', 'senate-bill']], 'the amended ones lead, newest first among them, then the rest');
});

await ok('the Senate board: the Senate calendar, and the House-passed bill with no action since', async () => {
  later();
  const r = await ask('senate');
  assert.deepStrictEqual(r.body.calendar.map((b) => [b.id, b.cal, b.tag]), [['S. 20', 5, 'senate-bill']]);
  assert.deepStrictEqual(r.body.from.map((b) => [b.id, b.tag]), [['H.R. 200', 'house-bill']]);
});

await ok('a bill whose record updates to something else drops out, and only the changes are read the next time', async () => {
  bills.hr[0] = { ...bills.hr[0], updateDate: '2026-04-01', latestAction: { actionDate: '2026-04-01', text: 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 220 - 205.' } };
  later(); calls = [];
  const r = await ask('house');
  assert.deepStrictEqual(r.body.calendar, []);
  const busy = calls.filter((c) => /\/bill\/119\/(s|hr)\?/.test(c));   // the types that have bills: read from their cursors, not from the start of the Congress
  assert.ok(busy.length && busy.every((c) => /fromDateTime=2026-\d\d-\d\dT00:00:00Z/.test(c)), busy.join(' | '));
});

await ok('a run that cannot finish within its page budget says so and the next one carries on from where it stopped', async () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ type: 'HR', number: String(1000 + i), title: 'x', updateDate: `2026-05-${String(1 + Math.floor(i / 36)).padStart(2, '0')}`, latestAction: { actionDate: '2026-05-01', text: i % 2 ? 'Placed on the Union Calendar, Calendar No. ' + i + '.' : 'Referred to the House Committee on X.' } }));
  bills.hr.push(...many);
  const store2 = new Map();
  const e2 = { CONGRESS_API_KEY: 'k', PIPELINE_PAGES: 6, HLS_CACHE: { ...kv, get: async (k) => store2.get(k) ?? null, put: async (k, v) => { store2.set(k, v); } } };
  later(); const a = await ask('house', e2);
  assert.strictEqual(a.body.complete, false, '1,004 bills are five pages of 250, three requests go to the other types, and a run may ask for six');
  let r = a;
  for (let i = 0; i < 4 && !r.body.complete; i++) { later(); r = await ask('house', e2); }
  assert.strictEqual(r.body.complete, true, 'it gets there');
  assert.strictEqual(r.body.calendar.length, 500, 'the 500 reported ones of the thousand, and nothing twice');
});

Date.now = realNow;
console.log(`\n${n} passed`);
