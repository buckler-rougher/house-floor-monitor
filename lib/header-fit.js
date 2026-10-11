// The page's top padding follows the fixed header's real height. Under 640px the header is auto-height and wraps (the "next convenes" line, the clocks), so a fixed 108px
// left the first panel's top under it. Sets --header-h on <html>; the stylesheet uses it with the old number as fallback.
(function (root) {
  const h = document.querySelector('.main-header');
  if (!h) return;
  const set = () => document.documentElement.style.setProperty('--header-h', Math.ceil(h.getBoundingClientRect().height) + 'px');
  set();
  if (root.ResizeObserver) new root.ResizeObserver(set).observe(h);
  root.addEventListener('resize', set);
  setInterval(set, 1000);   // a throttled tab stops observer callbacks
})(globalThis);
