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
ok('a call that matches no Member in the roster is written as the captions have it, never as the chair\'s words', () => {
  // the roster of a later day lacks a Member who was there on 3 January (a former Member): Waltz
  const later = roster.filter((m) => m.bioguideId !== 'W000823');
  const heard = new Set();
  for (let u = 60; u <= cues.length; u += 3) for (const r of (SE.read(cues.slice(0, u), later)[0] || { recent: [] }).recent) if (!r.member) heard.add(r.heard);
  assert(heard.has('WALTZ'), 'WALTZ as heard: ' + [...heard].slice(0, 12).join(' | '));
  for (const h of heard) if (h) assert(!/\b(THE|ORDER|SURNAME|CHAIR|CLERK|GENTLEMAN)\b/.test(h) && !/^OF /.test(h), `not a name: ${h}`);
  // and one that is placed carries no heard text
  assert(SE.read(cues, roster)[0].recent.every((r) => !r.member || r.heard == null));
});
ok('the state in a call picks the Member: Turner of Ohio and Turner of Texas, split across cues, are told apart', () => {
  // the captions read "TURNER. / OF OHIO. / JOHNSON." then "TURNER OF TEXAS. / JEFFRIES."
  const last = (r) => r.recent.filter((x) => x.member && x.member.last === 'Turner' || /TURNER/.test(x.heard || '')).map((x) => [x.member ? x.member.bioguideId : x.heard, x.candidate]);
  const full = SE.read(cues.slice(0, 866), roster)[0];
  assert.deepStrictEqual(last(full), [['T000463', 'JOHNSON'], ['T000489', 'JEFFRIES']], 'Ohio for Johnson, Texas for Jeffries');
  // today\'s roster has no Turner of Texas: the call is kept as heard, and Turner of Ohio is not blamed for it
  const later = SE.read(cues.slice(0, 866), roster.filter((m) => m.bioguideId !== 'T000489'))[0];
  assert.deepStrictEqual(last(later), [['T000463', 'JOHNSON'], ['TURNER OF TEXAS', 'JEFFRIES']]);
  // a state token that arrives on its own joins the name before it
  assert.deepStrictEqual(SE.tokensOf([{ text: 'TURNER.' }, { text: 'OF OHIO.' }, { text: 'JOHNSON.' }]), ['TURNER OF OHIO', 'JOHNSON']);
});
ok('the Members named as just read match the Clerk\'s roll, at every moment of the roll but the changed votes', () => {
  const seen = new Map();
  for (let u = 60; u <= cues.length; u += 4) for (const r of (SE.read(cues.slice(0, u), roster)[0] || { recent: [] }).recent) if (r.member) seen.set(r.member.bioguideId, r.candidate);
  const truth = JSON.parse(fs.readFileSync(path.join(dir, 'roster-2025.json'), 'utf8')).truth;
  let wrong = 0;
  for (const [id, c] of seen) if ((truth[id] || '').split(' (')[0].toUpperCase() !== c) wrong++;
  assert(seen.size >= 380, 'named ' + seen.size);
  assert(wrong <= 4, wrong + ' wrong of ' + seen.size);   // two are Members who answered Jordan and Donalds, then changed to Johnson after the roll
});
ok('a changed vote moves the count: Norman (Jordan to Johnson) and Self (Donalds to Johnson), read after the roll', () => {
  const at = (u) => Object.fromEntries(SE.read(cues.slice(0, u), roster)[0].candidates.map((c) => [c.key, c.votes]));
  const before = at(1006);   // the roll and its second call are read; the clerk has not yet read back a vote
  assert.strictEqual(before.JORDAN, 1);
  assert.strictEqual(before.DONALDS, 1);
  assert.strictEqual(before.JOHNSON, 216);
  const mid = at(1013);      // "MR. NORMAN IS RECORDED AS JORDAN ... MR. NORMAN. JOHNSON." has been read; Self has not
  assert.strictEqual(mid.JOHNSON, 217);
  assert.strictEqual(mid.JORDAN, undefined, 'Jordan loses the vote Norman moved');
  assert.strictEqual(mid.DONALDS, 1);
  const after = at(1020);    // "MR. SELF IS RECORDED AS DONALDS ... MR. SELF. JOHNSON."
  assert.strictEqual(after.JOHNSON, 218, 'the tellers say 218');
  assert.strictEqual(after.DONALDS, undefined);
  const last = SE.read(cues, roster)[0];
  assert.deepStrictEqual(last.recent.filter((r) => r.changed).map((r) => [r.member && r.member.last, r.candidate]), [['Norman', 'JOHNSON'], ['Self', 'JOHNSON']]);
  assert.strictEqual(last.candidates.find((c) => c.key === 'JOHNSON').votes, 218);
});
ok('the count with the tellers\' names read is the count without them: announced candidates do not change how the roll is read', () => {
  const key = (u) => SE.read(cues.slice(0, u), roster)[0].candidates.map((c) => c.key + c.votes).join(' ');
  assert.strictEqual(key(1019), key(cues.length));
});
ok('the tellers\' announcement is read as it arrives: the total, then each count, complete only when the winner is declared', () => {
  const step = (u) => SE.read(cues.slice(0, u), roster)[0].announced;
  assert.strictEqual(step(1016), null, 'before the tellers speak');
  const total = step(1022);
  assert.strictEqual(total.total, 434); assert.deepStrictEqual(total.candidates, []); assert.strictEqual(total.complete, false);
  assert.deepStrictEqual(step(1026).candidates.map((c) => c.votes), [218]);
  assert.deepStrictEqual(step(1029).candidates.map((c) => c.votes), [218, 215]);
  const all3 = step(1034);   // the counts add up to 434, but a candidate has a majority: the winner is still to be declared, so it is not complete
  assert.deepStrictEqual(all3.candidates.map((c) => c.votes), [218, 215, 1]);
  assert.strictEqual(all3.complete, false);
  assert.strictEqual(step(1036).complete, true);
  assert.strictEqual(step(1036).elected, 'MIKE JOHNSON');
});
ok('counts that add up to the total with nobody over half is complete at once: no majority, another ballot', () => {
  const none = SE.announcement([{ text: 'THE TOTAL NUMBER OF VOTES CAST IS 430 WHICH THE HONORABLE ADA ONE OF OHIO HAS RECEIVED 200. THE HONORABLE BEN TWO OF TEXAS HAS RECEIVED 200. THE HONORABLE CY THREE OF IOWA HAS RECEIVED 30.' }]);
  assert.strictEqual(none.total, 430); assert.strictEqual(none.candidates.length, 3); assert.strictEqual(none.elected, null);
  assert.strictEqual(none.complete, true);
});
console.log(`\n${n} passed`);
