#!/usr/bin/env node
//
// kvCache serves the last good body when its source THROWS, not only when it answers with an error: senate.gov began answering 403 to every automated client on 23 October 2026,
// fetchSource throws on that, and the board got a 500 for panels whose last good answer was sitting in KV. With nothing kept, the error still goes out. No network.

import assert from 'node:assert';
import worker from '../worker.js';

const KEY = 'senate-schedule-v1';
const store = new Map();
const env = {
  HLS_CACHE: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true }; },
  },
};
globalThis.fetch = async () => new Response('Access Denied', { status: 403 });

const call = () => worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/senate/schedule'), env, { waitUntil() {} });
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('with nothing kept, a source that answers 403 is still an error', async () => {
  const r = await call();
  assert.strictEqual(r.status, 500);
});
await ok('with a good body kept, the same outage serves it, marked stale', async () => {
  store.set(KEY, JSON.stringify({ body: JSON.stringify({ days: [{ date: '2026-10-22' }] }), cachedAt: Date.now() - 3 * 86400000 }));
  const r = await call();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('X-Stale'), '1');
  const j = await r.json();
  assert.strictEqual(j.stale, true);
  assert.deepStrictEqual(j.days, [{ date: '2026-10-22' }]);
});
console.log(`\n${n} passed`);
