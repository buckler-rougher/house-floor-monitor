// The House's committee meetings for one day, read off the Clerk's Committee Repository calendar (docs.house.gov/Committee/Calendar/ByDay.aspx).
//
//   CommitteeMeetings.parseDay(html) -> { events: [{ id, title, committee, time, location, url }], table } | null
//
// The page is one table: each row a meeting, its title (a hearing's name, or the bills a markup takes up), the committee, the time and the room.
// A day with none has the same table with "No meetings found.", so that is an empty list, and a page with no table at all (a 200 with an error
// page, which this site is known to answer) is null, not an empty day. The strings are the Clerk's own, whitespace-collapsed and nothing else;
// `table` is the table as it was sent, less the layout attributes, for a source popover.

(function (root) {
  const decode = (t) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const clean = (s) => decode(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

  function parseDay(html) {
    const table = (String(html || '').match(/<table[^>]*id="MainContent_GridViewMeetings"[\s\S]*?<\/table>/) || [])[0];
    if (!table) return null;
    const events = [];
    const ROW = /<tr>\s*<td>\s*<a href="ByEvent\.aspx\?EventID=(\d+)"[^>]*>([\s\S]*?)<\/a>\s*<br\s*\/?>\s*<span class="text-tiny"[^>]*>([\s\S]*?)<\/span>\s*<\/td>\s*<td>\s*<span class="text-small">([\s\S]*?)<\/span>\s*<\/td>\s*<td>\s*<span class="text-small">([\s\S]*?)<\/span>/g;
    for (const m of table.matchAll(ROW)) {
      events.push({ id: m[1], title: clean(m[2]), committee: clean(m[3]), time: clean(m[4]), location: clean(m[5]), url: `https://docs.house.gov/Committee/Calendar/ByEvent.aspx?EventID=${m[1]}` });
    }
    const tidy = table.replace(/\s(?:style|cellspacing|rules|border|scope|id|class)="[^"]*"/g, '').replace(/>\s+</g, '>\n<');
    return { events, table: tidy };
  }

  root.CommitteeMeetings = { parseDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CommitteeMeetings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
