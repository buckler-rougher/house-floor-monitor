#!/usr/bin/env node
// lib/replay-cc.js reads the House video's own captions out of a segment: one real segment (16 Sep 2026, the 4740th, 2 s each, smallest rendition) is saved in test/replay/.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CC = require('../lib/replay-cc.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

const seg = fs.readFileSync(path.join(__dirname, 'replay', 'segment-20260916-4740.m4s'));

ok('a segment: its start in video seconds, and the caption words with the time of the frame they came in', () => {
  const r = CC.segmentCaptions(seg);
  assert.strictEqual(r.start, 9480);
  assert.deepStrictEqual(r.text.map((x) => x.text), ['AUTHORITIES TO DEVELOP', 'A PROGRAM TO']);
  assert.ok(r.text[0].t >= 9480 && r.text[0].t < 9482);
  assert.ok(r.text[1].t > r.text[0].t);
});

ok('bytes that are not a segment give nothing, not an error', () => {
  assert.deepStrictEqual(CC.segmentCaptions(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])).text, []);
  assert.deepStrictEqual(CC.segmentCaptions(new Uint8Array(0)).text, []);
});

ok('the rendition path comes from the start of its playlist', () => {
  assert.strictEqual(CC.rendition('#EXTM3U\n#EXT-X-MAP:URI="h264/145000/init.mp4"\n#EXTINF:2.0,'), 'h264/145000/segment_');
  assert.strictEqual(CC.rendition('nothing'), null);
});

ok('playlists: the smallest rendition, and a media playlist as segments (newer days: 2 s files; older: byte ranges of one file)', () => {
  assert.strictEqual(CC.lowest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2128000,X=1\nvideo_0.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=273000,X=1\nvideo_4.m3u8\n'), 'video_4.m3u8');
  const a = CC.playlist('#EXTM3U\n#EXT-X-MAP:URI="h264/145000/init.mp4"\n#EXTINF:2.0,\nh264/145000/segment_0.m4s\n#EXTINF:0.07,\nh264/145000/segment_1.m4s\n');
  assert.deepStrictEqual(a.segs.map((x) => [x.t0, x.dur, x.uri, x.range]), [[0, 2, 'h264/145000/segment_0.m4s', null], [2, 0.07, 'h264/145000/segment_1.m4s', null]]);
  const b = CC.playlist('#EXT-X-MAP:URI="v.mp4",BYTERANGE="874@0"\n#EXTINF:6.000,\n#EXT-X-BYTERANGE:875796@65706\nv.mp4\n#EXTINF:6.000,\n#EXT-X-BYTERANGE:1087891\nv.mp4\n');
  assert.deepStrictEqual(b.map, { uri: 'v.mp4', range: [0, 874] });
  assert.deepStrictEqual(b.segs.map((x) => x.range), [[65706, 875796], [941502, 1087891]]);
});

console.log(`replay-cc: ${n} passed`);
