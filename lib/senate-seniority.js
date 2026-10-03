/**
 * Senate seniority, from Wikipedia's "Seniority in the United States Senate", shared
 * by worker.js and testable on its own.
 *
 * WHY WIKIPEDIA
 * The Senate publishes no seniority list in any form this board can read. The roster
 * file carries class, party, state and Bioguide ID but no dates of service;
 * Bioguide refuses automated requests; Congress.gov gives only the YEAR someone
 * first served, which cannot order the many senators sworn in on the same day.
 * Seniority is not just a date: ties are broken by prior Senate service, then
 * Vice President, House service, governor, and finally state population, and
 * Wikipedia's table applies those and shows the rank (1 to 100).
 *
 * It is community-edited, so it is read defensively: a page whose table does not
 * parse to a clean, contiguous ranking is REJECTED outright rather than half-used,
 * and the board then simply has no seniority order, as before.
 *
 * Each row of the table has its rank in the first cell, the senator as
 * data-sort-value="Last, First", and a link titled "List of United States senators
 * from <State>". Party, state and date cells are merged across rows (rowspan) where
 * they repeat, which is why none of those is read by position.
 */
(function (root) {
  'use strict';

  const decode = (s) => String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

  // Diacritics folded: the roster says Luján, and so can the article; do not depend on it.
  const fold = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z]/g, '');

  /** The table's rows as { rank, last, first, state } where state is the full name. */
  function parse(html) {
    const rows = [];
    // A state cell is merged down over a tied pair of senators from one state (the
    // two Georgians ranked 77 and 78 share one), so the second row has no state
    // cell at all. The table says so itself with rowspan, and that is what is
    // followed: the state carries into exactly the rows it claims to span, no more.
    let carry = null;   // { state, left }
    for (const tr of String(html || '').match(/<tr[\s\S]*?<\/tr>/g) || []) {
      const rank = (tr.match(/^<tr[^>]*>\s*<th[^>]*>\s*(\d{1,3})\s*<\/th>/) || [])[1];
      if (!rank) continue;
      const sort = (tr.match(/data-sort-value="([^"]+)"/) || [])[1];
      const cell = tr.match(/<td([^>]*)>\s*<a[^>]*title="List of United States senators from ([^"]+)"/);
      let state;
      if (cell) {
        state = decode(cell[2]).trim();
        const span = Number((cell[1].match(/rowspan="(\d+)"/) || [])[1] || 1);
        carry = span > 1 ? { state, left: span - 1 } : null;
      } else if (carry && carry.left > 0) {
        state = carry.state;
        carry.left -= 1;
      }
      if (!sort || !state) continue;
      const [last, ...first] = decode(sort).split(',');
      rows.push({ rank: Number(rank), last: last.trim(), first: first.join(',').trim(), state });
    }
    return rows;
  }

  /** True when the rows look like a whole, clean ranking. */
  function valid(rows) {
    if (!Array.isArray(rows) || rows.length < 90 || rows.length > 100) return false;
    for (let i = 0; i < rows.length; i++) if (rows[i].rank !== i + 1) return false;
    return true;
  }

  /**
   * Give each roster member a rank. `roster` is [{ last, state }] with the state as a
   * postal code; `nameToPostal` maps full state names to postal codes.
   * Returns a Map keyed `<SURNAME FOLDED>|<POSTAL>` -> rank. A member the table does
   * not name is simply absent (and sorts last), never guessed.
   */
  function rankMap(rows, roster, nameToPostal) {
    const byState = new Map();
    for (const r of rows) {
      const postal = nameToPostal[r.state];
      if (!postal) continue;
      if (!byState.has(postal)) byState.set(postal, []);
      byState.get(postal).push(r);
    }
    const out = new Map();
    const members = new Map();
    for (const m of roster) {
      if (!members.has(m.state)) members.set(m.state, []);
      members.get(m.state).push(m);
    }
    for (const [state, ms] of members) {
      const rs = (byState.get(state) || []).slice();
      const left = [];
      for (const m of ms) {
        const i = rs.findIndex((r) => fold(r.last) === fold(m.last));
        if (i >= 0) { out.set(`${fold(m.last)}|${state}`, rs[i].rank); rs.splice(i, 1); }
        else left.push(m);
      }
      // One of a state's two senators spelled differently on both sides, and one row
      // left over: that row is theirs. Two unmatched of each is not resolved.
      if (left.length === 1 && rs.length === 1) out.set(`${fold(left[0].last)}|${state}`, rs[0].rank);
    }
    return out;
  }

  root.SenateSeniority = { parse, valid, rankMap, fold };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateSeniority;
})(typeof globalThis !== 'undefined' ? globalThis : this);
