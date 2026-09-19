#!/usr/bin/env node
//
// Build the roll-call XML the demo's absentee panel reads.
//
//   node dev/make-demo-roll.mjs
//
// The panel lists members who missed the previous vote series, which it gets by
// fetching the Clerk's roll XML for latestRollNumber and collecting every
// <recorded-vote> whose <vote> is "Not Voting". Unrouted, that fetch returned
// "{}" and the panel always read ALL MEMBERS VOTED.
//
// Members are drawn from the same member-data fixture the rest of the site uses,
// so the names, parties and states in the absentee list match the roster the
// board is showing rather than being invented.

import { readFileSync, writeFileSync } from 'node:fs';

const xml = JSON.parse(readFileSync('dev/fixtures/base/member-data.json', 'utf8')).xmlData;

const members = [];
for (const m of xml.match(/<member>[\s\S]*?<\/member>/g) || []) {
  const pick = (t) => (m.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [, ''])[1];
  const sd = pick('statedistrict');
  const party = pick('party') || pick('caucus');
  const last = pick('lastname'), first = pick('firstname');
  if (!sd || !last) continue;
  members.push({ state: sd.slice(0, 2), district: sd.slice(2), party, last, first,
                 sortName: pick('sort-name'), bioguide: pick('bioguideID') });
}

// 14 absences, weighted the way a real series runs: a few more from the minority,
// spread across states rather than clustered.
const ABSENT = 14;
const step = Math.floor(members.length / ABSENT);
const absent = new Set();
for (let i = 0; i < ABSENT; i++) absent.add(members[(i * step + 7) % members.length]);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rows = members.map((mem) => {
  const vote = absent.has(mem)
    ? 'Not Voting'
    : (mem.party === 'R' ? 'Yea' : 'Nay');
  return `<recorded-vote><legislator name-id="${esc(mem.bioguide)}" sort-field="${esc(mem.last)}" `
       + `unaccented-name="${esc(mem.last)}" party="${esc(mem.party)}" state="${esc(mem.state)}" `
       + `role="legislator">${esc(mem.last)}</legislator><vote>${vote}</vote></recorded-vote>`;
}).join('');

const out = `<?xml version="1.0" encoding="UTF-8"?>
<rollcall-vote><vote-metadata><majority>R</majority><congress>119</congress><session>2nd</session>
<chamber>U.S. House of Representatives</chamber><rollcall-num>295</rollcall-num>
<legis-num>H R 4795</legis-num><vote-question>On Passage</vote-question>
<vote-type>YEA-AND-NAY</vote-type><vote-result>Passed</vote-result>
<action-date>16-Sep-2026</action-date><action-time time-etz="14:38">2:38 PM</action-time>
</vote-metadata><vote-data>${rows}</vote-data></rollcall-vote>`;

writeFileSync('dev/fixtures/demo/roll-call.xml', out);
const byParty = {};
for (const a of absent) byParty[a.party] = (byParty[a.party] || 0) + 1;
console.log(`  ${members.length} members, ${absent.size} not voting`, JSON.stringify(byParty));
