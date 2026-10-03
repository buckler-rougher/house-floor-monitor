#!/usr/bin/env node
//
// Contract test for lib/senate-desks.js -- reading who sits at which Senate desk.
//
// WHY THIS EXISTS
// The desk map came with no test, and its parser has two traps that both passed by
// accident before they were caught:
//   - the dataRef is relative to xml/, not to the page;
//   - `<class` also matches the `<classes>` wrapper, so the first "class" is the
//     container, with no dateRange and the first real plan's dataRef inside it. That
//     selected a correct plan for the wrong reason.
// Both files are saved VERBATIM from the Curator's chamber map (3 October 2026). Do
// not tidy them. No network, no dependencies.
//
//   npm test

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const D = require('../lib/senate-desks.js');

const classes = fs.readFileSync(path.join(__dirname, 'senate-desks-classes.xml'), 'utf8');
const plan = fs.readFileSync(path.join(__dirname, 'senate-desks-plan.xml'), 'utf8');
const roster = JSON.parse(fs.readFileSync(path.join(__dirname, 'senate-roster.json'), 'utf8'))
  .map(([last, first, party, state]) => ({ last, first, party, state }));
const fold = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const seats = D.parseSeats(plan);
const count = (key) => seats.reduce((a, s) => ((a[s[key]] = (a[s[key]] || 0) + 1), a), {});

test('the live plan is the one whose range ends in "present"', () => {
  const p = D.pickPlan(classes);
  assert.strictEqual(p.ref, 'floorplans/119_2c_red.xml');
  assert.match(p.range, /present/i);
});

test('the <classes> wrapper is not read as a class of its own', () => {
  // A looser pattern would match the wrapper as the first block, and that block has
  // no dateRange. With every real class's range stripped, nothing may be "live".
  const stripped = classes.replace(/dateRange="[^"]*"/g, 'dateRange=""');
  const p = D.pickPlan(stripped);
  assert.strictEqual(p.ref, 'floorplans/119_2c_red.xml', 'falls back to the first REAL class, not the wrapper');
  assert.strictEqual(p.range, '');
});

test('the plan listed first is not chosen merely for being first', () => {
  // Move "present" from the first class to the second. If the first were taken because
  // it is first, this would still say 119_2c_red.
  const moved = classes
    .replace('dateRange="2026, Jul 14\u2013present"', 'dateRange="2026, Jul 14\u2013earlier"')
    .replace('dateRange="2026, Mar 24\u2013Jul 14"', 'dateRange="2026, Mar 24\u2013present"');
  assert.strictEqual(D.pickPlan(moved).ref, 'floorplans/119_2b_red.xml');
});

test('no classes, no plan', () => { assert.strictEqual(D.pickPlan(''), null); assert.strictEqual(D.pickPlan(null), null); });

test('the plan parses to a full chamber of 100 desks', () => assert.strictEqual(seats.length, 100));

test('47 on the left and 53 on the right', () => assert.deepStrictEqual(count('side'), { left: 47, right: 53 }));

test('the parties are 45 D, 53 R and 2 I', () => assert.deepStrictEqual(count('party'), { D: 45, R: 53, I: 2 }));

test('every desk is once, and every one has a Bioguide id and a state', () => {
  assert.strictEqual(new Set(seats.map((s) => s.desk)).size, 100);
  assert.strictEqual(seats.filter((s) => s.bioguide).length, 100);
  assert.strictEqual(seats.filter((s) => s.state).length, 100);
  assert.ok(D.valid(seats));
});

test('each side has three sections, and rows run 1 to 4', () => {
  assert.deepStrictEqual([...new Set(seats.filter((s) => s.side === 'left').map((s) => s.section))].sort(), [0, 1, 2]);
  assert.deepStrictEqual([...new Set(seats.map((s) => s.row))].sort(), [1, 2, 3, 4]);
});

test('order within a row counts from zero with no gaps', () => {
  const rows = {};
  for (const s of seats) (rows[`${s.side}${s.section}${s.row}`] ||= []).push(s.order);
  for (const [k, o] of Object.entries(rows)) assert.deepStrictEqual(o.sort((a, b) => a - b), o.map((_, i) => i), k);
});

test('the surname is the part before the comma', () => {
  const s = seats.find((x) => x.name.startsWith('Schumer'));
  assert.strictEqual(s.last, 'Schumer');
  assert.strictEqual(s.bioguide, 'S000148');
  assert.strictEqual(s.desk, 10);
});

test('every senator on the roster has a desk, matched on surname and state', () => {
  const missing = roster.filter((m) => !seats.some((s) => fold(s.last) === fold(m.last) && s.state === m.state));
  assert.deepStrictEqual(missing.map((m) => `${m.last} ${m.state}`), []);
});

test('both Scotts have their own desks', () => {
  const scotts = seats.filter((s) => s.last === 'Scott').map((s) => s.state).sort();
  assert.deepStrictEqual(scotts, ['FL', 'SC']);
});

test('an empty desk is a vacancy, not a member', () => {
  const vacant = plan.replace(/<sName>Schumer, Charles E\.<\/sName>/, '<sName></sName>');
  const s = D.parseSeats(vacant);
  assert.strictEqual(s.length, 99);
  assert.ok(!s.some((x) => x.last === 'Schumer'));
});

test('a row with no rownum is numbered by its position', () => {
  const noRowNum = plan.replace(/ rownum="1"/, '');
  const s = D.parseSeats(noRowNum);
  assert.strictEqual(s.length, 100);
  assert.ok(s.every((x) => Number.isFinite(x.row)));
});

test('a page that is not a floorplan is refused', () => {
  assert.strictEqual(D.valid(D.parseSeats('<html>not found</html>')), false);
  assert.strictEqual(D.valid(D.parseSeats('')), false);
  assert.strictEqual(D.valid(seats.slice(0, 60)), false);
  assert.strictEqual(D.valid([...seats, seats[0]]), false, 'a desk listed twice');
});

console.log(`\n${n} passed`);
