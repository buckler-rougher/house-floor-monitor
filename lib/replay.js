// The TIME MACHINE's clocks: how a position in the House's archived floor video, a line of its caption file and an entry in the Clerk's floor log refer to one moment.
// Shared by the Worker (which finds a day's archive) and the board (which plays it). Pure: no network, no DOM, no clock.
//
//   Replay.etMs('2026-09-16T09:00:00.000')            a wall-clock time written in Eastern -> UTC milliseconds
//   Replay.pickFiles(event)                            one /broadcastevents/<YYYYMMDD> record -> { name, startMs, endMs, assetName, hls, vtt, live } | null
//   Replay.parseVtt(text)                              a caption file -> [{ t, end, text }]  (t in seconds since the captions began)
//   Replay.anchorsFrom(inband, vttCues)                what the VIDEO's own captions say about where the caption file sits -> [{ c, shift, n }]
//   Replay.timeline({ startMs, vttCues, anchors })     the mapping object (below)
//   Replay.snap(vttCues, estC, test, windowS)          the caption line near an estimated time that best matches `test` -> cue | null
//   Replay.clip(items, wallMs)                         the Clerk's entries (newest first) that had happened by `wallMs`
//
// WHAT WAS MEASURED (14 October 2026, dev/replay-align.mjs and the video's own captions; see AGENTS.md "Time machine"):
//   * The Clerk's roll call minutes and the caption file agree if the caption file's zero is the broadcast event's startDate ("09:00:00"): the median of 17 days' differences
//     was +15 s, most days within two minutes. So wall-clock time = startDate + caption time.
//   * The caption file does NOT sit on the video at a fixed offset. Its own header ("NOTE CAPTIONS TIME OFFSET: 00:03:57.914") was wrong on both days checked, the asset name's
//     time is not it either, and within one day the offset STEPS (16 Sep 2026: 215.8 s at 20% and 50% of the day, 183.0 s at 80%). The video carries the captions in-band
//     (CEA-608, which hls.js exposes as a text track), and those cues are in video time, so each cue that also appears once in the caption file is an exact anchor.
//   So: video time = caption time + shift, with `shift` read from the anchors nearest in caption time, and the caption time maps to the wall clock by startDate.

(function (root) {
  const TZ = 'America/New_York';

  // ---- Eastern time ----
  const tzOffsetMin = (ms) => {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))) p[x.type] = x.value;
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000) / 60000;
  };
  function etMs(local) {
    const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?/.exec(String(local || ''));
    if (!m) return NaN;
    const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), Math.round(+('0.' + (m[7] || '0')) * 1000));
    let ms = base - tzOffsetMin(base) * 60000;
    ms = base - tzOffsetMin(ms) * 60000;   // once more: the first guess can sit on the other side of a clock change
    return ms;
  }

  // ---- the archive record ----
  // The API lists each asset several ways (DASH and HLS, two regions, the caption file twice). Take the east HLS and the east caption file, as the live player does.
  function pickFiles(event) {
    if (!event || !event.asset) return null;
    const files = event.asset.files || [];
    const east = (type) => files.filter((f) => String(f.type || '').toUpperCase() === type.toUpperCase() && f.url);
    const pick = (type) => { const l = east(type); return (l.find((f) => f.url.includes('/east/')) || l[0] || {}).url || null; };
    const hls = pick('HLS');
    const vtt = pick('WebVTT');
    if (!hls) return null;
    const asset = String(event.asset.name || '');
    const am = asset.match(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)/);
    return {
      name: String(event.name || ''),
      startMs: etMs(event.startDate), endMs: etMs(event.endDate),
      assetName: asset,
      assetStartMs: am ? etMs(`${am[1]}T${am[2]}:${am[3]}:${am[4]}`) : NaN,
      hls: hls.replace(/#.*$/, ''),
      vtt,
      live: String(event.isLiveBroadcast || '').toLowerCase() === 'true',
    };
  }

  // ---- captions ----
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^SPEAKER \d+:/, 'UNIDENTIFIED SPEAKER:').trim();
  function parseVtt(text) {
    const out = [];
    const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const re = /(?:(\d+):)?(\d\d):(\d\d(?:\.\d+)?) --> (?:(\d+):)?(\d\d):(\d\d(?:\.\d+)?)[^\n]*\n([\s\S]*?)(?=\n\n|\n*$)/g;
    for (const m of src.matchAll(re)) {
      const t = (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
      const end = (+(m[4] || 0)) * 3600 + (+m[5]) * 60 + parseFloat(m[6]);
      const text2 = norm(m[7]);
      if (text2) out.push({ t, end, text: text2 });
    }
    return out;
  }

  // ---- anchors: the video's own caption cues against the caption file ----
  // `inband` is [{ t (video seconds), text }] as the text track gives them. A roll-up caption line shows up in several cues as it scrolls; the earliest is when it first appeared.
  // A line is an anchor only if its text occurs ONCE in the caption file and is long enough not to be "YES." or "MR. SPEAKER."; the result is the median shift of those that agree,
  // so one stray match cannot move it.
  function anchorsFrom(inband, vttCues, opts) {
    const minLen = (opts && opts.minLen) || 22;
    const once = new Map();
    for (const c of vttCues) { if (c.text.length < minLen) continue; const a = once.get(c.text); if (a) a.push(c.t); else once.set(c.text, [c.t]); }
    const first = new Map();
    for (const c of inband || []) { const x = norm(c.text); if (x.length < minLen) continue; if (!first.has(x) || c.t < first.get(x)) first.set(x, c.t); }
    const pairs = [];
    for (const [x, t] of first) { const a = once.get(x); if (a && a.length === 1) pairs.push({ c: a[0], shift: t - a[0] }); }
    if (!pairs.length) return [];
    // cluster by shift (within 3 s), keep the biggest cluster: a few lines can be said twice a day and match the wrong place
    pairs.sort((a, b) => a.shift - b.shift);
    let best = [], cur = [];
    for (const p of pairs) { if (cur.length && p.shift - cur[0].shift > 3) { if (cur.length > best.length) best = cur; cur = []; } cur.push(p); }
    if (cur.length > best.length) best = cur;
    const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    return [{ c: med(best.map((p) => p.c)), shift: med(best.map((p) => p.shift)), n: best.length }];
  }

  // ---- the mapping ----
  // anchors: [{ c, shift, n }]. With none yet, `defaultShift` stands in (the caption file's NOTE offset is the House's own guess; it was off by 22 and 64 s on the two days measured).
  function timeline({ startMs, vttCues, anchors, defaultShift }) {
    const list = (anchors || []).slice().sort((a, b) => a.c - b.c);
    const self = {
      startMs, vttCues: vttCues || [], anchors: list,
      addAnchors(more) {
        for (const a of more || []) {
          const dup = list.findIndex((x) => Math.abs(x.c - a.c) < 20);   // the same place seen again: keep the better supported
          if (dup >= 0) { if ((a.n || 1) > (list[dup].n || 1)) list[dup] = a; } else list.push(a);
        }
        list.sort((a, b) => a.c - b.c);
        return self;
      },
      // the shift that applies at caption time c: the nearest anchor's (the offset steps, it does not drift, so interpolating would be wrong between steps)
      shiftAt(c) {
        if (!list.length) return defaultShift || 0;
        let best = list[0];
        for (const a of list) if (Math.abs(a.c - c) < Math.abs(best.c - c)) best = a;
        return best.shift;
      },
      mediaFromCaption(c) { return c + self.shiftAt(c); },
      captionFromMedia(m) { let c = m - self.shiftAt(m); c = m - self.shiftAt(c); return c; },
      wallFromCaption(c) { return startMs + c * 1000; },
      captionFromWall(ms) { return (ms - startMs) / 1000; },
      wallFromMedia(m) { return self.wallFromCaption(self.captionFromMedia(m)); },
      mediaFromWall(ms) { return self.mediaFromCaption(self.captionFromWall(ms)); },
      // how sure: no anchors, or the nearest one is more than twenty minutes of captions away
      uncertainAt(c) { return !list.length || Math.min(...list.map((a) => Math.abs(a.c - c))) > 1200; },
    };
    return self;
  }

  // The caption line nearest an estimated caption time that satisfies `test(text)`. Used to put a click on a Clerk entry ("On motion to suspend the rules and pass H.R. 7834") on the words
  // being said, since the Clerk's own minute can be a few minutes off. Nearest to the estimate wins; null when nothing in the window matches.
  function snap(vttCues, estC, test, windowS) {
    const w = windowS || 600;
    let best = null;
    for (const c of vttCues) {
      if (c.t < estC - w) continue;
      if (c.t > estC + w) break;
      if (!test(c.text)) continue;
      if (!best || Math.abs(c.t - estC) < Math.abs(best.t - estC)) best = c;
    }
    return best;
  }

  // The Clerk's floor entries come newest first with a `timestamp` (ms). What the board would have held at wall time `ms`.
  const clip = (items, ms) => (items || []).filter((x) => Number(x && x.timestamp) <= ms);

  root.Replay = { etMs, pickFiles, parseVtt, anchorsFrom, timeline, snap, clip, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Replay;
})(typeof globalThis !== 'undefined' ? globalThis : this);
