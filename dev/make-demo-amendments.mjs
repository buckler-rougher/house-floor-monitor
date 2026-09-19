#!/usr/bin/env node
//
// Build the amendments fixture for the demo's debate panel.
//
//   node dev/make-demo-amendments.mjs
//
// /api/amendments was stubbed to an empty array in the harness, so the
// Amendments tab read "No amendments submitted" and its counter stayed blank --
// on a bill being debated under a rule, which is exactly when amendments exist.
//
// Sponsors are written in the Clerk's own format ("Mr. Lastname (ST)") because
// enrichAmendments parses that string and looks each name up in the member-data
// fixture; anything else renders without a photo or party colour.

import { readFileSync, writeFileSync } from 'node:fs';

const xml = JSON.parse(readFileSync('dev/fixtures/base/member-data.json', 'utf8')).xmlData;
const roster = [];
for (const m of xml.match(/<member>[\s\S]*?<\/member>/g) || []) {
  const g = (t) => (m.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [, ''])[1];
  const sd = g('statedistrict');
  if (!sd || !g('lastname')) continue;
  roster.push({ last: g('lastname'), state: sd.slice(0, 2), party: g('party'), courtesy: g('courtesy') || 'Mr.' });
}
const byParty = (p) => roster.filter(m => m.party === p);
const R = byParty('R'), D = byParty('D');
const fmt = (m) => `${m.courtesy} ${m.last} (${m.state})`;

// A spread a rule would actually produce: some made in order and adopted, some
// failed, one withdrawn, several still pending, and a bipartisan pair.
const PLAN = [
  { status: 'Adopted',   party: 'R', extra: null },
  { status: 'Adopted',   party: 'R', extra: 'D' },   // bipartisan
  { status: 'Failed',    party: 'D', extra: null },
  { status: 'Adopted',   party: 'D', extra: null },
  { status: 'Withdrawn', party: 'R', extra: null },
  { status: 'Pending',   party: 'D', extra: null },
  { status: 'Pending',   party: 'R', extra: 'D' },   // bipartisan
  { status: 'Pending',   party: 'D', extra: null },
  { status: 'Failed',    party: 'R', extra: null },
];

const PURPOSES = [
  'Requires the Secretary to publish the register of reportable foreign gifts in machine-readable form.',
  'Exempts community colleges with fewer than 5,000 enrolled students from the contract reporting requirement.',
  'Strikes the civil penalty provisions in section 4.',
  'Extends the disclosure deadline from 30 to 90 days for institutions reporting for the first time.',
  'Adds research security training requirements for principal investigators.',
  'Requires an annual GAO review of the Department’s enforcement actions.',
  'Clarifies that gifts from allied governments are not subject to the register.',
  'Directs the Secretary to establish an appeals process for penalty determinations.',
  'Narrows the definition of foreign country of concern to those designated under section 1260H.',
];

const amendments = PLAN.map((p, i) => {
  const primary = (p.party === 'R' ? R : D)[(i * 5 + 3) % (p.party === 'R' ? R.length : D.length)];
  const second = p.extra ? (p.extra === 'R' ? R : D)[(i * 11 + 7) % (p.extra === 'R' ? R.length : D.length)] : null;
  const sponsors = second ? `${fmt(primary)}, ${fmt(second)}` : fmt(primary);
  return {
    num: String(i + 1),
    sponsors,
    party: p.party,
    status: p.status,
    purpose: PURPOSES[i],
    version: 'Submitted',
  };
});

writeFileSync('dev/fixtures/demo/amendments.json', JSON.stringify({ amendments }, null, 1));
const tally = amendments.reduce((a, x) => (a[x.status] = (a[x.status] || 0) + 1, a), {});
console.log(`  ${amendments.length} amendments`, JSON.stringify(tally));
console.log(`  bipartisan: ${amendments.filter(a => a.sponsors.includes(',')).length}`);
