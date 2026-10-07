// The (?) explainer popup, for both boards: a title, optional tags, a body, a source line and an optional
// picture, in the page's modal style. The first one was the House's ("Suspension of the Rules"); it lived in
// app.js, so the Senate board could not have one. The mechanism is here once and each board registers its own
// content; content that is true of both chambers (a White House memo) is `SharedInfoContent`.
//
//   InfoPopup.register({ key: { title, tags: [], body: string | () => string, table, source, image } })
//   InfoPopup.has('sap')       // whether a (?) for it should be drawn at all
//   InfoPopup.open('sap')
//   InfoPopup.reveal()         // unhide the (?) buttons marked `hidden` whose entry this board has registered
//
// A button opens one by carrying `class="info-btn" data-info="<key>"`; the click is delegated, so a button
// drawn later (inside a modal that was built after load) works. `body` paragraphs are split on a blank line
// and are HTML, so a source's link or <strong> works; a paragraph that is exactly [[table]] is replaced by the
// entry's comparison `table: { columns: ['', 'A', 'B'], rows: [['label', 'a', 'b'], ...] }`. Every entry is written by hand in the board's scripts,
// never taken from a feed. An unknown key opens nothing.
//
// A popup can open from inside the bill modal, so its layer is above that modal's (styles.css).

(function (root) {
  'use strict';

  const content = {};
  let keyHandler = null;
  let trapCleanup = null;

  function register(map) {
    Object.assign(content, map || {});
    // Warm the pictures so they are cached by the time a popup opens.
    for (const c of Object.values(map || {})) { if (c && c.image && c.image.url) { const i = new Image(); i.src = c.image.url; } }
  }
  const has = (key) => !!content[key];

  function trapFocus(el) {
    const sel = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    function handler(e) {
      if (e.key !== 'Tab') return;
      const nodes = [...el.querySelectorAll(sel)];
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }

  function hide(el) {
    if (root.hideAfterAnimation) root.hideAfterAnimation(el); else if (el) el.hidden = true;
  }

  // A comparison chart: a header row of column names and one row per thing compared, the first cell of each
  // row being its label. Values are HTML written in the board's scripts, like the paragraphs.
  function tableHtml(t) {
    const th = (v, i) => `<th scope="${i === 0 ? 'row' : 'col'}">${v}</th>`;
    return `<div class="info-popup-table-wrap"><table class="info-popup-table">
      <thead><tr>${t.columns.map((v) => `<th scope="col">${v}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map((v, i) => (i === 0 ? `<th scope="row">${v}</th>` : `<td>${v}</td>`)).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  // The paragraphs (and chart) of an entry as HTML. An entry's body can be a function, for one that names
  // something that changes (the House Chaplain).
  function bodyHtml(c) {
    const text = typeof c.body === 'function' ? c.body() : c.body;
    return text.split('\n\n').map((p) => (p.trim() === '[[table]]' && c.table ? tableHtml(c.table) : `<p>${p}</p>`)).join('');
  }

  // The same entry drawn in the page instead of a popup, for a panel that explains itself under the Clerk's
  // words: the paragraphs go into `el`, and the source line into `sourceEl` when there is one. Both are written
  // only when they change, so a panel that refreshes does not rebuild its text.
  function inline(el, key, sourceEl) {
    const c = content[key];
    if (!el || !c) return false;
    // A picture goes after the text, so it is only seen once a clamped explanation is opened.
    const html = bodyHtml(c) + (c.image
      ? `<figure class="info-popup-figure"><img src="${c.image.url}" alt="${c.image.alt}" class="info-popup-image" loading="lazy"></figure><p class="info-popup-caption">${c.image.caption}</p>` : '');
    if (el.innerHTML !== html) el.innerHTML = html;
    el.dataset.inlineInfo = key;
    if (sourceEl && c.source && sourceEl.innerHTML !== c.source) sourceEl.innerHTML = c.source;
    // The entry's tags, as pills, where the block has a place for them (the joint and privilege panels keep their own).
    const tagsEl = el.closest('.ai-block') && el.closest('.ai-block').querySelector('[data-inline-tags]');
    if (tagsEl) {
      const tags = (c.tags || []).map((t) => `<span class="ai-pill">${t}</span>`).join('');
      if (tagsEl.innerHTML !== tags) tagsEl.innerHTML = tags;
    }
    // The purple tint says "written by AI"; an entry that quotes a source verbatim is not.
    const block = el.closest('.ai-block');
    if (block) block.classList.toggle('is-plain', !(c.source && /generated by AI/.test(c.source)));
    // A clamped card re-measures its text, which is not the size of the box it sits in.
    const card = el.closest('.calendar-card');
    if (card && card._measure) card._measure();
    return true;
  }
  // Every `[data-inline-info="key"]` in scope, with its source line in the element named by `data-inline-source`.
  function fillInline(scope) {
    for (const el of (scope || document).querySelectorAll('[data-inline-info]')) {
      const src = el.dataset.inlineSource ? document.getElementById(el.dataset.inlineSource) : null;
      inline(el, el.dataset.inlineInfo, src);
    }
  }

  function close(trigger) {
    hide(document.getElementById('info-popup-overlay'));
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    if (trapCleanup) { trapCleanup(); trapCleanup = null; }
    if (trigger && trigger.focus) trigger.focus();
  }

  function open(key) {
    const c = content[key];
    if (!c) return;

    let overlay = document.getElementById('info-popup-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'info-popup-overlay';
      overlay.className = 'info-popup-overlay';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    }

    const tagsHtml = c.tags && c.tags.length
      ? `<div class="info-popup-tags">${c.tags.map((t) => `<span class="info-popup-tag">${t}</span>`).join('')}</div>` : '';
    const imageHtml = c.image ? `
        <figure class="info-popup-figure">
            <img src="${c.image.url}" alt="${c.image.alt}" class="info-popup-image" loading="lazy">
        </figure>
        <p class="info-popup-caption">${c.image.caption}</p>` : '';
    overlay.innerHTML = `
        <div class="info-popup${c.source && /generated by AI/.test(c.source) ? ' is-ai' : ''}" role="dialog" aria-modal="true">
            <button class="info-popup-close" id="info-popup-close" aria-label="Close">&#x2715;</button>
            <div class="info-popup-title">${c.title}</div>
            ${tagsHtml}
            <div class="info-popup-body">${bodyHtml(c)}</div>
            ${c.source ? `<div class="info-popup-source">${c.source}</div>` : ''}
            ${imageHtml}
        </div>
    `;
    overlay.hidden = false;
    const trigger = document.activeElement;
    const closeBtn = document.getElementById('info-popup-close');
    closeBtn.addEventListener('click', () => close(trigger));
    keyHandler = (e) => { if (e.key === 'Escape') close(trigger); };
    document.addEventListener('keydown', keyHandler);
    trapCleanup = trapFocus(overlay);
    closeBtn.focus();
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.info-btn');
    if (btn && btn.dataset.info) { e.stopPropagation(); open(btn.dataset.info); }
  });

  // A (?) placed in a page's markup that both boards share is written `hidden`, so a board that has no entry for
  // it shows no dead button. Each board calls this after registering its entries.
  // In `?fixtures` (the offline harness) they are all shown, so the layout can be reviewed before the text exists.
  function reveal(scope) {
    const preview = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fixtures');
    for (const b of (scope || document).querySelectorAll('.info-btn[hidden][data-info]')) {
      if (preview || has(b.dataset.info)) b.hidden = false;
    }
  }

  root.InfoPopup = { register, has, open, close, reveal, inline, fillInline };
})(typeof globalThis !== 'undefined' ? globalThis : this);
