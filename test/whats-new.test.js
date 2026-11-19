// lib/whats-new.js: when the "What's new" dot and banner show. A first visit shows neither; the newest entry is new until the list is opened, for 14 days from its date; the banner is that
// entry once (its X hides it, opening the list hides it); a link that took the reader straight to something shows no banner. Entries are major features, newest first, one short sentence.
const assert = require('assert');
const W = require('../lib/whats-new.js');
const E = [
  { id: 'c', date: '2026-11-18', title: 'C', text: 'c', boards: ['house'] },
  { id: 'b', date: '2026-11-17', title: 'B', text: 'b', boards: ['house', 'senate'] },
  { id: 'a', date: '2026-10-14', title: 'A', text: 'a', boards: ['house'] },
];
const day = (iso) => Date.parse(`${iso}T15:00:00Z`);
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('a first visit shows neither, and says it is a first visit', () => assert.deepStrictEqual(W.decide({ board: 'house', seen: null, dismissed: null, now: day('2026-11-19'), entries: E }), { newest: E[0], first: true, isNew: false, showDot: false, showBanner: false }));
ok('the newest unseen entry shows the dot and the banner', () => { const d = W.decide({ board: 'house', seen: 'b', dismissed: null, now: day('2026-11-19'), entries: E }); assert.strictEqual(d.newest.id, 'c'); assert(d.showDot && d.showBanner); });
ok('seen: nothing shows', () => { const d = W.decide({ board: 'house', seen: 'c', dismissed: null, now: day('2026-11-19'), entries: E }); assert(!d.showDot && !d.showBanner && !d.isNew); });
ok('dismissed: the dot stays, the banner goes', () => { const d = W.decide({ board: 'house', seen: 'b', dismissed: 'c', now: day('2026-11-19'), entries: E }); assert(d.showDot && !d.showBanner); });
ok('after 14 days from the entry\'s date nothing shows', () => {
  assert(W.decide({ board: 'house', seen: 'b', dismissed: null, now: day('2026-12-02'), entries: E }).showBanner, 'day 14');
  const late = W.decide({ board: 'house', seen: 'b', dismissed: null, now: day('2026-12-03'), entries: E }); assert(!late.showDot && !late.showBanner, 'day 15');
});
ok('session days: window is 5 session days after the date; a recess does not use it up', () => {
  const args = { board: 'house', seen: 'b', dismissed: null, now: day('2026-12-20'), entries: E };
  assert(W.decide({ ...args, sessionsSince: 5 }).showBanner, 'fifth session day');
  assert(!W.decide({ ...args, sessionsSince: 6 }).showBanner, 'sixth');
  assert(W.decide({ ...args, sessionsSince: 0 }).showBanner, 'a month of recess, no sessions');
});
ok('sessionDaysSince counts distinct days after the date, up to today, skipping cancelled', () => {
  const items = [{ date: '2026-11-18', type: 'vote-day' }, { date: '2026-11-19', type: 'vote-day' }, { date: '2026-11-19', type: 'fly-in' }, { date: '2026-11-20', type: 'cancelled' }, { date: '2026-11-23', type: 'vote-day' }, { date: '2026-11-30', type: 'vote-day' }];
  assert.strictEqual(W.sessionDaysSince(items, '2026-11-18', '2026-11-23'), 2);
});
ok('a link straight to something shows the dot but no banner', () => { const d = W.decide({ board: 'house', seen: 'b', dismissed: null, now: day('2026-11-19'), entries: E, straightToSomething: true }); assert(d.showDot && !d.showBanner); });
ok('the Senate site hears only of what is for it', () => { const d = W.decide({ board: 'senate', seen: 'a', dismissed: null, now: day('2026-11-19'), entries: E }); assert.strictEqual(d.newest.id, 'b'); assert.deepStrictEqual(W.forBoard('senate', E).map((e) => e.id), ['b']); });
ok('a board with no entries shows nothing', () => assert.deepStrictEqual(W.decide({ board: 'senate', seen: 'x', dismissed: null, now: day('2026-11-19'), entries: [E[0]] }).showBanner, false));
ok('the real entries: newest first, each for a board, one short sentence, no em dash', () => {
  const real = W.ENTRIES;
  for (let i = 1; i < real.length; i++) assert(real[i - 1].date >= real[i].date, 'newest first');
  for (const e of real) { assert(e.boards.length && e.boards.every((b) => b === 'house' || b === 'senate')); assert(e.text.length <= 110, e.id + ' too long'); assert(!/—/.test(e.title + e.text)); assert(/^\d{4}-\d\d-\d\d-/.test(e.id)); }
  assert.strictEqual(new Set(real.map((e) => e.id)).size, real.length);
});
ok('an entry dated in the future is held back: not new, not listed, until its day', () => {
  const F = [{ id: 'f', date: '2027-01-03', title: 'F', text: 'f', boards: ['house'] }, ...E];
  const before = W.decide({ board: 'house', seen: 'b', dismissed: null, now: day('2026-11-20'), entries: F });
  assert.strictEqual(before.newest.id, 'c', 'the newest published one, not the future one');
  assert.deepStrictEqual(W.forBoard('house', F, day('2026-11-20')).map((e) => e.id), ['c', 'b', 'a']);
  const on = W.decide({ board: 'house', seen: 'c', dismissed: null, now: day('2027-01-03'), entries: F });
  assert.strictEqual(on.newest.id, 'f');
  assert(on.showDot && on.showBanner, 'new on the day');
  assert.deepStrictEqual(W.forBoard('house', F, day('2027-01-03')).map((e) => e.id), ['f', 'c', 'b', 'a']);
  assert.strictEqual(W.decide({ board: 'house', seen: 'c', dismissed: null, now: day('2027-01-02'), entries: F }).showBanner, false, 'the day before: nothing');
});
console.log(`\n${n} passed`);
