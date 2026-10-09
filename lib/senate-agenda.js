// Reading a Senate Democratic Caucus schedule post: the measures it names, the votes, when
// the Senate convenes and when the vote is.
//
// The posts are hand-written, and each shape the parser has not seen silently drops a
// measure or a time. Two did, found by running the parser over the posts in the feed:
//
//   "Cal. #453 , H.R.2347 Survivor Justice Tax Prevention Act" -- a stray space and comma
//   between the calendar number and the bill number, from the link markup. The pattern
//   expected the bill number right after the calendar number, so the measure was lost.
//
//   "it will stand adjourned until 3:00pm on Monday, November 9, 2026" -- "stand", not
//   "stands", so the convening time and date came back null.
//
// A backtest over all 103 schedule posts of the 119th Congress's second session (dev/backtest-senate-schedule.mjs)
// found this parser reading almost none of them: it looked for "Cal. #NNN S.nnn" only. The posts also say
// "Calendar #299, H.R.6938", "House Message with respect to S.1383" (no calendar number at all), "motion to
// discharge S.J.Res.123" and "consideration of H.J.Res.140 ... is possible". So a measure is now found by its
// NUMBER wherever it appears, with the calendar number and title taken from around it, and with the ROLE it
// plays in the sentence it sits in: taken-up, cloture, discharge, possible or named. A panel can then say
// "Pending consideration" only of a measure the post says the Senate will take up, not of one that is merely
// mentioned.
//
// Pure text in, plain data out, so test/senate-agenda.test.js can run it on verbatim posts.
// The Worker adds what needs the network (enrichSenateOrders).

(function (root) {
  const MEAS = String.raw`[SH]\.\s?(?:J\.\s?Res\.|Con\.\s?Res\.|Res\.|R\.)?\s?\d+`;
  // A measure by its number, wherever it is. Not preceded by a letter, digit or dot, so "S. 5" inside a word or "H.R.1.S.5" is not read.
  const TOKEN = new RegExp(String.raw`(?<![A-Za-z0-9.])(${MEAS})\b`, 'g');
  // The calendar number just before a measure, in any of the forms the posts use ("Cal. #548", "Calendar #299,", "Calendar No. 12").
  const CAL_BEFORE = /(?:Cal\.|Calendar)\s*(?:#|No\.?)?\s*(\d+)\s*,?\s*$/i;
  // "stands adjourned as a further mark of respect to the memory of the late Senator X until 10:00am on ..." is a form the posts take after a senator dies.
  const CONVENE = /(?:stands?\s+(?:adjourned|in recess)(?:\s+as a[\s\S]{0,200}?)?\s+until|convenes? at|will convene at)\s+([0-9:]+\s*[ap]\.?m\.?|(?:12(?::00)?\s+)?noon)\s+on\s+(?:([A-Za-z]+day),?\s*)?([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i;

  // What a measure is doing in the sentence it sits in, read from the words just before it (back to the previous measure,
  // at most 200 characters) and, for "possible", from the rest of its sentence.
  // taken-up: the Senate will be on it ("resume consideration of", "House Message with respect to", "consideration of").
  // vote:     a scheduled vote on a motion to proceed to it; the Senate is not on it yet, and may not get there.
  // cloture, discharge: cloture filed or voted on, a discharge motion; possible: "consideration ... is possible".
  const ROLE_ORDER = ['taken-up', 'cloture', 'vote', 'discharge', 'possible', 'named'];
  // The words that lead into a mention, from the start of its own sentence: back to the last blank line or full stop before a capital
  // (and never past the mention before it). Otherwise an earlier sentence's "post-cloture" colours the next measure's role.
  const leadOf = (before) => before.split(/\n\s*\n|\.\s+(?=[A-Z])/).pop();

  function roleOf(before, after) {
    const lead = leadOf(before);
    const b = lead.toLowerCase();
    const rest = after.split(/\.\s|\n\s*\n/)[0].toLowerCase();
    if (/\bpossible\b|\bmay be\b|\bcould be\b/.test(rest)) return 'possible';
    // A line that opens "Motion to ..." is an item in the list of scheduled votes ("Motion to proceed to Cal. #293, S.J.Res.84"), whatever the
    // heading above it said: it is a vote on the motion, and the Senate is not on the measure yet.
    if (/^\s*[-*\u2022\u0001\u0002]?\s*motion\s+to\b/i.test(lead)) return /\bcloture\b/.test(b) ? 'cloture' : /\bdischarge/.test(b) ? 'discharge' : 'vote';
    if (/\bdischarge/.test(b)) return 'discharge';
    if (/\bcloture\b/.test(b)) return 'cloture';
    // "vote on the motion to proceed to Cal. #293, S.J.Res.84": a vote, not the Senate taking it up. "Vote on passage of" is the measure being on the floor.
    if (/\bvote\b|roll call/.test(b) && /motion to proceed/.test(b) && !/passage/.test(b)) return 'vote';
    if (/resume consideration|continue consideration|motion to proceed|proceed to|consideration of|house message with respect to|vote on passage|passage of|take up|will consider/.test(b)) return 'taken-up';
    return 'named';
  }

  // "At 11:30am", "At approximately 2:15pm", "by noon": the time a sentence gives, as minutes after midnight (Eastern, as the posts are).
  function timeIn(lead) {
    const all = [...String(lead).matchAll(/\b(?:at|by|until)\s+(?:approximately\s+|about\s+)?(\d{1,2})(?::(\d\d))?\s*([ap])\.?m\.?|\b(?:at|by)\s+(?:approximately\s+)?(noon)\b/gi)];
    const m = all[all.length - 1];
    if (!m) return null;
    if (m[4]) return 12 * 60;
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'p') h += 12;
    return h * 60 + Number(m[2] || 0);
  }

  // A title ends at its comma, full stop or line. Cut at a word when it runs long, so a title is never half a word.
  function titleAfter(after) {
    const m = after.match(/^\s*,?\s*([^,.\n]{0,70})/);
    let t = (m ? m[1] : '').trim();
    if (m && m[1].length >= 70 && !/^[\s,.]/.test(after.slice(m[0].length))) t = t.replace(/\s+\S*$/, '') + '\u2026';
    return t || null;
  }

  function readMeasures(text, steps) {
    const found = [];
    const tokens = [...text.matchAll(TOKEN)];
    tokens.forEach((m, i) => {
      const at = m.index, end = at + m[0].length;
      const prevEnd = i ? tokens[i - 1].index + tokens[i - 1][0].length : 0;
      const before = text.slice(Math.max(prevEnd, at - 200), at);
      const after = text.slice(end, end + 200);
      const cal = text.slice(Math.max(0, at - 40), at).match(CAL_BEFORE);
      const f = {
        calendarNo: cal ? Number(cal[1]) : null,
        measure: m[1].replace(/\s+/g, ''),
        title: titleAfter(after),
        role: roleOf(before, after),
      };
      found.push(f);
      // The sentence this mention sits in, for its time: back to the last blank line or full stop before a capital.
      if (steps) steps.push({ measure: f.measure, role: f.role, at: timeIn(leadOf(before)) });
    });
    // One entry per measure, in the order first named; it keeps the best role and any calendar number or title seen.
    const out = [];
    for (const f of found) {
      const have = out.find((x) => x.measure === f.measure);
      if (!have) { out.push({ ...f }); continue; }
      if (ROLE_ORDER.indexOf(f.role) < ROLE_ORDER.indexOf(have.role)) have.role = f.role;
      if (have.calendarNo == null && f.calendarNo != null) have.calendarNo = f.calendarNo;
      if (!have.title && f.title) have.title = f.title;
    }
    return out;
  }

  function parse(text) {
    text = String(text || '');
    const steps = [];
    const measures = readMeasures(text, steps);
    // Not delimited on a period: the text is full of abbreviations, and "Cal." truncated
    // this to "Passage of Cal".
    const votes = [...text.matchAll(/roll call vote[s]?:\s*(.{0,170}?)(?=\s*(?:$|Monday|Tuesday|Wednesday|Thursday|Friday|At approximately|Following Leader|Upon disposition))/gi)]
      .map((m) => m[1].replace(/\s+/g, ' ').replace(/[,;]\s*$/, '').trim()).filter(Boolean);
    const convene = text.match(CONVENE);
    // "Monday, November 9, 2026" whichever way the post spaced it (a comma after the weekday is not always there, nor is the weekday).
    const conveneDate = convene
      ? `${convene[2] ? convene[2][0].toUpperCase() + convene[2].slice(1).toLowerCase() + ', ' : ''}${convene[3][0].toUpperCase() + convene[3].slice(1).toLowerCase()} ${Number(convene[4])}, ${convene[5]}`
      : null;
    // "At approximately 5:30pm, absent further agreement, the Senate will vote on passage":
    // the convene time is when the chamber opens, not when the vote happens, and putting
    // 3:00pm on a bill card said the wrong thing.
    const voteAt = text.match(/(?:at\s+)?approximately\s+([0-9:]+\s*[ap]\.?m\.?)[^.]{0,80}?(?:vote|roll call)/i)
                || text.match(/(?:vote|roll call)[^.]{0,80}?at\s+approximately\s+([0-9:]+\s*[ap]\.?m\.?)/i);
    // The schedule names nominations by calendar number, which is what the XML keys on.
    const execCals = [...new Set([...text.matchAll(/Executive Calendar #\s*(\d+)/gi)].map((m) => Number(m[1])))];
    return {
      execCals, measures, steps, votes,
      conveneTime: convene ? convene[1].replace(/\s+/g, ' ').replace(/^noon$/i, '12:00 noon') : null,
      conveneDate,
      voteTime: voteAt ? voteAt[1].replace(/\s+/g, '') : null,
      postCloture: /post-cloture/i.test(text),
    };
  }

  // What the Senate is on at `minutes` after midnight Eastern, according to the post for the day, or null.
  //
  // The plan is read as a sequence: the measures the Senate will take up, in the order and at the times the post gives
  // ("Following Leader remarks, resume consideration of H.R.6938 ... At 11:30am the Senate will proceed to ... H.R.5334"),
  // the latest one that has come due. A measure with no time is the start of the day. `done` is the measures the day's
  // votes have already disposed of (a bill passed, a motion to proceed rejected), which the caller reads off the roll call
  // menu. With nothing taken up, the first measure with cloture or a motion to proceed up for a vote is the one the votes
  // are about. It says only what the post says, so a board shows it as the SCHEDULE and not as a fact about the floor.
  function onFloor(parsed, { minutes, done = [] } = {}) {
    const gone = new Set(done);
    const due = (parsed && parsed.steps || []).filter((s) => !gone.has(s.measure) && (s.at == null || s.at <= minutes));
    // A timed step switches the Senate at its time, so the latest due one wins. Untimed steps are the start of the day, and the
    // first of them is what the day starts on: later untimed mentions are the same post talking about something else.
    const best = (list) => {
      const timed = list.filter((s) => s.at != null).sort((x, y) => x.at - y.at);
      return timed.length ? timed[timed.length - 1] : list.find((s) => s.at == null) || null;
    };
    const hit = best(due.filter((s) => s.role === 'taken-up')) || due.find((s) => s.role === 'cloture' || s.role === 'vote') || null;
    if (!hit) return null;
    const m = parsed.measures.find((x) => x.measure === hit.measure);
    return { measure: hit.measure, calendarNo: m ? m.calendarNo : null, title: m ? m.title : null, role: hit.role, at: hit.at };
  }

  // Which measures a day's votes have finished with, from votes already limited to that day: [{ measure, stage, carried }], stage
  // being the roll call menu's own (see SENATE_VOTE_STAGES in worker.js). A final vote (passage, adoption) finishes a measure
  // either way. A motion to proceed or a cloture vote that FAILED sends the Senate on to the next thing, as on 30 September
  // when cloture on the motion to proceed to H.R. 7008 failed and the next vote was on H.R. 9340. Amendment votes finish nothing.
  // Answers measures as the posts write them ("H.R.7008", no space), so they compare with `steps`.
  function disposedBy(votes) {
    const out = new Set();
    for (const v of votes || []) {
      const key = String(v.measure || '').replace(/\s+/g, '');
      if (!key) continue;
      if (v.stage === 'final') out.add(key);
      else if (!v.carried && (v.stage === 'cloture-mtp' || v.stage === 'mtp' || v.stage === 'cloture')) out.add(key);
    }
    return [...out];
  }

  root.SenateAgenda = { parse, onFloor, disposedBy };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateAgenda;
})(typeof globalThis !== 'undefined' ? globalThis : this);
