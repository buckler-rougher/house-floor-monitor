#!/usr/bin/env node
//
// lib/funding-deadline.js: the date a continuing resolution funds the government through. test/funding-cr-excerpt.txt is sections 105 to 107 of the real enrolled
// H.R. 6500 (P.L. 119-103); the whole resolution names December 11, 2026 forty times, so what is pinned is that ONLY section 106's last item is read. No network.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const FD = require('../lib/funding-deadline.js');
const excerpt = fs.readFileSync(path.join(__dirname, 'funding-cr-excerpt.txt'), 'utf8');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('the real section 106 gives its third item, December 11, 2026', () => {
  assert.strictEqual(FD.parse(excerpt), '2026-12-11');
});

ok('a date elsewhere in the text, even earlier or first, is not the deadline', () => {
  const noise = 'Sec. 157. (a) Notwithstanding section 106, through November 20, 2026, a rule shall not take effect. Sec. 158. Until October 1, 2026, nothing. ';
  assert.strictEqual(FD.parse(noise + excerpt), '2026-12-11');
});

ok('markup is ignored, and the item with only a date is the one taken even when the list is longer', () => {
  const html = '<p>Sec. 106. Unless otherwise provided, funds shall be available until whichever of the following first occurs:</p><p>(1) The enactment of an appropriation.</p><p>(2) The enactment of the Act.</p><p>(3) The enactment of a joint resolution.</p><p>(4) January&nbsp;30, 2027.</p><p>Sec. 107. Expenditures.</p>';
  assert.strictEqual(FD.parse(html), '2027-01-30');
});

ok('no section 106 clause, or no date in it, is null: a deadline is never guessed', () => {
  assert.strictEqual(FD.parse('Sec. 157. Through December 11, 2026, a rule shall not take effect.'), null);
  assert.strictEqual(FD.parse('Sec. 106. Funds shall be available until whichever of the following first occurs: (1) The enactment of an appropriation. Sec. 107. Next.'), null);
  assert.strictEqual(FD.parse(''), null);
  assert.strictEqual(FD.parse(null), null);
});

ok('pick: the newest continuing resolution for the year, enacted only; a regular act or another year\'s is not one', () => {
  const law = (number, title, date, laws = [{ number: '119-1', type: 'Public Law' }]) => ({ type: 'HR', number, title, laws, latestAction: { actionDate: date } });
  const r = FD.pick([
    law('7147', 'Homeland Security and Further Additional Continuing Appropriations Act, 2026.', '2026-04-30'),
    law('6500', 'Continuing Appropriations and Extensions Act, 2027', '2026-09-02'),
    law('7148', 'Consolidated Appropriations Act, 2026', '2026-02-03'),
    law('9000', 'Further Continuing Appropriations Act, 2027', '2026-11-20'),
    law('9001', 'Further Continuing Appropriations Act, 2027', '2026-11-30', []),
  ], 2027);
  assert.strictEqual(r.number, '9000', 'the one without a law number is not enacted');
  assert.strictEqual(FD.pick([law('7147', 'Further Continuing Appropriations Act, 2026', '2026-04-30')], 2027), null);
  assert.strictEqual(FD.pick([], 2027), null);
});

ok('days counts whole days to the date', () => {
  assert.strictEqual(FD.days('2026-12-11', '2026-10-10'), 62);
  assert.strictEqual(FD.days('2026-12-11', '2026-12-11'), 0);
  assert.strictEqual(FD.days('2026-12-11', '2026-12-12'), -1);
});

ok('fiscalYear: the year that is running today; it rolls on 1 October', () => {
  assert.strictEqual(FD.fiscalYear('2026-10-10'), 2027);
  assert.strictEqual(FD.fiscalYear('2026-09-30'), 2026);
  assert.strictEqual(FD.fiscalYear('2026-10-01'), 2027);
  assert.strictEqual(FD.fiscalYear('2027-04-15'), 2027, 'next spring, when the list has moved on to FY2028, the funding is still FY2027\'s');
  assert.strictEqual(FD.fiscalYear('2027-12-31'), 2028);
});

console.log(`\n${n} passed`);
