#!/usr/bin/env node
// lib/display-style.js `text`: US and the bill types without periods, in every spelling the board meets.
const assert = require('assert');
const { text } = require('../lib/display-style.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const eq = (a, b) => assert.strictEqual(text(a), b);

ok('every bill type loses its periods', () => {
  eq('H.R. 1234', 'HR 1234');
  eq('H. Res. 1499', 'HRes 1499');
  eq('H.Res. 12', 'HRes 12');
  eq('H.J.Res. 5', 'HJRes 5');
  eq('H.J. Res. 5', 'HJRes 5');
  eq('H.Con.Res. 3', 'HConRes 3');
  eq('H. Con. Res. 3', 'HConRes 3');
  eq('S. 4668', 'S 4668');
  eq('S.Res. 4', 'SRes 4');
  eq('S. Res. 4', 'SRes 4');
  eq('S.J.Res. 2', 'SJRes 2');
  eq('S.J. Res. 2', 'SJRes 2');
  eq('S.Con.Res. 1', 'SConRes 1');
});
ok('with no space, or in a sentence, and the period that ends the sentence stays', () => {
  eq('H.R.1869', 'HR 1869');
  eq('The House passed H.R. 4795.', 'The House passed HR 4795.');
  eq('H.R. 1 and S. 2, with H.Res. 3', 'HR 1 and S 2, with HRes 3');
});
ok('DomeWatch\'s unpunctuated form', () => {
  eq('H R 4795 - On Passage', 'HR 4795 - On Passage');
  eq('H RES 1490', 'HRes 1490');
  eq('H J RES 5', 'HJRes 5');
  eq('S CON RES 1', 'SConRes 1');
});
ok('US, not U.S., and USC', () => {
  eq('the U.S. House', 'the US House');
  eq('U.S. Constitution, Article I', 'US Constitution, Article I');
  eq('U.S. 5 times', 'US 5 times');   // the S is not read as a Senate bill
  eq('5 U.S.C. 3331', '5 USC 3331');
});
ok('nothing else moves', () => {
  eq('Mr. Smith of Texas', 'Mr. Smith of Texas');
  eq('Section 4. The House', 'Section 4. The House');
  eq('Roll Call 295', 'Roll Call 295');
  eq('HR 4795', 'HR 4795');
  assert.strictEqual(text(''), '');
  assert.strictEqual(text(null), null);
});
console.log(`\n${n} passed`);
