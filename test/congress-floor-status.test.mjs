#!/usr/bin/env node
//
// congressFloorStatus (worker.js): what one Congress.gov floor action says about the measure. The wordings are Congress.gov's own, as the House's floor log sends them. What is pinned:
// 10 November 2026, the Hegseth impeachment (H.Res. 1655) was REFERRED to Judiciary, 211-204, and Congress.gov's "On motion to refer Agreed to by the Yeas and Nays" read as passage, so the
// card said PASSED. A motion is not the measure: referring or tabling it disposes of it (a new status, neither passed nor failed), a failed motion or a motion to discharge says nothing about it.

import assert from 'node:assert';
import { congressFloorStatus } from '../worker.js';

const act = (text, extra = {}) => congressFloorStatus({ type: 'Floor', text, actionDate: '2026-11-10', ...extra });
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('agreeing to a motion to refer disposes of the resolution, with the roll call and tally', () => {
  const s = act('On motion to refer Agreed to by the Yeas and Nays: 211 - 204 (Roll no. 317).');
  assert.strictEqual(s.status, 'disposed');
  assert.strictEqual(s.statusText, 'Referred (Roll Call 317): 211-204');
});

ok('agreeing to a motion to table does the same', () => {
  const s = act('On motion to table Agreed to by the Yeas and Nays: 232 - 147, 47 Present (Roll no. 498).');
  assert.strictEqual(s.status, 'disposed');
  assert.ok(/^Tabled /.test(s.statusText));
});

ok('a motion to refer or table that FAILED says nothing about the resolution', () => {
  assert.strictEqual(act('On motion to refer Failed by the Yeas and Nays: 204 - 211 (Roll no. 317).'), null);
  assert.strictEqual(act('On motion to table Not agreed to by the Yeas and Nays: 200 - 215 (Roll no. 498).'), null);
});

ok('agreeing to a motion to discharge is not passage of the resolution it brings up', () => {
  assert.strictEqual(act('On motion to discharge Agreed to by the Yeas and Nays: 245 - 175 (Roll no. 320).'), null);
});

ok('motion to reconsider laid on the table is nothing', () => {
  assert.strictEqual(act('Motion to reconsider laid on the table Agreed to without objection.'), null);
});

ok('passage is still passage: recorded, voice, suspension; failure is still failure', () => {
  assert.strictEqual(act('On passage Passed by the Yeas and Nays: 295 - 128 (Roll no. 321).').statusText, 'Passed (Roll Call 321): 295-128');
  assert.strictEqual(act('On passage Passed by voice vote.').statusText, 'Passed (voice vote)');
  assert.strictEqual(act('On motion to suspend the rules and pass the bill Agreed to by voice vote.').status, 'passed');
  assert.strictEqual(act('On passage Failed by the Yeas and Nays: 200 - 220 (Roll no. 9).').status, 'failed');
});

ok('a rule being adopted is skipped (it is not the bill)', () => {
  assert.strictEqual(act('Rule H. Res. 1300 passed House.'), null);
});

console.log(`\n${n} passed`);
