#!/usr/bin/env node
//
// The Hegseth impeachment, 10 November 2026: H. Res. 1655 was called up as a privileged matter, Mr. Issa moved to refer it to the Judiciary and the House agreed, 211-204 (Roll no. 317).
// The rows below are the Clerk's own wording, newest first as the Clerk lists them, in the shape of its page (a hidden span carries the full text and the time). What is pinned:
// the referral is read as the resolution's outcome, it is not given to the rule H. Res. 1650 whose "unfinished business" row follows it in the feed, and the schedule's unnumbered
// "H. Res. ___" with a title shorter than ninety characters is matched to the numbered resolution.

import assert from 'node:assert';
import { extractBillStatusesFromProceedings } from '../worker.js';

const link = (n) => `<a target="_blank" rel="bill" href="https://www.congress.gov/bill/119th-congress/house-resolution/${n}">H. Res. ${n}</a>`;
const row = (time, html) => `<tr><td><span style="display:none;">11/10/2026 ${time}</span></td><td data-label="Activity"><span style="display:none;">${html}</span></td></tr>`;
const page = `<table>
${row('18:03:00', `Considered as unfinished business. ${link(1650)} — " Providing for consideration of the bill ( H.R. 1013 ) to amend the Federal securities laws to enhance 403(b) plans, and for other purposes ."`)}
${row('18:02:41', 'On motion to refer Agreed to by the Yeas and Nays: 211 - 204 (Roll no. 317) .')}
${row('17:35:01', 'The previous question on the motion to refer was ordered without objection.')}
${row('17:34:23', `DEBATE - The House proceeded with one hour of debate on motion to refer ${link(1655)} .`)}
${row('17:34:11', 'Mr. Issa moved to refer to the Judiciary.')}
${row('17:33:54', `Considered as privileged matter. ${link(1655)} — " Impeaching Peter Brian Hegseth, Secretary of Defense, for high crimes and misdemeanors ."`)}
</table>`;

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const { statuses, titles } = extractBillStatusesFromProceedings(page, 'https://clerk.house.gov/FloorSummary/ViewFloorActions?date=11%2F10%2F2026');
const key = Object.keys(statuses).find((k) => /1655/.test(k));

ok('the referral is the outcome of H. Res. 1655: the terminal status "disposed" (not passed, not failed) with the words saying what happened', () => {
  assert.ok(key, `no status for 1655 in ${JSON.stringify(Object.keys(statuses))}`);
  assert.strictEqual(statuses[key].status, 'disposed');
  assert.strictEqual(statuses[key].statusText, 'Referred (Roll Call 317): 211-204');
});

ok('it is not given to the rule whose row follows it in the feed', () => {
  assert.ok(!Object.keys(statuses).some((k) => /1650/.test(k) && /Referred/.test(statuses[k].statusText || '')));
});

ok("the Clerk's text for 1655 carries the title the schedule uses, so a short title can be matched whole", () => {
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const schedule = norm('Impeaching Peter Brian Hegseth, Secretary of Defense, for high crimes and misdemeanors.');
  assert.ok(schedule.length < 90);
  assert.ok(norm(titles[key]).includes(schedule));
});

ok('a motion to refer that is not agreed to leaves the resolution where it was', () => {
  const failed = page.replace('Agreed to by the Yeas and Nays: 211 - 204', 'Failed by the Yeas and Nays: 204 - 211');
  const r = extractBillStatusesFromProceedings(failed, 'x').statuses;
  assert.ok(!Object.keys(r).some((k) => /1655/.test(k) && (r[k].status === 'failed' || r[k].status === 'disposed')));
});

console.log(`\n${n} passed`);
