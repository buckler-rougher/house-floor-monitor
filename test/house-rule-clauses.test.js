// The clause lookup is read from the House's own PDF by dev/house-rule-clauses.mjs; these pin the clauses special rules cite, word for word.
const test = require('node:test'); const assert = require('node:assert');
const doc = (require('../lib/house-rule-clauses.js'), globalThis.HouseRuleClauses);
const at = (r, c) => doc.rules[r][c];

test('rule XIX clause 1(c), the postponement the special rules waive', () => {
  assert.equal(at('XIX', 1).heading, 'Previous question');
  assert.equal(at('XIX', 1).paragraphs.c, '(c) Notwithstanding paragraph (a), when the previous question is operating to adoption or passage of a measure pursuant to a special order of business, the Chair may postpone further consideration of such measure in the House to such time as may be designated by the Speaker.');
});
test('rule XX clause 8 opens with the two additional legislative days', () => {
  assert.equal(at('XX', 8).heading, 'Postponement of proceedings');
  assert.match(at('XX', 8).paragraphs.a, /within two additional legislative days/);
});
test('headings sit on the clause they head', () => {
  assert.equal(at('XIII', 6).heading, 'Privileged reports by the Committee on Rules');
  assert.equal(at('XIII', 7).heading, 'Resolutions of inquiry');
  assert.equal(at('XXI', 5).heading, 'Tax and tariff measures and amendments');
});
test('every clause the 61 special rules cite is present', () => {
  for (const [r, c] of [['XVIII', 2], ['XXI', 5], ['XIII', 6], ['XV', 1], ['XIX', 1], ['XX', 8], ['XXI', 2], ['XIII', 7], ['I', 13]]) assert.ok(at(r, c), `${r} ${c}`);
});
test('no broken line-end hyphens in cited clauses', () => {
  for (const [r, c] of [['XIX', 1], ['XX', 8], ['XIII', 6]]) assert.doesNotMatch(at(r, c).text, /[a-z]- [a-z]/);
});
