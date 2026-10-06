// The sources the (?) explanations and panel summaries cite, read OUT OF THE CODE so there is no second list
// to keep in step: a CRS report is any link to `crs_external_products/.../<ID>.<version>.pdf` in the board's
// scripts and pages, and the year is the "(2024)" after its "CRS Report <ID></a>". Used by
// dev/check-sources.mjs (the network check) and test/sources.test.js (the offline one).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Where explanations live. Add a file here if a new one starts citing sources.
const FILES = ['app.js', 'senate.js', 'index.html', 'senate.html', 'lib/info-content.js'];

const CRS = /crs_external_products\/(?:R|RS|IF)\/PDF\/([A-Za-z0-9-]+)\/\1\.(\d+)\.pdf"[^>]*>CRS Report \1<\/a>\s*(?:\((\d{4})\))?/g;
// Non-CRS sources the explanations lean on: precedents on govinfo and the artwork's catalogue page.
const OTHER = /https:\/\/(?:www\.govinfo\.gov\/content\/pkg\/GPO-HPREC[^"'\s]+\.pdf|artgallery\.yale\.edu\/collections\/objects\/\d+)/g;

function extract(read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')) {
  const crs = [];
  const other = new Set();
  for (const file of FILES) {
    let text;
    try { text = read(file); } catch { continue; }
    for (const m of text.matchAll(CRS)) crs.push({ id: m[1], version: Number(m[2]), year: m[3] ? Number(m[3]) : null, file });
    for (const m of text.matchAll(OTHER)) other.add(m[0]);
  }
  return { crs, other: [...other] };
}

// One citation against what the Congress.gov API says the report is now.
// A newer version is a failure ON PURPOSE: it is the thing to be told about. It stays failing until someone
// re-reads the report and bumps the link, which is the re-read this check exists to cause.
function judge(cite, api) {
  const current = Number(api && api.currentVersion);
  if (!current) return { fail: `the API gave no version for ${cite.id}` };
  if (cite.version < current) {
    const when = api.publishDate ? ` (${String(api.publishDate).slice(0, 10)})` : '';
    return { fail: `cites version ${cite.version}, version ${current}${when} is out: re-read it, then update the link and the year` };
  }
  if (cite.version > current) return { fail: `cites version ${cite.version} but the API says the current one is ${current}` };
  const year = api.publishDate ? Number(String(api.publishDate).slice(0, 4)) : null;
  if (cite.year === null) return { fail: 'has no "(year)" after its source line' };
  if (year && cite.year !== year) return { fail: `shows (${cite.year}) but version ${current} was published in ${year}` };
  return { ok: `version ${current}, ${year}` };
}

module.exports = { extract, judge, FILES };
