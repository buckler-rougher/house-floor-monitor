#!/usr/bin/env node
/**
 * Diff two snapshot directories: dev/snapshots/<before>/ vs <after>/
 *
 *   node dev/compare.mjs before after            # summary
 *   node dev/compare.mjs before after --verbose  # every changed property
 *   node dev/compare.mjs before after --mode prayer
 *
 * Exit code is 1 when anything differs, so this drops into a pre-commit hook or
 * CI step unchanged.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'snapshots');
const [a, b, ...rest] = process.argv.slice(2);
const verbose = rest.includes('--verbose');
const onlyMode = rest.includes('--mode') ? rest[rest.indexOf('--mode') + 1] : null;

if (!a || !b) {
  console.error('usage: node dev/compare.mjs <before> <after> [--verbose] [--mode <name>]');
  process.exit(2);
}
for (const d of [a, b]) {
  if (!existsSync(join(ROOT, d))) { console.error(`no such snapshot set: dev/snapshots/${d}`); process.exit(2); }
}

const files = readdirSync(join(ROOT, a)).filter(f => f.endsWith('.json'))
  .filter(f => !onlyMode || f === `${onlyMode}.json`);

let totalChanged = 0, totalAdded = 0, totalRemoved = 0, modesTouched = 0;

for (const f of files.sort()) {
  const mode = f.replace(/\.json$/, '');
  const pa = join(ROOT, a, f), pb = join(ROOT, b, f);
  if (!existsSync(pb)) { console.log(`  ${mode.padEnd(16)} MISSING in ${b}`); totalRemoved++; continue; }
  const A = JSON.parse(readFileSync(pa, 'utf8')).elements;
  const B = JSON.parse(readFileSync(pb, 'utf8')).elements;

  const added = Object.keys(B).filter(k => !(k in A));
  const removed = Object.keys(A).filter(k => !(k in B));
  const changes = [];
  for (const k of Object.keys(A)) {
    if (!(k in B)) continue;
    for (const p of Object.keys(A[k])) {
      if (A[k][p] !== B[k][p]) changes.push({ el: k, prop: p, from: A[k][p], to: B[k][p] });
    }
  }

  if (!changes.length && !added.length && !removed.length) {
    console.log(`  ok   ${mode.padEnd(16)} identical (${Object.keys(A).length} elements)`);
    continue;
  }
  modesTouched++;
  totalChanged += changes.length; totalAdded += added.length; totalRemoved += removed.length;
  console.log(`  DIFF ${mode.padEnd(16)} ${changes.length} prop change(s), +${added.length} el, -${removed.length} el`);

  // Group by property so the common case — "letter-spacing moved everywhere" —
  // reads as one line instead of hundreds.
  const byProp = {};
  for (const c of changes) (byProp[c.prop] ||= []).push(c);
  for (const [prop, list] of Object.entries(byProp).sort((x, y) => y[1].length - x[1].length)) {
    const sample = list[0];
    console.log(`         ${String(list.length).padStart(4)}x ${prop}: ${sample.from} → ${sample.to}`);
    if (verbose) for (const c of list) console.log(`                 ${c.el}\n                   ${c.from} → ${c.to}`);
  }
  if (verbose) {
    for (const k of added) console.log(`         + ${k}`);
    for (const k of removed) console.log(`         - ${k}`);
  }
}

console.log(`\n${modesTouched} of ${files.length} modes differ — ` +
            `${totalChanged} property changes, +${totalAdded}/-${totalRemoved} elements`);
process.exit(modesTouched ? 1 : 0);
