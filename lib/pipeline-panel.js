// The WAITING FOR THE FLOOR panel both boards carry: two columns, each scrolling on its own. Data: the Worker's /api/pipeline?board= (lib/pipeline.js sorts every bill of the Congress
// by its latest action; the Worker keeps the ones that match and updates them from Congress.gov).
//
//   PipelinePanel.mount({ base, board })    board: 'house' | 'senate'; loads now and every ten minutes (and every 12 s while the Worker is still filling in)
//
//   House board:  [Reported by committees: on the House calendar, waiting for a floor vote]   [From the Senate: Senate bills, and House bills the Senate AMENDED]
//   Senate board: [On the calendar: the Senate Legislative Calendar]                           [From the House: House-passed bills with no action since, and Senate bills the House AMENDED]
//
// A bill amended by the other chamber wears a clear mark, since it comes back for a vote on the amendment, which is not what a bill passed untouched asks for. Bill numbers open the
// board's own bill modal. The latest action is the only thing read, so "no action since" is the honest label.

(function (root) {
  const { escapeHtml: esc, setIfChanged } = root.BoardUtil;
  const LABELS = {
    house: {
      calendar: { head: 'Reported by committees', sub: 'On the House calendar, waiting for a floor vote' },
      from: { head: 'From the Senate', sub: 'Senate bills the House holds, and House bills the Senate amended' },
      other: 'Senate', amended: 'Amended by the Senate',
    },
    senate: {
      calendar: { head: 'On the calendar', sub: 'Placed on the Senate Legislative Calendar, waiting for floor time' },
      from: { head: 'From the House', sub: 'Passed the House, no action in the Senate since, and Senate bills the House amended' },
      other: 'House', amended: 'Amended by the House',
    },
  };

  function mount({ base, board }) {
    const L = LABELS[board];
    let data = null, tries = 0;
    const put = (id, v) => { const n = document.getElementById(id); if (n && n.textContent !== v) n.textContent = v; };

    // the same card as BILLS THIS WEEK (createBillCard in app.js, nominationCard in senate.js): the empty status ring (no vote has happened), the id row, the title, the latest
    // action and its date, the chevron; the calendar number and the chamber-of-origin mark sit in the id row; clicking opens the board's own bill modal
    const card = (b, col) => {
      const mark = b.tag === 'amended' ? `<span class="pipe-tag is-amended">${esc(L.amended)}</span>`
        : (board === 'house' && b.tag === 'senate-bill') ? '<span class="pipe-tag">Senate bill</span>'
        : (board === 'senate' && col === 'calendar' && b.tag === 'house-bill') ? '<span class="pipe-tag">House bill</span>' : '';
      return `<div class="bill-card-wrap">
        <button class="bill-card" data-bill-open="${esc(b.id)}" data-status="scheduled" type="button">
          <div class="bill-status scheduled" aria-hidden="true"></div>
          <div class="bill-info">
            <div class="bill-id-row"><span class="bill-id">${esc(b.id)}</span>${b.cal ? `<span class="bill-calendar-no">Cal. No. ${esc(String(b.cal))}</span>` : ''}${mark}</div>
            <div class="bill-title">${esc(b.ti)}</div>
            <div class="bill-meta"><div class="bill-action">${esc(b.a || '')}</div><div class="bill-date">${esc(root.BoardUtil.fmtIso(b.d))}</div></div>
          </div>
          <div class="bill-chevron gi gi-chev-right" aria-hidden="true"></div>
        </button>
      </div>`;
    };

    function render() {
      if (!data) return;
      for (const col of ['calendar', 'from']) {
        const list = document.getElementById(`pipeline-list-${col}`);
        const items = data[col] || [];
        put(`pipeline-count-${col}`, items.length ? String(items.length) : '');
        if (!list) continue;
        setIfChanged(list, items.length ? items.map((b) => card(b, col)).join('')
          : (data.complete ? '<div class="empty-note">Nothing waiting</div>' : '<div class="loading-indicator" role="status" aria-label="Loading"><i></i><i></i><i></i></div>'));
        if (root.ScrollFade) root.ScrollFade.watch(list);
      }
      put('pipeline-summary', data.complete ? '' : 'Loading');
    }

    const load = () => fetch(`${base}/pipeline?board=${board}`)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { data = d; render(); if (!d.complete && ++tries < 14) setTimeout(load, 12000); else tries = 0; })
      .catch(() => { for (const col of ['calendar', 'from']) { const l = document.getElementById(`pipeline-list-${col}`); if (l && !data) setIfChanged(l, '<div class="empty-note">Unavailable</div>'); } });

    for (const col of ['calendar', 'from']) {
      put(`pipeline-head-${col}`, L[col].head);
      const sub = document.getElementById(`pipeline-sub-${col}`); if (sub) sub.textContent = L[col].sub;
    }
    load();
    setInterval(load, 10 * 60 * 1000);
  }

  root.PipelinePanel = { mount };
})(globalThis);
