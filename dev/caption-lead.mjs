#!/usr/bin/env node
//
// Does the caption stream see morning business before the Clerk records it?
//
//   node dev/caption-lead.mjs 20260916 20260915 ...
//   node dev/caption-lead.mjs            # the last 20 days, session days only
//
// The board picks its mode from the Clerk's proceedings feed. That feed is slow
// during morning business, and morning business is short -- a prayer and pledge
// are over in two minutes -- so a feed that lags misses them entirely rather
// than reporting them late, and the board sits in the wrong mode through the
// one part of the day it could have been right.
//
// Captions arrive within seconds of the words being spoken. Before building
// anything on them, this measures whether they are actually good enough:
//
//   detection  does the caption text contain the event at all
//   offset     caption first-mention vs the Clerk's own timestamp for it
//   noise      caption matches on days or moments with no such action
//
// WHAT THIS DOES NOT MEASURE. The Clerk's floor-action page gives the time an
// action HAPPENED, not the time its entry appeared in the feed. Publication lag
// -- the actual complaint -- can only be measured by polling the live feed
// during a session and recording first-seen times. This answers the prior
// question: are captions reliable enough to be worth wiring up at all.

import '../lib/floor-speaker.js';

const H = globalThis.HouseFloorSpeaker;
const BROADCAST = 'https://liveproxy-azapp-prod-eastus2-003.azurewebsites.net/broadcastevents';

const get = async (url, label, timeoutMs = 25_000) => {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
  return r.text();
};

// Anchored phrases, not keywords. "prayer" alone appears in debate; the Chair's
// stock language for opening business does not.
const EVENTS = [
  { key: 'prayer',
    caption: /prayer will be\s+offered|offered the following prayer|offered by (?:the )?chaplain|chaplain[^.]{0,30}offered/i,
    clerk:   /prayer/i },
  { key: 'pledge',
    caption: /pledge of allegiance/i,
    clerk:   /pledge of allegiance/i },
  { key: 'silence',
    caption: /moment of silence/i,
    clerk:   /moment of silence/i },
  { key: 'one-minute',
    caption: /recognized for one minute|one[- ]minute speech/i,
    clerk:   /one[- ]minute speech/i },
];

async function captionsFor(date) {
  const raw = await get(`${BROADCAST}/${date}`, 'broadcast events');
  if (!raw.trim()) return null;
  const data = JSON.parse(raw);
  const event = Array.isArray(data) ? data[0] : null;
  const files = event?.asset?.files || [];
  const vtt = files.filter((f) => (f.type || '').toUpperCase() === 'WEBVTT');
  const pick = vtt.find((f) => f.url?.includes('/east/')) || vtt[0];
  if (!pick?.url) return null;
  // Anchor cue offsets to the event's startDate, NOT the asset name.
  //
  // The asset name is when the encoder started, which is several minutes before
  // the House convenes -- the stream opens on a holding card. On 16 Sep the name
  // said 08:51:54 while startDate said 09:00:00, and anchoring to the name put
  // every caption ~8 minutes early. That bias was the entire "captions lead the
  // Clerk by 8-12 minutes" result in the first run of this script; it was
  // measuring its own misalignment. Against startDate the prayer cue lands at
  // 09:00:30 versus the Clerk's 09:00, which is the agreement you would expect.
  const m = (event.startDate || '').match(/T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return { url: pick.url.replace(/#.*$/, ''), startMin: (+m[1]) * 60 + (+m[2]) + (+m[3]) / 60 };
}

// Cue offset -> minutes since midnight ET on the session day.
const cueToMinutes = (meta, offsetSec) => meta.startMin + offsetSec / 60;

async function clerkActions(date) {
  const mmddyyyy = `${date.slice(4, 6)}%2F${date.slice(6, 8)}%2F${date.slice(0, 4)}`;
  const html = await get(`https://clerk.house.gov/FloorSummary/ViewFloorActions?date=${mmddyyyy}`, 'floor actions');
  const out = [];
  // "10:44:18 PM, Bills:, Activity: The House adjourned ..."
  for (const m of html.matchAll(/(\d{1,2}):(\d{2}):(\d{2})\s*([AP])M[^,]*,[^,]*,\s*Activity:\s*([^"<]{4,300})/g)) {
    let h = +m[1] % 12;
    if (m[4] === 'P') h += 12;
    out.push({ minutes: h * 60 + (+m[2]) + (+m[3]) / 60, text: m[5].replace(/\s+/g, ' ').trim() });
  }
  return out;
}

const fmt = (mins) => {
  if (mins == null) return '   --  ';
  const h = Math.floor(mins / 60), m = Math.floor(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

function daysAgoET(n) {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setDate(et.getDate() - n);
  return `${et.getFullYear()}${String(et.getMonth() + 1).padStart(2, '0')}${String(et.getDate()).padStart(2, '0')}`;
}

const dates = process.argv.slice(2).filter((a) => /^\d{8}$/.test(a));
const targets = dates.length ? dates : Array.from({ length: 20 }, (_, i) => daysAgoET(i + 1));

const rows = [];
for (const date of targets) {
  let meta, cues, actions;
  try {
    meta = await captionsFor(date);
    if (!meta) { if (dates.length) console.log(`  ${date}  no broadcast / no captions`); continue; }
    cues = H.parseCaptionCues(await get(meta.url, 'captions', 40_000));
    actions = await clerkActions(date);
  } catch (e) {
    console.log(`  ${date}  skipped: ${String(e.message).slice(0, 60)}`);
    continue;
  }
  if (!cues.length) { console.log(`  ${date}  captions empty`); continue; }

  console.log(`\n### ${date}   ${cues.length} cues, ${actions.length} clerk actions`);
  // Cues are one short line each, so a phrase spanning a line break never
  // matches a single cue: "THE PRAYER WILL BE" / "OFFERED BY CHAPLAIN KIBBEN."
  // is two cues, and the first run of this script reported prayer as undetected
  // on every day because of it. Search a rolling join instead, and attribute the
  // hit to the cue the match starts in.
  const WINDOW = 6;
  const findPhrase = (re) => {
    for (let i = 0; i < cues.length; i++) {
      const joined = cues.slice(i, i + WINDOW).map((c) => c.text).join(' ');
      if (re.test(joined)) return cues[i];
    }
    return null;
  };

  for (const ev of EVENTS) {
    const cue = findPhrase(ev.caption);
    const act = actions.filter((a) => ev.clerk.test(a.text)).sort((a, b) => a.minutes - b.minutes)[0];
    const capMin = cue ? cueToMinutes(meta, cue.t) : null;
    const actMin = act ? act.minutes : null;
    const delta = (capMin != null && actMin != null) ? (actMin - capMin) : null;
    const verdict = capMin == null && actMin == null ? 'neither'
                  : capMin == null ? 'MISSED by captions'
                  : actMin == null ? 'caption only (no clerk action)'
                  : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} min`;
    console.log(`  ${ev.key.padEnd(11)} caption ${fmt(capMin)}  clerk ${fmt(actMin)}  ${verdict}`);
    rows.push({ date, key: ev.key, capMin, actMin, delta });
  }
}

// ── summary ─────────────────────────────────────────────────────────────────
console.log('\n── summary ──');
for (const ev of EVENTS) {
  const mine = rows.filter((r) => r.key === ev.key);
  const both = mine.filter((r) => r.delta != null).map((r) => r.delta).sort((a, b) => a - b);
  const missed = mine.filter((r) => r.capMin == null && r.actMin != null).length;
  const only = mine.filter((r) => r.capMin != null && r.actMin == null).length;
  const median = both.length ? both[Math.floor(both.length / 2)] : null;
  console.log(`  ${ev.key.padEnd(11)} matched ${String(both.length).padStart(2)}  median ${median == null ? '  --' : (median >= 0 ? '+' : '') + median.toFixed(1)} min`
            + `  missed-by-captions ${missed}  caption-only ${only}`);
}
console.log('\n  Positive median = captions saw it first, by that many minutes.');
console.log('  caption-only rows are candidate false positives: check them before trusting a trigger.');
console.log('  This is detection accuracy against the Clerk’s own action times.');
console.log('  Feed publication lag is a separate measurement and needs a live poller.');
