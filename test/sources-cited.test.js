// Every "Source:" link a panel shows must also be cited in the footer sources list. A new source is added to both,
// with a status check (sourceStatusChecks + lib/source-status.js MAP) where it can be checked.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const key = (u) => { const m = u.match(/^https?:\/\/(?:www\.)?([^/]+)(\/[^/?#]*)?/); return m ? m[1] + (m[2] && m[2] !== '/' ? m[2] : '') : u; };
let n = 0;
for (const f of ['index.html', 'senate.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const fi = html.indexOf('class="footer-sources"');
  assert(fi > 0, `${f}: no footer sources list`);
  const body = html.slice(0, fi), foot = html.slice(fi);
  const panel = [...body.matchAll(/<span class="[^"]*source[^"]*"[^>]*>\s*Source:\s*<a[^>]*href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const cited = new Set([...foot.matchAll(/<a href="(https?:\/\/[^"]+)"/g)].map((m) => key(m[1])));
  const missing = [...new Set(panel.map(key))].filter((k) => !cited.has(k));
  assert.deepStrictEqual(missing, [], `${f}: panel sources missing from the footer: ${missing.join(', ')}`);
  n++;
}
console.log(`sources-cited: ${n} passed`);
