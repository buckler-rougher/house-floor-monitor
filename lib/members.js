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
  // One snapshot per Congress (member-stats-119.json, built by dev/build-member-stats.mjs), then whatever roll calls the Clerk has published since, added from /api/member-rolls. The Congress is the
  // one in session by the date (the 120th begins on 3 January 2027, with no snapshot: it starts empty and fills as roll calls are held). On the staging sites ?congress=120 shows how that looks.
  const congressByDate = () => { const n = new Date(), y = n.getFullYear(), eff = n.getMonth() > 0 || n.getDate() >= 3 ? y : y - 1, start = eff % 2 === 0 ? eff - 1 : eff; return 118 + (start - 2023) / 2; };
  const STAGING = /^(?:house|senate)-floor-staging\.evanhollander\.org$/.test(location.hostname);
  const congressNow = () => { const q = STAGING ? Number(new URLSearchParams(location.search).get('congress')) : 0; return q >= 119 ? q : congressByDate(); };
  const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;

  let markReady; const ready = new Promise((r) => { markReady = r; });   // set once init has given the window its roster and routes
  let opts = {}, data = null, names = new Map(), ov = null, onKey = null, trap = null, opener = null;
  const sets = new Map();   // congress -> { promise, data }
  const st = { q: '', party: 'all', former: false, sort: 'missedPct', dir: -1, id: null, congress: 0 };

  // Voting days missed in a row, up to their latest vote: a day counts when they missed every roll call they were listed on that day (a day they voted on anything ends the run)
  function dayStreak(d, m) {
    const R = d.rollList, missed = new Set(m.missedAt), gaps = new Set(m.gaps || []);
    let run = 0, day = null, n = 0, x = 0;
    for (let i = m.li; i >= m.fi && i >= 0; i--) {
      if (gaps.has(i)) continue;
      const date = R[i].d;
      if (day === null) day = date;
      if (date !== day) { if (x !== n) return run; run++; day = date; n = 0; x = 0; }
      n++; if (missed.has(i)) x++;
    }
    return day !== null && x === n ? run + 1 : run;
  }

  // what the window needs on each Member, from the record and the roster (run again when roll calls are added)
  function prepare(d) {
    const current = d.congress === congressNow();
    const lastIdx = new Map(); d.rollList.forEach((r, i) => lastIdx.set(r.d, i));
    d.members.forEach((m) => {
      // today's roster says who is a Member now (the Speaker is on the roll calls only when he votes); for a past Congress the dates say it
      if (current && names.size) { const on = names.has(m.id); m.gone = !on && m.last === d.through; m.active = on; }
      const n = names.get(m.id) || {};
      m.fn = n.first || ''; m.district = n.district || ''; m.info = n;
      m.full = n.official || (m.fn ? `${m.fn} ${m.name.replace(/\s*\([A-Z]{2}\)\s*$/, '')}` : m.name);
      m.search = `${m.full} ${m.name} ${m.state}`.toLowerCase();
      let k = m.li; const gone = new Set(m.missedAt); m.streak = 0;
      while (k != null && k >= 0 && gone.has(k)) { m.streak++; k--; }
      m.dayStreak = dayStreak(d, m);
      if (!current && m.last !== d.through) m.active = false;
    });
  }

  // The roll calls since the snapshot, a few at a time, until the Clerk has no more.
  async function catchUp(d) {
    if (!opts.rolls || !root.MemberStats) return;
    d.caughtAt = Date.now();
    for (let guard = 0; guard < 80; guard++) {
      const last = root.MemberStats.lastRoll(d);
      let res = null;
      try { res = await opts.rolls(d.congress, last ? `${last.y}-${last.n}` : ''); } catch (e) { return; }
      if (!res || !Array.isArray(res.rolls)) return;
      const added = root.MemberStats.apply(d, res.rolls.map((r) => Object.assign({}, r, { members: res.members || {} })));
      if (added) { prepare(d); refreshView(d); }
      if (res.done || !res.rolls.length) return;
    }
  }
  function refreshView(d) {
    if (!ov || d !== data) return;
    const body = ov.querySelector('.mem-body'); if (!body) return;
    if (st.id) { const keep = body.scrollTop; render(); body.scrollTop = keep; } else { const l = ov.querySelector('.mem-list'); if (l) l.innerHTML = ''; drawList(); }   // new numbers: the rows are drawn again, not moved
    sources();
  }

  function load(c = st.congress || congressNow()) {
    if (sets.has(c)) return sets.get(c).promise;
    // two places to start from: the nightly snapshot (the Worker's /api/member-stats) and the file bundled with the site; the one that goes through more roll calls wins, and the page adds the rest
    const fresh = opts.snapshot ? Promise.resolve(opts.snapshot(c)).catch(() => null) : Promise.resolve(null);
    const bundled = fetch(`member-stats-${c}.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error('HTTP ' + r.status))));
    const promise = Promise.all([fresh, bundled.catch((e) => ({ error: e }))])
      .then(([a, b]) => {
        const ok = [a, b].filter((x) => x && !x.error && Array.isArray(x.members));
        if (ok.length) return ok.reduce((p, q) => ((q.rolls || 0) > (p.rolls || 0) ? q : p));
        if (b && b.error && !a) throw b.error;
        return root.MemberStats.empty(c);   // a Congress with no record yet
      })
      .then(async (d) => {
        // Delegates and the Resident Commissioner (listed by the Clerk with the state "XX") vote only in Committee of the Whole, so a rate of "missed" means nothing for them
        d.members = d.members.filter((m) => m.state !== 'XX');
        try { if (!names.size && opts.roster) names = (await opts.roster()) || new Map(); } catch (e) { names = new Map(); }
        prepare(d);
        sets.get(c).data = d;
        return d;
      }).catch((e) => { sets.delete(c); throw e; });
    sets.set(c, { promise, data: null });
    return promise;
  }

  const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  const pct = (a, b) => (b ? (100 * a / b) : 0);
  const pf = (v) => (v >= 10 ? Math.round(v) : v.toFixed(1)) + '%';
  const photo = (id) => `<span class="mem-photo"><img src="https://bioguide.congress.gov/photo/${esc(id)}.jpg" alt="" loading="lazy" data-img="fade"></span>`;
  // The site's own party tag and state (as in Missing Members): a tinted letter, then the state in the muted mono face
  const CLS = { D: 'democrat', R: 'republican', I: 'independent' };
  const seat = (m) => `<span class="absentee-party-tag ${CLS[m.party] || 'independent'}">${esc(m.party)}</span> <span class="absentee-state">${esc(m.state)}${m.district ? '-' + esc(m.district) : ''}</span>`;
  // How a rate of missed votes reads at a glance: under 5% low, 5 to 12 middling, 12 and over high
  const sev = (p) => (p >= 12 ? 'hi' : p >= 5 ? 'mid' : 'lo');
  // How a roll call came out, and whether it was close. A vote counts as recorded when at least 200 Members voted (a quorum call or a Speaker election has no Yeas and Nays to compare).
  const CLOSE = 5;
  const recorded = (r) => r.ye != null && r.ye + r.na >= 200;
  const isClose = (r) => recorded(r) && Math.abs(r.ye - r.na) <= CLOSE;
  const tallyText = (r) => `${r.r || ''}${recorded(r) ? ` ${r.ye}\u2013${r.na}` : ''}`.trim();
  const VOTE = { Y: ['Yea', 'yea'], N: ['Nay', 'nay'], P: ['Present', 'pres'], O: ['Voted', 'pres'] };
  function rollRow(i, extra) {
    const r = data.rollList[i];
    const t = tallyText(r);
    return `<li data-key="${i}"><a class="mem-roll-n ext" href="https://clerk.house.gov/Votes/${r.y}${r.n}" target="_blank" rel="noopener" title="Roll call ${r.n} at the Clerk">${r.n}</a><span class="mem-roll-t">${extra && extra.vote ? `<em class="mem-vote ${VOTE[extra.vote][1]}">${VOTE[extra.vote][0]}</em>` : ''}${rollText(r)}${r.t ? `<small>${esc(r.t)}</small>` : ''}<small class="mem-result">${esc(t)}${isClose(r) ? ` <b class="mem-close">decided by ${Math.abs(r.ye - r.na)}</b>` : ''}${extra && extra.broke ? ' <b class="mem-broke">voted against their party</b>' : ''}</small></span><span class="mem-roll-d">${fmtDate(r.d)}</span></li>`;
  }
  // A bill number that is one (H R 4464, H RES 1247, S J RES 72) opens the site's bill window; the rest (QUORUM, JOURNAL) is plain text.
  const billButton = (label) => {
    const b = root.BillId && root.BillId.parseBillId ? root.BillId.parseBillId(label) : null;
    return b && b.display ? `<button type="button" class="mem-bill" data-act="openBillModal" data-args="${esc(JSON.stringify([b.display]))}">${esc(b.display)}</button>` : esc(label);
  };
  const rollText = (r) => `${r.l ? billButton(r.l) + ' · ' : ''}${esc(r.q || 'Vote')}`;

  // ── directory ──────────────────────────────────────────────────────────────
  const COLS = [
    { k: 'missedPct', label: 'Votes missed', title: 'Roll calls missed, of those held while they were a Member' },
    { k: 'daysMissed', label: 'Days', title: 'Voting days on which they missed every roll call' },
    { k: 'weeksMissed', label: 'Weeks', title: 'Voting weeks (Monday to Sunday) in which they missed every roll call' },
    { k: 'streak', label: 'Streak', title: 'Roll calls missed in a row, up to their latest vote' },
    { k: 'breakPct', label: 'Party breaks', title: 'On votes that split the parties, how often they voted against their own party' },
  ];
  // A Member with only a handful of roll calls (sworn in just before a resignation, say) has a percentage that means nothing: they sort below everyone with a real record, whatever the column.
const FEW = 20;
const cmp = (k, dir) => (a, b) => {
    if (k === 'name') return a.name.localeCompare(b.name) * dir || a.full.localeCompare(b.full);   // by surname, as the Clerk lists them
    if (k !== 'streak' && (a.rolls < FEW) !== (b.rolls < FEW)) return a.rolls < FEW ? 1 : -1;
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
      `<span class="mem-num">${m.missed}<i> / ${m.rolls}</i></span><b class="sev-${sev(m.missedPct)}">${pf(m.missedPct)}</b>`,
      `<span class="mem-num">${m.daysMissed}<i> / ${m.days}</i></span>`,
      `<span class="mem-num">${m.weeksMissed}<i> / ${m.weeks}</i></span>`,
      m.streak ? `<span class="mem-num${m.streak >= 2 ? ' sev-hi' : ''}">${m.streak}</span>` : '<span class="mem-dim">0</span>',
      m.breakPct == null ? '<span class="mem-dim">–</span>' : `<span class="mem-num">${pf(m.breakPct)}</span>`,
    ];
    return `<button type="button" class="mem-row ${PARTY[m.party] || ''}${m.active ? '' : ' is-former'}${m.rolls < FEW ? ' is-few' : ''}" title="${m.rolls < FEW ? 'Only ' + m.rolls + ' roll calls, too few for the percentages to mean much' : ''}" data-id="${esc(m.id)}">${photo(m.id)}<span class="mem-who"><b>${esc(m.full)}${(meetingsFor(m) || []).length ? '<span class="mem-dot" title="A committee or subcommittee of theirs meets today"></span>' : ''}</b><i>${seat(m)}${m.active ? '' : m.gone ? ' · no longer a Member' : ' · left ' + fmtDate(m.last)}</i></span>${cells.map((c, i) => `<span class="mem-cell c${i}">${c}</span>`).join('')}</button>`;
  }
  const REDUCED = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function drawList() {
    const list = ov.querySelector('.mem-list'); if (!list) return;
    const rows = visible();
    ov.querySelector('.mem-count').textContent = `${rows.length} ${rows.length === 1 ? 'Member' : 'Members'}`;
    ov.querySelectorAll('.mem-th').forEach((th) => {
      const on = th.dataset.k === st.sort;
      th.classList.toggle('is-sorted', on);
      th.classList.toggle('is-asc', on && st.dir > 0);
      th.setAttribute('aria-sort', on ? (st.dir < 0 ? 'descending' : 'ascending') : 'none');
    });
    if (!data.members.length) {
      list.innerHTML = root.EmptyState ? root.EmptyState.html({ shape: 'people', title: `No votes yet in the ${ordinal(data.congress)} Congress`, text: 'Members appear here once the first roll call is held.' }) : '<p class="mem-empty">No votes yet.</p>';
      return;
    }
    if (!rows.length) {
      list.innerHTML = root.EmptyState ? root.EmptyState.html({ shape: 'people', title: 'No Member matches your search', term: st.q }) : '<p class="mem-empty">No Member matches your search.</p>';
      return;
    }
    // The rows are kept and reordered (not redrawn), so each can glide from where it was to where it now is.
    const have = new Map([...list.querySelectorAll('.mem-row')].map((e) => [e.dataset.id, e]));
    const before = new Map();
    have.forEach((e, id) => before.set(id, e.getBoundingClientRect().top));
    const keep = new Set(rows.map((m) => m.id));
    have.forEach((e, id) => { if (!keep.has(id)) e.remove(); });
    [...list.children].filter((e) => !e.classList.contains('mem-row')).forEach((e) => e.remove());   // the empty state of a search that found nothing
    const frag = document.createDocumentFragment();
    const tpl = document.createElement('template');
    for (const m of rows) {
      let e = have.get(m.id);
      if (!e) { tpl.innerHTML = rowHtml(m).trim(); e = tpl.content.firstChild; }
      frag.appendChild(e);
    }
    list.appendChild(frag);
    if (!have.size || REDUCED()) return;
    const view = list.closest('.mem-body'), vr = view.getBoundingClientRect();
    const near = (y) => y > vr.top - 160 && y < vr.bottom + 160;   // only rows that can be seen are worth moving
    for (const e of list.children) {
      const was = before.get(e.dataset.id);
      if (was == null) continue;
      const now = e.getBoundingClientRect().top, dy = was - now;
      if (Math.abs(dy) < 2 || (!near(was) && !near(now))) continue;
      e.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
  }
  const ARROW = '<svg class="mem-arrow" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 2v8M2.8 6.8L6 10l3.2-3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function directoryHtml() {
    return `<div class="mem-tools">
        <input class="mem-search" type="search" placeholder="Search" aria-label="Search Members" autocomplete="off" spellcheck="false" value="${esc(st.q)}">
        <div class="bills-sort-switcher mem-parties">${['all', 'dem', 'rep', 'ind'].map((p) => `<button class="bills-sort-btn${st.party === p ? ' active' : ''}" data-party="${p}">${p === 'all' ? 'ALL' : p === 'dem' ? 'D' : p === 'rep' ? 'R' : 'I'}</button>`).join('')}</div>
        ${congressNow() > 119 ? `<div class="bills-sort-switcher mem-congress">${Array.from({ length: congressNow() - 118 }, (_, k) => 119 + k).map((c) => `<button class="bills-sort-btn${st.congress === c ? ' active' : ''}" data-congress="${c}">${ordinal(c)}</button>`).join('')}</div>` : ''}
        <label class="tm-outside mem-check"><input type="checkbox" class="mem-former"${st.former ? ' checked' : ''}> Include former Members</label>
        <span class="mem-count"></span>
      </div>
      <div class="mem-head"><span></span><button type="button" class="mem-th mem-th-name" data-k="name" title="Sort by surname">Member${ARROW}</button>${COLS.map((c, i) => `<button type="button" class="mem-th c${i}" data-k="${c.k}" title="${esc(c.title)}">${esc(c.label)}${ARROW}</button>`).join('')}</div>
      <div class="mem-list" role="list"></div>`;
  }

  // From the Clerk's roster (MemberData.xml), for a sitting Member: hometown, office, phone, and when they were sworn in. A former Member is not on it.
  function infoHtml(m) {
    const n = m.info || {};
    const prof = m.prof || {};
    const site = /^https?:\/\//i.test(prof.website || '') ? prof.website : '';
    const rows = [['Hometown', n.town ? `${esc(n.town)}, ${esc(m.state)}` : ''], ['Office', esc(n.office || '')], ['Phone', esc(n.phone || '')], ['Sworn in', esc(n.sworn || '')], ['In the House', prof.firstYear ? `since ${esc(prof.firstYear)}${prof.houseTerms ? ` \u00b7 ${esc(prof.houseTerms)} term${prof.houseTerms === 1 ? '' : 's'}` : ''}` : '']].filter((r) => r[1]);
    return rows.length ? `<dl class="mem-info">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : '';
  }

  // The record over time, for the cards: one value a month, drawn as a faint area behind the figure.
  function series(m) {
    const R = data.rollList;
    const lo = R.findIndex((r) => r.d >= m.first);
    let hi = -1; for (let i = R.length - 1; i >= 0; i--) if (R[i].d <= m.last) { hi = i; break; }
    if (lo < 0 || hi < lo) return null;
    const missed = new Set(m.missedAt), brk = new Set(m.breakAt);
    const mon = new Map();
    const get = (k) => { if (!mon.has(k)) mon.set(k, { rolls: 0, missed: 0, scored: 0, breaks: 0, dayR: {}, dayX: {}, wkR: {}, wkX: {} }); return mon.get(k); };
    const monday = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
    for (let i = lo; i <= hi; i++) {
      const r = R[i], b = get(r.d.slice(0, 7)), x = missed.has(i) ? 1 : 0, wk = monday(r.d), wb = get(wk.slice(0, 7));
      b.rolls++; b.missed += x; b.dayR[r.d] = (b.dayR[r.d] || 0) + 1; b.dayX[r.d] = (b.dayX[r.d] || 0) + x;
      wb.wkR[wk] = (wb.wkR[wk] || 0) + 1; wb.wkX[wk] = (wb.wkX[wk] || 0) + x;
      if (r.u && !x) { b.scored++; if (brk.has(i)) b.breaks++; }
    }
    const keys = [...mon.keys()].sort();
    if (keys.length < 3) return null;
    const out = { votes: [], days: [], weeks: [], breaks: [] };
    for (const k of keys) {
      const b = mon.get(k);
      out.votes.push(pct(b.missed, b.rolls));
      out.days.push(Object.keys(b.dayR).filter((d) => b.dayX[d] === b.dayR[d]).length);
      out.weeks.push(Object.keys(b.wkR).filter((w) => b.wkX[w] === b.wkR[w]).length);
      out.breaks.push(b.scored ? pct(b.breaks, b.scored) : 0);
    }
    return out;
  }
  function spark(vals, cls) {
    if (!vals) return '';
    const max = Math.max(...vals, 1e-9), n = vals.length;
    const pts = vals.map((v, i) => `${(100 * i / (n - 1)).toFixed(1)},${(100 - 92 * v / max).toFixed(1)}`);
    return `<svg class="mem-spark ${cls}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="M0,100 L${pts.join(' L')} L100,100 Z"/><polyline class="line" points="${pts.join(' ')}"/></svg>`;
  }

  // BILLS ON THE FLOOR THIS WEEK, by sponsor (the one who introduced it; cosponsors are not looked at). null until the week's bills have loaded, so nothing is claimed before then.
  const FLOOR_STATUS = { scheduled: 'Scheduled', passed: 'Passed', failed: 'Failed', disposed: 'Disposed of', 'roll-call': 'Vote under way', postponed: 'Postponed' };
  function floorFor(m) {
    const all = opts.floor ? opts.floor() : null;
    if (!all || !all.length) return null;
    return all.filter((x) => x.sponsorId === m.id);
  }
  function floorHtml(m) {
    const mine = floorFor(m);
    if (mine == null) return '';
    if (!mine.length) return '<h3 class="mem-h">On the floor this week <em>as sponsor</em></h3><p class="mem-none">No bill of theirs is on the floor this week.</p>';
    return `<h3 class="mem-h mem-h-live"><span class="mem-dot"></span>On the floor this week <em>as sponsor</em></h3><ol class="mem-rolls mem-floor">${mine.map((b) => `<li><span class="mem-roll-n">${esc(FLOOR_STATUS[b.status] || b.status || '')}</span><span class="mem-roll-t">${billButton(b.id)}${b.title ? `<small>${esc(b.title)}</small>` : ''}<small class="mem-result">${esc(b.group)}</small></span><span class="mem-roll-d"></span></li>`).join('')}</ol>`;
  }

  // The week's bills load with the page; a Member opened from a link or a reload can be drawn before they have. The section then fills in when they arrive (for up to 30 seconds), and claims nothing until then.
  function fillFloor(m, tries = 0) {
    const slot = ov && ov.querySelector(`.mem-floor-slot[data-for="${m.id}"]`);
    if (!slot || floorFor(m) != null) { if (slot) slot.innerHTML = floorHtml(m); return; }
    if (tries < 30) setTimeout(() => fillFloor(m, tries + 1), 1000);
  }

  // The roster gives committees as codes. The names are the Clerk's own (each code is a page at clerk.house.gov/committees/<code>); subcommittees are left out.
  const COMMITTEES = {
    AG00: 'Agriculture', AP00: 'Appropriations', AS00: 'Armed Services', BU00: 'Budget', ED00: 'Education and Workforce', IF00: 'Energy and Commerce', SO00: 'Ethics',
    BA00: 'Financial Services', FA00: 'Foreign Affairs', HM00: 'Homeland Security', HA00: 'House Administration', JU00: 'Judiciary', II00: 'Natural Resources',
    GO00: 'Oversight and Government Reform', RU00: 'Rules', SY00: 'Science, Space, and Technology', SM00: 'Small Business', PW00: 'Transportation and Infrastructure',
    VR00: "Veterans' Affairs", WM00: 'Ways and Means', IG00: 'Intelligence', ZS00: 'Select Strategic Competition', EC00: 'Joint Economic', JL00: 'Joint Library',
    JP00: 'Joint Printing', IT00: 'Joint Taxation',
  };
  // The Clerk's subcommittee names, by code (a subcommittee's code starts with its committee's: AG22 is under AG00).
  const SUBS = { AG22: "Commodity Markets, Digital Assets, and Rural Development", AG14: "Conservation, Research, and Biotechnology", AG15: "Forestry and Horticulture", AG16: "General Farm Commodities, Risk Management, and Credit", AG29: "Livestock, Dairy, and Poultry", AG03: "Nutrition and Foreign Agriculture", AP01: "Agriculture, Rural Development, Food and Drug Administration, and Related Agencies", AP19: "Commerce, Justice, Science, and Related Agencies", AP02: "Defense", AP10: "Energy and Water Development and Related Agencies", AP23: "Financial Services and General Government", AP15: "Homeland Security", AP06: "Interior, Environment, and Related Agencies", AP07: "Labor, Health and Human Services, Education, and Related Agencies", AP24: "Legislative Branch", AP18: "Military Construction, Veterans Affairs, and Related Agencies", AP04: "National Security, Department of State, and Related Programs", AP20: "Transportation, Housing and Urban Development, and Related Agencies", AS35: "Cyber, Information Technologies, and Innovation", AS26: "Intelligence and Special Operations", AS02: "Military Personnel", AS03: "Readiness", AS28: "Seapower and Projection Forces", AS29: "Strategic Forces", AS25: "Tactical Air and Land Forces", BA16: "Capital Markets", BA21: "Digital Assets, Financial Technology, and Artificial Intelligence", BA20: "Financial Institutions", BA04: "Housing and Insurance", BA10: "National Security, Illicit Finance, and International Financial Institutions", BA09: "Oversight and Investigations", ED14: "Early Childhood, Elementary, and Secondary Education", ED02: "Health, Employment, Labor, and Pensions", ED13: "Higher Education and Workforce Development", ED10: "Workforce Protections", IF17: "Commerce, Manufacturing, and Trade", IF16: "Communications and Technology", IF03: "Energy", IF18: "Environment", IF14: "Health", IF02: "Oversight and Investigations", FA16: "Africa", FA05: "East Asia and Pacific", FA14: "Europe", FA13: "Middle East and North Africa", FA17: "Oversight and Intelligence", FA19: "South and Central Asia", FA07: "Western Hemisphere", HM11: "Border Security and Enforcement", HM05: "Counterterrorism and Intelligence", HM08: "Cybersecurity and Infrastructure Protection", HM12: "Emergency Management and Technology", HM09: "Oversight, Investigations, and Accountability", HM07: "Transportation and Maritime Security", HA08: "Elections", HA27: "Modernization and Innovation", JU03: "Courts, Intellectual Property, Artificial Intelligence, and the Internet", JU08: "Crime and Federal Government Surveillance", JU01: "Immigration Integrity, Security, and Enforcement", JU13: "Oversight", JU05: "The Administrative State, Regulatory Reform, and Antitrust", JU10: "The Constitution and Limited Government", II06: "Energy and Mineral Resources", II10: "Federal Lands", II24: "Indian and Insular Affairs", II15: "Oversight and Investigations", II13: "Water, Wildlife and Fisheries", GO12: "Cybersecurity, Information Technology, and Government Innovation", GO16: "Delivering on Government Efficiency", GO05: "Economic Growth, Energy Policy, and Regulatory Affairs", GO33: "Federal Law Enforcement", GO24: "Government Operations", GO27: "Health Care and Financial Services", GO06: "Military and Foreign Affairs", RU02: "Legislative and Budget Process", RU04: "Rules and Organization of the House", SY20: "Energy", SY18: "Environment", SY21: "Investigations and Oversight", SY15: "Research and Technology", SY16: "Space and Aeronautics", SM23: "Contracting and Infrastructure", SM27: "Economic Growth, Tax, and Capital Access", SM22: "Innovation, Entrepreneurship, and Workforce Development", SM24: "Oversight, Investigations, and Regulations", SM21: "Rural Development, Energy, and Supply Chains", PW05: "Aviation", PW07: "Coast Guard and Maritime Transportation", PW13: "Economic Development, Public Buildings, and Emergency Management", PW12: "Highways and Transit", PW14: "Railroads, Pipelines, and Hazardous Materials", PW02: "Water Resources and Environment", VR09: "Disability Assistance and Memorial Affairs", VR10: "Economic Opportunity", VR03: "Health", VR08: "Oversight and Investigations", VR11: "Technology Modernization", WM02: "Health", WM06: "Oversight", WM01: "Social Security", WM05: "Tax", WM04: "Trade", WM03: "Work and Welfare", IG01: "Central Intelligence Agency", IG04: "Defense Intelligence and Overhead Architecture", IG06: "National Intelligence Enterprise", IG02: "National Security Agency and Cyber", IG11: "Open Source Intelligence", IG09: "Oversight and Investigations" };
  // Meetings are named in words ("Committee on Agriculture", "Subcommittee on Elections (Committee on House Administration)", "Africa Subcommittee (Committee on Foreign Affairs)"), so a Member's
  // committees are matched by name: a full-committee meeting concerns every Member of that committee, a subcommittee's only those on that subcommittee.
  const norm = (t) => String(t || '').toLowerCase().replace(/[.,'\u2019\u201c\u201d"]/g, '').replace(/\bthe\b/g, '').replace(/\s+/g, ' ').trim();
  const comKey = (t) => norm(t).replace(/^(?:permanent select |select |joint )?committee on /, '').replace(/ committee$/, '').trim();
  const subKey = (t) => norm(t).replace(/^subcommittee on /, '').replace(/ subcommittee$/, '').trim();
  const NAME_TO_CODE = Object.fromEntries(Object.entries(COMMITTEES).map(([c, n]) => [comKey(n), c]));
  function eventKey(ev) {   // -> 'AG00' (a committee) or 'AG22' (a subcommittee), or ''
    const t = String(ev.committee || '');
    const paren = t.match(/^(.*?)\s*\((.*)\)\s*$/);
    if (!paren) return NAME_TO_CODE[comKey(t)] || '';
    const parent = NAME_TO_CODE[comKey(paren[2])];
    if (!parent) return '';
    const want = subKey(paren[1]);
    return Object.keys(SUBS).find((c) => c.slice(0, 2) === parent.slice(0, 2) && subKey(SUBS[c]) === want) || '';
  }
  const dayData = () => (opts.meetings && opts.meetings());
  const keyCache = new Map();
  const keyOf = (ev) => { const k = ev.id + '|' + ev.committee; if (!keyCache.has(k)) keyCache.set(k, eventKey(ev)); return keyCache.get(k); };
  // Today's meetings that concern this Member: [{ ev, via: 'AG00' | 'AG22' }]
  function meetingsFor(m) {
    const day = dayData();
    if (!day || !m.info) return null;
    const mine = new Set([...(m.info.committees || []).map((c) => c.code), ...(m.info.subcommittees || []).map((c) => c.code)]);
    return day.events.map((ev) => ({ ev, via: keyOf(ev) })).filter((x) => x.via && mine.has(x.via));
  }
  function meetingHtml({ ev, via }) {
    const name = via.endsWith('00') ? COMMITTEES[via] : `${SUBS[via]} Subcommittee`;
    return `<a class="mem-meet" href="${esc(ev.url)}" target="_blank" rel="noopener"><span class="mem-meet-time">${esc(ev.time)}</span><span class="mem-meet-what"><b>${esc(ev.title)}</b><i>${esc(name)}${ev.location ? ' \u00b7 ' + esc(ev.location) : ''}</i></span></a>`;
  }
  function committeesHtml(m) {
    const list = ((m.info && m.info.committees) || []).filter((c) => COMMITTEES[c.code]);
    if (!list.length) return '';
    const chip = (c) => {
      const name = COMMITTEES[c.code];
      const lead = c.lead ? `<span class="mem-comm-role">${esc(c.lead)}</span>` : '';
      const inner = root.Committees ? root.Committees.committeeChipHtml({ name, chamber: /^Joint /.test(name) ? 'Joint' : 'House' }, lead) : `<span>${esc(name)}${lead}</span>`;
      return `<a class="mem-comm" href="https://clerk.house.gov/committees/${esc(c.code)}" target="_blank" rel="noopener">${inner}</a>`;
    };
    const subsOf = (code) => ((m.info && m.info.subcommittees) || []).filter((x) => x.code.slice(0, 2) === code.slice(0, 2) && SUBS[x.code]);
    const meets = meetingsFor(m);
    const block = (c) => {
      const subs = subsOf(c.code);
      const mine = (meets || []).filter((x) => x.via === c.code || (!x.via.endsWith('00') && x.via.slice(0, 2) === c.code.slice(0, 2) && subs.some((y) => y.code === x.via)));
      return `<div class="mem-comm-block${mine.length ? ' has-meeting' : ''}">${chip(c)}${subs.length ? `<ul class="mem-subs">${subs.map((x) => `<li><span>${esc(SUBS[x.code])}</span>${x.lead ? `<em>${esc(x.lead)}</em>` : ''}</li>`).join('')}</ul>` : ''}${mine.map(meetingHtml).join('')}</div>`;
    };
    const live = meets && meets.length ? `<span class="mem-live"><span class="mem-dot"></span>${meets.length} meeting${meets.length === 1 ? '' : 's'} today</span>` : '';
    const quiet = meets && !meets.length ? '<span class="mem-quiet">none meet today</span>' : '';
    return `<h3 class="mem-h">Committees <em>${list.length}</em>${live}${quiet}</h3><div class="mem-comms">${list.map(block).join('')}</div>`;
  }

  // LOADING: bars in the shape of the window (a photo and a name, a row of figures, then rows), shimmering as the rest of the site's stand-ins do, until the record has come in.
  function loadingHtml() {
    const bar = (w, h) => `<i class="bsk" style="width:${w};height:${h}"></i>`;
    const rows = [92, 84, 96, 78, 88, 70].map((w) => `<div class="mem-load-row">${bar('2.4rem', '2.4rem')}${bar(w + '%', '0.9rem')}</div>`).join('');
    return `<div class="mem-loading" role="status" aria-label="Loading Member data"><div class="mem-load-head">${bar('5.5rem', '5.5rem')}<div class="mem-load-title">${bar('14rem', '1.6rem')}${bar('9rem', '0.9rem')}</div></div><div class="mem-load-figs">${bar('100%', '4.5rem')}${bar('100%', '4.5rem')}${bar('100%', '4.5rem')}${bar('100%', '4.5rem')}</div>${rows}</div>`;
  }

  // STREAKS: in a row, which says more than a total. Ten roll calls missed in one afternoon is a day; missing the last two weeks is a pattern.
  // A voting day (or week) is "all" when every roll call they were listed on went unvoted, "none" when they voted on every one, "some" otherwise.
  function streaks(m) {
    const R = data.rollList;
    const lo = R.findIndex((r) => r.d >= m.first);
    let hi = -1; for (let i = R.length - 1; i >= 0; i--) if (R[i].d <= m.last) { hi = i; break; }
    if (lo < 0 || hi < lo) return null;
    const missed = new Set(m.missedAt);
    const monday = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
    const days = [], weeks = [];
    const dayAt = new Map(), weekAt = new Map();
    for (let i = lo; i <= hi; i++) {
      const r = R[i], x = missed.has(i) ? 1 : 0;
      let d = dayAt.get(r.d); if (!d) { d = { key: r.d, from: r.d, to: r.d, n: 0, x: 0 }; dayAt.set(r.d, d); days.push(d); }
      d.n++; d.x += x;
      const wk = monday(r.d);
      let w = weekAt.get(wk); if (!w) { w = { key: wk, from: r.d, to: r.d, n: 0, x: 0 }; weekAt.set(wk, w); weeks.push(w); }
      w.n++; w.x += x; w.to = r.d;
    }
    const state = (u) => (u.x === u.n ? 'all' : u.x === 0 ? 'none' : 'some');
    // runs of "all" (units), as { len, from, to }, and of consecutive missed roll calls
    const runs = (units) => { const out = []; let cur = null; for (const u of units) { if (state(u) === 'all') { if (!cur) { cur = { len: 0, from: u.from, to: u.to }; out.push(cur); } cur.len++; cur.to = u.to; } else cur = null; } return out; };
    const rollRuns = []; { let cur = null; for (let i = lo; i <= hi; i++) { if (missed.has(i)) { if (!cur) { cur = { len: 0, from: R[i].d, to: R[i].d }; rollRuns.push(cur); } cur.len++; cur.to = R[i].d; } else cur = null; } }
    const summarise = (rs, lastDate) => {
      const best = rs.reduce((a, b) => (b.len > a.len ? b : a), { len: 0 });
      const last = rs[rs.length - 1];
      return { current: last && last.to === lastDate ? last : null, best };
    };
    const lastDay = days[days.length - 1].to;
    return {
      rolls: summarise(rollRuns, R[hi].d), days: summarise(runs(days), lastDay), weeks: summarise(runs(weeks), weeks[weeks.length - 1].to),
      dayStrip: days.map((d) => ({ s: state(d), t: `${fmtDate(d.key)}: missed ${d.x} of ${d.n}` })),
      weekStrip: weeks.map((w) => ({ s: state(w), t: `Week of ${fmtDate(w.key)}: missed ${w.x} of ${w.n}` })),
    };
  }
  function streaksHtml(m) {
    const t = streaks(m); if (!t) return '';
    const card = (label, r) => {
      const n = r.current ? r.current.len : 0;
      const when = r.current ? `${esc(fmtDate(r.current.from))}${r.current.from === r.current.to ? '' : ' to ' + esc(fmtDate(r.current.to))}` : '';
      return `<div class="mem-streak${n >= 2 ? ' is-on' : ''}"><span>${label}</span><b>${n}</b>${when ? `<small>${when}</small>` : ''}</div>`;
    };
    const strip = (items, label) => `<div class="mem-strip-wrap"><span class="mem-strip-label">${label}</span><div class="mem-strip">${items.map((x) => `<span class="${x.s}" title="${esc(x.t)}"></span>`).join('')}</div></div>`;
    return `<h3 class="mem-h">Streaks missed in a row <em>as of ${esc(fmtDate(data.through))}</em></h3>
      <div class="mem-streaks">${card('Roll calls', t.rolls)}${card('Voting days', t.days)}${card('Voting weeks', t.weeks)}</div>
      ${strip(t.weekStrip, 'Every voting week')}${strip(t.dayStrip, 'Every voting day')}
      <p class="mem-key"><span class="none"></span>voted on all <span class="some"></span>missed some <span class="all"></span>missed all</p>`;
  }

  // ── one member ─────────────────────────────────────────────────────────────
  function idBlock(m) {
    return `<div class="mem-id">${photo(m.id).replace('mem-photo', 'mem-photo is-big')}<div><h2>${esc(m.full)}</h2><p>${seat(m)}${m.active ? '' : m.gone ? ` · no longer a Member (last roll in this data: ${fmtDate(m.last)})` : ` · served ${fmtDate(m.first)} to ${fmtDate(m.last)}`}</p>
        ${infoHtml(m)}<p class="mem-links">${(m.prof && /^https?:\/\//i.test(m.prof.website || '')) ? `<a class="mem-ext ext" href="${esc(m.prof.website)}" target="_blank" rel="noopener">Official website</a>` : ''}<a class="mem-ext ext" href="https://clerk.house.gov/members/${esc(m.id)}" target="_blank" rel="noopener">Clerk profile</a></p></div></div>`;
  }
  function detailHtml(m) {
    const R = data.rollList;
    const lo = R.findIndex((r) => r.d >= m.first);
    let hi = -1; for (let i = R.length - 1; i >= 0; i--) if (R[i].d <= m.last) { hi = i; break; }
    const missed = new Set(m.missedAt);
    const last10 = []; for (let i = hi; i >= lo && last10.length < 10; i--) last10.unshift(i);
    const dayStat = DAYS.map((d, wd) => { let n = 0, x = 0; for (let i = lo; i <= hi; i++) { const dt = new Date(R[i].d + 'T12:00:00Z'); if (((dt.getUTCDay() + 6) % 7) !== wd) continue; n++; if (missed.has(i)) x++; } return { d, n, x, p: pct(x, n) }; });
    const top = Math.max(25, Math.ceil(Math.max(...dayStat.map((s) => s.p)) / 5) * 5);   // a fixed scale from 0, never stretched to the tallest bar
    const breakSet = new Set(m.breakAt);
    const list = (idx, id, keep) => `<ol class="mem-rolls" data-for="${id}" data-clamp="${keep}">${[...idx].reverse().map((i) => rollRow(i)).join('')}</ol>`;
    // the last votes they cast (a missed vote has its own list below)
    const castRows = [...(m.cast || [])].reverse();
    const recentList = castRows.length ? `<ol class="mem-rolls" data-for="recent" data-clamp="5">${castRows.map(([i, c]) => rollRow(i, { vote: c, broke: breakSet.has(i) })).join('')}</ol>` : '<p class="mem-none">No votes cast.</p>';
    const missedReal = m.missedAt.filter((i) => recorded(data.rollList[i]));
    const missedClose = missedReal.filter((i) => isClose(data.rollList[i]));
    const closeNote = missedReal.length ? `<p class="mem-note">${missedClose.length} of the ${missedReal.length} recorded votes they missed ${missedClose.length === 1 ? 'was' : 'were'} decided by ${CLOSE} or fewer.</p>` : '';
    const likes = (m.like || []).map(([id, p]) => ({ m: data.members.find((x) => x.id === id), p })).filter((x) => x.m);
    const likeHtml = likes.length ? `<h3 class="mem-h">Votes most like theirs <em>agreement on votes both cast</em></h3><div class="mem-likes">${likes.map(({ m: o, p }) => `<button type="button" class="mem-like" data-id="${esc(o.id)}">${photo(o.id)}<span><b>${esc(o.full)}</b><i>${esc(o.party)}-${esc(o.state)}</i></span><em>${pf(p)}</em></button>`).join('')}</div>` : '';
    const dpHtml = opts.discharge ? `<h3 class="mem-h">Discharge petitions <em class="mem-dp-count">loading</em></h3><div class="mem-dp" data-for="${esc(m.id)}"><p class="mem-none">Reading the signature lists\u2026</p></div>` : '';
    const ts = series(m);
    const cards = [
      ['Votes missed', pf(m.missedPct), `${m.missed} of ${m.rolls} roll calls`, spark(ts && ts.votes, 'red'), `sev-${sev(m.missedPct)}`],
      ['Days missed', `${m.daysMissed}`, `of ${m.days} voting days`, spark(ts && ts.days, 'red'), ''],
      ['Weeks missed', `${m.weeksMissed}`, `of ${m.weeks} voting weeks`, spark(ts && ts.weeks, 'red'), ''],
      ['Party breaks', m.breakPct == null ? '–' : pf(m.breakPct), m.breakPct == null ? 'not scored' : `${m.breaks} of ${m.unityScored} party-split votes`, spark(ts && ts.breaks, 'purple'), ''],
    ];
return `${idBlock(m)}
      <div class="mem-cards">${cards.map(([a, b, c, sp, sv]) => `<div class="mem-card">${sp}<span>${a}</span><b class="${sv}">${b}</b><i>${c}</i></div>`).join('')}</div>
      ${streaksHtml(m)}
      <div class="mem-floor-slot" data-for="${esc(m.id)}">${floorHtml(m)}</div>
      ${committeesHtml(m)}
      <h3 class="mem-h">Last ${last10.length} roll calls</h3>
      <div class="mem-last" title="Red: not voting. Green: voted.">${last10.map((i) => `<span class="${missed.has(i) ? 'x' : 'v'}" title="Roll ${R[i].n}, ${esc(fmtDate(R[i].d))}: ${missed.has(i) ? 'not voting' : 'voted'}"></span>`).join('')}</div>
      <h3 class="mem-h">Votes missed by weekday <em>scale 0 to ${top}%</em></h3>
      <div class="mem-wd">${dayStat.map((s) => `<div title="${s.x} of ${s.n} roll calls"><span class="bar"><s class="sev-${sev(s.p)}" style="height:${s.p ? Math.max(2, 100 * s.p / top).toFixed(1) : 0}%"></s></span><b>${s.n ? pf(s.p) : '–'}</b><i>${s.d}</i></div>`).join('')}</div>
      <h3 class="mem-h">Roll calls missed <em>${m.missed}</em></h3>${closeNote}${m.missed ? list(m.missedAt, 'missed', 6) : '<p class="mem-none">None.</p>'}
      <h3 class="mem-h">Voted against their party <em>${m.breaks}</em></h3>${m.breaks ? list(m.breakAt, 'breaks', 6) : '<p class="mem-none">None on a party-split vote.</p>'}
      ${dpHtml}
      <h3 class="mem-h">Recent votes <em>votes cast, newest first</em></h3>${recentList}
      ${likeHtml}`;
  }

  // The Source line, as every panel has one: the Clerk's roll calls, with a popover saying what was counted, and the other sources the window draws on.
  function sources() {
    const foot = ov && ov.querySelector('.mem-foot');
    if (!foot || !root.SourcePop || !data) return;
    root.SourcePop.set(foot, {
      title: `Member vote record, ${ordinal(data.congress)} Congress`,
      request: 'GET https://clerk.house.gov/evs/<year>/roll<NNN>.xml  (one file per roll call, 2025 and 2026)',
      rows: [
        ['Roll calls read', String(data.rolls)],
        ['Voting days', String(data.days)],
        ['Voting weeks (Monday to Sunday)', String(data.weeks)],
        ['Through', data.through || 'no roll calls yet'],
        ['Missed', 'Not Voting, on a roll call held while the Member was listed (the Clerk lists a Member only while they serve)'],
        ['Party breaks', 'A vote against their own party\u2019s majority, on roll calls where a majority of Democrats voted against a majority of Republicans'],
        ['Decided by 5 or fewer', 'The Yeas and Nays differ by five or fewer, on roll calls with at least 200 Members voting'],
        ['Votes like theirs', 'Agreement over roll calls both Members voted Yea or Nay on, at least 150 of them'],
        ['Left out', 'Delegates and the Resident Commissioner, who do not vote on final passage'],
      ],
    });
    root.SourcePop.also(foot, [
      { name: 'Clerk Member roster', href: 'https://clerk.house.gov/xml/lists/MemberData.xml', supplies: 'names, districts, offices, hometowns, and committee assignments' },
      { name: 'Clerk MemberData guide', href: 'https://clerk.house.gov/member_info/MemberData_UserGuide.pdf', supplies: 'the committee codes' },
      { name: 'House Committee Repository', href: 'https://docs.house.gov/Committee/Calendar/ByDay.aspx', supplies: 'today\u2019s committee meetings' },
      { name: 'Discharge petitions (House Clerk)', href: 'https://clerk.house.gov/DischargePetition/DischargePetitions?CongressNum=119', supplies: 'who signed each petition' },
      { name: 'Congress.gov', href: 'https://www.congress.gov/members', supplies: 'official websites, and the years each Member has served in the House' },
      { name: 'Bioguide', href: 'https://bioguide.congress.gov', supplies: 'photos' },
    ]);
  }

  // The lists are clamped by the site's own ClampList (as Missing Members and the others are): the first few rows, the next one fading out, a pill that says how many more and becomes "Show less".
  function mountClamps(scope) {
    if (!root.ClampList) return;
    scope.querySelectorAll('.mem-rolls[data-clamp]').forEach((ol) => root.ClampList.mount(ol, { keep: Number(ol.dataset.clamp) || 5 }));
  }

  // DISCHARGE PETITIONS: which of the Congress's petitions this Member has signed. The signature lists are the site's own (one per petition), fetched when a Member is opened and kept.
  const dpCache = new Map();
  function petitionSigners(id) {
    if (!dpCache.has(id)) dpCache.set(id, opts.discharge.signers(id).catch(() => { dpCache.delete(id); return null; }));
    return dpCache.get(id);
  }
  async function fillPetitions(mid) {
    const box = ov && ov.querySelector(`.mem-dp[data-for="${mid}"]`);
    if (!box) return;
    let list = opts.discharge.list();
    if (!list && opts.discharge.load) list = await opts.discharge.load();
    const unavailable = () => { const b = ov && ov.querySelector(`.mem-dp[data-for="${mid}"]`); const c = ov && ov.querySelector('.mem-dp-count'); if (b) b.innerHTML = '<p class="mem-none">The petition list could not be read. Try again shortly.</p>'; if (c) c.textContent = 'unavailable'; };
    if (!list || !list.length) return unavailable();
    const lists = new Array(list.length);
    let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => { while (next < list.length) { const k = next++; lists[k] = await petitionSigners(list[k].id); } }));
    const live = ov && ov.querySelector(`.mem-dp[data-for="${mid}"]`);
    if (!live) return;
    const count = ov.querySelector('.mem-dp-count');
    if (lists.some((x) => x === null)) { live.innerHTML = '<p class="mem-none">Some signature lists could not be read. Try again shortly.</p>'; if (count) count.textContent = 'unavailable'; return; }
    const signed = [], open = [];
    list.forEach((pt, k) => {
      const hit = (lists[k] || []).find((x) => x.id === mid);
      if (hit) signed.push({ pt, hit }); else if ((Number(pt.signatures) || 0) < (opts.discharge.needed || 218)) open.push(pt);
    });
    const newest = (x, y) => Number(y.number) - Number(x.number);   // the newest petition first (they are numbered in the order they were filed)
    signed.sort((x, y) => newest(x.pt, y.pt));
    open.sort(newest);
    if (count) count.textContent = `signed ${signed.length} of ${list.length}`;
    const iso = (d) => { const m = String(d || '').match(/^(\d\d)\/(\d\d)\/(\d{4})$/); return m ? `${m[3]}-${m[1]}-${m[2]}` : ''; };
    const sponsor = (pt) => !pt.sponsor ? '' : ' \u00b7 ' + (data.members.some((x) => x.id === pt.sponsorId) ? `<button type="button" class="mem-link" data-member="${esc(pt.sponsorId)}">${esc(pt.sponsor)}</button>` : esc(pt.sponsor));
    const row = ({ pt, hit }) => `<li title="${esc((pt.description || '').replace(/^Providing for (?:the )?consideration of /i, 'Consideration of '))}"><a class="mem-roll-n ext" href="https://clerk.house.gov/DischargePetition/${esc(pt.id)}" target="_blank" rel="noopener" title="Discharge Petition No. ${esc(pt.number)} at the Clerk">No. ${esc(pt.number)}</a><span class="mem-roll-t">${pt.billNumber ? billButton(pt.billNumber) : ''}${sponsor(pt)}</span><span class="mem-roll-d">signed ${esc(fmtDate(iso(hit.date)) || hit.date || '')}</span></li>`;
    const rows = signed.map((x) => row(x).replace(/^<li/, `<li data-key="${esc(x.pt.id)}"`));
    const need = opts.discharge.needed || 218;
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    if (!signed.length) {
      live.innerHTML = `<p class="mem-none">Has not signed any of the ${list.length} petitions${open.length ? `. ${open.length} of them are still short of the ${need} signatures needed to force a vote.` : '.'}</p>`;
    } else {
      live.innerHTML = `<ol class="mem-rolls" data-clamp="3">${rows.join('')}</ol>`
        + (open.length ? `<p class="mem-note">Has not signed ${plural(open.length, 'petition')} still short of the ${need} signatures needed to force a vote. <button type="button" class="mem-more mem-more-inline" data-fold aria-expanded="false">Show which</button></p><div class="mem-fold"><div class="mem-fold-in">${open.map((pt) => `<button type="button" class="mem-chipn" data-dp-signers="${esc(pt.id)}" data-dp-number="${esc(pt.number)}" title="${esc((pt.billNumber || '') + ' · open the petition')}">No. ${esc(pt.number)}</button>`).join(' ')}</div></div>` : '');
      mountClamps(live);
    }
  }

  // Congress.gov's record of the Member (website, name as written, years in the House): asked for once per Member, then drawn into the name block.
  function fillProfile(m) {
    if (!opts.profile || !m || m.prof !== undefined) return;
    m.prof = null;
    opts.profile(m.id).then((p) => {
      if (!p || p.error) return;
      m.prof = p;
      if (!(m.info && m.info.official) && p.name) m.full = p.name;
      const el = ov && st.id === m.id && ov.querySelector('.mem-id');
      if (el) el.outerHTML = idBlock(m);
    });
  }

  // ── the modal ──────────────────────────────────────────────────────────────
  function render() {
    const body = ov.querySelector('.mem-body');
    if (st.id) {
      const m = data.members.find((x) => x.id === st.id);
      body.innerHTML = m ? detailHtml(m) : '<p class="mem-none">This Member has no vote record here. Delegates and the Resident Commissioner do not vote on final passage, so they are not counted.</p>';
    }
    else body.innerHTML = directoryHtml();
    ov.querySelector('.mem-headleft').innerHTML = st.id
      ? '<button type="button" class="mem-back"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>All Members</button><span class="tm-picker-title mem-title">MEMBER</span>'
      : '<span class="tm-picker-title mem-title">MEMBERS</span>';
    setHash(st.id ? '#member/' + st.id : '#members');
    if (!st.id) { drawList(); if (root.SearchField) { const f = root.SearchField.mount(body.querySelector('.mem-search'), { fields: ['Name', 'State'], examples: root.SearchField.sample(data.members.map((m) => m.fn ? m.name.replace(/\s*\(.*$/, '') : m.name), 12) }); } }
    body.scrollTop = 0;
    if (st.id) mountClamps(body);
    if (st.id && opts.discharge) fillPetitions(st.id);
    if (st.id) { const cur = data.members.find((x) => x.id === st.id); fillProfile(cur); fillFloor(cur); }
  }

  // The window is in the address: #members, or #member/<id>, so a reload reopens it and a link shares it.
  const setHash = (h) => { try { history.replaceState(null, '', location.pathname + location.search + (h || '')); } catch (e) {} };

  // The bill and petition windows sit above this one. Opened from inside one of them (a sponsor's name), this window comes to the front of it; a bill opened from in here goes in front instead.
  const otherWindowOpen = () => !!document.querySelector('.bill-modal-overlay:not([hidden]), .dp-modal-overlay, .info-popup-overlay:not([hidden])');
  function front() { if (ov) ov.style.zIndex = otherWindowOpen() ? '1300' : ''; }

  function close() {
    if (!ov) return;
    setHash('');
    const o = ov; ov = null;
    o.classList.remove('is-open'); setTimeout(() => o.remove(), 220);
    document.removeEventListener('keydown', onKey);
    if (trap) { trap.release(); trap = null; }
    if (opener && opener.focus) try { opener.focus(); } catch (e) {}
  }

  async function open(id) {
    if (ov) { front(); if (id) { st.id = id; render(); } return; }
    opener = document.activeElement;
    st.id = id || null;
    ov = document.createElement('div');
    ov.className = 'tm-picker-overlay mem-overlay';
    ov.innerHTML = `<div class="tm-picker mem-dialog" role="dialog" aria-modal="true" aria-label="Members"><div class="tm-picker-head mem-head-bar"><span class="mem-headleft"></span><button type="button" class="tm-picker-close" aria-label="Close"></button></div><div class="mem-body" aria-busy="true">${loadingHtml()}</div><div class="mem-foot"><span class="panel-source">Source: <a href="https://clerk.house.gov/Votes" target="_blank" rel="noopener">Roll Call Votes (House Clerk)</a></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') e.target.remove(); }, true);   // a Member without a photo shows the empty frame
    requestAnimationFrame(() => ov && ov.classList.add('is-open'));
    onKey = (e) => { if (e.key === 'Escape') { if (st.id && !id) { st.id = null; render(); } else close(); } };
    document.addEventListener('keydown', onKey);
    if (root.FocusTrap) trap = root.FocusTrap.activate(ov.querySelector('.mem-dialog'), { initial: '.tm-picker-close' });
    ov.querySelector('.tm-picker-close').addEventListener('click', close);
    front();
    ov.addEventListener('click', (e) => {
      if (e.target === ov) return close();
      const t = e.target;
      if (t.closest('[data-act], [data-dp-signers]')) ov.style.zIndex = '';   // a bill or a petition opened from in here goes in front of this window
      const fold = t.closest('[data-fold]'); if (fold) { const f = ov.querySelector('.mem-fold'); const on = !f.classList.contains('is-open'); f.classList.toggle('is-open', on); fold.setAttribute('aria-expanded', String(on)); fold.textContent = on ? 'Hide' : 'Show which'; return; }
      const lk = t.closest('.mem-link[data-member]'); if (lk) { st.id = lk.dataset.member; render(); return; }
      const like = t.closest('.mem-like'); if (like) { st.id = like.dataset.id; render(); return; }
      const row = t.closest('.mem-row'); if (row) { st.id = row.dataset.id; render(); return; }
      if (t.closest('.mem-back')) { st.id = null; render(); return; }
      const cg = t.closest('[data-congress]'); if (cg) { switchCongress(Number(cg.dataset.congress)); return; }
      const p = t.closest('[data-party]'); if (p) { st.party = require_next(p.dataset.party); ov.querySelectorAll('[data-party]').forEach((b) => b.classList.toggle('active', b.dataset.party === st.party)); drawList(); return; }
      const th = t.closest('.mem-th'); if (th) { if (st.sort === th.dataset.k) st.dir = -st.dir; else { st.sort = th.dataset.k; st.dir = th.dataset.k === 'name' ? 1 : -1; } drawList(); return; }
    });
    ov.addEventListener('change', (e) => { if (e.target.classList && e.target.classList.contains('mem-former')) { st.former = e.target.checked; drawList(); } });
    ov.addEventListener('input', (e) => { if (e.target.classList.contains('mem-search')) { st.q = e.target.value; drawList(); } });
    if (!st.congress) st.congress = congressNow();
    try { data = await load(st.congress); } catch (e) {
      if (ov) ov.querySelector('.mem-body').innerHTML = root.EmptyState ? root.EmptyState.error('Member data is unavailable', 'The vote history could not be loaded. Check back shortly.', 'rows') : '<p class="mem-lede">Member data is unavailable.</p>';
      return;
    }
    if (ov) sources();
    if (ov) { render(); if (!st.id) { const s = ov.querySelector('.mem-search'); if (s) s.focus(); } }
    if (data && Date.now() - (data.caughtAt || 0) > 60000) catchUp(data);
  }

  // Each Member's current run of voting days missed in a row (id -> number), for the Missing Members panel: the record, brought up to the latest roll call first.
  async function allDayStreaks() {
    await ready;
    const d = await load(congressNow());
    if (Date.now() - (d.caughtAt || 0) > 60000) await catchUp(d);
    return new Map(d.members.map((m) => [m.id, m.dayStreak || 0]));
  }

  async function switchCongress(c) {
    if (!ov || c === st.congress) return;
    st.congress = c; st.id = null;
    ov.querySelector('.mem-body').innerHTML = loadingHtml();
    try { data = await load(c); } catch (e) { ov.querySelector('.mem-body').innerHTML = root.EmptyState ? root.EmptyState.error('Member data is unavailable', 'The vote history could not be loaded. Check back shortly.', 'rows') : ''; return; }
    render(); sources();
    if (Date.now() - (data.caughtAt || 0) > 60000) catchUp(data);
  }
  function require_next(p) { return root.Segmented ? root.Segmented.next('filter', st.party, p) : p; }

  function init(o) {
    opts = o || {};
    markReady();
    document.documentElement.classList.add('has-members');   // the page's Member names and faces are links now (see styles.css)
    // Any name or face on the page that carries data-open-member opens that Member here (a link inside it keeps its own job)
    document.addEventListener('click', (e) => {
      const el = e.target.closest && e.target.closest('[data-open-member]');
      if (!el || e.target.closest('a[href], button')) return;
      e.preventDefault(); open(el.dataset.openMember);
    });
    document.addEventListener('click', (e) => { const b = e.target.closest('#members-btn'); if (b) { e.preventDefault(); open(); } });
    const hm = location.hash.match(/^#member\/([A-Za-z]\d{6})$/);
    if (hm) open(hm[1].toUpperCase()); else if (location.hash === '#members') open();
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      e.preventDefault(); open();
    });
  }

  root.Members = { init, open, close, streaks: allDayStreaks, has: () => !!data };
})(typeof globalThis !== 'undefined' ? globalThis : this);
