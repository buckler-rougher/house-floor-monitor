// A reload comes back to the panel you were on. The browser's own restore runs before the panels have loaded, when the page is short, so it lands wherever that height allows
// (and the panels filling in afterwards move everything under it). This keeps the panel under a line near the top of the window and how far into it that line was, and after a
// reload puts the page back there, again as the panels grow, until the reader scrolls or touches the page. Only for a reload or back/forward, never a fresh visit or a #link.
(function (root) {
  const KEY = 'scroll-restore:' + location.pathname;
  const hdr = () => { const h = document.querySelector('.main-header'); return h ? h.getBoundingClientRect().bottom : 0; };
  const line = () => hdr() + 24;
  const panels = () => [...document.querySelectorAll('.main-display > [id]')].filter((e) => e.offsetParent !== null && getComputedStyle(e).position !== 'fixed' && e.getBoundingClientRect().height > 0);
  const store = (v) => { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private window */ } };
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } };

  function save() {
    const l = line();
    let hit = null;
    for (const e of panels()) { const r = e.getBoundingClientRect(); if (r.top <= l) hit = { id: e.id, off: Math.round(l - r.top) }; }
    store({ y: Math.round(root.scrollY), id: hit && hit.id, off: hit ? hit.off : 0 });
  }

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
  const saved = (nav.type === 'reload' || nav.type === 'back_forward') && !location.hash ? load() : null;

  let busy = false;
  const onScroll = () => { if (busy) return; busy = true; setTimeout(() => { busy = false; save(); }, 200); };
  root.addEventListener('scroll', onScroll, { passive: true });
  root.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

  if (!saved || (!saved.y && !saved.id)) return;
  let stop = false;
  const quit = () => { stop = true; };
  for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown']) root.addEventListener(ev, quit, { once: true, passive: true });
  const started = Date.now();
  const tick = () => {
    if (stop || Date.now() - started > 10000) return;
    const el = saved.id && document.getElementById(saved.id);
    const visible = el && el.offsetParent !== null && el.getBoundingClientRect().height > 0;
    const y = visible ? Math.max(0, el.getBoundingClientRect().top + root.scrollY + saved.off - line()) : (Date.now() - started > 6000 ? saved.y : null);
    if (y != null && Math.abs(root.scrollY - y) > 2) root.scrollTo(0, y);
    setTimeout(tick, 250);
  };
  tick();
})(globalThis);
