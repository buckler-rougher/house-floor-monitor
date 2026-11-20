#!/usr/bin/env node
//
// lib/api-base.js (staging sends API requests to the staging Worker, and nothing else changes) and lib/memory-kv.js (the staging Worker's stand-in for KV). No network.
const assert = require('assert');
const ApiBase = require('../lib/api-base.js');
const MemoryKv = require('../lib/memory-kv.js');
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

(async () => {
  await test('on a staging host, the production API address becomes the staging one (both chambers)', () => {
    for (const h of ['house-floor-staging.evanhollander.org', 'senate-floor-staging.evanhollander.org']) {
      assert.strictEqual(ApiBase.rewrite('https://api.evanhollander.org/house-floor/api/proceedings?date=11/19/2026', h), 'https://api-staging.evanhollander.org/house-floor/api/proceedings?date=11/19/2026');
    }
  });
  await test('on the real sites, and anywhere else, nothing is rewritten', () => {
    const u = 'https://api.evanhollander.org/house-floor/api/senate/quorum';
    for (const h of ['house-floor.evanhollander.org', 'senate-floor.evanhollander.org', 'localhost', 'evil.example', 'house-floor-staging.evanhollander.org.evil.example']) assert.strictEqual(ApiBase.rewrite(u, h), u);
  });
  await test('an address that is not the production API is never touched, even on staging', () => {
    for (const u of ['https://api.weather.gov/points/1,2', 'https://bioguide.congress.gov/photo/A000001.jpg', '/lib/app.js', 'https://api.evanhollander.org.evil.example/x']) assert.strictEqual(ApiBase.rewrite(u, 'house-floor-staging.evanhollander.org'), u);
  });
  await test('the in-memory KV behaves as the Worker uses KV: get, put, delete, list with a prefix, json reads', async () => {
    const kv = MemoryKv();
    assert.strictEqual(await kv.get('a'), null);
    await kv.put('a', '{"x":1}'); await kv.put('b', 'plain'); await kv.put('senate-bill-1', 'z');
    assert.strictEqual(await kv.get('b'), 'plain');
    assert.deepStrictEqual(await kv.get('a', 'json'), { x: 1 });
    assert.deepStrictEqual(await kv.get('a', { type: 'json' }), { x: 1 });
    assert.deepStrictEqual((await kv.list({ prefix: 'senate-bill-' })).keys, [{ name: 'senate-bill-1' }]);
    await kv.delete('b'); assert.strictEqual(await kv.get('b'), null);
  });
  console.log(`\n${n} passed`);
})();
