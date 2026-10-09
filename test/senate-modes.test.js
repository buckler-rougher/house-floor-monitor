#!/usr/bin/env node
//
// Contract test for lib/senate-modes.js -- the Senate's prayer, pledge, morning business and
// leader-recognized modes, read off rolling captions. The wordings come from the
// Congressional Record (the Senate's own transcript), NOT from the caption track, which has
// never been captured; what is pinned here is that wording plus the behaviour around it:
// start, hold, end, ceiling, the cooldown that stops a phrase still in the caption window
// from restarting a finished mode, and the leader overlay falling back to what it covered.

const assert = require('assert');
const M = require('../lib/senate-modes.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const S = 1000, MIN = 60 * S;
const mode = (s, t) => { const c = M.current(s, t); return c && c.mode; };

ok('nothing heard is no mode', () => {
  assert.strictEqual(M.current(M.empty(), 0), null);
  assert.strictEqual(M.current(M.feed(M.empty(), 'THE SENATOR FROM OHIO HAS THE FLOOR.', 0), 0), null);
});

ok('the prayer starts on the chair, holds, and ends on amen', () => {
  let s = M.feed(M.empty(), 'THE CHAPLAIN, DR. SOMEONE, OFFERED THE FOLLOWING PRAYER:', 0);
  assert.strictEqual(mode(s, 1 * S), 'prayer');
  s = M.feed(s, 'LET US PRAY. ETERNAL GOD ...', 5 * S);
  assert.strictEqual(mode(s, 60 * S), 'prayer');
  s = M.feed(s, 'IN YOUR NAME WE PRAY. AMEN.', 120 * S);
  assert.strictEqual(mode(s, 125 * S), 'prayer', 'held for a moment after amen');
  assert.strictEqual(mode(s, 131 * S), null);
});

ok('the Chaplain line as the Congressional Record prints it (24 September 2026)', () => {
  // Verbatim from CREC-2026-09-24 PRAYER. Dr. and C. carry periods, which an earlier
  // pattern stopped at.
  const s = M.feed(M.empty(), 'The Chaplain, Dr. Barry C. Black, offered the following prayer:', 0);
  assert.strictEqual(mode(s, 1 * S), 'prayer');
  assert.strictEqual(mode(M.feed(M.empty(), 'The Chaplain, Dr. Barry C. Black, ', 0), 1 * S), null, 'a name alone is not an offering');
});

ok('the pledge text is the pledge', () => {
  let s = M.feed(M.empty(), 'I PLEDGE ALLEGIANCE TO THE FLAG OF THE UNITED STATES', 0);
  assert.strictEqual(mode(s, 2 * S), 'pledge');
  s = M.feed(s, 'ONE NATION UNDER GOD, INDIVISIBLE, WITH LIBERTY AND JUSTICE FOR ALL.', 20 * S);
  assert.strictEqual(mode(s, 25 * S), 'pledge');
  assert.strictEqual(mode(s, 31 * S), null);
});

ok('the pledge takes over from a prayer that has not ended', () => {
  let s = M.feed(M.empty(), 'LET US PRAY.', 0);
  s = M.feed(s, 'I PLEDGE ALLEGIANCE TO THE FLAG', 60 * S);
  assert.strictEqual(mode(s, 61 * S), 'pledge');
});

ok('a missed closing phrase cannot strand the board', () => {
  const p = M.feed(M.empty(), 'LET US PRAY.', 0);
  assert.strictEqual(mode(p, 6 * MIN - 1), 'prayer');
  assert.strictEqual(mode(p, 6 * MIN), null);
  const g = M.feed(M.empty(), 'I PLEDGE ALLEGIANCE', 0);
  assert.strictEqual(mode(g, 91 * S), null);
});

ok('the same words still rolling past do not restart a finished mode', () => {
  let s = M.feed(M.empty(), 'I PLEDGE ALLEGIANCE TO THE FLAG ... JUSTICE FOR ALL.', 0);
  s = M.feed(s, 'I PLEDGE ALLEGIANCE TO THE FLAG ... JUSTICE FOR ALL.', 1 * S);
  assert.strictEqual(mode(s, 20 * S), null);
  s = M.settle(s, 20 * S);
  assert.strictEqual(s.base, null);
  s = M.feed(s, 'I PLEDGE ALLEGIANCE TO THE FLAG ... JUSTICE FOR ALL.', 30 * S);
  assert.strictEqual(mode(s, 31 * S), null, 'inside the cooldown');
  s = M.feed(s, 'I PLEDGE ALLEGIANCE TO THE FLAG', 10 * MIN);
  assert.strictEqual(mode(s, 10 * MIN + 1), 'pledge', 'a real pledge the next day starts');
});

ok('amen in the middle of a speech is not a prayer ending', () => {
  const s = M.feed(M.empty(), 'AMEN, SAID THE SENATOR FROM TEXAS.', 0);
  assert.strictEqual(mode(s, 1 * S), null);
});

// ---- morning business ----------------------------------------------------------------

ok('morning business, in the chair\'s words from the Record, with the limit it states', () => {
  // CREC 2026-09-29, 2026-09-30 (the chair, under the previous order) and 2026-09-24 (by
  // unanimous consent).
  let s = M.feed(M.empty(), 'Under the previous order, the Senate will be in a period of morning business, with Senators permitted to speak therein for up to 10 minutes each.', 0);
  assert.deepStrictEqual(M.current(s, 1 * S), { mode: 'morning-business', since: 0, limit: 10 });
  const u = M.feed(M.empty(), 'I ask unanimous consent that the Senate be in a period of morning business, with Senators permitted to speak therein for up to 10 minutes each.', 0);
  assert.strictEqual(mode(u, 1 * S), 'morning-business');
});

ok('a motion to proceed ends morning business too: the real 30 September captions never said "morning business is closed"', () => {
  // The wording is C-SPAN2's, lower case and without labels (the Senate's own caption format is still to be captured); the
  // words are the chair's and the leader's, so the match does not depend on it.
  let s = M.feed(M.empty(), 'under the previous order, the leadership time is reserved. under the previous order, the senate will be in a period of morning business, with senators permitted to speak therein for up to ten minutes each.', 0);
  assert.strictEqual(mode(s, 1 * S), 'morning-business');
  s = M.feed(s, "mr. president. the majority leader. mr. president, i move to proceed to calendar number six, 84, hr 9340. the clerk will report.", 5 * MIN);
  assert.strictEqual(mode(s, 5 * MIN + 10 * S), null, 'closed once the motion is made');
  // the same words still rolling in the window cannot reopen it
  s = M.feed(s, 'the clerk will report. motion to proceed to calendar 684. hr 9340.', 5 * MIN + 12 * S);
  assert.strictEqual(mode(s, 5 * MIN + 20 * S), null);
});

ok('morning business lasts until the chair closes it, however long that is', () => {
  let s = M.feed(M.empty(), 'THE SENATE WILL BE IN A PERIOD OF MORNING BUSINESS, FOR UP TO 5 MINUTES EACH', 0);
  assert.strictEqual(mode(s, 3 * 60 * MIN), 'morning-business', 'three hours in and still open');
  s = M.feed(s, 'THE PRESIDING OFFICER. MORNING BUSINESS IS CLOSED.', 3 * 60 * MIN + 1);
  assert.strictEqual(mode(s, 3 * 60 * MIN + 2 * S), 'morning-business', 'a short hold');
  assert.strictEqual(mode(s, 3 * 60 * MIN + 10 * S), null);
});

ok('a request for morning business is not morning business closing, and the closing line does not reopen it', () => {
  let s = M.feed(M.empty(), 'THE SENATE BE IN A PERIOD OF MORNING BUSINESS', 0);
  s = M.feed(s, 'MORNING BUSINESS IS CLOSED. THE SENATE WILL BE IN A PERIOD OF MORNING BUSINESS', 1 * S);
  assert.strictEqual(mode(s, 20 * S), null, 'the opening still rolling in the window after it closed');
});

ok('the wrap-up asking for morning business to be closed tomorrow does not open it', () => {
  // Verbatim from CREC 2026-09-30 ORDERS FOR ...: "morning business be closed".
  const s = M.feed(M.empty(), 'the time for the two leaders be reserved for their use later in the day, morning business be closed, and the Senate resume consideration', 0);
  assert.strictEqual(mode(s, 1 * S), null);
});

// ---- leader remarks ------------------------------------------------------------------
// The daily remarks, not any leader speaking: each leader's first recognition after the day's
// opening, once a day. `opened()` is a day that has had its pledge.

const opened = () => M.feed(M.empty(), 'I PLEDGE ALLEGIANCE TO THE FLAG', 0);
const afterOpening = 5 * MIN;

ok('the chair recognizes the majority leader and the Democratic leader (Record, 30 September)', () => {
  let s = M.feed(opened(), 'The majority leader is recognized.', afterOpening);
  assert.deepStrictEqual(M.current(s, afterOpening + S), { mode: 'leader', which: 'Majority Leader', since: afterOpening, first: null });
  s = M.feed(opened(), 'The Democratic leader is recognized.', afterOpening);
  assert.strictEqual(M.current(s, afterOpening + S).which, 'Democratic Leader');
  s = M.feed(opened(), 'THE MINORITY LEADER IS RECOGNIZED', afterOpening);
  assert.strictEqual(M.current(s, afterOpening + S).which, 'Democratic Leader', 'minority is the same office');
});

ok('a leader recognized before the day opened is not the daily remarks', () => {
  // A cold start mid-day, or a unanimous-consent request with no opening seen: no guess.
  const s = M.feed(M.empty(), 'The majority leader is recognized.', 0);
  assert.strictEqual(M.current(s, 1 * S), null);
});

ok('each leader has the daily remarks once; later recognitions are ordinary speech', () => {
  let s = M.feed(opened(), 'The majority leader is recognized.', afterOpening);
  s = M.speaker(s, 'THUNE', afterOpening + 2 * S);
  s = M.speaker(s, 'DURBIN', afterOpening + 600 * S);
  assert.strictEqual(mode(s, afterOpening + 601 * S), null, 'finished');
  s = M.feed(s, 'The majority leader is recognized.', 3 * 60 * MIN);
  assert.strictEqual(mode(s, 3 * 60 * MIN + S), null, 'recognized again mid-afternoon for a consent request: no mode');
  s = M.feed(s, 'The Democratic leader is recognized.', 3 * 60 * MIN + 10 * S);
  assert.strictEqual(M.current(s, 3 * 60 * MIN + 11 * S).which, 'Democratic Leader', 'the other leader has not had theirs');
});

ok('a leader sits over morning business and gives it back', () => {
  let s = M.feed(opened(), 'THE SENATE WILL BE IN A PERIOD OF MORNING BUSINESS, FOR UP TO 10 MINUTES EACH', 60 * S);
  s = M.feed(s, 'THE MAJORITY LEADER IS RECOGNIZED.', 120 * S);
  assert.strictEqual(mode(s, 121 * S), 'leader');
  s = M.speaker(s, 'THUNE', 122 * S);
  s = M.speaker(s, 'THUNE', 150 * S);
  assert.strictEqual(mode(s, 151 * S), 'leader', 'still the same speaker');
  s = M.feed(s, 'THE SENATOR FROM IOWA IS RECOGNIZED.', 400 * S);
  assert.strictEqual(mode(s, 401 * S), 'morning-business');
});

ok('a different member speaking ends the leader', () => {
  let s = M.feed(opened(), 'THE DEMOCRATIC LEADER IS RECOGNIZED.', afterOpening);
  s = M.speaker(s, 'SCHUMER', afterOpening + 2 * S);
  assert.strictEqual(mode(s, afterOpening + 3 * S), 'leader');
  s = M.speaker(s, 'DURBIN', afterOpening + 400 * S);
  assert.strictEqual(mode(s, afterOpening + 401 * S), null);
});

ok('a leader whose label never changes is not mistaken for the next speaker', () => {
  // The leader was already the latched speaker, so no label arrives at the recognition; the
  // first label to change, a minute or more later, is somebody else's.
  let s = M.feed(opened(), 'THE MAJORITY LEADER IS RECOGNIZED.', afterOpening);
  s = M.speaker(s, 'CORNYN', afterOpening + 90 * S);
  assert.strictEqual(M.current(s, afterOpening + 91 * S).first, null, 'not knowable, not guessed');
  assert.strictEqual(mode(s, afterOpening + 91 * S), 'leader', 'and not ended by it either');
  s = M.speaker(s, 'DURBIN', afterOpening + 200 * S);
  assert.strictEqual(mode(s, afterOpening + 201 * S), 'leader', 'only a recognition or the ceiling ends it now');
});

ok('a recognition of someone else ends it, and the leader line still in the window does not restart it', () => {
  let s = M.feed(opened(), 'THE MAJORITY LEADER IS RECOGNIZED.', afterOpening);
  s = M.feed(s, 'THE MAJORITY LEADER IS RECOGNIZED. ... THE SENATOR FROM TEXAS IS RECOGNIZED.', afterOpening + 200 * S);
  assert.strictEqual(mode(s, afterOpening + 201 * S), null, 'the later recognition wins within one cue');
  s = M.feed(s, 'THE MAJORITY LEADER IS RECOGNIZED. ... THE SENATOR FROM TEXAS IS RECOGNIZED.', afterOpening + 205 * S);
  assert.strictEqual(mode(s, afterOpening + 206 * S), null);
});

ok('the second leader follows the first', () => {
  let s = M.feed(opened(), 'THE MAJORITY LEADER IS RECOGNIZED.', afterOpening);
  s = M.feed(s, 'THE DEMOCRATIC LEADER IS RECOGNIZED.', afterOpening + 600 * S);
  assert.strictEqual(M.current(s, afterOpening + 601 * S).which, 'Democratic Leader');
});

ok('a leader nobody ends cannot strand the board', () => {
  const s = M.feed(opened(), 'THE MAJORITY LEADER IS RECOGNIZED.', afterOpening);
  assert.strictEqual(mode(s, afterOpening + 30 * MIN - 1), 'leader');
  assert.strictEqual(mode(s, afterOpening + 30 * MIN), null);
});

// ---- wrap-up -------------------------------------------------------------------------

ok('the wrap-up opens on the majority leader\'s request, in the Record\'s words', () => {
  // CREC 2026-09-30 ORDERS FOR ...: opens the same way on every full day sampled.
  let s = M.feed(M.empty(), 'Mr. THUNE. Mr. President, I ask unanimous consent that when the Senate completes its business today, it stand adjourned, to then convene for pro forma session only', 0);
  assert.strictEqual(mode(s, 1 * S), 'wrap-up');
  assert.strictEqual(mode(M.feed(M.empty(), 'I ask unanimous consent that when the Senate adjourns on Thursday, September 10', 0), 1 * S), 'wrap-up');
});

ok('the wrap-up lasts until the Senate is adjourned, which can follow the Democratic leader', () => {
  let s = M.feed(opened(), 'I ask unanimous consent that when the Senate completes its business today, it stand adjourned', 60 * MIN);
  s = M.feed(s, 'if there is no further business, I ask that it stand adjourned under the previous order following the remarks of the Democratic leader.', 61 * MIN);
  assert.strictEqual(mode(s, 75 * MIN), 'wrap-up', 'still going through the closing remarks');
  s = M.feed(s, 'Under the previous order, the Senate stands adjourned until 10:30 a.m. tomorrow.', 80 * MIN);
  assert.strictEqual(mode(s, 80 * MIN + 5 * S), 'wrap-up', 'a short hold');
  assert.strictEqual(mode(s, 80 * MIN + 21 * S), null);
});

ok('an ordinary unanimous-consent request is not the wrap-up', () => {
  const s = M.feed(M.empty(), 'I ask unanimous consent that the Senate be in a period of morning business', 0);
  assert.notStrictEqual(mode(s, 1 * S), 'wrap-up');
  assert.strictEqual(mode(M.feed(M.empty(), 'I ask unanimous consent that the committee be discharged', 0), 1 * S), null);
});

console.log(`\n${n} passed`);
