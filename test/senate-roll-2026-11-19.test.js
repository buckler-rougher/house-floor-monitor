#!/usr/bin/env node
//
// The roll call on passage of H.R. 2347, 19 November 2026 (roll 270, 62-33), replayed through the same reader the Worker runs, one 12-second caption segment at a time, and held to the Senate's own roll.
// The reader may MISS a senator (the clerk's answers are not all captioned: six were not that night) but must never put one on the wrong side, and every name it keeps must be a senator on the roll
// ("CAT TON" once kept its own entry). It must also read the chair's question and outcome. This is the test that would have caught the page and the Worker disagreeing: it fails on any single wrong vote.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SC = require('../lib/senate-call.js');
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

const dir = path.join(__dirname, 'senate-roll-2026-11-19');
const segs = JSON.parse(fs.readFileSync(path.join(dir, 'captions.json'), 'utf8'));
const xml = fs.readFileSync(path.join(dir, 'roll270.xml'), 'utf8');
const fold = (v) => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const official = {};
for (const m of xml.match(/<member>[\s\S]*?<\/member>/g)) {
  const last = fold(m.match(/<last_name>(.*?)<\/last_name>/)[1]);
  const st = m.match(/<state>(.*?)<\/state>/)[1];
  const v = m.match(/<vote_cast>(.*?)<\/vote_cast>/)[1];
  official[last === 'SCOTT' ? `SCOTT (${st})` : last] = v === 'Yea' ? 'AYE' : v === 'Nay' ? 'NO' : v.toUpperCase();
}

const T0 = Date.UTC(2026, 0, 1);
let call = SC.emptyCall(), final = null, questionAtStart = null;
for (const { n: seg, vtt } of segs) {
  const heard = T0 + seg * 12000;
  call = SC.expire(call, heard);
  call = SC.feedVtt(call, vtt, heard);
  if (call.kind === 'vote') { final = JSON.parse(JSON.stringify(call)); if (!questionAtStart && call.question) questionAtStart = call.question; }
}

test('the replay found the roll call and its end', () => {
  assert(final && final.kind === 'vote', 'a vote');
  assert(final.ended && final.ended.how === 'closed', 'closed by the chair');
  assert.strictEqual(final.ended.yeas, 62);
  assert.strictEqual(final.ended.nays, 33);
});

test('NO senator is on the wrong side: every vote the reader kept matches the official roll', () => {
  const wrong = Object.entries(final.votes).filter(([k, v]) => k in official && official[k] !== v).map(([k, v]) => `${k}: heard ${v}, official ${official[k]}`);
  assert.deepStrictEqual(wrong, []);
});

test('every name the reader kept is a senator on the roll (a garbled name is snapped, never kept as its own entry)', () => {
  const strangers = Object.keys(final.votes).filter((k) => !(k in official));
  assert.deepStrictEqual(strangers, []);
});

test('it hears at least what it heard that night, and misses only senators the captions never carried', () => {
  const heard = Object.keys(final.votes).length;
  assert(heard >= 89, `heard ${heard}`);   // 89 senators: Cotton once (the garbled "CAT TON" was a second entry for him, which counted him twice)
  const missed = Object.keys(official).filter((k) => !(k in final.votes) && (official[k] === 'AYE' || official[k] === 'NO')).sort();
  assert(missed.length <= 6, 'missed ' + missed.join(', '));   // Baldwin, Heinrich, King, Marshall, McCormick, Moody
});

test('the chair\'s question ("THE QUESTION OCCURS ON PASSAGE") is read, and the outcome ("THE BILL, AS AMENDED, PASSES")', () => {
  assert(/PASSAGE/.test(final.question || ''), String(final.question));
  assert.strictEqual(final.ended.outcome, 'PASSED');
});

console.log(`\n${n} passed`);
