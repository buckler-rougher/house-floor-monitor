// OPTION PICKER (staging only, temporary): two independent groups, the demo prompt and the two top panels. Remembers picks in localStorage.
(function () {
  'use strict';
  if (!/^(?:house|senate)-floor-staging\.evanhollander\.org$/.test(location.hostname)) return;

  const PLAY = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true" style="vertical-align:-2px"><path d="M8 5v14l11-7z"/></svg>';
  const demoSetup = (html) => (doc) => {
    const a = doc.getElementById('session-demo-prompt'); if (!a) return null;
    const orig = a.innerHTML; a.innerHTML = html; a.dataset.pick = '1';
    return () => { a.innerHTML = orig; delete a.dataset.pick; };
  };
  const NOTE = "The House isn't in session";

  const GROUPS = {
    demo: {
      title: 'Demo prompt',
      options: {
        off: { label: 'Current', css: '' },
        A: { label: 'A  Pill', css: `
          #session-demo-prompt[data-pick] { display:flex; flex-direction:column; align-items:center; gap:5px; border:0; margin-top:var(--sp-8); }
          #session-demo-prompt .dm-note { font-size:var(--fs-xs); color:var(--text-muted); letter-spacing:var(--track-wide); text-transform:uppercase; font-family:var(--font-mono); }
          #session-demo-prompt .dm-btn { display:inline-flex; align-items:center; gap:5px; padding:3px 11px; border-radius:999px; border:1px solid color-mix(in srgb,var(--accent-green) 55%,transparent); color:var(--text-primary); background:color-mix(in srgb,var(--accent-green) 10%,var(--bg-elevated)); font-size:var(--fs-sm); font-weight:600; transition:box-shadow .2s, transform .2s; }
          #session-demo-prompt:hover .dm-btn { box-shadow:0 0 14px rgba(63,185,80,.3); transform:translateY(-1px); }
          #session-demo-prompt .dm-btn svg { color:var(--accent-green); }`,
          setup: demoSetup(`<span class="dm-note">${NOTE}</span><span class="dm-btn">${PLAY}See a demo</span>`) },
        B: { label: 'B  Capsule', css: `
          #session-demo-prompt[data-pick] { display:inline-flex; align-items:stretch; border:1px solid var(--border-color); border-radius:var(--radius-8); background:var(--bg-elevated); overflow:hidden; margin-top:var(--sp-10); text-decoration:none; transition:border-color .2s; }
          #session-demo-prompt:hover { border-color:var(--accent-blue); }
          #session-demo-prompt .dm-note { padding:7px 12px; font-size:var(--fs-sm); color:var(--text-muted); letter-spacing:var(--track-wide); text-transform:uppercase; font-family:var(--font-mono); border-right:1px solid var(--border-color); display:flex; align-items:center; }
          #session-demo-prompt .dm-btn { padding:7px 14px; font-size:var(--fs-base); font-weight:600; color:var(--accent-blue); display:flex; align-items:center; gap:6px; transition:background .2s; }
          #session-demo-prompt:hover .dm-btn { background:color-mix(in srgb,var(--accent-blue) 14%,transparent); }`,
          setup: demoSetup(`<span class="dm-note">${NOTE}</span><span class="dm-btn">${PLAY}See a demo</span>`) },
        C: { label: 'C  Solid', css: `
          #session-demo-prompt[data-pick] { display:flex; flex-direction:column; align-items:center; gap:9px; border:0; margin-top:var(--sp-10); }
          #session-demo-prompt .dm-note { font-size:var(--fs-sm); color:var(--text-muted); }
          #session-demo-prompt .dm-btn { display:inline-flex; align-items:center; gap:8px; padding:9px 20px; border-radius:var(--radius-8); background:var(--accent-blue); color:#06101f; font-size:var(--fs-lg); font-weight:700; letter-spacing:.01em; transition:filter .2s, transform .2s; }
          #session-demo-prompt:hover .dm-btn { filter:brightness(1.12); transform:translateY(-1px); }`,
          setup: demoSetup(`<span class="dm-note">${NOTE}. Watch a past day play out.</span><span class="dm-btn">${PLAY}See a demo</span>`) },
      },
    },
    panels: {
      title: 'Top panels',
      options: {
        off: { label: 'Current', css: '' },
        P1: { label: 'P1  Timeline', css: `
          #today-house-body { display:grid; grid-template-columns:repeat(3,1fr); }
          #today-house-body .today-row { display:flex; flex-direction:column; gap:6px; padding:14px 22px; border-left:1px solid var(--border-color); }
          #today-house-body .today-row:first-child { border-left:0; }
          #today-house-body .today-label { font-size:var(--fs-xs); letter-spacing:var(--track-wider); color:var(--text-muted); width:auto; }
          #today-house-body .today-value { font-size:var(--fs-lg); color:var(--text-secondary); }
          #today-house-body .today-time { display:block; font-size:var(--fs-5xl); font-weight:600; font-family:var(--font-mono); color:var(--accent-green); margin-bottom:2px; } `},
        P2: { label: 'P2  Ledger', css: `
          #today-house-body { padding:6px 0; }
          #today-house-body .today-row { display:grid; grid-template-columns:130px 1fr; align-items:baseline; padding:9px 22px; }
          #today-house-body .today-row + .today-row { border-top:1px dashed var(--border-color); }
          #today-house-body .today-label { color:var(--text-muted); font-size:var(--fs-sm); letter-spacing:var(--track-wider); }
          #today-house-body .today-time { font-family:var(--font-mono); font-size:var(--fs-xl); font-weight:600; color:var(--text-primary); padding:2px 8px; border-radius:var(--radius-4); background:color-mix(in srgb,var(--accent-green) 12%,transparent); margin-right:10px; } `},
        P3: { label: 'P3  Duration', css: `
          #today-house-body { display:grid; grid-template-columns:1fr 1fr; gap:0; padding:0; }
          #today-house-body .today-row { display:flex; flex-direction:column; gap:4px; padding:16px 22px; }
          #today-house-body .today-row:nth-child(3) { grid-column:1 / -1; border-top:1px solid var(--border-color); flex-direction:row; align-items:baseline; gap:14px; background:color-mix(in srgb,var(--accent-amber) 6%,transparent); }
          #today-house-body .today-label { font-size:var(--fs-xs); color:var(--text-muted); letter-spacing:var(--track-wider); }
          #today-house-body .today-time { font-family:var(--font-mono); font-size:var(--fs-4xl); font-weight:600; color:var(--text-primary); }
          #today-house-body .today-row:nth-child(3) .today-time { color:var(--accent-amber); }
          #today-house-body .today-row:nth-child(3) .today-value { color:var(--text-primary); font-size:var(--fs-xl); } `},
      },
    },
  };

  const KEY = 'option-picker2';
  function start() {
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:6px;background:#000d;border:1px solid #fff3;border-radius:10px;padding:8px;max-width:96vw';
    const state = {};
    Object.keys(GROUPS).forEach((g) => {
      const G = GROUPS[g]; const st = document.head.appendChild(document.createElement('style')); let cleanup = null;
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center';
      const t = document.createElement('span'); t.textContent = G.title; t.style.cssText = 'color:#9aa;font:11px system-ui;width:86px'; row.appendChild(t);
      const set = (k) => {
        if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
        st.textContent = G.options[k].css || '';
        if (G.options[k].setup) cleanup = G.options[k].setup(document) || null;
        state[g] = k; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
        [...row.querySelectorAll('button')].forEach((c) => { c.style.background = c.dataset.k === k ? '#2f4a86' : '#1a2233'; });
      };
      Object.keys(G.options).forEach((k) => {
        const b = document.createElement('button'); b.dataset.k = k; b.textContent = G.options[k].label;
        b.style.cssText = 'color:#fff;border:0;border-radius:7px;padding:6px 10px;cursor:pointer;font:12px system-ui;background:#1a2233'; b.onclick = () => set(k); row.appendChild(b);
      });
      bar.appendChild(row);
      const k0 = saved[g] in G.options ? saved[g] : Object.keys(G.options)[1];
      set(k0);
    });
    document.body.appendChild(bar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
