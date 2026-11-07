#!/usr/bin/env node
//
// kvCache does not rewrite an answer whose only change is its leading "at" timestamp: that stamp differed on every fetch, so each refresh cost a KV write
// (1,000 a day on the free tier). It is rewritten when the stored copy is hours old, and at once when the data itself changes. No network.

import assert from 'node:assert';
import worker from '../worker.js';

const puts = [];
const store = new Map();
const env = {
  CONGRESS_API_KEY: 'k',
  HLS_CACHE: {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { puts.push(k); store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [], list_complete: true }; },
  },
};
let treaties = [];
globalThis.fetch = async (url) => new Response(JSON.stringify({ treaties }), { status: 200, headers: { 'content-type': 'application/json' } });

const realNow = Date.now.bind(Date);
let shift = 0;
Date.now = () => realNow() + shift;
const call = () => worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/senate/treaties'), env, { waitUntil() {} });
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('the first answer is written', async () => {
  assert.strictEqual((await call()).status, 200);
  assert.strictEqual(puts.length, 1);
});
await ok('two hours later the same data, with a new stamp, is not written again', async () => {
  shift = 2 * 3600_000;
  const r = await call();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(puts.length, 1);
});
await ok('five hours later the stored copy is old, so it is rewritten (the stamp stays honest)', async () => {
  shift = 5 * 3600_000;
  await call();
  assert.strictEqual(puts.length, 2);
});
await ok('changed data is written at once', async () => {
  shift = 8 * 3600_000;
  store.set([...store.keys()][0], JSON.stringify({ body: '{"at":1,"treaties":[{"x":1}]}', cachedAt: realNow() + shift - 7200_000 }));
  await call();
  assert.strictEqual(puts.length, 3);
});
console.log(`\n${n} passed`);
