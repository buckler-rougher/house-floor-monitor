// The bill under debate: fills the Debate section both boards carry (the markup is the same in
// index.html and senate.html, ids `debate-*`). What differs is where the bill comes from; this takes
// one model and draws it, so the two panels cannot drift.
//
//   DebatePanel.fill({
//     id, title,
//     sponsor:   { name, party, loc, photoUrl, placeholder } | null,
//     support:   { D, R, I, total, cosponsorCount } | null,
//     committees, report, reportDate, formatDate,
//     summary,                                  // plain text, already decoded
//     linkClass,                                // 'rule' | 'suspension' | 'senate'
//     links: { text, report, memo, congress },
//   })
//
// The sections are the modal's own (lib/bill-sections.js) so a number or a chip reads the same in
// both places. The panel keeps its own wrappers, so each piece is drawn by BillSections and moved
// into them rather than redrawn here. A section with nothing to show is hidden, not left empty.
//
// Re-running with the same model changes nothing in the DOM, which matters: the House calls this on
// every 15 s poll and a rewritten sponsor photo would blink.

(() => {
  const $ = (id) => document.getElementById(id);
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
  const setIfChanged = (el, html) => { if (el && el.innerHTML !== html) el.innerHTML = html; };
  const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };

  // BillSections returns a whole section as a string; take the part this panel's markup wants.
  function parse(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content;
  }

  function fill(m) {
    setText($('debate-bill-title'), m.title || '—');
    setText($('debate-bill-id'), m.id || '');

    // Sponsor
    const sp = m.sponsor ? parse(globalThis.BillSections.sponsor(m.sponsor)).querySelector('.absentee-member') : null;
    setIfChanged($('debate-sponsor-inner'), sp ? sp.outerHTML : '');
    show($('debate-sponsor-section'), !!sp);

    // Support bar: the label, the bar and the counts of BillSections.support
    const su = m.support && m.support.total ? parse(globalThis.BillSections.support(m.support)) : null;
    if (su) {
      setText($('debate-support-label'), su.querySelector('.bill-modal-section-label').textContent);
      setIfChanged($('debate-support-bar'), su.querySelector('.bill-modal-support-bar').innerHTML);
      setIfChanged($('debate-support-labels'), su.querySelector('.bill-modal-support-labels').innerHTML);
    }
    show($('debate-support-section'), !!su);

    // Committees: chips, the report's vote on the first chip, the date to the right. "Referred to"
    // until a committee has reported.
    const co = parse(globalThis.BillSections.committees({
      committees: m.committees, report: m.report, reportDate: m.reportDate, formatDate: m.formatDate,
    }));
    const chips = co.querySelector('.bill-modal-committees');
    if (chips) {
      setIfChanged($('debate-committees-list'), chips.innerHTML);
      setText($('debate-committees-label'), m.report ? 'COMMITTEE' : 'REFERRED TO');
      const when = $('debate-committee-date');
      // The date shows whenever there is one, reported or not: a referral has a date too.
      if (when) {
        const d = m.reportDate && m.formatDate ? m.formatDate(m.reportDate) : '';
        setText(when, d);
        show(when, !!d);
      }
    }
    show($('debate-committees-section'), !!chips);

    // Summary (plain text; textContent keeps it inert)
    setText($('debate-bill-description'), m.summary || '');
    show($('debate-summary-section'), !!m.summary);

    // Links
    const L = m.links || {};
    const link = (id, url) => {
      const a = $(id);
      if (!a) return;
      if (url) { a.href = url; a.className = `bill-modal-link ${m.linkClass || ''}`.trim(); }
      show(a, !!url);
    };
    link('debate-link-text', L.text);
    link('debate-link-report', L.report);
    link('debate-link-sap', L.memo);
    link('debate-link-congress', L.congress);
    show($('debate-links-foot'), !!(L.text || L.report || L.memo || L.congress));
  }

  // The panel when there is no bill to show: just a title and an id, every section hidden.
  function bare({ id, title }) {
    setText($('debate-bill-title'), title || '—');
    setText($('debate-bill-id'), id || '—');
    for (const id of ['debate-sponsor-section', 'debate-support-section', 'debate-committees-section', 'debate-summary-section']) show($(id), false);
    show($('debate-links-foot'), false);
  }

  globalThis.DebatePanel = { fill, bare };
})();
