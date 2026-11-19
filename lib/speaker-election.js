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
  const CHANGES_RE = /\bIS\s+RECORDED\s+AS\b/i;          // "MR. SELF IS RECORDED AS DONALDS": the clerk reading back a vote a Member may now change. It follows the roll, so it ends the count.
  const TELLERS_RE = /TELLERS\s+AGREE\s+ON\s+THEIR|TOTAL\s+NUMBER\s+OF\s+VOTES\s+CAST/i;
  const WORDS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10 };
  const LABEL_RE = /^(?:THE\s+CHAIR|THE\s+CLERK(?:\s+OF\s+THE\s+HOUSE)?|THE\s+READING\s+CLERK|CLERK|UNIDENTIFIED\s+SPEAKER)\s*:\s*/i;
  // words the chair and clerk say between calls that could be mistaken for an answer or a Member's name
  const NOT_AN_ANSWER = new Set(['THE', 'ORDER', 'HOUSE', 'CHAIR', 'SPEAKER', 'CLERK', 'MEMBER', 'MEMBERS', 'GENTLEMAN', 'GENTLEWOMAN', 'GENTLELADY', 'SURNAME', 'PRESENT', 'RESPOND', 'ANSWER']);
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
  // memoized: the same garbled spelling is compared with the same surnames on every read (the Worker reads again as the roll goes on), and the edit distance is most of the work
  const SIM = new Map();
  const similar = (a, b) => {
    const key = a + '|' + b;
    let v = SIM.get(key);
    if (v === undefined) {
      if (SIM.size > 60000) SIM.clear();
      v = 1 - lev(a, b) / Math.max(a.length, b.length, 1);
      SIM.set(key, v);
    }
    return v;
  };

  // The tokens of the ballot: one string per spoken name or answer, labels and "OF <STATE>" kept for the state ("JOHNSON OF LOUISIANA" is a call; "JOHNSON" an answer).
  function tokensOf(cues) {
    const out = [];
    for (const cue of cues) {
      const text = String(cue.text || '').toUpperCase().replace(/--+/g, ' ').replace(LABEL_RE, '').replace(/\bMR\.|\bMRS\.|\bMS\.|\bDR\./g, ' ');
      for (const piece of text.split(/[.,;?!]/)) {
        const p = fold(piece);
        if (!p) continue;
        // "TURNER." then "OF OHIO.": the stenographer's line broke between the name and its state; they are one call
        if (/^OF [A-Z ]+$/.test(p) && out.length && !/ OF /.test(out[out.length - 1])) out[out.length - 1] += ' ' + p;
        else out.push(p);
      }
    }
    return out;
  }

  // Everything the roster lets the reader place a call: the surname, with the state when the clerk says it.
  function buildIndex(roster) {
    const sorted = roster.map((m, i) => ({ m, last: fold(m.last || m.lastDisplay), i })).sort((a, b) => (a.last < b.last ? -1 : a.last > b.last ? 1 : 0));
    sorted.forEach((x, k) => { x.k = k; });
    // by surname, and by first letter (a spelling is only compared with Members who start the same way): the Worker has a few milliseconds a request
    const byLast = new Map(), byFirst = new Map();
    for (const x of sorted) {
      (byLast.get(x.last) || byLast.set(x.last, []).get(x.last)).push(x);
      (byFirst.get(x.last[0]) || byFirst.set(x.last[0], []).get(x.last[0])).push(x);
    }
    return { sorted, byLast, byFirst, pos: new Map(sorted.map((x, k) => [x.m, k])) };
  }
  function placeCall(base, index, near, state) {
    // exact surname first, then close spellings; among several (Smith, Johnson) the nearest to where the roll is
    let best = null;
    const consider = (x, sc) => {
      const dist = near == null ? 0 : Math.abs(x.k - near);
      if (!best || sc > best.sc || (sc === best.sc && dist < best.dist)) best = { sc, k: x.k, x, dist };
    };
    // "TURNER OF TEXAS": only a Member of that state will do (two Turners, a Johnson from each of four states); none of that state in the roster means no Member, not the other one
    const postal = state ? STATE_POSTAL[fold(state)] : null;
    const inState = (x) => !postal || x.m.postal === postal;
    const exact = index.byLast.get(base);
    if (exact) for (const x of exact) if (inState(x)) consider(x, 1);
    for (const x of index.byFirst.get(base[0]) || []) {
      if (x.last === base || !inState(x)) continue;
      if (Math.abs(x.last.length - base.length) > 3) continue;
      const sc = similar(base, x.last);
      if (sc >= 0.8) consider(x, sc);
    }
    return best;
  }


  // WebVTT to cues, in the file's order (the stamps are not in order, so nothing sorts them): [{ start, end, text }], a cue's lines joined with a space.
  function parseVtt(text) {
    const out = [];
    for (const blk of String(text || '').split(/\r?\n\r?\n+/)) {
      const m = blk.match(/(\d+:\d+:\d+\.\d+|\d+:\d+\.\d+)\s+-->\s+(\d+:\d+:\d+\.\d+|\d+:\d+\.\d+)[^\n]*\r?\n([\s\S]*)/);
      if (m) out.push({ start: m[1], end: m[2], text: m[3].replace(/\r?\n/g, ' ').trim() });
    }
    return out;
  }

  const STATE_POSTAL = { ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY' };

  // Which Member a candidate is. A surname held by one Member is that Member; a shared one (Johnson, four of them) is told apart by the tellers' announcement ("MIKE JOHNSON OF LOUISIANA") once it is
  // read, and before that only when exactly one of them is in `leaders` (bioguide ids: the sitting Speaker and the party leaders, who are the usual nominees). Otherwise null: no face, never a guess.
  function memberFor(key, ann, roster, leaders, firsts) {
    const hits = (roster || []).filter((m) => fold(m.last || m.lastDisplay) === key);
    if (hits.length === 1) return hits[0];
    if (!hits.length) return null;
    const said = ((ann && ann.candidates) || []).find((c) => fold(c.name).split(' ').pop() === key);
    if (said) {
      const postal = STATE_POSTAL[fold(said.state)];
      const one = hits.filter((m) => m.postal === postal);
      if (one.length === 1) return one[0];
    }
    // the nominations, read before the roll, give a first name even when the surname is garbled ("THE HONORABLE MIKE JANUARYSON"): the one of the group who has it
    const named = hits.filter((m) => m.first && (firsts || []).includes(fold(m.first)));
    if (named.length === 1) return named[0];
    const lead = hits.filter((m) => (leaders || []).includes(m.bioguideId));
    return lead.length === 1 ? lead[0] : null;
  }


  // THE TELLERS: "THE CLERK APPOINTS THE FOLLOWING TELLERS, THE GENTLEWOMAN FROM NORTH CAROLINA, MS. FOXX, THE GENTLEMAN FROM NEW YORK, MR. MORELLE, ..." read before the roll. Each is named by state and
  // surname, so the state narrows the roster to a handful and a garbled surname ("MR. STYLE" for Steil) is still the nearest of them; one that matches none is kept as heard, with its state.
  function tellersFrom(preText, roster) {
    const at = preText.search(/APPOINTS\s+THE\s+FOLLOWING\s+TELLERS/i);
    if (at < 0) return [];
    const text = preText.slice(at).toUpperCase();
    const end = text.search(/TELLERS\s+WILL\s+COME\s+FORWARD/);
    const seg = end > 0 ? text.slice(0, end) : text.slice(0, 600);
    const out = [];
    const re = /GENTLE(?:MAN|WOMAN|LADY)\s+(?:FROM\s+)+([A-Z ]+?),?\s+(?:MR|MS|MRS|DR)\.?\s+([A-Z'-]+)/g;
    let m;
    while ((m = re.exec(seg)) && out.length < 8) {
      const state = m[1].replace(/\s+/g, ' ').trim();
      const heard = m[2];
      const postal = STATE_POSTAL[state];
      const pool = (roster || []).filter((x) => x.postal === postal);
      let best = null;
      for (const x of pool) {
        const last = fold(x.last || x.lastDisplay);
        const sc = last === heard ? 1 : similar(heard, last);
        if (!best || sc > best.sc) best = { sc, x };
      }
      const hit = best && (best.sc === 1 || (best.sc >= 0.4 && best.x.last[0] === heard[0])) ? best.x : null;
      out.push({ state: postal || state, heard, member: hit ? memberOut(hit) : null });
    }
    return out;
  }


  // A cue's time in seconds: the Time Machine's cues carry `t`, a parsed file `start` ("01:52:06.243").
  function cueSeconds(cue) {
    if (cue && Number.isFinite(cue.t)) return cue.t;
    const m = String((cue && cue.start) || '').match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
    return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null;
  }

  const CAND_ALIASES = {};
  function read(cues, roster, opts) {
    const options = opts || {};
    const index = buildIndex(roster || []);
    const expected = (roster || []).length || null;

    // 1. the ballots: from the start phrase, in the file's order
    const ballots = [];
    let cur = null;
    // first names the nominations give, from the cues before the first roll
    const firsts = [];
    const pre = [];
    for (const cue of cues) {
      const text = String(cue.text || '');
      if (START_RE.test(text)) break;
      pre.push(text);
    }
    // joined first: a name is split across cues ("AND THE HONORABLE MIKE" / "JANUARYSON FROM THE STATE OF")
    for (const m of fold(pre.join(' ')).matchAll(/\bHONORABLE ([A-Z]{3,}) [A-Z]{3,}/g)) firsts.push(m[1]);
    const tellers = tellersFrom(pre.join(' '), roster || []);
    cues.forEach((cue, i) => {
      const text = String(cue.text || '');
      // a ballot is over when the tellers have announced and nobody was elected; the next call of the roll is a new ballot
      const finished = cur && cur.tellersAt != null && !announcement(cur.cues.slice(cur.tellersAt)).elected;
      if (START_RE.test(text) && (!cur || finished)) { cur = { n: ballots.length + 1, from: i, to: cues.length, announced: null, second: null, firsts, tellers, cues: [] }; ballots.push(cur); }
      else if (cur && SECOND_CALL_RE.test(text) && cur.second == null) cur.second = cur.cues.length;
      if (cur) {
        cur.cues.push(cue);
        if (!cur.announced && cur.cues.length > 40 && TELLERS_RE.test(text)) cur.tellersAt = cur.cues.length - 1;
      }
    });

    // the latest time in the captions (the stamps are not in order, so not the last cue)
    let nowT = null;
    for (const c of cues) { const t = cueSeconds(c); if (t != null && (nowT == null || t > nowT)) nowT = t; }
    return ballots.map((b) => ({ ...finishBallot(b, index, expected, options), nowT }));
  }

  function finishBallot(b, index, expected, options) {
    // the tellers' announcement ends the ballot's counting: the votes are the cues before it
    let end = b.cues.length;
    if (b.tellersAt != null) end = b.tellersAt;
    // the vote changes come after the roll and its second call: what is read there is not another answer
    // (a read-back is split across cues, "...MR. NORMAN IS" / "RECORDED AS JORDAN", so each cue is tested with the next)
    const chg = b.cues.findIndex((c, i) => i < end && CHANGES_RE.test(String(c.text || '') + ' ' + String((b.cues[i + 1] || {}).text || '')));
    if (chg >= 0) end = chg;
    const ann = announcement(b.cues.slice(b.tellersAt != null ? b.tellersAt : b.cues.length));
    const toks = tokensOf(b.cues.slice(0, end));

    // 2. the candidates: surnames answered again and again. A first pass counts every token's frequency.
    const freq = new Map();
    // only the first pass down the alphabet, and a repeated token counted once: the second call names the same Members again, and a call repeated by the stenographer is one call
    const tail = new Set(index.sorted.slice(-6).map((x) => x.last));
    const lastAt = toks.findIndex((t) => tail.has(t.replace(/ OF [A-Z ]+$/, '')));
    toks.slice(0, lastAt >= 0 ? lastAt + 1 : toks.length).forEach((t, i, a) => {
      const base = t.replace(/ OF [A-Z ]+$/, '');
      if (i && a[i - 1].replace(/ OF [A-Z ]+$/, '') === base) return;
      freq.set(base, (freq.get(base) || 0) + 1);
    });
    const cands = new Set([...freq.entries()].filter(([k, v]) => v >= MIN_CANDIDATE_VOTES && k.length > 2).map(([k]) => k));
    // a candidate named in the tellers' announcement is one even with few votes (a write-in): matched to the surname heard
    // (NOT added to the set the roll is read with: a candidate who is also a Member is CALLED by his own surname, and reading that call as an answer swallowed the next real answer.
    // A write-in is found by its place in the roll instead, and the tellers' names are only used to say who the candidates are.)
    const surnames = new Set(index.sorted.map((x) => x.last));
    for (const w of NOT_AN_ANSWER) cands.delete(w);
    for (const k of [...cands]) if (surnames.size && !surnames.has(k) && ![...surnames].some((n) => n.length > 3 && similar(k, n) >= 0.85)) cands.delete(k);   // the chair's words ("THE", "ORDER") answered five times are not candidates
    const isCandidate = (base) => { if (cands.has(base)) return base; for (const c of cands) if (base.length > 3 && similar(base, c) >= 0.85) return c; return null; };

    // 3. the read: an answer is a candidate's surname following any other token; a Member's surname far from the clerk's place in the roll is a write-in answer
    const counts = new Map(); const recent = [];
    const claimed = new Set();
    let pendingText = null;   // the call as the captions have it, for an answer whose Member could not be placed
    let prevAnswer = true, near = null, pendingMember = null, heard = 0, passEnded = false;   // passEnded: the first pass down the alphabet is done; what follows is the second call, which has known candidates only
    for (const t of toks) {
      const hadOf = / OF [A-Z ]+$/.test(t);
      const base = t.replace(/ OF [A-Z ]+$/, '');
      const cand = !hadOf ? isCandidate(base) : null;
      if (cand && !prevAnswer) {
        counts.set(cand, (counts.get(cand) || 0) + 1); heard++; prevAnswer = true;
        if (pendingMember && pendingMember.m) claimed.add(pendingMember.m);
        recent.push({ candidate: cand, member: pendingMember && pendingMember.m ? memberOut(pendingMember.m) : null, heard: pendingMember && pendingMember.m ? null : pendingText }); pendingMember = null; pendingText = null;
        continue;
      }
      if (cand && prevAnswer) continue;     // a repeat of the answer with no call between: the window stuttering
      const hit = placeCall(base, index, near, hadOf ? (t.match(/ OF ([A-Z ]+)$/) || [])[1] : null);
      if (hit && hit.k >= index.sorted.length - 6 && !NOT_AN_ANSWER.has(base)) passEnded = true;
      if (hit && hit.sc === 1 && !passEnded && !NOT_AN_ANSWER.has(base) && !prevAnswer && near != null && Math.abs(hit.k - near) > WRITE_IN_GAP && !hadOf) {
        // out of alphabetical order, with a call waiting: an answer for a Member who is not (yet) a candidate: EMMER
        counts.set(base, (counts.get(base) || 0) + 1); heard++; prevAnswer = true;
        if (pendingMember && pendingMember.m) claimed.add(pendingMember.m);
        recent.push({ candidate: base, member: pendingMember && pendingMember.m ? memberOut(pendingMember.m) : null, heard: pendingMember && pendingMember.m ? null : pendingText, writeIn: true }); pendingMember = null; pendingText = null;
        continue;
      }
      prevAnswer = false;
      if (hit) {
        // a call heard again after its answer is the stenographer's repeat: the answer that follows belongs to a Member not yet placed, so nobody is named for it
        pendingMember = claimed.has(hit.x.m) ? null : hit.x;
        pendingText = null;
        near = hit.k;
      } else {
        pendingMember = null;
        // a call that matches no Member (a former Member, a garbled name) is kept as heard, unless it is the chair's words rather than a name
        const words = t.split(' ');
        if (/^OF /.test(t)) pendingText = pendingText ? `${pendingText} ${t}` : null;   // "DAVIDS, OF KANSAS": the state arrives as a token of its own, after the name
        else pendingText = words.length <= 4 && t.length >= 2 && t.length <= 28 && !words.some((w) => NOT_AN_ANSWER.has(w)) ? t : null;
      }
    }

    // THE VOTE CHANGES: "MR. NORMAN IS RECORDED AS JORDAN. ... MR. NORMAN. JOHNSON." moves that Member's vote from Jordan to Johnson (and "MR. SELF IS RECORDED AS DONALDS ... MR. SELF. JOHNSON."). Read on the
    // text joined, from the first read-back to the tellers, since the lines break anywhere.
    if (chg >= 0) {
      const tail = b.cues.slice(chg, b.tellersAt != null ? b.tellersAt : b.cues.length).map((c) => String(c.text || '').replace(LABEL_RE, '')).join(' ').toUpperCase().replace(/\s+/g, ' ');
      const re = /([A-Z]+) IS RECORDED AS ([A-Z]+)\.[\s\S]{0,200}?\b\1\.\s*([A-Z]+)\./g;
      let m;
      while ((m = re.exec(tail))) {
        const [, who, from, to0] = m;
        const to = isCandidate(to0) || to0;
        const old = isCandidate(from) || from;
        if (NOT_AN_ANSWER.has(to) || to === old) continue;
        if (counts.get(old) > 0) { counts.set(old, counts.get(old) - 1); if (!counts.get(old)) counts.delete(old); }
        counts.set(to, (counts.get(to) || 0) + 1);
        const hits = index.byLast.get(who) || [];
        recent.push({ candidate: to, member: hits.length === 1 ? memberOut(hits[0].m) : null, heard: hits.length === 1 ? null : who, changed: true });
      }
    }

    const candidates = [...counts.entries()].map(([k, v]) => {
      const m = memberFor(k, ann, index.sorted.map((x) => x.m), options.leaders, b.firsts);
      const display = k.charAt(0) + k.slice(1).toLowerCase();
      return { key: k, display, votes: v, member: m ? { ...memberOut(m), name: [m.first, m.lastDisplay || m.last].filter(Boolean).join(' ') || display } : null };
    }).sort((a, b) => b.votes - a.votes);
    return {
      n: b.n, startedAtCue: b.from, over: !!ann.total || !!ann.elected, heard: expected ? Math.min(heard, expected) : heard, expected,
      majority: expected ? Math.floor(expected / 2) + 1 : null,
      candidates, recent: recent.slice(-8), tellers: b.tellers || [],
      // when the winner was declared (the cue's time in seconds), so a panel can step aside once the election is well over
      electedT: (() => { const at = b.cues.findIndex((c, i) => i >= (b.tellersAt || 0) && /DULY\s+ELECTED/i.test(String(c.text || ''))); return at >= 0 ? cueSeconds(b.cues[at]) : null; })(),
      second: b.second != null,
      announced: ann.total || ann.candidates.length ? ann : null,
    };
  }
  const memberOut = (m) => ({ bioguideId: m.bioguideId, last: m.lastDisplay || m.last, party: m.party, state: m.postal || m.state });

  // The tellers: "THE TOTAL NUMBER OF VOTES CAST IS 434 ... THE HONORABLE MIKE JOHNSON OF THE STATE OF LOUISIANA HAS RECEIVED 218. THE HONORABLE HAKEEM JEFFRIES OF THE STATE OF NEW YORK HAS
  // RECEIVED 215. AND THE HONORABLE TOM EMMER OF THE STATE OF MINNESOTA HAS RECEIVED ONE. THEREFORE, THE HONORABLE MIKE JOHNSON ... IS DULY ELECTED SPEAKER".
  function announcement(cues) {
    const text = cues.map((c) => String(c.text || '').replace(LABEL_RE, '')).join(' ').replace(/\s+/g, ' ').toUpperCase();
    const out = { total: null, candidates: [], elected: null, complete: false };
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
    // The announcement arrives over a minute or more, candidate by candidate. It is COMPLETE when the winner is declared, when the announced counts account for the total, or when the House
    // is told there will be another ballot; until then each count read so far is final and the rest are not.
    const sum = out.candidates.reduce((a, c) => a + c.votes, 0);
    // (counts that add up to the total finish it only when nobody has a majority: when someone does, the winner is declared a few seconds later, and "no majority" must not be shown in between)
    const need = out.total != null ? Math.floor(out.total / 2) + 1 : null;
    const someMajority = need != null && out.candidates.some((c) => c.votes >= need);
    out.complete = !!out.elected || (out.total != null && out.candidates.length > 0 && sum >= out.total && !someMajority) || /NO\s+CANDIDATE|NOT\s+(?:HAVING\s+)?RECEIVED\s+A\s+MAJORITY|ANOTHER\s+BALLOT|SECOND\s+BALLOT|NEXT\s+BALLOT/.test(text);
    return out;
  }

  // a quick test on the raw file, before it is parsed: has the roll been called yet?
  const hasRoll = (text) => START_RE.test(String(text || ''));

  root.SpeakerElection = { read, parseVtt, hasRoll, tellersFrom, tokensOf, announcement, memberFor, fold, similar, MIN_CANDIDATE_VOTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SpeakerElection;
})(typeof globalThis !== 'undefined' ? globalThis : this);
