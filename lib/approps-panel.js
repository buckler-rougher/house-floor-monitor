// The APPROPRIATIONS panel both boards carry: the twelve regular bills of the fiscal year, each with how far it has got and, opened, the steps it took.
// Data: the Worker's /api/appropriations (the bills and their Congress.gov actions, lib/appropriations.js) and /api/appropriations-markups (the subcommittee and
// full committee markups of the House committee repository, read a stretch of days at a time, so it fills in over a few calls).
//
//   AppropsPanel.mount({ base })    base: the board's Worker API base; loads both now and again every ten minutes
//
// Five steps, as Congress.gov's Appropriations Status Table (CRS) has them for the House: subcommittee approval, committee approval, passed the House, passed the
// Senate, law. Subcommittee and committee approval come from the markup meetings (the committee's report, which the actions show, also proves the committee
// approved it), so a bill whose markups the repository does not list still shows committee approval from its report. A markup's vote count is in a PDF, so
// each step links the roll call votes, it does not read them. Furthest along first, then the committee's order; four shown behind a button.

(function (root) {
  const { escapeHtml: esc, setIfChanged } = root.BoardUtil;
  const SHOWN = 4;
  const STEPS = ['Subcommittee', 'Committee', 'Passed House', 'Passed Senate', 'Law'];
  let data = null, markups = null, all = false;
  const open = new Set();

  const date = (iso) => (iso && /^\d{4}-\d\d-\d\d/.test(iso) ? new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });   // YYYY-MM-DD

  // The markups that have happened for one bill, and the stage they and the actions together prove (0 to 5).
  function view(b) {
    const ev = ((markups && markups.events) || []).filter((e) => (e.shorts || []).includes(b.short) && e.date <= today());
    const sub = ev.filter((e) => e.kind === 'subcommittee').sort((x, y) => x.date.localeCompare(y.date))[0] || null;
    const full = ev.filter((e) => e.kind === 'full').sort((x, y) => x.date.localeCompare(y.date))[0] || null;
    const stage = Math.max(b.stage, sub ? 1 : 0, full ? 2 : 0, sub && b.stage >= 2 ? 2 : 0);
    // a bill reported has been through the committee, and so through its subcommittee
    const eff = b.stage >= 2 ? Math.max(stage, 2) : stage;
    return { sub, full, stage: eff };
  }

  function milestones(b, v) {
    const doc = (url, label) => (url ? { label, url } : null);
    const out = [];
    if (v.sub) out.push({ date: v.sub.date, label: 'Subcommittee markup', detail: null, links: [doc(v.sub.docs && v.sub.docs.votes, 'Roll call votes'), doc(v.sub.url, 'Meeting')].filter(Boolean) });
    if (v.full) out.push({ date: v.full.date, label: 'Full committee markup', detail: null, links: [doc(v.full.docs && v.full.docs.votes, 'Roll call votes'), doc(v.full.docs && v.full.docs.amendments, 'Amendments'), doc(v.full.url, 'Meeting')].filter(Boolean) });
    for (const m of b.milestones || []) out.push({ date: m.date, label: m.label, detail: m.detail, links: [doc(m.url, 'Report')].filter(Boolean) });
    return out.sort((x, y) => String(x.date).localeCompare(String(y.date)));
  }

  function render() {
    const list = document.getElementById('approps-list');
    if (!list || !data) return;
    const stages = data.stages;
    const rows = data.bills.map((b, i) => ({ b, i, v: view(b) })).sort((x, y) => (y.v.stage - x.v.stage) || (x.i - y.i));
    const shown = all ? rows : rows.slice(0, SHOWN);
    const put = (id, v) => { const n = document.getElementById(id); if (n && n.textContent !== v) n.textContent = v; };
    put('approps-label', `FY${data.fiscalYear} APPROPRIATIONS`);
    const passed = rows.filter((r) => r.v.stage >= 3).length;
    put('approps-summary', `${passed} of ${rows.length} passed the House`);
    const item = ({ b, v }) => {
      const word = !b.known ? 'Not found' : stages[v.stage];
      const when = [null, v.sub && v.sub.date, b.reported || (v.full && v.full.date), b.housePassed, b.senatePassed, typeof b.law === 'string' && b.law.length >= 10 ? b.law : null][v.stage];
      const ms = milestones(b, v);
      const isOpen = open.has(b.id);
      return `
        <div class="approps-item">
            <div class="approps-top">
                <span class="approps-id"><span class="approps-name">${esc(b.short)}</span><a href="${esc(b.url)}" target="_blank" rel="noopener" title="${esc(b.title || b.name)}">${esc(b.id)}</a></span>
                <span class="approps-stage${v.stage === 5 ? ' is-law' : ''}">${esc(word)}${when && b.known ? ` <span>${esc(date(when))}</span>` : ''}</span>
            </div>
            <div class="approps-track" role="img" aria-label="${esc(b.known ? `${word}: step ${v.stage} of 5` : 'Not found on Congress.gov')}">${STEPS.map((s, n) => `<i class="${n + 1 <= v.stage ? (v.stage === 5 ? 'is-law' : 'on') : ''}" title="${esc(s)}"></i>`).join('')}</div>
            ${b.latestAction ? `<div class="approps-action"><span>Latest action${b.latestActionDate ? `, ${esc(date(b.latestActionDate))}` : ''}:</span> ${esc(b.latestAction)}</div>` : ''}
            ${ms.length ? `<button type="button" class="committee-more" data-approps-ms="${esc(b.id)}" aria-expanded="${isOpen}">${isOpen ? 'Hide steps' : `Steps (${ms.length})`}</button>` : ''}
            ${isOpen ? `<div class="approps-ms">${ms.map((m) => `<div class="approps-ms-row"><span class="approps-ms-date">${esc(date(m.date))}</span><span class="approps-ms-what">${esc(m.label)}${m.detail ? ` <span>${esc(m.detail)}</span>` : ''}${m.links.length ? `<span class="approps-ms-links">${m.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</span>` : ''}</span></div>`).join('')}</div>` : ''}
        </div>`;
    };
    const rest = rows.length - shown.length;
    const entries = shown.map((r) => ({ key: r.b.id, html: item(r) }));
    if (rows.length > SHOWN) entries.push({ key: 'toggle', tail: true, html: `<button type="button" class="dp-toggle" id="approps-toggle">${all ? 'Show fewer' : `Show ${rest} more bill${rest === 1 ? '' : 's'}`}</button>` });
    root.ListSync.sync(list, entries);
  }

  // The markups are asked for the stretch of days the bills' own dates point to: from two weeks before the earliest report (or six weeks back, before any bill is
  // reported) to the latest report (or a week ahead while a bill is still to be reported). It answers a stretch at a time; ask again until it says it is complete.
  function markupRange() {
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const now = Date.now();
    const reported = data.bills.map((b) => b.reported).filter(Boolean).sort();
    const from = reported.length ? day(Date.parse(reported[0] + 'T00:00:00Z') - 14 * 86400000) : day(now - 45 * 86400000);
    const pending = data.bills.some((b) => b.stage < 2);
    const to = pending || !reported.length ? day(now + 7 * 86400000) : reported[reported.length - 1];
    return { from, to: to < from ? from : to };
  }

  function mount({ base }) {
    let tries = 0;
    const loadMarkups = () => {
      if (!data) return;
      const { from, to } = markupRange();
      fetch(`${base}/appropriations-markups?fy=${data.fiscalYear}&from=${from}&to=${to}`)
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((d) => { markups = d; render(); if (!d.complete && ++tries < 14) setTimeout(loadMarkups, 15000); else tries = 0; })
        .catch(() => { /* the panel is right without them: the steps come from the actions */ });
    };
    const load = () => fetch(`${base}/appropriations`).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { data = d; render(); loadMarkups(); })
      .catch(() => { const l = document.getElementById('approps-list'); if (l && !data) setIfChanged(l, '<div class="empty-note">Appropriations unavailable</div>'); });
    load();
    setInterval(load, 10 * 60 * 1000);
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.id === 'approps-toggle') { all = !all; render(); }
      const ms = t.closest('[data-approps-ms]');
      if (ms) { const id = ms.dataset.appropsMs; if (open.has(id)) open.delete(id); else open.add(id); render(); }
    });
  }

  root.AppropsPanel = { mount, view, milestones };
})(globalThis);
