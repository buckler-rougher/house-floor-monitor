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
  const CSS2 = `
.empty-note.es.es-okc2{grid-column:1/-1;width:100%;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:var(--sp-8);padding:var(--sp-24) var(--sp-16) var(--sp-28)}
.es-okc2 .es-h{margin:0}
.es-okc2 .es-mono{font-family:var(--font-mono);font-size:var(--fs-sm);letter-spacing:var(--track-wide);color:var(--text-muted)}
.es-okc2 .chk{width:44px;height:44px}
.es-okc2 .chk circle,.es-okc2 .chk path{stroke:var(--accent-green)}
.es-okc2 .chips{display:flex;gap:var(--sp-8);justify-content:center;flex-wrap:wrap}
.es-okc2 .chip{font-family:var(--font-mono);font-size:var(--fs-sm);font-weight:600;padding:2px 10px;border-radius:999px;border:1px solid var(--border-color);color:var(--text-primary)}
.es-okc2 .chip b{margin-right:6px}
.es-okc2.lock{flex-direction:row;gap:var(--sp-14);padding:var(--sp-20) var(--sp-16)}
.es-okc2.lock .txt{display:flex;flex-direction:column;align-items:flex-start;gap:var(--sp-4);text-align:left}
.es-okc2 .dotring{width:76px;height:76px;position:relative}
.es-okc2 .dotring svg.ring{position:absolute;inset:0;width:100%;height:100%;overflow:visible;transform:rotate(-90deg)}
.es-okc2 .dotring svg.ring circle{fill:none;stroke:var(--accent-green);stroke-width:3.2;stroke-linecap:round;stroke-dasharray:0 6.28}
.es-okc2 .dotring .chk{position:absolute;left:50%;top:50%;width:34px;height:34px;transform:translate(-50%,-50%)}`;
  const PARTY = { dem: 'D', rep: 'R', ind: 'I' };
  const partyChips = () => `<div class="chips">${['dem', 'rep', 'ind'].map((k) => ({ k, n: num('party-' + k) })).filter((p) => p.n > 0).map((p) => `<span class="chip" style="color:${getComputedStyle(document.querySelector('#absentee .' + p.k + '-metric .party-value') || document.body).color}"><b>${PARTY[p.k]}</b>${p.n} of ${p.n}</span>`).join('')}</div>`;
  const CHECK = (cls) => `<svg class="es-ring es-ring-solid chk ${cls || ''}" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6"/><path d="M4.2 7.2l2 2 3.6-4"/></svg>`;
  const line = () => `${totalOf()} of ${totalOf()} ${who} voted${roll() ? ' \u00b7 ' + E.esc(roll()) : ''}`;
  const card = (inner, cls) => `<div class="empty-note es es-okc2 ${cls || ''}">${inner}</div>`;
  function clean() { const l = list(); if (l) { l.style.display = ''; l.innerHTML = ''; } }
  const VARIANTS = {
    A: () => { list().innerHTML = card(`${CHECK()}<div class="es-h">No one missed this vote</div><p class="es-mono">${line()}</p>`); },
    B: () => { list().innerHTML = card(`${CHECK()}<div class="es-h">No one missed this vote</div>${partyChips()}<p class="es-mono">${roll() ? E.esc(roll()) : ''}</p>`); },
    C: () => {
      const dots = 24, r = 33, circ = 2 * Math.PI * r;
      list().innerHTML = card(`<div class="dotring"><svg class="ring" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="${r}" style="stroke-dasharray:0 ${(circ / dots).toFixed(2)}"/></svg>${CHECK()}</div><div class="es-h">No one missed this vote</div><p class="es-mono">${line()}</p>`);
    },
    D: () => { list().innerHTML = card(`${CHECK()}<div class="txt"><div class="es-h">No one missed this vote</div><p class="es-mono">${line()}</p></div>`, 'lock'); },
  };
  const OPTS = [['real', 'Real roll (reload)'], ['A', 'A  the one you liked, centered'], ['B', 'B  with the party counts'], ['C', 'C  a ring of dots around the check'], ['D', 'D  check beside the words (shorter)']];
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
      clean(); VARIANTS[mode]();
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
    document.head.appendChild(document.createElement('style')).textContent = CSS2;
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
