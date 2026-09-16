/**
 * Floor-action classification, shared by worker.js and app.js.
 *
 * WHY THIS FILE EXISTS
 * A bill's status on the floor comes from the Clerk's activity rows, and until
 * now each consumer read those rows with its own private regexes:
 *
 *   worker.js  extractBillStatusesFromProceedings  — postponed, passed, failed
 *   app.js     updateBillStatusFromProceedings     — passed (voice vote) ONLY
 *
 * That asymmetry is the bug this file exists to end. The client had no
 * "recorded vote requested" case at all, so between the moment a member demands
 * the yeas and nays on a suspension and the moment the vote series is called —
 * often hours, and exactly the window a floor monitor is for — nothing on the
 * page could say so. The only code that knew lives in the worker, behind an
 * hour-long KV freshness window, so the flag arrived long after it mattered or
 * not at all. Suspensions feel it worst because they are precisely the measures
 * whose votes get batched and postponed, often a dozen at a time.
 *
 * ORDERING MATTERS, TWICE:
 *
 *   1. A postponed row must be classified BEFORE a passage row, because the
 *      Clerk's postponed text contains the passage motion inside it ("...on the
 *      motion to suspend the rules and pass H.R. 1234, the Chair put the
 *      question..."). Test the postponed shape first or every postponement
 *      reads as a passage.
 *
 *   2. Clerk rows arrive NEWEST FIRST. A bill postponed in the morning and
 *      passed in the afternoon therefore yields its passage row first and its
 *      postponement row later, so a blind assignment lets the older row win and
 *      a bill that already passed reverts to "vote requested". Resolve with
 *      outranks() rather than by assignment order.
 *
 * LOADING
 * Same convention as lib/bill-id.js and lib/floor-speaker.js: no `export`, it
 * assigns to globalThis, so worker.js side-effect imports it (esbuild inlines it
 * at deploy), index.html loads it as a plain script before app.js, and the
 * CommonJS test can require it.
 */
(function (root) {
  'use strict';

  const POSTPONED_STATUS_TEXT = 'Recorded vote requested — postponed';

  // Rank for resolving two rows that touch the same measure. Passage and
  // failure are terminal and equal: whichever the Clerk posted more recently
  // wins, and neither may be walked back to a pending state.
  const STATUS_RANK = { passed: 4, failed: 4, 'roll-call': 3, postponed: 2, scheduled: 1 };

  /** May `next` replace `current`? Strict, so the newest row wins a tie. */
  function outranks(next, current) {
    if (!current) return true;
    return (STATUS_RANK[next] || 0) > (STATUS_RANK[current] || 0);
  }

  // The Chair put the question, someone demanded the yeas and nays, and the vote
  // was deferred to a later series. Every wording the Clerk uses for it.
  const POSTPONED_RES = [
    /postponed proceedings/i,
    /further proceedings\b[\s\S]*\bwere postponed/i,
    /recorded vote requested.*postponed/i,
    /postponed.*recorded vote/i,
  ];

  // Motions whose row carries an outcome. Used to classify, and to bound the
  // search for a nearby bill link so one motion never borrows another's bill.
  const PASSAGE_RES = [
    /on motion to suspend the rules and (pass|agree)/i,
    /\bon passage\b/i,
    /on agreeing to the (resolution|amendment)\b/i,
    /on passage of the bill\b/i,
    /agree to the senate amendment/i,
    /on ordering the previous question/i,
  ];

  const isPostponedRow = (desc) => POSTPONED_RES.some((re) => re.test(desc || ''));
  const isPassageRow   = (desc) => PASSAGE_RES.some((re) => re.test(desc || ''));
  const isOutcomeRow   = (desc) => isPostponedRow(desc) || isPassageRow(desc);

  /**
   * What this row says about the measure it concerns.
   * @returns { status, statusText, viaVoiceVote } or null when the row is not an outcome.
   */
  function classifyFloorAction(description) {
    const desc = description || '';
    // Rule 1 above: postponed is tested first because its text contains the
    // passage motion it postpones.
    if (isPostponedRow(desc)) {
      return { status: 'roll-call', statusText: POSTPONED_STATUS_TEXT, viaVoiceVote: false };
    }
    if (!isPassageRow(desc)) return null;

    const votes = desc.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)/);
    const num = (s) => s.replace(/,/g, '');
    if (/(agreed to|passed)\b/i.test(desc) && !/not agreed to|failed/i.test(desc)) {
      const viaVoiceVote = /voice vote|without objection/i.test(desc);
      if (viaVoiceVote) return { status: 'passed', statusText: 'Passed (voice vote)', viaVoiceVote: true };
      if (votes) return { status: 'passed', statusText: `Passed ${num(votes[1])}-${num(votes[2])}`, viaVoiceVote: false };
      return { status: 'passed', statusText: 'Passed', viaVoiceVote: false };
    }
    if (/\b(failed|not agreed to)\b/i.test(desc)) {
      return {
        status: 'failed',
        statusText: votes ? `Failed ${num(votes[1])}-${num(votes[2])}` : 'Failed',
        viaVoiceVote: false,
      };
    }
    return null;
  }

  // Compact spelling per normalised type key — matches how the schedule XML is
  // normalised in worker.js ("H. Res. 1499" -> "H.Res. 1499"), so ids extracted
  // from prose key the same map as ids taken from the schedule.
  const COMPACT = {
    HR: 'H.R.', HRES: 'H.Res.', HJRES: 'H.J.Res.', HCONRES: 'H.Con.Res.',
    S: 'S.', SRES: 'S.Res.', SJRES: 'S.J.Res.', SCONRES: 'S.Con.Res.',
  };

  // Longest first so "H.Res." is never read as "H.R.". Bare "H"/"S" are
  // deliberately absent: these are free-text sentences, and a bare letter before
  // a number matches things that are not bill references at all.
  const TEXT_TYPE_RE = new RegExp(
    String.raw`\b(H\.\s*J\.\s*Res\.|H\.\s*Con\.\s*Res\.|H\.\s*Res\.|H\.\s*R\.` +
    String.raw`|S\.\s*J\.\s*Res\.|S\.\s*Con\.\s*Res\.|S\.\s*Res\.|S\.)\s*(\d+)`, 'i');

  /**
   * First bill identifier mentioned in a row's prose, in compact spelling, or
   * null. Handles the spaced form ("H. Res. 1499") that the worker's old inline
   * regex could not match.
   */
  function billIdFromText(description) {
    const m = String(description || '').match(TEXT_TYPE_RE);
    if (!m) return null;
    const key = m[1].toUpperCase().replace(/[.\s]/g, '');
    const compact = COMPACT[key];
    return compact ? `${compact} ${m[2]}` : null;
  }

  root.FloorStatus = {
    classifyFloorAction, billIdFromText,
    isPostponedRow, isPassageRow, isOutcomeRow,
    outranks, STATUS_RANK, POSTPONED_STATUS_TEXT,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
