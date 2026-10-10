#!/usr/bin/env node
// lib/jct-publications.js against three real entries of the JCT's 119th Congress feed (test/jct-sample.xml, verbatim).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const J = require('../lib/jct-publications.js');
const xml = fs.readFileSync(path.join(__dirname, 'jct-sample.xml'), 'utf8');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('only the publications that name a bill; the key is the bill id without punctuation, the date ISO', () => {
  const l = J.parse(xml);
  assert.deepStrictEqual(l.map((p) => [p.title, p.bill, p.date]), [['JCX-2-25', 'HR997', '2025-02-10'], ['JCX-26-25', 'HR1', '2025-05-28']]);
  assert.strictEqual(l[0].link, 'https://www.jct.gov/publications/2025/jcx-2-25/');
});
ok('the summary is the first line of the description, with its markup and double-escaped entities decoded', () => {
  assert.strictEqual(J.parse(xml)[0].summary, 'Description Of H.R. 997, The “National Taxpayer Advocate Enhancement Act Of 2025”');
});
ok('latestFor finds the newest for a bill however its id is spaced, and null for none', () => {
  const l = J.parse(xml).concat([{ title: 'JCX-9-26', bill: 'HR1', date: '2026-02-01', link: 'https://www.jct.gov/x', summary: 's' }]);
  assert.strictEqual(J.latestFor(l, 'H.R. 1').title, 'JCX-9-26');
  assert.strictEqual(J.latestFor(l, 'H.R.997').title, 'JCX-2-25');
  assert.strictEqual(J.latestFor(l, 'H.R. 5'), null);
  assert.strictEqual(J.latestFor(null, 'H.R. 1'), null);
});
ok('a page that is not the feed is null (a challenge page is not "no publications")', () => {
  assert.strictEqual(J.parse('<html>Attention Required! | Cloudflare</html>'), null);
  assert.strictEqual(J.parse(''), null);
});
console.log(`\n${n} passed`);
