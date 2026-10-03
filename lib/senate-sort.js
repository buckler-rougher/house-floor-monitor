// How the Senate board can be ordered. Pure, so it can be tested without a page.
//
//   alpha      A to Z by surname, which is the order the clerk reads and the default
//   state      grouped by state, states A to Z by NAME (not postal code: AK, AL, AR,
//              AZ is not Alabama, Alaska, Arizona, Arkansas)
//   admission  grouped by state, in the order the states joined the Union
//   recent     whoever was heard last first; members not yet heard follow, A to Z
//   seniority  by rank, 1 first (members carry `rank`; see lib/senate-seniority.js for
//              where it comes from). A member with no rank follows, A to Z, and is
//              never guessed into the order.
//
// Two senators of one state are ordered by surname within it.

(function (root) {
  'use strict';

  // postal code -> [name, order admitted]. The first thirteen are the ratification
  // order of the original states; the rest, the order of admission.
  const STATES = {
    DE: ['Delaware', 1], PA: ['Pennsylvania', 2], NJ: ['New Jersey', 3], GA: ['Georgia', 4],
    CT: ['Connecticut', 5], MA: ['Massachusetts', 6], MD: ['Maryland', 7], SC: ['South Carolina', 8],
    NH: ['New Hampshire', 9], VA: ['Virginia', 10], NY: ['New York', 11], NC: ['North Carolina', 12],
    RI: ['Rhode Island', 13], VT: ['Vermont', 14], KY: ['Kentucky', 15], TN: ['Tennessee', 16],
    OH: ['Ohio', 17], LA: ['Louisiana', 18], IN: ['Indiana', 19], MS: ['Mississippi', 20],
    IL: ['Illinois', 21], AL: ['Alabama', 22], ME: ['Maine', 23], MO: ['Missouri', 24],
    AR: ['Arkansas', 25], MI: ['Michigan', 26], FL: ['Florida', 27], TX: ['Texas', 28],
    IA: ['Iowa', 29], WI: ['Wisconsin', 30], CA: ['California', 31], MN: ['Minnesota', 32],
    OR: ['Oregon', 33], KS: ['Kansas', 34], WV: ['West Virginia', 35], NV: ['Nevada', 36],
    NE: ['Nebraska', 37], CO: ['Colorado', 38], ND: ['North Dakota', 39], SD: ['South Dakota', 40],
    MT: ['Montana', 41], WA: ['Washington', 42], ID: ['Idaho', 43], WY: ['Wyoming', 44],
    UT: ['Utah', 45], OK: ['Oklahoma', 46], NM: ['New Mexico', 47], AZ: ['Arizona', 48],
    AK: ['Alaska', 49], HI: ['Hawaii', 50],
  };

  const MODES = ['alpha', 'state', 'admission', 'recent', 'seniority'];

  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const name = (m) => `${String(m.last || '').toUpperCase()} ${String(m.first || '').toUpperCase()}`;
  const stateName = (m) => (STATES[m.state] ? STATES[m.state][0] : String(m.state || '~')).toUpperCase();
  const admitted = (m) => (STATES[m.state] ? STATES[m.state][1] : 99);

  /**
   * `members`  [{ last, first, state, party, key }]
   * `heard`    for 'recent': an array of keys in the order they were heard, oldest first
   * Returns a new array; the input is not touched.
   */
  function sortMembers(members, mode, heard) {
    const out = [...members];
    if (mode === 'state') {
      return out.sort((a, b) => cmp(stateName(a), stateName(b)) || cmp(name(a), name(b)));
    }
    if (mode === 'admission') {
      return out.sort((a, b) => (admitted(a) - admitted(b)) || cmp(name(a), name(b)));
    }
    if (mode === 'seniority') {
      const rank = (m) => (Number.isFinite(m.rank) ? m.rank : Infinity);
      return out.sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        if (ra !== rb) return ra < rb ? -1 : 1;
        return cmp(name(a), name(b));
      });
    }
    if (mode === 'recent') {
      // Position of each key in the order heard; a later position is more recent.
      const at = new Map();
      (heard || []).forEach((k, i) => at.set(k, i));
      return out.sort((a, b) => {
        const ia = at.has(a.key) ? at.get(a.key) : -1;
        const ib = at.has(b.key) ? at.get(b.key) : -1;
        if (ia !== ib) return ib - ia;            // most recent first, unheard last
        return cmp(name(a), name(b));
      });
    }
    return out.sort((a, b) => cmp(name(a), name(b)));
  }

  root.SenateSort = { sortMembers, MODES, STATES };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateSort;
})(typeof globalThis !== 'undefined' ? globalThis : this);
