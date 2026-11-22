// STAGING ONLY, TEMPORARY. Tries designs for the clamp's + / - button (lib/clamp-list.js, styles.css ".clamp-toggle") on every clamped list at once: Missing Members, Committee Meetings, and the rest. It restyles the real button
// and, for the labelled designs, writes the count of hidden rows into it. On any other hostname this does nothing. Delete this file and its script tags once a design is chosen and built into styles.css.
(function () {
  'use strict';
  if (!/^(?:house|senate)-floor-staging\.evanhollander\.org$/.test(location.hostname)) return;
  const CSS = `
/* A: a pill that says how many */
html.ct-A .clamp-toggle{width:auto;min-width:0;height:28px;padding:0 12px 0 10px;border-radius:999px;gap:6px;font:600 12px/1 var(--font-sans);color:var(--text-secondary);white-space:nowrap;background:var(--bg-elevated)}
html.ct-A .clamp-toggle .ct-l{display:inline}
html.ct-A .clamp-toggle svg{width:11px;height:11px}
/* B: a hairline across the list with a small chevron on it */
html.ct-B .clamp-toggle{left:0;right:0;transform:none;width:100%;height:22px;border:0;border-radius:0;background:transparent;border-top:1px solid var(--border-color)}
html.ct-B .clamp-toggle svg{display:none}
html.ct-B .clamp-toggle::before{content:"";width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg);transition:transform .25s}
html.ct-B .clamp.is-open .clamp-toggle::before{transform:translateY(2px) rotate(-135deg)}
html.ct-B .clamp{padding-bottom:22px}
html.ct-B .clamp.is-short{padding-bottom:0}
/* C: only the symbol, no ring until you hover */
html.ct-C .clamp-toggle{border-color:transparent;background:transparent;width:28px;height:28px}
html.ct-C .clamp-toggle:hover{border-color:var(--text-muted);background:var(--bg-elevated)}
html.ct-C .clamp-toggle svg{width:14px;height:14px;stroke-width:1.5}
/* D: a ring of dots, the way the empty states draw theirs */
html.ct-D .clamp-toggle{border:0;background:transparent;width:30px;height:30px}
html.ct-D .clamp-toggle::before{content:"";position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,transparent 62%,transparent 63%);}
html.ct-D .clamp-toggle .ct-ring{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
html.ct-D .clamp-toggle .ct-ring circle{fill:none;stroke:var(--text-muted);stroke-width:1.8;stroke-linecap:round;stroke-dasharray:0 4.1;transition:stroke .2s}
html.ct-D .clamp-toggle:hover .ct-ring circle{stroke:var(--text-primary)}
html.ct-D .clamp-toggle svg:not(.ct-ring){position:relative;width:12px;height:12px}
.clamp-toggle .ct-l{display:none}`;
  let mode = 'off', timer;
  const RING = '<svg class="ct-ring" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="13.4"/></svg>';
  function label(wrap) {
    const btn = wrap.querySelector('.clamp-toggle'); if (!btn) return;
    let l = btn.querySelector('.ct-l'); if (!l) { l = document.createElement('span'); l.className = 'ct-l'; btn.appendChild(l); }
    const body = wrap.querySelector('.clamp-body'), list = body && body.firstElementChild; if (!list) return;
    const items = [...list.children].filter((e) => e.dataset && e.dataset.key && e.offsetParent !== null);
    const bodyH = body.getBoundingClientRect().height;
    const hidden = wrap.classList.contains('is-open') ? 0 : items.filter((e) => e.offsetTop >= bodyH - 57).length;
    l.textContent = wrap.classList.contains('is-open') ? 'Show less' : 'Show ' + hidden + ' more';
    if (mode === 'D') { if (!btn.querySelector('.ct-ring')) btn.insertAdjacentHTML('afterbegin', RING); } else btn.querySelectorAll('.ct-ring').forEach((e) => e.remove());
  }
  function tick() { document.querySelectorAll('.clamp').forEach(label); }
  function start() {
    document.head.appendChild(document.createElement('style')).textContent = CSS;
    const OPTS = [['off', 'Current'], ['A', 'A  a pill that says how many'], ['B', 'B  a hairline with a chevron'], ['C', 'C  just the symbol'], ['D', 'D  a ring of dots']];
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;display:flex;gap:6px;background:#000d;border:1px solid #fff3;border-radius:10px;padding:8px;max-width:96vw;flex-wrap:wrap;justify-content:center';
    const paint = () => [...bar.children].forEach((b) => { b.style.background = b.dataset.k === mode ? '#2f4a86' : '#1a2233'; });
    OPTS.forEach(([k, label2]) => { const b = document.createElement('button'); b.dataset.k = k; b.textContent = label2; b.style.cssText = 'color:#fff;border:0;border-radius:7px;padding:6px 10px;cursor:pointer;font:12px system-ui;background:#1a2233'; b.onclick = () => { mode = k; ['A', 'B', 'C', 'D'].forEach((m) => document.documentElement.classList.toggle('ct-' + m, k === m)); paint(); tick(); const w = document.querySelector('#absentee .clamp'); if (w) { w.scrollIntoView({ block: 'center' }); } }; bar.appendChild(b); });
    document.body.appendChild(bar); paint(); timer = setInterval(tick, 500); tick();
  }
  const wait = setInterval(() => { if (document.querySelector('.clamp-toggle')) { clearInterval(wait); start(); } }, 500);
})();
