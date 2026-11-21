// STAGING ONLY, TEMPORARY. Every empty state on the House and Senate sites, drawn with the real stylesheet and the real EmptyState helper (lib/empty-state.js), in the shape of the place it appears
// (a whole panel, a column beside other columns, the calendar's week strip, an opened row, a dialog), so the proposed look of each can be judged in place.
// Delete this file, empty-states.html, and the 404 rule in functions/_middleware.js once the states are wired into the sites.
(function () {
  'use strict';
  const E = globalThis.EmptyState;
  const big = (shape, title, text, next) => E.html({ shape, title, text, next });
  const hdr = (icon, label) => `<div class="panel-header"><span class="panel-label" data-icon="${icon}">${label.toUpperCase()}</span></div>`;
  const panel = (icon, label, inner) => `<div class="vote-series-panel">${hdr(icon, label)}<div class="vote-series-body">${inner}</div></div>`;
  const colHead = (t) => `<div class="bills-column-header"><div class="bills-column-header-left"><span class="bills-column-title">${t}</span></div></div>`;
  const cols = (icon, label, cs) => `<div class="vote-series-panel">${hdr(icon, label)}<div class="pipe-cols">${cs.map(([t, html]) => `<div class="pipe-col">${colHead(t)}<div class="pipe-list">${html}</div></div>`).join('')}</div></div>`;
  const G = [
    ['House: whole panels', [
      ['Vote Series', 'No active vote series', panel('ballot', 'Vote Series', big('timeline', 'No active vote series', 'Each vote will appear here as a step, in the order it is called.'))],
      ['Vote Series', 'No vote series announced yet', panel('ballot', 'Vote Series', big('timeline', 'No vote series announced yet', 'The Democratic Whip posts a series when the House schedules a run of votes.'))],
      ['Vote Series', 'No votes listed in notice', panel('ballot', 'Vote Series', big('timeline', 'The notice lists no votes', 'When it names them, they will appear here in order.'))],
      ['Dem Whip Notices', 'No notices today.', panel('megaphone', 'Dem Whip Notices', big('cards', 'No notices today', 'The Democratic Whip’s notices appear here as they are posted.'))],
      ['Dem Whip Notices, filtered', 'No Floor Update notices.', panel('megaphone', 'Dem Whip Notices', big('cards', 'No floor updates', 'Clear the filter to see the other notices.'))],
      ['Committee Meetings', 'No committee meetings today', panel('group', 'Committee Meetings', big('rows', 'No committee meetings today', 'Meetings are listed here on days committees meet.'))],
      ['Member-initiated Floor Action', 'No open petitions', panel('sign', 'Member-initiated Floor Action', big('doc', 'No open petitions', 'A discharge petition appears here from its first signature.'))],
    ]],
    ['House: columns, strips, and dialogs', [
      ['Bills This Week, two columns (see the live switcher on the House staging page for the real panel)', 'No bills subject to a rule', cols('doc', 'Bills This Week', [['SUBJECT TO A RULE', E.column('No bills subject to a rule', 'All 15 of this week’s bills are under suspension.')], ['UNDER SUSPENSION (15)', E.column('No bills under suspension', 'All 15 of this week’s bills are subject to a rule.')]])],
      ['Bills This Week, tracked filter on', 'No tracked bills', cols('doc', 'Bills This Week', [['SUBJECT TO A RULE', E.column('No tracked bills', 'Track a bill from its card and it will be kept here.')], ['UNDER SUSPENSION', E.column('No tracked bills', 'Track a bill from its card and it will be kept here.')]])],
      ['Waiting for the Floor, two columns', 'Nothing waiting', cols('hourglass', 'Waiting for the Floor', [['REPORTED BY COMMITTEES', E.column('Nothing waiting', 'Bills reported by committees appear here, waiting for a floor vote.')], ['FROM THE SENATE', E.column('Nothing waiting', 'Senate bills the House holds appear here.')]])],
      ['House Calendar, the week strip', 'No votes scheduled this week', `<div class="vote-series-panel">${hdr('calendar', 'House Calendar')}<div class="this-week-strip"><span class="this-week-label">THIS WEEK</span><span class="this-week-body">${E.week('No votes scheduled this week')}</span></div></div>`],
      ['Committee meeting, opened', 'Nothing posted yet', `<div class="vote-series-panel">${hdr('group', 'Committee Meetings')}<div class="vote-series-body" style="padding:var(--sp-16) var(--sp-24)"><div class="committee-detail">${E.detail('Nothing posted yet. Witnesses and documents appear here when the committee posts them.')}</div></div></div>`],
      ['Petition signers, a search with no match', 'No matching signers', panel('sign', 'Signers', `<div style="padding:var(--sp-8) 0">${E.search('Smth')}</div>`)],
      ['Missing Members', 'ALL MEMBERS VOTED', panel('missing', 'Missing Members', E.ok('All Members voted', { n: 433, of: 433 }))],
    ]],
    ['Senate', [
      ['Floor notices', 'No floor notices', panel('megaphone', 'Floor notices', big('cards', 'No floor notices', 'The Senate’s notices appear here as they are posted.'))],
      ['Nominations, three of its columns', 'None at this stage', cols('nom', 'Nominations', [['ON THE EXECUTIVE CALENDAR', E.column('None at this stage', 'Nominations reported by committee wait here for floor time.')], ['IN COMMITTEE', E.column('None at this stage', 'Nominations referred to a committee appear here.')], ['CONFIRMED', E.column('None at this stage', 'Confirmed nominations appear here.')]])],
      ['Procedural Stages, two columns', 'Nothing at this stage', cols('stairs', 'Procedural Stages', [['PASSAGE AND CONFIRMATION', E.column('Nothing at this stage', 'A measure waits here for its final vote.')], ['CLOTURE ON THE MEASURE', E.column('Nothing at this stage', 'A cloture vote on a measure appears here.')]])],
      ['Treaties', 'No treaties pending', panel('treaty', 'Treaties', big('doc', 'No treaties pending', 'A treaty appears here once it is sent to the Senate for advice and consent.'))],
      ['Committee Meetings', 'No committee meetings scheduled in the next week', panel('group', 'Committee Meetings', big('rows', 'No meetings this week', 'Committee meetings for the next seven days are listed here.'))],
      ['Missing Senators', 'ALL SENATORS VOTED', panel('missing', 'Missing Senators', E.ok('All Senators voted', { n: 100, of: 100 }))],
    ]],
    ['When a source cannot be read (a different look from "nothing here")', [
      ['Bills This Week', 'The Clerk’s bill list could not be read', panel('doc', 'Bills This Week', E.error('The bill list could not be read', 'Showing the last copy we have. This panel retries on its own.'))],
      ['Petition signers', 'The signer list could not be read', panel('sign', 'Signers', E.error('The signer list could not be read', 'The House Clerk did not answer. This panel retries on its own.'))],
      ['Waiting for the Floor, a column', 'Unavailable', cols('hourglass', 'Waiting for the Floor', [['REPORTED BY COMMITTEES', E.error('Unavailable', 'Retrying.')], ['FROM THE SENATE', E.error('Unavailable', 'Retrying.')]])],
    ]],
  ];
  const q = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  document.getElementById('eg').innerHTML = '<h1>Empty states</h1><p>Every empty state on both sites, each in the shape of the place it appears, with the real styles. The note above each frame says where it is and what it says now. Staging only.</p>'
    + G.map(([h, items]) => `<h2>${h}</h2>` + items.map(([where, was, html]) => `<div class="eg-item"><p class="eg-was"><b>${q(where)}</b> &middot; now: <code>${q(was)}</code></p>${html}</div>`).join('')).join('');
})();
