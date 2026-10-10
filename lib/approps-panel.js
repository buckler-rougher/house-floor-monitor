// The APPROPRIATIONS panel both boards carry: the twelve regular bills of the fiscal year, each with how far it has got (reported, passed the House, passed
// the Senate, law) and Congress.gov's own latest action line. Data: the Worker's /api/appropriations (lib/appropriations.js).
//
//   AppropsPanel.mount({ url })    loads it now and every ten minutes, and draws into #approps-list, #approps-summary and #approps-label
//
// Furthest along first, then the House committee's order; four shown behind a button. Nothing drawn until the first answer; an unreachable Worker with
// nothing drawn says so quietly. A bill Congress.gov does not know is listed as "Not found" so a wrong number shows.

(function (root) {
  const { escapeHtml: esc, setIfChanged } = root.BoardUtil;
  const SHOWN = 4;
  let data = null, all = false;

  const date = (iso) => (iso && /^\d{4}-\d\d-\d\d/.test(iso) ? new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');

  function render() {
    const list = document.getElementById('approps-list');
    if (!list || !data) return;
    const stages = data.stages;
    const rank = (b, i) => [-b.stage, i];
    const bills = data.bills.map((b, i) => ({ b, i })).sort((x, y) => (y.b.stage - x.b.stage) || (x.i - y.i)).map((x) => x.b);
    const shown = all ? bills : bills.slice(0, SHOWN);
    const put = (id, v) => { const n = document.getElementById(id); if (n && n.textContent !== v) n.textContent = v; };
    put('approps-label', `FY${data.fiscalYear} APPROPRIATIONS`);
    const passed = data.bills.filter((b) => b.stage >= 2).length;
    put('approps-summary', `${passed} of ${data.bills.length} passed the House`);
    const item = (b) => {
      const word = !b.known ? 'Not found' : stages[b.stage];
      const when = [null, b.reported, b.housePassed, b.senatePassed, typeof b.law === 'string' && b.law.length === 10 ? b.law : null][b.stage];
      return `
        <div class="approps-item">
            <div class="approps-top">
                <span class="approps-id"><span class="approps-name">${esc(b.short)}</span><a href="${esc(b.url)}" target="_blank" rel="noopener" title="${esc(b.title || b.name)}">${esc(b.id)}</a></span>
                <span class="approps-stage${b.stage === 4 ? ' is-law' : ''}">${esc(word)}${when && b.known ? ` <span>${esc(date(when))}</span>` : ''}</span>
            </div>
            <div class="approps-track" role="img" aria-label="${esc(b.known ? `${word}: step ${b.stage} of 4` : 'Not found on Congress.gov')}">${[1, 2, 3, 4].map((n) => `<i class="${n <= b.stage ? (b.stage === 4 ? 'is-law' : 'on') : ''}" title="${esc(stages[n])}"></i>`).join('')}</div>
            ${b.latestAction ? `<div class="approps-action"><span>Latest action${b.latestActionDate ? `, ${esc(date(b.latestActionDate))}` : ''}:</span> ${esc(b.latestAction)}</div>` : ''}
        </div>`;
    };
    const rest = bills.length - shown.length;
    sync(list, shown.map((b) => ({ key: b.id, html: item(b) })));
    let btn = document.getElementById('approps-toggle');
    if (bills.length > SHOWN) {
      if (!btn) { btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dp-toggle'; btn.id = 'approps-toggle'; list.appendChild(btn); }
      const label = all ? 'Show fewer' : `Show ${rest} more bill${rest === 1 ? '' : 's'}`;
      if (btn.textContent !== label) btn.textContent = label;
    } else if (btn) btn.remove();
  }

  // Keep what is already drawn and animate what comes and goes: a bill that appears opens up from nothing (its height, its fade and the gap below it), one that
  // goes closes the same way and is removed when it is shut, so the button under the list slides rather than jumps. The first drawing, a data refresh that changes
  // nothing and reduced motion are not animated. Items are matched by their key and kept when their markup is unchanged, so a refresh does not touch them.
  function sync(list, entries) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const first = !list.querySelector('[data-key]');
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    const EASE = 'cubic-bezier(0.15, 0.83, 0.66, 1)';
    const items = [...list.children].filter((el) => el.dataset && el.dataset.key);
    const old = new Map(items.map((el) => [el.dataset.key, el]));
    const wanted = new Set(entries.map((e) => e.key));
    // leaving
    for (const el of items) {
      if (wanted.has(el.dataset.key) || el.dataset.leaving) continue;
      if (reduce || first) { el.remove(); continue; }
      el.dataset.leaving = '1';
      const h = el.offsetHeight;
      el.style.overflow = 'hidden';
      el.animate([{ height: h + 'px', opacity: 1, marginBottom: '0px' }, { height: '0px', opacity: 0, marginBottom: -gap + 'px' }], { duration: 240, easing: EASE }).onfinish = () => el.remove();
      el.style.height = '0px'; el.style.marginBottom = -gap + 'px'; el.style.opacity = '0';
    }
    // anything that is not a bill or the button (the "Loading" note) goes
    [...list.children].forEach((el) => { if (!(el.dataset && el.dataset.key) && el.id !== 'approps-toggle') el.remove(); });
    // staying and arriving, in order; bills still closing are left where they are
    let prev = null;
    for (const { key, html } of entries) {
      let el = old.get(key);
      const changed = !el || el.dataset.sig !== html;
      const arriving = !el;
      if (changed) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        const n = t.content.firstElementChild;
        n.dataset.key = key; n.dataset.sig = html;
        if (el && el.parentNode === list) el.replaceWith(n);
        el = n;
      }
      let ref = prev ? prev.nextSibling : list.firstChild;
      while (ref && ref.dataset && ref.dataset.leaving) ref = ref.nextSibling;
      if (ref !== el) list.insertBefore(el, ref || document.getElementById('approps-toggle') || null);
      prev = el;
      if (arriving && !reduce && !first) {
        const h = el.offsetHeight;
        el.style.overflow = 'hidden';
        el.animate([{ height: '0px', opacity: 0, marginBottom: -gap + 'px' }, { height: h + 'px', opacity: 1, marginBottom: '0px' }], { duration: 280, easing: EASE }).onfinish = () => { el.style.overflow = ''; };
      }
    }
  }

  function mount({ url }) {
    const load = () => fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { data = d; render(); })
      .catch(() => { const l = document.getElementById('approps-list'); if (l && !data) setIfChanged(l, '<div class="empty-note">Appropriations unavailable</div>'); });
    load();
    setInterval(load, 10 * 60 * 1000);
    document.addEventListener('click', (e) => { if (e.target && e.target.id === 'approps-toggle') { all = !all; render(); } });
  }

  root.AppropsPanel = { mount };
})(globalThis);
