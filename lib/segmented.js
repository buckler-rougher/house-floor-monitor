// The two kinds of segmented control (the row of small buttons, `.bills-sort-btn`: they look the same and must not behave the same):
//
//   SORT    picks how a list is ordered. One option is always on, so choosing the one already chosen changes nothing, however often it is pressed.
//   FILTER  picks which rows show, and "All" is the way back. Choosing an option that is already on (other than All) turns it off and goes back to All.
//
//   Segmented.next('sort' | 'filter', current, clicked, all = 'all')  ->  the value after the click
//
// One function so every control in both boards means the same by a repeated press (test/segmented.test.js).

(function (root) {
  function next(kind, current, clicked, all = 'all') {
    if (kind === 'filter' && clicked !== all && clicked === current) return all;
    return clicked;
  }
  root.Segmented = { next };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Segmented;
})(typeof globalThis !== 'undefined' ? globalThis : this);
