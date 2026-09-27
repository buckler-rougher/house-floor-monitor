/**
 * Board animations, shared by the House and Senate boards.
 *
 * WHY THIS FILE EXISTS
 * The Senate board is the House page adapted, so it inherits the notice filter
 * drawer and the absentee list. It did not inherit the movement, because the
 * functions were in app.js and the Senate board does not load app.js: its
 * drawer snapped open and its filtered rows cut.
 *
 * These are the versions that survived several rewrites and each carries a
 * reason not to do the obvious thing -- the drawer pins the panel height
 * because animating in flow reflowed the page every frame, the reorder measures
 * before and after because innerHTML makes every card a new element, and the
 * absentee entry animation is gated behind a class so the list does not twitch
 * on every poll. Porting them by hand a second time would have lost that.
 *
 * DEPENDENCIES ARE INJECTED: init() takes the board's element map, so this file
 * knows nothing about either page's ids.
 *
 * LOADING
 * No `export` syntax, matching lib/bill-id.js: assigns to globalThis so a plain
 * <script> tag serves every consumer.
 */
(function (root) {
  'use strict';

  let _el = {};

  /** @param {object} elements the board's element map (needs absenteeList etc.) */
  function init(elements) { _el = elements || {}; }

  function hideAfterAnimation(el, fallbackMs = 320) {
      if (!el || el.hidden) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { el.hidden = true; return; }
      let done = false;
      const finish = (e) => {
          if (e && e.target !== el) return;   // a child's animation bubbling
          if (done) return;
          done = true;
          clearTimeout(timer);
          el.removeEventListener('animationend', finish);
          el.classList.remove('is-closing');
          el.hidden = true;
      };
      const timer = setTimeout(finish, fallbackMs);
      el.addEventListener('animationend', finish);
      el.classList.add('is-closing');
  }

  // Open and close the notice filter dropdown.
  //
  // It stays in normal flow, so it pushes the feed down rather than covering the
  // first notice. The cost of that is normally a page-wide reflow on every frame,
  // which was visibly choppy here. So the panel's height is pinned for as long as
  // the drawer is open: the panel is a flex column, the feed is the flexible
  // child, and the drawer's height therefore comes out of the feed rather than
  // out of the page. Nothing below the panel moves, and the reflow each frame is
  // confined to the panel's own subtree.
  //
  // The pin is cleared only once the drawer has closed again.
  const DRAWER_EASE = 'cubic-bezier(0.15, 0.83, 0.66, 1)';   // --ease-emphasis

  function openDrawer(el, ms = 200) {
      if (!el) return;
      const panel = el.closest('.whip-updates-panel');
      delete el.dataset.closing;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { el.hidden = false; return; }

      // Collapse the drawer first, then measure. renderWhipFilterDropdown clears
      // [hidden] before this runs, so measuring straight away reads a panel that
      // has ALREADY grown by the drawer's height and pins it at the wrong size.
      el.hidden = false;
      el.style.overflow = 'hidden';
      el.style.height = '0px';
      void el.offsetHeight;
      if (panel) panel.style.height = `${panel.getBoundingClientRect().height}px`;

      const target = el.scrollHeight;
      el.style.transition = `height ${ms}ms ${DRAWER_EASE}`;
      el.style.height = `${target}px`;

      let done = false;
      const clear = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          el.removeEventListener('transitionend', settle);
          // Height goes back to auto so the drawer can grow if the chip set
          // changes while it is open. The panel stays pinned until it closes.
          el.style.transition = el.style.height = el.style.overflow = '';
      };
      const timer = setTimeout(clear, ms + 120);
      const settle = (e) => { if (e.propertyName === 'height') clear(); };
      el.addEventListener('transitionend', settle);
  }

  function closeDrawer(el, ms = 160) {
      if (!el || el.hidden || el.dataset.closing === '1') return;
      const panel = el.closest('.whip-updates-panel');
      const unpin = () => { if (panel) panel.style.height = ''; };
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          el.hidden = true; unpin(); return;
      }
      el.dataset.closing = '1';
      el.style.overflow = 'hidden';
      el.style.height = `${el.getBoundingClientRect().height}px`;
      void el.offsetHeight;
      el.style.transition = `height ${ms}ms ease`;
      el.style.height = '0px';

      let done = false;
      const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          el.removeEventListener('transitionend', onEnd);
          el.style.transition = el.style.height = el.style.overflow = '';
          el.hidden = true;
          delete el.dataset.closing;
          unpin();
      };
      // Transitions do not run in a hidden tab, so transitionend would never
      // arrive and the drawer would sit open at height zero with the panel pinned.
      const timer = setTimeout(finish, ms + 120);
      const onEnd = (e) => { if (e.propertyName === 'height') finish(); };
      el.addEventListener('transitionend', onEnd);
  }

  // Re-sort the bills lists without the cards teleporting.
  //
  // Sorting rebuilds both lists with innerHTML, so the same bill is a brand new
  // element at a new position and the whole panel jumps. This measures every card
  // before the rebuild, measures again after, and plays each one from where it
  // used to be to where it now is. Cards that were not on screen before simply
  // fade in, which is what a tracked-filter toggle does.
  //
  // The wrapper is the thing that moves when there is one: a card can sit inside
  // .bill-card-wrap alongside its track button and any motion-to-recommit rows,
  // and animating the card alone would tear it away from them.
  function animateBillsReorder(render) {
      const lists = [_el.ruleBillsList, _el.suspensionBillsList].filter(Boolean);
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!lists.length || reduce) { render(); return; }

      const EASE = 'cubic-bezier(0.15, 0.83, 0.66, 1)';   // --ease-emphasis
      const movers = () => lists.flatMap(l => [...l.querySelectorAll('.bill-card[data-bill-id]')]
          .map(card => ({ id: card.dataset.billId, el: card.closest('.bill-card-wrap') || card })));

      const before = new Map();
      movers().forEach(({ id, el }) => before.set(id, el.getBoundingClientRect()));

      render();

      movers().forEach(({ id, el }) => {
          const prev = before.get(id);
          const now = el.getBoundingClientRect();
          if (!prev) {
              el.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }],
                         { duration: 200, easing: EASE });
              return;
          }
          const dx = prev.left - now.left, dy = prev.top - now.top;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
                     { duration: 320, easing: EASE });
      });
  }

  // Re-render the absentee list with the filter animation.
  //
  // The list is replaced wholesale on every poll, so the entry animation is gated
  // behind a class that only a filter click sets: animating on every render would
  // make the panel twitch every thirty seconds for no reason.
  //
  // Height is eased separately because filtering changes the row count, and
  // without it the whole panel below jumps the instant the class list changes.
  async function animateAbsenteeFilter(render) {
      const list = _el.absenteeList;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!list || reduce) { await render(); return; }

      const visible = () => [...list.querySelectorAll('.absentee-member')]
          .filter(el => el.offsetParent !== null);

      const before = list.getBoundingClientRect().height;
      const wasVisible = new Set(visible());
      list.querySelectorAll('.is-entering').forEach(el => el.classList.remove('is-entering'));
      // updateAbsenteeUI is async -- it awaits the Clerk member XML before it
      // writes any rows. Measuring without awaiting reads the old list, the two
      // heights come out equal, and the height transition never runs even though
      // the row count is about to change.
      await render();
      const after = list.getBoundingClientRect().height;

      // Only rows that just appeared animate. A row that was already on screen
      // stays put: re-animating it was the thing that made switching filters feel
      // like the whole panel was redrawing.
      void list.offsetWidth;
      visible().forEach((el, i) => {
          if (wasVisible.has(el)) return;
          el.style.setProperty('--stagger', i);
          el.classList.add('is-entering');
      });

      if (before > 0 && after > 0 && Math.abs(before - after) > 1) {
          list.style.height = `${before}px`;
          void list.offsetWidth;
          list.style.transition = 'height var(--dur-300) var(--ease-emphasis)';
          list.style.height = `${after}px`;
          const settle = (e) => {
              if (e.propertyName !== 'height') return;
              list.style.transition = '';
              list.style.height = '';
              list.removeEventListener('transitionend', settle);
          };
          list.addEventListener('transitionend', settle);
      }
      clearTimeout(animateAbsenteeFilter._t);
      animateAbsenteeFilter._t = setTimeout(() => {
          list.querySelectorAll('.is-entering').forEach(el => el.classList.remove('is-entering'));
      }, 600);
  }
  root.BoardAnimations = {
    init, hideAfterAnimation, openDrawer, closeDrawer,
    animateBillsReorder, animateAbsenteeFilter,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
