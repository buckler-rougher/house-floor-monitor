// The FAA's airport delays, from the FAA's own public Airport Status Web Service (https://external-api.faa.gov/asws/api/airport/delays), written out in the shape the Airport Delays panel has always read
// (the XML nasstatus.faa.gov publishes: Ground_Stop_List, Ground_Delay_List, Arrival_Departure_Delay_List, Airport_Closure_List under Delay_type elements). nasstatus.faa.gov answers this site's
// Worker "403 Access Denied" (from 19 November 2026), so the Worker reads the official service instead and the panel needs no change.
//
//   FaaDelays.toXml(json, now)  ->  '<AIRPORT_STATUS_INFORMATION>...</AIRPORT_STATUS_INFORMATION>'
//
// What the delay LIST does not carry: whether an arrival/departure delay is for arrivals or departures, and its trend (the Worker adds both from each affected airport's own status, as `type` and `trend`),
// and the start of a closure; airspace flow programs the panel never used. Every field is optional here: a section the
// service leaves out is simply not written, and a quiet day (no delays at all) is a valid answer.
(function (root) {
  'use strict';
  const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tag = (name, value) => (value == null || value === '' ? '' : `<${name}>${esc(value)}</${name}>`);
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

  function toXml(json, now = Date.now()) {
    const j = json || {};
    const stops = list(j.GroundStops && j.GroundStops.groundStop);
    const delays = list(j.GroundDelays && j.GroundDelays.groundDelay);
    const moves = list(j.ArriveDepartDelays && j.ArriveDepartDelays.arriveDepart);
    const closures = list(j.Closures && j.Closures.closure);
    const out = ['<AIRPORT_STATUS_INFORMATION>', `<Update_Time>${esc(new Date(now).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1 $3 $2 $5 $4 GMT'))}</Update_Time>`];
    if (stops.length) out.push(`<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List>${stops.map((s) => `<Program>${tag('ARPT', s.airport)}${tag('Reason', s.reason)}${tag('End_Time', s.endTime)}</Program>`).join('')}</Ground_Stop_List></Delay_type>`);
    if (delays.length) out.push(`<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List>${delays.map((d) => `<Ground_Delay>${tag('ARPT', d.airport)}${tag('Reason', d.reason)}${tag('Avg', d.avgTime)}${tag('Max', d.maxTime)}</Ground_Delay>`).join('')}</Ground_Delay_List></Delay_type>`);
    if (moves.length) out.push(`<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List>${moves.map((m) => `<Delay>${tag('ARPT', m.airport)}${tag('Reason', m.reason)}<Arrival_Departure${m.type ? ` Type="${esc(m.type)}"` : ''}>${tag('Min', m.minTime)}${tag('Max', m.maxTime)}${tag('Trend', m.trend)}</Arrival_Departure></Delay>`).join('')}</Arrival_Departure_Delay_List></Delay_type>`);
    if (closures.length) out.push(`<Delay_type><Name>Airport Closures</Name><Airport_Closure_List>${closures.map((c) => `<Airport>${tag('ARPT', c.airport)}${tag('Reason', c.reason)}${tag('Start', c.start)}${tag('Reopen', c.reopen)}</Airport>`).join('')}</Airport_Closure_List></Delay_type>`);
    out.push('</AIRPORT_STATUS_INFORMATION>');
    return out.join('');
  }

  root.FaaDelays = { toXml };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FaaDelays;
})(typeof globalThis !== 'undefined' ? globalThis : this);
