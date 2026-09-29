// The quorum board: every senator, dark until the clerk calls their name.
//
// Driven by the `senate-roll-name` events lib/senate-speaker.js broadcasts off
// the floor feed's caption track. The clerk reads alphabetically -- "MS.
// ALSOBROOKS. MR. ARMSTRONG. MS. BALDWIN." -- and each name lights its member.
//
// What this does NOT claim: that a lit member is present. The captions carry
// names and no answers, so "called" is the only thing observable. Whether the
// clerk's pacing tracks arrivals, which would make called a proxy for present,
// is an open question recorded in the TODO. The labels here say CALLED for
// that reason, and the count is of names read.

(() => {
  const QUORUM_REQUIRED = 51;   // a majority of 100, the constitutional quorum
  const SEATS = 100;

  let _seats = [];
  let _called = new Set();
  let _deps = {};
  let _grid = null;
  let _lastNameAt = 0;
  let _votes = new Map();   // surname -> AYE | NO | PRESENT
  let _mode = 'quorum';
  let _lastRoll = '';          // last roll name heard, to spot the alphabet restarting
  let _workerVotesStale = false;     // flips to 'vote' the first time a vote is heard

  const el = (id) => document.getElementById(id);

  // Diacritics folded on both sides of every name comparison.
  //
  // The roster spells one senator Luján; the captions spell him LUJAN. That is
  // the only accented name in the chamber today, and it was enough to make him
  // the one member who never registered.
  const fold = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();


  // Called names survive a reload.
  //
  // The caption window holds about three lines, so a name is readable for
  // seconds and then gone for good. Keeping the set only in memory meant a
  // reload during a call -- which is exactly when you reload, because the call
  // has stalled and you are wondering if the page is stuck -- started from zero
  // with nothing left in the buffer to recover.
  //
  // Scoped to the day. A quorum call does not span midnight, and yesterday's
  // names on today's board would be worse than an empty one.
  const STORE_KEY = 'senate-quorum-called';
  const today = () => new Date().toISOString().slice(0, 10);

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ day: today(), names: [..._called], votes: [..._votes], mode: _mode }));
    } catch { /* private window, blocked storage: the board just stops persisting */ }
  }

  function restore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw && raw.day === today() && Array.isArray(raw.names)) {
        _called = new Set(raw.names);
        if (Array.isArray(raw.votes)) _votes = new Map(raw.votes);
        if (raw.mode === 'vote') _mode = 'vote';
      }
    } catch { /* unreadable or absent: start empty, which is the old behaviour */ }
  }

  function build(seats) {
    _seats = Array.isArray(seats) ? seats : [];
    _grid = el('quorum-board');
    if (!_grid) return;
    // Alphabetical, because that is the order the clerk reads and it makes the
    // board fill left to right rather than scattering.
    const rows = [..._seats].sort((a, b) => String(a.last).localeCompare(String(b.last)));
    _grid.innerHTML = rows.map((m) => {
      const photo = _deps.photoUrlFor ? _deps.photoUrlFor(m.bioguide) : '';
      const party = m.party === 'R' ? 'republican' : m.party === 'D' ? 'democrat' : 'independent';
      return `
      <div class="qb-member" data-last="${fold(m.last)}" title="${m.first} ${m.last} (${m.party}-${m.state})">
        <span class="qb-photo">${photo ? `<img src="${photo}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
        <span class="qb-text">
          <span class="qb-name">${m.last}</span>
          <span class="qb-meta"><span class="qb-party ${party}">${m.party}</span>${m.state}</span>
        </span>
      </div>`;
    }).join('');
    // Re-light whoever has already been called. loadBalance refreshes the
    // roster every hour and calls this again, which would otherwise blank a
    // call in progress -- the names are held in _called, not in the DOM, so
    // they survive the re-render and are put back without the warm-up flicker,
    // which belongs to the moment a name is read and not to a repaint.
    paint();
    update();
  }

  // Put the called set onto the board, without the warm-up flicker: that
  // belongs to the moment a name is read, not to a repaint or a sync.
  function paint() {
    if (!_grid) return;
    for (const key of _called) {
      _grid.querySelector(`.qb-member[data-last="${CSS.escape(key)}"]`)?.classList.add('is-called');
    }
    for (const [key, vote] of _votes) {
      const n = _grid.querySelector(`.qb-member[data-last="${CSS.escape(key)}"]`);
      if (n) n.classList.add('is-called', vote === 'NO' ? 'is-no' : vote === 'PRESENT' ? 'is-present' : 'is-aye');
    }
  }

  // A vote heard is worth more than a name read, and it also tells us which
  // kind of event this is. The clerk reads the whole alphabet during a vote
  // exactly as in a quorum call, so without this the board would light all 100
  // in two minutes and look like a result.
  function castVote(surname, vote) {
    const key = fold(surname);
    if (!key || !vote) return;
    // Entering a vote clears the quorum call's lighting.
    //
    // They are different events and the old names mean nothing in the new one.
    // Left alone, a board carrying 95 names from an earlier quorum call showed
    // 95 lit boxes beside a count of 6 votes -- which reads as 95 senators
    // having done something in this vote, and made every member who had not
    // voted yet look like the odd one out rather than the norm.
    if (_mode !== 'vote') {
      _called = new Set();
      _grid?.querySelectorAll('.qb-member').forEach((n) =>
        n.classList.remove('is-called', 'is-warming', 'is-aye', 'is-no', 'is-present'));
    }
    _votes.set(key, vote);
    _mode = 'vote';
    _lastNameAt = Date.now();
    save();
    paint();
    update();
  }

  function light(surname) {
    const key = fold(surname);
    if (!key) return;
    // Record first, draw second.
    //
    // The roster is fetched async and the caption buffer is swept the moment
    // the track attaches, so on a page opened mid-call every name already in
    // the buffer arrives before there is a board to light. This used to return
    // early and drop them -- and they never came back, because the speaker
    // module remembers which names it has broadcast and does not repeat one.
    // The set is the state; the DOM is a view of it, and build() re-applies it.
    // A second roll call starts the alphabet again, and that is the only
    // signal there is that the last vote is over. Nothing announces it, so a
    // name sorting BEFORE the previous one means the clerk has gone back to
    // the top and whatever is on the board belongs to a finished vote.
    //
    // Guarded to a real jump backwards: adjacent names out of order would be a
    // caption stutter, not a new call.
    if (_lastRoll && key < _lastRoll && _lastRoll.slice(0, 1) > 'D' && key.slice(0, 1) < 'C') {
      reset();
      // The Worker's set still holds BOTH calls, keyed on the stream, so
      // merging it back would undo this. Dropped for the rest of the page's
      // life rather than re-lighting a vote that has finished.
      _workerVotesStale = true;
    }
    _lastRoll = key;

    // During a vote the roll read is just the clerk going down the list and
    // says nothing about anyone, so it must not light a box.
    if (_mode === 'vote') return;
    const known = _called.has(key);
    _called.add(key);
    _lastNameAt = Date.now();
    if (!_grid) return;
    const node = _grid.querySelector(`.qb-member[data-last="${CSS.escape(key)}"]`);
    save();
    if (!node || known || node.classList.contains('is-called')) { update(); return; }
    // The flicker is a class rather than a permanent animation so it runs once,
    // on the way up, and does not keep twitching afterwards.
    node.classList.add('is-called', 'is-warming');
    setTimeout(() => node.classList.remove('is-warming'), 900);
    update();
  }

  function update() {
    const voting = _mode === 'vote';
    const ayes = [..._votes.values()].filter((v) => v === 'AYE').length;
    const nos = [..._votes.values()].filter((v) => v === 'NO').length;
    const n = voting ? _votes.size : _called.size;

    // The labels have to change with the mode, because the same box means a
    // different thing: names read in a quorum call, votes recorded in a vote.
    const l1 = document.querySelector('.quorum-metrics .metric-item:nth-child(1) .metric-label');
    const l2 = document.querySelector('.quorum-metrics .metric-item:nth-child(2) .metric-label');
    const v2 = document.querySelector('.quorum-metrics .metric-item:nth-child(2) .metric-value');
    const tag = el('vote-type-tag');
    if (l1) l1.textContent = voting ? 'Votes Recorded' : 'Names Called';
    if (l2) l2.textContent = voting ? 'Aye / No' : 'Required for Quorum';
    if (v2) v2.textContent = voting ? `${ayes} / ${nos}` : '51';
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
      const met = n >= QUORUM_REQUIRED;
      ind.classList.toggle('quorum-met', met);
      const txt = ind.querySelector('.indicator-text');
      // "No call in progress" claimed to know what the Senate is doing. All this
      // knows is whether it has read any names off the caption track, and those
      // are different: a silent track means nobody is speaking, the stream
      // dropped, or the chamber is quiet, and none of that is observable from
      // here. Say what was counted.
      if (txt) txt.textContent = voting ? `${n} OF 100 RECORDED`
        : n === 0 ? 'NO NAMES READ' : met ? 'QUORUM PRESENT' : `${QUORUM_REQUIRED - n} MORE FOR QUORUM`;
    }

    document.body.classList.toggle('senate-quorum-active', n > 0);
  }

  function reset() {
    _called = new Set();
    _lastRoll = '';
    _votes = new Map();
    _mode = 'quorum';
    _lastNameAt = 0;
    save();
    globalThis.SenateSpeaker?.resetRoll?.();
    _grid?.querySelectorAll('.qb-member').forEach((n) => n.classList.remove('is-called', 'is-warming', 'is-aye', 'is-no', 'is-present'));
    update();
  }

  // The timer lives in HAPPENING NOW in the shared markup, where it sat among
  // the yea/nay tallies. A quorum call has a duration but no tallies, so it is
  // relocated under the board it is timing rather than duplicated.
  function moveTimer() {
    const timer = document.querySelector('.vote-display .vote-timer');
    const panel = document.querySelector('.quorum-panel .quorum-content');
    if (timer && panel && timer.parentElement !== panel) panel.appendChild(timer);
  }

  function init(deps) {
    _deps = deps || {};
    restore();
    moveTimer();
    document.addEventListener('senate-roll-name', (e) => light(e.detail?.surname));
    // Called off by consent: the call is over and the board should not keep
    // showing it as running.
    document.addEventListener('senate-quorum-vitiated', () => reset());
    document.addEventListener('senate-vote-cast', (e) => castVote(e.detail?.surname, e.detail?.vote));
    // A call that simply stops being read is over too. Nothing announces that,
    // and without it a board sits on a finished call until the next day's
    // stream. Twenty minutes because a live quorum genuinely pauses for long
    // stretches while members are found -- shorter would clear a call that is
    // merely waiting.
    setInterval(() => {
      // Counts votes as well as names. Guarding on _called alone meant this
      // could never fire in vote mode, which empties it -- so a finished vote
      // stayed on screen through debate and adjournment with nothing able to
      // clear it.
      if ((!_called.size && !_votes.size) || !_lastNameAt) return;
      // A vote is a bounded event and goes quiet the moment it is gavelled, so
      // ten minutes of silence ends it. A quorum call genuinely pauses for
      // long stretches while members are found, so it keeps the longer leash.
      const idle = _mode === 'vote' ? 10 * 60 * 1000 : 20 * 60 * 1000;
      if (Date.now() - _lastNameAt > idle) reset();
    }, 60 * 1000);
    update();
  }

  // The Worker reads the same captions and keeps the whole call, so a viewer
  // arriving mid-call gets every name already read instead of an empty board.
  // The local caption reader stays: it lights a name the instant it is spoken,
  // where this trails by a poll. Merged rather than replacing, so whichever
  // sees a name first wins and neither can un-light one.
  async function syncFromWorker(api) {
    if (!api) return;
    try {
      const r = await fetch(`${api}/senate/quorum`);
      if (!r.ok) return;
      const d = await r.json();
      // The Worker's set is the QUORUM roll. During a vote it means nothing --
      // the clerk reads the same alphabet either way -- and merging it in was
      // refilling the board seconds after a vote cleared it, on a browser with
      // no stored state at all.
      // Votes first, and they apply in any mode: they are the thing a viewer
      // joining mid-vote most needs and the thing localStorage cannot give them.
      let changed = false;
      for (const [k, v] of (_workerVotesStale ? [] : Object.entries(d.votes || {}))) {
        const key = fold(k);
        if (key && _votes.get(key) !== v) { _votes.set(key, v); changed = true; }
      }
      if (changed) {
        if (_mode !== 'vote') { _called = new Set(); _mode = 'vote'; }
        save(); paint(); update();
      }
      if (_mode === 'vote') return;
      let added = false;
      for (const n of d.names || []) {
        const key = fold(n);
        if (key && !_called.has(key)) { _called.add(key); added = true; }
      }
      if (added) { save(); paint(); update(); }
    } catch { /* the board keeps whatever it read locally */ }
  }

  globalThis.SenateQuorum = { init, build, reset, light, syncFromWorker };
})();
