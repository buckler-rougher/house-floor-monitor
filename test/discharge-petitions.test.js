#!/usr/bin/env node
//
// lib/discharge-petitions.js: the Clerk's list of discharge petitions and one petition's signature table. test/discharge-list.html is the head of
// page 2 of the 119th Congress's list (petitions 11 and 12) as sent; test/discharge-signatures.html is the first three rows of petition No. 10's
// signature table. No network.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const D = require('../lib/discharge-petitions.js');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('the number needed is 218, which every petition that got there stopped at (all eight of the 119th, 2025 included, vacancies and all)', () => {
  assert.strictEqual(D.NEEDED, 218);
});

ok('each petition: its number, the Clerk\'s link id (even with the pager\'s ?Page= on it), what it asks for, the bill, the sponsor and the dates', () => {
  const r = D.parseList(read('discharge-list.html'));
  assert.deepStrictEqual(r.petitions.map((p) => p.number), [11, 12]);
  const p = r.petitions[0];
  assert.strictEqual(p.id, '2025120211');
  assert.match(p.description, /^Providing for consideration of the bill \(H\.R\. 1908\) to prohibit stock trading/);
  assert.strictEqual(p.billNumber, 'H.Res. 725');
  assert.strictEqual(p.billUrl, 'https://www.congress.gov/bill/119/HRes/725');
  assert.strictEqual(p.sponsor, 'Anna Paulina Luna');
  assert.strictEqual(p.petitionDate, 'December 2nd, 2025');
  assert.strictEqual(p.referralDate, 'September 16th, 2025');
  assert.ok(p.block.includes('Discharge Petition No. 11') && !p.block.includes('Discharge Petition No. 12'), 'the block is the one entry, as sent');
});

ok('the list says how many there are and how many pages (10 to a page)', () => {
  const r = D.parseList(read('discharge-list.html'));
  assert.strictEqual(r.total, 27);
  assert.strictEqual(r.pages, 3);
});

ok('entities come out as characters, hex ones too (the Clerk writes an apostrophe as &#x27;)', () => {
  const r = D.parseList('Discharge Petition No. 23 <label>Description:</label> to protect an individual&#x27;s ability &amp; more </p>');
  assert.strictEqual(r.petitions[0].description, "to protect an individual's ability & more");
});

ok('a page that is not the list gives no petitions, not a guess', () => {
  assert.deepStrictEqual(D.parseList('<html>Not found</html>').petitions, []);
  assert.deepStrictEqual(D.parseList('').petitions, []);
});

ok('the signature count is the highest signer number in the table, and the newest date is its last', () => {
  const s = D.parseSignatures(read('discharge-signatures.html'));
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.last, '11/12/2025');
  // a long table: the count is the numbering, so 218 rows read as 218
  const rows = Array.from({ length: 218 }, (_, i) => `<tr><td data-label="No.">${i + 1}.</td><td><span style="display:none;">12/${String(1 + (i % 28)).padStart(2, '0')}/2025 00:00:00</span></td></tr>`).join('');
  const big = D.parseSignatures(`<tbody id="member-signatures">${rows}</tbody>`);
  assert.strictEqual(big.count, 218);
  assert.strictEqual(big.last, '12/28/2025');
});

ok('a page with no signature table is null (not zero signatures), and an empty table is zero', () => {
  assert.strictEqual(D.parseSignatures('<html>Not found</html>'), null);
  assert.deepStrictEqual(D.parseSignatures('<tbody id="member-signatures"></tbody>'), { count: 0, last: null });
});

console.log(`\n${n} passed`);
