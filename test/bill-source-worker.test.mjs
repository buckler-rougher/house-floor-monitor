#!/usr/bin/env node
//
// The Worker's /api/bill-source: the Congress.gov responses behind a bill modal's source popover, read from what
// enrichment stored. Pins the two rules that matter: opening the popover makes NO request to Congress.gov, and the API key
// is in nothing that is stored or sent. Enrichment here is the Senate bill route (test/congress/*.json); the House's
// enrichment writes the same keys through the same helper. No network: fetch is the mock, HLS_CACHE a Map.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const f = (n) => readFileSync(join(here, 'congress', n), 'utf8');
const { default: worker } = await import('../worker.js');

const KEY = 'secret-test-key';
let asked = [];
globalThis.fetch = async (u) => {
  u = String(u); asked.push(u);
  const m = u.match(/api\.congress\.gov\/v3\/bill\/119\/(s|hr)\/(\d+)(\/[a-z]+)?\?/);
  if (m) {
    try { return new Response(f(`${m[1]}-${m[2]}-${(m[3] || '/record').slice(1)}.json`), { status: 200 }); } catch { return new Response('{}', { status: 404 }); }
  }
  return new Response('', { status: 404 });
};
const store = new Map();
const env = { CONGRESS_API_KEY: KEY, HLS_CACHE: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } } };
const call = (path) => worker.fetch(new Request(`https://api.evanhollander.org/senate-floor/api/${path}`), env);

// S. 999 has 300 cosponsors, so Congress.gov answers 250 and then 50 (offset=250); everything else is S. 4668's files.
const realFetch = globalThis.fetch;
const co = (from, count) => Array.from({ length: count }, (_, i) => ({ bioguideId: 'X' + (from + i), party: (from + i) % 3 === 0 ? 'D' : 'R', state: 'TX' }));
globalThis.fetch = async (u) => {
  u = String(u);
  if (/\/bill\/119\/s\/999\/cosponsors/.test(u)) {
    const off = Number((u.match(/offset=(\d+)/) || [])[1] || 0);
    return new Response(JSON.stringify({ cosponsors: co(off, off ? 50 : 250), pagination: { count: 300 } }), { status: 200 });
  }
  return realFetch(u.replace('/s/999', '/s/4668'));
};

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('a bill nothing has been stored for answers 404 and asks Congress.gov for nothing', async () => {
  asked = [];
  const r = await call('bill-source?id=' + encodeURIComponent('S. 4668'));
  assert.strictEqual(r.status, 404);
  assert.strictEqual(asked.length, 0);
});

await ok('an unrecognised id is a 400', async () => {
  assert.strictEqual((await call('bill-source?id=nope')).status, 400);
});

await ok('once the bill has been enriched the popover reads it back, whole, with no request to Congress.gov', async () => {
  assert.strictEqual((await call('senate/bill?id=' + encodeURIComponent('S. 4668'))).status, 200);
  asked = [];
  const r = await call('bill-source?id=' + encodeURIComponent('S. 4668'));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(asked.length, 0, 'the popover must not call Congress.gov');
  const { parts, at } = await r.json();
  assert.ok(Math.abs(Date.now() - at) < 60_000, 'carries the time the responses were fetched');
  assert.deepStrictEqual(parts.map((p) => p.request.replace(/^GET https:\/\/api\.congress\.gov\/v3\/bill\/119\/s\/4668/, '')),
    ['?format=json', '/cosponsors?limit=250&format=json', '/committees?format=json', '/summaries?limit=5&format=json']);
  assert.strictEqual(parts[0].json.bill.number, JSON.parse(f('s-4668-record.json')).bill.number);
  assert.strictEqual(parts[1].json.cosponsors.length, JSON.parse(f('s-4668-cosponsors.json')).cosponsors.length, 'every cosponsor, none cut');
});

await ok('the API key is in no stored value and no request line', async () => {
  for (const v of store.values()) assert.ok(!v.includes(KEY));
  const { parts } = await (await call('bill-source?id=' + encodeURIComponent('S. 4668'))).json();
  for (const p of parts) assert.ok(!p.request.includes('api_key') && !p.request.includes(KEY));
});

await ok('more than 250 cosponsors: the rest are read, counted in the support bar and kept for the popover', async () => {
  const b = await (await call('senate/bill?id=' + encodeURIComponent('S. 999'))).json();
  const sponsor = b.sponsor ? 1 : 0;
  assert.strictEqual(b.support.total, 300 + sponsor);
  const { parts } = await (await call('bill-source?id=' + encodeURIComponent('S. 999'))).json();
  const pages = parts.filter((p) => /\/cosponsors/.test(p.request));
  assert.strictEqual(pages.length, 2);
  assert.ok(pages[1].request.includes('offset=250'));
  assert.strictEqual(pages[0].json.cosponsors.length + pages[1].json.cosponsors.length, 300);
});

console.log(n + ' passed');
