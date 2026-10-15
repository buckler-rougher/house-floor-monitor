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

console.log(`replay-cc: ${n} passed`);
