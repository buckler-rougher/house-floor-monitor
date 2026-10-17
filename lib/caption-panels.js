// What the House's captions say, read for the morning-business panels (prayer, pledge, Speaker pro tempore, one-minute speeches) before the Clerk has published them.
// Pure functions over the caption text (all capitals, as the House's captioner writes it); app.js draws what they find. Each pattern is one that real caption tracks carried
// (15 Sep, 16 Sep, 8 Sep, 10 Sep and 3 Sep 2026); see test/caption-panels.test.js, which runs them over those lines.
//
//   CaptionPanels.EVENTS                          [{ key, mode, re, needles }]  the phrases that put a panel up, and the words that keep it up (see app.js)
//   CaptionPanels.prayerLeader(text)              { guest: bool, name } | null           "THE PRAYER WILL BE OFFERED BY GUEST CHAPLAIN, REVEREND JOHN KELLOGG."
//   CaptionPanels.pledgeLeader(text)              { chair: true } | { honorific, surname, state } | null
//   CaptionPanels.speakerProTem(text)             name | null                            "I HEREBY APPOINT THE HONORABLE MIKE FLOOD TO ACT AS SPEAKER PRO TEMPORE"
//   CaptionPanels.cueBlock(vtt, heard, phrase)    the cues of a WebVTT file the words are in, with the one before and the one after, as the file has them | null
//
// Names come back as spoken (capitals, and "GIBBONS" is the captioner's drift for "KIBBEN"); the caller sets the case and looks the Member up.

(function (root) {
  const EVENTS = [
    { key: 'prayer', mode: 'prayer', re: /prayer will be\s+offered|offered the following prayer|offered by (?:the )?chaplain|chaplain[^.]{0,30}offered/i, needles: ['prayer', 'chaplain'] },
    { key: 'pledge', mode: 'pledge', re: /pledge of allegiance/i, needles: ['pledge', 'allegiance'] },
    { key: 'speaker', mode: 'speaker', re: /hereby appoint the honorable|to act as speaker pro tempore/i, needles: ['pro tempore'] },
    { key: 'one-minute', mode: 'one-minute', re: /recognized for one minute|one[- ]minute speech/i, needles: ['one-minute speech', 'one minute speech'] },
  ];

  function prayerLeader(text) {
    if (!text) return null;
    // the comma after GUEST CHAPLAIN is optional; the affiliation that follows is cut off by a period or a comma; the House Chaplain is announced by surname alone
    const guest = text.match(/offered\s+by\s+(?:the\s+)?guest\s+chaplain,?\s+([^.,]{2,60})/i)
      // the Clerk's published form drops the words "guest chaplain" and leads with the honorific, so captions sometimes do too
      || text.match(/offered\s+by\s+((?:most\s+reverend|reverend|rev|father|rabbi|imam|pastor|cantor|doctor|dr|bishop|monsignor|sister|brother|elder)\.?\s+[^.,]{2,50})/i);
    if (guest) return { guest: true, name: guest[1] };
    const house = text.match(/offered\s+by\s+(?:the\s+)?(?:house\s+)?chaplain,?\s+(?:chaplain\s+)?([^.,]{2,60})/i);
    return house ? { guest: false, name: house[1] } : null;
  }

  // "THE PLEDGE OF ALLEGIANCE WILL BE LED BY THE GENTLEMAN FROM SOUTH CAROLINA, MR. WILSON." or "THE CHAIR WILL LEAD THE HOUSE IN THE PLEDGE OF ALLEGIANCE."
  function pledgeLeader(text) {
    if (!text) return null;
    const led = text.match(/pledge\s+of\s+allegiance\s+will\s+be\s+led\s+by\s+the\s+gentle(?:man|woman|lady)\s+from\s+([A-Za-z ]+?),\s+(M[rs]s?|Miss)\.?\s+([A-Za-z'-]+(?:\s+[A-Za-z'-]+)?)\s*[.,]/i);
    if (led) return { state: led[1], honorific: led[2], surname: led[3] };
    return /the\s+chair\s+will\s+lead\s+the\s+house\s+in\s+the\s+pledge/i.test(text) ? { chair: true } : null;
  }

  function speakerProTem(text) {
    if (!text) return null;
    const m = text.match(/appoint\s+the\s+honorable\s+(.+?)\s+to\s+act\s+as\s+speaker\s+pro\s+tempore/i) || text.match(/honorable\s+(.+?)\s+to\s+act\s+as\s+speaker\s+pro\s+tempore/i);
    return m ? m[1] : null;
  }

  const squash = (s) => String(s).replace(/\s+/g, ' ').trim().toUpperCase();
  function cueBlock(vtt, heard, phrase) {
    const cues = [];
    for (const block of String(vtt || '').split(/\r?\n\r?\n/)) {
      const lines = block.split(/\r?\n/);
      const at = lines.findIndex((l) => l.includes('-->'));
      if (at < 0) continue;
      const raw = lines.slice(at + 1).join('\n').trim();
      cues.push({ time: lines[at].trim(), raw, text: squash(raw.replace(/^UNIDENTIFIED SPEAKER:\s*/i, '')) });
    }
    let joined = '';
    const marks = [];
    for (const c of cues) { marks.push(joined.length); joined += c.text + ' '; }
    let from = joined.lastIndexOf(squash(heard)), len = squash(heard).length;
    if (from < 0) { from = joined.lastIndexOf(squash(phrase)); len = squash(phrase).length; }
    if (from < 0 || !len) return null;
    const idx = (pos) => { let k = 0; while (k + 1 < marks.length && marks[k + 1] <= pos) k++; return k; };
    const a = idx(from), z = idx(from + len - 1);
    return cues.slice(Math.max(0, a - 1), z + 2).map((c) => `${c.time}\n${c.raw}`).join('\n\n');
  }

  root.CaptionPanels = { EVENTS, prayerLeader, pledgeLeader, speakerProTem, cueBlock };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CaptionPanels;
})(typeof globalThis !== 'undefined' ? globalThis : this);
