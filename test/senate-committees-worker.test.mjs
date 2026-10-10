#!/usr/bin/env node
//
// The Worker's /api/senate/committee-meetings and /api/senate/treaties, over a mock Congress.gov. Pinned: the list holds only ids, so each meeting's record is read
// and the answer picks the first day from today that has one; records are read thirty a run and the answer says how many are left (`pending`), then nothing is
// read twice (the KV state keeps them until a meeting's update time moves); a record read is shaped (Eastern clock); no key is a 503, not an empty list. Treaties:
// the two Congresses' lists, each treaty's record and actions, pending ones marked. No network.

import assert from 'node:assert';
import worker from '../worker.js';

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
let calls = [];
const meetings = {};   // id -> record
const add = (id, whenIso) => { meetings[id] = { chamber: 'Senate', congress: 119, eventId: id, date: whenIso, meetingStatus: 'Scheduled', type: 'Open Hearing', committees: [{ name: 'Senate Judiciary' }], location: { building: 'Hart Senate Office Building', room: '216' }, title: 'Hearing ' + id, videos: [], meetingDocuments: [] }; };
// 70 meetings ten days ahead (outside the week), then one tomorrow and one the day after
for (let i = 0; i < 70; i++) add(String(400000 + i), `${day(10)}T14:00:00Z`);
// and three from last week: past, but still in the month's list, and read once and kept (a recess lists only past ones)
for (let i = 0; i < 3; i++) add(String(300001 + i), `${day(-5)}T14:00:00Z`);
add('500001', `${day(1)}T18:30:00Z`);
add('500002', `${day(2)}T14:00:00Z`);

globalThis.fetch = async (u) => {
  u = String(u);
  calls.push(u.replace(/api_key=[^&]*/, 'api_key=X'));
  let m;
  if ((m = u.match(/committee-meeting\/119\/senate\/(\d+)\?/))) return new Response(JSON.stringify({ committeeMeeting: meetings[m[1]] }), { status: 200 });
  if (/committee-meeting\/119\/senate\?/.test(u)) return new Response(JSON.stringify({ committeeMeetings: Object.values(meetings).map((x) => ({ chamber: 'Senate', congress: 119, eventId: x.eventId, updateDate: '2026-10-01T12:00:00Z', url: 'x' })), pagination: { count: Object.keys(meetings).length } }), { status: 200 });
  if (/treaty\/119\?/.test(u)) return new Response(JSON.stringify({ treaties: [{ congressReceived: 119, number: 2, suffix: '' }, { congressReceived: 119, number: 1, suffix: '' }] }), { status: 200 });
  if (/treaty\/118\?/.test(u)) return new Response(JSON.stringify({ treaties: [{ congressReceived: 118, number: 2, suffix: '' }] }), { status: 200 });
  if ((m = u.match(/treaty\/(\d+)\/(\d+)\/actions/))) {
    const done = m[1] === '118';
    return new Response(JSON.stringify({ actions: [{ actionDate: '2024-12-18', text: 'Received in the Senate and referred to the Committee on Foreign Relations.' }, ...(done ? [{ actionDate: '2025-02-01', text: 'Resolution of ratification agreed to in Senate by Yea-Nay Vote. 80 - 10.' }] : [])] }), { status: 200 });
  }
  if ((m = u.match(/treaty\/(\d+)\/(\d+)\?/))) return new Response(JSON.stringify({ treaty: [{ congressReceived: Number(m[1]), number: Number(m[2]), suffix: '', topic: 'Taxation', transmittedDate: '2026-09-14T00:00:00Z', countriesParties: [{ name: 'Croatia' }], titles: [{ title: `Treaty ${m[1]}-${m[2]}`, titleType: 'Treaty - Short Title' }] }] }), { status: 200 });
  return new Response('', { status: 404 });
};
const store = new Map();
const kv = () => ({ get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async () => {}, list: async () => ({ keys: [] }) });
const ask = async (path, env) => { const r = await worker.fetch(new Request('https://api.evanhollander.org/senate-floor/api' + path), env); return { status: r.status, body: await r.json() }; };

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await ok('no key is a 503 and says why, never an empty week', async () => {
  const r = await ask('/senate/committee-meetings', { HLS_CACHE: kv() });
  assert.strictEqual(r.status, 503);
  assert.match(r.body.error, /no Congress\.gov key/);
});

const env = { CONGRESS_API_KEY: 'k', HLS_CACHE: kv() };

await ok('75 meetings are listed: thirty records are read in the first run and the rest are said to be left', async () => {
  calls = [];
  const r = await ask('/senate/committee-meetings', env);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls.filter((c) => /senate\/\d+\?/.test(c)).length, 30);
  assert.strictEqual(r.body.pending, 45);
  assert.ok(calls.length <= 40, 'within the subrequest budget: ' + calls.length);
});

await ok('later runs read what is left and then nothing; the answer is the first day with a meeting, in Eastern time', async () => {
  // an answer is kept for two minutes in memory, so the clock is moved on between asks
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => t;
  let r;
  try {
    for (let i = 0; i < 4; i++) { t += 3 * 60 * 1000; calls = []; r = await ask('/senate/committee-meetings', env); }
  } finally { Date.now = realNow; }
  assert.strictEqual(r.body.pending, 0);
  assert.strictEqual(calls.filter((c) => /senate\/\d+\?/.test(c)).length, 0, 'nothing read twice');
  assert.strictEqual(r.body.events.length, 1, 'tomorrow\'s, not the day after\'s and not the ones ten days out');
  assert.strictEqual(r.body.events[0].id, '500001');
  assert.match(r.body.events[0].time, /^[12]:30 PM$/, '18:30 UTC is 2:30 PM in daylight time and 1:30 PM in winter');
});

await ok('treaties: both Congresses are listed, each read with its actions, and the ratified one is not pending', async () => {
  const r = await ask('/senate/treaties', env);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.treaties.length, 3);
  const by = Object.fromEntries(r.body.treaties.map((t) => [t.id, t.pending]));
  assert.deepStrictEqual(by, { 'Treaty Doc. 119-2': true, 'Treaty Doc. 119-1': true, 'Treaty Doc. 118-2': false });
});

console.log(`\n${n} passed`);
