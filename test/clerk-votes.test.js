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

// ---- one roll call's own file ---------------------------------------------------------------
// test/clerk-roll-314.xml is roll 314 (16 September 2026) as the Clerk published it, with the member-by-member votes cut after the first two.
{
  const fs = require('fs'), path = require('path');
  const xml = fs.readFileSync(path.join(__dirname, 'clerk-roll-314.xml'), 'utf8');
  ok('a roll call file is read for its question, result, time, title and the totals by party', () => {
    const r = ClerkVotes.parseRoll(xml);
    assert.strictEqual(r.roll, '314');
    assert.strictEqual(r.legis, 'S 2403');
    assert.strictEqual(r.question, 'On Motion to Suspend the Rules and Pass');
    assert.strictEqual(r.result, 'Passed');
    assert.strictEqual(r.date, '09/16/2026');
    assert.strictEqual(r.time, '7:05 PM');
    assert.strictEqual(r.desc, 'Retire through Ownership Act');
    assert.deepStrictEqual(r.totals, { yeas: 401, nays: 14, present: 0, notVoting: 18 });
    assert.deepStrictEqual(r.parties.R, { yeas: 191, nays: 14, present: 0, notVoting: 13 });
    assert.deepStrictEqual(r.parties.D, { yeas: 209, nays: 0, present: 0, notVoting: 5 });
    assert.deepStrictEqual(r.parties.I, { yeas: 1, nays: 0, present: 0, notVoting: 0 });
  });
  ok('the metadata is kept as the Clerk wrote it, less the table-header boilerplate and every member\'s vote', () => {
    const r = ClerkVotes.parseRoll(xml);
    assert.ok(r.metadata.startsWith('<vote-metadata>') && r.metadata.endsWith('</vote-metadata>'));
    assert.ok(!r.metadata.includes('totals-by-party-header') && !r.metadata.includes('recorded-vote'));
    assert.ok(r.metadata.includes('<vote-result>Passed</vote-result>'));
  });
  ok('a page that is not a roll call (a 200 with an error, an empty file) is not a vote', () => {
    assert.strictEqual(ClerkVotes.parseRoll('<html><body>Page not found</body></html>'), null);
    assert.strictEqual(ClerkVotes.parseRoll(''), null);
    assert.strictEqual(ClerkVotes.parseRoll(null), null);
  });
  ok('the date reads whatever the day\'s width, and entities in the title are decoded', () => {
    const r = ClerkVotes.parseRoll('<rollcall-vote><vote-metadata><rollcall-num>5</rollcall-num><action-date>2-Jan-2026</action-date><vote-desc>Taxes &amp; Fees Act</vote-desc></vote-metadata></rollcall-vote>');
    assert.strictEqual(r.date, '01/02/2026');
    assert.strictEqual(r.desc, 'Taxes & Fees Act');
  });
}

console.log(`\n${n} passed`);
