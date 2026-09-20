#!/usr/bin/env node
//
// How long after a floor action does it reach the board?
//
//   node dev/proceedings-lag.mjs                  # poll until Ctrl-C
//   node dev/proceedings-lag.mjs --minutes=120    # stop on its own
//   node dev/proceedings-lag.mjs --interval=15    # seconds between polls
//
// Run this DURING a session. dev/caption-lead.mjs measures whether captions can
// detect morning business, but it compares against the Clerk's action times --
// when things happened, not when the entry appeared. That leaves the actual
// question open: the board reads a feed, and the complaint is that the feed is
// slow during morning business. Nobody has measured how slow.
//
// So poll and watch. Each item carries a pubDate, which is the time of the
// action. Recording when the item first becomes visible gives the publication
// lag directly.
//
// Two sources, because they answer different things:
//
//   clerk   clerk.house.gov/Home/Feed      upstream lag, the Clerk's own delay
//   api     our /api/proceedings           what the board actually sees, which
//                                          adds the worker's cache TTL on top
//
// The gap between them is ours to fix; the clerk figure is not.
//
// Every observation is appended to a JSONL file as it happens, so a crash or a
// closed laptop costs nothing and the log can be analysed later.

import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const INTERVAL_MS = Math.max(5, Number(arg('interval', 20))) * 1000;
const STOP_AFTER_MS = Number(arg('minutes', 0)) * 60 * 1000;
const OUT = arg('out', 'dev/proceedings-lag.jsonl');

const SOURCES = {
  clerk: 'https://clerk.house.gov/Home/Feed',
  api: 'https://api.evanhollander.org/house-floor/api/proceedings',
};

const seen = new Map();   // `${source}:${hash}` -> true
const rows = [];

// Resume: anything already logged stays logged, so restarting mid-session does
// not double-count or re-time an item that was seen an hour ago.
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); seen.set(`${r.source}:${r.hash}`, true); rows.push(r); } catch {}
  }
  console.log(`  resumed: ${rows.length} observations already logged`);
}

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const clean = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
                      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// The Clerk serves RSS; our worker serves JSON. Both end up as {when, text}.
function parseItems(source, body) {
  const out = [];
  if (source === 'api') {
    try {
      for (const it of (JSON.parse(body).items || [])) {
        const text = clean(it.description || it.title || '');
        if (text && it.pubDate) out.push({ when: Date.parse(it.pubDate), text });
      }
    } catch {}
    return out;
  }
  for (const item of body.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const pub = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    const desc = (item.match(/<description>([\s\S]*?)<\/description>/) || [])[1]
              || (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    if (!pub || !desc) continue;
    const text = clean(desc);
    if (text) out.push({ when: Date.parse(pub.trim()), text });
  }
  return out;
}

const mins = (ms) => (ms / 60000);
const fmtLag = (m) => `${m >= 0 ? '+' : ''}${m.toFixed(1)}m`;

const bootstrapped = new Set(
  // A resumed run has already bootstrapped whatever is in the log.
  [...new Set(rows.map((r) => r.source))]
);

async function poll() {
  const now = Date.now();
  for (const [source, url] of Object.entries(SOURCES)) {
    let body;
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) { console.log(`  ${source}: HTTP ${r.status}`); continue; }
      body = await r.text();
    } catch (e) { console.log(`  ${source}: ${String(e.message).slice(0, 50)}`); continue; }

    for (const item of parseItems(source, body)) {
      if (!Number.isFinite(item.when)) continue;
      const h = hash(item.text);
      const key = `${source}:${h}`;
      if (seen.has(key)) continue;
      seen.set(key, true);
      // An item already in the feed when polling started has no measurable lag:
      // it was published at some unknown earlier moment. Flag rather than count.
      //
      // Per poll, not per item. Testing "have I logged anything for this source"
      // inside the item loop flags only the first item of the first poll and
      // counts the rest as live -- which reported a median lag of 4,404 minutes,
      // those being the previous session day's entries sitting in the feed.
      const firstPoll = !bootstrapped.has(source);
      const row = { source, hash: h, actionAt: new Date(item.when).toISOString(),
                    firstSeenAt: new Date(now).toISOString(), lagMin: +mins(now - item.when).toFixed(2),
                    backfill: firstPoll, text: item.text.slice(0, 160) };
      rows.push(row);
      appendFileSync(OUT, JSON.stringify(row) + '\n');
      console.log(`  [${source}] ${fmtLag(row.lagMin)}${row.backfill ? ' (backfill)' : ''}  ${row.text.slice(0, 84)}`);
    }
    bootstrapped.add(source);
  }
}

function summary() {
  const lines = [];
  const say = (t) => { console.log(t); lines.push(t); };
  say('\n── publication lag ──');
  for (const source of Object.keys(SOURCES)) {
    const live = rows.filter((r) => r.source === source && !r.backfill).map((r) => r.lagMin).sort((a, b) => a - b);
    if (!live.length) { say(`  ${source.padEnd(6)} no live observations yet`); continue; }
    const med = live[Math.floor(live.length / 2)];
    say(`  ${source.padEnd(6)} n=${String(live.length).padStart(3)}  median ${fmtLag(med)}`
      + `  p90 ${fmtLag(live[Math.floor(live.length * 0.9)])}  max ${fmtLag(live[live.length - 1])}`);
  }
  const c = rows.filter((r) => r.source === 'clerk' && !r.backfill).map((r) => r.lagMin);
  const a = rows.filter((r) => r.source === 'api' && !r.backfill).map((r) => r.lagMin);
  if (c.length && a.length) {
    const med = (x) => x.sort((p, q) => p - q)[Math.floor(x.length / 2)];
    say(`\n  our added delay: ${fmtLag(med(a) - med(c))} on top of the Clerk`);
  }
  say(`\n  log: ${OUT}`);
  say('  backfill rows are items already present at startup; they carry no timing.');

  // So an unattended run leaves its result somewhere a person will see it.
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        ['## Proceedings publication lag', '', '```', ...lines, '```', ''].join('\n'));
    } catch {}
  }
}

process.on('SIGINT', () => { summary(); process.exit(0); });

console.log(`  polling every ${INTERVAL_MS / 1000}s${STOP_AFTER_MS ? ` for ${STOP_AFTER_MS / 60000} min` : ' (Ctrl-C to stop)'}`);
const started = Date.now();
await poll();
const timer = setInterval(async () => {
  await poll();
  if (STOP_AFTER_MS && Date.now() - started >= STOP_AFTER_MS) { clearInterval(timer); summary(); process.exit(0); }
}, INTERVAL_MS);
