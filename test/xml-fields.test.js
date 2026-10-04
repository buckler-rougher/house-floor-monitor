#!/usr/bin/env node
//
// Contract test for lib/xml-fields.js -- reading one field out of an XML block.
//
// WHY THIS EXISTS
// Five Worker handlers each had their own one-line reader, and they differ: attributes on the
// opening tag, CDATA markers, inner tags, only trimming. They were merged into one reader with
// options. A merge like that is only safe if every preset still returns EXACTLY what the
// lambda it replaced returned, so the originals are kept below, verbatim from before the
// change, as the reference, and every preset is compared with its original over inputs chosen
// to tell the variants apart. No network, no dependencies.
//
//   npm test

const assert = require('assert');
const X = require('../lib/xml-fields.js');

// ---- the originals, verbatim from worker.js before the merge
const was = {
  nomination: (b, t) => {
    const m = b.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`));
    return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\s+/g, ' ').trim() : '';
  },
  plain: (b, t) => {
    const m = b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`));
    return m ? m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  },
  raw: (b, t) => {
    const m = b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`));
    return m ? m[1].trim() : '';
  },
  text: (b, t) => {
    const m = b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`));
    return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ')
                   .replace(/\s+/g, ' ').trim() : '';
  },
};

// ---- inputs chosen to tell the four apart
const blocks = [
  '<vote_number>00242</vote_number>',
  '<title>  Motion to Invoke Cloture:   S. 4668,\n   as Amended  </title>',
  '<question>On the <measure>S.Amdt. 6776</measure> to <b>the</b> bill</question>',
  '<issue><![CDATA[S. 4668]]></issue>',
  '<result>  <![CDATA[ Agreed   to ]]> </result>',
  '<NominationDisplayNumber DocumentType="PN" NominationNumber="1022">PN1022-36</NominationDisplayNumber>',
  '<NominationDisplayNumber>PN5</NominationDisplayNumber>',
  '<name>Schumer, Charles E.</name><state>NY</state>',
  '<a>one</a><a>two</a>',
  '<empty></empty>',
  '<spaced>\n\n a \t b \n</spaced>',
  '<nested><x><![CDATA[ in <i>cdata</i> ]]></x></nested>',
  'no tags here at all',
  '',
];
const tags = ['vote_number', 'title', 'question', 'issue', 'result', 'NominationDisplayNumber', 'name', 'state', 'a', 'empty', 'spaced', 'nested', 'missing'];

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

const same = (preset, original) => {
  const diffs = [];
  for (const b of blocks) for (const t of tags) {
    const got = X[preset](b, t), want = original(b, t);
    if (got !== want) diffs.push(`${preset}(${JSON.stringify(b.slice(0, 40))}, ${t}): got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
  assert.deepStrictEqual(diffs, []);
};

test('xmlNomination returns exactly what the nominations reader did', () => same('xmlNomination', was.nomination));
test('xmlPlain returns exactly what the plain element readers did (three handlers)', () => same('xmlPlain', was.plain));
test('xmlRaw returns exactly what the schedule reader did', () => same('xmlRaw', was.raw));
test('xmlText returns exactly what the roster and vote readers did (two handlers)', () => same('xmlText', was.text));

test('the variants really are different, so merging them blindly would have changed behaviour', () => {
  const b = '<question>On <measure>S.Amdt. 6776</measure></question>';
  assert.notStrictEqual(X.xmlRaw(b, 'question'), X.xmlPlain(b, 'question'));
  const c = '<issue><![CDATA[S. 4668]]></issue>';
  assert.notStrictEqual(X.xmlPlain(c, 'issue'), X.xmlText(c, 'issue'));
  const d = '<NominationDisplayNumber DocumentType="PN">PN9</NominationDisplayNumber>';
  assert.notStrictEqual(X.xmlText(d, 'NominationDisplayNumber'), X.xmlNomination(d, 'NominationDisplayNumber'));
  assert.strictEqual(X.xmlText(d, 'NominationDisplayNumber'), '', 'a tag with attributes is invisible without attrs');
});

test('the nominations reader is the one that sees a tag with attributes', () => {
  assert.strictEqual(X.xmlNomination('<NominationDisplayNumber DocumentType="PN" NominationNumber="1022">PN1022-36</NominationDisplayNumber>', 'NominationDisplayNumber'), 'PN1022-36');
});

test('a missing tag, an empty block and a non-string all read as the empty string', () => {
  for (const f of ['xmlText', 'xmlPlain', 'xmlRaw', 'xmlNomination']) {
    assert.strictEqual(X[f]('<a>x</a>', 'b'), '');
    assert.strictEqual(X[f]('', 'a'), '');
    assert.strictEqual(X[f](undefined, 'a'), '');
  }
});

test('only the first occurrence is read', () => assert.strictEqual(X.xmlRaw('<a>one</a><a>two</a>', 'a'), 'one'));

console.log(`\n${n} passed`);
