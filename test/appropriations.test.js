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
  assert.deepStrictEqual([A.stage(cal, [], []).stage, A.stage(cal, [], []).reported], [2, '2026-05-15']);
  assert.strictEqual(A.stage([act('2026-05-01', 'IntroReferral', 'Introduced in House')], [], [{ citation: 'H. Rept. 119-652' }]).stage, 2);
  assert.strictEqual(A.stage([act('2026-05-01', 'IntroReferral', 'Introduced in House')], [], []).stage, 0);
});
ok('introduced only: stage 0', () => {
  assert.deepStrictEqual(A.stage([act('2026-05-01', 'IntroReferral', 'Introduced in House')], []), { reported: null, rule: null, housePassed: null, receivedSenate: null, senatePassed: null, law: null, stage: 0, milestones: [] });
});
ok('reported by the committee: stage 2, with the date of the first report (it is logged twice)', () => {
  const r = A.stage([act('2026-06-05', 'Committee', 'Reported (Amended) by the Committee on Appropriations. H. Rept. 119-600.'), act('2026-06-05', 'Committee', 'Reported (Amended) by the Committee on Appropriations. H. Rept. 119-600.'), act('2026-06-03', 'Committee', 'Committee Consideration and Mark-up Session Held')], []);
  assert.deepStrictEqual([r.stage, r.reported], [2, '2026-06-05']);
});
ok('passed the House: stage 3; a rule\'s adoption and a failed vote are not passage', () => {
  const base = [act('2026-06-05', 'Committee', 'Reported by the Committee on Appropriations. H. Rept. 119-1.')];
  assert.strictEqual(A.stage([act('2026-06-23', 'Floor', 'Rule H. Res. 1377 passed House.', 'H1L100'), ...base], []).stage, 2);
  assert.strictEqual(A.stage([act('2026-06-25', 'Floor', 'On passage Failed by the Yeas and Nays: 200 - 220 (Roll no. 300).'), ...base], []).stage, 2);
  const r = A.stage([act('2026-06-26', 'Floor', 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 215 - 210 (Roll no. 301).'), ...base], []);
  assert.deepStrictEqual([r.stage, r.housePassed], [3, '2026-06-26']);
});
ok('passed the Senate: stage 4', () => {
  const r = A.stage([act('2026-09-28', 'Floor', 'Passed Senate with an amendment by Yea-Nay Vote. 77 - 22. Record Vote Number: 250.'), act('2026-06-08', 'Floor', 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 215 - 210.')], []);
  assert.deepStrictEqual([r.stage, r.senatePassed], [4, '2026-09-28']);
});
ok('became law: stage 5, by the action or by the record\'s laws', () => {
  assert.strictEqual(A.stage([act('2026-10-01', 'BecameLaw', 'Became Public Law No: 119-90.')], []).stage, 5);
  assert.strictEqual(A.stage([], [{ number: '119-90', type: 'Public Law' }]).stage, 5);
});
ok('milestones from the real actions of H.R. 8646: the report (with its PDF), the rule, the House vote with its tally and roll, the Senate receiving it', () => {
  const m = A.stage([act('2026-06-08', 'IntroReferral', 'Received in the Senate.'), act('2026-06-04', 'Floor', 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 213 - 210 (Roll no. 205).', '8000'),
    act('2026-06-03', 'Floor', 'Rules Committee Resolution H. Res. 1333 Reported to House. Rule provides for consideration of H.R. 8646.', 'H1L210'), act('2026-05-01', 'Calendars', 'Placed on the Union Calendar, Calendar No. 548.', 'H12410'),
    act('2026-05-01', 'Committee', 'The House Committee on Appropriations reported an original measure, H. Rept. 119-632, by Mr. Harris (MD).', 'H12100')], [], []);
  assert.strictEqual(m.stage, 3);
  assert.deepStrictEqual(m.milestones.map((x) => [x.key, x.date, x.detail]), [['reported', '2026-05-01', 'H. Rept. 119-632'], ['rule', '2026-06-03', 'H. Res. 1333'], ['house', '2026-06-04', '213\u2013210 (roll 205)'], ['received', '2026-06-08', null]]);
  assert.strictEqual(m.milestones[0].url, 'https://www.congress.gov/119/crpt/hrpt632/CRPT-119hrpt632.pdf');
  assert.strictEqual(A.stage([act('2026-06-04', 'Floor', 'Passed/agreed to in House: On passage Passed by voice vote.')], []).milestones[0].detail, 'voice vote');
});

// markup meetings as the committee repository titles them (real ones of April to June 2026)
ok('markups: which bills a meeting names (one, or two marked up together), and that a hearing is not one', () => {
  assert.deepStrictEqual(A.shortNames('Fiscal Year 2027 Agriculture, Rural Development, Food and Drug Administration, and Related Agencies Bill'), ['Agriculture']);
  assert.deepStrictEqual(A.shortNames('Fiscal Year 2027 Military Construction, Veterans Affairs, and Related Agencies Bill, Fiscal Year 2027 Financial Services and General Government Bill'), ['Military Construction, VA', 'Financial Services']);
  assert.deepStrictEqual(A.shortNames('Fiscal Year 2027 Labor, Health and Human Services, Education, and Related Agencies Bill and the Fiscal Year 2027 Department of Homeland Security Bill'), ['Labor, HHS, Education', 'Homeland Security']);
  assert.deepStrictEqual(A.shortNames('Fiscal Year 2027 Transportation, and Housing and Urban Development, and Related Agencies Bill'), ['Transportation, HUD']);
  assert.ok(A.isMarkup('Fiscal Year 2027 Defense Bill (Closed)'));
  assert.ok(A.isMarkup('Fiscal Year 2027 National Security, Department of State, and Related Programs Bill (Rescheduled)'));
  assert.ok(!A.isMarkup('Budget Hearing - Department of Commerce'));
  assert.ok(!A.isMarkup('Fiscal Year 2027 Budget Request for the Military Services (CLOSED)'));
  assert.deepStrictEqual([A.markupKind('Subcommittee on Defense (Committee on Appropriations)'), A.markupKind('Committee on Appropriations')], ['subcommittee', 'full']);
});
console.log(`\n${n} passed`);
