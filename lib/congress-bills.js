// Reading a bill's committee action off Congress.gov: which action is the committee reporting it
// out, how that reads on a chip, and where its report PDF is. Shared by the House's bill meta
// and the Senate's bill endpoint, and a module of its own so test/congress-bills.test.js can run it
// on real action texts.

(function (root) {
  // "Ordered to be Reported" → "Reported by Committee xx – yy" / "Reported out of cmte by unanimous consent"
  function formatCommitteeReport(text) {
    const t = text || '';
    if (/unanimous consent/i.test(t)) return 'Reported out of cmte by unanimous consent';
    const m = t.match(/yeas? and nays?:\s*(\d+)\s*[-–]\s*(\d+)/i);
    if (m) return `Reported by Committee ${m[1]} – ${m[2]}`;
    if (/voice vote/i.test(t)) return 'Reported by Committee (voice vote)';
    return 'Reported by Committee';
  }

  // Which action in a bill's list is the committee reporting it out? Two kinds appear, and only one
  // carries the markup vote:
  //
  //   "Ordered to be Reported (Amended) by the Yeas and Nays: 30 - 0."
  //   "Reported by the Committee on Energy and Commerce. H. Rept. 119-286."
  //
  // Matching only the first missed every bill whose markup was not logged as a separate action --
  // H.R. 9615 was reported and still showed no committee vote and no Rice index. Prefer the
  // ordered-to-be-reported action, because it is the one with the tally, but fall back to the formal
  // report action so the bill at least reads as reported. The Senate words the second one "Reported
  // by Senator Cruz with an amendment ...", so that is a fallback too; it carries no tally, and the
  // result then reads as plain "Reported", never an invented count.
  function pickCommitteeReport(actions) {
    let ordered = null, fallback = null;
    for (const action of (actions || [])) {
      if (action.type !== 'Committee') continue;
      const text = action.text || '';
      if (!ordered && /ordered to be reported/i.test(text)) {
        ordered = { text: formatCommitteeReport(text), date: action.actionDate };
      } else if (!fallback && /reported\s+(?:\([^)]*\)\s+)?by\s+(?:the\s+committee|senator\b)/i.test(text)) {
        fallback = { text: formatCommitteeReport(text), date: action.actionDate };
      }
    }
    return ordered || fallback;
  }

  // A committee report's PDF, from the citation Congress.gov gives a bill.
  // "H. Rept. 119-632" -> https://www.congress.gov/119/crpt/hrpt632/CRPT-119hrpt632.pdf
  function committeeReportLink(citation) {
    const m = String(citation || '').match(/^(H|S)\.\s*Rept\.\s*(\d+)-(\d+)$/i);
    if (!m) return { citation: null, url: null };
    const slug = `${m[1].toLowerCase()}rpt${m[3]}`;
    return { citation, url: `https://www.congress.gov/${m[2]}/crpt/${slug}/CRPT-${m[2]}${slug}.pdf` };
  }

  root.CongressBills = { formatCommitteeReport, pickCommitteeReport, committeeReportLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CongressBills;
})(typeof globalThis !== 'undefined' ? globalThis : this);
