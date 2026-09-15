#!/usr/bin/env node
//
// Contract test for lib/crec.js — the Congressional Record used as ground truth
// for who actually spoke on the House floor.
//
// WHY THIS EXISTS
// This is the only automated check on lib/floor-speaker.js's accuracy. Every
// wrong name the site showed during the 2026-09-14 session was caught by a person
// watching the floor; the resolved-share statistic climbed the whole time and
// said nothing. If this grader is itself wrong, that stays true.
//
// The two failure modes that would make it worthless are both asserted below:
// counting Extensions of Remarks (text submitted for printing, never spoken) as
// floor speech, and grading a day whose Record has not been published yet — which
// would flag every correctly-identified member as a false positive.
//
//   npm test

require('../lib/crec.js');
const { parseCrecSpeakers, gradeTimeline, granuleOrder, runs, lcsLength } = globalThis.Crec;

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`fail  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`pass  ${label}`);
};

const granule = (id, prefix, title, members) => `
<relatedItem type="constituent" ID="id-${id}">
  <extension>
    <pagePrefix>${prefix}</pagePrefix><chamber>HOUSE</chamber>
    <title>${title}</title>
    ${members.map(([bid, role, name, st]) =>
      `<congMember bioGuideId="${bid}" chamber="H" congress="119" party="D" role="${role}" state="${st || 'VA'}">
         <name type="parsed">${name}</name>
       </congMember>`).join('')}
  </extension>
</relatedItem>`;

const mods = `<mods>
${granule('CREC-2026-09-03-pt1-PgH5481-5', 'H', 'WELCOMING', [['M001223', 'SPEAKING', 'Mr. MAGAZINER', 'RI']])}
${granule('CREC-2026-09-03-pt1-PgH5490',   'H', 'DEBATE',    [['W000821', 'SPEAKING', 'Mr. WESTERMAN', 'AR'], ['H001094', 'SPEAKING', 'Ms. HOYLE', 'OR']])}
${granule('CREC-2026-09-03-pt1-PgE853-3',  'E', 'TRIBUTE',   [['B001292', 'SPEAKING', 'Mr. BEYER', 'VA']])}
${granule('CREC-2026-09-03-pt1-PgH5495',   'H', 'SUBMITTED', [['C001130', 'SUBMITTING', 'Mr. CASTRO', 'TX']])}
</mods>`;

const speakers = parseCrecSpeakers(mods);
check('only House floor speeches are counted', speakers.map((s) => s.bioguideId), ['M001223', 'W000821', 'H001094']);
check('parsed name survives', speakers[0].parsedName, 'Mr. MAGAZINER');

// An E-page granule is text submitted for printing — the member was never at the
// microphone. Counting those would credit the resolver for people not in the room;
// on 2026-09-03 they were 41 of 155 granules.
check('Extensions of Remarks excluded', speakers.some((s) => s.bioguideId === 'B001292'), false);
check('SUBMITTING excluded', speakers.some((s) => s.bioguideId === 'C001130'), false);

// Page order is numeric. Sorting the ids as strings puts H999 after H5481.
check('H999 sorts before H5481', granuleOrder('CREC-x-PgH999')[0] < granuleOrder('CREC-x-PgH5481')[0], true);
check('sub-index orders within a page', granuleOrder('CREC-x-PgH5481-5'), [5481, 5]);
check('bare page is index 1', granuleOrder('CREC-x-PgH5481'), [5481, 1]);

const tl = (...ids) => ids.map((id, i) => ({
  t: i, role: 'speech', basis: 'manager-binding',
  member: id ? { bioguideId: id, last: id } : null,
}));

// The number that matters: a member named by the site who never spoke.
const bad = gradeTimeline(tl('W000821', 'ZZZ9999'), speakers);
check('a name absent from the Record is unconfirmed', bad.unconfirmedIds, ['ZZZ9999']);
check('precision reflects it', bad.precisionPct, 50);
check('the failing rule is named', bad.byBasis['manager-binding'].unconfirmedTurns, 1);

const good = gradeTimeline(tl('M001223', 'W000821', 'H001094'), speakers);
check('all-correct scores 100% precision', good.precisionPct, 100);
check('and 100% recall', good.recallPct, 100);
check('and 100% order', good.sequencePct, 100);

// Order is scored separately from membership: the same three members in the wrong
// sequence means hand-offs were missed, which is how one member's name lands on
// another's speech.
const scrambled = gradeTimeline(tl('H001094', 'W000821', 'M001223'), speakers);
check('wrong order still scores full precision', scrambled.precisionPct, 100);
check('but order is penalised', scrambled.sequencePct < 100, true);

// Consecutive turns by one member are one speech in the Record.
check('runs collapse repeats', runs(['a', 'a', 'b', 'b', 'a']), ['a', 'b', 'a']);
check('lcs of disjoint runs is 0', lcsLength(['a'], ['b']), 0);

// Grading a day the Record has not covered must report NOT GRADED. Scoring it
// would call every correct name a false positive — the one result that would make
// this tool worth ignoring.
const ungraded = gradeTimeline(tl('W000821', 'H001094'), []);
check('no Record means not graded', ungraded.graded, false);
check('no false unconfirmed list', ungraded.unconfirmedIds, undefined);
check('coverage still reported', ungraded.coveragePct, 100);
check('a graded day says so', good.graded, true);

for (const junk of [null, undefined, '', '<mods></mods>'])
  check(`no crash on ${JSON.stringify(junk)}`, parseCrecSpeakers(junk).length, 0);

console.log(failed ? `\n${failed} failed` : `\nall crec assertions pass`);
process.exit(failed ? 1 : 0);
