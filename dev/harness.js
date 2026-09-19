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
  // ?demo drives the public demo at /demo: fixtures, the vote mode, and a tally
  // that actually moves. Deliberately NOT folded into ?fixtures&mode=vote --
  // dev/check-modes.mjs diffs computed styles against saved snapshots, and a
  // board whose numbers change every 400ms can never match a saved frame.
  // /demo is served by rewriting to index.html (see _redirects), which leaves the
  // browser URL as /demo with no query string -- so the path has to count too.
  const demo = (q.has('demo') && q.get('demo') !== '0') || /^\/demo\/?$/.test(location.pathname);
  // The demo is fixtures + the vote mode, so it implies both rather than making
  // the URL spell them out.
  const useFixtures = (q.has('fixtures') && q.get('fixtures') !== '0') || demo;
  const mode = q.get('mode') || (demo ? 'vote' : null);
  if (!useFixtures && !mode && !q.has('freeze')) return; // inert on normal loads

  const BASE = new URL('dev/fixtures/', new URL('.', location.href)).href;
  const log = (...a) => console.info('%c[harness]', 'color:#58a6ff;font-weight:bold', ...a);
  const warn = (...a) => console.warn('%c[harness]', 'color:#d29922;font-weight:bold', ...a);

  // ── Always refetch the stylesheet ──────────────────────────────────────────
  // styles.css?v=NNN is a separate URL from the page, so cache-busting the page
  // does NOT get you fresh CSS. When you edit styles.css between two captures,
  // some frames keep serving the old file and the snapshot diff reports changes
  // that are pure cache artifacts. Re-pointing the link at a unique URL on every
  // harness load makes "what's on disk" and "what's rendered" the same thing.
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    link.href = link.href.replace(/[?&]_hcb=\d+/, '') +
                (link.href.includes('?') ? '&' : '?') + '_hcb=' + Date.now();
  }

  // ── Frozen clock ───────────────────────────────────────────────────────────
  // Snapshots compare computed styles across a refactor; a live clock would make
  // every run differ (header times, "3m ago", vote countdown). Must stay in sync
  // with BASE in make-mode-fixtures.mjs.
  const FREEZE_DEFAULT = '2026-09-03T18:30:00Z';
  const freezeArg = q.get('freeze');
  // The demo runs on a live clock. A frozen Date.now() makes tickVoteTimer
  // compute zero elapsed on every 100ms tick, so the vote clock only moved when
  // a tally arrived and stepped two seconds at a time with the centiseconds
  // pinned at .00 -- it read as jumping rather than running. Snapshot captures
  // still freeze; they pass ?fixtures, not ?demo. An explicit ?freeze= still wins.
  if (freezeArg !== '0' && (demo ? freezeArg : (useFixtures || mode || freezeArg))) {
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

  // The demo cannot freeze the clock -- tickVoteTimer derives its display from
  // Date.now() - syncedAt, so a fixed clock makes the vote timer step rather than
  // run. But a live clock put a vote in progress on a real Saturday, with the
  // header reading today's date and OUT OF SESSION beside a running tally.
  //
  // Shift instead of freeze: time still advances at one second per second, so the
  // timer runs, but it reads as the session the demo is actually portraying --
  // 16 September 2026, at the moment the archived video is seeked to.
  const DEMO_CLOCK = '2026-09-16T22:49:00Z';   // 6:49 pm ET, roll call 311
  if (demo && !freezeArg) {
    const target = Date.parse(DEMO_CLOCK);
    if (Number.isFinite(target)) {
      const RealDate = Date;
      const delta = target - RealDate.now();
      const Shifted = function (...args) {
        return args.length === 0 ? new RealDate(RealDate.now() + delta) : new RealDate(...args);
      };
      Shifted.prototype = RealDate.prototype;
      Shifted.now = () => RealDate.now() + delta;
      Shifted.parse = RealDate.parse;
      Shifted.UTC = RealDate.UTC;
      window.Date = Shifted;
      log('clock shifted to', new RealDate(target).toISOString(), '(still running)');
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
    // Longer key than /api/congress-index, and ROUTE_KEYS is sorted longest
    // first, so the roll fetch resolves here rather than being handed the index.
    '/api/congress-index/roll/':        'roll-call.xml',
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
    demo ? `${BASE}demo/${name}` : (mode ? `${BASE}modes/${mode}/${name}` : null);

  // Per-mode file if one exists, else the shared capture.
  const cache = new Map();
  async function loadFixture(name) {
    if (cache.has(name)) return cache.get(name);
    const p = (async () => {
      // Cloudflare Pages answers an unknown path with index.html and status 200,
      // so r.ok is true for a fixture that does not exist and the caller gets a
      // page of HTML where it expected JSON. Test for that page specifically --
      // an earlier version rejected anything starting with '<', which also threw
      // away the roll-call XML fixture the absentee panel reads.
      const usable = (text) => {
        if (!text) return false;
        const head = text.trimStart().slice(0, 120).toLowerCase();
        return !head.startsWith('<!doctype html') && !head.startsWith('<html');
      };
      // The demo runs on a live clock, so a fixture with a fixed publishedAt
      // would age out of the vote timeline's lookback window. Fixtures mark the
      // spots with PLACEHOLDER_PUBLISHED and they are stamped at load time.
      const dated = (text) => {
        if (!text.includes('PLACEHOLDER_')) return text;
        const at = new Date(Date.now() - 20 * 60 * 1000);
        // The notice's own "At approximately H:MM a.m./p.m." has to move with the
        // timestamp, or the panel reports a series that ended before it started.
        const et = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
        }).format(at).replace(/\u202f/g, ' ').replace(/AM/, 'a.m.').replace(/PM/, 'p.m.');
        return text.replace(/PLACEHOLDER_PUBLISHED/g, at.toISOString())
                   .replace(/PLACEHOLDER_START/g, et);
      };

      for (const url of [fixtureUrl(name), demo && mode ? `${BASE}modes/${mode}/${name}` : null]) {
        if (!url) continue;
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) continue;
        const text = await r.text();
        if (usable(text)) return dated(text);
      }
      const r = await fetch(BASE + 'base/' + name, { cache: 'no-store' });
      if (!r.ok) throw new Error(`fixture missing: ${name}`);
      const text = await r.text();
      if (!usable(text)) throw new Error(`fixture missing: ${name} (server returned a page)`);
      return text;
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

  // ── Demo banner ────────────────────────────────────────────────────────────
  // Nothing on this board is live in demo mode, and several panels are designed
  // to look convincing -- a running tally, a chamber full of real names, footage
  // of the actual floor. Say so plainly and permanently rather than relying on
  // the URL, which is the first thing lost in a screenshot.
  //
  // The header is position:fixed at top:0, so the bar cannot simply be prepended:
  // it is fixed above the header, the header is pushed down by its height, and
  // the same amount is added to the body so normal-flow content follows.
  if (demo) {
    const BAR_H = 34;
    const style = document.createElement('style');
    style.textContent = `
      .demo-banner {
        position: fixed; top: 0; left: 0; right: 0; height: ${BAR_H}px;
        z-index: 1001; display: flex; align-items: center; justify-content: center;
        gap: .75em; padding: 0 1em; box-sizing: border-box;
        background: #f0b429; color: #1a1205;
        font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: .04em; text-transform: uppercase;
        box-shadow: 0 1px 6px rgba(0,0,0,.45);
      }
      .demo-banner b { font-weight: 800; letter-spacing: .12em; }
      .demo-banner span { text-transform: none; letter-spacing: 0; font-weight: 500; }
      .demo-banner a { color: inherit; font-weight: 700; text-underline-offset: 3px; }
      .demo-banner .demo-modes {
        font: inherit; text-transform: none; letter-spacing: 0;
        background: rgba(0,0,0,.12); color: inherit;
        border: 1px solid rgba(0,0,0,.35); border-radius: 4px;
        padding: 2px 4px; max-width: 46vw;
      }
      .demo-banner .short { display: none; }
      /* Narrow screens get a shorter warning, never none: the word DEMO on its
         own is not a statement that the numbers are fabricated. */
      @media (max-width: 760px) {
        .demo-banner { gap: .5em; font-size: 11px; }
        .demo-banner .long { display: none; }
        .demo-banner .short { display: inline; }
      }
    `;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'demo-banner';
    bar.setAttribute('role', 'note');
    // A picker, because otherwise the other 23 modes are undiscoverable -- they
    // exist only as a query string nobody would guess.
    const picker = document.createElement('select');
    picker.className = 'demo-modes';
    picker.setAttribute('aria-label', 'Floor mode');
    picker.onchange = () => {
      const p = new URLSearchParams(location.search);
      p.set('demo', '1');
      if (picker.value === 'vote') p.delete('mode'); else p.set('mode', picker.value);
      location.search = p.toString();
    };
    fetch(BASE + 'modes/index.json', { cache: 'no-store' })
      .then(r => r.json())
      .then(list => {
        const names = Array.isArray(list) ? list : (list.modes || []);
        for (const n of names) {
          const name = typeof n === 'string' ? n : n.name;
          if (!name) continue;
          const o = document.createElement('option');
          o.value = name;
          o.textContent = name.replace(/-/g, ' ');
          if (name === (mode || 'vote')) o.selected = true;
          picker.appendChild(o);
        }
      })
      .catch(() => { picker.hidden = true; });

    bar.innerHTML = '<b>Demo</b>'
      + '<span class="long">Nothing here is live \u2014 the tally is a scripted replay and the '
      + 'video is an archived session.</span>'
      + '<span class="short">Simulated data \u2014 not live</span>'
      + '<a href="/">Live board \u2192</a>';
    bar.insertBefore(picker, bar.querySelector('a'));

    const install = () => {
      if (!document.body || document.querySelector('.demo-banner')) return;
      document.body.insertBefore(bar, document.body.firstChild);
      document.body.style.paddingTop = `${BAR_H}px`;
      const header = document.querySelector('.main-header');
      if (header) header.style.top = `${BAR_H}px`;
      log('demo banner installed');
    };
    if (document.body) install();
    else document.addEventListener('DOMContentLoaded', install);
  }

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
        // app.js only loads the cold-start bundle — which carries rollLog, the
        // input to applyRollLogToBills — when the stream announces itself with a
        // `connected` event saying the server's caches are cold. Without this the
        // harness never exercises the roll-call path at all, so bills sit on
        // whatever status the proceedings text gave them. clientId is omitted on
        // purpose: it would start a POST ping loop with nothing to talk to.
        const connected = { type: 'connected', data: JSON.stringify({ rollLogCold: true, whipFeedCold: true }) };
        (this._l.connected || []).forEach(f => f(connected));

        // Replay the pushes the Durable Object normally makes. The bills panel
        // in particular is only populated by the `bills` event in normal
        // operation — fetchBillsThisWeek() is reached only for date overrides —
        // so without this replay the panel renders "No bills subject to a rule"
        // and none of the bills logic can be exercised in the harness at all.
        loadFixture('bills.json').then(text => {
          const ev = { type: 'bills', data: JSON.stringify({ bills: JSON.parse(text) }) };
          (this._l.bills || []).forEach(f => f(ev));
        }).catch(() => {});

        // The static vote fixture shows the layout but not what the board is for:
        // watching a close vote come in. In demo mode, push the recorded tally
        // sequence the way the Durable Object pushes the real one.
        // Vote mode only. A tally sets currentStatus to 'vote', so replaying one
        // under ?demo&mode=debate dragged the vote display back over the debate
        // panel and the board showed both at once.
        if (demo && mode === 'vote' && /votes|stream/.test(String(url))) this._startTallyReplay();
      }, 0);
    }
    _startTallyReplay() {
      fetch(BASE + 'demo/tally-replay.json', { cache: 'no-store' })
        .then(r => r.json())
        .then(({ intervalMs, frames, bill, rollCall, question }) => {
          let i = 0;
          const tick = () => {
            if (this.readyState === 2) return;            // closed — stop
            const f = frames[i];
            const ev = { type: 'vote.tally', data: JSON.stringify({ vote: {
              roll_call: { bill, number: rollCall, question },
              counts: f.counts,
              timer: { ...f.timer, timestamp: new Date().toISOString() },
            } }) };
            (this._l['vote.tally'] || []).forEach(fn => fn(ev));
            // Loop, with a beat on the final tally so the result is readable
            // before it resets rather than snapping straight back to 0-0. Fixed
            // rather than a multiple of intervalMs, which at the current cadence
            // would freeze the board for half a minute.
            i = (i + 1) % frames.length;
            this._replayTimer = setTimeout(tick, i === 0 ? 6000 : intervalMs);
          };
          tick();
          log(`demo: replaying ${frames.length} tally frames every ${intervalMs}ms`);
        })
        .catch(e => warn('demo tally replay unavailable:', e.message));
    }
    addEventListener(t, f) { (this._l[t] ||= []).push(f); }
    removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter(x => x !== f); }
    close() { this.readyState = 2; clearTimeout(this._replayTimer); }
  };
  window.EventSource.CONNECTING = 0;
  window.EventSource.OPEN = 1;
  window.EventSource.CLOSED = 2;

  // ── Live video ─────────────────────────────────────────────────────────────
  // Both HLS call sites guard on `window.Hls`, so a non-writable stub keeps the
  // Capitol cam and floor-feed players off the network. hls.js assigns to
  // window.Hls in sloppy mode, where writing a non-writable property is a
  // silent no-op, so this survives its later <script>.
  // The demo wants the real player: dev/fixtures/demo/hls-url.json points at an
  // archived session (a VOD manifest, so it is seekable), and SEEK_TO skips the
  // hours of holding card before the House actually convenes. Nothing is hosted
  // here -- the Clerk serves it, and the broadcast metadata states the footage is
  // a US Government work in the public domain.
  const DEMO_SEEK_SECONDS = 35826;   // 18:49 ET, roll call 311, stream began 08:51:54
  if (demo) {
    const seekOnce = (v) => {
      if (v.dataset.demoSeeked) return;
      // Guard on duration: the Capitol cam is a different, shorter source and
      // must not be dragged to an offset it does not have.
      if (!isFinite(v.duration) || v.duration < DEMO_SEEK_SECONDS + 60) return;
      v.dataset.demoSeeked = '1';
      v.currentTime = DEMO_SEEK_SECONDS;
      v.play?.().catch(() => {});
      log(`demo: seeking floor feed to ${DEMO_SEEK_SECONDS}s`);

      // app.js snaps this player to the live edge in four places (currentTime =
      // dur - 1, edge - 4, and so on) as segments load, which drags the demo to
      // the end of the archive -- where the recording is a holding card for the
      // next day. Hold the position while those fire, then stop so the viewer
      // keeps control of the scrubber.
      const startedAt = Date.now();
      const hold = setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 1000;
        if (elapsed > 25) { clearInterval(hold); return; }
        const expected = DEMO_SEEK_SECONDS + elapsed;
        if (Math.abs(v.currentTime - expected) > 300) {
          v.currentTime = expected;
          v.play?.().catch(() => {});
        }
      }, 1000);
    };
    const watch = (v) => {
      seekOnce(v);
      v.addEventListener('loadedmetadata', () => seekOnce(v));
      v.addEventListener('durationchange', () => seekOnce(v));
    };
    document.querySelectorAll('video').forEach(watch);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeName === 'VIDEO') watch(n);
      else if (n.querySelectorAll) n.querySelectorAll('video').forEach(watch);
    }))).observe(document.documentElement, { childList: true, subtree: true });
  } else {
    try {
      Object.defineProperty(window, 'Hls', {
        value: { isSupported: () => false, Events: {}, ErrorTypes: {} },
        writable: false, configurable: false,
      });
    } catch { /* non-fatal: worst case the players try to load */ }
  }

  // ── Remote images ──────────────────────────────────────────────────────────
  // <img src> never passes through window.fetch, so tweet avatars and media
  // (proxied via /api/img-proxy) go to the real network. In practice ~27 per
  // page never resolve, which leaves layout settling at a different moment on
  // every run — the baseline then reports a different random handful of modes
  // as "changed". Swapping every remote image for one fixed placeholder makes
  // capture deterministic. Sizes come from CSS, not the intrinsic image, so the
  // layout under test is unaffected.
  const PLACEHOLDER =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="%23233044"/></svg>');

  const isRemote = src => /^https?:\/\//i.test(src) && !src.startsWith(location.origin);
  const swap = img => {
    const src = img.getAttribute('src');
    if (src && isRemote(src)) img.setAttribute('src', PLACEHOLDER);
  };
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.target.tagName === 'IMG') swap(m.target);
      for (const n of m.addedNodes || []) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'IMG') swap(n);
        else n.querySelectorAll && n.querySelectorAll('img').forEach(swap);
      }
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['src'],
  });

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
