// Keyboard focus for a dialog: Tab and Shift+Tab cycle inside it while it is open, focus moves in when it opens, and goes back to what had it when it closes.
//
//   const t = FocusTrap.activate(dialogEl, { initial: '.close-button' });    initial: a selector or an element to focus first (default: the first focusable)
//   t.release();                                                               on close; focus returns to the element that had it when activate ran
//
// The cycling decision is `FocusTrap.next(items, active, shift)` (pure: which item should get focus, or null to let the browser carry on), so it can be tested without a page.
(function (root) {
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

  /** Which of `items` takes focus on this Tab press: wraps at either end, and pulls in focus that has strayed outside (not in `items`). null: nothing to do. */
  function next(items, active, shift) {
    if (!items || !items.length) return null;
    const i = items.indexOf(active);
    if (i === -1) return shift ? items[items.length - 1] : items[0];
    if (shift && i === 0) return items[items.length - 1];
    if (!shift && i === items.length - 1) return items[0];
    return null;
  }

  function activate(box, opts = {}) {
    const opener = document.activeElement;
    const items = () => [...box.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const to = next(items(), document.activeElement, e.shiftKey);
      if (to) { e.preventDefault(); to.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const first = typeof opts.initial === 'string' ? box.querySelector(opts.initial) : opts.initial;
    const start = first || items()[0];
    if (start && start.focus) start.focus();
    return {
      release(restore = true) {
        document.removeEventListener('keydown', onKey, true);
        if (restore && opener && opener.focus && document.contains(opener)) opener.focus();
      },
    };
  }

  root.FocusTrap = { activate, next, FOCUSABLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FocusTrap;
})(typeof globalThis !== 'undefined' ? globalThis : this);
