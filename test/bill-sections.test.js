#!/usr/bin/env node
//
// Contract test for lib/bill-sections.js -- the sections of a bill modal both boards draw.
//
// WHY THIS EXISTS
// The House modal built these inline and the Senate's copied them, with less in it. They are one
// module now. The House modal's markup was compared old against new for 24 bills over synthetic
// data covering every branch (sponsor, split, committee chips and tallies, summary, every
// action-source link, every link), and was identical; what is pinned here is the contract a board
// relies on: a section with nothing to show is the empty string, values are escaped (except the
// action text a board hands over as HTML), and the support bar's arithmetic. No network.

const assert = require('assert');
globalThis.BoardUtil = require('../lib/util.js');
require('../lib/committees.js');
require('../lib/bill-sections.js');
const B = globalThis.BillSections;

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('a section with nothing in it is the empty string', () => {
  assert.strictEqual(B.sponsor({}), '');
  assert.strictEqual(B.support({ D: 0, R: 0, I: 0, total: 0 }), '');
  assert.strictEqual(B.committees({ committees: [], report: null }), '');
  assert.strictEqual(B.committees({ committees: undefined }), '');
  assert.strictEqual(B.summary(''), '');
  assert.strictEqual(B.summary(null), '');
  assert.strictEqual(B.action({ textHtml: '' }), '');
});

ok('the source line: empty without a link, a new-tab link to Congress.gov with one, escaped', () => {
  assert.strictEqual(B.source(''), '');
  assert.strictEqual(B.source(null), '');
  const html = B.source('https://www.congress.gov/bill/119th-congress/house-bill/1?a="b"');
  assert.ok(html.startsWith('<div class="bill-modal-source">Source: <a href="https://www.congress.gov/bill/'));
  assert.ok(html.includes('target="_blank"') && html.includes('&quot;') && !html.includes('"b"'));
});

ok('the sponsor card: name, party, place, photo; an unknown party is an independent', () => {
  const html = B.sponsor({ name: 'John Thune', party: 'R', loc: 'SD', photoUrl: 'https://x/p.jpg', placeholder: '<svg/>' });
  assert.ok(html.includes('absentee-party-tag republican">R<'));
  assert.ok(html.includes('<span class="absentee-name">John Thune</span>') && html.includes('<span class="absentee-state">SD</span>'));
  assert.ok(html.includes('<img class="absentee-photo" src="https://x/p.jpg" alt="John Thune"'));
  assert.ok(html.includes('<svg/>'));
  assert.ok(B.sponsor({ name: 'A', party: 'ID' }).includes('independent">I<'));
  assert.ok(!B.sponsor({ name: 'A', party: 'D' }).includes('<img'), 'no photo url, no img');
});

ok('a name is escaped, so a quote or bracket cannot break the markup', () => {
  const html = B.sponsor({ name: 'Beto "O\'Rourke" <x>', party: 'D', loc: 'TX', photoUrl: 'https://x/"y' });
  assert.ok(!html.includes('<x>') && html.includes('&lt;x&gt;') && html.includes('&quot;'), html);
});

ok('the support bar: widths are shares of the total to one decimal, and the label counts cosponsors', () => {
  const html = B.support({ D: 1, R: 2, I: 0, total: 3, cosponsorCount: 2 });
  assert.ok(html.includes('SUPPORT — 2 COSPONSORS'));
  assert.ok(html.includes('support-fill dem" style="width:33.3%" title="1 Democrat"'));
  assert.ok(html.includes('support-fill rep" style="width:66.7%" title="2 Republicans"'));
  assert.ok(!html.includes('support-fill ind') && !html.includes('>0I<'), 'a party with none is not drawn');
  assert.ok(html.includes('support-count dem">1D<') && html.includes('support-count rep">2R<'));
});

ok('one cosponsor is singular, none is "NO COSPONSORS"', () => {
  assert.ok(B.support({ D: 2, R: 0, I: 0, total: 2, cosponsorCount: 1 }).includes('SUPPORT — 1 COSPONSOR<'));
  assert.ok(B.support({ D: 1, R: 0, I: 0, total: 1, cosponsorCount: 0 }).includes('NO COSPONSORS'));
});

ok('committees: chips, the report on the FIRST chip only, and its date to the right', () => {
  const html = B.committees({
    committees: [{ name: 'Ways and Means Committee', chamber: 'House' }, { name: 'Finance Committee', chamber: 'Senate' }],
    report: 'Reported by Committee 34 – 12', reportDate: '2026-06-01', formatDate: (d) => `D(${d})`,
  });
  assert.strictEqual((html.match(/class="bill-modal-committee(?: |")/g) || []).length, 2);
  assert.strictEqual((html.match(/ct-aye/g) || []).length, 1, 'the tally is on one chip');
  assert.ok(html.indexOf('ct-aye') < html.indexOf('Finance'), 'and it is the first');
  assert.ok(html.includes('<span class="bill-modal-date">D(2026-06-01)</span>'));
  assert.ok(html.includes('is-senate'));
});

ok('reported but no committee named still shows one generic chip; no report, no date', () => {
  const html = B.committees({ committees: [], report: 'Reported by Committee', reportDate: null, formatDate: (d) => d });
  assert.ok(html.includes('committee-chip-name">Committee<'));
  assert.ok(!html.includes('bill-modal-date'));
});

ok('the summary is escaped plain text', () => {
  const html = B.summary('A & B <b>bold</b>');
  assert.ok(html.includes('A &amp; B &lt;b&gt;bold&lt;/b&gt;') && html.includes('SUMMARY (AUTHORED BY CRS)'));
});

ok('the latest action takes HTML from the board, and the date is optional', () => {
  const html = B.action({ textHtml: 'Agreed to <i>by voice</i>', dateHtml: '3 Sep <a href="x">Source</a>' });
  assert.ok(html.includes('<span class="bill-modal-action-text">Agreed to <i>by voice</i></span>'));
  assert.ok(html.includes('<span class="bill-modal-date">3 Sep <a href="x">Source</a></span>'));
  assert.ok(!B.action({ textHtml: 'Passed', dateHtml: '' }).includes('bill-modal-date'));
});

ok('links: only the ones that exist, in order, with the committee report titled by its citation', () => {
  const all = B.links({ linkClass: 'senate', text: 'https://t', report: 'https://r', reportTitle: 'S. Rept. 119-1', memo: 'https://m', congress: 'https://c' });
  const labels = [...all.matchAll(/>(View [^<]+)</g)].map((m) => m[1]);
  assert.deepStrictEqual(labels, ['View Bill Text →', 'View Committee Report →', 'View White House Memo →', 'View on Congress.gov →']);
  assert.ok(all.includes('title="S. Rept. 119-1"') && all.includes('bill-modal-link senate'));
  const some = B.links({ linkClass: 'rule', text: 'https://t', congress: 'https://c' });
  assert.deepStrictEqual([...some.matchAll(/>(View [^<]+)</g)].map((m) => m[1]), ['View Bill Text →', 'View on Congress.gov →']);
  assert.ok(B.links({ report: 'https://r' }).includes('title="Committee Report"'));
});

ok('links: the CBO cost estimate sits after the memo, titled with what it priced', () => {
  const l = B.links({ text: 'https://t', memo: 'https://m', cbo: 'https://www.cbo.gov/publication/1', cboTitle: 'S. 1 - As reported', congress: 'https://c' });
  assert.deepStrictEqual([...l.matchAll(/>(View [^<]+)</g)].map((m) => m[1]), ['View Bill Text →', 'View White House Memo →', 'View CBO Cost Estimate →', 'View on Congress.gov →']);
  assert.ok(l.includes('title="S. 1 - As reported"'));
});

ok('the Copy link button is always there, and an href is escaped', () => {
  assert.ok(B.links({}).includes('id="bill-copy-link"'));
  assert.ok(B.links({ text: 'https://t/?a=1&b="2"' }).includes('href="https://t/?a=1&amp;b=&quot;2&quot;"'));
});

console.log(`\n${n} passed`);
