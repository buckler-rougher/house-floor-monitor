#!/usr/bin/env node
// Member vote statistics for the current Congress, from the Clerk's roll call files (evs/<year>/rollNNN.xml).
//
//   node dev/build-member-stats.mjs [--cache DIR] [--out FILE] [--years 2025,2026]
//
// Each roll call lists every sitting member (bioguide id, party, state) with Yea, Nay, Present, Not Voting (or a name, for a Speaker election).
// "Missed" is Not Voting. A member's rolls are the ones they appear in, so a member who joined late, or left, is only counted for the votes held while they served.
//
//   rolls    how many roll calls they were listed on
//   missed   of those, how many were Not Voting
//   days     voting days (a date with at least one roll) they were listed on, and the ones they missed every roll of
//   weeks    the same for calendar weeks (Monday to Sunday) with a vote
//   unity    on party-unity rolls (a majority of Democrats against a majority of Republicans, counting Yea and Nay only), how often they voted with
//            their own party's majority; `breaks` is the other times they voted. Independents are not scored.
//
//   cast     each Member's last 40 votes actually cast (not Not Voting): [roll index, Y | N | P | O]. O is anything else, as in a Speaker election.
//   like     the five Members whose votes most often match theirs, over rolls where both voted Yea or Nay (at least 150 shared): [id, percent].
//   y, n, r  on each roll: the Yeas, the Nays and the result, so a missed vote can be put against its margin.
//
// Downloads are cached under --cache so a rerun only fetches rolls it has not seen. Nothing here guesses: a roll that cannot be fetched or parsed is reported and left out.
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const CACHE = arg('cache', '.member-stats-cache');
const OUT = arg('out', 'member-stats.json');
const YEARS = arg('years', '2025,2026').split(',').map(Number);
const DELAY = Number(arg('delay', '0'));   // ms between downloads (cached rolls cost nothing); a slow, steady pace is kind to the Clerk's site
const CONGRESS = 119;
fs.mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'house-floor-monitor member stats' } });
      if (r.status === 404) return null;
      if (r.ok) { const t = await r.text(); return /<rollcall-vote/.test(t) ? t : null; }   // a missing roll comes back 200 with an "Error sanitizing file" stub
    } catch (e) { /* retry */ }
    await sleep(800 * (i + 1));
  }
  return 'ERR';
}

const tag = (s, t) => { const m = s.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`)); return m ? m[1].trim() : ''; };
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function isoDate(d) { const m = d.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/); return m ? `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; }
function weekOf(iso) { // Monday of that date's week
  const d = new Date(iso + 'T12:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10);
}

function parseRoll(xml) {
  const meta = xml.slice(0, xml.indexOf('<vote-data>'));
  if (Number(tag(meta, 'congress')) !== CONGRESS) return null;
  const date = isoDate(tag(meta, 'action-date'));
  if (!date) return null;
  const votes = [];
  for (const m of xml.matchAll(/<recorded-vote>\s*<legislator name-id="([^"]+)"[^>]*? party="([^"]*)" state="([^"]*)"[^>]*>([^<]*)<\/legislator>\s*<vote>([^<]*)<\/vote>/g)) {
    votes.push({ id: m[1], party: m[2], state: m[3], name: m[4].trim(), v: m[5].trim() });
  }
  if (!votes.length) return null;
  const tot = meta.match(/<totals-by-vote>[\s\S]*?<yea-total>(\d+)<\/yea-total>\s*<nay-total>(\d+)<\/nay-total>/);
  return { yeas: tot ? Number(tot[1]) : null, nays: tot ? Number(tot[2]) : null, result: tag(meta, 'vote-result'), roll: Number(tag(meta, 'rollcall-num')), date, question: tag(meta, 'vote-question'), type: tag(meta, 'vote-type'), legis: tag(meta, 'legis-num'), desc: tag(meta, 'vote-desc'), votes };
}

async function loadYear(year) {
  const rolls = [];
  const failed = [];
  let missesInARow = 0;
  for (let n = 1; n < 2000; n += 8) {
    const batch = [];
    for (let k = 0; k < 8; k++) {
      const num = n + k; const f = path.join(CACHE, `${year}-${String(num).padStart(3, '0')}.xml`);
      if (fs.existsSync(f)) { batch.push({ num, xml: fs.readFileSync(f, 'utf8') }); continue; }
      if (DELAY) await sleep(DELAY);
      const got = await get(`https://clerk.house.gov/evs/${year}/roll${String(num).padStart(3, '0')}.xml`);
      if (got === 'ERR') { failed.push(num); batch.push({ num, xml: null }); continue; }
      if (got) fs.writeFileSync(f, got);
      batch.push({ num, xml: got });
    }
    let any = false;
    for (const b of batch) {
      if (!b.xml) continue;
      any = true;
      const r = parseRoll(b.xml);
      if (r) rolls.push(r); else console.error('skipped', year, b.num);
    }
    missesInARow = any ? 0 : missesInARow + 1;
    if (missesInARow >= 1) break;
  }
  const top = Math.max(0, ...rolls.map((r) => r.roll));
  const lost = failed.filter((n) => n < top);
  if (lost.length) throw new Error(`${year}: could not fetch rolls ${lost.join(', ')} (rerun; fetched ones are cached)`);
  return rolls;
}

const all = [];
for (const y of YEARS) { const r = await loadYear(y); console.error(`${y}: ${r.length} rolls`); all.push(...r); }
all.sort((a, b) => a.date.localeCompare(b.date) || a.roll - b.roll);

const who = new Map();   // id -> record
const ensure = (v) => { if (!who.has(v.id)) who.set(v.id, { id: v.id, name: v.name, party: v.party, state: v.state, rolls: 0, missed: 0, dayRolls: {}, dayMissed: {}, unity: 0, breaks: 0, recent: [], missedAt: [], breakAt: [], first: '', last: '', vec: new Int8Array(all.length), cast: [] }); const m = who.get(v.id); m.name = v.name; m.party = v.party; m.state = v.state; return m; };

const days = new Set(); const weeks = new Set(); let unityRolls = 0;
for (const [ri, r] of all.entries()) {
  days.add(r.date); weeks.add(weekOf(r.date));
  // party-unity roll: majority of D against majority of R on Yea/Nay
  const tally = { D: { y: 0, n: 0 }, R: { y: 0, n: 0 } };
  for (const v of r.votes) { const t = tally[v.party]; if (!t) continue; if (/^(yea|aye)$/i.test(v.v)) t.y++; else if (/^(nay|no)$/i.test(v.v)) t.n++; }
  const maj = (t) => (t.y > t.n ? 'Y' : t.n > t.y ? 'N' : '');
  const md = maj(tally.D), mr = maj(tally.R);
  const unity = md && mr && md !== mr;
  r.unity = !!unity;
  if (unity) unityRolls++;
  for (const v of r.votes) {
    const m = ensure(v);
    m.rolls++;
    const missed = /^not voting$/i.test(v.v);
    if (missed) { m.missed++; m.missedAt.push(ri); }
    if (!m.first) m.first = r.date;
    if (!missed) {
      const y = /^(yea|aye)$/i.test(v.v), n = /^(nay|no)$/i.test(v.v);
      m.vec[ri] = y ? 1 : n ? -1 : 0;
      m.cast.push([ri, y ? 'Y' : n ? 'N' : /^present$/i.test(v.v) ? 'P' : 'O']);
    }
    m.last = r.date;
    m.dayRolls[r.date] = (m.dayRolls[r.date] || 0) + 1;
    if (missed) m.dayMissed[r.date] = (m.dayMissed[r.date] || 0) + 1;
    m.recent.push(missed ? 1 : 0);
    if (unity && (v.party === 'D' || v.party === 'R')) {
      const yea = /^(yea|aye)$/i.test(v.v), nay = /^(nay|no)$/i.test(v.v);
      if (yea || nay) { const own = v.party === 'D' ? md : mr; if ((yea ? 'Y' : 'N') === own) m.unity++; else { m.breaks++; m.breakAt.push(ri); } }
    }
  }
}

// Members whose votes match most often: agreement over the rolls both cast a Yea or a Nay on
const all_ = [...who.values()];
const likeOf = new Map();
for (const a of all_) {
  const scores = [];
  for (const b of all_) {
    if (a === b) continue;
    let shared = 0, same = 0;
    for (let i = 0; i < a.vec.length; i++) { const x = a.vec[i], y = b.vec[i]; if (x && y) { shared++; if (x === y) same++; } }
    if (shared >= 150) scores.push([b.id, +(100 * same / shared).toFixed(1)]);
  }
  scores.sort((p, q) => q[1] - p[1]);
  likeOf.set(a.id, scores.slice(0, 5));
}

const members = [...who.values()].map((m) => {
  const dayList = Object.keys(m.dayRolls);
  const daysMissed = dayList.filter((d) => m.dayMissed[d] === m.dayRolls[d]).length;
  const wk = {}; for (const d of dayList) { const w = weekOf(d); (wk[w] ||= { r: 0, x: 0 }); wk[w].r += m.dayRolls[d]; wk[w].x += m.dayMissed[d] || 0; }
  const weekList = Object.values(wk);
  const weeksMissed = weekList.filter((w) => w.x === w.r).length;
  const last10 = m.recent.slice(-10).reduce((a, b) => a + b, 0);
  const scored = m.unity + m.breaks;
  return {
    id: m.id, name: m.name, party: m.party, state: m.state,
    rolls: m.rolls, missed: m.missed, missedPct: +(100 * m.missed / m.rolls).toFixed(1),
    days: dayList.length, daysMissed, weeks: weekList.length, weeksMissed,
    first: m.first, last: m.last, active: m.last === all.at(-1)?.date,
    last10Missed: last10, missedAt: m.missedAt, breakAt: m.breakAt, cast: m.cast.slice(-40), like: likeOf.get(m.id) || [], unityScored: scored, breaks: m.breaks, breakPct: scored ? +(100 * m.breaks / scored).toFixed(1) : null,
  };
}).sort((a, b) => b.missed - a.missed);

fs.writeFileSync(OUT, JSON.stringify({ congress: CONGRESS, rollList: all.map((r) => ({ y: +r.date.slice(0, 4), n: r.roll, d: r.date, l: r.legis, q: r.question, t: r.desc, u: r.unity ? 1 : 0, y: r.yeas, n: r.nays, r: r.result })), rolls: all.length, days: days.size, weeks: weeks.size, unityRolls, through: all.at(-1)?.date, members }, null, 0));
console.log(`rolls ${all.length}, voting days ${days.size}, weeks ${weeks.size}, party-unity rolls ${unityRolls}, members ${members.length}, through ${all.at(-1)?.date}`);
console.log('most missed:'); for (const m of members.slice(0, 12)) console.log(`  ${m.name} (${m.party}-${m.state}) ${m.missed}/${m.rolls} rolls (${m.missedPct}%), ${m.daysMissed}/${m.days} days, ${m.weeksMissed}/${m.weeks} weeks`);
const br = members.filter((m) => m.unityScored >= 50).sort((a, b) => b.breakPct - a.breakPct);
console.log('most party breaks:'); for (const m of br.slice(0, 8)) console.log(`  ${m.name} (${m.party}-${m.state}) ${m.breaks}/${m.unityScored} (${m.breakPct}%)`);
