#!/usr/bin/env node
/**
 * Generates dev/fixtures/modes/<mode>/{proceedings,domewatch-floor}.json
 *
 * Each mode of the House Floor Monitor is chosen by autoSwitchModeFromProceedings()
 * in app.js, which text-matches the Clerk proceedings feed in a fixed priority
 * order. The MODES table below mirrors that order: each entry's `items` are
 * crafted so the app's own real code path lands on that mode — we fixture the
 * INPUT rather than forcing the body class, so the harness exercises the same
 * logic production does.
 *
 * Two hazards the table works around:
 *  1. DomeWatch status is checked FIRST and wins outright. If it says
 *     recess/adjourned every mode collapses to recess, so non-recess modes get a
 *     neutral `house_in_session` domewatch override.
 *  2. Checks run top-to-bottom on items[0], so a fixture must not accidentally
 *     match an EARLIER check. Notably: nothing but `speaker` may contain
 *     "pro tempore", and nothing before `silence` may contain "silence".
 *
 * Re-run after changing the table:  node dev/make-mode-fixtures.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'fixtures', 'modes');

// Fixed clock — must match FREEZE_DEFAULT in harness.js so snapshots are stable.
const BASE = Date.parse('2026-09-03T18:30:00Z');
const at = minsAgo => new Date(BASE - minsAgo * 60_000).toUTCString();

// A neutral in-session status, so the DomeWatch short-circuit doesn't force recess.
const IN_SESSION = {
  now: { text: 'House in session', value: 'house_in_session' },
  roll_call: null, timer: null, votes: null,
  fetchedAt: new Date(BASE).toISOString(),
};

// A live roll-call vote, for vote mode.
const VOTING = JSON.parse(readFileSync(join(HERE, 'fixtures/base/domewatch-floor.json'), 'utf8'));
VOTING.now = { text: 'Voting in progress', value: 'vote' };
VOTING.timer = { seconds_remaining: 214, timestamp: new Date(BASE).toISOString(), value: '3:34' };
VOTING.votes.timer = VOTING.timer;

const item = (description, minsAgo, extra = {}) => ({
  title: description.slice(0, 100),
  link: '', description, pubDate: at(minsAgo), ...extra,
});

// Filler that matches no mode check — gives each feed realistic length without
// tripping an earlier branch.
const FILLER = [
  item('The Chair laid before the House a communication from the Clerk.', 240),
  item('The House proceeded with further consideration of the legislative program.', 300),
];

const MODES = {
  // ── DomeWatch-driven ──────────────────────────────────────────────────────
  vote:            { dome: VOTING,    items: [item('DEBATE - The House proceeded with debate on H.R. 4795.', 12)] },
  recess:          { dome: null,      items: [item('The Speaker announced that the House do now adjourn pursuant to clause 13 of Rule I.', 5)] },

  // ── Priority-ordered proceedings matches (see app.js:5745 onward) ─────────
  tellers:         { items: [item('APPOINTMENT OF TELLERS - The Chair appointed the following Members as tellers.', 3)] },
  'joint-session': { items: [item('JOINT SESSION - The House and Senate convened in Joint Session.', 8)] },
  'cert-electoral':{ items: [item('CERTIFICATION OF ELECTORAL VOTES - The Chair announced the certification of the electoral votes.', 9)] },
  'cert-election': { items: [item('CERTIFICATION OF ELECTION - The Chair announced the certification of the election of a Member.', 9)] },
  'new-session':   { items: [item('Pursuant to the 20th amendment, the House convened for a new legislative day.', 6)] },
  'admin-oath':    { items: [item('ADMINISTRATION OF THE OATH OF OFFICE - The Speaker administered the oath of office to the Members-elect.', 7)] },
  // NOTE: sine-die mode looks unreachable in production. The recess branch
  // (app.js:5745) returns on any items[0] containing "adjourn", and it runs ~90
  // lines before the sine-die check at app.js:5835 — but every realistic Clerk
  // phrasing of a sine die adjournment contains the word "adjourn" (app.js's own
  // fallback string at :7479 is "The House stands adjourned sine die."). This
  // fixture deliberately avoids "adjourn" so the branch is reachable and its CSS
  // can still be baselined. Fixing the ordering is an app.js change, out of
  // scope for the harness — see dev/README.md.
  'sine-die':      { items: [item('SINE DIE - The second session of the One Hundred Nineteenth Congress came to a close sine die.', 4)] },
  'joint-meeting': { items: [item('JOINT MEETING - The House and Senate convened in Joint Meeting to receive an address.', 10)] },

  // ── items[0]-only matches ─────────────────────────────────────────────────
  message:         { items: [item('The House received a message from the Senate.', 2)] },
  prayer:          { items: [item('PRAYER - The Chaplain offered the following prayer.', 2)] },
  pledge:          { items: [item('PLEDGE OF ALLEGIANCE - The House recited the Pledge of Allegiance.', 2)] },
  silence:         { items: [item('MOMENT OF SILENCE - The House observed a moment of silence in remembrance.', 3)] },
  'committee-chair': { items: [item('The Chair appointed a Member to act as chairman of the committee of the whole.', 4)] },
  speaker:         { items: [item('The Speaker pro tempore assumed the chair.', 3)] },

  // ── Episodic vs persistent (most-recent wins, COWH breaks ties) ───────────
  debate:          { items: [item('The House resolved itself into the Committee of the Whole House on the state of the Union for consideration of H.R. 4795.', 15)] },
  'special-order': { items: [item('SPECIAL ORDER SPEECHES - The House has concluded all anticipated legislative business and has proceeded with special order speeches.', 6)] },
  'one-minute':    { items: [item('ONE MINUTE SPEECHES - The House proceeded with one minute speeches.', 6)] },
  'morning-hour':  { items: [item('MORNING-HOUR DEBATE - The House proceeded with morning-hour debate.', 6)] },

  // ── Tail checks ───────────────────────────────────────────────────────────
  oath:            { items: [item('OATH OF OFFICE - The Speaker administered the oath of office to the Member-elect.', 5)] },
  journal:         { items: [item('The Chair announced approval of the Journal.', 3)] },
};

let n = 0;
for (const [mode, cfg] of Object.entries(MODES)) {
  const dir = join(OUT, mode);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proceedings.json'),
    JSON.stringify({ items: [...cfg.items, ...FILLER], error: null }, null, 2));
  // `dome: null` means "use the captured adjourned fixture" (recess only).
  if (cfg.dome !== null) {
    writeFileSync(join(dir, 'domewatch-floor.json'),
      JSON.stringify(cfg.dome ?? IN_SESSION, null, 2));
  }
  n++;
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(Object.keys(MODES), null, 2));
console.log(`wrote ${n} mode fixtures → dev/fixtures/modes/`);
