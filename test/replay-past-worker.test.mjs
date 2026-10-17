#!/usr/bin/env node
//
// The Worker's "as of" parameters for the time machine: /api/whip-floor-updates?asof=, /api/whip-notices-feed?asof= and /api/congress-index/roll/N?year=. What is pinned: a value that is
// not a real time between 2019 and tomorrow is a 400 (so a visitor cannot make the Worker keep an answer for every second of every year), a good one is answered from upstream once,
// kept in the colo cache and never written to KV (the free cap of 1,000 writes a day is shared with the live board), and the roll's year picks the Clerk's file. No network.

import assert from 'node:assert';
import worker from '../worker.js';

const asked = [];
globalThis.fetch = async (u, init) => {
  u = String(u); asked.push(u);
  if (u.includes('firestore.googleapis.com')) return new Response(JSON.stringify([{ document: { name: 'x/1', fields: { title: { stringValue: 'Floor Update' }, publishedAt: { timestampValue: '2026-09-15T14:00:00Z' } } } }]), { status: 200 });
  if (u.includes('data.domewatch.us')) return new Response(JSON.stringify({ data: [{ id: 'n1', kind: 'daily', sourceText: '<p>x</p>', publishDate: '2026-09-15', postedAt: '2026-09-15T12:00:00Z' }] }), { status: 200 });
  if (u.includes('clerk.house.gov/evs/')) return new Response('<rollcall-vote><vote-metadata><rollcall-num>297</rollcall-num></vote-metadata></rollcall-vote>', { status: 200 });
  return new Response('', { status: 404 });
};
const kept = new Map();
globalThis.caches = { default: { match: async (r) => { const v = kept.get(r.url); return v ? new Response(v) : undefined; }, put: async (r, res) => { kept.set(r.url, await res.text()); } } };
let kvWrites = 0;
const env = { HLS_CACHE: { get: async () => null, put: async () => { kvWrites++; }, delete: async () => {} } };
const call = async (path) => { asked.length = 0; const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api' + path), env); return { status: r.status, text: await r.text(), asked: [...asked] }; };

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('a floor update asof that is not a time between 2019 and tomorrow is a 400', async () => {
  for (const bad of ['2018-12-31T00:00:00Z', '2099-01-01T00:00:00Z', 'yesterday', '2026-09-15', '2026-09-15T14:00:00']) {
    assert.strictEqual((await call(`/whip-floor-updates?asof=${encodeURIComponent(bad)}`)).status, 400, bad);
  }
});
await ok('a good floor update asof is asked of Firestore once, kept in the colo cache, and never written to KV', async () => {
  const first = await call('/whip-floor-updates?asof=2026-09-16T04:00:00Z');
  assert.strictEqual(first.status, 200);
  assert.ok(first.asked.some((u) => u.includes('firestore')));
  const again = await call('/whip-floor-updates?asof=2026-09-16T04:00:00Z');
  assert.deepStrictEqual(again.asked, []);
  assert.strictEqual(kvWrites, 0);
});
await ok('two moments in the same hour are two answers (the cache is keyed on the whole time)', async () => {
  const a = await call('/whip-floor-updates?asof=2026-09-16T05:10:00Z');
  const b = await call('/whip-floor-updates?asof=2026-09-16T05:50:00Z');
  assert.ok(a.asked.length && b.asked.length);
});
await ok('a notices asof must be a date between 2019 and tomorrow, and a good one is kept in the colo cache, not KV', async () => {
  for (const bad of ['2018-01-01', '2099-01-01', 'x', '2026-9-1']) assert.strictEqual((await call(`/whip-notices-feed?asof=${bad}`)).status, 400, bad);
  const first = await call('/whip-notices-feed?asof=2026-09-16');
  assert.strictEqual(first.status, 200);
  assert.ok(first.asked.some((u) => u.includes('cursor=2026-09-16')));
  assert.deepStrictEqual((await call('/whip-notices-feed?asof=2026-09-16')).asked, []);
  assert.strictEqual(kvWrites, 0);
});
await ok('a roll call for an earlier year reads that year\'s file; a year that is not 20xx is ignored', async () => {
  assert.ok((await call('/congress-index/roll/297?year=2025')).asked.some((u) => u.includes('/evs/2025/roll297.xml')));
  const thisYear = String(new Date().getFullYear());
  assert.ok((await call('/congress-index/roll/297?year=abcd')).asked.some((u) => u.includes(`/evs/${thisYear}/roll297.xml`)));
});

console.log(`replay-past-worker: ${n} passed`);
