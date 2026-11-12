#!/usr/bin/env node
//
// Cut named ranges of segments out of a recorded Senate day into a test fixture, verbatim.
//
//   node dev/extract-senate-fixture.mjs <day folder> <out.json> name=FROM-TO [name=FROM-TO ...]
//   node dev/extract-senate-fixture.mjs /tmp/stv111026 test/senate-captions-2026-11-10.json opening=76-95 vitiated=1531-1624
//
// The output is the shape test/senate-captions-replay.test.js reads: { note, segments: { name: { from, vtt: [segment text, ...] } } }, each segment as the recorder saved it with the
// WEBVTT and X-TIMESTAMP-MAP header dropped. A segment the recorder did not save is an empty string, so the segments after it keep their place (segment N is 12 s * (N - 1) into the stream).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [, , dir, out, ...ranges] = process.argv;
if (!dir || !out || !ranges.length) { console.error('usage: node dev/extract-senate-fixture.mjs <day folder> <out.json> name=FROM-TO ...'); process.exit(2); }
const day = dir.replace(/\/$/, '').split('/').pop();
const doc = { note: `Verbatim WebVTT segments of the Senate floor captions (${day}), as dev/record-senate-captions.mjs saved them, the X-TIMESTAMP-MAP header dropped. Ranges of segments, not the whole day; each segment is 12 s after the last.`, segments: {} };
for (const r of ranges) {
  const m = r.match(/^([\w-]+)=(\d+)-(\d+)$/);
  if (!m) { console.error(`not a range: ${r}`); process.exit(2); }
  const [, name, a, b] = m; const vtt = [];
  for (let n = Number(a); n <= Number(b); n++) {
    const f = join(dir, `text_1_${String(n).padStart(5, '0')}.vtt`);
    vtt.push(existsSync(f) ? readFileSync(f, 'utf8').replace(/^WEBVTT\n(X-TIMESTAMP-MAP=[^\n]*\n)?\n?/, '') : '');
  }
  doc.segments[name] = { from: Number(a), vtt };
}
writeFileSync(out, JSON.stringify(doc));
console.log(`${Object.keys(doc.segments).length} ranges, ${Math.round(JSON.stringify(doc).length / 1024)} KB -> ${out}`);
