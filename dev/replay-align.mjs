#!/usr/bin/env node
//
// How does the House's archived video line up with the Clerk's clock?
//
//   node dev/replay-align.mjs [roll-from] [roll-to]       # defaults: the newest 70 rolls of this year
//
// The time machine needs ONE mapping from a position in the archived video to a wall-clock time in Eastern, because the Clerk's floor log and its roll call files
// are in wall-clock time and the video and its captions are in elapsed seconds. Three zero points could be right: the stream's start (the asset name, "2026-09-16T08-51-54"),
// the broadcast event's startDate ("09:00:00"), and the caption file's own header ("NOTE CAPTIONS TIME OFFSET: 00:03:57.914"). dev/caption-lead.mjs found 8 minutes of bias
// when it used the first, so this measures instead of assuming.
//
// THE ANCHOR is the roll call result. A roll call's XML says what minute it was taken (`action-time time-etz="19:05"`), and the chair reads the result aloud with its
// numbers ("ON THIS VOTE THE YEAS ARE 237 THE NAYS ARE 190"), so the caption cue with those two numbers gives that same moment in video seconds. For each candidate zero point
// the script prints, per day, the median difference between the Clerk's minute and the video's, and how far the votes of that day spread around it. The right zero point is
// the one whose median is near the same for every day and whose spread is a minute or less (the Clerk's time has only minute resolution).

import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ClerkVotes = require(join(ROOT, 'lib/clerk-votes.js'));

const get = async (url, tries = 2) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)', Accept: '*/*' }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch { /* retry */ }
  }
  return null;
};

const year = new Date().getFullYear();
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const hms = (s) => { const sign = s < 0 ? '-' : '+'; s = Math.abs(Math.round(s)); return `${sign}${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; };

// ---- the rolls ----
let hi = Number(process.argv[3]);
if (!hi) {
  // newest roll: walk the listing's first page
  const html = await get(ClerkVotes.listUrl(year));
  hi = Number((ClerkVotes.parseRolls(html, year)[0] || {}).rollNumber);
}
const lo = Number(process.argv[2]) || Math.max(1, hi - 199);
console.log(`rolls ${lo} to ${hi} of ${year}`);
const rolls = [];
for (let n = hi; n >= lo; n -= 6) {
  const batch = [];
  for (let k = n; k > n - 6 && k >= lo; k--) batch.push(get(`https://clerk.house.gov/evs/${year}/roll${String(k).padStart(3, '0')}.xml`).then((x) => (x ? { n: k, ...ClerkVotes.parseRoll(x), etz: (x.match(/time-etz="(\d\d):(\d\d)"/) || []) } : null)));
  for (const r of await Promise.all(batch)) if (r && r.date && r.etz[1]) rolls.push(r);
}
const byDay = new Map();
for (const r of rolls) { (byDay.get(r.date) || byDay.set(r.date, []).get(r.date)).push(r); }
console.log(`${rolls.length} rolls on ${byDay.size} days`);

// ---- per day ----
const results = [];
for (const [date, rs] of [...byDay].sort()) {
  if (rs.length < 2) continue;
  const [mm, dd, yyyy] = date.split('/');
  const id = `${yyyy}${mm}${dd}`;
  const ev = JSON.parse((await get(`https://liveproxy-azapp-prod-eastus2-003.azurewebsites.net/broadcastevents/${id}`)) || 'null');
  const e = ev && ev[0];
  if (!e) { console.log(`${date}: no broadcast event`); continue; }
  const files = (e.asset || {}).files || [];
  const vtt = (files.find((f) => f.type === 'WebVTT' && /\/east\//.test(f.url)) || files.find((f) => f.type === 'WebVTT') || {}).url;
  const text = vtt && (await get(vtt) || '').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  if (!text) { console.log(`${date}: no captions`); continue; }  // (the file uses CRLF: normalised above)
  const note = (text.match(/CAPTIONS TIME OFFSET:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/) || []);
  const noteOffset = note[1] ? Number(note[1]) * 3600 + Number(note[2]) * 60 + Number(note[3]) : 0;
  const hash = (files.find((f) => f.type === 'HLS') || {}).url || '';
  const tFrag = Number((hash.match(/#t=([\d.]+)/) || [])[1]) || 0;
  const an = (e.asset.name || '').match(/(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)/);
  const assetStart = an ? Number(an[4]) * 3600 + Number(an[5]) * 60 + Number(an[6]) : NaN;
  const sd = (e.startDate || '').match(/T(\d\d):(\d\d):(\d\d)/);
  const eventStart = sd ? Number(sd[1]) * 3600 + Number(sd[2]) * 60 + Number(sd[3]) : NaN;
  const cues = [...text.matchAll(/(\d+):(\d\d):(\d\d\.\d+) --> [\d:.]+\n([\s\S]*?)(?=\n\n)/g)].map((m) => ({ t: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]), text: m[4].replace(/\n/g, ' ') }));

  const rows = [];
  for (const r of rs) {
    const y = r.totals.yeas, nn = r.totals.nays;
    // a window of five cues, so the sentence may span cues
    let hit = null;
    for (let i = 0; i < cues.length - 4 && !hit; i++) {
      const w = cues.slice(i, i + 5).map((c) => c.text).join(' ');
      const m = w.match(/YEAS\s+ARE\s+(\d+)[^0-9]{0,40}NAYS\s+ARE\s+(\d+)/);
      if (m && Number(m[1]) === y && Number(m[2]) === nn) hit = cues[i + 2].t;
    }
    if (hit != null) rows.push({ roll: r.n, clerk: Number(r.etz[1]) * 3600 + Number(r.etz[2]) * 60, cue: hit });
  }
  if (process.env.VERBOSE) for (const x of rows) console.log(`   roll ${x.roll}  clerk ${new Date(x.clerk * 1000).toISOString().slice(11, 16)}  caption at +${Math.floor(x.cue / 3600)}:${String(Math.floor(x.cue % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(x.cue % 60)).padStart(2, '0')}  startDate+cue = ${new Date((eventStart + x.cue) * 1000).toISOString().slice(11, 19)}  delta ${hms(x.clerk - (eventStart + x.cue))}`);
  if (rows.length < 2) { console.log(`${date}: only ${rows.length} rolls found in the captions of ${rs.length}`); continue; }
  const cand = {
    'asset start': (c) => assetStart + c,
    'event startDate': (c) => eventStart + c,
    'asset start + NOTE offset': (c) => assetStart + noteOffset + c,
    'event startDate + NOTE offset': (c) => eventStart + noteOffset + c,
    'asset start + #t': (c) => assetStart + tFrag + c,
  };
  const line = { date, rolls: rows.length, assetStart: assetStart / 3600, eventStart: eventStart / 3600, noteOffset, tFrag };
  console.log(`\n${date}  ${rows.length} of ${rs.length} rolls found in captions; asset ${an && an.slice(4, 7).join(':')}, startDate ${sd && sd.slice(1).join(':')}, NOTE offset ${noteOffset}s, #t ${tFrag}s`);
  for (const [name, f] of Object.entries(cand)) {
    // the Clerk's minute is the START of a minute: the vote could be anywhere in [m, m+60); so the difference has a 60 s band
    const d0 = rows.map((x) => x.clerk - f(x.cue));
    // a tally pair can occur twice in a day (two votes with the same totals), so the match may be the wrong vote: keep the deltas within ten minutes of the day's median
    const m0 = median(d0);
    const d = d0.filter((v) => Math.abs(v - m0) <= 600);
    const med = median(d);
    const spread = Math.max(...d) - Math.min(...d);
    line[name + ' within90'] = d.filter((v) => v >= -30 && v <= 90).length; line[name + ' n'] = d.length;
    line[name] = med; line[name + ' spread'] = spread;
    console.log(`  ${name.padEnd(32)} clerk - video: median ${hms(med).padStart(9)}  spread ${String(Math.round(spread)).padStart(4)}s  (${line[name + ' within90']} of ${d.length} within -30..+90 s)`);
  }
  results.push(line);
}
console.log('\nsummary (median of the per-day medians, and how much days differ from each other)');
for (const name of ['asset start', 'event startDate', 'asset start + NOTE offset', 'event startDate + NOTE offset', 'asset start + #t']) {
  const meds = results.map((r) => r[name]).filter((x) => !Number.isNaN(x));
  const sp = results.map((r) => r[name + ' spread']);
  console.log(`  ${name.padEnd(32)} median ${hms(median(meds)).padStart(9)}  days range ${Math.round(Math.max(...meds) - Math.min(...meds))}s  mean in-day spread ${Math.round(sp.reduce((a, b) => a + b, 0) / (sp.length || 1))}s  (${meds.length} days)`);
}
