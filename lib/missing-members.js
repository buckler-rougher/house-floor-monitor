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
//     emptyText: 'ALL MEMBERS VOTED',
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
        m.classList.toggle('dim', !(mode === 'all' || m.dataset.filter === mode)));
      panel.querySelectorAll('.absentee-filter-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.filter === mode));
      list.dataset.filter = mode;
    }

    // Both the filter bar and the metric boxes. Matching only the buttons meant
    // clicking DEMOCRATS did nothing, which is most of the panel's surface.
    panel.addEventListener('click', (e) => {
      const target = e.target.closest('.absentee-filter-btn') || e.target.closest('.party-metric[data-filter]');
      const next = target && target.dataset.filter;
      if (!next) return;
      // Clicking the active party filter clears back to all.
      mode = globalThis.Segmented.next('filter', mode, next);
      const anim = globalThis.BoardAnimations;
      if (anim?.animateAbsenteeFilter) anim.animateAbsenteeFilter(paintFilter);
      else paintFilter();
    });

    function render({ members = [], info = '', emptyText = 'ALL MEMBERS VOTED' }) {
      const counts = { rep: 0, dem: 0, ind: 0 };
      for (const m of members) counts[m.party in counts ? m.party : 'ind']++;

      const set = (id, v) => { const n = $(id); if (n) n.textContent = v; };
      set('absentee-rep', counts.rep);
      set('absentee-dem', counts.dem);
      set('absentee-ind', counts.ind);
      set('absentee-total', members.length);
      const indMetric = $('absentee-ind-metric');
      if (indMetric) indMetric.style.display = counts.ind > 0 ? '' : 'none';
      const infoNode = $('absentee-roll-info');
      if (infoNode && info) infoNode.textContent = info;

      paintFilter();

      if (!members.length) {
        setIfChanged(list, `<div class="absentee-member">${esc(emptyText)}</div>`);
        return;
      }
      setIfChanged(list, members.map((m, i) => {
        const party = m.party in counts ? m.party : 'ind';
        const name = esc(m.name || 'Unknown');
        return `
        <div class="absentee-member ${party}" data-absentee-index="${i}">
            <div class="absentee-photo-wrap">
                <div class="absentee-photo-placeholder">${placeholder}</div>
                ${m.photoUrl ? `<img class="absentee-photo" src="${esc(m.photoUrl)}" alt="${name}" loading="lazy" onload="this.style.opacity='1'" onerror="this.remove()">` : ''}
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
