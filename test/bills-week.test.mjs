#!/usr/bin/env node
//
// Which week's schedule the Bills This Week panel reads (pickBillsWeekStart in worker.js). What is pinned: a weekend belongs to the coming week; a recess week whose next
// week's schedule is already posted shows that one (the panel was empty); a week with its own schedule keeps it; a past date asked for by the time machine is the plain week.

import assert from 'node:assert';
import { pickBillsWeekStart } from '../worker.js';

const mon = (y, m, d) => Date.UTC(y, m - 1, d);                 // a Monday as the feed's week start (ms)
const at = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 15));    // an afternoon, UTC
const iso = (d) => d.toISOString().slice(0, 10);
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

ok('Saturday 7 Nov, with the 9 Nov schedule posted: the coming week', () => assert.strictEqual(iso(pickBillsWeekStart(at(2026, 11, 7), [mon(2026, 11, 9)], true)), '2026-11-09'));
ok('Sunday 8 Nov: the coming week too', () => assert.strictEqual(iso(pickBillsWeekStart(at(2026, 11, 8), [mon(2026, 11, 9)], true)), '2026-11-09'));
ok('Wednesday of a recess week, next week posted: next week', () => assert.strictEqual(iso(pickBillsWeekStart(at(2026, 11, 4), [mon(2026, 10, 26), mon(2026, 11, 9)], true)), '2026-11-09'));
ok('a week with its own schedule keeps it, even with the next posted', () => assert.strictEqual(iso(pickBillsWeekStart(at(2026, 11, 11), [mon(2026, 11, 9), mon(2026, 11, 16)], true)), '2026-11-09'));
ok('Wednesday of a recess week, nothing posted for next week: this week (the caller falls back to the one before)', () => assert.strictEqual(iso(pickBillsWeekStart(at(2026, 11, 4), [mon(2026, 10, 26)], true)), '2026-11-02'));
ok('Saturday with only the week just ended posted: the coming Monday (the caller falls back to the one before it)', () => assert.strictEqual(iso(pickBillsWeekStart(at(2026, 11, 7), [mon(2026, 11, 2)], true)), '2026-11-09'));
ok('a past date for the time machine is the plain calendar week', () => assert.strictEqual(iso(pickBillsWeekStart(at(2026, 11, 7), [mon(2026, 11, 9)], false)), '2026-11-02'));
ok('Monday is its own week', () => assert.strictEqual(iso(pickBillsWeekStart(at(2026, 11, 9), [mon(2026, 11, 9)], true)), '2026-11-09'));
console.log(`\n${n} passed`);
