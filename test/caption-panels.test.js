#!/usr/bin/env node
//
// lib/caption-panels.js over lines the House's captioner really wrote (the caption tracks of 15, 16, 8, 10 and 3 September 2026): who leads the pledge, who offers the prayer,
// who is appointed Speaker pro tempore, which phrases put a panel up, and which cues of a WebVTT file a quoted passage is in. No network.

const assert = require('node:assert');
const CP = require('../lib/caption-panels.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

// the real file's cues, 15 Sep 2026, around the pledge (the Chair's sentence runs across three of them)
const VTT = `WEBVTT

NOTE CAPTIONS TIME OFFSET: 00:06:31.284

02:00:58.608 --> 02:01:00.777
APPROVAL THEREOF. PURSUANT TO

02:01:00.777 --> 02:01:02.245
CLAUSE ONE OF RULE ONE, THE

02:01:02.245 --> 02:01:04.447
JOURNAL STANDS APPROVED. THE

02:01:04.447 --> 02:01:05.381
PLEDGE OF ALLEGIANCE WILL BE

02:01:05.381 --> 02:01:07.350
LED BY THE GENTLEMAN FROM SOUTH

02:01:07.350 --> 02:01:10.453
CAROLINA, MR. WILSON.

02:01:10.453 --> 02:01:11.320
UNIDENTIFIED SPEAKER: EVERYONE, INCLUDING

02:01:11.320 --> 02:01:12.622
THOSE IN THE GALLERY, PLEASE RISE.
`;

test('pledge: the gentleman from a state, Mr. or Ms. and the surname, as spoken (15 and 16 Sep)', () => {
  assert.deepStrictEqual(CP.pledgeLeader('THE JOURNAL STANDS APPROVED. THE PLEDGE OF ALLEGIANCE WILL BE LED BY THE GENTLEMAN FROM SOUTH CAROLINA, MR. WILSON. EVERYONE'), { state: 'SOUTH CAROLINA', honorific: 'MR', surname: 'WILSON' });
  assert.deepStrictEqual(CP.pledgeLeader('THE PLEDGE OF ALLEGIANCE WILL BE LED BY THE GENTLEMAN FROM MASSACHUSETTS, MR. NEAL. '), { state: 'MASSACHUSETTS', honorific: 'MR', surname: 'NEAL' });
  assert.deepStrictEqual(CP.pledgeLeader('THE PLEDGE OF ALLEGIANCE WILL BE LED BY THE GENTLEWOMAN FROM NEW YORK, MS. CLARKE. '), { state: 'NEW YORK', honorific: 'MS', surname: 'CLARKE' });
});
test('pledge: "the Chair will lead the House" (8 Sep) is the Chair, and a bare mention of the pledge is nobody', () => {
  assert.deepStrictEqual(CP.pledgeLeader('JOURNAL OF THE LAST DAYS PROCEEDING IS APPROVED. THE CHAIR WILL LEAD THE HOUSE IN THE PLEDGE OF ALLEGIANCE. I PLEDGE'), { chair: true });
  assert.strictEqual(CP.pledgeLeader('THE PLEDGE OF ALLEGIANCE IS A PART OF THE DAILY ORDER'), null);
  assert.strictEqual(CP.pledgeLeader(''), null);
});
test('prayer: a guest chaplain with or without the comma, the honorific form, and the House Chaplain by surname (16, 8, 10, 3 Sep)', () => {
  assert.deepStrictEqual(CP.prayerLeader('THE PRAYER WILL BE OFFERED BY GUEST CHAPLAIN, REVEREND JOHN KELLOGG. CHRIST CHURCH,'), { guest: true, name: 'REVEREND JOHN KELLOGG' });
  assert.deepStrictEqual(CP.prayerLeader('THE PRAYER WILL BE OFFERED BY GUEST CHAPLAIN CANTOR DOCTOR JOEL GLUCK, UNITED BROTHERS'), { guest: true, name: 'CANTOR DOCTOR JOEL GLUCK' });
  assert.deepStrictEqual(CP.prayerLeader('THE PRAYER WILL BE OFFERED BY CHAPLAIN KIBBEN.'), { guest: false, name: 'KIBBEN' });
  assert.deepStrictEqual(CP.prayerLeader('THE PRAYER WILL BE OFFERED BY CHAPLAIN GIBBONS.'), { guest: false, name: 'GIBBONS' });
  assert.strictEqual(CP.prayerLeader('THE GENTLEMAN WILL SUSPEND'), null);
});
test('speaker pro tempore: the name between "the Honorable" and "to act as Speaker pro tempore"', () => {
  assert.strictEqual(CP.speakerProTem('PURSUANT TO CLAUSE 8 OF RULE I, I HEREBY APPOINT THE HONORABLE MIKE FLOOD TO ACT AS SPEAKER PRO TEMPORE ON THIS DAY.'), 'MIKE FLOOD');
  assert.strictEqual(CP.speakerProTem('THE SPEAKER PRO TEMPORE RECOGNIZES'), null);
});
test('events: the phrases that put a panel up, and the ones that must not', () => {
  const hit = (key, text) => CP.EVENTS.find((e) => e.key === key).re.test(text);
  assert.ok(hit('prayer', 'THE PRAYER WILL BE OFFERED BY CHAPLAIN KIBBEN'));
  assert.ok(hit('pledge', 'THE PLEDGE OF ALLEGIANCE WILL BE LED BY'));
  assert.ok(hit('speaker', 'I HEREBY APPOINT THE HONORABLE'));
  assert.ok(hit('one-minute', 'THE CHAIR WILL ENTERTAIN UP TO FIFTEEN ONE-MINUTE SPEECHES'));
  assert.ok(!hit('prayer', 'MEMBERS ARE IN PRAYER FOR THE FAMILIES'), 'a word in debate is not the announcement');
});
test('cueBlock: the cues the words are in, with one either side, as the file has them', () => {
  const block = CP.cueBlock(VTT, 'THE JOURNAL STANDS APPROVED. THE PLEDGE OF ALLEGIANCE WILL BE LED BY THE GENTLEMAN FROM SOUTH CAROLINA, MR. WILSON.', 'PLEDGE OF ALLEGIANCE');
  assert.ok(block.startsWith('02:00:58.608 --> 02:01:00.777\nAPPROVAL THEREOF. PURSUANT TO'), 'the cue before');
  assert.ok(block.includes('02:01:02.245 --> 02:01:04.447\nJOURNAL STANDS APPROVED. THE'));
  assert.ok(block.includes('02:01:07.350 --> 02:01:10.453\nCAROLINA, MR. WILSON.'));
  assert.ok(block.endsWith('UNIDENTIFIED SPEAKER: EVERYONE, INCLUDING'), 'the cue after, its speaker label kept as the file has it');
});
test('cueBlock: falls back to the phrase, and says nothing when the words are not in the file', () => {
  assert.ok(CP.cueBlock(VTT, 'WORDS THE FILE DOES NOT HAVE, PLEDGE OF ALLEGIANCE WILL BE', 'PLEDGE OF ALLEGIANCE WILL BE').includes('02:01:04.447'));
  assert.strictEqual(CP.cueBlock(VTT, 'NOTHING LIKE THIS', 'NOR THIS'), null);
  assert.strictEqual(CP.cueBlock('', 'X', 'Y'), null);
});

console.log(`caption-panels: ${n} passed`);
