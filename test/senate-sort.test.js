#!/usr/bin/env node
//
// Contract test for lib/senate-sort.js -- the orders the Senate board can take.
// No network, no dependencies.
//
//   npm test

const assert = require('assert');
const S = require('../lib/senate-sort.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const M = (last, state, first = 'X') => ({ last, first, state, party: 'D', key: last.toUpperCase() });
const names = (list) => list.map((m) => m.last);

const roster = [
  M('Scott', 'SC', 'Tim'), M('Murkowski', 'AK'), M('Collins', 'ME'), M('Shaheen', 'NH'),
  M('Coons', 'DE'), M('Schmitt', 'MO'), M('Alsobrooks', 'MD'), M('Sullivan', 'AK'), M('Scott', 'FL', 'Rick'),
];

test('alpha is A to Z by surname', () => {
  assert.deepStrictEqual(names(S.sortMembers(roster, 'alpha')),
    ['Alsobrooks', 'Collins', 'Coons', 'Murkowski', 'Schmitt', 'Scott', 'Scott', 'Shaheen', 'Sullivan']);
});

test('two senators who share a surname are told apart by first name', () => {
  const s = S.sortMembers(roster, 'alpha').filter((m) => m.last === 'Scott');
  assert.deepStrictEqual(s.map((m) => m.first), ['Rick', 'Tim']);
});

test('state groups by state NAME, not postal code', () => {
  // By postal code the order would be AK, AL, AR, AZ; by name it is Alabama,
  // Alaska, Arizona, Arkansas.
  const r = [M('A', 'AL'), M('B', 'AK'), M('C', 'AZ'), M('D', 'AR')];
  assert.deepStrictEqual(S.sortMembers(r, 'state').map((m) => m.state), ['AL', 'AK', 'AZ', 'AR']);
});

test('state keeps a state\'s two senators together, by surname', () => {
  const s = S.sortMembers(roster, 'state');
  const ak = s.map((m, i) => (m.state === 'AK' ? i : -1)).filter((i) => i >= 0);
  assert.strictEqual(ak[1] - ak[0], 1);
  assert.deepStrictEqual(s.filter((m) => m.state === 'AK').map((m) => m.last), ['Murkowski', 'Sullivan']);
});

test('admission orders states by when they joined, and Delaware is first', () => {
  const s = S.sortMembers(roster, 'admission');
  assert.strictEqual(s[0].state, 'DE');
  assert.deepStrictEqual([...new Set(s.map((m) => m.state))], ['DE', 'MD', 'SC', 'NH', 'ME', 'MO', 'FL', 'AK']);
});

test('admission uses the real ratification order for the original states', () => {
  const orig = ['DE', 'PA', 'NJ', 'GA', 'CT', 'MA', 'MD', 'SC', 'NH', 'VA', 'NY', 'NC', 'RI'];
  assert.deepStrictEqual(orig.map((p) => S.STATES[p][1]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.strictEqual(S.STATES.AK[1], 49);
  assert.strictEqual(S.STATES.HI[1], 50);
});

test('there are fifty states, each with a distinct admission order', () => {
  const orders = Object.values(S.STATES).map((v) => v[1]);
  assert.strictEqual(orders.length, 50);
  assert.strictEqual(new Set(orders).size, 50);
  assert.strictEqual(Math.min(...orders), 1);
  assert.strictEqual(Math.max(...orders), 50);
});

test('recent puts the last senator heard first, and the unheard after, A to Z', () => {
  const s = S.sortMembers(roster, 'recent', ['COLLINS', 'COONS', 'MURKOWSKI']);
  assert.deepStrictEqual(names(s).slice(0, 3), ['Murkowski', 'Coons', 'Collins']);
  assert.deepStrictEqual(names(s).slice(3), ['Alsobrooks', 'Schmitt', 'Scott', 'Scott', 'Shaheen', 'Sullivan']);
});

test('recent with nobody heard is just A to Z', () => {
  assert.deepStrictEqual(names(S.sortMembers(roster, 'recent', [])), names(S.sortMembers(roster, 'alpha')));
});

test('an unknown state sorts last rather than throwing', () => {
  const s = S.sortMembers([M('A', 'ZZ'), M('B', 'DE')], 'admission');
  assert.deepStrictEqual(names(s), ['B', 'A']);
});

test('sorting does not mutate its input', () => {
  const copy = JSON.stringify(roster);
  S.sortMembers(roster, 'admission');
  S.sortMembers(roster, 'recent', ['SCOTT']);
  assert.strictEqual(JSON.stringify(roster), copy);
});

console.log(`\n${n} passed`);
