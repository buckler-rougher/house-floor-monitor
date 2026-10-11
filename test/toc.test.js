#!/usr/bin/env node
//
// lib/toc.js: which section of the page is "current" for the contents sidebar, and what the top item is called. The positions are a real page's (the House board's panels at 1600px).
// No browser.

const assert = require('assert');
const T = require('../lib/toc.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

// the House board's panels, top of each (px from the top of the page), a footer of 509px after the last, a 1000px window, the header's line at 124px
const tops = [0, 478, 756, 939, 1417, 1642, 3346, 4168, 4628, 5267, 5603, 6147, 7121, 7688];
const docH = 7688 + 658 + 509, vh = 1000, max = docH - vh, line = 124;
const th = T.thresholds(tops, line, max, 48);
const at = (y) => T.activeIndex(y, th);

ok('a section is current from the moment its top reaches the line under the header until the next one\'s does', () => {
  assert.strictEqual(at(0), 0);
  assert.strictEqual(at(478 - line - 1), 0);
  assert.strictEqual(at(478 - line), 1);
  assert.strictEqual(at(1642 - line + 500), 5);
});

ok('the last panel is current when the page is scrolled to the bottom, though the footer below it means its own top never reaches the line', () => {
  assert.ok(7688 - line > 0);
  assert.strictEqual(at(max), tops.length - 1);
  assert.strictEqual(at(max - 1), tops.length - 1);
});

ok('a short tail: panels at 2600, 2740 and 2830 on a page that ends 240px after the last one starts: they cannot all reach the line, so each gets its own 48px of the final scroll', () => {
  const t = [0, 1000, 2000, 2600, 2740, 2830];
  const m = 2830 + 140 + 100 - 1000;   // the last panel is 140px tall, a footer of 100px; a 1000px window: 2070 to scroll
  const th2 = T.thresholds(t, 100, m, 48);
  assert.deepStrictEqual(th2, [0, 900, 1900, 1974, 2022, 2070], 'the three that cannot reach the line are given the last 96px, in steps');
  const idxAt = (y) => T.activeIndex(y, th2);
  assert.strictEqual(idxAt(m), 5, 'the last, at the very bottom');
  assert.strictEqual(idxAt(m - 1), 4, 'one pixel up is the one before it');
  assert.strictEqual(idxAt(m - 48 - 1), 3, 'and before that');
  assert.strictEqual(idxAt(m - 3 * 48), 2, 'then the panel that does reach the line');
  assert.strictEqual(T.activeIndex(2069.7, th2), 5, 'a fractional scroll position a hair short of the bottom still counts');
  for (let i = 1; i < th2.length; i++) assert.ok(th2[i] > th2[i - 1], 'every threshold above the one before it, so none is skipped');
});

ok('a page with nothing to scroll has no negative threshold, and its one position makes the last current (it is all in view)', () => {
  const thS = T.thresholds([0, 300, 600], 100, 0, 48);
  assert.ok(thS.every((x) => x >= 0));
  assert.strictEqual(T.activeIndex(0, thS), 2, 'a page with nothing to scroll has one position, 0, and the last is current there: it is all in view and the bottom rule says so');
});

ok('the top item\'s name: live floor, today\'s sitting, or the last sitting day', () => {
  assert.strictEqual(T.topLabel({ live: true, todayLabel: 'LAST SITTING DAY' }), 'Happening now');
  assert.strictEqual(T.topLabel({ live: false, todayLabel: 'TODAY IN THE HOUSE' }), 'Today on the floor');
  assert.strictEqual(T.topLabel({ live: false, todayLabel: 'LAST SITTING DAY' }), 'Last sitting day');
  assert.strictEqual(T.topLabel({ live: false, session: 'ADJOURNED', idle: 'Adjourned' }), 'Adjourned');
  assert.strictEqual(T.topLabel({ live: false, session: 'IN SESSION', idle: 'Adjourned' }), 'Today on the floor');
  assert.strictEqual(T.topLabel({ live: false, todayLabel: '', session: 'IN SESSION' }), 'Today on the floor', 'the Senate has no panel of its own: the header says');
  assert.strictEqual(T.topLabel({ live: false, todayLabel: '', session: 'ADJOURNED' }), 'Last sitting day');
  assert.strictEqual(T.topLabel({}), 'Last sitting day');
});

console.log(`\n${n} passed`);
