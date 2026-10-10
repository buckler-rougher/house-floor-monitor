#!/usr/bin/env node
//
// Contract test for lib/congress-bills.js -- how a bill's committee report is read off Congress.gov.
//
// WHY THIS EXISTS
// The House's bill meta and the new Senate bill endpoint both need "which action is the committee
// reporting this out, and what vote did it carry?". That logic was inline in the House Worker; it is
// now one function, and the House's answer must not have moved. `legacy` below is the original loop,
// copied from the Worker before it was lifted out; it is run against every action list here and the
// two must agree.
//
// The action texts are real, from Congress.gov on 4 October 2026 (test/congress/*.json: excerpts
// of the responses, the values exactly as returned). The Senate's are the case that matters: they
// record "Reported by Senator Cruz ... Without written report" and carry NO vote count, and must read
// as plain "Reported", never an invented tally. No network.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CB = require('../lib/congress-bills.js');
const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'congress', f), 'utf8'));
const sActions = load('s-4668-actions.json').actions;
const hActions = load('hr-7008-actions.json').actions;

// The House Worker's original committee extraction, verbatim, from before it was lifted out.
function legacy(actions) {
  let committeeReport = null;
  let committeeReportFallback = null;
  for (const action of (actions || [])) {
    if (!committeeReport && action.type === 'Committee') {
      const text = action.text || '';
      if (/ordered to be reported/i.test(text)) {
        committeeReport = { text: CB.formatCommitteeReport(text), date: action.actionDate };
      } else if (!committeeReportFallback && /reported\s+(?:\([^)]*\)\s+)?by\s+the\s+committee/i.test(text)) {
        committeeReportFallback = { text: CB.formatCommitteeReport(text), date: action.actionDate };
      }
    }
  }
  if (!committeeReport && committeeReportFallback) committeeReport = committeeReportFallback;
  return committeeReport;
}

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('a House bill: the markup vote is the tally (7 - 4), dated the day of the markup', () => {
  assert.deepStrictEqual(CB.pickCommitteeReport(hActions), { text: 'Reported by Committee 7 – 4', date: '2026-01-14' });
});

ok('a Senate bill reads as plain "Reported", with the date it was ordered reported, and no tally', () => {
  const r = CB.pickCommitteeReport(sActions);
  assert.deepStrictEqual(r, { text: 'Reported by Committee', date: '2026-06-18' });
  assert.ok(!/\d/.test(r.text), 'a count was invented');
});

ok('a Senate bill with ONLY "Reported by Senator ..." is still reported', () => {
  const only = sActions.filter((a) => /Reported by Senator/.test(a.text));
  assert.deepStrictEqual(CB.pickCommitteeReport(only), { text: 'Reported by Committee', date: '2026-06-24' });
});

ok('the House answer is exactly what the original inline code gave, on every list here', () => {
  const lists = [
    hActions, sActions,
    hActions.slice().reverse(), sActions.slice().reverse(),
    hActions.filter((a) => !/Ordered/.test(a.text)),                         // only the formal report
    hActions.filter((a) => /Ordered/.test(a.text)),                          // only the markup
    [{ type: 'Floor', text: 'Ordered to be reported' }],                     // not a Committee action
    [{ type: 'Committee', text: 'Ordered to be Reported by Unanimous Consent.', actionDate: '2026-03-01' }],
    [{ type: 'Committee', text: 'Reported by the Committee on Rules. H. Rept. 119-1.', actionDate: '2026-03-02' }],
    [{ type: 'Committee', text: 'Reported (Amended) by the Committee on Ways and Means.', actionDate: '2026-03-03' },
     { type: 'Committee', text: 'Ordered to be Reported (Amended) by Voice Vote.', actionDate: '2026-03-01' }],
    [], null, undefined,
  ];
  for (const l of lists) assert.deepStrictEqual(CB.pickCommitteeReport(l), legacy(l), String(JSON.stringify(l)).slice(0, 90));
});

ok('the one deliberate difference from the original: "Reported by Senator ..." now counts', () => {
  const senateOnly = [{ type: 'Committee', text: 'Committee on Finance. Reported by Senator Crapo without amendment.', actionDate: '2026-04-01' }];
  assert.strictEqual(legacy(senateOnly), null);
  assert.deepStrictEqual(CB.pickCommitteeReport(senateOnly), { text: 'Reported by Committee', date: '2026-04-01' });
});

ok('unanimous consent, a voice vote and a tally keep the wording the House board shows', () => {
  assert.strictEqual(CB.formatCommitteeReport('Ordered to be Reported by Unanimous Consent.'), 'Reported out of cmte by unanimous consent');
  assert.strictEqual(CB.formatCommitteeReport('Ordered to be Reported (Amended) by the Yeas and Nays: 30 - 0.'), 'Reported by Committee 30 – 0');
  assert.strictEqual(CB.formatCommitteeReport('Ordered to be Reported by Voice Vote.'), 'Reported by Committee (voice vote)');
  assert.strictEqual(CB.formatCommitteeReport('Reported.'), 'Reported by Committee');
  assert.strictEqual(CB.formatCommitteeReport(null), 'Reported by Committee');
});

ok('a report citation becomes its PDF, for either chamber', () => {
  assert.deepStrictEqual(CB.committeeReportLink('H. Rept. 119-479'), { citation: 'H. Rept. 119-479', url: 'https://www.congress.gov/119/crpt/hrpt479/CRPT-119hrpt479.pdf' });
  assert.deepStrictEqual(CB.committeeReportLink('S. Rept. 119-23'), { citation: 'S. Rept. 119-23', url: 'https://www.congress.gov/119/crpt/srpt23/CRPT-119srpt23.pdf' });
  // the House Worker's own example
  assert.strictEqual(CB.committeeReportLink('H. Rept. 119-632').url, 'https://www.congress.gov/119/crpt/hrpt632/CRPT-119hrpt632.pdf');
});

ok('anything that is not a citation is no link, never a guess', () => {
  for (const c of ['', null, undefined, 'See report', 'H. Rept. 119', 'Senate Report 119-1']) {
    assert.deepStrictEqual(CB.committeeReportLink(c), { citation: null, url: null }, String(c));
  }
});

console.log(`\n${n} passed`);
