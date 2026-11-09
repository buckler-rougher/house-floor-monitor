// Privileged resolutions a Member has given notice of, read off the House Clerk's floor record (clerk.house.gov/FloorSummary/ViewFloorActions).
//
//   PrivilegedNotices.build(days) -> [{ kind, bill, member, noticeDate, noticeAt, text, id, title, consideredAt, outcome, days, state }]   newest notice first
//     days: [{ date: 'YYYY-MM-DD', items: [{ description, pubDate }] }], any order; a date with no items is a day the House did not meet
//
// The Clerk records the notice as "NOTIFICATION OF INTENT TO OFFER RESOLUTION - Mr. Massie notified the House of his intent to offer a resolution ...". A resolution
// raising a question of the privileges of the House that a Member other than a leader offers this way must be taken up at a time the Speaker sets within two
// legislative days of the notice (Rule IX clause 2). The same heading announces a discharge motion (kind 'discharge', `bill` the measure the petition is for); the
// Chair says it will be entertained within two legislative days, the same clock, and it belongs to the petition, not to this list. The House does not post a list of these. What is in the record is the notice and, if it happens, a later
// row "Considered as privileged matter. H. Res. N" followed by a motion to table or refer, or a vote on agreeing to it.
//
// A legislative day is a day the House met, pro forma days included, so `days` is how many dates after the notice's own date have rows in the record. That is the
// number of legislative days that have passed, as far as the record can say: the Clerk's page for a day has rows only if the House met that day.
//
//   state: 'resolved'   there is an outcome (tabled, referred, agreed to, rejected)
//          'considered' it was called up and nothing has decided it yet
//          'lapsed'     more than two legislative days have passed with no row calling it up
//          'due'        this is the second legislative day after the notice
//          'noticed'    fewer than two legislative days have passed

(function (root) {
  const DUE_DAYS = 2;
  // the Clerk's rows arrive with their links entity-encoded (&lt;a ...&gt;), so they are decoded first and then stripped
  const decode = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const clean = (s) => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  function memberOf(text) {
    const m = text.match(/^(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+(.+?)\s+notified\b/i);
    return m ? m[1].trim() : '';
  }

  // The outcome in the rows after the one that called the resolution up. The record is read oldest first here.
  function outcomeOf(rows, from) {
    for (let j = from; j < rows.length && j <= from + 12; j++) {
      const d = rows[j].text;
      const tally = d.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)/);
      const n = tally ? `${tally[1].replace(/,/g, '')}-${tally[2].replace(/,/g, '')}` : null;
      if (/on motion to table/i.test(d) && /agreed to/i.test(d)) return n ? `Tabled ${n}` : 'Tabled';
      if (/on motion to refer/i.test(d) && /agreed to/i.test(d)) return n ? `Referred ${n}` : 'Referred';
      if (/on agreeing to the resolution/i.test(d) && /agreed to/i.test(d)) return n ? `Agreed to ${n}` : 'Agreed to';
      if (/on agreeing to the resolution/i.test(d) && /(failed|not agreed to|rejected)/i.test(d)) return n ? `Rejected ${n}` : 'Rejected';
    }
    return null;
  }

  function build(days) {
    const sitting = (days || []).filter((d) => d && d.date && (d.items || []).length).sort((a, b) => a.date.localeCompare(b.date));
    const rows = [];
    for (const d of sitting) {
      const items = [...d.items].sort((a, b) => String(a.pubDate).localeCompare(String(b.pubDate)));
      for (const it of items) rows.push({ date: d.date, at: it.pubDate, text: clean(it.description) });
    }
    const notices = [];
    rows.forEach((r, i) => {
      if (/^NOTIFICATION OF INTENT TO OFFER/i.test(r.text)) {
        const text = r.text.replace(/^NOTIFICATION OF INTENT TO OFFER[A-Z ]*?\s*[-–—]\s*/i, '');
        // "... notified the House of his intent to offer a motion to discharge the Committee on Rules from further consideration of H. Res. 1247 ..." is the announcement of
        // a ripe discharge petition's motion, not a privileged resolution: it names the measure the petition is for
        const dis = text.match(/intent to offer a motion to discharge\b.*?\b(H\.\s?(?:J\.\s?)?(?:Con\.\s?)?Res\.\s*\d+|H\.\s?R\.\s*\d+)/i);
        notices.push({ i, kind: dis ? 'discharge' : 'resolution', bill: dis ? dis[1].replace(/\s+/g, '').replace(/(\d+)$/, ' $1') : null,
          member: memberOf(text), noticeDate: r.date, noticeAt: r.at, text, id: null, title: null, consideredAt: null, outcome: null, taken: false });
      }
    });
    // each "considered as privileged matter" row answers the oldest notice before it that nothing has answered yet
    rows.forEach((r, i) => {
      if (!/privileged matter/i.test(r.text)) return;
      const n = notices.find((x) => x.kind === 'resolution' && !x.taken && x.i < i);
      if (!n) return;
      n.taken = true;
      n.consideredAt = r.at;
      const label = r.text.match(/\b(H\.\s?(?:J\.\s?)?(?:Con\.\s?)?Res\.\s*\d+)/i);
      const title = r.text.match(/—\s*"?(.{8,300}?)"?\s*$/) || r.text.match(/\bH\.\s?(?:J\.\s?)?(?:Con\.\s?)?Res\.\s*\d+\s*[-–—:]\s*(.{8,300})$/i);
      if (label) n.id = label[1].replace(/\s+/g, ' ').trim();
      if (title) n.title = title[1].trim();
      n.outcome = outcomeOf(rows, i + 1);
    });
    return notices.map((n) => {
      const passed = new Set(sitting.filter((d) => d.date > n.noticeDate).map((d) => d.date)).size;
      const state = n.outcome ? 'resolved' : n.consideredAt ? 'considered' : passed > DUE_DAYS ? 'lapsed' : passed === DUE_DAYS ? 'due' : 'noticed';
      const { i, taken, ...rest } = n;
      return { ...rest, days: passed, state };
    }).sort((a, b) => String(b.noticeAt).localeCompare(String(a.noticeAt)));
  }

  root.PrivilegedNotices = { build, DUE_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PrivilegedNotices;
})(typeof globalThis !== 'undefined' ? globalThis : this);
