/**
 * What the Senate clerk is doing right now -- a quorum call or a roll call vote --
 * read off the caption text. Shared by worker.js and the browser, and testable
 * on its own.
 *
 * WHY THIS FILE EXISTS
 * The two events look identical on the captions: the clerk reads the alphabet
 * either way. They used to share one panel, one set of names and one reset rule,
 * with the Worker holding a single set per stream and the browser patching around
 * it. That conflation produced a board stuck partially lit, a new call that did
 * not clear the old one, and a vote with no end. It is one state machine here,
 * and a call has a KIND.
 *
 * WHAT IS KNOWN (see AGENTS.md, "What the captions actually carry")
 *   - Nothing announces the START of a call. The only signal is the clerk
 *     returning to the top of the alphabet.
 *   - A name being read ("MS. BALDWIN.") is not a vote and not a presence.
 *   - A vote is recorded with a comma ("MS. DUCKWORTH, AYE.") or sits under a
 *     heading ("SENATORS VOTING IN THE NEGATIVE: MR. PAUL.").
 *   - A vote ENDS when the chair reads the tally. A quorum call ENDS when it is
 *     vitiated. Neither ends on a timer; the idle expiry here is a backstop.
 *
 * The same text also says who has the floor: Senate TV names the member once, at
 * recognition ("MS. CANTWELL:"), so the label is latched in `speaker` until the
 * next one. That is not part of any call and survives one ending.
 *
 * A call is { callId, kind, names, votes, lastRoll, lastAt, ended, speaker }. `callId` is
 * the wall-clock ms the call was first seen, so two independent readers (the
 * Worker and a tab) can tell "same call" from "a newer call" by comparing them.
 * Kind is 'quorum' until a vote is heard, then 'vote': a roll call vote opens
 * exactly like a quorum call, so the first recorded answer is the tell.
 */
(function (root) {
  'use strict';

  const QUORUM_REQUIRED = 51;

  // Idle expiry, the backstop for a call whose ending was never heard. Long,
  // because both kinds genuinely pause for latecomers.
  const IDLE_MS = 45 * 60 * 1000;

  // After a call ends, its own trailing names are still in the caption window
  // for a few cues. Ignoring names for this long keeps them from opening a
  // phantom call.
  const GRACE_MS = 60 * 1000;

  // Two readers that saw the same call start within this of each other agree.
  const SAME_CALL_MS = 30 * 1000;

  const HISTORY_MAX = 20;

  // Forms of address that are not members. "MR. PRESIDENT" opens half the
  // speeches on the floor and parses as a surname.
  // Words that follow "MR." in a half-rewritten roll-up window ("MR. NOT." when the captioner replaced "MR. DURBIN: THANK YOU, MR. PRESIDENT" mid-line, 10 November 2026) are not senators.
  const NOT_A_MEMBER = new Set(['PRESIDENT', 'SPEAKER', 'CHAIRMAN', 'CHAIRWOMAN', 'CHAIR', 'CLERK', 'LEADER', 'SECRETARY', 'PARLIAMENTARIAN', 'NOT', 'THE', 'AND', 'YOU', 'THANK', 'THAT', 'THIS', 'WITH', 'FOR', 'ARE', 'WE', 'IS', 'IT', 'OF', 'TO', 'IN', 'ON', 'AT', 'BY', 'OR', 'IF', 'SO', 'NO', 'YES']);

  const NAME = String.raw`([A-Z][A-Z'’-]{1,24}(?:\s+[A-Z][A-Z'’-]{1,24})?)`;
  // The clerk reads a state after a surname only where two senators share it ("Mr. SCOTT of
  // Florida", "Mr. SCOTT of South Carolina"). That qualifier is captured as part of the name, and the
  // surname's own second word may not be "OF": without that, "SCOTT OF" read as a two-word surname
  // and the period it needed never came, so the Scotts were silently missed.
  const NAME_Q = String.raw`((?!(?:MR|MRS|MS)\b)[A-Z][A-Z'’-]{1,24}(?:\s+(?!OF\b)[A-Z][A-Z'’-]{1,24})?)(?:\s+OF\s+(@STATES@))?`;
  // A name being CALLED ends in a period; a member taking the floor ends in a colon.
  const ROLL_SRC = String.raw`\b(?:MR|MRS|MS)\.\s+${NAME_Q}\s*\.`;
  // Only AYE has been seen. NO, NAY and PRESENT are on the shape of the pattern.
  const VOTE_SRC = String.raw`\b(?:MR|MRS|MS)\.\s+${NAME_Q}\s*,\s*(AYE|YEA|NO|NAY|PRESENT)\b`;
  // The AYE heading is observed; the negative wording is GUESSED and unconfirmed.
  // The heading needs VOTING. "No Senator VOTED in the negative" is a running
  // tally, one letter away, and loosening this inverts results silently.
  const HEAD_RE = /\bSENATORS?\s+VOTING\s+(?:IN\s+THE\s+)?(AFFIRMATIVE|NEGATIVE|AYE|YEA|NAY|NO|PRESENT)\b/g;
  const YEAS_RE = /\bTHE\s+(?:YEAS|AYES)\s+ARE\s+(\d{1,3})\b/;
  const NAYS_RE = /\bTHE\s+NAYS\s+ARE\s+(\d{1,3})\b/;
  const TALLY_RE = /\bTHE\s+(?:YEAS|AYES)\s+ARE\s+(\d{1,3})\b[\s\S]{0,60}?\bTHE\s+NAYS\s+ARE\s+(\d{1,3})\b/;
  // The tally alone cannot say what happened (cloture needs sixty, a treaty two
  // thirds), so the outcome word is read, not inferred.
  const OUTCOME_RE = /\b(?:IS|ARE|STANDS|HAVING)\s+(NOT\s+)?(AGREED\s+TO|PASSED|CONFIRMED|INVOKED|ADOPTED|REJECTED|SUSTAINED|WELL\s+TAKEN)\b/;
  // What is being voted on. The chair states the question BEFORE the clerk starts
  // the roll ("THE QUESTION IS ON AGREEING TO THE MOTION TO PROCEED TO ..."),
  // and senate.gov's vote menu only lists a vote after it ends, so the captions
  // are the one source there is while it is open. NOT confirmed against a real
  // caption: the wording is the Senate's standing form, matched loosely, and the
  // board shows nothing rather than guess when it is absent. Runs to the
  // announcement that follows it, or to the first senator's name (a question never
  // contains one, and a window that cut before the announcement would otherwise let the
  // votes that follow become part of the question), or the end of the cue.
  const QUESTION_RE = /\bTHE\s+QUESTION\s+IS,?\s+([\s\S]{8,400}?)(?=\s+(?:THE\s+YEAS\s+AND\s+NAYS|THE\s+CLERK\s+WILL\s+CALL|IS\s+THERE\s+A\s+SUFFICIENT\s+SECOND|(?:IF\s+NOT,?\s+)?THE\s+QUESTION\s+IS)\b|\s+(?:MR|MRS|MS)\.\s+[A-Z]|$)/;
  // A question and the roll that follows are minutes apart at most; one older
  // than this belongs to something else.
  const QUESTION_MS = 15 * 60 * 1000;
  const LABEL_REPEAT_MS = 10 * 60 * 1000;
  // A heading's list can run over many cues; one not continued for this long is over.
  const BLOCK_MS = 90 * 1000;
  // The clerk's second pass over the roll, for senators who have not voted, comes while the vote is still going; one that comes after this long with nothing heard is a different roll call.
  const VOTE_PASS_MS = 20 * 60 * 1000;

  // How a quorum call ends, as heard on 10 November 2026 (test/senate-captions-2026-11-10.json): "I ask that it be VITIATED" (the senator who asks may be a hundred characters from
  // the words "quorum call"), "I ask that the quorum call be LIFTED", "I ask that we DISPENSE with the quorum call", and the majority leader's "the order for the quorum call be RESCINDED".
  // Each is a request the chair grants "without objection"; none of them has been seen refused.
  const VITIATE_RE = /(QUORUM\s+CALL[\s\S]{0,60}?(VITIAT|RESCIND|LIFTED|DISPENS))|((VITIAT|RESCIND|LIFTED|DISPENS)[A-Z]*[\s\S]{0,60}?QUORUM\s+CALL)|\bASK\s+(?:THAT\s+)?IT\s+BE\s+(VITIAT)/;
  // The captioner types a section label when a call starts: "QUORUM CALL:" before the clerk's first name, "VOTE:" before a roll call, "ADJOURN:" at the end of the day. It appears on its own line
  // and the roll-up window repeats it for a few cues. It is the one signal that a call BEGINS (the clerk's first name is not), and it says which kind, so a roll call is a vote from its first name.
  const CALL_LABEL_RE = /\b(QUORUM\s+CALL|VOTE)\s*:/g;

  // Senate floor address, as the stenographer types it. A member taking the floor
  // ends in a COLON, which is what tells it from a name being read.
  const MEMBER_RE = /\b(?:MR|MRS|MS|SEN|SENATOR)\.?\s+([A-Z][A-Z'’-]{1,24}(?:\s+[A-Z][A-Z'’-]{1,24})?)\s*:/g;
  const OFFICE_RE = /\b(THE\s+(?:PRESIDING\s+OFFICER|VICE\s+PRESIDENT|PRESIDENT\s+PRO\s+TEMPORE|ACTING\s+PRESIDENT\s+PRO\s+TEMPORE|CLERK|MAJORITY\s+LEADER|MINORITY\s+LEADER|CHAIR))\s*:/g;

  // Two senators can share a surname (the Scotts of Florida and South Carolina),
  // and the caption label carries only the surname. What disambiguates is the
  // chair, who recognises by state: "THE SENATOR FROM FLORIDA." comes before the
  // label, and in the Record a member is written "Mr. SCOTT of Florida".
  const STATES = {'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR', 'CALIFORNIA': 'CA', 'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE', 'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI', 'IDAHO': 'ID', 'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA', 'KANSAS': 'KS', 'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD', 'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS', 'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH', 'OKLAHOMA': 'OK', 'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT', 'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV', 'WISCONSIN': 'WI', 'WYOMING': 'WY'};
  const STATE_RE = new RegExp('\\b(?:SENATORS?\\s+FROM|OF)\\s+(' + Object.keys(STATES).sort((a, b) => b.length - a.length).join('|') + ')\\b', 'g');
  const STATE_ALT = Object.keys(STATES).sort((a, b) => b.length - a.length).join('|');
  const ROLL_RE = new RegExp(ROLL_SRC.replace('@STATES@', STATE_ALT), 'g');
  const VOTE_RE = new RegExp(VOTE_SRC.replace('@STATES@', STATE_ALT), 'g');
  // A senator as the call keys them: the surname, or SURNAME (ST) when the clerk read the state.
  const keyOf = (name, state) => (state ? `${fold(name)} (${STATES[state]})` : fold(name));
  // A recognition and the label that follows it are seconds apart, and the label
  // can land in the next cue. Held this long, then forgotten: a state named in
  // passing a minute ago is not who is speaking now.
  const STATE_HINT_MS = 45 * 1000;

  // Diacritics folded: the roster says Luján, the captions say LUJAN.
  const fold = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

  const emptyCall = () => ({
    callId: null, kind: null, names: [], votes: {}, lastRoll: '', lastAt: 0, ended: null, history: [], speaker: null, stateHint: null, question: null, pendingQuestion: null, block: null, pendingYeas: null,
  });

  function copy(s) {
    return { ...s, names: [...s.names], votes: { ...s.votes }, history: [...(s.history || [])] };
  }

  // Close out the call being replaced into a one-line history record. Whoever
  // wants to know who was absent from an earlier roll (Missing Senators) needs
  // more than "there was a call", but not every name from every one.
  function remember(s) {
    if (!s.callId) return;
    s.history.push({
      callId: s.callId, kind: s.kind,
      count: s.kind === 'vote' ? Object.keys(s.votes).length : s.names.length,
      ended: s.ended ? { how: s.ended.how, at: s.ended.at, ...(s.ended.word ? { word: s.ended.word } : {}) } : null,
    });
    if (s.history.length > HISTORY_MAX) s.history.splice(0, s.history.length - HISTORY_MAX);
  }

  function begin(s, kind, now) {
    remember(s);
    s.callId = now;
    s.kind = kind;
    s.names = [];
    s.votes = {};
    s.lastRoll = '';
    s.ended = null;
    s.question = null;
    s.lastAt = now;
  }

  // Every vote in the text, in either of the two shapes it comes in. Headed
  // blocks first, so a name inside one is attributed to its heading and not to
  // the bare-name path; the heading's own text is also returned so the roll
  // scan can leave it alone.
  function readVotes(flat, latched) {
    const out = [];
    const marks = [...flat.matchAll(HEAD_RE)].map((m) => ({
      start: m.index,
      at: m.index + m[0].length,
      vote: /AFFIRM|AYE|YEA/.test(m[1]) ? 'AYE' : /NEGATIVE|NAY|NO/.test(m[1]) ? 'NO' : 'PRESENT',
    }));
    marks.forEach((mk, i) => {
      const chunk = flat.slice(mk.at, i + 1 < marks.length ? marks[i + 1].start : flat.length);
      const re = new RegExp(ROLL_RE.source, 'g');
      let r;
      while ((r = re.exec(chunk))) out.push([keyOf(r[1], r[2]), mk.vote]);
      for (const key of headedList(chunk)) out.push([key, mk.vote]);
    });
    const re = new RegExp(VOTE_RE.source, 'g');
    let m;
    while ((m = re.exec(flat))) out.push([keyOf(m[1], m[2]), m[3] === 'YEA' ? 'AYE' : m[3] === 'NAY' ? 'NO' : m[3]]);
    // Bare names under a heading are a block and are not roll reads: cut the
    // text off at the first heading.
    // The window scrolls the heading off the top of its three lines while the list under it goes on ("BARRASSO, BLACKBURN, CAPITO, ..." with no heading in the cue), so text before the cue's
    // first heading is a continuation of the block the last cue ended in, when that was heard a moment ago and the text is a list of names, not speech.
    const head = marks.length ? flat.slice(0, marks[0].start) : flat;
    // Text ahead of the cue's FIRST heading is the tail of the list that came before that heading (the affirmative list, ahead of the negative heading), so it takes the earlier heading's vote:
    // taking the latest one counted the last name of the affirmative list ("... WICKER, YOUNG.") as a no.
    const ahead = marks.length ? ({ NO: 'AYE', PRESENT: 'NO' })[marks[0].vote] || null : latched;
    if (ahead && /,|^\s*[A-Z][A-Z'\u2019-]+\s*\./.test(head) && !/\b(?:MR|MRS|MS)\./.test(head.split('.')[0] || '')) {
      for (const key of headedList(head)) out.push([key, ahead]);
    }
    return { votes: out, rollText: marks.length ? flat.slice(0, marks[0].start) : flat, block: marks.length ? marks[marks.length - 1].vote : null };
  }


  // The clerk's recap under a heading, as heard on 10 November 2026 about half an hour into a roll call: "SENATORS VOTING IN THE AFFIRMATIVE -- ARMSTRONG, BARRASSO, BLACKBURN, ... YOUNG.
  // SENATORS VOTING IN THE NEGATIVE -- BALDWIN, BOOKER, ... ROUNDS." Bare surnames, a comma between, a full stop after the last (and "MR. WYDEN, NO." after, for the ones that voted since).
  // A name is taken only when a comma or the full stop follows it, because the roll-up window cuts a cue mid-word. The list ends at the first full stop: names have none.
  function headedList(chunk) {
    const lead = chunk.match(/^\s*(?:--|\u2014|\u2013|:)?\s*/)[0].length;
    const body = chunk.slice(lead);
    const stop = body.indexOf('.');
    const text = stop < 0 ? body : body.slice(0, stop + 1);
    const parts = text.split(',');
    if (stop < 0) parts.pop();                       // no full stop yet: the last token may be half a name
    const keys = [];
    for (let part of parts) {
      part = part.replace(/\.$/, '').trim();
      const hit = new RegExp("^([A-Z][A-Z'\u2019-]+(?: (?!OF\\b)[A-Z][A-Z'\u2019-]+)?)(?: OF (" + STATE_ALT + "))?$").exec(part);
      if (!hit) { if (keys.length) break; else continue; }
      const base = fold(hit[1]);
      if (NOT_A_MEMBER.has(base) || /^(?:MR|MRS|MS)$/.test(base)) continue;
      keys.push(keyOf(hit[1], hit[2]));
    }
    return keys;
  }

  // The LAST label in the text, because a cue can carry a handoff: one member
  // yielding and the next being recognised inside the same line.
  function lastLabel(flat) {
    let hit = null, m;
    const mem = new RegExp(MEMBER_RE.source, 'g');
    while ((m = mem.exec(flat))) {
      // "MR. PRESIDENT:" is a form of address, not a member taking the floor.
      if (!NOT_A_MEMBER.has(fold(m[1]))) hit = { kind: 'member', at: m.index, label: m[1].replace(/\s+/g, ' ').trim() };
    }
    const off = new RegExp(OFFICE_RE.source, 'g');
    while ((m = off.exec(flat))) {
      if (!hit || m.index > hit.at) hit = { kind: 'office', at: m.index, label: m[1].replace(/\s+/g, ' ').trim() };
    }
    return hit;
  }

  /**
   * Feed one chunk of caption text. Returns a NEW state; the input is untouched.
   * Idempotent over repeats, because the caption window is a rolling roll-up
   * that shows the same words for several cues.
   */
  function feed(prev, text, now) {
    const s = copy(prev || emptyCall());
    const flat = String(text || '').replace(/\s+/g, ' ');
    if (!flat.trim()) return s;
    const touch = () => { s.lastAt = now; };

    // 1. Votes. "MS. DUCKWORTH, AYE." also satisfies the bare-name pattern if
    //    the comma is ignored, which is why these go before the roll scan.
    // 0. The captioner's label: a call begins. The captioner types it again after a pause (five VOTE: labels in one 85-minute roll call), and the roll-up window repeats it for a few
    //    cues, so a label for the kind of call already running, heard within ten minutes of its last sign of life, is the same call. One just after a call ended is the window's echo.
    const labels = [...flat.matchAll(CALL_LABEL_RE)];
    if (labels.length) {
      const kind = /VOTE/.test(labels[labels.length - 1][1]) ? 'vote' : 'quorum';
      const running = s.callId && !s.ended && s.kind === kind && now - s.lastAt < LABEL_REPEAT_MS;
      const justEnded = s.ended && now - s.ended.at < GRACE_MS;
      if (running) touch();
      else if (!justEnded) { begin(s, kind, now); touch(); }
    }
    const latched = s.block && now - s.block.at < BLOCK_MS ? s.block.vote : null;
    const { votes, rollText, block } = readVotes(flat, latched);
    if (block) s.block = { vote: block, at: now };
    for (const [key, vote] of votes) {
      if (!key || NOT_A_MEMBER.has(key.replace(/ \([A-Z]{2}\)$/, ''))) continue;
      // Same answer again just after the tally is the caption window repeating
      // itself. Later than that, or a different answer, belongs to a new vote.
      if (s.ended && s.votes[key] === vote && now - s.ended.at < GRACE_MS) continue;
      if (s.ended) begin(s, 'vote', now);
      if (s.kind === null) begin(s, 'vote', now);
      // A quorum call that hears its first answer was a roll call vote all
      // along. Same call, so the same id; the names read so far meant nothing.
      if (s.kind === 'quorum') { s.kind = 'vote'; s.names = []; }
      s.votes[key] = vote;
      touch();
    }

    // 2. The tally ends a vote. It goes after the votes so a chunk carrying both
    //    is read in the order it was spoken. With no call at all (a reader that
    //    arrived mid-vote and missed every answer) it still means a vote happened.
    // The tally can arrive across cues: the window holds three lines, so "THE YEAS ARE 62." has scrolled off by the cue that says "THE NAYS ARE 21." (10 November 2026). The yeas are held a minute
    // for the nays; the outcome word ("THE MOTION IS ADOPTED.") can come a cue later too, and is added to a tally read within a minute.
    let tally = flat.match(TALLY_RE);
    const yeasOnly = flat.match(YEAS_RE), naysOnly = flat.match(NAYS_RE);
    if (!tally && yeasOnly) s.pendingYeas = { n: Number(yeasOnly[1]), at: now };
    if (!tally && naysOnly && s.pendingYeas && now - s.pendingYeas.at < 60_000) tally = [null, String(s.pendingYeas.n), naysOnly[1]];
    if (tally && !(s.ended && s.ended.how === 'closed')) {
      if (s.kind === null || s.ended) begin(s, 'vote', now);
      else if (s.kind === 'quorum') { s.kind = 'vote'; s.names = []; }
      const o = flat.match(OUTCOME_RE);
      s.ended = {
        how: 'closed', at: now, yeas: Number(tally[1]), nays: Number(tally[2]),
        outcome: o ? `${o[1] ? 'NOT ' : ''}${o[2].replace(/\s+/g, ' ')}` : null,
      };
      s.pendingYeas = null;
      touch();
    } else if (s.ended && s.ended.how === 'closed' && !s.ended.outcome && now - s.ended.at < 60_000) {
      const o = flat.match(OUTCOME_RE);
      if (o) s.ended = { ...s.ended, outcome: `${o[1] ? 'NOT ' : ''}${o[2].replace(/\s+/g, ' ')}` };
    }

    // 3. Vitiation ends a quorum call. It says nothing about a vote.
    // `how` stays 'vitiated' for either wording; `word` keeps the one actually said, since the majority
    // leader asks that "the order for the quorum call be rescinded" and a senator may say "vitiated".
    const vit = s.kind === 'quorum' && !s.ended ? VITIATE_RE.exec(flat) : null;
    if (vit) {
      s.ended = { how: 'vitiated', word: /RESCIND/.test(vit[0]) ? 'rescinded' : /LIFTED/.test(vit[0]) ? 'lifted' : /DISPENS/.test(vit[0]) ? 'dispensed' : 'vitiated', at: now };
      touch();
    }

    // 4. Names being read.
    const re = new RegExp(ROLL_RE.source, 'g');
    let m;
    while ((m = re.exec(rollText))) {
      const base = fold(m[1]);                       // the surname: ordering and "top of the alphabet"
      const key = keyOf(m[1], m[2]);                 // the surname, or SURNAME (ST) when the state was read
      if (!base || NOT_A_MEMBER.has(base)) continue;
      const top = base.charAt(0) < 'C';
      if (s.ended) {
        if (now - s.ended.at < GRACE_MS) continue;
        // Over for good. A sentence ending in a senator's name is not a new
        // call; the clerk returning to the top of the alphabet is.
        if (!top) continue;
        begin(s, 'quorum', now);
      } else if (s.kind === null) {
        begin(s, 'quorum', now);
      } else if ((s.kind !== 'vote' || now - s.lastAt > VOTE_PASS_MS) && s.lastRoll && base < s.lastRoll && s.lastRoll.charAt(0) > 'D' && top) {   // the clerk's second pass for senators who have not voted is the same vote
        // A real jump backwards. Adjacent names out of order would be a caption
        // stutter, not a new call, hence the guard.
        begin(s, 'quorum', now);
      }
      s.lastRoll = base;
      // During a vote the roll read says nothing about anyone, so it lights nothing.
      if (s.kind === 'quorum' && !s.names.includes(key)) s.names.push(key);
      touch();
    }

    // 5. The question, held until a vote claims it. Longer wins when the same
    //    question is seen again with more of it, since the window rolls.
    // The window rolls, so the segment holds the same sentence once per cue, each longer than the last: the LAST statement of the question is the one with all of it (the first cut off
    // mid-sentence, and taking it ran a question into the next speaker's words).
    const qs = [...flat.matchAll(new RegExp(QUESTION_RE.source, 'g'))].filter((x) => x[1].replace(/[?.,\s]+$/, '').trim().length >= 8);
    const q = qs.length ? qs[qs.length - 1] : null;
    if (q) {
      const text = q[1].replace(/\s+/g, ' ').replace(/[?.,\s]+$/, '').trim();
      const held = s.pendingQuestion && s.pendingQuestion.text;
      const sameStart = held && text.slice(0, 30) === held.slice(0, 30);
      if (text.length >= 8 && (!held || !sameStart || text.length > held.length)) {
        s.pendingQuestion = { text, at: now };
      }
    }
    // A finished vote still takes the question it was held under, but not one
    // stated after it closed: that is the next vote's.
    if (s.kind === 'vote' && s.pendingQuestion && now - s.pendingQuestion.at <= QUESTION_MS
        && (!s.ended || s.pendingQuestion.at <= s.ended.at)) {
      const held = s.question || '';
      const pq = s.pendingQuestion.text;
      if (!held || (pq.length > held.length && pq.slice(0, 30) === held.slice(0, 30))) s.question = pq;
    }

    // 6. Who has the floor. Not a call event, so it does not touch lastAt.
    //    A state named BEFORE the label in this chunk belongs to it; one named
    //    after it is held as a hint for the next label.
    const hit = lastLabel(flat);
    const states = [...flat.matchAll(STATE_RE)].map((x) => ({ at: x.index, abbr: STATES[x[1]] }));
    const before = hit && states.filter((x) => x.at < hit.at).pop();
    const after = states.filter((x) => !hit || x.at > hit.at).pop();
    if (after) s.stateHint = { abbr: after.abbr, at: now };
    if (hit && !(s.speaker && s.speaker.label === hit.label)) {
      const hint = before ? { abbr: before.abbr, at: now } : s.stateHint;
      const state = hint && now - hint.at <= STATE_HINT_MS ? hint.abbr : null;
      s.speaker = { label: hit.label, kind: hit.kind, at: now, ...(hit.kind === 'member' && state ? { state } : {}) };
      // Spent: it named this speaker and should not name the next one too.
      if (before || state) s.stateHint = null;
    }
    return s;
  }

  /** Drop a call whose ending was never heard. */
  function expire(s, now) {
    if (!s || !s.callId) return s;
    return now - s.lastAt > IDLE_MS ? { ...emptyCall(), history: s.history || [], speaker: s.speaker || null } : s;
  }

  /**
   * Two readers' views of the same stream: the Worker's and a tab's. Neither is
   * authoritative, so this takes whichever call is newer, and for the same call
   * takes everything either one saw, so neither can un-light a name.
   */
  function merge(a, b) {
    const out = { ...mergeCall(a, b) };
    // Who has the floor is independent of which call is newer: whichever reader
    // heard its label later has the more recent one.
    const sa = a && a.speaker, sb = b && b.speaker;
    out.speaker = !sa ? (sb || null) : !sb ? sa : (sb.at > sa.at ? sb : sa);
    const pa = a && a.pendingQuestion, pb = b && b.pendingQuestion;
    out.pendingQuestion = !pa ? (pb || null) : !pb ? pa : (pb.at > pa.at ? pb : pa);
    return out;
  }

  function mergeCall(a, b) {
    if (!b || !b.callId) return a || emptyCall();
    if (!a || !a.callId) return b;
    if (b.callId - a.callId > SAME_CALL_MS) return b;
    if (a.callId - b.callId > SAME_CALL_MS) return a;
    const s = copy(a);
    s.callId = Math.min(a.callId, b.callId);
    s.kind = a.kind === 'vote' || b.kind === 'vote' ? 'vote' : 'quorum';
    s.votes = { ...b.votes, ...a.votes };
    s.names = s.kind === 'vote' ? [] : [...new Set([...a.names, ...b.names])];
    s.ended = a.ended || b.ended || null;
    s.lastAt = Math.max(a.lastAt, b.lastAt);
    s.question = (a.question || '').length >= (b.question || '').length ? a.question : b.question;
    s.lastRoll = a.lastRoll >= b.lastRoll ? a.lastRoll : b.lastRoll;
    s.history = (a.history || []).length >= (b.history || []).length ? s.history : [...b.history];
    return s;
  }

  /** What a board needs to draw, with no reference to how it was learned. */
  function summarize(s) {
    const votes = Object.values(s.votes);
    const lit = s.kind === 'vote' ? votes.length : s.names.length;
    return {
      kind: s.kind,
      count: lit,
      ayes: votes.filter((v) => v === 'AYE').length,
      nos: votes.filter((v) => v === 'NO').length,
      present: votes.filter((v) => v === 'PRESENT').length,
      quorumMet: s.kind === 'quorum' && s.names.length >= QUORUM_REQUIRED,
      ended: s.ended,
      question: s.question,
    };
  }

  /**
   * The key each senator has in a call. A surname is the key, unless two senators share it (the Scotts),
   * when each is `SURNAME (ST)`: that is how the clerk's "Mr. SCOTT of Florida" is keyed. A caption that
   * gave only the surname is the bare key, which belongs to neither of them and to both of them at once:
   * `aliases` maps it to the keys it could be, so a board can show "one of these" and never light both as
   * if both had answered.
   *
   * Returns { keyOf(seat), aliases: Map<surname, [key, ...]> }.
   */
  function keyTable(seats) {
    const by = new Map();
    for (const s of seats || []) {
      const k = fold(s.last);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(s);
    }
    const key = new Map(), aliases = new Map();
    for (const [base, group] of by) {
      if (group.length === 1) { key.set(group[0], base); continue; }
      const keys = group.map((s) => `${base} (${s.state})`);
      group.forEach((s, i) => key.set(s, keys[i]));
      aliases.set(base, keys);
    }
    return { keyOf: (seat) => key.get(seat) || fold(seat && seat.last), aliases };
  }

  // The words of a WebVTT segment, as the readers take them: the header, the cue timings and the blank lines are not captions, and a timing such as "07:51:44.376 --> 07:51:44.442" run into the
  // text came out in a vote's question (found replaying the 10 November session).
  function cueText(vtt) {
    return String(vtt || '').replace(/\r/g, '').split('\n')
      .filter((l) => l.trim() && !/^WEBVTT\b/.test(l) && !/^X-TIMESTAMP-MAP=/.test(l) && !/^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+\d/.test(l.trim()) && !/^NOTE\b/.test(l))
      .join(' ');
  }

  // The cues of a WebVTT segment, one string each. The captioner's window rolls, so every cue is the whole window at that moment (the last three lines, a word longer than the one before);
  // the cues are read one at a time because run together the end of one is read as the start of the next ("YOUNG." from the next cue was counted under the heading before it).
  function cues(vtt) {
    const out = []; let cur = null;
    for (const raw of String(vtt || '').replace(/\r/g, '').split('\n')) {
      const l = raw.trim();
      if (/^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+\d/.test(l)) { if (cur && cur.length) out.push(cur.join(' ')); cur = []; continue; }
      if (cur && l) cur.push(l);
    }
    if (cur && cur.length) out.push(cur.join(' '));
    return out;
  }
  const feedVtt = (prev, vtt, now) => cues(vtt).reduce((s, c) => feed(s, c, now), prev || emptyCall());

  root.SenateCall = { emptyCall, feed, expire, merge, summarize, fold, keyTable, cueText, cues, feedVtt, QUORUM_REQUIRED, GRACE_MS, IDLE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateCall;
})(typeof globalThis !== 'undefined' ? globalThis : this);
