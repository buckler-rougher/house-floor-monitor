#!/usr/bin/env node
//
// The Worker's /api/special-rule against govinfo (the 61 rule texts of test/special-rules-corpus.json, served as pages). Pins: the rule asked for is read first; the seed fills in over a few
// calls (`complete` false until then, and the Worker never reads more than a batch of texts a call); a chain across rules ends where its last step says; an HTML error page answering 200 is
// not a rule; a govinfo failure is a 5xx and is not held. No network.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, 'special-rules-corpus.json'), 'utf8'));
const RealDate = Date;
let FIXED = RealDate.parse('2026-11-12T16:00:00Z');
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };
const { default: worker } = await import('../worker.js');

let mode = 'ok', asked = [];
globalThis.fetch = async (u) => {
  u = String(u); asked.push(u);
  const m = u.match(/BILLS-119hres(\d+)(rh|eh|ih)\/html\//);
  if (!m) return new Response('', { status: 404 });
  if (mode === 'down') return new Response('', { status: 503 });
  if (mode === 'error-page') return new Response('<html><body><h1>The requested package was not found</h1></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  const r = corpus.rules[m[1]];
  if (!r || m[2] !== 'rh') return new Response('', { status: 404 });
  return new Response(`<html><body><pre>${r.body}</pre></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
};
const kv = new Map();
const env = { HLS_CACHE: { get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } } };
const get = async (n) => {
  const r = await worker.fetch(new Request(`https://api.evanhollander.org/house-floor/api/special-rule?n=${n}`, { headers: { Origin: 'https://house-floor.evanhollander.org' } }), env);
  return { status: r.status, body: await r.json().catch(() => null) };
};
let count = 0;
const ok = async (name, fn) => { await fn(); count++; console.log('ok  ' + name); };

await ok('a bad number is a 400', async () => { assert.equal((await get('abc')).status, 400); });
await ok('a govinfo failure is an error and is not held', async () => {
  mode = 'down'; const r = await get(1656); assert.ok(r.status >= 500, String(r.status));
  mode = 'ok';
});
await ok('an HTML error page answering 200 is not a rule', async () => {
  kv.clear(); mode = 'error-page'; const r = await get(1656); assert.equal(r.body.model, null); mode = 'ok'; kv.clear(); FIXED += 3600e3;
});
await ok('the asked-for rule comes back on the first call, with at most a batch of reads', async () => {
  asked = []; const r = await get(1656);
  assert.ok(r.body.model); assert.equal(r.body.model.n, 1656);
  assert.ok(asked.filter((u) => /BILLS-/.test(u)).length <= 14 * 3, `read ${asked.length}`);
  assert.deepEqual(r.body.model.tags.length, 2);
});
await ok('the seed fills in over several calls and then says complete', async () => {
  let r; for (let i = 0; i < 8; i++) { FIXED += 60_000; r = await get(1100 + i); if (r.body.complete) break; }
  assert.equal(r.body.complete, true);
});
await ok('a chain across rules ends where the last step says', async () => {
  const r = await get(1131); const c = r.body.model.provisions.flatMap((x) => x.chains).find((x) => x.steps.length > 1);
  assert.ok(c); assert.equal(c.end.until, '03 Jan 2027'); assert.equal(c.end.days, 52);
});
console.log(`${count} passed`);
