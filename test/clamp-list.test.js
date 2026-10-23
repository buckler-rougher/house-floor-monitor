#!/usr/bin/env node
// lib/clamp-list.js `clampPx`: how tall the clip is (the first `keep` items whole and a slice of the next), or null when nothing needs clipping.
const assert = require('assert');
const C = require('../lib/clamp-list.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('keep items whole and show a slice of the next: the top of item `keep` plus the peek', () => {
  assert.strictEqual(C.clampPx([0, 170, 340, 510, 680], 3, 56, 900), 510 + 56);
  assert.strictEqual(C.clampPx([0, 170, 340], 1, 56, 900), 170 + 56);
});
ok('never more than the list is tall', () => {
  assert.strictEqual(C.clampPx([0, 40, 80], 1, 56, 90), 90);
});
ok('keep or fewer items: nothing to clip', () => {
  assert.strictEqual(C.clampPx([0, 170, 340], 3, 56, 500), null);
  assert.strictEqual(C.clampPx([], 3), null);
  assert.strictEqual(C.clampPx(null, 3), null);
});

// ClampList.follow: while a block opens or closes inside a clamped list, the clip follows the list every frame with no transition of its own, then lets go.
// The clock and the frame loop are faked so the timing can be stepped through.
const realPerf = Object.getOwnPropertyDescriptor(globalThis, 'performance');
const realRaf = globalThis.requestAnimationFrame, realMatch = globalThis.matchMedia;
function clockWorld({ reduce = false } = {}) {
  let now = 0; const frames = []; const timers = [];
  Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true, writable: true });
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; };
  const classes = new Set(); let refreshes = 0;
  const list = { _clamp: { wrap: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } }, refresh: () => { refreshes++; } } };
  globalThis.matchMedia = () => ({ matches: reduce });
  return {
    list, classes, refreshes: () => refreshes,
    step(ms) { now += ms; const f = frames.splice(0); f.forEach((fn) => fn()); timers.filter((t) => t.at <= now).forEach((t) => { t.fn(); timers.splice(timers.indexOf(t), 1); }); },
  };
}
const realSetTimeout = setTimeout;
ok('follow: the clip is free of its own transition and refreshed on every frame while the block moves', () => {
  const w = clockWorld();
  C.follow(w.list, 340);
  assert.ok(w.classes.has('is-following'));
  const before = w.refreshes();
  w.step(16); w.step(16); w.step(16);
  assert.ok(w.refreshes() >= before + 3, 'one refresh per frame');
  assert.ok(w.classes.has('is-following'));
});
ok('follow: after its time it lets go, a little later, with one last refresh', () => {
  const w = clockWorld();
  C.follow(w.list, 340);
  for (let t = 0; t < 400; t += 16) w.step(16);
  assert.ok(w.classes.has('is-following'), 'still held through the settling');
  const r = w.refreshes();
  w.step(130);
  assert.ok(!w.classes.has('is-following'));
  assert.ok(w.refreshes() > r, 'one last refresh as it lets go');
});
ok('follow: nothing happens under reduced motion, or without a mounted clamp', () => {
  const w = clockWorld({ reduce: true });
  C.follow(w.list, 340);
  assert.ok(!w.classes.has('is-following'));
  assert.doesNotThrow(() => C.follow({}, 340));
  assert.doesNotThrow(() => C.follow(null, 340));
});
Object.defineProperty(globalThis, 'performance', realPerf); globalThis.setTimeout = realSetTimeout; globalThis.requestAnimationFrame = realRaf; globalThis.matchMedia = realMatch;
console.log(`\n${n} passed`);
