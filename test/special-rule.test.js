#!/usr/bin/env node
//
// lib/special-rule.js on the 61 special rules reported to the House in the 119th Congress (test/special-rules-corpus.json, verbatim from GovInfo). The reading is regular expressions and
// templates, so the same text always gives the same answer; what is pinned is that it still reads all of them, which sections it cannot place, and the lines it writes for the rules that
// matter (this week's, the filed stock-trading rule, the chains of extensions).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SR = require('../lib/special-rule.js');
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'special-rules-corpus.json'), 'utf8'));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const parsed = {};
for (const [num, r] of Object.entries(corpus.rules)) parsed[num] = SR.parse(r.body);
const rules = {};
for (const num of Object.keys(parsed)) rules[num] = { parsed: parsed[num], agreed: corpus.agreed[num] || null };
const section = (num, sec) => parsed[num].sections.find((s) => s.n === sec);

ok('all 61 rules are read, and every measure they take up has an id', () => {
  assert.strictEqual(Object.keys(parsed).length, 61);
  assert.ok(Object.values(parsed).every((p) => p && p.measures.length > 0));
  assert.ok(Object.values(parsed).every((p) => p.measures.every((m) => m.id)));
});

ok('the only sections no pattern places are three, and they are shown whole: an Impoundment Control Act waiver, a Speaker business waiver, a floor amendment written into a rule', () => {
  const other = [];
  for (const [num, p] of Object.entries(parsed)) for (const s of p.sections) if (s.kind === 'other') other.push(`${num}:${s.n}`);
  assert.deepStrictEqual(other.sort(), ['499:2', '936:8', '953:4']);
});

ok('body(): GovInfo\'s page to the operative text, entities decoded, furniture cut', () => {
  const html = '<html><pre>[H. Res. 9 Reported in House (RH)] House Calendar No. 1 RESOLUTION Resolved, That upon adoption it shall be in order to consider the bill (H.R. 1) &#x2014; and so on.  Sec. 2. Text.  House Calendar No. 1 &lt;all&gt;</pre></html>';
  const b = SR.body(html);
  assert.ok(b.startsWith('Resolved, That upon adoption'));
  assert.ok(b.includes('—') && !b.includes('House Calendar'));
});

ok('H.Res. 1650 (this week): one measure, closed, a committee substitute, one hour from Financial Services, one motion to recommit', () => {
  const m = parsed['1650'].measures[0];
  assert.strictEqual(m.id, 'H.R. 1013');
  assert.strictEqual(m.amendments, 'closed');
  assert.deepStrictEqual(m.substitute, { kind: 'committee', committee: 'Financial Services' });
  assert.strictEqual(m.debateMinutes, 60);
  assert.deepStrictEqual(m.debateCommittees, ['Financial Services']);
  assert.strictEqual(m.motionToRecommit, 'recommit');
  assert.ok(m.waivesConsideration && m.waivesProvisions);
  assert.deepStrictEqual(SR.cardTags(parsed['1650']), ['Closed', '1 hr debate']);
});

ok("a measure's title is the rule's own wording after its number", () => {
  assert.ok(parsed['1656'].measures[0].title.startsWith('to amend chapter 131 of title 5 to prohibit Members of Congress'));
  assert.strictEqual(parsed['1650'].measures[0].title, 'to amend the Federal securities laws to enhance 403(b) plans, and for other purposes');
});

ok('H.Res. 1656 (filed this week): same day, and a section that waives postponement', () => {
  assert.strictEqual(parsed['1656'].measures[0].timing, 'same-day');
  const p = section('1656', 2);
  assert.strictEqual(p.kind, 'clauses-waived');
  assert.deepStrictEqual(p.clauses.map((c) => c.text), ['clause 1(c) of rule XIX', 'clause 8 of rule XX']);
  // only what the rule's sentence says: nothing about what those clauses do, which the code does not know
  assert.strictEqual(SR.describe(p), 'Clause 1(c) of rule XIX and clause 8 of rule XX do not apply to the consideration of H.R. 6731.');
});

ok('structured and mixed rules: H.Res. 53 is structured for one bill and closed for the other; five measures in 1530, the first with a Rules Committee Print', () => {
  assert.deepStrictEqual(SR.cardTags(parsed['53']), ['Structured / Closed', '1 hr debate']);
  assert.strictEqual(parsed['1530'].measures.length, 5);
  assert.deepStrictEqual(parsed['1530'].measures[0].substitute, { kind: 'rules-committee-print', print: '119-41', inLieu: false });
  assert.strictEqual(parsed['53'].measures[0].timing, 'speaker-calls');
});

ok('a rule that lists its measures in a section (H.Res. 707 "any bill specified in section 2") gives one entry for each', () => {
  const ids = parsed['707'].measures.map((m) => m.id);
  assert.ok(ids.length >= 4 && ids.every(Boolean));
});

ok('the chain of the legislative-day provision: started by H.Res. 354 in April 2025, moved by 707, moved again by 1131 to the end of the Congress', () => {
  const c = SR.chainOf(rules, 354, 5);
  assert.deepStrictEqual(c.map((s) => `${s.resolution}:${s.section}:${s.kind}`), ['354:5:starts', '707:8:moves', '1131:5:moves']);
  assert.deepStrictEqual(c.map((s) => s.agreed), ['2025-04-29', '2025-09-16', '2026-03-25']);
  assert.strictEqual(c[1].to, '"March 31, 2026"');
  assert.strictEqual(c[2].to, '"the remainder of the One Hundred Nineteenth Congress"');
});

ok('the chains of the National Emergencies Act provisions: 211 and 313 are moved by 707 and then 722; 707 section 11 by 722', () => {
  assert.deepStrictEqual(SR.chainOf(rules, 211, 4).map((s) => `${s.resolution}:${s.section}`), ['211:4', '707:10', '722:3']);
  assert.deepStrictEqual(SR.chainOf(rules, 313, 2).map((s) => `${s.resolution}:${s.section}`), ['313:2', '707:9', '722:3']);
  assert.deepStrictEqual(SR.chainOf(rules, 707, 11).map((s) => `${s.resolution}:${s.section}`), ['707:11', '722:3']);
});

ok('where a chain stands: 1131 moved the legislative-day provision to the end of the 119th Congress (3 January 2027); 1042 ran to 31 July 2026', () => {
  const a = SR.chainEnd(SR.chainOf(rules, 354, 5), '2026-11-12');
  assert.deepStrictEqual([a.iso, a.days, a.state], ['2027-01-03', 52, 'in-effect']);
  const b = SR.chainEnd(SR.chainOf(rules, 1042, 4) || [{ kind: 'starts', through: '2026-07-31' }], '2026-11-12');
  assert.deepStrictEqual([b.iso, b.days, b.state], ['2026-07-31', -104, 'expired']);
  assert.strictEqual(SR.chainEnd(SR.chainOf(rules, 211, 4), '2026-11-12').iso, '2026-01-31');
});

ok('the clauses of the House rules a sentence names are listed as written, for a lookup in the rules themselves', () => {
  assert.deepStrictEqual(SR.clausesIn('Clause 1(c) of rule XIX and clause 8 of rule XX shall not apply').map((c) => c.text), ['clause 1(c) of rule XIX', 'clause 8 of rule XX']);
  assert.deepStrictEqual(SR.clausesIn('clauses 2(b) and 5 of rule XXI').map((c) => c.text), ['clause 2(b) of rule XXI', 'clause 5 of rule XXI']);
});

ok('an amendment is followed back to every provision it started from; a restatement is found by the emergencies it names', () => {
  assert.deepStrictEqual(SR.originsOf(rules, 1131, 5), [{ resolution: 354, section: 5 }]);
  assert.deepStrictEqual(SR.originsOf(rules, 722, 3), [{ resolution: 313, section: 2 }, { resolution: 211, section: 4 }, { resolution: 707, section: 11 }]);   // 722 changes sections 9, 10 and 11 of 707
  assert.deepStrictEqual(SR.sharedEmergency(rules, 1042, 4).map((s) => `${s.resolution}:${s.section}`), ['211:4', '313:2', '707:11']);
});

ok('numbers given as text (as a page has them) work the same, and a rule is never related to itself', () => {
  assert.deepStrictEqual(SR.sharedEmergency(rules, '1042', '4').map((s) => `${s.resolution}:${s.section}`), ['211:4', '313:2', '707:11']);
  assert.deepStrictEqual(SR.chainOf(rules, '354', '5').map((s) => s.resolution), [354, 707, 1131]);
});

ok('H.Res. 1042: days from 10 February to 31 July 2026 do not count under the National Emergencies Act, for four named emergencies (the rule says "or")', () => {
  const p = section('1042', 4);
  assert.strictEqual(p.kind, 'days-not-count');
  assert.deepStrictEqual([p.from, p.through], ['2026-02-10', '2026-07-31']);
  assert.deepStrictEqual(p.emergencies, ['2025-02-01', '2025-04-02', '2025-07-30', '2025-08-06']);
  assert.ok(SR.describe(p).endsWith('1 Feb 2025, 2 Apr 2025, 30 Jul 2025, or 6 Aug 2025.'));
});

ok('the other kinds write the line they should', () => {
  assert.strictEqual(SR.describe(section('1224', 9)), 'The Speaker may entertain motions to suspend the rules through the legislative day of 1 May 2026.');
  assert.strictEqual(SR.describe(section('1224', 8)), 'In the engrossment of S. 1318, the Clerk adds text from H.R. 1919.');
  assert.strictEqual(SR.describe(section('1014', 3)), 'The chair of the Committee on Appropriations may insert explanatory material about H.R. 7148 and H.R. 7147 in the Congressional Record by 23 Jan 2026.');
  assert.strictEqual(SR.describe(section('1014', 4)), 'The Clerk does not send the Senate a message that the House has passed H.R. 7148 until H.R. 7147 is passed.');
  assert.strictEqual(SR.describe(section('1014', 6)), 'Adopts H.Res. 375, as amended.');
  assert.strictEqual(SR.describe(section('1131', 5)), 'In section 8 of H.Res. 707, replaces "March 31, 2026" with "the remainder of the One Hundred Nineteenth Congress".');
  assert.strictEqual(SR.describe(section('499', 2)), null);   // 'other' has no line: the rule's own words are shown
  assert.strictEqual(SR.describe(section('1224', 2)), null);   // amendment procedure is not paraphrased either
});

console.log(`\n${n} passed`);
