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

  // One meeting's own page (ByEvent.aspx?EventID=): what is before the committee and who is testifying.
  //
  //   CommitteeMeetings.parseEvent(html) -> { title, committee, time, location, witnesses: [{ name, role, docs: [{ title, url }] }],
  //                                           sections: [{ title, items: [{ title, url }] }], updated, panel } | null
  //
  // The page's `previewPanel` is clean markup: a heading, then an <h2> per kind of thing ("Text of Legislation", "Support Documents", "Votes"),
  // each a list of titled PDFs, and for a hearing "Witnesses", one panel per witness with a name, a title and their documents. A page without the
  // panel is null (an error page, or a change). Document links come as http://docs.house.gov, which answers on https too.
  const https = (u) => String(u || '').replace(/^http:\/\/docs\.house\.gov/, 'https://docs.house.gov');
  const items = (html) => [...String(html).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => {
    const url = (m[1].match(/href="([^"]+)"/) || [])[1];
    return { title: clean(m[1].split(/\[\s*<a/)[0]), url: https(url) };
  }).filter((i) => i.title);

  function parseEvent(html) {
    const start = String(html || '').indexOf('<div id="previewPanel"');
    if (start < 0) return null;
    const end = html.indexOf('<div class="button-row">', start);
    const panel = html.slice(start, end < 0 ? html.length : end);
    const h1 = (panel.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1];
    if (!h1) return null;
    const witnesses = [...panel.matchAll(/<div class="witnessPanel">([\s\S]*?)<\/div>/g)].map((m) => ({
      name: clean((m[1].match(/<strong>([\s\S]*?)<\/strong>/) || [])[1] || ''),
      role: clean((m[1].match(/<small[^>]*>([\s\S]*?)<\/small>/) || [])[1] || ''),
      docs: items(m[1]),
    })).filter((w) => w.name);
    const sections = [];
    for (const part of panel.split(/<h2>/).slice(1)) {
      const title = clean(part.split('</h2>')[0]);
      if (/^Witnesses$/i.test(title)) continue;
      const its = items(part.split('</h2>')[1] || '');
      if (its.length) sections.push({ title, items: its });
    }
    const tidy = panel.replace(/<!--[\s\S]*?-->/g, '').replace(/\s(?:style|class|target|xmlns:dt)="[^"]*"/g, '').replace(/>\s+</g, '>\n<').replace(/http:\/\/docs\.house\.gov/g, 'https://docs.house.gov');
    return {
      title: clean(h1.split('<small')[0]), committee: clean((h1.match(/<small[^>]*>([\s\S]*?)<\/small>/) || [])[1] || ''),
      time: clean((panel.match(/<p class="meetingTime">([\s\S]*?)<\/p>/) || [])[1] || ''),
      location: clean((panel.match(/<blockquote class="location"><strong>([\s\S]*?)<\/strong>/) || [])[1] || ''),
      witnesses, sections,
      updated: clean(((panel.match(/Last Updated:([\s\S]*?)<\/p>/) || [])[1] || '')),
      panel: tidy,
    };
  }

  root.CommitteeMeetings = { parseDay, parseEvent };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CommitteeMeetings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
