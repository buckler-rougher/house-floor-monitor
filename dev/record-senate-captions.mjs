#!/usr/bin/env node
//
// Record the Senate floor's caption track, for use when the Senate is out.
//
//   node dev/record-senate-captions.mjs --out=senate-captions --minutes=340
//
// WHY IT MUST RUN DURING THE SESSION
// The day's playlists (master/text_1.m3u8 and master/index_1.m3u8) only exist
// while the day's stream does: they 404 from the day after, though the master
// playlist lingers, so a session cannot be fetched afterwards. They are EVENT
// playlists, though -- every segment from number 1 stays listed until the
// stream ends -- so a recorder that starts late still gets the whole day, and
// two recorders that overlap simply save the same files.
//
// Where the URL comes from: see handleSenateHlsUrl in worker.js.
//
// WHAT IT WRITES to --out
//   <stvMMDDYY>/text_1_NNNNN.vtt  each 12-second caption segment, byte for byte
//   <day>/text_1.m3u8   the caption playlist as last seen
//   <day>/index_1.m3u8  the video playlist as last seen (segment N starts at
//                       12*(N-1) seconds into the stream)
//   <day>/captions.txt  every cue in order, prefixed with its segment number
//   record.log          what was seen, and when

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const OUT      = arg('out', 'senate-captions');
const MINUTES  = Number(arg('minutes', 340));
const INTERVAL = Number(arg('interval', 30)) * 1000;
const UA = 'Mozilla/5.0 (compatible; HouseMonitor/1.0; +https://house-floor.evanhollander.org)';
const BASE = arg('base', 'https://www-senate-gov-media-srs.akamaized.net/hls/live/2096634/stv/');

mkdirSync(OUT, { recursive: true });
const say = (line) => {
  const s = `${new Date().toISOString()}  ${line}`;
  console.log(s);
  appendFileSync(join(OUT, 'record.log'), s + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  return { status: r.status, text: r.ok ? await r.text() : '' };
}

// Which day's stream to watch. The schedule names the NEXT sitting as soon as
// the evening before, so a recorder that starts at 9 p.m. Eastern would be
// pointed at tomorrow while today's session is still going. So watch every
// plausible name -- the schedule's, and stv + MMDDYY for Eastern today and
// yesterday -- and record whichever of them has a live stream.
async function candidateNames() {
  const names = [];
  try {
    const r = await get('https://www.senate.gov/legislative/schedule/floor_schedule.json');
    const m = r.text.match(/filename=(stv\d{6})/);
    if (m) names.push(m[1]);
  } catch { /* the computed names below still cover it */ }
  for (const back of [0, 1]) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: '2-digit', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(Date.now() - back * 86_400_000)).map((x) => [x.type, x.value]));
    names.push(`stv${p.month}${p.day}${p.year}`);
  }
  return [...new Set(names)];
}

// Everything in captions.txt comes from the saved segments, so it can be
// rebuilt at any time and never depends on this run having seen them live.
//
// The segments are named text_1_00001.vtt: the rendition number, then the
// sequence. This used to look for text_00001.vtt, a name guessed before anyone
// had seen the real one, so every run from 29 September on listed a full day's
// playlist, matched none of it, saved nothing, and reported "0 segments" as if
// that were a quiet day. The playlists it kept showed about 3,100 segments each.
const SEGMENT = /^text_\d+_(\d+)\.vtt$/;

function buildTranscript(out) {
  const files = readdirSync(out).filter((f) => SEGMENT.test(f)).sort();
  const lines = [];
  for (const f of files) {
    const n = Number(f.match(SEGMENT)[1]);
    let inCue = false;
    for (const line of readFileSync(join(out, f), 'utf8').split(/\r?\n/)) {
      if (line.includes('-->')) { inCue = true; continue; }
      if (!line.trim()) { inCue = false; continue; }
      if (inCue) lines.push(`[${String(n).padStart(5, '0')}] ${line.trim()}`);
    }
  }
  writeFileSync(join(out, 'captions.txt'), lines.join('\n') + '\n');
  return { segments: files.length, lines: lines.length };
}

const names = await candidateNames();
say(`watching ${names.join(', ')}`);
const state = Object.fromEntries(names.map((n) => [n, { seen: false, ended: false, lastSay: 0 }]));

async function poll(name) {
  const st = state[name];
  const dir = `${BASE}${name}/master/`;
  const out = join(OUT, name);
  let pl;
  try { pl = await get(`${dir}text_1.m3u8`); } catch (e) { say(`${name}: playlist error: ${e.message}`); return; }

  if (pl.status === 200) {
    if (!st.seen) { say(`${name}: stream is live; playlist found`); mkdirSync(out, { recursive: true }); }
    st.seen = true;
    writeFileSync(join(out, 'text_1.m3u8'), pl.text);
    const segs = pl.text.split('\n').map((l) => l.trim()).filter((l) => SEGMENT.test(l));
    // A playlist that lists lines but matches none of them is the parser being
    // wrong, not a quiet day. Said loudly, once.
    if (!st.warned && !segs.length && /\.vtt/.test(pl.text)) {
      st.warned = true;
      say(`${name}: the playlist lists .vtt files and none match the expected name; the pattern is out of date`);
    }
    const fresh = segs.filter((f) => !existsSync(join(out, f)));
    for (let i = 0; i < fresh.length; i += 8) {
      await Promise.all(fresh.slice(i, i + 8).map(async (f) => {
        try {
          const r = await get(dir + f);
          if (r.status === 200) writeFileSync(join(out, f), r.text);
          else say(`${name}/${f}: HTTP ${r.status}`);
        } catch (e) { say(`${name}/${f}: ${e.message}`); }
      }));
    }
    try {
      const v = await get(`${dir}index_1.m3u8`);
      if (v.status === 200) writeFileSync(join(out, 'index_1.m3u8'), v.text);
    } catch { /* the video playlist is only for timing */ }
    if (fresh.length || Date.now() - st.lastSay > 10 * 60_000) {
      say(`${name}: ${segs.length} segments listed, ${fresh.length} new`);
      st.lastSay = Date.now();
    }
    if (pl.text.includes('#EXT-X-ENDLIST')) { say(`${name}: ENDLIST, the day is over`); st.ended = true; }
  } else if (st.seen) {
    say(`${name}: playlist gone (HTTP ${pl.status}) after being live, the day is over`);
    st.ended = true;
  }
}

const deadline = Date.now() + MINUTES * 60_000;
// Stop once every day that went live has finished. A name that never went live
// is not waited on past the deadline, but does not hold the job open by itself
// once another day has ended.
const done = () => {
  const live = names.filter((n) => state[n].seen);
  return live.length > 0 && live.every((n) => state[n].ended);
};
while (Date.now() < deadline && !done()) {
  for (const n of names) if (!state[n].ended) await poll(n);
  if (!done()) await sleep(INTERVAL);
}

for (const n of names.filter((x) => state[x].seen)) {
  const t = buildTranscript(join(OUT, n));
  say(`${n}: ${t.segments} segments, ${t.lines} caption lines saved to ${join(OUT, n)}/`);
}
if (!names.some((n) => state[n].seen)) say(`nothing went live within ${MINUTES} minutes; nothing recorded`);
