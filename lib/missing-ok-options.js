// STAGING ONLY, TEMPORARY. Tries treatments of the Missing Members panel when nobody is missing, on the real panel: it forces that state, using the page's real roll line and the roll's real totals.
// On any other hostname this does nothing. Delete this file and its script tags once a treatment is chosen and built into lib/empty-state.js.
(function () {
  'use strict';
  if (!/^(?:house|senate)-floor-staging\.evanhollander\.org$/.test(location.hostname)) return;
  const SENATE = /^senate/.test(location.hostname);
  const E = globalThis.EmptyState;
  const list = () => document.getElementById('absentee-list');
  const panel = () => (typeof absenteePanel === 'function' ? absenteePanel() : (typeof absencePanel !== 'undefined' ? absencePanel : null));
  const roll = () => ((document.getElementById('absentee-roll-info') || {}).textContent || '').trim();
  const totals = () => { const l = list(); const of = +(l && l.dataset.of) || (SENATE ? 100 : 433); return { of, n: of }; };
  const who = SENATE ? 'Senators' : 'Members';
  const CSS = `
.es-waffle{display:grid;grid-template-columns:repeat(var(--cols),6px);gap:3px;justify-content:center;margin:var(--sp-4) 0 var(--sp-8)}
.es-waffle i{width:6px;height:6px;border-radius:50%;background:color-mix(in srgb,var(--accent-green) 62%,transparent)}
.es-bigcheck{width:44px;height:44px;margin-bottom:var(--sp-4)}
.es-mono{font-family:var(--font-mono);font-size:var(--fs-sm);letter-spacing:var(--track-wide);color:var(--text-muted)}`;
  const VARIANTS = {
    A: () => E.ok('All ' + who + ' voted', totals()),
    B: () => {
      const { of } = totals(), cols = SENATE ? 20 : 29;
      return `<div class="empty-note es es-okwaffle"><div class="es-waffle" style="--cols:${cols}" aria-hidden="true">${'<i></i>'.repeat(of)}</div><div class="es-h">Every ${SENATE ? 'Senator' : 'Member'} voted</div><p class="es-mono">${E.esc(roll())}</p></div>`;
    },
    C: () => {
      const { of } = totals();
      return `<div class="empty-note es es-okbig"><svg class="es-ring es-ring-solid es-bigcheck es-okc" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6"/><path d="M4.2 7.2l2 2 3.6-4"/></svg><div class="es-h">No one missed this vote</div><p class="es-mono">${of} of ${of} ${who} voted${roll() ? ' · ' + E.esc(roll()) : ''}</p></div>`;
    },
  };
  const OPTS = [['real', 'Real roll (reload)'], ['A', 'A  check and a full meter'], ['B', 'B  one dot per ' + (SENATE ? 'Senator' : 'Member')], ['C', 'C  big check, the roll line']];
  let mode = 'A';
  // The page redraws this panel from the real roll every few seconds; while an option is picked, the panel's own render is wrapped so it keeps drawing "everyone voted".
  let wrapped = false;
  function hold() {
    const p = panel();
    if (!p || wrapped) return;
    wrapped = true;
    const real = p.render;
    p.render = function (args) {
      if (mode === 'real') return real.call(p, args);
      const of = (args && args.of) || totals().of;
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
    p.render({ members: [], info: roll(), emptyText: 'All ' + who + ' voted', of: totals().of, n: totals().of });
  }
  function start() {
    document.head.appendChild(document.createElement('style')).textContent = CSS + '.es-okc circle,.es-okc path{stroke:var(--accent-green)}.es-okbig .es-h{margin-top:0}';
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
