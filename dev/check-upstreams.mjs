#!/usr/bin/env node
//
// Is everything the boards read from other people's servers still there, in the shape we read?
//
//   node dev/check-upstreams.mjs              # both groups
//   node dev/check-upstreams.mjs --worker     # the deployed Worker's routes
//   node dev/check-upstreams.mjs --direct     # the pages and feeds the Worker scrapes
//
// Exit 1 if anything FAILS; a WARN is something that may be legitimately empty (the House out
// of session has no bills this week) and does not fail the run.
//
// WHY THIS EXISTS
// On 4 October the House Clerk removed evs/<year>/index.asp without notice. The Worker's
// /api/congress-index went to 500, and MISSING MEMBERS and the quorum panel on the live House
// board sat at "--" until somebody pasted a console log. Nothing was watching. Every source here
// is another agency's page or feed that can change shape, so this looks at each one, with the same
// parsers the Worker uses where one exists ("the page parsed" and not just "it answered 200",
// which govinfo and the Clerk both do for a missing page).
//
// TWO GROUPS, because they fail differently. A Worker route can answer 200 from a stale cache
// while its upstream is gone; an upstream can change while the Worker still serves a good copy.
// Checking only one would have missed one of those.
//
// Needs no key and no dependencies (Node 18+). It reads, and never writes.

import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ClerkVotes = require(join(ROOT, 'lib/clerk-votes.js'));
const SenateSeniority = require(join(ROOT, 'lib/senate-seniority.js'));
const SenateDesks = require(join(ROOT, 'lib/senate-desks.js'));
const HouseCalendar = require(join(ROOT, 'lib/house-calendar.js'));
const CommitteeMeetings = require(join(ROOT, 'lib/committee-meetings.js'));
const DischargePetitions = require(join(ROOT, 'lib/discharge-petitions.js'));
const DischargeCalendar = require(join(ROOT, 'lib/discharge-calendar.js'));

const args = process.argv.slice(2);
const only = args.includes('--worker') ? 'worker' : args.includes('--direct') ? 'direct' : null;
const API = process.env.API_BASE || 'https://api.evanhollander.org';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const year = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 4));
const congress = 119;
const todayEt = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric' });   // MM/DD/YYYY
const senateSession = year % 2 ? 1 : 2;

const get = async (url, { ms = 30_000, headers = {} } = {}) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  const text = await r.text();
  return { status: r.status, type: r.headers.get('content-type') || '', text };
};

// ---- what to check ----------------------------------------------------------------------------

// A check returns [] for fine, or { fail } / { warn }. `json` is the parsed body for the Worker group.
const has = (cond, msg) => (cond ? null : { fail: msg });
const arr = (v) => Array.isArray(v) ? v : [];

const worker = (chamber, path, check, opts = {}) => ({
  group: 'worker', name: `${chamber} ${path}`, run: async () => {
    const r = await get(`${API}/${chamber}-floor/api/${path}`, { headers: { Origin: `https://${chamber}-floor.evanhollander.org` }, ...opts });
    if (r.status !== 200) return { fail: `HTTP ${r.status}: ${r.text.slice(0, 120).replace(/\s+/g, ' ')}` };
    let j; try { j = JSON.parse(r.text); } catch { return { fail: `not JSON: ${r.text.slice(0, 80)}` }; }
    if (j && j.error) return { fail: `answered 200 with an error: ${String(j.error).slice(0, 120)}` };
    return check(j);
  },
});

const direct = (name, url, check, opts = {}) => ({
  group: 'direct', name, run: async () => {
    const r = await get(typeof url === 'function' ? await url() : url, opts);
    return check(r);
  },
});

const CHECKS = [
  // ---- the deployed Worker, House ----
  worker('house', 'health', (j) => has(j.status === 'ok', `status ${j.status}`)),
  worker('house', 'congress-index', (j) => has(/^\d+$/.test(j.latestRollNumber || '') && arr(j.rollNumbers).length > 0, 'no latestRollNumber (the Clerk\'s vote listing, see lib/clerk-votes.js)')),
  worker('house', 'member-data', (j) => has((j.xmlData || '').includes('<MemberData') && (j.xmlData.match(/<bioguideID>/g) || []).length > 400, 'MemberData has too few members')),
  worker('house', 'proceedings', (j) => arr(j.items).length ? null : { warn: 'no proceedings items (normal when the House is out)' }),
  worker('house', 'cold-start-bundle', (j) => has('rollLog' in j && 'whipNotices' in j, 'missing rollLog or whipNotices')),
  worker('house', 'domewatch-floor', (j) => has(j.now && typeof j.now.text === 'string', 'no now.text')),
  worker('house', 'hls-url', (j) => has(typeof j.isLive === 'boolean', 'no isLive')),
  worker('house', 'leadership', (j) => has(j.bioguideId && j.name, 'no leader')),
  worker('house', 'house-calendar', (j) => j.calendar ? has(Number.isInteger(j.calendar.legislativeDay) && j.calendar.meetsAt, 'a calendar with no legislative day or meeting time')
    : { warn: `no House Calendar for ${j.date} (normal when the House is not sitting)` }),
  worker('house', 'last-session-date', (j) => has(/^\d{4}-\d\d-\d\d$/.test(j.date || ''), `date ${j.date}`)),
  worker('house', 'voting-days', (j) => has(arr(j.votingDays).length > 100, 'too few voting days')),
  worker('house', 'whip-notices', (j) => arr(j.recs).length ? null : { warn: 'no whip recommendations' }),
  worker('house', 'whip-floor-updates', (j) => arr(j.items).length ? null : { warn: 'no whip floor updates' }),
  worker('house', 'bills', (j) => (arr(j.ruleBills).length + arr(j.suspensionBills).length) ? null : { warn: 'no bills this week (normal when the House is out)' }),
  worker('house', 'roll-log', (j) => arr(j.entries).length ? null : { warn: 'roll log is empty' }),
  worker('house', 'tweets', (j) => has(arr(j.tweets).length >= 5, `${arr(j.tweets).length} tweets`)),
  worker('house', 'casualty-list', (j) => has(Object.keys(j).length > 0, 'empty')),
  // The Worker's two Clerk feeds for the committee and discharge panels. The petitions answer carries a count for every petition, and a petition
  // with none means its own page could not be read, which is a warning (the panel leaves it out) and not a failure.
  worker('house', `committee-meetings?scan=1&date=${encodeURIComponent(todayEt)}`, (j) => has(Array.isArray(j.events) && typeof j.table === 'string' && /^\d\d\/\d\d\/\d{4}$/.test(j.date || ''), 'no events list, table or date')),
  worker('house', 'discharge-petitions', (j) => {
    if (!arr(j.petitions).length || j.needed !== 218) return { fail: `${arr(j.petitions).length} petitions, needed ${j.needed}` };
    const unread = j.petitions.filter((p) => p.id && p.signatures == null).length;
    return unread ? { warn: `${unread} petition page(s) not read (no signature count)` } : null;
  }),
  // legislative days each motion on the Discharge Calendar has waited (GPO's House Calendars); a pending motion with no count means its entry day's Calendar was not found
  worker('house', 'discharge-calendar', (j) => {
    if (!(j.legislativeDay > 0) || !Array.isArray(j.pending)) return { fail: 'no legislative day or pending list' };
    const unread = j.pending.filter((m) => m.elapsed == null).length;
    return unread ? { warn: `${unread} pending motion(s) with no legislative-day count` } : null;
  }),
  worker('house', 'airport-delays', (j) => has((j.xmlData || '').includes('AIRPORT_STATUS_INFORMATION'), 'not the FAA feed')),

  // ---- the deployed Worker, Senate ----
  worker('senate', 'senate/roster', (j) => has(j.seats === 100 && arr(j.members).length === 100, `${arr(j.members).length} senators`)),
  worker('senate', 'senate/desks', (j) => has(j.count === 100 && arr(j.seats).length === 100, `${j.count} desks`)),
  worker('senate', 'senate/seniority', (j) => has(arr(j.rows).length >= 90, `${arr(j.rows).length} rows`)),
  worker('senate', 'senate/schedule', (j) => has(arr(j.days).length > 100 && j.latest, 'no schedule')),
  worker('senate', 'senate/votes', (j) => has(arr(j.votes).length > 0, 'no votes')),
  worker('senate', 'senate/absences', (j) => has(j.rollCall, 'no roll call')),
  worker('senate', 'senate/calendar', (j) => has(arr(j.orders).length > 0, 'no orders')),
  worker('senate', 'senate/stages', (j) => has(Object.keys(j.stages || {}).length > 0, 'no stages')),
  worker('senate', 'senate/nominations', (j) => has(j.total > 0 && arr(j.nominations).length > 0, 'no nominations')),
  worker('senate', 'senate/proceedings', (j) => has(arr(j.sections).length > 0, 'no sections')),
  worker('senate', 'senate/floor-schedule', (j) => has(arr(j.notices).length > 0 && j.agenda, 'no Democratic Caucus posts')),
  worker('senate', 'senate/hls-url', (j) => has(typeof j.isLive === 'boolean', 'no isLive')),
  worker('senate', 'senate/quorum', (j) => has(/^stv\d{6}$/.test(j.stream || '') && j.call, 'no stream or call')),

  // ---- the House's own sources ----
  direct('clerk vote listing', () => ClerkVotes.listUrl(year), (r) => r.status !== 200 ? { fail: `HTTP ${r.status}` }
    : ClerkVotes.parseRolls(r.text, year).length ? null : { fail: 'no roll calls found: the page has changed (lib/clerk-votes.js)' }),
  direct('clerk latest roll XML', async () => {
    const r = await get(ClerkVotes.listUrl(year));
    const latest = ClerkVotes.parseRolls(r.text, year)[0];
    if (!latest) throw new Error('could not find the latest roll');
    return `https://clerk.house.gov/evs/${year}/roll${String(latest.rollNumber).padStart(3, '0')}.xml`;
  }, (r) => r.status === 200 && r.text.includes('<rollcall-vote>') ? null : { fail: `HTTP ${r.status}, not a roll call XML: ${r.text.slice(0, 80)}` }),
  direct('clerk Home/Feed (proceedings)', 'https://clerk.house.gov/Home/Feed', (r) => r.status === 200 && /<item[\s>]/.test(r.text) ? null : { fail: `HTTP ${r.status}, no items` }),
  // GPO's House Calendar for the latest day the House sat: read with the same parser the Worker uses, so a
  // change to the page's layout fails here and not as a missing line on the board.
  direct('GPO House Calendar (latest sitting day)', async () => {
    const r = await get(`${API}/house-floor/api/last-session-date`, { headers: { Origin: 'https://house-floor.evanhollander.org' } });
    const d = JSON.parse(r.text).date;
    if (!/^\d{4}-\d\d-\d\d$/.test(d || '')) throw new Error(`last-session-date gave ${d}`);
    return `https://www.govinfo.gov/content/pkg/CCAL-119hcal-${d}/html/CCAL-119hcal-${d}-pt0.htm`;
  }, (r) => {
    if (r.status !== 200) return { fail: `HTTP ${r.status}` };
    const c = HouseCalendar.parse(r.text);
    return c && c.meetsAt && c.orders !== null ? null : { fail: c ? 'the calendar parsed but its meeting time or orders section did not (lib/house-calendar.js)' : 'not a House Calendar page (lib/house-calendar.js)' };
  }),
  // The pages those two feeds are read from, with the same parsers the Worker uses. A change to the Clerk's markup fails here, not as a panel that says nothing.
  direct('docs.house.gov committee calendar (today)', `https://docs.house.gov/Committee/Calendar/ByDay.aspx?DayID=${todayEt.replace(/\//g, '')}`, (r) => r.status !== 200 ? { fail: `HTTP ${r.status}` }
    : CommitteeMeetings.parseDay(r.text) ? null : { fail: 'no meetings table: the page has changed (lib/committee-meetings.js)' }),
  direct('GPO discharge calendar (part 6, today)', `https://www.govinfo.gov/content/pkg/CCAL-${congress}hcal-${todayEt.replace(/(\d\d)\/(\d\d)\/(\d{4})/, '$3-$1-$2')}/html/CCAL-${congress}hcal-${todayEt.replace(/(\d\d)\/(\d\d)\/(\d{4})/, '$3-$1-$2')}-pt6.htm`, (r) => r.status !== 200 ? { warn: `HTTP ${r.status} (no Calendar on a day the House does not sit)` }
    : DischargeCalendar.parse(r.text) ? null : { warn: 'not the calendar (a day with no package, or the page has changed: lib/discharge-calendar.js)' }),
  direct('clerk discharge petition list', `https://clerk.house.gov/DischargePetition/DischargePetitions?CongressNum=${congress}`, (r) => {
    if (r.status !== 200) return { fail: `HTTP ${r.status}` };
    const l = DischargePetitions.parseList(r.text);
    if (!l.petitions.length) return { fail: 'no petitions found: the page has changed (lib/discharge-petitions.js)' };
    return l.petitions.every((p) => p.id && p.description && p.sponsor) ? null : { fail: 'a petition entry is missing its link, description or sponsor' };
  }),
  direct('clerk discharge petition page (first)', async () => {
    const r = await get(`https://clerk.house.gov/DischargePetition/DischargePetitions?CongressNum=${congress}`);
    const first = DischargePetitions.parseList(r.text).petitions[0];
    if (!first || !first.id) throw new Error('no petition link on the list');
    return `https://clerk.house.gov/DischargePetition/${first.id}`;
  }, (r) => {
    if (r.status !== 200) return { fail: `HTTP ${r.status}` };
    const s = DischargePetitions.parseSignatures(r.text);
    return s && s.count > 0 ? null : { fail: s ? 'a signature table with no signers' : 'no signature table: the page has changed (lib/discharge-petitions.js)' };
  }),
  direct('CBO cost estimates feed', 'https://www.cbo.gov/publications/all/rss.xml', (r) => r.status !== 200 ? { fail: `HTTP ${r.status}` } : /<rss/.test(r.text) && /<item>/.test(r.text) ? null : { fail: 'not an RSS feed with items' }),
  direct('clerk MemberData.xml', 'https://clerk.house.gov/xml/lists/MemberData.xml', (r) => r.status === 200 && r.text.includes('<MemberData') ? null : { fail: `HTTP ${r.status}, not MemberData` }),
  direct('house docs BillsThisWeek RSS', 'https://docs.house.gov/BillsThisWeek-RSS.xml', (r) => r.status === 200 && /<rss|<feed/.test(r.text) ? null : { fail: `HTTP ${r.status}, not a feed` }),
  direct('house voting days (ics)', 'https://votingdays.house.gov/voting-days.ics', (r) => r.status === 200 && r.text.includes('BEGIN:VCALENDAR') ? null : { fail: `HTTP ${r.status}, not a calendar` }),
  direct('domewatch whip notices', 'https://data.domewatch.us/v1/whip-notices?limit=8', (r) => r.status === 200 && r.type.includes('json') ? null : { fail: `HTTP ${r.status} ${r.type}` }),
  // No direct check of the FAA feed: its WAF refuses any non-browser client outside Cloudflare (an
  // Akamai "Access Denied" page, from a laptop or a CI runner alike), so a direct request says
  // nothing about the Worker's. The `airport-delays` route above covers it.

  // ---- the Senate's own sources ----
  direct('senate floor_schedule.json', 'https://www.senate.gov/legislative/schedule/floor_schedule.json', (r) => r.status === 200 && /filename=stv\d{6}/.test(r.text) ? null : { fail: `HTTP ${r.status}, no stream filename (the stream id the Worker reads captions by)` }),
  direct('senate senators_cfm.xml', 'https://www.senate.gov/general/contact_information/senators_cfm.xml', (r) => r.status === 200 && (r.text.match(/<member>/g) || []).length >= 99 ? null : { fail: `HTTP ${r.status}, ${(r.text.match(/<member>/g) || []).length} members` }),
  direct('senate vote menu', `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${senateSession}.xml`, (r) => r.status === 200 && r.text.includes('<vote_summary') ? null : { fail: `HTTP ${r.status}, not a vote menu` }),
  direct('senate floor activity', 'https://www.senate.gov/legislative/LIS/floor_activity/floor_activity.htm', (r) => r.status === 200 && r.type.includes('html') ? null : { fail: `HTTP ${r.status} ${r.type}` }),
  direct('senate nominations', 'https://www.senate.gov/legislative/LIS/nominations', (r) => r.status === 200 ? null : { fail: `HTTP ${r.status}` }),
  direct('senate desks plan (classes.xml)', 'https://www.senate.gov/art-artifacts/decorative-art/furniture/senate-chamber-desks/xml/classes.xml', (r) => r.status !== 200 ? { fail: `HTTP ${r.status}` }
    : SenateDesks.pickPlan(r.text) ? null : { fail: 'no current floorplan in classes.xml' }),
  direct('senate desks floorplan', async () => {
    const r = await get('https://www.senate.gov/art-artifacts/decorative-art/furniture/senate-chamber-desks/xml/classes.xml');
    const plan = SenateDesks.pickPlan(r.text);
    if (!plan) throw new Error('no floorplan');
    return 'https://www.senate.gov/art-artifacts/decorative-art/furniture/senate-chamber-desks/xml/' + plan.ref;
  }, (r) => r.status === 200 && SenateDesks.valid(SenateDesks.parseSeats(r.text)) ? null : { fail: `HTTP ${r.status}, did not parse to a whole chamber` }),
  direct('wikipedia seniority table', 'https://en.wikipedia.org/api/rest_v1/page/html/Seniority_in_the_United_States_Senate', (r) => r.status !== 200 ? { fail: `HTTP ${r.status}` }
    : SenateSeniority.valid(SenateSeniority.parse(r.text)) ? null : { fail: 'the ranked table did not parse cleanly (lib/senate-seniority.js)' },
    { headers: { 'User-Agent': 'house-floor-monitor/1.0 (https://house-floor.evanhollander.org)', Accept: 'text/html' } }),
  direct('democrats.senate.gov schedule', 'https://www.democrats.senate.gov/floor/senate-schedule', (r) => r.status === 200 && r.type.includes('html') ? null : { fail: `HTTP ${r.status} ${r.type}` }),
  direct('democrats.senate.gov wrap-up', 'https://www.democrats.senate.gov/floor/wrap-up', (r) => r.status === 200 && r.type.includes('html') ? null : { fail: `HTTP ${r.status} ${r.type}` }),
];

// ---- run ---------------------------------------------------------------------------------------

const todo = CHECKS.filter((c) => !only || c.group === only);
const results = new Array(todo.length);
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < todo.length) {
    const i = next++;
    const t0 = Date.now();
    const once = async () => { try { return (await todo[i].run()) || {}; } catch (e) { return { fail: `${e.name === 'TimeoutError' ? 'timed out' : e.message}` }; } };
    let out = await once();
    // A server error or a dropped connection is retried once after a pause: these are other
    // people's servers, and a check that fails at random gets ignored. A pass on the retry is
    // reported as a warning and not hidden, since the user would have met the failure.
    if (out.fail && /^(HTTP 5\d\d|timed out|fetch failed|terminated|other side closed)/.test(out.fail)) {
      await new Promise((r) => setTimeout(r, 1500));
      const again = await once();
      out = again.fail ? { fail: `${out.fail} (and again on retry)` } : { warn: `failed once, passed on retry: ${out.fail.slice(0, 90)}` };
    }
    results[i] = { ...todo[i], ms: Date.now() - t0, ...out };
  }
}));

let fails = 0, warns = 0;
for (const r of results) {
  const tag = r.fail ? 'FAIL' : r.warn ? 'warn' : 'ok  ';
  if (r.fail) fails++; else if (r.warn) warns++;
  console.log(`${tag}  ${r.name.padEnd(40)} ${String(r.ms).padStart(5)}ms${r.fail ? '  ' + r.fail : r.warn ? '  ' + r.warn : ''}`);
}
console.log(`\n${results.length} checked: ${results.length - fails - warns} ok, ${warns} warn, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
