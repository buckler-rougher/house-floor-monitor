#!/usr/bin/env node
//
// Replay a recorded Senate day through the same readers the Worker runs (lib/senate-modes.js and lib/senate-call.js), one caption segment at a time, and print what the board would have
// shown: the modes as they began and ended, each call (a vote or a quorum call) with what it counted against what the chair announced, and the question stated before each.
//
//   node dev/replay-senate-captions.mjs <folder with text_1_NNNNN.vtt> [--json=out.json] [--quiet]
//
// The folder is one day of the senate-captions-<run id> artifact (dev/record-senate-captions.mjs, `.github/workflows/record-senate-captions.yml`); see docs/senate-captions.md for the procedure.
// Segment N starts 12 s * (N - 1) into the stream; the replay clock is that, so a mode's "since" and a call's "lastAt" are stream time, not wall time.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = new URL('.', import.meta.url).pathname;
const SC = require(join(here, '../lib/senate-call.js'));
const SM = require(join(here, '../lib/senate-modes.js'));

const dir = process.argv[2];
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=');
if (!dir) { console.error('usage: node dev/replay-senate-captions.mjs <day folder> [--json=out.json] [--quiet]'); process.exit(2); }
const quiet = process.argv.includes('--quiet');

const segs = readdirSync(dir).filter((f) => /^text_1_\d+\.vtt$/.test(f)).sort();
const T0 = Date.UTC(2026, 0, 1);
const clock = (ms) => { const s = Math.round((ms - T0) / 1000); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

let modes = SM.empty(); let call = SC.emptyCall();
const events = []; const calls = [];
let lastMode = null, lastCallId = null, lastSpeaker = null, cur = null;
const log = (t, kind, text, extra) => { events.push({ at: clock(t), kind, text, ...(extra || {}) }); if (!quiet) console.log(`${clock(t)}  ${kind.padEnd(8)} ${text}`); };

let segCount = 0;
for (const f of segs) {
  const n = Number(f.match(/_(\d+)\.vtt/)[1]);
  const heard = T0 + n * 12_000;   // the segment has finished by the time it is read, as in the Worker
  const flat = SC.cueText(readFileSync(join(dir, f), 'utf8'));
  segCount++;
  modes = SM.feed(modes, flat, heard);
  call = SC.expire(call, heard);
  call = SC.feedVtt(call, readFileSync(join(dir, f), 'utf8'), heard);
  const sp = call.speaker;
  if (sp && sp.kind === 'member') modes = SM.speaker(modes, sp.label, heard);
  modes = SM.settle(modes, heard);

  const m = SM.current(modes, heard);
  const sig = m ? `${m.mode}${m.which ? ':' + m.which : ''}${m.bill ? ':' + m.bill : ''}` : '-';
  if (sig !== lastMode) { log(heard, 'mode', sig + (m && m.first ? ` (${m.first})` : '')); lastMode = sig; }

  if (call.callId && call.callId !== lastCallId) {
    if (cur) calls.push(cur);
    cur = { id: clock(call.callId), seg: n, kind: call.kind, question: call.question || null, summary: null, ended: null };
    log(heard, 'call', `${call.kind} begins${call.question ? ' on: ' + call.question.slice(0, 90) : ''}`);
    lastCallId = call.callId;
  }
  if (cur && call.callId === lastCallId) {
    cur.summary = SC.summarize(call); cur.kind = call.kind; cur.question = call.question || cur.question;
    if (call.ended && !cur.ended) { cur.ended = call.ended; log(heard, 'ended', `${call.kind}: ${call.ended.how}${call.ended.word ? ' (' + call.ended.word + ')' : ''}; counted ${call.kind === 'vote' ? `${cur.summary.ayes} aye, ${cur.summary.nos} no, ${cur.summary.present} present` : cur.summary.count + ' names'}${call.ended.yeas != null ? `; chair read ${call.ended.yeas}-${call.ended.nays}${call.ended.outcome ? ' ' + call.ended.outcome : ''}` : ''}`); }
  }
  if (sp && (sp.label !== lastSpeaker)) { lastSpeaker = sp.label; if (!quiet && process.argv.includes('--speakers')) log(heard, 'speaker', `${sp.kind}: ${sp.label}`); }
}
if (cur) calls.push(cur);

console.log(`\n${segCount} segments. ${calls.length} calls (${calls.filter((c) => c.kind === 'vote').length} votes, ${calls.filter((c) => c.kind === 'quorum').length} quorum calls); ${events.filter((e) => e.kind === 'mode').length} mode changes.`);
for (const c of calls) {
  const s = c.summary || {};
  console.log(`  ${c.id} ${String(c.kind).padEnd(6)} ${c.kind === 'vote' ? `${s.ayes}-${s.nos}${s.present ? ` (${s.present} present)` : ''}` : `${s.count} names${s.quorumMet ? ', quorum met' : ''}`}  ended: ${c.ended ? c.ended.how + (c.ended.word ? ' (' + c.ended.word + ')' : '') + (c.ended.yeas != null ? ` ${c.ended.yeas}-${c.ended.nays}` : '') : 'never heard'}${c.question ? '  | ' + c.question.slice(0, 80) : ''}`);
}
if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ events, calls }, null, 1));
