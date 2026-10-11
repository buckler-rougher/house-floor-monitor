// Small helpers both boards need, written once.
//
// Each of these was written out in app.js AND senate.js, and the copies had drifted: the
// House's escapeHtml leaned on the DOM and left quotes alone, so a `"` in a name could end an
// attribute like alt="..." early; the Senate's escapes them. This is the Senate's, which is
// the safe one for both text and attributes.
//
//   const { escapeHtml, setIfChanged, MONTH_NAMES, DAY_NAMES, fmtDate, fmtDateLong, fmtIso, fmtIsoLong } = globalThis.BoardUtil;

(function (root) {
  'use strict';

  // For building HTML strings. null and undefined become the empty string, so a missing
  // field prints nothing rather than the word "undefined".
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Set a node's HTML only if it is not already that HTML. Most renders are the same as the
  // last one, and rewriting identical markup restarts animations, drops hover and scroll
  // state, and makes every photo in it load again.
  const _htmlCache = new WeakMap();
  function setIfChanged(node, html) {
    if (!node) return;
    if (_htmlCache.get(node) === html) return;
    _htmlCache.set(node, html);
    node.innerHTML = html;
  }

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));   // dates are shown with these, so they are all one length
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Day-first with a short month, the board's one date format: "02 May 2026", "26 Sep 2026", and
  // "Saturday, 26 Sep 2026" for the long form (the month is short everywhere so dates line up).
  const fmtDate = (d) => `${String(d.getDate()).padStart(2, '0')} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  const fmtDateLong = (d) => `${DAY_NAMES[d.getDay()]}, ${fmtDate(d)}`;

  // The same two formats from an ISO date string ("2026-09-30", or a longer ISO stamp: the day is read from its first ten characters, in no time zone):
  // "30 Sep 2026" and "Wednesday, 30 Sep 2026". Anything that is not a date gives ''.
  const isoDay = (iso) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(iso || '')); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null; };
  const fmtIso = (iso) => { const d = isoDay(iso); return d ? fmtDate(d) : ''; };
  const fmtIsoLong = (iso) => { const d = isoDay(iso); return d ? fmtDateLong(d) : ''; };

  // A window reopened by a reload focuses its ✕ as a click would, but a script's focus on a fresh page counts as keyboard focus and lights it. The window is marked `data-quiet`, which the
  // stylesheet uses to keep the ✕ unlit, until the reader presses a key or moves the pointer.
  root.QuietFocus = (el) => {
    el.dataset.quiet = '1';
    const off = () => { delete el.dataset.quiet; document.removeEventListener('keydown', off, true); document.removeEventListener('pointermove', off, true); };
    document.addEventListener('keydown', off, true); document.addEventListener('pointermove', off, true);
  };

  root.BoardUtil = { escapeHtml, setIfChanged, MONTH_NAMES, MONTH_SHORT, DAY_NAMES, fmtDate, fmtDateLong, fmtIso, fmtIsoLong };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BoardUtil;
})(typeof globalThis !== 'undefined' ? globalThis : this);
