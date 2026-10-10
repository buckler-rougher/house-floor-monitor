// The twelve regular appropriations bills of a fiscal year and how far each has got.
//
//   Appropriations.discover(items)      -> { fiscalYear, bills: [{ short, name, number }] } | null   from Congress.gov's committee-bills entries
//   Appropriations.itemsOf(json)        -> the entries, however the answer is wrapped
//   Appropriations.FALLBACK_YEAR, Appropriations.FALLBACK   the FY2027 twelve, when discovery finds nothing
//   Appropriations.stage(actions, laws, committeeReports) -> { stage: 0..4, reported, housePassed, senatePassed, law }   dates (YYYY-MM-DD) or null
//   Appropriations.STAGES                ['Introduced', 'Reported', 'Passed House', 'Passed Senate', 'Law']
//
// THE LIST is found, not written: the House Appropriations Committee's bills are listed by Congress.gov (/committee/house/hsap00/bills), and the regular
// ones are told by their titles ("... Appropriations Act, 2027", or "Making appropriations for ... for the fiscal year ending September 30, 2027"), not
// the supplemental, continuing or rescission bills that come to the same committee. `discover` picks the newest fiscal year that has at least SET_MIN of its
// bills, so FY2028 takes over when its bills start appearing (the House committee reports them in the spring) and until then the panel stays on FY2027, which
// is still being enacted. FALLBACK is the FY2027 twelve, from CBO's "Report on the Status of Discretionary Appropriation Legislation, Fiscal Year 2027, U.S.
// House of Representatives" (as of 25 June 2026), used only when discovery returns nothing. A bill's progress is read from its own Congress.gov record, so
// a House bill whose text is enacted through another vehicle (a minibus, an omnibus) shows no "Law" here; its latest action line says what happened.
//
// The stage is the furthest of: reported by the committee, passed the House, passed the Senate, became law. Congress.gov actions: "Reported (Amended) by the
// Committee on Appropriations. H. Rept. 119-xxx." (type Committee), "Passed/agreed to in House: On passage Passed by the Yeas and Nays ..." and
// "Passed Senate with an amendment ..." (type Floor), "Became Public Law No: 119-xx." A rule's adoption ("Rule H. Res. 1377 passed House") is not passage.

(function (root) {
  const SET_MIN = 6;
  const FALLBACK_YEAR = 2027;
  const FALLBACK = [
    { short: 'Agriculture', name: 'Agriculture, Rural Development, Food and Drug Administration', number: 8646 },
    { short: 'Military Construction, VA', name: 'Military Construction, Veterans Affairs', number: 8469 },
    { short: 'Commerce, Justice, Science', name: 'Commerce, Justice, Science', number: 8845 },
    { short: 'Defense', name: 'Defense', number: 9495 },
    { short: 'Energy and Water', name: 'Energy and Water Development', number: 9022 },
    { short: 'Financial Services', name: 'Financial Services and General Government', number: 8495 },
    { short: 'Homeland Security', name: 'Homeland Security', number: 9310 },
    { short: 'Interior, Environment', name: 'Interior, Environment', number: 9171 },
    { short: 'Legislative Branch', name: 'Legislative Branch', number: 9010 },
    { short: 'Labor, HHS, Education', name: 'Labor, Health and Human Services, Education', number: 9260 },
    { short: 'State, National Security', name: 'National Security, Department of State', number: 8595 },
    { short: 'Transportation, HUD', name: 'Transportation, Housing and Urban Development', number: 9170 },
  ];
  const STAGES = ['Introduced', 'Reported', 'Passed House', 'Passed Senate', 'Law'];

  // The subcommittee a bill belongs to, as a short name, from its title (the full title is kept for the tooltip). Order matters: "Commerce, Justice, Science" before
  // "Justice", "Military Construction" before "Veterans".
  const SHORT = [
    [/military construction/i, 'Military Construction, VA'], [/commerce, justice, science/i, 'Commerce, Justice, Science'], [/agriculture/i, 'Agriculture'],
    [/energy and water/i, 'Energy and Water'], [/financial services/i, 'Financial Services'], [/homeland security/i, 'Homeland Security'],
    [/interior/i, 'Interior, Environment'], [/legislative branch/i, 'Legislative Branch'], [/labor, health|health and human services/i, 'Labor, HHS, Education'],
    [/national security, department of state|department of state|state, foreign operations/i, 'State, National Security'],
    [/transportation, housing/i, 'Transportation, HUD'], [/\bdefense\b/i, 'Defense'],
  ];
  // the order the committee and CRS's Appropriations Status Table list them in
  const ORDER = ['Agriculture', 'Commerce, Justice, Science', 'Defense', 'Energy and Water', 'Financial Services', 'Homeland Security', 'Interior, Environment', 'Legislative Branch', 'Labor, HHS, Education', 'Military Construction, VA', 'State, National Security', 'Transportation, HUD'];
  const shortName = (title) => { const m = SHORT.find(([re]) => re.test(title)); return m ? m[1] : null; };
  const fiscalYearOf = (title) => { const m = String(title || '').match(/appropriations act, (\d{4})|fiscal year ending september 30, (\d{4})/i); return m ? Number(m[1] || m[2]) : null; };
  const isRegular = (title) => fiscalYearOf(title) !== null && !/supplemental|continuing|rescission|disaster|emergency|extension/i.test(title) && shortName(title) !== null;

  // Congress.gov's committee-bills answer, however it is wrapped: the first list of objects that have a type and a number.
  function itemsOf(json) {
    const seen = [json];
    while (seen.length) {
      const x = seen.shift();
      if (Array.isArray(x)) { if (x.length && x.every((i) => i && typeof i === 'object' && 'number' in i && 'type' in i)) return x; seen.push(...x); }
      else if (x && typeof x === 'object') seen.push(...Object.values(x));
    }
    return [];
  }

  // items: committee-bills entries { congress, type, number, title, updateDate }. The newest fiscal year with at least SET_MIN subcommittees (else the one
  // with the most), one bill per subcommittee (the most recently updated), in the order of the subcommittees above.
  function discover(items) {
    const byYear = {};
    for (const i of items || []) {
      if (String(i.type).toUpperCase() !== 'HR' || !isRegular(i.title)) continue;
      const fy = fiscalYearOf(i.title), s = shortName(i.title);
      const cur = (byYear[fy] = byYear[fy] || {})[s];
      if (!cur || String(i.updateDate || '') > String(cur.updateDate || '')) byYear[fy][s] = i;
    }
    const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
    if (!years.length) return null;
    const full = years.find((y) => Object.keys(byYear[y]).length >= SET_MIN);
    const fy = full || years.sort((a, b) => Object.keys(byYear[b]).length - Object.keys(byYear[a]).length || b - a)[0];
    const order = ORDER;
    const bills = Object.entries(byYear[fy]).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([short, i]) => ({ short, congress: Number(i.congress) || null, name: String(i.title).replace(/ and Related Agencies Appropriations Act, \d{4}\.?$/i, '').replace(/ Appropriations Act, \d{4}\.?$/i, ''), number: Number(i.number) }));
    return { fiscalYear: fy, bills };
  }

  function stage(actions, laws, committeeReports) {
    const found = {};
    // oldest first, so the first of each kind is the first time it happened
    for (const a of [...(actions || [])].reverse()) {
      const text = String(a.text || '').trim();
      const t = text.toLowerCase();
      const date = a.actionDate || null;
      if (!found.reported && a.type === 'Committee' && /^reported\b/i.test(text)) found.reported = date;
      if (a.type === 'Floor') {
        const rule = /^H1L/i.test(a.actionCode || '') || /^rule\s+h\.?\s*res\./i.test(text);
        const failed = t.includes('failed') || t.includes('not agreed to') || t.includes('not passed');
        if (!found.housePassed && !rule && !failed && (/^passed\/agreed to in house/i.test(text) || /passed house|on passage passed|considered and passed|agreed to by/i.test(text))) found.housePassed = date;
        if (!found.senatePassed && !failed && /^passed senate|^passed\/agreed to in senate|^senate agreed to/i.test(text)) found.senatePassed = date;
      }
      if (!found.law && /^became public law/i.test(text)) found.law = date;
      if (!found.calendared && /^placed on the (union|house) calendar/i.test(text)) found.calendared = date;
    }
    // reported: the committee's report is on the record, or the bill was placed on a calendar (which is what reporting does)
    if (!found.reported && (committeeReports || []).length) found.reported = found.calendared || (actions && actions[0] && actions[0].actionDate) || null;
    if (!found.reported && found.calendared) found.reported = found.calendared;
    if (!found.law && (laws || []).length) found.law = (laws[0] && laws[0].date) || 'law';
    const out = { reported: found.reported || null, housePassed: found.housePassed || null, senatePassed: found.senatePassed || null, law: found.law || null };
    out.stage = out.law ? 4 : out.senatePassed ? 3 : out.housePassed ? 2 : out.reported ? 1 : 0;
    return out;
  }

  root.Appropriations = { SET_MIN, FALLBACK_YEAR, FALLBACK, STAGES, shortName, fiscalYearOf, isRegular, itemsOf, discover, stage };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Appropriations;
})(typeof globalThis !== 'undefined' ? globalThis : this);
