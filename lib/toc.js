// The CONTENTS sidebar both boards carry: a fixed list at the left of the page, the section in view in bold, the next one bold as it is scrolled to. Shown where the left margin has
// room for it (it takes the room there is, from 176px down to 132), hidden where there is less: a window under about 1200px wide.
//
//   Toc.mount({ items: [{ id, label }], topLabel: () => string })   the first item is the top of the page (the live floor, today's, or the last sitting day's): its `id` is ignored
//   Toc.topLabel({ live, todayLabel, session })                    "Happening now" | "Today on the floor" | "Last sitting day"
//   Toc.thresholds(tops, offset, maxScroll, step)                  the scroll position at which each section becomes the current one (pure; test/toc.test.js)
//   Toc.activeIndex(scrollY, thresholds)                           the last section whose threshold has passed
//
// WHICH SECTION IS CURRENT. A section is current from the moment its top reaches a line just under the fixed header until the next one's does. Two things break that at the end of the
// page, and both are handled: the last panels are SHORT and the page has a footer below them, so the page runs out of scroll before their tops reach the line (the last one would never be
// current, and a short one before it would be skipped); so each of the last sections is given its own `step` pixels of the final scroll (the last is current at the very bottom, the one
// before it for the `step` pixels above that, and so on), and a section's threshold is the smaller of where its top reaches the line and that reserved stretch. A click on an item sets
// it current and keeps it so until the reader scrolls on their own (the first scroll after the click's own has ended: a wheel, a touch, a key, the scrollbar), because a short section
// scrolled to as far as it will go would otherwise lose to the one below.

(function (root) {
  function thresholds(tops, offset, maxScroll, step) {
    const n = tops.length;
    return tops.map((t, i) => Math.max(0, Math.min(t - offset, maxScroll - (n - 1 - i) * step)));
  }

  function activeIndex(scrollY, th) {
    let a = 0;
    for (let i = 0; i < th.length; i++) if (scrollY >= th[i] - 0.5) a = i;
    return a;
  }

  function topLabel({ live, todayLabel, session } = {}) {
    if (live) return 'Happening now';
    const t = String(todayLabel || '').toUpperCase();
    if (/LAST SITTING/.test(t)) return 'Last sitting day';
    if (/TODAY/.test(t)) return 'Today on the floor';
    return /IN SESSION/i.test(String(session || '')) ? 'Today on the floor' : 'Last sitting day';
  }

  function mount({ items, topLabel: labelFn, width = 176, minWidth = 132, gap = 20, edge = 12 }) {
    const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nav = document.createElement('nav');
    nav.className = 'toc';
    nav.setAttribute('aria-label', 'Page contents');
    nav.hidden = true;
    nav.innerHTML = `<div class="toc-title">Contents</div><ol class="toc-list">${items.map((it, i) => `<li data-i="${i}"><a href="#${it.id || ''}" data-i="${i}" data-label="${String(it.label || '').replace(/"/g, '&quot;')}"><span>${it.label || ''}</span></a></li>`).join('')}</ol>`;
    document.body.appendChild(nav);
    const lis = [...nav.querySelectorAll('li')];
    const links = [...nav.querySelectorAll('a')];

    let locked = null, moving = false, moveTimer = null, active = -1, pending = false, lastLabel = '';
    const header = () => document.querySelector('header, .header');
    const offset = () => ((header() && header().getBoundingClientRect().bottom) || 0) + 24;
    const els = items.map((it, i) => (i === 0 ? null : document.getElementById(it.id)));
    const shown = (i) => i === 0 || (els[i] && els[i].offsetParent !== null && els[i].getBoundingClientRect().height > 0);
    const absTop = (el) => el.getBoundingClientRect().top + window.scrollY;

    function layout() {
      // room for it: what lies between the screen's edge and the first panel, less a small margin and the gap, is the list's width, up to its full width and down to a narrowest
      // that still reads (labels are cut with an ellipsis). The panels sit 200px in from the edge on any window between 1200 and 1400px wide (the page's own side padding), so a
      // 13-inch laptop at 1280 or 1366 gets a 168px list; a wide window gets the full 176 and a margin to spare; under 1200 the panels are 80px in and there is no room.
      const anchor = els.find((e, i) => i > 0 && shown(i));
      const room = anchor ? anchor.getBoundingClientRect().left - edge - gap : -1;
      const w = Math.min(width, Math.floor(room));
      const fits = w >= minWidth;
      nav.hidden = !fits;
      if (fits) {
        // under the fixed header, and under the congress banner that spans the top of the page while it is in view: the list starts below it and rises as the page scrolls, until it docks
        const banner = document.querySelector('.congress-info');
        const top = Math.max(offset() + 8, banner ? banner.getBoundingClientRect().bottom + 16 : 0);
        nav.style.left = edge + 'px'; nav.style.width = w + 'px'; nav.style.top = top + 'px';
        nav.style.maxHeight = Math.max(120, window.innerHeight - top - 12) + 'px';   // a short window with the banner still in view: the list scrolls within itself rather than run off the screen
      }
      return fits;
    }

    function update() {
      pending = false;
      const fits = layout();
      if (!fits) return;
      const idx = items.map((_, i) => i).filter(shown);
      const tops = idx.map((i) => (i === 0 ? 0 : absTop(els[i])));
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const th = thresholds(tops, offset(), maxScroll, 48);
      let cur = locked != null && idx.includes(locked) ? locked : idx[activeIndex(window.scrollY, th)];
      // the top item's name follows the state of the floor
      const label = labelFn ? labelFn() : items[0].label;
      if (label !== lastLabel) { lastLabel = label; links[0].dataset.label = label; links[0].firstChild.textContent = label; }
      lis.forEach((li, i) => { li.hidden = !shown(i); });
      if (cur !== active) {
        active = cur;
        links.forEach((a, i) => { const on = i === cur; a.classList.toggle('is-active', on); if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
        // keep the current item in view if the list is taller than the window
        const a = links[cur];
        if (a) { const r = a.getBoundingClientRect(), nr = nav.getBoundingClientRect(); if (r.top < nr.top || r.bottom > window.innerHeight - 8) a.scrollIntoView({ block: 'nearest' }); }
      }
    }
    // a frame normally, and a timer behind it in case none comes (a tab the browser has throttled stops them): the list must not be left hidden or out of date
    const schedule = () => { if (pending) return; pending = true; requestAnimationFrame(update); setTimeout(() => { if (pending) update(); }, 250); };

    nav.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[data-i]');
      if (!a) return;
      e.preventDefault();   // not the hash: the board uses it for its modals
      const i = Number(a.dataset.i);
      locked = i;
      const y = i === 0 ? 0 : Math.max(0, absTop(els[i]) - offset());
      // the click's own scrolling does not release the hold; the first scroll after it ends does (the reader's, by wheel, touch, key, scrollbar or anything else)
      moving = true;
      clearTimeout(moveTimer);
      const done = () => { moving = false; };
      moveTimer = setTimeout(done, reduce() ? 80 : 1100);
      window.addEventListener('scrollend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(done, 60); }, { once: true });
      window.scrollTo({ top: y, behavior: reduce() ? 'auto' : 'smooth' });
      schedule();
    });
    for (const ev of ['wheel', 'touchstart', 'keydown']) window.addEventListener(ev, () => { if (locked != null) { locked = null; moving = false; schedule(); } }, { passive: true });
    window.addEventListener('scroll', () => { if (locked != null && !moving) locked = null; schedule(); }, { passive: true });
    window.addEventListener('resize', schedule);
    setInterval(schedule, 1500);   // panels fill in and the floor changes state; positions are read live each time
    schedule();
  }

  root.Toc = { mount, thresholds, activeIndex, topLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Toc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
