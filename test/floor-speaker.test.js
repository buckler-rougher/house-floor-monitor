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

// An honorific that disagrees rules out an INEXACT match. Found by the Record
// grader on 2026-09-03: "I NOW YIELD TO THE DISTINGUISHED GENTLEMAN FROM NEW YORK,
// MR. FENIG" was resolving to Grace Meng — two edits, inside the allowance for a
// five-letter surname, and she is a gentlewoman. Saying nothing is right here; the
// member behind "FENIG" is not recoverable from that spelling.
check('a garbled name with a conflicting honorific resolves to nobody',
  H.matchSurname('FENIG', 'NEW YORK', roster, 'M'), null);
// The captions get honorifics wrong on their own ("THE GENTLEMAN FROM MARYLAND,
// MS. ELFRETH"), so an exact spelling still wins whatever the honorific claims.
check('an exact spelling outranks a wrong honorific',
  H.matchSurname('ELFRETH', 'MARYLAND', roster, 'M').member.last, 'ELFRETH');
// And the real garbles must survive the filter.
for (const [heard, state, gender, want] of [
  ['KEELEY', 'CALIFORNIA', 'M', 'KILEY'],
  ['MORELLI', 'NEW YORK', 'M', 'MORELLE'],
  ['WHITMAN', 'VIRGINIA', 'M', 'WITTMAN'],
  ['FOX', 'NORTH CAROLINA', 'F', 'FOXX'],
  ['BOLTON', 'MASSACHUSETTS', 'M', 'MOULTON'],
]) check(`${heard} (${gender}) still resolves to ${want}`,
  H.matchSurname(heard, state, roster, gender).member.last, want);

// "FOR YIELDING" names the member who yielded TO the speaker — the opposite
// direction. Testing for the bare word set the next speaker from whichever name
// the sentence contained, which put one member's name on the following turn and
// the thanking member's on this one.
const thanksForYield = H.resolveFloorSpeakers([
  { t: 0, text: 'THE GENTLEMAN FROM ARKANSAS, MR. WESTERMAN, IS RECOGNIZED FOR FIVE MINUTES.' },
  { t: 1, text: 'MR. SPEAKER, I RISE TODAY IN REMEMBRANCE.' },
  { t: 2, text: 'THANK YOU TO MY COLLEAGUE FROM NEW YORK, MR. MORELLE, FOR YIELDING. I RISE AS WELL.' },
  { t: 3, text: 'MR. SPEAKER, I ASK FOR A MOMENT OF SILENCE.' },
], roster);
check('the recognition names the speaker', thanksForYield.timeline[1].member.last, 'Westerman');
// Turn 2 thanks a DIFFERENT member for yielding. Read as a hand-off it made turn 3
// Morelle; it must stay with whoever actually holds the floor.
check('being thanked for yielding does not hand over the next turn',
  thanksForYield.timeline[3].member.last, 'Westerman');

// The captions drop stray periods into the middle of a yield. "to the bill
// sponsor, my friend from Louisiana, Mr. Carter" came through as "TO THE BILL.
// SPONSOR MY FRIEND FROM LOUISIANA, MR. CARTER", and a token run that stopped dead
// at "BILL." missed the hand-off — so the chair's bare "THE GENTLEMAN IS
// RECOGNIZED" fell back to the manager and the row named Magaziner while Carter
// spoke.
const brokenYield = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM RHODE ISLAND, MR. MAGAZINER, AND THE GENTLEMAN FROM LOUISIANA, MR. CARTER, EACH WILL CONTROL 20 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM RHODE ISLAND IS RECOGNIZED.' },
  { t: 2, text: 'THANK YOU, MR. SPEAKER. I YIELD TO THE BILL. SPONSOR MY FRIEND FROM LOUISIANA, MR. CARTER, AS MUCH TIME AS HE MAY CONSUME.' },
  { t: 3, text: 'THE GENTLEMAN IS RECOGNIZED.' },
  { t: 4, text: 'MR. SPEAKER, I RISE TODAY IN SUPPORT OF MY BILL, H.R. 5109.' },
], roster);
check('a yield survives a stray period mid-phrase', brokenYield.timeline[4].member.last, 'Carter');
check('and is credited to the yield', brokenYield.timeline[4].basis, 'yielded-named');

// A state is stronger evidence than a spelling the stenographer typed at speed.
//
// "THE GENTLEMAN FROM OREGON, MR. BOYLE" is Ms. Hoyle — the captions garbled her
// name AND her gender. Rejecting the one-edit match on the honorific and falling
// through to the whole roster found an exact "Boyle" in Pennsylvania, which is a
// worse answer than the near miss it replaced. So: a one-edit match outranks a
// disagreeing honorific, and a state that has plausible candidates is never
// abandoned for a national search.
check('a garbled name beats a garbled honorific',
  H.matchSurname('BOYLE', 'OREGON', roster, 'M').member.last, 'HOYLE');
check('two edits plus a wrong honorific is not enough',
  H.matchSurname('FENIG', 'NEW YORK', roster, 'M'), null);
check('and it never escapes to another state',
  (H.matchSurname('BOYLE', 'OREGON', roster, 'M') || {}).scope, 'state');

// A yield whose name trails a long appositive, and which does not resolve.
// "MR. NILS" is Mr. Nehls — four letters, two edits, not recoverable. What matters
// is that the Texas binding from earlier is dropped rather than reused, so the
// floor reports an unidentified Texan instead of the wrong one.
const staleBind = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM ARKANSAS, MR. WESTERMAN, AND THE GENTLEMAN FROM TEXAS, MR. CASTRO, EACH WILL CONTROL 20 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM ARKANSAS IS RECOGNIZED.' },
  { t: 2, text: 'MR. SPEAKER, I YIELD TWO MINUTES TO THE GENTLEMAN FROM TEXAS, THE LEAD SPONSOR OF THIS BILL AND SOMEONE WHO PERSONALLY KNOWS ABOUT LAW ENFORCEMENT, HAVING SERVED AS A SHERIFF. MR. NILS.' },
  { t: 3, text: 'THE GENTLEMAN FROM TEXAS IS RECOGNIZED FOR TWO MINUTES.' },
  { t: 4, text: 'THANK YOU, MR. SPEAKER. I RISE IN STRONG SUPPORT OF MY BILL.' },
], roster);
check('an unreadable yield target does not inherit the old binding',
  staleBind.timeline[4].member, null);

// The same construction with a readable name must still bind, appositive and all.
const longAppositive = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM ARKANSAS, MR. WESTERMAN, AND THE GENTLEWOMAN FROM OREGON, MS. HOYLE, EACH WILL CONTROL 20 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM ARKANSAS IS RECOGNIZED.' },
  { t: 2, text: 'MR. SPEAKER, I YIELD TWO MINUTES TO THE GENTLEMAN FROM CALIFORNIA, THE LEAD SPONSOR OF THIS BILL AND A LONG-SERVING MEMBER OF THIS COMMITTEE, MR. MCCLINTOCK.' },
  { t: 3, text: 'THE GENTLEMAN FROM CALIFORNIA IS RECOGNIZED FOR TWO MINUTES.' },
  { t: 4, text: 'THANK YOU, MR. SPEAKER.' },
], roster);
check('a readable name behind a long appositive still binds',
  longAppositive.timeline[4].member.last, 'McClintock');

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

// A yield is where most members are named at all, and members do not say
// "gentleman" — Moulton handed Crow three minutes as "MY DISTINGUISHED COLLEAGUE
// FROM COLORADO, MR. CROW". With only the chair's nouns accepted, that name was
// invisible and the chair's follow-up ("GENTLEMAN RECOGNIZED FOR THREE MINUTES.",
// no state) fell back to the manager — captioning Crow's three minutes as Moulton.
check('08:51:44 yielded member is Crow, not the manager', hoWho('08:51:44'), 'Crow');
check('08:51:44 credited to the yield', hoAt('08:51:44').basis, 'yielded-named');

// Backstop for when the yield itself cannot be read: nobody thanks themselves.
const selfThank = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM FLORIDA, MR. MAST, AND THE GENTLEMAN FROM MASSACHUSETTS, MR. MOULTON, EACH WILL CONTROL 30 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM MASSACHUSETTS IS RECOGNIZED.' },
  { t: 2, text: 'THANK YOU, MR. SPEAKER. AND THANK YOU, REPRESENTATIVE MOULTON, FOR YOUR LEADERSHIP ON THIS.' },
], roster);
check('a member thanking Moulton is not Moulton', selfThank.timeline[2].member, null);
check('self-thank is reported as contradicted', selfThank.timeline[2].basis, 'contradicted');

// "I YIELD AS MUCH TIME AS I MAY CONSUME TO BRIEFLY RESPOND" is a yield to SELF;
// the "to" is an infinitive. Reading it as a hand-off blanks the speaker.
const infinitive = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM FLORIDA, MR. MAST, AND THE GENTLEMAN FROM MASSACHUSETTS, MR. MOULTON, EACH WILL CONTROL 30 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM FLORIDA IS RECOGNIZED.' },
  { t: 2, text: 'I YIELD AS MUCH TIME AS I MAY CONSUME TO BRIEFLY RESPOND TO MY COLLEAGUE.' },
  { t: 3, text: 'THE GENTLEMAN IS RECOGNIZED.' },
  { t: 4, text: 'AS I WAS SAYING, THE THREAT IS REAL.' },
], roster);
check('yield-to-self keeps the floor', infinitive.timeline[4].member && infinitive.timeline[4].member.last, 'Mast');

// A member's own sentence can end in a state name. That must never be read as a
// chair hand-off, or a manager yielding would hand the floor to themselves.
const selfYield = H.resolveFloorSpeakers(
  [{ t: 0, text: 'MR. SPEAKER, I YIELD TWO MINUTES TO THE GENTLEMAN FROM MASSACHUSETTS.' }], roster);
check('member yield is not a chair hand-off', selfYield.timeline[0].role, 'speech');

// ── Stats are session-wide, not window-wide ─────────────────────────────────
// `limit` trims what the caller SEES. If the counts are taken after that trim,
// resolvedPct reads 100% whenever the newest turn happens to be resolved — which
// is exactly what the live endpoint reported before this was separated out.
const full    = H.resolveFloorSpeakers(H.splitTurns(H.parseCaptionCues(read('captions-suspension.vtt'))), roster);
const trimmed = H.resolveFloorSpeakers(H.splitTurns(H.parseCaptionCues(read('captions-suspension.vtt'))), roster, { limit: 1 });
check('limit trims the visible timeline', trimmed.timeline.length, 1);
check('limit does not change the speech-turn count', trimmed.speechTurns, full.speechTurns);
check('limit does not change the resolved count', trimmed.resolvedTurns, full.resolvedTurns);
check('speech-turn count matches the timeline', full.speechTurns, full.timeline.filter((x) => x.role === 'speech').length);
check('limit does not change who is current', trimmed.current.t, full.current.t);

// ── Special Order hours ─────────────────────────────────────────────────────
// A different format entirely, and most of an evening is made of them. The chair
// recognises the holder once, for sixty minutes, and then says nothing at all:
// the holder introduces each guest and speaks again between them. Every rule the
// bill-debate path relies on — manager bindings, chair recognitions — is absent.
const so = H.resolveFloorSpeakers([
  { t: 0, text: "UNDER THE SPEAKER'S ANNOUNCED POLICY OF JANUARY 3RD, 2025, THE GENTLEWOMAN FROM WYOMING, MS. HAGEMAN, IS RECOGNIZED FOR 60 MINUTES." },
  { t: 1, text: 'THANK YOU, MR. SPEAKER. WE HAVE GATHERED THIS EVENING TO TALK ABOUT TRUCKING.' },
  { t: 2, text: 'I NOW INVITE REPRESENTATIVE RALPH NORMAN FROM SOUTH CAROLINA TO ADDRESS THE BODY.' },
  { t: 3, text: 'I WANT TO THANK CONGRESSWOMAN HAGERMAN FOR LEADING THIS CHARGE.' },
  { t: 4, text: 'THANK YOU, REPRESENTATIVE NORMAN. I NOW INVITE REPRESENTATIVE MIKE VOSS FROM ILLINOIS TO ADDRESS THE BODY.' },
  { t: 5, text: 'I THANK THE GENTLEMAN FOR YIELDING. I RISE TODAY IN RECOGNITION OF TRUCK DRIVERS.' },
], roster);
const soWho = (i) => so.timeline[i].member && so.timeline[i].member.last;

check('the hour opens with its holder', soWho(1), 'Hageman');
// "REPRESENTATIVE RALPH NORMAN FROM SOUTH CAROLINA" — surname after the given
// name and FROM rather than OF, the inverse of the suspension formula.
check('invited guest takes the floor', soWho(3), 'Norman');
// Only the holder invites, so the introducing turn is theirs — otherwise it is
// credited to the guest who just finished.
check('the introduction belongs to the holder', soWho(2), 'Hageman');
// Reclaiming the floor from a guest IS an inference from the format's shape, and
// is labelled so the confidence drops. (The opening introduction needs no such
// inference — the holder already had the floor.)
check('holder reclaims between guests', soWho(4), 'Hageman');
check('the reclaim is marked as an inference', so.timeline[4].basis, 'hour-holder');
check('and carries lower confidence', so.timeline[4].confidence < so.timeline[3].confidence, true);
// "MIKE VOSS" is Mike Bost. VOSS->BOST is two edits, more than a four-letter
// surname is allowed alone; the given name narrows Illinois first.
check('a garbled surname resolves via the given name', soWho(5), 'Bost');
check('given name narrows the delegation',
  H.matchPersonTokens('MIKE VOSS', 'ILLINOIS', roster).member.last, 'BOST');
check('surname alone would not have', H.matchSurname('VOSS', 'ILLINOIS', roster), null);

const liveSeedLate = {
  FLORIDA: roster.find((r) => r.last === 'MAST'),
  MASSACHUSETTS: roster.find((r) => r.last === 'MOULTON'),
};

// ── The House rising ────────────────────────────────────────────────────────
// Nobody holds the floor once the Speaker gavels out, and the broadcast API does
// not say so: hours after the House adjourned on 2026-09-14 it still reported
// isLiveBroadcast "True" with an empty endDate. Only the captions know, so the
// last member of the night otherwise stays on screen over the House's own "not in
// session" slate until the next morning.
const adj = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM FLORIDA, MR. MAST, AND THE GENTLEMAN FROM MASSACHUSETTS, MR. MOULTON, EACH WILL CONTROL 30 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM FLORIDA IS RECOGNIZED.' },
  { t: 2, text: 'MR. SPEAKER, I RISE IN SUPPORT.' },
  { t: 3, text: 'MR. SPEAKER, I MOVE THAT THE HOUSE DO NOW ADJOURN.' },
  { t: 4, text: 'THE QUESTION IS ON THE MOTION TO ADJOURN. THOSE IN FAVOR SAY AYE. THE AYES HAVE IT.' },
  { t: 5, text: 'THE HOUSE STANDS ADJOURNED UNTIL 10 A.M. TOMORROW FOR MORNING HOUR DEBATE.' },
], roster);
check('adjournment is detected', adj.sessionState, 'adjourned');
check('and when they return', adj.sessionUntil, '10 A.M. TOMORROW');
check('nobody holds the floor after it', adj.current, null);

// The motion and the vote on it are not the House rising. Treating them as such
// would blank the speaker several turns early, every single session.
const motion = H.resolveFloorSpeakers(adj.timeline.slice(0, 5).map((x) => ({ t: x.t, text: x.text })), roster);
check('a motion to adjourn is not an adjournment', motion.sessionState, 'in-session');
// `current` can be the chair now, so this asks the question it always meant to:
// the member holding the floor is untouched by the motion being put.
const lastMember = [...motion.timeline].reverse().find((x) => x.role === 'speech' && x.member);
check('and the member holding the floor is untouched', lastMember.member.last, 'Mast');

// A recess ends without announcement — anyone speaking means they are back.
const back = H.resolveFloorSpeakers([
  { t: 0, text: 'THE HOUSE STANDS IN RECESS UNTIL 2 P.M. TODAY.' },
  { t: 1, text: 'THE GENTLEMAN FROM FLORIDA IS RECOGNIZED.' },
  { t: 2, text: 'MR. SPEAKER, I RISE IN SUPPORT OF THIS MEASURE.' },
], roster);
check('recess is detected', H.resolveFloorSpeakers([{ t: 0, text: 'THE HOUSE STANDS IN RECESS UNTIL 2 P.M. TODAY.' }], roster).sessionState, 'recess');
check('speech means they are back', back.sessionState, 'in-session');

// The live path must clear on its own, seconds after the words are spoken, rather
// than waiting for the sidecar the server reads.
const liveAdj = H.resolveLiveFloor('THE AYES HAVE IT. THE HOUSE STANDS ADJOURNED UNTIL 10 A.M. TOMORROW.', roster, liveSeedLate);
check('live track reports adjournment', liveAdj.basis, 'adjourned');
check('with no member attached', liveAdj.member, null);
check('live motion alone is not adjournment',
  H.resolveLiveFloor('MR. SPEAKER, I MOVE THAT THE HOUSE DO NOW ADJOURN.', roster, liveSeedLate), null);

// "10 A.M. TOMORROW" is full of periods, and every caption is capitalized, so
// neither "stop at the first period" nor "stop before a capital" works.
check('until-clause survives A.M.', H.cleanUntil('10 A.M. TOMORROW FOR MORNING HOUR DEBATE.'), '10 A.M. TOMORROW');
check('and stops at a real sentence end', H.cleanUntil('NOON TOMORROW. THE CLERK WILL NOTIFY THE SENATE.'), 'NOON TOMORROW');

// ── Live caption track (unsegmented) ────────────────────────────────────────
// The video carries its own CEA-608 track whose cues arrive ahead of the picture,
// while captions.vtt is rewritten only every 70-78s. But the live track has no
// "UNIDENTIFIED SPEAKER:" markers — those are added by the stenographer in the
// sidecar only — so there are no turn boundaries to split on. resolveLiveFloor
// replays just the events that move the floor over a seeded binding table.
const liveSeed = liveSeedLate;
const live = (t) => H.resolveLiveFloor(t, roster, liveSeed);

check('state-only hand-off resolves off the seed',
  live('AND I YIELD BACK. GENTLEMAN RESERVES. THE GENTLEMAN FROM FLORIDA IS RECOGNIZED.').member.last, 'Mast');
check('a name in the recognition wins',
  live('WITHOUT OBJECTION, THE GENTLEMAN FROM COLORADO, MR. CROW, IS RECOGNIZED FOR ONE MINUTE.').member.last, 'Crow');
check('yield then a bare recognition',
  live('I YIELD THREE MINUTES TO MY COLLEAGUE FROM COLORADO, MR. CROW. GENTLEMAN RECOGNIZED FOR THREE MINUTES.').member.last, 'Crow');
check('the LAST hand-off wins, not the first',
  live('THE GENTLEMAN FROM FLORIDA IS RECOGNIZED. ... THE GENTLEMAN FROM MASSACHUSETTS IS RECOGNIZED.').member.last, 'Moulton');

// Text with no hand-off must report nothing, so the caller keeps the server's
// answer instead of blanking a correct name mid-speech.
check('no hand-off in the text yields null',
  live('AND THAT IS WHY I URGE MY COLLEAGUES TO SUPPORT THIS GOOD LEGISLATION.'), null);
check('no roster yields null', H.resolveLiveFloor('THE GENTLEMAN FROM FLORIDA IS RECOGNIZED.', [], {}), null);
check('empty text yields null', H.resolveLiveFloor('', roster, liveSeed), null);

// Roll-up captions repeat the previous line with every new one.
check('roll-up duplicates collapse',
  H.dedupeLiveCues([{ text: 'A B' }, { text: 'C D' }, { text: 'A B' }, { text: '  ' }, { text: 'C  D' }]),
  ['A B', 'C D']);

// ── What the reading clerk was asked to do ──────────────────────────────────
// The clerk reads titles, but also designates resolutions, reports amendments and
// calls the roll. A line that always read "reading the measure" was wrong for
// three of those four, and the instruction says which it is.
const CP = H.buildPatterns(roster);
for (const [instruction, want] of [
  ['THE CLERK WILL REPORT THE TITLE OF THE BILL.', 'reading the bill title'],
  ['THE CLERK WILL DESIGNATE THE RESOLUTION.', 'designating the resolution'],
  ['THE CLERK WILL REPORT THE AMENDMENT.', 'reading the amendment'],
  ['THE CLERK WILL CALL THE ROLL.', 'calling the roll'],
  ['THE CLERK WILL READ THE MESSAGE FROM THE SENATE.', 'reading a senate message'],
]) check(`"${instruction.slice(4, 40)}" -> ${want}`, H.clerkActionPhrase(instruction, CP), want);

// "reading the title of the bill" is the commonest of these and overran the panel
// at its narrowest, so that phrasing is shortened rather than left to ellipsis.
check('the commonest phrasing is the shortened one',
  H.clerkActionPhrase('THE CLERK WILL REPORT THE TITLE OF THE BILL.', CP).length <= 22, true);
check('an unreadable instruction yields nothing',
  H.clerkActionPhrase('THE GENTLEMAN FROM TEXAS IS RECOGNIZED.', CP), null);

// The live track has no turn boundaries, so the instruction itself marks the clerk.
const liveClerk = H.resolveLiveFloor(
  'THE GENTLEMAN FROM ARKANSAS IS RECOGNIZED. MR. SPEAKER, I MOVE TO SUSPEND THE RULES. THE CLERK WILL REPORT THE TITLE OF THE BILL.',
  roster, {});
check('the live track reports the clerk', liveClerk.basis, 'clerk');
check('with no member attached', liveClerk.member, null);
check('and carries what they are doing', liveClerk.clerkAction, 'reading the bill title');

// ── Which state was recognised ──────────────────────────────────────────────
// The two orderings fight each other — "THE CHAIR RECOGNIZES THE GENTLEMAN FROM
// ARKANSAS" puts the state after the word, "THE GENTLEMAN FROM ARKANSAS IS
// RECOGNIZED" before it — and a chair turn routinely settles the last speaker
// before naming the next. Proximity to the word is what binds them, not order.
const RP = H.buildPatterns(roster);
for (const [label, text, want] of [
  ['stray periods mid-phrase',
   'GENTLEMAN RESERVES. GENTLEMAN FROM RHODE ISLAND. MR. MAGAZINE. MAGAZINER IS RECOGNIZED.', 'RHODE ISLAND'],
  ['two states, the later one wins',
   'THE GENTLEMAN FROM RHODE ISLAND YIELDS BACK. THE GENTLEMAN FROM TEXAS IS RECOGNIZED.', 'TEXAS'],
  ['state after the word',
   'THE CHAIR RECOGNIZES THE GENTLEMAN FROM ARKANSAS.', 'ARKANSAS'],
  ['reserves, then the next',
   'GENTLEMAN RESERVES. THE GENTLEMAN FROM OREGON IS RECOGNIZED.', 'OREGON'],
]) check(label, H.recognitionState(text, RP), want);
check('no recognition, no state', H.recognitionState('THE GENTLEMAN FROM TEXAS YIELDS BACK.', RP), null);

// End to end: the caption stutter that cost Magaziner a whole speech.
const stutter = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM TEXAS, MR. CASTRO, AND THE GENTLEMAN FROM RHODE ISLAND, MR. MAGAZINER, EACH WILL CONTROL 20 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM TEXAS IS RECOGNIZED.' },
  { t: 2, text: 'MR. SPEAKER, I RISE IN SUPPORT.' },
  { t: 3, text: 'GENTLEMAN RESERVES. GENTLEMAN FROM RHODE ISLAND. MR. MAGAZINE. MAGAZINER IS RECOGNIZED.' },
  { t: 4, text: 'THANK YOU, MR. SPEAKER. I YIELD MYSELF SUCH TIME AS I MAY CONSUME.' },
], roster);
check('the floor moves despite the stutter', stutter.timeline[4].member.last, 'Magaziner');

// ── A hand-off buried inside somebody's turn ────────────────────────────────
// Turn boundaries exist only where the stenographer types "UNIDENTIFIED SPEAKER:",
// and sometimes they simply do not — one turn then swallows a recognition and
// everything after it, and the floor changes hands with nothing noticing.
const SP = H.buildPatterns(roster);
const merged = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM MICHIGAN, MR. WALBERG, AND THE GENTLEMAN FROM VIRGINIA, MR. SCOTT, EACH WILL CONTROL 20 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM VIRGINIA IS RECOGNIZED.' },
  { t: 2, text: 'MR. SPEAKER, I RISE IN FAVOR OF THIS BILL. IT CLOSES A LOOPHOLE THAT HAS PERSISTED FOR YEARS AND I URGE MY COLLEAGUES TO SUPPORT IT. I YIELD BACK. THE GENTLEMAN FROM MICHIGAN IS RECOGNIZED. MR. SPEAKER, I THANK THE RANKING MEMBER AND RISE IN STRONG SUPPORT.' },
], roster);
check('the buried hand-off is found', merged.current.member.last, 'Walberg');
check('and the speech before it still belongs to the first member',
  merged.timeline.filter((x) => x.role === 'speech')[0].member.last, 'Scott');

// The chair's own turns must survive intact. "THE GENTLEMAN RESERVES." in front of
// a recognition is one chair turn, not two — and the lead-in test missed it for a
// while because it was anchored without allowing the leading "THE".
check('a chair turn is not split', H.splitEmbeddedChairTurns(
  [{ t: 0, text: 'THE GENTLEMAN RESERVES. THE GENTLEMAN FROM NEW YORK IS RECOGNIZED.' }], SP).length, 1);
check('nor is one opening with a yield-back', H.splitEmbeddedChairTurns(
  [{ t: 0, text: "THE GENTLEMAN'S TIME HAS EXPIRED. THE GENTLEMAN FROM TEXAS IS RECOGNIZED." }], SP).length, 1);

// ── A yield must not cost the manager their seat ────────────────────────────
//
// Live on 2026-09-16: the Virginia manager yielded five minutes to Mrs. Kiggans,
// also of Virginia. `bind` is the running "last member named from this state"
// table and the yield wrote her into it, so the chair's next "THE GENTLEMAN FROM
// VIRGINIA IS RECOGNIZED" — him resuming control — came back as her. The row
// named a gentlewoman for a gentleman and held her there for the rest of the bill.
//
// Control of time and "who was named most recently" are two different facts.
const yieldedSameState = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM ARKANSAS, MR. WESTERMAN, AND THE GENTLEMAN FROM VIRGINIA, MR. SUBRAMANYAM, EACH WILL CONTROL 20 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM VIRGINIA IS RECOGNIZED.' },
  { t: 2, text: 'THANK YOU, MR. SPEAKER. I YIELD FIVE MINUTES TO THE GENTLEWOMAN FROM VIRGINIA. MS. KIGGANS.' },
  { t: 3, text: 'THE GENTLEWOMAN FROM VIRGINIA IS RECOGNIZED.' },
  { t: 4, text: 'THANK YOU, MR. SPEAKER. I RISE TODAY IN SUPPORT OF MY BILL, WHICH WOULD DESIGNATE A POST OFFICE.' },
  { t: 5, text: 'THE GENTLEMAN FROM ARKANSAS RESERVES. THE GENTLEMAN FROM VIRGINIA IS RECOGNIZED.' },
  { t: 6, text: 'THANK YOU, MR. SPEAKER. I THANK THE GENTLEMAN FOR THIS BILL, AND I URGE MY COLLEAGUES TO SUPPORT IT.' },
], roster);
const yss = (t) => yieldedSameState.timeline.find((x) => Math.floor(x.t) === t);
check('the yield target gets her own turns', yss(4).member.last, 'Kiggans');
check('and the manager gets his seat back', yss(6).member.last, 'Subramanyam');

// ── Yielding to an office nobody names ──────────────────────────────────────
//
// "I YIELD TO THE LEADER FOR ONE MINUTE", also live on 2026-09-16. LEADER was not
// in the vocabulary of things one yields TO, so the resolver never saw the floor
// move and ran the Leader's whole minute under the yielder's name. The captions
// name an office, not a person, and there is no free feed that turns one into the
// other — so the answer is that we do not know, not a name we know to be wrong.
const yieldedToOffice = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM ARKANSAS, MR. WESTERMAN, AND THE GENTLEMAN FROM VIRGINIA, MR. SUBRAMANYAM, EACH WILL CONTROL 20 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM VIRGINIA IS RECOGNIZED.' },
  { t: 2, text: 'THANK YOU, MR. SPEAKER. I YIELD TO THE LEADER FOR ONE MINUTE.' },
  { t: 3, text: 'THANK YOU, MR. SPEAKER. I RISE IN STRONG SUPPORT OF THIS LEGISLATION AND I THANK MY COLLEAGUE FOR YIELDING.' },
], roster);
const yto = (t) => yieldedToOffice.timeline.find((x) => Math.floor(x.t) === t);
check('the yielder keeps the turn they yielded in', yto(2).member.last, 'Subramanyam');
check('the office that follows is not them', yto(3).member, null);
check('and says why', yto(3).basis, 'yield-unresolved');
// And reports no delegation. purposeState is the state the CHAIR last recognised,
// which after this yield is a fact about the member who yielded, not the one
// speaking — it billed the Democratic Leader of New York as an unidentified
// Virginian, which is a worse answer than admitting to nothing.
check('and claims no delegation it does not have', yto(3).candidateState, null);

// The contrast: a yield that DOES name a state, whose surname is past recovery.
// "MR. NILS" is Mr. Nehls. An unidentified Texan is exactly what is known here,
// so this one keeps its delegation.
const yieldedNamelessInState = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM ARKANSAS, MR. WESTERMAN, AND THE GENTLEMAN FROM VIRGINIA, MR. SUBRAMANYAM, EACH WILL CONTROL 20 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM ARKANSAS IS RECOGNIZED.' },
  { t: 2, text: 'MR. SPEAKER, I YIELD TWO MINUTES TO THE GENTLEMAN FROM TEXAS, WHO KNOWS THIS ISSUE WELL. MR. NILS.' },
  { t: 3, text: 'THANK YOU, MR. SPEAKER. I RISE IN STRONG SUPPORT OF MY BILL.' },
], roster);
const ynis = yieldedNamelessInState.timeline.find((x) => Math.floor(x.t) === 3);
check('a nameless in-state yield is still nameless', ynis.member, null);
check('but keeps the delegation the chair was given', ynis.candidateState, 'TEXAS');

// ── Which of the three the speaker row shows ────────────────────────────────
//
// The client used to decide this inline, and got it wrong in a way no test could
// see: the chair branch ran only when the live resolver returned NOTHING, and the
// clerk branch deferred to the live resolver whenever it returned ANYTHING. The
// live resolver returns non-null continuously while the House is sitting — its
// input is a rolling few minutes of floor speech and almost any slice of that
// moves the floor — so between them, those two conditions made the Speaker's seal
// and the reading clerk's quill unreachable. Live for months, shown never.
//
// The real rule is about time: a live event decides while it is still the latest
// thing said; after that the server's snapshot, which has caught up by then, does.
const CHAIR = { role: 'chair', member: null, presiding: 'speaker' };
const CLERK = { role: 'clerk', member: null, clerkAction: 'reading the bill title' };
const SPEECH = { role: 'speech', member: { last: 'Comer' } };
const LIVE_MEMBER = { basis: 'live-named', member: { last: 'Massie' }, fromEnd: 40 };
const LIVE_CLERK = { basis: 'clerk', member: null, fromEnd: 12 };

// The bug, stated as the two cases that used to be unreachable.
check('a stale live result does not hide the chair', H.floorRole(LIVE_MEMBER, false, CHAIR, true), 'chair');
check('a stale live result does not hide the clerk', H.floorRole(LIVE_MEMBER, false, CLERK, true), 'clerk');

// And the reason the gate existed in the first place: fresh live really does win.
check('a fresh live naming outranks the server chair', H.floorRole(LIVE_MEMBER, true, CHAIR, true), 'member');
check('a fresh live clerk call outranks the server speech', H.floorRole(LIVE_CLERK, true, SPEECH, true), 'clerk');
check('a fresh live naming outranks the server clerk', H.floorRole(LIVE_MEMBER, true, CLERK, true), 'member');

// No live track at all — Safari, a dropped stream, the panel closed.
check('no live result falls back to the server chair', H.floorRole(null, false, CHAIR, true), 'chair');
check('no live result falls back to the server clerk', H.floorRole(null, false, CLERK, true), 'clerk');
check('no live result falls back to the server member', H.floorRole(null, false, SPEECH, true), 'member');
check('no server current is survivable', H.floorRole(null, false, null, true), 'member');

// A stale snapshot must not assert either mark. Both are present-tense claims
// about this instant — the clerk is reading NOW — and a reading lasts about
// fifteen seconds while the sidecar can be two minutes behind, so off stale
// evidence the quill turns up after the clerk has sat down and then stays.
check('a stale snapshot does not assert the clerk', H.floorRole(null, false, CLERK, false), 'member');
check('nor the chair', H.floorRole(null, false, CHAIR, false), 'member');
check('but a fresh live clerk call still counts', H.floorRole(LIVE_CLERK, true, SPEECH, false), 'clerk');

// The chair holding the floor, off the live track — the only source that can
// carry it, since the sidecar is always too far behind for a present-tense mark.
const LIVE_CHAIR = { basis: 'chair', member: null, presiding: 'speaker', fromEnd: 20 };
check('a fresh live chair shows the chair', H.floorRole(LIVE_CHAIR, true, SPEECH, true), 'chair');

// It is heard directly rather than inferred, and only while it is still current.
const liveChair = (t) => H.resolveLiveFloor(t, roster, {});
check('the chair putting the question',
  liveChair('THE GENTLEMAN FROM FLORIDA IS RECOGNIZED. THE QUESTION IS, WILL THE HOUSE SUSPEND THE RULES?').basis, 'chair');
check('and who is presiding',
  liveChair('THE GENTLEMAN FROM FLORIDA IS RECOGNIZED. THE QUESTION IS, WILL THE HOUSE SUSPEND THE RULES?').presiding, 'speaker');
// A member resuming after "without objection" gets the floor back with no
// recognition at all, which is what put the seal over 114 turns of members.
check('a member resuming is not the chair',
  liveChair('THE GENTLEMAN FROM ARKANSAS, MR. WESTERMAN, IS RECOGNIZED. WITHOUT OBJECTION, SO ORDERED. MR. SPEAKER, I RISE IN SUPPORT OF THIS BILL.').member.last, 'Westerman');
// And the chair goes stale within the same breath: short utterances, and the
// floor moves on without saying so.
check('a chair phrase left behind is not the chair now',
  liveChair('THE GENTLEMAN FROM FLORIDA IS RECOGNIZED. THE GENTLEMAN RESERVES. ' + 'AND SO THE PROVISION WOULD TAKE EFFECT IN THE FOLLOWING FISCAL YEAR UNDER THE TERMS SET OUT IN TITLE TWO.').basis !== 'chair', true);

// ── The manager slot gets a wider budget ────────────────────────────────────
//
// Live on 2026-09-16 the chair said "MR. COBURN" for Mr. Comer. Three edits is
// past the ordinary cap, so Kentucky never bound, and every turn on that side of
// the bill came back as an unidentified Kentuckian for the rest of the measure.
// This one slot is worth more than the ordinary budget: one person, a known
// state, a fixed sentence, spoken slowly, and a miss is expensive.
check('COBURN in the manager slot is Comer',
  (H.matchManagerName('COBURN', 'KENTUCKY', roster, 'M') || {}).member.last, 'COMER');
check('and says the budget it used', H.matchManagerName('COBURN', 'KENTUCKY', roster, 'M').scope, 'manager-slot');
check('an exact name never needs it', H.matchManagerName('COMER', 'KENTUCKY', roster, 'M').scope, 'state');

// What keeps it honest. Rogers and Barr sit 4 edits from COBURN, inside the
// widened cap — it is the first letter that rules them out, and that survives
// seven of the eight real garbles on record here. Without it this slot would be
// picking between three Kentuckians on a one-edit margin.
check('the near misses lose on their first letter',
  ['ROGERS', 'BARR'].includes(H.matchManagerName('COBURN', 'KENTUCKY', roster, 'M').member.last), false);
check('a first letter matching nobody resolves to nobody',
  H.matchManagerName('XOBURN', 'KENTUCKY', roster, 'M'), null);
check('a disagreeing honorific still rules it out', H.matchManagerName('COBURN', 'KENTUCKY', roster, 'F'), null);
check('and nonsense resolves to nobody', H.matchManagerName('ZZZZZZ', 'KENTUCKY', roster, 'M'), null);
// The wide budget is for this slot only — an ordinary mention stays strict.
check('the ordinary budget is unchanged', H.matchSurname('COBURN', 'KENTUCKY', roster, 'M'), null);

// End to end: the seat binds and the side of the bill stops being anonymous.
const garbledManager = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM KENTUCKY, MR. COBURN, AND THE GENTLEMAN FROM VIRGINIA, MR. SUBRAMANYAM, EACH WILL CONTROL 20 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM KENTUCKY IS RECOGNIZED.' },
  { t: 2, text: 'MR. SPEAKER, I RISE IN SUPPORT OF THIS BILL AND I YIELD MYSELF SUCH TIME AS I MAY CONSUME.' },
], roster);
check('the garbled manager holds their seat',
  garbledManager.timeline.find((x) => Math.floor(x.t) === 2).member.last, 'Comer');

// ── Surnames of more than one word ──────────────────────────────────────────
//
// Ten members have one. The capture stopped at the first token, so the chair
// naming "THE GENTLEMAN FROM TENNESSEE, MR. VAN EPPS" as a floor manager yielded
// "VAN", which matches nobody — and because it was a MANAGER, the seat never
// bound and 40 consecutive turns of that bill reported an unidentified
// Tennessean. One name, 11% of that day's floor speech, and the chair had spelled
// it perfectly.
const SP2 = H.buildPatterns(roster);
check('the control formula takes the whole surname',
  SP2.control.exec('PURSUANT TO THE RULE. THE GENTLEMAN FROM TENNESSEE, MR. VAN EPPS, AND THE GENTLEMAN FROM RHODE ISLAND, MR. MAGAZINER, EACH WILL CONTROL 20 MINUTES.')[2],
  'VAN EPPS');
check('and matches the member', (H.matchSurname('VAN EPPS', 'TENNESSEE', roster) || {}).member.last, 'VAN EPPS');
check('a three-word surname too', (H.matchSurname('DE LA CRUZ', 'TEXAS', roster) || {}).member.last, 'DE LA CRUZ');
check('and one that is two full names', (H.matchSurname('WASSERMAN SCHULTZ', 'FLORIDA', roster) || {}).member.last, 'WASSERMAN SCHULTZ');
check('single-word surnames are untouched', (H.matchSurname('MAGAZINER', 'RHODE ISLAND', roster) || {}).member.last, 'MAGAZINER');

// The reason this is an exact list from the roster rather than "two capitalised
// words": a loose capture reads the sentence carrying on as part of the name, and
// the fuzzy matcher downstream will find somebody for anything.
SP2.bind.lastIndex = 0;
const loose = SP2.bind.exec('THE GENTLEMAN FROM FLORIDA, MR. MAST AND THE GENTLEMAN FROM TEXAS IS RECOGNIZED.');
check('a following word is not swallowed into the surname', loose[3], 'MAST');

// End to end: the manager binds, and the turns of that bill are his.
const multiWordManager = H.resolveFloorSpeakers([
  { t: 0, text: 'PURSUANT TO THE RULE, THE GENTLEMAN FROM TENNESSEE, MR. VAN EPPS, AND THE GENTLEMAN FROM RHODE ISLAND, MR. MAGAZINER, EACH WILL CONTROL 20 MINUTES.' },
  { t: 1, text: 'THE GENTLEMAN FROM TENNESSEE IS RECOGNIZED.' },
  { t: 2, text: 'THANK YOU, MR. SPEAKER. I YIELD MYSELF SUCH TIME AS I MAY CONSUME.' },
], roster);
check('the multi-word manager holds his seat',
  multiWordManager.timeline.find((x) => Math.floor(x.t) === 2).member.last, 'Van Epps');

// ── Degenerate input ────────────────────────────────────────────────────────
for (const junk of ['', null, undefined, 'WEBVTT\n\n']) {
  check(`no crash on ${JSON.stringify(junk)}`, H.splitTurns(H.parseCaptionCues(junk)).length, 0);
}
check('empty roster resolves to nothing',
  H.resolveFloorSpeakers(H.splitTurns(H.parseCaptionCues(read('captions-suspension.vtt'))), []).timeline
    .filter((x) => x.member).length, 0);

console.log(failed ? `\n${failed} failed` : `\nall floor-speaker assertions pass`);
process.exit(failed ? 1 : 0);
