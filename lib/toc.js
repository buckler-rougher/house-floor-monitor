// The CONTENTS list both boards carry: a fixed list at the left of the page, the section in view in bold, the next one bold as it is scrolled to. Shown where the left margin has
// room for it (it takes the room there is, from 176px down to 132). Where there is less (a phone, a window under about 1200px) it becomes a strip of dots at the screen's edge, the
// section in view lit, that opens the same list on top of the page.
//
//   Toc.mount({ items: [{ id, label }], topLabel: () => string })   the first item is the top of the page (the live floor, today's, or the last sitting day's): its `id` is ignored
//   Toc.topLabel({ live, todayLabel, session })                    "Happening now" | "Today on the floor" | "Last sitting day"
//   Toc.thresholds(tops, offset, maxScroll, step)                  the scroll position at which each section becomes the current one (pure; test/toc.test.js)
//   Toc.activeIndex(scrollY, thresholds)                           the last section whose threshold has passed
//
// WHICH SECTION IS CURRENT. A section is current from the moment its top reaches a line a third of the way down the visible area (below the fixed header) until the next one's does. Two things break that at the end of the
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
    const listHtml = (withTitle = true) => `${withTitle ? '<div class="toc-title">Contents</div>' : ''}<ol class="toc-list">${items.map((it, i) => `<li data-i="${i}"><a href="#${it.id || ''}" data-i="${i}" data-label="${String(it.label || '').replace(/"/g, '&quot;')}"><span>${it.label || ''}</span></a></li>`).join('')}</ol>`;
    const nav = document.createElement('nav');
    nav.className = 'toc';
    nav.setAttribute('aria-label', 'Page contents');
    nav.hidden = true;
    nav.innerHTML = listHtml();
    // WHERE THE SIDE LIST DOES NOT FIT (a phone, a narrow window) there is a strip of small dots at the screen's edge, one for each section, the one in view larger and lit: where you are,
    // with no words. Tapping it opens the same list on top of the page, as a card; choosing an item (or tapping outside, or Escape) closes it.
    const mini = document.createElement('div');
    mini.className = 'toc-mini';
    mini.hidden = true;
    mini.innerHTML = `<button type="button" class="toc-dots" aria-haspopup="dialog" aria-expanded="false" aria-label="Contents">${items.map((_, i) => `<i class="toc-dot" data-i="${i}"></i>`).join('')}</button>`;
    const sheet = document.createElement('div');
    sheet.className = 'toc-sheet';
    sheet.hidden = true;
    sheet.innerHTML = `<div class="toc-backdrop"></div><nav class="toc-card" role="dialog" aria-label="Page contents"><div class="toc-title">Contents</div><div class="toc-card-scroll">${listHtml(false)}</div></nav>`;   // the title stays put; only the list scrolls
    document.body.appendChild(mini);
    document.body.appendChild(sheet);
    const dotsBtn = mini.querySelector('.toc-dots');
    const dots = [...mini.querySelectorAll('.toc-dot')];
    const card = sheet.querySelector('.toc-card');
    // a list longer than the screen (the Senate's sixteen on a phone) scrolls inside the card, with the board's fade along its bottom edge while there is more below (lib/scroll-fade.js);
    // the fade is a mask, so it is on the scroller inside the card, which keeps its border and shadow whole
    const scroller = card.querySelector('.toc-card-scroll');
    // The list sits in a rail with `position: sticky`, so it starts at the top of the panel column (under the congress banner), travels up with the page as it scrolls, and stops under the
    // fixed header, the browser doing the pinning (not a script moving it on every scroll).
    if (root.ScrollFade) { root.ScrollFade.watch(scroller); root.ScrollFade.watch(nav); }
    const rail = document.createElement('aside');
    rail.className = 'toc-rail';
    rail.hidden = true;
    rail.appendChild(nav);
    const lis = [...nav.querySelectorAll('li'), ...card.querySelectorAll('li')];
    const links = [...nav.querySelectorAll('a')];
    const sheetLinks = [...card.querySelectorAll('a')];
    const everyLink = () => [...links, ...sheetLinks];
    const els = items.map((it, i) => (i === 0 ? null : document.getElementById(it.id)));
    // The rail lives INSIDE the column the panels are in (absolutely positioned, the column's full height), so its top is wherever the panels start: under the congress banner however
    // tall that has grown (the banner fills in after the page loads; a script that measured it left the list in the old place until its next look, and it jumped), and it ends where
    // the panels end. Only its left edge and width are worked out, from the window's width.
    const host = (els.find(Boolean) || {}).parentElement || document.body;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.insertBefore(rail, host.firstChild);

    let locked = null, moving = false, moveTimer = null, active = -1, pending = false, lastLabel = '';
    const header = () => document.querySelector('header, .header');
    const offset = () => ((header() && header().getBoundingClientRect().bottom) || 0) + 24;   // where a clicked section is scrolled to, under the fixed header
    // WHERE A SECTION COUNTS AS CURRENT: a third of the way down the visible area, not at its very top. At the top a section only became current once its heading sat right under the
    // header, so the one before it stayed lit long after the next panel filled most of the screen. A third down is where the eye is: the panel there is the one being read.
    const line = () => { const h = (header() && header().getBoundingClientRect().bottom) || 0; return Math.round(h + (window.innerHeight - h) * 0.33); };
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
      rail.hidden = !fits;
      nav.hidden = !fits;
      if (fits) {
        const pinned = offset() - 4;   // where the list stops, under the fixed header
        const hostLeft = host.getBoundingClientRect().left;
        rail.style.left = (edge - hostLeft) + 'px'; rail.style.width = w + 'px';
        nav.style.top = pinned + 'px';
        nav.style.maxHeight = Math.max(120, window.innerHeight - pinned - 12) + 'px';   // a short window: the list scrolls within itself rather than run off the screen
      }
      return fits;
    }

    function update() {
      pending = false;
      const fits = layout();
      mini.hidden = fits;   // the dots stand in wherever the side list does not
      if (fits && !sheet.hidden) closeSheet(false);
      const idx = items.map((_, i) => i).filter(shown);
      const tops = idx.map((i) => (i === 0 ? 0 : absTop(els[i])));
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const th = thresholds(tops, line(), maxScroll, 48);
      let cur = locked != null && idx.includes(locked) ? locked : idx[activeIndex(window.scrollY, th)];
      // the top item's name follows the state of the floor
      const label = labelFn ? labelFn() : items[0].label;
      if (label !== lastLabel) { lastLabel = label; for (const a of [links[0], sheetLinks[0]]) { a.dataset.label = label; a.firstChild.textContent = label; } }
      lis.forEach((li, k) => { li.hidden = !shown(k % items.length); });
      dots.forEach((d, i) => { d.hidden = !shown(i); });
      if (cur !== active) {
        active = cur;
        const all = everyLink();
        all.forEach((a) => { const on = Number(a.dataset.i) === cur; a.classList.toggle('is-active', on); if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
        dots.forEach((d, i) => d.classList.toggle('is-active', i === cur));
        dotsBtn.setAttribute('aria-label', `Contents, now at ${items[cur] ? (cur === 0 ? lastLabel : items[cur].label) : ''}`);
        // keep the current item in view if the list is taller than the window
        if (fits) { const a = links[cur]; if (a) { const r = a.getBoundingClientRect(), nr = nav.getBoundingClientRect(); if (r.top < nr.top || r.bottom > window.innerHeight - 8) a.scrollIntoView({ block: 'nearest' }); } }
      }
    }
    // the card on top: opened by the dots, closed by a choice, a tap outside it, or Escape
    function openSheet() {
      sheet.hidden = false;
      dotsBtn.setAttribute('aria-expanded', 'true');
      const h = (header() && header().getBoundingClientRect().bottom) || 0;
      card.style.top = (h + 10) + 'px';
      // The list ends PART WAY THROUGH a row, never on a whole one: where the window is shorter than the list, the card's height is fitted so the last row showing is cut four fifths of the way
      // through and the next is under the fade (at 55% only a sliver of its text survived the fade on a phone, and it could not be seen). (Ending on a row left a band of empty space where the fade was, and nothing under it to say there is more.)
      scroller.style.maxHeight = '';
      const avail = Math.max(160, window.innerHeight - h - 26) - ((card.querySelector('.toc-title') || {}).offsetHeight || 0);
      const rows = sheetLinks.map((a) => a.closest('li')).filter((li) => li && !li.hidden);
      const rowH = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : 0;
      if (rowH > 0 && scroller.scrollHeight > avail) {
        const k = Math.max(1, Math.floor((avail - 0.8 * rowH) / rowH));
        scroller.style.maxHeight = Math.floor(k * rowH + 0.8 * rowH) + 'px';
      } else {
        scroller.style.maxHeight = Math.max(120, avail) + 'px';
      }
      const a = sheetLinks[active] || sheetLinks[0];
      if (a) { a.focus({ preventScroll: true }); a.scrollIntoView({ block: 'nearest' }); }
    }
    function closeSheet(refocus = true) {
      sheet.hidden = true;
      dotsBtn.setAttribute('aria-expanded', 'false');
      if (refocus) dotsBtn.focus({ preventScroll: true });
    }
    dotsBtn.addEventListener('click', () => (sheet.hidden ? openSheet() : closeSheet()));
    sheet.querySelector('.toc-backdrop').addEventListener('click', () => closeSheet());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
    // a frame normally, and a timer behind it in case none comes (a tab the browser has throttled stops them): the list must not be left hidden or out of date
    const schedule = () => { if (pending) return; pending = true; requestAnimationFrame(update); setTimeout(() => { if (pending) update(); }, 250); };

    const choose = (e) => {
      const a = e.target.closest && e.target.closest('a[data-i]');
      if (!a) return;
      e.preventDefault();   // not the hash: the board uses it for its modals
      if (!sheet.hidden) closeSheet(false);
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
    };
    nav.addEventListener('click', choose);
    card.addEventListener('click', choose);
    for (const ev of ['wheel', 'touchstart', 'keydown']) window.addEventListener(ev, () => { if (locked != null) { locked = null; moving = false; schedule(); } }, { passive: true });
    window.addEventListener('scroll', () => { if (locked != null && !moving) locked = null; schedule(); }, { passive: true });
    window.addEventListener('resize', schedule);
    setInterval(schedule, 1500);   // panels fill in and the floor changes state; positions are read live each time
    schedule();
  }

  root.Toc = { mount, thresholds, activeIndex, topLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Toc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
