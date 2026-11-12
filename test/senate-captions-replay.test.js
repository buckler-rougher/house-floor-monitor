// The Senate's own captions of 10 November 2026, replayed through the readers the Worker runs (lib/senate-call.js, lib/senate-modes.js). Segments of the day, verbatim, not the whole
// of it (test/senate-captions-2026-11-10.json); `node dev/replay-senate-captions.mjs <day folder>` replays all 2,889. What each scenario pins was wrong or unknown before the first real capture:
// the captioner's QUORUM CALL: / VOTE: labels start a call; a quorum call ends by "dispense with", "lifted" or "vitiated" as well as "rescinded"; a half-rewritten window ("MR. NOT.", "MR. MR.")
// is not a senator; the clerk's second pass is the same vote; the question is the last statement of it, not the window's first; the wrap-up survives a garbled "when".
const test = require('node:test'); const assert = require('node:assert');
const SC = require('../lib/senate-call.js'); const SM = require('../lib/senate-modes.js');
const day = require('./senate-captions-2026-11-10.json').segments;

const T0 = Date.UTC(2026, 10, 10, 13, 0, 0);
// One or more scenarios in order, the readers' state carried over (the leader's remarks need the day's opening heard first).
function run(...names) {
  let call = SC.emptyCall(), modes = SM.empty(); const seen = { modes: [], calls: [] };
  for (const name of names) {
    const { from, vtt: text } = day[name];
    text.forEach((t, i) => {
      const now = T0 + (from + i) * 12_000;
      modes = SM.feed(modes, SC.cueText(t), now); call = SC.expire(call, now); call = SC.feedVtt(call, t, now);
      if (call.speaker && call.speaker.kind === 'member') modes = SM.speaker(modes, call.speaker.label, now);
      modes = SM.settle(modes, now);
      const m = SM.current(modes, now); const sig = m ? m.mode + (m.bill ? ':' + m.bill : '') : '-';
      if (seen.modes[seen.modes.length - 1] !== sig) seen.modes.push(sig);
      if (call.callId && !seen.calls.includes(call.callId)) seen.calls.push(call.callId);
    });
  }
  return { call, modes, seen };
}

test('the prayer, the pledge, then the measure the clerk reports', () => {
  assert.deepEqual(run('opening').seen.modes.filter((x) => x !== '-'), ['prayer', 'pledge', 'debate:H.R. 2347']);
});
test('a quorum call ended by "I ask that we dispense with the quorum call"', () => {
  const { call, seen } = run('dispensed');
  assert.equal(seen.calls.length, 1); assert.equal(call.kind, 'quorum');
  assert.deepEqual([call.ended.how, call.ended.word], ['vitiated', 'dispensed']);
});
test('a quorum call ended by "I ask that the quorum call be lifted"', () => {
  const { call, seen } = run('lifted');
  assert.equal(seen.calls.length, 1); assert.equal(call.ended.word, 'lifted');
});
test('one quorum call, labelled twice, is one call, ended by "I ask it be vitiated"', () => {
  const { call, seen } = run('vitiated');
  assert.equal(seen.calls.length, 1, 'the second QUORUM CALL: label is the same call'); assert.equal(call.ended.word, 'vitiated');
});
test('"MR. NOT." in a half-rewritten window is not a senator', () => {
  const c = SC.feed(SC.emptyCall(), 'MR. NOT. MR. DURBIN: THANK YOU, MR. NOT. MR. MR. PETERS: MR. PRESIDENT.', 1);
  assert.equal(c.kind, null); assert.deepEqual(c.names, []);
});
test('the label VOTE: starts a vote, and the question is the last statement of it, with no timings in it', () => {
  const { call } = run('vote-start');
  assert.equal(call.kind, 'vote'); assert.equal(call.question, 'ON THE MOTION TO PROCEED');
  assert.doesNotMatch(call.question, /-->|\d\d:\d\d/);
});
test('the chair reads the tally and the outcome', () => {
  const { call } = run('vote-end');
  assert.deepEqual([call.ended.how, call.ended.yeas, call.ended.nays, call.ended.outcome], ['closed', 62, 21, 'ADOPTED']);
});
test('the clerk starting again at the top of the alphabet inside a vote is the same vote', () => {
  let c = SC.emptyCall(); c = SC.feed(c, 'VOTE: THE CLERK: MS. ALSOBROOKS. MR. BARRASSO. MS. CANTWELL. MR. DURBIN. MR. SCHUMER. MR. THUNE.', 1000);
  c = SC.feed(c, 'THE CLERK WILL CALL THE NAMES OF SENATORS WHO HAVE NOT VOTED. MS. ALSOBROOKS. MR. BANKS.', 200000);
  assert.equal(c.kind, 'vote'); assert.equal(c.callId, 1000);
});
test('a wrap-up with the captioner\'s "EXAMINE" for "WHEN" is still the wrap-up, ended by the adjournment', () => {
  const { seen } = run('wrap-up');
  assert.ok(seen.modes.includes('wrap-up'), seen.modes.join(','));
});
test('cueText drops the header and the timings and keeps the words', () => {
  assert.equal(SC.cueText('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:183000\n\n08:04:48.000 --> 08:04:48.692\nYOUNG.\nSENATORS VOTING IN THE NEGATIVE\n'), 'YOUNG. SENATORS VOTING IN THE NEGATIVE');
});

test('the clerk\'s recap under SENATORS VOTING IN THE AFFIRMATIVE / NEGATIVE is read, name by name, across cues', () => {
  const { call } = run('recap'); const s = SC.summarize(call);
  assert.equal(call.votes.YOUNG, 'AYE', 'the last name of the affirmative list is not counted under the negative heading that follows it');
  assert.equal(call.votes.ROUNDS, 'NO'); assert.equal(call.votes.WYDEN, 'NO'); assert.equal(call.votes.DUCKWORTH, 'NO');
  assert.deepEqual([s.ayes, s.nos], [15, 9]);
});
test('"THE DEMOCRATIC LEADER." from the chair starts the leader\'s remarks, named from the label that follows', () => {
  const { seen } = run('opening', 'leader');
  assert.ok(seen.modes.some((m) => m === 'leader'), seen.modes.join(','));
});
test('"LEADER THUNE." followed by "I CALL UP" is running the floor, not giving remarks', () => {
  const { seen } = run('opening', 'leader-business');
  assert.ok(!seen.modes.includes('leader'), seen.modes.join(','));
});
