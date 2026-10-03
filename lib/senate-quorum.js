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
  let _tick = null;
  let _rows = [];                         // { m, node } for every senator on the board
  let _ranks = null;                      // seniority: Map('<SURNAME>|<STATE>' -> rank), once loaded
  let _view = { sort: 'alpha', party: 'all' };   // how the board is ordered and filtered
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
  function loadView() {
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
    _party = new Map();
    for (const m of _seats) {
      const k = fold(m.last), p = m.party === 'D' ? 'D' : m.party === 'R' ? 'R' : 'I';
      _party.set(k, _party.has(k) && _party.get(k) !== p ? null : p);
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
      <div class="qb-member" data-last="${fold(m.last)}" data-party="${m.party === 'R' || m.party === 'D' ? m.party : 'I'}" data-state="${m.state}" title="${m.first} ${m.last} (${m.party}-${m.state})">
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
    _rows = rows.map((m, i) => ({ m: { ...m, key: fold(m.last), party: m.party === 'R' || m.party === 'D' ? m.party : 'I' }, node: nodes[i] }));
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
    _grid.querySelectorAll('.qb-member').forEach((node) => {
      const want = lit.get(node.dataset.last) || [];
      for (const c of STATES) {
        if (c !== 'is-warming' || !want.length) node.classList.toggle(c, want.includes(c));
      }
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
    const n = sum.count;

    // The labels change with the kind of call, because the same box means a
    // different thing: names read in a quorum call, votes recorded in a vote.
    const l1 = document.querySelector('.quorum-metrics .metric-item:nth-child(1) .metric-label');
    const l2 = document.querySelector('.quorum-metrics .metric-item:nth-child(2) .metric-label');
    const v2 = document.querySelector('.quorum-metrics .metric-item:nth-child(2) .metric-value');
    const tag = el('vote-type-tag');
    if (l1) l1.textContent = voting ? 'Votes Recorded' : 'Names Called';
    if (l2) l2.textContent = voting ? 'Aye / No' : 'Required for Quorum';
    if (v2) v2.textContent = voting ? `${sum.ayes} / ${sum.nos}` : String(SC.QUORUM_REQUIRED);
    if (tag) tag.textContent = voting ? 'ROLL CALL VOTE' : 'QUORUM CALL';

    const present = el('members-present');
    const whole = el('quorum-session-status');
    const bar = el('quorum-progress-bar');
    const fill = el('quorum-fill');
    const ind = el('quorum-indicator');
    if (present) present.textContent = String(n);
    if (whole) whole.textContent = String(_seats.length || SEATS);
    if (fill) fill.style.width = `${Math.min(100, (n / SEATS) * 100)}%`;
    if (bar) bar.setAttribute('aria-valuenow', String(n));
    if (ind) {
      ind.classList.toggle('quorum-met', sum.quorumMet);
      const txt = ind.querySelector('.indicator-text');
      // Says what was counted, not what the Senate is doing: a silent track means
      // nobody is speaking, the stream dropped, or the chamber is quiet, and none
      // of that is observable from here.
      //
      // A finished call stays on the board, labelled, until the next one begins.
      // A vote shows the outcome when the chair said one and the bare tally when
      // not -- assuming AGREED was wrong, a rejected vote would read as carried.
      if (txt) {
        const end = sum.ended;
        txt.textContent =
            voting && end ? `${end.outcome ? end.outcome + ' ' : ''}${end.yeas}-${end.nays}`
          : voting ? `${n} OF ${SEATS} RECORDED`
          : end ? 'CALL VITIATED'
          : n === 0 ? 'NO NAMES READ'
          : sum.quorumMet ? 'QUORUM PRESENT'
          : `${SC.QUORUM_REQUIRED - n} MORE FOR QUORUM`;
      }
    }

    document.body.classList.toggle('senate-quorum-active', n > 0);
    // A roll call vote is the House's vote panel with the senator grid attached
    // beneath it; a quorum call is the grid alone. The stylesheet keys off these.
    document.body.classList.toggle('senate-call-vote', voting);
    document.body.classList.toggle('senate-call-quorum', sum.kind === 'quorum');
    placeTimer(voting);
    if (voting) renderVote(sum);
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

  function applyView() {
    paintControls();
    if (!_grid || !_rows.length) return;
    _grid.dataset.party = _view.party;
    const heard = _call.kind === 'vote' ? Object.keys(_call.votes) : _call.names;
    const ordered = SenateSort.sortMembers(_rows.map((r) => r.m), effectiveSort(), heard);
    const nodeOf = new Map(_rows.map((r) => [r.m, r.node]));
    ordered.forEach((m, i) => { nodeOf.get(m).style.order = String(i); });
  }

  function initControls() {
    loadView();
    paintControls();
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
      if (d.call && d.call.callId) apply(SC.merge(_call, { ...SC.emptyCall(), ...d.call }));
    } catch { /* the board keeps whatever it read locally */ }
  }

  function reset() { apply({ ...SC.emptyCall(), speaker: _call.speaker }); }

  globalThis.SenateQuorum = { init, build, reset, syncFromWorker, setSeniority };
})();
