#!/usr/bin/env node
//
// Contract test for lib/floor-status.js — reading the Clerk's floor actions.
//
// WHY THIS EXISTS
// On 2026-09-16 the site said four suspensions were still to come when three of
// them had already been debated and had a recorded vote demanded. A suspension
// whose vote has been deferred to the next series is not a suspension waiting to
// be brought up, and on a day of ten that is the whole difference between the two
// numbers anyone actually wants.
//
// The cause was that the Chair postpones a vote in two different wordings and the
// detection only knew the rarer one. Every string below is VERBATIM from
// clerk.house.gov/FloorSummary. Do not tidy them: the doubled clauses, the
// inconsistent tense and the heading that is sometimes absent are the problem
// being tested.

require('../lib/floor-status.js');
const F = globalThis.FloorStatus;

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`fail  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`pass  ${label}`);
};

// ── The wording that was being missed ───────────────────────────────────────
// A SUSPENSION. No "POSTPONED PROCEEDINGS" heading, and "would be postponed"
// rather than "were postponed", which is what every old pattern looked for.
// S. 2403 and H.R. 9497, both on 2026-09-16, both invisible to the site.
const suspension =
  'At the conclusion of debate, the Yeas and Nays were demanded and ordered. ' +
  'Pursuant to the provisions of clause 8, rule XX, the Chair announced that ' +
  'further proceedings on the motion would be postponed.';
check('a suspension with the vote deferred is a postponement', F.isPostponement(suspension), true);
check('and counts as an outcome row', F.isOutcomeRow(suspension), true);

// ── The wording that already worked, which must keep working ────────────────
const passage =
  'POSTPONED PROCEEDINGS - At the conclusion of debate on H.R. 10326, the Chair put ' +
  'the question on passage of the bill, and by voice vote announced that the ayes had ' +
  'prevailed. Mr. Raskin demanded the yeas and nays and the Chair postponed further ' +
  'proceedings until a time to be announced.';
check('passage deferred is still a postponement', F.isPostponement(passage), true);

const senateAmendments =
  'POSTPONED PROCEEDINGS - At the conclusion of debate on H.R. 5334, the Chair put the ' +
  'question on agreeing to the Senate amendments and by voice vote announced that the ' +
  'ayes had prevailed. Mr. Meeks demanded the yeas and nays and the Chair postponed ' +
  'further proceedings until a time to be announced.';
check('Senate amendments deferred too', F.isPostponement(senateAmendments), true);

// ── What must NOT read as a postponement ────────────────────────────────────
// The Speaker's standing notice at the top of the day. It contains "will be
// postponed", concerns votes not yet ordered, and names no measure — reading it
// as one would defer something that has not happened.
const blanket = 'The Speaker announced that votes on suspensions, if ordered, will be ' +
  'postponed until a time to be announced.';
check('the day-opening notice is recognised as blanket', F.isBlanketSuspensionNotice(blanket), true);
check('and names no measure to postpone', F.isPostponement(blanket), false);

// A vote that was demanded and then actually TAKEN. The guard on the suspension
// formula is an explicit mention of postponement, and this has none.
const taken = 'On motion to suspend the rules and pass the bill Agreed to by the Yeas and ' +
  'Nays: (2/3 required): 401 - 14 (Roll no. 512).';
check('a vote taken is not a vote deferred', F.isPostponement(taken), false);
check('but it is a passage motion', F.isPassageMotion(taken), true);

const failedVote = 'On motion to suspend the rules and pass the bill Failed by the Yeas and ' +
  'Nays: (2/3 required): 210 - 215 (Roll no. 513).';
check('a failed vote is not deferred either', F.isPostponement(failedVote), false);

// Ordinary floor business must not trip any of it.
for (const plain of [
  'The House convened, returning from a recess continuing the legislative day of September 15.',
  'Mr. Comer moved to suspend the rules and pass the bill, as amended.',
  'The Clerk will report the title of the bill.',
  'Motion to reconsider laid on the table Agreed to without objection.',
  '', null, undefined,
]) {
  check(`no false postponement on ${JSON.stringify(String(plain).slice(0, 44))}`, F.isPostponement(plain), false);
}

// "Considered as unfinished business" is how a deferred vote comes BACK. It is
// not itself a deferral, and marking it as one would re-postpone a measure at the
// moment it is finally being voted.
check('unfinished business is not a fresh postponement',
  F.isPostponement('Considered as unfinished business. H.R. 9497.'), false);

// ── Tabling, the one disposition that reads backwards ───────────────────────
// 2026-09-15: Mr. Green rose to a question of the privileges of the House,
// H.Res. 1486 was considered as a privileged matter, Mr. Fry moved to table it,
// and the motion carried 232-147. The measure is dead. Reading that "Agreed to"
// the way every other outcome row is read would have reported it as PASSED.
const tabled = 'On motion to table Agreed to by the Yeas and Nays: 232 - 147, 47 Present (Roll no. 498).';
check('tabling is recognised', F.isTablingMotion(tabled), true);
check('and bounds the bill search like any outcome', F.isOutcomeRow(tabled), true);
// It must NOT be handled by the passage branch, which would call it a pass.
check('tabling is not a passage motion', F.isPassageMotion(tabled), false);
check('nor a postponement', F.isPostponement(tabled), false);

// The row that follows nearly every passage in the feed. It contains "on the
// table" and is not a tabling motion; matching it would kill measures that had
// just passed.
const reconsider = 'Motion to reconsider laid on the table Agreed to without objection.';
check('reconsideration laid on the table is not tabling', F.isTablingMotion(reconsider), false);
check('and is not an outcome at all', F.isOutcomeRow(reconsider), false);

// ── How an outcome reads on the card ────────────────────────────────────────
// The complaint that produced this: suspensions that had a recorded vote said
// just "Passed", or "Passed 415-9", while measures under a rule said "Passed
// (Roll Call 311): 214-208" — three wordings for one kind of event, because the
// tally and the roll number were read by different code in different places.
check('roll number and tally together',
  F.formatVoteDetail('On motion to suspend the rules and pass the bill Agreed to by the Yeas and Nays: (2/3 required): 343 - 79 (Roll no. 304) .'),
  '(Roll Call 304): 343-79');
check('the 2/3 threshold is not mistaken for a tally',
  F.formatVoteDetail('Agreed to by the Yeas and Nays: (2/3 required): 415 - 9 (Roll no. 313) .'),
  '(Roll Call 313): 415-9');
check('en dash separator reads the same as a hyphen',
  F.formatVoteDetail('Passed by the Yeas and Nays: 214 \u2013 208 (Roll no. 311).'),
  '(Roll Call 311): 214-208');
check('four-digit tallies keep no comma',
  F.formatVoteDetail('Agreed to by the Yeas and Nays: 1,024 - 2 (Roll no. 7).'),
  '(Roll Call 7): 1024-2');
// The Clerk sometimes posts the outcome before the tally lands in the row.
check('a roll number with no tally still identifies the vote',
  F.formatVoteDetail('Agreed to by recorded vote: (Roll no. 273).'), '(Roll Call 273)');
check('a tally with no roll number is still the result',
  F.formatVoteDetail('Agreed to by the Yeas and Nays: 262 - 159.'), '262-159');
check('a voice vote carries neither', F.formatVoteDetail('Agreed to by voice vote.'), null);
check('no crash on empty', F.formatVoteDetail(''), null);
check('no crash on null', F.formatVoteDetail(null), null);

// The ratchet locks a terminal status the first time it sees one, so it needs to
// know when a later reading of the same outcome says more than the stored one.
check('roll + tally is the fullest reading', F.statusTextDetail('Passed (Roll Call 304): 343-79'), 3);
check('roll alone says less', F.statusTextDetail('Passed (Roll Call 273)'), 2);
check('a tally says as much as a roll number', F.statusTextDetail('Passed 343-79'), 2);
check('a voice vote is complete as written', F.statusTextDetail('Passed (voice vote)'), 2);
check('bare "Passed" says the least', F.statusTextDetail('Passed'), 1);
check('nothing at all scores zero', F.statusTextDetail(''), 0);
// The ordering is the whole point: a fuller line must beat the stored one.
check('a tally replaces a bare Passed',
  F.statusTextDetail('Passed (Roll Call 304): 343-79') > F.statusTextDetail('Passed'), true);
check('but a bare Passed never replaces a tally',
  F.statusTextDetail('Passed') > F.statusTextDetail('Passed (Roll Call 304): 343-79'), false);

// ── Senate amendments, the vote with no bill on it ──────────────────────────
// 2026-09-16: "On motion that the House agree to the Senate amendments Agreed to
// by the Yeas and Nays: 262 - 159 (Roll no. 308)" — no bill link, no bill number,
// and no "Considered as unfinished business" row beside it. The only row naming
// H.R. 5334 is the postponement this vote resolves, and both say "Senate
// amendment", which is how worker.js pairs them.
check('the resolving vote is recognisable',
  F.isSenateAmendmentQuestion('On motion that the House agree to the Senate amendments Agreed to by the Yeas and Nays: 262 - 159 (Roll no. 308).'),
  true);
check('so is the postponement it resolves',
  F.isSenateAmendmentQuestion('POSTPONED PROCEEDINGS - At the conclusion of debate on H.R. 5334, the Chair put the question on agreeing to the Senate amendments and by voice vote, announced the ayes had prevailed.'),
  true);
check('an ordinary passage is not',
  F.isSenateAmendmentQuestion('On passage Passed by the Yeas and Nays: 214 - 208 (Roll no. 311).'), false);
check('no crash on null', F.isSenateAmendmentQuestion(null), false);

console.log(failed ? `\n${failed} failed` : `\nall floor-status assertions pass`);
process.exit(failed ? 1 : 0);
