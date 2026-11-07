// Quiet placeholders for the first moments of a visit. Before data arrive, the page is full of "--", a lone dash and "Loading...": raw stand-ins that read as broken. Each text-only element
// holding one is marked `is-pending`, and the stylesheet draws a soft shimmering bar in its place, the width of the placeholder and the height of its line, so nothing moves when
// the real text lands. The mark comes off the moment the element's text changes; anything still pending after MAX_MS gets its text back (a "--" that is the honest answer, like a
// source with no value, must not shimmer forever).
//
//   Placeholders.isPending(text)    pure: is this one of the stand-ins   (test/placeholders.test.js)
(function (root) {
  const PENDING = /^(--|—|loading\.\.\.)$/i;
  const MAX_MS = 8000;
  const isPending = (t) => PENDING.test(String(t == null ? '' : t).trim());

  function start() {
    if (typeof document === 'undefined') return;
    const marked = [];
    const observers = [];
    const clear = (el) => { el.classList.remove('is-pending'); el.style.removeProperty('--ph-w'); el.style.removeProperty('--ph-h'); el.style.removeProperty('--ph-lh'); };
    const candidates = document.querySelectorAll('span, p, h1, h2, h3, div');
    for (const el of candidates) {
      if (el.children.length || el.closest('.conn-dash, [hidden]') || !isPending(el.textContent)) continue;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize) || 12;
      const range = document.createRange();
      range.selectNodeContents(el);
      const w = range.getBoundingClientRect().width;
      el.style.setProperty('--ph-w', `${Math.max(w, fs * 2.2).toFixed(1)}px`);
      el.style.setProperty('--ph-h', `${(fs * 0.9).toFixed(1)}px`);
      el.style.setProperty('--ph-lh', `${el.getBoundingClientRect().height.toFixed(1)}px`);
      el.classList.add('is-pending');
      marked.push(el);
      const mo = new MutationObserver(() => { if (!isPending(el.textContent)) { clear(el); mo.disconnect(); } });
      mo.observe(el, { childList: true, characterData: true, subtree: true });
      observers.push(mo);
    }
    setTimeout(() => { observers.forEach((o) => o.disconnect()); marked.forEach(clear); }, MAX_MS);
  }

  root.Placeholders = { isPending };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Placeholders;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
