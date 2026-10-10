#!/usr/bin/env node
// lib/appropriations.js: the twelve bills, and the stage read off a bill's Congress.gov actions. The action texts are the forms in this repo's real fixtures
// (test/congress/hr-7008-actions.json, s-4668-actions.json) and the ones the Worker's floor-status reader already matches.
const assert = require('assert');
const A = require('../lib/appropriations.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const act = (actionDate, type, text, actionCode) => ({ actionDate, type, text, actionCode: actionCode || null });

ok('twelve bills, each with a short name, a full name and a distinct number', () => {
  assert.strictEqual(A.BILLS.length, 12);
  assert.strictEqual(new Set(A.BILLS.map((b) => b.number)).size, 12);
  assert.ok(A.BILLS.every((b) => b.short && b.name && b.number > 0));
  assert.strictEqual(A.FISCAL_YEAR, 2027);
});
ok('introduced only: stage 0', () => {
  assert.deepStrictEqual(A.stage([act('2026-05-01', 'IntroReferral', 'Introduced in House')], []), { reported: null, housePassed: null, senatePassed: null, law: null, stage: 0 });
});
ok('reported by the committee: stage 1, with the date of the first report (it is logged twice)', () => {
  const r = A.stage([act('2026-06-05', 'Committee', 'Reported (Amended) by the Committee on Appropriations. H. Rept. 119-600.'), act('2026-06-05', 'Committee', 'Reported (Amended) by the Committee on Appropriations. H. Rept. 119-600.'), act('2026-06-03', 'Committee', 'Committee Consideration and Mark-up Session Held')], []);
  assert.deepStrictEqual([r.stage, r.reported], [1, '2026-06-05']);
});
ok('passed the House: stage 2; a rule\'s adoption and a failed vote are not passage', () => {
  const base = [act('2026-06-05', 'Committee', 'Reported by the Committee on Appropriations. H. Rept. 119-1.')];
  assert.strictEqual(A.stage([act('2026-06-23', 'Floor', 'Rule H. Res. 1377 passed House.', 'H1L100'), ...base], []).stage, 1);
  assert.strictEqual(A.stage([act('2026-06-25', 'Floor', 'On passage Failed by the Yeas and Nays: 200 - 220 (Roll no. 300).'), ...base], []).stage, 1);
  const r = A.stage([act('2026-06-26', 'Floor', 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 215 - 210 (Roll no. 301).'), ...base], []);
  assert.deepStrictEqual([r.stage, r.housePassed], [2, '2026-06-26']);
});
ok('passed the Senate: stage 3', () => {
  const r = A.stage([act('2026-09-28', 'Floor', 'Passed Senate with an amendment by Yea-Nay Vote. 77 - 22. Record Vote Number: 250.'), act('2026-06-08', 'Floor', 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 215 - 210.')], []);
  assert.deepStrictEqual([r.stage, r.senatePassed], [3, '2026-09-28']);
});
ok('became law: stage 4, by the action or by the record\'s laws', () => {
  assert.strictEqual(A.stage([act('2026-10-01', 'BecameLaw', 'Became Public Law No: 119-90.')], []).stage, 4);
  assert.strictEqual(A.stage([], [{ number: '119-90', type: 'Public Law' }]).stage, 4);
});
console.log(`\n${n} passed`);
