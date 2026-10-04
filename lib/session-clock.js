// "NEXT SESSION IN 2D 4H 12M 09S": the countdown to the chamber's next sitting.
//
// Both boards had this function, the same to the character, driven from a different
// source (the House reads the Clerk's proceedings, the Senate its own schedule). What
// differs is only where the target time comes from; the formatting is here.
//
//   SessionClock.format(date)          -> the text
//   SessionClock.show(node, date)      -> show or hide the node and set its text

(function (root) {
  'use strict';

  function format(target) {
    if (!(target instanceof Date) || Number.isNaN(target.getTime())) return '';
    const diffMs = target.getTime() - Date.now();
    if (diffMs <= 0) return 'NEXT SESSION: NOW';
    const total = Math.floor(diffMs / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const parts = [];
    if (days) parts.push(`${days}D`);
    if (hours) parts.push(`${hours}H`);
    if (mins || days || hours) parts.push(`${mins}M`);
    parts.push(`${String(secs).padStart(2, '0')}S`);
    return `NEXT SESSION IN ${parts.join(' ')}`;
  }

  // With no target the node is hidden: a countdown to nothing is worse than none.
  function show(node, target) {
    if (!node) return;
    if (!target) { node.style.display = 'none'; return; }
    node.style.display = 'inline-flex';
    node.textContent = format(target);
  }

  root.SessionClock = { format, show };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SessionClock;
})(typeof globalThis !== 'undefined' ? globalThis : this);
