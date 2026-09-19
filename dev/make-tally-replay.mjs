#!/usr/bin/env node
//
// Build the tally sequence the demo replays over SSE.
//
//   node dev/make-tally-replay.mjs
//
// The static vote fixture is a single frozen snapshot, which shows the layout
// but not the thing the board is actually for: watching a close vote come in.
// This writes a sequence of `vote.tally` payloads the harness pushes on a timer.
//
// The lead has to change several times or the demo is just a progress bar, so
// the curve is built from hand-placed waypoints that deliberately cross, with
// per-member jitter on top. Members are drawn party-weighted (Republicans
// mostly yea, Democrats mostly nay, a handful of crossovers each way) so the
// party rows move the way a real board does.

import { writeFileSync } from 'node:fs';

const FINAL = {
  red:   { yeas: 208, nays: 8,   nv: 2 },   // 218 Republicans
  blue:  { yeas: 9,   nays: 205, nv: 0 },   // 214 Democrats
  white: { yeas: 0,   nays: 1,   nv: 0 },   //   1 Independent
};
const TOTAL_YEA = 217, TOTAL_NAY = 214;

// (progress 0-1, yea, nay) — crossings are intentional.
const WAYPOINTS = [
  [0.00,   0,   0],
  [0.08,  11,  14],   // nay ahead
  [0.16,  35,  31],   // yea takes it
  [0.26,  57,  63],   // nay back
  [0.38,  95,  91],   // yea
  [0.50, 132, 138],   // nay
  [0.62, 171, 167],   // yea
  [0.74, 194, 198],   // nay
  [0.86, 207, 205],   // yea
  [0.94, 212, 212],   // dead tie
  [1.00, TOTAL_YEA, TOTAL_NAY],
];

const lerp = (a, b, t) => a + (b - a) * t;
function at(p) {
  for (let i = 1; i < WAYPOINTS.length; i++) {
    const [p1, y1, n1] = WAYPOINTS[i], [p0, y0, n0] = WAYPOINTS[i - 1];
    if (p <= p1) {
      const t = (p - p0) / (p1 - p0);
      return [Math.round(lerp(y0, y1, t)), Math.round(lerp(n0, n1, t))];
    }
  }
  return [TOTAL_YEA, TOTAL_NAY];
}

// Split a running total across parties in the ratio each party finishes at, so
// the per-party rows stay plausible the whole way down rather than only at the end.
const split = (running, final, totalFinal) =>
  totalFinal === 0 ? 0 : Math.min(final, Math.round(running * (final / totalFinal)));

// app.js updates the big counts on every tally but throttles the full render --
// threshold, quorum, floor grid -- to 2s. At 400ms a frame those panels moved
// once per five frames while the numbers ran away from them, which reads as the
// panels being broken. Real DomeWatch tallies arrive seconds apart, where that
// throttle is invisible, so the replay now runs at that cadence instead: every
// frame gets a full render, and the whole vote still takes about 90 seconds.
const FRAMES = 40;
const INTERVAL_MS = 2200;

// app.js ticks the clock off wall time between tallies and resyncs to whatever
// each one carries. A nominal 15-minute countdown compressed into 90 seconds of
// replay therefore dropped ~22s on every sync, and the timer visibly jumped
// backwards instead of running. Deriving it from the cadence makes one replayed
// second equal one real second, so each sync is a correction of milliseconds and
// the clock just runs. It reads as a vote in its closing stretch, which is when
// a board is worth watching anyway.
const VOTE_SECONDS = Math.round((FRAMES * INTERVAL_MS) / 1000);
const frames = [];
for (let i = 0; i <= FRAMES; i++) {
  const p = i / FRAMES;
  const [yea, nay] = at(p);
  // Round the minority shares, then let the party that finishes largest on that
  // side absorb the remainder -- three independent round() calls do not sum to
  // the running total, and the board would show party rows that disagree with it.
  const rY = split(yea, FINAL.red.yeas, TOTAL_YEA);
  const bY = yea - rY;                                   // Democrats absorb yea remainder
  const rN = split(nay, FINAL.red.nays, TOTAL_NAY);
  const wN = split(nay, FINAL.white.nays, TOTAL_NAY);
  const bN = nay - rN - wN;                              // Democrats absorb nay remainder
  const secs = Math.max(0, Math.round(VOTE_SECONDS * (1 - p)));
  const str = n => (n ? String(n) : '');
  frames.push({
    yeas: yea, nays: nay,
    counts: {
      blue:  { yeas: str(bY), nays: str(bN), present: '', not_voting: str(214 - bY - bN) },
      red:   { yeas: str(rY), nays: str(rN), present: '', not_voting: str(218 - rY - rN) },
      white: { yeas: '',      nays: str(wN), present: '', not_voting: str(1 - wN) },
      totals:{ yeas: String(yea), nays: String(nay), present: '', not_voting: String(433 - yea - nay) },
    },
    timer: { seconds_remaining: secs, value: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` },
  });
}

// Report the lead changes so a bad curve is obvious at build time.
let lead = null, changes = 0;
for (const f of frames) {
  if (f.yeas === f.nays) continue;
  const l = f.yeas > f.nays ? 'Y' : 'N';
  if (lead && l !== lead) changes++;
  lead = l;
}
writeFileSync('dev/fixtures/demo/tally-replay.json', JSON.stringify({
  intervalMs: INTERVAL_MS,
  bill: { id: '4795', number: '4795', title: 'Protect Economic and Academic Freedom Act of 2026' },
  rollCall: '295',
  question: 'H R 4795 - On Passage',
  frames,
}, null, 1));
console.log(`  ${frames.length} frames, ${changes} lead changes, final ${TOTAL_YEA}-${TOTAL_NAY}`);
