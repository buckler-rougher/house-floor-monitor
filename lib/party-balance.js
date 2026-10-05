// The PARTY BREAKDOWN panel: how many of each party, who controls, the bar, the vacancies.
//
// Shared by both boards. What differs is where the numbers come from (the House counts voting
// Members in the Clerk's MemberData XML and finds its vacancies in it; the Senate reads a roster
// the Worker has already counted) and how a vacancy is worded (the House names each former
// Member, the Senate says how many seats are unfilled). Each board maps what it has into one
// model and hands it over; what this owns is everything after: the counts, the control badge,
// the bar and which party is on the left, the vacancy list, and the date stamp.
//
//   PartyBalance.render({
//     counts: { R, D, I },     // members by party
//     total: 433,              // the TOTAL figure shown (voting members)
//     seats: 435,              // what the bar's widths are a share of: members plus vacancies
//     control: 'R' | 'D' | null,
//     vacancyCount: 2,
//     vacancyHtml: '<div class="vacancy-item">...</div>',   // the board's own rows
//     stamp: '02 September 2026',                           // already formatted
//   });
//
// A value the board does not have is shown as "--", never as a zero: "no data" and "none" are
// different claims.

(function (root) {
  const ID = {
    rep: 'party-rep', dem: 'party-dem', ind: 'party-ind', total: 'party-total',
    badge: 'majority-control-badge',
    repFill: 'rep-fill', demFill: 'dem-fill', indFill: 'ind-fill', vacFill: 'vac-fill',
    vacCount: 'vacancies-count', vacList: 'vacancies-list', vacSection: 'vacancies-section',
    stamp: 'party-breakdown-last-update',
  };

  function render(m, doc) {
    doc = doc || root.document;
    const el = (k) => doc.getElementById(ID[k]);
    const set = (k, v) => { const n = el(k); if (n) n.textContent = v; };
    const c = m.counts || {};
    const show = (n) => (n === null || n === undefined ? '--' : n);

    set('rep', show(c.R)); set('dem', show(c.D)); set('ind', show(c.I)); set('total', show(m.total));

    const badge = el('badge');
    if (badge) {
      if (m.control) {
        const full = m.control === 'R' ? 'REPUBLICAN' : m.control === 'D' ? 'DEMOCRATIC' : m.control;
        badge.textContent = `${full} CONTROL`;
        badge.className = `majority-badge ${String(m.control).toLowerCase()}-control`;
      } else {
        badge.className = 'majority-badge hidden';
      }
    }

    // Each fill is a share of the seats, vacancies included, so the bar stays whole if the
    // chamber ever changes size.
    const seats = m.seats || 1;
    const pct = (n) => `${((n || 0) / seats) * 100}%`;
    const fills = { repFill: c.R, demFill: c.D, indFill: c.I, vacFill: m.vacancyCount };
    for (const [k, n] of Object.entries(fills)) { const node = el(k); if (node) node.style.width = pct(n); }

    // The majority party is always on the left. appendChild moves a node that is already in
    // the bar, so re-appending in order is the reorder.
    const bar = el('repFill') && el('repFill').parentElement;
    if (bar) {
      const order = (c.D || 0) > (c.R || 0) ? ['demFill', 'repFill', 'indFill', 'vacFill'] : ['repFill', 'demFill', 'indFill', 'vacFill'];
      for (const k of order) { const node = el(k); if (node) bar.appendChild(node); }
    }

    set('vacCount', show(m.vacancyCount));
    const list = el('vacList');
    // setIfChanged, so an unchanged list is not rebuilt and nothing flickers.
    if (list && m.vacancyHtml !== undefined) (root.BoardUtil ? root.BoardUtil.setIfChanged(list, m.vacancyHtml) : (list.innerHTML = m.vacancyHtml));
    const sec = el('vacSection');
    if (sec && sec.classList) sec.classList.remove('hidden');

    if (m.stamp !== undefined) set('stamp', m.stamp);
  }

  root.PartyBalance = { render, ID };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PartyBalance;
})(typeof globalThis !== 'undefined' ? globalThis : this);
