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

  function restore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw && Array.isArray(raw.names) && raw.votes && typeof raw.votes === 'object') {
        _call = SC.expire({ ...SC.emptyCall(), ...raw }, Date.now());
      }
    } catch { /* unreadable or absent: start empty */ }
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

  // Put the call onto the board. `warm` is the names that arrived since the last
  // paint, which get the one-shot flicker; a repaint or a sync does not.
  function paint(warm = []) {
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
  }

  // Take a new view of the call, from the captions or from the Worker. Draws
  // only if something changed, and flickers only the names that are new.
  function apply(next) {
    const sig = (c) => JSON.stringify([c.callId, c.kind, c.names, c.votes, c.ended]);
    const was = _call;
    const changed = sig(next) !== sig(was);
    _call = next;
    if (!changed) { if (next.lastAt !== was.lastAt) save(); return; }
    const before = new Set(was.callId === next.callId ? was.names : []);
    save();
    paint(next.kind === 'quorum' ? next.names.filter((k) => !before.has(k)) : []);
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
    document.addEventListener('senate-caption', (e) => apply(SC.feed(_call, e.detail?.text, Date.now())));
    // A call whose ending was never heard. A call that simply stops being read is
    // over too, and without this a board sits on a finished call until the next
    // day's stream. Forty-five minutes, because both kinds genuinely pause for
    // long stretches while members are found.
    setInterval(() => apply(SC.expire(_call, Date.now())), 60 * 1000);
    update();
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

  function reset() { apply(SC.emptyCall()); }

  globalThis.SenateQuorum = { init, build, reset, syncFromWorker };
})();
