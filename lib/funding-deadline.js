// How long the government is funded: the date in the continuing resolution the current fiscal year runs on.
//
//   FundingDeadline.parse(text)        the text of a continuing resolution (tags removed or not) -> 'YYYY-MM-DD' | null
//   FundingDeadline.pick(laws, fy)     /law/<congress> bills -> the newest "Continuing Appropriations" law for fiscal year `fy`, or null
//   FundingDeadline.days(iso, today)   whole days from `today` (YYYY-MM-DD) to the date
//   FundingDeadline.status(o)          what the band says: { kind: 'cr', left } | { kind: 'lapse', since, days, why } | null (see below)
//   FundingDeadline.fiscalYear(today)  the fiscal year running on `today` (YYYY-MM-DD): it starts 1 October, so 10 October 2026 is FY2027
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

  const fiscalYear = (today) => Number(String(today).slice(0, 4)) + (Number(String(today).slice(5, 7)) >= 10 ? 1 : 0);

  // WHAT THE BAND SAYS. `o`: funding (the Worker's answer: { through, fiscalYear, ... } or null), checked (the Worker read the law list and found no resolution for
  // the year, so null means "none", not "could not read"), fundingYear (the fiscal year running today), listYear (the panel's list), today (YYYY-MM-DD), unfunded (how many
  // of the list's twelve bills are not enacted, packages counted). A resolution still in date is "cr". A lapse is asserted only with its evidence: either the resolution's
  // date has passed (the lapse began the day after it) or the year has begun and no resolution or enacted bill was found for it (it began 1 October), AND some of the list's
  // bills are not enacted, AND it is not older than MAX_LAPSE days, AND the list is the year funding is about (otherwise `unfunded` counts another year's bills). Anything else is null: the board says nothing
  // rather than guess. It clears by itself: a newer resolution has a later date, and enacting the bills (a package counts) takes `unfunded` to 0.
  // A lapse older than MAX_LAPSE days is not asserted: the longest ever was 43 days, so past that the likelier story is that the board missed the law that ended it.
  const MAX_LAPSE = 120;
  function status(o) {
    const { funding: f, checked, fundingYear, listYear, today, unfunded } = o || {};
    if (f && f.through) {
      const left = days(f.through, today);
      if (left >= 0) return { kind: 'cr', left };
      if (!(unfunded > 0) || Number(listYear) !== Number(f.fiscalYear || fundingYear) || -left > MAX_LAPSE) return null;
      const since = new Date(Date.parse(f.through + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
      return { kind: 'lapse', since, days: -left, why: 'ended' };
    }
    if (checked && fundingYear && unfunded > 0 && Number(listYear) === Number(fundingYear)) {
      const start = `${fundingYear - 1}-10-01`;
      const d = days(today, start);
      if (d >= 0 && d < MAX_LAPSE) return { kind: 'lapse', since: start, days: d + 1, why: 'none' };
    }
    return null;
  }

  const days = (iso, today) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);

  root.FundingDeadline = { parse, pick, days, fiscalYear, status };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FundingDeadline;
})(typeof globalThis !== 'undefined' ? globalThis : this);
