/**
 * What a row of the Clerk's floor actions is saying happened, shared by
 * worker.js and testable on its own.
 *
 * WHY THIS FILE EXISTS
 * A suspension that has been debated and had a recorded vote demanded is NOT a
 * suspension still waiting to be brought up, and on a day of ten suspensions that
 * is the difference between "four left" and "one left". The site was reporting
 * the first as the second, because the Clerk writes that outcome two different
 * ways and the detection only knew one of them:
 *
 *   POSTPONED PROCEEDINGS - At the conclusion of debate on H.R. 10326, the Chair
 *   put the question on passage of the bill, and by voice vote announced that the
 *   ayes had prevailed. Mr. Raskin demanded the yeas and nays and the Chair
 *   postponed further proceedings until a time to be announced.
 *
 * — which is how passage, Senate amendments and agreeing to a resolution are
 * written, and which the old patterns matched. And then:
 *
 *   At the conclusion of debate, the Yeas and Nays were demanded and ordered.
 *   Pursuant to the provisions of clause 8, rule XX, the Chair announced that
 *   further proceedings on the motion WOULD BE postponed.
 *
 * — which is how a SUSPENSION is written. No "POSTPONED PROCEEDINGS" heading, and
 * "would be postponed" rather than "were postponed", so every one of the four
 * patterns missed it. On 2026-09-16 that silently swallowed S. 2403 and H.R. 9497.
 *
 * Suspensions are the bulk of a normal House day, so this was the common case
 * failing while the rarer ones worked, which is why it looked like it worked.
 *
 * The strings in test/floor-status.test.js are verbatim from the Clerk. Do not
 * tidy them up: the doubled clauses and the inconsistent tense are the problem.
 */
(function (root) {
  'use strict';

  // The Chair deferring a vote to a later series, in any of the Clerk's wordings.
  function isPostponement(desc) {
    const d = String(desc || '');
    return (
      // "POSTPONED PROCEEDINGS - ..." heading, used for passage and amendments.
      /postponed\s+proceedings/i.test(d) ||
      // "...further proceedings on the motion would be / were postponed."
      // Both tenses: the suspension wording says "would be", and only that.
      /further\s+proceedings\b[\s\S]{0,160}?\b(?:were|would\s+be|will\s+be|shall\s+be)\s+postponed/i.test(d) ||
      // "...the Chair postponed further proceedings until a time to be announced."
      /postponed\s+further\s+proceedings/i.test(d) ||
      // The suspension formula. Guarded by an explicit mention of postponement so
      // that a vote demanded and then TAKEN does not read as one deferred.
      (/\byeas\s+and\s+nays\s+were\s+demanded\s+and\s+ordered\b/i.test(d) && /\bpostpon/i.test(d)) ||
      /recorded\s+vote\s+requested[\s\S]*postponed/i.test(d) ||
      /postponed[\s\S]*recorded\s+vote/i.test(d)
    );
  }

  // Tabling. "On motion to table Agreed to by the Yeas and Nays: 232 - 147" is
  // the House killing a measure, and it is the one disposition whose sense is
  // INVERTED: agreeing to the motion means the measure is dead, and failing it
  // means the measure survives. Treating it like any other "Agreed to" would have
  // reported H.Res. 1486 as passed on 2026-09-15 when the House had just buried
  // it, which is worse than the silence it replaced — so it is kept separate from
  // isPassageMotion rather than folded in.
  //
  // This is how privileged resolutions die, which makes it rare but never
  // obscure: they are the censure and impeachment resolutions.
  //
  // "Motion to reconsider laid on the table", which follows nearly every passage,
  // is not this and must not match. It says "laid on the table", never "on motion
  // to table".
  function isTablingMotion(desc) {
    return /\bon\s+motion\s+to\s+table\b/i.test(String(desc || ''));
  }

  // A row that puts a question to the House — the thing a postponement defers and
  // an outcome resolves. Used to bound the search for a nearby bill link so one
  // outcome does not claim the measure belonging to the next.
  function isPassageMotion(desc) {
    const d = String(desc || '');
    return (
      /on motion to suspend the rules and (pass|agree)/i.test(d) ||
      /\bon passage\b/i.test(d) ||
      /on agreeing to the (resolution|amendment)\b/i.test(d) ||
      /on passage of the bill\b/i.test(d) ||
      /agree to the senate amendment/i.test(d) ||
      /on ordering the previous question/i.test(d)
    );
  }

  // Either of the above. A row that is itself an outcome bounds the bill-link
  // search. These two were written out twice in worker.js, separately, and the
  // copies had already drifted apart by one pattern.
  function isOutcomeRow(desc) {
    return isPostponement(desc) || isPassageMotion(desc) || isTablingMotion(desc);
  }

  // The Speaker's standing notice at the top of the day. It sounds like a
  // postponement and is not one — it is about votes not yet ordered, names no
  // measure, and must never mark anything as deferred.
  function isBlanketSuspensionNotice(desc) {
    return /votes?\s+on\s+suspensions?,?\s+if\s+ordered,?\s+will\s+be\s+postponed/i.test(String(desc || ''));
  }

  root.FloorStatus = { isPostponement, isPassageMotion, isTablingMotion, isOutcomeRow, isBlanketSuspensionNotice };
})(typeof globalThis !== 'undefined' ? globalThis : this);
