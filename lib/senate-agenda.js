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
// Pure text in, plain data out, so test/senate-agenda.test.js can run it on verbatim posts.
// The Worker adds what needs the network (enrichSenateOrders).

(function (root) {
  const MEAS = String.raw`[SH]\.\s?(?:J\.\s?Res\.|Con\.\s?Res\.|Res\.|R\.)?\s?\d+`;
  // The title stops at the end of its line. It used to run on across the break, so for
  // "Cal. #548 H.R.7008 , Stop Insider Trading Act" it swallowed the next line AND the "Cal" of
  // the measure after it, which was then never matched, and carried a newline into the title.
  // The comma may sit on either side of the bill number: "Cal. #548 H.R.7008 , Title" and
  // "Cal. #684 , H.R.9340 Title" are both in the feed.
  const MEASURE = new RegExp(String.raw`Cal\.\s*#?\s*(\d+)\s*,?\s*(${MEAS})\s*,?\s*([^,.\n]{0,70})`, 'g');
  const CONVENE = /(?:stands?\s+adjourned until|convenes? at|will convene at)\s+([0-9:]+\s*[ap]\.?m\.?)\s+on\s+([A-Za-z]+,\s*[A-Za-z]+\s+\d{1,2},\s*\d{4})/i;

  function parse(text) {
    text = String(text || '');
    const measures = [], seen = new Set();
    for (const m of text.matchAll(MEASURE)) {
      const measure = m[2].replace(/\s+/g, '');
      const k = `${m[1]}|${measure}`;
      if (seen.has(k)) continue;
      seen.add(k);
      measures.push({ calendarNo: Number(m[1]), measure, title: m[3].trim() || null });
    }
    // Not delimited on a period: the text is full of abbreviations, and "Cal." truncated
    // this to "Passage of Cal".
    const votes = [...text.matchAll(/roll call vote[s]?:\s*(.{0,170}?)(?=\s*(?:$|Monday|Tuesday|Wednesday|Thursday|Friday|At approximately|Following Leader|Upon disposition))/gi)]
      .map((m) => m[1].replace(/\s+/g, ' ').replace(/[,;]\s*$/, '').trim()).filter(Boolean);
    const convene = text.match(CONVENE);
    // "At approximately 5:30pm, absent further agreement, the Senate will vote on passage":
    // the convene time is when the chamber opens, not when the vote happens, and putting
    // 3:00pm on a bill card said the wrong thing.
    const voteAt = text.match(/(?:at\s+)?approximately\s+([0-9:]+\s*[ap]\.?m\.?)[^.]{0,80}?(?:vote|roll call)/i)
                || text.match(/(?:vote|roll call)[^.]{0,80}?at\s+approximately\s+([0-9:]+\s*[ap]\.?m\.?)/i);
    // The schedule names nominations by calendar number, which is what the XML keys on.
    const execCals = [...new Set([...text.matchAll(/Executive Calendar #\s*(\d+)/gi)].map((m) => Number(m[1])))];
    return {
      execCals, measures, votes,
      conveneTime: convene ? convene[1] : null,
      conveneDate: convene ? convene[2] : null,
      voteTime: voteAt ? voteAt[1].replace(/\s+/g, '') : null,
      postCloture: /post-cloture/i.test(text),
    };
  }

  root.SenateAgenda = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateAgenda;
})(typeof globalThis !== 'undefined' ? globalThis : this);
