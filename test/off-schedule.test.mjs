#!/usr/bin/env node
//
// ALSO ON THE FLOOR (offScheduleBills in worker.js), from the Clerk's own rows for Wednesday 11 November 2026: H.Res. 1247 (the rule Takano's discharge motion brought up) and H.R. 9237,
// resumed as unfinished business and passed by voice vote. Neither is in any of the eleven versions of the Majority Leader's schedule that week, so the panel, built from that schedule, had
// no card for them. H.R. 2102, the bill the rule provides for, gets none: the log names it only inside the rule's title and has no row where the House took it up, and the rule's card
// already says so. What is pinned: they get cards, a measure the schedule has does not, a bill only named in passing does not, and a measure with no outcome row says what the Clerk last
// said instead of an invented result.

import assert from 'node:assert';
import { extractBillStatusesFromProceedings, offScheduleBills } from '../worker.js';

const link = (kind, n, label) => `<a target="_blank" rel="bill" href="https://www.congress.gov/bill/119th-congress/${kind}/${n}">${label}</a>`;
const row = (time, html) => `<tr><td><span style="display:none;">11/11/2026 ${time}</span></td><td data-label="Activity"><span style="display:none;">${html}</span></td></tr>`;
const page = `<table>
${row('17:15:18', `Considered as unfinished business. ${link('house-bill', 5549, 'H.R. 5549')} — " To amend the Atomic Energy Act of 1954 to provide for more efficient hearings on nuclear facility construction applications, and for other purposes ."`)}
${row('14:46:08', 'On passage Passed by voice vote.')}
${row('14:44:08', `Considered as unfinished business. ${link('house-bill', 9237, 'H.R. 9237')} — " To amend titles 10 and 38, United States Code, and other Federal laws, to improve benefits for veterans and the administration of the Department of Veterans Affairs ."`)}
${row('14:44:02', 'Pursuant to clause 1(c) of rule XIX, the House resumed consideration on HR 9237.')}
${row('13:32:25', `POSTPONED PROCEEDINGS - At the conclusion of debate on ${link('house-resolution', 1247, 'H. Res. 1247')} , the Chair put the question on agreeing to the resolution and by voice vote, announced that the noes had prevailed. Mr. Takano demanded the yeas and nays and the Chair postponed further proceedings until a time to be announced.`)}
${row('13:05:33', `DEBATE - The House proceeded with one hour of debate on ${link('house-resolution', 1247, 'H. Res. 1247')} .`)}
${row('13:05:31', `Considered from the Discharge Calendar. ${link('house-resolution', 1247, 'H. Res. 1247')} — " Providing for consideration of the bill ( ${link('house-bill', 2102, 'H.R. 2102')} ) to amend title 10, United States Code, to provide for concurrent receipt of veterans' disability compensation and retired pay for disability retirees with combat-related disabilities, and for other purposes ."`)}
${row('11:00:00', `Mr. Smith asked unanimous consent to insert a statement about ${link('house-bill', 7777, 'H.R. 7777')} in the record.`)}
</table>`;

const { statuses, titles } = extractBillStatusesFromProceedings(page, 'https://clerk.house.gov/FloorSummary/ViewFloorActions?date=11%2F11%2F2026');
const onSchedule = [{ id: 'H.R. 5549' }];   // on the schedule that week
const out = offScheduleBills(onSchedule, titles, statuses);
const by = (n) => out.find((b) => new RegExp(String(n)).test(b.id));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('the two the schedule never listed get cards; the one it did, a bill only named in the rule\'s title, and one only named in passing, do not', () => {
  assert.deepStrictEqual(out.map((b) => b.id).sort(), ['H. Res. 1247', 'H.R. 9237']);
});

ok("the title is the Clerk's quoted text, tidied (no space before a full stop or inside brackets)", () => {
  assert.strictEqual(by(9237).title, 'To amend titles 10 and 38, United States Code, and other Federal laws, to improve benefits for veterans and the administration of the Department of Veterans Affairs.');
  assert.ok(by(1247).title.startsWith('Providing for consideration of the bill (H.R. 2102) to amend title 10'));
});

ok('a measure with an outcome row says so; one whose last row is a postponement says that, not a result', () => {
  assert.strictEqual(by(1247).status, 'roll-call');
  assert.ok(/postponed/i.test(by(1247).latestAction));
});

ok('every card is marked as off the schedule and drawn from the Clerk', () => {
  for (const b of out) { assert.strictEqual(b.offSchedule, true); assert.strictEqual(b.actionSource, 'proceedings'); assert.strictEqual(b.considered, true); }
});

ok('nothing is added when everything taken up is on the schedule', () => {
  assert.deepStrictEqual(offScheduleBills([{ id: 'H.R. 5549' }, { id: 'H. Res. 1247' }, { id: 'H.R. 2102' }, { id: 'H.R. 9237' }, { id: 'H.R. 7777' }], titles, statuses), []);
});

console.log(`\n${n} passed`);
