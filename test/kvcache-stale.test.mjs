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
await ok('callers that arrive together on an expired key each get a whole response (no locked stream)', async () => {
  store.clear();
  let calls = 0;
  globalThis.fetch = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return new Response('<rss></rss>', { status: 200 }); };
  const rs = await Promise.all([call(), call(), call(), call()]);
  const texts = await Promise.all(rs.map((r) => r.text()));
  assert.ok(rs.every((r) => r.status === rs[0].status), 'one answer for all');
  assert.ok(texts.every((t) => t === texts[0]), 'the same body for all');
});
await ok('the Senate stages are built from the last vote list kept when senate.gov refuses (stale, titles empty), and from the last menu kept when there is one', async () => {
  store.clear();
  globalThis.fetch = async () => new Response('Access Denied', { status: 403 });
  const mk = (n, issue, question, result) => ({ number: String(n), date: '30-Sep', issue, question, result, yeas: 52, nays: 45 });
  store.set('senate-votes-119-2-v1', JSON.stringify({ body: JSON.stringify({ congress: 119, session: 2, count: 2, votes: [
    mk(255, 'S. 4668', 'On the Motion to Proceed', 'Agreed to'), mk(256, 'S. 4668', 'On the Cloture Motion', 'Cloture Motion Agreed to') ] }), cachedAt: Date.now() }));
  let r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/senate/stages'), env, { waitUntil() {} });
  assert.strictEqual(r.status, 200);
  let j = await r.json();
  assert.strictEqual(j.stale, true);
  assert.ok(Object.values(j.counts).reduce((a, b) => a + b, 0) >= 1, 'the measure is in a stage');
});
await ok('a slow source does not hold the reader up while a saved copy exists: the copy goes out stale, and the refresh finishes behind it', async () => {
  store.clear();
  store.set(KEY, JSON.stringify({ body: JSON.stringify({ days: [{ date: 'old' }] }), cachedAt: Date.now() - 3 * 86400000 }));
  const waits = [];
  const ctx = { waitUntil(p) { waits.push(p); } };
  const slowEnv = { ...env, KV_SLOW_MS: 40 };
  globalThis.fetch = async () => { await new Promise((r) => setTimeout(r, 250)); return new Response('<rss><channel><item><title>fresh</title></item></channel></rss>', { status: 200 }); };
  const t0 = Date.now();
  const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/senate/schedule'), slowEnv, ctx);
  assert.ok(Date.now() - t0 < 200, 'answered well before the source did');
  assert.strictEqual(r.headers.get('X-Stale'), '1');
  assert.deepStrictEqual((await r.json()).days, [{ date: 'old' }]);
  assert.ok(waits.length >= 1, 'the refresh was handed to waitUntil');
  // a second reader while that refresh is still running is not made to wait the 40 ms again
  const t1 = Date.now();
  const r2 = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/senate/schedule'), slowEnv, ctx);
  assert.strictEqual(r2.headers.get('X-Stale'), '1');
  assert.ok(Date.now() - t1 < 30, 'the second reader got the saved copy at once');
  await Promise.all(waits);
});
console.log(`\n${n} passed`);
