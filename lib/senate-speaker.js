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

  // The clerk reading the roll, which is a different thing from a speaker
  // label and is told apart by its punctuation: a name being called ends in a
  // PERIOD ("MS. BALDWIN.") and a member taking the floor ends in a COLON
  // ("MS. CANTWELL:"). Broadcast rather than handled here, so the quorum board
  // can listen without a second copy of the caption plumbing.
  // A vote being CAST, which is a different thing again from a name being read.
  //
  // The clerk reads the roll straight down -- "MS. DUCKWORTH." -- and that says
  // nothing about anyone. When a member answers, or a late-comer is recorded,
  // the vote is spoken with it and a COMMA appears before it:
  //
  //     MS. DUCKWORTH, AYE.  MS. SMITH, AYE.
  //
  // Captured live on 28 September. Only AYE has been seen -- nobody opposed
  // that vote -- so NO, NAY and PRESENT are included on the shape of the
  // pattern rather than on observation, and should be confirmed against a
  // contested vote before anything depends on them.
  const VOTE_RE = /\b(?:MR|MRS|MS)\.\s+([A-Z][A-Z'’-]{1,24}(?:\s+[A-Z][A-Z'’-]{1,24})?)\s*,\s*(AYE|YEA|NO|NAY|PRESENT)\b/g;

  const ROLL_RE = /\b(?:MR|MRS|MS)\.\s+([A-Z][A-Z'’-]{1,24}(?:\s+[A-Z][A-Z'’-]{1,24})?)\s*\./g;
  const NOT_A_MEMBER = new Set(['PRESIDENT', 'SPEAKER', 'CHAIRMAN', 'CHAIRWOMAN', 'CHAIR', 'CLERK', 'LEADER', 'SECRETARY', 'PARLIAMENTARIAN']);
  const _rollSeen = new Set();

  const _voteSeen = new Map();

  // The other shape a vote comes in.
  //
  // Besides the inline "MS. DUCKWORTH, AYE." the clerk reads blocks under a
  // heading -- "SENATORS VOTING AYE: MR. A, MR. B" -- where the names carry no
  // vote of their own and belong to whichever heading last opened. Without
  // this, a block of no-voters is invisible: the names have no comma, so they
  // parse as a plain roll read and mean nothing.
  //
  // The AYE heading is reported from watching it; the negative wording is
  // matched on several plausible forms and is NOT confirmed. Anything relying
  // on nay counts should be checked against a contested vote first.
  const HEAD_RE = /\bSENATORS?\s+VOTING\s+(?:IN\s+THE\s+)?(AFFIRMATIVE|NEGATIVE|AYE|YEA|NAY|NO|PRESENT)\b/g;

  function headingRuns(text) {
    const marks = [...text.matchAll(HEAD_RE)].map((m) => ({
      at: m.index + m[0].length,
      vote: /AFFIRM|AYE|YEA/.test(m[1]) ? 'AYE' : /NEGATIVE|NAY|NO/.test(m[1]) ? 'NO' : 'PRESENT',
    }));
    return marks.map((mk, i) => ({
      vote: mk.vote,
      text: text.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : text.length),
    }));
  }

  function emitVotes(text) {
    // Headed blocks first, so a name inside one is attributed to its heading
    // rather than to the bare-name path.
    for (const run of headingRuns(text)) {
      ROLL_RE.lastIndex = 0;
      let r;
      while ((r = ROLL_RE.exec(run.text))) record(r[1], run.vote);
    }
    VOTE_RE.lastIndex = 0;
    let m;
    while ((m = VOTE_RE.exec(text))) {
      record(m[1], m[2] === 'YEA' ? 'AYE' : m[2] === 'NAY' ? 'NO' : m[2]);
    }
  }

  function record(raw, vote) {
    {
      const name = String(raw).replace(/\s+/g, ' ').trim();
      const key = fold(name);
      // A member can be recorded, then recorded again in a later read-back.
      // Same answer twice is not news; a CHANGED answer is, and the later one
      // wins because that is the order the chamber heard them.
      if (_voteSeen.get(key) === vote) return;
      _voteSeen.set(key, vote);
      document.dispatchEvent(new CustomEvent('senate-vote-cast', {
        detail: { surname: name, vote, member: resolve(name) },
      }));
    }
  }

  function emitRollNames(text) {
    ROLL_RE.lastIndex = 0;
    let m;
    while ((m = ROLL_RE.exec(text))) {
      const name = m[1].replace(/\s+/g, ' ').trim();
      const key = fold(name);
      // "MR. PRESIDENT" is how half the floor starts a sentence and parses as
      // a surname. It is not a member and must not be counted as one.
      if (NOT_A_MEMBER.has(key)) continue;
      if (_rollSeen.has(key)) continue;   // the window repeats a name for several cues
      _rollSeen.add(key);
      document.dispatchEvent(new CustomEvent('senate-roll-name', {
        detail: { surname: name, member: resolve(name) },
      }));
    }
  }

  // A quorum call is usually called off by consent before it finishes: "the
  // order for the quorum call be rescinded", "the quorum call be vitiated".
  // Both orders of the two words appear, and the wording between them varies,
  // so this matches the pair rather than a phrase.
  // The close of a vote is announced, which is the only honest way to know it
  // is over. The chair reads the tally -- "THE YEAS ARE 74, THE NAYS ARE 25"
  // -- and that is the moment the vote stops being live.
  const TALLY_RE = /\bTHE\s+(?:YEAS|AYES)\s+ARE\s+(\d{1,3})\b[\s\S]{0,60}?\bTHE\s+NAYS\s+ARE\s+(\d{1,3})\b/;

  // What happened, read rather than inferred from the numbers. A tally alone
  // does not tell you: cloture needs sixty, a treaty two thirds, most things a
  // simple majority, so 55-45 can be carried or lost depending on the question.
  // The chair says which, and "NOT AGREED TO" differs from "AGREED TO" by one
  // word that flips the meaning.
  const OUTCOME_RE = /\b(?:IS|ARE|STANDS|HAVING)\s+(NOT\s+)?(AGREED\s+TO|PASSED|CONFIRMED|INVOKED|ADOPTED|REJECTED|SUSTAINED|WELL\s+TAKEN)\b/;

  const VITIATE_RE = /(QUORUM\s+CALL[\s\S]{0,60}?(VITIAT|RESCIND))|((VITIAT|RESCIND)[A-Z]*[\s\S]{0,60}?QUORUM\s+CALL)/;

  function onCue(text) {
    const flat = String(text || '').replace(/\n/g, ' ');
    const tally = flat.match(TALLY_RE);
    if (tally) {
      const o = flat.match(OUTCOME_RE);
      const outcome = o ? `${o[1] ? 'NOT ' : ''}${o[2].replace(/\s+/g, ' ')}` : null;
      document.dispatchEvent(new CustomEvent('senate-vote-closed', {
        detail: { yeas: Number(tally[1]), nays: Number(tally[2]), outcome },
      }));
    }
    if (VITIATE_RE.test(flat)) {
      document.dispatchEvent(new CustomEvent('senate-quorum-vitiated'));
    }
    // Votes first: "MS. DUCKWORTH, AYE." also satisfies the bare-name pattern
    // if the comma is ignored, and being counted as a name read would be the
    // weaker reading of the same words.
    emitVotes(flat);
    emitRollNames(flat);
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

  globalThis.SenateSpeaker = { init, setSeats, resetRoll: () => { _rollSeen.clear(); _voteSeen.clear(); } };
})();
