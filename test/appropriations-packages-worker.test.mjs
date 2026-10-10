#!/usr/bin/env node
//
// The Worker's /api/appropriations-packages over a mock Congress.gov and govinfo: the packages of a fiscal year, found among the enacted laws and the recent bills,
// each read once for its division headings (kept in KV by bill and text version), the stage of one not yet law read from its actions, a bill with no text printed
// yet left out and asked again, and the key required. Texts are the real heading wording, wrapped over lines as govinfo prints it. No network.

import assert from 'node:assert';
import worker from '../worker.js';

const html = (...heads) => '<html><body><pre>' + heads.join('\n\nTitle I\n\n') + '</pre></body></html>';
const TEXTS = {
  'BILLS-119hr6938enr': html('DIVISION A--COMMERCE, JUSTICE, SCIENCE, AND RELATED AGENCIES APPROPRIATIONS ACT, 2026', 'DIVISION B--ENERGY AND WATER DEVELOPMENT AND RELATED AGENCIES\nAPPROPRIATIONS ACT, 2026', 'DIVISION C--DEPARTMENT OF THE INTERIOR, ENVIRONMENT, AND RELATED AGENCIES APPROPRIATIONS ACT, 2026'),
  'BILLS-119hr7000eh': html('DIVISION A--DEPARTMENT OF DEFENSE APPROPRIATIONS ACT, 2026', 'DIVISION B--DEPARTMENT OF HOMELAND SECURITY APPROPRIATIONS ACT, 2026'),
};
let calls = [];
globalThis.fetch = async (u) => {
  u = String(u);
  calls.push(u.replace(/api_key=[^&]*/, 'api_key=X'));
  let m;
  if (/\/law\/119\?/.test(u)) return new Response(JSON.stringify({ bills: [
    { type: 'HR', number: '6938', title: 'Commerce, Justice, Science; Energy and Water Development; and Interior and Environment Appropriations Act, 2026', laws: [{ number: '119-74' }], updateDateIncludingText: '2026-01-23', latestAction: { actionDate: '2026-01-23', text: 'Became Public Law No: 119-74.' } },
    { type: 'S', number: '870', title: 'An act to authorize appropriations for the Fire Administration', laws: [{ number: '119-1' }] },
  ] }), { status: 200 });
  if (/\/bill\/119\/hr\?/.test(u)) return new Response(JSON.stringify({ bills: [
    { type: 'HR', number: '7000', title: 'Defense and Homeland Security Appropriations Act, 2026', updateDateIncludingText: '2026-03-01', latestAction: { actionDate: '2026-03-01', text: 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 220 - 205.' } },
    { type: 'HR', number: '7100', title: 'Consolidated Appropriations Act, 2026', updateDateIncludingText: '2026-03-02', latestAction: { actionDate: '2026-03-02', text: 'Placed on the Union Calendar' } },
    { type: 'HR', number: '4553', title: 'Energy and Water Development and Related Agencies Appropriations Act, 2026', updateDateIncludingText: '2026-01-01', latestAction: { actionDate: '2026-01-01', text: 'Placed on the Union Calendar' } },
  ] }), { status: 200 });
  if (/\/bill\/119\/s\?/.test(u)) return new Response(JSON.stringify({ bills: [] }), { status: 200 });
  if ((m = u.match(/\/bill\/119\/(hr|s)\/(\d+)\/text/))) {
    const pk = { '6938': 'BILLS-119hr6938enr', '7000': 'BILLS-119hr7000eh' }[m[2]];
    return new Response(JSON.stringify({ textVersions: pk ? [{ type: 'Engrossed in House', formats: [{ type: 'Formatted Text', url: `https://www.congress.gov/119/bills/${m[1]}${m[2]}/${pk}.htm` }] }] : [] }), { status: 200 });
  }
  if ((m = u.match(/govinfo\.gov\/content\/pkg\/(BILLS-[A-Za-z0-9]+)\/html/))) return new Response(TEXTS[m[1]] || '', { status: TEXTS[m[1]] ? 200 : 404 });
  if (/\/bill\/119\/hr\/7000\/actions/.test(u)) return new Response(JSON.stringify({ actions: [{ actionDate: '2026-03-01', type: 'Floor', text: 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 220 - 205.' }] }), { status: 200 });
  return new Response('', { status: 404 });
};
const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async () => {}, list: async () => ({ keys: [] }) };
const ask = async (qs, env) => { const r = await worker.fetch(new Request('https://api.evanhollander.org/house-floor/api/appropriations-packages' + qs), env); return { status: r.status, body: await r.json() }; };
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('a fiscal year and a key are required', async () => {
  assert.strictEqual((await ask('', { CONGRESS_API_KEY: 'k', HLS_CACHE: kv })).status, 400);
  assert.strictEqual((await ask('?fy=2026', { HLS_CACHE: kv })).status, 503);
});

const env = { CONGRESS_API_KEY: 'k', HLS_CACHE: kv };
await ok('the enacted minibus carries its three subcommittees at stage 5; the House-passed package carries two at stage 3; a regular bill and a package with no text yet are not packages', async () => {
  calls = [];
  const r = await ask('?fy=2026', env);
  assert.strictEqual(r.status, 200);
  const by = Object.fromEntries(r.body.packages.map((p) => [p.id, p]));
  assert.deepStrictEqual(Object.keys(by).sort(), ['H.R. 6938', 'H.R. 7000']);
  assert.deepStrictEqual(by['H.R. 6938'].shorts, ['Commerce, Justice, Science', 'Energy and Water', 'Interior, Environment']);
  assert.strictEqual(by['H.R. 6938'].stage, 5);
  assert.strictEqual(by['H.R. 6938'].law, '119-74');
  assert.deepStrictEqual(by['H.R. 7000'].shorts, ['Defense', 'Homeland Security']);
  assert.strictEqual(by['H.R. 7000'].stage, 3, 'passed the House, read from its actions');
  assert.strictEqual(by['H.R. 7000'].enacted, false);
  assert.ok(!calls.some((c) => /hr\/4553/.test(c)), 'a bill with one subcommittee\'s name is not a package candidate');
});

await ok('a text is read once: the second ask reads no text, and a package with no text yet is asked for again', async () => {
  const realNow = Date.now; let t = realNow(); Date.now = () => t;
  try {
    t += 31 * 60 * 1000; calls = [];
    const r = await ask('?fy=2026', env);
    assert.strictEqual(r.body.packages.length, 2);
    assert.strictEqual(calls.filter((c) => /govinfo\.gov/.test(c)).length, 0, 'nothing read twice');
    assert.ok(calls.some((c) => /hr\/7100\/text/.test(c)), 'the one with no text printed is asked about again');
  } finally { Date.now = realNow; }
});

console.log(`\n${n} passed`);
