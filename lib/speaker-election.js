/**
 * The election of the Speaker, counted as it is read, from the House's live captions.
 *
 * WHY THIS FILE EXISTS
 * A Speaker is elected on the first day of a Congress (3 January 2027 for the 120th) by a roll call that is READ ALOUD, not an electronic vote: the Reading Clerk calls each Member's surname in
 * alphabetical order and the Member answers with the surname of the candidate they choose. The site's live vote panel reads DomeWatch's vote stream, which holds a yea/nay/present count by
 * party and has nothing for a vote by candidate, and the Clerk's roll file is posted only afterwards. The captions carry the roll as it happens, and that is all there is while it is read.
 *
 * WHAT THE CAPTIONS LOOK LIKE (3 January 2025, 434 members, test/speaker-election/captions-2025-01-03.vtt, verbatim)
 *
 *     THE ROLL NOW WILL BE CALLED. / AND THOSE RESPONDING TO THEIR NAMES WILL INDICATE BY SURNAME / THE NOMINEE OF THEIR CHOOSING.
 *     THE CHAIR: ADAMS.      JEFFRIES.      ADERHOLT.      JOHNSON.      AGUILAR.      JEFFRIES.      AMODEI OF NEVADA.      JOHNSON. ...
 *
 * One token per call and one per answer, in the order the stenographer typed them. What makes it hard, all seen in that file:
 *   - the names are garbled ("AWKEN CLAUS" for Auchincloss, "BEAR BEGAN" for Barragan, "BALANCEDDERSON -- BALDERSON" for Balderson), and a call can be missing altogether;
 *   - the cues are NOT in time order (a cue stamped 01:57:18 follows one stamped 01:59:14), so the file's order is used, not the stamps;
 *   - an answer and the next call can share a cue ("BARR, JOHNSON.");
 *   - the surname a Member answers with is often ALSO a Member's name (JOHNSON is a candidate and, in the roster, many Members), so a token is read by where it falls, not by what it is;
 *   - later, "MR. SELF IS RECORDED AS DONALDS" (a changed vote) and a second call for "THE REPRESENTATIVES ELECT WHO DID NOT ANSWER THE FIRST CALL".
 *
 * WHAT IT DOES, AND WHY IT COUNTS ANSWERS AND NOT MEMBERS
 * Matching each answer to the right Member failed on the garbles (327 of 434 placed, 324 right; placing the unmatched by alphabetical position was WORSE, 186 of 389). The count needs only HOW MANY
 * answers each candidate got, so an answer is counted when it follows any name token, matched or garbled: Johnson 214 of the true 218, Jeffries 209 of 215, Emmer 1 of 1 (423 of 434 heard).
 * Members are still matched where they can be, for the ticker of who answered last, and a Member is never claimed twice.
 *   - A candidate is a surname answered over and over (five times or more in the ballot); a write-in is a Member's surname that arrives far out of alphabetical order (EMMER, answered while the
 *     clerk is in the Ms).
 *   - The count is a FLOOR, like the Senate quorum board's: what was heard, and the tellers' announced totals replace it when read ("THE HONORABLE MIKE JOHNSON OF THE STATE OF LOUISIANA HAS
 *     RECEIVED 218"). The official roll (clerk.house.gov/evs/<year>/roll002.xml) replaces that, afterwards.
 *   - Repeat ballots (2023 took fifteen) are separate: a ballot is over when the tellers have announced and nobody is elected.
 */
(function (root) {
  'use strict';

  const START_RE = /\b(?:THE\s+ROLL\s+NOW\s+WILL\s+BE\s+CALLED|INDICATE\s+BY\s+SURNAME|READING\s+CLERK\s+WILL\s+NOW\s+CALL\s+THE\s+ROLL)\b/i;
  const SECOND_CALL_RE = /DID\s+NOT\s+ANSWER\s+THE\s+FIRST\s+CALL|WHO\s+DID\s+NOT\s+VOTE|HAVE\s+NOT\s+VOTED/i;
  const TELLERS_RE = /TELLERS\s+AGREE\s+ON\s+THEIR|TOTAL\s+NUMBER\s+OF\s+VOTES\s+CAST/i;
  const WORDS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10 };
  const LABEL_RE = /^(?:THE\s+CHAIR|THE\s+CLERK(?:\s+OF\s+THE\s+HOUSE)?|THE\s+READING\s+CLERK|CLERK|UNIDENTIFIED\s+SPEAKER)\s*:\s*/i;
  const MIN_CANDIDATE_VOTES = 5;      // a surname answered this many times in a ballot is a candidate
  const WRITE_IN_GAP = 12;            // a Member's surname this many places from the clerk's place in the roll is an answer, not a call

  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z' -]/g, ' ').replace(/\s+/g, ' ').trim();
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return Math.max(m, n);
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const similar = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

  // The tokens of the ballot: one string per spoken name or answer, labels and "OF <STATE>" kept for the state ("JOHNSON OF LOUISIANA" is a call; "JOHNSON" an answer).
  function tokensOf(cues) {
    const out = [];
    for (const cue of cues) {
      const text = String(cue.text || '').toUpperCase().replace(/--+/g, ' ').replace(LABEL_RE, '').replace(/\bMR\.|\bMRS\.|\bMS\.|\bDR\./g, ' ');
      for (const piece of text.split(/[.,;?!]/)) {
        const p = fold(piece);
        if (p) out.push(p);
      }
    }
    return out;
  }

  // Everything the roster lets the reader place a call: the surname, with the state when the clerk says it.
  function buildIndex(roster) {
    const sorted = roster.map((m, i) => ({ m, last: fold(m.last || m.lastDisplay), i })).sort((a, b) => (a.last < b.last ? -1 : a.last > b.last ? 1 : 0));
    return { sorted, pos: new Map(sorted.map((x, k) => [x.m, k])) };
  }
  function placeCall(base, index, near) {
    // exact surname first, then close spellings; among several (Smith, Johnson) the nearest to where the roll is
    let best = null;
    for (let k = 0; k < index.sorted.length; k++) {
      const x = index.sorted[k];
      const sc = x.last === base ? 1 : (Math.abs(x.last.length - base.length) <= 3 && x.last[0] === base[0]) ? similar(base, x.last) : 0;
      if (sc < 0.8) continue;
      const dist = near == null ? 0 : Math.abs(k - near);
      if (!best || sc > best.sc || (sc === best.sc && dist < best.dist)) best = { sc, k, x, dist };
    }
    return best;
  }

  const CAND_ALIASES = {};
  function read(cues, roster, opts) {
    const options = opts || {};
    const index = buildIndex(roster || []);
    const expected = (roster || []).length || null;

    // 1. the ballots: from the start phrase, in the file's order
    const ballots = [];
    let cur = null;
    cues.forEach((cue, i) => {
      const text = String(cue.text || '');
      if (START_RE.test(text) && (!cur || cur.announced)) { cur = { n: ballots.length + 1, from: i, to: cues.length, announced: null, second: null, cues: [] }; ballots.push(cur); }
      else if (cur && SECOND_CALL_RE.test(text) && cur.second == null) cur.second = cur.cues.length;
      if (cur) {
        cur.cues.push(cue);
        if (!cur.announced && cur.cues.length > 40 && TELLERS_RE.test(text)) cur.tellersAt = cur.cues.length - 1;
      }
    });

    return ballots.map((b) => finishBallot(b, index, expected, options));
  }

  function finishBallot(b, index, expected, options) {
    // the tellers' announcement ends the ballot's counting: the votes are the cues before it
    let end = b.cues.length;
    if (b.tellersAt != null) end = b.tellersAt;
    const ann = announcement(b.cues.slice(b.tellersAt != null ? b.tellersAt : b.cues.length));
    const toks = tokensOf(b.cues.slice(0, end));

    // 2. the candidates: surnames answered again and again. A first pass counts every token's frequency.
    const freq = new Map();
    toks.forEach((t) => { const base = t.replace(/ OF [A-Z ]+$/, ''); freq.set(base, (freq.get(base) || 0) + 1); });
    const cands = new Set([...freq.entries()].filter(([k, v]) => v >= MIN_CANDIDATE_VOTES && k.length > 2).map(([k]) => k));
    // a candidate named in the tellers' announcement is one even with few votes (a write-in): matched to the surname heard
    (ann.candidates || []).forEach((c) => { const last = fold(c.name).split(' ').pop(); if (last && freq.has(last)) cands.add(last); });
    const isCandidate = (base) => { if (cands.has(base)) return base; for (const c of cands) if (base.length > 3 && similar(base, c) >= 0.85) return c; return null; };

    // 3. the read: an answer is a candidate's surname following any other token; a Member's surname far from the clerk's place in the roll is a write-in answer
    const counts = new Map(); const recent = [];
    let prevAnswer = true, near = null, pendingMember = null, heard = 0;
    for (const t of toks) {
      const hadOf = / OF [A-Z ]+$/.test(t);
      const base = t.replace(/ OF [A-Z ]+$/, '');
      const cand = !hadOf ? isCandidate(base) : null;
      if (cand && !prevAnswer) {
        counts.set(cand, (counts.get(cand) || 0) + 1); heard++; prevAnswer = true;
        recent.push({ candidate: cand, member: pendingMember && pendingMember.m ? memberOut(pendingMember.m) : null }); pendingMember = null;
        continue;
      }
      if (cand && prevAnswer) continue;     // a repeat of the answer with no call between: the window stuttering
      const hit = placeCall(base, index, near);
      if (hit && !prevAnswer && near != null && Math.abs(hit.k - near) > WRITE_IN_GAP && !hadOf) {
        // out of alphabetical order, with a call waiting: an answer for a Member who is not (yet) a candidate: EMMER
        counts.set(base, (counts.get(base) || 0) + 1); heard++; prevAnswer = true;
        recent.push({ candidate: base, member: pendingMember && pendingMember.m ? memberOut(pendingMember.m) : null, writeIn: true }); pendingMember = null;
        continue;
      }
      prevAnswer = false;
      if (hit) { near = hit.k; pendingMember = hit.x; } else pendingMember = null;
    }

    const candidates = [...counts.entries()].map(([k, v]) => ({ key: k, display: k.charAt(0) + k.slice(1).toLowerCase(), votes: v })).sort((a, b) => b.votes - a.votes);
    return {
      n: b.n, startedAtCue: b.from, over: !!ann.total || !!ann.elected, heard, expected,
      majority: expected ? Math.floor(expected / 2) + 1 : null,
      candidates, recent: recent.slice(-8),
      second: b.second != null,
      announced: ann.total || ann.candidates.length ? ann : null,
    };
  }
  const memberOut = (m) => ({ bioguideId: m.bioguideId, last: m.lastDisplay || m.last, party: m.party, state: m.postal || m.state });

  // The tellers: "THE TOTAL NUMBER OF VOTES CAST IS 434 ... THE HONORABLE MIKE JOHNSON OF THE STATE OF LOUISIANA HAS RECEIVED 218. THE HONORABLE HAKEEM JEFFRIES OF THE STATE OF NEW YORK HAS
  // RECEIVED 215. AND THE HONORABLE TOM EMMER OF THE STATE OF MINNESOTA HAS RECEIVED ONE. THEREFORE, THE HONORABLE MIKE JOHNSON ... IS DULY ELECTED SPEAKER".
  function announcement(cues) {
    const text = cues.map((c) => String(c.text || '').replace(LABEL_RE, '')).join(' ').replace(/\s+/g, ' ').toUpperCase();
    const out = { total: null, candidates: [], elected: null };
    const tot = text.match(/TOTAL\s+NUMBER\s+OF\s+VOTES\s+CAST\s+IS\s+(\d{1,3})/);
    if (tot) out.total = Number(tot[1]);
    const re = /(?:THE\s+)?HONORABLE\s+([A-Z .'-]+?)\s+OF\s+(?:THE\s+STATE\s+OF\s+)?([A-Z ]+?),?\s+(?:HAS|HAVING)\s+RECEIVED\s+(\d{1,3}|[A-Z]+)/g;
    let m;
    while ((m = re.exec(text))) {
      const v = /^\d+$/.test(m[3]) ? Number(m[3]) : WORDS[m[3]];
      if (v != null) out.candidates.push({ name: m[1].replace(/\s+/g, ' ').trim(), state: m[2].trim(), votes: v });
    }
    const el = text.match(/HONORABLE\s+([A-Z .'-]+?)\s+OF\s+(?:THE\s+STATE\s+OF\s+)?[A-Z ]+?,?\s+HAVING\s+RECEIVED\s+A\s+MAJORITY[\s\S]{0,80}?DULY\s+ELECTED/);
    if (el) out.elected = el[1].replace(/\s+/g, ' ').trim();
    return out;
  }

  root.SpeakerElection = { read, tokensOf, announcement, fold, similar, MIN_CANDIDATE_VOTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SpeakerElection;
})(typeof globalThis !== 'undefined' ? globalThis : this);
