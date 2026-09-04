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
