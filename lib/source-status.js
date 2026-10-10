// Is each source still answering? Both boards. A small dot at the start of each link in the footer's list of data sources, and a
// line in a panel's source popover (lib/source-pop.js asks `statusFor`). The panels' own source links carry no dot.
//
// The Worker's /api/status (see handleSourceStatus) asks each source and keeps the answer ten minutes; this draws it. A link
// whose source the Worker does not check gets no dot, and nothing is drawn at all while the answer is missing or stale: the
// page would be claiming a status it does not know. The dot's shape as well as its colour says which state it is (a circle is
// fine, a triangle is slow or flaky, a diamond is down), and it carries the same words for a screen reader.

(function (root) {
  'use strict';

  const LINKS = '.footer-sources a[href^="http"]';
  const STALE_MS = 30 * 60 * 1000;
  const EVERY_MS = 5 * 60 * 1000;

  // Which of the Worker's checks speak for a link, by where it points.
  const MAP = [
    [/clerk\.house\.gov\/FloorSummary/, ['clerk-feed']],
    [/clerk\.house\.gov\/Votes/, ['clerk-votes']],
    [/clerk\.house\.gov\/xml\/lists\/MemberData/, ['clerk-members']],
    [/docs\.house\.gov\/BillsThisWeek/, ['house-docs']],
    [/docs\.house\.gov\/Committee/, ['house-committees']],
    [/clerk\.house\.gov\/DischargePetition/, ['house-discharge']],
    [/votingdays\.house\.gov/, ['voting-days']],
    [/domewatch\.us/, ['domewatch']],
    [/nasstatus\.faa\.gov/, ['faa']],
    [/senate\.gov\/legislative\/votes_new/, ['senate-votes']],
    [/senate\.gov\/legislative\/schedule\/floor_schedule/, ['senate-schedule']],
    [/senate\.gov\/legislative\/LIS\/nominations/, ['senate-nominations']],
    [/senate\.gov\/legislative\/LIS\/floor_activity\/floor_activity/, ['senate-floor-activity']],
    [/senate\.gov\/general\/contact_information\/senators_cfm/, ['senate-roster']],
    [/democrats\.senate\.gov/, ['senate-democrats']],
    [/senate\.gov\/general\/capcam/, ['capcam']],
    [/weather\.gov/, ['nws']],
    [/live\.house\.gov/, ['house-live']],
    [/rules\.house\.gov/, ['house-rules']],
    [/www\.house\.gov\/voting-days/, ['house-voting-days']],
    [/govinfo\.gov/, ['govinfo']],
    [/cbo\.gov/, ['cbo']],
    [/federalregister\.gov/, ['federal-register']],
    [/pressgallery\.house\.gov/, ['press-gallery']],
    [/wikipedia\.org/, ['wikipedia']],
    [/commons\.wikimedia\.org/, ['wikimedia']],
    [/lxndrblz\/Airports/, ['airports']],
    [/senate\.gov\/floor\/?$/, ['senate-floor']],
  ];
  const WORDS = { ok: 'responding', warn: 'slow or unreliable', fail: 'not responding' };
  const RANK = { ok: 0, warn: 1, fail: 2 };

  let latest = null;

  function when(ms) {
    return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  }

  // The worst state among a link's checks, with the words to go with it.
  function verdict(ids, data) {
    let worst = null;
    for (const id of ids) {
      const s = data.sources[id];
      if (s && (!worst || RANK[s.state] > RANK[worst.state])) worst = s;
    }
    return worst;
  }

  // The state is an attribute on the link itself and CSS draws the dot before its text (a:before), so it cannot wrap away from
  // the link: the footer's sources are block links in a column, where a sibling element lands on a line of its own. The words
  // for a screen reader are a visually hidden span inside the link.
  function clear(a) {
    delete a.dataset.sourceState;
    const sr = a.querySelector(':scope > .source-status-words');
    if (sr) sr.remove();
    if (a.dataset.statusTitle) { a.removeAttribute('title'); delete a.dataset.statusTitle; }
  }

  function paint() {
    const data = latest;
    const fresh = data && data.sources && Date.now() - data.at < STALE_MS;
    for (const a of document.querySelectorAll(LINKS)) {
      const entry = MAP.find(([re]) => re.test(a.href));
      const s = fresh && entry ? verdict(entry[1], data) : null;
      if (!s) { clear(a); continue; }
      a.dataset.sourceState = s.state;
      const text = 'Source ' + WORDS[s.state] + (s.detail ? ': ' + s.detail : '') + '. Checked ' + when(data.at) + '.';
      let sr = a.querySelector(':scope > .source-status-words');
      if (!sr) {
        sr = document.createElement('span');
        sr.className = 'source-status-words';
        a.append(sr);
      }
      sr.textContent = ' (' + text + ')';
      // a link that already has a title of its own keeps it
      if (!a.title || a.dataset.statusTitle) { a.title = text; a.dataset.statusTitle = '1'; }
    }
  }

  // For the popover: how the source behind a link is doing now, or null when it is not known (not a checked source, no answer
  // yet, or the answer is stale).
  function statusFor(href) {
    const data = latest;
    if (!data || !data.sources || Date.now() - data.at >= STALE_MS) return null;
    const entry = MAP.find(([re]) => re.test(href));
    const s = entry && verdict(entry[1], data);
    if (!s) return null;
    const words = WORDS[s.state];
    return { state: s.state, text: words.charAt(0).toUpperCase() + words.slice(1) + (s.detail ? ': ' + s.detail : '') + '. Checked ' + when(data.at) + '.' };
  }

  async function refresh(api) {
    try {
      const r = await fetch(api + '/status');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      latest = await r.json();
    } catch (e) { /* keep what there is: paint() drops it once it is stale */ }
    paint();
  }

  function start() {
    const api = 'https://api.evanhollander.org/' + (document.documentElement.dataset.chamber === 'senate' ? 'senate-floor' : 'house-floor') + '/api';
    const go = () => refresh(api);
    // Not in the way of the first paint, which has the panels to load.
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
    setInterval(() => { if (!document.hidden) go(); }, EVERY_MS);
  }

  document.addEventListener('DOMContentLoaded', start);
  root.SourceStatus = { paint, statusFor, MAP };
})(typeof globalThis !== 'undefined' ? globalThis : this);
