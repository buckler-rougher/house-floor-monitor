// What inline `onclick=` and `onerror=` attributes used to do, as data attributes and three listeners on the document. Inline handlers are code in markup: one built from
// text that came from somewhere else (a Whip notice's words, a bill's id) can end its own string and run what follows, and a page that has them cannot ask the browser to
// refuse inline script. With these, the markup holds only data, and the functions are the page's own.
//
//   data-act="openBillModal" data-args='["H.R. 1"]'      a click calls window.openBillModal("H.R. 1")
//   data-act-input="setVoteRecNote" data-args='["key"]'   typing calls window.setVoteRecNote("key", value)
//   data-img="fade | fade-remove | remove | hide | tweet | card | avatar | mark"   what a picture does when it loads or fails
//   role="button" tabindex="0" on a non-button               Enter and Space click it, as they do a button
//
// Build the arguments with JSON.stringify and put them through escapeHtml for the attribute; nothing here evaluates a string.

(function () {
  'use strict';
  const argsOf = (el) => { try { const a = JSON.parse(el.getAttribute('data-args') || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
  const call = (name, args) => { const fn = typeof name === 'string' && /^[A-Za-z_$][\w$]*$/.test(name) ? window[name] : null; if (typeof fn === 'function') fn(...args); };

  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-act]');
    if (el && !el.disabled) call(el.getAttribute('data-act'), argsOf(el));
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest && e.target.closest('[data-act-input]');
    if (el) call(el.getAttribute('data-act-input'), [...argsOf(el), el.value]);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.defaultPrevented) return;
    const el = e.target;
    if (el && el.matches && el.matches('[role="button"][tabindex]:not(button):not(a):not(input)')) { e.preventDefault(); el.click(); }
  });

  // load and error do not bubble, so they are caught on the way down
  const IMG = {
    fade:          { load: (i) => { i.style.opacity = '1'; }, error: (i) => { i.style.display = 'none'; } },
    'fade-remove': { load: (i) => { i.style.opacity = '1'; }, error: (i) => i.remove() },
    remove:        { error: (i) => i.remove() },
    hide:          { error: (i) => { i.style.display = 'none'; } },
    card:          { error: (i) => { const c = i.closest('.tweet-card'); if (c) c.style.display = 'none'; } },
    avatar:        { error: (i) => { i.style.display = 'none'; if (i.nextElementSibling) i.nextElementSibling.style.display = 'flex'; } },
    // a committee seal that is missing: the committee's letters in its place
    mark:          { error: (i) => { const s = document.createElement('span'); s.className = 'committee-chip-mark'; s.textContent = i.getAttribute('data-mark') || ''; i.replaceWith(s); } },
    // a tweet's picture: gone, and its frame too when none of its pictures is left
    tweet:         { error: (i) => { i.style.display = 'none'; const w = i.closest('.tweet-images,.tweet-card'); if (w && !w.querySelector('img:not([style*="none"])')) w.style.display = 'none'; } },
  };
  const onImg = (e) => {
    const i = e.target;
    if (!i || i.tagName !== 'IMG') return;
    const mode = IMG[i.getAttribute('data-img')];
    const h = mode && mode[e.type];
    if (h) h(i);
  };
  document.addEventListener('load', onImg, true);
  document.addEventListener('error', onImg, true);
})();
