#!/usr/bin/env node
// lib/search-field.js `sample`: the pool of examples a search box rotates through.
const assert = require('assert');
const S = require('../lib/search-field.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('distinct (case-blind), non-empty, trimmed, nothing lost but what is empty or repeated', () => {
  const out = S.sample(['Pingree', ' Maine ', 'maine', '', null, undefined, 'Takano'], 40, () => 0.5);
  assert.deepStrictEqual([...out].sort(), ['Maine', 'Pingree', 'Takano']);
});
ok('at most n, shuffled (a different order from a different draw), and an empty or missing list is an empty pool', () => {
  const list = Array.from({ length: 100 }, (_, i) => 'name' + i);
  assert.strictEqual(S.sample(list, 12).length, 12);
  assert.notDeepStrictEqual(S.sample(list, 100, () => 0.1), S.sample(list, 100, () => 0.9));
  assert.deepStrictEqual(S.sample([]), []);
  assert.deepStrictEqual(S.sample(null), []);
});
ok('the header names the options in words: one, two (or), three (comma, or)', () => {
  assert.strictEqual(S.describe('Search by', ['Name']), 'Search by name');
  assert.strictEqual(S.describe('Search by', ['Name', 'State']), 'Search by name or state');
  assert.strictEqual(S.describe('Search by', ['Number', 'Sponsor', 'Summary']), 'Search by number, sponsor or summary');
  assert.strictEqual(S.describe('Search by', []), 'Search by');
});
console.log(`\n${n} passed`);
