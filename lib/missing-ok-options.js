// STAGING ONLY, TEMPORARY. Tries treatments of the Missing Members panel when nobody is missing, on the real panel: it forces that state, using the page's real roll line, the roll's real totals, and the
// chamber's real party counts (from the Balance of Power panel). Every treatment spans the whole list and lines up with the count boxes above it. On any other hostname this does nothing.
// Delete this file and its script tags once a treatment is chosen and built into lib/empty-state.js.
(function () {
  'use strict';
  if (!/^(?:house|senate)-floor-staging\.evanhollander\.org$/.test(location.hostname)) return;
  const SENATE = /^senate/.test(location.hostname);
  const E = globalThis.EmptyState;
  const list = () => document.getElementById('absentee-list');
  const panel = () => (typeof absenteePanel === 'function' ? absenteePanel() : (typeof absencePanel !== 'undefined' ? absencePanel : null));
  const roll = () => ((document.getElementById('absentee-roll-info') || {}).textContent || '').trim();
  const num = (id) => +((document.getElementById(id) || {}).textContent || '').replace(/\D/g, '') || 0;
  const who = SENATE ? 'Senators' : 'Members';
  const totalOf = () => { const l = list(); return +(l && l.dataset.of) || (num('party-dem') + num('party-rep') + num('party-ind')) || (SENATE ? 100 : 433); };
  // the count boxes above the list, in order, each with its own width and colour: the treatments line up under them
  const cols = () => [...document.querySelectorAll('#absentee .party-metric')].filter((m) => m.offsetParent).map((m) => {
    const key = /dem-metric/.test(m.className) ? 'dem' : /rep-metric/.test(m.className) ? 'rep' : /ind-metric/.test(m.className) ? 'ind' : 'total';
    const of = key === 'total' ? totalOf() : num('party-' + key);
    return { key, of, w: m.offsetWidth, color: getComputedStyle(m.querySelector('.party-value') || m).color, label: (m.querySelector('.party-label') || m.firstElementChild || {}).textContent || '' };
  });
  const wrap = (inner, extra) => `<div class="empty-note es es-okgrid" style="grid-column:1/-1${extra || ''}">${inner}</div>`;
  const row = (cells) => `<div class="es-okrow">${cells.join('')}</div>`;
  const CSS = `
.empty-note.es.es-okgrid{display:block;align-items:stretch;width:100%;box-sizing:border-box;padding:var(--sp-12) 0 var(--sp-20);text-align:center}
.es-okrow{display:flex;justify-content:space-between;align-items:flex-start}
.es-okcell{display:flex;flex-direction:column;align-items:center;gap:var(--sp-6)}
.es-okn{font-family:var(--font-mono);font-size:var(--fs-sm);letter-spacing:var(--track-wide);color:var(--text-muted)}
.es-okn b{color:var(--text-primary);font-weight:600}
.es-okbar{display:block;width:70%;height:4px;border-radius:2px;background:color-mix(in srgb,var(--accent-green) 70%,transparent)}
.es-okdots{display:grid;gap:2px;justify-content:center}
.es-okdots i{width:5px;height:5px;border-radius:50%}
.es-okcheck{width:30px;height:30px}
.es-okcheck circle,.es-okcheck path{stroke:var(--accent-green)}
.es-okline{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-12);padding:var(--sp-10) var(--sp-16);border:1px solid color-mix(in srgb,var(--accent-green) 35%,transparent);border-radius:var(--radius-8);background:color-mix(in srgb,var(--accent-green) 7%,transparent);text-align:left}
.es-okline .l{display:flex;align-items:center;gap:var(--sp-10);color:var(--text-primary);font-weight:600;font-size:var(--fs-md)}
.es-okline .r{font-family:var(--font-mono);font-size:var(--fs-sm);letter-spacing:var(--track-wide);color:var(--text-muted);white-space:nowrap}`;
  const CHECK = '<svg class="es-ring es-ring-solid es-okcheck" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6"/><path d="M4.2 7.2l2 2 3.6-4"/></svg>';
  const VARIANTS = {
    A: () => wrap(row(cols().map((c) => `<div class="es-okcell" style="width:${c.w}px"><span class="es-okn"><b>${c.of}</b> of ${c.of} voted</span><span class="es-okbar"></span></div>`)) + `<p class="es-okn" style="margin:var(--sp-14) 0 0">Everyone voted · ${E.esc(roll())}</p>`),
    B: () => wrap(row(cols().map((c) => {
      if (c.key === 'total') return `<div class="es-okcell" style="width:${c.w}px">${CHECK}<span class="es-okn"><b>Everyone voted</b></span></div>`;
      const per = Math.max(8, Math.floor(c.w / 7));
      return `<div class="es-okcell" style="width:${c.w}px"><span class="es-okdots" style="grid-template-columns:repeat(${per},5px)" aria-hidden="true">${`<i style="background:${c.color}"></i>`.repeat(c.of)}</span><span class="es-okn"><b>${c.of}</b> of ${c.of}</span></div>`;
    })) + `<p class="es-okn" style="margin:var(--sp-14) 0 0">${E.esc(roll())}</p>`),
    C: () => wrap(`<div class="es-okline"><span class="l">${CHECK.replace('es-okcheck', 'es-okcheck" style="width:20px;height:20px')}Everyone voted</span><span class="r">${totalOf()} of ${totalOf()} ${who} · ${E.esc(roll())}</span></div>`),
  };
  const OPTS = [['real', 'Real roll (reload)'], ['A', 'A  voted, under each count'], ['B', 'B  one dot per ' + (SENATE ? 'Senator' : 'Member') + ', by party'], ['C', 'C  a slim confirmation bar']];
  let mode = 'A', wrapped = false;
  // The page redraws this panel from the real roll every few seconds; while an option is picked, the panel's own render is wrapped so it keeps drawing "everyone voted".
  function hold() {
    const p = panel();
    if (!p || wrapped) return;
    wrapped = true;
    const real = p.render;
    p.render = function (args) {
      if (mode === 'real') return real.call(p, args);
      const of = (args && args.of) || totalOf();
      const out = real.call(p, Object.assign({}, args, { members: [], of, n: of }));
      const l = list();
      if (l) l.innerHTML = VARIANTS[mode]();
      return out;
    };
  }
  function show() {
    const l = list(), p = panel();
    if (!l || !p || mode === 'real') return;
    hold();
    p.render({ members: [], info: roll(), emptyText: 'All ' + who + ' voted', of: totalOf(), n: totalOf() });
  }
  function start() {
    document.head.appendChild(document.createElement('style')).textContent = CSS;
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;display:flex;gap:6px;background:#000d;border:1px solid #fff3;border-radius:10px;padding:8px;max-width:96vw;flex-wrap:wrap;justify-content:center';
    const paint = () => [...bar.children].forEach((b) => { b.style.background = b.dataset.k === mode ? '#2f4a86' : '#1a2233'; });
    OPTS.forEach(([k, label]) => {
      const b = document.createElement('button');
      b.dataset.k = k; b.textContent = label;
      b.style.cssText = 'color:#fff;border:0;border-radius:7px;padding:6px 10px;cursor:pointer;font:12px system-ui;background:#1a2233';
      b.onclick = () => { if (k === 'real') { location.reload(); return; } mode = k; paint(); show(); const a = document.getElementById('absentee'); if (a) a.scrollIntoView({ block: 'center' }); };
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
    paint();
    setTimeout(show, 6000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
