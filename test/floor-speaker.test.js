#!/usr/bin/env node
//
// Contract test for lib/floor-speaker.js — putting a name on each House floor
// speaking turn, from captions that never name anybody.
//
// WHY THIS EXISTS
// The Clerk's live WebVTT labels every single turn "UNIDENTIFIED SPEAKER:" (795
// times on 2026-09-14, 230 on 2026-09-03, zero other labels ever), and the floor
// camera carries no chyron. So every name on the site is INFERRED from the
// parliamentary ritual in the caption text. That inference is the kind of thing
// that looks fine in aggregate and is wrong on the one turn somebody screenshots,
// so the fixtures below are verbatim caption slices with hand-checked answers.
//
// The two fixtures are deliberately the two different worlds:
//   captions-suspension.vtt  — a suspension-bill debate, where the chair names
//                              both floor managers up front and almost everything
//                              resolves. This is the good case.
//   captions-oneminutes.vtt  — morning one-minute speeches, where the chair says
//                              "WITHOUT OBJECTION, THE GENTLEMAN IS RECOGNIZED"
//                              and nothing else. This is the case that must come
//                              back UNKNOWN rather than confidently wrong.
//
// Do not "clean up" the fixtures. The stenographer's mangled surnames, dropped
// words and wrong gender pronouns are the entire problem being tested.
//
//   npm test

const fs = require('fs');
const path = require('path');
require('../lib/floor-speaker.js');
const H = globalThis.HouseFloorSpeaker;

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const roster = H.buildRoster(read('members-subset.xml'));

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`fail  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`pass  ${label}`);
};

check('roster parses', roster.length > 100, true);

// ── Garbled surnames ────────────────────────────────────────────────────────
// Every one of these is a real spelling observed in the Clerk's own captions.
// Exact matching finds none of them; state-scoped fuzzy matching finds them all.
for (const [heard, state, want] of [
  ['KEELEY',      'CALIFORNIA',     'KILEY'],
  ['MORELLI',     'NEW YORK',       'MORELLE'],
  ['WHITMAN',     'VIRGINIA',       'WITTMAN'],
  ['FOX',         'NORTH CAROLINA', 'FOXX'],
  ['SUBRAMANIAM', 'VIRGINIA',       'SUBRAMANYAM'],
  ['WESTERMAN',   'ARKANSAS',       'WESTERMAN'],
]) {
  const hit = H.matchSurname(heard, state, roster);
  check(`${heard} (${state}) -> ${want}`, hit && hit.member.last, want);
}

// A short surname must not drift: FOXX is one edit from COX, and both sit in the
// roster. Only the state keeps them apart, so the national fallback must refuse.
check('short name will not drift nationally', H.matchSurname('FOX', null, roster), null);

// ── Suspension debate: the good case ────────────────────────────────────────
const susp = H.resolveFloorSpeakers(H.splitTurns(H.parseCaptionCues(read('captions-suspension.vtt'))), roster);
const at = (hhmmss) => {
  const [h, m, s] = hhmmss.split(':').map(Number);
  const want = h * 3600 + m * 60 + s;
  // Whole-second equality, not a window: chair hand-offs land within a second or
  // two of the speech they introduce, and a tolerant match silently tests the
  // wrong turn — which is how this test first passed while the resolver was wrong.
  return susp.timeline.find((x) => Math.floor(x.t) === want);
};
const who = (hhmmss) => { const x = at(hhmmss); return x && (x.role !== 'speech' ? `[${x.role}]` : (x.member ? x.member.last : '???')); };

// Hand-verified against the caption text, turn by turn.
check('04:21:41 clerk reads the title, not a member', who('04:21:41'), '[clerk]');
check('04:22:02 manager UC request',                  who('04:22:02'), 'Westerman');
check('04:22:19 majority manager opens',              who('04:22:19'), 'Westerman');
check('04:24:21 minority manager responds',           who('04:24:21'), 'Hoyle');
check('04:26:34 yielded sponsor speaks',              who('04:26:34'), 'McClintock');
check('04:29:39 floor returns to manager',            who('04:29:39'), 'Westerman');
check('04:29:46 minority manager closes',             who('04:29:46'), 'Hoyle');

// "GENTLEMAN FROM ARKANSAS." with no verb is the chair trailing off mid-handoff.
// Read as a member turn it silently keeps the previous speaker on the floor.
check('04:29:38 truncated handoff is the chair', at('04:29:38').role, 'chair');

// The manager-assignment line is what makes the rest resolvable at all.
check('both managers bound from one line',
  susp.managers.map((m) => m.last).sort(), ['ELFRETH', 'WESTERMAN']);

const suspSpeech = susp.timeline.filter((x) => x.role === 'speech');
check('suspension debate resolves > 85%',
  Math.round(suspSpeech.filter((x) => x.member).length / suspSpeech.length * 100) > 85, true);

// ── One-minutes: the honest-failure case ────────────────────────────────────
const om = H.resolveFloorSpeakers(H.splitTurns(H.parseCaptionCues(read('captions-oneminutes.vtt'))), roster);
const omSpeech = om.timeline.filter((x) => x.role === 'speech');
check('one-minutes produce speech turns', omSpeech.length > 10, true);

// The point of this fixture: when the chair never names anyone, the resolver must
// return null rather than leaving the last known speaker on the floor. A blank is
// recoverable from the next morning's Congressional Record; a wrong name is not.
check('unnamed one-minutes come back unresolved',
  omSpeech.filter((x) => !x.member).length > 0, true);
for (const x of omSpeech) {
  if (!x.member) continue;
  if (x.confidence === null || x.confidence < 0.3) { failed++; console.log(`fail  attributed turn at ${x.t} has no usable confidence`); }
}
check('every attributed turn carries a confidence',
  omSpeech.filter((x) => x.member && typeof x.confidence === 'number').length,
  omSpeech.filter((x) => x.member).length);

// Nobody is ever attributed a turn whose basis says we did not know.
check('no member attached to an unknown basis',
  susp.timeline.concat(om.timeline).filter((x) => x.member && /unknown|state-only/.test(x.basis || '')).length, 0);

// ── Manager hand-off with mangled chair formulas ────────────────────────────
// Captured live on 2026-09-14 while the House debated the Iran war powers
// resolution. Both chair turns in this window are broken in ways that had the
// resolver leave the floor with the outgoing manager for ten straight minutes,
// showing Mast on screen while Moulton was the one speaking:
//
//   "GENTLEMAN. RESERVES. GENTLEMAN FROM MASSACHUSETTS."  <- stray period, and
//                                                            the state trails a
//                                                            clause instead of
//                                                            standing alone
//   "GENTLEMAN RECOGNIZED."                               <- "IS" simply dropped
//
// Neither is a typo we can wish away; both recur. If this block goes red the
// site will confidently caption one member's speech with another's name.
const ho = H.resolveFloorSpeakers(H.splitTurns(H.parseCaptionCues(read('captions-handoff.vtt'))), roster);
const hoAt = (hhmmss) => {
  const [h, m, sec] = hhmmss.split(':').map(Number);
  return ho.timeline.find((x) => Math.floor(x.t) === h * 3600 + m * 60 + sec);
};
const hoWho = (hhmmss) => { const x = hoAt(hhmmss); return x && (x.role !== 'speech' ? `[${x.role}]` : (x.member ? x.member.last : '???')); };

// The hour was assigned as "EQUALLY DIVIDED AND CONTROLLED BY REPRESENTATIVE
// MAST OF FLORIDA AND REPRESENTATIVE MOULTON OF MASSACHUSETTS" — surname before
// state, the inverse of the suspension formula, and the form used for privileged
// resolutions. The same sentence then said "THE GENTLEMAN FROM MASSACHUSETTS,
// MR. BOLTON", so the two spellings of one seat disagree and the closer one has
// to win.
check('both managers bound from the privileged-resolution formula',
  ho.managers.map((m) => m.last).sort(), ['MAST', 'MOULTON']);
check('BOLTON resolves to Moulton', H.matchSurname('BOLTON', 'MASSACHUSETTS', roster).member.last, 'MOULTON');

check('08:32:29 majority manager holds the floor', hoWho('08:32:29'), 'Mast');
check('08:36:12 "GENTLEMAN. RESERVES." is the chair', hoAt('08:36:12').role, 'chair');
check('08:36:15 floor moves to the minority manager', hoWho('08:36:15'), 'Moulton');
check('08:36:18 "GENTLEMAN RECOGNIZED." is the chair', hoAt('08:36:18').role, 'chair');
check('08:36:20 reply is Moulton, not Mast', hoWho('08:36:20'), 'Moulton');
check('08:36:20 attributed with full confidence', hoAt('08:36:20').confidence, 0.9);

// A member's own sentence can end in a state name. That must never be read as a
// chair hand-off, or a manager yielding would hand the floor to themselves.
const selfYield = H.resolveFloorSpeakers(
  [{ t: 0, text: 'MR. SPEAKER, I YIELD TWO MINUTES TO THE GENTLEMAN FROM MASSACHUSETTS.' }], roster);
check('member yield is not a chair hand-off', selfYield.timeline[0].role, 'speech');

// ── Degenerate input ────────────────────────────────────────────────────────
for (const junk of ['', null, undefined, 'WEBVTT\n\n']) {
  check(`no crash on ${JSON.stringify(junk)}`, H.splitTurns(H.parseCaptionCues(junk)).length, 0);
}
check('empty roster resolves to nothing',
  H.resolveFloorSpeakers(H.splitTurns(H.parseCaptionCues(read('captions-suspension.vtt'))), []).timeline
    .filter((x) => x.member).length, 0);

console.log(failed ? `\n${failed} failed` : `\nall floor-speaker assertions pass`);
process.exit(failed ? 1 : 0);
