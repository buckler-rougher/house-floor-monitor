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

  const el = (id) => document.getElementById(id);

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
      <div class="qb-member" data-last="${String(m.last).toUpperCase()}" title="${m.first} ${m.last} (${m.party}-${m.state})">
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
    for (const key of _called) {
      _grid.querySelector(`.qb-member[data-last="${CSS.escape(key)}"]`)?.classList.add('is-called');
    }
    update();
  }

  function light(surname) {
    if (!_grid) return;
    const key = String(surname || '').toUpperCase();
    const node = _grid.querySelector(`.qb-member[data-last="${CSS.escape(key)}"]`);
    if (!node || node.classList.contains('is-called')) return;
    _called.add(key);
    // The flicker is a class rather than a permanent animation so it runs once,
    // on the way up, and does not keep twitching afterwards.
    node.classList.add('is-called', 'is-warming');
    setTimeout(() => node.classList.remove('is-warming'), 900);
    update();
  }

  function update() {
    const n = _called.size;
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
      if (txt) txt.textContent = n === 0 ? 'NO CALL IN PROGRESS' : met ? 'QUORUM PRESENT' : `${QUORUM_REQUIRED - n} MORE FOR QUORUM`;
    }

    document.body.classList.toggle('senate-quorum-active', n > 0);
  }

  function reset() {
    _called = new Set();
    globalThis.SenateSpeaker?.resetRoll?.();
    _grid?.querySelectorAll('.qb-member').forEach((n) => n.classList.remove('is-called', 'is-warming'));
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
    moveTimer();
    document.addEventListener('senate-roll-name', (e) => light(e.detail?.surname));
    update();
  }

  globalThis.SenateQuorum = { init, build, reset, light };
})();
