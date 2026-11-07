const assert = require('assert');
const P = require('../lib/placeholders.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
ok('the stand-ins are pending', () => { for (const t of ['--', ' -- ', '\u2014', 'Loading...', 'loading...']) assert.strictEqual(P.isPending(t), true, t); });
ok('real text and empty text are not', () => { for (const t of ['', 'House adjourned', '0', '12', '-1', 'Loading votes', '---']) assert.strictEqual(P.isPending(t), false, t); });
console.log(`\n${n} passed`);
