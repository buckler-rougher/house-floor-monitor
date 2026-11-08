// The page's top padding follows the fixed header's real height. Under 640px the header is auto-height and wraps (the "next convenes" line, the clocks), so a fixed 108px
// left the first panel's top under it. Sets --header-h on <html>; the stylesheet uses it with the old number as fallback.
(function (root) {
  // The narrow header (below 1120px) shows the date as a small label over the session status, and colours the status by what it says. Both boards write plain text into
  // #today-date ("Thursday, 03 Sep 2026") and #session-text ("IN SESSION"); this derives `data-short` ("Thu, 03 Sep") and `data-state` from it, for the stylesheet to use.
  const shortDate = (t) => { const m = /^([A-Za-z]{3})[A-Za-z]*,\s*(\d{1,2}\s+[A-Za-z]{3})/.exec(String(t || '').trim()); return m ? `${m[1]}, ${m[2]}` : ''; };
  const stateOf = (t) => { t = String(t || ''); return /^in session$/i.test(t.trim()) ? 'live' : /fly-?in/i.test(t) ? 'fly' : /pro.?forma/i.test(t) ? 'pro' : ''; };
  // the long statuses, short, for the narrow header's cell (a status that wrapped to two or three lines made the header grow)
  const SHORT = [[/^pro.?forma session$/i, 'PRO FORMA'], [/^out of session$/i, 'NO SESSION'], [/^session unknown$/i, 'UNKNOWN'], [/^session status unavailable$/i, 'UNAVAILABLE'], [/^checking session/i, 'CHECKING']];
  const shortStatus = (t) => { t = String(t || '').trim(); const h = SHORT.find(([re]) => re.test(t)); return h ? h[1] : ''; };
  root.HeaderFit = { shortDate, stateOf, shortStatus };

  const h = document.querySelector('.main-header');
  if (!h) return;
  const root_el = document.documentElement;
  const set = () => {
    const px = Math.ceil(h.getBoundingClientRect().height) + 'px';
    root_el.style.setProperty('--header-h', px);
    // the page's top padding keeps the full header's height while it is collapsed (a phone, scrolled): otherwise the content would jump up as the header folds
    if (!root_el.classList.contains('header-compact')) root_el.style.setProperty('--header-full-h', px);
  };
  set();
  // A phone folds the header to its brand row once the page is scrolled (the stylesheet decides what folds; this only says when). It unfolds near the top, with a gap between the two
  // thresholds so a scroll hovering at one of them does not flicker.
  const fold = () => {
    const y = root.scrollY || 0, on = root_el.classList.contains('header-compact');
    if (!on && y > 90) root_el.classList.add('header-compact');
    else if (on && y < 20) root_el.classList.remove('header-compact');
  };
  root.addEventListener('scroll', fold, { passive: true });
  fold();
  const label = () => {
    const d = document.getElementById('today-date'), st = document.getElementById('session-text');
    if (d) { const v = shortDate(d.textContent); if (v) d.dataset.short = v; else delete d.dataset.short; }
    if (st) { const v = stateOf(st.textContent); if (v) st.dataset.state = v; else delete st.dataset.state; }
    if (st) { const v = shortStatus(st.textContent); if (v) st.dataset.short = v; else delete st.dataset.short; }
    const nv = document.getElementById('next-votes');   // an empty line (a no-break space) must not take a row in the status cell
    if (nv) { if (nv.textContent.replace(/\u00a0/g, '').trim()) delete nv.dataset.empty; else nv.dataset.empty = '1'; }
  };
  label();
  for (const id of ['today-date', 'session-text', 'next-votes']) { const e = document.getElementById(id); if (e && root.MutationObserver) new root.MutationObserver(label).observe(e, { childList: true, characterData: true, subtree: true }); }
  if (root.ResizeObserver) new root.ResizeObserver(set).observe(h);
  root.addEventListener('resize', set);
  setInterval(set, 1000);   // a throttled tab stops observer callbacks
})(globalThis);
