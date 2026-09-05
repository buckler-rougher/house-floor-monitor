#!/usr/bin/env node
//
// Contract test for lib/bill-id.js — the one place bill identifiers are
// normalised, shared by app.js and worker.js.
//
// WHY THIS EXISTS
// The same measure arrives spelled three ways: "H. Res. 1499" (Whip schedule),
// "H RES 1499" (DomeWatch roll call), "H.Res. 1499" (Congress.gov). Comparing
// any two as raw strings fails, and that exact mistake shipped four separate
// times in this codebase before the rule was centralised. If this file goes
// red, resolutions silently stop showing their vote results.
//
//   npm test

require('../lib/bill-id.js');
const { normalizeBillId, parseBillId, billIdFromRollCallQuestion, sameBill } = globalThis.BillId;

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`fail  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`pass  ${label}`);
};

// The three spellings must collapse to one key — this is the whole point.
for (const spelling of ['H. Res. 1499', 'H.Res. 1499', 'H RES 1499', 'HRES1499', 'h. res. 1499'])
  check(`normalize ${JSON.stringify(spelling)}`, normalizeBillId(spelling), 'HRES1499');

// The Whip is inconsistent about the space before the number.
check('normalize "H.R.1869" == "H.R. 1869"', sameBill('H.R.1869', 'H.R. 1869'), true);
check('H.R. 1 is not H. Res. 1', sameBill('H.R. 1', 'H. Res. 1'), false);

// Longest prefix first: H.J.Res. must never be read as H.
check('H.J.Res. 1',      parseBillId('H.J.Res. 1').normalized,      'HJRES1');
check('H J RES 1',       parseBillId('H J RES 1').normalized,       'HJRES1');
check('H.Con.Res. 14',   parseBillId('H.Con.Res. 14').normalized,   'HCONRES14');
check('S.J.Res. 9',      parseBillId('S.J.Res. 9').normalized,      'SJRES9');
check('S. 307',          parseBillId('S. 307').normalized,          'S307');
// DomeWatch writes a bare "H" for a House bill.
check('bare "H 8464"',   parseBillId('H 8464').normalized,          'HR8464');
check('bare "S 1003"',   parseBillId('S 1003').normalized,          'S1003');

// Display spelling is what a person reads.
check('display H RES 1499', parseBillId('H RES 1499').display, 'H. Res. 1499');
check('display H R 4795',   parseBillId('H R 4795').display,   'H.R. 4795');

// Roll-call questions: a vote on the measure itself counts, procedural motions
// and amendment votes do not — they name a bill number without being a vote on
// the bill, and stamping their tally on it reports the wrong outcome.
check('passage',            billIdFromRollCallQuestion('H R 1501 - On Passage'), 'HR1501');
check('resolution adopted', billIdFromRollCallQuestion('H RES 1499 - On Agreeing to the Resolution'), 'HRES1499');
check('suspension',         billIdFromRollCallQuestion('H J RES 1 - On Motion to Suspend the Rules and Pass'), 'HJRES1');
check('recommit excluded',  billIdFromRollCallQuestion('H R 9436 - On Motion to Recommit'), null);
check('prev question excluded', billIdFromRollCallQuestion('H RES 1499 - On Ordering the Previous Question'), null);
check('amendment excluded', billIdFromRollCallQuestion('H R 8595 - Boebert Part A Amendment No. 1 - On Agreeing to the Amendment'), null);
check('table excluded',     billIdFromRollCallQuestion('H RES 12 - On Motion to Table'), null);

// Anchoring: a roll-call question is about the measure it STARTS with.
check('anchored ignores later mentions',
  parseBillId('H R 1501 - On Passage of H.R. 9999', { anchored: true }).normalized, 'HR1501');

// Junk in, null out.
for (const junk of ['', null, undefined, 'On Passage', 'Q 123'])
  check(`no match for ${JSON.stringify(junk)}`, parseBillId(junk), null);

console.log(failed ? `\n${failed} failed` : `\nall bill-id assertions pass`);
process.exit(failed ? 1 : 0);
