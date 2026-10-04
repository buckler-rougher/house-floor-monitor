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

  root.ClerkVotes = { sessionFor, listUrl, parseRolls };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ClerkVotes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
