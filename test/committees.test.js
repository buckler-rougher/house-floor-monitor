#!/usr/bin/env node
//
// Contract test for lib/committees.js -- the committee chips both boards' bill modals draw.
//
// WHY THIS EXISTS
// The chips were the House board's own code (app.js) and were moved out so the Senate's bill
// modal could show committees too. The move was checked against the original code over 264
// committee inputs and against the House modal's markup for 24 bills; what is pinned here is
// the behaviour that matters for a SENATE bill: a Senate committee gets no House seal (both
// chambers have a Judiciary, a Rules and an Armed Services), is marked is-senate, and the
// reporting committee's vote reads as a tally only when the text actually has one. No network.

const assert = require('assert');
globalThis.BoardUtil = require('../lib/util.js');
require('../lib/committees.js');
const C = globalThis.Committees;

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('a House committee gets its seal; the same name from the Senate does not', () => {
  assert.strictEqual(C.committeeMark({ name: 'Judiciary Committee', chamber: 'House' }).logo, 'judiciary');
  assert.strictEqual(C.committeeMark({ name: 'Judiciary Committee', chamber: 'Senate' }).logo, null);
  assert.strictEqual(C.committeeMark({ name: 'Judiciary', systemCode: 'ssju00' }).logo, null, 'ssju00 is the Senate\'s');
  assert.strictEqual(C.committeeMark({ name: 'Judiciary', systemCode: 'hsju00' }).logo, 'judiciary');
});

ok('a Senate chip says so, and shows its own monogram', () => {
  const html = C.committeeChipHtml({ name: 'Commerce, Science, and Transportation Committee', chamber: 'Senate', systemCode: 'sscm00' });
  assert.ok(html.includes('bill-modal-committee is-senate'), html);
  assert.ok(html.includes('committee-chip-mark'), 'a monogram, not an image');
  assert.ok(!html.includes('<img'), 'no House seal on a Senate committee');
  assert.ok(html.includes('title="Senate Commerce, Science, and Transportation Committee"'));
});

ok('a committee nobody has seen gets a stable derived mark', () => {
  const a = C.committeeMark('Select Committee on the Climate Crisis'), b = C.committeeMark('Select Committee on the Climate Crisis');
  assert.deepStrictEqual(a, b);
  assert.ok(/^[A-Z?]{2}$/.test(a.abbr) && /^#[0-9a-f]{6}$/i.test(a.color));
});

ok('a name is escaped on the chip', () => {
  const html = C.committeeChipHtml({ name: 'Foo & <Bar> Committee' });
  assert.ok(html.includes('Foo &amp; &lt;Bar&gt;') && !html.includes('<Bar>'), html);
});

ok('the reporting committee\'s vote is a tally only when the text has one', () => {
  assert.ok(C.reportChipHtml('Reported by Committee 34 – 12').includes('<b class="ct-aye">34</b><span class="ct-sep">–</span><b class="ct-nay">12</b>'));
  assert.ok(C.reportChipHtml('Reported by Committee 7 - 4').includes('<b class="ct-aye">7</b>'));
  assert.ok(C.reportChipHtml('Reported out of cmte by unanimous consent').includes('Unanimous Consent'));
  assert.ok(C.reportChipHtml('Reported by Committee (voice vote)').includes('Voice Vote'));
  // Senate committees mostly record no count: that reads "Reported", never an invented tally.
  const plain = C.reportChipHtml('Reported by Committee');
  assert.ok(plain.includes('committee-chip-tally-text') && plain.includes('Reported') && !plain.includes('ct-aye'), plain);
});

ok('no report, no chip tail', () => {
  assert.strictEqual(C.reportChipHtml(''), '');
  assert.strictEqual(C.reportChipHtml(null), '');
  assert.strictEqual(C.reportChipHtml(undefined), '');
});

ok('the report chip rides inside the committee chip', () => {
  const html = C.committeeChipHtml({ name: 'Rules', chamber: 'House' }, C.reportChipHtml('Reported by Committee 9 - 4'));
  assert.ok(html.endsWith('</span></span>') && html.includes('ct-aye'));
});

console.log(`\n${n} passed`);
