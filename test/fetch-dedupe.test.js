#!/usr/bin/env node
// lib/fetch-dedupe.js: a second GET to the Worker for an address already on its way shares the first; nothing else changes.
const assert = require('assert');
const FD = require('../lib/fetch-dedupe.js');
let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('ok  ' + name); });

function world() {
  const calls = [];
  const gates = [];
  const target = {
    fetch(input, init) {
      calls.push([String(input && input.url || input), init]);
      return new Promise((resolve) => gates.push(() => resolve({ ok: true, body: 'x', clone() { return { ...this, cloned: true }; } })));
    },
  };
  FD.install(target);
  return { target, calls, release: () => gates.splice(0).forEach((g) => g()) };
}
const A = 'https://api.evanhollander.org/house-floor/api/member-data';

(async () => {
  await ok('two overlapping GETs to the Worker make one request, and each caller gets its own copy', async () => {
    const w = world();
    const a = w.target.fetch(A), b = w.target.fetch(A);
    assert.strictEqual(w.calls.length, 1);
    w.release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.ok(ra.cloned && rb.cloned && ra !== rb);
  });
  await ok('once it has answered nothing is kept: a later GET asks again, so polling still polls', async () => {
    const w = world();
    const a = w.target.fetch(A); w.release(); await a;
    const b = w.target.fetch(A); w.release(); await b;
    assert.strictEqual(w.calls.length, 2);
  });
  await ok('different addresses, other hosts, other methods and calls with their own signal are left alone', async () => {
    const w = world();
    w.target.fetch(A + '?a=1'); w.target.fetch(A + '?a=2');
    w.target.fetch('https://api.weather.gov/points/1,2'); w.target.fetch('https://api.weather.gov/points/1,2');
    w.target.fetch(A, { method: 'POST' }); w.target.fetch(A, { method: 'POST' });
    w.target.fetch(A, { signal: {} }); w.target.fetch(A, { signal: {} });
    assert.strictEqual(w.calls.length, 8);
  });
  await ok('a failure is shared and does not stick: the next GET after it asks again', async () => {
    const calls = [];
    const target = { fetch(u) { calls.push(u); return Promise.reject(new Error('down')); } };
    FD.install(target);
    const a = target.fetch(A), b = target.fetch(A);
    assert.strictEqual(calls.length, 1);
    await assert.rejects(a); await assert.rejects(b);
    await target.fetch(A).catch(() => {});
    assert.strictEqual(calls.length, 2);
  });
  await ok('installing twice does not wrap twice', async () => {
    const w = world();
    const first = w.target.fetch;
    FD.install(w.target);
    assert.strictEqual(w.target.fetch, first);
  });
  console.log(`\n${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
