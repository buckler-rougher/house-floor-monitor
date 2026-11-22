// The MISSING MEMBERS panel: who did not vote on the last roll call, by party, with
// a party filter.
//
// Shared by both boards. Where the data comes from is entirely different (the
// House reads the Clerk's roll call XML, the Senate its own per-vote file joined to
// the roster by the Worker), so none of that is here. Each board maps what it has
// into one row shape and hands it over; what this owns is everything that happens
// after: the counts, the roll line, the rows, and the filter.
//
//   const panel = MissingMembers.init({ panel, list, placeholder });
//   panel.render({
//     members: [{ party: 'rep'|'dem'|'ind', name, state, photoUrl, badge }],
//     info:    'Roll 314 • 16 September 2026 7:05 PM',   // formatted by the board
//     emptyText: 'All Members voted',
//   });
//
// `badge` is optional text for a small status chip on the row (the House uses it
// for a member who has died in office).
//
// Filtering is a CSS attribute on the list (.absentee-list[data-filter]), never a
// rebuild: rebuilding destroyed and recreated every surviving row, which refetched
// and flashed the photos, and made D and R animate differently depending on how
// many rows happened to survive. See lib/animations.js.

(() => {
  const { escapeHtml: esc, setIfChanged } = globalThis.BoardUtil;
  const LETTER = { rep: 'R', dem: 'D', ind: 'I' };
  const CLASS = { rep: 'republican', dem: 'democrat', ind: 'independent' };

  function init({ panel, list, placeholder = '' }) {
    if (!panel || !list) return null;
    const $ = (id) => document.getElementById(id);
    let mode = 'all';            // 'all' | 'rep' | 'dem' | 'ind'

    // The filter's visible state: which button is active, which metric boxes dim
    // (every box but the selected one, and the total dims too once a party is
    // chosen), and the attribute the stylesheet hides rows by.
    function paintFilter() {
      panel.querySelectorAll('.party-metric[data-filter]').forEach((m) =>
        { m.classList.toggle('dim', !(mode === 'all' || m.dataset.filter === mode)); m.setAttribute('aria-pressed', String(m.dataset.filter === mode)); });
      panel.querySelectorAll('.bills-sort-btn[data-filter]').forEach((b) =>
        b.classList.toggle('active', b.dataset.filter === mode));
      list.dataset.filter = mode;
    }

    // Both the filter bar and the metric boxes. Matching only the buttons meant
    // clicking DEMOCRATS did nothing, which is most of the panel's surface.
    panel.addEventListener('click', (e) => {
      const target = e.target.closest('.bills-sort-btn[data-filter]') || e.target.closest('.party-metric[data-filter]');
      const next = target && target.dataset.filter;
      if (!next) return;
      // Clicking the active party filter clears back to all.
      mode = globalThis.Segmented.next('filter', mode, next);
      const anim = globalThis.BoardAnimations;
      if (anim?.animateAbsenteeFilter) anim.animateAbsenteeFilter(paintFilter);
      else paintFilter();
    });

    // The I count box and I filter button are there whenever the chamber has independents (the Balance of Power panel says how many: lib/party-balance.js), and also whenever one is missing.
    let lastCounts = { rep: 0, dem: 0, ind: 0 };
    const paintInd = () => {
      const show = lastCounts.ind > 0 || globalThis.__chamberIndependents > 0;
      const indMetric = $('absentee-ind-metric');
      if (indMetric) indMetric.style.display = show ? '' : 'none';
      const indBtn = $('absentee-ind-btn');
      if (indBtn) indBtn.style.display = show ? '' : 'none';
      if (!show && mode === 'ind') { mode = 'all'; paintFilter(); }
    };
    document.addEventListener('chamber-independents', paintInd);
    paintInd();

    function render({ members = [], info = '', emptyText = 'All Members voted', who = 'Members' }) {
      const counts = { rep: 0, dem: 0, ind: 0 };
      for (const m of members) counts[m.party in counts ? m.party : 'ind']++;

      const set = (id, v) => { const n = $(id); if (n) n.textContent = v; };
      set('absentee-rep', counts.rep);
      set('absentee-dem', counts.dem);
      set('absentee-ind', counts.ind);
      set('absentee-total', members.length);
      lastCounts = counts;
      paintInd();
      const infoNode = $('absentee-roll-info');
      if (infoNode && info) infoNode.textContent = info;

      paintFilter();

      if (!members.length) {
        setIfChanged(list, globalThis.EmptyState ? globalThis.EmptyState.allVoted({ who, roll: info, parties: globalThis.__chamberParties }) : `<div class="absentee-member is-empty">${esc(emptyText)}</div>`);
        return;
      }
      setIfChanged(list, members.map((m, i) => {
        const party = m.party in counts ? m.party : 'ind';
        const name = esc(m.name || 'Unknown');
        return `
        <div class="absentee-member ${party}" data-absentee-index="${i}">
            <div class="absentee-photo-wrap">
                <div class="absentee-photo-placeholder">${placeholder}</div>
                ${m.photoUrl ? `<img class="absentee-photo" src="${esc(m.photoUrl)}" alt="${name}" loading="lazy" data-img="fade-remove">` : ''}
            </div>
            <div class="absentee-meta">
                <span class="absentee-name">${name}</span>
                <span class="absentee-party-tag ${CLASS[party]}">${LETTER[party]}</span>
                <span class="absentee-state">${esc(m.state || '')}</span>
                ${m.badge ? `<span class="absentee-casualty-status">${esc(m.badge)}</span>` : ''}
            </div>
        </div>`;
      }).join(''));
    }

    paintFilter();
    return { render, get filter() { return mode; } };
  }

  globalThis.MissingMembers = { init };
})();
