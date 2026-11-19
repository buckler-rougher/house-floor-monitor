// "What's new": a short list of the features a reader would notice, a footer link that carries a dot while the newest is unseen, and a one-line banner above the page, once.
//
// MAJOR FEATURES ONLY (owner, 18 November 2026): not release notes, not a fix or a tweak. Add an entry here, newest FIRST, when something ships that a reader would notice and use.
// `boards` says which site it is for ('house', 'senate'); an entry for both lists both. One short sentence of `text`.
//
// WHEN THE BANNER AND THE DOT SHOW (`decide`, tested):
//   - A reader's first visit shows neither: everything is new to them and the welcome dialog introduces the site. The newest entry is quietly marked seen.
//   - After that, the newest entry for this site is "new" until the reader opens the list (it is then seen), but only for 14 days from the entry's date: someone returning after a month is not shown old news.
//   - The banner is the same entry, once: the X hides it for good, opening the list hides it too. The dot stays in the footer until the list is opened.
//   - Nothing is shown over a link that took the reader straight to something (a bill, a replayed day, a report), where the welcome dialog also keeps out of the way.
// What was seen is kept in this browser only (two keys); where storage cannot be written nothing is remembered and the banner comes back each visit, which is harmless.
(function (root) {
  'use strict';

  const ENTRIES = [
    { id: '2026-11-18-debate', date: '2026-11-18', title: 'Watch the debate', text: 'Open a bill to jump to the moment its debate began, in the Time Machine.', boards: ['house'] },
    { id: '2026-11-17-link-cards', date: '2026-11-17', title: 'Shared bill links show the bill', text: 'A link to a bill previews as a card with its title, sponsor, and support.', boards: ['house', 'senate'] },
    { id: '2026-11-12-special-rules', date: '2026-11-12', title: 'What a special rule does', text: 'Each rule shows how amendments are handled, how long debate runs, and any extensions. Beta.', boards: ['house'] },
    { id: '2026-11-11-member-action', date: '2026-11-11', title: 'Member-initiated floor action', text: 'Privileged resolutions and discharge petitions, together.', boards: ['house'] },
    { id: '2026-10-14-time-machine', date: '2026-10-14', title: 'The Time Machine', text: 'Replay any past day with the video, the Clerk’s log, and the votes.', boards: ['house'] },
  ];
  const NEW_DAYS = 14;
  const SEEN_KEY = 'wn-seen', BANNER_KEY = 'wn-banner';

  const forBoard = (board, entries = ENTRIES) => entries.filter((e) => e.boards.includes(board));
  const daysSince = (iso, now) => Math.floor((now - Date.parse(`${iso}T12:00:00Z`)) / 86400000);

  // seen / dismissed: the stored ids, or null. Returns { newest, first, isNew, showDot, showBanner }.
  function decide({ board, seen, dismissed, now = Date.now(), entries = ENTRIES, straightToSomething = false }) {
    const list = forBoard(board, entries);
    const newest = list[0] || null;
    if (!newest) return { newest: null, first: false, isNew: false, showDot: false, showBanner: false };
    if (seen == null) return { newest, first: true, isNew: false, showDot: false, showBanner: false };   // a first visit: nothing is new to them
    const isNew = seen !== newest.id && daysSince(newest.date, now) <= NEW_DAYS;
    return { newest, first: false, isNew, showDot: isNew, showBanner: isNew && dismissed !== newest.id && !straightToSomething };
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
  };

  function init() {
    const board = /^senate/i.test(location.hostname) || /\/senate/.test(location.pathname) ? 'senate' : 'house';
    const q = new URLSearchParams(location.search);
    const straight = ['bill', 'signers', 'report', 'replay', 'demo'].some((k) => q.has(k));
    const list = forBoard(board);
    if (!list.length) return;
    let state = decide({ board, seen: store.get(SEEN_KEY), dismissed: store.get(BANNER_KEY), straightToSomething: straight });
    if (state.first) { store.set(SEEN_KEY, list[0].id); state = decide({ board, seen: list[0].id, dismissed: null }); }

    // the footer link
    const col = document.querySelector('.site-footer-col[aria-label="The site"]');
    const link = document.createElement('button');
    link.type = 'button'; link.className = 'site-footer-license wn-link'; link.innerHTML = `What’s new<span class="wn-dot" hidden aria-hidden="true"></span>`;
    if (col) { const head = col.querySelector('.site-footer-head'); head ? head.after(link) : col.prepend(link); }
    const dot = () => link.querySelector('.wn-dot');
    const showDot = (on) => { const d = dot(); if (d) d.hidden = !on; link.setAttribute('aria-label', on ? 'What’s new (something new)' : 'What’s new'); };
    showDot(state.showDot);

    // the banner
    let banner = null;
    if (state.showBanner) {
      const host = document.querySelector('main.container');
      if (host) {
        banner = document.createElement('div');
        banner.className = 'wn-banner'; banner.setAttribute('role', 'region'); banner.setAttribute('aria-label', 'What’s new');
        banner.innerHTML = `<span class="wn-pill"><i></i>New</span><button type="button" class="wn-banner-text"><b>${esc(state.newest.title)}</b> <span>${esc(state.newest.text)}</span></button><button type="button" class="wn-banner-x" aria-label="Dismiss"></button>`;
        host.prepend(banner);
        banner.querySelector('.wn-banner-x').addEventListener('click', () => { store.set(BANNER_KEY, state.newest.id); banner.remove(); banner = null; });
        banner.querySelector('.wn-banner-text').addEventListener('click', () => openList());
      }
    }

    // the list: the welcome dialog's own overlay, card, and close button
    let overlay = null, trap = null;
    function closeList() {
      if (!overlay) return;
      const out = root.BoardAnimations && root.BoardAnimations.hideAfterAnimation;
      if (out) out(overlay); else overlay.hidden = true;
      document.removeEventListener('keydown', onKey, true);
      if (trap) { trap.release(); trap = null; }
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeList(); } }
    function openList() {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'welcome-overlay wn-overlay'; overlay.hidden = true;
        overlay.innerHTML = `<div class="welcome-backdrop"></div>
          <div class="welcome-card wn-card" role="dialog" aria-modal="true" aria-labelledby="wn-title">
            <button class="welcome-close" type="button" aria-label="Close"></button>
            <div class="welcome-head wn-head"><div class="welcome-to" id="wn-title">What’s new</div></div>
            <div class="wn-list">${list.map((e, i) => `<div class="wn-entry${i === 0 && state.isNew ? ' is-new' : ''}"><span class="wn-date">${esc(root.BoardUtil ? root.BoardUtil.fmtIso(e.date) : e.date)}</span><div><div class="wn-title">${esc(e.title)}</div><p class="wn-text">${esc(e.text)}</p></div></div>`).join('')}</div>
          </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('.welcome-backdrop').addEventListener('click', closeList);
        overlay.querySelector('.welcome-close').addEventListener('click', closeList);
      }
      overlay.hidden = false;
      document.addEventListener('keydown', onKey, true);
      if (root.FocusTrap) trap = root.FocusTrap.activate(overlay.querySelector('.welcome-card'), { initial: '.welcome-close' });
      // opened: seen. The dot and the banner go, and the "New" mark stays on the entry for this opening only.
      store.set(SEEN_KEY, list[0].id); showDot(false);
      if (banner) { banner.remove(); banner = null; }
    }
    link.addEventListener('click', openList);
    root.WhatsNew.open = openList;
  }

  root.WhatsNew = { ENTRIES, decide, forBoard, NEW_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WhatsNew;
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
