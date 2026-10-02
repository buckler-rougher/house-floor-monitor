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
  // Senate floor address, as the stenographer types it. Surnames resolve
  // against the roster; the chair and the desk do not, and keep their title.
  const MEMBER_RE = /\b(?:MR|MRS|MS|SEN|SENATOR)\.?\s+([A-Z][A-Z'’-]{1,24}(?:\s+[A-Z][A-Z'’-]{1,24})?)\s*:/g;
  const OFFICE_RE = /\b(THE\s+(?:PRESIDING\s+OFFICER|PRESIDENT\s+PRO\s+TEMPORE|ACTING\s+PRESIDENT\s+PRO\s+TEMPORE|CLERK|MAJORITY\s+LEADER|MINORITY\s+LEADER|CHAIR))\s*:/g;

  let _seats = [];
  let _current = null;   // { label, member }
  let _deps = {};

  const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

  // Diacritics folded: the roster says Luján, the captions say LUJAN.
  const fold = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

  function resolve(surname) {
    const want = fold(surname).replace(/[’']/g, "'");
    // Exact surname first; "VAN HOLLEN" and "CANTWELL" both land here.
    return _seats.find((s) => fold(s.last) === want)
        || _seats.find((s) => fold(s.last).replace(/[^A-Z]/g, '') === want.replace(/[^A-Z]/g, ''))
        || null;
  }

  // The last label in the text, because a cue can carry a handoff: one member
  // yielding and the next being recognised inside the same line.
  function lastLabel(text) {
    let hit = null, m;
    MEMBER_RE.lastIndex = 0;
    while ((m = MEMBER_RE.exec(text))) hit = { kind: 'member', at: m.index, raw: m[1] };
    OFFICE_RE.lastIndex = 0;
    while ((m = OFFICE_RE.exec(text))) {
      if (!hit || m.index > hit.at) hit = { kind: 'office', at: m.index, raw: m[1] };
    }
    return hit;
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
    name.textContent = m ? `${m.first} ${m.last}` : titleCase(_current.label);
    meta.textContent = m ? `${m.party}-${m.state}` : officeMeta(_current.label);
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

  // Roll names, recorded votes, the tally and a vitiated quorum call are not
  // this module's business. They are read by lib/senate-call.js, the same code
  // the Worker runs, held by lib/senate-quorum.js, and handed the text through
  // the `senate-caption` event below. This module owns the caption plumbing; that
  // one owns what the words mean.

  function onCue(text) {
    const flat = String(text || '').replace(/\n/g, ' ');
    document.dispatchEvent(new CustomEvent('senate-caption', { detail: { text: flat } }));
    const hit = lastLabel(flat);
    if (!hit) return;                       // no label in this cue: keep the latch
    const label = hit.raw.replace(/\s+/g, ' ').trim();
    if (_current && _current.label === label) return;   // same speaker, still talking
    _current = { label, member: hit.kind === 'member' ? resolve(label) : null };
    render();
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

  function setSeats(seats) { _seats = Array.isArray(seats) ? seats : []; if (_current && !_current.member) { _current.member = resolve(_current.label); render(); } }

  globalThis.SenateSpeaker = { init, setSeats };
})();
