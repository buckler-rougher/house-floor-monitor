// The (?) explainer popup, for both boards: a title, optional tags, a body, a source line and an optional
// picture, in the page's modal style. The first one was the House's ("Suspension of the Rules"); it lived in
// app.js, so the Senate board could not have one. The mechanism is here once and each board registers its own
// content; content that is true of both chambers (a White House memo) is `SharedInfoContent`.
//
//   InfoPopup.register({ key: { title, tags: [], body: string | () => string, source, image } })
//   InfoPopup.has('sap')       // whether a (?) for it should be drawn at all
//   InfoPopup.open('sap')
//   InfoPopup.reveal()         // unhide the (?) buttons marked `hidden` whose entry this board has registered
//
// A button opens one by carrying `class="info-btn" data-info="<key>"`; the click is delegated, so a button
// drawn later (inside a modal that was built after load) works. `body` paragraphs are split on a blank line
// and are HTML, so a source's link or <strong> works; every entry is written by hand in the board's scripts,
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
    const bodyText = typeof c.body === 'function' ? c.body() : c.body;
    const imageHtml = c.image ? `
        <figure class="info-popup-figure">
            <img src="${c.image.url}" alt="${c.image.alt}" class="info-popup-image" loading="lazy">
        </figure>
        <p class="info-popup-caption">${c.image.caption}</p>` : '';
    overlay.innerHTML = `
        <div class="info-popup" role="dialog" aria-modal="true">
            <button class="info-popup-close" id="info-popup-close" aria-label="Close">&#x2715;</button>
            <div class="info-popup-title">${c.title}</div>
            ${tagsHtml}
            <div class="info-popup-body">${bodyText.split('\n\n').map((p) => `<p>${p}</p>`).join('')}</div>
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

  root.InfoPopup = { register, has, open, close, reveal };
})(typeof globalThis !== 'undefined' ? globalThis : this);
