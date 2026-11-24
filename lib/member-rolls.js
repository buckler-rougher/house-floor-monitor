// One roll call file from the Clerk (evs/<year>/rollNNN.xml), reduced to who voted how, for the Members window's live additions (/api/member-rolls).
//
//   MemberRolls.parse(xml) -> {
//     congress, y, n, d (YYYY-MM-DD), l (the bill, as the Clerk writes it), q (the question), t (its description), r (the result), ye, na (Yeas and Nays),
//     u: 1 when this is a party-unity roll (a majority of Democrats against a majority of Republicans, counting Yea and Nay only), else 0,
//     yea, nay, present, nv (Not Voting), other: arrays of Member ids (bioguide) by how they voted ("other" is a name, as in a Speaker election),
//     brk: the ids of Democrats and Republicans who voted against their own party's majority on a unity roll,
//     members: { id: [party, state, name] }   everyone the file lists
//   } | null (not a roll call file: the Clerk answers a missing roll with a 200 and an "Error sanitizing file" stub)
//
// The rules are the ones dev/build-member-stats.mjs uses for the snapshot, so a roll added here counts exactly as it would there (test/member-stats-core.test.js reads both and compares).
(function (root) {
  'use strict';
  const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const tag = (s, t) => { const m = s.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`)); return m ? m[1].trim() : ''; };
  const decode = (t) => String(t).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
  function isoDate(d) { const m = String(d).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/); return m && MONTHS[m[2]] ? `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; }

  function parse(xml) {
    const text = String(xml || '');
    const at = text.indexOf('<vote-data>');
    if (!/<rollcall-vote/.test(text) || at < 0) return null;
    const meta = text.slice(0, at);
    const congress = Number(tag(meta, 'congress'));
    const d = isoDate(tag(meta, 'action-date'));
    const n = Number(tag(meta, 'rollcall-num'));
    if (!congress || !d || !n) return null;
    const tot = meta.match(/<totals-by-vote>[\s\S]*?<yea-total>(\d+)<\/yea-total>\s*<nay-total>(\d+)<\/nay-total>/);
    const votes = [];
    const re = /<recorded-vote>\s*<legislator name-id="([^"]+)"[^>]*? party="([^"]*)" state="([^"]*)"[^>]*>([^<]*)<\/legislator>\s*<vote>([^<]*)<\/vote>/g;
    for (const m of text.slice(at).matchAll(re)) votes.push({ id: m[1], party: m[2], state: m[3], name: decode(m[4]).trim(), v: decode(m[5]).trim() });
    if (!votes.length) return null;

    const tally = { D: { y: 0, n: 0 }, R: { y: 0, n: 0 } };
    for (const v of votes) { const t = tally[v.party]; if (!t) continue; if (/^(yea|aye)$/i.test(v.v)) t.y++; else if (/^(nay|no)$/i.test(v.v)) t.n++; }
    const maj = (t) => (t.y > t.n ? 'Y' : t.n > t.y ? 'N' : '');
    const md = maj(tally.D), mr = maj(tally.R);
    const unity = !!(md && mr && md !== mr);

    const out = { congress, y: Number(d.slice(0, 4)), n, d, l: decode(tag(meta, 'legis-num')), q: decode(tag(meta, 'vote-question')), t: decode(tag(meta, 'vote-desc')), r: decode(tag(meta, 'vote-result')),
      ye: tot ? Number(tot[1]) : null, na: tot ? Number(tot[2]) : null, u: unity ? 1 : 0, yea: [], nay: [], present: [], nv: [], other: [], brk: [], members: {} };
    for (const v of votes) {
      out.members[v.id] = [v.party, v.state, v.name];
      const yea = /^(yea|aye)$/i.test(v.v), nay = /^(nay|no)$/i.test(v.v);
      if (yea) out.yea.push(v.id); else if (nay) out.nay.push(v.id);
      else if (/^not voting$/i.test(v.v)) out.nv.push(v.id);
      else if (/^present$/i.test(v.v)) out.present.push(v.id);
      else out.other.push(v.id);
      if (unity && (v.party === 'D' || v.party === 'R') && (yea || nay)) { const own = v.party === 'D' ? md : mr; if ((yea ? 'Y' : 'N') !== own) out.brk.push(v.id); }
    }
    return out;
  }

  root.MemberRolls = { parse, isoDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MemberRolls;
})(typeof globalThis !== 'undefined' ? globalThis : this);
