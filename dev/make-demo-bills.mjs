#!/usr/bin/env node
//
// Build the bills fixture the demo's debate panel reads.
//
//   node dev/make-demo-bills.mjs
//
// The debate panel hides its sponsor and summary sections unless the bill
// carries them, and the base fixture's H.R. 4795 entry has neither -- so debate
// mode rendered a large empty box holding a title and two links. Its status also
// said "passed / Passed 237-169", which is not a bill anyone is still debating.
//
// The sponsor is a real member taken from the member-data fixture, matching the
// one the vote-series notice already credits.

import { readFileSync, writeFileSync } from 'node:fs';

const bills = JSON.parse(readFileSync('dev/fixtures/base/bills.json', 'utf8'));

const SPONSOR = {
  firstName: 'Tim', lastName: 'Walberg', party: 'R',
  state: 'MI', district: 5, bioguideId: 'W000798',
};

const SUMMARY =
  'Prohibits institutions of higher education that receive Federal research funding '
+ 'from entering into contracts with, or accepting gifts from, entities owned or '
+ 'controlled by a foreign country of concern, and directs the Secretary of Education '
+ 'to publish an annual register of reportable foreign gifts. Establishes civil '
+ 'penalties for failure to disclose and conditions continued eligibility for Federal '
+ 'research grants on compliance.';

// Cosponsors drawn from the real roster, weighted like a committee-reported bill
// that picked up a handful of minority support -- so the SUPPORT bar has two
// colours rather than a single block.
const roster = (() => {
  const xml = JSON.parse(readFileSync('dev/fixtures/base/member-data.json', 'utf8')).xmlData;
  const out = [];
  for (const m of xml.match(/<member>[\s\S]*?<\/member>/g) || []) {
    const g = (t) => (m.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [, ''])[1];
    const sd = g('statedistrict');
    if (!sd || !g('lastname')) continue;
    out.push({
      firstName: g('firstname'), lastName: g('lastname'), party: g('party'),
      state: sd.slice(0, 2), district: Number(sd.slice(2)) || 0, bioguideId: g('bioguideID'),
    });
  }
  return out;
})();
const pick = (party, n, skip) => roster.filter(m => m.party === party && m.bioguideId !== skip).filter((_, i) => i % 7 === 0).slice(0, n);
const COSPONSORS = [...pick('R', 21, 'W000798'), ...pick('D', 6, null)];

let patched = 0;
for (const key of ['ruleBills', 'suspensionBills', 'consideredBills', 'mayBeConsideredBills']) {
  for (const b of bills[key] || []) {
    if (!/4795/.test(b.id || '')) continue;
    b.sponsor = SPONSOR;
    // The panel reads foundBill.summary, not description -- description stays
    // empty in the Clerk's own feed, which is why it was free to reuse here.
    b.summary = SUMMARY;
    b.description = SUMMARY;
    b.committee = 'Education and Workforce';
    b.cosponsors = COSPONSORS;
    b.committees = ['Education and Workforce', 'Science, Space, and Technology'];
    b.committeeReport = 'Reported by the Committee on Education and Workforce, 24\u201319';
    b.committeeReportDate = '2026-07-29T00:00:00.000Z';
    b.committeeReportUrl = 'https://www.congress.gov/119/crpt/hrpt412/CRPT-119hrpt412.pdf';
    b.sapUrl = 'https://www.whitehouse.gov/wp-content/uploads/2026/09/SAP-HR-4795.pdf';
    b.procedure = 'rule';
    // Under debate, not finished: the base entry said passed, with a final tally.
    b.status = 'debate';
    b.latestAction = 'Considered as unfinished business in the Committee of the Whole '
                   + 'under the provisions of H. Res. 1490';
    delete b.considered;
    patched++;
  }
}

writeFileSync('dev/fixtures/demo/bills.json', JSON.stringify(bills, null, 1));
console.log(`  patched ${patched} H.R. 4795 entr${patched === 1 ? 'y' : 'ies'}`);
console.log(`  sponsor ${SPONSOR.firstName} ${SPONSOR.lastName} (${SPONSOR.party}-${SPONSOR.state}-0${SPONSOR.district}), summary ${SUMMARY.length} chars`);
console.log(`  cosponsors ${COSPONSORS.length} (${COSPONSORS.filter(c => c.party === 'R').length}R / ${COSPONSORS.filter(c => c.party === 'D').length}D), 2 committees, report + SAP`);
