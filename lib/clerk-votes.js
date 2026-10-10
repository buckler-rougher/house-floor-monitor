// Which roll calls has the House held? Read off the Clerk's vote listing.
//
// The Clerk used to publish a plain index at clerk.house.gov/evs/<year>/index.asp, with
// links shaped rollnumber=314">314</A>. It now answers 404 (checked for 2025 and 2026), and
// the Worker's /api/congress-index went to 500 with it: nothing could find the latest roll, so
// MISSING MEMBERS and the quorum panel sat at "--". The listing moved to
//
//   https://clerk.house.gov/Votes/MemberVotes?Session=2nd      (paged, newest first, 10 a page)
//
// where each roll is
//
//   Roll Call Number: <a href="/Votes/2026314?Page=2" aria-label="Roll number, 314">314</a>
//
// the href being the year and the roll number run together. The roll call XML itself did not
// move (evs/2026/roll314.xml still answers), so only the discovery of the latest number changed.
//
// A page this does not recognise returns NO rolls, and the caller treats that as an error. A
// wrong "latest roll" is worse than none: the board would show an old vote as the last one.

(function (root) {
  // A session is a calendar year in practice: the first in odd years, the second in even ones.
  const sessionFor = (year) => (year % 2 ? '1st' : '2nd');
  const listUrl = (year) => `https://clerk.house.gov/Votes/MemberVotes?Session=${sessionFor(year)}`;

  // [{ rollNumber: '314', displayNumber: '314' }], highest first, for `year` only. The year is in
  // the href, and the roll number is there twice (href and label), which must agree.
  function parseRolls(html, year) {
    const seen = new Set();
    const re = /href="\/Votes\/(\d{4})(\d+)(?:\?[^"]*)?"[^>]*aria-label="Roll number, (\d+)"/g;
    for (const m of String(html || '').matchAll(re)) {
      if (year && Number(m[1]) !== year) continue;
      if (m[2] !== m[3]) continue;
      seen.add(Number(m[3]));
    }
    return [...seen].sort((a, b) => b - a).map((n) => ({ rollNumber: String(n), displayNumber: String(n) }));
  }

  // One roll call's own file (evs/<year>/rollNNN.xml), reduced to what a board shows: question, result, when, the title, the totals and each party's.
  // The file is 90 KB because it lists every member's vote after the metadata; none of that is read, and `metadata` is the block as the Clerk wrote it
  // (without the table-header boilerplate), for a source popover. `date` is MM/DD/YYYY, the form the Clerk's floor summary takes. Null for anything
  // that is not a roll call file, so a page that answers 200 with an error is not a vote.
  const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const decode = (t) => String(t).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
  function parseRoll(xml) {
    const meta = (String(xml || '').match(/<vote-metadata>[\s\S]*?<\/vote-metadata>/) || [])[0];
    if (!meta || !/<rollcall-num>/.test(meta)) return null;
    const field = (src, t) => decode(((src.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)) || [])[1] || '').trim());
    const counts = (src) => ({ yeas: Number(field(src, 'yea-total')) || 0, nays: Number(field(src, 'nay-total')) || 0, present: Number(field(src, 'present-total')) || 0, notVoting: Number(field(src, 'not-voting-total')) || 0 });
    const parties = {};
    for (const m of meta.matchAll(/<totals-by-party>([\s\S]*?)<\/totals-by-party>/g)) {
      const name = field(m[1], 'party');
      if (name) parties[name[0].toUpperCase()] = counts(m[1]);
    }
    const byVote = (meta.match(/<totals-by-vote>([\s\S]*?)<\/totals-by-vote>/) || [])[1] || '';
    const d = field(meta, 'action-date').match(/^(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{4})$/);
    return {
      roll: field(meta, 'rollcall-num'),
      legis: field(meta, 'legis-num'),
      question: field(meta, 'vote-question'),
      type: field(meta, 'vote-type'),
      result: field(meta, 'vote-result'),
      date: d && MONTHS[d[2].toLowerCase()] ? `${MONTHS[d[2].toLowerCase()]}/${d[1].padStart(2, '0')}/${d[3]}` : null,
      time: field(meta, 'action-time'),
      desc: field(meta, 'vote-desc'),
      totals: counts(byVote),
      parties,
      metadata: meta.replace(/<totals-by-party-header>[\s\S]*?<\/totals-by-party-header>\s*/, ''),
    };
  }

  root.ClerkVotes = { sessionFor, listUrl, parseRolls, parseRoll };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ClerkVotes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
