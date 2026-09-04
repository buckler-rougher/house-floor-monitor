#!/usr/bin/env node
/**
 * Files a snapshots.json captured by dev/screens.html into dev/snapshots/<name>/,
 * one file per mode, which is the layout dev/compare.mjs reads.
 *
 *   node dev/save-snapshot.mjs before ~/Downloads/snapshots.json
 *   node dev/save-snapshot.mjs after  ~/Downloads/snapshots.json
 *   node dev/compare.mjs before after
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [name, src] = process.argv.slice(2);
if (!name || !src) {
  console.error('usage: node dev/save-snapshot.mjs <name> <path/to/snapshots.json>');
  process.exit(2);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots', name);
if (existsSync(dir)) rmSync(dir, { recursive: true });
mkdirSync(dir, { recursive: true });

const all = JSON.parse(readFileSync(src, 'utf8'));
let ok = 0, bad = [];
for (const [mode, snap] of Object.entries(all)) {
  if (snap.error) { bad.push(`${mode}: ${snap.error}`); continue; }
  writeFileSync(join(dir, `${mode}.json`), JSON.stringify(snap, null, 1));
  ok++;
}
console.log(`saved ${ok} modes → dev/snapshots/${name}/`);
if (bad.length) {
  console.log(`\n${bad.length} mode(s) failed to capture:`);
  bad.forEach(b => console.log('  ' + b));
  process.exit(1);
}
