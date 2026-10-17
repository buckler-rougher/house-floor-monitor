#!/usr/bin/env node
// Rewrites the inline-script hashes in _headers' Content-Security-Policy-Report-Only from the pages' own inline <script> blocks. Run it after editing an inline script
// (the loaders for the dev harness and the time machine in index.html carry a version string, so a version bump there changes the hash); test/csp.test.js fails until you do.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const hashes = new Set();
for (const f of ['index.html', 'senate.html', 'legal.html']) {
  for (const m of readFileSync(f, 'utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) hashes.add("'sha256-" + createHash('sha256').update(m[1]).digest('base64') + "'");
}
let h = readFileSync('_headers', 'utf8');
h = h.replace(/(script-src [^;]*?)((?: 'sha256-[^']+')+)/, (_, a) => a + ' ' + [...hashes].sort().join(' '));
writeFileSync('_headers', h);
console.log(`${hashes.size} inline script hashes written to _headers`);
