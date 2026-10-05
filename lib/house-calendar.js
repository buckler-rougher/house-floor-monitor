// The House Calendar's front page for a sitting day: which legislative day it is, when the House
// meets, whether it meets for morning-hour debate, and the orders it has agreed to for the day.
//
// GPO publishes it for every day the House sits, at
//
//   https://www.govinfo.gov/content/pkg/CCAL-119hcal-<YYYY-MM-DD>/html/CCAL-119hcal-<YYYY-MM-DD>-pt0.htm
//
// ("Cover and Special Orders"), a fixed-width text page. A day the House does not sit has no package,
// and govinfo answers a missing package with an HTML error page that is not a 404, so a page is a
// calendar only if this can read a Legislative Day line off it.
//
//   Legislative Day 123                                     Calendar Day 123
//                         Wednesday, September 16, 2026
//                                SUSPENSIONS
//                          HOUSE MEETS AT 9 A.M.
//                          FOR MORNING-HOUR DEBATE          (only on days it applies)
//                              SPECIAL ORDERS
//   HOUR OF         On motion of Mr. Gill of Texas, by unanimous consent, Ordered, ...
//   MEETING             That when the House adjourns ...  (Agreed to Sept. 15, 2026.)
//
// The orders are in two columns: a 16-character label, then the text, each order ending in
// "(Agreed to ...)". What follows them (the Speaker's special-order policy and the morning-hour rule)
// is standing text that does not change day to day and is not read here.
//
// Verified on seven real pages (test/house-calendar/). `orders` is null, not [], when the page's
// shape is not recognised: "none today" and "could not read" are different claims.

(function (root) {
  const LABEL_W = 16;

  const text = (html) => String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&')
    // The Calendar is typeset text: ``crawl'' is a pair of curly quotes.
    .replace(/``/g, '\u201c').replace(/''/g, '\u201d');

  function parse(html) {
    const lines = text(html).split('\n');
    const dayAt = lines.findIndex((l) => /^\s*Legislative Day\s+\d+\s+Calendar Day\s+\d+/.test(l));
    if (dayAt < 0) return null;
    const [, legislativeDay, calendarDay] = lines[dayAt].match(/Legislative Day\s+(\d+)\s+Calendar Day\s+(\d+)/);

    // The header block runs from the Legislative Day line to the first SPECIAL ORDERS heading.
    let headEnd = lines.findIndex((l, i) => i > dayAt && l.trim() === 'SPECIAL ORDERS');
    if (headEnd < 0) headEnd = Math.min(lines.length, dayAt + 25);
    const head = lines.slice(dayAt, headEnd).join('\n');
    const date = (head.match(/^\s*((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s+\w+\s+\d{1,2},\s+\d{4})\s*$/m) || [])[1] || null;
    const meets = (head.match(/HOUSE MEETS AT\s+([^\n]+?)\s*$/m) || [])[1] || null;

    return {
      legislativeDay: Number(legislativeDay),
      calendarDay: Number(calendarDay),
      date,
      suspensions: /^\s*SUSPENSIONS\s*$/m.test(head),
      meetsAt: meets,
      morningHour: /^\s*FOR MORNING-HOUR DEBATE\s*$/m.test(head),
      orders: orders(lines, headEnd),
      standing: standing(lines, headEnd),
    };
  }

  // The agreed orders: between the last SPECIAL ORDERS heading and the standing "SPECIAL ORDER
  // SPEECHES" entry that follows them.
  function orders(lines, from) {
    let start = -1;
    for (let i = from; i < lines.length; i++) {
      if (lines[i].trim() === 'SPECIAL ORDERS') start = i;
      if (/^SPECIAL ORDER\b/.test(lines[i])) break;
    }
    const end = lines.findIndex((l, i) => i > Math.max(start, from) && /^SPECIAL ORDER\b/.test(l));
    if (start < 0 || end < 0) return null;

    const out = [];
    let labels = [], parts = [];
    const flush = () => {
      if (!parts.length) { labels = []; return; }
      const label = labels.join(' ').replace(/\s+/g, ' ').trim();
      out.push({
        kind: /HOUR OF MEETING/i.test(label) ? 'meeting' : /POSTPONED ROLL CALL/i.test(label) ? 'postponed-vote' : 'other',
        label,
        text: parts.join(' ').replace(/\s+/g, ' ').trim(),
      });
      labels = []; parts = [];
    };
    for (const line of lines.slice(start + 1, end)) {
      const left = line.slice(0, LABEL_W).trim(), right = line.slice(LABEL_W).trim();
      if (left) labels.push(left);
      if (right) parts.push(right);
      if (/\(Agreed to[^)]*\)/.test(parts.join(' '))) flush();
    }
    flush();
    return out;
  }

  // The standing orders that follow the day's own: the Speaker's special-order speeches policy, the
  // morning-hour debate rule, the daily hours of meeting. They are the same text most days but they are the
  // rules in force, quoted from the Calendar, so the board shows them as the House states them. Each is a
  // label (the left 16 columns, possibly two lines) and paragraphs (blank lines between). A new entry starts
  // at a label that follows a blank line or an "(Agreed to ...)"; a label that follows text with neither is
  // the second line of the current label ("SPECIAL ORDER" / "SPEECHES"). Null when the page has none.
  function standing(lines, from) {
    const start = lines.findIndex((l, i) => i > from && /^SPECIAL ORDER\b/.test(l));
    if (start < 0) return null;
    const out = [];
    let labels = [], paras = [], cur = [], blank = false, agreed = false;
    // A line can break inside a hyphenated word ("special-" / "order speech"): rejoin it, or the text reads
    // "special- order".
    const closePara = () => { if (cur.length) paras.push(cur.join(' ').replace(/\s+/g, ' ').replace(/([A-Za-z0-9])- (?=[a-z])/g, '$1-').trim()); cur = []; };
    const flush = () => {
      closePara();
      if (labels.length && paras.length) {
        const label = labels.join(' ').replace(/\s+/g, ' ').trim();
        out.push({
          kind: /SPECIAL ORDER/i.test(label) ? 'special-order-speeches' : /MORNING HOUR/i.test(label) ? 'morning-hour' : /HOURS? OF/i.test(label) ? 'hour-of-meeting' : 'other',
          label, paragraphs: paras,
        });
      }
      labels = []; paras = []; cur = []; agreed = false;
    };
    for (const line of lines.slice(start)) {
      if (!line.trim()) { closePara(); blank = true; continue; }
      const left = line.slice(0, LABEL_W).trim(), right = line.slice(LABEL_W).trim();
      if (left) {
        if ((paras.length || cur.length) && (blank || agreed)) flush();
        labels.push(left);
      }
      if (right) cur.push(right);
      if (/\(Agreed to[^)]*\)\s*$/.test(right)) agreed = true;
      blank = false;
    }
    flush();
    return out.length ? out : null;
  }

  root.HouseCalendar = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HouseCalendar;
})(typeof globalThis !== 'undefined' ? globalThis : this);
