#!/usr/bin/env node
// Contract test for lib/replay.js: the time machine's clocks. No network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../lib/replay.js');
let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const ev = (d) => JSON.parse(fs.readFileSync(path.join(__dirname, 'replay', `event-${d}.json`), 'utf8'))[0];

test('Eastern wall time to UTC, either side of the clock change', () => {
  assert.strictEqual(new Date(R.etMs('2026-09-16T09:00:00.000')).toISOString(), '2026-09-16T13:00:00.000Z');   // EDT
  assert.strictEqual(new Date(R.etMs('2026-01-14T09:00:00')).toISOString(), '2026-01-14T14:00:00.000Z');       // EST
  assert.strictEqual(new Date(R.etMs('2026-03-08T01:30:00')).toISOString(), '2026-03-08T06:30:00.000Z');       // before the spring change
  assert.strictEqual(new Date(R.etMs('2026-03-08T03:30:00')).toISOString(), '2026-03-08T07:30:00.000Z');       // after it
  assert.ok(Number.isNaN(R.etMs('soon')));
});

test('a real archive record: east HLS without its #t fragment, east captions, the event and asset times', () => {
  const f = R.pickFiles(ev('20260916'));
  assert.strictEqual(f.hls, 'https://houseliveprod-f9h4cpb9dyb8gegg.a01.azurefd.net/east/2026-09-16T08-51-54/manifest.m3u8');
  assert.strictEqual(f.vtt, 'https://houseliveprod-f9h4cpb9dyb8gegg.a01.azurefd.net/east/2026-09-16T08-51-54/captions.vtt');
  assert.strictEqual(new Date(f.startMs).toISOString(), '2026-09-16T13:00:00.000Z');
  assert.strictEqual(new Date(f.assetStartMs).toISOString(), '2026-09-16T12:51:54.000Z');
  assert.strictEqual(f.live, false);
  assert.strictEqual(f.name, 'LEGISLATIVE DAY OF SEPTEMBER 16, 2026');
});

test('an older record whose video folder is "_Download" and captions folder is not', () => {
  const f = R.pickFiles(ev('20240319'));
  assert.ok(f.hls.includes('_Download/manifest.m3u8'));
  assert.ok(f.vtt.endsWith('2024-03-19T11-54-37/captions.vtt'));
  assert.strictEqual(R.pickFiles({}), null);
  assert.strictEqual(R.pickFiles({ asset: { files: [] } }), null);
});

const VTT = '﻿WEBVTT\r\n\r\nNOTE CAPTIONS TIME OFFSET: 00:03:57.914\r\n\r\n00:00:10.000 --> 00:00:13.537\r\nCHAIR LAYS BEFORE THE HOUSE. A\r\n\r\n01:02:03.500 --> 01:02:05.000\r\nUNIDENTIFIED SPEAKER: MR. LANDSMAN VOTES\r\nI.\r\n\r\n';
test('a caption file: CRLF, a BOM, a NOTE header, hours, two-line cues', () => {
  const c = R.parseVtt(VTT);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].t, 10);
  assert.strictEqual(c[0].text, 'CHAIR LAYS BEFORE THE HOUSE. A');
  assert.strictEqual(c[1].t, 3723.5);
  assert.strictEqual(c[1].text, 'UNIDENTIFIED SPEAKER: MR. LANDSMAN VOTES I.');
});

// the video's own captions, as the text track gives them: "SPEAKER 10:" for the file's "UNIDENTIFIED SPEAKER:", and every roll-up line more than once
const FILE = [
  { t: 34610, end: 34612, text: 'UNIDENTIFIED SPEAKER: MR. LANDSMAN VOTES I.' },
  { t: 34620, end: 34622, text: 'ALL RIGHT, SAM, WE ARE ALL TOGETHER. THAT WAS.' },
  { t: 34623, end: 34625, text: 'UNIDENTIFIED SPEAKER: THE YEAS ARE 352.' },
  { t: 34625, end: 34627, text: 'THE NAYS ARE 72. THE BILL IS' },
  { t: 40000, end: 40002, text: 'THE NAYS ARE 72. THE BILL IS' },          // the same words twice in a day: not an anchor
  { t: 34630, end: 34632, text: 'YES.' },
];
const INBAND = [
  { t: 34794.8, text: 'SPEAKER 10: MR. LANDSMAN VOTES I.' },
  { t: 34793.4, text: 'SPEAKER 10: MR. LANDSMAN VOTES I.' },
  { t: 34803.9, text: 'ALL RIGHT, SAM, WE ARE ALL TOGETHER. THAT WAS.' },
  { t: 34806.9, text: 'SPEAKER 16: THE YEAS ARE 352.' },
  { t: 34808.2, text: 'THE NAYS ARE 72. THE BILL IS' },
  { t: 34810, text: 'YES.' },
];
test('anchors: the median shift of the video lines that appear once in the file; the earliest cue of a repeated line; short and repeated lines ignored', () => {
  const a = R.anchorsFrom(INBAND, FILE);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].n, 3);
  assert.ok(Math.abs(a[0].shift - 183.4) < 0.6, String(a[0].shift));
  assert.deepStrictEqual(R.anchorsFrom([], FILE), []);
  assert.deepStrictEqual(R.anchorsFrom([{ t: 5, text: 'NOT IN THE FILE AT ALL, NOT ANYWHERE' }], FILE), []);
});

test('a stray match cannot move the shift: the biggest cluster wins', () => {
  const lone = [{ t: 5000, text: 'ALL RIGHT, SAM, WE ARE ALL TOGETHER. THAT WAS.' }];
  const a = R.anchorsFrom(INBAND.slice(0, 2).concat(INBAND.slice(3)).concat(lone), FILE);
  assert.ok(Math.abs(a[0].shift - 183.4) < 0.6);
});

test('the timeline: wall clock from the event start, video time from the nearest anchor (a step, not a slope)', () => {
  const f = R.pickFiles(ev('20260916'));
  const tl = R.timeline({ startMs: f.startMs, vttCues: FILE, anchors: [{ c: 12000, shift: 215.8, n: 20 }, { c: 36000, shift: 183.0, n: 20 }] });
  assert.strictEqual(tl.shiftAt(500), 215.8);
  assert.strictEqual(tl.shiftAt(20000), 215.8);
  assert.strictEqual(tl.shiftAt(30000), 183.0);
  assert.strictEqual(tl.mediaFromCaption(34610), 34610 + 183.0);
  assert.ok(Math.abs(tl.captionFromMedia(34610 + 183.0) - 34610) < 1e-6);
  // 18:49 EDT is 9:49:00 into captions that began at 09:00:00
  assert.strictEqual(tl.captionFromWall(R.etMs('2026-09-16T18:49:00')), 35340);
  assert.strictEqual(tl.wallFromCaption(35340), R.etMs('2026-09-16T18:49:00'));
  assert.strictEqual(tl.wallFromMedia(tl.mediaFromWall(R.etMs('2026-09-16T12:00:00'))), R.etMs('2026-09-16T12:00:00'));
  assert.strictEqual(tl.uncertainAt(12500), false);
  assert.strictEqual(tl.uncertainAt(24000), true, 'more than twenty minutes from any anchor');
  assert.strictEqual(R.timeline({ startMs: 0, vttCues: [] }).uncertainAt(10), true);
  assert.strictEqual(R.timeline({ startMs: 0, vttCues: [], defaultShift: 200 }).mediaFromCaption(10), 210);
});

test('anchors are added as they are seen, and the better supported one stands when the same place is seen twice', () => {
  const tl = R.timeline({ startMs: 0, vttCues: [], anchors: [{ c: 1000, shift: 100, n: 2 }] });
  tl.addAnchors([{ c: 1005, shift: 101, n: 9 }, { c: 5000, shift: 90, n: 4 }]);
  assert.deepStrictEqual(tl.anchors.map((a) => [a.c, a.shift]), [[1005, 101], [5000, 90]]);
});

test('snap: the matching caption line nearest the estimate, inside the window', () => {
  const cues = [{ t: 100, text: 'H.R. 7834 AS AMENDED' }, { t: 700, text: 'H.R. 7834 THE CLERK WILL REPORT' }, { t: 2000, text: 'H.R. 7834' }];
  const test7834 = (x) => /7834/.test(x);
  assert.strictEqual(R.snap(cues, 650, test7834, 600).t, 700);
  assert.strictEqual(R.snap(cues, 650, test7834, 20), null);
  assert.strictEqual(R.snap(cues, 650, (x) => /9999/.test(x), 600), null);
});

test('bill numbers as the captioner spells them: digits split by a full stop, number words, a number across a cue boundary', () => {
  const t = (id, text) => R.billMentions([id])(text);
  assert.ok(t('7834', 'UNIDENTIFIED SPEAKER: H.R. 7834, AS AMENDED.'));
  assert.ok(t('9576', 'H.R. 95. 76 A BILL TO ESTABLISH'));
  assert.ok(t('9576', 'ON PASSAGE OF H.R. 9576, ON'));
  assert.ok(t('10326', 'ON THE PASSAGE OF H.R. TEN 326, ON WHICH'));
  assert.ok(t('213', 'THE VOTE ON H.J. RES. TWO 13, ON WHICH THE YEAS'));
  assert.ok(!t('213', 'ON PASSAGE OF H.R. 9576, ON'));
  assert.ok(!t('213', 'H.R. 2134 AS AMENDED'), 'a longer number is another bill');
  assert.ok(!t('78', 'H.R. 7834'), 'a prefix is not the number');
  assert.ok(!t('213', 'THE HOUSE WILL COME TO ORDER 213'), 'no bill type, no bill');
  const cues = [{ t: 100, text: 'UNFINISHED BUSINESS IS THE VOTE ON H.R.' }, { t: 103, text: 'TEN 326, ON WHICH THE YEAS' }];
  assert.strictEqual(R.snap(cues, 100, R.billMentions(['10326']), 60).t, 100, 'found across the cue boundary');
});

test('clip: the Clerk entries that had happened by then', () => {
  const items = [{ timestamp: 300, d: 'c' }, { timestamp: 200, d: 'b' }, { timestamp: 100, d: 'a' }];
  assert.deepStrictEqual(R.clip(items, 250).map((x) => x.d), ['b', 'a']);
  assert.deepStrictEqual(R.clip(items, 50), []);
  assert.deepStrictEqual(R.clip(null, 50), []);
});

console.log(`replay: ${n} passed`);
