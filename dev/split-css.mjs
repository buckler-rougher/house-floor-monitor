#!/usr/bin/env node
//
// Generate each chamber's stylesheet from styles.css.
//
//   node dev/split-css.mjs            # writes styles.senate.css and styles.house.css
//   node dev/split-css.mjs --check    # exits 1 if either committed file is out of date
//
// styles.css stays the one source of truth, written and read as before; it is heavily
// commented, and the comments are about half of what a visitor downloads.
//
// THE HOUSE gets styles.house.css: styles.css with its comments removed and NOTHING else
// changed. No rule is dropped or reordered, so the cascade is the original by construction.
// (Dropping the rules the House page never uses was measured at 1 to 3 KB gzipped more, and
// carries a risk comment stripping does not: the House JS builds class names from data.)
//
// THE SENATE gets styles.senate.css. The Senate page loads it; it is styles.css with every rule that names a class or id the
// Senate page never uses taken out. NOTHING IS REORDERED OR REWRITTEN, so the cascade the
// Senate page sees is the original one by construction: removing a rule that matches no element
// cannot change what any other rule does. (Splitting into shared / House / Senate source files
// would reorder rules, and the cascade would have to be re-proved by snapshot.)
//
// "THE SENATE PAGE USES A CLASS" IS A GENEROUS TEST, so that it errs toward keeping a rule:
//   - the class name, as a whole word, appears anywhere in senate.html, senate.js or a lib/
//     script that senate.html loads, in code, strings or comments; or
//   - some word there ends in "-" or "_" and the class starts with it ("qb-" + name), or some
//     word starts with "-" and the class ends with it (name + "-mode"), which is how names built
//     by concatenation are caught.
// Only classes and ids outside :not() / :is() / :where() / :has() are required to exist, and
// [data-chamber="house"] is dead on the Senate page. Tags and attribute selectors are never
// grounds for dropping. Comments are stripped from the generated file (the source keeps them).
// @keyframes survive only if something kept, or the Senate scripts, names them.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- stripping comments ------------------------------------------------------------------

// Remove every comment, and nothing else but the blank lines and trailing spaces they leave.
// Strings and url() are copied through untouched, so a "/*" inside one is not a comment. A
// comment between two tokens becomes a space, so `1px/**/2px` cannot become `1px2px`; one that
// already has whitespace (or a delimiter) beside it simply goes.
export function stripComments(css) {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") { const j = skipString(css, i); out += css.slice(i, j + 1); i = j; continue; }
    if (c === 'u' && /^url\(\s*[^"'\s)]/i.test(css.slice(i, i + 12))) {      // unquoted url(...)
      const j = css.indexOf(')', i); out += css.slice(i, j + 1); i = j; continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      const j = css.indexOf('*/', i + 2);
      if (j < 0) throw new Error('unterminated comment');
      const before = out[out.length - 1], after = css[j + 2];
      const apart = (ch) => ch === undefined || /[\s;{}]/.test(ch);
      if (!apart(before) && !apart(after)) out += ' ';
      i = j + 1; continue;
    }
    out += c;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

// ---- reading CSS -------------------------------------------------------------------------

// Index of the character after the `}` that closes the `{` at `open`, skipping strings and
// comments.
function closeOf(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { i = skipString(s, i); continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2) + 1; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  throw new Error('unbalanced braces');
}
function skipString(s, i) {
  const q = s[i];
  for (i++; i < s.length; i++) { if (s[i] === '\\') i++; else if (s[i] === q) return i; }
  throw new Error('unterminated string');
}

// The next `{` or `;` at the top level of a prelude, skipping strings, comments and parens.
function endOfPrelude(s, i) {
  let paren = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { i = skipString(s, i); continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2) + 1; continue; }
    if (c === '(') paren++; else if (c === ')') paren--;
    else if (!paren && (c === '{' || c === ';')) return i;
  }
  return -1;
}

const NESTING = new Set(['media', 'supports', 'layer', 'container']);

// A flat list of nodes: { kind: 'rule'|'at-block'|'at-stmt', prelude, body?, children? }.
export function parse(s) {
  const nodes = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2) + 2; continue; }
    const end = endOfPrelude(s, i);
    if (end < 0) break;
    const prelude = s.slice(i, end).trim();
    if (s[end] === ';') { nodes.push({ kind: 'at-stmt', prelude }); i = end + 1; continue; }
    const after = closeOf(s, end);
    const body = s.slice(end + 1, after - 1);
    if (prelude.startsWith('@')) {
      const name = prelude.slice(1).match(/^[a-z-]+/)[0];
      if (NESTING.has(name)) nodes.push({ kind: 'at-block', name, prelude, children: parse(body) });
      else nodes.push({ kind: 'at-raw', name, prelude, body });
    } else nodes.push({ kind: 'rule', prelude, body });
    i = after;
  }
  return nodes;
}

// ---- what a page uses --------------------------------------------------------------------

export function universe(files) {
  const words = new Set(), prefixes = [], suffixes = [];
  for (const f of files) {
    const t = readFileSync(join(ROOT, f), 'utf8');
    for (const m of t.matchAll(/[A-Za-z_][\w-]*/g)) {
      words.add(m[0]);
      if (/[-_]$/.test(m[0]) && m[0].length >= 3) prefixes.push(m[0]);
    }
    for (const m of t.matchAll(/(?<![\w-])(-[a-z][\w-]*)/g)) suffixes.push(m[1]);
  }
  const used = (name) =>
    words.has(name) || prefixes.some((p) => name.startsWith(p)) || suffixes.some((x) => name.endsWith(x));
  return { words, used };
}

export const SENATE_FILES = (() => {
  const html = readFileSync(join(ROOT, 'senate.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"?]+)/g)].map((m) => m[1]).filter((p) => !/^https?:/.test(p));
  return ['senate.html', ...scripts];
})();

// ---- selectors ---------------------------------------------------------------------------

// Split a selector list on its top-level commas.
function splitList(sel) {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '"' || c === "'") { const j = skipString(sel, i); cur += sel.slice(i, j + 1); i = j; continue; }
    if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
    if (c === ',' && !depth) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Can this one selector match an element on a page that uses `uni`?
function alive(selector, chamber, uni) {
  if (selector.includes('[data-chamber="house"]') && chamber === 'senate') return false;
  if (selector.includes('[data-chamber="senate"]') && chamber === 'house') return false;
  // Only what is required to be present: strip every parenthesised group and attribute
  // selector, which may name things that are absent in a match.
  let flat = '', depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '(' || c === '[') { depth++; continue; }
    if (c === ')' || c === ']') { depth--; continue; }
    if (!depth) flat += c;
  }
  for (const m of flat.matchAll(/[.#](-?[_a-zA-Z][\w-]*)/g)) if (!uni.used(m[1])) return false;
  return true;
}

// ---- generating --------------------------------------------------------------------------

export function generate(css, chamber, uni) {
  const kept = [];            // the text of what survives, used to decide which keyframes do
  const filter = (nodes) => {
    const out = [];
    for (const n of nodes) {
      if (n.kind === 'rule') {
        const live = splitList(n.prelude).filter((s) => alive(s, chamber, uni));
        if (!live.length) continue;
        const text = `${live.map((s) => s.trim()).join(', ')} {${n.body}}`;
        kept.push(text); out.push({ text });
      } else if (n.kind === 'at-block') {
        const children = filter(n.children);
        if (children.length) out.push({ block: n.prelude, children });
      } else if (n.kind === 'at-raw') {
        out.push({ raw: n });
      } else out.push({ text: `${n.prelude};` });
    }
    return out;
  };
  const tree = filter(parse(css));
  // @keyframes and @font-face: faces always, keyframes only when named.
  const keep = (n) => n.name !== 'keyframes' || (() => {
    const name = n.prelude.replace(/^@keyframes\s+/, '').trim();
    const re = new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, '\\-')}([^\\w-]|$)`);
    return kept.some((t) => re.test(t)) || uni.words.has(name);
  })();
  const print = (items, ind = '') => items.map((it) => {
    if (it.text) return ind + it.text;
    if (it.block) return `${ind}${it.block} {\n${print(it.children, ind + '  ')}\n${ind}}`;
    return keep(it.raw) ? `${ind}${it.raw.prelude} {${it.raw.body.replace(/\/\*[\s\S]*?\*\//g, '')}}` : null;
  }).filter((x) => x !== null).join('\n');
  const header = `/* GENERATED by dev/split-css.mjs from styles.css. Do not edit: change styles.css and run \`npm run css\`.\n   The ${chamber} page's stylesheet: every rule that names a class or id its page never uses is\n   left out, in the original order, with comments stripped. */\n`;
  return header + print(tree).replace(/\n{3,}/g, '\n\n') + '\n';
}

export function senateCss() {
  return generate(stripComments(readFileSync(join(ROOT, 'styles.css'), 'utf8')), 'senate', universe(SENATE_FILES));
}

export function houseCss() {
  const header = '/* GENERATED by dev/split-css.mjs from styles.css. Do not edit: change styles.css and run `npm run css`.\n   The house page\'s stylesheet: styles.css with its comments removed and nothing else changed. */\n';
  return header + stripComments(readFileSync(join(ROOT, 'styles.css'), 'utf8')).replace(/^\n+/, '');
}

// ---- CLI ---------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = readFileSync(join(ROOT, 'styles.css'), 'utf8');
  const targets = [['styles.senate.css', senateCss()], ['styles.house.css', houseCss()]];
  if (process.argv.includes('--check')) {
    let bad = 0;
    for (const [name, next] of targets) {
      let cur = ''; try { cur = readFileSync(join(ROOT, name), 'utf8'); } catch {}
      if (cur !== next) { console.error(`${name} is out of date: run \`npm run css\``); bad++; } else console.log(`${name} is current`);
    }
    process.exit(bad ? 1 : 0);
  }
  for (const [name, next] of targets) {
    writeFileSync(join(ROOT, name), next);
    console.log(`styles.css ${src.length} bytes -> ${name} ${next.length} bytes (${Math.round(100 * next.length / src.length)}%)`);
  }
}
