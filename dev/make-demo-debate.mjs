#!/usr/bin/env node
//
// Build the demo's debate mode from H.R. 1 (117th), the For the People Act.
//
//   node dev/make-demo-debate.mjs
//
// The vote demo replays the ACA, which was considered under a closed rule, so
// its amendments panel is legitimately empty. Debate mode needs a bill that
// actually went through the Rules Committee, and this one did: 183 amendments,
// 77 Democratic, 104 Republican, 2 bipartisan, across five dispositions.
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

import { writeFileSync, mkdirSync } from 'node:fs';

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)' };
const get = async (url, headers = {}) => {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
};
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// ── amendments ───────────────────────────────────────────────────────────────
const rulesHtml = await get('https://rules.house.gov/bill/117/hr-1');
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
const billText = strip(await get('https://www.govinfo.gov/content/pkg/BILLS-117hr1ih/html/BILLS-117hr1ih.htm'));
const intro = billText.slice(billText.indexOf('IN THE HOUSE OF REPRESENTATIVES'));
const sponsorLine = (intro.match(/(M[rs]?s?\.\s[^(]+)\(for (?:himself|herself)(.*?)\) introduced/) || []);
const sponsorName = (sponsorLine[1] || '').trim();
const cosponsorNames = (sponsorLine[2] || '').split(/,\s*and\s+|,\s*/).map(s => s.trim()).filter(Boolean);
const referral = (intro.match(/referred to the Committee on ([\s\S]*?), for a period/) || [, ''])[1];
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
const resolve = (raw) => {
  const surname = raw.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.\s+/, '').replace(/\sof\s+.*$/, '').trim();
  const hits = roster.filter(m => m.surname.toLowerCase() === surname.toLowerCase());
  if (hits.length !== 1) return null;
  const m = hits[0];
  return { firstName: '', lastName: m.surname, party: m.party, state: m.state, bioguideId: m.id };
};
const sponsor = resolve(sponsorName);
const cosponsors = cosponsorNames.map(resolve).filter(Boolean);

mkdirSync('dev/fixtures/demo/debate', { recursive: true });
writeFileSync('dev/fixtures/demo/debate/amendments.json', JSON.stringify({ amendments }, null, 1));

writeFileSync('dev/fixtures/demo/debate/bills.json', JSON.stringify({
  ruleBills: [{
    id: 'H.R. 1', title: 'For the People Act of 2021', isRule: true, description: '',
    pubDate: '2021-03-03T20:00:00.000Z', status: 'debate',
    latestAction: 'Considered in the Committee of the Whole under the provisions of H. Res. 179',
    latestActionDate: '2021-03-03T20:00:00.000Z',
    actionSource: 'proceedings', procedure: 'rule',
    sponsor, cosponsors, committees,
    // The introduced text, not a reported one: H.R. 1 was never reported by
    // committee, so BILLS-117hr1rh does not exist. govinfo answers that package
    // with a 200 and an HTML error page, so the broken link looked like a
    // working one until the content type was checked.
    textUrl: 'https://www.govinfo.gov/content/pkg/BILLS-117hr1ih/pdf/BILLS-117hr1ih.pdf',
    // Statement of Administration Policy, 1 March 2021, from the Biden White
    // House archive rather than whitehouse.gov, where the original 404s now.
    sapUrl: 'https://bidenwhitehouse.archives.gov/wp-content/uploads/2021/03/SAP_HR-1.pdf',
    governingHres: 'H. Res. 179',
  }],
  suspensionBills: [], mayBeConsideredBills: [], consideredBills: [],
  lastUpdated: '2021-03-03T20:00:00.000Z', weekDate: '2021-03-03', rawHeaders: [],
}, null, 1));

writeFileSync('dev/fixtures/demo/debate/domewatch-floor.json', JSON.stringify({
  now: { text: 'House in session', value: 'house_in_session' },
  roll_call: null, timer: null, votes: null, fetchedAt: 'PLACEHOLDER_PUBLISHED',
}, null, 1));

const at = (h, m, text) => ({ title: text, description: text, link: '',
  pubDate: new Date(Date.UTC(2021, 2, 3, h + 5, m, 0)).toUTCString() });   // 3 Mar 2021 was EST
writeFileSync('dev/fixtures/demo/debate/proceedings.json', JSON.stringify({
  items: [
    at(20, 12, 'DEBATE - The Committee of the Whole proceeded with general debate on H.R. 1.'),
    at(19, 48, 'The House resolved itself into the Committee of the Whole House on the state of the Union for consideration of H.R. 1.'),
    at(18, 30, 'On agreeing to H. Res. 179 the resolution was agreed to by recorded vote.'),
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
