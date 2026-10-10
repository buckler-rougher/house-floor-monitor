// Discharge petitions, read off the House Clerk's pages (clerk.house.gov/DischargePetition).
//
//   DischargePetitions.parseList(html)  -> { petitions: [{ number, id, description, billNumber, billUrl, sponsor, petitionDate, referralDate, block }], total, pages }
//   DischargePetitions.parseSignatures(html) -> { count, last, signers: [{ n, id, name, state, district, party, date }], rows }  from one petition's own page
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

  // The entry as the Clerk sent it, without its page furniture: the second, phone-width copy of the buttons, the layout divs, and the styling and
  // accessibility attributes. What is left is the content, one element a line, with the Clerk's unquoted hrefs quoted.
  function tidy(block) {
    return block
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<div class="col-lg-12 visible-sm visible-xs">[\s\S]*?<\/div>/, '')
      .replace(/<hr\s*\/?>/g, '')
      .replace(/<\/?div\b[^>]*>/g, '')
      .replace(/\s(?:class|style|aria-[a-z]+|tabindex|role|type|target|id)=(?:"[^"]*"|'[^']*')/g, '')
      .replace(/\shref=([^\s"'>]+)/g, ' href="$1"')
      .replace(/\s+/g, ' ')
      .replace(/ ?(<\/p>|<\/a>)/g, '$1\n').replace(/\n ?(?=<(?:p|a)\b)/g, '\n').replace(/<p>\s*(?=\S)/g, '<p>')
      .replace(/\n<\/p>/g, '</p>').replace(/\n+/g, '\n').trim();
  }

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
        sponsorId: (block.match(/href="\/Members\/([A-Z]\d{6})"/) || [])[1] || null,
        petitionDate: field('Petition Date'),
        referralDate: field('Referral Date'),
        block: tidy(block),
      });
    }
    return { petitions, total: info ? Number(info[3]) : petitions.length, pages };
  }

  // The signature table: one numbered row per signer. The count is the highest number, not the rows (a page has other tables), and `last` is the
  // date of the newest signature (MM/DD/YYYY), which the table carries in a hidden span. `signers` is every row, in the order signed.
  function parseSignatures(html) {
    const at = String(html || '').indexOf('id="member-signatures"');
    if (at < 0) return null;
    const end = html.indexOf('</tbody>', at);
    const table = html.slice(at, end < 0 ? html.length : end);
    const signers = [];
    for (const row of table.split(/<tr\b/).slice(1)) {
      const no = row.match(/<td data-label="No\.">(\d+)\.<\/td>/);
      if (!no) continue;
      const cell = (label) => clean((row.match(new RegExp(`<td data-label="${label}">([\\s\\S]*?)</td>`)) || [])[1] || '');
      const who = row.match(/href="\/Members\/([A-Z]\d{6})"[^>]*>([\s\S]*?)<\/a>/);
      const abbr = (row.match(/<\/td>\s*<td style="display:none;">([A-Z]{2})<\/td>/) || [])[1] || null;
      const d = (row.match(/<span style="display:none;">(\d\d\/\d\d\/\d{4}) \d\d:\d\d:\d\d<\/span>/) || [])[1] || null;
      signers.push({
        n: Number(no[1]), id: who ? who[1] : null, name: who ? clean(who[2]) : cell('Representative'),
        state: abbr, stateName: cell('State'), district: cell('District'), party: cell('Party'), date: d,
      });
    }
    // the rows as the Clerk sent them, for a popover: hidden cells and the hidden date span out, attributes out, one row a line
    const rows = table.split(/<tr\b/).slice(1).filter((r) => /data-label="No\."/.test(r)).map((r) => '<tr' + r.replace(/<\/tr>[\s\S]*$/, '</tr>')
      .replace(/<td style="display:none;">[\s\S]*?<\/td>/g, '').replace(/<span style="display:none;">[^<]*<\/span>/g, '')
      .replace(/\s(?:class|style|title|tabindex|data-label)=(?:"[^"]*"|'[^']*')/g, '').replace(/\s+/g, ' ').replace(/ ?(<\/?(?:td|tr)[^>]*>) ?/g, '$1').replace(/&#xD;\s*/g, '')).join('\n');
    const nums = signers.map((x) => x.n);
    const dates = signers.map((x) => x.date).filter(Boolean);
    const key = (x) => x.slice(6) + x.slice(0, 2) + x.slice(3, 5);
    return { count: nums.length ? Math.max(...nums) : 0, last: dates.length ? dates.reduce((a, b) => (key(b) > key(a) ? b : a)) : null, signers, rows };
  }

  root.DischargePetitions = { NEEDED, parseList, parseSignatures };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DischargePetitions;
})(typeof globalThis !== 'undefined' ? globalThis : this);
