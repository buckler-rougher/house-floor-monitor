#!/usr/bin/env node
//
// Contract test for lib/util.js and lib/session-clock.js -- the helpers both boards share.
//
// WHY THIS EXISTS
// These were written out in app.js and senate.js and had drifted: the House's escapeHtml
// left quotes alone, so a `"` in a name ended an alt="..." early. With one copy, a test can
// pin the behaviour for both boards at once. No network, no dependencies.
//
//   npm test

const assert = require('assert');
const U = require('../lib/util.js');
const SC = require('../lib/session-clock.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

test('escapeHtml escapes all five characters that matter in text and attributes', () => {
  assert.strictEqual(U.escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('a quote cannot end an attribute early', () => {
  const name = 'Rep. "Bob" O\'Brien';
  const html = `<img alt="${U.escapeHtml(name)}">`;
  assert.ok(!/alt="[^"]*"[^>]*"/.test(html), html);
});

test('escapeHtml turns null and undefined into nothing, not the word undefined', () => {
  assert.strictEqual(U.escapeHtml(null), '');
  assert.strictEqual(U.escapeHtml(undefined), '');
  assert.strictEqual(U.escapeHtml(0), '0');
  assert.strictEqual(U.escapeHtml(false), 'false');
});

test('escapeHtml does not double-escape what it has already escaped differently', () => {
  assert.strictEqual(U.escapeHtml('a & b'), 'a &amp; b');
});

test('fmtDate is day-first with the month spelled out and the day padded', () => {
  assert.strictEqual(U.fmtDate(new Date(2026, 4, 2)), '02 May 2026');
  assert.strictEqual(U.fmtDate(new Date(2026, 8, 26)), '26 September 2026');
});

test('fmtDateLong adds the weekday', () => {
  assert.strictEqual(U.fmtDateLong(new Date(2026, 8, 26)), 'Saturday, 26 September 2026');
});

test('there are twelve months and seven days', () => {
  assert.strictEqual(U.MONTH_NAMES.length, 12);
  assert.strictEqual(U.DAY_NAMES.length, 7);
  assert.strictEqual(U.DAY_NAMES[0], 'Sunday');
});

test('setIfChanged writes once and then leaves an identical render alone', () => {
  let writes = 0;
  const node = { set innerHTML(v) { writes++; this._h = v; }, get innerHTML() { return this._h; } };
  U.setIfChanged(node, '<b>x</b>'); U.setIfChanged(node, '<b>x</b>'); U.setIfChanged(node, '<b>x</b>');
  assert.strictEqual(writes, 1);
  U.setIfChanged(node, '<b>y</b>');
  assert.strictEqual(writes, 2);
});

test('setIfChanged tolerates a missing node', () => { U.setIfChanged(null, 'x'); U.setIfChanged(undefined, 'x'); });

// ---- the countdown. Date.now is pinned so the text is exact.
const at = (fromNow) => { const real = Date.now; const t0 = 1_800_000_000_000; Date.now = () => t0; const out = SC.format(new Date(t0 + fromNow)); Date.now = real; return out; };
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

test('a countdown with days, hours and minutes lists each', () => assert.strictEqual(at(2 * D + 4 * H + 12 * M + 9 * S), 'NEXT SESSION IN 2D 4H 12M 09S'));
test('minutes and seconds only, when that is all there is', () => assert.strictEqual(at(5 * M + 3 * S), 'NEXT SESSION IN 5M 03S'));
test('seconds alone, padded', () => assert.strictEqual(at(7 * S), 'NEXT SESSION IN 07S'));
test('a zero minute is kept once days or hours are showing', () => assert.strictEqual(at(3 * H + 5 * S), 'NEXT SESSION IN 3H 0M 05S'));
test('a time already past reads NOW', () => { assert.strictEqual(at(-1000), 'NEXT SESSION: NOW'); assert.strictEqual(at(0), 'NEXT SESSION: NOW'); });
test('nothing that is not a valid date gives text', () => {
  assert.strictEqual(SC.format(null), ''); assert.strictEqual(SC.format('soon'), ''); assert.strictEqual(SC.format(new Date('nope')), '');
});

test('show hides the node with no target and shows it with one', () => {
  const node = { style: {}, textContent: '' };
  SC.show(node, null);
  assert.strictEqual(node.style.display, 'none');
  SC.show(node, new Date(Date.now() + 90 * S));
  assert.strictEqual(node.style.display, 'inline-flex');
  assert.match(node.textContent, /^NEXT SESSION IN 1M \d\dS$/);
  SC.show(null, new Date());                 // a missing node is not an error
});

console.log(`\n${n} passed`);
