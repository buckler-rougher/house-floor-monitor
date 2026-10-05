#!/usr/bin/env node
//
// The Worker's /api/house-calendar against govinfo (test/house-calendar/*.htm, verbatim), with the clock
// pinned to a sitting day. Pins: today's package is read; a day with no package is `calendar: null` (an
// answer, held for a while); a govinfo failure is a 5xx and is NOT held, so a real calendar is not hidden
// by a hiccup; and an HTML error page that answers 200 is not mistaken for a calendar. No network.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page = (d) => readFileSync(join(here, 'house-calendar', `${d}.htm`), 'utf8');

// Pin the clock to noon on 16 September 2026 Eastern, a day the House sat.
const RealDate = Date;
let FIXED = RealDate.parse('2026-09-16T16:00:00Z');
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };

const { default: worker } = await import('../worker.js');

let mode = 'ok', asked = [];
globalThis.fetch = async (u) => {
  u = String(u); asked.push(u);
  const m = u.match(/CCAL-119hcal-(\d{4}-\d\d-\d\d)\/html\/.*-pt0\.htm$/);
  if (!m) return new Response('', { status: 404 });
  if (mode === 'down') return new Response('', { status: 503 });
  if (mode === 'error-page') return new Response('<html><body><h1>The requested package was not found</h1></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  if (mode === 'missing') return new Response('', { status: 404 });
  try { return new Response(page(m[1]), { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } }); }
  catch { return new Response('', { status: 404 }); }
};
const get = async () => {
  const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/house-calendar', { headers: { Origin: 'https://house-floor.evanhollander.org' } }), {});
  return { status: r.status, body: await r.json().catch(() => null), cors: r.headers.get('Access-Control-Allow-Origin') };
};

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok("today's calendar: legislative day 123, meets at 9 A.M., and its two orders", async () => {
  const { status, body } = await get();
  assert.strictEqual(status, 200);
  assert.strictEqual(body.date, '2026-09-16');
  assert.strictEqual(body.calendar.legislativeDay, 123);
  assert.strictEqual(body.calendar.meetsAt, '9 A.M.');
  assert.deepStrictEqual(body.calendar.orders.map((o) => o.kind), ['meeting', 'postponed-vote']);
  assert.ok(body.source.endsWith('CCAL-119hcal-2026-09-16-pt0.htm'));
});

await ok('it asks for TODAY by Eastern date, in the current Congress', async () => {
  assert.ok(asked.every((u) => u.includes('CCAL-119hcal-2026-09-16')), asked.join(' '));
});

await ok('a day the House did not sit is `calendar: null`, and that is a 200 answer', async () => {
  FIXED = RealDate.parse('2026-09-19T16:00:00Z');          // a Saturday: no package in the fixtures
  const { status, body } = await get();
  assert.strictEqual(status, 200);
  assert.strictEqual(body.date, '2026-09-19');
  assert.strictEqual(body.calendar, null);
  assert.strictEqual(body.source, null);
});

await ok('an HTML error page that answers 200 is not mistaken for a calendar', async () => {
  FIXED = RealDate.parse('2026-10-20T16:00:00Z'); mode = 'error-page';
  const { status, body } = await get();
  assert.strictEqual(status, 200);
  assert.strictEqual(body.calendar, null);
});

await ok('govinfo being down is an error and is not held as "no calendar"', async () => {
  FIXED = RealDate.parse('2026-09-17T16:00:00Z'); mode = 'down';
  const down = await get();
  assert.strictEqual(down.status, 500);
  // A thrown handler is a JSON 500 carrying the caller's CORS origin, not Cloudflare's error page, so the
  // browser can read the status instead of reporting a CORS failure.
  assert.ok(/house calendar: HTTP 503/.test(down.body.error), JSON.stringify(down.body));
  assert.strictEqual(down.cors, 'https://house-floor.evanhollander.org');
  mode = 'ok';
  const back = await get();                                  // the same day, now up: not served a held null
  assert.strictEqual(back.status, 200);
  assert.strictEqual(back.body.calendar.legislativeDay, 124);
});

console.log(`\n${n} passed`);
process.exit(0);
