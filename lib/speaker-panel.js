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
    let nominations = null, official = [];
    let history = [], historyFor = null, historyBusy = false;   // ballots of EARLIER DAYS, from the Clerk's roll files (an election can take days: 2023 took four)
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

    // BALLOTS OF EARLIER DAYS. Today's captions hold today's ballots only, so on day two of an election the panel would say "Ballot 1" for what is the fourth. Each ballot is a roll call in the Clerk's
    // roll files ("Election of the Speaker", every candidate's total, those present), so from today's first roll the earlier rolls are read backward, each once (kept in this browser): election rolls
    // are history ballots, other rolls (a motion to adjourn is taken by roll call between ballots) are passed over, and the scan stops after eight in a row that are not. The back arrow then goes
    // through them too, as the Clerk recorded them.
    const rollYear = () => inReplay() ? (location.search.match(/[?&]replay=(\d{4})/) || [])[1] : forced ? forced.slice(0, 4) : new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 4);
    async function electionRoll(n, who, year) {
      const key = `se-roll:${year}:${n}`;
      try { const kept = localStorage.getItem(key); if (kept != null) return kept === '0' ? null : JSON.parse(kept); } catch { /* not kept */ }
      let parsed = null;
      try {
        const r = await fetch(`${base}/congress-index/roll/${String(n).padStart(3, '0')}?year=${year}`);   // the Clerk's files are roll001.xml: three digits
        if (!r.ok) return undefined;                       // unknown, not "not an election": asked again next time
        parsed = SE.electionRollFromXml(await r.text(), who, leaders);
      } catch { return undefined; }
      try { localStorage.setItem(key, parsed ? JSON.stringify(parsed) : '0'); } catch { /* not kept */ }
      return parsed;
    }
    async function ensureHistory(who) {
      if (historyBusy || !who) return;
      let first = official.length ? official[0].roll : null;
      if (first == null) {
        try { const j = await (await fetch(`${base}/congress-index`)).json(); if (Number(j.latestRollNumber)) first = Number(j.latestRollNumber) + 1; } catch { /* the first roll of today is not known yet */ }
      }
      if (!first || first <= 2 || first === historyFor) return;   // roll 1 is the quorum call: nothing before the first ballot
      historyBusy = true;
      try {
        const year = rollYear(), found = [];
        let misses = 0, unknown = false;
        for (let n = first - 1; n >= 1 && misses <= 8; n--) {
          const r = await electionRoll(n, who, year);
          if (r === undefined) { unknown = true; break; }
          if (r) { found.push(r); misses = 0; } else misses++;
        }
        if (!unknown) {
          history = found.reverse().map((r) => ({ history: true, n: 0, announced: null, candidates: [], recent: [], tellers: [], heard: 0, expected: 435, majority: r.need,
            official: { roll: r.roll, url: `https://clerk.house.gov/cgi-bin/vote.asp?year=${year}&rollnumber=${r.roll}`, candidates: r.candidates, elected: r.elected, electedMember: r.electedMember, present: r.present } }));
          historyFor = first;
        }
      } finally { historyBusy = false; }
      render();
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
        const r = await fetch(`${base}/congress-index/roll/001?year=${year}`);
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
      // a file being written ends in the middle of a cue, with no newline after it: that last block is not read until it is whole
      const whole = /\n\s*$/.test(text) ? text : text.slice(0, Math.max(0, text.lastIndexOf('\n\n')));
      const all = SE.parseVtt(whole);
      const upto = uptoNow;   // ?speaker=20250103&upto=500: the panel as of the first 500 cues, to see it mid-roll without the Time Machine
      return forced && upto > 0 ? all.slice(0, upto) : all;
    }

    // the Clerk's name for a candidate ("Mr. Johnson (LA)", "Mr. Jeffries") as the key the rest of the panel uses (the surname)
    const officialKey = (name) => SE.fold(String(name || '').replace(/^(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '').replace(/\s*\([A-Za-z]{2}\)\s*$/, '')).split(' ').pop();

    function viewModel(b, latest, ofRoll) {
      if (b.nominated) {
        // before the roll: who the Clerk says was nominated, at nothing yet
        const rows = nominations.candidates.map((c) => ({ key: officialKey(c.name), name: (c.member && c.member.name) || c.name.replace(/^the\s+honorable\s+/i, ''), votes: 0, member: c.member, announced: false }));
        return { rows, over: false, done: false, total: null, need: b.majority || 218, estimate: true, winnerKey: null, ann: null, b, nominated: true };
      }
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
      let winnerKey = ann && ann.elected ? keyOf(ann.elected) : null;
      // THE CLERK'S OWN RESULT (the log's "Roll call 2 - Election of the Speaker. Mr. Johnson (LA) 218, ...") replaces what was heard and read once it is posted: it is the official count, and it
      // names the winner. It has no first names, so a candidate keeps the name the captions gave when they gave one.
      if (ofRoll && ofRoll.candidates.length) {
        const have = new Map(rows.map((r) => [r.key, r]));
        const official = ofRoll.candidates.map((c) => {
          const key = officialKey(c.name), was = have.get(key);
          return { key, name: (was && was.member && was.member.name && was.name) || (was && was.announced && was.name) || (c.member && have.get(key) && have.get(key).name) || titleCase(String(c.name).replace(/^(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '').replace(/\s*\([A-Za-z]{2}\)\s*$/, '')), votes: c.votes, member: c.member || (was && was.member) || null, announced: true };
        });
        const sum = official.reduce((a, r) => a + r.votes, 0);
        return { rows: official, over: true, done: true, total: total || sum, need: Math.floor((total || sum) / 2) + 1, estimate: false, winnerKey: ofRoll.elected ? officialKey(ofRoll.elected) : winnerKey, ann, b, official: ofRoll };
      }
      return { rows: kept, over, done, total, need, estimate: !total, winnerKey, ann, b };
    }
    const heardName = (t) => String(t).toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase()).replace(/ Of /g, ' of ');
    const titleCase = (s) => String(s).toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());

    function ring(m) { return PARTY[(m && m.party && m.party[0]) || ''] || 'var(--text-muted)'; }   // the colour of a bar and its count, not of a photo
    function photo(m, cls) {
      const img = m && m.bioguideId ? `<img src="https://bioguide.congress.gov/photo/${esc(m.bioguideId)}.jpg" alt="">` : '';
      return `<span class="${cls}">${placeholder || ''}${img}</span>`;
    }
    // a Member's party and state as the page's person rows draw them (Missing Members): the tinted party tag with no outline, the state in muted mono
    const partyClass = (p) => ({ R: 'republican', D: 'democrat' })[String(p || '')[0]] || 'independent';
    const who = (m) => m ? `<span class="absentee-party-tag ${partyClass(m.party)}">${esc(String(m.party || '?')[0])}</span><span class="absentee-state">${esc(m.state || '')}</span>` : '';

    // ONE card is the Happening Now (the page's rule). Is one of the page's own cards (a mode's column, or a vote panel with a vote) the current one? Then this panel is not.
    const otherHappeningVisible = () => [...document.querySelectorAll('.mode-column:not(#speaker-column), .vote-display:not(.is-empty)')].some((e) => e.offsetParent && e.getBoundingClientRect().height > 0);

    // While the roll is being read and the tellers are reporting, the Clerk's log has said nothing since it logged the tellers' appointment (12:50 on 3 January 2025, the result at 2:36), so the House's
    // own Happening Now card sat on "Appointment of Tellers" for an hour and three quarters, repeating what this panel's Tellers row says. The body class lets the stylesheet hold that card back.
    const setLive = (on) => document.body.classList.toggle('speaker-election-live', !!on);

    function render() {
      // before the roll, once the Clerk has logged the nominations: the candidates, at nothing yet
      const today = ballots.length ? ballots : (nominations ? [{ nominated: true, n: 1, announced: null, candidates: [], recent: [], tellers: [], heard: 0, expected: (rollExpected || (roster || []).length || 435), majority: Math.floor((rollExpected || (roster || []).length || 435) / 2) + 1 }] : []);
      const list = today.length ? history.concat(today) : [];
      if (!list.length) { setLive(false); if (!el.hidden) { el.hidden = true; el.innerHTML = ''; lastHtml = ''; } return; }
      const cur = list.length;
      // once the Speaker has been declared for a while the panel steps aside: the House has moved on (the escort, the oath, the day's business) and "Happening Now" must not say the election is
      const lastB = list[cur - 1];
      if (lastB.electedT != null && lastB.nowT != null && lastB.nowT - lastB.electedT > AFTER_S) { setLive(false); if (!el.hidden) { el.hidden = true; el.innerHTML = ''; lastHtml = ''; } return; }
      const idx = viewIdx != null && viewIdx < cur ? viewIdx : cur;   // 1-based; viewIdx null follows the latest ballot
      // a result no longer being read, and one of the page's own cards (the oath, say) now the current one: this is not the Happening Now, and there is only one
      if (lastB.electedT != null && otherHappeningVisible()) { setLive(false); if (!el.hidden) { el.hidden = true; el.innerHTML = ''; lastHtml = ''; } return; }
      // the Clerk's roll entries are in the order of the day's ballots: the one for this ballot is the one at its place, if its leader's count is the tellers'
      const ofRoll = (() => { const b0 = list[idx - 1]; if (b0.history) return b0.official; const o = official[idx - 1 - history.length]; return o && b0.announced && b0.announced.candidates.length && o.candidates.length && o.candidates[0].votes === b0.announced.candidates[0].votes ? o : null; })();
      const vm = viewModel(list[idx - 1], idx === cur, ofRoll);
      // equal counts keep the order they had, so a tie does not make the rows trade places every time a vote lands
      const was = el._order && el._order.ballot === idx ? el._order.keys : [];
      const at = (k) => { const i = was.indexOf(k); return i < 0 ? 99 : i; };
      vm.rows.sort((x, y) => (y.votes - x.votes) || (at(x.key) - at(y.key)));
      el._order = { ballot: idx, keys: vm.rows.map((r) => r.key) };
      const live = !vm.over;
      const elected = !!vm.winnerKey;
      setLive(idx === cur && !vm.done);
      const tag = vm.nominated ? '<span class="vote-type-tag se-state is-live">NOMINATIONS</span>'
        : live ? '<span class="vote-type-tag se-state is-live">READING THE ROLL</span>'
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
        return { key: r.key, win, w, c, votes: r.votes, estimate: vm.estimate, who: `${photo(r.member, 'se-cph')}<span class="se-cn"><b>${esc(r.name)}${win ? CHECK : ''}</b>${r.member ? `<span class="se-pr">${who(r.member)}</span>` : ''}</span>` };
      });
      const others = rest.length ? `<div class="se-others">${rest.length} more: ${rest.map((r) => `${esc(r.name)} ${r.votes}`).join(', ')}</div>` : '';
      const exp = vm.b.expected || 434;
      const need = vm.estimate
        ? `<span class="se-need"><b>~${vm.need}</b> <em class="lg">estimate: if all ${exp} vote</em><em class="sm">est.</em></span>`
        : `<span class="se-need"><b>${vm.need}</b> <span class="lg">of ${vm.total} votes cast</span></span>`;
      // the tellers, appointed before the roll: who is counting
      const tellers = (vm.b.tellers || []).length ? `<div class="se-tellers"><span class="se-tellers-h">TELLERS</span>${vm.b.tellers.map((t) => {
        const line = t.member ? `<span class="absentee-name">${esc(t.member.last)}</span>${who(t.member)}` : `<span class="absentee-name">${esc(heardName(t.heard))}</span><span class="absentee-state">${esc(t.state)}</span>`;
        return `<span class="se-teller">${photo(t.member, 'se-ph')}<span class="se-line">${line}</span></span>`;
      }).join('')}</div>` : '';
      const recent = live ? (vm.b.recent || []).slice(-4).reverse() : [];
      const strip = recent.length ? `<div class="se-strip"><div class="se-strip-h">JUST READ</div><div class="se-reads">${recent.map((r) => {
        const cand = vm.b.candidates.find((c) => c.key === r.candidate);
        const cm = cand ? cand.member : null;
        // a Member who could not be placed (a former Member, a garbled name) is written as the captions have it, not as "Heard"
        const name = r.member ? `<span class="absentee-name">${esc(r.member.last)}</span>${who(r.member)}`
          : r.heard ? `<span class="absentee-name">${esc(heardName(r.heard))}</span>` : '<span class="absentee-state">Name not caught</span>';
        return `<div class="se-read">${photo(r.member, 'se-ph')}<span class="se-line">${name}</span><span class="absentee-vote">${esc((cand && cand.display) || titleCase(r.candidate))}</span></div>`;
      }).join('')}</div></div>` : '';
      const nominators = vm.nominated ? nominations.candidates.map((c) => c.nominator && c.nominator.name ? `${esc(c.name.replace(/^the\s+honorable\s+/i, ''))} by ${esc(c.nominator.member ? `Rep. ${c.nominator.member.last} (${c.nominator.member.party}-${c.nominator.member.state})` : c.nominator.name)}` : esc(c.name)).join('; ') : '';
      const foot = vm.nominated
        ? `<div class="se-foot"><span class="se-note">Nominated: ${nominators}. The roll is called next; each Member answers with the surname of the candidate they choose.</span></div>`
        : vm.official
          ? `<div class="se-foot"><span class="se-note">Official: ${vm.official.url ? `<a href="${esc(vm.official.url)}" target="_blank" rel="noopener" class="ext">the Clerk's roll ${vm.official.roll}</a>` : `the Clerk's roll ${vm.official.roll}`}, ${vm.total} votes cast, ${vm.need} needed${vm.official.present ? `, ${vm.official.present} present` : ''}.${elected ? '' : ' No candidate had a majority, so the House balloted again.'}</span></div>`
          : live
        ? `<div class="se-foot"><span><b>${vm.b.heard}</b> of ${exp} Members heard</span><span class="se-note">Counted from the captions, so a floor. The majority is of those who vote for a person, known only when the roll ends.</span></div>`
        : !vm.done
          ? `<div class="se-foot"><span class="se-note">The tellers are reading their totals${vm.total != null ? `: ${vm.total} votes cast, ${vm.need} needed` : ''}. A count they have read is final; the others are still what was heard.</span></div>`
          : `<div class="se-foot"><span class="se-note">Tellers' totals: ${vm.total != null ? `${vm.total} votes cast, ${vm.need} needed.` : 'announced.'} ${elected ? 'Clerk roll to follow.' : 'No candidate had a majority, so the House balloted again.'}</span></div>`;
      // the Happening Now card is this one, unless the opening-day card (the escort, the address) is showing: then that is, and this is a card under it with its own title
      const od = document.getElementById('opening-day');
      const secondary = !!(od && !od.hidden);
      const lead = secondary ? '<span class="panel-label">Speaker election</span>' : '<span class="panel-label" data-icon="live">Happening Now</span><span class="vote-type-tag se-kind">SPEAKER ELECTION</span>';
      const html = `<div class="panel-header">${lead}${nav}${tag}${back}<div class="panel-header-right"><span class="panel-source">Source: <a href="https://www.house.gov/" target="_blank" rel="noopener">House floor captions</a></span></div></div>`
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
        // the Clerk's log (the same feed the rest of the page reads, as of the Time Machine's clock in a replay): the nominations before the roll, and each ballot's official result after it
        const items = (typeof proceedingsData !== 'undefined' && Array.isArray(proceedingsData)) ? proceedingsData : [];
        nominations = SE.clerkNominations(items, who || [], leaders);
        official = SE.clerkSpeakerRolls(items, who || [], leaders);
        if (ballots.length || nominations) ensureHistory(who);   // not awaited: the panel draws today's ballots, the earlier days arrive
        root.__speakerElected = ((official.slice().reverse().find((o) => o.electedMember) || {}).electedMember) || null;   // for lib/opening-day.js (the Speaker-elect's photo on the escort and address cards)
        root.__memberPlaceholder = placeholder;
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
