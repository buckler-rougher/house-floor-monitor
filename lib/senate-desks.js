/**
 * The Senate's desk assignments, from the Curator's chamber map, shared by worker.js
 * and testable on its own.
 *
 * The Senate publishes who sits at which desk (a desk is a member, unlike the House,
 * where nobody has an assigned seat):
 *
 *   xml/classes.xml                -> a dated list of floorplans, one per reshuffle
 *     <class dateRange="2026, Jul 14–present"><dataRef>floorplans/119_2c_red.xml</dataRef>
 *   xml/floorplans/<that file>     -> sides > sections > rows > seats
 *
 * Each seat carries a desk id, party, name, state and a Bioguide link, which joins
 * straight to the roster. What it does NOT carry is coordinates: the Senate's own
 * renderer was a Flash floorplan that no longer exists, so a desk has only its place
 * (side, section, row, order) and the arc is computed on the page.
 */
(function (root) {
  'use strict';

  /**
   * The live plan: the class whose dateRange ends in "present", not simply the first.
   * There were three for one session and they are dated, so hardcoding one would go
   * stale at the next reshuffle. `<class\s`, not `<class`: the file opens with a
   * <classes> wrapper, which the looser pattern matches as its own first block, with
   * no dateRange and the first real class's dataRef inside it. That picked the right
   * plan by accident and would have picked the wrong one the moment the order changed.
   */
  function pickPlan(classesXml) {
    let ref = null, range = null;
    for (const m of String(classesXml || '').matchAll(/<class\s([^>]*)>([\s\S]*?)<\/class>/g)) {
      const dr = (m[1].match(/dateRange="([^"]*)"/) || [])[1] || '';
      const dataRef = (m[2].match(/<dataRef>([^<]+)<\/dataRef>/) || [])[1];
      if (dataRef && /present/i.test(dr)) return { ref: dataRef, range: dr };
      if (dataRef && !ref) { ref = dataRef; range = dr; }   // fallback: newest listed
    }
    return ref ? { ref, range } : null;
  }

  /**
   * Every occupied desk as { desk, side, section, row, order, party, name, last, state,
   * bioguide }. An empty desk (no name) is a vacancy, not a member. A row with no
   * rownum is numbered by its position.
   */
  function parseSeats(planXml) {
    const seats = [];
    for (const sideM of String(planXml || '').matchAll(/<side name="([^"]+)">([\s\S]*?)<\/side>/g)) {
      const side = sideM[1];
      let sectionIdx = 0;
      for (const secM of sideM[2].matchAll(/<section>([\s\S]*?)<\/section>/g)) {
        let rowIdx = 0;
        for (const rowM of secM[1].matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)) {
          rowIdx += 1;
          const row = Number((rowM[1].match(/rownum="(\d+)"/) || [])[1] || rowIdx);
          let order = 0;
          for (const seatM of rowM[2].matchAll(/<seat id="(\d+)"[^>]*>([\s\S]*?)<\/seat>/g)) {
            const b = seatM[2];
            const tag = (t) => (b.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1] || '';
            const name = tag('sName');
            if (!name) continue;
            seats.push({
              desk: Number(seatM[1]), side, section: sectionIdx, row, order: order++,
              party: tag('politics') || null,
              name,
              // "Schumer, Charles E." -> the surname the captions use.
              last: name.split(',')[0].trim(),
              state: tag('sState') || null,
              bioguide: (b.match(/index=([A-Z]\d{6})/) || [])[1] || null,
            });
          }
        }
        sectionIdx += 1;
      }
    }
    return seats;
  }

  /** Whole enough to use: near 100, each desk once. */
  function valid(seats) {
    if (!Array.isArray(seats) || seats.length < 90 || seats.length > 102) return false;
    return new Set(seats.map((s) => s.desk)).size === seats.length;
  }

  root.SenateDesks = { pickPlan, parseSeats, valid };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateDesks;
})(typeof globalThis !== 'undefined' ? globalThis : this);
