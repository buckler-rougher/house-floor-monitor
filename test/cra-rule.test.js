#!/usr/bin/env node
// lib/cra-rule.js: titles of three real 119th Congress CRA resolutions (H.J.Res. 25, 26 and 100, as Congress.gov wrote them: straight quotes, and doubled
// apostrophes) and a real Federal Register search answer (test/fr-rule-search.json: "Gross Proceeds Reporting ...", two rules of that title).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../lib/cra-rule.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const T25 = 'Providing for congressional disapproval under chapter 8 of title 5, United States Code, of the rule submitted by the Internal Revenue Service relating to "Gross Proceeds Reporting by Brokers That Regularly Provide Services Effectuating Digital Asset Sales".';
const T100 = "Providing for congressional disapproval under chapter 8 of title 5, United States Code, of the rule submitted by the Federal Trade Commission relating to ''Negative Option Rule''.";

ok('the agency and the rule\'s title come out of a CRA resolution\'s title, whatever quotes it uses', () => {
  assert.deepStrictEqual(C.parse(T25), { agency: 'Internal Revenue Service', ruleTitle: 'Gross Proceeds Reporting by Brokers That Regularly Provide Services Effectuating Digital Asset Sales' });
  assert.deepStrictEqual(C.parse(T100), { agency: 'Federal Trade Commission', ruleTitle: 'Negative Option Rule' });
  assert.strictEqual(C.parse(T25.replace(/"/g, '“').replace('Sales“', 'Sales”').replace('relating to “', 'relating to “')).agency, 'Internal Revenue Service');
});
ok('any other title is not one', () => {
  assert.strictEqual(C.parse('Providing for consideration of the bill (H.R. 1) to do something.'), null);
  assert.strictEqual(C.parse(''), null);
  assert.strictEqual(C.parse(null), null);
});
ok('the search asks for rules only, with the title quoted', () => {
  const u = C.searchUrl('Negative Option Rule');
  assert.ok(u.startsWith('https://www.federalregister.gov/api/v1/documents.json?') && u.includes('conditions%5Bterm%5D=%22Negative+Option+Rule%22') && u.includes('conditions%5Btype%5D%5B%5D=RULE'));
});
ok('of two rules with the title, the one from the named agency that came first (the Federal Register lists the IRS under the Treasury)', () => {
  const fr = JSON.parse(fs.readFileSync(path.join(__dirname, 'fr-rule-search.json'), 'utf8'));
  const p = C.pick(fr.results, 'Internal Revenue Service', 'Gross Proceeds Reporting by Brokers That Regularly Provide Services Effectuating Digital Asset Sales');
  assert.strictEqual(p.date, '2024-12-30');
  assert.ok(p.url.startsWith('https://www.federalregister.gov/documents/2024/12/30/'));
  assert.strictEqual(p.agency, 'Treasury Department');
});
ok('only a document whose own title is the rule\'s counts; nothing like it is no link', () => {
  const rs = [{ title: 'Telemarketing Sales Rule', publication_date: '2024-04-16', html_url: 'https://x', agencies: [] }, { title: 'Negative Option Rule', publication_date: '2024-11-15', html_url: 'https://y', agencies: [{ name: 'Federal Trade Commission' }] }];
  assert.strictEqual(C.pick(rs, 'Federal Trade Commission', 'Negative Option Rule').url, 'https://y');
  assert.strictEqual(C.pick(rs, 'Federal Trade Commission', 'Something Else'), null);
  assert.strictEqual(C.pick([], 'x', 'y'), null);
});
console.log(`\n${n} passed`);
