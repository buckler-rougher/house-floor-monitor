// The call board: every senator, dark until the clerk reaches them.
//
// A QUORUM CALL and a ROLL CALL VOTE look the same on the captions -- the clerk
// reads the alphabet either way -- and are different events. What each one is,
// and when it begins and ends, is decided by lib/senate-call.js; this file holds
// the current call, draws it, and keeps it in step with the Worker's copy.
//
// What this does NOT claim: that a lit member in a quorum call is present. The
// captions carry names and no answers, so "called" is the only thing observable.
// The labels say CALLED for that reason, and the count is of names read.

(() => {
  const SC = globalThis.SenateCall;
  const SEATS = 100;
  const STATES = ['is-called', 'is-warming', 'is-aye', 'is-no', 'is-present'];

  let _seats = [];
  let _deps = {};
  let _grid = null;
  let _call = SC.emptyCall();
  let _party = new Map();
  let _keys = null;                  // SenateCall.keyTable(roster): a senator's key, and the surnames two share
  let _aliases = new Map();          // SCOTT -> ['SCOTT (FL)', 'SCOTT (SC)']
  let _tick = null;
  let _rows = [];                         // { m, node } for every senator on the board
  let _picked = null;                     // the tile tapped for a closer look, on a phone
  let _ranks = null;                      // seniority: Map('<SURNAME>|<STATE>' -> rank), once loaded
  let _view = { sort: 'recent', party: 'all' };   // how the board is ordered and filtered
  const VOTE_CLOCK_MS = 15 * 60 * 1000;   // the Senate holds a vote open at least this long

  const el = (id) => document.getElementById(id);
  const fold = SC.fold;

  // The call survives a reload.
  //
  // The caption window holds about three lines, so a name is readable for
  // seconds and then gone for good. A reload during a call -- which is exactly
  // when you reload, because the call has stalled and you are wondering if the
  // page is stuck -- would otherwise start from zero with nothing left in the
  // buffer to recover. Expired on load, so yesterday's call never greets today.
  const STORE_KEY = 'senate-call';

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(_call)); }
    catch { /* private window, blocked storage: the board just stops persisting */ }
  }

  // How this viewer likes the board ordered. A per-viewer convenience, so it lives
  // in this browser and nowhere else, and the board works without it.
  const VIEW_KEY = 'senate-board-view';
  // The default order is "recent": whoever has just answered is at the top, and the rest
  // follow A to Z until they are heard. Before anyone has been heard that is just A to Z,
  // the clerk's own order. Anyone who has chosen another order keeps it.
  function loadView() {
    _view.sort = 'recent';
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
      if (v && SenateSort.MODES.includes(v.sort)) _view.sort = v.sort;
      if (v && ['all', 'D', 'R', 'I'].includes(v.party)) _view.party = v.party;
    } catch { /* absent or unreadable: the default order */ }
  }
  function saveView() {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(_view)); } catch { /* not persisted */ }
  }

  function restore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw && Array.isArray(raw.names) && raw.votes && typeof raw.votes === 'object') {
        _call = SC.expire({ ...SC.emptyCall(), ...raw }, Date.now());
        // The speaker outlives a call, but not a night: a label latched
        // yesterday is not who has the floor now.
        if (_call.speaker && Date.now() - _call.speaker.at > 6 * 60 * 60 * 1000) _call.speaker = null;
      }
    } catch { /* unreadable or absent: start empty */ }
  }

  function build(seats) {
    _seats = Array.isArray(seats) ? seats : [];
    // Surname -> party, for the D / R / I split under each tally. Where two
    // senators share a surname and a party the answer is the same either way; where
    // they do not it is left out, and the split under-counts rather than guesses.
    // Keyed as the call keys senators: the surname, or SURNAME (ST) where two share it. A bare
    // surname that two share (a caption that did not say which Scott) gets the party they have in
    // common, or none.
    _keys = SC.keyTable(_seats);
    _aliases = _keys.aliases;
    _party = new Map();
    const partyOf = (m) => (m.party === 'D' ? 'D' : m.party === 'R' ? 'R' : 'I');
    for (const m of _seats) _party.set(_keys.keyOf(m), partyOf(m));
    for (const alias of _aliases.keys()) {
      const ps = new Set(_seats.filter((m) => fold(m.last) === alias).map(partyOf));
      _party.set(alias, ps.size === 1 ? [...ps][0] : null);
    }
    _grid = el('quorum-board');
    if (!_grid) return;
    // Alphabetical, because that is the order the clerk reads and it makes the
    // board fill left to right rather than scattering.
    const rows = [..._seats].sort((a, b) => String(a.last).localeCompare(String(b.last)));
    _grid.innerHTML = rows.map((m) => {
      const photo = _deps.photoUrlFor ? _deps.photoUrlFor(m.bioguide) : '';
      const party = m.party === 'R' ? 'republican' : m.party === 'D' ? 'democrat' : 'independent';
      return `
      <div class="qb-member" data-last="${_keys.keyOf(m)}" data-party="${m.party === 'R' || m.party === 'D' ? m.party : 'I'}" data-state="${m.state}" title="${m.first} ${m.last} (${m.party}-${m.state})">
        <span class="qb-photo">${photo ? `<img src="${photo}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
        <span class="qb-text">
          <span class="qb-name">${m.last}</span>
          <span class="qb-meta"><span class="qb-party ${party}">${m.party}</span>${m.state}</span>
        </span>
      </div>`;
    }).join('');
    // Keep each senator with their box, for ordering. The DOM stays alphabetical and
    // the view is applied with CSS `order`, so a re-sort moves nothing in the
    // document and no photo is refetched.
    const nodes = _grid.querySelectorAll('.qb-member');
    _laidOut = false;
    _picked = null;
    const detail = el('qb-detail'); if (detail) detail.hidden = true;
    _rows = rows.map((m, i) => ({ m: { ...m, key: _keys.keyOf(m), party: m.party === 'R' || m.party === 'D' ? m.party : 'I' }, node: nodes[i] }));
    rankRows();
    applyView();
    // Re-light whoever has already been called. loadBalance refreshes the
    // roster every hour and calls this again, which would otherwise blank a
    // call in progress -- the names are held in _called, not in the DOM, so
    // they survive the re-render and are put back without the warm-up flicker,
    // which belongs to the moment a name is read and not to a repaint.
    paint();
    update();
  }

  // Put the call onto the board. `warm` is the names that arrived since the last
  // paint, which get the one-shot flicker; a repaint or a sync does not.
  function paint(warm = []) {
    // The chamber floor mirrors the board, so it is told at the same moment and
    // from the same two sets rather than keeping its own copy.
    // The chamber floor shows the same roll, so it is handed the same marks, taken from
    // the call the board is drawing: names read in a quorum call, answers in a vote.
    // (This used to pass _called and _votes, which no longer exist, and threw on every
    // paint.)
    globalThis.SenateChamber?.setState?.(
      _call.kind === 'vote' ? new Set() : new Set(_call.names),
      _call.kind === 'vote' ? new Map(Object.entries(_call.votes)) : new Map());
    if (!_grid) return;
    // What each lit member should carry. A vote also keeps is-called, which is
    // what the stylesheet lights a box with; the answer class colours it.
    const lit = new Map();
    if (_call.kind === 'vote') {
      for (const [k, v] of Object.entries(_call.votes)) {
        lit.set(k, ['is-called', v === 'NO' ? 'is-no' : v === 'PRESENT' ? 'is-present' : 'is-aye']);
      }
    } else {
      for (const k of _call.names) lit.set(k, ['is-called']);
    }
    // The DOM is a view of the call. Anything lit that the call does not say is
    // lit gets cleared, which is how a new call starts the board over.
    // A caption that gave only a surname two senators share (the Scotts) is heard but not
    // attributed: it lights neither as if they had answered, and marks both as "one of these".
    const either = new Set();
    for (const k of (_call.kind === 'vote' ? Object.keys(_call.votes) : _call.names)) {
      for (const t of _aliases.get(k) || []) either.add(t);
    }
    _grid.querySelectorAll('.qb-member').forEach((node) => {
      const want = lit.get(node.dataset.last) || [];
      for (const c of STATES) {
        if (c !== 'is-warming' || !want.length) node.classList.toggle(c, want.includes(c));
      }
      node.classList.toggle('is-either', !want.length && either.has(node.dataset.last));
    });
    for (const k of warm) {
      const node = _grid.querySelector(`.qb-member[data-last="${CSS.escape(k)}"]`);
      if (!node) continue;
      // A class rather than a permanent animation, so it runs once on the way up.
      node.classList.add('is-warming');
      setTimeout(() => node.classList.remove('is-warming'), 900);
    }
  }

  function update() {
    const sum = SC.summarize(_call);
    const voting = sum.kind === 'vote';
    // Once the chair reads the tally that is who voted, which is more than the captions
    // caught.
    const n = voting && sum.ended ? Math.max(sum.count, sum.ended.yeas + sum.ended.nays) : sum.count;

    // The quorum panel is the House's, and during a vote it stays: members present against
    // the 51 a quorum needs, with the bar. What a vote adds (the tallies, party splits,
    // threshold) is in the panels above it, so this one does not repeat them. The labels
    // differ by kind because the same box counts different things: names READ in a quorum
    // call, and senators recorded in a vote (a senator who has voted is present).
    const l1 = document.querySelector('.quorum-metrics .metric-item:nth-child(1) .metric-label');
    const l2 = document.querySelector('.quorum-metrics .metric-item:nth-child(2) .metric-label');
    const v2 = document.querySelector('.quorum-metrics .metric-item:nth-child(2) .metric-value');
    const tag = el('vote-type-tag');
    const panelLabel = document.querySelector('#quorum > .panel-header .panel-label');
    if (l1) l1.textContent = voting ? 'Members Present' : 'Names Called';
    if (l2) l2.textContent = 'Required for Quorum';
    if (v2) v2.textContent = String(SC.QUORUM_REQUIRED);
    // In a vote the panel above already says what is happening, and the ROLL CALL VOTE tag
    // is on it; this one is the quorum.
    // No call heard at all is neither, and used to read QUORUM CALL.
    if (tag) tag.textContent = sum.kind === 'quorum' ? 'QUORUM CALL' : '';
    if (panelLabel) panelLabel.textContent = voting ? 'QUORUM' : 'HAPPENING NOW';

    const present = el('members-present');
    const whole = el('quorum-session-status');
    const bar = el('quorum-progress-bar');
    const fill = el('quorum-fill');
    const ind = el('quorum-indicator');
    if (present) present.textContent = String(n);
    if (whole) whole.textContent = String(_seats.length || SEATS);
    if (fill) {
      // As the House does: the gradient is sized to the whole track, so it is revealed by
      // the fill rather than squeezed into it (5 of 100 shows only the red start).
      const frac = Math.min(1, Math.max(0, n / SEATS));
      fill.style.width = `${frac * 100}%`;
      fill.style.backgroundSize = frac > 0 ? `${100 / frac}% 100%` : '100% 100%';
    }
    if (bar) bar.setAttribute('aria-valuenow', String(n));
    if (ind) {
      const txt = ind.querySelector('.indicator-text');
      // Says what was counted, not what the Senate is doing: a silent track means
      // nobody is speaking, the stream dropped, or the chamber is quiet, and none
      // of that is observable from here.
      //
      // A finished call stays on the board, labelled, until the next one begins.
      // A vote shows the outcome when the chair said one and the bare tally when
      // not -- assuming AGREED was wrong, a rejected vote would read as carried.
      if (txt) {
        // A vote's quorum is the same question as a quorum call's: have 51 answered.
        const met = voting ? n >= SC.QUORUM_REQUIRED : sum.quorumMet;
        ind.classList.toggle('quorum-met', met);
        txt.textContent =
            sum.ended && !voting ? 'CALL VITIATED'
          : n === 0 ? (voting ? 'NO VOTES HEARD' : 'NO NAMES READ')
          : met ? 'QUORUM PRESENT'
          : `${SC.QUORUM_REQUIRED - n} MORE FOR QUORUM`;
      }
    }

    document.body.classList.toggle('senate-quorum-active', n > 0);
    // A roll call vote shows the House's stack: the vote panel, the threshold analysis,
    // and the quorum panel with the senator grid; a quorum call is the quorum panel
    // alone. The stylesheet keys off these.
    document.body.classList.toggle('senate-call-vote', voting);
    document.body.classList.toggle('senate-call-quorum', sum.kind === 'quorum');
    placeTimer(voting);
    if (voting) { renderVote(sum); renderThreshold(sum); }
    else {
      // "N not yet heard" belongs to a vote and is only refreshed by one, so a quorum call
      // that follows would carry the last vote's count on its clock.
      const ny = el('vote-not-yet');
      if (ny) ny.hidden = true;
    }
    // Not "opened": the clock starts when this board first HEARD the call, which
    // is the open only if it was watching.
    const start = el('vote-timer-start');
    if (start) {
      start.textContent = !_call.callId ? '' : `FIRST HEARD ${new Date(_call.callId).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}`;
    }
    syncClock();
  }

  // The vote panel is the House's, filled from the call. Every id below is the
  // same one the House board uses, so the markup and the stylesheet are shared
  // and only this file differs.
  const setText = (id, v) => { const n = el(id); if (n && n.textContent !== v) n.textContent = v; };
  const setSplit = (id, n, suffix, hideZero) => {
    const node = el(id);
    if (!node) return;
    node.innerHTML = `${n}<span class="cpb-suffix">${suffix}</span>`;
    if (hideZero) node.style.display = n > 0 ? '' : 'none';
  };

  function renderVote(sum) {
    const split = { AYE: { D: 0, R: 0, I: 0 }, NO: { D: 0, R: 0, I: 0 } };
    for (const [k, v] of Object.entries(_call.votes)) {
      const party = _party.get(k);
      if (party && split[v]) split[v][party]++;
    }
    // The captions miss votes (the clerk is silent through stretches of a roll),
    // so what was HEARD is a floor, not the count. Once the chair reads the tally
    // that is the count, and the numbers switch to it. The party split is built
    // from heard votes only, so it is shown only while it can add up: a split
    // that sums to 24 under a headline of 60 would state something untrue.
    const end0 = sum.ended;
    const ayes = end0 ? end0.yeas : sum.ayes;
    const nos = end0 ? end0.nays : sum.nos;
    const total = ayes + nos + sum.present;
    const splitHolds = !end0 || (end0.yeas === sum.ayes && end0.nays === sum.nos);
    if (!splitHolds) {
      for (const id of ['yeas-d', 'yeas-r', 'yeas-i', 'nays-d', 'nays-r', 'nays-i']) {
        const n = el(id);
        if (n) n.style.display = 'none';
      }
    } else {
      // D and R always show; I only when non-zero, which setSplit handles below.
      for (const id of ['yeas-d', 'yeas-r', 'nays-d', 'nays-r']) {
        const n = el(id);
        if (n) n.style.display = '';
      }
    }
    const pct = (n) => total ? `${(n / total * 100).toFixed(1)}%` : '--%';
    setText('yeas-count', String(ayes));
    setText('nays-count', String(nos));
    setText('present-count', String(sum.present));
    setText('yeas-percent', pct(ayes));
    setText('nays-percent', pct(nos));
    setText('present-percent', pct(sum.present));
    if (splitHolds) {
      setSplit('yeas-d', split.AYE.D, 'D'); setSplit('yeas-r', split.AYE.R, 'R'); setSplit('yeas-i', split.AYE.I, 'I', true);
      setSplit('nays-d', split.NO.D, 'D');  setSplit('nays-r', split.NO.R, 'R');  setSplit('nays-i', split.NO.I, 'I', true);
    }
    const bar = (id, n) => { const b = el(id); if (b) b.style.width = total ? `${n / total * 100}%` : '0%'; };
    bar('yeas-bar', ayes); bar('nays-bar', nos); bar('present-bar', sum.present);
    el('yeas-bar')?.classList.toggle('right-cap', ayes > 0 && !nos && !sum.present);
    el('present-bar')?.classList.toggle('right-cap', sum.present > 0 && !nos);
    setText('total-votes', total ? `Total: ${total}` : 'Total: --');
    const yc = el('yeas-count'), nc = el('nays-count');
    if (yc && nc) { yc.style.fontWeight = ayes > nos ? 'bold' : 'normal'; nc.style.fontWeight = nos > ayes ? 'bold' : 'normal'; }

    // What is being voted on: the chair's own words, verbatim and capitalized as
    // captioned (a source quoted as sent). Nothing is guessed when the question
    // was not heard, and the title says only what is known.
    setText('vote-title', sum.question || 'Roll call vote');
    const end = sum.ended;
    const outcome = end ? `${end.outcome ? end.outcome + ' ' : ''}${end.yeas}-${end.nays}` : '';
    setText('vote-id', outcome);
    // "Heard", not "voted": a silent stretch of the roll is a vote the captions
    // never carried, so the gap is what has not been HEARD.
    const left = Math.max(0, SEATS - total);
    const notYet = el('vote-not-yet');
    if (notYet) { notYet.textContent = end ? '' : `${left} not yet heard`; notYet.hidden = !!end || total === 0; }
    const tag = document.querySelector('.vote-display .vote-type-tag');
    if (tag) tag.textContent = 'ROLL CALL VOTE';
  }

  // The House board's THRESHOLD ANALYSIS, for a Senate vote (lib/senate-threshold.js says
  // what the threshold is and why it is sometimes only assumed). Counts are what the
  // captions heard until the chair reads the tally, then the announced numbers.
  function renderThreshold(sum) {
    const T = globalThis.SenateThreshold;
    const end = sum.ended;
    const whole = _seats.length || SEATS;
    const rule = T.classify(sum.question);
    const r = T.analyze({
      ayes: end ? end.yeas : sum.ayes, nays: end ? end.nays : sum.nos, present: sum.present,
      whole, rule: rule.rule, known: rule.known,
    });
    // Once the result is announced, the announcement is the answer, not an inference.
    let state = r.state;
    if (end && end.outcome) state = /^NOT\b/.test(end.outcome) ? 'locked-fail' : 'locked-pass';
    const stateEl = el('threshold-state');
    if (stateEl) {
      stateEl.classList.remove('in-play', 'locked-pass', 'locked-fail');
      stateEl.classList.add(state);
      stateEl.textContent = state === 'locked-pass' ? 'PASS LOCKED' : state === 'locked-fail' ? 'FAIL LOCKED' : 'IN PLAY';
    }
    const basis = el('threshold-basis');
    if (basis) basis.textContent = `Threshold: ${rule.label}.`;
    setText('votes-remaining', String(end ? 0 : r.remaining));
    setText('yeas-needed', r.yeasNeeded == null ? '--' : String(r.yeasNeeded));
    setText('nays-to-block', r.naysToBlock == null ? '--' : String(r.naysToBlock));
    setText('max-possible-yeas', String(end ? end.yeas : r.maxYeas));
    const marker = el('vote-threshold-marker');
    if (marker) { marker.style.left = `${Math.min(r.marker, 99).toFixed(2)}%`; marker.style.display = ''; }
  }

  // The clock is wired to the call of the roll. A vote counts down the 15 minutes
  // the Senate holds it open, the way the House's does, and runs over as +MM:SS;
  // a quorum call has no deadline and counts up. Both stop when the call ends.
  function tickClock() {
    const value = el('last-update'), arc = el('vta-fill');
    if (!value) return;
    if (!_call.callId) {
      value.className = 'vote-timer-value'; value.textContent = '--:--';
      if (arc) arc.style.strokeDashoffset = '125.66';
      return;
    }
    const now = _call.ended ? _call.ended.at : Date.now();
    const elapsed = Math.max(0, now - _call.callId);
    const fmt = (ms, cs) => {
      const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000), c = Math.floor((ms % 1000) / 10);
      return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${cs ? '.' + String(c).padStart(2, '0') : ''}`;
    };
    const CIRC = 125.66;
    if (_call.kind === 'vote') {
      const remaining = VOTE_CLOCK_MS - elapsed;
      const over = remaining < 0;
      value.className = `vote-timer-value ${_call.ended ? 'expired' : over ? 'overtime' : remaining < 60000 ? 'warning' : 'active'}`;
      value.textContent = (over ? '+' : '') + fmt(Math.abs(remaining), true);
      if (arc) {
        arc.style.strokeDashoffset = String((CIRC * (1 - (over ? 1 : Math.max(0, Math.min(1, elapsed / VOTE_CLOCK_MS))))).toFixed(2));
        arc.style.stroke = over ? 'var(--accent-red)' : remaining < 60000 ? 'var(--accent-amber)' : 'var(--accent-green)';
      }
    } else {
      value.className = `vote-timer-value ${_call.ended ? 'expired' : 'active'}`;
      value.textContent = fmt(elapsed, false);
      if (arc) arc.style.strokeDashoffset = '125.66';
    }
  }

  // Running only while a call is live: ten ticks a second for a clock nobody can
  // see is the kind of thing that costs a laptop its battery.
  function syncClock() {
    const live = !!_call.callId && !_call.ended;
    if (live && !_tick) _tick = setInterval(tickClock, 100);
    if (!live && _tick) { clearInterval(_tick); _tick = null; }
    tickClock();
  }

  // Give each senator the rank the seniority table assigned them, if it named them.
  function rankRows() {
    if (!_ranks) return;
    for (const r of _rows) {
      const rank = _ranks.get(`${globalThis.SenateSeniority.fold(r.m.last)}|${r.m.state}`);
      r.m.rank = rank == null ? undefined : rank;
    }
  }

  // Called with the order from /api/senate/seniority. Until it arrives, and if it
  // never does, the board simply has no seniority button.
  function setSeniority(rows) {
    try {
      const SS = globalThis.SenateSeniority;
      const nameToPostal = Object.fromEntries(Object.entries(SenateSort.STATES).map(([p, [n]]) => [n, p]));
      const roster = _rows.length ? _rows.map((r) => r.m) : _seats;
      _ranks = SS.rankMap(rows, roster, nameToPostal);
      rankRows();
      applyView();
    } catch (e) { console.error('Seniority could not be applied:', e); }
  }

  // Tapping a tile names the senator in full: on a phone the tiles are surnames only, and
  // two senators share a surname. Tapping the same tile again closes it. Only shown by
  // the stylesheet at phone width; elsewhere the tiles already say it.
  function describePicked() {
    const out = el('qb-detail');
    if (!out) return;
    const row = _picked && _rows.find((r) => r.node === _picked);
    if (!row) { out.hidden = true; if (_picked) _picked.classList.remove('is-picked'); _picked = null; return; }
    const m = row.m, key = m.key;
    const answer = _call.kind === 'vote'
      ? (_call.votes[key] === 'AYE' ? 'Aye' : _call.votes[key] === 'NO' ? 'No' : _call.votes[key] === 'PRESENT' ? 'Present' : 'Not heard')
      : (_call.names.includes(key) ? 'Called' : 'Not called');
    const name = `${m.first && m.first !== 'X' ? m.first + ' ' : ''}${m.last}`;
    // Heard by surname only, and two senators have it: say so rather than "Not heard".
    const alias = [..._aliases].find(([a, ks]) => ks.includes(key) && (_call.kind === 'vote' ? a in _call.votes : _call.names.includes(a)));
    const said = (answer === 'Not heard' || answer === 'Not called') && alias
      ? `${_call.kind === 'vote' ? 'A vote' : 'A call'} for ${alias[0][0]}${alias[0].slice(1).toLowerCase()} was heard, but not which of the ${_aliases.get(alias[0]).length}`
      : answer;
    out.textContent = `${name} (${m.party}-${m.state}) \u00b7 ${said}`;
    out.hidden = false;
  }

  // The board is a short scrolling window on a phone, with a fade at the bottom to say
  // there is more; the fade goes once it is scrolled to the end (the same behaviour as
  // the other lists on the page).
  function watchEnd() {
    const board = el('quorum-board');
    if (!board) return;
    const check = () => board.classList.toggle('is-at-end', board.scrollTop + board.clientHeight >= board.scrollHeight - 2);
    if (!board.dataset.watched) { board.dataset.watched = '1'; board.addEventListener('scroll', check, { passive: true }); }
    check();
  }

  // Order and filter the board. The order is CSS `order` on the existing boxes and
  // the party filter an attribute the stylesheet hides by, so neither rebuilds
  // anything. "Recent" follows the call: the last senator heard comes first.
  // The buttons show the view whether or not the board has been built yet, so a
  // reload does not flash the default as selected while the roster is on its way.
  // Seniority is only an option once the order has loaded; until then a saved
  // choice of it behaves as A to Z rather than as an empty sort.
  const seniorityKnown = () => !!(_ranks && _ranks.size);
  const effectiveSort = () => (_view.sort === 'seniority' && !seniorityKnown() ? 'alpha' : _view.sort);

  function paintControls() {
    const btn = document.querySelector('#qb-sort [data-sort="seniority"]');
    if (btn) btn.hidden = !seniorityKnown();
    document.querySelectorAll('#qb-sort .bills-sort-btn').forEach((b) => b.classList.toggle('active', b.dataset.sort === effectiveSort()));
    document.querySelectorAll('#qb-party .bills-sort-btn').forEach((b) => b.classList.toggle('active', b.dataset.party === _view.party));
  }

  // Tiles slide to their new places instead of jumping (FLIP: note where each one is,
  // reorder, then animate from the old place to the new). The reorder is CSS `order`, so
  // the document never changes and nothing is rebuilt; this only draws the move.
  //
  // Skipped for anyone who has asked for reduced motion, for tiles that are hidden by the
  // party filter, and for the very first layout, where there is nothing to move from.
  let _laidOut = false;
  const reducedMotion = () => !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const MOVE_MS = 320;

  function applyView() {
    paintControls();
    if (!_grid || !_rows.length) return;
    _grid.dataset.party = _view.party;
    const heard = _call.kind === 'vote' ? Object.keys(_call.votes) : _call.names;
    const ordered = SenateSort.sortMembers(_rows.map((r) => r.m), effectiveSort(), heard);
    const nodeOf = new Map(_rows.map((r) => [r.m, r.node]));

    const animate = _laidOut && !reducedMotion() && typeof Element !== 'undefined' && Element.prototype.animate;
    let before = null;
    if (animate) {
      // Where each tile is NOW, including any move still in flight, so a second reorder
      // starts from where the eye last saw the tile and not from its old home.
      before = new Map(_rows.map((r) => [r.node, r.node.getBoundingClientRect()]));
      // Then stop those moves, so the measurement after the reorder is the true layout.
      for (const r of _rows) for (const a of r.node.getAnimations ? r.node.getAnimations() : []) if (a.id === 'qb-move') a.cancel();
    }

    ordered.forEach((m, i) => { nodeOf.get(m).style.order = String(i); });

    if (animate) {
      for (const r of _rows) {
        const was = before.get(r.node), now = r.node.getBoundingClientRect();
        if (!was.width || !now.width) continue;           // hidden by the party filter
        const dx = was.left - now.left, dy = was.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        const move = r.node.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: MOVE_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
        move.id = 'qb-move';
      }
    }
    _laidOut = true;
    watchEnd();
  }

  function initControls() {
    loadView();
    paintControls();
    const board = el('quorum-board');
    if (board) board.addEventListener('click', (e) => {
      const tile = e.target.closest('.qb-member');
      if (!tile) return;
      if (_picked) _picked.classList.remove('is-picked');
      _picked = _picked === tile ? null : tile;
      if (_picked) _picked.classList.add('is-picked');
      describePicked();
    });
    const sort = el('qb-sort'), party = el('qb-party');
    if (sort) sort.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sort]');
      if (!b) return;
      _view.sort = b.dataset.sort; saveView(); applyView();
    });
    if (party) party.addEventListener('click', (e) => {
      const b = e.target.closest('[data-party]');
      if (!b) return;
      // Choosing the active party again clears back to everyone.
      _view.party = (b.dataset.party !== 'all' && b.dataset.party === _view.party) ? 'all' : b.dataset.party;
      saveView(); applyView();
    });
  }

  // Take a new view of the call, from the captions or from the Worker. Draws
  // only if something changed, and flickers only the names that are new.
  function apply(next) {
    const sig = (c) => JSON.stringify([c.callId, c.kind, c.names, c.votes, c.ended, c.speaker && c.speaker.label, c.question]);
    const was = _call;
    const changed = sig(next) !== sig(was);
    _call = next;
    if (!changed) { if (next.lastAt !== was.lastAt) save(); return; }
    // Anything else on the page that depends on the call (the speaker row) takes
    // it from here, so there is one copy of the state in the tab.
    document.dispatchEvent(new CustomEvent('senate-call', { detail: { call: next } }));
    const before = new Set(was.callId === next.callId ? was.names : []);
    save();
    paint(next.kind === 'quorum' ? next.names.filter((k) => !before.has(k)) : []);
    if (_view.sort === 'recent') applyView();
    update();
    if (_picked) describePicked();
  }

  // The clock lives in the vote panel, between the tallies and the progress bar,
  // where the House has it. A quorum call has no vote panel on screen, so the
  // clock is relocated under the board it is timing instead of being duplicated.
  let _timerHome = null;
  function placeTimer(voting) {
    const timer = document.querySelector('.vote-timer');
    const display = document.querySelector('.vote-display');
    const panel = document.querySelector('.quorum-panel .quorum-content');
    if (!timer || !display || !panel) return;
    if (!_timerHome) _timerHome = { parent: display, before: display.querySelector('.progress-section') };
    const want = voting ? _timerHome.parent : panel;
    if (timer.parentElement === want) return;
    if (voting) want.insertBefore(timer, _timerHome.before);
    else want.appendChild(timer);
  }

  function init(deps) {
    _deps = deps || {};
    restore();
    initControls();
    placeTimer(false);
    document.addEventListener('senate-caption', (e) => apply(SC.feed(_call, e.detail?.text, Date.now())));
    // A call whose ending was never heard. A call that simply stops being read is
    // over too, and without this a board sits on a finished call until the next
    // day's stream. Forty-five minutes, because both kinds genuinely pause for
    // long stretches while members are found.
    setInterval(() => apply(SC.expire(_call, Date.now())), 60 * 1000);
    update();
    // A reload keeps the speaker as well as the call.
    if (_call.speaker) document.dispatchEvent(new CustomEvent('senate-call', { detail: { call: _call } }));
  }

  // The Worker reads the same captions and keeps the call, so a viewer arriving
  // mid-call gets every name already read instead of an empty board. The local
  // caption reader stays: it lights a name the instant it is spoken, where this
  // trails by a poll. Merged by SenateCall.merge, so the newer call wins and,
  // within one call, whichever reader saw a name first keeps it.
  async function syncFromWorker(api) {
    if (!api) return;
    try {
      const r = await fetch(`${api}/senate/quorum`);
      if (!r.ok) return;
      const d = await r.json();
      // The floor mode (prayer, pledge, ...) is the Worker's reading of the captions; the page only draws it.
      document.dispatchEvent(new CustomEvent('senate-mode', { detail: { mode: d.mode || null } }));
      if (d.call && d.call.callId) apply(SC.merge(_call, { ...SC.emptyCall(), ...d.call }));
    } catch { /* the board keeps whatever it read locally */ }
  }

  function reset() { apply({ ...SC.emptyCall(), speaker: _call.speaker }); }

  globalThis.SenateQuorum = { init, build, reset, syncFromWorker, setSeniority };
})();
