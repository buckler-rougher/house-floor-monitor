// A window (a modal, a drawer, the contents card) does not scroll the page behind it. A wheel or touch move over one is let through only when something inside it can
// scroll that way; otherwise it is stopped, so a list that has reached its end, or the header above it, does not pass the scroll to the page.
(function (root) {
  const SEL = '.dp-modal-overlay, .bill-modal-overlay, .info-popup-overlay, .vrec-overlay, .suggest-overlay, .suggest-drawer, .suggest-data-modal, .toc-sheet';
  const canScroll = (el, dir) => {
    if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY) || el.scrollHeight <= el.clientHeight + 1) return false;
    return dir < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  };
  function guard(e, dir) {
    if (!dir || !e.target || !e.target.closest) return;
    const win = e.target.closest(SEL);
    if (!win) return;
    for (let el = e.target; el && el !== win.parentElement; el = el.parentElement) if (canScroll(el, dir)) return;
    if (e.cancelable) e.preventDefault();
  }
  let y0 = 0;
  document.addEventListener('wheel', (e) => guard(e, Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : 0), { passive: false });
  document.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchmove', (e) => guard(e, y0 - e.touches[0].clientY), { passive: false });
})(globalThis);
