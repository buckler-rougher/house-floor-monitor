// OPTION PICKER: a temporary, staging-only switcher for showing the owner several visual treatments of ONE real part of the site, live, and letting them flip between them.
// The owner wants options shown on the ACTUAL page (real header, real icons, real sizes), never as a drawn mock-up and never described in words.
//
// HOW TO USE
//   1. Copy this file to lib/option-picker.js and fill in OPTIONS below (a label, and for each option the CSS it applies and, if it needs to, a setup(root) that edits the DOM).
//   2. Add <script src="lib/option-picker.js?v=1"></script> after lib/api-base.js in index.html and/or senate.html.
//   3. Ship to the staging sites only:  dev/ship.sh --staging "STAGING ONLY: <what> options (temporary)"
//      The picker does nothing on any other hostname, and it remembers the pick in localStorage.
//   4. When the owner approves one: build it into styles.css and the markup, DELETE lib/option-picker.js and its script tags, ship through the PR flow.
//   Bump ?v= on each staging push. The owner cannot see anything injected into the Browser pane: only what is deployed to staging.
(function () {
  'use strict';
  if (!/^(?:house|senate)-floor-staging\.evanhollander\.org$/.test(location.hostname)) return;

  const OPTIONS = {
    off: { label: 'Current', css: '' },
    A: { label: 'A  brighter header, rule under it', css: `
      #calendar-orders .calendar-card-head { padding-bottom: var(--sp-8); border-bottom: 1px solid var(--border-color); }
      #calendar-orders .calendar-card-title { color: var(--text-primary); font-size: var(--fs-md); }
      #calendar-orders .calendar-card-count { color: var(--text-muted); }
    ` },
    B: { label: 'B  items set in from an accent bar', css: `
      #calendar-orders .calendar-card-item { margin-left: var(--sp-4); padding-left: var(--sp-12); border-left: 2px solid var(--border-color); }
      #calendar-orders .calendar-card-item + .calendar-card-item { border-top: 0; }
      #calendar-orders .calendar-card-label { color: var(--text-primary); }
    ` },
    C: { label: 'C  header as a bar across the card top', css: `
      #calendar-orders .calendar-card-head { margin: calc(-1 * var(--sp-8)) calc(-1 * var(--sp-12)) var(--sp-4); padding: var(--sp-8) var(--sp-12); background: rgba(255, 255, 255, 0.045); border-bottom: 1px solid var(--border-color); border-radius: var(--radius-8) var(--radius-8) 0 0; }
      #calendar-orders .calendar-card-title { color: var(--text-primary); }
    ` },
  };

  const KEY = 'option-picker';
  let cleanup = null;
  function start() {
    let mode = 'off';
    try { mode = localStorage.getItem(KEY) || 'A'; } catch (e) {}
    if (!(mode in OPTIONS)) mode = 'off';
    const st = document.head.appendChild(document.createElement('style'));
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;display:flex;gap:6px;background:#000c;border:1px solid #fff3;border-radius:10px;padding:6px;max-width:96vw;flex-wrap:wrap;justify-content:center';
    const set = (k) => {
      if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
      mode = k; st.textContent = OPTIONS[k].css || '';
      if (OPTIONS[k].setup) cleanup = OPTIONS[k].setup(document) || null;
      try { localStorage.setItem(KEY, k); } catch (e) {}
      [...bar.children].forEach((c) => { c.style.background = c.dataset.k === k ? '#2f4a86' : '#1a2233'; });
    };
    Object.keys(OPTIONS).forEach((k) => {
      const b = document.createElement('button');
      b.dataset.k = k; b.textContent = OPTIONS[k].label;
      b.style.cssText = 'color:#fff;border:0;border-radius:7px;padding:7px 11px;cursor:pointer;font:12px system-ui;background:#1a2233';
      b.onclick = () => set(k);
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
    set(mode);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
