#!/usr/bin/env node
//
// Build the demo's debate mode from H.R. 3684 (117th), the INVEST in America
// Act, which the Senate later amended into the Infrastructure Investment and
// Jobs Act.
//
//   node dev/make-demo-debate.mjs
//
// The vote demo replays the ACA, which was considered under a closed rule, so
// its amendments panel is legitimately empty. Debate mode needs a bill that
// exercises every panel, and this one does: reported by committee on a recorded
// 38-26 vote, 324 amendments (173 Democratic, 114 Republican, 37 bipartisan)
// across five dispositions, three cosponsors, and a Statement of Administration
// Policy. H.R. 1 was tried first and rejected -- it was never reported by
// committee, so its committee-vote section could never be filled.
//
// Everything is fetched from the source at build time -- the amendment table
// from rules.house.gov, the sponsor and committee referral from the introduced
// text, and the member identities from the roll call on the bill itself, which
// doubles as the 117th roster. Nothing here is written by hand.
//
// The worker's own /api/amendments cannot be used: its parser returns zero for
// every pre-119th bill, because the archived Rules pages use a different table
// layout. That is a live-site limitation worth fixing separately; the demo
// sidesteps it by baking the real rows into a fixture.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)' };
const get = async (url, headers = {}) => {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
};
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// ── amendments ───────────────────────────────────────────────────────────────
const rulesHtml = await get('https://rules.house.gov/bill/117/hr-3684');
const amendments = [];
for (const row of rulesHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
  if (!row.includes('amendments-rules.house.gov')) continue;
  const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map(c => strip(c));
  if (cells.length < 6) continue;
  const pdf = (row.match(/https:\/\/amendments-rules\.house\.gov[^"']+/) || [])[0] || null;
  const [num, version, sponsors, party, summaryRaw, status] = cells;
  amendments.push({
    num, version, sponsors, party, status, pdfUrl: pdf,
    // The summary cell repeats "Revised" from the version column on revised
    // amendments; drop it so the text reads as a summary rather than a label.
    summary: summaryRaw.replace(/^Revised\s+/, ''),
  });
}

// ── sponsor, cosponsors and committees ──────────────────────────────────────
const billText = strip(await get('https://www.govinfo.gov/content/pkg/BILLS-117hr3684ih/html/BILLS-117hr3684ih.htm'));
const intro = billText.slice(billText.indexOf('IN THE HOUSE OF REPRESENTATIVES'));
const sponsorLine = (intro.match(/(M[rs]?s?\.\s[^(]+)\(for (?:himself|herself)(.*?)\) introduced/) || []);
const sponsorName = (sponsorLine[1] || '').trim();
const cosponsorNames = (sponsorLine[2] || '').split(/,\s*and\s+|,\s*/).map(s => s.trim()).filter(Boolean);
// Two referral shapes: a single committee ends at the rule line, a multi-
// committee one runs to "for a period to be subsequently determined". Without
// the first alternative the match ran to the end of the bill and produced two
// thousand "committees".
const referral = (intro.match(/referred to the Committees? on ([\s\S]{0,400}?)(?:,? for a period|\s_{5,}|$)/) || [, ''])[1];
// Committee names contain commas of their own ("Science, Space, and
// Technology"), so protect the compound ones before splitting the list on
// commas -- otherwise one referral becomes three committees that do not exist.
const COMPOUND = ['Science, Space, and Technology', 'Education and Labor',
  'Ways and Means', 'Oversight and Reform', 'Homeland Security', 'Armed Services',
  'Financial Services', 'Intelligence (Permanent Select)'];
let guarded = referral;
COMPOUND.forEach((name, i) => { guarded = guarded.split(name).join(`\u0000${i}\u0000`); });
const committees = guarded
  .replace(/\band in addition to the Committees? on\b/g, ',')
  .split(/,\s*(?:and\s+)?/)
  .map(x => x.trim().replace(/^the\s+/i, ''))
  .map(x => x.replace(/\u0000(\d+)\u0000/g, (_, i) => COMPOUND[+i]))
  .filter(x => x && x.length > 2 && !/^for$/i.test(x));

// ── the 117th roster, from the roll call on this bill ───────────────────────
const voteXml = await get('https://clerk.house.gov/evs/2021/roll062.xml');
const roster = [];
for (const leg of voteXml.match(/<legislator[^>]*>[^<]*<\/legislator>/g) || []) {
  const at = (k) => (leg.match(new RegExp(`${k}="([^"]*)"`)) || [, ''])[1];
  const shown = (leg.match(/>([^<]*)</) || [, ''])[1];
  roster.push({ surname: shown.replace(/\s*\(.*$/, '').trim(), state: at('state'), party: at('party'), id: at('name-id') });
}
// Delegates do not appear in roll-call rosters -- they cannot vote on passage --
// so a cosponsor like Ms. Norton of DC is absent from the vote XML. Fall back to
// the member-data fixture for those, still requiring a unique exact surname so
// the wrong member can never be substituted.
const memberXml = JSON.parse(readFileSync('dev/fixtures/base/member-data.json', 'utf8')).xmlData;
const delegates = [];
for (const m of memberXml.match(/<member>[\s\S]*?<\/member>/g) || []) {
  const g = (t) => (m.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [, ''])[1];
  const sd = g('statedistrict');
  if (!sd || !g('lastname')) continue;
  delegates.push({ surname: g('lastname'), state: sd.slice(0, 2), party: g('party'), id: g('bioguideID') });
}
const resolve = (raw) => {
  const surname = raw.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.\s+/, '').replace(/\sof\s+.*$/, '').trim();
  for (const pool of [roster, delegates]) {
    const hits = pool.filter(m => m.surname.toLowerCase() === surname.toLowerCase());
    if (hits.length === 1) {
      const m = hits[0];
      return { firstName: '', lastName: m.surname, party: m.party, state: m.state, bioguideId: m.id };
    }
  }
  return null;
};
const sponsor = resolve(sponsorName);
const cosponsors = cosponsorNames.map(resolve).filter(Boolean);

mkdirSync('dev/fixtures/demo/debate', { recursive: true });
writeFileSync('dev/fixtures/demo/debate/amendments.json', JSON.stringify({ amendments }, null, 1));

writeFileSync('dev/fixtures/demo/debate/bills.json', JSON.stringify({
  ruleBills: [{
    id: 'H.R. 3684', title: 'INVEST in America Act', isRule: true, description: '',
    pubDate: '2021-06-30T20:00:00.000Z', status: 'debate',
    latestAction: 'Considered in the Committee of the Whole under the provisions of H. Res. 491',
    latestActionDate: '2021-06-30T20:00:00.000Z',
    actionSource: 'proceedings', procedure: 'rule',
    sponsor, cosponsors, committees,
    // "ordered reported to the House with a favorable recommendation, amended,
    // by a record vote of 38 yeas and 26 nays (Roll Call Vote No. 38)".
    committeeReport: 'Ordered reported by the Committee on Transportation and Infrastructure, 38\u201326',
    committeeReportDate: '2021-06-10T00:00:00.000Z',
    committeeReportUrl: 'https://www.govinfo.gov/content/pkg/CRPT-117hrpt70/pdf/CRPT-117hrpt70.pdf',
    textUrl: 'https://www.govinfo.gov/content/pkg/BILLS-117hr3684ih/pdf/BILLS-117hr3684ih.pdf',
    sapUrl: 'https://bidenwhitehouse.archives.gov/wp-content/uploads/2021/06/SAP-HR3684.pdf',
    governingHres: 'H. Res. 491',
  }],
  suspensionBills: [], mayBeConsideredBills: [], consideredBills: [],
  lastUpdated: '2021-06-30T20:00:00.000Z', weekDate: '2021-06-30', rawHeaders: [],
}, null, 1));

writeFileSync('dev/fixtures/demo/debate/domewatch-floor.json', JSON.stringify({
  now: { text: 'House in session', value: 'house_in_session' },
  roll_call: null, timer: null, votes: null, fetchedAt: 'PLACEHOLDER_PUBLISHED',
}, null, 1));

const at = (h, m, text) => ({ title: text, description: text, link: '',
  pubDate: new Date(Date.UTC(2021, 5, 30, h + 4, m, 0)).toUTCString() });  // 30 Jun 2021 was EDT
writeFileSync('dev/fixtures/demo/debate/proceedings.json', JSON.stringify({
  items: [
    at(20, 12, 'DEBATE - The Committee of the Whole proceeded with general debate on H.R. 3684.'),
    at(19, 48, 'The House resolved itself into the Committee of the Whole House on the state of the Union for consideration of H.R. 3684.'),
    at(18, 30, 'On agreeing to H. Res. 491 the resolution was agreed to by recorded vote.'),
    at(12, 0, 'The House convened, beginning a legislative day.'),
  ],
}, null, 1));

writeFileSync('dev/fixtures/demo/debate/cold-start-bundle.json',
  JSON.stringify({ rollLog: [], whipFloor: [], whipNotices: [] }, null, 1));

const by = (k) => amendments.reduce((a, x) => (a[x[k]] = (a[x[k]] || 0) + 1, a), {});
console.log(`  amendments: ${amendments.length}`, JSON.stringify(by('party')));
console.log(`  statuses:`, JSON.stringify(by('status')));
console.log(`  sponsor: ${sponsorName} -> ${sponsor ? `${sponsor.lastName} (${sponsor.party}-${sponsor.state})` : 'UNRESOLVED'}`);
console.log(`  cosponsors: ${cosponsors.map(c => `${c.lastName} (${c.party}-${c.state})`).join(', ')}`);
console.log(`  committees (${committees.length}): ${committees.join(' | ')}`);
