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
// GPO puts a placeholder up before the real Record: four constituent granules
// (one each for Daily Digest, Extensions, House, Senate), no congMember markup
// anywhere, titled "Daily Digest". CREC-2026-09-16 still looked like this three
// days after a 603-turn session. A full day's Record carries well over a hundred
// granules, so the count separates the two cleanly.
const SKELETON_MAX_GRANULES = 10;
const recordIsPublished = (mods) =>
  (mods.match(/<relatedItem type="constituent"/g) || []).length > SKELETON_MAX_GRANULES;

const crecUrl = (d) => `https://www.govinfo.gov/metadata/pkg/CREC-${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}/mods.xml`;

// 20 s cap: on 19 Sep the broadcast API hung on a no-session date and the job
// sat for 4m13s before the proxy gave up with HTTP 499.
const get = async (url, label, timeoutMs = 20_000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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

// N days ago in Eastern Time — the House runs on ET.
function daysAgoET(n) {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setDate(et.getDate() - n);
  return `${et.getFullYear()}${String(et.getMonth() + 1).padStart(2, '0')}${String(et.getDate()).padStart(2, '0')}`;
}

// Which recent days the Record actually covers.
//
// It does NOT arrive the next morning. Checked on 2026-09-16, the newest published
// day was 2026-09-14: the 15th returned a 302 to govinfo's error page, as did the
// 13th, 12th and 11th. So "grade yesterday" found nothing nearly every run — which
// is exactly what the first scheduled run did, reporting 447 turns it could not
// score against anything.
//
// Rather than guess a fixed offset, ask. Walking back also copes with weekends,
// recesses and a lag that varies, and grading more than one day means a session
// still gets scored on the run after it finally appears.
async function publishedDates(maxBack, want) {
  const found = [];
  for (let i = 1; i <= maxBack && found.length < want; i++) {
    const d = daysAgoET(i);
    try {
      const r = await fetch(crecUrl(d), { method: 'GET', redirect: 'manual' });
      if (r.status === 200) found.push(d);
    } catch { /* treat as unavailable */ }
  }
  return found;
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
if (!dates.length) {
  const auto = await publishedDates(8, 3);
  if (!auto.length) {
    say('no published Congressional Record in the last 8 days — nothing to grade');
    process.exit(0);
  }
  dates.push(...auto);
}

const byId = new Map(roster.map((r) => [r.bioguideId, r]));
const nameOf = (id, fallback) => {
  const r = byId.get(id);
  return r ? `${r.lastDisplay} (${r.party}-${r.postal})` : (fallback || id);
};

let worstPrecision = null;
let gradedAny = false;
// Turns we resolved on a day the Record could not score. A quiet week is fine; a
// full session that produced no grade means this tool is broken, and the two look
// identical in a green run unless they are told apart.
let ungradedTurns = 0;
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
    if (!g.graded) {
      // Only an ungraded day whose Record GPO has actually published points at a
      // bug here. Before publication there is nothing to grade against, and
      // failing the build for that just means failing every run until GPO
      // catches up -- which is what happened on 19 Sep.
      const published = recordIsPublished(mods);
      say(`  not graded: ${g.reason}${published ? '' : ' [Record not published yet]'}`);
      if (published) ungradedTurns = Math.max(ungradedTurns, g.attributedTurns || 0);
      continue;
    }
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
// A whole session that went unscored is a failure of this tool, not of the
// resolver — the first scheduled run reported exactly that and passed green.
const SESSION_TURNS = 50;
const brokenlyQuiet = !gradedAny && ungradedTurns >= SESSION_TURNS;
const failed = (gradedAny && worstPrecision !== null && worstPrecision < MIN_PRECISION) || brokenlyQuiet;
if (gradedAny) say(`\nlowest precision ${worstPrecision}% (threshold ${MIN_PRECISION}%)`);
else if (brokenlyQuiet) say(`\nGRADED NOTHING, yet a day carried ${ungradedTurns} attributed turns — the Record should have covered it`);
else say('\nnothing to grade: no floor speech in the Record for any day checked');
if (summaryPath && summary.length) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(summaryPath, ['## Floor speaker attribution vs the Congressional Record', ...summary, ''].join('\n'));
}
process.exit(failed ? 1 : 0);
