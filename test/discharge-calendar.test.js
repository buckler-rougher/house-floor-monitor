#!/usr/bin/env node
// lib/discharge-calendar.js against real pages of the House Calendars' Calendar of Motions to Discharge Committees (verbatim, part 6 of a sitting day).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DC = require('../lib/discharge-calendar.js');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('one motion pending (16 September 2026): petition 22, entered 15 September, calendar number 8', () => {
  assert.deepStrictEqual(DC.parse(read('discharge-calendar-one.htm')), [{ number: 22, title: 'H. Res. 1247', calendarNumber: 8, entered: '2026-09-15' }]);
});
ok('two pending (21 May 2026), each with its own date', () => {
  assert.deepStrictEqual(DC.parse(read('discharge-calendar-two.htm')).map((m) => [m.number, m.title, m.entered, m.calendarNumber]),
    [[8, 'H. Res. 518', '2026-05-13', 6], [19, 'H. Res. 1140', '2026-05-20', 7]]);
});
ok('a motion that runs onto continuation lines (Mr. Golden of Maine) and a 2025 year heading', () => {
  assert.deepStrictEqual(DC.parse(read('discharge-calendar-2025.htm')).map((m) => [m.number, m.entered]), [[9, '2025-11-12'], [6, '2025-11-17']]);
});
ok('nothing pending is an empty list, not null', () => {
  assert.deepStrictEqual(DC.parse(read('discharge-calendar-empty.htm')), []);
});
ok('a page that is not the calendar is null (an error page does not mean nothing is pending)', () => {
  assert.strictEqual(DC.parse('<html>Not found</html>'), null);
  assert.strictEqual(DC.parse(''), null);
});
console.log(`\n${n} passed`);
