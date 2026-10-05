#!/usr/bin/env node
//
// Contract test for lib/party-balance.js -- the PARTY BREAKDOWN panel both boards share.
//
// WHY THIS EXISTS
// The House drew this panel in app.js (fetchHouseMakeup / updatePartyBreakdownDisplay) and the
// Senate wrote its own copy (renderBalance). They are now one module, and the House is the board
// everything else is measured against, so what is pinned is what the House's own code did: the
// text of each count, the control badge, a bar width that is a share of members plus vacancies,
// the majority party moved to the left, and an unchanged vacancy list left alone. A fake DOM, no
// network, no dependencies.

const assert = require('assert');
const PB = require('../lib/party-balance.js');

// ---- a fake document: just what the module touches --------------------------------------------
function makeDoc(skip = []) {
  const nodes = {};
  const bar = { children: [], appendChild(n) { this.children = this.children.filter((c) => c !== n); this.children.push(n); n.parentElement = this; } };
  for (const [k, id] of Object.entries(PB.ID)) {
    if (skip.includes(k)) continue;
    nodes[id] = { id, textContent: '', className: '', innerHTML: '', style: {}, classList: { removed: [], remove(c) { this.removed.push(c); } }, parentElement: null };
  }
  for (const k of ['repFill', 'demFill', 'indFill', 'vacFill']) if (nodes[PB.ID[k]]) bar.appendChild(nodes[PB.ID[k]]);
  return { getElementById: (id) => nodes[id] || null, nodes, bar, order: () => bar.children.map((c) => c.id) };
}

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

// What the House board hands over for the 2 September 2026 MemberData (the harness fixtures).
const house = {
  counts: { R: 218, D: 214, I: 1 }, total: 433, seats: 435, control: 'R',
  vacancyCount: 2, vacancyHtml: '<div class="vacancy-item">TX-23</div>', stamp: '02 September 2026',
};

ok('the counts, total, control badge and stamp are written as the House wrote them', () => {
  const d = makeDoc(); PB.render(house, d);
  assert.strictEqual(d.nodes['party-rep'].textContent, 218);
  assert.strictEqual(d.nodes['party-dem'].textContent, 214);
  assert.strictEqual(d.nodes['party-ind'].textContent, 1);
  assert.strictEqual(d.nodes['party-total'].textContent, 433);
  assert.strictEqual(d.nodes['majority-control-badge'].textContent, 'REPUBLICAN CONTROL');
  assert.strictEqual(d.nodes['majority-control-badge'].className, 'majority-badge r-control');
  assert.strictEqual(d.nodes['party-breakdown-last-update'].textContent, '02 September 2026');
  assert.strictEqual(d.nodes['vacancies-count'].textContent, 2);
});

ok('bar widths are the same arithmetic as the House\'s (share of members plus vacancies)', () => {
  const d = makeDoc(); PB.render(house, d);
  // The House's own expressions, verbatim.
  const totalSeats = 435;
  assert.strictEqual(d.nodes['rep-fill'].style.width, `${(218 / totalSeats) * 100}%`);
  assert.strictEqual(d.nodes['dem-fill'].style.width, `${(214 / totalSeats) * 100}%`);
  assert.strictEqual(d.nodes['ind-fill'].style.width, `${(1 / totalSeats) * 100}%`);
  assert.strictEqual(d.nodes['vac-fill'].style.width, `${(2 / totalSeats) * 100}%`);
  assert.strictEqual(d.nodes['rep-fill'].style.width, '50.114942528735625%');
});

ok('the Senate\'s numbers, which came out as whole percentages, still do', () => {
  const d = makeDoc();
  PB.render({ counts: { R: 53, D: 45, I: 2 }, total: 100, seats: 100, control: 'R', vacancyCount: 0 }, d);
  assert.deepStrictEqual(['rep-fill', 'dem-fill', 'ind-fill', 'vac-fill'].map((i) => d.nodes[i].style.width), ['53%', '45%', '2%', '0%']);
});

ok('the majority party is on the left', () => {
  const d = makeDoc(); PB.render(house, d);
  assert.deepStrictEqual(d.order(), ['rep-fill', 'dem-fill', 'ind-fill', 'vac-fill']);
  const e = makeDoc(); PB.render({ ...house, counts: { R: 210, D: 222, I: 1 }, control: 'D' }, e);
  assert.deepStrictEqual(e.order(), ['dem-fill', 'rep-fill', 'ind-fill', 'vac-fill']);
  assert.strictEqual(e.nodes['majority-control-badge'].textContent, 'DEMOCRATIC CONTROL');
  assert.strictEqual(e.nodes['majority-control-badge'].className, 'majority-badge d-control');
});

ok('and moves back when control changes hands', () => {
  const d = makeDoc();
  PB.render({ ...house, counts: { R: 210, D: 222, I: 1 } }, d);
  PB.render(house, d);
  assert.deepStrictEqual(d.order(), ['rep-fill', 'dem-fill', 'ind-fill', 'vac-fill']);
});

ok('no controlling party hides the badge', () => {
  const d = makeDoc(); PB.render({ ...house, control: null }, d);
  assert.strictEqual(d.nodes['majority-control-badge'].className, 'majority-badge hidden');
});

ok('an unknown count is "--", never a zero', () => {
  const d = makeDoc(); PB.render({ counts: {}, seats: 100 }, d);
  for (const id of ['party-rep', 'party-dem', 'party-ind', 'party-total', 'vacancies-count']) assert.strictEqual(d.nodes[id].textContent, '--', id);
});

ok('the vacancy list is the board\'s own rows, and an unchanged one is not rebuilt', () => {
  // On the real pages BoardUtil is always loaded; it is what keeps the list from being rebuilt.
  globalThis.BoardUtil = require('../lib/util.js');
  const d = makeDoc();
  let writes = 0, html = '';
  Object.defineProperty(d.nodes['vacancies-list'], 'innerHTML', { get: () => html, set: (v) => { writes++; html = v; } });
  PB.render(house, d);
  assert.strictEqual(html, '<div class="vacancy-item">TX-23</div>');
  assert.strictEqual(writes, 1);
  PB.render(house, d);
  assert.strictEqual(writes, 1, 'the same html was written again');
  PB.render({ ...house, vacancyHtml: '<div class="vacancy-item">none</div>' }, d);
  assert.strictEqual(writes, 2);
  delete globalThis.BoardUtil;
});

ok('a board that sends no vacancy rows leaves the list alone', () => {
  const d = makeDoc(); d.nodes['vacancies-list'].innerHTML = 'kept';
  const { vacancyHtml, ...noRows } = house;
  PB.render(noRows, d);
  assert.strictEqual(d.nodes['vacancies-list'].innerHTML, 'kept');
});

ok('the vacancies section is un-hidden, and a page without one is fine', () => {
  const d = makeDoc(); PB.render(house, d);
  assert.deepStrictEqual(d.nodes['vacancies-section'].classList.removed, ['hidden']);
  assert.doesNotThrow(() => PB.render(house, makeDoc(['vacSection', 'badge', 'stamp', 'vacList'])));
});

ok('a page missing some of its elements does not throw', () => {
  assert.doesNotThrow(() => PB.render(house, makeDoc(['repFill', 'demFill', 'indFill', 'vacFill'])));
  assert.doesNotThrow(() => PB.render(house, { getElementById: () => null }));
});

console.log(`\n${n} passed`);
