#!/usr/bin/env node
//
// The Worker's /api/replay-day and /api/replay-probe: where a past day's archived House video and captions are. The House's broadcast API is a mock (the real record of 16 September
// 2026 and of 19 March 2024 are saved in test/replay/). What is pinned: the east HLS and caption URLs are picked, a day with no broadcast is a 404 and not a hang or a 500, a day
// that has not happened is refused without asking anyone, a bad date is a 400, and the probe marks exactly the days that have an archive. No network.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from '../worker.js';

const here = dirname(fileURLToPath(import.meta.url));
const ev = (d) => readFileSync(join(here, 'replay', `event-${d}.json`), 'utf8');
const events = { '20260916': ev('20260916'), '20240319': ev('20240319') };
let asked = [];
globalThis.fetch = async (u) => {
  u = String(u);
  const m = u.match(/broadcastevents\/(\d{8})/);
  if (m) { asked.push(m[1]); return new Response(events[m[1]] || '[]', { status: 200 }); }
  return new Response('', { status: 404 });
};
const store = new Map();
const env = { HLS_CACHE: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async () => {} } };
const call = async (path) => { asked = []; const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api' + path), env); return { status: r.status, body: await r.json(), asked: [...asked] }; };

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('a past day: the east video and captions, the event and asset times', async () => {
  const r = await call('/replay-day?date=20260916');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.hls, 'https://houseliveprod-f9h4cpb9dyb8gegg.a01.azurefd.net/east/2026-09-16T08-51-54/manifest.m3u8');
  assert.ok(r.body.vtt.endsWith('/east/2026-09-16T08-51-54/captions.vtt'));
  assert.strictEqual(new Date(r.body.startMs).toISOString(), '2026-09-16T13:00:00.000Z');
  assert.strictEqual(r.body.date, '20260916');
});

await ok('the same day twice asks the House once (it is kept)', async () => {
  const r = await call('/replay-day?date=20260916');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.asked, []);
});

await ok('a day with no broadcast is a 404 that says so', async () => {
  const r = await call('/replay-day?date=20260917');
  assert.strictEqual(r.status, 404);
  assert.ok(/no video archive/.test(r.body.error));
});

await ok('a day that has not happened is refused without asking the House; a bad date is a 400', async () => {
  const r = await call('/replay-day?date=20991231');
  assert.strictEqual(r.status, 404);
  assert.deepStrictEqual(r.asked, []);
  assert.strictEqual((await call('/replay-day?date=sept16')).status, 400);
  assert.strictEqual((await call('/replay-day')).status, 400);
});

await ok('the probe: days with an archive are marked, each kept so it is asked once', async () => {
  const r = await call('/replay-probe?ids=20260915,20260916,20240319,20260917');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(Object.keys(r.body.days).filter((k) => r.body.days[k].has).sort(), ['20240319', '20260916']);
  assert.strictEqual(r.body.days['20260916'].name, 'LEGISLATIVE DAY OF SEPTEMBER 16, 2026');
  assert.strictEqual(r.asked.length, 4);
  assert.strictEqual(r.body.days['20260916'].congress, 119);
  assert.strictEqual(r.body.days['20260916'].session, 2);
  const again = await call('/replay-probe?ids=20260916,20260917');
  assert.deepStrictEqual(again.asked, []);
  assert.strictEqual((await call('/replay-probe?ids=2026')).status, 400);
  assert.strictEqual((await call('/replay-probe?ids=20991231')).body.days['20991231'].has, false);
});

console.log(`replay-worker: ${n} passed`);
