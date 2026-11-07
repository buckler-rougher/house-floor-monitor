// The welcome dialog: shown once, on a reader's first visit, and then kept shut in this browser. The close X, Escape, the backdrop and "Start exploring" all close it. It
// stays out of the way of a link that took someone straight to something (a bill, the signers list, a report, a replayed day), and where storage cannot be written (a private
// window) it simply shows again next visit.
(function () {
  const overlay = document.getElementById('welcome');
  if (!overlay) return;
  const KEY = 'welcome-closed';
  try { if (localStorage.getItem(KEY)) return; } catch { /* unreadable storage: show it */ }
  const q = new URLSearchParams(location.search);
  if (['bill', 'signers', 'report', 'replay', 'demo'].some((k) => q.has(k))) return;
  const card = overlay.querySelector('.welcome-card');
  let trap = null;

  function close() {
    overlay.hidden = true;
    document.removeEventListener('keydown', onKey, true);
    if (trap) trap.release();
    try { localStorage.setItem(KEY, '1'); } catch { /* it comes back next visit */ }
  }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

  function open() {
    overlay.hidden = false;
    document.addEventListener('keydown', onKey, true);
    if (window.FocusTrap) trap = window.FocusTrap.activate(card, { initial: '#welcome-go' });
  }
  document.getElementById('welcome-close').addEventListener('click', close);
  document.getElementById('welcome-go').addEventListener('click', close);
  document.getElementById('welcome-backdrop').addEventListener('click', close);
  setTimeout(open, 500);   // after the page has drawn, so it lands on something rather than on a blank screen
})();
