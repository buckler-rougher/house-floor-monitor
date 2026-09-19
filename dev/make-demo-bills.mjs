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
