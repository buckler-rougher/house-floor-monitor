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

ok('a hearing\'s own page: the witnesses with their titles and documents (https links), and the record', () => {
  const e = CM.parseEvent(read('committee-event-hearing.html'));
  assert.strictEqual(e.title, 'Hearing: "Increasing Demand and Opportunities for Homegrown Products Here and Abroad"');
  assert.strictEqual(e.committee, 'Committee on Agriculture');
  assert.strictEqual(e.time, 'Wednesday, September 16, 2026 (9:30 AM)');
  assert.strictEqual(e.location, '1300 LHOB');
  assert.strictEqual(e.witnesses.length, 6);
  assert.deepStrictEqual(e.witnesses[0].name, 'The Honorable Alexis Taylor');
  assert.strictEqual(e.witnesses[0].role, 'Chief Global Policy Officer, International Fresh Produce Association, Washington, DC');
  assert.deepStrictEqual(e.witnesses[0].docs[0], { title: 'Testimony_Taylor_09.16.2026', url: 'https://docs.house.gov/meetings/AG/AG00/20260916/119559/HHRG-119-AG00-Wstate-TaylorA-20260916.pdf' });
  assert.deepStrictEqual(e.sections.map((x) => x.title), ['Hearing Record']);
  assert.ok(!/class=|style=|target=/.test(e.panel) && e.panel.includes('https://docs.house.gov/meetings/'), 'the panel for a popover: no styling, https');
});

ok('a markup: the text of the legislation, the notice and the votes, and no witnesses', () => {
  const e = CM.parseEvent(read('committee-event-markup.html'));
  assert.deepStrictEqual(e.sections.map((x) => x.title), ['Text of Legislation', 'Support Documents', 'Votes']);
  assert.deepStrictEqual(e.sections[0].items.map((i) => i.title), ['H.R. 4464, the Preventive Health Savings Act', 'H.R. 6470, the Increasing Baseline Updates Act']);
  assert.strictEqual(e.sections[2].items[0].title, 'Vote #1-On Favorably Reporting, without amendment, H.R. 6470');
  assert.deepStrictEqual(e.witnesses, []);
  assert.strictEqual(e.updated, 'September 16, 2026 at 04:40 PM');
});

ok('a hearing with witnesses and nothing else lists no sections; a page that is not a meeting is null', () => {
  assert.deepStrictEqual(CM.parseEvent(read('committee-event-small.html')).sections, []);
  assert.strictEqual(CM.parseEvent('<html>Service unavailable</html>'), null);
  assert.strictEqual(CM.parseEvent(''), null);
});

console.log(`\n${n} passed`);
