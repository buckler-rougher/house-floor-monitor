// The airport panel says the FAA's delays in plain words ("15\u201329 min", "Miles-in-trail \u00b7 weather"): lib/airport-delays.js plainDelay and plainReason.
const assert = require('node:assert/strict');
require('../lib/airport-delays.js');
const { plainDelay, plainReason } = globalThis.AirportDelays;

assert.equal(plainDelay('15 minutes-29 minutes min'), '15\u201329 min');
assert.equal(plainDelay('1 hour and 1 minute-1 hour and 15 minutes min'), '1h 01m \u2013 1h 15m');
assert.equal(plainDelay('1 hour-2 hours min'), '1h \u2013 2h');
assert.equal(plainDelay('45 minutes-1 hour and 5 minutes min'), '45 min \u2013 1h 05m');
assert.equal(plainDelay('25 minutes'), '25 min');
assert.equal(plainDelay('2 hours and 3 minutes'), '2h 03m');
assert.equal(plainDelay('DELAYED'), 'DELAYED');                 // nothing to read: left as the FAA wrote it
assert.equal(plainDelay(''), '');

assert.equal(plainReason('TM Initiatives:MIT:WX'), 'Miles-in-trail \u00b7 weather');
assert.equal(plainReason('TM Initiatives:MIT:VOL'), 'Miles-in-trail \u00b7 volume');
assert.equal(plainReason('TM Initiatives:ZZZ'), 'Zzz');          // an unknown code is kept, lower-cased and capitalised
assert.equal(plainReason('airport volume'), 'airport volume');   // anything else is untouched
assert.equal(plainReason('runway construction'), 'runway construction');
console.log('airport plain words: all passed');
