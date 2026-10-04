// Who has the floor in the Senate, read off the caption track.
//
// Not the House's mechanism. lib/floor-speaker.js splits on "UNIDENTIFIED
// SPEAKER:", which the House stenographer emits at every speaker change and
// which carries no name. Senate TV names the member instead -- "MS. CANTWELL:"
// -- which is better, and comes with a catch.
//
// The catch is that the label appears ONCE, when the member is recognised, and
// the caption window is a three-line roll-up. Sample the track while somebody
// has been speaking for a few minutes and there is no label in it at all: the
// buffer holds only the tail of the current sentence. Measured on a live
// session, 79 cues in the track deduped to 14 lines of speech and zero labels,
// while the chamber had been hearing the same senator for some time.
//
// So the label is latched when it goes past and held until the next one. A
// speaker is not "the label currently on screen", it is "the last label seen".
//
// The cues are also rolling cumulative: each repeats the previous text plus a
// few more words, so 79 cues is 14 lines. Scanning every cue would match the
// same label a dozen times, which is harmless but means the "new speaker"
// signal has to come from the label changing, not from finding one.

(() => {
  let _seats = [];
  let _current = null;   // { label, member }
  let _deps = {};

  const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

  // Diacritics folded: the roster says Luján, the captions say LUJAN.
  const fold = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

  // Who the surname is, or who it might be.
  //
  // Returns { member } when it is one senator, { candidates } when two share the
  // surname and nothing says which, and null when the roster has nobody by that
  // name. Matching on surname alone used to take the first of two Scotts, which
  // puts a face and a party on a speech that may belong to the other one -- the
  // one outcome worse than showing nothing. `state` is the chair's own words
  // ("THE SENATOR FROM FLORIDA"), read by lib/senate-call.js.
  function resolve(surname, state) {
    const want = fold(surname).replace(/[’']/g, "'");
    // Exact surname first; "VAN HOLLEN" and "CANTWELL" both land here.
    let hits = _seats.filter((s) => fold(s.last) === want);
    if (!hits.length) hits = _seats.filter((s) => fold(s.last).replace(/[^A-Z]/g, '') === want.replace(/[^A-Z]/g, ''));
    if (hits.length > 1 && state) {
      const inState = hits.filter((s) => s.state === state);
      if (inState.length === 1) hits = inState;
    }
    if (hits.length > 1) return { candidates: hits };
    return hits.length ? { member: hits[0] } : null;
  }

  // What the office is doing, which is not always presiding. The chair and the
  // president pro tempore preside; the clerk reads, and calling him presiding
  // was simply wrong. The leaders are senators speaking as leaders, not
  // officers of the chamber.
  function officeMeta(label) {
    const l = label.toUpperCase();
    if (l.includes('CLERK')) return 'Reading';
    if (l.includes('LEADER')) return 'Floor leader';
    return 'Presiding';
  }

  function render() {
    const row   = document.getElementById('pip-speaker');
    const photo = document.getElementById('pip-speaker-photo-wrap');
    const name  = document.getElementById('pip-speaker-name');
    const meta  = document.getElementById('pip-speaker-meta');
    if (!row || !name || !meta) return;
    if (!_current) { row.hidden = true; return; }

    const m = _current.member;
    const amb = _current.candidates;
    // Two senators share the name and nothing says which. Say so, with the
    // states, rather than put either one's face on the speech.
    name.textContent = m ? `${m.first} ${m.last}` : amb ? `Sen. ${titleCase(_current.label)}` : titleCase(_current.label);
    meta.textContent = m ? `${m.party}-${m.state}` : amb ? amb.map((c) => c.state).join(' or ') : officeMeta(_current.label);
    if (photo) {
      const url = m && m.bioguide && _deps.photoUrlFor ? _deps.photoUrlFor(m.bioguide) : '';
      // .pip-speaker-photo is opacity:0 in the stylesheet and faded in on load,
      // which is how every other photo on these boards avoids showing a
      // half-decoded image. Without the onload it loaded correctly and stayed
      // invisible, which looked like the photo never arriving.
      photo.innerHTML = url
        ? `<img class="pip-speaker-photo" src="${url}" alt="" onload="this.style.opacity='1'" onerror="this.remove()">`
        : '';
    }
    row.hidden = false;
  }

  // Reading the words is not this module's business. lib/senate-call.js, the same
  // code the Worker runs, decides what a caption means -- a roll name, a vote, a
  // tally, who has the floor -- and lib/senate-quorum.js holds the result and
  // merges it with the Worker's. This module hands it the text (`senate-caption`)
  // and draws the speaker row from what comes back (`senate-call`). A viewer who
  // joins mid-speech gets the speaker from the Worker instead of waiting for the
  // next label.
  function place(sp) {
    const r = sp.kind === 'member' ? resolve(sp.label, sp.state) : null;
    return { member: r && r.member || null, candidates: r && r.candidates || null };
  }

  function onCall(call) {
    const sp = call && call.speaker;
    if (!sp) return;
    if (_current && _current.label === sp.label && _current.state === (sp.state || null)) return;   // same speaker, still talking
    _current = { label: sp.label, state: sp.state || null, office: sp.kind === 'office', ...place(sp) };
    render();
  }

  function onCue(text) {
    const flat = String(text || '').replace(/\n/g, ' ');
    document.dispatchEvent(new CustomEvent('senate-caption', { detail: { text: flat } }));
  }

  function watch(track) {
    if (!track) return;
    if (track.mode === 'disabled') track.mode = 'hidden';
    if (!track._senateSpeakerWatched) {
      track._senateSpeakerWatched = true;
      track._senateSpeakerSeen = 0;
      track.addEventListener('cuechange', () => {
        for (const c of track.activeCues || []) onCue(c.text);
      });
    }
    // Sweep whatever is in the buffer beyond what has already been read.
    //
    // Scanning it once on attach was not enough. hls.js can hand the track over
    // before any cue has landed, and cuechange only fires while the video is
    // PLAYING -- so a tab that is backgrounded, or a stream that stalls, fills
    // the buffer with nobody listening and the latch never happens. Observed
    // exactly that: a buffer holding "THE CLERK:" and an empty speaker row.
    const cues = track.cues || [];
    for (let i = track._senateSpeakerSeen || 0; i < cues.length; i++) onCue(cues[i].text);
    track._senateSpeakerSeen = cues.length;
  }

  function init(deps) {
    _deps = deps || {};
    _seats = Array.isArray(_deps.seats) ? _deps.seats : [];
    document.addEventListener('senate-call', (e) => onCall(e.detail?.call));
    const video = document.getElementById(_deps.videoId || 'player-pip');
    if (!video) return;
    const scan = () => { for (const t of video.textTracks || []) if (t.kind === 'subtitles' || t.kind === 'captions') watch(t); };
    video.textTracks?.addEventListener?.('addtrack', scan);
    scan();
    // The track is attached by hls.js after the manifest parses, which can be
    // well after this runs, and addtrack is not fired by every path into it.
    // This also re-sweeps the buffer, which is what catches a label that landed
    // while the video was paused.
    setInterval(scan, 4000);
  }

  function setSeats(seats) { _seats = Array.isArray(seats) ? seats : []; if (_current && !_current.member) { Object.assign(_current, place({ kind: _current.office ? 'office' : 'member', label: _current.label, state: _current.state })); render(); } }

  globalThis.SenateSpeaker = { init, setSeats, current: () => _current };
})();
