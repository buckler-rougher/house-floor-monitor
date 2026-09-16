#!/usr/bin/env node
//
// Contract test for lib/floor-status.js — how a Clerk activity row becomes a
// bill status, shared by worker.js and app.js.
//
// WHY THIS EXISTS
// Suspensions stopped showing "VOTE REQUESTED". The client's copy of this logic
// knew exactly one shape of row — a voice-vote passage — so between a member
// demanding the yeas and nays on a suspension and the vote series hours later,
// nothing on the live page could say a recorded vote was pending. Only the
// worker understood postponement, and its answer sat behind an hour-long cache.
//
// Two orderings are easy to get backwards and both have bitten this code:
//   1. A postponed row CONTAINS the passage motion it postpones, so postponement
//      must be tested first or every postponement reads as a passage.
//   2. Clerk rows are NEWEST FIRST, so a bill postponed in the morning and
//      passed in the afternoon yields passage first and postponement second.
//      Assigning blindly reverts a passed bill to "vote requested".
//
//   npm test

require('../lib/floor-status.js');
const { classifyFloorAction, billIdFromText, isOutcomeRow, outranks } = globalThis.FloorStatus;

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`fail  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`pass  ${label}`);
};

// Verbatim-shaped Clerk rows. The postponed one is the case that regressed.
const POSTPONED_SUSPENSION =
  'POSTPONED PROCEEDINGS - At the conclusion of debate on the motion to suspend the rules ' +
  'and pass H.R. 1234, the Chair put the question on the motion and by voice vote, announced ' +
  'that the ayes had prevailed. Mr. Smith demanded the yeas and nays and the Chair postponed ' +
  'further proceedings on the motion until a time to be announced.';
const PASSED_SUSPENSION_RECORDED =
  'On motion to suspend the rules and pass the bill, as amended Agreed to by the Yeas and Nays: ' +
  '(2/3 required): 405 - 0 (Roll no. 512).';
const PASSED_SUSPENSION_VOICE =
  'On motion to suspend the rules and pass the bill Agreed to by voice vote.';
const FAILED_SUSPENSION =
  'On motion to suspend the rules and pass the bill Failed by the Yeas and Nays: (2/3 required): 212 - 206 (Roll no. columns).';
const POSTPONED_RULE =
  'POSTPONED PROCEEDINGS - The Chair put the question on adoption of the resolution and by voice ' +
  'vote announced that the ayes had prevailed. Mr. Jones demanded the yeas and nays and further ' +
  'proceedings on H. Res. 1499 were postponed.';
const DEBATE = 'DEBATE - The House proceeded with forty minutes of debate on H.R. 1234.';
const RECONSIDER = 'Motion to reconsider laid on the table Agreed to without objection.';

// ── Trap 1: postponed must not read as passage ────────────────────────────────
// Its text contains "suspend the rules and pass" AND "voice vote" AND "ayes had
// prevailed". Classified in the wrong order it reads as a passed bill.
check('postponed suspension -> roll-call',
  classifyFloorAction(POSTPONED_SUSPENSION),
  { status: 'roll-call', statusText: 'Recorded vote requested — postponed', viaVoiceVote: false });
check('postponed rule -> roll-call',
  classifyFloorAction(POSTPONED_RULE).status, 'roll-call');

// ── Passage and failure still classify as before ──────────────────────────────
check('recorded-vote passage keeps its tally',
  classifyFloorAction(PASSED_SUSPENSION_RECORDED),
  { status: 'passed', statusText: 'Passed 405-0', viaVoiceVote: false });
check('voice-vote passage is flagged as such',
  classifyFloorAction(PASSED_SUSPENSION_VOICE),
  { status: 'passed', statusText: 'Passed (voice vote)', viaVoiceVote: true });
check('failure keeps its tally',
  classifyFloorAction(FAILED_SUSPENSION),
  { status: 'failed', statusText: 'Failed 212-206', viaVoiceVote: false });
check('four-digit tallies keep their commas stripped',
  classifyFloorAction('On passage Passed by the Yeas and Nays: 1,024 - 2 (Roll no. 3).').statusText,
  'Passed 1024-2');

// Non-outcome rows say nothing at all.
for (const [label, row] of [['debate', DEBATE], ['reconsider', RECONSIDER],
                            ['adjournment', 'The Speaker announced that the House do now adjourn.']])
  check(`${label} row is not an outcome`, classifyFloorAction(row), null);
check('postponed row counts as an outcome boundary', isOutcomeRow(POSTPONED_SUSPENSION), true);
check('debate row is not an outcome boundary', isOutcomeRow(DEBATE), false);

// ── Trap 2: newest-first ordering ─────────────────────────────────────────────
// Rank, not arrival order, decides. A morning postponement arrives AFTER the
// afternoon passage that resolved it.
check('passage is not walked back by an older postponement',
  outranks('roll-call', 'passed'), false);
check('failure is not walked back by an older postponement',
  outranks('roll-call', 'failed'), false);
check('a pending bill does take the roll-call flag', outranks('roll-call', 'scheduled'), true);
check('an unseen bill takes whatever the row says', outranks('roll-call', undefined), true);
check('passage does supersede a standing roll-call', outranks('passed', 'roll-call'), true);
check('newest wins a tie: failed does not replace passed', outranks('failed', 'passed'), false);

// Replaying a day in Clerk order (newest first) must end on the real outcome.
{
  const day = [RECONSIDER, PASSED_SUSPENSION_RECORDED, 'Considered as unfinished business.',
               POSTPONED_SUSPENSION, DEBATE];
  let status;
  for (const row of day) {
    const a = classifyFloorAction(row);
    if (a && outranks(a.status, status)) status = a.status;
  }
  check('postponed-then-passed suspension ends on passed', status, 'passed');
}
// And a bill still awaiting its series ends on roll-call.
{
  const day = [POSTPONED_SUSPENSION, DEBATE];
  let status;
  for (const row of day) {
    const a = classifyFloorAction(row);
    if (a && outranks(a.status, status)) status = a.status;
  }
  check('postponed-and-not-yet-voted suspension ends on roll-call', status, 'roll-call');
}

// ── Bill ids out of prose ─────────────────────────────────────────────────────
check('reads the bill out of a postponed suspension', billIdFromText(POSTPONED_SUSPENSION), 'H.R. 1234');
// The spaced form the worker's old inline regex could not match at all.
check('reads the spaced resolution form', billIdFromText(POSTPONED_RULE), 'H.Res. 1499');
for (const [text, want] of [
  ['debate on H.R. 9576, as amended', 'H.R. 9576'],
  ['agreeing to H. Con. Res. 75', 'H.Con.Res. 75'],
  ['passage of H.J.Res. 1', 'H.J.Res. 1'],
  ['consideration of S. 307', 'S. 307'],
  ['agreeing to S. Res. 45', 'S.Res. 45'],
]) check(`reads ${JSON.stringify(text)}`, billIdFromText(text), want);
// Longest-first alternation: "H.Res." must never be read as "H.R.".
check('H.Res. is not read as H.R.', billIdFromText('on H.Res. 1499'), 'H.Res. 1499');
check('no bill mentioned -> null', billIdFromText(RECONSIDER), null);
check('a congress.gov url alone is not a bill mention',
  billIdFromText('href="https://www.congress.gov/bill/119th-congress/house-bill/4795"'), null);

console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
