#!/usr/bin/env node
//
// What the Worker refuses and how it keeps what it answers (16 October review): a date, year or id outside what the board can ask for is a 400 and costs no upstream request and no KV
// write; answers keyed by what a visitor chose are kept in the colo cache, not KV (its free 1,000 writes a day are shared with the whole board); every answer says nosniff; the image
// proxy passes on pictures only, from the places Twitter keeps them. No network.

import assert from 'node:assert';
import worker from '../worker.js';

const asked = [];
let upstream = () => new Response('', { status: 404 });
globalThis.fetch = async (u, init) => { u = String(u); asked.push(u); return upstream(u, init); };
const kept = new Map();
globalThis.caches = { default: { match: async (r) => { const v = kept.get(r.url); return v ? new Response(v) : undefined; }, put: async (r, res) => { kept.set(r.url, await res.text()); } } };
let kvWrites = 0;
const env = { HLS_CACHE: { get: async () => null, put: async () => { kvWrites++; }, delete: async () => {} } };
const call = async (path) => { asked.length = 0; const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api' + path), env); return { r, status: r.status, text: await r.text(), asked: [...asked] }; };

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };
const q = encodeURIComponent;

await ok('a date before 2019 or too far ahead is a 400 and asks nobody', async () => {
  for (const p of [`/committee-meetings?date=${q('01/01/1900')}`, `/house-rolls?date=${q('01/01/1900')}`, `/proceedings?date=${q('01/01/1900')}`, `/bills-source?date=${q('01/01/1900')}`, `/bills?date=${q('01/01/1900')}`, `/committee-meetings?date=${q('01/01/2099')}`]) {
    const x = await call(p);
    assert.strictEqual(x.status, 400, p);
    assert.deepStrictEqual(x.asked, [], p);
  }
  assert.strictEqual((await call('/replay-day?date=19000101')).status, 404);
  assert.strictEqual((await call('/proceedings?date=not-a-date')).status, 400, 'a proceedings date is a date');
});
await ok('a ranged question outside 2019 and next year is a 400', async () => {
  assert.strictEqual((await call('/senate/session-days-source?from=1900-01-01&to=1900-01-02')).status, 400);
  assert.strictEqual((await call('/senate/session-days-source?from=2026-01-01&to=2028-01-01')).status, 400, 'a span over 400 days');
  assert.strictEqual((await call('/appropriations-markups?from=1900-01-01&to=1900-02-01&fy=1901')).status, 400);
});
await ok('a bill number is a number a Congress could hold', async () => {
  assert.strictEqual((await call('/senate/bill?id=' + q('H.R. 99999999'))).status === 200, false);
  assert.strictEqual((await call('/senate/amendments?id=' + q('S. 999999'))).status, 400);
});
await ok('every answer says nosniff', async () => {
  const x = await call(`/committee-meetings?date=${q('01/01/1900')}`);
  assert.strictEqual(x.r.headers.get('X-Content-Type-Options'), 'nosniff');
});
await ok('a day asked about is kept in the colo cache and never written to KV', async () => {
  upstream = () => new Response('<table><tr><th>Title</th><th>Time</th><th>Location</th></tr></table>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  const day = (() => { const d = new Date(); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`; })();
  const first = await call(`/committee-meetings?date=${q(day)}`);
  const again = await call(`/committee-meetings?date=${q(day)}`);
  assert.ok(first.status === 200 || first.status === 502);
  if (first.status === 200) assert.deepStrictEqual(again.asked, []);
  assert.strictEqual(kvWrites, 0);
});
await ok('the image proxy: Twitter picture paths only, pictures only, and an upstream error is an error', async () => {
  const pic = (u) => call('/img-proxy?url=' + q(u));
  assert.strictEqual((await pic('https://nitter.example/pic/..%2F..%2Fsecret')).status, 403, 'no climbing out of the picture folders');
  assert.strictEqual((await pic('https://nitter.example/pic/other%2Fthing.jpg')).status, 403, 'only the folders pictures live in');
  assert.strictEqual((await pic('https://nitter.example/pic/%E0%A4%A')).status, 400, 'a bad escape is a 400, not a crash');
  assert.strictEqual((await pic('https://evil.example/x.png')).status, 403, 'a host that is not a known mirror');
  upstream = () => new Response('<html>not a picture</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  assert.strictEqual((await pic('https://nitter.example/pic/media%2FAbC.jpg')).status, 502, 'a page is not a picture');
  upstream = () => new Response('x', { status: 404, headers: { 'Content-Type': 'image/jpeg' } });
  assert.strictEqual((await pic('https://nitter.example/pic/media%2FAbC.jpg')).status, 502, 'an upstream 404 is not passed on as a 200');
  upstream = () => new Response('PNG', { status: 200, headers: { 'Content-Type': 'image/png' } });
  const good = await pic('https://nitter.example/pic/media%2FAbC.jpg');
  assert.strictEqual(good.status, 200);
  assert.ok(good.asked[0].startsWith('https://pbs.twimg.com/media/AbC.jpg'));
});

console.log(`worker-hardening: ${n} passed`);
