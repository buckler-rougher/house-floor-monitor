#!/usr/bin/env node
//
// lib/source-status.js maps a source link to the Worker's /api/status checks by where the link points. The two lists live in
// different files, so this fails if one drifts from the other: a check nothing draws, or a link mapped to a check the Worker
// does not make (which would simply never get a dot). No network, no DOM beyond the two calls the file makes at load.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

globalThis.document = { addEventListener() {}, documentElement: { dataset: {} } };
require('../lib/source-status.js');
const MAP = globalThis.SourceStatus.MAP;

// The Worker's check ids: the quoted keys of the object sourceStatusChecks returns.
const src = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
const body = src.slice(src.indexOf('function sourceStatusChecks()'), src.indexOf('async function handleSourceStatus'));
const workerIds = [...body.matchAll(/^\s+'([a-z-]+)': \[/gm)].map((m) => m[1]);

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('the Worker makes the checks the client expects, and the client draws every one', () => {
  const mapped = [...new Set(MAP.flatMap(([, ids]) => ids))].sort();
  assert.ok(workerIds.length >= 10, 'could not read the check ids out of worker.js');
  assert.deepStrictEqual(mapped, [...workerIds].sort());
});

ok('links are matched by where they point', () => {
  const idsFor = (href) => (MAP.find(([re]) => re.test(href)) || [, []])[1];
  assert.deepStrictEqual(idsFor('https://clerk.house.gov/FloorSummary'), ['clerk-feed']);
  assert.deepStrictEqual(idsFor('https://www.senate.gov/legislative/LIS/nominations/NomWithdrawn.xml'), ['senate-nominations']);
  assert.deepStrictEqual(idsFor('https://www.senate.gov/general/capcam.htm'), ['capcam']);
  assert.deepStrictEqual(idsFor('https://www.congress.gov/bill/119th-congress/house-bill/1'), [], 'no check on Congress.gov: its key is rate limited');
});

console.log(n + ' passed');
