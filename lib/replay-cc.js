// Reading the House video's own captions straight out of its segments, without playing them.
//
// The archive's video carries its captions in-band (CEA-608, inside each H.264 frame's SEI), in video time. Where the caption FILE (captions.vtt) sits against the video is not known
// ahead of time (see lib/replay.js), so the time machine reads a few segments around the moment asked for, matches the lines against the caption file, and so knows exactly where
// to seek. Doing it with fetch() and this parser takes a second or two; waiting for a player to buffer and report the same captions took up to fifteen.
//
//   ReplayCC.segmentCaptions(arrayBuffer)   one fMP4 segment -> { start (media seconds), text: [{ t, text }] }   the captions in it, one entry per roll-up line fragment
//   ReplayCC.lines(chunks)                  [{ t, text }] fragments from consecutive segments -> [{ t, text }] whole lines, `t` where each began
//   ReplayCC.rendition(playlistHead)        the first bytes of a rendition playlist -> its segment path ('h264/145000/segment_')
//   ReplayCC.lowest(master)                 a master playlist -> the URI of its smallest rendition
//   ReplayCC.playlist(text)                 a media playlist -> { map, segs: [{ t0, dur, uri, range }] } (the House's older days are one file cut by byte ranges, 6 s apiece)
//   ReplayCC.timescale(init)                an initialisation segment -> the video track's ticks per second
//
// What this does not do: pop-on and paint-on captions, the second caption channel, or accents (the House feed is roll-up in channel 1; an accented letter is matched as its plain one).

(function (root) {
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
  const tag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

  function boxes(b, from, to) {
    const out = [];
    let o = from;
    while (o + 8 <= to) {
      let size = u32(b, o); const type = tag(b, o + 4); let head = 8;
      if (size === 1) { size = u64(b, o + 8); head = 16; } else if (size === 0) size = to - o;
      if (size < head || o + size > to) break;
      out.push({ type, start: o + head, end: o + size, box: o });
      o += size;
    }
    return out;
  }

  // the SEI's emulation-prevention bytes (00 00 03) out
  function unescape(b, from, to) {
    const out = [];
    for (let i = from, z = 0; i < to; i++) {
      if (z >= 2 && b[i] === 3) { z = 0; continue; }
      out.push(b[i]);
      z = b[i] === 0 ? z + 1 : 0;
    }
    return out;
  }

  // the field-1 byte pairs of the A/53 caption data in one frame's NAL units
  function ccPairs(b, from, to) {
    const pairs = [];
    let o = from;
    while (o + 5 <= to) {
      const len = u32(b, o); const nal = b[o + 4] & 0x1f;
      if (len < 1 || o + 4 + len > to) break;
      if (nal === 6) {
        const r = unescape(b, o + 5, o + 4 + len);
        let i = 0;
        while (i + 2 < r.length) {
          let type = 0; while (r[i] === 0xff) { type += 255; i++; } type += r[i++];
          let size = 0; while (r[i] === 0xff) { size += 255; i++; } size += r[i++];
          if (type === 4 && size >= 10 && r[i] === 0xb5 && r[i + 3] === 0x47 && r[i + 4] === 0x41 && r[i + 5] === 0x39 && r[i + 6] === 0x34) {
            let k = i + 8; const count = r[k] & 0x1f; k += 2;
            for (let n = 0; n < count && k + 2 < i + size; n++, k += 3) if ((r[k] & 0x04) && (r[k] & 0x03) === 0) pairs.push([r[k + 1] & 0x7f, r[k + 2] & 0x7f]);
          }
          i += size;
          if (r[i] === 0x80) break;
        }
      }
      o += 4 + len;
    }
    return pairs;
  }

  // a roll-up decoder, enough for the text: printable pairs are letters, a carriage return ends a line, the rest of the control codes are skipped
  function decoder() {
    let line = '', t0 = null, last = null;
    const out = [];
    const flush = () => { const x = line.replace(/\s+/g, ' ').trim(); if (x) out.push({ t: t0, text: x }); line = ''; t0 = null; };
    return {
      feed(t, a, c) {
        if (a === 0 && c === 0) return;
        if (a >= 0x10 && a <= 0x1f) {
          const key = a * 256 + c;
          if (key === last) { last = null; return; }   // control codes are sent twice
          last = key;
          if (c >= 0x20 && c <= 0x7f) {
            if (a === 0x14 && c === 0x2d) flush();                                  // carriage return: the line rolls up
            else if (a === 0x14 && (c === 0x2c || c === 0x2f)) flush();             // erase display / end of caption
            else if (a === 0x11 && c >= 0x30 && c <= 0x3f) { if (c === 0x37) line += ' '; }   // special characters (the music note, etc.)
            else if ((a & 0x07) !== 4 && (a & 0x07) !== 5 && c >= 0x40) { if (line && !/ $/.test(line)) line += ' '; }   // a row change: a space between words
          }
          return;
        }
        last = null;
        for (const ch of [a, c]) if (ch >= 0x20) { if (t0 == null) t0 = t; line += String.fromCharCode(ch === 0x7f ? 0x20 : ch); }
      },
      end() { flush(); return out; },
    };
  }

  // one segment: when it starts, and the caption fragments in it with the time of the frame each came in
  function segmentCaptions(buf, timescale) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let start = null, scale = timescale || 30000;
    const res = [];
    const top = boxes(b, 0, b.length);
    for (let i = 0; i < top.length; i++) {
      const sidx = top[i].type === 'sidx' ? top[i] : null;
      if (sidx && !timescale) scale = u32(b, sidx.start + 8) || scale;
      if (top[i].type !== 'moof') continue;
      for (const traf of boxes(b, top[i].start, top[i].end).filter((x) => x.type === 'traf')) {
        let dflt = 0, base = 0, trun = null;
        for (const bx of boxes(b, traf.start, traf.end)) {
          if (bx.type === 'tfhd') { const fl = u32(b, bx.start) & 0xffffff; let p = bx.start + 8; if (fl & 1) p += 8; if (fl & 2) p += 4; if (fl & 8) dflt = u32(b, p); }
          else if (bx.type === 'tfdt') base = b[bx.start] === 1 ? u64(b, bx.start + 4) : u32(b, bx.start + 4);
          else if (bx.type === 'trun') trun = bx;
        }
        if (!trun) continue;
        const ver1 = b[trun.start] === 1;
        const fl = u32(b, trun.start) & 0xffffff; const n = u32(b, trun.start + 4);
        let p = trun.start + 8; let dataOff = 0;
        if (fl & 1) { dataOff = u32(b, p) | 0; p += 4; }
        if (fl & 4) p += 4;
        const mdat = top.find((x) => x.type === 'mdat' && x.start > top[i].start);
        let o = top[i].box + dataOff;
        if (!(fl & 1) && mdat) o = mdat.start;
        let tick = base;
        if (start == null) start = base / scale;
        // caption bytes ride in each frame in DECODE order; with B-frames that is not the order they are shown in, so they are put back in presentation order first
        const all = [];
        for (let s = 0; s < n; s++) {
          let dur = dflt, size = 0, cto = 0;
          if (fl & 0x100) { dur = u32(b, p); p += 4; }
          if (fl & 0x200) { size = u32(b, p); p += 4; }
          if (fl & 0x400) p += 4;
          if (fl & 0x800) { cto = ver1 ? (u32(b, p) | 0) : u32(b, p); p += 4; }
          for (const [x, y] of ccPairs(b, o, o + size)) all.push([(tick + cto) / scale, all.length, x, y]);
          o += size; tick += dur;
        }
        all.sort((m, k) => m[0] - k[0] || m[1] - k[1]);
        const dec = decoder();
        for (const [t, , x, y] of all) dec.feed(t, x, y);
        for (const x of dec.end()) res.push(x);
      }
    }
    return { start: start == null ? 0 : start, text: res };
  }

  // fragments of a line arrive across frames and segments (the decoder above ends a line only at a carriage return, so a segment holds whole lines except at its edges):
  // join a fragment that does not start a new line onto the last, when it follows it closely
  function lines(chunks) {
    return chunks.slice().sort((x, y) => x.t - y.t);
  }

  // the video track's timescale, from the initialisation segment's mdhd
  function timescale(init) {
    const b = init instanceof Uint8Array ? init : new Uint8Array(init);
    const dive = (from, to, path) => {
      for (const bx of boxes(b, from, to)) {
        if (bx.type === path[0]) { if (path.length === 1) return bx; const r = dive(bx.start, bx.end, path.slice(1)); if (r) return r; }
      }
      return null;
    };
    const m = dive(0, b.length, ['moov', 'trak', 'mdia', 'mdhd']);
    return m ? u32(b, m.start + (b[m.start] === 1 ? 20 : 12)) : null;
  }

  // a master playlist -> the URI of its smallest video rendition (the captions are in all of them)
  function lowest(master) {
    const lines = String(master || '').split(/\r?\n/);
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      const m = /^#EXT-X-STREAM-INF:.*?BANDWIDTH=(\d+)/.exec(lines[i]);
      if (m && lines[i + 1] && (!best || +m[1] < best.bw)) best = { bw: +m[1], uri: lines[i + 1].trim() };
    }
    return best ? best.uri : null;
  }

  // a media playlist -> { map: { uri, range }, segs: [{ t0, dur, uri, range }] } (a byte range is [offset, length], as the House's older days are one file cut up that way)
  function playlist(text) {
    const out = { map: null, segs: [] };
    let t = 0, dur = null, range = null, next = 0;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const l = raw.trim();
      let m;
      if ((m = /^#EXT-X-MAP:URI="([^"]+)"(?:,BYTERANGE="(\d+)@(\d+)")?/.exec(l))) out.map = { uri: m[1], range: m[2] ? [+m[3], +m[2]] : null };
      else if ((m = /^#EXTINF:([\d.]+)/.exec(l))) dur = parseFloat(m[1]);
      else if ((m = /^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/.exec(l))) { const o = m[2] != null ? +m[2] : next; range = [o, +m[1]]; next = o + +m[1]; }
      else if (l && l[0] !== '#' && dur != null) { out.segs.push({ t0: t, dur, uri: l, range }); t += dur; dur = null; range = null; }
    }
    return out;
  }

  function rendition(head) {
    const m = /URI="([^"]*?)init\.mp4"/.exec(String(head || ''));
    return m ? m[1] + 'segment_' : null;
  }

  root.ReplayCC = { segmentCaptions, lines, rendition, timescale, lowest, playlist };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ReplayCC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
