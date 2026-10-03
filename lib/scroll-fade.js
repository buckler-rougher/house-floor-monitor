// The fade at the bottom of a scrolling list, and its removal at the end.
//
// A list that scrolls and gives no sign of it reads as a list that is all there is, so
// each is faded out along its bottom edge to say there is more. Scrolled to the end, or
// not long enough to scroll at all, there is nothing more to hint at, so the fade goes:
// a fade over empty space suggests rows that are not there.
//
// The class that does the fading is `scroll-fade` (or the Senate's older `list-scroll`);
// this module only decides when it is `is-at-end`. It watches for the three things that
// change the answer, so a caller does not have to remember to ask after every render:
// scrolling, the content being replaced (every feed here rebuilds with innerHTML), and the
// list being resized. It used to be a function in senate.js that each render had to call.
//
//   ScrollFade.watch(document.getElementById('proceedings-feed'))

(() => {
  function check(node) {
    node.classList.toggle('is-at-end', node.scrollTop + node.clientHeight >= node.scrollHeight - 2);
  }

  // Safe to call again on the same node: it re-checks, and wires itself up only once. (A
  // version that returned early on a node it had seen decided the fade by whatever the list
  // held on its first render, so a list that later held one card kept a fade over empty
  // space and one that grew lost the fade it needed.)
  function watch(node) {
    if (!node) return;
    if (!node.classList.contains('list-scroll')) node.classList.add('scroll-fade');
    if (!node.dataset.fadeWatched) {
      node.dataset.fadeWatched = '1';
      node.addEventListener('scroll', () => check(node), { passive: true });
      if (typeof MutationObserver !== 'undefined') new MutationObserver(() => check(node)).observe(node, { childList: true, subtree: true });
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => check(node)).observe(node);
    }
    check(node);
  }

  globalThis.ScrollFade = { watch };
})();
