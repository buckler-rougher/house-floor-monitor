#!/usr/bin/env node
//
// Every JavaScript file the pages load (and the Worker) must PARSE, and so must every inline script. A syntax error in a browser script fails silently for the reader: the file does not run and the panel
// it drives goes dead (19 November 2026: an unescaped apostrophe in lib/senate-quorum.js, pushed while the other tests passed because nothing loaded that file). This test loads nothing, it only parses,
// so it runs in under a second and needs no network.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
let n = 0;
const failures = [];

const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
const files = new Set(['worker.js']);
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = (m[1].match(/\bsrc="([^"]+)"/) || [])[1];
    if (src) {
      if (/^https?:/.test(src)) continue;                          // a library from a CDN: not ours to parse
      const f = src.split('?')[0].replace(/^\//, '');
      if (fs.existsSync(path.join(root, f))) files.add(f); else failures.push(`${page}: loads ${src}, which does not exist`);
    } else if (m[2].trim() && !/type="(?:application\/json|application\/ld\+json|text\/template|importmap)"/.test(m[1])) {
      try { new vm.Script(m[2], { filename: `${page} (inline script)` }); n++; } catch (e) { failures.push(`${page} inline script: ${e.message}`); }
    }
  }
}
for (const f of [...files].sort()) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
  n++;
  if (r.status !== 0) failures.push(`${f}: ${(r.stderr || '').split('\n').filter(Boolean).slice(0, 4).join(' | ')}`);
}
if (failures.length) { console.error('SYNTAX FAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`ok  every script the pages load parses (${files.size} files, ${n - files.size} inline scripts)`);
console.log(`\n1 passed`);
