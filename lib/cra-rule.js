// A Congressional Review Act resolution names the rule it would overturn in its own title, and the Federal Register has that rule:
//
//   "Providing for congressional disapproval under chapter 8 of title 5, United States Code, of the rule submitted by the Internal Revenue Service
//    relating to "Gross Proceeds Reporting by Brokers That Regularly Provide Services Effectuating Digital Asset Sales"."
//
//   CraRule.parse(title)                 -> { agency, ruleTitle } | null          (null for any title that is not one)
//   CraRule.searchUrl(ruleTitle)         -> the Federal Register API search for documents of type RULE that contain that title
//   CraRule.pick(results, agency, ruleTitle) -> { url, title, date, agency } | null
//
// The Federal Register's search is full text, so a title matches many documents ("Negative Option Rule" turns up eleven); only a document whose own title IS
// the rule's title counts. Several can (a rule and a later correction or reissue): the agency named in the resolution narrows them (it can be a sub-agency, so
// it is matched against every agency on the document) and the earliest remaining is the rule as first published. Nothing exact is no link, not a guess.
// Congress.gov writes the quotes as ", '' or curly quotes.

(function (root) {
  const RE = /^Providing for congressional disapproval under chapter 8 of title 5, United States Code, of the rule submitted by (?:the )?(.+?) relating to (?:“|"|'')([\s\S]+?)(?:”|"|'')\s*\.?\s*$/i;
  const norm = (s) => String(s || '').toLowerCase().replace(/[‘’“”"']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  function parse(title) {
    const m = String(title || '').match(RE);
    return m ? { agency: m[1].trim(), ruleTitle: m[2].replace(/\s+/g, ' ').trim() } : null;
  }

  function searchUrl(ruleTitle) {
    const q = new URLSearchParams();
    q.set('conditions[term]', `"${String(ruleTitle).replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim()}"`);
    q.append('conditions[type][]', 'RULE');
    q.set('per_page', '50');
    for (const f of ['title', 'html_url', 'publication_date', 'agencies']) q.append('fields[]', f);
    return `https://www.federalregister.gov/api/v1/documents.json?${q.toString()}`;
  }

  function pick(results, agency, ruleTitle) {
    const exact = (results || []).filter((r) => norm(r.title) === norm(ruleTitle));
    if (!exact.length) return null;
    const names = (r) => (r.agencies || []).flatMap((a) => [a.name, a.raw_name]).map(norm);
    const byAgency = exact.filter((r) => names(r).some((n) => n && (n === norm(agency) || n.includes(norm(agency)) || norm(agency).includes(n))));
    const best = (byAgency.length ? byAgency : exact).sort((a, b) => String(a.publication_date).localeCompare(String(b.publication_date)))[0];
    return { url: best.html_url, title: best.title, date: best.publication_date, agency: ((best.agencies || [])[0] || {}).name || null };
  }

  root.CraRule = { parse, searchUrl, pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CraRule;
})(typeof globalThis !== 'undefined' ? globalThis : this);
