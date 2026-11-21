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
  const sub = () => [...document.querySelectorAll('#absentee *')].find((e) => e.children.length === 0 && /Potential absences|Everyone voted on/.test(e.textContent));
  const SUB_ORIG = { text: null };
  const CSS2 = `
.es-okcap{display:block;margin-top:var(--sp-4);font-family:var(--font-mono);font-size:var(--fs-2xs);letter-spacing:var(--track-wider);text-transform:uppercase;color:var(--accent-green)}
.es-okhero{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;gap:var(--sp-6);padding:var(--sp-20) 0 var(--sp-24)}
.es-okhero .big{font-family:var(--font-mono);font-size:56px;line-height:1;font-weight:700;letter-spacing:-.02em;color:var(--accent-green)}
.es-okhero .cap{font-family:var(--font-mono);font-size:var(--fs-sm);letter-spacing:var(--track-wide);color:var(--text-muted);text-transform:uppercase}
.es-oksub{display:inline-flex;align-items:center;gap:var(--sp-8);color:var(--accent-green)}
.es-oksub svg{width:16px;height:16px}
.es-oksub svg circle,.es-oksub svg path{stroke:var(--accent-green)}`;
  const CHECK = '<svg class="es-ring es-ring-solid" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6"/><path d="M4.2 7.2l2 2 3.6-4"/></svg>';
  // Each treatment edits the panel's own parts after the panel has drawn itself; clean() puts them back first.
  function clean() {
    const l = list();
    if (l) { l.style.display = ''; l.innerHTML = ''; }
    document.querySelectorAll('#absentee .es-okcap').forEach((e) => e.remove());
    document.querySelectorAll('#absentee .party-value').forEach((v) => { v.style.color = ''; });
    const sb = sub();
    if (sb && SUB_ORIG.text != null) { sb.textContent = SUB_ORIG.text; }
  }
  const VARIANTS = {
    A: () => {   // the count boxes turn green and say how many voted; the empty list goes away
      list().style.display = 'none';
      const ms = [...document.querySelectorAll('#absentee .party-metric')].filter((x) => x.offsetParent);
      cols().forEach((c, i) => {
        const m = ms[i], v = m.querySelector('.party-value');
        v.textContent = String(c.of); v.style.color = 'var(--accent-green)';
        m.insertAdjacentHTML('beforeend', '<span class="es-okcap">all voted</span>');
      });
      const sb = sub(); if (sb) sb.innerHTML = `<span class="es-oksub">${CHECK}Everyone voted on the previous vote series</span>`;
    },
    B: () => {   // one number, large
      list().innerHTML = `<div class="es-okhero"><span class="big">100%</span><span class="cap">${totalOf()} of ${totalOf()} ${who} voted \u00b7 ${E.esc(roll())}</span></div>`;
    },
    C: () => {   // nothing extra at all: the line that explains the panel says so, and the empty list goes away
      list().style.display = 'none';
      const sb = sub(); if (sb) sb.innerHTML = `<span class="es-oksub">${CHECK}Everyone voted on the previous vote series</span>`;
    },
  };
  const OPTS = [['real', 'Real roll (reload)'], ['A', 'A  the count boxes turn green'], ['B', 'B  one large number'], ['C', 'C  just the sub-line, no empty area']];
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
      const sb = sub(); if (sb && SUB_ORIG.text == null && /Potential absences/.test(sb.textContent)) SUB_ORIG.text = sb.textContent;
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
