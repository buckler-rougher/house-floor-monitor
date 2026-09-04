/**
 * Computed-style snapshotter — the baseline a CSS refactor is checked against.
 *
 * Deliberately NOT pixel screenshots. For this job a computed-style dump is
 * strictly better: it is deterministic, diffs as text, needs no headless browser
 * or image toolchain, and it answers the exact question a refactor raises — did
 * any element's resolved styling change? Pixel diffs would also flag antialiasing
 * and font-rasterisation noise that has nothing to do with the CSS.
 *
 * Usage — paste into the console on a harness page, or let snapshot-all.mjs drive it:
 *   __snapshot()            → object
 *   copy(JSON.stringify(__snapshot()))
 */
(function () {
  'use strict';

  // The properties a skin refactor can plausibly change. Kept to a fixed list
  // (rather than the whole ~340-property computed set) so diffs stay readable
  // and stable across browser versions.
  const PROPS = [
    'display', 'position', 'visibility', 'opacity', 'z-index', 'overflow',
    'width', 'height', 'padding', 'margin', 'gap',
    'flex-direction', 'align-items', 'justify-content',
    'grid-template-columns', 'grid-template-rows',
    'color', 'background-color', 'background-image',
    'border-width', 'border-style', 'border-color', 'border-radius',
    'box-shadow', 'outline-color',
    'font-family', 'font-size', 'font-weight', 'line-height',
    'letter-spacing', 'text-transform', 'text-align', 'text-decoration-line',
    'transform', 'transition-property', 'transition-duration',
  ];

  // Stable identity for an element: structural path + its classes. Class list is
  // sorted so DOM insertion order can't produce a spurious diff.
  function pathOf(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      const idx = n.parentElement
        ? [...n.parentElement.children].filter(c => c.tagName === n.tagName).indexOf(n) + 1
        : 1;
      parts.unshift(n.id ? `${tag}#${n.id}` : `${tag}:nth-of-type(${idx})`);
    }
    return parts.join('>');
  }

  /**
   * Await everything that can still move layout after `load`, so two captures of
   * the same page agree.
   *
   * Without this the baseline is flaky: several ceremonial modes (speaker,
   * admin-oath, joint-meeting, the certification modes) render an <img> whose
   * lookup the harness stubs out. Whether that image had resolved to its
   * broken-image state at capture time changes its box, and the change cascades
   * all the way up to <html>. Symptom is a different random handful of modes
   * "changing" on every run.
   */
  // Minimum age of the document before a capture is trusted. The frozen clock
  // pins every VALUE the app computes, but not WHEN its intervals fire: several
  // panels (the vote timer most visibly) toggle `display` on a 1s tick, so a
  // capture taken before the first tick disagrees with one taken after. Waiting
  // past a couple of ticks lets that state converge. The harness pins the mode
  // at ~1200ms, so this also guarantees capture happens after that.
  const MIN_AGE_MS = 3500;

  window.__ready = async function (timeoutMs = 10000) {
    const t0 = Date.now();
    try { await document.fonts.ready; } catch { /* older engines */ }
    const age = () => performance.now();
    if (age() < MIN_AGE_MS) await new Promise(r => setTimeout(r, MIN_AGE_MS - age()));
    const pending = () => [...document.images].filter(i => !i.complete);
    while (pending().length && Date.now() - t0 < timeoutMs) {
      await new Promise(r => setTimeout(r, 100));
    }
    // Wait for the DOM to stop growing. Images and a fixed delay are not enough:
    // the app builds most panels asynchronously as fixture data arrives, and
    // under load (several frames at once) that can take well past any fixed
    // timeout. Capturing early yields a half-built page — the tell is an element
    // count far below the steady-state one. Polling for a stable count is
    // app-agnostic and catches all of it.
    let last = -1, stable = 0;
    while (Date.now() - t0 < timeoutMs) {
      const n = document.getElementsByTagName('*').length;
      if (n === last) { if (++stable >= 3) break; } else { stable = 0; last = n; }
      await new Promise(r => setTimeout(r, 250));
    }

    // Flush pending style/layout. requestAnimationFrame is the natural hook but
    // it does NOT fire in a hidden or background document, so it must be raced
    // against a timer or this hangs whenever the page isn't visible.
    await new Promise(r => {
      let done = false;
      const fin = () => { if (!done) { done = true; r(); } };
      requestAnimationFrame(() => requestAnimationFrame(fin));
      setTimeout(fin, 50);
    });
    document.documentElement.getBoundingClientRect(); // force layout
    return { waitedMs: Date.now() - t0, images: document.images.length, unsettled: pending().length };
  };

  // Stable 32-bit FNV-1a. Not cryptographic — just needs to be deterministic
  // across runs so two captures of unchanged CSS produce identical digests.
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  /**
   * Compact form of __snapshot(): one hash per element instead of 37 property
   * values. A full snapshot of all 22 modes is several MB, which is impractical
   * to move around; digests are ~50 KB per mode and answer the only question a
   * deletion-only refactor asks — did anything change? When a mode's digest
   * moves, re-run __snapshot() on that mode alone to see what.
   */
  // Used-value geometry — the resolved px width/height and the bounding box.
  // These settle at slightly different moments depending on when async content
  // lands, so including them makes the digest flap on a random handful of modes
  // per run even with an untouched stylesheet. Excluded by default: any CSS
  // change that really moves layout must first change one of the INPUTS to
  // layout (display, padding, margin, border, font, …), all of which stay in
  // the digest. Pass {geometry:true} when geometry is the thing under test.
  // `margin` is in here because getComputedStyle resolves `margin:auto` to a
  // used pixel value (e.g. "0px 0px 0px 344.898px") that tracks sibling widths,
  // so it drifts for the same reason width/height do. The cost is that a
  // deliberate margin change won't show up in the style digest — check it with
  // {geometry:true}, or lean on the fact that a margin only changes if some rule
  // changed, which the source diff shows directly.
  const GEOMETRY = ['width', 'height', '_box', 'margin'];

  window.__digest = function (opts) {
    const geometry = !!(opts && opts.geometry);
    const snap = window.__snapshot();
    const els = {};
    for (const [path, rec] of Object.entries(snap.elements)) {
      let r = rec;
      if (!geometry) { r = { ...rec }; for (const g of GEOMETRY) delete r[g]; }
      els[path] = hash(JSON.stringify(r));
    }
    return {
      mode: snap.mode, count: snap.count, viewport: snap.viewport, geometry,
      all: hash(JSON.stringify(els)),
      elements: els,
    };
  };

  window.__snapshot = function () {
    const out = {};
    for (const el of document.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta') continue;
      const cs = getComputedStyle(el);
      const rec = { class: [...el.classList].sort().join(' ') };
      for (const p of PROPS) rec[p] = cs.getPropertyValue(p);
      // Box geometry catches layout shifts that computed styles alone can miss
      // (e.g. a flex child resizing because a sibling's padding changed).
      const r = el.getBoundingClientRect();
      rec._box = [Math.round(r.width), Math.round(r.height)].join('x');
      out[pathOf(el)] = rec;
    }
    return {
      mode: document.documentElement.dataset.harnessMode || null,
      url: location.search,
      viewport: [innerWidth, innerHeight].join('x'),
      count: Object.keys(out).length,
      elements: out,
    };
  };
})();
