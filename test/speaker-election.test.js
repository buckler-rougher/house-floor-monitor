#!/usr/bin/env node
//
// lib/speaker-election.js: the election of the Speaker, counted from the captions as the roll is read. The fixtures are the REAL captions of 3 January 2025 (1,046 cues, the House
// broadcast's captions.vtt) and the 434 Members of that day with how each voted (roll 2 of the Clerk's, roll002.xml): Johnson (LA) 218, Jeffries 215, Emmer 1.
// What is pinned is what the reader may promise: a FLOOR (it hears most answers, never more than were given, and not the chair's words), the tellers' totals when they are read, the
// candidates, and a second ballot starting when the first elects no one. No network.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SE = require('../lib/speaker-election.js');

const dir = path.join(__dirname, 'speaker-election');
const vtt = fs.readFileSync(path.join(dir, 'captions-2025-01-03.vtt'), 'utf8');
const roster = JSON.parse(fs.readFileSync(path.join(dir, 'roster-2025.json'), 'utf8')).roster;
const cues = SE.parseVtt(vtt);

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const votes = (b, key) => (b.candidates.find((c) => c.key === key) || { votes: 0 }).votes;

const ballots = SE.read(cues, roster);
const b = ballots[0];

ok('the fixture reads as one ballot, over, with the House as large as the roster', () => {
  assert.strictEqual(cues.length, 1046);
  assert.strictEqual(ballots.length, 1);
  assert(b.over);
  assert.strictEqual(b.expected, 434);
  assert.strictEqual(b.majority, 218);
});
ok('the candidates are the three who got votes, and not the chair\'s words', () => {
  const keys = b.candidates.map((c) => c.key);
  for (const k of ['JOHNSON', 'JEFFRIES', 'EMMER']) assert(keys.includes(k), k);
  for (const bad of ['THE', 'ORDER', 'HOUSE', 'CLERK', 'CHAIR', 'CLYDE', 'NORMAN']) assert(!keys.includes(bad), bad + ' is not a candidate');
  assert.deepStrictEqual(b.candidates.slice(0, 2).map((c) => c.key), ['JOHNSON', 'JEFFRIES']);
});
ok('the count is a floor: close to the roll, never over it', () => {
  // Johnson 218 and Jeffries 215 in the end; two Members who answered otherwise (Jordan, Donalds) changed to Johnson AFTER the roll, so Johnson is 216 here, and a few answers are lost to the garbled names
  assert(votes(b, 'JOHNSON') >= 205 && votes(b, 'JOHNSON') <= 218, 'Johnson ' + votes(b, 'JOHNSON'));
  assert(votes(b, 'JEFFRIES') >= 200 && votes(b, 'JEFFRIES') <= 215, 'Jeffries ' + votes(b, 'JEFFRIES'));
  assert.strictEqual(votes(b, 'EMMER'), 1);
  assert(b.heard >= 415 && b.heard <= 434, 'heard ' + b.heard);
});
ok('the vote changes after the roll are not counted again', () => {
  assert(votes(b, 'JORDAN') <= 1 && votes(b, 'DONALDS') <= 1);
  assert(b.heard <= b.expected);
});
ok('the tellers\' announcement: the total, each candidate\'s count, and who was elected', () => {
  const a = b.announced;
  assert.strictEqual(a.total, 434);
  assert.deepStrictEqual(a.candidates.map((c) => [c.name, c.votes]), [['MIKE JOHNSON', 218], ['HAKEEM JEFFRIES', 215], ['TOM EMMER', 1]]);
  assert.strictEqual(a.elected, 'MIKE JOHNSON');
  assert.strictEqual(a.candidates[0].state, 'LOUISIANA');
});
ok('the last Members heard are placed on a Member where the names allow it', () => {
  assert(b.recent.length > 0 && b.recent.length <= 8);
  assert(b.recent.some((r) => r.member && r.member.bioguideId));
});
ok('captions that are only the start of the roll: a ballot, not over, no tellers', () => {
  const early = SE.read(cues.slice(0, 400), roster)[0];
  assert(early && !early.over && !early.announced);
  assert(early.heard > 100 && early.heard < 434);
  assert(votes(early, 'JOHNSON') > 40);
});
ok('a second ballot starts when the first elected no one', () => {
  const first = cues.slice(29, 1038).map((c) => ({ ...c, text: c.text.replace(/DULY ELECTED/i, 'NOT ELECTED').replace(/HAVING/i, 'NOT HAVING') }));
  const two = SE.read([...cues.slice(0, 29), ...first, ...cues.slice(29)], roster);
  assert.strictEqual(two.length, 2, 'two ballots');
  assert.strictEqual(two[0].announced.elected, null);
  assert.strictEqual(two[1].announced.elected, 'MIKE JOHNSON');
  assert.strictEqual(two[1].n, 2);
});
ok('an election that elects someone is not followed by a second ballot, even if the roll is called again', () => {
  assert.strictEqual(SE.read([...cues, ...cues.slice(29, 60)], roster).length, 1);
});
ok('no roll in the captions: no ballot', () => assert.deepStrictEqual(SE.read(cues.slice(0, 20), roster), []));
ok('parseVtt keeps the file\'s order and joins a cue\'s lines', () => {
  const c = SE.parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nTHE ROLL NOW\nWILL BE CALLED.\n\n00:00:02.000 --> 00:00:04.000\nADAMS.\n');
  assert.deepStrictEqual(c.map((x) => x.text), ['THE ROLL NOW WILL BE CALLED.', 'ADAMS.']);
  assert.strictEqual(c[0].start, '00:00:01.000');
  assert.deepStrictEqual(SE.parseVtt(''), []);
});
ok('a candidate is told from the four Johnsons by the tellers\' state, or by being a leader, never guessed', () => {
  const half = cues.slice(0, 500);
  const noFirst = roster.map(({ first, ...m }) => m);   // a roster without first names, and no leaders: nothing to go on
  assert.strictEqual(SE.read(half, noFirst)[0].candidates.find((c) => c.key === 'JOHNSON').member, null, 'ambiguous and nothing to go on: no Member');
  assert.strictEqual(SE.read(half, roster)[0].candidates.find((c) => c.key === 'JOHNSON').member.bioguideId, 'J000299', 'the nominations said "THE HONORABLE MIKE ...": the one Johnson called Mike');
  assert.strictEqual(SE.read(half, noFirst, { leaders: ['J000299', 'J000294'] })[0].candidates.find((c) => c.key === 'JOHNSON').member.bioguideId, 'J000299', 'the one leader of the four');
  assert.strictEqual(SE.read(half, noFirst, { leaders: ['J000299', 'J000288'] })[0].candidates.find((c) => c.key === 'JOHNSON').member, null, 'two of them are leaders: still no guess');
  assert.strictEqual(votes(b, 'JOHNSON') > 0 && b.candidates.find((c) => c.key === 'JOHNSON').member.bioguideId, 'J000299', 'the tellers say Louisiana');
  assert.strictEqual(b.candidates.find((c) => c.key === 'JEFFRIES').member.bioguideId, 'J000294', 'a surname held by one Member needs nothing');
  assert.strictEqual(b.candidates.find((c) => c.key === 'EMMER').member.bioguideId, 'E000294');
});
ok('the Members shown as just read are never named twice: a stenographer\'s repeated call does not claim the next answer', () => {
  for (const upTo of [300, 450, 600, 800, 1000, cues.length]) {
    const recent = SE.read(cues.slice(0, upTo), roster)[0].recent;
    const ids = recent.filter((r) => r.member).map((r) => r.member.bioguideId);
    assert.strictEqual(new Set(ids).size, ids.length, `cue ${upTo}: ${ids.join(' ')}`);
  }
  // Goldman, then Gomez: the repeated GOLDMAN in the file must not hand Gomez's answer to Goldman
  const all = SE.read(cues, roster)[0];
  const seen = new Map();
  for (const r of all.recent) if (r.member) { assert(!seen.has(r.member.bioguideId), r.member.last + ' twice'); seen.set(r.member.bioguideId, r.candidate); }
});
console.log(`\n${n} passed`);
