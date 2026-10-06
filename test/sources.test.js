#!/usr/bin/env node
//
// dev/sources.js: the citations the explanations make, read out of the code, and the judgement of one against
// what the Congress.gov API says. The network check (dev/check-sources.mjs) runs weekly in CI; this pins what it
// reads and how it decides, offline. A source line without a year, or one report cited at two versions, fails
// HERE, on every push, before it can reach the live site.

const assert = require('assert');
const { extract, judge } = require('../dev/sources.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

const { crs, other } = extract();
const ids = [...new Set(crs.map((c) => c.id))];

ok('every explanation cites its report with a version and a year', () => {
  for (const c of crs) {
    assert.ok(c.version >= 1, `${c.id} in ${c.file} has no version`);
    assert.ok(c.year >= 2000 && c.year <= 2100, `${c.id} in ${c.file} has no (year) after "CRS Report ${c.id}"`);
  }
});

ok('a report is cited at one version and one year everywhere', () => {
  for (const id of ids) {
    const rows = crs.filter((c) => c.id === id);
    assert.strictEqual(new Set(rows.map((r) => r.version)).size, 1, `${id} cited at more than one version`);
    assert.strictEqual(new Set(rows.map((r) => r.year)).size, 1, `${id} shown with more than one year`);
  }
});

ok('the reports behind the explanations are all found', () => {
  for (const id of ['R41807', 'R45209', 'R48308', '98-314', 'R46626', 'R44539', 'R47039', 'IF11722']) {
    assert.ok(ids.includes(id), `${id} is cited by an explanation and was not found by the reader`);
  }
});

ok('the non-CRS sources are found too', () => {
  assert.ok(other.some((u) => /GPO-HPREC-DESCHLERS-V17/.test(u)));
  assert.ok(other.some((u) => /artgallery\.yale\.edu/.test(u)));
});

ok('judge: the same version and the right year is fine', () => {
  assert.ok(judge({ id: 'R44539', version: 5, year: 2016 }, { currentVersion: 5, publishDate: '2016-06-21T04:00:00Z' }).ok);
});

ok('judge: a newer version fails, and says to re-read it', () => {
  const j = judge({ id: 'R46626', version: 3, year: 2025 }, { currentVersion: 4, publishDate: '2025-09-15T04:00:00Z' });
  assert.ok(/version 4/.test(j.fail) && /re-read/.test(j.fail));
});

ok('judge: a wrong year, a missing year, and an impossible version all fail', () => {
  assert.ok(judge({ id: 'X', version: 2, year: 2024 }, { currentVersion: 2, publishDate: '2025-01-06T00:00:00Z' }).fail);
  assert.ok(judge({ id: 'X', version: 2, year: null }, { currentVersion: 2, publishDate: '2025-01-06T00:00:00Z' }).fail);
  assert.ok(judge({ id: 'X', version: 3, year: 2025 }, { currentVersion: 2, publishDate: '2025-01-06T00:00:00Z' }).fail);
  assert.ok(judge({ id: 'X', version: 2, year: 2025 }, {}).fail);
});

console.log(`\n${n} passed`);
