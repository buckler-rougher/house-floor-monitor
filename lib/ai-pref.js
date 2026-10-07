// Whether the board shows its AI-written explanations (both boards).
//
// Everything the board explains is written by AI from a CRS report and labelled so. A reader who does not want
// it can turn it off: the choice is kept in this browser (localStorage; the page works without it) and applied
// to <html> as soon as this script runs, which is in the <head>, so the explanations never flash on before they
// go. CSS does the hiding: `html.ai-off .ai-block` is the inline explanations, and lib/info-popup.js writes a
// rule per AI entry for its (?) buttons. An entry that is not AI-written (the moment of silence's Deschler quote)
// stays.
//
//   AiPref.isOn()        AiPref.set(true | false)
//
// Two controls: a "Hide AI summaries" button added to every `.ai-block`, and any `[data-ai-toggle]` button (the
// footer's), whose label says the current state.

(function (root) {
  'use strict';

  const KEY = 'ai-summaries';
  let off = false;
  try { off = localStorage.getItem(KEY) === 'off'; } catch (e) { /* private window: default on */ }

  const html = document.documentElement;
  html.classList.toggle('ai-off', off);

  function paint() {
    html.classList.toggle('ai-off', off);
    for (const b of document.querySelectorAll('[data-ai-toggle]')) {
      b.setAttribute('aria-pressed', String(!off));
      b.textContent = 'AI summaries: ' + (off ? 'off' : 'on');
    }
  }

  function set(on) {
    off = !on;
    try { localStorage.setItem(KEY, off ? 'off' : 'on'); } catch (e) { /* kept for this visit only */ }
    paint();
  }

  function addButtons() {
    for (const block of document.querySelectorAll('.ai-block')) {
      if (block.querySelector(':scope > .ai-off-btn')) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ai-off-btn';
      b.textContent = 'Hide AI summaries';
      b.title = 'Turn off AI summaries (the footer turns them back on)';
      block.appendChild(b);
    }
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-ai-toggle], .ai-off-btn');
    if (!t) return;
    set(t.hasAttribute('data-ai-toggle') ? off : false);   // the footer flips it; a block's button turns it off
  });

  document.addEventListener('DOMContentLoaded', () => { addButtons(); paint(); });

  root.AiPref = { isOn: () => !off, set };
})(typeof globalThis !== 'undefined' ? globalThis : this);
