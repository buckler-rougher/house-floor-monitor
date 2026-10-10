#!/usr/bin/env node
// lib/appropriations.js: the twelve bills, and the stage read off a bill's Congress.gov actions. The action texts are the forms in this repo's real fixtures
// (test/congress/hr-7008-actions.json, s-4668-actions.json) and the ones the Worker's floor-status reader already matches.
const assert = require('assert');
const A = require('../lib/appropriations.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const act = (actionDate, type, text, actionCode) => ({ actionDate, type, text, actionCode: actionCode || null });

ok('the written fallback: twelve bills, each with a short name, a full name and a distinct number', () => {
  assert.strictEqual(A.FALLBACK.length, 12);
  assert.strictEqual(new Set(A.FALLBACK.map((b) => b.number)).size, 12);
  assert.ok(A.FALLBACK.every((b) => b.short && b.name && b.number > 0));
  assert.strictEqual(A.FALLBACK_YEAR, 2027);
});

// titles as Congress.gov wrote them for the 119th Congress (short titles for most, the official one for H.R. 8469)
const T = {
  ag: 'Agriculture, Rural Development, Food and Drug Administration, and Related Agencies Appropriations Act, 2027',
  milcon: 'Making appropriations for military construction, the Department of Veterans Affairs, and related agencies for the fiscal year ending September 30, 2027, and for other purposes.',
  cjs: 'Commerce, Justice, Science, and Related Agencies Appropriations Act, 2027',
  ew: 'Energy and Water Development and Related Agencies Appropriations Act, 2027',
  thud: 'Transportation, Housing and Urban Development, and Related Agencies Appropriations Act, 2027',
  def: 'Department of Defense Appropriations Act, 2027',
  hs: 'Department of Homeland Security Appropriations Act, 2027',
};
const item = (title, number, extra) => ({ congress: 119, type: 'HR', number: String(number), title, updateDate: '2026-06-01', ...extra });

ok('titles: the fiscal year and the subcommittee, from either form; supplemental, continuing and rescission bills are not regular', () => {
  assert.deepStrictEqual([A.fiscalYearOf(T.ag), A.fiscalYearOf(T.milcon)], [2027, 2027]);
  assert.deepStrictEqual([A.shortName(T.ag), A.shortName(T.milcon), A.shortName(T.cjs), A.shortName(T.def), A.shortName(T.hs)], ['Agriculture', 'Military Construction, VA', 'Commerce, Justice, Science', 'Defense', 'Homeland Security']);
  assert.ok(A.isRegular(T.thud));
  assert.ok(!A.isRegular('Continuing Appropriations Act, 2027') && !A.isRegular('Disaster Supplemental Appropriations Act, 2027') && !A.isRegular('Defense Rescissions Act, 2027'));
  assert.ok(!A.isRegular('A bill to name a post office'));
});
ok('discover: the newest fiscal year with six subcommittees; a year with only a few does not take over; one bill per subcommittee; non-HR ignored', () => {
  const y27 = [item(T.ag, 8646), item(T.milcon, 8469), item(T.cjs, 8845), item(T.ew, 9022), item(T.thud, 9170), item(T.def, 9495), item(T.hs, 9310)];
  const y28 = [item(T.ag.replace('2027', '2028'), 100, { congress: 120 }), item(T.def.replace('2027', '2028'), 101, { congress: 120 })];
  const noise = [item('Continuing Appropriations Act, 2028', 5), { ...item(T.ag, 7), type: 'S' }];
  const d = A.discover([...y27, ...y28, ...noise]);
  assert.strictEqual(d.fiscalYear, 2027);
  assert.deepStrictEqual(d.bills.map((b) => b.short), ['Agriculture', 'Commerce, Justice, Science', 'Defense', 'Energy and Water', 'Homeland Security', 'Military Construction, VA', 'Transportation, HUD']);
  // six FY2028 bills and it takes over
  const six28 = [T.ag, T.milcon, T.cjs, T.ew, T.thud, T.def].map((t, i) => item(t.replace(/2027/g, '2028'), 200 + i, { congress: 120 }));
  const d28 = A.discover([...y27, ...six28]);
  assert.deepStrictEqual([d28.fiscalYear, d28.bills.length, d28.bills[0].congress], [2028, 6, 120]);
  // two bills for one subcommittee: the one updated last
  const dup = A.discover([...y27, item(T.ag, 8700, { updateDate: '2026-08-01' })]);
  assert.strictEqual(dup.bills.find((b) => b.short === 'Agriculture').number, 8700);
  assert.strictEqual(A.discover([]), null);
});
ok('itemsOf finds the entries however the answer is wrapped', () => {
  const entries = [item(T.ag, 1)];
  assert.deepStrictEqual(A.itemsOf({ 'committee-bills': { bills: entries, count: 1 }, pagination: {} }), entries);
  assert.deepStrictEqual(A.itemsOf({ bills: entries }), entries);
  assert.deepStrictEqual(A.itemsOf({ error: 'x' }), []);
});
ok('reported without a "Reported" action: the committee report on the record, or being placed on the Union Calendar', () => {
  const cal = [act('2026-05-15', 'Calendars', 'Placed on the Union Calendar, Calendar No. 567.')];
  assert.deepStrictEqual([A.stage(cal, [], []).stage, A.stage(cal, [], []).reported], [1, '2026-05-15']);
  assert.strictEqual(A.stage([act('2026-05-01', 'IntroReferral', 'Introduced in House')], [], [{ citation: 'H. Rept. 119-652' }]).stage, 1);
  assert.strictEqual(A.stage([act('2026-05-01', 'IntroReferral', 'Introduced in House')], [], []).stage, 0);
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
