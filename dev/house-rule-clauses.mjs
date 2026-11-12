#!/usr/bin/env node
// The clauses of the Rules of the House, verbatim, as a lookup: so a special rule that says "clause 1(c) of rule XIX shall not apply" can show what that clause says, in the House's own words,
// rather than anything written by hand or by a model.
//
//   swift dev/pdf-text.swift houserules119thupdated.pdf /tmp/houserules119.txt     (macOS PDFKit; any PDF-to-text that keeps the line breaks will do)
//   node dev/house-rule-clauses.mjs /tmp/houserules119.txt lib/house-rule-clauses.js
//
// Source: "Rules of the House of Representatives, One Hundred Nineteenth Congress", https://rules.house.gov/sites/evo-subsites/rules.house.gov/files/documents/houserules119thupdated.pdf
//
// How it reads the page, with no judgement in it: a rule starts at a line "RULE XIX"; a clause starts at a line "N. " that is the next number in order; a paragraph starts at a line "(a) " that is
// the next letter in order. The headings above a clause ("Previous question") are the short lines without a closing full stop just above its number. The page furniture of the PDF (page numbers,
// the running head "Rule XX, clause 8", "RULES OF THE") is dropped. A word broken at the end of a line ("oper-ating") is joined when the joined spelling appears elsewhere in the document, kept
// hyphenated when the hyphenated spelling does ("one-fifth"), and joined otherwise. `test/house-rule-clauses.test.js` pins the clauses special rules cite.

import fs from 'node:fs';

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) { console.error('usage: node dev/house-rule-clauses.mjs <rules.txt> <out.json>'); process.exit(2); }

let lines = fs.readFileSync(inFile, 'utf8').split('\n').map((l) => l.replace(/\s+$/, ''));
const FURNITURE = [/^=====PAGE \d+=====$/, /^\d+$/, /^\d+ \d+$/, /Jkt \d+ PO \d+ Frm/, /^F:\\/, /^RULES OF THE$/, /^HOUSE OF REPRESENTATIVES$/, /^Rule [IVXL]+, clause \d+/, /^\d+ \d+ Rule [IVXL]+, clause \d+/, /^VerDate/];
lines = lines.filter((l) => l && !FURNITURE.some((re) => re.test(l)));

// word forms in the document, for deciding what a line-end hyphen is
const joinedForms = new Set(); const hyphenForms = new Set();
for (const l of lines) for (const w of l.match(/[A-Za-z]+(?:-[A-Za-z]+)+/g) || []) { hyphenForms.add(w.toLowerCase()); }
for (const l of lines) for (const w of l.match(/[A-Za-z]{4,}/g) || []) joinedForms.add(w.toLowerCase());
function joinLines(ls) {
  let out = '';
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (/[A-Za-z]-$/.test(l) && i + 1 < ls.length && /^[a-z]/.test(ls[i + 1])) {
      const left = l.match(/([A-Za-z]+)-$/)[1]; const right = ls[i + 1].match(/^([a-z]+)/)[1];
      const hyph = `${left}-${right}`.toLowerCase(); const joined = `${left}${right}`.toLowerCase();
      out += hyphenForms.has(hyph) && !joinedForms.has(joined) ? l : l.slice(0, -1);   // keep "one-fifth"; drop the break of "oper-ating"
    } else out += l + (i + 1 < ls.length ? ' ' : '');
  }
  return out.replace(/\s+/g, ' ').trim();
}

// rules: "RULE XIX" headings; a numeral can appear more than once (a contents list), so the last one before the next numeral wins
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII', 'XXVIII', 'XXIX'];
const heads = [];
lines.forEach((l, i) => { const m = l.match(/^RULE ([IVXL]+)$/); if (m && ROMAN.includes(m[1])) heads.push({ rule: m[1], i }); });
const rules = {};
heads.forEach((h, k) => {
  const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
  const seg = lines.slice(h.i + 1, end);
  if (!rules[h.rule] || seg.length > rules[h.rule].length) rules[h.rule] = seg;
});

const SHORT_HEADING = (l) => l.length <= 70 && !/[.;:,]$/.test(l) && !/^\(?[a-z0-9]+[).]/.test(l);
const out = {};
for (const [rule, seg] of Object.entries(rules)) {
  // clause starts: "N. " lines in order 1, 2, 3 ...
  const starts = []; let want = 1;
  seg.forEach((l, i) => { const m = l.match(/^(\d{1,2})\. (?=[(A-Za-z])/); if (m && Number(m[1]) === want) { starts.push({ n: want, i }); want++; } });
  let carried = null;
  starts.forEach((s, k) => {
    let to = k + 1 < starts.length ? starts[k + 1].i : seg.length;
    // the heading lines of the next clause sit just above its number
    let headingFrom = to;
    if (k + 1 < starts.length) while (headingFrom - 1 > s.i && SHORT_HEADING(seg[headingFrom - 1]) && to - headingFrom < 3) headingFrom--;
    const own = seg.slice(s.i, headingFrom);
    let heading = carried;
    carried = headingFrom < to ? joinLines(seg.slice(headingFrom, to)) : null;   // the lines above the NEXT clause's number are its heading
    if (k === 0) { const above = []; for (let j = s.i - 1; j >= 0 && SHORT_HEADING(seg[j]) && above.length < 4; j--) above.unshift(seg[j]); heading = above.length ? joinLines(above.slice(-1)) : null; }
    // paragraphs: the clause's joined text, cut where "(b) " follows the end of a sentence and is the next letter in order (a paragraph does not always start a line in the PDF)
    const full = joinLines(own.map((l, j) => (j === 0 ? l.replace(/^\d{1,2}\. /, '') : l)));
    const paras = {}; let letter = 'a'; let pos = full.startsWith('(a)') ? 0 : -1;
    while (pos >= 0) {
      const next = String.fromCharCode(letter.charCodeAt(0) + 1);
      const re = new RegExp(`(?<=[.:;\\u2014\\u201d] )\\(${next}\\) `, 'g'); re.lastIndex = pos + 1;
      const m = re.exec(full);
      paras[letter] = full.slice(pos, m ? m.index : undefined).trim();
      if (!m) break; pos = m.index; letter = next;
    }
    (out[rule] = out[rule] || {})[s.n] = { heading: heading || null, text: full, ...(Object.keys(paras).length ? { paragraphs: paras } : {}) };
  });
}
const doc = {
  source: { title: 'Rules of the House of Representatives, One Hundred Nineteenth Congress', url: 'https://rules.house.gov/sites/evo-subsites/rules.house.gov/files/documents/houserules119thupdated.pdf', note: 'Verbatim, from the PDF the House publishes. Line-end hyphens repaired by dev/house-rule-clauses.mjs; page furniture dropped.' },
  rules: out,
};
fs.writeFileSync(outFile, `// GENERATED by dev/house-rule-clauses.mjs from the House's published Rules of the House. Do not edit.\n(function (root) { root.HouseRuleClauses = ${JSON.stringify(doc)}; })(typeof globalThis !== 'undefined' ? globalThis : this);\n`);
const nClauses = Object.values(out).reduce((a, r) => a + Object.keys(r).length, 0);
console.log(`${Object.keys(out).length} rules, ${nClauses} clauses, ${Math.round(fs.statSync(outFile).size / 1024)} KB -> ${outFile}`);
