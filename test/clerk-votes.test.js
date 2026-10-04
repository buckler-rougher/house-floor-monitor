#!/usr/bin/env node
//
// Contract test for lib/clerk-votes.js -- finding the House's latest roll call.
//
// WHY THIS EXISTS
// The Clerk removed the index page the Worker scraped (evs/<year>/index.asp now 404s) and the
// board lost its latest roll number: /api/congress-index went to 500, MISSING MEMBERS showed "--".
// test/clerk-votes-list.html is the replacement listing exactly as the Clerk served it on
// 4 October 2026 (the 2nd session, 314 rolls, newest first). Do not tidy it. No network.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const V = require('../lib/clerk-votes.js');

const page = fs.readFileSync(path.join(__dirname, 'clerk-votes-list.html'), 'utf8');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('the latest roll is the highest number on the page, 314', () => {
  const rolls = V.parseRolls(page, 2026);
  assert.strictEqual(rolls[0].rollNumber, '314');
});

ok('a page of results is ten rolls, highest first, no repeats', () => {
  const rolls = V.parseRolls(page, 2026);
  assert.deepStrictEqual(rolls.map((r) => r.rollNumber), ['314', '313', '312', '311', '310', '309', '308', '307', '306', '305']);
});

ok('the shape the Worker used to return is kept', () => {
  assert.deepStrictEqual(V.parseRolls(page, 2026)[0], { rollNumber: '314', displayNumber: '314' });
});

ok('rolls from another year are not this year\'s', () => {
  assert.deepStrictEqual(V.parseRolls(page, 2025), []);
});

ok('a page it does not recognise gives no rolls, never a guess', () => {
  assert.deepStrictEqual(V.parseRolls('<html><body>Not found</body></html>', 2026), []);
  assert.deepStrictEqual(V.parseRolls('', 2026), []);
  assert.deepStrictEqual(V.parseRolls(null, 2026), []);
  // the old index's shape, which is what the Clerk no longer serves
  assert.deepStrictEqual(V.parseRolls('<A HREF="roll.asp?rollnumber=314">314</A>', 2026), []);
});

ok('a link whose two roll numbers disagree is not trusted', () => {
  assert.deepStrictEqual(V.parseRolls('<a href="/Votes/2026314" aria-label="Roll number, 313">313</a>', 2026), []);
});

ok('the session follows the year: first in odd years, second in even', () => {
  assert.strictEqual(V.sessionFor(2025), '1st');
  assert.strictEqual(V.sessionFor(2026), '2nd');
  assert.strictEqual(V.listUrl(2026), 'https://clerk.house.gov/Votes/MemberVotes?Session=2nd');
});

console.log(`\n${n} passed`);
