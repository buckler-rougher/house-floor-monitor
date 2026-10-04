#!/usr/bin/env node
//
// End to end: the Worker's /senate/quorum against a mocked caption stream whose text is the
// Congressional Record's wording, a few segments per pass, with a fake clock. The modes run in
// the Worker (lib/senate-modes.js), so this is the test that a tab will be told the right thing:
// that the leaders' daily remarks are the first recognition after the opening and no later one,
// that a leader falls back to morning business, and that the wrap-up runs to adjournment.
// No network: every fetch is the mock below. Not captions: the text is the Record's.
import assert from 'node:assert';
import worker from '../worker.js';

let clock = Date.parse('2026-09-30T14:00:00Z');
const realNow = Date.now; Date.now = () => clock;

const BASE = 'https://www-senate-gov-media-srs.akamaized.net/hls/live/2096634/stv/stv093026/master/';
let segs = [];            // [{name, text}]
const vtt = (t) => `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${t}\n`;
globalThis.fetch = async (u) => {
  u = String(u);
  const ok = (body) => new Response(body, { status: 200 });
  if (u.includes('floor_schedule.json')) return ok('filename=stv093026');
  if (u.endsWith('stv093026/master.m3u8')) return ok('#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",URI="master/text_1.m3u8"\n');
  if (u.endsWith('master/text_1.m3u8')) return ok('#EXTM3U\n' + segs.map((s) => s.name).join('\n') + '\n');
  const seg = segs.find((s) => u.endsWith(s.name));
  if (seg) return ok(vtt(seg.text));
  return new Response('', { status: 404 });
};

let n = 0;
const push = (text) => { segs.push({ name: `text_1_${String(++n).padStart(5, '0')}.vtt`, text }); };
const env = { HLS_CACHE: undefined };
async function poll() {
  clock += 6000;                       // a tab polls every few seconds
  const r = await worker.fetch(new Request('https://api.evanhollander.org/senate-floor/api/senate/quorum'), env);
  const d = await r.json();
  return d.mode;
}
let checked = 0;
const step = async (label, expectMode, text, extra = {}) => {
  if (text) push(text);
  const m = await poll();
  assert.strictEqual(m ? m.mode : null, expectMode, `${label}: expected ${expectMode}, got ${m && m.mode}`);
  for (const [k, v] of Object.entries(extra)) assert.strictEqual(m[k], v, `${label}: ${k}`);
  checked++;
  console.log('ok  ' + label);
};

await step('quiet floor', null);
await step('a leader recognized before the day opened is no mode', null, 'The majority leader is recognized.');
await step('prayer', 'prayer', 'The Chaplain, Dr. Barry C. Black, offered the following prayer: Let us pray.');
await step('amen ends it', null, 'IN YOUR NAME WE PRAY. AMEN.');
await step('pledge', 'pledge', 'I pledge allegiance to the Flag of the United States of America');
await step('end of the pledge', null, 'one nation under God, indivisible, with liberty and justice for all.');
await step('morning business, with the chair\'s limit', 'morning-business', 'Under the previous order, the Senate will be in a period of morning business, with Senators permitted to speak therein for up to 10 minutes each.', { limit: 10 });
await step('the majority leader\'s daily remarks, and who', 'leader', 'The ACTING PRESIDENT pro tempore. The majority leader is recognized. MR. THUNE: Mr. President, ...', { which: 'Majority Leader', first: 'THUNE' });
await step('then the Democratic leader\'s', 'leader', 'The Democratic leader is recognized. MR. SCHUMER: Mr. President, ...', { which: 'Democratic Leader', first: 'SCHUMER' });
await step('a senator is recognized: back to morning business', 'morning-business', 'The Senator from Iowa is recognized.');
await step('the majority leader again mid-day is no mode', 'morning-business', 'The majority leader is recognized.');
await step('morning business closed', null, 'The PRESIDING OFFICER. Morning business is closed.');
await step('the wrap-up', 'wrap-up', 'Mr. THUNE. Mr. President, I ask unanimous consent that when the Senate completes its business today, it stand adjourned, to then convene for pro forma session only');
await step('adjourned', 'wrap-up', 'Under the previous order, the Senate stands adjourned until 10:30 a.m. tomorrow.');
clock += 60000;
assert.strictEqual((await poll()), null, 'after adjournment and the hold');
Date.now = realNow;
console.log(`\n${checked + 1} passed`);
process.exit(0);
