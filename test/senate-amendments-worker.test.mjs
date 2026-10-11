#!/usr/bin/env node
//
// The Worker's /api/senate/amendments over a mock Congress.gov: the bill's amendments list, each amendment's record read for its sponsor (thirty a run, kept by update time, so a
// second ask reads none), `pending` says how many are left, rows in number order with the status Congress.gov's latest action gives, an unrecognised id is a 400 and no key a 503.
// No network.

import assert from 'node:assert';
import worker from '../worker.js';

const N = 40;   // more than one run's thirty
let calls = [];
globalThis.fetch = async (u) => {
  u = String(u);
  calls.push(u.replace(/api_key=[^&]*/, 'api_key=X'));
  let m;
  if (/\/bill\/119\/s\/4668\/amendments\?/.test(u)) {
    return new Response(JSON.stringify({ amendments: Array.from({ length: N }, (_, i) => ({ congress: 119, number: String(6800 + i), type: 'SAMDT', updateDate: '2026-09-30T00:00:00Z', ...(i === 0 ? { purpose: 'To limit price increases.', latestAction: { actionDate: '2026-09-28', text: 'Under the order of 9/28/26, amendment SA 6800 not agreed to in Senate by Yea-Nay Vote. 42 - 54. Record Vote Number: 249.' } } : {}) })), pagination: { count: N } }), { status: 200 });
  }
  if ((m = u.match(/\/amendment\/119\/samdt\/(\d+)\/cosponsors/))) return new Response(JSON.stringify({ cosponsors: [{ fullName: 'Sen. Warnock, Raphael [D-GA]', lastName: 'Warnock', party: 'D', state: 'GA' }] }), { status: 200 });
  if ((m = u.match(/\/amendment\/119\/samdt\/(\d+)/))) {
    const i = Number(m[1]) - 6800;
    return new Response(JSON.stringify({ amendment: { number: m[1], type: 'SAMDT', purpose: `Purpose ${m[1]}`, submittedDate: '2026-09-24T04:00:00Z', cosponsors: { count: i === 2 ? 1 : 0 }, sponsors: [{ fullName: 'Sen. Booker, Cory A. [D-NJ]', lastName: i % 2 ? 'Booker' : 'Paul', party: i % 2 ? 'D' : 'R', state: i % 2 ? 'NJ' : 'KY' }], ...(i === 0 ? { latestAction: { actionDate: '2026-09-28', text: 'Under the order of 9/28/26, amendment SA 6800 not agreed to in Senate by Yea-Nay Vote. 42 - 54. Record Vote Number: 249.' } } : {}) } }), { status: 200 });
  }
  return new Response('', { status: 404 });
};
const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async () => {}, list: async () => ({ keys: [] }) };
const ask = async (qs, env) => { const r = await worker.fetch(new Request('https://api.evanhollander.org/senate-floor/api/senate/amendments' + qs), env); return { status: r.status, body: await r.json() }; };
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('a measure it cannot read is a 400, and no key is a 503', async () => {
  assert.strictEqual((await ask('?id=nonsense', { CONGRESS_API_KEY: 'k', HLS_CACHE: kv })).status, 400);
  assert.strictEqual((await ask('?id=S.%204668', { HLS_CACHE: kv })).status, 503);
});

const env = { CONGRESS_API_KEY: 'k', HLS_CACHE: kv };
await ok('the list is read at once and every amendment is a row; eighteen records are read in the first run and the rest are said to be left', async () => {
  calls = [];
  const r = await ask('?id=S.%204668', env);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.count, N);
  assert.strictEqual(r.body.amendments.length, N);
  assert.strictEqual(calls.filter((c) => /\/amendment\/119\/samdt\/\d+\?/.test(c)).length, 18);
  assert.strictEqual(r.body.pending, N - 18);
  assert.deepStrictEqual(r.body.amendments.map((a) => a.num).slice(0, 3), [6800, 6801, 6802], 'in number order');
});

await ok('the next run reads the rest, then nothing; a roll call result is a status with its tally; the sponsor is the amendment\'s own', async () => {
  const realNow = Date.now; let t = realNow(); Date.now = () => t;
  let r;
  try { for (let i = 0; i < 4; i++) { t += 3 * 60 * 1000; calls = []; r = await ask('?id=S.%204668', env); } } finally { Date.now = realNow; }
  assert.strictEqual(r.body.pending, 0);
  assert.strictEqual(calls.filter((c) => /\/amendment\/119\/samdt\//.test(c)).length, 0, 'nothing read twice');
  const a = r.body.amendments[0];
  assert.deepStrictEqual([a.status, a.kind, a.sponsor.name, a.sponsor.party], ['Not agreed 42-54', 'failed', 'Paul', 'R']);
  assert.strictEqual(r.body.amendments[1].kind, 'submitted');
  const bi = r.body.amendments[2];   // sponsor Paul (R) with cosponsor Warnock (D)
  assert.deepStrictEqual([bi.dot, bi.cosponsors.length, bi.cosponsors[0].name], ['bipartisan', 1, 'Warnock']);
  assert.strictEqual(r.body.amendments[4].dot, 'rep', 'no cosponsors: the sponsor\'s party');
});

console.log(`\n${n} passed`);
