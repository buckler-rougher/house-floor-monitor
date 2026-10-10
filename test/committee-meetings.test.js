#!/usr/bin/env node
//
// lib/committee-meetings.js: the Clerk's committee calendar for a day. test/committee-day.html is three rows of 16 September 2026's table as the
// Clerk sent it (a markup naming two bills, a hearing, a subcommittee's), test/committee-empty-day.html the table of a day with no meetings. No network.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CM = require('../lib/committee-meetings.js');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('each row is a meeting: title, committee, time, room, and the Clerk\'s link to it', () => {
  const r = CM.parseDay(read('committee-day.html'));
  assert.strictEqual(r.events.length, 3);
  assert.deepStrictEqual(r.events[0], {
    id: '119566',
    title: 'H.R. 4464, the Preventive Health Savings Act; H.R. 6470, the Increasing Baseline Updates Act',
    committee: 'Committee on the Budget', time: '9:30 AM', location: '210 CHOB',
    url: 'https://docs.house.gov/Committee/Calendar/ByEvent.aspx?EventID=119566',
  });
  assert.strictEqual(r.events[1].title, '"Increasing Demand and Opportunities for Homegrown Products Here and Abroad"');
});

ok('a subcommittee row keeps its parent: the committee text is whitespace-collapsed, nothing else', () => {
  const sub = CM.parseDay(read('committee-day.html')).events[2];
  assert.match(sub.committee, /^Subcommittee on .+ \(Committee on Appropriations\)$/);
  assert.ok(!/\s{2}|\n/.test(sub.committee));
});

ok('entities come out as characters, hex ones too', () => {
  const r = CM.parseDay('<table id="MainContent_GridViewMeetings"><tr><td><a href="ByEvent.aspx?EventID=1">Members&#x27; Day &amp; more</a><br /><span class="text-tiny">Committee on X</span></td><td><span class="text-small">9:00 AM</span></td><td><span class="text-small">1 RHOB</span></td></tr></table>');
  assert.strictEqual(r.events[0].title, "Members' Day & more");
});

ok('the table is kept as sent, less layout attributes, for a source popover', () => {
  const t = CM.parseDay(read('committee-day.html')).table;
  assert.ok(t.startsWith('<table') && t.endsWith('</table>'));
  assert.ok(t.includes('EventID=119566') && !/style=|cellspacing=/.test(t));
});

ok('a day with no meetings is an empty list; a page with no calendar table is not a day at all', () => {
  assert.deepStrictEqual(CM.parseDay(read('committee-empty-day.html')).events, []);
  assert.strictEqual(CM.parseDay('<html><body>Service unavailable</body></html>'), null);
  assert.strictEqual(CM.parseDay(''), null);
  assert.strictEqual(CM.parseDay(null), null);
});

console.log(`\n${n} passed`);
