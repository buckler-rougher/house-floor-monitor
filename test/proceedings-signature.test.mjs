#!/usr/bin/env node
//
// proceedingsSignature (worker.js): the fingerprint of the Clerk's floor log the stream object watches each minute. A new row, or an edited one, changes it; the same page twice does not.
// (17 November 2026: the yeas and nays were ordered on H.R. 9600 at 4:44 PM and the page said "scheduled" until the ten-minute rebuild.)

import assert from 'node:assert';
import { proceedingsSignature } from '../worker.js';

const page = (rows) => `<table><tr><th>Time</th></tr>${rows.map((r) => `<tr><td>${r}</td></tr>`).join('')}</table>`;
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('the same page gives the same fingerprint', () => {
  const p = page(['16:34:07 Mr. Westerman moved to suspend the rules']);
  assert.strictEqual(proceedingsSignature(p), proceedingsSignature(p));
});
ok('a new row changes it', () => {
  const a = page(['16:34:07 Mr. Westerman moved to suspend the rules']);
  const b = page(['16:34:07 Mr. Westerman moved to suspend the rules', '16:44:40 The Yeas and Nays were demanded and ordered']);
  assert.notStrictEqual(proceedingsSignature(a), proceedingsSignature(b));
});
ok('an edited row of a different length changes it', () => {
  assert.notStrictEqual(proceedingsSignature(page(['one'])), proceedingsSignature(page(['one, edited'])));
});
ok('nothing, or an empty page, does not throw', () => {
  assert.strictEqual(proceedingsSignature(null), '0:0');
  assert.strictEqual(proceedingsSignature(''), '0:0');
});
console.log(`\n${n} passed`);
