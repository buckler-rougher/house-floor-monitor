#!/usr/bin/env node
//
// The time a measure's status was set, from the Clerk's own row (extractBillStatusesFromProceedings, worker.js). 17 November 2026 the card gave H.R. 8483's "Recorded vote requested" as 5:24 PM when
// the Clerk logged it at 4:33:52 PM: the time shown was the House Docs list's update time, not the action's. Each status now carries `at`, the row's Eastern time as UTC, with the clock change handled
// (4:33:52 PM on 17 November is EST, UTC-5; the same hour in July is EDT, UTC-4). The fixture is the Clerk's real rows for H.R. 8483 and H.R. 9600 that afternoon.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractBillStatusesFromProceedings } from '../worker.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'proceedings-2026-11-17.html'), 'utf8');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

const { statuses } = extractBillStatusesFromProceedings(html);

ok('H.R. 8483: the vote request is at 4:33:52 PM EST, 21:33:52 UTC', () => {
  assert.strictEqual(statuses['H.R. 8483'].status, 'roll-call');
  assert.strictEqual(statuses['H.R. 8483'].at, '2026-11-17T21:33:52.000Z');
});
ok('H.R. 9600: the vote request is at 4:44:40 PM EST, 21:44:40 UTC', () => {
  assert.strictEqual(statuses['H.R. 9600'].at, '2026-11-17T21:44:40.000Z');
});
ok('a row in summer is EDT, an hour earlier in UTC than the same clock time in winter', () => {
  const july = html.replace(/11\/17\/2026 16:33:52/, '07/14/2026 16:33:52');
  assert.strictEqual(extractBillStatusesFromProceedings(july).statuses['H.R. 8483'].at, '2026-07-14T20:33:52.000Z');
});
ok('a row with no readable time still gives its status, with no time', () => {
  const broken = html.replace(/11\/17\/2026 16:33:52/, 'not a time');
  const s = extractBillStatusesFromProceedings(broken).statuses['H.R. 8483'];
  assert.strictEqual(s.status, 'roll-call'); assert.strictEqual(s.at, null);
});
console.log(`\n${n} passed`);
