// What the House did on a day, read off what the board already holds, for the TODAY IN THE HOUSE panel (app.js renderTodayInHouse).
//
//   HouseWrapup.summarize({ items, rollLog, day, etDay })
//     items    the Clerk's floor entries, newest first ({ description, pubDate })
//     rollLog  the roll log ({ roll, question, totals, dem, rep, updatedAt })
//     day      the day the entries are for, as `etDay` writes it
//     etDay    (Date) -> that day in Eastern time, as a string; the caller's own formatter, so a day is never compared in two time zones
//   -> { adjourned: { at, next } | null, votes: [entry] }
//
// Two rules. The Clerk's words are kept as sent: `next` is the text of its own sentence ("10:00 a.m. on September 4, 2026"), not a date this
// builds. And votes are only those logged on `day`, so looking at an earlier sitting day never shows today's votes. There is no result word,
// because the roll log carries a tally and a tally does not say what happened (a suspension needs two thirds).

(function (root) {
  const ADJOURN = /\b(?:do now adjourn|House adjourned|stands adjourned)\b/i;
  // "10:00 a.m. on September 4, 2026.": the time has full stops in it, so the sentence is read up to a four-digit year and the full stop after it.
  const NEXT = /next meeting is scheduled for ([\s\S]+?\b\d{4})\./i;

  function summarize({ items, rollLog, day, etDay }) {
    const adj = (items || []).find((i) => ADJOURN.test((i && i.description) || ''));
    const next = adj && String(adj.description).match(NEXT);
    const votes = (rollLog || [])
      .filter((e) => e && e.updatedAt && etDay(new Date(e.updatedAt)) === day)
      .sort((a, b) => Number(a.roll) - Number(b.roll));
    return {
      adjourned: adj ? { at: new Date(adj.pubDate).getTime(), next: next ? next[1] : null } : null,
      votes,
    };
  }

  root.HouseWrapup = { summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HouseWrapup;
})(typeof globalThis !== 'undefined' ? globalThis : this);
