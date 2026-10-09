#!/usr/bin/env node
//
// How well do the Democratic Caucus's schedule posts say which measures the Senate takes up?
//
//   node dev/backtest-senate-schedule.mjs            # this session (the 2nd of the 119th; edit YEAR below for another)
//   node dev/backtest-senate-schedule.mjs --misses   # also list every day the schedule did not name a measure that was voted
//
// WHY THIS EXISTS
// The Senate has no live feed of what is pending, and the debate panel (senate.js, planDebate) is driven by the day's schedule post
// read by lib/senate-agenda.js. Before relying on that, this reads every schedule post of the year from the Caucus's feed and the
// Senate's roll call menu, and counts how often the measures voted on were the ones the post named. It found the first parser reading
// almost none of the posts (it looked for "Cal. #NNN S.nnn" only); the numbers it printed on 9 October 2026 for the parser now in
// lib/senate-agenda.js were: 63 days with a vote on a bill, 80 of 95 bills voted named in that day's post (84%), 71 as taken up,
// cloture, a vote or discharge (75%), the first measure the post says the Senate will take up was voted that day on 35 of 44 days (80%).
//
// READ THE LAST NUMBER AS A FLOOR. A roll call menu says what was voted on, not what was on the floor: on 13 January the post says
// the Senate resumes the motion to proceed to H.R.6938, the only votes were on S.J.Res. 84 and 98, and the Congressional Record has
// 81 mentions of H.R.6938 that day. Checked by hand against the Record, all seven days where the first measure was not voted were
// days the Senate was on it. What the menu cannot find are the days with no post (a Friday or weekend session) and a measure first
// taken up that day, and those are the real holes. No key, no dependencies (Node 18+); it only reads.

import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = require(join(ROOT, 'lib/senate-agenda.js'));
const C = require(join(ROOT, 'lib/convening.js'));

const YEAR = 2026, SESSION = 2, CONGRESS = 119;
const UA = 'Mozilla/5.0 (compatible; HouseMonitor/1.0; +https://house-floor.evanhollander.org)';
const get = async (url) => {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25_000) }); if (r.ok) return r.text(); } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return '';
};
const decode = (t) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const norm = (s) => s.replace(/\s+/g, '').replace(/^(H\.R\.|S\.J\.Res\.|H\.J\.Res\.|H\.Con\.Res\.|S\.Con\.Res\.|H\.Res\.|S\.Res\.|S\.)(\d+)$/, '$1 $2');

// 1. the schedule posts of the year, from the Caucus's feed
const items = [], seen = new Set();
for (let n = 1; n < 60; n++) {
  const html = await get(`https://www.democrats.senate.gov/floor/feed?pagenum_rs=${n}`);
  const blocks = [...html.matchAll(/<p class="Heading Heading--time[^"]*">(\d\d\.\d\d\.\d{4})<\/p>[\s\S]*?href="([^"]+)"[\s\S]*?<h2>([^<]+)<\/h2>/g)];
  let fresh = 0;
  for (const [, date, url, title] of blocks) if (!seen.has(url)) { seen.add(url); fresh++; items.push({ date, url, title: decode(title).trim() }); }
  if (!blocks.length || !fresh || (blocks.at(-1)[1] && blocks.at(-1)[1].endsWith(String(YEAR - 1)))) break;
}
const posts = items.filter((i) => i.date.endsWith(String(YEAR)) && /^Schedule for/i.test(i.title));
const bodies = [];
for (let i = 0; i < posts.length; i += 4) {
  bodies.push(...await Promise.all(posts.slice(i, i + 4).map(async (p) => {
    const html = await get(p.url);
    const m = html.match(/js-press-release RawHTML[^"]*">([\s\S]*?)<\/div>\s*\n/);
    const text = decode((m ? m[1] : '').replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/g, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t\xa0]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
    return { ...p, body: text };
  })));
}

// 2. the roll calls, by day
const menu = await get(`https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${CONGRESS}_${SESSION}.xml`);
const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const tag = (b, t) => ((b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1] || '').trim();
const BILL = /^(H\.R\.|S\.|H\.J\.Res\.|S\.J\.Res\.|H\.Res\.|S\.Res\.|H\.Con\.Res\.|S\.Con\.Res\.)\s*\d+$/;
const votes = {};
for (const m of menu.matchAll(/<vote>([\s\S]*?)<\/vote>/g)) {
  const [dd, mon] = tag(m[1], 'vote_date').split('-');
  const issue = norm(tag(m[1], 'issue'));
  if (BILL.test(issue)) (votes[`${YEAR}-${MON[mon.toLowerCase()]}-${dd.padStart(2, '0')}`] ||= new Set()).add(issue);
}

// 3. the comparison
const sched = {};
for (const p of bodies) {
  const r = A.parse(p.body);
  const iso = C.isoDate(r.conveneDate);
  if (iso) sched[iso] = r;
}
let days = 0, noPost = 0, voted = 0, named = 0, taken = 0, daysAny = 0, headN = 0, headOk = 0;
const misses = [];
for (const day of Object.keys(votes).sort()) {
  const bills = [...votes[day]];
  days++; voted += bills.length;
  const s = sched[day];
  if (!s) { noPost++; misses.push(`${day}  no schedule post  (voted ${bills.join(', ')})`); continue; }
  const all = s.measures.map((m) => norm(m.measure));
  const strong = s.measures.filter((m) => ['taken-up', 'cloture', 'vote', 'discharge'].includes(m.role)).map((m) => norm(m.measure));
  const a = bills.filter((b) => all.includes(b));
  named += a.length; taken += bills.filter((b) => strong.includes(b)).length;
  if (a.length) daysAny++;
  const head = s.measures.find((m) => m.role === 'taken-up') || s.measures.find((m) => m.role === 'cloture');
  if (head) { headN++; if (bills.includes(norm(head.measure))) headOk++; }
  const miss = bills.filter((b) => !all.includes(b));
  if (miss.length) misses.push(`${day}  voted but not named: ${miss.join(', ')}  (named: ${all.slice(0, 5).join(', ') || 'none'})`);
}
const pct = (a, b) => (b ? `${Math.round(100 * a / b)}%` : 'n/a');
console.log(`${bodies.length} schedule posts read, ${Object.keys(sched).length} with a convening date; ${days} days with a roll call on a bill or resolution (${noPost} with no post)`);
console.log(`bills voted on: ${voted}; named anywhere in that day's post: ${named} (${pct(named, voted)}); named as taken up, cloture, vote or discharge: ${taken} (${pct(taken, voted)})`);
console.log(`days on which at least one voted bill was named: ${daysAny}/${days} (${pct(daysAny, days)})`);
console.log(`first measure the post says the Senate takes up was voted that day: ${headOk}/${headN} (${pct(headOk, headN)})  <- a floor, see the header`);
if (process.argv.includes('--misses')) { console.log('\nDAYS THE SCHEDULE DID NOT COVER:'); for (const m of misses) console.log('  ' + m); }
