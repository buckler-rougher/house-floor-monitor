// How long the government is funded: the date in the continuing resolution the current fiscal year runs on.
//
//   FundingDeadline.parse(text)        the text of a continuing resolution (tags removed or not) -> 'YYYY-MM-DD' | null
//   FundingDeadline.pick(laws, fy)     /law/<congress> bills -> the newest "Continuing Appropriations" law for fiscal year `fy`, or null
//   FundingDeadline.days(iso, today)   whole days from `today` (YYYY-MM-DD) to the date
//
// Every continuing resolution carries the same section 106: funds "shall be available until whichever of the following first occurs: (1) the enactment of an
// appropriation for the project, (2) the enactment of the applicable appropriations Act without a provision for it, (3) <date>". The date is the last item. That is
// the only date read, never the first "through" or any other date in a text that is mostly extensions (the 2027 resolution names December 11, 2026 forty times,
// in unrelated programs, and in one section that has nothing to do with funding). A text without that clause gives null and the board shows nothing.

(function (root) {
  const MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };

  function parse(text) {
    const t = String(text || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
    const at = t.search(/shall be available until whichever of the following first occurs/i);
    if (at < 0) return null;
    // the items run to the next section; the date is the one that is only a date
    const rest = t.slice(at, at + 1500).split(/\bSec(?:tion)?\.\s*\d+/i)[0];
    const m = [...rest.matchAll(/\(\d+\)\s*([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\s*\./g)].pop();
    if (!m || !MONTHS[m[1]]) return null;
    return `${m[3]}-${String(MONTHS[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  function pick(laws, fy) {
    const fyRe = new RegExp(`\\b${fy}\\b`);
    const found = (laws || []).filter((b) => /continuing appropriations/i.test(b.title || '') && fyRe.test(b.title || '') && (b.laws || []).length);
    found.sort((a, b) => String(((b.latestAction || {}).actionDate) || '').localeCompare(String(((a.latestAction || {}).actionDate) || '')));
    return found[0] || null;
  }

  const days = (iso, today) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);

  root.FundingDeadline = { parse, pick, days };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FundingDeadline;
})(typeof globalThis !== 'undefined' ? globalThis : this);
