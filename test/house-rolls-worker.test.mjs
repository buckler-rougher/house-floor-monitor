#!/usr/bin/env node
//
// The Worker's /api/house-rolls: the roll calls the House took on one day, read from the Clerk's own roll call files, newest first until the day is passed.
// What is pinned: only the day's rolls come back, oldest first; the search stops at the first roll older than the day (a day with no votes costs one file,
// not sixty); a file that is not a roll call is an error, not an empty day. The Clerk is a mock: the vote listing is test/clerk-votes-list.html (newest roll
// 314) and each roll file is test/clerk-roll-314.xml with its number and date changed. No network.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from '../worker.js';

const here = dirname(fileURLToPath(import.meta.url));
const list = readFileSync(join(here, 'clerk-votes-list.html'), 'utf8');
const base = readFileSync(join(here, 'clerk-roll-314.xml'), 'utf8');

// rolls 314..312 on 16 September, 311 and 310 on 15 September, anything lower on 14 September
const dateOf = (n) => (n >= 312 ? '16-Sep-2026' : n >= 310 ? '15-Sep-2026' : '14-Sep-2026');
let files = [];
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.includes('/Votes/MemberVotes')) return new Response(list, { status: 200 });
  const m = u.match(/evs\/2026\/roll(\d+)\.xml(?:\?|$)/);   // the Worker's feed fetch adds a cache-busting ?_=
  if (m) {
    files.push(Number(m[1]));
    if (m[1] === '308') return new Response('<html><body>Page not found</body></html>', { status: 200 });
    return new Response(base.replace(/<rollcall-num>\d+</, `<rollcall-num>${Number(m[1])}<`).replace(/<action-date>[^<]*</, `<action-date>${dateOf(Number(m[1]))}<`), { status: 200 });
  }
  return new Response('', { status: 404 });
};
const store = new Map();
const env = { HLS_CACHE: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async () => {} } };
const get = async (date) => {
  files = [];
  const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/house-rolls?date=' + encodeURIComponent(date)), env);
  return { status: r.status, body: await r.json(), files: [...files] };
};

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('only the day\'s rolls, oldest first, each with its result, and the search stops at the first older roll', async () => {
  const r = await get('09/16/2026');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.rolls.map((x) => x.roll), ['312', '313', '314']);
  assert.strictEqual(r.body.rolls[0].result, 'Passed');
  assert.strictEqual(r.body.rolls[0].date, '09/16/2026');
  assert.deepStrictEqual(r.files, [314, 313, 312, 311], 'one older file read, to know it was over');
});

await ok('a day with no votes costs one file', async () => {
  const r = await get('10/09/2026');
  assert.deepStrictEqual(r.body.rolls, []);
  assert.deepStrictEqual(r.files, [314]);
});

await ok('an earlier day is found by reading back past the newer ones', async () => {
  const r = await get('09/15/2026');
  assert.deepStrictEqual(r.body.rolls.map((x) => x.roll), ['310', '311']);
});

await ok('a file that is not a roll call is an error, not an empty day', async () => {
  const r = await get('09/14/2026');
  assert.strictEqual(r.status, 502);
  assert.match(r.body.error, /308/);
});

await ok('a date that is not MM/DD/YYYY is a 400', async () => {
  assert.strictEqual((await get('2026-09-16')).status, 400);
});

console.log(`\n${n} passed`);
process.exit(0);
