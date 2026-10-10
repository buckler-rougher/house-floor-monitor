// The Joint Committee on Taxation's publications for the 119th Congress, from its own XML feed:
//
//   https://www.jct.gov/publications-xml/xml/?name=119th%20Congress
//
//   JctPublications.parse(xml)        -> [{ title, date, summary, bill, link }]   only the ones that name a bill
//   JctPublications.latestFor(list, billId) -> the newest publication for that bill, or null
//
// Each <Publication> has a Title (JCX-2-25), a PublicationDate (M/D/YYYY h:mm:ss PM), a Description (HTML, entity-escaped twice: "&lt;br /&gt;" and
// "&amp;ldquo;"; its first line is the document's name), the Congress, a BillNumber ("H.R. 997", empty on a publication about no bill) and a Link. A
// markup description covers several bills but names one in BillNumber, so a bill's entry is the document that lists it there, nothing inferred.
// `bill` is the comparison key (H.R. 997 -> HR997), the same as lib/bill-id.js's. Whether a request from the Worker gets through is the host's call
// (curl is turned away with a challenge page), so an answer that is not this XML is null, not an empty list.

(function (root) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—' };
  const decode = (t) => String(t).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in entities ? entities[n.toLowerCase()] : m));
  const key = (s) => String(s || '').toUpperCase().replace(/[.\s]/g, '');
  const field = (block, tag) => decode((block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '').trim();

  function parse(xml) {
    xml = String(xml || '');
    if (!/<Publications[\s>]/.test(xml)) return null;
    const out = [];
    for (const block of xml.match(/<Publication>[\s\S]*?<\/Publication>/g) || []) {
      const bill = key(field(block, 'BillNumber'));
      if (!bill) continue;
      // the description is HTML inside the XML: decode once for the XML, then drop the markup and decode what it carried
      const first = decode(field(block, 'Description').split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      const d = field(block, 'PublicationDate').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      out.push({
        title: field(block, 'Title'), summary: first, bill, link: field(block, 'Link'),
        date: d ? `${d[3]}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}` : null,
      });
    }
    return out.filter((p) => /^https:\/\/www\.jct\.gov\//.test(p.link));
  }

  function latestFor(list, billId) {
    const k = key(billId);
    const mine = (list || []).filter((p) => p.bill === k).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return mine[0] || null;
  }

  // In a page: read the board's /jct-publications once, keep the list, and say what a bill's link and tooltip are. Until it has answered (or when it
  // cannot) there is no link; nothing waits on it.
  let list = [];
  function load(url) {
    if (typeof fetch !== 'function') return;
    fetch(url).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && Array.isArray(d.publications)) list = d.publications; }).catch(() => { /* no link */ });
  }
  function forBill(billId) {
    const p = latestFor(list, billId);
    return p ? { url: p.link, title: [p.title, p.summary].filter(Boolean).join(': ') } : { url: null, title: null };
  }

  root.JctPublications = { parse, latestFor, load, forBill };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.JctPublications;
})(typeof globalThis !== 'undefined' ? globalThis : this);
