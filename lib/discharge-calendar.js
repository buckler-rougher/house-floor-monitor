// The Calendar of Motions to Discharge Committees, from the House Calendars (GPO, part 6 of a sitting day's package):
//
//   https://www.govinfo.gov/content/pkg/CCAL-119hcal-<YYYY-MM-DD>/html/CCAL-119hcal-<YYYY-MM-DD>-pt6.htm
//
//   DischargeCalendar.parse(html) -> [{ number, entered: 'YYYY-MM-DD', title, calendarNumber }]  or null if the page is not this section
//
// A petition is on this calendar from the day it reaches 218 until the House acts on it (or it is stricken), so a petition at 218 that is NOT listed has
// been dealt with. Rule XV clause 2(c)(1), printed at the head of the same page: after seven legislative days on the calendar a signer who announces the
// motion makes it privileged at a time the Speaker sets within two legislative days. The rows are fixed-width text: the petition's number and, under it, the
// date entered ("Sept. 15"), which sits under a year heading; a row can run to many lines, which are skipped.
//
//      22       H. Res. 1247,           Rules         Mr. Takano         8
//   Sept. 15      providing for
//                 consideration of the bill ...
//
// An empty calendar is a page with the table head and no rows ([]); a page without the head is null (an error page is not "nothing pending").

(function (root) {
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const text = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'");

  function parse(html) {
    const lines = text(html).split('\n');
    const head = lines.findIndex((l) => /^\s*Motion No\./.test(l));
    if (head < 0 || !lines.some((l) => /CALENDAR OF MOTIONS TO DISCHARGE COMMITTEES/.test(l))) return null;
    const out = [];
    let year = null;
    let row = null;
    for (const l of lines.slice(head + 1)) {
      if (/^-{20,}/.test(l)) break;
      const y = l.match(/^\s*(20\d\d)\s*$/);
      if (y) { year = Number(y[1]); row = null; continue; }
      const r = l.match(/^\s{1,8}(\d{1,3})\s{2,}(\S.*?)\s{2,}\S.*?\s+(\d{1,3})\s*$/);
      if (r) { row = { number: Number(r[1]), title: (r[2].match(/^[HS]\.\s?(?:J\.\s?|Con\.\s?)?(?:Res\.|R\.)\s?\d+/) || [r[2].replace(/,$/, '')])[0], calendarNumber: Number(r[3]), entered: null }; out.push(row); continue; }
      const d = row && !row.entered && l.match(/^\s{1,8}([A-Z][a-z]{2,4})\.?\s+(\d{1,2})\b/);
      if (d && year && MONTHS[d[1].slice(0, 3).toLowerCase()]) {
        row.entered = `${year}-${String(MONTHS[d[1].slice(0, 3).toLowerCase()]).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}`;
      }
    }
    return out.filter((m) => m.entered);
  }

  // The table as the Calendar prints it, from its heading to the closing rule, for a popover.
  function table(html) {
    const lines = text(html).split('\n');
    const head = lines.findIndex((l) => /^\s*Motion No\./.test(l));
    if (head < 0) return null;
    let end = lines.findIndex((l, i) => i > head && /^-{20,}/.test(l));
    if (end < 0) end = lines.length;
    return lines.slice(head, end).map((l) => l.replace(/\s+$/, '')).filter((l, i, all) => l || (all[i - 1] && all[i + 1] !== undefined)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  root.DischargeCalendar = { parse, table };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DischargeCalendar;
})(typeof globalThis !== 'undefined' ? globalThis : this);
