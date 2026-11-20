// STAGING ONLY. On a staging hostname (house-floor-staging.evanhollander.org, senate-floor-staging.evanhollander.org) every request the page makes to the production API
// (https://api.evanhollander.org/...) goes to the staging Worker (https://api-staging.evanhollander.org/...) instead: fetch, the live-vote stream (EventSource), and image links. The production API
// address is written in about fifty places across ten files, so it is rewritten here once, before any of them runs, rather than edited in each. On every other hostname this file does nothing.
// It must load BEFORE lib/fetch-dedupe.js, so the page's own request shows the production address to the de-duplicator and the rewrite happens underneath it.
//
// A fixed "STAGING" tab marks the page too, so nobody mistakes it for the real site.
(function (root) {
  'use strict';
  const PROD = /^https:\/\/api\.evanhollander\.org\//;
  const STAGING_API = 'https://api-staging.evanhollander.org/';
  const STAGING_HOST = /^(?:house|senate)-floor-staging\.evanhollander\.org$/;

  // Pure, so it can be tested: the address a request should really go to.
  function rewrite(url, hostname) {
    return STAGING_HOST.test(hostname || '') && PROD.test(String(url)) ? String(url).replace(PROD, STAGING_API) : url;
  }

  function install(win) {
    if (!win || !win.location || !STAGING_HOST.test(win.location.hostname) || win.__apiBaseInstalled) return;
    win.__apiBaseInstalled = true;
    const host = win.location.hostname;
    const realFetch = win.fetch && win.fetch.bind(win);
    if (realFetch) {
      win.fetch = function (input, init) {
        if (typeof input === 'string' || input instanceof URL) return realFetch(rewrite(String(input), host), init);
        if (input && typeof input.url === 'string' && PROD.test(input.url)) return realFetch(new Request(rewrite(input.url, host), input), init);
        return realFetch(input, init);
      };
    }
    if (win.EventSource) {
      const RealES = win.EventSource;
      win.EventSource = function (url, cfg) { return new RealES(rewrite(String(url), host), cfg); };
      win.EventSource.prototype = RealES.prototype;
      ['CONNECTING', 'OPEN', 'CLOSED'].forEach((k) => { win.EventSource[k] = RealES[k]; });
    }
    // an image address set from script (the link-preview cards ask the Worker for an image)
    const img = win.HTMLImageElement && Object.getOwnPropertyDescriptor(win.HTMLImageElement.prototype, 'src');
    if (img && img.set) {
      Object.defineProperty(win.HTMLImageElement.prototype, 'src', { configurable: true, enumerable: img.enumerable, get: img.get, set(v) { img.set.call(this, rewrite(String(v), host)); } });
    }
    const tag = () => {
      if (!win.document || !win.document.body) return;
      const t = win.document.createElement('div');
      t.textContent = 'STAGING';
      t.setAttribute('aria-hidden', 'true');
      Object.assign(t.style, { position: 'fixed', top: '0', right: '12px', zIndex: '2147483647', padding: '2px 10px', background: '#d29922', color: '#111', font: '700 11px/1.6 monospace', letterSpacing: '1px', borderRadius: '0 0 6px 6px', pointerEvents: 'none' });
      win.document.body.appendChild(t);
      // The page rewrites its title all day (live-title.js, display-style.js), so the prefix is put back whenever it is lost.
      const mark = () => { const d = win.document; if (d.title && !/^STAGING/.test(d.title)) d.title = 'STAGING ' + d.title; };
      mark();
      const titleEl = win.document.querySelector('title');
      if (titleEl && win.MutationObserver) new win.MutationObserver(mark).observe(titleEl, { childList: true, characterData: true, subtree: true });
    };
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', tag); else tag();
  }

  root.ApiBase = { rewrite, install };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ApiBase;
  if (typeof window !== 'undefined') install(window);
})(typeof globalThis !== 'undefined' ? globalThis : this);
