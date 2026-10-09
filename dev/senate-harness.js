/**
 * Senate Floor Monitor -- development harness.  NOT loaded in normal page views.
 *
 * senate.html only pulls this in when the URL carries ?fixtures, ?state or ?freeze. Like
 * dev/harness.js for the House, it exists so the page renders OFFLINE and the same way twice:
 * the Worker's CORS allowlist rejects localhost, and most of what the Senate board shows
 * (a quorum call, a vote, the leaders' remarks) only exists while the Senate is doing it.
 *
 *   ?fixtures                 serve every API call from dev/fixtures/senate/
 *   ?fixtures&state=vote      ...and put the board in a state (below)
 *   ?freeze=0                 do not pin the clock (default 2026-09-30T14:00:00Z)
 *   ?fixtures&bill=s4668      open a bill's modal (s4668, hr7008 have fixtures)
 *
 * STATES  idle (default)  prayer  pledge  morning-business  wrap-up  leader  quorum  vote  ended
 *         plan   the Senate is in at 11:30 a.m. on 30 September with nothing heard on the captions and no votes taken yet: the
 *                debate panel comes from today's Democratic Caucus schedule post (H.R.7008, then H.R.9340 once its vote is in)
 *         scott-bare  scott-state  scott-quorum   (the two Scotts: a surname alone, and with the state read)
 *
 * The states go through the real code paths: the floor mode is what /senate/quorum returns
 * (lib/senate-quorum.js hands it to senate.js, as in production), and a call is built by
 * feeding captions to lib/senate-call.js, the same module the Worker runs.
 */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  if (!(q.has('fixtures') || q.has('state') || q.has('freeze'))) return;

  const BASE = new URL('dev/fixtures/senate/', new URL('.', location.href)).href;
  const state = q.get('state') || 'idle';
  const log = (...a) => console.info('%c[senate-harness]', 'color:#58a6ff;font-weight:bold', ...a);

  // Whatever a previous visit left in this browser (a call restored by lib/senate-quorum.js, the
  // viewer's sort and filter) would make two loads of the same state differ.
  try { for (const k of ['senate-call', 'senate-board-view']) localStorage.removeItem(k); } catch (e) { /* storage blocked */ }

  // Always refetch the stylesheet: styles.css?v=NNN is its own URL, so a cache-busted page
  // still serves the old CSS, and a before/after comparison then compares a mix.
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    link.href = link.href.replace(/[?&]_hcb=\d+/, '') + (link.href.includes('?') ? '&' : '?') + '_hcb=' + Date.now();
  }

  const FIXED = Date.parse(q.get('freeze') && q.get('freeze') !== '1' && q.get('freeze') !== '0' ? q.get('freeze') : (state === 'plan' ? '2026-09-30T15:30:00Z' : '2026-09-30T14:00:00Z'));
  if (q.get('freeze') !== '0') {
    const RealDate = Date;
    const Frozen = function (...a) { return a.length === 0 ? new RealDate(FIXED) : new RealDate(...a); };
    Frozen.prototype = RealDate.prototype; Frozen.now = () => FIXED; Frozen.parse = RealDate.parse; Frozen.UTC = RealDate.UTC;
    window.Date = Frozen;
    log('clock frozen at', new RealDate(FIXED).toISOString());
  }

  // What each state says. Captions are fed to lib/senate-call.js.
  const NAMES = ['ALLARD','BALDWIN','BARRASSO','BENNET','BLACKBURN','BOOKER','BRAUN','BRITT','BROWN','BUDD','CANTWELL','CAPITO','CARDIN','CASSIDY','COLLINS','COONS','CORNYN','COTTON','CRAMER','CRAPO'];
  const captions = {
    quorum: 'THE CLERK WILL CALL THE ROLL. ' + NAMES.map((n) => `MR. ${n}.`).join(' '),
    vote: 'THE QUESTION IS ON THE MOTION TO INVOKE CLOTURE. THE CLERK WILL CALL THE ROLL. ' +
      NAMES.map((n, i) => `MR. ${n}, ${i % 3 === 1 ? 'NO' : 'AYE'}.`).join(' '),
    // The two Scotts. The clerk reads a state after a surname only where two senators share it
    // ("Mr. SCOTT of Florida"; the wording is the Record's, not confirmed against a caption).
    'scott-bare': 'THE QUESTION IS ON THE MOTION TO INVOKE CLOTURE. THE CLERK WILL CALL THE ROLL. MR. SCHUMER, AYE. MR. SCOTT, AYE. MR. SHAHEEN, NO.',
    'scott-state': 'THE QUESTION IS ON THE MOTION TO INVOKE CLOTURE. THE CLERK WILL CALL THE ROLL. MR. SCHUMER, AYE. MR. SCOTT OF FLORIDA, AYE. MR. SCOTT OF SOUTH CAROLINA, NO. MR. SHAHEEN, NO.',
    'scott-quorum': 'THE CLERK WILL CALL THE ROLL. MR. SCHUMER. MR. SCOTT. MR. SHAHEEN.',
    ended: 'THE QUESTION IS ON THE MOTION TO INVOKE CLOTURE. THE CLERK WILL CALL THE ROLL. ' +
      NAMES.map((n, i) => `MR. ${n}, ${i % 3 === 1 ? 'NO' : 'AYE'}.`).join(' ') + ' THE YEAS ARE 53, THE NAYS ARE 47. THE MOTION IS AGREED TO.',
  };
  const modes = {
    prayer: { mode: 'prayer', since: FIXED - 20000 },
    pledge: { mode: 'pledge', since: FIXED - 5000 },
    'morning-business': { mode: 'morning-business', since: FIXED - 600000, limit: 10 },
    'wrap-up': { mode: 'wrap-up', since: FIXED - 60000 },
    debate: { mode: 'debate', bill: 'S. 4668', since: FIXED - 90000, source: 'schedule' },
    'debate-caption': { mode: 'debate', bill: 'H.R. 7008', since: FIXED - 90000 },
    'debate-unknown': { mode: 'debate', bill: 'S.J.Res. 99', title: 'A joint resolution (no record yet)', since: FIXED - 90000, source: 'schedule' },
    leader: { mode: 'leader', which: 'Majority Leader', since: FIXED - 30000, first: 'THUNE' },
  };

  const ROUTES = {
    '/senate/absences': 'senate-absences', '/senate/floor-schedule': 'senate-floor-schedule',
    '/senate/nominations': 'senate-nominations', '/senate/proceedings': 'senate-proceedings',
    '/senate/roster': 'senate-roster', '/senate/schedule': 'senate-schedule',
    '/senate/seniority': 'senate-seniority', '/senate/stages': 'senate-stages',
    '/status': 'senate-status', '/senate/stages-source': 'senate-stages-source', '/senate/session-days-source': 'senate-session-days-source',
    '/senate/desks': 'senate-desks', '/tweets': 'tweets', '/airport-delays': 'airport-delays',
  };
  const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.startsWith(BASE) || (!/^https?:/i.test(url) && !url.startsWith('//'))) return realFetch(input, init);
    const path = (url.split('/senate-floor/api')[1] || '').split('?')[0];

    if (path === '/senate/hls-url') return json({ url: null, isLive: false });
    // A bill's details: dev/fixtures/senate/senate-bill-<slug>.json (s4668, hr7008). The page's own
    // deep link opens one: /senate?fixtures&bill=s4668. Any other measure is a miss, as the
    // Worker answers one Congress.gov has no record of.
    if (path === '/senate/bill') {
      const slug = (new URL(url).searchParams.get('id') || '').toLowerCase().replace(/[\s.]+/g, '');
      try { return json(await (await realFetch(`${BASE}senate-bill-${slug}.json`)).text()); }
      catch (e) { return json({ error: `no fixture for ${slug}` }, 404); }
    }
    if (path === '/senate/quorum') {
      const SC = globalThis.SenateCall;
      let call = SC.emptyCall();
      if (captions[state]) call = SC.feed(call, captions[state], FIXED - 30000);
      return json({ stream: 'stv093026', call, summary: SC.summarize(call), updated: null, mode: modes[state] || null, live: true, names: call.names, votes: call.votes });
    }
    // One nominations file per stage: dev/fixtures/senate/senate-nominations-source-<stage>.json
    if (path === '/senate/nominations-source') {
      const stage = new URL(url).searchParams.get('stage') || '';
      try { return json(await (await realFetch(`${BASE}senate-nominations-source-${stage}.json`)).text()); }
      catch (e) { return json({ error: `no fixture for ${stage}` }, 404); }
    }
    // The plan state: the Senate came in at its announced 10:15 and has taken no vote yet (no roll calls in the window).
    if (state === 'plan' && path === '/senate/schedule') {
      const d = JSON.parse(await (await realFetch(`${BASE}senate-schedule.json`)).text());
      d.latest = { ...d.latest, convene: '2026-09-29T10:00:00-04:00', adjourn: '2026-09-29T20:00:00-04:00', proForma: false, nextConvene: '2026-09-30T10:15:00-04:00', nextIsProForma: false };
      return json(d);
    }
    if (state === 'plan' && path === '/senate/stages') {
      const d = JSON.parse(await (await realFetch(`${BASE}senate-stages.json`)).text());
      return json({ ...d, stages: {}, counts: {}, kept: 0 });
    }
    const name = ROUTES[path];
    if (name) { try { return json((await (await realFetch(`${BASE}${name}.json`)).text()).replace(/"PLACEHOLDER_NOW"/g, String(Date.now()))); } catch (e) { return json('{}'); } }
    // Anything else is blocked rather than let out: a live call brings back the nondeterminism
    // this exists to remove. (Weather, the FAA airport list and the like.)
    return json('{}');
  };
  log(`fixtures on, state "${state}"`);
})();
