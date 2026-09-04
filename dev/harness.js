/**
 * House Floor Monitor — development harness.  NOT loaded in normal page views.
 *
 * index.html only pulls this file in when the URL carries ?fixtures, ?mode or
 * ?freeze, so production traffic never pays for it. Its job is to make the site
 * renderable and reproducible off-network, which is a precondition for any CSS
 * refactor: the worker's CORS allowlist rejects localhost, and 20 of the 22
 * floor modes only occur when the House is actually in that state.
 *
 *   ?fixtures        serve every API call from dev/fixtures/ instead of the network
 *   ?mode=prayer     drive the app into one floor mode (see fixtures/modes/index.json)
 *   ?freeze=<iso>    pin the clock (default 2026-09-03T18:30:00Z; ?freeze=0 disables)
 *
 * Design note: with ?fixtures we feed the app crafted proceedings and let its own
 * autoSwitchModeFromProceedings() choose the mode, rather than forcing the body
 * class. That exercises the real code path, so a fixture that stops selecting its
 * mode is itself a regression signal — the console warns when the app lands
 * somewhere other than the requested mode.
 */
(function () {
  'use strict';

  const q = new URLSearchParams(location.search);
  const useFixtures = q.has('fixtures') && q.get('fixtures') !== '0';
  const mode = q.get('mode');
  if (!useFixtures && !mode && !q.has('freeze')) return; // inert on normal loads

  const BASE = new URL('dev/fixtures/', new URL('.', location.href)).href;
  const log = (...a) => console.info('%c[harness]', 'color:#58a6ff;font-weight:bold', ...a);
  const warn = (...a) => console.warn('%c[harness]', 'color:#d29922;font-weight:bold', ...a);

  // ── Frozen clock ───────────────────────────────────────────────────────────
  // Snapshots compare computed styles across a refactor; a live clock would make
  // every run differ (header times, "3m ago", vote countdown). Must stay in sync
  // with BASE in make-mode-fixtures.mjs.
  const FREEZE_DEFAULT = '2026-09-03T18:30:00Z';
  const freezeArg = q.get('freeze');
  if (freezeArg !== '0' && (useFixtures || mode || freezeArg)) {
    const fixed = Date.parse(freezeArg && freezeArg !== '1' ? freezeArg : FREEZE_DEFAULT);
    if (Number.isFinite(fixed)) {
      const RealDate = Date;
      const Frozen = function (...args) {
        return args.length === 0 ? new RealDate(fixed) : new RealDate(...args);
      };
      Frozen.prototype = RealDate.prototype;
      Frozen.now = () => fixed;
      Frozen.parse = RealDate.parse;
      Frozen.UTC = RealDate.UTC;
      window.Date = Frozen;
      log('clock frozen at', new RealDate(fixed).toISOString());
    }
  }

  if (!useFixtures) { wireMode(); return; }

  // ── Route table ────────────────────────────────────────────────────────────
  // Matched as substrings against the request URL, longest first, so
  // /stream/votes/current/status wins over /stream/votes/current.
  const ROUTES = {
    '/api/stream/votes/current/status': 'stream-status.json',
    '/api/cold-start-bundle':           'cold-start-bundle.json',
    '/api/domewatch-floor':             'domewatch-floor.json',
    '/api/last-session-date':           'last-session-date.json',
    '/api/airport-delays':              'airport-delays.json',
    '/api/congress-index':              'congress-index.json',
    '/api/member-data':                 'member-data.json',
    '/api/proceedings':                 'proceedings.json',
    '/api/voting-days':                 'voting-days.json',
    '/api/leadership':                  'leadership.json',
    '/api/bluesky':                     'bluesky.json',
    '/api/tweets':                      'tweets.json',
    '/api/hls-url':                     'hls-url.json',
    '/api/bills':                       'bills.json',
    '/api/news':                        'news.json',
    'api.weather.gov/points':           'weather-points.json',
    'api.weather.gov/gridpoints':       'weather-forecast.json',
    'airports.csv':                     'airports.csv',
  };
  const ROUTE_KEYS = Object.keys(ROUTES).sort((a, b) => b.length - a.length);

  // Endpoints with no fixture: answered with an empty-but-valid shape rather
  // than a network call, so a missing fixture never turns into a CORS error.
  const STUBS = {
    '/api/amendments': { amendments: [] },
    'en.wikipedia.org': { query: { search: [], pages: {} } },
  };

  const resolve = url => ROUTE_KEYS.find(k => url.includes(k));
  const fixtureUrl = name =>
    mode ? `${BASE}modes/${mode}/${name}` : null;

  // Per-mode file if one exists, else the shared capture.
  const cache = new Map();
  async function loadFixture(name) {
    if (cache.has(name)) return cache.get(name);
    const p = (async () => {
      const scoped = fixtureUrl(name);
      if (scoped) {
        const r = await fetch(scoped, { cache: 'no-store' });
        if (r.ok) return r.text();
      }
      const r = await fetch(BASE + 'base/' + name, { cache: 'no-store' });
      if (!r.ok) throw new Error(`fixture missing: ${name}`);
      return r.text();
    })();
    cache.set(name, p);
    return p;
  }

  const reply = (body, type) => new Response(body, {
    status: 200, headers: { 'Content-Type': type },
  });

  const realFetch = window.fetch.bind(window);
  let served = 0, passed = 0;

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';

    // Our own fixture reads, and any same-origin asset, go straight through.
    if (url.startsWith(BASE) || (!/^https?:/i.test(url) && !url.startsWith('//'))) {
      return realFetch(input, init);
    }

    const key = resolve(url);
    if (key) {
      const name = ROUTES[key];
      try {
        const body = await loadFixture(name);
        served++;
        return reply(body, name.endsWith('.csv') ? 'text/csv' : 'application/json');
      } catch (e) {
        warn(e.message, '←', url);
        return reply('{}', 'application/json');
      }
    }

    const stubKey = Object.keys(STUBS).find(k => url.includes(k));
    if (stubKey) { served++; return reply(JSON.stringify(STUBS[stubKey]), 'application/json'); }

    // Anything unrouted is blocked rather than allowed out: a silent live call
    // would reintroduce exactly the nondeterminism fixtures exist to remove.
    passed++;
    warn('blocked unrouted request →', url);
    return reply('{}', 'application/json');
  };

  // ── SSE ────────────────────────────────────────────────────────────────────
  // app.js opens an EventSource to /stream/votes/current and retries on error.
  // A stub that simply reports "open" and stays quiet keeps the REST poll as the
  // single source of data and avoids an endless reconnect loop in the console.
  window.EventSource = class {
    constructor(url) {
      this.url = url; this.readyState = 1;
      this.onopen = this.onerror = this.onmessage = null;
      this._l = {};
      setTimeout(() => {
        this.onopen && this.onopen({ type: 'open' });
        (this._l.open || []).forEach(f => f({ type: 'open' }));
      }, 0);
    }
    addEventListener(t, f) { (this._l[t] ||= []).push(f); }
    removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter(x => x !== f); }
    close() { this.readyState = 2; }
  };
  window.EventSource.CONNECTING = 0;
  window.EventSource.OPEN = 1;
  window.EventSource.CLOSED = 2;

  // ── Live video ─────────────────────────────────────────────────────────────
  // Both HLS call sites guard on `window.Hls`, so a non-writable stub keeps the
  // Capitol cam and floor-feed players off the network. hls.js assigns to
  // window.Hls in sloppy mode, where writing a non-writable property is a
  // silent no-op, so this survives its later <script>.
  try {
    Object.defineProperty(window, 'Hls', {
      value: { isSupported: () => false, Events: {}, ErrorTypes: {} },
      writable: false, configurable: false,
    });
  } catch { /* non-fatal: worst case the players try to load */ }

  wireMode();
  window.addEventListener('load', () => {
    setTimeout(() => log(`${served} requests served from fixtures, ${passed} blocked`), 1500);
  });

  // ── Mode pinning ───────────────────────────────────────────────────────────
  function wireMode() {
    if (!mode) return;
    window.addEventListener('load', () => {
      // Let the app's own auto-switch run on the fixtured proceedings first, then
      // compare and pin. A mismatch means the fixture no longer selects its mode.
      setTimeout(() => {
        const landed = [...document.body.classList]
          .filter(c => c.endsWith('-mode'))
          .map(c => c.replace(/-mode$/, ''));
        // "vote" is the app's default state and adds NO body class — see
        // updateModeClasses(), which has a branch for every mode except vote.
        // An empty class list is therefore a correct landing for it.
        const ok = mode === 'vote' ? landed.length === 0 : landed.includes(mode);
        if (!ok) {
          warn(`requested "${mode}" but app selected "${landed.join(', ') || 'none'}" — ` +
               `fixture may no longer match app.js triggers; forcing it`);
        }
        if (typeof window.lockMode === 'function') window.lockMode(mode);
        document.documentElement.dataset.harnessMode = mode;
        log('mode pinned →', mode);
      }, 1200);
    });
  }
})();
