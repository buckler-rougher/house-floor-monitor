const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../lib/leadership.js');
const read = (f) => fs.readFileSync(path.join(__dirname, 'leadership', f), 'utf8');
let n = 0;
const test = (name, fn) => { fn(); n++; };

test('House: the real Clerk page gives the Speaker and the leaders and whips, with the party of each column', () => {
  const p = L.parseHouse(read('house.html'));
  assert(p);
  const by = (t) => p.find((x) => x.title === t);
  assert.strictEqual(by('Speaker of the House').name, 'Mike Johnson');
  assert.strictEqual(by('Speaker of the House').bioguideId, 'J000299');
  assert.strictEqual(by('Majority Leader').name, 'Steve Scalise');
  assert.strictEqual(by('Majority Leader').party, 'R');
  assert.strictEqual(by('Minority Whip').party, 'D');
  assert.strictEqual(p.length, 5, 'conference and committee chairs are not kept');
});

test('Senate: the real senate.gov page gives the President of the Senate, the President Pro Tempore and the two leaders, not the whips or the chairs', () => {
  const p = L.parseSenate(read('senate.html'));
  assert(p);
  assert.strictEqual(p.length, 4);
  const vp = p.find((x) => x.role === 'president');
  assert.strictEqual(vp.title, 'President of the Senate');
  assert.strictEqual(vp.name, 'J.D. Vance');
  assert.strictEqual(vp.bioguideId, 'V000137');
  assert.strictEqual(vp.party, null, 'the page gives no party for the Vice President');
  const pt = p.find((x) => x.role === 'protem');
  assert.strictEqual(pt.name, 'Chuck Grassley');
  assert.strictEqual(pt.party, 'R');
  assert.strictEqual(pt.state, 'IA');
  const thune = p.find((x) => x.name === 'John Thune');
  assert.strictEqual(thune.role, 'leader');
  assert.strictEqual(thune.party, 'R');
  assert.strictEqual(thune.bioguideId, 'T000250');
  assert.strictEqual(p.find((x) => x.party === 'D' && x.role === 'leader').name, 'Charles E. Schumer');
  assert(!p.some((x) => x.role === 'whip'));
});

test('a page of another shape is null, never a list with holes', () => {
  assert.strictEqual(L.parseHouse('<html>maintenance</html>'), null);
  assert.strictEqual(L.parseSenate('<html>maintenance</html>'), null);
  assert.strictEqual(L.parseHouse(read('house.html').replace(/Majority Whip/g, 'Something')), null);
});

test('layout: majority in the left column, minority in the right; the Senate takes sides from the party in control and has no whips', () => {
  const h = L.layout(L.parseHouse(read('house.html')), 'R');
  assert.strictEqual(h.top.length, 1);
  assert.strictEqual(h.top[0].name, 'Mike Johnson');
  assert.strictEqual(h.rows.length, 2);
  assert.strictEqual(h.rows[0][0].name, 'Steve Scalise');
  assert.strictEqual(h.rows[0][1].party, 'D');
  const s = L.layout(L.parseSenate(read('senate.html')), 'R');
  assert.deepStrictEqual(s.top.map((p) => p.title), ['President of the Senate', 'President Pro Tempore']);
  assert.strictEqual(s.rows.length, 1);
  assert.strictEqual(s.rows[0][0].name, 'John Thune');
  assert.strictEqual(s.rows[0][1].name, 'Charles E. Schumer');
  // the page's own "Majority" wording wins over the party in control
  assert.strictEqual(L.layout(L.parseSenate(read('senate.html')), 'D').rows[0][0].name, 'John Thune');
});

console.log(`leadership: ${n} passed`);
