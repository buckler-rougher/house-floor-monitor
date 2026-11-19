// The SPEAKER ELECTION panel (House board): who is getting how many votes as the roll is read, ballot by ballot. The election is a roll read ALOUD, not an electronic vote, so
// the numbers come from the House's captions through lib/speaker-election.js. They are a FLOOR (some answers are lost to garbled names) until the tellers read the totals, which then
// replace them. The majority is of the Members who vote for a person: known only when the roll ends, so it is drawn as an ESTIMATE (dashed: the majority if every Member votes)
// until the tellers report, then solid with the real number.
//
//   SpeakerPanel.mount({ base })
//
// WHERE THE CAPTIONS COME FROM, AND WHY NOTHING IS STORED. The day's whole caption file is a public file on the House's CDN that grows through the day (the Time Machine reads the
// same one), so every tab reads it whole and works out every ballot again: a reload, a second visitor and a tab opened an hour late all get the same ballots with nothing saved
// anywhere. Earlier ballots are kept by being in the file. In the Time Machine the cues are the replay's own (window.__replay.cues) up to the moment on the clock, so scrubbing back
// shows the count at that moment.
//
// WHEN IT WATCHES. In the Time Machine on any day whose captions hold a roll; on a live day when the Clerk's log says the House is electing a Speaker, or in the first days of January of
// an odd year (a new Congress; the file is only fetched, a roll found in it or not); and for `?speaker=YYYYMMDD`, which shows that day (3 January 2025 is the one to try).
(function (root) {
  'use strict';
  const SE = root.SpeakerElection;
  const { escapeHtml: esc } = root.BoardUtil;
  const PARTY = { R: 'var(--party-r)', D: 'var(--party-d)', I: 'var(--party-i)' };
  const SHOWN = 5;
  const CHECK = '<span class="se-check" title="Elected"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.4l2.3 2.3 4.7-5"/></svg></span>';

  function mount({ base }) {
    const el = document.getElementById('speaker-election');
    if (!el || !SE) return;
    const q = new URLSearchParams(location.search);
    let roster = null, rosterTried = false, leaders = [], cues = null, cuesKey = null, ballots = [], viewIdx = null, timer = null, busy = false, lastHtml = '';

    const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');
    const forced = (q.get('speaker') || '').replace(/\D/g, '');
    const inReplay = () => !!(root.__replay && root.__replay.cues);

    async function loadRoster() {
      if (roster || rosterTried) return;
      rosterTried = true;
      try {
        const j = await (await fetch(`${base}/member-data`)).json();
        const built = root.HouseFloorSpeaker && root.HouseFloorSpeaker.buildRoster(j.xmlData || '');
        if (built && built.length) roster = built;
      } catch { /* the bars still draw, without faces */ }
      try {
        const l = await (await fetch(`${base}/leadership`)).json();
        leaders = [l.bioguideId, ...((l.leaders || []).map((x) => x.bioguideId))].filter(Boolean);
      } catch { /* no hint */ }
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
        if (!R.cues.length) return [];
        const key = 'replay';
        // the cues stamped up to the moment on the clock, in the file's order
        const upTo = R.timeline && Number.isFinite(R.wallMs) ? R.timeline.captionFromWall(R.wallMs) : Infinity;
        return R.cues.filter((c) => c.t <= upTo).map((c) => ({ text: c.text, t: c.t }));
      }
      const day = forced || ymd(new Date());
      const rec = await (await fetch(`${base}/replay-day?date=${day}`)).json();
      if (!rec || !rec.vtt) return [];
      const text = await (await fetch(rec.vtt)).text();
      if (!SE.hasRoll || !SE.hasRoll(text)) return [];
      return SE.parseVtt(text);
    }

    function viewModel(b) {
      const ann = b.announced || null;
      const over = !!(ann && (ann.total || ann.elected));
      let rows;
      if (ann && ann.candidates && ann.candidates.length) {
        // the tellers' totals replace what was heard
        rows = ann.candidates.map((c) => {
          const key = SE.fold(c.name).split(' ').pop();
          const heard = b.candidates.find((x) => x.key === key);
          return { key, name: (heard && heard.member && heard.member.name) || titleCase(c.name), votes: c.votes, member: heard ? heard.member : null, announced: true };
        });
      } else {
        rows = b.candidates.map((c) => ({ key: c.key, name: (c.member && c.member.name) || c.display, votes: c.votes, member: c.member }));
      }
      rows.sort((x, y) => y.votes - x.votes);
      const total = ann && ann.total ? ann.total : null;
      const need = total ? Math.floor(total / 2) + 1 : (b.majority || 218);
      const winnerKey = ann && ann.elected ? SE.fold(ann.elected).split(' ').pop() : null;
      return { rows, over, total, need, estimate: !total, winnerKey, ann, b };
    }
    const titleCase = (s) => String(s).toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());

    function ring(m) { return PARTY[(m && m.party && m.party[0]) || ''] || 'var(--text-muted)'; }
    function photo(m, cls) {
      const c = ring(m);
      const img = m && m.bioguideId ? `<img src="https://bioguide.congress.gov/photo/${esc(m.bioguideId)}.jpg" alt="">` : '';
      return `<span class="${cls}" style="--c:${c}">${img}</span>`;
    }

    function render() {
      if (!ballots.length) { if (!el.hidden) { el.hidden = true; el.innerHTML = ''; lastHtml = ''; } return; }
      const cur = ballots.length;
      const idx = viewIdx != null && viewIdx < cur ? viewIdx : cur;   // 1-based; viewIdx null follows the latest ballot
      const vm = viewModel(ballots[idx - 1]);
      const live = !vm.over;
      const elected = !!vm.winnerKey;
      const tag = live ? '<span class="vote-type-tag se-state is-live">READING THE ROLL</span>'
        : elected ? '<span class="vote-type-tag se-state is-done">TELLERS REPORTED</span>'
        : '<span class="vote-type-tag se-state is-none">NO MAJORITY</span>';
      const nav = `<span class="se-nav"><button type="button" class="tm-nav-btn" data-se-nav="-1" aria-label="Previous ballot"${idx <= 1 ? ' disabled' : ''}>‹</button><span class="se-nav-label">BALLOT ${idx}${cur > 1 ? ` <span>of ${cur}</span>` : ''}</span><button type="button" class="tm-nav-btn" data-se-nav="1" aria-label="Next ballot"${idx >= cur ? ' disabled' : ''}>›</button></span>`;
      const back = idx < cur ? `<button type="button" class="se-back" data-se-nav="latest">Back to ballot ${cur}</button>` : '';
      const shown = vm.rows.slice(0, SHOWN), rest = vm.rows.slice(SHOWN);
      const bars = shown.map((r) => {
        const win = elected && r.key === vm.winnerKey;
        const w = Math.min(100, (r.votes / (vm.need * 2)) * 100);
        const c = ring(r.member);
        const sub = r.member ? `${esc(r.member.party || '')}-${esc(r.member.state || '')}` : '';
        return `<div class="se-bar${win ? ' is-winner' : ''}"><div class="se-who">${photo(r.member, 'se-cph')}<span class="se-cn"><b>${esc(r.name)}${win ? CHECK : ''}</b>${sub ? `<span>${sub}</span>` : ''}</span></div><div class="se-track"><div class="se-fill" style="width:${w.toFixed(2)}%;background:${c}"></div><div class="se-mark${vm.estimate ? ' is-est' : ''}"></div></div><div class="se-num" style="color:${win ? 'var(--accent-green)' : c}">${r.votes}</div></div>`;
      }).join('');
      const others = rest.length ? `<div class="se-others">${rest.length} more: ${rest.map((r) => `${esc(r.name)} ${r.votes}`).join(', ')}</div>` : '';
      const exp = vm.b.expected || 434;
      const need = vm.estimate
        ? `<span class="se-need"><b>~${vm.need}</b> <em class="lg">estimate: if all ${exp} vote</em><em class="sm">est.</em></span>`
        : `<span class="se-need"><b>${vm.need}</b> <span class="lg">of ${vm.total} votes cast</span></span>`;
      const recent = live ? (vm.b.recent || []).slice(-4).reverse() : [];
      const strip = recent.length ? `<div class="se-strip"><div class="se-strip-h">JUST READ</div><div class="se-reads">${recent.map((r) => {
        const cand = vm.b.candidates.find((c) => c.key === r.candidate);
        const cm = cand ? cand.member : null;
        const name = r.member ? `<b>${esc(r.member.last)}</b> ${esc(r.member.party || '')}-${esc(r.member.state || '')}` : '<b>Heard</b>';
        return `<div class="se-read">${photo(r.member, 'se-ph')}<span class="se-rn">${name}</span><span class="se-rc" style="color:${ring(cm)}">${esc((cand && cand.display) || titleCase(r.candidate))}</span></div>`;
      }).join('')}</div></div>` : '';
      const foot = live
        ? `<div class="se-foot"><span><b>${vm.b.heard}</b> of ${exp} Members heard</span><span class="se-note">Counted from the captions, so a floor. The majority is of those who vote for a person, known only when the roll ends.</span></div>`
        : `<div class="se-foot"><span class="se-note">Tellers' totals: ${vm.total != null ? `${vm.total} votes cast, ${vm.need} needed.` : 'announced.'} ${elected ? 'Clerk roll to follow.' : 'No candidate had a majority, so the House balloted again.'}</span></div>`;
      const html = `<div class="panel-header"><span class="panel-label" data-icon="ballot">Speaker election</span>${nav}${tag}${back}<div class="panel-header-right"><span class="panel-source">Source: <a href="https://www.house.gov/" target="_blank" rel="noopener">House floor captions</a></span></div></div>`
        + `<div class="se-head"><h2 class="se-title">Election of the Speaker</h2></div><div class="se-bars">${bars}${others}<div class="se-scale"><span></span>${need}<span></span></div></div>${strip}${foot}`;
      if (html !== lastHtml) { el.innerHTML = html; lastHtml = html; }
      el.hidden = false;
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
        ballots = c && c.length && roster ? SE.read(c, roster, { leaders }) : [];
        render();
      } catch { /* the panel keeps what it had */ }
      busy = false;
    }
    const every = () => (inReplay() ? 1500 : 8000);
    const loop = () => { tick().finally(() => { timer = setTimeout(loop, every()); }); };
    loop();
    root.SpeakerPanel = { tick, ballots: () => ballots };
  }

  root.SpeakerPanel = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
