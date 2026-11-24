// The Members window's counting, for roll calls that arrive after the snapshot was built (dev/build-member-stats.mjs).
//
//   MemberStats.empty(congress)                       a Congress with no roll calls yet
//   MemberStats.apply(data, rolls)                    add roll calls (MemberRolls.parse results, oldest first) to a snapshot, in place; returns how many were new
//   MemberStats.derive(data)                          recompute every Member's totals from what the record holds (apply does this)
//   MemberStats.lastRoll(data)                        { y, n } of the newest roll call, or null: where to ask the server to continue from
//
// A Member's record holds: first and last (the dates of the first and last roll call they were listed on), missedAt (the indices into data.rollList of the roll calls they did not vote on), breakAt (the
// ones where they voted against their party), cast (their last 40 votes cast, [index, Y|N|P|O]), and the running counts rolls, missed, unityScored, breaks. Days and weeks are not stored: they are worked
// out from missedAt and the roll list (derive), the same way for a snapshot and for what is added to it. A Member is listed on every roll call from their first to their last (the Clerk lists a
// Member only while they serve), so `rolls` counts that stretch. "Votes like theirs" (`like`) needs every pair of Members and is left as the snapshot had it.
(function (root) {
  'use strict';
  const monday = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

  function empty(congress) {
    return { congress, rollList: [], rolls: 0, days: 0, weeks: 0, unityRolls: 0, through: null, members: [] };
  }

  const lastRoll = (data) => { const r = data.rollList[data.rollList.length - 1]; return r ? { y: r.y, n: r.n } : null; };

  function apply(data, rolls) {
    const byId = new Map(data.members.map((m) => [m.id, m]));
    let added = 0;
    for (const r of rolls) {
      const last = lastRoll(data);
      if (last && (r.y < last.y || (r.y === last.y && r.n <= last.n))) continue;   // already in
      const idx = data.rollList.length;
      data.rollList.push({ y: r.y, n: r.n, d: r.d, l: r.l, q: r.q, t: r.t, u: r.u, ye: r.ye, na: r.na, r: r.r });
      const how = new Map();
      r.yea.forEach((id) => how.set(id, 'Y')); r.nay.forEach((id) => how.set(id, 'N')); r.present.forEach((id) => how.set(id, 'P'));
      r.other.forEach((id) => how.set(id, 'O')); r.nv.forEach((id) => how.set(id, 'X'));
      for (const [id, c] of how) {
        let m = byId.get(id);
        if (!m) {   // a Member the snapshot did not have (sworn in since)
          const [party, state, name] = r.members[id] || ['', '', id];
          m = { id, name, party, state, rolls: 0, missed: 0, unityScored: 0, breaks: 0, first: r.d, last: r.d, fi: idx, li: idx, gaps: [], active: true, missedAt: [], breakAt: [], cast: [], like: [] };
          data.members.push(m); byId.set(id, m);
        }
        for (let g = m.li + 1; g < idx; g++) m.gaps.push(g);   // the roll calls between their last listing and this one did not list them
        m.rolls++; m.last = r.d; m.li = idx;
        if (c === 'X') { m.missed++; m.missedAt.push(idx); } else {
          m.cast.push([idx, c === 'Y' || c === 'N' || c === 'P' ? c : 'O']);
          if (m.cast.length > 40) m.cast.shift();
          if (r.u && (c === 'Y' || c === 'N') && (m.party === 'D' || m.party === 'R')) m.unityScored++;
        }
      }
      for (const id of r.brk) { const m = byId.get(id); if (m) { m.breaks++; m.breakAt.push(idx); } }
      data.unityRolls += r.u ? 1 : 0;
      data.through = r.d;
      added++;
    }
    if (added) derive(data);
    return added;
  }

  function derive(data) {
    const R = data.rollList;
    data.rolls = R.length;
    data.days = new Set(R.map((r) => r.d)).size;
    data.weeks = new Set(R.map((r) => monday(r.d))).size;
    for (const m of data.members) {
      const lo = m.fi, hi = m.li;
      m.active = m.last === data.through;
      if (lo == null || hi == null || lo < 0) continue;
      const gone = new Set(m.gaps || []);
      const missed = new Set(m.missedAt);
      const dayN = new Map(), dayX = new Map(), wkN = new Map(), wkX = new Map();
      for (let i = lo; i <= hi; i++) {
        if (gone.has(i)) continue;
        const d = R[i].d, w = monday(d), x = missed.has(i) ? 1 : 0;
        dayN.set(d, (dayN.get(d) || 0) + 1); dayX.set(d, (dayX.get(d) || 0) + x);
        wkN.set(w, (wkN.get(w) || 0) + 1); wkX.set(w, (wkX.get(w) || 0) + x);
      }
      m.days = dayN.size; m.weeks = wkN.size;
      m.daysMissed = [...dayN].filter(([d, n]) => dayX.get(d) === n).length;
      m.weeksMissed = [...wkN].filter(([w, n]) => wkX.get(w) === n).length;
      m.missedPct = +(100 * m.missed / m.rolls).toFixed(1);
      m.breakPct = m.unityScored ? +(100 * m.breaks / m.unityScored).toFixed(1) : null;
    }
  }

  root.MemberStats = { empty, apply, derive, lastRoll };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MemberStats;
})(typeof globalThis !== 'undefined' ? globalThis : this);
