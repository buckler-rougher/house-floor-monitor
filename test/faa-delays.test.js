#!/usr/bin/env node
//
// lib/faa-delays.js: the FAA's official airport delay list (a real answer of 20 November 2026, test/faa/asws-delays-2026-11-20.json) written in the shape the Airport Delays panel reads. No network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const FaaDelays = require('../lib/faa-delays.js');
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'faa', 'asws-delays-2026-11-20.json'), 'utf8'));
const NOW = Date.UTC(2026, 10, 20, 16, 38, 23);
const xml = FaaDelays.toXml(real, NOW);
const all = (re) => [...xml.matchAll(re)].map((m) => m[1]);

test('the root and the update time are the FAA feed\'s own (the panel and the upstream check look for them)', () => {
  assert(xml.startsWith('<AIRPORT_STATUS_INFORMATION>') && xml.endsWith('</AIRPORT_STATUS_INFORMATION>'));
  assert.strictEqual(all(/<Update_Time>(.*?)<\/Update_Time>/g)[0], 'Fri Nov 20 16:38:23 2026 GMT');
});

test('every airport in the FAA\'s list is in the output, under the section the panel reads it from', () => {
  const sec = (name) => (xml.match(new RegExp(`<Name>${name}</Name>(.*?)</Delay_type>`)) || [])[1] || '';
  const arpts = (s) => [...s.matchAll(/<ARPT>(.*?)<\/ARPT>/g)].map((m) => m[1]);
  assert.deepStrictEqual(arpts(sec('Ground Stop Programs')), real.GroundStops.groundStop.map((x) => x.airport));
  assert.deepStrictEqual(arpts(sec('Ground Delay Programs')), real.GroundDelays.groundDelay.map((x) => x.airport));
  assert.deepStrictEqual(arpts(sec('General Arrival/Departure Delay Info')), real.ArriveDepartDelays.arriveDepart.map((x) => x.airport));
  assert.deepStrictEqual(arpts(sec('Airport Closures')), real.Closures.closure.map((x) => x.airport));
});

test('the details the panel shows come through: stop end time, average delay, min and max, a closure\'s reopening', () => {
  assert(/<Program><ARPT>TEB<\/ARPT><Reason>airport volume<\/Reason><End_Time>12:30 pm EST<\/End_Time><\/Program>/.test(xml));
  assert(/<Ground_Delay><ARPT>SAN<\/ARPT><Reason>airport volume<\/Reason><Avg>25 minutes<\/Avg>/.test(xml));
  assert(/<Delay><ARPT>TPA<\/ARPT><Reason>WX:Thunderstorms<\/Reason><Arrival_Departure><Min>1 hour and 1 minute<\/Min><Max>1 hour and 15 minutes<\/Max><\/Arrival_Departure><\/Delay>/.test(xml));
  assert(/<Airport><ARPT>SNA<\/ARPT><Reason>[^<]*CLSD DLY[^<]*<\/Reason><Reopen>Nov 21 at 14:15 UTC\.<\/Reopen><\/Airport>/.test(xml));
});

test('a quiet day is a valid answer: no delays at all, and sections the service leaves out, give a well-formed empty feed', () => {
  for (const j of [{}, null, { status: { code: 200, count: 0 } }, { GroundStops: { groundStop: [], count: 0 } }]) {
    const q = FaaDelays.toXml(j, NOW);
    assert(q.startsWith('<AIRPORT_STATUS_INFORMATION>') && q.endsWith('</AIRPORT_STATUS_INFORMATION>') && !/<Delay_type>/.test(q), q);
  }
});

test('text is escaped (a closure reason is a NOTAM with ampersands and brackets in it) and a single object is read as a one-item list', () => {
  const q = FaaDelays.toXml({ Closures: { closure: { airport: 'XYZ', reason: 'RWY 1 & 2 <CLSD>', reopen: 'Nov 21' } } }, NOW);
  assert(q.includes('<Reason>RWY 1 &amp; 2 &lt;CLSD&gt;</Reason>') && q.includes('<ARPT>XYZ</ARPT>'), q);
});

console.log(`\n${n} passed`);
