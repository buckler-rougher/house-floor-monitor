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

  // A link address that is safe to put in an href: http, https or mailto, or a relative address, and nothing else. A scheme is read the way a browser reads it (it drops tabs
  // and line breaks inside "javascript:"), so the address is parsed, not matched with a pattern. Anything else is '' (a link with no destination).
  const safeHref = (u) => {
    const raw = String(u ?? '').trim();
    if (!raw) return '';
    try { return ['http:', 'https:', 'mailto:'].includes(new URL(raw, 'https://relative.invalid/').protocol) ? raw : ''; } catch (_) { return ''; }
  };

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


  // The Monday of the week a moment falls in, in Eastern time, as YYYYMMDD: the key a bill's link-preview image is kept under (a bill is drawn again at most weekly; see handleOgImage). The same
  // function is written in functions/_middleware.js, which cannot load this file; test/seo-middleware.test.js holds them equal.
  function weekKey(date) {
    const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);   // 2026-11-17
    const [y, m, day] = ymd.split('-').map(Number);
    const mon = new Date(Date.UTC(y, m - 1, day));
    mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7));
    return `${mon.getUTCFullYear()}${String(mon.getUTCMonth() + 1).padStart(2, '0')}${String(mon.getUTCDate()).padStart(2, '0')}`;
  }


  // "One Hundred Nineteenth" for 119: the Clerk's own wording for a Congress's name (the member file gives it for the current one; a replayed day of an earlier Congress needs it made). 100 to 199;
  // anything else is "123rd"-style numerals, never a wrong word.
  const ORD_ONES = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'];
  const ORD_TEENS = ['Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth'];
  const CARD_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const ORD_TENS = ['', '', 'Twentieth', 'Thirtieth', 'Fortieth', 'Fiftieth', 'Sixtieth', 'Seventieth', 'Eightieth', 'Ninetieth'];
  function congressName(n) {
    n = Number(n);
    if (!Number.isInteger(n) || n < 100 || n > 199) return Number.isInteger(n) && n > 0 ? `${n}th Congress` : '';
    const r = n - 100;
    let w;
    if (r === 0) w = 'Hundredth';
    else if (r < 10) w = ORD_ONES[r];
    else if (r < 20) w = ORD_TEENS[r - 10];
    else if (r % 10 === 0) w = ORD_TENS[r / 10];
    else w = `${CARD_TENS[Math.floor(r / 10)]}-${ORD_ONES[r % 10]}`;
    return r === 0 ? 'One Hundredth Congress' : `One Hundred ${w} Congress`;
  }

  root.BoardUtil = { escapeHtml, safeHref, setIfChanged, MONTH_NAMES, MONTH_SHORT, DAY_NAMES, fmtDate, fmtDateLong, fmtIso, fmtIsoLong, weekKey, congressName };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BoardUtil;
})(typeof globalThis !== 'undefined' ? globalThis : this);
