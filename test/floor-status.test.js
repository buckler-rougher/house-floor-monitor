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

console.log(failed ? `\n${failed} failed` : `\nall floor-status assertions pass`);
process.exit(failed ? 1 : 0);
