#!/usr/bin/env node
// The nightly refresh of the Members window's snapshot (.github/workflows/member-stats.yml).
//
//   node dev/refresh-member-stats.mjs [--congress N] [--api BASE] [--from DIR_OR_URL] [--out DIR]
//
// Takes the last published snapshot and vote record, asks the site's own /api/member-rolls for the roll calls since (the Clerk is not contacted from here: the Worker reads the Clerk and keeps each
// roll call), adds them with the same counting the page uses (lib/member-stats-core.js), recomputes "votes like theirs" (every pair of Members: too heavy for a Worker, fine here), and writes
//   member-stats-<congress>.json   what the page loads
//   member-votes-<congress>.json   each Member's Yea / Nay on every roll call (one character each), which the next refresh needs
// to --out, and says "changed" or "unchanged". A new Congress starts empty. The two files are published by the workflow as assets of the `member-data` release; the Worker serves them
// (/api/member-stats) and the page adds whatever is newer than that, live.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MS = require('../lib/member-stats-core.js');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const byDate = () => { const n = new Date(), y = n.getUTCFullYear(), eff = n.getUTCMonth() > 0 || n.getUTCDate() >= 3 ? y : y - 1, start = eff % 2 === 0 ? eff - 1 : eff; return 118 + (start - 2023) / 2; };
const CONGRESS = Number(arg('congress', byDate()));
const API = arg('api', 'https://api.evanhollander.org/house-floor');
const FROM = arg('from', 'https://github.com/buckler-rougher/house-floor-monitor/releases/download/member-data');
const OUT = arg('out', 'member-data-out');

async function readJson(where, name) {
  try {
    if (/^https?:/.test(where)) { const r = await fetch(`${where}/${name}`); return r.ok ? await r.json() : null; }
    const f = path.join(where, name); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  } catch (e) { return null; }
}

let data = await readJson(FROM, `member-stats-${CONGRESS}.json`);
let votes = await readJson(FROM, `member-votes-${CONGRESS}.json`);
if (!data) { data = MS.empty(CONGRESS); votes = { votes: {} }; console.error(`starting the ${CONGRESS}th Congress from nothing`); }
else if (!votes) { console.error(`there is a snapshot for the ${CONGRESS}th Congress but no vote record beside it: build both with dev/build-member-stats.mjs --votes-out and publish them`); process.exit(2); }
data.members = data.members.filter((m) => m.state !== 'XX');
const V = new Map(Object.entries(votes.votes).map(([id, s]) => [id, s.split('')]));   // id -> one character per roll call

let added = 0;
for (let guard = 0; guard < 400; guard++) {
  const last = MS.lastRoll(data);
  const res = await fetch(`${API}/api/member-rolls?congress=${CONGRESS}&after=${last ? `${last.y}-${last.n}` : ''}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!res || !Array.isArray(res.rolls)) { console.error('the roll call route did not answer; keeping what there is'); break; }
  for (const r of res.rolls) {
    const idx = data.rollList.length;
    const n = MS.apply(data, [Object.assign({}, r, { members: res.members || {} })]);
    if (!n) continue;
    added += n;
    const how = new Map(); r.yea.forEach((id) => how.set(id, '1')); r.nay.forEach((id) => how.set(id, '2'));
    for (const id of Object.keys(res.members || {})) if (!V.has(id) && res.members[id][1] !== 'XX') V.set(id, new Array(idx).fill('0'));
    for (const [id, arr] of V) arr.push(how.get(id) || '0');
  }
  if (res.done || !res.rolls.length) break;
}
data.members = data.members.filter((m) => m.state !== 'XX');

if (!added) { console.log('unchanged'); process.exit(0); }

// votes like theirs: agreement over the roll calls both voted Yea or Nay on, at least 150 of them
const ids = data.members.map((m) => m.id).filter((id) => V.has(id));
for (const m of data.members) {
  const a = V.get(m.id); if (!a) { m.like = []; continue; }
  const scores = [];
  for (const id of ids) {
    if (id === m.id) continue;
    const b = V.get(id); let shared = 0, same = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; if (x !== '0' && y !== '0') { shared++; if (x === y) same++; } }
    if (shared >= 150) scores.push([id, +(100 * same / shared).toFixed(1)]);
  }
  scores.sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1));   // ties by id, so a full rebuild and the nightly refresh pick the same Members
  m.like = scores.slice(0, 6);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `member-stats-${CONGRESS}.json`), JSON.stringify(data));
fs.writeFileSync(path.join(OUT, `member-votes-${CONGRESS}.json`), JSON.stringify({ congress: CONGRESS, rolls: data.rollList.length, through: data.through, votes: Object.fromEntries([...V].map(([id, a]) => [id, a.join('')])) }));
console.log(`changed: ${added} roll call${added === 1 ? '' : 's'} added, through ${data.through}`);
