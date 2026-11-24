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
    A: { label: 'A  Columns', css: `
      #absentee-list .absentee-meta { display:grid; grid-template-columns:minmax(0,10.5rem) 1.8rem 3.7rem 2.9rem; justify-content:start; column-gap:var(--sp-8); row-gap:0; align-items:center; flex-wrap:nowrap; }
      #absentee-list .absentee-name { grid-column:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #absentee-list .absentee-party-tag { grid-column:2; justify-self:start; }
      #absentee-list .absentee-state { grid-column:3; }
      #absentee-list .absentee-streak { grid-column:4; justify-self:start; }
      #absentee-list .absentee-casualty-status { grid-column:1 / -1; font-size:var(--fs-xs); line-height:1.15; }` },
    B: { label: 'B  Badge on photo', css: `
      #absentee-list .absentee-member { position:relative; }
      #absentee-list .absentee-streak { position:absolute; left:15px; top:23px; z-index:2; padding:0 4px; border-radius:999px; background:var(--bg-card); border:1px solid currentColor; font-size:var(--fs-xs); line-height:1.35; }
      #absentee-list .absentee-streak .absentee-streak-ic { display:none; }` },
    C: { label: 'C  Name over details', css: `
      #absentee-list .absentee-meta { display:grid; grid-template-columns:1.8rem 3.7rem 2.9rem minmax(0,1fr); grid-template-areas:"name name name name" "party state streak status"; row-gap:1px; column-gap:var(--sp-8); align-items:center; flex-wrap:nowrap; }
      #absentee-list .absentee-name { grid-area:name; }
      #absentee-list .absentee-party-tag { grid-area:party; justify-self:start; }
      #absentee-list .absentee-state { grid-area:state; }
      #absentee-list .absentee-streak { grid-area:streak; justify-self:start; }
      #absentee-list .absentee-casualty-status { grid-area:status; font-size:var(--fs-xs); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #absentee-list .absentee-member { padding:var(--sp-6) 0; }` },
  };

  const KEY = 'option-picker';
  let cleanup = null;
  function start() {
    let mode = 'off';
    try { mode = localStorage.getItem(KEY) || Object.keys(OPTIONS)[1] || 'off'; } catch (e) {}
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
