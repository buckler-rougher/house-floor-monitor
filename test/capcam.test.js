#!/usr/bin/env node
//
// lib/capcam.js: the playlist trimmer. The Capitol Camera's playlist is an EVENT playlist that has run
// since segment 1 (about 94,000 entries on 5 October 2026), and hls.js re-downloads and re-parses all of it
// on every refresh. The trimmer keeps the last few segments and must keep their NUMBERS true, or hls.js
// would play the wrong media or refetch old segments. No network.

const assert = require('assert');
globalThis.window = {};
require('../lib/capcam.js');
const { trimPlaylist } = globalThis.CapCam;

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const segs = (from, count) => Array.from({ length: count }, (_, i) => `#EXTINF:12.00000,\nmaster_${String(from + i).padStart(5, '0')}.ts`).join('\n');
const head = (seq, type = true) => `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:12\n#EXT-X-MEDIA-SEQUENCE:${seq}\n${type ? '#EXT-X-PLAYLIST-TYPE:EVENT\n' : ''}`;
const names = (t) => t.split('\n').filter((l) => l.endsWith('.ts'));
const seq = (t) => Number(t.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)[1]);

ok('a long playlist keeps the last 8 segments', () => {
  const t = trimPlaylist(head(1) + segs(1, 3000) + '\n');
  assert.deepStrictEqual(names(t).map((s) => Number(s.match(/\d+/)[0])), [2993, 2994, 2995, 2996, 2997, 2998, 2999, 3000]);
});

ok('MEDIA-SEQUENCE advances by what was dropped, so the numbering stays true', () => {
  const t = trimPlaylist(head(1) + segs(1, 3000) + '\n');
  assert.strictEqual(seq(t), 2993);
  assert.strictEqual(trimPlaylist(head(500) + segs(500, 3000) + '\n').match(/MEDIA-SEQUENCE:(\d+)/)[1], '3492');
});

ok('PLAYLIST-TYPE:EVENT is dropped, so the window is allowed to slide', () => {
  assert.ok(!/PLAYLIST-TYPE/.test(trimPlaylist(head(1) + segs(1, 3000) + '\n')));
});

ok('a small playlist is returned untouched', () => {
  const small = head(10) + segs(10, 6) + '\n';
  assert.strictEqual(trimPlaylist(small), small);
});

ok('a playlist with no MEDIA-SEQUENCE is left whole rather than renumbered by guesswork', () => {
  const odd = '#EXTM3U\n#EXT-X-TARGETDURATION:12\n' + segs(1, 3000) + '\n';
  assert.strictEqual(trimPlaylist(odd), odd);
});

ok('an ENDLIST survives, and non-strings pass through', () => {
  const t = trimPlaylist(head(1, false) + segs(1, 3000) + '\n#EXT-X-ENDLIST\n');
  assert.ok(t.includes('#EXT-X-ENDLIST'));
  assert.strictEqual(trimPlaylist(null), null);
  assert.strictEqual(trimPlaylist(undefined), undefined);
});

console.log(`\n${n} passed`);
