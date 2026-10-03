#!/usr/bin/env node
//
// Contract test for lib/senate-threshold.js -- what a Senate vote needs, and whether the
// result is settled.
//
// WHY THIS EXISTS
// The House's analysis panel says PASS LOCKED and FAIL LOCKED, and a wrong lock is a wrong
// call on the result of a vote, on a board people watch for exactly that. The Senate has
// three thresholds, and nothing in a question's wording says when a consent agreement has
// raised a majority to 60. So the lib calls a result locked only when it holds under the
// strictest rule that could apply, and counts from captions are floors. These pin that.
// No network, no dependencies.
//
//   npm test

const assert = require('assert');
const T = require('../lib/senate-threshold.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const run = (ayes, nays, rule, known, extra = {}) => T.analyze({ ayes, nays, rule, known, ...extra });

test('cloture is three fifths, and that is known from the question', () => {
  const c = T.classify('IS IT THE SENSE OF THE SENATE THAT DEBATE ON THE NOMINATION OF JANE DOE SHALL BE BROUGHT TO A CLOSE');
  assert.deepStrictEqual([c.rule, c.known], ['three-fifths', true]);
  assert.strictEqual(T.classify('ON THE MOTION TO INVOKE CLOTURE ON THE BILL').rule, 'three-fifths');
});

test('a treaty or a veto override is two thirds, known', () => {
  for (const q of ['ON THE RESOLUTION OF RATIFICATION', 'SHALL THE BILL PASS, THE OBJECTIONS OF THE PRESIDENT TO THE CONTRARY NOTWITHSTANDING',
                   'ON THE TREATY', 'ON THE JOINT RESOLUTION PROPOSING A CONSTITUTIONAL AMENDMENT']) {
    const c = T.classify(q);
    assert.deepStrictEqual([c.rule, c.known], ['two-thirds', true], q);
  }
});

test('anything else is a majority, and only ASSUMED: a consent agreement can set 60', () => {
  const c = T.classify('ON PASSAGE OF THE BILL');
  assert.deepStrictEqual([c.rule, c.known], ['majority', false]);
  assert.match(c.label, /assumed/i);
});

test('no question heard is an assumed majority, said plainly', () => {
  const c = T.classify('');
  assert.deepStrictEqual([c.rule, c.known], ['majority', false]);
  assert.match(c.label, /not known/i);
});

test('cloture: 55 yeas, 40 nays, 5 unheard is in play, and one more nay would block it', () => {
  const r = run(55, 40, 'three-fifths', true);
  assert.deepStrictEqual([r.remaining, r.maxYeas, r.yeasNeeded, r.state, r.naysToBlock], [5, 60, 5, 'in-play', 1]);
});

test('cloture: 60 yeas locks it, whatever the rest do', () => {
  assert.strictEqual(run(60, 30, 'three-fifths', true).state, 'locked-pass');
  assert.strictEqual(run(60, 30, 'three-fifths', true).yeasNeeded, 0);
});

test('cloture: 55 yeas with only 4 unheard cannot reach 60', () => {
  assert.strictEqual(run(55, 41, 'three-fifths', true).state, 'locked-fail');   // 55 + 4 = 59
});

test('an assumed majority is NOT called locked on a bare majority', () => {
  // 55 yeas, 30 nays, 15 unheard: a majority is certain, but a 60-vote agreement would
  // not be. It must not say PASS LOCKED.
  const r = run(55, 30, 'majority', false);
  assert.strictEqual(r.state, 'in-play');
});

test('an assumed majority is locked to pass once it clears 60 as well', () => {
  assert.strictEqual(run(60, 10, 'majority', false).state, 'locked-pass');
});

test('a KNOWN majority could lock on a bare majority, but only if the rule were known', () => {
  assert.strictEqual(run(55, 30, 'majority', true).state, 'locked-pass');
});

test('a majority is locked to fail only when even every unheard yea falls short', () => {
  assert.strictEqual(run(30, 60, 'majority', false, { }).state, 'locked-fail');   // best case 30 + 10 = 40 < 60
  assert.strictEqual(run(30, 40, 'majority', false).state, 'in-play');             // 30 + 30 = 60 could still pass
});

test('a tied majority is in play, because the Vice President breaks a tie', () => {
  const r = run(50, 50, 'majority', false);
  assert.strictEqual(r.state, 'in-play');
  assert.strictEqual(r.remaining, 0);
});

test('two thirds: 67 to 33 carries, 66 to 34 does not', () => {
  assert.strictEqual(run(67, 33, 'two-thirds', true).state, 'locked-pass');
  assert.strictEqual(run(66, 34, 'two-thirds', true).state, 'locked-fail');
});

test('two thirds: yeas needed is twice the nays', () => {
  assert.strictEqual(run(40, 30, 'two-thirds', true).yeasNeeded, 20);   // 60 yeas to 30 nays
});

test('a majority: yeas needed is to pass the nays by one, as heard', () => {
  assert.strictEqual(run(10, 20, 'majority', false).yeasNeeded, 11);
  assert.strictEqual(run(30, 20, 'majority', false).yeasNeeded, 0);
});

test('votes remaining and max yeas follow what is counted, and never go negative', () => {
  const r = run(4, 3, 'majority', false);
  assert.deepStrictEqual([r.remaining, r.maxYeas], [93, 97]);
  assert.strictEqual(run(60, 50, 'majority', false).remaining, 0);   // over-counted: clamped
});

test('present counts as heard but is neither for nor against', () => {
  assert.strictEqual(T.analyze({ ayes: 40, nays: 40, present: 10, rule: 'majority' }).remaining, 10);
});

test('the marker sits at the share each rule needs', () => {
  assert.strictEqual(run(0, 0, 'three-fifths', true).marker, 60);
  assert.ok(Math.abs(run(0, 0, 'two-thirds', true).marker - 66.667) < 0.01);
  assert.strictEqual(run(0, 0, 'majority', false).marker, 50);
});

test('vacancies lower the whole number, and three fifths with it', () => {
  // 99 senators: three fifths of 99 is 59.4, so 60 yeas (the next whole one).
  assert.strictEqual(T.analyze({ ayes: 60, nays: 0, rule: 'three-fifths', known: true, whole: 99 }).state, 'locked-pass');
  assert.strictEqual(T.analyze({ ayes: 59, nays: 0, rule: 'three-fifths', known: true, whole: 99 }).state, 'in-play');
});

test('a lock holds whatever the unheard do: flipping every unheard vote cannot undo it', () => {
  for (const [a, nn, rule, known] of [[60, 20, 'three-fifths', true], [67, 20, 'two-thirds', true], [62, 10, 'majority', false]]) {
    const r = run(a, nn, rule, known);
    assert.strictEqual(r.state, 'locked-pass');
    // worst case: every unheard senator votes against
    assert.ok(T.carries(a, nn + r.remaining, rule, T.WHOLE), `${a}-${nn} ${rule}`);
  }
});

console.log(`\n${n} passed`);
