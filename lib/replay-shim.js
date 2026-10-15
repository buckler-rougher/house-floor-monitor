// THE TIME MACHINE, board side. Loaded in the <head> (before hls.js and app.js, like the dev harness) ONLY when the address carries ?replay=YYYYMMDD, so a normal page view pays nothing.
//
//   /?replay=20260916                 the board as it was on 16 September 2026, from the gavel
//   /?replay=20260916&t=18:49:30      ... from 6:49:30 PM Eastern
//   /?replay=20260916&local           (dev) the day, its floor log and its rolls from dev/fixtures/replay/ instead of the Worker
//
// HOW IT WORKS. The board is built to be fed by a live Worker: a floor log and a floor status pushed over a server-sent-events stream, a few REST reads, the clock. In replay the
// board runs unchanged and is handed a different past: this file installs, before app.js runs,
//   * a Date whose "now" is the replay moment (every clock, "today" test and countdown on the board follows it, including which Congress it is),
//   * a fetch that answers the board's own API from the archived day (the Clerk's floor log clipped to the moment, a floor status made from it and the day's roll calls, the speaker
//     from the day's captions) and gives an empty answer to everything that has no history, so those panels stay empty (lib/replay-ui.js marks them "not available for this date"),
//   * an EventSource that "pushes" the clipped floor log and floor status as the moment moves,
// and drives the video (lib/floor-feed.js, `replay` option). The moment is the video: wall time = lib/replay.js's timeline of the video position.
//
// `window.__replay` is the controller lib/replay-ui.js talks to: state, `seekWall(ms)`, `seekMedia(s)`, `play()/pause()`, `rate(x)`, `on(fn)` for ticks.

(function () {
  const q = new URLSearchParams(location.search);
  const DATE = q.get('replay');
  if (!/^\d{8}$/.test(DATE || '')) return;
  const R = window.Replay;
  if (!R) { console.error('replay: lib/replay.js must load first'); return; }

  const LOCAL = q.has('local');
  const API = 'https://api.evanhollander.org/house-floor/api';
  const RealDate = Date;
  const realFetch = window.fetch.bind(window);
  const RealES = window.EventSource;
  const MMDDYYYY = `${DATE.slice(4, 6)}/${DATE.slice(6, 8)}/${DATE.slice(0, 4)}`;
  const ISO = `${DATE.slice(0, 4)}-${DATE.slice(4, 6)}-${DATE.slice(6, 8)}`;

  const S = {
    active: true, date: DATE, iso: ISO,
    day: null, items: [], rolls: [], cues: [], timeline: null,
    wallMs: R.etMs(`${ISO}T09:00:00`),        // until the day is known
    targetWall: null,                          // where the viewer asked to go; the video is corrected to it once the captions say where it really is
    playing: false, rateX: 1, synced: false, syncing: true, error: null,
    video: null, listeners: new Set(), speaker: null,
    floorFeedOpts: null,
  };
  window.__replay = S;
  document.documentElement.classList.add('replay-mode');

  // ---- the clock ----
  function ReplayDate(...a) {
    if (!(this instanceof ReplayDate)) return new RealDate(S.wallMs).toString();
    return a.length ? new RealDate(...a) : new RealDate(S.wallMs);
  }
  ReplayDate.prototype = RealDate.prototype;
  ReplayDate.now = () => S.wallMs;
  ReplayDate.UTC = RealDate.UTC;
  ReplayDate.parse = RealDate.parse;
  window.Date = ReplayDate;

  // ---- what a replay must not do: leave marks on the viewer's board state, or ask for permission ----
  try {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (/^(mtr-|amendment-votes|dw-notified|tracked-bills|bills-alerts)/.test(String(k))) return; return set.call(this, k, v); };
  } catch { /* storage unavailable */ }
  try { Object.defineProperty(window, 'Notification', { value: undefined, configurable: true }); } catch { /* ok */ }

  // ---- data ----
  const local = (name) => realFetch(`dev/fixtures/replay/${name}-${DATE}.json`).then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); });
  const remote = (path) => realFetch(`${API}/${path}`).then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); });
  const getDay = () => (LOCAL ? local('day') : remote(`replay-day?date=${DATE}`));
  const getItems = () => (LOCAL ? local('proceedings') : remote(`proceedings?date=${encodeURIComponent(MMDDYYYY)}`));
  const getRolls = () => (LOCAL ? local('rolls') : remote(`house-rolls?date=${encodeURIComponent(MMDDYYYY)}`));

  const rollMs = (r) => {
    const m = /^(\d{1,2}):(\d\d) ([AP]M)$/.exec(String(r.time || ''));
    if (!m) return NaN;
    const h = (+m[1] % 12) + (m[3] === 'PM' ? 12 : 0);
    return R.etMs(`${ISO}T${String(h).padStart(2, '0')}:${m[2]}:00`) + 45000;   // the Clerk's minute; the chair has read the result by the middle of it
  };

  // When each recorded vote was OPEN, from the captions: the chair says "THIS IS A FIVE MINUTE VOTE" as it opens and reads "ON THIS VOTE, THE YEAS ARE ..." as it closes. The Clerk's roll file
  // only has the minute it was announced (that is what `ms` is), so the announcement cue is the one nearest it that carries the same totals, and the opening is the last "MINUTE VOTE" before.
  // A vote whose two cues cannot both be found has no window: it appears at its result, as it would from the roll file alone.
  const NUM = { TWO: 2, THREE: 3, FIVE: 5, TEN: 10, FIFTEEN: 15 };
  function voteWindows(rolls, cues, tl) {
    const out = [];
    for (const r of rolls) {
      const est = tl.captionFromWall(r.ms - 45000);
      let close = null, loose = null;
      for (let i = 0; i < cues.length; i++) {
        const c = cues[i];
        if (c.t < est - 900) continue;
        if (c.t > est + 900) break;
        const w = cues.slice(i, i + 4).map((x) => x.text).join(' ');
        const m = w.match(/YEAS\s+ARE\s+(\d+)\D{0,40}?NAYS\s+ARE\s+(\d+)/) || w.match(/AYES\s+ARE\s+(\d+)\D{0,60}?(?:NAYS|NOES|THOSE)\s+ARE\s+(\d+)/);
        if (!m) continue;
        const exact = +m[1] === r.totals.yeas && +m[2] === r.totals.nays;
        if (exact && (close == null || Math.abs(c.t - est) < Math.abs(close - est))) close = c.t;
        if (!exact && (loose == null || Math.abs(c.t - est) < Math.abs(loose - est))) loose = c.t;   // a garbled tally ("THE AYES ARE 217 AND THOSE ARE 207") near the right minute
      }
      if (close == null && loose != null && Math.abs(loose - est) < 300) close = loose;
      if (close == null) continue;
      let open = null, minutes = null;
      for (let i = cues.length - 1; i >= 0; i--) {
        if (cues[i].t > close) continue;
        if (cues[i].t < close - 3000) break;
        const m = (cues[i].text + ' ' + (cues[i + 1] ? cues[i + 1].text : '')).match(/\b(\d+|TWO|THREE|FIVE|TEN|FIFTEEN)[- ](?:MINUTE )?VOTE\b/);
        if (m) { open = cues[i].t; minutes = NUM[m[1]] || +m[1] || null; break; }
      }
      const closeMs = tl.wallFromCaption(close);
      // no "N-minute vote" in the words (a vote after a long debate often has none): the Clerk's own time for the roll is when the vote was opened, if that leaves a vote to watch
      if (open == null && r.ms < closeMs - 20000 && r.ms > closeMs - 40 * 60000) { out.push({ roll: r.roll, open: r.ms, close: closeMs, minutes: null, r }); continue; }
      if (open == null) continue;
      out.push({ roll: r.roll, open: tl.wallFromCaption(open), close: closeMs, minutes, r });
    }
    return out;
  }

  // ---- where the caption file sits against the video, read straight from the video's own captions ----
  // A window of segments around a media time is fetched and decoded (lib/replay-cc.js); the lines in it that occur once in the caption file give the shift there (lib/replay.js).
  // Any window with speech in it will do (the shift does not depend on where in the window), so it widens outward from the moment asked for until there are captions.
  const CC = () => window.ReplayCC;
  let ccSetupP = null;
  // the smallest rendition's playlist (read once), its segment list and the video's timescale. The House's newer days are 2 s files, its older ones one file cut into 6 s byte ranges.
  function ccSetup() {
    if (ccSetupP) return ccSetupP;
    ccSetupP = (async () => {
      const base = S.day.hls.replace(/[^/]*$/, '');
      const uri = CC().lowest(await realFetch(S.day.hls).then((r) => r.text()));
      if (!uri) throw new Error('no rendition');
      const pl = CC().playlist(await realFetch(base + uri).then((r) => r.text()));
      if (!pl.segs.length) throw new Error('no segments');
      const get = (u, range) => realFetch(base + u, range ? { headers: { Range: `bytes=${range[0]}-${range[0] + range[1] - 1}` } } : undefined).then((r) => (r.ok ? r.arrayBuffer() : null));
      let scale = null;
      if (pl.map) { const init = await get(pl.map.uri, pl.map.range); scale = init ? CC().timescale(init) : null; }
      return { pl, get, scale };
    })();
    ccSetupP.catch(() => { ccSetupP = null; });
    return ccSetupP;
  }
  const segAt = (pl, t) => { let lo = 0, hi = pl.segs.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pl.segs[mid].t0 <= t) lo = mid; else hi = mid - 1; } return lo; };
  async function readSegs(cc, from, to) {
    const out = [];
    await Promise.all(cc.pl.segs.slice(from, to).map((sg) => cc.get(sg.uri, sg.range).then((b) => { if (b) for (const x of CC().segmentCaptions(b, cc.scale).text) out.push(x); }).catch(() => {})));
    return out;
  }
  // where the caption file has runs of speech (a cue with another within five seconds either side), sorted: a read of the video only finds captions where someone spoke
  let speech = null;
  const speechTimes = () => {
    if (speech) return speech;
    const ts = S.cues.map((c) => c.t).sort((x, y) => x - y);
    speech = ts.filter((t, i) => i > 0 && i < ts.length - 1 && t - ts[i - 1] < 5 && ts[i + 1] - t < 5);
    return speech;
  };
  let probes = 0;
  async function probeAt(m0) {
    if (LOCAL || !CC() || !S.day) return false;
    S.probing = true; probes++;
    try {
      const cc = await ccSetup();
      const st = speechTimes();
      const c0 = S.timeline.captionFromMedia(m0);
      let lo = 0, hi = st.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (st[mid] < c0) lo = mid + 1; else hi = mid; }
      // the speech nearest the moment on either side, the nearer first (the shift hardly changes between them)
      const centres = [st[lo - 1], st[lo]].filter((x) => x != null).sort((x, y) => Math.abs(x - c0) - Math.abs(y - c0));
      if (!centres.length) centres.push(c0);
      for (const c of centres) {
        const i0 = segAt(cc.pl, S.timeline.mediaFromCaption(c));
        const big = !!cc.pl.segs[i0].range;                     // a day of 6 s, 1 MB pieces is read in small windows; a day of 2 s, 30 KB ones in wide ones
        const W = big ? 3 : 15, rounds = big ? 3 : 5;
        // the first window is centred on the guess; the next ones go outward on alternating sides (the shift guess may be a minute out)
        const lo0 = i0 - (W >> 1), wins = [[lo0, lo0 + W]];
        for (let r = 1; r < rounds; r++) { const k = Math.ceil(r / 2); wins.push(r % 2 ? [lo0 + k * W, lo0 + (k + 1) * W] : [lo0 - k * W, lo0 - (k - 1) * W]); }
        for (const [x, y] of wins) {
          const frags = await readSegs(cc, Math.max(0, x), Math.min(cc.pl.segs.length, y));
          const found = R.anchorsFrom(frags, S.cues);
          if (found.length && found[0].n >= 2) { S.timeline.addAnchors(found); saveAnchors(); return true; }
        }
      }
    } catch { /* the player's own captions are still tried */ }
    finally { if (--probes === 0) { S.probing = false; S.probeEnded = performance.now(); } }
    return false;
  }
  // a moment far from every anchor gets one read of its own before the video is trusted there (the shift steps during a day)
  const farFromAnchors = (ms) => { const cT = S.timeline.captionFromWall(ms); return !S.timeline.anchors.some((x) => Math.abs(x.c - cT) < 180); };
  S.ensureAnchor = (ms) => { if (S.timeline && farFromAnchors(ms)) probeAt(S.timeline.mediaFromWall(ms)).then(() => emit()); };

  let resolveReady;
  const ready = new Promise((res) => { resolveReady = res; });

  async function load() {
    try {
      // everything that can be asked at once is: the day's record, the Clerk's log and the roll calls together; then the caption file and the video's playlists while the log is read
      const itemsP = getItems(), rollsP = getRolls().catch(() => ({ rolls: [] }));
      const day = await getDay();
      S.day = day;
      const vttP = realFetch(day.vtt).then((r) => { if (!r.ok) throw new Error(`captions: ${r.status}`); return r.text(); });
      if (!LOCAL) ccSetup().catch(() => {});
      const itemsRes = await itemsP;
      S.items = (itemsRes.items || []).slice().sort((a, b) => b.timestamp - a.timestamp);
      S.rolls = [];   // the roll calls of an earlier year take a few seconds to find: the video does not wait for them (they are added when they come)
      const vttText = await vttP;
      S.cues = R.parseVtt(vttText);
      let anchors = [];
      try { anchors = JSON.parse(localStorage.getItem('replay-anchors:' + DATE) || '[]'); } catch { /* none kept */ }
      // until the video's own captions say better, the caption file's header offset is the guess (the House's own, off by up to a minute: far nearer than none, which lands on the opening slate)
      const note = /NOTE\s+CAPTIONS TIME OFFSET:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(vttText);
      const defaultShift = note ? (+note[1]) * 3600 + (+note[2]) * 60 + parseFloat(note[3]) : 0;
      S.timeline = R.timeline({ startMs: day.startMs, vttCues: S.cues, anchors, defaultShift });
      S.votes = [];
      const addRolls = (rollsRes) => {
        S.rolls = (rollsRes.rolls || []).map((r) => ({ ...r, ms: rollMs(r) })).filter((r) => !Number.isNaN(r.ms)).sort((a, b) => a.ms - b.ms);
        S.votes = voteWindows(S.rolls, S.cues, S.timeline);
        for (const w of S.votes) { w.r.startMs = w.open; w.r.ms = w.close; }   // a roll is a result once the vote closes, not when it opens
        push(true); emit();
      };
      rollsP.then(addRolls);
      S.endMs = day.endMs;
      const t = parseT(q.get('t'));
      const gavel = S.items.filter((x) => /^The House convened/i.test(x.description || '')).map((x) => x.timestamp).sort((a, b) => a - b)[0];   // with no time given, from the gavel (the recording starts well before it)
      S.targetWall = t != null ? t : (gavel != null ? gavel - 3000 : day.startMs);
      S.wallMs = S.targetWall;
      if (farFromAnchors(S.targetWall)) await Promise.race([probeAt(S.timeline.mediaFromWall(S.targetWall)), new Promise((r) => setTimeout(r, 9000))]);
      const startAt = Math.max(0, S.timeline.mediaFromWall(S.targetWall) - 2);
      S.startAt = startAt;
      resolveReady({ url: day.hls, startAt });
    } catch (e) {
      S.error = String(e && e.message || e);
      resolveReady(null);
    }
    S.loaded = true;
    emit();
    return S;
  }

  function parseT(v) {
    const m = /^(\d{1,2}):(\d\d)(?::(\d\d))?$/.exec(String(v || ''));
    return m ? R.etMs(`${ISO}T${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`) : null;
  }

  // what the viewer's tab holds for the video: given to lib/floor-feed.js by app.js
  S.floorFeedOpts = { replay: { ready: ready.then((r) => (r ? { url: r.url, startAt: r.startAt } : null)) } };

  // ---- the board's picture at a moment ----
  // The Clerk posts an entry a little after the words it records. A line the viewer CLICKED is shown even if the click lands on the words a few seconds before it was posted (it would
  // otherwise vanish from the log the moment it was clicked); this holds only while the moment is within four minutes before it.
  const itemsAt = (ms) => R.clip(S.items, S.pinTs && ms >= S.pinTs - 240000 && ms <= S.pinTs ? S.pinTs : ms);

  // the floor log as the board is given it: what had happened, and (to be greyed, and clicked to go there) what had not
  function feedAt(ms) {
    const items = itemsAt(ms), seen = new Set(items);
    return { items, future: S.items.filter((x) => !seen.has(x)) };
  }

  function stateAt(ms) {
    const clipped = itemsAt(ms);
    const last = clipped[0] && clipped[0].description || '';
    if (!clipped.length) return 'adjourned';
    if (/\badjourn/i.test(last)) return 'adjourned';
    if (/\brecess/i.test(last)) return /\bresum|reconven|convened/i.test(last) ? 'in-session' : 'recess';
    return 'in-session';
  }

  function floorAt(ms) {
    const st = stateAt(ms);
    const open = (S.votes || []).find((v) => ms >= v.open && ms < v.close);
    const now = open ? { text: 'Voting in progress', value: 'vote' } : st === 'adjourned' ? { text: 'House adjourned', value: 'house_not_in_session' } : st === 'recess' ? { text: 'House in recess', value: 'house_recess' } : { text: 'House in session', value: 'house_in_session' };
    const left = open ? Math.max(0, Math.round((open.close - ms) / 1000)) : 0;
    const timer = { seconds_remaining: left, timestamp: new RealDate(ms).toISOString(), value: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
    const out = { now, timer, fetchedAt: new RealDate(ms).toISOString(), timeline: {} };
    const shown = open ? open.r : S.rolls.filter((r) => r.ms <= ms).pop();   // the vote open now, else the last one finished
    if (shown) {
      const r = shown;
      const id = (String(r.legis || '').match(/\d+/) || [''])[0];
      const roll_call = { number: String(r.roll), question: `${r.legis} - ${r.question}`, bill: { id, number: id, title: r.desc || '' } };
      out.roll_call = roll_call;
      if (open) {
        // no tally exists for a vote in progress (only its result does): nothing is made up
        out.votes = { counts: { blue: {}, red: {}, white: {}, totals: {} }, roll_call, timer };
      } else {
        const p = (k) => { const x = r.parties && r.parties[k] || {}; return { yeas: String(x.yeas ?? ''), nays: String(x.nays ?? ''), present: String(x.present ?? ''), not_voting: String(x.notVoting ?? '') }; };
        out.votes = { counts: { blue: p('D'), red: p('R'), white: p('I'), totals: { yeas: String(r.totals.yeas), nays: String(r.totals.nays), present: String(r.totals.present || ''), not_voting: String(r.totals.notVoting) } }, roll_call, timer };
      }
    }
    return out;
  }

  // ---- the speaker, from the day's captions (a client-side run of the same code the Worker uses for today) ----
  async function buildSpeaker() {
    try {
      let tries = 0;
      while (!(window.HouseFloorSpeaker && window.HouseFloorSpeaker.resolveFloorSpeakers) && tries++ < 100) await new Promise((r) => setTimeout(r, 100));
      const H = window.HouseFloorSpeaker;
      const members = LOCAL ? await realFetch('dev/fixtures/base/member-data.json').then((r) => r.json()) : await remote('member-data');
      const roster = H.buildRoster(members.xmlData || '');
      if (!roster.length) return;
      const turns = H.splitTurns(S.cues.map((c) => ({ t: c.t, text: c.text })));
      const resolved = H.resolveFloorSpeakers(turns, roster, { limit: 5000 });
      S.speaker = { timeline: resolved.timeline || [], bindings: resolved.bindings, managers: resolved.managers };
      S.speakerBuilt = true;
      push(true);
    } catch (e) { S.speakerError = String(e && e.message || e); }
  }

  function speakerPayload(ms) {
    const sp = S.speaker;
    if (!sp) return { available: false, reason: 'not-yet', date: DATE, current: null, timeline: [] };
    const c = S.timeline.captionFromWall(ms);
    let cur = null;
    for (const e of sp.timeline) { if (e.t <= c) cur = e; else break; }
    const st = stateAt(ms);
    return { available: true, date: DATE, isLive: false, turns: sp.timeline.length, current: st === 'adjourned' ? null : cur, sessionState: st, managers: sp.managers, bindings: sp.bindings, timeline: [], captionAgeSeconds: 0 };
  }

  // ---- routes ----
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  // Everything below has no history to replay (it is the news of NOW): it is answered with nothing, and the board marks the panel as not available for the date.
  const NO_HISTORY = /^(bills|whip-|cold-start-bundle|congress-index|tweets|airport-delays|house-calendar|leadership|discharge-|pipeline|appropriations|roll-log|casualty-list|voting-days-source)/;

  function route(path, qs, input, init) {
    if (path === 'hls-url') return ready.then((r) => json({ url: r && r.url || null, isLive: false }));
    if (path === 'proceedings') {
      const d = qs.get('date');
      if (d && d !== MMDDYYYY) return realFetch(input, init);
      return ready.then(() => json(feedAt(S.wallMs)));
    }
    if (path === 'domewatch-floor') return ready.then(() => json(floorAt(S.wallMs)));
    if (path === 'floor-speaker') return ready.then(() => json(speakerPayload(S.wallMs)));
    if (path === 'house-rolls') return ready.then(() => json({ at: S.wallMs, date: MMDDYYYY, year: +DATE.slice(0, 4), rolls: S.rolls.filter((r) => r.ms <= S.wallMs) }));
    // the calendar knows this year's days only: a day the House sat is in session on the day's own evidence, whatever year it is
    if (path === 'voting-days' && !LOCAL) return Promise.all([realFetch(input, init).then((r) => (r.ok ? r.json() : {})).catch(() => ({})), ready]).then(([d]) => {
      const days = (d.votingDays || []).slice();
      if (S.items.length && !days.some((x) => x.date === ISO)) days.push({ date: ISO, summary: 'Vote Day' });
      return json({ ...d, votingDays: days, error: undefined });
    });
    if (path.startsWith('stream/')) return Promise.resolve(json({}));
    if (NO_HISTORY.test(path)) return Promise.resolve(json({}));
    if (LOCAL) return ['voting-days', 'member-data', 'committee-meetings'].includes(path) ? realFetch(`dev/fixtures/base/${path}.json`) : Promise.resolve(json({}));   // a local page can reach nothing else
    return realFetch(input, init);
  }

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const m = /\/house-floor\/api\/([^?#]*)(\?[^#]*)?/.exec(url);
    if (!m) return realFetch(input, init);
    return route(m[1], new URLSearchParams(m[2] || ''), input, init);
  };

  // ---- the stream the board listens to ----
  const streams = [];
  class ReplayStream {
    constructor(url) {
      this.url = url; this.readyState = 0; this.onopen = null; this.onerror = null; this.onmessage = null; this._l = {};
      streams.push(this);
      setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen({ type: 'open' }); this._emit('connected', { clientId: 'replay', rollLogCold: false, whipFeedCold: false }); push(true, this); }, 0);
    }
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
    removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); }
    close() { this.readyState = 2; const i = streams.indexOf(this); if (i >= 0) streams.splice(i, 1); }
    _emit(type, data) { for (const f of this._l[type] || []) { try { f({ type, data: JSON.stringify(data) }); } catch (e) { console.error(e); } } }
  }
  window.EventSource = function (url, opts) { return /\/stream\/votes\/current/.test(String(url)) ? new ReplayStream(url) : new RealES(url, opts); };
  window.EventSource.CONNECTING = 0; window.EventSource.OPEN = 1; window.EventSource.CLOSED = 2;

  // what has been pushed, so a quiet moment pushes nothing
  let pushed = '';
  function signature() {
    const c = itemsAt(S.wallMs);
    const done = S.rolls.filter((r) => r.ms <= S.wallMs);
    const open = (S.votes || []).find((v) => S.wallMs >= v.open && S.wallMs < v.close);
    return `${c.length}|${c[0] ? c[0].timestamp : 0}|${done.length}|${open ? open.roll : ''}|${S.pinTs || ''}`;
  }
  function push(force, only) {
    if (!S.loaded || !S.items.length) return;
    const sig = signature();
    if (!force && sig === pushed) return;
    pushed = sig;
    const feed = feedAt(S.wallMs);
    for (const s of only ? [only] : streams) { s._emit('proceedings', feed); s._emit('floor', floorAt(S.wallMs)); }
  }
  S.push = push;

  // ---- the video ----
  const emit = () => { for (const f of S.listeners) { try { f(S); } catch (e) { console.error(e); } } };
  S.on = (f) => { S.listeners.add(f); return () => S.listeners.delete(f); };

  function video() { return (window.FloorFeed && window.FloorFeed.replay && window.FloorFeed.replay.video) || null; }
  // `jump` moves the video; `seekMedia` is the viewer's own move, which also lets go of a clicked line
  const jump = (m) => {
    const v = video(); if (!v) return;
    S.synced = false;
    window.FloorFeed.replay.resetCaptions(m - 2);
    v.currentTime = Math.max(0, m);
  };
  S.seekMedia = (m) => { S.pinTs = null; jump(m); };
  S.seekWall = (ms, pinTs) => {
    S.targetWall = ms; S.wallMs = ms; S.syncing = true; S.attempts = 0; S.syncSince = performance.now();
    const m = S.timeline ? S.timeline.mediaFromWall(ms) : 0;
    jump(m);
    S.pinTs = pinTs || null;
    S.ensureAnchor(ms);
    push(true); emit();
  };
  S.play = () => { const v = video(); if (v) v.play().catch(() => {}); };
  S.pause = () => { const v = video(); if (v) v.pause(); };
  S.rate = (x) => { S.rateX = x; const v = video(); if (v) v.playbackRate = x; emit(); };
  S.duration = () => { const v = video(); return v && Number.isFinite(v.duration) ? v.duration : (S.day ? (S.day.endMs - S.day.assetStartMs) / 1000 : 0); };

  // Keep the board's moment on the video, and put a seek on the words it was meant to land on.
  function tick() {
    const v = video();
    if (!v || !S.timeline) return;
    S.playing = !v.paused && !v.ended;
    const quiet = !!(S.syncing && S.loaded);   // the sound of somewhere else is as much a lie as its picture
    if (quiet !== S.quiet) { S.quiet = quiet; try { v.volume = quiet ? 0 : 1; } catch { /* read-only on some phones */ } }
    // the video's own captions say where the caption file really sits at this spot
    const inband = window.FloorFeed.replay.inband();
    if (inband.length) {
      const a = R.anchorsFrom(inband, S.cues);
      if (a.length && a[0].n >= 2) {
        const before = S.timeline.anchors.length;
        S.timeline.addAnchors(a);
        if (S.timeline.anchors.length !== before) saveAnchors();
      }
    }
    // whatever the video is doing, the picture is never held back for more than twelve seconds (a slow connection, a stalled segment): it is shown as it is
    if (S.targetWall != null && S.syncing && performance.now() - (S.syncSince || (S.syncSince = performance.now())) > 12000) { S.syncing = false; S.synced = false; S.targetWall = null; }
    if (S.targetWall != null && S.syncing && !v.seeking && v.readyState >= 2) {
      // landed: is this where the words are? The anchors take a few seconds to appear (the video's captions have to arrive); once one is in reach of the target, go to where it says
      // the target is (at most three times); with none in reach once the read of the video's captions is over, carry on with the estimate.
      const cT = S.timeline.captionFromWall(S.targetWall);
      // an anchor within twenty minutes is trusted at once; once the read of the video's captions is over, the nearest within an hour is (the shift steps rarely, and a long recess has no speech to read)
      const near = S.timeline.anchors.some((x) => Math.abs(x.c - cT) < 1200) || (!S.probing && S.timeline.anchors.some((x) => Math.abs(x.c - cT) < 3600));
      const waited = performance.now() - (S.syncSince || (S.syncSince = performance.now()));
      if (near) {
        const want = S.timeline.mediaFromWall(S.targetWall);
        if (Math.abs(want - v.currentTime) > 4 && (S.attempts || 0) < 3) { S.attempts = (S.attempts || 0) + 1; S.syncSince = performance.now(); jump(want); }
        else { S.syncing = false; S.synced = true; S.targetWall = null; }
      } else if (!S.probing && waited > 3000 && performance.now() - (S.probeEnded || 0) > 1500) { S.syncing = false; S.synced = false; S.targetWall = null; }
    }
    if (!S.syncing || S.targetWall == null) S.wallMs = S.timeline.wallFromMedia(v.currentTime);
    push(false);
    emit();
  }
  function saveAnchors() { try { localStorage.setItem('replay-anchors:' + DATE, JSON.stringify(S.timeline.anchors)); } catch { /* full */ } }

  document.addEventListener('DOMContentLoaded', () => {
    setInterval(tick, 400);
    const bind = setInterval(() => {
      const v = video(); if (!v) return;
      clearInterval(bind);
      v.addEventListener('seeked', () => { window.FloorFeed.replay.resetCaptions(v.currentTime - 6); tick(); });
      v.addEventListener('play', () => { v.playbackRate = S.rateX; });
    }, 200);
    buildSpeaker();
  });

  // a background walk over the day with a hidden, lowest-quality player, reading where the caption file sits at several points; the viewer's own player is untouched
  S.calibrate = async function calibrate() {
    return;   // superseded by probeAt (a read on demand, near where the viewer is going), which needs no hidden players
    if (S.calibrating || !window.Hls || !S.day) return;
    S.calibrating = true;
    const dur = S.duration() || 40000;
    for (const f of [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92]) {
      const pos = dur * f;
      const near = S.timeline.anchors.some((a) => Math.abs(S.timeline.mediaFromCaption(a.c) - pos) < dur * 0.05);
      if (near) continue;
      try {
        const v = document.createElement('video'); v.muted = true; v.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px';
        document.body.appendChild(v);
        const h = new window.Hls({ startPosition: pos, startLevel: 0, maxBufferLength: 8, autoStartLoad: true });
        h.loadSource(S.day.hls); h.attachMedia(v);
        await new Promise((r) => setTimeout(r, 5500));
        const tr = [...v.textTracks][0]; if (tr) tr.mode = 'hidden';
        await new Promise((r) => setTimeout(r, 2500));
        const cues = tr && tr.cues ? [...tr.cues].map((c) => ({ t: c.startTime, text: c.text })) : [];
        h.destroy(); v.remove();
        const a = R.anchorsFrom(cues, S.cues);
        if (a.length && a[0].n >= 3) { S.timeline.addAnchors(a); saveAnchors(); emit(); }
      } catch { /* a missed point costs only accuracy there */ }
    }
    S.calibrating = false; S.calibrated = true; emit();
  };

  load();
})();
