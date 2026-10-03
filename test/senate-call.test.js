#!/usr/bin/env node
//
// Contract test for lib/senate-call.js -- telling a quorum call from a roll call
// vote, and one call from the next, using only caption text.
//
// WHY THIS EXISTS
// The two events read identically (the clerk goes down the alphabet), and the
// board used to treat them as one. Each case below is a shape that was reported
// or observed live; the cue text follows the stenographer's, not good English.
// No network, no dependencies.
//
//   npm test

const assert = require('assert');
const C = require('../lib/senate-call.js');

const T0 = Date.UTC(2026, 8, 28, 20, 0, 0);
const MIN = 60 * 1000;
let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const run = (steps, from) => {
  let s = from || C.emptyCall();
  for (const [text, at] of steps) s = C.feed(s, text, at);
  return s;
};

test('names read start a quorum call, and light members', () => {
  const s = run([['MS. ALSOBROOKS. MR. ARMSTRONG. MS. BALDWIN.', T0]]);
  assert.strictEqual(s.kind, 'quorum');
  assert.deepStrictEqual(s.names, ['ALSOBROOKS', 'ARMSTRONG', 'BALDWIN']);
  assert.strictEqual(s.callId, T0);
});

test('the rolling window repeating a name is not a second reading', () => {
  const s = run([
    ['MS. ALSOBROOKS. MR. ARMSTRONG.', T0],
    ['MS. ALSOBROOKS. MR. ARMSTRONG. MS. BALDWIN.', T0 + 2000],
  ]);
  assert.deepStrictEqual(s.names, ['ALSOBROOKS', 'ARMSTRONG', 'BALDWIN']);
  assert.strictEqual(s.callId, T0);
});

test('MR. PRESIDENT is not a senator', () => {
  const s = run([['MR. PRESIDENT. MS. BALDWIN.', T0]]);
  assert.deepStrictEqual(s.names, ['BALDWIN']);
});

test('accents are folded', () => {
  const s = run([['MR. LUJAN.', T0]]);
  assert.deepStrictEqual(s.names, ['LUJAN']);
  assert.strictEqual(C.fold('Luján'), 'LUJAN');
});

test('a recorded answer turns the call into a vote and drops the names', () => {
  const s = run([
    ['MS. ALSOBROOKS. MR. ARMSTRONG. MS. BALDWIN.', T0],
    ['MS. DUCKWORTH, AYE.', T0 + 5000],
  ]);
  assert.strictEqual(s.kind, 'vote');
  assert.deepStrictEqual(s.names, []);
  assert.deepStrictEqual(s.votes, { DUCKWORTH: 'AYE' });
  assert.strictEqual(s.callId, T0, 'same call, so the same id');
});

test('during a vote the roll read lights nothing', () => {
  const s = run([
    ['MS. DUCKWORTH, AYE.', T0],
    ['MR. DURBIN. MS. ERNST.', T0 + 1000],
  ]);
  assert.deepStrictEqual(s.names, []);
  assert.deepStrictEqual(Object.keys(s.votes), ['DUCKWORTH']);
});

test('the heading carries the vote for bare names', () => {
  const s = run([['SENATORS VOTING IN THE NEGATIVE: MR. PAUL. MR. LEE. SENATORS VOTING AYE: MS. COLLINS.', T0]]);
  assert.deepStrictEqual(s.votes, { PAUL: 'NO', LEE: 'NO', COLLINS: 'AYE' });
  assert.strictEqual(s.kind, 'vote');
  assert.deepStrictEqual(s.names, []);
});

test('"No Senator voted in the negative" is a running tally, not a heading', () => {
  const s = run([['MS. DUCKWORTH, AYE. NO SENATOR VOTED IN THE NEGATIVE: MR. LEE.', T0]]);
  assert.deepStrictEqual(s.votes, { DUCKWORTH: 'AYE' });
});

test('inline NAY is recorded as NO', () => {
  const s = run([['MR. PAUL, NAY. MR. KING, PRESENT.', T0]]);
  assert.deepStrictEqual(s.votes, { PAUL: 'NO', KING: 'PRESENT' });
});

test('the tally closes a vote and carries the outcome', () => {
  const s = run([
    ['MS. DUCKWORTH, AYE.', T0],
    ['THE YEAS ARE 74, THE NAYS ARE 25. THE MOTION IS AGREED TO.', T0 + 9000],
  ]);
  assert.strictEqual(s.ended.how, 'closed');
  assert.strictEqual(s.ended.yeas, 74);
  assert.strictEqual(s.ended.nays, 25);
  assert.strictEqual(s.ended.outcome, 'AGREED TO');
});

test('NOT AGREED TO is not read as AGREED TO', () => {
  const s = run([['THE YEAS ARE 45, THE NAYS ARE 55. THE AMENDMENT IS NOT AGREED TO.', T0]]);
  assert.strictEqual(s.ended.outcome, 'NOT AGREED TO');
});

test('a tally with no answers heard still makes a closed vote', () => {
  const s = run([['THE YEAS ARE 74, THE NAYS ARE 25.', T0]]);
  assert.strictEqual(s.kind, 'vote');
  assert.strictEqual(s.ended.how, 'closed');
});

test('a tally read twice is one close', () => {
  const s = run([
    ['MS. DUCKWORTH, AYE. THE YEAS ARE 74, THE NAYS ARE 25.', T0],
    ['THE YEAS ARE 74, THE NAYS ARE 25.', T0 + 3000],
  ]);
  assert.strictEqual(s.ended.at, T0);
  assert.strictEqual(s.callId, T0);
});

test('a finished vote stays on the board until the next call begins', () => {
  const s = run([
    ['MS. DUCKWORTH, AYE. THE YEAS ARE 74, THE NAYS ARE 25.', T0],
    ['MR. DURBIN.', T0 + 10 * MIN],     // mid-alphabet: a speech, not a new call
  ]);
  assert.strictEqual(s.callId, T0);
  assert.strictEqual(s.ended.how, 'closed');
});

test('the clerk returning to the top of the alphabet starts a NEW call', () => {
  let s = run([
    ['MR. YOUNG.', T0],
    ['THE YEAS ARE 74, THE NAYS ARE 25.', T0 + 1000],
  ]);
  const first = s.callId;
  s = C.feed(s, 'MS. ALSOBROOKS. MR. ARMSTRONG.', T0 + 20 * MIN);
  assert.notStrictEqual(s.callId, first);
  assert.strictEqual(s.kind, 'quorum');
  assert.deepStrictEqual(s.names, ['ALSOBROOKS', 'ARMSTRONG']);
  assert.strictEqual(s.ended, null);
  assert.strictEqual(s.history.length, 1);
  assert.strictEqual(s.history[0].kind, 'vote', 'the closed call is remembered as the vote it turned out to be');
});

test('a second roll call starts over even if the first was never closed', () => {
  const s = run([
    ['MS. DUCKWORTH, AYE. MR. YOUNG.', T0],
    ['MS. ALSOBROOKS. MR. ARMSTRONG.', T0 + 30 * MIN],
  ]);
  assert.strictEqual(s.kind, 'quorum');
  assert.deepStrictEqual(s.votes, {});
  assert.deepStrictEqual(s.names, ['ALSOBROOKS', 'ARMSTRONG']);
});

test('adjacent names out of order are a stutter, not a new call', () => {
  const s = run([['MR. SCOTT. MR. SCHATZ.', T0]]);
  assert.strictEqual(s.callId, T0);
  assert.strictEqual(s.names.length, 2);
});

test('a vitiated quorum call ends, and keeps its names for display', () => {
  const s = run([
    ['MS. ALSOBROOKS. MR. ARMSTRONG.', T0],
    ['I ASK UNANIMOUS CONSENT THAT THE ORDER FOR THE QUORUM CALL BE RESCINDED.', T0 + 4000],
  ]);
  assert.strictEqual(s.ended.how, 'vitiated');
  assert.deepStrictEqual(s.names, ['ALSOBROOKS', 'ARMSTRONG']);
});

test('the call vitiated, words the other way round', () => {
  const s = run([
    ['MR. ARMSTRONG.', T0],
    ['THE VITIATION OF THE QUORUM CALL.', T0 + 1000],
  ]);
  assert.strictEqual(s.ended.how, 'vitiated');
});

test('vitiation does not end a vote', () => {
  const s = run([
    ['MS. DUCKWORTH, AYE.', T0],
    ['THE QUORUM CALL BE VITIATED.', T0 + 1000],
  ]);
  assert.strictEqual(s.ended, null);
});

test('trailing names after a vitiation do not open a phantom call', () => {
  const s = run([
    ['MS. ALSOBROOKS. MR. ARMSTRONG.', T0],
    ['THE QUORUM CALL BE VITIATED.', T0 + 4000],
    ['MS. ALSOBROOKS. MR. ARMSTRONG. THE QUORUM CALL BE VITIATED.', T0 + 6000],
  ]);
  assert.strictEqual(s.callId, T0);
  assert.strictEqual(s.ended.how, 'vitiated');
});

test('a quorum call after a vitiated one is a new call', () => {
  const s = run([
    ['MS. ALSOBROOKS. MR. ARMSTRONG.', T0],
    ['THE QUORUM CALL BE VITIATED.', T0 + 4000],
    ['MS. ALSOBROOKS.', T0 + 30 * MIN],
  ]);
  assert.strictEqual(s.callId, T0 + 30 * MIN);
  assert.strictEqual(s.ended, null);
  assert.deepStrictEqual(s.names, ['ALSOBROOKS']);
});

test('a vote after the tally is a new vote', () => {
  const s = run([
    ['MS. DUCKWORTH, AYE. THE YEAS ARE 74, THE NAYS ARE 25.', T0],
    ['MS. DUCKWORTH, AYE. MR. PAUL, NAY.', T0 + 30 * MIN],
  ]);
  assert.strictEqual(s.callId, T0 + 30 * MIN);
  assert.deepStrictEqual(s.votes, { DUCKWORTH: 'AYE', PAUL: 'NO' });
  assert.strictEqual(s.ended, null);
});

test('re-reading a recorded vote after the tally changes nothing', () => {
  const s = run([
    ['MS. DUCKWORTH, AYE. THE YEAS ARE 74, THE NAYS ARE 25.', T0],
    ['MS. DUCKWORTH, AYE.', T0 + 4000],
  ]);
  assert.strictEqual(s.callId, T0);
});

test('feed does not mutate its input', () => {
  const a = run([['MS. ALSOBROOKS.', T0]]);
  const frozen = JSON.stringify(a);
  C.feed(a, 'MR. ARMSTRONG. MS. DUCKWORTH, AYE.', T0 + 1000);
  assert.strictEqual(JSON.stringify(a), frozen);
});

test('a silent hour ends a call whose ending was never heard', () => {
  const s = run([['MS. ALSOBROOKS.', T0]]);
  assert.strictEqual(C.expire(s, T0 + 30 * MIN).callId, T0);
  assert.strictEqual(C.expire(s, T0 + 46 * MIN).callId, null);
});

test('merge: the newer call wins', () => {
  const old = run([['MS. DUCKWORTH, AYE.', T0]]);
  const next = run([['MS. ALSOBROOKS.', T0 + 20 * MIN]]);
  assert.strictEqual(C.merge(old, next).callId, next.callId);
  assert.strictEqual(C.merge(next, old).callId, next.callId);
});

test('merge: the same call takes everything either reader saw', () => {
  const tab = run([['MS. ALSOBROOKS. MR. ARMSTRONG.', T0 + 4000]]);
  const worker = run([['MS. ALSOBROOKS. MR. ARMSTRONG. MS. BALDWIN.', T0]]);
  const m = C.merge(tab, worker);
  assert.strictEqual(m.callId, T0);
  assert.deepStrictEqual([...m.names].sort(), ['ALSOBROOKS', 'ARMSTRONG', 'BALDWIN']);
});

test('merge: one reader heard the first answer, so it is a vote', () => {
  const tab = run([['MS. ALSOBROOKS.', T0]]);
  const worker = run([['MS. ALSOBROOKS. MS. DUCKWORTH, AYE.', T0 + 1000]]);
  const m = C.merge(tab, worker);
  assert.strictEqual(m.kind, 'vote');
  assert.deepStrictEqual(m.names, []);
});

test('merge: a mid-vote joiner picks up the close the Worker heard', () => {
  const tab = run([['MS. DUCKWORTH, AYE.', T0 + 2000]]);
  const worker = run([['MS. DUCKWORTH, AYE. THE YEAS ARE 74, THE NAYS ARE 25.', T0]]);
  assert.strictEqual(C.merge(tab, worker).ended.yeas, 74);
});

test('merge: empty on either side is the other', () => {
  const s = run([['MS. ALSOBROOKS.', T0]]);
  assert.strictEqual(C.merge(C.emptyCall(), s).callId, T0);
  assert.strictEqual(C.merge(s, C.emptyCall()).callId, T0);
  assert.strictEqual(C.merge(s, null).callId, T0);
});

test('summarize counts what the board shows', () => {
  const q = C.summarize(run([['MS. ALSOBROOKS. MR. ARMSTRONG.', T0]]));
  assert.strictEqual(q.kind, 'quorum');
  assert.strictEqual(q.count, 2);
  assert.strictEqual(q.quorumMet, false);
  const v = C.summarize(run([['MS. DUCKWORTH, AYE. MR. PAUL, NAY.', T0]]));
  assert.deepStrictEqual([v.kind, v.count, v.ayes, v.nos], ['vote', 2, 1, 1]);
});

test('a member taking the floor is latched as the speaker', () => {
  const s = run([['MS. CANTWELL: THANK YOU. I RISE TODAY', T0]]);
  assert.deepStrictEqual(s.speaker, { label: 'CANTWELL', kind: 'member', at: T0 });
});

test('the speaker holds until the next label, and a repeat is not a change', () => {
  const s = run([
    ['MS. CANTWELL: I RISE TODAY', T0],
    ['I RISE TODAY TO TALK ABOUT', T0 + 5000],
    ['MS. CANTWELL: I RISE TODAY', T0 + 9000],
  ]);
  assert.strictEqual(s.speaker.label, 'CANTWELL');
  assert.strictEqual(s.speaker.at, T0);
});

test('a handoff inside one cue takes the last label', () => {
  const s = run([['MS. CANTWELL: I YIELD. MR. LEE: I THANK THE SENATOR', T0]]);
  assert.strictEqual(s.speaker.label, 'LEE');
});

test('the chair and the clerk are offices, not members', () => {
  const s = run([['THE PRESIDING OFFICER: WITHOUT OBJECTION', T0]]);
  assert.strictEqual(s.speaker.kind, 'office');
  assert.strictEqual(s.speaker.label, 'THE PRESIDING OFFICER');
});

test('MR. PRESIDENT: is a form of address and does not take the floor', () => {
  const s = run([['MS. CANTWELL: MR. PRESIDENT: I RISE', T0]]);
  assert.strictEqual(s.speaker.label, 'CANTWELL');
});

test('a name being read is not a speaker', () => {
  const s = run([['MS. ALSOBROOKS. MR. ARMSTRONG.', T0]]);
  assert.strictEqual(s.speaker, null);
});

test('the speaker survives a call ending and the idle expiry', () => {
  let s = run([['MS. ALSOBROOKS.', T0], ['MS. CANTWELL: I RISE', T0 + 1000]]);
  s = C.expire(s, T0 + 60 * MIN);
  assert.strictEqual(s.callId, null);
  assert.strictEqual(s.speaker.label, 'CANTWELL');
});

test('merge: the later label wins, whichever reader heard it', () => {
  const tab = run([['MS. CANTWELL: I RISE', T0 + 8000]]);
  const worker = run([['MR. LEE: I RISE', T0]]);
  assert.strictEqual(C.merge(tab, worker).speaker.label, 'CANTWELL');
  assert.strictEqual(C.merge(worker, tab).speaker.label, 'CANTWELL');
});

test('merge: a speaker comes through even when the other side has no call', () => {
  const worker = run([['MS. CANTWELL: I RISE', T0]]);
  const tab = C.emptyCall();
  assert.strictEqual(C.merge(tab, worker).speaker.label, 'CANTWELL');
});

test('the chair recognising by state before the label names the state', () => {
  const s = run([['THE PRESIDING OFFICER: THE SENATOR FROM FLORIDA. MR. SCOTT: THANK YOU', T0]]);
  assert.strictEqual(s.speaker.label, 'SCOTT');
  assert.strictEqual(s.speaker.state, 'FL');
});

test('a recognition in an earlier cue still names the state', () => {
  const s = run([
    ['THE SENATOR FROM SOUTH CAROLINA IS RECOGNIZED.', T0],
    ['MR. SCOTT: I RISE', T0 + 4000],
  ]);
  assert.strictEqual(s.speaker.state, 'SC');
});

test('a state named a minute ago does not name this speaker', () => {
  const s = run([
    ['THE SENATOR FROM SOUTH CAROLINA IS RECOGNIZED.', T0],
    ['MR. SCOTT: I RISE', T0 + 60 * 1000],
  ]);
  assert.strictEqual(s.speaker.state, undefined);
});

test('one recognition names one speaker, not the next Scott as well', () => {
  const s = run([
    ['THE SENATOR FROM FLORIDA. MR. SCOTT: I RISE', T0],
    ['MR. LEE: I THANK THE SENATOR', T0 + 5000],
    ['MR. SCOTT: I RISE AGAIN', T0 + 10000],
  ]);
  assert.strictEqual(s.speaker.label, 'SCOTT');
  assert.strictEqual(s.speaker.state, undefined, 'the Florida recognition was spent on the first label');
});

test('no state said, none claimed', () => {
  const s = run([['MR. SCOTT: I RISE', T0]]);
  assert.strictEqual(s.speaker.state, undefined);
});

test('a two-word state is matched whole', () => {
  const s = run([['THE SENATOR FROM WEST VIRGINIA. MR. JUSTICE: I RISE', T0]]);
  assert.strictEqual(s.speaker.state, 'WV');
});

test('the question stated before the roll attaches to the vote', () => {
  const s = run([
    ['THE QUESTION IS ON AGREEING TO THE MOTION TO PROCEED TO CALENDAR NO. 213, S. 1234. THE YEAS AND NAYS ARE ORDERED. THE CLERK WILL CALL THE ROLL.', T0],
    ['MS. ALSOBROOKS. MR. ARMSTRONG.', T0 + 4000],
    ['MS. DUCKWORTH, AYE.', T0 + 9000],
  ]);
  assert.strictEqual(s.kind, 'vote');
  assert.strictEqual(s.question, 'ON AGREEING TO THE MOTION TO PROCEED TO CALENDAR NO. 213, S. 1234. THE YEAS AND NAYS ARE ORDERED'.replace(/\. THE YEAS.*/, ''));
});

test('a question cut off before any announcement stops at the first senator named', () => {
  const s = run([['THE QUESTION IS ON PASSAGE OF THE BILL MR. SCHUMER, AYE. MR. THUNE, NAY.', T0]]);
  assert.strictEqual(s.question, 'ON PASSAGE OF THE BILL');
  assert.deepStrictEqual(s.votes, { SCHUMER: 'AYE', THUNE: 'NO' });
});

test('a quorum call has no question, even with one waiting', () => {
  const s = run([
    ['THE QUESTION IS ON THE MOTION TO ADJOURN. THE CLERK WILL CALL THE ROLL.', T0],
    ['MS. ALSOBROOKS. MR. ARMSTRONG.', T0 + 4000],
  ]);
  assert.strictEqual(s.kind, 'quorum');
  assert.strictEqual(s.question, null);
});

test('a question cut off by the window is extended when more arrives', () => {
  const s = run([
    ['THE QUESTION IS ON THE MOTION TO INVOKE CLOTURE ON THE NOM', T0],
    ['MS. DUCKWORTH, AYE.', T0 + 3000],
    ['THE QUESTION IS ON THE MOTION TO INVOKE CLOTURE ON THE NOMINATION OF JANE DOE. THE CLERK WILL CALL THE ROLL.', T0 + 6000],
  ]);
  assert.strictEqual(s.question, 'ON THE MOTION TO INVOKE CLOTURE ON THE NOMINATION OF JANE DOE');
});

test('a question from half an hour ago is not claimed by a later vote', () => {
  const s = run([
    ['THE QUESTION IS ON THE MOTION TO ADJOURN. THE CLERK WILL CALL THE ROLL.', T0],
    ['MS. DUCKWORTH, AYE.', T0 + 30 * MIN],
  ]);
  assert.strictEqual(s.question, null);
});

test('a new call forgets the last call\'s question', () => {
  let s = run([
    ['THE QUESTION IS ON THE MOTION TO ADJOURN. THE CLERK WILL CALL THE ROLL.', T0],
    ['MS. DUCKWORTH, AYE. THE YEAS ARE 74, THE NAYS ARE 25.', T0 + 3000],
  ]);
  assert.ok(s.question);
  s = C.feed(s, 'MS. ALSOBROOKS. MR. ARMSTRONG.', T0 + 40 * MIN);
  assert.strictEqual(s.question, null);
});

test('merge: the longer question wins', () => {
  const a = run([['THE QUESTION IS ON THE MOTION TO INVOKE CLOTURE ON THE NOM', T0], ['MS. DUCKWORTH, AYE.', T0 + 1000]]);
  const b = run([['THE QUESTION IS ON THE MOTION TO INVOKE CLOTURE ON THE NOMINATION OF JANE DOE. THE CLERK WILL CALL', T0], ['MS. DUCKWORTH, AYE.', T0 + 1000]]);
  assert.strictEqual(C.merge(a, b).question, 'ON THE MOTION TO INVOKE CLOTURE ON THE NOMINATION OF JANE DOE');
});

console.log(`\n${n} passed`);
