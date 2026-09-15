/**
 * Who is speaking on the House floor, derived from the Clerk's live captions.
 *
 * WHY THIS FILE EXISTS
 * The House publishes a live WebVTT caption file for every broadcast, and it
 * labels every single speaker turn with the literal string
 *
 *     UNIDENTIFIED SPEAKER:
 *
 * — 795 times on 2026-09-14, 230 times on 2026-09-03, with no other label ever
 * appearing. The label carries zero identity. The floor camera carries no
 * chyron either, so there is nothing to OCR.
 *
 * What the label IS good for is diarisation: a human stenographer inserts it at
 * every speaker change, live, for free. So turn boundaries are solved and the
 * only open problem is putting a name on each turn.
 *
 * The names live in the parliamentary ritual, in five shapes of decreasing use:
 *
 *   1. "PURSUANT TO THE RULE, THE GENTLEMAN FROM ARKANSAS, MR. WESTERMAN, AND
 *       THE GENTLEWOMAN FROM OREGON, MS. HOYLE, EACH WILL CONTROL 20 MINUTES"
 *      — names BOTH floor managers at the top of every suspension bill. This is
 *        the line that unlocks the whole debate: it binds state -> person, and
 *        every later "THE GENTLEMAN FROM ARKANSAS IS RECOGNIZED" resolves off it.
 *   2. "I YIELD SUCH TIME AS HE MAY CONSUME TO THE GENTLEMAN FROM CALIFORNIA,
 *       THE LEAD SPONSOR OF THE BILL, MR. MCCLINTOCK"  — names the next speaker.
 *   3. "THE GENTLEMAN FROM TEXAS, MR. GREEN, IS RECOGNIZED FOR 60 MINUTES AS THE
 *       DESIGNEE OF THE MINORITY LEADER"                — special-order hours.
 *   4. "THE GENTLEMAN FROM VIRGINIA IS RECOGNIZED"      — state only.
 *   5. "WITHOUT OBJECTION, THE GENTLEMAN IS RECOGNIZED" — nothing at all.
 *
 * TWO THINGS THE CAPTIONS GET WRONG, BOTH LOAD-BEARING
 *
 * Surnames are garbled constantly. Observed, verbatim, in two days of captions:
 * KEELEY (Kiley), MORELLI (Morelle), WHITMAN (Wittman), FOX (Foxx),
 * SUBRAMANIAM (Subramanyam). Never match a caption surname exactly — always
 * fuzzy-match it into the roster, scoped by state, which cuts the candidate pool
 * from 441 people to between 1 and ~50 and recovers every one of those.
 *
 * The gender word is ALSO wrong, often. Today's captions said "THE GENTLEMAN
 * FROM MARYLAND, MS. ELFRETH" (she is a gentlewoman) and, one turn apart,
 * "GENTLEMAN FROM MICHIGAN SEEK RECOGNITION? ... THE GENTLEWOMAN IS RECOGNIZED".
 * So gentleman/gentlewoman is NEVER a filter here, only a weak tiebreaker when
 * two same-state members fuzzy-match equally well.
 *
 * LOADING
 * Same globalThis convention as lib/bill-id.js, for the same reason: worker.js
 * pulls it in with a side-effect `import './lib/floor-speaker.js'` and esbuild
 * inlines it; a browser could load it as a plain <script>. No export syntax.
 */
(function (root) {
  'use strict';

  // ── Roster ────────────────────────────────────────────────────────────────
  // Parsed out of the Clerk's MemberData.xml. Regex rather than a DOM parse
  // because Workers has no DOMParser and the shape of this file is stable.
  function buildRoster(xmlText) {
    const roster = [];
    if (typeof xmlText !== 'string') return roster;
    const memberRe = /<member>([\s\S]*?)<\/member>/g;
    let m;
    while ((m = memberRe.exec(xmlText)) !== null) {
      const b = m[1];
      const pick = (tag) => {
        const hit = b.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
        return hit ? hit[1].trim() : '';
      };
      const last = pick('lastname');
      if (!last) continue;
      const postal = (b.match(/<state postal-code="([A-Z]{2})"/) || [])[1] || '';
      roster.push({
        bioguideId: pick('bioguideID'),
        // `last` is the matching key and must stay upper-case: the captions are
        // all-caps, and every comparison in here is against that. `lastDisplay`
        // is the Clerk's own casing, and is the ONLY one that should reach a page
        // — "Bruce WESTERMAN" is what you get if you render the key.
        last: last.toUpperCase(),
        lastDisplay: last,
        first: pick('firstname'),
        state: pick('state-fullname').toUpperCase(),
        postal,
        party: pick('caucus') || pick('party'),
        courtesy: pick('courtesy'),
      });
    }
    return roster;
  }

  // ── Fuzzy surname matching ────────────────────────────────────────────────
  // Levenshtein, capped: the caption garbles are all 1–3 edits away
  // (FOX->FOXX is 1, KEELEY->KILEY is 2, SUBRAMANIAM->SUBRAMANYAM is 2).
  function editDistance(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = cur;
    }
    return prev[n];
  }

  // Allowed edits scale with name length so short names stay strict: a 3-letter
  // surname must be exact-ish, or "FOX" would happily become "COX".
  function allowedEdits(len) {
    if (len <= 4) return 1;
    if (len <= 7) return 2;
    return 3;
  }

  function matchSurname(surname, stateFullName, roster, gender) {
    if (!surname) return null;
    const needle = surname.toUpperCase().replace(/[^A-Z-]/g, '');
    if (needle.length < 3) return null;

    const inState = stateFullName
      ? roster.filter((r) => r.state === stateFullName)
      : [];
    const pools = inState.length ? [inState, roster] : [roster];

    for (let p = 0; p < pools.length; p++) {
      const pool = pools[p];
      // Searching the whole roster means either no state was given or the
      // caption's state word was itself garbled. Either way the pool is 441 people
      // instead of a handful, so demand a much closer name — and for a short
      // surname, an exact one. "FOX" sits one edit from both FOXX and COX, and
      // only the state tells them apart; with no state the honest answer is none.
      const national = !inState.length || p > 0;
      const cap = national ? (needle.length <= 4 ? 0 : 1) : allowedEdits(needle.length);
      let best = null, bestD = Infinity, tie = false;
      for (const r of pool) {
        const d = editDistance(needle, r.last);
        if (d > cap) continue;
        if (d < bestD) { best = r; bestD = d; tie = false; }
        else if (d === bestD) { tie = true; if (gender && genderOf(r) === gender && genderOf(best) !== gender) { best = r; tie = false; } }
      }
      // An unbroken tie between two same-state members is a genuine ambiguity —
      // report nothing rather than coin-flip a member's name onto a speech.
      if (best && !tie) return { member: best, distance: bestD, scope: national ? 'national' : 'state' };
    }
    return null;
  }

  function genderOf(r) {
    if (!r) return null;
    return /^(MRS|MS|MISS)\.?$/i.test(r.courtesy || '') ? 'F' : 'M';
  }

  // ── WebVTT ────────────────────────────────────────────────────────────────
  function parseCaptionCues(vttText) {
    const cues = [];
    if (typeof vttText !== 'string') return cues;
    const lines = vttText.replace(/^﻿/, '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\d\d):(\d\d):(\d\d)\.(\d\d\d)\s+-->/);
      if (!m) continue;
      const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
      const text = [];
      i++;
      while (i < lines.length && lines[i].trim()) { text.push(lines[i].trim()); i++; }
      cues.push({ t, text: text.join(' ') });
    }
    return cues;
  }

  // Every "UNIDENTIFIED SPEAKER:" is a stenographer-marked speaker change.
  // A cue can contain more than one, so split inside cues too.
  function splitTurns(cues) {
    const turns = [];
    let cur = [], start = null;
    for (const cue of cues) {
      const parts = cue.text.split(/UNIDENTIFIED SPEAKER:/);
      for (let k = 0; k < parts.length; k++) {
        if (k > 0) {
          if (cur.length) turns.push({ t: start, text: cur.join(' ').trim() });
          cur = []; start = cue.t;
        }
        const p = parts[k].trim();
        if (p) {
          if (start === null) start = cue.t;
          cur.push(p);
        }
      }
    }
    if (cur.length) turns.push({ t: start, text: cur.join(' ').trim() });
    return turns.filter((x) => x.text);
  }

  // ── Patterns ──────────────────────────────────────────────────────────────
  // The state alternation is built from the roster so territories ("VIRGIN
  // ISLANDS", "PUERTO RICO", "DISTRICT OF COLUMBIA") come along for free and
  // stay in sync with the Clerk. Longest-first so "WEST VIRGINIA" is never
  // partially matched as "VIRGINIA" — the alternation is order-sensitive, the
  // same trap lib/bill-id.js documents for bill prefixes.
  function statePattern(roster) {
    const names = Array.from(new Set(roster.map((r) => r.state).filter(Boolean)));
    // The stenographer writes the Virgin Islands three different ways in a
    // single afternoon; accept the variants the Clerk's own spelling misses.
    names.push('U.S. VIRGIN ISLANDS', 'THE U.S. VIRGIN ISLANDS', 'THE VIRGIN ISLANDS');
    names.sort((a, b) => b.length - a.length);
    return names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  }

  function canonicalState(raw, roster) {
    if (!raw) return '';
    const up = raw.toUpperCase().replace(/^THE\s+/, '').replace(/^U\.S\.\s+/, '');
    const hit = roster.find((r) => r.state === up);
    if (hit) return hit.state;
    const loose = roster.find((r) => r.state && up.indexOf(r.state) !== -1);
    return loose ? loose.state : up;
  }

  const HON = "(?:MR\\.|MRS\\.|MS\\.|MISS|DOCTOR|DR\\.|CONGRESSMAN|CONGRESSWOMAN|REPRESENTATIVE)";

  function buildPatterns(roster) {
    const ST = statePattern(roster);
    const GENT = '(?:GENTLE\\w+|MEMBER)';
    return {
      // "THE GENTLEMAN FROM ARKANSAS, MR. WESTERMAN, AND THE GENTLEWOMAN FROM
      //  OREGON, MS. HOYLE, EACH WILL CONTROL 20 MINUTES"
      control: new RegExp(
        GENT + '\\s+FROM\\s+(' + ST + ')\\s*,?\\s*' + HON + '\\s+([A-Z][A-Z\'\u2019-]{2,})' +
        '[\\s\\S]{0,120}?' + GENT + '\\s+FROM\\s+(' + ST + ')\\s*,?\\s*' + HON + '\\s+([A-Z][A-Z\'\u2019-]{2,})' +
        '[\\s\\S]{0,80}?(?:EACH\\s+WILL\\s+CONTROL|WILL\\s+EACH\\s+CONTROL)', 'i'),
      // Any "GENTLEMAN FROM <state>[, optional appositive,] MR. <NAME>".
      // The appositive ("THE LEAD SPONSOR OF THE BILL,") is why the gap is loose.
      bind: new RegExp(
        GENT + '\\s+FROM\\s+(' + ST + ')\\s*[,.]?\\s*(?:THE\\s+[A-Z][A-Z\\s]{2,50}[,.]\\s*)?' +
        HON + '\\s+([A-Z][A-Z\'\u2019-]{2,})', 'g'),
      recognized: new RegExp(GENT + '\\s+FROM\\s+(' + ST + ')\\b[^.]{0,60}?IS\\s+(?:NOW\\s+)?RECOGNIZED', 'i'),
      chairRecognizes: new RegExp('CHAIR\\s+RECOGNIZES\\s+THE\\s+' + GENT + '\\s+FROM\\s+(' + ST + ')', 'i'),
      bareRecognized: /(?:^|\W)(?:THE\s+)?GENTLE\w+\s+IS\s+(?:NOW\s+)?RECOGNIZED/i,
      purpose: new RegExp('(?:FOR\\s+WHAT\\s+PURPOSE|FOR\\s+PURPOSES?)[\\s\\S]{0,40}?' + GENT + '\\s+FROM\\s+(' + ST + ')', 'i'),
      // Chair-only bookkeeping. A member says "I RESERVE"; the chair says
      // "THE GENTLEMAN RESERVES" — that third person is the whole distinction.
      chair: new RegExp(
        'FOR\\s+WHAT\\s+PURPOSE|FOR\\s+PURPOSES?\\b|WITHOUT\\s+OBJECTION|' +
        GENT + '\\s+FROM\\s+(?:' + ST + ')\\b[^.]{0,60}?IS\\s+(?:NOW\\s+)?RECOGNIZED|' +
        '(?:THE\\s+)?GENTLE\\w+\\s+IS\\s+(?:NOW\\s+)?RECOGNIZED|' +
        '(?:THE\\s+)?GENTLE\\w+\\s+(?:FROM\\s+(?:' + ST + ')\\s+)?(?:YIELDS|RESERVES)|' +
        'THE\\s+CHAIR\\b|CLERK\\s+WILL\\s+REPORT|THE\\s+QUESTION\\s+IS|PURSUANT\\s+TO\\s+THE\\s+RULE|' +
        'SEEK\\s+RECOGNITION|RULES\\s+ARE\\s+SUSPENDED|TIME\\s+HAS\\s+EXPIRED|' +
        "UNDER\\s+THE\\s+SPEAKER'?S\\s+ANNOUNCED\\s+POLICY", 'i'),
      expired: /TIME\s+HAS\s+EXPIRED|YIELDS\s+BACK|YIELDED\s+BACK/i,
      // The chair often trails off: a turn that is nothing but "GENTLEMAN FROM
      // OREGON." is the chair handing over, not a member speaking. Without this
      // the previous speaker keeps the floor across the hand-off.
      shortHandoff: new RegExp('^(?:THE\\s+)?' + GENT + '\\s+FROM\\s+(' + ST + ')\\s*[.,]?$', 'i'),
      // A member addressing the chair. "MR. SPEAKER, I ASK UNANIMOUS CONSENT..."
      // contains "WITHOUT OBJECTION" whenever the stenographer merges the chair's
      // interjection into the member's turn, which would otherwise flip the whole
      // turn to 'chair' and lose the speaker.
      selfAddress: /^(?:THANK\s+YOU[,.]?\s+)?(?:MR\.|MADAM|MADAME)\s+SPEAKER\b/i,
      // The reading clerk, not a member. Fires on the turn after "THE CLERK WILL
      // REPORT THE TITLE OF THE BILL".
      clerkReading: /^(?:UNION\s+CALENDAR|CALENDAR\s+NO|NUMBER\s+\d|H\.\s?R\.\s?\d|A\s+BILL\s+TO)/i,
      newMeasure: /MOVE\s+TO\s+SUSPEND\s+THE\s+RULES|CLERK\s+WILL\s+REPORT\s+THE\s+TITLE|PURSUANT\s+TO\s+THE\s+RULE/i,
    };
  }

  // ── The resolver ──────────────────────────────────────────────────────────
  // A deterministic state machine over the turn list. It deliberately reports
  // "unknown" rather than guessing: a wrong name attached to a floor speech is
  // far worse than a blank, and the blanks are exactly what a model (or the next
  // morning's Congressional Record) is for.
  function resolveFloorSpeakers(turns, roster, opts) {
    const P = buildPatterns(roster);
    const options = opts || {};
    const stateCounts = {};
    for (const r of roster) stateCounts[r.state] = (stateCounts[r.state] || 0) + 1;

    let bind = {};          // state -> member, reset at each new measure
    let floor = null;       // member the chair last handed the floor to
    let floorBasis = null;
    let pending = null;     // { member, state } named by a yielder, not yet recognised
    let purposeState = null;
    let carried = 0;        // speech turns since the last explicit recognition

    const bindFrom = (text) => {
      P.bind.lastIndex = 0;
      let m, found = null;
      while ((m = P.bind.exec(text)) !== null) {
        const st = canonicalState(m[1], roster);
        const hit = matchSurname(m[2], st, roster);
        if (hit) { bind[st] = hit.member; found = { member: hit.member, state: st }; }
      }
      return found;
    };

    const timeline = [];
    let clerkNext = false;
    for (const turn of turns) {
      const text = turn.text;

      // The reading clerk announces the title between the motion and the debate.
      // Attributing that to whichever member last held the floor is the single
      // most visible error this resolver can make, so it is checked first.
      if (clerkNext && P.clerkReading.test(text)) {
        clerkNext = false;
        timeline.push({ t: turn.t, role: 'clerk', member: null, basis: 'clerk-reading', confidence: null, text });
        continue;
      }
      clerkNext = false;

      const isChair = P.shortHandoff.test(text) ||
        (P.chair.test(text) && !P.selfAddress.test(text));

      if (isChair) {
        if (/CLERK\s+WILL\s+REPORT/i.test(text)) clerkNext = true;
        const sh = P.shortHandoff.exec(text);
        if (sh) {
          const st = canonicalState(sh[1], roster);
          if (bind[st]) { floor = bind[st]; floorBasis = 'manager-binding'; }
          else if (stateCounts[st] === 1) { floor = roster.find((r) => r.state === st); floorBasis = 'sole-delegate'; }
          else { floor = null; floorBasis = 'state-only'; purposeState = st; }
          carried = 0;
          timeline.push({ t: turn.t, role: 'chair', member: null, basis: null, confidence: null, text });
          continue;
        }
        const ctl = P.control.exec(text);
        if (ctl) {
          bind = {};                        // new measure: previous managers are done
          pending = null;
          for (const [rawSt, name] of [[ctl[1], ctl[2]], [ctl[3], ctl[4]]]) {
            const st = canonicalState(rawSt, roster);
            const hit = matchSurname(name, st, roster);
            if (hit) bind[st] = hit.member;
          }
        } else {
          bindFrom(text);
        }

        const pm = P.purpose.exec(text);
        if (pm) purposeState = canonicalState(pm[1], roster);

        const rec = P.chairRecognizes.exec(text) || P.recognized.exec(text);
        if (rec) {
          const st = canonicalState(rec[1], roster);
          if (pending && pending.state === st) {
            floor = pending.member; floorBasis = 'yielded-named'; pending = null;
          } else if (bind[st]) {
            floor = bind[st]; floorBasis = ctl ? 'chair-named' : 'manager-binding';
          } else if (stateCounts[st] === 1) {
            floor = roster.find((r) => r.state === st); floorBasis = 'sole-delegate';
          } else {
            floor = null; floorBasis = 'state-only'; purposeState = st;
          }
          carried = 0;
        } else if (P.bareRecognized.test(text)) {
          if (pending) { floor = pending.member; floorBasis = 'yielded-named'; pending = null; }
          else if (purposeState && bind[purposeState]) { floor = bind[purposeState]; floorBasis = 'manager-binding'; }
          else if (purposeState && stateCounts[purposeState] === 1) { floor = roster.find((r) => r.state === purposeState); floorBasis = 'sole-delegate'; }
          else { floor = null; floorBasis = 'state-only'; }
          carried = 0;
        }

        if (P.expired.test(text)) pending = null;

        timeline.push({ t: turn.t, role: 'chair', member: null, basis: null, confidence: null, text });
        continue;
      }

      // ── member speech ──
      // A manager naming the next speaker mid-turn ("I YIELD TWO MINUTES TO THE
      // GENTLEMAN FROM UTAH, MR. OWENS") is the single richest source of names.
      const named = bindFrom(text);
      if (named && /YIELD/i.test(text)) pending = { member: named.member, state: named.state };

      let confidence = null;
      if (floor) {
        confidence = { 'chair-named': 0.95, 'yielded-named': 0.95, 'manager-binding': 0.9, 'sole-delegate': 0.85 }[floorBasis] || 0.7;
        // The known failure mode: a manager yields, the chair never re-recognises,
        // and attribution sticks to the manager for turns on end. Decay so the UI
        // (and any model behind it) can see the guess going stale.
        if (carried > 0) confidence = Math.max(0.35, confidence - 0.15 * carried);
      }
      timeline.push({
        t: turn.t,
        role: 'speech',
        member: floor ? { bioguideId: floor.bioguideId, last: floor.lastDisplay || floor.last, first: floor.first, party: floor.party, state: floor.postal } : null,
        basis: floor ? (carried > 0 ? floorBasis + '-carried' : floorBasis) : (floorBasis || 'unknown'),
        candidateState: floor ? null : (purposeState || null),
        candidates: floor ? null : (purposeState ? stateCounts[purposeState] || null : null),
        confidence,
        text,
      });
      carried++;
    }

    const lastSpeech = [...timeline].reverse().find((x) => x.role === 'speech');
    return {
      timeline: options.limit ? timeline.slice(-options.limit) : timeline,
      current: lastSpeech || null,
      managers: Object.keys(bind).map((st) => ({ state: st, last: bind[st].last, bioguideId: bind[st].bioguideId })),
    };
  }

  root.HouseFloorSpeaker = {
    buildRoster, parseCaptionCues, splitTurns, matchSurname, editDistance, genderOf,
    resolveFloorSpeakers, buildPatterns, canonicalState,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
