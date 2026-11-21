// STAGING ONLY, TEMPORARY. Every empty state on the House and Senate sites, drawn with the real stylesheet and the real EmptyState helper (lib/empty-state.js), in a real panel frame,
// so the proposed look of each can be judged in place. Delete this file, empty-states.html, and the 404 rule in functions/_middleware.js once the states are wired into the sites.
(function () {
  'use strict';
  const E = globalThis.EmptyState;
  const big = (shape, title, text, next) => E.html({ shape, title, text, next });
  const G = [
    ['House', [
      ['ballot', 'Vote Series', 'No active vote series', big('timeline', 'No active vote series', 'Each vote will appear here as a step, in the order it is called.')],
      ['ballot', 'Vote Series', 'No vote series announced yet', big('timeline', 'No vote series announced yet', 'The Democratic Whip posts a series when the House schedules a run of votes.')],
      ['ballot', 'Vote Series', 'No votes listed in notice', big('timeline', 'The notice lists no votes', 'When it names them, they will appear here in order.')],
      ['megaphone', 'Dem Whip Notices', 'No notices today.', big('cards', 'No notices today', 'The Democratic Whip’s notices appear here as they are posted.')],
      ['megaphone', 'Dem Whip Notices (filtered)', 'No Floor Update notices.', big('cards', 'No floor updates', 'Clear the filter to see the other notices.')],
      ['doc', 'Bills This Week', 'No bills under suspension / No bills subject to a rule', big('rows', 'No bills under suspension', 'Bills the House takes up under suspension are listed here.')],
      ['doc', 'Bills This Week (tracked)', 'No tracked bills', big('rows', 'No tracked bills', 'Track a bill from its card and it will be kept here.')],
      ['group', 'Committee Meetings', 'No committee meetings today', big('rows', 'No committee meetings today', 'Meetings are listed here on days committees meet.')],
      ['sign', 'Member-initiated Floor Action', 'No open petitions', big('doc', 'No open petitions', 'A discharge petition appears here from its first signature.')],
      ['sign', 'Petition signers (dialog)', 'No matching signers', E.small('No signers match that search')],
      ['hourglass', 'Waiting for the Floor (columns)', 'Nothing waiting', E.small('Nothing waiting')],
      ['calendar', 'House Calendar', 'No votes scheduled this week', E.small('No votes scheduled this week')],
      ['group', 'Committee meeting detail', 'Nothing posted yet', E.small('Nothing posted yet')],
      ['missing', 'Missing Members', 'ALL MEMBERS VOTED', E.ok('All 433 Members voted')],
    ]],
    ['Senate', [
      ['megaphone', 'Floor notices', 'No floor notices', big('cards', 'No floor notices', 'The Senate’s notices appear here as they are posted.')],
      ['nom', 'Nominations (a column)', 'None at this stage', E.small('None at this stage')],
      ['stairs', 'Procedural Stages (a column)', 'Nothing at this stage', E.small('Nothing at this stage')],
      ['treaty', 'Treaties', 'No treaties pending', big('doc', 'No treaties pending', 'A treaty appears here once it is sent to the Senate for advice and consent.')],
      ['group', 'Committee Meetings', 'No committee meetings scheduled in the next week', big('rows', 'No meetings this week', 'Committee meetings for the next seven days are listed here.')],
      ['missing', 'Missing Senators', 'ALL SENATORS VOTED', E.ok('All 100 Senators voted')],
    ]],
    ['When a source cannot be read (a different look from "nothing here")', [
      ['doc', 'Bills This Week', 'The Clerk’s bill list could not be read', E.error('The bill list could not be read', 'Showing the last copy we have. This panel retries on its own.')],
      ['sign', 'Petition signers', 'The signer list could not be read', E.error('The signer list could not be read', 'The House Clerk did not answer. This panel retries on its own.')],
      ['hourglass', 'Waiting for the Floor (columns)', 'Unavailable', E.error('Unavailable', 'Retrying.')],
    ]],
  ];
  const el = document.getElementById('eg');
  el.innerHTML = '<h1>Empty states</h1><p>Every empty state on both sites, in a real panel frame with the real styles. The note above each frame says where it appears and what it says now. Staging only.</p>'
    + G.map(([h, items]) => `<h2>${h}</h2>` + items.map(([icon, panel, was, html]) =>
      `<div class="eg-item"><p class="eg-was"><b>${panel}</b> &middot; now: <code>${was.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></p>`
      + `<div class="vote-series-panel"><div class="panel-header"><span class="panel-label" data-icon="${icon}">${panel.toUpperCase()}</span></div><div class="vote-series-body">${html}</div></div></div>`).join('')).join('');
})();
