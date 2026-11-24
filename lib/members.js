// MEMBERS: a modal that finds a House member and shows how often they miss votes.
//
//   Members.init({ roster })      roster: async () => Map(bioguideId -> { first, last, district })   (first names and districts; the roll call files carry only a surname)
//   Members.open()                the directory: search, party filter, sortable columns
//   Members.open(bioguideId)      straight to one member
//   Members.has()                 whether the data are there
//
// The numbers come from member-stats.json, built from the Clerk's roll call files by dev/build-member-stats.mjs. A member is counted only on the roll calls held while they sat (the
// Clerk lists a member on a roll only while in office), so a member who left, or arrived late, is never charged for votes they could not have cast. "Missed" is Not Voting.
// Days and weeks missed are ones where every roll they were listed on went unvoted. Party breaks are votes against their own party's majority on rolls where the two parties' majorities split.
//
// Nothing here predicts. It lays out the record (overall, the last ten rolls, the weekdays) so the reader can.
(function (root) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const PARTY = { D: 'dem', R: 'rep', I: 'ind' };
  const STATS_URL = 'member-stats.json';

  let opts = {}, data = null, loading = null, names = new Map(), ov = null, onKey = null, trap = null, opener = null;
  const st = { q: '', party: 'all', former: false, sort: 'missedPct', dir: -1, id: null };

  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    loading = fetch(STATS_URL, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(async (d) => {
        data = d;
        // Delegates and the Resident Commissioner (listed by the Clerk with the state "XX") vote only in Committee of the Whole, so a rate of "missed" means nothing for them
        d.members = d.members.filter((m) => m.state !== 'XX');
        try { if (opts.roster) names = (await opts.roster()) || new Map(); } catch (e) { names = new Map(); }
        d.members.forEach((m) => {
          // the roll calls end where the data do; today's roster says who is still a Member now
          if (names.size && m.active && !names.has(m.id)) { m.active = false; m.gone = true; }
          const n = names.get(m.id) || {};
          m.fn = n.first || ''; m.district = n.district || ''; m.info = n;   // (`first` and `last` on a record are the dates of its first and last roll call)
          m.full = n.official || (m.fn ? `${m.fn} ${m.name.replace(/\s*\([A-Z]{2}\)\s*$/, '')}` : m.name);
          m.search = `${m.full} ${m.name} ${m.state}`.toLowerCase();
        });
        return d;
      }).catch((e) => { loading = null; throw e; });
    return loading;
  }

  const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  const pct = (a, b) => (b ? (100 * a / b) : 0);
  const pf = (v) => (v >= 10 ? Math.round(v) : v.toFixed(1)) + '%';
  const photo = (id) => `<span class="mem-photo"><img src="https://bioguide.congress.gov/photo/${esc(id)}.jpg" alt="" loading="lazy" data-img="fade"></span>`;
  const seat = (m) => `${esc(m.party)}-${esc(m.state)}${m.district ? '-' + esc(m.district) : ''}`;
  const rollText = (r) => `${r.l ? esc(r.l) + ' · ' : ''}${esc(r.q || 'Vote')}`;

  // ── directory ──────────────────────────────────────────────────────────────
  const COLS = [
    { k: 'missedPct', label: 'Votes missed', title: 'Roll calls missed, of those held while they were a Member' },
    { k: 'daysMissed', label: 'Days', title: 'Voting days on which they missed every roll call' },
    { k: 'weeksMissed', label: 'Weeks', title: 'Voting weeks (Monday to Sunday) in which they missed every roll call' },
    { k: 'breakPct', label: 'Party breaks', title: 'On votes that split the parties, how often they voted against their own party' },
  ];
  // A Member with only a handful of roll calls (sworn in just before a resignation, say) has a percentage that means nothing: they sort below everyone with a real record, whatever the column.
const FEW = 20;
const cmp = (k, dir) => (a, b) => {
    if ((a.rolls < FEW) !== (b.rolls < FEW)) return a.rolls < FEW ? 1 : -1;
    const av = a[k] == null ? -1 : a[k], bv = b[k] == null ? -1 : b[k];
    if (k === 'daysMissed' || k === 'weeksMissed') { const ap = pct(a[k], a[k === 'daysMissed' ? 'days' : 'weeks']), bp = pct(b[k], b[k === 'daysMissed' ? 'days' : 'weeks']); if (ap !== bp) return (ap - bp) * dir; }
    return (av - bv) * dir || a.name.localeCompare(b.name);
  };
  function visible() {
    const q = st.q.trim().toLowerCase();
    return data.members.filter((m) => (st.former || m.active) && (st.party === 'all' || PARTY[m.party] === st.party) && (!q || m.search.includes(q))).sort(cmp(st.sort, st.dir));
  }
  function rowHtml(m) {
    const cells = [
      `<span class="mem-num">${m.missed}<i> / ${m.rolls}</i></span><b>${pf(m.missedPct)}</b>`,
      `<span class="mem-num">${m.daysMissed}<i> / ${m.days}</i></span>`,
      `<span class="mem-num">${m.weeksMissed}<i> / ${m.weeks}</i></span>`,
      m.breakPct == null ? '<span class="mem-dim">–</span>' : `<span class="mem-num">${pf(m.breakPct)}</span>`,
    ];
    return `<button type="button" class="mem-row ${PARTY[m.party] || ''}${m.active ? '' : ' is-former'}${m.rolls < FEW ? ' is-few' : ''}" title="${m.rolls < FEW ? 'Only ' + m.rolls + ' roll calls, too few for the percentages to mean much' : ''}" data-id="${esc(m.id)}">${photo(m.id)}<span class="mem-who"><b>${esc(m.full)}</b><i>${seat(m)}${m.active ? '' : m.gone ? ' · no longer a Member' : ' · left ' + fmtDate(m.last)}</i></span>${cells.map((c, i) => `<span class="mem-cell c${i}">${c}</span>`).join('')}</button>`;
  }
  function drawList() {
    const list = ov.querySelector('.mem-list'); if (!list) return;
    const rows = visible();
    list.innerHTML = rows.length ? rows.map(rowHtml).join('') : (root.EmptyState ? root.EmptyState.html({ shape: 'people', title: 'No Member matches your search', term: st.q }) : '<p class="mem-empty">No Member matches your search.</p>');
    ov.querySelector('.mem-count').textContent = `${rows.length} ${rows.length === 1 ? 'Member' : 'Members'}`;
    ov.querySelectorAll('.mem-th').forEach((th) => { const on = th.dataset.k === st.sort; th.classList.toggle('is-sorted', on); th.setAttribute('aria-sort', on ? (st.dir < 0 ? 'descending' : 'ascending') : 'none'); th.dataset.dir = on ? (st.dir < 0 ? '↓' : '↑') : ''; });
  }
  function directoryHtml() {
    return `<div class="mem-lede">${esc(String(data.rolls))} roll calls across ${esc(String(data.days))} voting days, through ${esc(fmtDate(data.through))}. A Member is counted only on the votes held while they served.</div>
      <div class="mem-tools">
        <input class="mem-search" type="search" placeholder="Search" aria-label="Search Members" autocomplete="off" spellcheck="false" value="${esc(st.q)}">
        <div class="bills-sort-switcher mem-parties">${['all', 'dem', 'rep', 'ind'].map((p) => `<button class="bills-sort-btn${st.party === p ? ' active' : ''}" data-party="${p}">${p === 'all' ? 'ALL' : p === 'dem' ? 'D' : p === 'rep' ? 'R' : 'I'}</button>`).join('')}</div>
        <button type="button" class="bills-sort-btn mem-former${st.former ? ' active' : ''}" aria-pressed="${st.former}" title="Include Members who have left the House">Former</button>
        <span class="mem-count"></span>
      </div>
      <div class="mem-head"><span></span><span>Member</span>${COLS.map((c, i) => `<button type="button" class="mem-th c${i}" data-k="${c.k}" title="${esc(c.title)}">${esc(c.label)}<em></em></button>`).join('')}</div>
      <div class="mem-list" role="list"></div>`;
  }

  // From the Clerk's roster (MemberData.xml), for a sitting Member: hometown, office, phone, and when they were sworn in. A former Member is not on it.
  function infoHtml(m) {
    const n = m.info || {};
    const rows = [['Hometown', n.town ? `${esc(n.town)}, ${esc(m.state)}` : ''], ['Office', esc(n.office || '')], ['Phone', esc(n.phone || '')], ['Sworn in', esc(n.sworn || '')]].filter((r) => r[1]);
    return rows.length ? `<dl class="mem-info">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : '';
  }

  // ── one member ─────────────────────────────────────────────────────────────
  function detailHtml(m) {
    const R = data.rollList;
    const lo = R.findIndex((r) => r.d >= m.first);
    let hi = -1; for (let i = R.length - 1; i >= 0; i--) if (R[i].d <= m.last) { hi = i; break; }
    const missed = new Set(m.missedAt);
    const last10 = []; for (let i = hi; i >= lo && last10.length < 10; i--) last10.unshift(i);
    const dayStat = DAYS.map((d, wd) => { let n = 0, x = 0; for (let i = lo; i <= hi; i++) { const dt = new Date(R[i].d + 'T12:00:00Z'); if (((dt.getUTCDay() + 6) % 7) !== wd) continue; n++; if (missed.has(i)) x++; } return { d, n, x, p: pct(x, n) }; });
    const top = Math.max(10, ...dayStat.map((s) => s.p));
    const list = (idx, id) => {
      const rows = [...idx].reverse();
      const show = rows.slice(0, 12);
      return `<ol class="mem-rolls" data-for="${id}">${show.map((i) => `<li><span class="mem-roll-n">${R[i].n}</span><span class="mem-roll-t">${rollText(R[i])}${R[i].t ? `<small>${esc(R[i].t)}</small>` : ''}</span><span class="mem-roll-d">${fmtDate(R[i].d)}</span></li>`).join('')}</ol>${rows.length > show.length ? `<button type="button" class="mem-more" data-more="${id}">Show ${rows.length - show.length} more</button>` : ''}`;
    };
    const cards = [
      ['Votes missed', pf(m.missedPct), `${m.missed} of ${m.rolls} roll calls`],
      ['Days missed', `${m.daysMissed}`, `of ${m.days} voting days`],
      ['Weeks missed', `${m.weeksMissed}`, `of ${m.weeks} voting weeks`],
      ['Party breaks', m.breakPct == null ? '–' : pf(m.breakPct), m.breakPct == null ? 'not scored' : `${m.breaks} of ${m.unityScored} party-split votes`],
    ];
    return `<button type="button" class="mem-back">← All Members</button>
      <div class="mem-id">${photo(m.id).replace('mem-photo', 'mem-photo is-big')}<div><h2>${esc(m.full)}</h2><p class="${PARTY[m.party] || ''}">${seat(m)}${m.active ? '' : m.gone ? ` · no longer a Member (last roll in this data: ${fmtDate(m.last)})` : ` · served ${fmtDate(m.first)} to ${fmtDate(m.last)}`}</p>
        ${infoHtml(m)}<a class="mem-ext ext" href="https://clerk.house.gov/members/${esc(m.id)}" target="_blank" rel="noopener">Clerk profile</a></div></div>
      <div class="mem-cards">${cards.map(([a, b, c]) => `<div class="mem-card"><span>${a}</span><b>${b}</b><i>${c}</i></div>`).join('')}</div>
      <h3 class="mem-h">Last ${last10.length} roll calls</h3>
      <div class="mem-last" title="Red: not voting. Green: voted.">${last10.map((i) => `<span class="${missed.has(i) ? 'x' : 'v'}" title="Roll ${R[i].n}, ${esc(fmtDate(R[i].d))}: ${missed.has(i) ? 'not voting' : 'voted'}"></span>`).join('')}</div>
      <h3 class="mem-h">Votes missed by weekday</h3>
      <div class="mem-wd">${dayStat.map((s) => `<div title="${s.x} of ${s.n} roll calls"><span class="bar"><s style="height:${(100 * s.p / top).toFixed(0)}%"></s></span><b>${s.n ? pf(s.p) : '–'}</b><i>${s.d}</i></div>`).join('')}</div>
      <h3 class="mem-h">Roll calls missed <em>${m.missed}</em></h3>${m.missed ? list(m.missedAt, 'missed') : '<p class="mem-none">None.</p>'}
      <h3 class="mem-h">Voted against their party <em>${m.breaks}</em></h3>${m.breaks ? list(m.breakAt, 'breaks') : '<p class="mem-none">None on a party-split vote.</p>'}`;
  }

  // ── the modal ──────────────────────────────────────────────────────────────
  function render() {
    const body = ov.querySelector('.mem-body');
    if (st.id) { const m = data.members.find((x) => x.id === st.id); body.innerHTML = m ? detailHtml(m) : directoryHtml(); if (!m) st.id = null; }
    else body.innerHTML = directoryHtml();
    ov.querySelector('.mem-title').textContent = st.id ? 'MEMBER' : 'MEMBERS';
    if (!st.id) { drawList(); if (root.SearchField) { const f = root.SearchField.mount(body.querySelector('.mem-search'), { fields: ['Name', 'State'], examples: root.SearchField.sample(data.members.map((m) => m.fn ? m.name.replace(/\s*\(.*$/, '') : m.name), 12) }); } }
    body.scrollTop = 0;
  }

  function close() {
    if (!ov) return;
    const o = ov; ov = null;
    o.classList.remove('is-open'); setTimeout(() => o.remove(), 220);
    document.removeEventListener('keydown', onKey);
    if (trap) { trap.release(); trap = null; }
    if (opener && opener.focus) try { opener.focus(); } catch (e) {}
  }

  async function open(id) {
    if (ov) { if (id) { st.id = id; render(); } return; }
    opener = document.activeElement;
    st.id = id || null;
    ov = document.createElement('div');
    ov.className = 'tm-picker-overlay mem-overlay';
    ov.innerHTML = `<div class="tm-picker mem-dialog" role="dialog" aria-modal="true" aria-label="Members"><div class="tm-picker-head"><span class="tm-picker-title mem-title">MEMBERS</span><button type="button" class="tm-picker-close" aria-label="Close"></button></div><div class="mem-body"><p class="mem-lede">Loading…</p></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') e.target.remove(); }, true);   // a Member without a photo shows the empty frame
    requestAnimationFrame(() => ov && ov.classList.add('is-open'));
    onKey = (e) => { if (e.key === 'Escape') { if (st.id && !id) { st.id = null; render(); } else close(); } };
    document.addEventListener('keydown', onKey);
    if (root.FocusTrap) trap = root.FocusTrap.activate(ov.querySelector('.mem-dialog'), { initial: '.tm-picker-close' });
    ov.querySelector('.tm-picker-close').addEventListener('click', close);
    ov.addEventListener('click', (e) => {
      if (e.target === ov) return close();
      const t = e.target;
      const row = t.closest('.mem-row'); if (row) { st.id = row.dataset.id; render(); return; }
      if (t.closest('.mem-back')) { st.id = null; render(); return; }
      const p = t.closest('[data-party]'); if (p) { st.party = require_next(p.dataset.party); ov.querySelectorAll('[data-party]').forEach((b) => b.classList.toggle('active', b.dataset.party === st.party)); drawList(); return; }
      if (t.closest('.mem-former')) { st.former = !st.former; const b = t.closest('.mem-former'); b.classList.toggle('active', st.former); b.setAttribute('aria-pressed', st.former); drawList(); return; }
      const th = t.closest('.mem-th'); if (th) { if (st.sort === th.dataset.k) st.dir = -st.dir; else { st.sort = th.dataset.k; st.dir = -1; } drawList(); return; }
      const more = t.closest('[data-more]'); if (more) { const m = data.members.find((x) => x.id === st.id); const idx = more.dataset.more === 'missed' ? m.missedAt : m.breakAt; const R = data.rollList; const ol = ov.querySelector(`.mem-rolls[data-for="${more.dataset.more}"]`); ol.innerHTML = [...idx].reverse().map((i) => `<li><span class="mem-roll-n">${R[i].n}</span><span class="mem-roll-t">${rollText(R[i])}${R[i].t ? `<small>${esc(R[i].t)}</small>` : ''}</span><span class="mem-roll-d">${fmtDate(R[i].d)}</span></li>`).join(''); more.remove(); }
    });
    ov.addEventListener('input', (e) => { if (e.target.classList.contains('mem-search')) { st.q = e.target.value; drawList(); } });
    try { await load(); } catch (e) {
      if (ov) ov.querySelector('.mem-body').innerHTML = root.EmptyState ? root.EmptyState.error('Member data is unavailable', 'The vote history could not be loaded. Check back shortly.', 'rows') : '<p class="mem-lede">Member data is unavailable.</p>';
      return;
    }
    if (ov) { render(); if (!st.id) { const s = ov.querySelector('.mem-search'); if (s) s.focus(); } }
  }
  function require_next(p) { return root.Segmented ? root.Segmented.next('filter', st.party, p) : p; }

  function init(o) {
    opts = o || {};
    document.addEventListener('click', (e) => { const b = e.target.closest('#members-btn'); if (b) { e.preventDefault(); open(); } });
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      e.preventDefault(); open();
    });
  }

  root.Members = { init, open, close, has: () => !!data };
})(typeof globalThis !== 'undefined' ? globalThis : this);
