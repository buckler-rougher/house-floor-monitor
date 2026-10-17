#!/usr/bin/env node
//
// The page's own markup must stay something a Content-Security-Policy can describe (16 October review). Pinned: every inline <script> in a page has its hash in the policy in _headers
// (edit one and this fails until the hash is updated, instead of the page quietly losing the script), no inline event handler (`onclick=` and the rest) is written in a page or in the
// markup the scripts build, and no `javascript:` link is. The handlers they replaced are lib/actions.js. No network.

const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

const headers = read('_headers');
const policy = (headers.match(/Content-Security-Policy(?:-Report-Only)?:\s*(.+)/) || [])[1] || '';
const pages = ['index.html', 'senate.html', 'legal.html'];
const sources = ['app.js', 'senate.js', ...fs.readdirSync(path.join(root, 'lib')).filter((f) => f.endsWith('.js')).map((f) => 'lib/' + f)];

test('every inline script has its hash in the policy', () => {
  assert.ok(policy.includes("script-src"), 'a script-src is declared');
  for (const f of pages) {
    for (const m of read(f).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const h = 'sha256-' + crypto.createHash('sha256').update(m[1]).digest('base64');
      assert.ok(policy.includes(`'${h}'`), `${f}: an inline script (${m[1].trim().slice(0, 50).replace(/\s+/g, ' ')}…) has no hash ${h} in _headers`);
    }
  }
});
test('no page or script writes an inline event handler', () => {
  const handler = /\son(?:click|input|change|load|error|submit|keydown|keyup|mouse\w+|focus|blur)\s*=\s*["']/;
  for (const f of [...pages, ...sources]) {
    const hit = read(f).split('\n').findIndex((l) => handler.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    assert.strictEqual(hit, -1, `${f}:${hit + 1} writes an inline event handler`);
  }
});
test('no javascript: link is written', () => {
  for (const f of [...pages, ...sources]) {
    const hit = read(f).split('\n').findIndex((l) => /href\s*=\s*["']\s*javascript:/i.test(l));
    assert.strictEqual(hit, -1, `${f}:${hit + 1} has a javascript: link`);
  }
});
test('the frame, base, object and form rules are set', () => {
  for (const d of ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'"]) assert.ok(policy.includes(d), d);
});

console.log(`csp: ${n} passed`);
