/**
 * Does swapping one stylesheet for another change anything on this page?
 *
 * Paste into the console on a harness page, or load it (the Senate checks do):
 *
 *   await __cssCompare('/styles.senate.css')   // -> { elements, same, diffs: [...] }
 *
 * It digests EVERY element's complete computed style (all ~350 properties, not a hand-picked
 * list), its ::before and ::after, and its box, with the page's current stylesheet; swaps the
 * stylesheet link for the one given; digests again; and reports every element and property that
 * differs. Same page, same moment, same DOM: the only variable is the CSS. Run it on each state
 * of the harness (dev/senate-harness.js ?state=...) and at each width that has its own media query.
 */
(function () {
  const digest = () => {
    // A running animation is a different opacity every instant. Pin each at its start so the
    // digest sees the same value under both stylesheets; the animation's own properties
    // (name, duration) are still compared.
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = 0; }
    const out = new Map();
    const path = (el) => {
      const p = [];
      for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
        const i = n.parentElement ? [...n.parentElement.children].indexOf(n) : 0;
        p.push(`${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}[${i}]`);
      }
      return p.reverse().join('>');
    };
    const props = (cs) => { const o = {}; for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]); return o; };
    const pseudo = (el, which) => {
      const cs = getComputedStyle(el, which);
      return cs.content === 'none' || cs.content === 'normal' ? { content: 'none' } : props(cs);
    };
    for (const el of document.body.querySelectorAll('*')) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      const r = el.getBoundingClientRect();
      out.set(path(el), {
        self: props(getComputedStyle(el)),
        // A pseudo-element only has a style worth reading when it generates content.
        before: pseudo(el, '::before'),
        after: pseudo(el, '::after'),
        box: [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10].join(','),
      });
    }
    return out;
  };

  const swap = (href) => new Promise((resolve) => {
    const link = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => /styles(\.\w+)?\.css/.test(l.href));
    const next = document.createElement('link');
    next.rel = 'stylesheet';
    next.href = href + (href.includes('?') ? '&' : '?') + 'cmp=' + Date.now();
    // A timer, not requestAnimationFrame: rAF never fires in a hidden pane or tab.
    next.onload = next.onerror = () => { link.remove(); setTimeout(resolve, 150); };
    link.after(next);
  });

  window.__cssDigest = digest;
  // Two calls, for a runner that times a single call out: __cssBegin() digests the page as it is;
  // __cssFinish(href) swaps the stylesheet, digests again and compares.
  window.__cssBegin = async function () { await new Promise((r) => setTimeout(r, 400)); window.__cssA = digest(); return window.__cssA.size; };
  window.__cssFinish = async function (altHref) { return compareTo(window.__cssA, altHref); };
  window.__cssCompare = async function (altHref) {
    await window.__cssBegin();
    return compareTo(window.__cssA, altHref);
  };
  async function compareTo(a, altHref) {
    const settle = () => new Promise((r) => setTimeout(r, 400));
    await swap(altHref);
    await settle();
    const b = digest();
    const diffs = [];
    for (const [k, va] of a) {
      const vb = b.get(k);
      if (!vb) { diffs.push({ at: k, problem: 'element gone' }); continue; }
      for (const part of ['self', 'before', 'after']) {
        for (const p of Object.keys(va[part])) if (va[part][p] !== vb[part][p]) diffs.push({ at: k, part, prop: p, was: va[part][p], now: vb[part][p] });
      }
      if (va.box !== vb.box) diffs.push({ at: k, part: 'box', was: va.box, now: vb.box });
    }
    for (const k of b.keys()) if (!a.has(k)) diffs.push({ at: k, problem: 'element new' });
    return { elements: a.size, same: diffs.length === 0, diffs: diffs.length, first: diffs.slice(0, 12) };
  }
})();
