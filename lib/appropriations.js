// The twelve regular appropriations bills of a fiscal year and how far each has got.
//
//   Appropriations.FISCAL_YEAR, Appropriations.BILLS   [{ short, name, number }]   the House's twelve H.R. bills
//   Appropriations.stage(actions, laws)  -> { stage: 0..4, reported, housePassed, senatePassed, law }   dates (YYYY-MM-DD) or null
//   Appropriations.STAGES                ['Introduced', 'Reported', 'Passed House', 'Passed Senate', 'Law']
//
// THE LIST is the House Committee on Appropriations' bills for the year, taken from CBO's "Report on the Status of Discretionary Appropriation Legislation,
// Fiscal Year 2027, U.S. House of Representatives" (as of 25 June 2026), which names the twelve with their numbers. It is written down here, not found: nothing
// machine-readable lists them, and a new year needs a new list (see AGENTS.md). A bill's progress is read from its own Congress.gov record, so a House bill
// whose text is enacted through another vehicle (a minibus, an omnibus) shows no "Law" here; its latest action line says what happened.
//
// The stage is the furthest of: reported by the committee, passed the House, passed the Senate, became law. Congress.gov actions: "Reported (Amended) by the
// Committee on Appropriations. H. Rept. 119-xxx." (type Committee), "Passed/agreed to in House: On passage Passed by the Yeas and Nays ..." and
// "Passed Senate with an amendment ..." (type Floor), "Became Public Law No: 119-xx." A rule's adoption ("Rule H. Res. 1377 passed House") is not passage.

(function (root) {
  const FISCAL_YEAR = 2027;
  const BILLS = [
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

  function stage(actions, laws) {
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
    }
    if (!found.law && (laws || []).length) found.law = (laws[0] && laws[0].date) || 'law';
    const out = { reported: found.reported || null, housePassed: found.housePassed || null, senatePassed: found.senatePassed || null, law: found.law || null };
    out.stage = out.law ? 4 : out.senatePassed ? 3 : out.housePassed ? 2 : out.reported ? 1 : 0;
    return out;
  }

  root.Appropriations = { FISCAL_YEAR, BILLS, STAGES, stage };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Appropriations;
})(typeof globalThis !== 'undefined' ? globalThis : this);
