// The SPEAKER ELECTION panel (House board): who is getting how many votes as the roll is read, ballot by ballot. The election is a roll read ALOUD, not an electronic vote, so
// the numbers come from the House's captions through lib/speaker-election.js. They are a FLOOR (some answers are lost to garbled names) until the tellers read the totals, which then
// replace them. The majority is of the Members who vote for a person: known only when the roll ends, so it is drawn as an ESTIMATE (dashed: the majority if every Member votes)
// until the tellers report, then solid with the real number.
//
//   SpeakerPanel.mount({ base, placeholder })    placeholder: the site's generic member image, under every photo (and alone for a candidate not yet placed, or a photo that does not load)
//
// WHERE THE CAPTIONS COME FROM, AND WHY NOTHING IS STORED. The day's whole caption file is a public file on the House's CDN that grows through the day (the Time Machine reads the
// same one), so every tab reads it whole and works out every ballot again: a reload, a second visitor and a tab opened an hour late all get the same ballots with nothing saved
// anywhere. Earlier ballots are kept by being in the file. In the Time Machine the cues are the replay's own (window.__replay.cues) up to the moment on the clock, so scrubbing back
// shows the count at that moment.
//
// WHEN IT WATCHES. In the Time Machine on any day whose captions hold a roll; on a live day when the Clerk's log says the House is electing a Speaker, or in the first days of January of
// an odd year (a new Congress; the file is only fetched, a roll found in it or not); and for `?speaker=YYYYMMDD`, which shows that day (3 January 2025 is the one to try), with `&upto=N` for the first N cues.
(function (root) {
  'use strict';
  const SE = root.SpeakerElection;
  const { escapeHtml: esc } = root.BoardUtil;
  const PARTY = { R: 'var(--party-r)', D: 'var(--party-d)', I: 'var(--party-i)' };
  const SHOWN = 5;
  const AFTER_S = 12 * 60;   // seconds of captions after the winner is declared that the panel stays up: long enough to read the result and the ballots, not the afternoon
  const CHECK = '<span class="se-check" title="Elected"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.4l2.3 2.3 4.7-5"/></svg></span>';

  function mount({ base, placeholder }) {
    const el = document.getElementById('speaker-election');
    if (!el || !SE) return;
    const q = new URLSearchParams(location.search);
    let roster = null, rosterTried = false, leaders = [], cues = null, cuesKey = null, ballots = [], viewIdx = null, timer = null, busy = false, lastHtml = '';

    const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
    const forced = (q.get('speaker') || '').replace(/\D/g, '');
    let uptoNow = Number(q.get('upto')) || 0;
    // the Time Machine is on for the whole page from the address, not from whether its cues have arrived: before they do, the panel must NOT fall back to the live day's captions, which in a
    // replay are the replayed day's whole file and would show a finished election at 12:04 PM, hours before the roll
    const inReplay = () => /[?&]replay=/.test(location.search);

    async function loadRoster() {
      if (roster || rosterTried) return;
      rosterTried = true;
      try {
        const j = await (await fetch(`${base}/member-data`)).json();
        const built = root.HouseFloorSpeaker && root.HouseFloorSpeaker.buildRoster(j.xmlData || '');
        // Members vote for the Speaker; the Delegates and the Resident Commissioner (DC, Puerto Rico, Guam, the Virgin Islands, American Samoa, the Northern Marianas) do not. The Clerk's file
        // lists all of them, so the House is 435 seats less its vacancies, not the file's length.
        const NON_VOTING = new Set(['DC', 'PR', 'GU', 'VI', 'AS', 'MP']);
        const voting = built ? built.filter((m) => !NON_VOTING.has(m.postal)) : [];
        if (voting.length) roster = voting;
      } catch { /* the bars still draw, without faces */ }
      try {
        const l = await (await fetch(`${base}/leadership`)).json();
        leaders = [l.bioguideId, ...((l.leaders || []).map((x) => x.bioguideId))].filter(Boolean);
      } catch { /* no hint */ }
    }

    // THE OPENING DAY'S ROSTER. The Clerk's member file may not list the Members-elect yet (or lists the last Congress), but roll call 1, the quorum "Call by States", does, about 25 minutes
    // before the Speaker roll begins (lib/speaker-election.js `rosterFromRoll`). Fetched once the roll is in the captions, retried each minute until the Clerk has posted it (a few times), and
    // used in place of the member file's roster when it is there. It is also why the Time Machine names the Members of 3 January 2025 who have since left.
    let rollRoster = null, rollExpected = null, rollTriedAt = 0, rollTries = 0;
    async function ensureRollRoster() {
      if (rollRoster || rollTries >= 6 || Date.now() - rollTriedAt < 60000) return;
      rollTriedAt = Date.now(); rollTries++;
      try {
        const year = inReplay() ? (location.search.match(/[?&]replay=(\d{4})/) || [])[1]
          : forced ? forced.slice(0, 4)
          : new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 4);
        const r = await fetch(`${base}/congress-index/roll/1?year=${year}`);
        if (!r.ok) return;
        const built = SE.rosterFromRoll(await r.text(), roster || []);
        if (built) { rollRoster = built.roster; rollExpected = built.expected; }
      } catch { /* the member file's roster stands */ }
    }

    // Is it worth fetching the day's captions? Cheap tests only.
    function worthWatching() {
      if (forced || inReplay()) return true;
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      if (now.getMonth() === 0 && now.getDate() >= 3 && now.getDate() <= 6 && now.getFullYear() % 2 === 1) return true;
      try { if (typeof proceedingsData !== 'undefined' && Array.isArray(proceedingsData) && /election of (?:a |the )?Speaker/i.test(JSON.stringify(proceedingsData))) return true; } catch { /* not loaded */ }
      return false;
    }

    async function getCues() {
      if (inReplay()) {
        const R = root.__replay;
        // not ready (the cues, or the clock that says which moment it is): nothing yet
        if (!R || !R.cues || !R.cues.length || !R.timeline || !Number.isFinite(R.wallMs)) return null;
        // the cues stamped up to the moment on the clock, in the file's order
        const upTo = R.timeline.captionFromWall(R.wallMs);
        return R.cues.filter((c) => c.t <= upTo).map((c) => ({ text: c.text, t: c.t }));
      }
      const day = forced || ymd(new Date());
      const rec = await (await fetch(`${base}/replay-day?date=${day}`)).json();
      if (!rec || !rec.vtt) return [];
      const text = await (await fetch(rec.vtt)).text();
      if (!SE.hasRoll || !SE.hasRoll(text)) return [];
      const all = SE.parseVtt(text);
      const upto = uptoNow;   // ?speaker=20250103&upto=500: the panel as of the first 500 cues, to see it mid-roll without the Time Machine
      return forced && upto > 0 ? all.slice(0, upto) : all;
    }

    function viewModel(b, latest) {
      const ann = b.announced || null;
      const over = !!(ann && (ann.total || ann.elected || (ann.candidates && ann.candidates.length)));
      const keyOf = (name) => SE.fold(name).split(' ').pop();
      // what was heard, with each count the tellers have read so far put in its place; one they have not read yet stays as heard
      const rows = b.candidates.map((c) => ({ key: c.key, name: (c.member && c.member.name) || c.display, votes: c.votes, member: c.member, announced: false }));
      for (const a of (ann && ann.candidates) || []) {
        const key = keyOf(a.name);
        const at = rows.findIndex((r) => r.key === key);
        if (at >= 0) rows[at] = { ...rows[at], votes: a.votes, name: rows[at].member && rows[at].member.name ? rows[at].name : titleCase(a.name), announced: true };
        else rows.push({ key, name: titleCase(a.name), votes: a.votes, member: null, announced: true });
      }
      // once the announcement is complete, a candidate the tellers did not name was not a candidate (a count lost to a garbled name, a vote that was changed)
      const done = !!(ann && ann.complete) || (!latest && over);   // an earlier ballot is over: a later one has begun
      const kept = done ? rows.filter((r) => r.announced) : rows;
      const total = ann && ann.total ? ann.total : null;
      const need = total ? Math.floor(total / 2) + 1 : (b.majority || 218);
      const winnerKey = ann && ann.elected ? keyOf(ann.elected) : null;
      return { rows: kept, over, done, total, need, estimate: !total, winnerKey, ann, b };
    }
    const heardName = (t) => String(t).toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase()).replace(/ Of /g, ' of ');
    const titleCase = (s) => String(s).toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());

    function ring(m) { return PARTY[(m && m.party && m.party[0]) || ''] || 'var(--text-muted)'; }
    function photo(m, cls) {
      const c = ring(m);
      const img = m && m.bioguideId ? `<img src="https://bioguide.congress.gov/photo/${esc(m.bioguideId)}.jpg" alt="">` : '';
      return `<span class="${cls}" style="--c:${c}">${placeholder || ''}${img}</span>`;
    }

    // While the roll is being read and the tellers are reporting, the Clerk's log has said nothing since it logged the tellers' appointment (12:50 on 3 January 2025, the result at 2:36), so the House's
    // own Happening Now card sat on "Appointment of Tellers" for an hour and three quarters, repeating what this panel's Tellers row says. The body class lets the stylesheet hold that card back.
    const setLive = (on) => document.body.classList.toggle('speaker-election-live', !!on);

    function render() {
      if (!ballots.length) { setLive(false); if (!el.hidden) { el.hidden = true; el.innerHTML = ''; lastHtml = ''; } return; }
      const cur = ballots.length;
      // once the Speaker has been declared for a while the panel steps aside: the House has moved on (the escort, the oath, the day's business) and "Happening Now" must not say the election is
      const lastB = ballots[cur - 1];
      if (lastB.electedT != null && lastB.nowT != null && lastB.nowT - lastB.electedT > AFTER_S) { setLive(false); if (!el.hidden) { el.hidden = true; el.innerHTML = ''; lastHtml = ''; } return; }
      const idx = viewIdx != null && viewIdx < cur ? viewIdx : cur;   // 1-based; viewIdx null follows the latest ballot
      const vm = viewModel(ballots[idx - 1], idx === cur);
      // equal counts keep the order they had, so a tie does not make the rows trade places every time a vote lands
      const was = el._order && el._order.ballot === idx ? el._order.keys : [];
      const at = (k) => { const i = was.indexOf(k); return i < 0 ? 99 : i; };
      vm.rows.sort((x, y) => (y.votes - x.votes) || (at(x.key) - at(y.key)));
      el._order = { ballot: idx, keys: vm.rows.map((r) => r.key) };
      const live = !vm.over;
      const elected = !!vm.winnerKey;
      setLive(idx === cur && !vm.done);
      const tag = live ? '<span class="vote-type-tag se-state is-live">READING THE ROLL</span>'
        : !vm.done ? '<span class="vote-type-tag se-state is-live">TELLERS REPORTING</span>'
        : elected ? '<span class="vote-type-tag se-state is-done">TELLERS REPORTED</span>'
        : '<span class="vote-type-tag se-state is-none">NO MAJORITY</span>';
      const nav = `<span class="se-nav"><button type="button" class="tm-nav-btn" data-se-nav="-1" aria-label="Previous ballot"${idx <= 1 ? ' disabled' : ''}>‹</button><span class="se-nav-label">BALLOT ${idx}${cur > 1 ? ` <span>of ${cur}</span>` : ''}</span><button type="button" class="tm-nav-btn" data-se-nav="1" aria-label="Next ballot"${idx >= cur ? ' disabled' : ''}>›</button></span>`;
      const back = idx < cur ? `<button type="button" class="se-back" data-se-nav="latest">Back to ballot ${cur}</button>` : '';
      const shown = vm.rows.slice(0, SHOWN), rest = vm.rows.slice(SHOWN);
      // the rows are kept between draws (updateRows): a row that stays is changed in place and moves when its place changes, so a bar grows, a count ticks and the leader rises
      const rowData = shown.map((r) => {
        const win = elected && r.key === vm.winnerKey;
        const w = Math.min(100, (r.votes / (vm.need * 2)) * 100);
        const c = ring(r.member);
        const sub = r.member ? `${esc(r.member.party || '')}-${esc(r.member.state || '')}` : '';
        return { key: r.key, win, w, c, votes: r.votes, estimate: vm.estimate, who: `${photo(r.member, 'se-cph')}<span class="se-cn"><b>${esc(r.name)}${win ? CHECK : ''}</b>${sub ? `<span>${sub}</span>` : ''}</span>` };
      });
      const others = rest.length ? `<div class="se-others">${rest.length} more: ${rest.map((r) => `${esc(r.name)} ${r.votes}`).join(', ')}</div>` : '';
      const exp = vm.b.expected || 434;
      const need = vm.estimate
        ? `<span class="se-need"><b>~${vm.need}</b> <em class="lg">estimate: if all ${exp} vote</em><em class="sm">est.</em></span>`
        : `<span class="se-need"><b>${vm.need}</b> <span class="lg">of ${vm.total} votes cast</span></span>`;
      // the tellers, appointed before the roll: who is counting
      const tellers = (vm.b.tellers || []).length ? `<div class="se-tellers"><span class="se-tellers-h">TELLERS</span>${vm.b.tellers.map((t) => {
        const who = t.member ? `<b>${esc(t.member.last)}</b> ${esc(t.member.party || '')}-${esc(t.member.state || '')}` : `<b>${esc(heardName(t.heard))}</b> ${esc(t.state)}`;
        return `<span class="se-teller">${photo(t.member, 'se-tph')}<span>${who}</span></span>`;
      }).join('')}</div>` : '';
      const recent = live ? (vm.b.recent || []).slice(-4).reverse() : [];
      const strip = recent.length ? `<div class="se-strip"><div class="se-strip-h">JUST READ</div><div class="se-reads">${recent.map((r) => {
        const cand = vm.b.candidates.find((c) => c.key === r.candidate);
        const cm = cand ? cand.member : null;
        // a Member who could not be placed (a former Member, a garbled name) is written as the captions have it, not as "Heard"
        const name = r.member ? `<b>${esc(r.member.last)}</b> ${esc(r.member.party || '')}-${esc(r.member.state || '')}`
          : r.heard ? `<b>${esc(heardName(r.heard))}</b>` : '<span class="se-unk">Name not caught</span>';
        return `<div class="se-read">${photo(r.member, 'se-ph')}<span class="se-rn">${name}</span><span class="se-rc" style="color:${ring(cm)}">${esc((cand && cand.display) || titleCase(r.candidate))}</span></div>`;
      }).join('')}</div></div>` : '';
      const foot = live
        ? `<div class="se-foot"><span><b>${vm.b.heard}</b> of ${exp} Members heard</span><span class="se-note">Counted from the captions, so a floor. The majority is of those who vote for a person, known only when the roll ends.</span></div>`
        : !vm.done
          ? `<div class="se-foot"><span class="se-note">The tellers are reading their totals${vm.total != null ? `: ${vm.total} votes cast, ${vm.need} needed` : ''}. A count they have read is final; the others are still what was heard.</span></div>`
          : `<div class="se-foot"><span class="se-note">Tellers' totals: ${vm.total != null ? `${vm.total} votes cast, ${vm.need} needed.` : 'announced.'} ${elected ? 'Clerk roll to follow.' : 'No candidate had a majority, so the House balloted again.'}</span></div>`;
      const html = `<div class="panel-header"><span class="panel-label" data-icon="live">Happening Now</span><span class="vote-type-tag se-kind">SPEAKER ELECTION</span>${nav}${tag}${back}<div class="panel-header-right"><span class="panel-source">Source: <a href="https://www.house.gov/" target="_blank" rel="noopener">House floor captions</a></span></div></div>`
        + `<div class="se-head"><h2 class="se-title">Election of the Speaker</h2></div><div class="se-bars"><div class="se-rows"></div>${others}<div class="se-scale"><span></span>${need}<span></span></div></div>${tellers}${strip}${foot}`;
      if (html !== lastHtml) {
        // the shell (header, ballots, the "heard" line, the strip) is rewritten when it changes; the rows are carried over so they can animate
        const keep = el.querySelector('.se-rows');
        el.innerHTML = html;
        if (keep) el.querySelector('.se-rows').replaceWith(keep);
        lastHtml = html;
      }
      el.hidden = false;
      updateRows(el.querySelector('.se-rows'), rowData, idx);
    }

    // ── the rows: kept, updated in place, reordered with a glide ──
    const calm = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const rowHtml = (d) => `<div class="se-who"></div><div class="se-track"><div class="se-fill"></div><div class="se-mark"></div></div><div class="se-num"></div>`;
    function tickNumber(numEl, to) {
      const from = numEl._v;
      numEl._v = to;
      if (from == null || from === to || calm()) { numEl.textContent = to; return; }
      cancelAnimationFrame(numEl._raf);
      const t0 = performance.now(), dur = 450;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        numEl.textContent = Math.round(from + (to - from) * e);
        if (k < 1) numEl._raf = requestAnimationFrame(step); else numEl.textContent = to;
      };
      numEl._raf = requestAnimationFrame(step);
    }
    function puff(row, n, color, widthPct) {
      if (calm()) return;
      const track = row.querySelector('.se-track');
      const tr = track.getBoundingClientRect(), rr = row.getBoundingClientRect();
      if (!tr.width) return;
      const mark = document.createElement('span');
      mark.className = 'se-plus';
      mark.textContent = '+' + n;
      mark.style.color = color;
      // just past the end of the bar, kept inside the track
      const x = (tr.left - rr.left) + Math.min(tr.width - 28, tr.width * (widthPct / 100) + 8);
      mark.style.left = Math.max(0, x) + 'px';
      row.appendChild(mark);
      const a = mark.animate([
        { opacity: 0, transform: 'translateY(5px)' },
        { opacity: 1, transform: 'translateY(0)', offset: 0.18 },
        { opacity: 0, transform: 'translateY(-14px)' },
      ], { duration: 1500, easing: 'ease-out' });
      a.onfinish = () => mark.remove();
      setTimeout(() => mark.remove(), 1800);   // a tab in the background does not run animations: the mark is cleared either way
    }
    function updateRows(host, data, ballotIdx) {
      if (!host) return;
      if (host._ballot !== ballotIdx) { host.innerHTML = ''; host._ballot = ballotIdx; }   // another ballot: a fresh set, not a reshuffle of the last one
      const old = new Map([...host.children].map((c) => [c.dataset.key, c]));
      const before = new Map([...old].map(([k, c]) => [k, c.getBoundingClientRect().top]));
      // build or update each row, then put them in order
      const order = data.map((d) => {
        let row = old.get(d.key);
        const isNew = !row;
        if (isNew) { row = document.createElement('div'); row.className = 'se-bar'; row.dataset.key = d.key; row.innerHTML = rowHtml(d); }
        if (row._who !== d.who) { row.querySelector('.se-who').innerHTML = d.who; row._who = d.who; }
        row.classList.toggle('is-winner', d.win);
        const fill = row.querySelector('.se-fill');
        fill.style.background = d.c;
        if (isNew) { fill.style.width = '0%'; requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = d.w.toFixed(2) + '%'; })); }
        else fill.style.width = d.w.toFixed(2) + '%';
        row.querySelector('.se-mark').classList.toggle('is-est', d.estimate);
        const num = row.querySelector('.se-num');
        num.style.color = d.win ? 'var(--accent-green)' : d.c;
        const had = num._v;
        tickNumber(num, d.votes);
        // a vote gained: "+1" rises from the end of the bar and fades. Not for a jump of many (a seek in the Time Machine, not a vote landing), and not on a first draw
        if (had != null && d.votes > had && d.votes - had <= 12) puff(row, d.votes - had, d.c, d.w);
        return { row, isNew, key: d.key };
      });
      const keys = new Set(order.map((o) => o.key));
      for (const [k, c] of old) if (!keys.has(k)) c.remove();
      order.forEach((o, i) => { if (host.children[i] !== o.row) host.insertBefore(o.row, host.children[i] || null); });
      if (calm()) return;
      // the glide: each row that stayed starts where it was and eases to where it is; a new one rises in
      order.forEach((o) => {
        if (o.isNew) { if (host._seen) o.row.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 350, easing: 'ease-out' }); return; }
        const dy = before.get(o.key) - o.row.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) o.row.animate([{ transform: `translateY(${dy}px)`, zIndex: 1 }, { transform: 'none', zIndex: 1 }], { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      });
      host._seen = true;
    }

    // a photo that does not load leaves its framed square, not a broken image (error does not bubble: captured)
    el.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') e.target.remove(); }, true);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-se-nav]');
      if (!b || b.disabled) return;
      const v = b.dataset.seNav, cur = ballots.length;
      const at = viewIdx != null && viewIdx < cur ? viewIdx : cur;
      viewIdx = v === 'latest' ? null : Math.max(1, Math.min(cur, at + Number(v)));
      if (viewIdx === cur) viewIdx = null;
      render();
    });

    async function tick() {
      if (busy || !worthWatching()) return;
      busy = true;
      try {
        await loadRoster();
        const c = await getCues();
        if (c === null) { busy = false; return; }   // a replay that is not ready: leave the panel as it is (hidden at first)
        if (c && c.length) await ensureRollRoster();
        const who = rollRoster || roster;
        ballots = c && c.length && who ? SE.read(c, who, { leaders, expected: rollExpected || undefined }) : [];
        render();
      } catch { /* the panel keeps what it had */ }
      busy = false;
    }
    const every = () => (inReplay() ? 1500 : 8000);
    const loop = () => { tick().finally(() => { timer = setTimeout(loop, every()); }); };
    loop();
    root.SpeakerPanel = { tick, ballots: () => ballots, setUpto: (n) => { uptoNow = n; return tick(); } };   // setUpto: for looking at the roll move on, from the console
  }

  root.SpeakerPanel = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
