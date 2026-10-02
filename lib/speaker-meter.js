// The speaker level meter: the four bars beside the current speaker's name.
//
// Shared by both boards. The signals come from lib/floor-feed.js, which both
// load (window.__pipAudioLevel and window.__liveCaptionMeta). What the Senate
// lacked was the loop that draws them, which lived inside the House's app.js,
// so its bars were four static dots.
//
// Two sources, same animation.
//
// Real audio, where the browser allows it. Chromium does: captureStream() taps
// a muted element and an AudioContext will start without a gesture. Safari does
// not implement captureStream() on media elements at all, and Firefox restricts
// mozCaptureStream() for MSE-backed media, which is exactly what hls.js feeds
// the element, and neither will start an AudioContext unprompted. A real
// amplitude meter with no click is therefore impossible there, browser policy
// rather than something to engineer around.
//
// So elsewhere the bars follow the rate the CAPTIONS are arriving at. That is
// still the floor speaking, since the words appear as they are spoken; it is
// simply activity rather than volume. It moves while somebody is talking and
// settles flat when the floor goes quiet, which is what the meter is there to
// show.

(() => {
  const IDLE_H = 4.6, IDLE_Y = 9.7, MAX_H = 19, SAMPLE_MS = 80;

  // `row` is the speaker row, which is hidden until there is a speaker; the loop
  // does nothing while it is.
  function init(row, waveId = 'pip-speaker-wave') {
    const bars = document.getElementById(waveId);
    if (!row || !bars) return;

    const rects = [...bars.querySelectorAll('rect')];
    const history = new Array(rects.length).fill(0);
    let lastSample = 0, idled = true, lastChars = null, capEnv = 0;

    // Caption flow as a stand-in for loudness: characters arriving per sample,
    // with a decay so one line of captions reads as a pulse rather than a step.
    const captionLevel = () => {
      const meta = typeof window.__liveCaptionMeta === 'function' ? window.__liveCaptionMeta() : null;
      if (!meta || !meta.lastCueAt || Date.now() - meta.lastCueAt > 15000) return null;
      const delta = lastChars === null ? 0 : Math.max(0, meta.totalChars - lastChars);
      lastChars = meta.totalChars;
      capEnv = Math.max(capEnv * 0.82, Math.min(1, delta / 14));
      return capEnv;
    };

    const draw = () => {
      requestAnimationFrame(draw);
      if (document.hidden || row.hidden) return;
      const now = performance.now();
      if (now - lastSample < SAMPLE_MS) return;
      lastSample = now;

      const audio = typeof window.__pipAudioLevel === 'function' ? window.__pipAudioLevel() : null;
      const level = audio !== null ? audio : captionLevel();

      if (level === null) {
        // Settle flat once, then stop touching the DOM until signal returns.
        if (idled) return;
        idled = true;
        history.fill(0);
        for (const r of rects) { r.setAttribute('y', IDLE_Y); r.setAttribute('height', IDLE_H); }
        return;
      }
      idled = false;
      history.push(level); history.shift();
      for (let i = 0; i < rects.length; i++) {
        const h = IDLE_H + (MAX_H - IDLE_H) * history[i];
        rects[i].setAttribute('height', h.toFixed(2));
        rects[i].setAttribute('y', (12 - h / 2).toFixed(2));
      }
    };
    requestAnimationFrame(draw);
  }

  globalThis.SpeakerMeter = { init };
})();
