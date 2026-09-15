#!/usr/bin/env node
//
// Grade the caption-derived speaker attribution against the Congressional Record.
//
//   node dev/grade.mjs 20260903 [20260914 ...]
//
// For each date this fetches the day's captions (via the Clerk's broadcast event),
// resolves speakers with lib/floor-speaker.js, and scores the result against
// GPO's CREC mods.xml, which tags every floor speech with a bioguide ID.
//
// The number to watch is `unconfirmed`: members the site named who the Record says
// never spoke on the floor that day. Those are unambiguously wrong, and they are
// broken out by `basis` so the failing rule names itself. Everything else is
// context — coverage can be low for honest reasons (morning one-minutes identify
// nobody), but a name that never spoke is always a bug.
//
// Network only, no writes. Safe to run against any past session day.

import '../lib/floor-speaker.js';
import '../lib/crec.js';

const H = globalThis.HouseFloorSpeaker;
const C = globalThis.Crec;

const BROADCAST = 'https://liveproxy-azapp-prod-eastus2-003.azurewebsites.net/broadcastevents';
const MEMBERS = 'https://clerk.house.gov/xml/lists/MemberData.xml';
const crecUrl = (d) => `https://www.govinfo.gov/metadata/pkg/CREC-${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}/mods.xml`;

const get = async (url, label) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
  return r.text();
};

async function captionsUrlFor(date) {
  const raw = await get(`${BROADCAST}/${date}`, 'broadcast events');
  if (!raw.trim()) return null;
  const data = JSON.parse(raw);
  const files = (data?.[0]?.asset?.files) || [];
  const vtt = files.filter((f) => (f.type || '').toUpperCase() === 'WEBVTT');
  const pick = vtt.find((f) => f.url?.includes('/east/')) || vtt[0];
  return pick?.url ? pick.url.replace(/#.*$/, '') : null;
}

// Yesterday in Eastern Time — the House runs on ET, and the Record for a sitting
// day is published the following morning.
function yesterdayET() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setDate(et.getDate() - 1);
  return `${et.getFullYear()}${String(et.getMonth() + 1).padStart(2, '0')}${String(et.getDate()).padStart(2, '0')}`;
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
// Below this, something has genuinely broken rather than one name drifting: a
// single unconfirmed member is ordinary, and a job that goes red most nights is a
// job nobody reads.
const MIN_PRECISION = Number(flag('--min-precision', 90));
const summaryPath = args.includes('--summary') ? process.env.GITHUB_STEP_SUMMARY : null;
const summary = [];
const say = (line) => { console.log(line); if (summaryPath) summary.push(line); };

const roster = H.buildRoster(await get(MEMBERS, 'member data'));
const dates = args.filter((a) => /^\d{8}$/.test(a));
if (!dates.length) dates.push(yesterdayET());

const byId = new Map(roster.map((r) => [r.bioguideId, r]));
const nameOf = (id, fallback) => {
  const r = byId.get(id);
  return r ? `${r.lastDisplay} (${r.party}-${r.postal})` : (fallback || id);
};

let worstPrecision = null;
let gradedAny = false;
for (const date of dates) {
  say(`\n### ${date}`);
  try {
    const capUrl = await captionsUrlFor(date);
    if (!capUrl) { say('  no broadcast for this date'); continue; }

    const [vtt, mods] = await Promise.all([
      get(capUrl, 'captions'),
      get(crecUrl(date), 'CREC mods'),
    ]);

    const resolved = H.resolveFloorSpeakers(H.splitTurns(H.parseCaptionCues(vtt)), roster);
    const crec = C.parseCrecSpeakers(mods);
    const g = C.gradeTimeline(resolved.timeline, crec);

    say(`  turns ${g.speechTurns}  attributed ${g.attributedTurns} (${g.coveragePct}%)`);
    if (!g.graded) { say(`  not graded: ${g.reason}`); continue; }
    gradedAny = true;
    if (worstPrecision === null || g.precisionPct < worstPrecision) worstPrecision = g.precisionPct;
    say(`  speakers: record ${g.crecSpeakers}, ours ${g.ourSpeakers}, confirmed ${g.confirmed}`);
    say(`  precision ${g.precisionPct}%   recall ${g.recallPct}%   order ${g.sequencePct}%`);

    if (g.unconfirmedIds.length) {
      say(`  UNCONFIRMED — named by the site, absent from the Record:`);
      for (const id of g.unconfirmedIds) say(`      ${nameOf(id)}`);
      say('  by rule:');
      for (const [basis, st] of Object.entries(g.byBasis).sort((a, b) => b[1].unconfirmedTurns - a[1].unconfirmedTurns)) {
        if (st.unconfirmedTurns) say(`      ${basis}: ${st.unconfirmedTurns}/${st.turns} turns unconfirmed`);
      }
    } else {
      say('  every name the site printed appears in the Record');
    }

    if (g.missedIds.length) {
      const shown = g.missedIds.slice(0, 12).map((id) => {
        const hit = crec.find((s) => s.bioguideId === id);
        return nameOf(id, hit?.parsedName);
      });
      say(`  not identified (${g.missedIds.length}): ${shown.join(', ')}${g.missedIds.length > 12 ? ', …' : ''}`);
    }
  } catch (err) {
    say(`  failed: ${err.message}`);
  }
}
const failed = gradedAny && worstPrecision !== null && worstPrecision < MIN_PRECISION;
if (gradedAny) say(`\nlowest precision ${worstPrecision}% (threshold ${MIN_PRECISION}%)`);
if (summaryPath && summary.length) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(summaryPath, ['## Floor speaker attribution vs the Congressional Record', ...summary, ''].join('\n'));
}
process.exit(failed ? 1 : 0);
