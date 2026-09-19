#!/usr/bin/env node
//
// Build the cold-start bundle the demo's VOTE SERIES panel reads.
//
//   node dev/make-demo-series.mjs
//
// The base fixture's only series notices are "Last Vote" ones whose votes have
// all finished, and renderVoteTimeline hides a series once every item has a
// terminal result -- so the demo showed "No active vote series."
//
// This announces five votes and places the live one THIRD: two above it already
// carry results from the roll log, two below are still pending. That is the only
// arrangement where the timeline shows all three states at once, which is the
// point of the panel.

import { readFileSync, writeFileSync } from 'node:fs';

const base = JSON.parse(readFileSync('dev/fixtures/base/cold-start-bundle.json', 'utf8'));

const blue = (s) => `<span style="color:rgb(66, 125, 255);">${s}</span>`;
const item = (action, bill, title, sponsor, mins, rec) =>
  `<li>${blue(`<strong>${action} of ${bill}</strong> – ${title} (${sponsor})`
    + (rec ? ` – <strong><u>${rec}</u></strong>` : '')
    + ` – <u>${mins} minutes</u>`)}</li>`;

const body =
  `<p>The House is now taking the following votes. At approximately PLACEHOLDER_START the House will `
+ `consider the remaining measures:&nbsp;</p><ol>`
+ item('Passage', 'H.R. 3421', 'Veterans’ Housing Stability Act', 'Rep. Alford – Veterans’ Affairs', 15, 'VOTE YES')
+ item('Passage', 'H.R. 7710', 'Rural Broadband Modernization Act', 'Rep. Hoyle – Energy and Commerce', 5, 'VOTE NO')
+ item('Passage', 'H.R. 4795', 'Protect Economic and Academic Freedom Act of 2026', 'Rep. Walberg – Education and Workforce', 5, 'VOTE NO')
+ item('Passage', 'H.R. 5120', 'Federal Records Transparency Act', 'Rep. Mace – Oversight', 5, '')
+ item('Motion on Ordering the Previous Question', 'H. Res. 1533', 'Providing for consideration of H.R. 6012', 'Rep. Foxx – Rules', 5, '')
+ `</ol>`;

// PLACEHOLDER_PUBLISHED is rewritten to a recent timestamp by dev/harness.js --
// the demo runs on a live clock, and a fixed date here would age out of the
// timeline's lookback window.
const series = {
  id: 'demo-floor-update-5-votes',
  title: 'Floor Update – 5 Votes',
  body,
  publishedAt: 'PLACEHOLDER_PUBLISHED',
  noticeType: 'floor',
};

const rollLogEntry = (roll, legis, title, question, yeas, nays, dYea, dNay, rYea, rNay) => ({
  roll: String(roll), bill: title, question: `${legis} - ${question}`,
  totals: { yeas, nays, present: 0, notVoting: 433 - yeas - nays },
  dem: { yeas: dYea, nays: dNay, present: 0, notVoting: 214 - dYea - dNay },
  rep: { yeas: rYea, nays: rNay, present: 0, notVoting: 218 - rYea - rNay },
  ind: { yeas: 0, nays: 0, present: 0, notVoting: 1 },
  updatedAt: 'PLACEHOLDER_PUBLISHED',
});

const bundle = {
  // Votes one and two are finished; the live one (roll 295) is deliberately
  // absent so the timeline reads it from the board instead.
  rollLog: [
    rollLogEntry(294, 'H R 7710', 'Rural Broadband Modernization Act', 'On Passage', 194, 231, 181, 26, 13, 204),
    rollLogEntry(293, 'H R 3421', 'Veterans’ Housing Stability Act', 'On Passage', 402, 19, 196, 11, 206, 8),
    ...base.rollLog.slice(0, 6),
  ],
  whipFloor: [series, ...base.whipFloor.filter(i => !/floor\s+update/i.test(i.title)).slice(0, 4)],
  whipNotices: base.whipNotices.slice(0, 3),
};

writeFileSync('dev/fixtures/demo/cold-start-bundle.json', JSON.stringify(bundle, null, 1));
console.log(`  series: 5 votes, live one is #3`);
console.log(`  rollLog: ${bundle.rollLog.length} entries (293 passed, 294 failed)`);
console.log(`  whipFloor: ${bundle.whipFloor.length}, whipNotices: ${bundle.whipNotices.length}`);
