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
        // `last` is the matching key and stays fully capitalized: the captions are
        // fully capitalized too, and every comparison in here is against that.
        // `lastDisplay` is the Clerk's own casing, and is the ONLY one that should
        // reach a page — "Bruce WESTERMAN" is what you get if you render the key.
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
    // What the chair calls a member. "REPRESENTATIVE" belongs here as much as
    // "GENTLEMAN" — the chair said "REPRESENTATIVE FROM FLORIDA IS RECOGNIZED"
    // live on 2026-09-14, and with only the gentle- forms accepted that hand-off
    // was invisible and the floor stayed with the previous speaker.
    const GENT = '(?:GENTLE\\w+|MEMBER|REPRESENTATIVE|CONGRESS(?:MAN|WOMAN))';
    // The chair says "the gentleman from X". MEMBERS say "my distinguished
    // colleague from Colorado, Mr. Crow" — and a yield is the only place many
    // speakers are ever named, so refusing the courtesy nouns loses them
    // entirely. Kept separate from GENT: the chair never recognises a "colleague",
    // so widening the recognition patterns would only add false positives.
    const PERSON = '(?:GENTLE\\w+|MEMBER|COLLEAGUE|FRIEND)';
    // A gap that may contain honorific periods but not a sentence break. Anything
    // matching [^.] passes; a period passes only as the tail of a known honorific.
    const GAP = '(?:[^.]|(?:MR|MRS|MS|DR|MISS)\\.)';
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
        PERSON + '\\s+FROM\\s+(' + ST + ')\\s*[,.]?\\s*(?:THE\\s+[A-Z][A-Z\\s]{2,50}[,.]\\s*)?' +
        HON + '\\s+([A-Z][A-Z\'\u2019-]{2,})', 'g'),
      // A member handing the floor to somebody ELSE, matched in two parts so the
      // span between YIELD and TO can be inspected — see yieldsFloorAway().
      yieldAway: new RegExp('\\bYIELD(?:ING)?\\s+((?:[A-Z\'\u2019-]+\\s+){0,8}?)TO\\s+(?:THE\\s+|MY\\s+)?(?:[A-Z][A-Z\'\u2019-]*\\s+){0,3}?' +
        '(?:GENTLE\\w+|MEMBER|COLLEAGUE|FRIEND|REPRESENTATIVE|CONGRESS\\w+|MR\\.|MRS\\.|MS\\.|DR\\.|DOCTOR)\\b', 'gi'),
      // Nobody thanks themselves. When the turn opens by thanking a member by
      // name and that name is who we think is talking, the attribution is wrong —
      // this is the signal that caught Crow being captioned as Moulton.
      thanksNamed: new RegExp('(?:I\\s+)?THANK(?:S|ING)?\\s+(?:YOU\\s*,?\\s*)?(?:AND\\s+THANK\\s+YOU\\s*,?\\s*)?' +
        HON + '\\s+([A-Z][A-Z\'\u2019-]{2,})', 'g'),
      // "IS" is optional throughout: the stenographer drops it often enough to
      // matter ("GENTLEMAN RECOGNIZED." live on 2026-09-14), and a dropped verb
      // silently leaves the floor with the previous speaker.
      // "REPRESENTATIVE MAST OF FLORIDA AND REPRESENTATIVE MOULTON OF
      // MASSACHUSETTS" — the order is inverted from the suspension formula, and
      // this is how time is assigned on privileged resolutions and anything
      // structured by a rule, i.e. the highest-profile debates of the day. In the
      // Iran war powers debate this spelling was CORRECT while the familiar form
      // in the very same sentence garbled Moulton to "MR. BOLTON".
      nameOfState: new RegExp(HON + '\\s+([A-Z][A-Z\'\u2019-]{2,})\\s+OF\\s+(' + ST + ')', 'g'),
      // Same sentence, reset form: "...DEBATABLE FOR ONE HOUR, EQUALLY DIVIDED
      // AND CONTROLLED BY ..." opens a new measure exactly as "EACH WILL CONTROL"
      // does, and must clear the previous measure's bindings.
      equallyDivided: /EQUALLY\s+DIVIDED\s+AND\s+CONTROLLED\s+BY/i,
      // The gap between the state and "RECOGNIZED" holds the appositive that names
      // the member: "THE GENTLEMAN FROM RHODE ISLAND, MR. MAGAZINER, IS
      // RECOGNIZED". It must not run across a sentence boundary, but it MUST
      // survive the period in an honorific — spelling it [^.] silently failed on
      // every recognition that actually named somebody, which is the useful kind.
      recognized: new RegExp(GENT + '\\s+FROM\\s+(' + ST + ')\\b' + GAP + '{0,60}?(?:IS\\s+)?(?:NOW\\s+)?RECOGNIZED', 'i'),
      chairRecognizes: new RegExp('CHAIR\\s+RECOGNIZES\\s+THE\\s+' + GENT + '\\s+FROM\\s+(' + ST + ')', 'i'),
      bareRecognized: /(?:^|\W)(?:THE\s+)?GENTLE\w+[.,]?\s+(?:IS\s+)?(?:NOW\s+)?RECOGNIZED/i,
      purpose: new RegExp('(?:FOR\\s+WHAT\\s+PURPOSE|FOR\\s+PURPOSES?)[\\s\\S]{0,40}?' + GENT + '\\s+FROM\\s+(' + ST + ')', 'i'),
      // Chair-only bookkeeping. A member says "I RESERVE"; the chair says
      // "THE GENTLEMAN RESERVES" — that third person is the whole distinction.
      chair: new RegExp(
        'FOR\\s+WHAT\\s+PURPOSE|FOR\\s+PURPOSES?\\b|WITHOUT\\s+OBJECTION|' +
        GENT + '\\s+FROM\\s+(?:' + ST + ')\\b' + GAP + '{0,60}?(?:IS\\s+)?(?:NOW\\s+)?RECOGNIZED|' +
        '(?:THE\\s+)?GENTLE\\w+[.,]?\\s+(?:IS\\s+)?(?:NOW\\s+)?RECOGNIZED|' +
        // The period is real: "GENTLEMAN. RESERVES." is what the captions said at
        // 08:36:12 on 2026-09-14, and requiring a bare space there cost the whole
        // rest of that debate — every later turn stayed on the outgoing manager.
        '(?:THE\\s+)?GENTLE\\w+[.,]?\\s+(?:FROM\\s+(?:' + ST + ')[.,]?\\s+)?(?:YIELDS|RESERVES)|' +
        'THE\\s+CHAIR\\b|CLERK\\s+WILL\\s+REPORT|THE\\s+QUESTION\\s+IS|PURSUANT\\s+TO\\s+THE\\s+RULE|' +
        'SEEK\\s+RECOGNITION|RULES\\s+ARE\\s+SUSPENDED|TIME\\s+HAS\\s+EXPIRED|' +
        "UNDER\\s+THE\\s+SPEAKER'?S\\s+ANNOUNCED\\s+POLICY", 'i'),
      expired: /TIME\s+HAS\s+EXPIRED|YIELDS\s+BACK|YIELDED\s+BACK/i,
      // The chair often trails off, and just as often prefixes the hand-off with
      // its own bookkeeping: "GENTLEMAN. RESERVES. GENTLEMAN FROM MASSACHUSETTS."
      // Anchoring only at the end (with a length guard at the call site, and
      // members addressing the chair excluded) catches both shapes. Without this
      // the previous speaker keeps the floor straight through the hand-off.
      handoffTail: new RegExp('(?:THE\\s+)?' + GENT + '\\s+FROM\\s+(' + ST + ')\\s*[.,]?$', 'i'),
      // Caption fragments of the chair's own bookkeeping: "GENTLEMAN." on its own
      // line, split off from "GENTLEMAN YIELDS." a beat earlier. Read as speech it
      // hands a stray word to whoever last held the floor and, worse, keeps them
      // there through the recognition that follows.
      chairFragment: new RegExp('^(?:THE\\s+)?' + GENT + '\\s*[.,]?$', 'i'),
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

  // Does this turn hand the floor to somebody else?
  //
  // The tell is grammatical person in the span between YIELD and TO. A member
  // keeping their own time says "I YIELD MYSELF...", "AS I MAY CONSUME"; one
  // giving it away says "AS HE MAY CONSUME TO THE GENTLEMAN FROM..." or "THREE
  // MINUTES TO MY COLLEAGUE FROM COLORADO". Matching on "TO <person>" alone is
  // not enough — "I YIELD AS MUCH TIME AS I MAY CONSUME TO BRIEFLY RESPOND TO MY
  // COLLEAGUE" keeps the floor, and reading it as a hand-off blanks the speaker
  // for the rest of their remarks.
  function yieldsFloorAway(text, P) {
    P.yieldAway.lastIndex = 0;
    let m;
    while ((m = P.yieldAway.exec(text)) !== null) {
      if (!/\b(?:MYSELF|I|MY|ME)\b/i.test(m[1] || '')) return true;
    }
    return false;
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
    let managerStates = []; // the two seats controlling time; a subset of bind
    let floor = null;       // member the chair last handed the floor to
    let floorBasis = null;
    let pending = null;       // { member, state } named by a yielder, not yet recognised
    let pendingUnknown = false; // the floor was yielded away to somebody we could not name
    let purposeState = null;
    let carried = 0;        // speech turns since the last explicit recognition

    // One turn can name the same seat twice in two different formulas, and the
    // two spellings need not agree — the chair opened the Iran debate with
    // "REPRESENTATIVE MOULTON OF MASSACHUSETTS" and "THE GENTLEMAN FROM
    // MASSACHUSETTS, MR. BOLTON" in a single breath. Collect every candidate in
    // the turn and keep the closest match per state, so the good spelling wins
    // regardless of which order they arrive in.
    const bindFrom = (text) => {
      const seen = {};
      const offer = (rawState, surname) => {
        const st = canonicalState(rawState, roster);
        const hit = matchSurname(surname, st, roster);
        if (!hit) return;
        if (!seen[st] || hit.distance < seen[st].distance) seen[st] = { member: hit.member, state: st, distance: hit.distance };
      };
      P.bind.lastIndex = 0;
      let m;
      while ((m = P.bind.exec(text)) !== null) offer(m[1], m[2]);
      P.nameOfState.lastIndex = 0;
      while ((m = P.nameOfState.exec(text)) !== null) offer(m[2], m[1]);
      let found = null;
      for (const st of Object.keys(seen)) { bind[st] = seen[st].member; found = seen[st]; }
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

      // A bare hand-off is only ever a short utterance from the chair. The length
      // guard and the self-address check together keep a member's own sentence
      // that happens to end in a state name ("...I YIELD TO THE GENTLEMAN FROM
      // MASSACHUSETTS.") from being mistaken for one.
      const isHandoff = text.length <= 90 && !P.selfAddress.test(text) && P.handoffTail.test(text);
      const isChair = isHandoff || P.chairFragment.test(text) ||
        (P.chair.test(text) && !P.selfAddress.test(text));

      if (isChair) {
        if (/CLERK\s+WILL\s+REPORT/i.test(text)) clerkNext = true;
        const sh = isHandoff ? P.handoffTail.exec(text) : null;
        if (sh) {
          const st = canonicalState(sh[1], roster);
          // Remember the state either way: the chair frequently follows a hand-off
          // with a bare "GENTLEMAN RECOGNIZED.", and that turn has no state of its
          // own to work from.
          purposeState = st;
          if (bind[st]) { floor = bind[st]; floorBasis = 'manager-binding'; }
          else if (stateCounts[st] === 1) { floor = roster.find((r) => r.state === st); floorBasis = 'sole-delegate'; }
          else { floor = null; floorBasis = 'state-only'; }
          pendingUnknown = false;   // the chair named a state; we are no longer blind
          carried = 0;
          timeline.push({ t: turn.t, role: 'chair', member: null, basis: null, confidence: null, text });
          continue;
        }
        const ctl = P.control.exec(text);
        const divided = !ctl && P.equallyDivided.test(text);
        if (divided) { bind = {}; pending = null; bindFrom(text); managerStates = Object.keys(bind); }
        if (ctl) {
          bind = {};                        // new measure: previous managers are done
          pending = null;
          bindFrom(text);   // closest spelling per state, across both formulas
          for (const [rawSt, name] of [[ctl[1], ctl[2]], [ctl[3], ctl[4]]]) {
            const st = canonicalState(rawSt, roster);
            const hit = matchSurname(name, st, roster);
            // Only fill a seat bindFrom could not: it already picked the closest
            // spelling, and this pair is the noisier of the two formulas.
            if (hit && !bind[st]) bind[st] = hit.member;
          }
          managerStates = [ctl[1], ctl[3]].map((x) => canonicalState(x, roster)).filter((x) => bind[x]);
        } else if (!divided) {
          bindFrom(text);
        }

        const pm = P.purpose.exec(text);
        if (pm) purposeState = canonicalState(pm[1], roster);

        const rec = P.chairRecognizes.exec(text) || P.recognized.exec(text);
        if (rec) {
          const st = canonicalState(rec[1], roster);
          // Always remember the state, not just when it fails to resolve: the
          // chair follows a named recognition with a bare "THE GENTLEMAN IS
          // RECOGNIZED" constantly, and that turn carries no state of its own.
          purposeState = st;
          if (pending && pending.state === st) {
            floor = pending.member; floorBasis = 'yielded-named'; pending = null;
          } else if (bind[st]) {
            floor = bind[st]; floorBasis = ctl ? 'chair-named' : 'manager-binding';
          } else if (stateCounts[st] === 1) {
            floor = roster.find((r) => r.state === st); floorBasis = 'sole-delegate';
          } else {
            floor = null; floorBasis = 'state-only';
          }
          pendingUnknown = false;   // the chair named a state, so we are no longer blind
          carried = 0;
        } else if (P.bareRecognized.test(text)) {
          if (pending) { floor = pending.member; floorBasis = 'yielded-named'; pending = null; }
          // The floor was just handed to someone whose name we could not read.
          // Falling back on purposeState here hands it to the MANAGER, who is the
          // one person we already know it is not — that is how Crow's three
          // minutes went out under Moulton's name.
          else if (pendingUnknown) { floor = null; floorBasis = 'yield-unresolved'; }
          else if (purposeState && bind[purposeState]) { floor = bind[purposeState]; floorBasis = 'manager-binding'; }
          else if (purposeState && stateCounts[purposeState] === 1) { floor = roster.find((r) => r.state === purposeState); floorBasis = 'sole-delegate'; }
          else { floor = null; floorBasis = 'state-only'; }
          pendingUnknown = false;
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
      const yieldsAway = yieldsFloorAway(text, P);
      if (named && /YIELD/i.test(text)) { pending = { member: named.member, state: named.state }; pendingUnknown = false; }
      else if (yieldsAway) pendingUnknown = true;

      // Nobody thanks themselves by name. If this turn opens by thanking the
      // member we think is speaking, we are wrong — and saying nothing beats
      // putting one member's name on another's speech.
      if (floor) {
        P.thanksNamed.lastIndex = 0;
        let tm;
        while ((tm = P.thanksNamed.exec(text)) !== null) {
          const thanked = tm[1].toUpperCase().replace(/[^A-Z-]/g, '');
          if (editDistance(thanked, floor.last) <= allowedEdits(floor.last.length)) {
            floor = null; floorBasis = 'contradicted'; carried = 0;
            break;
          }
        }
      }

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
    // Counted over the WHOLE session, never the slice the caller asked to see.
    // Computing it after the slice made "resolvedPct" mean "of the last N turns",
    // which reads as 100% any time the most recent turn happens to be resolved.
    const allSpeech = timeline.filter((x) => x.role === 'speech');
    const namedSpeech = allSpeech.filter((x) => x.member).length;
    return {
      timeline: options.limit ? timeline.slice(-options.limit) : timeline,
      speechTurns: allSpeech.length,
      resolvedTurns: namedSpeech,
      current: lastSpeech || null,
      // Only the seats that control time. `bind` also accumulates every member
      // named in a yield during the debate, and reporting those as managers made
      // a three-minute guest look like a floor manager.
      managers: managerStates.filter((st) => bind[st]).map((st) => ({ state: st, last: bind[st].last, bioguideId: bind[st].bioguideId })),
      // The whole state -> member table for the measure under way. The client needs
      // this to resolve a live "THE GENTLEMAN FROM ARKANSAS IS RECOGNIZED" off the
      // video's own caption track, where the line that named him is long gone.
      bindings: Object.keys(bind).map((st) => ({ state: st, bioguideId: bind[st].bioguideId })),
    };
  }

  // ── Live, unsegmented caption text ────────────────────────────────────────
  //
  // The video stream carries its own CEA-608 caption track, and hls.js surfaces it
  // as cues that arrive AHEAD of the picture. The captions.vtt sidecar this file
  // was built around is a different artifact: the Clerk rewrites it every 70-78
  // seconds, so a name derived from it can be a minute behind the face on screen
  // even though the viewer can read the chair recognising somebody right now.
  //
  // The live track is missing the one thing resolveFloorSpeakers() depends on: the
  // stenographer's "UNIDENTIFIED SPEAKER:" markers exist only in the sidecar, so
  // there are no turn boundaries to split on. It does not need them. The floor only
  // changes hands when the chair recognises somebody or a manager yields, and both
  // of those are IN the text. Replaying just those events over a binding table
  // gives who holds the floor without knowing where any turn began.
  //
  // `seedBind` comes from the server, which has parsed the whole day and knows who
  // controls time on the current measure. Without it a hand-off that says only
  // "THE GENTLEMAN FROM ARKANSAS IS RECOGNIZED" cannot be resolved from live text
  // alone, because the line that named him scrolled past hours ago.
  function resolveLiveFloor(text, roster, seedBind) {
    if (!text || !roster || !roster.length) return null;
    const P = buildPatterns(roster);
    const bind = Object.assign(Object.create(null), seedBind || {});
    const stateCounts = {};
    for (const r of roster) stateCounts[r.state] = (stateCounts[r.state] || 0) + 1;

    // Every event that can move the floor, found in one pass so they stay in
    // document order — order is the whole point, the last one wins.
    const events = [];
    const push = (index, kind, state, surname) => events.push({ index, kind, state, surname });

    P.bind.lastIndex = 0;
    let m;
    while ((m = P.bind.exec(text)) !== null) push(m.index, 'name', m[1], m[2]);
    P.nameOfState.lastIndex = 0;
    while ((m = P.nameOfState.exec(text)) !== null) push(m.index, 'name', m[2], m[1]);

    const scanAll = (re, kind, group) => {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let x;
      while ((x = g.exec(text)) !== null) push(x.index, kind, group ? x[group] : null, null);
    };
    scanAll(P.recognized, 'recognize', 1);
    scanAll(P.chairRecognizes, 'recognize', 1);
    scanAll(P.bareRecognized, 'recognize-bare');

    events.sort((a, b) => a.index - b.index);

    let floor = null, basis = null, at = -1, lastNamed = null, lastState = null;
    for (const e of events) {
      if (e.kind === 'name') {
        const st = canonicalState(e.state, roster);
        const hit = matchSurname(e.surname, st, roster);
        if (hit) { bind[st] = hit.member; lastNamed = { member: hit.member, state: st, index: e.index }; }
        continue;
      }
      const st = e.state ? canonicalState(e.state, roster) : null;
      // A name mentioned just before the recognition is that recognition's subject:
      // "THE GENTLEMAN FROM RHODE ISLAND, MR. MAGAZINER, IS RECOGNIZED" arrives as a
      // name event immediately followed by a recognize event.
      const nearby = lastNamed && (e.index - lastNamed.index) < 200 ? lastNamed : null;
      if (nearby && (!st || nearby.state === st)) { floor = nearby.member; basis = 'live-named'; at = e.index; }
      else if (st && bind[st]) { floor = bind[st]; basis = 'live-binding'; at = e.index; }
      else if (st && stateCounts[st] === 1) { floor = roster.find((r) => r.state === st); basis = 'live-sole-delegate'; at = e.index; }
      else if (!st && lastState && bind[lastState]) { floor = bind[lastState]; basis = 'live-binding'; at = e.index; }
      else { floor = null; basis = 'live-unresolved'; at = e.index; }
      if (st) lastState = st;
    }

    if (at < 0) return null;   // nothing in this text moves the floor
    return {
      member: floor ? { bioguideId: floor.bioguideId, last: floor.lastDisplay || floor.last, first: floor.first, party: floor.party, state: floor.postal } : null,
      basis,
      // Characters from the end of the text — the client uses this to tell whether
      // the live stream has seen a hand-off the server's slower copy has not.
      fromEnd: text.length - at,
    };
  }

  // CEA-608 roll-up captions repeat the previous line with every new one, so the
  // same sentence arrives two or three times. Dedupe by text, keep first arrival.
  function dedupeLiveCues(cues) {
    const seen = new Set();
    const out = [];
    for (const c of cues) {
      const line = (c.text || '').replace(/\s+/g, ' ').trim();
      if (!line || seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
    return out;
  }

  root.HouseFloorSpeaker = {
    resolveLiveFloor, dedupeLiveCues,
    buildRoster, parseCaptionCues, splitTurns, matchSurname, editDistance, genderOf,
    resolveFloorSpeakers, buildPatterns, canonicalState,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
