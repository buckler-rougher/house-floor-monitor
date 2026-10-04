#!/usr/bin/env node
//
// The Worker's /api/congress-index against the Clerk's vote listing as the Clerk serves it now
// (test/clerk-votes-list.html, verbatim). The route used to scrape evs/<year>/index.asp, which the
// Clerk removed; it answered 500 and the board lost its latest roll number. Pins what the client
// reads (`latestRollNumber`), that a page the parser does not recognise is a 500 with a reason
// and not a null, and that the request goes to the new listing. No network: fetch is the mock.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const listing = readFileSync(join(here, 'clerk-votes-list.html'), 'utf8');

// Pin the clock to a day in 2026, so the year the Worker asks for does not depend on today.
const RealDate = Date;
const FIXED = RealDate.parse('2026-10-04T15:00:00Z');
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };

const { default: worker } = await import('../worker.js');

let page = listing, asked = [];
globalThis.fetch = async (u) => {
  u = String(u); asked.push(u);
  if (u.startsWith('https://clerk.house.gov/Votes/MemberVotes')) return new Response(page, { status: 200 });
  return new Response('not found', { status: 404 });
};
const get = async () => {
  const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/congress-index', { headers: { Origin: 'https://house-floor.evanhollander.org' } }), {});
  return { status: r.status, body: await r.json() };
};

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('the latest roll is 314, which is what the page reads', async () => {
  const { status, body } = await get();
  assert.strictEqual(status, 200);
  assert.strictEqual(body.latestRollNumber, '314');
  assert.deepStrictEqual(body.rollNumbers.slice(0, 3), [
    { rollNumber: '314', displayNumber: '314' }, { rollNumber: '313', displayNumber: '313' }, { rollNumber: '312', displayNumber: '312' }]);
});

await ok('it asks the Clerk\'s new listing for the 2nd session, not the removed index page', async () => {
  asked = []; await get();
  assert.ok(asked.some((u) => u.startsWith('https://clerk.house.gov/Votes/MemberVotes?Session=2nd')), asked.join(' '));
  assert.ok(!asked.some((u) => u.includes('/evs/2026/index.asp')));
});

await ok('a page it does not recognise is a 500 that says why, not a null latest roll', async () => {
  page = '<html><body><h1>Office of the Clerk</h1></body></html>';
  const { status, body } = await get();
  assert.strictEqual(status, 500);
  assert.ok(/no roll calls/.test(body.error), body.error);
  page = listing;
});

await ok('the Clerk being down is a 500, as before', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  const { status, body } = await get();
  globalThis.fetch = real;
  assert.strictEqual(status, 500);
  assert.ok(/Failed to fetch congress index/.test(body.error));
});

console.log(`\n${n} passed`);
process.exit(0);
