#!/usr/bin/env node
// Reads the captions out of a few segments of an archived day with lib/replay-cc.js and prints where the caption file sits against the video there.
//   node dev/replay-cc-probe.mjs <hls manifest url> <captions.vtt url> <media seconds> [window seconds]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CC = require('../lib/replay-cc.js'), R = require('../lib/replay.js');
const [hls, vtt, at, win = '40'] = process.argv.slice(2);
const base = hls.replace(/manifest\.m3u8.*$/, '');
const head = await (await fetch(base + 'video_4.m3u8', { headers: { Range: 'bytes=0-400' } })).text();
const path = CC.rendition(head);
const cues = R.parseVtt(await (await fetch(vtt)).text());
const first = Math.floor((+at - +win / 2) / 2), n = Math.ceil(+win / 2);
const t0 = Date.now();
const segs = await Promise.all(Array.from({ length: n }, (_, i) => fetch(`${base}${path}${first + i}.m4s`).then((r) => r.arrayBuffer()).then((b) => ({ i: first + i, b }))));
const frags = [];
for (const s of segs) { const c = CC.segmentCaptions(s.b); for (const x of c.text) frags.push({ t: x.t, text: x.text }); }
console.log(`${n} segments in ${Date.now() - t0} ms, ${frags.length} caption lines`);
console.log(frags.slice(0, 6));
console.log(R.anchorsFrom(frags, cues));
