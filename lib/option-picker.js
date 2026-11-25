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
    A: { label: 'A  time column, newest lit', css: `
      #proceedings-feed .proceedings-item { padding: var(--sp-6) 0; border-bottom: 0; }
      #proceedings-feed .proceedings-text { display: grid; grid-template-columns: 8.25rem minmax(0, 1fr); column-gap: var(--sp-12); align-items: baseline; color: var(--text-secondary); }
      #proceedings-feed .proceedings-time { text-align: right; color: var(--text-muted); font-weight: 500; font-variant-numeric: tabular-nums; }
      #proceedings-feed .proceedings-item:first-child .proceedings-text { color: var(--text-primary); }
      #proceedings-feed .proceedings-item:first-child .proceedings-time { color: var(--accent-green); font-weight: 600; }
    ` },
    B: { label: 'B  timeline, sans text', css: `
      #proceedings-feed { padding-left: var(--sp-20); }
      #proceedings-feed .proceedings-item { position: relative; margin-left: 4px; padding: var(--sp-8) 0 var(--sp-8) var(--sp-20); border-bottom: 0; border-left: 1px solid var(--border-color); }
      #proceedings-feed .proceedings-item::before { content: ""; position: absolute; left: -4px; top: 14px; width: 7px; height: 7px; box-sizing: border-box; border-radius: 50%; background: var(--bg-card); border: 1px solid var(--text-muted); }
      #proceedings-feed .proceedings-item:first-child::before { background: var(--accent-green); border-color: var(--accent-green); box-shadow: 0 0 0 3px rgba(63, 185, 80, 0.18); }
      #proceedings-feed .proceedings-text { display: block; font-family: var(--font-sans); font-size: var(--fs-xl, 0.9375rem); line-height: 1.5; }
      #proceedings-feed .proceedings-time { display: block; margin-bottom: 2px; color: var(--text-muted); font-size: var(--fs-sm); }
      #proceedings-feed .proceedings-item:first-child .proceedings-time { color: var(--accent-green); }
    ` },
    C: { label: 'C  cards, time chip', css: `
      #proceedings-feed .proceedings-item { margin: 0 0 var(--sp-8); padding: var(--sp-8) var(--sp-12); border: 1px solid var(--border-color); border-radius: var(--radius-8); background: var(--bg-card); }
      #proceedings-feed .proceedings-item:last-child { border-bottom: 1px solid var(--border-color); margin-bottom: 0; }
      #proceedings-feed .proceedings-text { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-6); font-family: var(--font-sans); font-size: var(--fs-xl, 0.9375rem); line-height: 1.5; }
      #proceedings-feed .proceedings-time { padding: 1px var(--sp-8); border-radius: var(--radius-6); background: rgba(63, 185, 80, 0.12); }
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
