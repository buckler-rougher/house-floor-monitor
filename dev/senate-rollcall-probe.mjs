#!/usr/bin/env node
//
// Does the Senate caption track carry a roll call vote, or go silent through it?
//
//   node dev/senate-rollcall-probe.mjs --minutes=240 --interval=20
//   node dev/senate-rollcall-probe.mjs --clip=4948        # replay an archived clip
//
// WHY THIS EXISTS
// On 22 Dec 2022 the Senate's own caption track went silent for the whole of
// every roll call. Fourteen votes; ten of them had zero caption lines in the
// eight minutes before the result was announced, the longest gap being 1,010
// seconds. The clerk announces each senator's vote aloud, but none of it is
// transcribed: the captions carry the Chair's formula going in and the final
// tally coming out, and nothing in between.
//
// That measurement is from the last era the Senate self-archived. Both public
// Granicus archives stop in early 2023 (view_id=2 ends 30 Dec 2022, view_id=12
// ends 31 Jan 2023) and senate.gov now sends the public to C-SPAN for past
// proceedings, so the 2022 sample cannot be refreshed after the fact. The only
// way to know whether the silence is still there is to watch a live session.
//
// WHAT A RESULT MEANS
//   lines > 0 during the roll call  ->  they caption it now. Parse the captions,
//                                       the way the House board already does.
//                                       No speech recognition needed.
//   lines == 0                      ->  the 2022 behaviour holds. A live tally
//                                       would have to come from the audio, and
//                                       then the question is whether the audio
//                                       is reachable at all (see the probe below).
//
// THE AUDIO PROBE. archive-stream.granicus.com answers 403 "Request blocked" to
// this laptop -- on the playlist, on a bogus path, and on the host root alike,
// which is a WAF rule against the caller rather than anything about the file. A
// CI runner leaves from a different address, so each run records what the media
// host says to it. That is the whole test: if a runner gets through, the 2022
// archive becomes a labelled backtest set (16 roll calls with official
// member-level XML to score against) without waiting for another session.

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const UA = 'Mozilla/5.0 (compatible; HouseMonitor/1.0; +https://house-floor.evanhollander.org)';
const HOST = 'https://senate.granicus.com';
const LIVE_VIEW = 16;

const MINUTES  = Number(arg('minutes', 240));
const INTERVAL = Number(arg('interval', 20)) * 1000;
const REPLAY   = arg('clip', '');
const OUT      = arg('out', 'senate-rollcall.jsonl');

const log = [];
const say = (line) => { console.log(line); log.push(line); };
const jsonl = [];
const record = (obj) => jsonl.push(JSON.stringify({ at: new Date().toISOString(), ...obj }));

async function get(url, timeoutMs = 30_000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  return { status: r.status, ok: r.ok, text: r.ok ? await r.text() : '' };
}

// Granicus serves the caption track as a rolling cumulative line: each entry
// repeats the line so far plus one more word. Collapse back to whole lines.
function collapse(raw) {
  const out = [];
  let cur = '', t0 = 0;
  for (const e of raw) {
    const txt = e.text || '';
    if (cur && txt.startsWith(cur)) { cur = txt; continue; }
    if (cur === txt) continue;
    if (cur) out.push({ t: t0, text: cur });
    cur = txt; t0 = parseFloat(e.time);
  }
  if (cur) out.push({ t: t0, text: cur });
  return out;
}

async function captionLines(clipId) {
  const r = await get(`${HOST}/JSON.php?clip_id=${clipId}`, 90_000);
  if (!r.ok) return null;
  let parsed;
  try { parsed = JSON.parse(r.text); } catch { return null; }
  return collapse(parsed?.[0] || []);
}

// The live publisher shows a holding graphic when nothing is playing, and embeds
// a clip once the chamber is up. Both player URL shapes are in use, so accept
// either rather than guessing which one this session gets.
async function discoverLiveClip() {
  const r = await get(`${HOST}/ViewPublisher.php?view_id=${LIVE_VIEW}`);
  if (!r.ok) return { clip: null, why: `publisher HTTP ${r.status}` };
  if (/No Event Playing|640_360_out\.jpg/i.test(r.text)) return { clip: null, why: 'no event playing' };
  const m = r.text.match(/clip_id=(\d+)/) || r.text.match(/\/player\/clip\/(\d+)/);
  return m ? { clip: m[1], why: 'live' } : { clip: null, why: 'live but no clip id found' };
}

// What does the media host say to whoever is running this?
async function probeMedia(clipId) {
  const out = { clipId };
  try {
    const p = await get(`${HOST}/MediaPlayer.php?view_id=${clipId === REPLAY ? 2 : LIVE_VIEW}&clip_id=${clipId}`);
    const m = p.text.match(/https?:\/\/[^"'<>\s]+\.m3u8[^"'<>\s]*/);
    out.manifest = m ? m[0] : null;
  } catch (e) { out.playerError = String(e.message); }
  if (!out.manifest) return out;
  try {
    const r = await fetch(out.manifest, { headers: { 'User-Agent': UA, Referer: `${HOST}/` }, signal: AbortSignal.timeout(25_000) });
    out.mediaStatus = r.status;
    out.mediaOk = r.ok;
    if (r.ok) out.manifestHead = (await r.text()).slice(0, 300);
  } catch (e) { out.mediaError = String(e.message); }
  return out;
}

const ROLL_START = /CALL THE ROLL/i;
const TALLY      = /YEAS ARE\s+([A-Z0-9]+)[,.]?\s+THE NAYS ARE\s+([A-Z0-9]+)/i;

// The Chair sometimes reads small counts as words: "THE NAYS ARE EIGHT".
const WORDS = { ZERO:0, ONE:1, TWO:2, THREE:3, FOUR:4, FIVE:5, SIX:6, SEVEN:7,
                EIGHT:8, NINE:9, TEN:10, ELEVEN:11, TWELVE:12 };
const num = (v) => (/^\d+$/.test(v) ? v : (WORDS[v.toUpperCase()] ?? v));

// Measure the silence, not the anchor.
//
// The first version of this keyed off "THE CLERK WILL CALL THE ROLL" and was
// wrong twice over: that phrase was captioned for only 1 of the 15 votes on
// 22 Dec 2022, and the one match counted the tail of the Chair's own formula as
// roll call content, which flipped the verdict. What actually distinguishes a
// captioned roll call from a silent one is whether ANY speech is transcribed in
// the minutes before the result, so that is what gets counted.
//
// Lines inside the last 30 seconds are excluded: Granicus emits the tally
// sentence itself as several overlapping rolling lines, and those are the
// result, not the roll call.
function scoreTrack(lines) {
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].text.match(TALLY);
    if (!m) continue;
    const tallyAt = lines[i].t;
    if (rows.length && tallyAt - rows[rows.length - 1].tallyAt < 60) continue;
    rows.push({
      tallyAt,
      gapBefore: Math.round(tallyAt - lines[i - 1].t),
      linesInWindow: lines.filter((l) => l.t < tallyAt - 30 && l.t > tallyAt - 480).length,
      yeas: num(m[1]), nays: num(m[2]),
    });
  }
  return rows;
}

const hms = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function report(rows) {
  if (!rows.length) { say('  no vote result captured'); return; }
  say('  tally     result at    silence before it   caption lines in the 8 min before');
  for (const r of rows) {
    say(`  ${String(r.yeas).padStart(3)}-${String(r.nays).padEnd(3)}  ${hms(r.tallyAt)}   ${String(r.gapBefore).padStart(5)}s            ${String(r.linesInWindow).padStart(3)} lines`);
  }
  const silent = rows.filter((r) => r.linesInWindow === 0).length;
  say('');
  say(`  VERDICT: ${silent}/${rows.length} roll calls captioned NOTHING in the 8 minutes`);
  say(`  before the result was read.`);
  say(silent === rows.length
    ? '  The 2022 silence holds. A live tally would have to come from the audio.'
    : silent === 0
      ? '  Roll call content IS being captioned now. Parse the captions; no ASR needed.'
      : '  Mixed. Read the captured lines before concluding either way.');
}

// ── Replay mode: score an archived clip, no waiting ──────────────────────────
if (REPLAY) {
  say(`Replaying archived clip ${REPLAY}`);
  const lines = await captionLines(REPLAY);
  if (!lines) { say('  no caption data for that clip'); process.exit(0); }
  say(`  ${lines.length} caption lines`);
  report(scoreTrack(lines));
  const probe = await probeMedia(REPLAY);
  record({ kind: 'media-probe', ...probe });
  say('');
  say(`  media host: ${probe.manifest ? probe.manifest.slice(0, 70) + '...' : '(no manifest found)'}`);
  say(`  answered:   ${probe.mediaStatus ?? probe.mediaError ?? 'n/a'}${probe.mediaOk ? '  <-- REACHABLE from here' : ''}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, log.join('\n') + '\n');
    fs.writeFileSync(OUT, jsonl.join('\n') + '\n');
  }
  process.exit(0);
}

// ── Live mode ────────────────────────────────────────────────────────────────
say(`Watching the Senate floor caption track for a roll call.`);
say(`Window ${MINUTES} min, polling every ${INTERVAL / 1000}s. Started ${new Date().toISOString()}`);
if (process.env.GITHUB_EVENT_NAME) say(`Triggered by ${process.env.GITHUB_EVENT_NAME}${process.env.GITHUB_EVENT_SCHEDULE ? ` (cron ${process.env.GITHUB_EVENT_SCHEDULE})` : ''}`);
say('');

const deadline = Date.now() + MINUTES * 60_000;
let clip = null, seen = 0, probed = false, sawRoll = false;

while (Date.now() < deadline) {
  try {
    if (!clip) {
      const d = await discoverLiveClip();
      record({ kind: 'discover', ...d });
      if (!d.clip) { await new Promise((r) => setTimeout(r, INTERVAL)); continue; }
      clip = d.clip;
      say(`Live clip ${clip} found at ${new Date().toISOString()}`);
    }

    const lines = await captionLines(clip);
    if (lines && lines.length > seen) {
      for (const l of lines.slice(seen)) {
        record({ kind: 'caption', clip, t: l.t, text: l.text });
        if (ROLL_START.test(l.text) && !sawRoll) { sawRoll = true; say(`  ${hms(l.t)}  ROLL CALL BEGINS`); }
      }
      seen = lines.length;
    }

    // Ask the media host what it thinks of this caller, once we have a clip.
    if (clip && !probed) {
      probed = true;
      const probe = await probeMedia(clip);
      record({ kind: 'media-probe', ...probe });
      say(`  media host answered ${probe.mediaStatus ?? probe.mediaError ?? 'n/a'} to this runner${probe.mediaOk ? '  <-- REACHABLE' : ''}`);
    }

    // Stop as soon as one roll call has run start to finish.
    const rows = lines ? scoreTrack(lines) : [];
    if (rows.length) { say(''); say('Captured a vote result.'); report(rows); break; }
  } catch (e) {
    record({ kind: 'error', message: String(e.message) });
  }
  await new Promise((r) => setTimeout(r, INTERVAL));
}

if (!sawRoll) { say(''); say('Window closed with no roll call seen. Either the Senate did not vote, or it never convened.'); }

if (process.env.GITHUB_STEP_SUMMARY) {
  const fs = await import('node:fs');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, log.join('\n') + '\n');
}
{
  const fs = await import('node:fs');
  fs.writeFileSync(OUT, jsonl.join('\n') + '\n');
}
