// A day on the House floor as an agenda: what was taken up, when, and how it came out. The time machine's way of finding a place in the day.
//
//   ReplayAgenda.build(items, rolls) -> [{ ms, kind, title, detail, outcome, vote, bills, find }]  oldest first
//
// `items` are the Clerk's floor-log entries ({ timestamp, description }, the HTML escaped once more, as the Worker serves them); `rolls` are the day's roll calls
// ({ roll, legis, question, result, ms, totals }, `ms` when the vote closed). Each debate is a row of its own: the measure and its official title (from the entry that moved it),
// how long the debate was set for and under what ("suspension of the rules", a rule, the Senate's amendments), and what came of it: the Clerk's next word on it, with the roll call
// that settled it when the vote came later (a postponed vote is found by the measure's number). A roll call that no debate in the log accounts for is a row of its own.
//
// kind: 'gavel' | 'debate' | 'speech' | 'recess' | 'vote' | 'other' | 'adjourn'

(function (root) {
  const dec = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
  const plain = (s) => dec(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const key = (x) => String(x || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();   // "H.R. 9497" and the roll file's "H R 9497" are the same measure
  const billsIn = (s) => [...new Set([...dec(s).matchAll(/rel="bill"[^>]*>(?:<a[^>]*>)?([^<]+)</g)].map((m) => m[1].trim()))];
  const nice = (legis) => String(legis || '').replace(/^H R /, 'H.R. ').replace(/^H RES /, 'H. Res. ').replace(/^H J RES /, 'H.J. Res. ').replace(/^H CON RES /, 'H. Con. Res. ').replace(/^S J RES /, 'S.J. Res. ').replace(/^S RES /, 'S. Res. ').replace(/^S /, 'S. ');
  const sentence = (s) => String(s).toLowerCase().replace(/^./, (c) => c.toUpperCase());
  const isRes = (b) => /^H\.? ?(Con\.? )?Res\b/i.test(b);   // a rule or a simple resolution; a joint resolution (H.J. Res.) is a measure

  function build(items, rolls) {
    const list = (items || []).slice().sort((a, b) => a.timestamp - b.timestamp);
    // an official title is in the bold of the entry that moved the measure
    const titles = new Map();
    for (const it of list) {
      // the title belongs to the measure named just before it ("<a>H.R. 9497</a> \u2014 "<b>To provide...</b>"")
      for (const m of dec(it.description).matchAll(/rel="bill"[^>]*>(?:<a[^>]*>)?([^<]+)<\/a>(?:<\/a>)?\s*[\u2014-]\s*"?\s*<b>([^<]+)<\/b>/g)) if (!titles.has(key(m[1]))) titles.set(key(m[1]), m[2].replace(/\.$/, '').trim());
    }
    const named = (b) => { const t = titles.get(key(b)); return t ? `${b} — ${t}` : b; };
    const used = new Set();
    const rows = [];

    list.forEach((it, i) => {
      const d = plain(it.description);
      const base = { ms: it.timestamp, bills: [], vote: null, outcome: '', detail: '' };
      if (/^The House convened/i.test(d)) rows.push({ ...base, kind: 'gavel', title: 'The House convened', find: 'convened gavel' });
      else if (/\badjourn/i.test(d) && /^The (House|Speaker)/i.test(d)) rows.push({ ...base, kind: 'adjourn', title: 'The House adjourned', find: 'adjourned' });
      else if (/^DEBATE\b/.test(d)) {
        const all = billsIn(it.description);
        const meas = all.filter((b) => !isRes(b));
        const bills = meas.length ? meas : all;   // "Pursuant to H. Res. 1530, ... debate on the Senate amendments to H.R. 5334": the debate is on H.R. 5334, under the rule
        const dur = (/proceeded with (.+?) of debate/i.exec(d) || [])[1] || '';
        const senate = /senate amendment/i.test(d);
        const rule = !meas.length;
        const under = meas.length ? all.filter(isRes) : [];
        // how it came to the floor: the nearest earlier entries
        let how = '';
        for (let j = i - 1; j >= 0 && j >= i - 6 && !how; j--) {
          const p = plain(list[j].description);
          const m = /^(M[rs]s?\. [^ ]+(?: \([A-Z]{2}\))?) (moved[^.]*|asked[^.]*|called up[^.]*)\./.exec(p);
          if (m) how = `${m[1]} ${m[2]}`;
          else if (/^Considered under suspension/i.test(p)) how = 'Under suspension of the rules';
          else if (/^Considered under the provisions of rule/i.test(p)) how = under.length ? `Under ${under.join(', ')}` : 'Under a rule';
        }
        if (!how && under.length) how = `Under ${under.join(', ')}`;
        let title;
        if (rule) {
          const before = list.slice(0, i + 1).reverse().find((x) => /^Rule provides for consideration of/i.test(plain(x.description)));
          const brings = before ? billsIn(before.description) : [];
          title = `Rule ${bills.join(', ')}${brings.length ? ` for ${brings.map(named).join('; ')}` : ''}`;
        } else title = (senate ? 'Senate amendments to ' : '') + (bills.map(named).join('; ') || d.replace(/^DEBATE\s*-\s*/, ''));
        // how it came out: the Clerk's next word on it, before the next debate
        let outcome = '';
        for (let j = i + 1; j < list.length && j <= i + 14; j++) {
          const p = plain(list[j].description);
          if (/^DEBATE\b/.test(p)) break;
          const post = /further proceedings[^.]*postponed|put the question[^.]*(?:Yeas and Nays|yeas and nays)/i.test(p);
          const res = /^On (?:motion|passage|agreeing|ordering|the)[^]*?\b((?:Agreed to|Passed|Failed|Rejected|Not agreed to)[^.]*)/i.exec(p);
          if (res) { outcome = res[1].replace(/\s*\(?Roll no\.?\s*\d+\)?\.?$/i, '').replace(/\s*[A-Z]{1,2}\.? ?(?:Res|R)\.? ?\d.*$/, '').trim(); break; }
          if (post) { outcome = 'Vote postponed'; break; }
        }
        // the roll call that settled it, which may come hours later
        const keys = bills.map(key);
        const roll = (rolls || []).find((r) => !used.has(r.roll) && r.ms >= it.timestamp && keys.includes(key(r.legis)));
        let vote = null;
        if (roll) { used.add(roll.roll); vote = { roll: roll.roll, ms: roll.ms, result: roll.result, yeas: roll.totals.yeas, nays: roll.totals.nays, question: roll.question }; }
        rows.push({
          ...base, kind: 'debate', title, bills: keys, vote,
          voice: !vote && /voice vote/i.test(outcome),
          detail: [dur ? `${sentence(dur)} of debate` : 'Debate', how].filter(Boolean).join('. '),
          outcome: vote ? `${vote.result}, ${vote.yeas}–${vote.nays} (roll ${vote.roll})` : outcome,
          find: `${bills.join(' ')} ${title} ${how}`,
        });
      } else if (/^(ONE[- ]MINUTE SPEECHES|SPECIAL ORDER SPEECHES|MORNING[- ]HOUR)/.test(d)) {
        rows.push({ ...base, kind: 'speech', title: sentence(d.split(' - ')[0]).replace(/^Morning-hour debate$/i, 'Morning-hour debate'), detail: (/ - (.*)/.exec(d) || [])[1] || '', find: d });
      } else if (/\bdeclared a recess|stand in recess|\brecess\b/i.test(d) && /^The (House|Speaker|Chair)/i.test(d)) {
        rows.push({ ...base, kind: 'recess', title: 'Recess', detail: d, find: 'recess' });
      } else if (/^(POINT OF PERSONAL PRIVILEGE|QUESTION OF THE PRIVILEGES)/.test(d)) {
        rows.push({ ...base, kind: 'other', title: sentence(d.split(' - ')[0]), detail: (/ - (.*)/.exec(d) || [])[1] || '', find: d });
      }
    });

    // a roll call no debate accounts for: its own row (a motion to adjourn, a quorum call, a vote by a day whose log was thin)
    for (const r of rolls || []) {
      if (used.has(r.roll)) continue;
      const bill = nice(r.legis);
      rows.push({
        ms: r.ms, kind: 'vote', bills: [key(r.legis)], vote: { roll: r.roll, ms: r.ms, result: r.result, yeas: r.totals.yeas, nays: r.totals.nays, question: r.question },
        title: `Vote${bill ? ` on ${titles.get(key(r.legis)) ? `${bill} — ${titles.get(key(r.legis))}` : bill}` : ''}`,
        detail: String(r.question || ''), outcome: `${r.result}, ${r.totals.yeas}–${r.totals.nays} (roll ${r.roll})`, find: `${bill} ${r.question} vote roll ${r.roll}`,
      });
    }
    // a day whose roll files could not be read still has its votes in the Clerk's log
    if (!(rolls || []).length) {
      for (const it of list) {
        const d = plain(it.description);
        const m = /^(On [^]*?)((?:Agreed to|Passed|Failed|Rejected)[^:]*?by the Yeas and Nays[^0-9]*(\d+)\s*-\s*(\d+))/i.exec(d);
        if (!m) continue;
        rows.push({ ...base0(it), kind: 'vote', title: `Vote ${m[1].trim().replace(/^On /, 'on ')}`.trim(), detail: '', outcome: `${m[2].replace(/\s*by the Yeas and Nays.*$/i, '')}, ${m[3]}–${m[4]}`, find: d });
      }
    }
    return rows.sort((a, b) => a.ms - b.ms).map((r) => ({ ...r, find: `${r.find || ''} ${r.title} ${r.outcome}`.toLowerCase().replace(/[^a-z0-9. ]+/g, ' ') + ' ' + (r.bills || []).join(' ').toLowerCase() }));
  }
  const base0 = (it) => ({ ms: it.timestamp, bills: [], vote: null });

  root.ReplayAgenda = { build, key };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ReplayAgenda;
})(typeof globalThis !== 'undefined' ? globalThis : this);
