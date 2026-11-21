// STAGING ONLY, TEMPORARY. Shows the Bills This Week panel's empty column in place, next to a populated one. A switcher regroups THIS WEEK'S REAL BILLS into a scenario (suspensions only, rules only, neither)
// and picks how the empty column reads. It wraps updateBillsDisplay (app.js) and puts the real data back after every draw. On any other hostname this does nothing.
// Delete this file and its script tag in index.html once a treatment is chosen and built into app.js.
(function () {
  'use strict';
  if (!/^(?:house|senate)-floor-staging\.evanhollander\.org$/.test(location.hostname)) return;
  if (typeof updateBillsDisplay !== 'function' || !globalThis.EmptyState) return;
  const E = globalThis.EmptyState;
  let scen = 'susp', treat = 'C';
  const KIND = {
    rule: { plain: 'No bills subject to a rule', other: 'under suspension', hint: 'Bills the House takes up under a rule from the Rules Committee appear here.' },
    susp: { plain: 'No bills under suspension', other: 'subject to a rule', hint: 'Bills the House takes up under suspension of the rules appear here.' },
  };
  const orig = updateBillsDisplay;
  function decorate(counts) {
    for (const [which, list] of [['rule', elements.ruleBillsList], ['susp', elements.suspensionBillsList]]) {
      if (!list || !list.querySelector(':scope > .empty-note')) continue;
      const k = KIND[which], other = counts[which === 'rule' ? 'susp' : 'rule'];
      let html;
      if (treat === 'off') html = `<div class="empty-note">${k.plain}</div>`;
      else if (treat === 'A') html = E.column(k.plain, k.hint);
      else if (treat === 'B') html = E.small(k.plain);
      else html = other > 0
        ? E.column(k.plain, `All ${other} of this week’s bills are ${k.other}.`)
        : E.column('No bills this week yet', 'They are listed here once the weekly schedule is posted.');
      list.innerHTML = html;
    }
  }
  window.updateBillsDisplay = function () {
    const bd = billsData, r = bd.ruleBills, s = bd.suspensionBills, all = (r || []).concat(s || []);
    if (scen === 'susp') { bd.ruleBills = []; bd.suspensionBills = all; }
    else if (scen === 'rule') { bd.ruleBills = all; bd.suspensionBills = []; }
    else if (scen === 'none') { bd.ruleBills = []; bd.suspensionBills = []; }
    const counts = { rule: bd.ruleBills.length, susp: bd.suspensionBills.length };
    let out;
    try { out = orig.apply(this, arguments); } finally { bd.ruleBills = r; bd.suspensionBills = s; }
    decorate(counts);
    return out;
  };
  const rows = [
    ['Week', 'scen', [['real', 'Real data'], ['susp', 'Suspensions only'], ['rule', 'Rules only'], ['none', 'Neither']]],
    ['Empty column', 'treat', [['off', 'Current'], ['A', 'A  ghost + what it is'], ['B', 'B  one quiet line'], ['C', 'C  ghost + where the bills are']]],
  ];
  function start() {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;display:grid;gap:6px;background:#000d;border:1px solid #fff3;border-radius:10px;padding:8px;max-width:96vw';
    const paint = () => [...bar.querySelectorAll('button')].forEach((b) => { b.style.background = (b.dataset.g === 'scen' ? scen : treat) === b.dataset.k ? '#2f4a86' : '#1a2233'; });
    rows.forEach(([label, g, opts]) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';
      row.innerHTML = `<span style="color:#9aa6b2;font:11px system-ui;width:84px">${label}</span>`;
      opts.forEach(([k, l]) => {
        const b = document.createElement('button');
        b.dataset.g = g; b.dataset.k = k; b.textContent = l;
        b.style.cssText = 'color:#fff;border:0;border-radius:7px;padding:6px 10px;cursor:pointer;font:12px system-ui;background:#1a2233';
        b.onclick = () => { if (g === 'scen') scen = k; else treat = k; paint(); window.updateBillsDisplay(); const p = document.querySelector('.bills-columns'); if (p) p.scrollIntoView({ block: 'center' }); };
        row.appendChild(b);
      });
      bar.appendChild(row);
    });
    document.body.appendChild(bar);
    paint();
    setTimeout(() => window.updateBillsDisplay(), 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
