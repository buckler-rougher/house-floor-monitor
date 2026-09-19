#!/usr/bin/env node
//
// Build the demo from the real 21 March 2010 session.
//
//   node dev/make-demo-aca.mjs
//
// Everything here comes from the Clerk's own roll-call XML rather than being
// invented. The previous demo attached fabricated cosponsors, a fabricated
// committee report, a dead whitehouse.gov link and an invented CRS summary to
// H.R. 4795, which is a real and politically sensitive bill. A finished vote
// needs none of that: the tallies, party splits, times and absences below are
// all on the record.
//
// That day also happens to be the ideal shape for this panel. Six roll calls,
// with the one worth watching fourth:
//
//   162  H.Res.1203  Previous Question      228-202  18:13
//   163  H.Res.1203  Agreeing to Resolution 224-206  18:29
//   164  H.Res. 925  Suspend and Agree      426-0    18:41   (4 not voting)
//   165  H.R. 3590   Concur in Senate Amdts 219-212  22:49   <- live
//   166  H.R. 4872   Motion to Recommit     199-232  23:19
//   167  H.R. 4872   Passage                220-211  23:37

import { writeFileSync, mkdirSync } from 'node:fs';

const STATE_ABBR = { Georgia: 'GA', Massachusetts: 'MA', Florida: 'FL', California: 'CA',
  Texas: 'TX', Ohio: 'OH', Michigan: 'MI', Washington: 'WA', 'New York': 'NY', Virginia: 'VA',
  Tennessee: 'TN', Indiana: 'IN', Wisconsin: 'WI', Oregon: 'OR', Missouri: 'MO', Maryland: 'MD' };

const ROLLS = [162, 163, 164, 165, 166, 167];
const LIVE = 165;

const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
};
const tag = (s, t) => (s.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [, ''])[1];

const rolls = {};
for (const n of ROLLS) {
  const xml = await get(`https://clerk.house.gov/evs/2010/roll${String(n).padStart(3, '0')}.xml`);
  const totalsBlock = (xml.match(/<totals-by-vote>([\s\S]*?)<\/totals-by-vote>/) || [, ''])[1];
  const party = {};
  for (const p of xml.match(/<totals-by-party>[\s\S]*?<\/totals-by-party>/g) || []) {
    party[tag(p, 'party').slice(0, 3)] = {
      yeas: +tag(p, 'yea-total') || 0, nays: +tag(p, 'nay-total') || 0,
      present: +tag(p, 'present-total') || 0, notVoting: +tag(p, 'not-voting-total') || 0,
    };
  }
  const notVoting = [];
  for (const rv of xml.match(/<recorded-vote>[\s\S]*?<\/recorded-vote>/g) || []) {
    if (!/<vote>Not Voting<\/vote>/.test(rv)) continue;
    const leg = rv.match(/<legislator([^>]*)>([^<]*)</);
    const at = (k) => (leg[1].match(new RegExp(`${k}="([^"]*)"`)) || [, ''])[1];
    notVoting.push({ name: leg[2], party: at('party'), state: at('state'), id: at('name-id') });
  }
  rolls[n] = {
    roll: n,
    legis: tag(xml, 'legis-num'),
    question: tag(xml, 'vote-question'),
    result: tag(xml, 'vote-result'),
    desc: tag(xml, 'vote-desc'),
    time: (xml.match(/time-etz="([0-9:]+)"/) || [, ''])[1],
    yeas: +tag(totalsBlock, 'yea-total') || 0,
    nays: +tag(totalsBlock, 'nay-total') || 0,
    notVotingTotal: +tag(totalsBlock, 'not-voting-total') || 0,
    party, notVoting,
  };
}

const live = rolls[LIVE];
const D = live.party.Dem, R = live.party.Rep;
const TOTAL_YEA = live.yeas, TOTAL_NAY = live.nays;
const DEM_SIZE = D.yeas + D.nays + D.notVoting;
const REP_SIZE = R.yeas + R.nays + R.notVoting;
const CHAMBER = DEM_SIZE + REP_SIZE;

mkdirSync('dev/fixtures/demo/debate', { recursive: true });

// ── the running tally ────────────────────────────────────────────────────────
// Waypoints that cross, ending on the real 219-212. Members do not vote in
// party order, so an early Republican block and a late Democratic one is what
// actually makes the lead change hands.
const WAY = [
  [0.00, 0, 0], [0.08, 14, 19], [0.17, 42, 38], [0.27, 66, 72],
  [0.38, 104, 99], [0.50, 138, 143], [0.62, 171, 168], [0.74, 191, 195],
  [0.86, 206, 203], [0.94, 214, 209], [1.00, TOTAL_YEA, TOTAL_NAY],
];
const lerp = (a, b, t) => a + (b - a) * t;
const at = (p) => {
  for (let i = 1; i < WAY.length; i++) {
    const [p1, y1, n1] = WAY[i], [p0, y0, n0] = WAY[i - 1];
    if (p <= p1) { const t = (p - p0) / (p1 - p0); return [Math.round(lerp(y0, y1, t)), Math.round(lerp(n0, n1, t))]; }
  }
  return [TOTAL_YEA, TOTAL_NAY];
};

const FRAMES = 40, INTERVAL_MS = 2200;
const VOTE_SECONDS = Math.round((FRAMES * INTERVAL_MS) / 1000);
const share = (run, fin, tot) => (tot === 0 ? 0 : Math.min(fin, Math.round(run * (fin / tot))));
const frames = [];
for (let i = 0; i <= FRAMES; i++) {
  const p = i / FRAMES, [yea, nay] = at(p);
  // Every yea is a Democrat on this vote; the nays split, so allocate the
  // Republican share and let Democrats take the remainder.
  const dY = Math.min(yea, D.yeas), rY = yea - dY;
  const rN = share(nay, R.nays, TOTAL_NAY), dN = nay - rN;
  const secs = Math.max(0, Math.round(VOTE_SECONDS * (1 - p)));
  const s = (n) => (n ? String(n) : '');
  frames.push({
    yeas: yea, nays: nay,
    counts: {
      blue:  { yeas: s(dY), nays: s(dN), present: '', not_voting: s(DEM_SIZE - dY - dN) },
      red:   { yeas: s(rY), nays: s(rN), present: '', not_voting: s(REP_SIZE - rY - rN) },
      white: { yeas: '', nays: '', present: '', not_voting: '' },
      totals:{ yeas: String(yea), nays: String(nay), present: '', not_voting: String(CHAMBER - yea - nay) },
    },
    timer: { seconds_remaining: secs, value: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` },
  });
}
let lead = null, changes = 0;
for (const f of frames) {
  if (f.yeas === f.nays) continue;
  const l = f.yeas > f.nays ? 'Y' : 'N';
  if (lead && l !== lead) changes++;
  lead = l;
}
writeFileSync('dev/fixtures/demo/tally-replay.json', JSON.stringify({
  intervalMs: INTERVAL_MS,
  bill: { id: '3590', number: '3590', title: live.desc },
  rollCall: String(LIVE),
  question: `${live.legis} - ${live.question}`,
  frames,
}, null, 1));

// ── the live vote ────────────────────────────────────────────────────────────
writeFileSync('dev/fixtures/demo/domewatch-floor.json', JSON.stringify({
  now: { text: 'Voting in progress', value: 'vote' },
  roll_call: {
    bill: { id: '3590', number: '3590', title: live.desc },
    number: String(LIVE),
    question: `${live.legis} - ${live.question}`,
  },
  timer: { seconds_remaining: VOTE_SECONDS, timestamp: 'PLACEHOLDER_PUBLISHED', value: `${Math.floor(VOTE_SECONDS / 60)}:${String(VOTE_SECONDS % 60).padStart(2, '0')}` },
  votes: { counts: frames[0].counts },
  fetchedAt: 'PLACEHOLDER_PUBLISHED',
}, null, 1));

// ── absences: the previous roll, which is what the panel actually shows ──────
const prev = rolls[164];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const rows = prev.notVoting.map(m =>
  `<recorded-vote><legislator name-id="${esc(m.id)}" sort-field="${esc(m.name)}" unaccented-name="${esc(m.name)}" `
+ `party="${esc(m.party)}" state="${esc(m.state)}" role="legislator">${esc(m.name)}</legislator>`
+ `<vote>Not Voting</vote></recorded-vote>`).join('');
writeFileSync('dev/fixtures/demo/roll-call.xml',
`<?xml version="1.0" encoding="UTF-8"?>
<rollcall-vote><vote-metadata><majority>D</majority><congress>111</congress><session>2nd</session>
<chamber>U.S. House of Representatives</chamber><rollcall-num>${prev.roll}</rollcall-num>
<legis-num>${esc(prev.legis)}</legis-num><vote-question>${esc(prev.question)}</vote-question>
<vote-result>${esc(prev.result)}</vote-result><action-date>21-Mar-2010</action-date>
<action-time time-etz="${prev.time}">${prev.time}</action-time>
</vote-metadata><vote-data>${rows}</vote-data></rollcall-vote>`);

writeFileSync('dev/fixtures/demo/congress-index.json', JSON.stringify({
  htmlData: '', rollNumbers: ROLLS.map(String), latestRollNumber: prev.roll,
}, null, 1));

// ── the vote series ─────────────────────────────────────────────────────────
// The six roll calls of that evening, in order, with the live one fourth. Three
// above it carry real results from the roll log; two below are still to come.
const billLabel = (r) => r.legis.replace(/^H RES /, 'H. Res. ').replace(/^H R /, 'H.R. ');
const blue = (x) => `<span style="color:rgb(66, 125, 255);">${x}</span>`;
const seriesBody =
  `<p>The House is now taking the following votes. At approximately PLACEHOLDER_START the House `
+ `will consider the remaining measures:&nbsp;</p><ol>`
+ ROLLS.map(n => {
    const r = rolls[n];
    return `<li>${blue(`<strong>${r.question} of ${billLabel(r)}</strong> \u2013 ${r.desc} \u2013 <u>15 minutes</u>`)}</li>`;
  }).join('')
+ `</ol>`;

const series = {
  id: 'demo-aca-series',
  title: `Floor Update \u2013 ${ROLLS.length} Votes`,
  body: seriesBody,
  publishedAt: 'PLACEHOLDER_PUBLISHED',
  noticeType: 'floor',
};

const logEntry = (r) => ({
  roll: String(r.roll), bill: r.desc, question: `${r.legis} - ${r.question}`,
  totals: { yeas: r.yeas, nays: r.nays, present: 0, notVoting: r.notVotingTotal },
  dem: { yeas: r.party.Dem.yeas, nays: r.party.Dem.nays, present: 0, notVoting: r.party.Dem.notVoting },
  rep: { yeas: r.party.Rep.yeas, nays: r.party.Rep.nays, present: 0, notVoting: r.party.Rep.notVoting },
  ind: { yeas: 0, nays: 0, present: 0, notVoting: 0 },
  updatedAt: 'PLACEHOLDER_PUBLISHED',
});

const bundle = {
  rollLog: [164, 163, 162].map(n => logEntry(rolls[n])),
  whipFloor: [series],
  whipNotices: [],
};
writeFileSync('dev/fixtures/demo/cold-start-bundle.json', JSON.stringify(bundle, null, 1));
writeFileSync('dev/fixtures/demo/debate/cold-start-bundle.json',
  JSON.stringify({ ...bundle, whipFloor: [] }, null, 1));

// ── cosponsors ──────────────────────────────────────────────────────────────
// The introduced text names them, but only as "Mr. Skelton" -- no party, no
// state. Roll 165's own XML carries every member of that House with party,
// state and bioguide id, so it doubles as the 111th roster and each name can be
// resolved against the Clerk's record instead of from memory. Surnames that are
// ambiguous without a state qualifier are dropped rather than guessed: naming
// the wrong member is the failure this rebuild exists to avoid.
const billText = await get('https://www.govinfo.gov/content/pkg/BILLS-111hr3590ih/html/BILLS-111hr3590ih.htm');
const plain = billText.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const intro = plain.slice(plain.indexOf('IN THE HOUSE OF REPRESENTATIVES')).replace(/\s+/g, ' ');
const listed = (intro.match(/Mr\. Rangel \(for himself,(.*?)\) introduced/) || [, ''])[1];
const names = listed.split(/,\s*and\s+|,\s*/).map(x => x.trim()).filter(Boolean);

const liveXml = await get(`https://clerk.house.gov/evs/2010/roll${LIVE}.xml`);
const roster = [];
for (const rv of liveXml.match(/<legislator[^>]*>[^<]*<\/legislator>/g) || []) {
  const at = (k) => (rv.match(new RegExp(`${k}="([^"]*)"`)) || [, ''])[1];
  const shown = (rv.match(/>([^<]*)</) || [, ''])[1];
  roster.push({ shown, surname: shown.replace(/\s*\(.*$/, '').trim(), state: at('state'), party: at('party'), id: at('name-id') });
}

const cosponsors = [];
const dropped = [];
for (const raw of names) {
  const stateHint = (raw.match(/\sof\s+([A-Z][a-z]+(?: [A-Z][a-z]+)*)$/) || [, ''])[1];
  const surname = raw.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.\s+/, '').replace(/\sof\s+.*$/, '').trim();
  const bare = surname.split(/\s+/).pop();
  let hits = roster.filter(m => m.surname.toLowerCase() === surname.toLowerCase()
                             || m.surname.toLowerCase() === bare.toLowerCase());
  if (hits.length > 1 && stateHint) {
    const st = STATE_ABBR[stateHint];
    if (st) hits = hits.filter(m => m.state === st);
  }
  if (hits.length !== 1) { dropped.push(`${raw} (${hits.length} matches)`); continue; }
  const m = hits[0];
  cosponsors.push({ firstName: '', lastName: m.surname, party: m.party, state: m.state, bioguideId: m.id });
}

// ── the bill ────────────────────────────────────────────────────────────────
// Sponsor and committee are the real ones: Mr. Rangel introduced H.R. 3590 on
// 17 September 2009 as the Service Members Home Ownership Tax Act, the vehicle
// the Senate later amended into the ACA. No cosponsor list, no committee report
// and no summary -- inventing those is what went wrong last time.
const bills = {
  ruleBills: [{
    id: 'H.R. 3590',
    title: live.desc,
    isRule: true,
    description: '',
    pubDate: '2010-03-21T22:49:00.000Z',
    status: 'passed',
    latestAction: `${live.question} \u2014 ${live.result} ${TOTAL_YEA}-${TOTAL_NAY}`,
    latestActionDate: '2010-03-21T22:49:00.000Z',
    considered: true,
    actionSource: 'proceedings',
    sponsor: { firstName: 'Charles', lastName: 'Rangel', party: 'D', state: 'NY', district: 15, bioguideId: 'R000053' },
    committees: ['Ways and Means'],
    cosponsors,
    procedure: 'rule',
    textUrl: 'https://www.govinfo.gov/content/pkg/BILLS-111hr3590enr/pdf/BILLS-111hr3590enr.pdf',
  }],
  suspensionBills: [], mayBeConsideredBills: [], consideredBills: [],
  lastUpdated: '2010-03-21T22:49:00.000Z', weekDate: '2010-03-21', rawHeaders: [],
};
writeFileSync('dev/fixtures/demo/bills.json', JSON.stringify(bills, null, 1));

// ── floor proceedings ───────────────────────────────────────────────────────
// Built from the roll calls themselves, so the times and actions are the
// Clerk's. The panel was still showing September 2026 and H.R. 4795, because
// the demo had no proceedings fixture and fell through to the vote mode's.
const etStamp = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  // 21 Mar 2010 was EDT (UTC-4).
  return new Date(Date.UTC(2010, 2, 21, h + 4, m, 0)).toUTCString().replace('GMT', 'GMT');
};
const proceedingItem = (time, text) => ({ title: text, link: '', description: text, pubDate: etStamp(time) });

const voteProceedings = {
  items: [
    proceedingItem(live.time, `On motion to concur in the Senate amendments to ${billLabel(live)} the yeas and nays were ordered.`),
    proceedingItem('20:05', `The House resolved itself into the Committee of the Whole for general debate on ${billLabel(live)}.`),
    proceedingItem(rolls[163].time, `On agreeing to ${billLabel(rolls[163])} the resolution was agreed to by recorded vote: ${rolls[163].yeas}-${rolls[163].nays}.`),
    proceedingItem(rolls[162].time, `On ordering the previous question on ${billLabel(rolls[162])} the previous question was ordered by recorded vote: ${rolls[162].yeas}-${rolls[162].nays}.`),
    proceedingItem('13:02', 'The House convened, beginning a legislative day.'),
  ],
};
writeFileSync('dev/fixtures/demo/proceedings.json', JSON.stringify(voteProceedings, null, 1));

// ── debate mode ─────────────────────────────────────────────────────────────
// The same afternoon, before the vote: general debate in the Committee of the
// Whole under the rule the House had just adopted. Debate borrowed the vote's
// state before this, so it flashed the tally on load and then emptied.
writeFileSync('dev/fixtures/demo/debate/domewatch-floor.json', JSON.stringify({
  now: { text: 'House in session', value: 'house_in_session' },
  roll_call: null, timer: null, votes: null,
  fetchedAt: 'PLACEHOLDER_PUBLISHED',
}, null, 1));

writeFileSync('dev/fixtures/demo/debate/proceedings.json', JSON.stringify({
  items: [
    proceedingItem('20:05', `DEBATE - The Committee of the Whole proceeded with general debate on ${billLabel(live)}.`),
    proceedingItem('19:42', `The House resolved itself into the Committee of the Whole House on the state of the Union for consideration of ${billLabel(live)}.`),
    proceedingItem(rolls[163].time, `On agreeing to ${billLabel(rolls[163])} the resolution was agreed to by recorded vote: ${rolls[163].yeas}-${rolls[163].nays}.`),
    proceedingItem('13:02', 'The House convened, beginning a legislative day.'),
  ],
}, null, 1));

console.log(`  proceedings: ${voteProceedings.items.length} items, built from the roll calls`);
console.log(`  debate: own floor state (no vote) + general debate proceedings`);
console.log(`  series: ${ROLLS.length} votes, live one is #${ROLLS.indexOf(LIVE) + 1}`);
console.log(`  rollLog: ${bundle.rollLog.length} completed (162, 163, 164)`);
console.log(`  bill: H.R. 3590, sponsor Rangel (D-NY-15), Ways and Means`);
console.log(`  cosponsors: ${cosponsors.length} of ${names.length} resolved against roll ${LIVE}'s roster ` +
            `(${cosponsors.filter(c => c.party === 'D').length}D / ${cosponsors.filter(c => c.party === 'R').length}R)` +
            (dropped.length ? `; dropped ${dropped.length}: ${dropped.join(', ')}` : ''));
console.log(`  live: roll ${LIVE} ${live.legis} ${TOTAL_YEA}-${TOTAL_NAY} (${live.result})`);
console.log(`  party: D ${D.yeas}-${D.nays}, R ${R.yeas}-${R.nays}; chamber ${CHAMBER}`);
console.log(`  replay: ${frames.length} frames, ${changes} lead changes, clock ${VOTE_SECONDS}s`);
console.log(`  absences from roll ${prev.roll}: ${prev.notVoting.map(m => `${m.name} (${m.party}-${m.state})`).join(', ')}`);
