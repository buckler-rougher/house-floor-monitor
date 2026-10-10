// When the House met and when it adjourned on a day, read off the Clerk's floor entries, for the TODAY IN THE HOUSE panel (app.js renderTodayInHouse).
//
//   HouseWrapup.summarize({ items })
//     items   the Clerk's floor entries for the day, newest first ({ description, pubDate })
//     -> { convened: { at, entry } | null, adjourned: { at, next, entry } | null }
//
// The Clerk's words are kept as sent: `next` is the text of its own sentence ("1:30 p.m. on October 13, 2026"), not a date this builds, and `entry` is
// the Clerk's entry itself, for the source popover. The votes are not here: they come from the Clerk's roll call files (lib/clerk-votes.js parseRoll,
// served by the Worker's /api/house-rolls).

(function (root) {
  // "The House convened, starting a new legislative day." (the first entry of a sitting; a House that returns from a recess has a different one)
  const CONVENE = /^\s*The House convened\b/i;
  const ADJOURN = /\b(?:do now adjourn|House adjourned|stands adjourned)\b/i;
  // "10:00 a.m. on September 4, 2026.": the time has full stops in it, so the sentence is read up to a four-digit year and the full stop after it.
  const NEXT = /next meeting is scheduled for ([\s\S]+?\b\d{4})\./i;

  function summarize({ items }) {
    const list = items || [];
    const at = (i) => new Date(i.pubDate).getTime();
    // The adjournment is the newest entry that says so; the convening is the OLDEST that says so (a day can have more than one).
    const adj = list.find((i) => ADJOURN.test((i && i.description) || ''));
    const next = adj && String(adj.description).match(NEXT);
    const con = [...list].reverse().find((i) => CONVENE.test((i && i.description) || ''));
    return {
      convened: con ? { at: at(con), entry: con } : null,
      adjourned: adj ? { at: at(adj), next: next ? next[1] : null, entry: adj } : null,
    };
  }

  root.HouseWrapup = { summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HouseWrapup;
})(typeof globalThis !== 'undefined' ? globalThis : this);
