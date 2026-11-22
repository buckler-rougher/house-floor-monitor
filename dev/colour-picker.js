// COLOUR PICKER: a temporary, staging-only panel for choosing a colour ON THE REAL PAGE. It reads every colour variable the stylesheet defines, shows them as swatches (dark to light) with their names and
// values, adds translucent versions of the site's text greys, and takes any typed value (#233044, or "35 48 68"). Clicking one applies it, live, to the thing being coloured. The owner picks by looking at the real
// page, not at a description. First used for the empty states (chosen: --text-secondary at 60%).
//
// HOW TO USE
//   1. Copy this file to lib/colour-picker.js. Set SELECTOR (what is being coloured) and PROPS (the custom properties or CSS properties that thing reads), below.
//      If the thing reads a custom property (the empty states read --es-ink), list it in PROPS. To colour a plain property (e.g. color or background), list that.
//   2. Add <script defer src="lib/colour-picker.js?v=1"></script> to index.html and/or senate.html.
//   3. Ship to the staging sites only:  dev/ship.sh --staging "STAGING ONLY: colour picker (temporary)"
//   4. When a colour is chosen: set it in styles.css, DELETE lib/colour-picker.js and its tags, ship through the PR flow.
//   Bump ?v= on each staging push. The owner cannot see anything injected into the Browser pane: only what is deployed to staging.
(function () {
  'use strict';
  const SELECTOR = '.empty-note.es';        // what is being coloured
  const PROPS = ['--es-ink', '--es-ghost'];   // the properties it reads, all set to the chosen colour
  if (!/^(?:house|senate)-floor-staging\.evanhollander\.org$/.test(location.hostname)) return;
  function start() {
    const probe = document.createElement('span');
    const toRgb = (v) => { probe.style.color = ''; probe.style.color = v; if (!probe.style.color) return null; document.body.appendChild(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; };
    const names = new Set();
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      const walk = (rs) => { for (const r of rs || []) { if (r.cssRules && !r.style) walk(r.cssRules); if (r.style) for (let i = 0; i < r.style.length; i++) { const p = r.style[i]; if (p && p.startsWith('--')) names.add(p); } } };
      walk(rules);
    }
    const root = getComputedStyle(document.documentElement);
    const seen = new Map();
    [...names].forEach((n) => {
      const v = root.getPropertyValue(n).trim();
      const rgb = v && !/^var\(/.test(v) ? toRgb(v) : null;
      if (!rgb || /rgba\(.*,\s*0\)$/.test(rgb)) return;
      const m = rgb.match(/[\d.]+/g).map(Number);
      const key = m.slice(0, 3).join(',') + (m[3] != null && m[3] < 1 ? '/' + m[3] : '');
      if (!seen.has(key)) seen.set(key, { names: [], rgb, m });
      seen.get(key).names.push(n.replace(/^--/, ''));
    });
    const lum = (m) => 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
    const items = [...seen.values()].sort((a, b) => lum(a.m) - lum(b.m));
    // translucent versions of the site's text greys, which is what the live version uses
    const tints = [];
    for (const n of ['text-muted', 'text-secondary']) { const v = root.getPropertyValue('--' + n).trim(); if (v) [25, 35, 45, 60].forEach((p) => tints.push({ label: n + ' @ ' + p + '%', css: 'color-mix(in srgb, var(--' + n + ') ' + p + '%, transparent)', sw: v })); }
    const st = document.head.appendChild(document.createElement('style'));
    const apply = (css) => { st.textContent = css ? SELECTOR + '{' + PROPS.map((p) => p + ':' + css + ' !important').join(';') + '}' : ''; shown.textContent = css || 'current (live) colour'; };
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:99999;width:min(920px,96vw);max-height:42vh;overflow:auto;background:#000e;border:1px solid #fff3;border-radius:10px;padding:8px;font:11px system-ui;color:#cbd5e1';
    const top = document.createElement('div');
    top.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap';
    const shown = document.createElement('span'); shown.style.cssText = 'font-family:monospace;color:#fff';
    const input = document.createElement('input'); input.placeholder = 'type a colour: #233044 or 35 48 68'; input.style.cssText = 'flex:1;min-width:200px;background:#111827;color:#fff;border:1px solid #334155;border-radius:6px;padding:5px 8px;font:12px monospace';
    input.onchange = () => { let v = input.value.trim(); if (/^\d+[ ,]+\d+[ ,]+\d+$/.test(v)) v = 'rgb(' + v.split(/[ ,]+/).join(',') + ')'; if (toRgb(v)) apply(v); };
    const reset = document.createElement('button'); reset.textContent = 'Current'; reset.onclick = () => apply('');
    [reset].forEach((b) => { b.style.cssText = 'background:#1e293b;color:#fff;border:0;border-radius:6px;padding:5px 9px;cursor:pointer;font:12px system-ui'; });
    top.append(reset, input, shown);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px';
    const cell = (label, sub, swatch, css) => { const b = document.createElement('button'); b.style.cssText = 'display:flex;align-items:center;gap:8px;text-align:left;background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:6px;padding:5px 7px;cursor:pointer;font:11px system-ui'; b.innerHTML = '<span style="flex:none;width:22px;height:22px;border-radius:4px;border:1px solid #fff3;background:' + swatch + '"></span><span style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + label + '</b><span style="color:#94a3b8;font-family:monospace">' + sub + '</span></span>'; b.onclick = () => apply(css); grid.appendChild(b); };
    items.forEach((it) => cell(it.names[0] + (it.names.length > 1 ? ' +' + (it.names.length - 1) : ''), it.rgb.replace(/rgba?\(|\)/g, ''), it.rgb, it.rgb));
    tints.forEach((t) => cell(t.label, 'translucent', 'color-mix(in srgb,' + t.sw + ' ' + t.label.match(/(\d+)%/)[1] + '%, #0f1720)', t.css));
    bar.append(top, grid);
    document.body.appendChild(bar);
    shown.textContent = 'current (live) colour';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
