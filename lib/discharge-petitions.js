// Discharge petitions, read off the House Clerk's pages (clerk.house.gov/DischargePetition).
//
//   DischargePetitions.parseList(html)  -> { petitions: [{ number, id, description, billNumber, billUrl, sponsor, petitionDate, referralDate, block }], total, pages }
//   DischargePetitions.parseSignatures(html) -> { count, last }  from one petition's own page
//   DischargePetitions.NEEDED = 218
//
// The list is paged (10 a page; `?CongressNum=119&Page=2`) and carries no signature count: that is the number of rows in the signature table of each
// petition's own page. NEEDED is 218. Checked against all 27 petitions of the 119th Congress on 9 October 2026: every petition that reached the number
// stopped at exactly 218 signatures (eight of them), including ones signed in 2025 when seats were vacant, so the Clerk's number is the majority of the
// whole 435 and does not move with vacancies. The strings are the Clerk's own, whitespace-collapsed; `block` is the list entry as sent, for a popover.

(function (root) {
  const NEEDED = 218;
  const decode = (t) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const clean = (s) => decode(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

  function parseList(html) {
    html = String(html || '');
    const info = html.match(/(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+Results/i);
    const pages = [...html.matchAll(/of (\d+) pages/g)].reduce((n, m) => Math.max(n, Number(m[1])), 0) || (info ? 1 : 0);
    const petitions = [];
    // (not slice(1): a split at the very start of the text makes no empty first piece, so the entries are picked by what they begin with)
    for (const part of html.split(/(?=Discharge Petition No\. \d+)/).filter((p) => /^Discharge Petition No\. \d+/.test(p))) {
      const number = Number(part.match(/^Discharge Petition No\. (\d+)/)[1]);
      // the entry ends where the next begins; the trailing part of the last one is the page's footer, cut at the end of its panel
      const block = part.replace(/<footer[\s\S]*$/i, '');
      const id = (block.match(/href="\/DischargePetition\/(\d+)(?:\?[^"]*)?"/) || [])[1] || null;
      const field = (label) => clean((block.match(new RegExp(`<label>${label}:</label>([\\s\\S]*?)</p>`)) || [])[1] || '');
      petitions.push({
        number, id,
        description: field('Description'),
        billNumber: (block.match(/aria-label="Bill Number: ([^"]+)"/) || [])[1] || null,
        billUrl: (block.match(/href=["']?(https:\/\/www\.congress\.gov\/bill\/[^"'\s>]+)/) || [])[1] || null,
        sponsor: clean((block.match(/Sponsor:<\/label>\s*<a[^>]*>([^<]+)<\/a>/) || [])[1] || ''),
        petitionDate: field('Petition Date'),
        referralDate: field('Referral Date'),
        block: block.replace(/\s+/g, ' ').replace(/<!--[\s\S]*?-->/g, '').trim(),
      });
    }
    return { petitions, total: info ? Number(info[3]) : petitions.length, pages };
  }

  // The signature table: one numbered row per signer. The count is the highest number, not the rows (a page has other tables), and `last` is the
  // date of the newest signature (MM/DD/YYYY), which the table carries in a hidden span.
  function parseSignatures(html) {
    const at = String(html || '').indexOf('id="member-signatures"');
    if (at < 0) return null;
    const end = html.indexOf('</tbody>', at);
    const table = html.slice(at, end < 0 ? html.length : end);
    const nums = [...table.matchAll(/<td data-label="No\.">(\d+)\.<\/td>/g)].map((m) => Number(m[1]));
    const dates = [...table.matchAll(/<span style="display:none;">(\d\d\/\d\d\/\d{4}) \d\d:\d\d:\d\d<\/span>/g)].map((m) => m[1]);
    const key = (d) => d.slice(6) + d.slice(0, 2) + d.slice(3, 5);
    return { count: nums.length ? Math.max(...nums) : 0, last: dates.length ? dates.reduce((a, b) => (key(b) > key(a) ? b : a)) : null };
  }

  root.DischargePetitions = { NEEDED, parseList, parseSignatures };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DischargePetitions;
})(typeof globalThis !== 'undefined' ? globalThis : this);
