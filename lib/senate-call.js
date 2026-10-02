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
  const NOT_A_MEMBER = new Set(['PRESIDENT', 'SPEAKER', 'CHAIRMAN', 'CHAIRWOMAN', 'CHAIR', 'CLERK', 'LEADER', 'SECRETARY', 'PARLIAMENTARIAN']);

  const NAME = String.raw`([A-Z][A-Z'’-]{1,24}(?:\s+[A-Z][A-Z'’-]{1,24})?)`;
  // A name being CALLED ends in a period; a member taking the floor ends in a colon.
  const ROLL_RE = new RegExp(String.raw`\b(?:MR|MRS|MS)\.\s+${NAME}\s*\.`, 'g');
  // Only AYE has been seen. NO, NAY and PRESENT are on the shape of the pattern.
  const VOTE_RE = new RegExp(String.raw`\b(?:MR|MRS|MS)\.\s+${NAME}\s*,\s*(AYE|YEA|NO|NAY|PRESENT)\b`, 'g');
  // The AYE heading is observed; the negative wording is GUESSED and unconfirmed.
  // The heading needs VOTING. "No Senator VOTED in the negative" is a running
  // tally, one letter away, and loosening this inverts results silently.
  const HEAD_RE = /\bSENATORS?\s+VOTING\s+(?:IN\s+THE\s+)?(AFFIRMATIVE|NEGATIVE|AYE|YEA|NAY|NO|PRESENT)\b/g;
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
  // announcement that follows it, or the end of the cue if the window cut it off.
  const QUESTION_RE = /\bTHE\s+QUESTION\s+IS,?\s+([\s\S]{8,400}?)(?=\s+(?:THE\s+YEAS\s+AND\s+NAYS|THE\s+CLERK\s+WILL\s+CALL|IS\s+THERE\s+A\s+SUFFICIENT\s+SECOND)\b|$)/;
  // A question and the roll that follows are minutes apart at most; one older
  // than this belongs to something else.
  const QUESTION_MS = 15 * 60 * 1000;

  const VITIATE_RE = /(QUORUM\s+CALL[\s\S]{0,60}?(VITIAT|RESCIND))|((VITIAT|RESCIND)[A-Z]*[\s\S]{0,60}?QUORUM\s+CALL)/;

  // Senate floor address, as the stenographer types it. A member taking the floor
  // ends in a COLON, which is what tells it from a name being read.
  const MEMBER_RE = /\b(?:MR|MRS|MS|SEN|SENATOR)\.?\s+([A-Z][A-Z'’-]{1,24}(?:\s+[A-Z][A-Z'’-]{1,24})?)\s*:/g;
  const OFFICE_RE = /\b(THE\s+(?:PRESIDING\s+OFFICER|PRESIDENT\s+PRO\s+TEMPORE|ACTING\s+PRESIDENT\s+PRO\s+TEMPORE|CLERK|MAJORITY\s+LEADER|MINORITY\s+LEADER|CHAIR))\s*:/g;

  // Two senators can share a surname (the Scotts of Florida and South Carolina),
  // and the caption label carries only the surname. What disambiguates is the
  // chair, who recognises by state: "THE SENATOR FROM FLORIDA." comes before the
  // label, and in the Record a member is written "Mr. SCOTT of Florida".
  const STATES = {'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR', 'CALIFORNIA': 'CA', 'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE', 'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI', 'IDAHO': 'ID', 'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA', 'KANSAS': 'KS', 'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD', 'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS', 'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH', 'OKLAHOMA': 'OK', 'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT', 'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV', 'WISCONSIN': 'WI', 'WYOMING': 'WY'};
  const STATE_RE = new RegExp('\\b(?:SENATORS?\\s+FROM|OF)\\s+(' + Object.keys(STATES).sort((a, b) => b.length - a.length).join('|') + ')\\b', 'g');
  // A recognition and the label that follows it are seconds apart, and the label
  // can land in the next cue. Held this long, then forgotten: a state named in
  // passing a minute ago is not who is speaking now.
  const STATE_HINT_MS = 45 * 1000;

  // Diacritics folded: the roster says Luján, the captions say LUJAN.
  const fold = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

  const emptyCall = () => ({
    callId: null, kind: null, names: [], votes: {}, lastRoll: '', lastAt: 0, ended: null, history: [], speaker: null, stateHint: null, question: null, pendingQuestion: null,
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
      ended: s.ended ? { how: s.ended.how, at: s.ended.at } : null,
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
  function readVotes(flat) {
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
      while ((r = re.exec(chunk))) out.push([fold(r[1]), mk.vote]);
    });
    const re = new RegExp(VOTE_RE.source, 'g');
    let m;
    while ((m = re.exec(flat))) out.push([fold(m[1]), m[2] === 'YEA' ? 'AYE' : m[2] === 'NAY' ? 'NO' : m[2]]);
    // Bare names under a heading are a block and are not roll reads: cut the
    // text off at the first heading.
    return { votes: out, rollText: marks.length ? flat.slice(0, marks[0].start) : flat };
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
    const { votes, rollText } = readVotes(flat);
    for (const [key, vote] of votes) {
      if (!key || NOT_A_MEMBER.has(key)) continue;
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
    const tally = flat.match(TALLY_RE);
    if (tally && !(s.ended && s.ended.how === 'closed')) {
      if (s.kind === null || s.ended) begin(s, 'vote', now);
      else if (s.kind === 'quorum') { s.kind = 'vote'; s.names = []; }
      const o = flat.match(OUTCOME_RE);
      s.ended = {
        how: 'closed', at: now, yeas: Number(tally[1]), nays: Number(tally[2]),
        outcome: o ? `${o[1] ? 'NOT ' : ''}${o[2].replace(/\s+/g, ' ')}` : null,
      };
      touch();
    }

    // 3. Vitiation ends a quorum call. It says nothing about a vote.
    if (s.kind === 'quorum' && !s.ended && VITIATE_RE.test(flat)) {
      s.ended = { how: 'vitiated', at: now };
      touch();
    }

    // 4. Names being read.
    const re = new RegExp(ROLL_RE.source, 'g');
    let m;
    while ((m = re.exec(rollText))) {
      const key = fold(m[1]);
      if (!key || NOT_A_MEMBER.has(key)) continue;
      const top = key.charAt(0) < 'C';
      if (s.ended) {
        if (now - s.ended.at < GRACE_MS) continue;
        // Over for good. A sentence ending in a senator's name is not a new
        // call; the clerk returning to the top of the alphabet is.
        if (!top) continue;
        begin(s, 'quorum', now);
      } else if (s.kind === null) {
        begin(s, 'quorum', now);
      } else if (s.lastRoll && key < s.lastRoll && s.lastRoll.charAt(0) > 'D' && top) {
        // A real jump backwards. Adjacent names out of order would be a caption
        // stutter, not a new call, hence the guard.
        begin(s, 'quorum', now);
      }
      s.lastRoll = key;
      // During a vote the roll read says nothing about anyone, so it lights nothing.
      if (s.kind === 'quorum' && !s.names.includes(key)) s.names.push(key);
      touch();
    }

    // 5. The question, held until a vote claims it. Longer wins when the same
    //    question is seen again with more of it, since the window rolls.
    const q = flat.match(QUESTION_RE);
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

  root.SenateCall = { emptyCall, feed, expire, merge, summarize, fold, QUORUM_REQUIRED, GRACE_MS, IDLE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateCall;
})(typeof globalThis !== 'undefined' ? globalThis : this);
