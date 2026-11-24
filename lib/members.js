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
  const st = { q: '', party: 'all', former: false, meet: false, sort: 'missedPct', dir: -1, id: null };

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
    return `<li><span class="mem-roll-n">${r.n}</span><span class="mem-roll-t">${extra && extra.vote ? `<em class="mem-vote ${VOTE[extra.vote][1]}">${VOTE[extra.vote][0]}</em>` : ''}${rollText(r)}${r.t ? `<small>${esc(r.t)}</small>` : ''}<small class="mem-result">${esc(t)}${isClose(r) ? ` <b class="mem-close">decided by ${Math.abs(r.ye - r.na)}</b>` : ''}${extra && extra.broke ? ' <b class="mem-broke">voted against their party</b>' : ''}</small></span><span class="mem-roll-d">${fmtDate(r.d)}</span></li>`;
  }
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
    return data.members.filter((m) => (st.former || m.active) && (!st.meet || (meetingsFor(m) || []).length > 0) && (st.party === 'all' || PARTY[m.party] === st.party) && (!q || m.search.includes(q))).sort(cmp(st.sort, st.dir));
  }
  function rowHtml(m) {
    const cells = [
      `<span class="mem-num">${m.missed}<i> / ${m.rolls}</i></span><b class="sev-${sev(m.missedPct)}">${pf(m.missedPct)}</b>`,
      `<span class="mem-num">${m.daysMissed}<i> / ${m.days}</i></span>`,
      `<span class="mem-num">${m.weeksMissed}<i> / ${m.weeks}</i></span>`,
      m.breakPct == null ? '<span class="mem-dim">–</span>' : `<span class="mem-num">${pf(m.breakPct)}</span>`,
    ];
    return `<button type="button" class="mem-row ${PARTY[m.party] || ''}${m.active ? '' : ' is-former'}${m.rolls < FEW ? ' is-few' : ''}" title="${m.rolls < FEW ? 'Only ' + m.rolls + ' roll calls, too few for the percentages to mean much' : ''}" data-id="${esc(m.id)}">${photo(m.id)}<span class="mem-who"><b>${esc(m.full)}${(meetingsFor(m) || []).length ? '<span class="mem-dot" title="A committee or subcommittee of theirs meets today"></span>' : ''}</b><i>${seat(m)}${m.active ? '' : m.gone ? ' · no longer a Member' : ' · left ' + fmtDate(m.last)}</i></span>${cells.map((c, i) => `<span class="mem-cell c${i}">${c}</span>`).join('')}</button>`;
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
        ${dayData() ? `<button type="button" class="bills-sort-btn mem-meeting${st.meet ? ' active' : ''}" aria-pressed="${st.meet}" title="Only Members with a committee or subcommittee meeting today">Meeting today</button>` : ''}
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
  // STAGING ONLY (temporary): a button in the window that swaps today's meetings for a real past day's, from the same Clerk feed, so the meeting markers can be judged on a day with none.
  const STAGING = /^(?:house|senate)-floor-staging\.evanhollander\.org$/.test(location.hostname);
  const PREVIEW_DAY = '12/10/2025';
  let preview = null;
  const dayData = () => preview || (opts.meetings && opts.meetings());
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
  function detailHtml(m) {
    const R = data.rollList;
    const lo = R.findIndex((r) => r.d >= m.first);
    let hi = -1; for (let i = R.length - 1; i >= 0; i--) if (R[i].d <= m.last) { hi = i; break; }
    const missed = new Set(m.missedAt);
    const last10 = []; for (let i = hi; i >= lo && last10.length < 10; i--) last10.unshift(i);
    const dayStat = DAYS.map((d, wd) => { let n = 0, x = 0; for (let i = lo; i <= hi; i++) { const dt = new Date(R[i].d + 'T12:00:00Z'); if (((dt.getUTCDay() + 6) % 7) !== wd) continue; n++; if (missed.has(i)) x++; } return { d, n, x, p: pct(x, n) }; });
    const top = Math.max(25, Math.ceil(Math.max(...dayStat.map((s) => s.p)) / 5) * 5);   // a fixed scale from 0, never stretched to the tallest bar
    const breakSet = new Set(m.breakAt);
    const list = (idx, id) => {
      const rows = [...idx].reverse();
      const show = rows.slice(0, 12);
      return `<ol class="mem-rolls" data-for="${id}">${show.map((i) => rollRow(i, { broke: id === 'recent' && breakSet.has(i) })).join('')}</ol>${rows.length > show.length ? `<button type="button" class="mem-more" data-more="${id}">Show ${rows.length - show.length} more</button>` : ''}`;
    };
    // the last votes they cast (a missed vote has its own list below)
    const castRows = [...(m.cast || [])].reverse();
    const recentList = castRows.length ? (() => {
      const show = castRows.slice(0, 10);
      return `<ol class="mem-rolls" data-for="recent">${show.map(([i, c]) => rollRow(i, { vote: c, broke: breakSet.has(i) })).join('')}</ol>${castRows.length > show.length ? `<button type="button" class="mem-more" data-more="recent">Show ${castRows.length - show.length} more</button>` : ''}`;
    })() : '<p class="mem-none">No votes cast.</p>';
    const missedReal = m.missedAt.filter((i) => recorded(data.rollList[i]));
    const missedClose = missedReal.filter((i) => isClose(data.rollList[i]));
    const closeNote = missedReal.length ? `<p class="mem-note">${missedClose.length} of the ${missedReal.length} recorded votes they missed ${missedClose.length === 1 ? 'was' : 'were'} decided by ${CLOSE} or fewer.</p>` : '';
    const likes = (m.like || []).map(([id, p]) => ({ m: data.members.find((x) => x.id === id), p })).filter((x) => x.m);
    const likeHtml = likes.length ? `<h3 class="mem-h">Votes most like theirs <em>agreement on votes both cast</em></h3><div class="mem-likes">${likes.map(({ m: o, p }) => `<button type="button" class="mem-like" data-id="${esc(o.id)}">${photo(o.id)}<span><b>${esc(o.full)}</b><i>${esc(o.party)}-${esc(o.state)}</i></span><em>${pf(p)}</em></button>`).join('')}</div>` : '';
    const dpHtml = opts.discharge && opts.discharge.list() ? `<h3 class="mem-h">Discharge petitions <em class="mem-dp-count">loading</em></h3><div class="mem-dp" data-for="${esc(m.id)}"><p class="mem-none">Reading the signature lists\u2026</p></div>` : '';
    const ts = series(m);
    const cards = [
      ['Votes missed', pf(m.missedPct), `${m.missed} of ${m.rolls} roll calls`, spark(ts && ts.votes, 'red'), `sev-${sev(m.missedPct)}`],
      ['Days missed', `${m.daysMissed}`, `of ${m.days} voting days`, spark(ts && ts.days, 'red'), ''],
      ['Weeks missed', `${m.weeksMissed}`, `of ${m.weeks} voting weeks`, spark(ts && ts.weeks, 'red'), ''],
      ['Party breaks', m.breakPct == null ? '–' : pf(m.breakPct), m.breakPct == null ? 'not scored' : `${m.breaks} of ${m.unityScored} party-split votes`, spark(ts && ts.breaks, 'purple'), ''],
    ];
    return `<div class="mem-id">${photo(m.id).replace('mem-photo', 'mem-photo is-big')}<div><h2>${esc(m.full)}</h2><p>${seat(m)}${m.active ? '' : m.gone ? ` · no longer a Member (last roll in this data: ${fmtDate(m.last)})` : ` · served ${fmtDate(m.first)} to ${fmtDate(m.last)}`}</p>
        ${infoHtml(m)}<a class="mem-ext ext" href="https://clerk.house.gov/members/${esc(m.id)}" target="_blank" rel="noopener">Clerk profile</a></div></div>
      <div class="mem-cards">${cards.map(([a, b, c, sp, sv]) => `<div class="mem-card">${sp}<span>${a}</span><b class="${sv}">${b}</b><i>${c}</i></div>`).join('')}</div>
      ${streaksHtml(m)}
      ${committeesHtml(m)}
      <h3 class="mem-h">Recent votes <em>votes cast, newest first</em></h3>${recentList}
      ${likeHtml}
      ${dpHtml}
      <h3 class="mem-h">Last ${last10.length} roll calls</h3>
      <div class="mem-last" title="Red: not voting. Green: voted.">${last10.map((i) => `<span class="${missed.has(i) ? 'x' : 'v'}" title="Roll ${R[i].n}, ${esc(fmtDate(R[i].d))}: ${missed.has(i) ? 'not voting' : 'voted'}"></span>`).join('')}</div>
      <h3 class="mem-h">Votes missed by weekday <em>scale 0 to ${top}%</em></h3>
      <div class="mem-wd">${dayStat.map((s) => `<div title="${s.x} of ${s.n} roll calls"><span class="bar"><s class="sev-${sev(s.p)}" style="height:${s.p ? Math.max(2, 100 * s.p / top).toFixed(1) : 0}%"></s></span><b>${s.n ? pf(s.p) : '–'}</b><i>${s.d}</i></div>`).join('')}</div>
      <h3 class="mem-h">Roll calls missed <em>${m.missed}</em></h3>${closeNote}${m.missed ? list(m.missedAt, 'missed') : '<p class="mem-none">None.</p>'}
      <h3 class="mem-h">Voted against their party <em>${m.breaks}</em></h3>${m.breaks ? list(m.breakAt, 'breaks') : '<p class="mem-none">None on a party-split vote.</p>'}`;
  }

  // The Source line, as every panel has one: the Clerk's roll calls, with a popover saying what was counted, and the other sources the window draws on.
  function sources() {
    const foot = ov && ov.querySelector('.mem-foot');
    if (!foot || !root.SourcePop || !data) return;
    root.SourcePop.set(foot, {
      title: 'Member vote record, 119th Congress',
      request: 'GET https://clerk.house.gov/evs/<year>/roll<NNN>.xml  (one file per roll call, 2025 and 2026)',
      rows: [
        ['Roll calls read', String(data.rolls)],
        ['Voting days', String(data.days)],
        ['Voting weeks (Monday to Sunday)', String(data.weeks)],
        ['Through', data.through],
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
      { name: 'Bioguide', href: 'https://bioguide.congress.gov', supplies: 'photos' },
    ]);
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
    const list = opts.discharge.list() || [];
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
    if (count) count.textContent = `signed ${signed.length} of ${list.length}`;
    const iso = (d) => { const m = String(d || '').match(/^(\d\d)\/(\d\d)\/(\d{4})$/); return m ? `${m[3]}-${m[1]}-${m[2]}` : ''; };
    const row = ({ pt, hit }) => `<li><span class="mem-roll-n">No. ${esc(pt.number)}</span><span class="mem-roll-t">${esc(pt.billNumber || '')}${pt.sponsor ? ' \u00b7 ' + esc(pt.sponsor) : ''}<small>${esc((pt.description || '').replace(/^Providing for (?:the )?consideration of /i, 'Consideration of '))}</small></span><span class="mem-roll-d">signed ${esc(fmtDate(iso(hit.date)) || hit.date || '')}</span></li>`;
    live.innerHTML = (signed.length ? `<ol class="mem-rolls">${signed.map(row).join('')}</ol>` : '<p class="mem-none">Has not signed any.</p>')
      + (open.length ? `<p class="mem-note">Has not signed the ${open.length} petition${open.length === 1 ? '' : 's'} still short of ${opts.discharge.needed || 218}: ${open.map((pt) => `<span class="mem-chipn" title="${esc(pt.billNumber || '')}">No. ${esc(pt.number)}</span>`).join(' ')}</p>` : '');
  }

  // ── the modal ──────────────────────────────────────────────────────────────
  function render() {
    const body = ov.querySelector('.mem-body');
    if (st.id) { const m = data.members.find((x) => x.id === st.id); body.innerHTML = m ? detailHtml(m) : directoryHtml(); if (!m) st.id = null; }
    else body.innerHTML = directoryHtml();
    ov.querySelector('.mem-headleft').innerHTML = st.id
      ? '<button type="button" class="mem-back"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>All Members</button><span class="tm-picker-title mem-title">MEMBER</span>'
      : '<span class="tm-picker-title mem-title">MEMBERS</span>';
    setHash(st.id ? '#member/' + st.id : '#members');
    if (!st.id) { drawList(); if (root.SearchField) { const f = root.SearchField.mount(body.querySelector('.mem-search'), { fields: ['Name', 'State'], examples: root.SearchField.sample(data.members.map((m) => m.fn ? m.name.replace(/\s*\(.*$/, '') : m.name), 12) }); } }
    body.scrollTop = 0;
    if (st.id && opts.discharge && opts.discharge.list()) fillPetitions(st.id);
  }

  // The window is in the address: #members, or #member/<id>, so a reload reopens it and a link shares it.
  const setHash = (h) => { try { history.replaceState(null, '', location.pathname + location.search + (h || '')); } catch (e) {} };

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
    if (ov) { if (id) { st.id = id; render(); } return; }
    opener = document.activeElement;
    st.id = id || null;
    ov = document.createElement('div');
    ov.className = 'tm-picker-overlay mem-overlay';
    ov.innerHTML = `<div class="tm-picker mem-dialog" role="dialog" aria-modal="true" aria-label="Members"><div class="tm-picker-head mem-head-bar"><span class="mem-headleft"></span>${STAGING ? '<button type="button" class="bills-sort-btn mem-preview" title="Staging only: show a past day on which committees met">Preview a meeting day</button>' : ''}<button type="button" class="tm-picker-close" aria-label="Close"></button></div><div class="mem-body"><p class="mem-lede">Loading…</p></div><div class="mem-foot"><span class="panel-source">Source: <a href="https://clerk.house.gov/Votes" target="_blank" rel="noopener">Roll Call Votes (House Clerk)</a></span></div></div>`;
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
      const like = t.closest('.mem-like'); if (like) { st.id = like.dataset.id; render(); return; }
      const row = t.closest('.mem-row'); if (row) { st.id = row.dataset.id; render(); return; }
      if (t.closest('.mem-back')) { st.id = null; render(); return; }
      const p = t.closest('[data-party]'); if (p) { st.party = require_next(p.dataset.party); ov.querySelectorAll('[data-party]').forEach((b) => b.classList.toggle('active', b.dataset.party === st.party)); drawList(); return; }
      if (t.closest('.mem-preview')) {
        const b = t.closest('.mem-preview');
        if (preview) { preview = null; b.textContent = 'Preview a meeting day'; b.classList.remove('active'); render(); return; }
        b.textContent = 'Loading\u2026';
        fetch('https://api.evanhollander.org/house-floor/api/committee-meetings?date=' + encodeURIComponent(PREVIEW_DAY)).then((r) => r.json()).then((d) => {
          preview = { date: PREVIEW_DAY, events: d.events || [] };
          b.textContent = `Previewing ${PREVIEW_DAY} (${preview.events.length} meetings). Click to stop`; b.classList.add('active'); render();
        }).catch(() => { b.textContent = 'Preview unavailable'; });
        return;
      }
      if (t.closest('.mem-meeting')) { st.meet = !st.meet; const b = t.closest('.mem-meeting'); b.classList.toggle('active', st.meet); b.setAttribute('aria-pressed', st.meet); drawList(); return; }
      if (t.closest('.mem-former')) { st.former = !st.former; const b = t.closest('.mem-former'); b.classList.toggle('active', st.former); b.setAttribute('aria-pressed', st.former); drawList(); return; }
      const th = t.closest('.mem-th'); if (th) { if (st.sort === th.dataset.k) st.dir = -st.dir; else { st.sort = th.dataset.k; st.dir = -1; } drawList(); return; }
      const more = t.closest('[data-more]'); if (more) {
        const m = data.members.find((x) => x.id === st.id); const which = more.dataset.more;
        const ol = ov.querySelector(`.mem-rolls[data-for="${which}"]`); const brk = new Set(m.breakAt);
        ol.innerHTML = which === 'recent' ? [...(m.cast || [])].reverse().map(([i, c]) => rollRow(i, { vote: c, broke: brk.has(i) })).join('') : [...(which === 'missed' ? m.missedAt : m.breakAt)].reverse().map((i) => rollRow(i)).join('');
        more.remove();
      }
    });
    ov.addEventListener('input', (e) => { if (e.target.classList.contains('mem-search')) { st.q = e.target.value; drawList(); } });
    try { await load(); } catch (e) {
      if (ov) ov.querySelector('.mem-body').innerHTML = root.EmptyState ? root.EmptyState.error('Member data is unavailable', 'The vote history could not be loaded. Check back shortly.', 'rows') : '<p class="mem-lede">Member data is unavailable.</p>';
      return;
    }
    if (ov) sources();
    if (ov) { render(); if (!st.id) { const s = ov.querySelector('.mem-search'); if (s) s.focus(); } }
  }
  function require_next(p) { return root.Segmented ? root.Segmented.next('filter', st.party, p) : p; }

  function init(o) {
    opts = o || {};
    document.addEventListener('click', (e) => { const b = e.target.closest('#members-btn'); if (b) { e.preventDefault(); open(); } });
    const hm = location.hash.match(/^#member\/([A-Za-z]\d{6})$/);
    if (hm) open(hm[1].toUpperCase()); else if (location.hash === '#members') open();
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      e.preventDefault(); open();
    });
  }

  root.Members = { init, open, close, has: () => !!data };
})(typeof globalThis !== 'undefined' ? globalThis : this);
