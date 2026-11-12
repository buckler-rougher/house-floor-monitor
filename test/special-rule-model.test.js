const test = require('node:test'); const assert = require('node:assert');
require('../lib/special-rule.js'); require('../lib/house-rule-clauses.js'); require('../lib/special-rule-model.js');
const SR = globalThis.SpecialRule, M = globalThis.SpecialRuleModel;
const corpus = require('./special-rules-corpus.json');
const rules = {};
for (const [n, r] of Object.entries(corpus.rules)) rules[n] = { parsed: SR.parse(r.body), agreed: corpus.agreed[n] || null };
const model = (n, today = '2026-11-12') => M.build(rules, n, today, globalThis.HouseRuleClauses);

test('every one of the 61 rules builds a model that is plain JSON', () => {
  for (const n of Object.keys(rules)) { const m = model(n); assert.ok(m, n); assert.deepEqual(JSON.parse(JSON.stringify(m)), m); assert.ok(M.html(m).includes('Beta')); }
});
test('H.Res. 1656: waived clauses carry the House\'s own words', () => {
  const m = model(1656); const p = m.provisions.find((x) => x.kind === 'clauses-waived');
  assert.equal(p.plain, 'Clause 1(c) of rule XIX and clause 8 of rule XX do not apply to the consideration of H.R. 6731.');
  assert.match(p.clauses[0].body, /^\(c\) Notwithstanding paragraph \(a\), when the previous question is operating/);
});
test('an extension chain ends where the last step says, with the day count', () => {
  const m = model(1131); const c = m.provisions.flatMap((x) => x.chains).find((x) => x.steps.length > 1);
  assert.ok(c); assert.equal(c.end.until, '03 Jan 2027'); assert.equal(c.end.days, 52);
  assert.equal(c.steps.filter((s) => s.mine).length, 1);
});
test('the card tags match the parser\'s', () => { assert.deepEqual(model(1650).tags, ['Closed', '1 hr debate']); });
test('html escapes what it draws', () => { const m = model(1650); m.measures[0].title = '<img onerror=x>'; assert.ok(!M.html(m).includes('<img')); });

test('a committee substitute reads ADOPTS AINS and spells itself out on hover', () => {
  const f = (n) => model(n).measures.flatMap((m) => m.facts).find((x) => x.t === 'Adopts AINS');
  assert.equal(f(211).tip, "Adopts Ways and Means Committee's amendment in the nature of a substitute");
  assert.equal(f(377).tip, "Adopts Natural Resources Committee's amendment in the nature of a substitute");
  const j = Object.keys(rules).map((n) => model(n).measures.flatMap((m) => m.facts)).flat().find((x) => /Judiciary/.test(x.tip || ''));
  assert.equal(j.tip, "Adopts Judiciary Committee's amendment in the nature of a substitute");
});
