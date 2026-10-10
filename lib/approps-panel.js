// The APPROPRIATIONS panel both boards carry: the twelve regular bills of the fiscal year, each with how far it has got and, opened, the steps it took.
// Data: the Worker's /api/appropriations (the bills and their Congress.gov actions, lib/appropriations.js) and /api/appropriations-markups (the subcommittee and
// full committee markups of the House committee repository, read a stretch of days at a time, so it fills in over a few calls).
//
//   AppropsPanel.mount({ base })    base: the board's Worker API base; loads both now and again every ten minutes
//
// Five steps (the House's, as CRS's Appropriations Status Table lays them out, which the board does not read: it is behind a challenge no script passes): subcommittee approval, committee approval, passed the House, passed the
// Senate, law. Subcommittee and committee approval come from the markup meetings (the committee's report, which the actions show, also proves the committee
// approved it), so a bill whose markups the repository does not list still shows committee approval from its report. A markup's vote count is in a PDF, so
// each step links the roll call votes, it does not read them. Furthest along first, then the committee's order; four shown whole and the top of the fifth under a fade, a + to open the rest (lib/clamp-list.js).

(function (root) {
  const { escapeHtml: esc, setIfChanged } = root.BoardUtil;
  const SHOWN = 4;
  const STEPS = ['Subcommittee', 'Committee', 'Passed House', 'Passed Senate', 'Law'];
  let data = null, markups = null;
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

  // "CR IN EFFECT", the date, and the days left: the continuing resolution's end (lib/funding-deadline.js, read by the Worker from the law's own text). The law's bill
  // number opens its modal like every bill number here. Gone once the date has passed (a newer law may have replaced it, and the board cannot say), and absent when the
  // Worker could not read it.
  function deadline() {
    const el = document.getElementById('approps-deadline');
    if (!el) return;
    const f = data && data.funding;
    const left = f && root.FundingDeadline ? root.FundingDeadline.days(f.through, today()) : null;
    if (!f || left == null || left < 0) { el.hidden = true; return; }
    const when = new Date(f.through + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const urgency = left <= 3 ? ' is-urgent' : left <= 14 ? ' is-soon' : '';
    // how much of the resolution's stretch has gone: from the start of the fiscal year (1 October) to its end date
    const start = `${data.fiscalYear - 1}-10-01`;
    const span = root.FundingDeadline.days(f.through, start);
    const pct = span > 0 ? Math.max(0, Math.min(100, Math.round((1 - left / span) * 100))) : 0;
    const html = `<div class="cr-main">`
      + `<span class="cr-badge" title="${esc('Once a regular appropriations bill is enacted it replaces the resolution for the projects it covers.')}">CR in effect</span>`
      + `<div class="cr-text"><span class="cr-through">Funded through <b>${esc(when)}</b></span>`
      + `<span class="cr-law"><span class="cr-pl" title="${esc(`Enacted as ${f.bill}`)}">P.L. ${esc(f.law)}</span><span class="cr-law-name">${esc(f.title)}</span></span></div>`
      + `<div class="cr-clock${urgency}"><span class="cr-num">${left === 0 ? '0' : left}</span><span class="cr-unit">${left === 1 ? 'day left' : 'days left'}</span></div>`
      + `</div><div class="cr-bar${urgency}" role="img" aria-label="${pct}% of the period elapsed"><i style="width:${pct}%"></i></div>`;
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    el.hidden = false;
  }

  function render() {
    const list = document.getElementById('approps-list');
    if (!list || !data) return;
    const stages = data.stages;
    const rows = data.bills.map((b, i) => ({ b, i, v: view(b) })).sort((x, y) => (y.v.stage - x.v.stage) || (x.i - y.i));
    const put = (id, v) => { const n = document.getElementById(id); if (n && n.textContent !== v) n.textContent = v; };
    put('approps-label', `FY${data.fiscalYear} APPROPRIATIONS`);
    // where the twelve stand, as two counts: passed the House, enacted (0 is shown, it is the news). No Senate count: these bills start in the House, so once the Senate passes one it is next to enacted; enacted is green once there is one
    const n = rows.length, atLeast = (k) => rows.filter((r) => r.v.stage >= k).length;
    const tally = [['House', atLeast(3)], ['Enacted', atLeast(5)]]
      .map(([label, c]) => `<span class="approps-count${label === 'Enacted' && c ? ' is-law' : ''}"><span>${label}</span> <b>${c}</b><i>/${n}</i></span>`).join('');
    const sum = document.getElementById('approps-summary');
    if (sum && sum._html !== tally) { sum.innerHTML = tally; sum._html = tally; sum.title = `Of ${n} bills: passed the House, enacted`; }
    deadline();
    const item = ({ b, v }) => {
      const word = !b.known ? 'Not found' : stages[v.stage];
      const when = [null, v.sub && v.sub.date, b.reported || (v.full && v.full.date), b.housePassed, b.senatePassed, typeof b.law === 'string' && b.law.length >= 10 ? b.law : null][v.stage];
      const ms = milestones(b, v);
      const isOpen = open.has(b.id);
      return `
        <div class="approps-item">
            <div class="approps-top">
                <span class="approps-id"><span class="approps-name">${esc(b.short)}</span><button type="button" class="bill-open" data-bill-open="${esc(b.id)}" title="${esc(b.title || b.name)}">${esc(b.id)}</button></span>
                <span class="approps-stage${v.stage === 5 ? ' is-law' : ''}">${esc(word)}${when && b.known ? ` <span>${esc(date(when))}</span>` : ''}</span>
            </div>
            <div class="approps-track" role="img" aria-label="${esc(b.known ? `${word}: step ${v.stage} of 5` : 'Not found on Congress.gov')}">${STEPS.map((s, n) => `<i class="${n + 1 <= v.stage ? (v.stage === 5 ? 'is-law' : 'on') : ''}" title="${esc(s)}"></i>`).join('')}</div>
            ${b.latestAction ? `<div class="approps-action"><span>Latest action${b.latestActionDate ? `, ${esc(date(b.latestActionDate))}` : ''}:</span> ${esc(b.latestAction)}</div>` : ''}
            ${ms.length ? `<button type="button" class="committee-more" data-approps-ms="${esc(b.id)}" aria-expanded="${isOpen}">${isOpen ? 'Hide steps' : `Steps (${ms.length})`}</button>` : ''}
            ${isOpen ? `<div class="approps-ms">${ms.map((m) => `<div class="approps-ms-row"><span class="approps-ms-date">${esc(date(m.date))}</span><span class="approps-ms-what">${esc(m.label)}${m.detail ? ` <span>${esc(m.detail)}</span>` : ''}${m.links.length ? `<span class="approps-ms-links">${m.links.map((l) => `<a class="ext" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</span>` : ''}</span></div>`).join('')}</div>` : ''}
        </div>`;
    };
    // the four furthest along shown whole, the top of the fifth under a fade, a + to open the rest (lib/clamp-list.js)
    if (!list._clamp) { list.innerHTML = ''; root.ClampList.mount(list, { keep: SHOWN }); }
    root.ListSync.sync(list, rows.map((r) => ({ key: r.b.id, html: item(r) })));
    list._clamp.refresh();
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
      const ms = t.closest('[data-approps-ms]');
      if (ms) { const id = ms.dataset.appropsMs; if (open.has(id)) open.delete(id); else open.add(id); render(); }
    });
  }

  root.AppropsPanel = { mount, view, milestones };
})(globalThis);
