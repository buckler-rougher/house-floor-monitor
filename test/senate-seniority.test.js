#!/usr/bin/env node
//
// Contract test for lib/senate-seniority.js -- reading the Senate's seniority order
// off Wikipedia's table, and refusing a page that does not parse cleanly.
//
// WHY THIS EXISTS
// The source is community-edited and its layout can change under us. The table is
// saved VERBATIM (test/senate-seniority-table.html, the "Seniority in the United
// States Senate" page's ranked table, 3 October 2026): the merged party, state and
// date cells are the whole reason the parser reads by attribute and not by column.
// Do not tidy it. No network, no dependencies.
//
//   npm test

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('../lib/senate-seniority.js');
const Sort = require('../lib/senate-sort.js');

const table = fs.readFileSync(path.join(__dirname, 'senate-seniority-table.html'), 'utf8');
const roster = JSON.parse(fs.readFileSync(path.join(__dirname, 'senate-roster.json'), 'utf8'))
  .map(([last, first, party, state]) => ({ last, first, party, state }));
const nameToPostal = Object.fromEntries(Object.entries(Sort.STATES).map(([p, [n]]) => [n, p]));

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

const rows = S.parse(table);

test('the table parses to one row per senator', () => assert.strictEqual(rows.length, 100));

test('ranks run 1 to 100 with none missing or repeated', () => {
  assert.deepStrictEqual(rows.map((r) => r.rank), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.ok(S.valid(rows));
});

test('each row names a senator and a state', () => {
  for (const r of rows) { assert.ok(r.last && r.state, JSON.stringify(r)); assert.ok(nameToPostal[r.state], `${r.state} is not a state`); }
});

test('rank 1 is Grassley, as the page has it', () => {
  assert.strictEqual(rows[0].last, 'Grassley');
  assert.strictEqual(rows[0].state, 'Iowa');
});

test('the Senate rows survive merged party, state and date cells', () => {
  // Row 60 (Kennedy of Louisiana) has no date cell of its own: it is merged from above.
  const k = rows.find((r) => r.last === 'Kennedy');
  assert.strictEqual(k.state, 'Louisiana');
});

test('every senator on the roster gets a rank', () => {
  const ranks = S.rankMap(rows, roster, nameToPostal);
  const missing = roster.filter((m) => !ranks.has(`${S.fold(m.last)}|${m.state}`)).map((m) => `${m.last} ${m.state}`);
  assert.deepStrictEqual(missing, []);
});

test('the ranks given are a permutation of 1 to 100', () => {
  const ranks = [...S.rankMap(rows, roster, nameToPostal).values()].sort((a, b) => a - b);
  assert.deepStrictEqual(ranks, Array.from({ length: 100 }, (_, i) => i + 1));
});

test('two senators of one state get different ranks, and both Scotts are told apart', () => {
  const ranks = S.rankMap(rows, roster, nameToPostal);
  const fl = ranks.get('SCOTT|FL'), sc = ranks.get('SCOTT|SC');
  assert.ok(fl && sc && fl !== sc);
});

test('a two-word surname matches (Van Hollen, Cortez Masto, Blunt Rochester)', () => {
  const ranks = S.rankMap(rows, roster, nameToPostal);
  for (const k of ['VANHOLLEN|MD', 'CORTEZMASTO|NV', 'BLUNTROCHESTER|DE']) assert.ok(ranks.has(k), k);
});

test('a diacritic on one side does not lose the match (Lujan)', () => {
  const ranks = S.rankMap(rows, roster, nameToPostal);
  assert.ok(ranks.has('LUJAN|NM'));
});

test('a senator the table does not name is left out, not guessed', () => {
  const ranks = S.rankMap(rows, [...roster, { last: 'Nobody', first: 'N', party: 'D', state: 'IA' }], nameToPostal);
  assert.ok(!ranks.has('NOBODY|IA'));
});

test('a page that is not the table is rejected', () => {
  assert.strictEqual(S.valid(S.parse('<html><body>not found</body></html>')), false);
  assert.strictEqual(S.valid(S.parse('')), false);
  assert.strictEqual(S.valid(S.parse(null)), false);
});

test('a table with a gap in the ranking is rejected rather than half used', () => {
  const broken = rows.filter((r) => r.rank !== 40);
  assert.strictEqual(S.valid(broken), false);
});

test('a table cut short is rejected', () => assert.strictEqual(S.valid(rows.slice(0, 60)), false));

console.log(`\n${n} passed`);
