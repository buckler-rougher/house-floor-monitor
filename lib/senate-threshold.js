/**
 * What a Senate vote needs to carry, and where it stands, shared by the board and
 * testable on its own. This is the Senate's version of the House board's THRESHOLD
 * ANALYSIS (votes remaining, yeas needed, nays to block, max possible yeas, and
 * whether the result is locked).
 *
 * THE THRESHOLD IS NOT ONE NUMBER. It depends on the question:
 *   - cloture ("shall debate be brought to a close") needs three fifths of the
 *     Senators duly chosen and sworn: 60 of 100.
 *   - a treaty, a veto override, a constitutional amendment, a conviction needs two
 *     thirds of those present and voting.
 *   - anything else is a majority of those voting. EXCEPT that a unanimous-consent
 *     agreement routinely sets a 60-vote threshold on an amendment or on passage, and
 *     nothing in the question says so.
 *
 * So the classification returns whether the rule is KNOWN from the question or only
 * ASSUMED, and an assumed majority is never allowed to claim more than it can. A
 * result is only called locked when it holds under the strictest rule that could
 * apply: passing is locked only at 60 yeas, though a bare majority would carry at 51.
 * Failing is locked only when even a majority is out of reach, which fails every
 * stricter rule too. The wording of the question is the chair's, from the captions,
 * and has NOT been confirmed against a real caption.
 *
 * COUNTS ARE FLOORS. The captions miss votes (the clerk is silent through stretches),
 * so what was heard is a lower bound on each side. The locks are built so that does not
 * matter: "pass locked" assumes every senator not yet heard votes against, "fail
 * locked" assumes every one votes for. Yeas needed and nays to block are "as heard".
 */
(function (root) {
  'use strict';

  const WHOLE = 100;

  /** Which rule applies to a stated question, and whether that is known or assumed. */
  function classify(question) {
    const q = String(question || '').toUpperCase();
    if (!q.trim()) return { rule: 'majority', known: false, label: 'Not known: the question was not heard, so a majority is assumed' };
    if (/BROUGHT TO A CLOSE|INVOKE CLOTURE|CLOTURE/.test(q)) {
      return { rule: 'three-fifths', known: true, label: 'Three fifths of the Senate (60), for cloture' };
    }
    if (/TWO[- ]THIRDS|VETO|OBJECTIONS? OF THE PRESIDENT|RATIFICATION|TREATY|CONSTITUTIONAL AMENDMENT|CONVICT/.test(q)) {
      return { rule: 'two-thirds', known: true, label: 'Two thirds of those voting' };
    }
    return { rule: 'majority', known: false, label: 'A majority of those voting, assumed: a consent agreement can set 60' };
  }

  const needThreeFifths = (whole) => Math.ceil(whole * 0.6);

  // Does this tally carry under `rule`?
  function carries(a, n, rule, whole) {
    if (rule === 'three-fifths') return a >= needThreeFifths(whole);
    if (rule === 'two-thirds') return a > 0 && 3 * a >= 2 * (a + n);
    return a > n;                                   // a majority: a tie does not carry
  }

  /**
   * ayes, nays, present: what is counted (heard, or announced once the tally is read).
   * whole: senators who can vote. rule: from classify().
   * Returns { remaining, maxYeas, yeasNeeded, naysToBlock, state, marker }.
   */
  function analyze({ ayes, nays, present = 0, whole = WHOLE, rule = 'majority', known = false }) {
    const counted = ayes + nays + present;
    const remaining = Math.max(0, whole - counted);
    const maxYeas = ayes + remaining;

    // Locked results hold whatever the unheard do. A rule that is only assumed is held to
    // the stricter of itself and 60, so passing is never called locked on a bare majority.
    const passLocked = carries(ayes, nays + remaining, rule, whole) && (known || ayes >= needThreeFifths(whole));
    // Under a majority a tie is not a settled failure: the Vice President breaks it. So a
    // majority fails for certain only when even every unheard vote for it falls short.
    const failLocked = rule === 'majority' ? maxYeas < nays : !carries(maxYeas, nays, rule, whole);

    // Yeas needed to carry as things stand, taking the rest as not voting.
    let yeasNeeded = 0;
    while (!carries(ayes + yeasNeeded, nays, rule, whole) && yeasNeeded <= whole) yeasNeeded++;
    if (yeasNeeded > whole) yeasNeeded = null;

    // The fewest of the unheard who would have to vote against to lock a failure, the
    // rest voting for. Nothing to block once it is locked either way.
    let naysToBlock = null;
    if (failLocked) naysToBlock = 0;
    else if (passLocked) naysToBlock = 0;
    else {
      for (let k = 1; k <= remaining; k++) {
        if (!carries(ayes + (remaining - k), nays + k, rule, whole)) { naysToBlock = k; break; }
      }
    }

    const marker = rule === 'three-fifths' ? 60 : rule === 'two-thirds' ? 200 / 3 : 50;
    return {
      remaining, maxYeas, yeasNeeded, naysToBlock, marker,
      state: passLocked ? 'locked-pass' : failLocked ? 'locked-fail' : 'in-play',
    };
  }

  root.SenateThreshold = { classify, analyze, carries, WHOLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateThreshold;
})(typeof globalThis !== 'undefined' ? globalThis : this);
