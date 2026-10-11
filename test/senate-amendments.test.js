#!/usr/bin/env node
//
// lib/senate-amendments.js: what Congress.gov's latest action on a Senate amendment says happened to it, and the row it becomes. The texts are the real latest actions on S.4668
// (30 September 2026), 74 amendments: 59 had none yet. No network.

const assert = require('assert');
const SA = require('../lib/senate-amendments.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const st = (t, p) => SA.status(t, p);

ok('agreed to: by unanimous consent, by voice vote or by a roll call with its tally', () => {
  assert.deepStrictEqual(st('Amendment SA 6848 agreed to in Senate by Unanimous Consent.'), { kind: 'adopted', label: 'Agreed (UC)' });
  assert.deepStrictEqual(st('Amendment SA 5819 agreed to in Senate by Voice Vote.'), { kind: 'adopted', label: 'Agreed (voice)' });
  assert.deepStrictEqual(st('Amendment SA 100 agreed to in Senate by Yea-Nay Vote. 52 - 47. Record Vote Number: 250.'), { kind: 'adopted', label: 'Agreed 52-47' });
});

ok('not agreed to: with its tally, and "not agreed to" is never read as "agreed to"', () => {
  assert.deepStrictEqual(st('Under the order of 9/28/26, amendment SA 6835 not agreed to in Senate by Yea-Nay Vote. 47 - 52. Record Vote Number: 249.'), { kind: 'failed', label: 'Not agreed 47-52' });
  assert.deepStrictEqual(st('Under the order of 9/28/26, amendment SA 6700, not having achieved 60 votes in the affirmative, was not agreed to.'), { kind: 'failed', label: 'Not agreed' });
});

ok('tabled, fell and withdrawn did not pass, and say which', () => {
  assert.deepStrictEqual(st('Motion to table amendment SA 6801 agreed to in Senate by Voice Vote.'), { kind: 'failed', label: 'Tabled (voice)' });
  assert.strictEqual(st('SA 6802 fell when SA 6801 was tabled.').label, 'Fell', 'it fell; the one tabled was another');
  assert.strictEqual(st('SA 6803 fell when SA 6804 fell.').label, 'Fell');
  assert.strictEqual(st('SA 6805 (the instructions of the motion to commit) fell when cloture was invoked on the bill.').label, 'Fell');
  assert.strictEqual(st('Amendment SA 6806 withdrawn.').label, 'Withdrawn');
});

ok('no action yet is Submitted, or Proposed when it has a proposed date; an action it cannot read is not claimed as a result', () => {
  assert.deepStrictEqual(st('', null), { kind: 'submitted', label: 'Submitted' });
  assert.deepStrictEqual(st(null, '2026-09-28T04:00:00Z'), { kind: 'submitted', label: 'Proposed' });
  assert.deepStrictEqual(st('Amendment SA 6900 referred to the Committee on Finance.', null), { kind: 'submitted', label: 'Submitted' });
});

ok('a row: number, purpose, status, the sponsor from the amendment\'s own record, the date of its last action', () => {
  const detail = { number: '6835', type: 'SAMDT', purpose: 'To establish certain standards with respect to coaches of varsity sports teams.', proposedDate: '2026-09-28T04:00:00Z', submittedDate: '2026-09-24T04:00:00Z',
    sponsors: [{ fullName: 'Sen. Booker, Cory A. [D-NJ]', lastName: 'Booker', party: 'D', state: 'NJ' }],
    latestAction: { actionDate: '2026-09-28', text: 'Under the order of 9/28/26, amendment SA 6835 not agreed to in Senate by Yea-Nay Vote. 47 - 52. Record Vote Number: 249.' } };
  assert.deepStrictEqual(SA.shape({ number: '6835', type: 'SAMDT' }, detail), { num: 6835, type: 'SAMDT', summary: 'To establish certain standards with respect to coaches of varsity sports teams.', status: 'Not agreed 47-52', kind: 'failed', date: '2026-09-28', sponsor: { name: 'Booker', party: 'D', state: 'NJ' } });
});

ok('a row from the list alone has no sponsor yet, and a record with no number is nothing', () => {
  const r = SA.shape({ number: '6836', type: 'SAMDT', purpose: 'In the nature of a substitute.', latestAction: { actionDate: '2026-09-30', text: 'Amendment SA 6836 agreed to in Senate by Unanimous Consent.' } }, null);
  assert.strictEqual(r.sponsor, null);
  assert.strictEqual(r.status, 'Agreed (UC)');
  assert.strictEqual(SA.shape({}, null), null);
});

console.log(`\n${n} passed`);
