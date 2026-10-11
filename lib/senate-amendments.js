// The AMENDMENTS tab of the Senate board's debate panel: the amendments offered to the measure the Senate is on, from Congress.gov (the Senate publishes no list of its
// own, and the board had none: the House's comes from the Rules Committee's XML, which has no Senate equivalent). Shared by the Worker (shape, status) and the board (the table).
//
//   SenateAmendments.status(latestActionText, proposed)  -> { kind: 'adopted' | 'failed' | 'submitted', label }   what happened to it, from Congress.gov's own latest action
//   SenateAmendments.shape(item, detail)                 -> { num, summary, status, kind, date, sponsor: { name, party, state } | null, cosponsors: [...], dot }   (detail.cosponsorList: the amendment's cosponsors)
//   SenateAmendments.mount({ base })                     the tab: SenateAmendments.show(billId) when the debate panel has a measure; hides the tab when there are none
//
// The kinds are the House table's (adopted / failed / submitted) so the same badges are drawn. An amendment with no action yet is "Submitted" (or "Proposed", when it has a
// proposed date: offered on the floor); one that "fell" (when another was adopted or tabled, or when cloture was invoked), was tabled or withdrawn did not pass, and says which.
// The sponsor is in the amendment's own record, not the list, so a row has none until that record has been read; the Worker says how many are still to read.

(function (root) {
  const tally = (t) => { const m = /(\d+)\s*-\s*(\d+)/.exec(t || ''); return m ? `${m[1]}-${m[2]}` : ''; };
  // short, so a badge fits its column: "Agreed (UC)", "Agreed (voice)", "Agreed 77-23"
  const how = (t) => (/unanimous consent/i.test(t) ? '(UC)' : /voice vote/i.test(t) ? '(voice)' : /yea-nay/i.test(t) && tally(t) ? tally(t) : '');

  function status(text, proposed) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return proposed ? { kind: 'submitted', label: 'Proposed' } : { kind: 'submitted', label: 'Submitted' };
    // "SA 6802 fell when SA 6801 was tabled" is about 6802, which fell; only a motion to table THIS amendment tabled it
    if (/\bfell\b/i.test(t)) return { kind: 'failed', label: 'Fell' };
    if (/motion to table[^.]*agreed to/i.test(t) || /laid on the table/i.test(t)) return { kind: 'failed', label: ['Tabled', how(t)].filter(Boolean).join(' ') };
    if (/withdrawn/i.test(t)) return { kind: 'failed', label: 'Withdrawn' };
    if (/not agreed to|not having achieved/i.test(t)) return { kind: 'failed', label: ['Not agreed', how(t)].filter(Boolean).join(' ') };
    if (/agreed to/i.test(t)) return { kind: 'adopted', label: ['Agreed', how(t)].filter(Boolean).join(' ') };
    return { kind: 'submitted', label: proposed ? 'Proposed' : 'Submitted' };
  }

  const day = (iso) => (/^\d{4}-\d\d-\d\d/.test(iso || '') ? iso.slice(0, 10) : null);

  function shape(item, detail) {
    const d = detail || {};
    const num = Number(d.number || (item && item.number));
    if (!num) return null;
    const la = d.latestAction || (item && item.latestAction) || null;
    const st = status(la && la.text, d.proposedDate);
    const sp = (d.sponsors || [])[0] || null;
    const person = (x) => ({ name: x.lastName ? `${x.lastName}` : String(x.fullName || '').replace(/^Sen\.\s*/, '').split(',')[0], party: x.party || '', state: x.state || '' });
    const sponsor = sp ? person(sp) : null;
    const cosponsors = (d.cosponsorList || []).map(person);
    // the dot is the AMENDMENT's party (its sponsor's, or purple when its sponsor and cosponsors are not all one party), as on the House table; the letters are each member's
    const parties = new Set([sponsor && sponsor.party, ...cosponsors.map((c) => c.party)].filter(Boolean));
    const dot = parties.size > 1 ? 'bipartisan' : sponsor ? (sponsor.party === 'R' ? 'rep' : sponsor.party === 'D' ? 'dem' : 'ind') : null;
    return {
      num,
      type: String(d.type || (item && item.type) || 'SAMDT'),
      summary: String(d.purpose || (item && item.purpose) || '').replace(/\s+/g, ' ').trim(),
      status: st.label,
      kind: st.kind,
      date: day(la && la.actionDate) || day(d.proposedDate) || day(d.submittedDate),
      sponsor,
      cosponsors,
      dot,
    };
  }

  // ---- the board's tab ----
  function mount({ base }) {
    const { escapeHtml: esc } = root.BoardUtil;
    const $ = (id) => document.getElementById(id);
    let bill = null, data = null, filter = 'all', sort = 'status', query = '', tries = 0, timer = null;
    const ORDER = { adopted: 0, submitted: 1, failed: 2 };
    const partyClass = (p) => (p === 'R' ? 'rep' : p === 'D' ? 'dem' : 'ind');   // the member's letter

    function table() {
      const body = $('debate-amendments-body');
      if (!body || !data) return;
      let rows = (data.amendments || []).slice();
      if (filter !== 'all') rows = rows.filter((a) => a.dot === filter);
      if (query) { const q = query.toLowerCase(); rows = rows.filter((a) => String(a.num).includes(q) || a.summary.toLowerCase().includes(q) || (a.sponsor && a.sponsor.name.toLowerCase().includes(q)) || (a.cosponsors || []).some((c) => c.name.toLowerCase().includes(q))); }
      rows.sort((a, b) => (sort === 'status' ? (ORDER[a.kind] - ORDER[b.kind]) || (a.num - b.num) : a.num - b.num));
      const who = (a) => {
        if (!a.sponsor) return '';
        const co = a.cosponsors || [];
        const names = co.map((c) => `${c.name} (${c.party}-${c.state})`).join(', ');
        return `<span class="amdt-sponsor-name">${esc(a.sponsor.name)} <span class="amdt-sponsor-party-tag ${partyClass(a.sponsor.party)}">${esc(a.sponsor.party || '?')}</span> <span class="amdt-sponsor-dist">${esc(a.sponsor.state)}</span>${co.length ? ` <span class="amdt-co" title="Cosponsors: ${esc(names)}">+${co.length}</span>` : ''}</span>`;
      };
      body.innerHTML = rows.length ? `
        <table class="amendments-table is-senate">
          <thead><tr><th>#</th><th>Sponsor</th><th>Summary</th><th>Status</th></tr></thead>
          <tbody>${rows.map((a) => `
            <tr>
              <td class="amdt-num"><span class="amdt-numwrap">${a.dot ? `<button class="amdt-party ${a.dot}" type="button" data-filter-party="${a.dot}" title="${a.dot === 'bipartisan' ? 'Bipartisan: sponsor and cosponsors from both parties' : 'Filter by party'}" aria-label="Filter by ${a.dot}"></button>` : ''}${esc(String(a.num))}</span></td>
              <td class="amdt-sponsors">${who(a)}</td>
              <td class="amdt-summary">${esc(a.summary)}</td>
              <td><span class="amdt-status-badge ${a.kind}">${esc(a.status)}</span></td>
            </tr>`).join('')}</tbody>
        </table>` : '<div class="bill-amendments-empty">No amendments match this filter.</div>';
    }

    function paint() {
      const nav = $('debate-panel-nav');
      const n = data ? (data.amendments || []).length : 0;
      if (nav) nav.style.display = n ? '' : 'none';
      const count = $('debate-amendments-count');
      if (count) count.textContent = n ? ` ${n}` : '';
      table();
    }

    function show(id) {
      if (id === bill) return;
      bill = id; data = null; tries = 0; clearTimeout(timer);
      // back to the bill's details until this measure's amendments are known
      $('debate-bill-panel') && ($('debate-bill-panel').style.display = '');
      $('debate-amendments-panel') && ($('debate-amendments-panel').style.display = 'none');
      document.querySelectorAll('#debate-panel-nav .bill-panel-nav-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.panel === 'bill'));
      paint();
      if (!id) return;
      const load = () => fetch(`${base}/senate/amendments?id=${encodeURIComponent(id)}`)
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((d) => {
          if (bill !== id) return;
          data = d; paint();
          if (d.pending && ++tries < 12) timer = setTimeout(load, 15000);
        })
        .catch(() => { /* the bill's details are right without the tab */ });
      load();
    }

    // the tab buttons, the party filter, the sort and the search of the panel (markup shared with the House's)
    document.addEventListener('click', (e) => {
      const nb = e.target.closest && e.target.closest('#debate-panel-nav .bill-panel-nav-btn');
      if (nb) {
        const which = nb.dataset.panel;
        document.querySelectorAll('#debate-panel-nav .bill-panel-nav-btn').forEach((b) => b.classList.toggle('is-active', b === nb));
        $('debate-bill-panel').style.display = which === 'bill' ? '' : 'none';
        $('debate-amendments-panel').style.display = which === 'amendments' ? '' : 'none';
        return;
      }
      const dotBtn = e.target.closest && e.target.closest('#debate-amendments-panel .amdt-party');
      if (dotBtn) { filter = root.Segmented.next('filter', filter, dotBtn.dataset.filterParty, 'all'); syncButtons(); table(); return; }
      const fb = e.target.closest && e.target.closest('#debate-amendments-panel .amdt-filter-btn');
      if (fb) { filter = root.Segmented.next('filter', filter, fb.dataset.filter, 'all'); syncButtons(); table(); return; }
      const sb = e.target.closest && e.target.closest('#debate-amendments-panel .amdt-sort-btn');
      if (sb) { sort = root.Segmented.next('sort', sort, sb.dataset.sort); syncButtons(); table(); }
    });
    const syncButtons = () => {
      document.querySelectorAll('#debate-amendments-panel .amdt-filter-btn').forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
      document.querySelectorAll('#debate-amendments-panel .amdt-sort-btn').forEach((b) => b.classList.toggle('active', b.dataset.sort === sort));
    };
    const input = document.querySelector('#debate-amendments-panel [data-amdt-search]');
    if (input) {
      if (root.SearchField) root.SearchField.mount(input, { fields: ['Number', 'Sponsor', 'Summary'], examples: [] });
      input.addEventListener('input', () => { query = input.value.trim(); table(); });
    }
    syncButtons();
    root.SenateAmendments.show = show;
  }

  root.SenateAmendments = { status, shape, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateAmendments;
})(typeof globalThis !== 'undefined' ? globalThis : this);
