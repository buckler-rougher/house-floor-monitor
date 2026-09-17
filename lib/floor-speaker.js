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

  // The chair naming a floor manager under the rule is the strongest position in
  // the whole day's captions: one specific person, a known state, a fixed slot in
  // a fixed sentence, spoken slowly. Everywhere else a surname is scored against
  // the ordinary edit budget, because a wrong name there goes out under somebody's
  // speech. Here, a name that does not match costs the seat for the whole measure
  // and every turn on that side falls to "an unidentified Kentuckian" — which is
  // what happened when the stenographer typed "MR. COBURN" for Mr. Comer, three
  // edits out and past the cap.
  //
  // So the budget widens, and two things keep it honest. The first letter must
  // agree: the stenographer types the start of a name right even when the rest is
  // a guess, true of seven of the eight garbles on record here (KEELEY/KILEY,
  // WHITMAN/WITTMAN, NILS/NEHLS, COBURN/COMER...). And it must land on exactly one
  // member of that delegation, so ambiguity still declines. In Kentucky "C" picks
  // Comer alone: Rogers and Barr are nearer spellings than the cap would otherwise
  // exclude, and both are ruled out by a letter.
  function matchManagerName(surname, stateFullName, roster, gender) {
    const ordinary = matchSurname(surname, stateFullName, roster, gender);
    if (ordinary) return ordinary;
    if (!surname || !stateFullName) return null;

    const needle = surname.toUpperCase().replace(/[^A-Z-]/g, '');
    if (needle.length < 4) return null;   // too short to spend a wide budget on

    const cap = Math.max(allowedEdits(needle.length), Math.ceil(needle.length / 2));
    const near = roster
      .filter((r) => r.state === stateFullName && r.last[0] === needle[0])
      .map((r) => ({ r, d: editDistance(needle, r.last) }))
      .filter((c) => c.d <= cap);

    if (near.length !== 1) return null;
    if (gender && genderOf(near[0].r) !== gender) return null;
    return { member: near[0].r, distance: near[0].d, scope: 'manager-slot' };
  }

  function matchSurname(surname, stateFullName, roster, gender) {
    if (!surname) return null;
    const needle = surname.toUpperCase().replace(/[^A-Z-]/g, '');
    if (needle.length < 3) return null;

    const inState = stateFullName ? roster.filter((r) => r.state === stateFullName) : [];

    // Within the state first, and if the state has anyone plausible the search ends
    // there — right or nothing.
    //
    // Falling through to the whole roster after a near miss is how "THE GENTLEMAN
    // FROM OREGON, MR. BOYLE" became Brendan Boyle of Pennsylvania: the captions had
    // garbled Ms. Hoyle's name AND her gender, the honorific filter threw away a
    // one-edit match in the right state, and the national pass then found an exact
    // spelling in the wrong one. A state is far stronger evidence than a spelling
    // the stenographer typed at speed.
    if (inState.length) {
      const cap = allowedEdits(needle.length);
      const near = inState
        .map((r) => ({ r, d: editDistance(needle, r.last) }))
        .filter((c) => c.d <= cap);
      if (near.length) {
        // A one-edit match outranks a disagreeing honorific — the captions get
        // gender wrong constantly ("THE GENTLEMAN FROM MARYLAND, MS. ELFRETH"), and
        // being one letter out is close enough to trust over it. At two edits or
        // more the name is no longer strong enough to carry that, and a conflicting
        // honorific rules it out: "MR. FENIG" is not Grace Meng.
        const allowed = near.filter((c) => c.d <= 1 || !gender || genderOf(c.r) === gender);
        if (!allowed.length) return null;
        let best = null, bestD = Infinity, tie = false;
        for (const c of allowed) {
          if (c.d < bestD) { best = c.r; bestD = c.d; tie = false; }
          else if (c.d === bestD) {
            tie = true;
            if (gender && genderOf(c.r) === gender && genderOf(best) !== gender) { best = c.r; tie = false; }
          }
        }
        // An unbroken tie between two members of one delegation is a real ambiguity;
        // report nothing rather than coin-flip a name onto a speech.
        return tie ? null : { member: best, distance: bestD, scope: 'state' };
      }
      // Nobody in the state comes close: the state word itself may be the garble, so
      // the national pass below is allowed to try.
    }

    // No state, or a state that yielded nothing. The pool is 441 people, so demand a
    // much closer name — and for a short surname, an exact one. "FOX" sits one edit
    // from both FOXX and COX, and only the state tells them apart.
    const cap = needle.length <= 4 ? 0 : 1;
    let best = null, bestD = Infinity, tie = false;
    for (const r of roster) {
      const d = editDistance(needle, r.last);
      if (d > cap) continue;
      if (d > 0 && gender && genderOf(r) !== gender) continue;
      if (d < bestD) { best = r; bestD = d; tie = false; }
      else if (d === bestD) { tie = true; if (gender && genderOf(r) === gender && genderOf(best) !== gender) { best = r; tie = false; } }
    }
    return best && !tie ? { member: best, distance: bestD, scope: 'national' } : null;
  }

  // Match "RALPH NORMAN" / "MIKE VOSS" against a state's delegation.
  //
  // The surname alone is often not enough once the captions mangle it: "MIKE VOSS"
  // is Mike Bost of Illinois, and VOSS->BOST is two edits, which a four-letter
  // surname is not allowed on its own. The given name narrows Illinois to Quigley
  // and Bost first, and the surname then separates them unambiguously.
  function matchPersonTokens(tokens, stateFullName, roster, gender) {
    const parts = String(tokens || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return null;
    const surname = parts[parts.length - 1];
    const direct = matchSurname(surname, stateFullName, roster, gender);
    if (direct && direct.distance === 0) return direct;
    if (parts.length >= 2 && stateFullName) {
      const given = parts[0].toUpperCase();
      const pool = roster.filter((r) =>
        r.state === stateFullName && editDistance(given, (r.first || '').toUpperCase()) <= 1);
      if (pool.length) {
        let best = null, bestD = Infinity, tie = false;
        for (const r of pool) {
          const d = editDistance(surname.toUpperCase(), r.last);
          if (d < bestD) { best = r; bestD = d; tie = false; }
          else if (d === bestD) tie = true;
        }
        if (best && !tie && bestD <= 3) return { member: best, distance: bestD, scope: 'state+given' };
      }
    }
    return direct;
  }

  // Gender asserted by an honorific. Mr. is male, Mrs./Ms./Miss female; the
  // office titles say nothing either way.
  function genderOfHonorific(h) {
    const t = String(h || '').toUpperCase().replace(/\./g, '');
    if (t === 'MR') return 'M';
    if (t === 'MRS' || t === 'MS' || t === 'MISS') return 'F';
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
    // Ten members of the House have a surname of more than one word — VAN EPPS,
    // DE LA CRUZ, WASSERMAN SCHULTZ, WATSON COLEMAN, LEGER FERNANDEZ, MCCLAIN
    // DELANEY, MCDONALD RIVET, VAN DREW, VAN DUYNE, VAN ORDEN — and a capture
    // that stops at the first token reads "MR. VAN EPPS" as "VAN", which matches
    // nobody. The chair had spelled it correctly and named him as a floor manager;
    // the Tennessee seat never bound, and 40 turns of that bill came back as an
    // unidentified Tennessean. One name, 11% of that day's floor speech.
    //
    // Built from the roster, so a member sworn in tomorrow is covered without an
    // edit here, and longest-first so VAN EPPS wins over the VAN that the generic
    // token would otherwise take.
    //
    // Exact spellings only, deliberately. A loose "two capitalised words" capture
    // would read "MR. SMITH AND THE GENTLEMAN FROM..." as a member called SMITH
    // AND, and the fuzzy matcher downstream would then find somebody for it.
    const multiWord = roster
      .filter((r) => /\s/.test(r.last))
      .map((r) => r.last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
      .sort((a, b) => b.length - a.length);
    const SURNAME = '(?:' + (multiWord.length ? multiWord.join('|') + '|' : '')
      + '[A-Z][A-Z\'\u2019-]{2,}' + ')';
    return {
      // "THE GENTLEMAN FROM ARKANSAS, MR. WESTERMAN, AND THE GENTLEWOMAN FROM
      //  OREGON, MS. HOYLE, EACH WILL CONTROL 20 MINUTES"
      control: new RegExp(
        GENT + '\\s+FROM\\s+(' + ST + ')\\s*,?\\s*' + HON + '\\s+(' + SURNAME + ')' +
        '[\\s\\S]{0,120}?' + GENT + '\\s+FROM\\s+(' + ST + ')\\s*,?\\s*' + HON + '\\s+(' + SURNAME + ')' +
        '[\\s\\S]{0,80}?(?:EACH\\s+WILL\\s+CONTROL|WILL\\s+EACH\\s+CONTROL)', 'i'),
      // Any "GENTLEMAN FROM <state>[, optional appositive,] MR. <NAME>".
      // The appositive ("THE LEAD SPONSOR OF THE BILL,") is why the gap is loose.
      bind: new RegExp(
        PERSON + '\\s+FROM\\s+(' + ST + ')\\s*[,.]?\\s*(?:THE\\s+[A-Z][A-Z\\s]{2,50}[,.]\\s*)?' +
        '(' + HON + ')\\s+(' + SURNAME + ')', 'g'),
      // A yield's target, where the name trails a long appositive: "I YIELD TWO
      // MINUTES TO THE GENTLEMAN FROM TEXAS, THE LEAD SPONSOR OF THIS BILL AND
      // SOMEONE WHO PERSONALLY KNOWS ABOUT LAW ENFORCEMENT, HAVING SERVED AS A
      // SHERIFF. MR. NILS." The ordinary binding pattern allows a short appositive
      // with no commas in it, so that name was never even looked at and the stale
      // Texas binding stood. Only used on turns that actually yield away.
      yieldNamed: new RegExp(PERSON + '\\s+FROM\\s+(' + ST + ')[\\s\\S]{0,200}?(' + HON + ')\\s+(' + SURNAME + ')', 'gi'),
      // A member handing the floor to somebody ELSE, matched in two parts so the
      // span between YIELD and TO can be inspected — see yieldsFloorAway().
      // The words between TO and the person may carry a stray period: the captions
      // rendered "to the bill sponsor, my friend from Louisiana, Mr. Carter" as
      // "TO THE BILL. SPONSOR MY FRIEND FROM LOUISIANA, MR. CARTER". A token class
      // that stopped dead at "BILL." missed the yield entirely, so the chair's bare
      // "THE GENTLEMAN IS RECOGNIZED" fell back to the manager and the row kept
      // naming Magaziner while Carter spoke.
      yieldAway: new RegExp('\\bYIELD(?:ING)?\\s+((?:[A-Z\'\u2019-]+\\s+){0,8}?)TO\\s+(?:THE\\s+|MY\\s+)?(?:[A-Z][A-Z\'\u2019.-]*\\s+){0,4}?' +
        '(?:GENTLE\\w+|MEMBER|COLLEAGUE|FRIEND|REPRESENTATIVE|CONGRESS\\w+|LEADER|WHIP|MR\\.|MRS\\.|MS\\.|DR\\.|DOCTOR)\\b', 'gi'),
      // A yield that names the member but NOT their state. On a committee bill the
      // managers introduce people by their place on the committee instead:
      //   "I WILL YIELD TWO MINUTES TO THE CHAIR OF THE ENERGY SUBCOMMITTEE.
      //    CONGRESSMAN LATTA."
      //   "TWO MINUTES TO A MEMBER OF THE ENERGY AND COMMERCE COMMITTEE,
      //    CONGRESSMAN BALDERSON."
      //   "THE SPONSOR, MEMBER OF THE ENERGY AND COMMERCE COMMITTEE, DOCTOR
      //    MILLER-MEEKS."
      // yieldNamed requires "FROM <state>" and none of these have one, so the
      // floor never moved and the manager kept the guest's minutes. On 2026-09-15
      // this was the commonest way anybody was introduced.
      //
      // Deliberately anchored to the span after YIELD ... TO rather than scanning
      // the turn: members name each other constantly for other reasons, and the
      // same day has "I THANK MICHELLE FISCHBACH FOR HER LEADERSHIP" and "LED BY
      // MY COLLEAGUES REPRESENTATIVE PANETTA AND PFLUGER", neither of which hands
      // anybody the floor. The span crosses a sentence break because the
      // stenographer puts one in the middle of the phrase.
      yieldTargetNoState: new RegExp(
        '\\bYIELD(?:ING)?\\s+((?:[A-Z\'\u2019-]+\\s+){0,8}?)TO\\s+[\\s\\S]{0,120}?\\b('
        + HON + ')\\s+(' + SURNAME + ')\\b', 'gi'),
      // Nobody thanks themselves. When the turn opens by thanking a member by
      // name and that name is who we think is talking, the attribution is wrong —
      // this is the signal that caught Crow being captioned as Moulton.
      thanksNamed: new RegExp('(?:I\\s+)?THANK(?:S|ING)?\\s+(?:YOU\\s*,?\\s*)?(?:AND\\s+THANK\\s+YOU\\s*,?\\s*)?' +
        HON + '\\s+(' + SURNAME + ')', 'g'),
      // "IS" is optional throughout: the stenographer drops it often enough to
      // matter ("GENTLEMAN RECOGNIZED." live on 2026-09-14), and a dropped verb
      // silently leaves the floor with the previous speaker.
      // "REPRESENTATIVE MAST OF FLORIDA AND REPRESENTATIVE MOULTON OF
      // MASSACHUSETTS" — the order is inverted from the suspension formula, and
      // this is how time is assigned on privileged resolutions and anything
      // structured by a rule, i.e. the highest-profile debates of the day. In the
      // Iran war powers debate this spelling was CORRECT while the familiar form
      // in the very same sentence garbled Moulton to "MR. BOLTON".
      // "REPRESENTATIVE MAST OF FLORIDA" and "REPRESENTATIVE RALPH NORMAN FROM
      // SOUTH CAROLINA" are the same construction. The second is how a Special
      // Order hour hands off — the chair recognises nobody there, the member
      // holding the hour just says "I NOW INVITE ... TO ADDRESS THE BODY", so
      // without this an entire evening of proceedings resolves to nothing.
      nameOfState: new RegExp('(' + HON + ')\\s+((?:[A-Z][A-Z\'\u2019-]+\\s+){0,2}[A-Z][A-Z\'\u2019-]{2,})\\s+(?:OF|FROM)\\s+(' + ST + ')', 'g'),
      // Same sentence, reset form: "...DEBATABLE FOR ONE HOUR, EQUALLY DIVIDED
      // AND CONTROLLED BY ..." opens a new measure exactly as "EACH WILL CONTROL"
      // does, and must clear the previous measure's bindings.
      equallyDivided: /EQUALLY\s+DIVIDED\s+AND\s+CONTROLLED\s+BY/i,
      // The gap between the state and "RECOGNIZED" holds the appositive that names
      // the member: "THE GENTLEMAN FROM RHODE ISLAND, MR. MAGAZINER, IS
      // RECOGNIZED". It must not run across a sentence boundary, but it MUST
      // survive the period in an honorific — spelling it [^.] silently failed on
      // every recognition that actually named somebody, which is the useful kind.
      // The gap here is permissive rather than sentence-bounded, and the LAST match
      // wins instead of the first — see lastMatch().
      //
      // Bounding it to honorific periods was meant to stop a recognition matching
      // across a sentence, but the captions stutter mid-phrase: "GENTLEMAN FROM
      // RHODE ISLAND. MR. MAGAZINE. MAGAZINER IS RECOGNIZED." has a full stop right
      // after the state and another after the false start, and neither is a
      // sentence. That cost Magaziner the floor for a whole speech. Taking the last
      // match protects what the bound was for: "...FROM RHODE ISLAND YIELDS BACK.
      // THE GENTLEMAN FROM TEXAS IS RECOGNIZED." still resolves to Texas.
      recognized: new RegExp(GENT + '\\s+FROM\\s+(' + ST + ')\\b[\\s\\S]{0,60}?(?:IS\\s+)?(?:NOW\\s+)?RECOGNIZED', 'gi'),
      chairRecognizes: new RegExp('CHAIR\\s+RECOGNIZES\\s+THE\\s+' + GENT + '\\s+FROM\\s+(' + ST + ')', 'gi'),
      // Pieces for recognitionState(): every "X from <state>" mention, and every
      // occurrence of the word itself.
      stateMention: new RegExp(GENT + '\\s+FROM\\s+(' + ST + ')', 'gi'),
      recognizedWord: /RECOGNIZ(?:ED|ES)/gi,
      bareRecognized: /(?:^|\W)(?:THE\s+)?GENTLE\w+[.,]?\s+(?:IS\s+)?(?:NOW\s+)?RECOGNIZED/i,
      purpose: new RegExp('(?:FOR\\s+WHAT\\s+PURPOSE|FOR\\s+PURPOSES?)[\\s\\S]{0,40}?' + GENT + '\\s+FROM\\s+(' + ST + ')', 'i'),
      // Chair-only bookkeeping. A member says "I RESERVE"; the chair says
      // "THE GENTLEMAN RESERVES" — that third person is the whole distinction.
      chair: new RegExp(
        'FOR\\s+WHAT\\s+PURPOSE|FOR\\s+PURPOSES?\\b|WITHOUT\\s+OBJECTION|' +
        GENT + '\\s+FROM\\s+(?:' + ST + ')\\b[\\s\\S]{0,60}?(?:IS\\s+)?(?:NOW\\s+)?RECOGNIZED|' +
        '(?:THE\\s+)?GENTLE\\w+[.,]?\\s+(?:IS\\s+)?(?:NOW\\s+)?RECOGNIZED|' +
        // The period is real: "GENTLEMAN. RESERVES." is what the captions said at
        // 08:36:12 on 2026-09-14, and requiring a bare space there cost the whole
        // rest of that debate — every later turn stayed on the outgoing manager.
        '(?:THE\\s+)?GENTLE\\w+[.,]?\\s+(?:FROM\\s+(?:' + ST + ')[.,]?\\s+)?(?:YIELDS|RESERVES)|' +
        'THE\\s+CHAIR\\b|CLERK\\s+WILL\\s+REPORT|THE\\s+QUESTION\\s+IS|PURSUANT\\s+TO\\s+THE\\s+RULE|' +
        'SEEK\\s+RECOGNITION|RULES\\s+ARE\\s+SUSPENDED|TIME\\s+HAS\\s+EXPIRED|' +
        "UNDER\\s+THE\\s+SPEAKER'?S\\s+ANNOUNCED\\s+POLICY", 'i'),
      // The chair conducting business, as distinct from the chair handing the floor
      // over. A recognition is the chair speaking too, but the thing that matters
      // about it is the member who follows, and `recognized` already carries that.
      // These are the utterances where the chair keeps the floor: putting the
      // question, ruling, announcing a reservation, assigning time under the rule.
      chairSpeaks: new RegExp(
        'WITHOUT\\s+OBJECTION|THE\\s+QUESTION\\s+IS|PURSUANT\\s+TO\\s+THE\\s+RULE|' +
        'FOR\\s+WHAT\\s+PURPOSE|FOR\\s+PURPOSES?\\b|RULES\\s+ARE\\s+SUSPENDED|' +
        'SO\\s+ORDERED|THE\\s+AYES\\s+APPEAR|IN\\s+THE\\s+OPINION\\s+OF\\s+THE\\s+CHAIR|' +
        // The tail ends of the chair's long formulas. The chair holds the floor for
        // ten or fifteen seconds putting a question or assigning time under a rule,
        // and the phrase that identifies it as the chair — "THE QUESTION IS",
        // "PURSUANT TO THE RULE" — is at the START. By the time a viewer is looking,
        // that opening is far enough back that the recency test rejects it and the
        // row shows a member while the chair is plainly still talking. These land
        // near the end of the same sentences, so the chair is still current.
        // Between them they were 320 of the 740 uncovered seconds in one afternoon.
        'THOSE\\s+IN\\s+FAVOR|THOSE\\s+OPPOSED|AYES\\s+(?:HAVE|APPEAR\\s+TO\\s+HAVE)\\s+IT|' +
        'NOES\\s+(?:HAVE|APPEAR\\s+TO\\s+HAVE)\\s+IT|TWO[\\s-]THIRDS\\s+BEING\\s+IN\\s+THE\\s+AFFIRMATIVE|' +
        '(?:EACH\\s+WILL|WILL\\s+EACH)\\s+CONTROL|IS\\s+SUSPENDED\\s+AND\\s+THE\\s+BILL|' +
        "UNDER\\s+THE\\s+SPEAKER'?S\\s+ANNOUNCED\\s+POLICY|" +
        '(?:THE\\s+)?GENTLE\\w+[.,]?\\s+(?:FROM\\s+(?:' + ST + ')[.,]?\\s+)?(?:YIELDS|RESERVES)|' +
        "(?:THE\\s+)?GENTLE\\w+(?:'S)?\\s+TIME\\s+HAS\\s+EXPIRED", 'gi'),
      expired: /TIME\s+HAS\s+EXPIRED|YIELDS\s+BACK|YIELDED\s+BACK/i,
      // The House leaving the floor. Deliberately narrow: the same passage contains
      // "I MOVE THAT THE HOUSE DO NOW ADJOURN" and "THE QUESTION IS ON THE MOTION TO
      // ADJOURN", which are a motion being made and voted, not the House rising.
      // Only the Speaker's own declaration ends the session.
      adjourned: /\bHOUSE\s+STANDS\s+ADJOURNED\b/i,
      recessed: /\bHOUSE\s+(?:STANDS|WILL\s+BE|IS)\s+IN\s+RECESS\b|\bDECLARES?\s+THE\s+HOUSE\s+IN\s+RECESS\b/i,
      // Captured loosely and trimmed in cleanUntil(), because the thing being
      // captured is full of periods: "UNTIL 10 A.M. TOMORROW". Stopping at the
      // first one yields "UNTIL 10 A".
      until: /\bUNTIL\s+([\s\S]{1,70})/i,
      // A chair recognition found INSIDE a member's turn. The stenographer marks
      // speaker changes with "UNIDENTIFIED SPEAKER:" and sometimes simply does not,
      // so one turn swallows the hand-off and everything after it — the sidecar has
      // run a single turn for ten minutes and more. Everything downstream keys off
      // those markers, so without this the floor changes hands and the resolver
      // never notices: it kept naming Magaziner while Carter spoke, having already
      // bound Louisiana to Carter from the recognition buried in the same turn.
      // Same permissive gap as `recognized`, and for the same reason: bounded to
      // honorific periods it could not survive a caption stutter, so the one
      // mechanism that recovers a hand-off from inside a merged turn never fired on
      // real text. The guards at the call site — a chair lead-in, and a minimum of
      // speech in front of it — are what keep this from splitting the chair's own
      // turns.
      // The chair recognises somebody in two voices and this only knew the passive
      // one. "THE GENTLEMAN FROM CALIFORNIA, MR. MIN, IS RECOGNIZED" was found;
      // "THE CHAIR RECOGNIZES THE GENTLEMAN FROM CALIFORNIA, MR. MIN, FOR FIVE
      // MINUTES" was not, because the verb comes before the state instead of after
      // it and there is no trailing RECOGNIZED for the pattern to end on. The
      // optional prefix looked like it covered the active form and never could:
      // everything after it still had to match the passive shape.
      //
      // The cost was not one turn. A recognition buried in somebody's turn and not
      // split out means the floor never changes hands, so the previous speaker
      // keeps the next member's words, and the next, until something else
      // intervenes. On 2026-09-15 two thirds of the day came back under a floor
      // manager's name and the Record shows 78 people spoke.
      embeddedRecognition: new RegExp(
        '(?:' +
          // active: THE CHAIR (NOW) RECOGNIZES THE GENTLEMAN FROM <state> ...
          '(?:THE\\s+)?CHAIR\\s+(?:NOW\\s+)?RECOGNIZES\\s+(?:THE\\s+)?' + GENT +
          '\\s+FROM\\s+(?:' + ST + ')\\b[^.]{0,60}\\.' +
        '|' +
          // passive: THE GENTLEMAN FROM <state>, MR. X, IS RECOGNIZED ...
          '(?:THE\\s+)?(?:CHAIR\\s+RECOGNIZES\\s+THE\\s+)?' + GENT + '\\s+FROM\\s+(?:' + ST + ')\\b' +
          '[\\s\\S]{0,60}?(?:IS\\s+)?(?:NOW\\s+)?RECOGNIZED[^.]{0,40}\\.' +
        ')', 'i'),
      // A question of personal privilege: the member is, by the nature of the
      // procedure, speaking about themselves. That is what makes a name inside the
      // speech usable here when it would be worthless anywhere else — members name
      // each other constantly, and almost never name themselves.
      personalPrivilege: /POINT\s+OF\s+PERSONAL\s+PRIVILEGE|QUESTION\s+OF\s+PERSONAL\s+PRIVILEGE/i,
      // A bare surname in running text, for that one case only.
      // No apostrophe in the class, so a possessive stops at the name: "THOMAS
      // MASSIE'S COMMENT" yields MASSIE, not MASSIES, which is one edit off and was
      // rejected by the exact-match requirement this relies on.
      bareName: /\b([A-Z][A-Z-]{3,})\b/g,
      // A Special Order or leadership hour, as opposed to a few minutes in debate.
      longRecognition: /RECOGNIZED\s+FOR\s+(?:\d{2,}|SIXTY|THIRTY|FORTY|FIFTY)\s*(?:-|\s)?\s*MINUTES|AS\s+THE\s+DESIGNEE/i,
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
      // The chair handing off to the reading clerk. In the live track there are no
      // turn boundaries to hang `clerkReading` off, so the instruction itself is the
      // event: from here until the next recognition, the voice is the clerk's.
      clerkCall: /\bCLERK\s+WILL\s+(?:REPORT|DESIGNATE|READ|CALL)\b/i,
      // Who is in the chair. In the House it is the Speaker (or a Speaker pro
      // tempore, who rotates through the day and is not named often enough to be
      // worth guessing at); in Committee of the Whole it is the Chair. Members
      // address them differently, which is the tell when the procedural line has
      // scrolled away: "MR. SPEAKER" against "MR. CHAIRMAN" or "MADAM CHAIR".
      intoCommittee: /RESOLVE[DS]?\s+ITSELF\s+INTO\s+THE\s+COMMITTEE\s+OF\s+THE\s+WHOLE|IN\s+THE\s+COMMITTEE\s+OF\s+THE\s+WHOLE/i,
      roseFromCommittee: /ROSE\s+FROM\s+THE\s+COMMITTEE\s+OF\s+THE\s+WHOLE|COMMITTEE\s+ROSE\b/i,
      addressesChair: /\b(?:MR\.|MADAM|MADAME)\s+CHAIR(?:MAN|WOMAN)?\b/i,
      addressesSpeaker: /\b(?:MR\.|MADAM|MADAME)\s+SPEAKER\b/i,
      // Either form of address, for the live path, which has no turn boundaries to
      // anchor to and needs to know only that SOMEBODY is addressing the chair.
      addressesFloor: new RegExp(
        '\\b(?:MR\\.|MADAM|MADAME)\\s+(?:SPEAKER|CHAIR(?:MAN|WOMAN)?)\\b|' +
        // First person on the floor. The chair speaks of itself as "the Chair" and
        // never in these terms, so each of these is a member and only a member.
        // Needed because members very often launch straight in after "WITHOUT
        // OBJECTION" without addressing anybody: the one-minutes are wall-to-wall
        // "I ASK UNANIMOUS CONSENT TO ADDRESS THE HOUSE FOR ONE MINUTE AND TO
        // REVISE AND EXTEND MY REMARKS", and every one of them was reading as the
        // chair still holding the floor.
        '\\bI\\s+(?:ASK|RISE|YIELD|THANK|MOVE|URGE|WOULD\\s+LIKE|WANT)\\b|' +
        '\\bREVISE\\s+AND\\s+EXTEND\\b|\\bMY\\s+REMARKS\\b|\\bUNANIMOUS\\s+CONSENT\\s+TO\\s+ADDRESS\\b',
        'gi'),
      // The instruction says what they are about to do, so capture it rather than
      // assuming. The clerk reads titles, but also designates resolutions, reports
      // amendments and calls the roll, and a line that always said "reading the
      // measure" was wrong for three of those four.
      clerkAction: /\bCLERK\s+WILL\s+(REPORT|DESIGNATE|READ|CALL)\s+(?:THE\s+)?([A-Z][A-Z' ]{2,40}?)\s*(?=[.,;]|$)/i,
      newMeasure: /MOVE\s+TO\s+SUSPEND\s+THE\s+RULES|CLERK\s+WILL\s+REPORT\s+THE\s+TITLE|PURSUANT\s+TO\s+THE\s+RULE/i,
    };
  }

  // "10 A.M. TOMORROW FOR MORNING HOUR DEBATE." -> "10 a.m. tomorrow".
  //
  // The trailing clause says what the House will do when it returns, not when, and
  // the sentence may run on past the adjournment into whatever follows.
  function cleanUntil(raw) {
    if (!raw) return null;
    let t = String(raw).replace(/\s+/g, ' ').trim();
    t = t.split(/\s+FOR\s+/i)[0];             // drop "FOR MORNING HOUR DEBATE"
    // Stop at a real sentence break. The obvious test — a period followed by a
    // capital — is useless here because every caption is capitalized throughout, and
    // it cut "10 A.M. TOMORROW" down to "10 A.M". Requiring three letters directly
    // before the period distinguishes the end of a word from the end of "A.M.".
    t = t.split(/(?<=[A-Z]{3})\.\s+/)[0];
    return t.replace(/[,.\s]+$/, '') || null;
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
    // yieldAway allows at most four words between TO and the noun for the person,
    // which is not enough when the manager introduces them by their seat on the
    // committee: "TO THE CHAIR OF THE ENERGY SUBCOMMITTEE. CONGRESSMAN LATTA" has
    // five, so the hand-off went undetected and Mr. Latta's two minutes stayed
    // under the manager's name. A named, resolvable target after YIELD ... TO is a
    // hand-off however long the words in between run.
    P.yieldTargetNoState.lastIndex = 0;
    while ((m = P.yieldTargetNoState.exec(text)) !== null) {
      if (!/\b(?:MYSELF|BACK)\b/i.test(m[1] || '')) return true;
    }
    return false;
  }

  // Phrases the chair uses immediately before recognising somebody. Text opening
  // with one of these is the chair's own, not a member's speech.
  // Note the optional leading "THE". Without it this never matched the commonest
  // form of all — "THE GENTLEMAN RESERVES." — and those turns were only saved from
  // being split in half by the length guard downstream, which is luck rather than
  // logic. Anything relaxing that guard would have started cutting chair turns.
  const CHAIR_LEADIN = /^(?:THE\s+)?(?:PURSUANT\s+TO|UNDER\s+THE\s+SPEAKER|WITHOUT\s+OBJECTION|FOR\s+WHAT\s+PURPOSE|FOR\s+PURPOSES?\b|CHAIR\b|BY\s+DIRECTION|HOUSE\s+WILL|QUESTION\s+IS|GENTLE\w+(?:'S)?\s+(?:YIELDS|RESERVES|TIME))/i;

  // Break out chair recognitions the stenographer buried inside a member's turn.
  //
  // A turn holding "...my remarks. THE GENTLEMAN FROM LOUISIANA, MR. CARTER, IS
  // RECOGNIZED FOR FIVE MINUTES. MR. SPEAKER, I rise..." is three turns wearing one
  // marker: the previous speaker, the chair, and the new speaker. Split so the rest
  // of the resolver sees what actually happened. A turn that BEGINS with the
  // recognition is already a chair turn and is left alone.
  function splitEmbeddedChairTurns(turns, P) {
    const out = [];
    for (const turn of turns) {
      let rest = turn.text;
      let guard = 0;
      while (guard++ < 8) {
        const m = P.embeddedRecognition.exec(rest);
        if (!m || m.index === 0) break;
        const before = rest.slice(0, m.index).trim();
        // The chair's own lead-ins sit in front of a recognition and belong with it:
        // "UNDER THE SPEAKER'S ANNOUNCED POLICY OF JANUARY 3RD, 2025, THE
        // GENTLEWOMAN FROM WYOMING, MS. HAGEMAN, IS RECOGNIZED FOR 60 MINUTES."
        // Splitting there tore the Special Order opening in half. What this is for
        // is a recognition buried behind somebody's SPEECH, which runs long and does
        // not open with the chair's vocabulary.
        if (CHAIR_LEADIN.test(before) || before.length < 60) break;
        if (before) out.push({ t: turn.t, text: before });
        out.push({ t: turn.t, text: m[0].trim() });
        rest = rest.slice(m.index + m[0].length).trim();
      }
      if (rest) out.push({ t: turn.t, text: rest });
    }
    return out;
  }

  // The last match in a turn, not the first.
  //
  // A chair turn routinely settles the previous speaker before naming the next —
  // "GENTLEMAN FROM RHODE ISLAND RESERVES. THE GENTLEMAN FROM TEXAS IS RECOGNIZED."
  // — so the recognition that matters is the one at the end. This is what lets the
  // gap inside those patterns be permissive without matching the wrong state.
  function lastMatch(re, text) {
    re.lastIndex = 0;
    let m, last = null;
    while ((m = re.exec(text)) !== null) {
      last = m;
      if (m.index === re.lastIndex) re.lastIndex++;   // guard against a zero-width match
    }
    return last;
  }

  // Which state was just recognised.
  //
  // Not a single pattern, because the two orderings fight each other. "THE CHAIR
  // RECOGNIZES THE GENTLEMAN FROM ARKANSAS" puts the state after the word; "THE
  // GENTLEMAN FROM ARKANSAS IS RECOGNIZED" puts it before. And a chair turn often
  // settles the last speaker before naming the next — "GENTLEMAN FROM RHODE ISLAND
  // YIELDS BACK. THE GENTLEMAN FROM TEXAS IS RECOGNIZED." — where one regex with a
  // loose gap simply swallows both states and reports the wrong one.
  //
  // So: take the last recognition in the turn and attach the NEAREST state mention
  // to it, whichever side it falls on. Proximity is what actually binds them.
  function recognitionState(text, P) {
    const states = [];
    P.stateMention.lastIndex = 0;
    let m;
    while ((m = P.stateMention.exec(text)) !== null) {
      states.push({ state: m[1], start: m.index, end: m.index + m[0].length });
    }
    if (!states.length) return null;

    P.recognizedWord.lastIndex = 0;
    let lastWord = null;
    while ((m = P.recognizedWord.exec(text)) !== null) lastWord = m.index;
    if (lastWord === null) return null;

    let best = null, bestGap = Infinity;
    for (const st of states) {
      // Before the word, or after it, whichever sits closer.
      const gap = st.end <= lastWord ? lastWord - st.end : st.start - lastWord;
      const limit = st.end <= lastWord ? 80 : 40;
      if (gap >= 0 && gap <= limit && gap < bestGap) { best = st.state; bestGap = gap; }
    }
    return best;
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
    // ...and who holds them. `bind` is the running "last member named from this
    // state" table, and a yield writes to it: when the Virginia manager yielded
    // five minutes to Mrs. Kiggans of Virginia, she replaced him in it. The chair's
    // next "THE GENTLEMAN FROM VIRGINIA IS RECOGNIZED" — him resuming control —
    // then resolved to her, and the row named a gentlewoman for a gentleman.
    // Control of time changes only when the chair assigns it, so it is recorded
    // when that happens and nothing else may overwrite it.
    let managerOf = {};
    // States whose next recognition belongs to a yield target we could not name.
    // The manager still controls time and resumes after them, so this is a single
    // recognition's worth of suppression rather than forgetting the seat.
    let unnamedYieldTo = new Set();
    // Whoever the chair gave a Special Order hour to. In that format the chair
    // recognises nobody after the opening, so the hour's holder is the only anchor
    // there is: they introduce each guest and speak again between them.
    let hourHolder = null;
    // 'in-session' | 'recess' | 'adjourned'. Nobody holds the floor in the last
    // two, and without this the final speaker of the night stays on screen over
    // the House's own "not in session" slate until the next morning — the broadcast
    // API is no help, its isLiveBroadcast flag was still "True" with an empty
    // endDate long after the Speaker had gavelled out.
    let sessionState = 'in-session';
    let sessionUntil = null;
    // 'speaker' | 'chair' — who is presiding, for the mark shown beside their turns.
    let presiding = 'speaker';
    // Set when the chair recognises someone on a point of personal privilege but
    // names only their state; cleared as soon as it is used or the floor moves on.
    let privilegeState = null;
    let floor = null;       // member the chair last handed the floor to
    let floorBasis = null;
    let pending = null;       // { member, state } named by a yielder, not yet recognised
    let pendingUnknown = false; // the floor was yielded away to somebody we could not name
    // ...and their delegation, when the yield named one. "I YIELD TWO MINUTES TO
    // THE GENTLEMAN FROM TEXAS, MR. NILS" gives a state and not a name, so an
    // unidentified Texan is the right answer. "I YIELD TO THE LEADER" gives an
    // office and neither, so there is no delegation to report — and purposeState,
    // which is only ever the state the CHAIR last recognised, is by then a fact
    // about the member who yielded rather than the one speaking. It said the
    // Democratic Leader of New York was an unidentified Virginian.
    let pendingUnknownState = null;
    let purposeState = null;
    let carried = 0;        // speech turns since the last explicit recognition

    // One turn can name the same seat twice in two different formulas, and the
    // two spellings need not agree — the chair opened the Iran debate with
    // "REPRESENTATIVE MOULTON OF MASSACHUSETTS" and "THE GENTLEMAN FROM
    // MASSACHUSETTS, MR. BOLTON" in a single breath. Collect every candidate in
    // the turn and keep the closest match per state, so the good spelling wins
    // regardless of which order they arrive in.
    // Returns the closest binding found, and records any state whose name could not
    // be read into `failed` — see the speech branch, which uses it to drop a stale
    // binding rather than hand the floor to the wrong member of that delegation.
    const bindFrom = (text, failed, opts) => {
      const seen = {};
      const take = (st, hit) => {
        if (!hit) return;
        if (!seen[st] || hit.distance < seen[st].distance) seen[st] = { member: hit.member, state: st, distance: hit.distance };
      };
      const offer = (rawState, surname, hon) => {
        const st = canonicalState(rawState, roster);
        const hit = matchSurname(surname, st, roster, genderOfHonorific(hon));
        if (!hit && failed) failed.add(st);
        take(st, hit);
      };
      const offerTokens = (rawState, tokens, hon) => {
        const st = canonicalState(rawState, roster);
        const hit = matchPersonTokens(tokens, st, roster, genderOfHonorific(hon));
        if (!hit && failed) failed.add(st);
        take(st, hit);
      };
      P.bind.lastIndex = 0;
      let m;
      while ((m = P.bind.exec(text)) !== null) offer(m[1], m[3], m[2]);
      // Names trailing a long appositive, which P.bind deliberately will not reach.
      if (opts && opts.yielding) {
        P.yieldNamed.lastIndex = 0;
        while ((m = P.yieldNamed.exec(text)) !== null) offer(m[1], m[3], m[2]);
        // ...and the same yield with no state given. Resolved against the whole
        // House, which matchSurname only does on an exact or near-exact spelling
        // and refuses outright on a tie, so an ambiguous "MR. SMITH" stays
        // unresolved rather than picking one of them.
        P.yieldTargetNoState.lastIndex = 0;
        while ((m = P.yieldTargetNoState.exec(text)) !== null) {
          if (/\b(?:MYSELF|BACK)\b/i.test(m[1] || '')) continue;
          const hit = matchSurname(m[3], null, roster, genderOfHonorific(m[2]));
          if (hit) take(hit.member.state, hit);
        }
      }
      P.nameOfState.lastIndex = 0;
      while ((m = P.nameOfState.exec(text)) !== null) offerTokens(m[3], m[2], m[1]);
      let found = null;
      for (const st of Object.keys(seen)) { bind[st] = seen[st].member; found = seen[st]; }
      return found;
    };

    // The seat that controls time, falling back to whoever was last named from
    // that state on a measure that never had managers assigned.
    const controller = (st) => managerOf[st] || bind[st];

    const timeline = [];
    let clerkNext = false;
    let clerkAction = null;
    for (const turn of splitEmbeddedChairTurns(turns, P)) {
      const text = turn.text;

      // The reading clerk announces the title between the motion and the debate.
      // Attributing that to whichever member last held the floor is the single
      // most visible error this resolver can make, so it is checked first.
      if (clerkNext && P.clerkReading.test(text)) {
        clerkNext = false;
        timeline.push({ t: turn.t, role: 'clerk', member: null, basis: 'clerk-reading', clerkAction, confidence: null, text });
        continue;
      }
      clerkNext = false;

      // Track who is in the chair. The explicit procedural lines are definitive;
      // how members address the chair is the running signal between them.
      if (P.roseFromCommittee.test(text)) presiding = 'speaker';
      else if (P.intoCommittee.test(text)) presiding = 'chair';
      else if (P.addressesChair.test(text)) presiding = 'chair';
      else if (P.addressesSpeaker.test(text)) presiding = 'speaker';

      // The Speaker gavelling out, checked before anything else. "THE HOUSE STANDS
      // ADJOURNED UNTIL 10 A.M. TOMORROW" contains none of the vocabulary the chair
      // detector keys on — no recognition, no yielding, no question — so placed
      // inside that branch it never ran at all.
      if (P.adjourned.test(text) || P.recessed.test(text)) {
        sessionState = P.adjourned.test(text) ? 'adjourned' : 'recess';
        sessionUntil = cleanUntil((P.until.exec(text) || [])[1]);
        floor = null; floorBasis = null; pending = null; pendingUnknown = false; pendingUnknownState = null;
        hourHolder = null; bind = {}; managerStates = []; managerOf = {}; unnamedYieldTo.clear(); carried = 0;
        timeline.push({ t: turn.t, role: 'chair', member: null, basis: sessionState, confidence: null, text });
        continue;
      }

      // A bare hand-off is only ever a short utterance from the chair. The length
      // guard and the self-address check together keep a member's own sentence
      // that happens to end in a state name ("...I YIELD TO THE GENTLEMAN FROM
      // MASSACHUSETTS.") from being mistaken for one.
      const isHandoff = text.length <= 90 && !P.selfAddress.test(text) && P.handoffTail.test(text);
      const isChair = isHandoff || P.chairFragment.test(text) ||
        (P.chair.test(text) && !P.selfAddress.test(text));

      if (isChair) {
        if (P.clerkCall.test(text)) { clerkNext = true; clerkAction = clerkActionPhrase(text, P); }
        const sh = isHandoff ? P.handoffTail.exec(text) : null;
        if (sh) {
          const st = canonicalState(sh[1], roster);
          // Remember the state either way: the chair frequently follows a hand-off
          // with a bare "GENTLEMAN RECOGNIZED.", and that turn has no state of its
          // own to work from.
          purposeState = st;
          if (controller(st)) { floor = controller(st); floorBasis = 'manager-binding'; }
          else if (stateCounts[st] === 1) { floor = roster.find((r) => r.state === st); floorBasis = 'sole-delegate'; }
          else { floor = null; floorBasis = 'state-only'; }
          pendingUnknown = false;   // the chair named a state; we are no longer blind
          carried = 0;
          timeline.push({ t: turn.t, role: 'chair', member: null, basis: null, presiding, confidence: null, text });
          continue;
        }
        const ctl = P.control.exec(text);
        const divided = !ctl && P.equallyDivided.test(text);
        if (divided) { bind = {}; pending = null; bindFrom(text); managerStates = Object.keys(bind); managerOf = Object.assign({}, bind); }
        if (ctl) {
          bind = {};                        // new measure: previous managers are done
          pending = null;
          unnamedYieldTo.clear();
          bindFrom(text);   // closest spelling per state, across both formulas
          for (const [rawSt, name] of [[ctl[1], ctl[2]], [ctl[3], ctl[4]]]) {
            const st = canonicalState(rawSt, roster);
            const hit = matchManagerName(name, st, roster);
            // Only fill a seat bindFrom could not: it already picked the closest
            // spelling, and this pair is the noisier of the two formulas.
            if (hit && !bind[st]) bind[st] = hit.member;
          }
          managerStates = [ctl[1], ctl[3]].map((x) => canonicalState(x, roster)).filter((x) => bind[x]);
          managerOf = {};
          for (const st of managerStates) managerOf[st] = bind[st];
        } else if (!divided) {
          bindFrom(text);
        }

        const pm = P.purpose.exec(text);
        if (pm) purposeState = canonicalState(pm[1], roster);

        const recState = recognitionState(text, P);
        if (recState) {
          const st = canonicalState(recState, roster);
          // Always remember the state, not just when it fails to resolve: the
          // chair follows a named recognition with a bare "THE GENTLEMAN IS
          // RECOGNIZED" constantly, and that turn carries no state of its own.
          purposeState = st;
          if (pending && pending.state === st) {
            floor = pending.member; floorBasis = 'yielded-named'; pending = null;
          } else if (unnamedYieldTo.has(st)) {
            // The seat yielded to somebody from its own delegation whose name the
            // stenographer mangled past recovery — "MR. NILS" for Mr. Nehls. This
            // recognition is that member, and the one person it is not is the
            // manager, so an unidentified Texan is the honest answer.
            floor = null; floorBasis = 'yield-unresolved';
            unnamedYieldTo.delete(st);
          } else if (controller(st)) {
            floor = ctl ? bind[st] : controller(st); floorBasis = ctl ? 'chair-named' : 'manager-binding';
          } else if (stateCounts[st] === 1) {
            floor = roster.find((r) => r.state === st); floorBasis = 'sole-delegate';
          } else {
            floor = null; floorBasis = 'state-only';
            // Only worth remembering when the speech that follows can settle it.
            privilegeState = P.personalPrivilege.test(text) ? st : null;
          }
          pendingUnknown = false;   // the chair named a state, so we are no longer blind
          if (floor && P.longRecognition.test(text)) hourHolder = floor;
          carried = 0;
        } else if (P.bareRecognized.test(text)) {
          if (pending) { floor = pending.member; floorBasis = 'yielded-named'; pending = null; }
          // The floor was just handed to someone whose name we could not read.
          // Falling back on purposeState here hands it to the MANAGER, who is the
          // one person we already know it is not — that is how Crow's three
          // minutes went out under Moulton's name.
          else if (pendingUnknown) { floor = null; floorBasis = 'yield-unresolved'; purposeState = pendingUnknownState; }
          else if (purposeState && controller(purposeState)) { floor = controller(purposeState); floorBasis = 'manager-binding'; }
          else if (purposeState && stateCounts[purposeState] === 1) { floor = roster.find((r) => r.state === purposeState); floorBasis = 'sole-delegate'; }
          else { floor = null; floorBasis = 'state-only'; }
          pendingUnknown = false; pendingUnknownState = null;
          carried = 0;
        }

        if (P.expired.test(text)) pending = null;

        timeline.push({ t: turn.t, role: 'chair', member: null, basis: null, presiding, confidence: null, text });
        continue;
      }

      // Anyone speaking on the floor means the House is back, whatever was declared
      // earlier — a recess ends without announcement.
      if (sessionState !== 'in-session') { sessionState = 'in-session'; sessionUntil = null; }

      // ── member speech ──
      // A hand-off named in the PREVIOUS turn lands here. In a bill debate the
      // chair usually confirms it first and this is already settled; in a Special
      // Order the chair says nothing at all, so adopting it here is the only thing
      // that moves the floor. Done before this turn is scanned, so a hand-off named
      // in THIS turn belongs to the next speaker, not to the current one.
      if (pending) {
        floor = pending.member; floorBasis = 'yielded-named'; pending = null; carried = 0;
      } else if (pendingUnknown) {
        // The previous turn gave the floor away to somebody we could not put a name
        // to, and this is them speaking. The member who yielded is the one person it
        // is definitely NOT, so holding their name here is worse than admitting we
        // do not know: "I YIELD TO THE LEADER FOR ONE MINUTE" ran the Leader's whole
        // minute under the yielder's name. Until now this only cleared at a chair
        // recognition, and a yield the chair never confirmed never got one.
        floor = null; floorBasis = 'yield-unresolved'; carried = 0;
        purposeState = pendingUnknownState;
        pendingUnknown = false; pendingUnknownState = null;
      }

      // A manager naming the next speaker mid-turn ("I YIELD TWO MINUTES TO THE
      // GENTLEMAN FROM UTAH, MR. OWENS") is the single richest source of names.
      const yieldsAway = yieldsFloorAway(text, P);
      const failedStates = new Set();
      const named = bindFrom(text, failedStates, { yielding: yieldsAway });
      // INVITE is the Special Order verb: "I NOW INVITE REPRESENTATIVE RALPH NORMAN
      // FROM SOUTH CAROLINA TO ADDRESS THE BODY". Only the member holding the hour
      // does the inviting, so the turn doing it is theirs — without this the
      // introduction is credited to the guest who just finished.
      const invites = /\bINVITE\b/i.test(text);
      if (invites && hourHolder && (!floor || floor.bioguideId !== hourHolder.bioguideId)) {
        floor = hourHolder; floorBasis = 'hour-holder'; carried = 0;
      }
      // Only a hand-off AWAY sets the next speaker, and that is what yieldsAway
      // tests for. A bare search for the word was wrong in both directions:
      // "THANK YOU TO MY COLLEAGUE FROM NEW YORK, MR. NADLER, FOR YIELDING" names
      // the member who yielded TO the person now speaking, and reading it as a
      // hand-off put Nadler's name on the following turn and the thanking member's
      // on this one. The Record grader caught exactly that on 2026-09-03.
      if (named && (yieldsAway || invites)) { pending = { member: named.member, state: named.state }; pendingUnknown = false; pendingUnknownState = null; }
      else if (yieldsAway) { pendingUnknown = true; pendingUnknownState = null; }

      // A yield that named a state but a surname we could not read means the floor
      // is going to SOMEONE ELSE from that delegation. Leaving the old binding in
      // place hands it to the member who was bound earlier — "I YIELD TWO MINUTES TO
      // THE GENTLEMAN FROM TEXAS ... MR. NILS" (Mr. Nehls, four letters and two
      // edits out, not recoverable) went to whichever Texan had been bound before.
      // Dropping it means the next "THE GENTLEMAN FROM TEXAS IS RECOGNIZED" reports
      // an unidentified Texan, which is what we actually know.
      if ((yieldsAway || invites) && failedStates.size) {
        for (const st of failedStates) {
          if (!named || named.state !== st) { delete bind[st]; unnamedYieldTo.add(st); pendingUnknown = true; pendingUnknownState = st; }
        }
      }

      // A member rising on personal privilege, recognised by state alone. The
      // delegation is known and the subject is the member themselves, so a single
      // member of that state named in the speech is them: "...LET ME TELL YOU HOW
      // STUPID THOMAS MASSIE'S COMMENT IS" is Mr. Massie, recognised as nothing more
      // than the gentleman from Kentucky, one of six.
      //
      // Deliberately narrow. Outside this procedure a name in running text is
      // whoever the speaker is talking ABOUT, which is almost never themselves, and
      // requiring exactly one match from the delegation keeps it from firing when
      // two Kentuckians are under discussion.
      if (!floor && privilegeState) {
        const hits = new Map();
        P.bareName.lastIndex = 0;
        let bm;
        while ((bm = P.bareName.exec(text)) !== null) {
          const hit = matchSurname(bm[1], privilegeState, roster);
          // Must be an exact name from THAT delegation. Without the scope check a
          // national fallback creeps in: this speech named Ro Khanna of California
          // five times, and with only "distance 0" required he counted as a second
          // Kentuckian and the rule declined.
          if (hit && hit.distance === 0 && hit.scope === 'state') hits.set(hit.member.bioguideId, hit.member);
        }
        if (hits.size === 1) {
          floor = [...hits.values()][0];
          floorBasis = 'personal-privilege';
          privilegeState = null;
          carried = 0;
        }
      }

      // Nobody thanks themselves by name. If this turn opens by thanking the
      // member we think is speaking, we are wrong — and saying nothing beats
      // putting one member's name on another's speech.
      if (floor) {
        P.thanksNamed.lastIndex = 0;
        let tm;
        while ((tm = P.thanksNamed.exec(text)) !== null) {
          const thanked = tm[1].toUpperCase().replace(/[^A-Z-]/g, '');
          if (editDistance(thanked, floor.last) <= allowedEdits(floor.last.length)) {
            // Thanking the previous speaker and introducing the next is what the
            // holder of a Special Order hour does between guests, so they are the
            // best remaining candidate. Marked distinctly, and at lower confidence,
            // because it is an inference from the shape of the format.
            if (hourHolder && hourHolder.bioguideId !== floor.bioguideId) {
              floor = hourHolder; floorBasis = 'hour-holder';
            } else {
              floor = null; floorBasis = 'contradicted';
            }
            carried = 0;
            break;
          }
        }
      }

      let confidence = null;
      if (floor) {
        confidence = { 'chair-named': 0.95, 'yielded-named': 0.95, 'manager-binding': 0.9, 'sole-delegate': 0.85, 'personal-privilege': 0.75, 'hour-holder': 0.7 }[floorBasis] || 0.7;
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

    // The reading clerk holds the floor while announcing a title, so `current` has
    // to be able to be them. Skipping clerk turns left the previous member named
    // over somebody else's voice for the length of the reading.
    const lastSpeech = [...timeline].reverse().find((x) => x.role === 'speech' || x.role === 'clerk' || x.role === 'chair');
    // Counted over the WHOLE session, never the slice the caller asked to see.
    // Computing it after the slice made "resolvedPct" mean "of the last N turns",
    // which reads as 100% any time the most recent turn happens to be resolved.
    const allSpeech = timeline.filter((x) => x.role === 'speech');
    const namedSpeech = allSpeech.filter((x) => x.member).length;
    return {
      timeline: options.limit ? timeline.slice(-options.limit) : timeline,
      speechTurns: allSpeech.length,
      resolvedTurns: namedSpeech,
      sessionState,
      sessionUntil,
      // Nobody is speaking once the House has risen, so do not hand back the last
      // member of the night as though they still were.
      current: sessionState === 'in-session' ? (lastSpeech || null) : null,
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
  // Characters between the chair's last words and the end of the caption buffer,
  // past which the floor has moved on. Swept against real captions: 40 gives 98%
  // at 28% recall, 100 gives 85% at 45%, and the knee is here.
  const CHAIR_RECENCY = 60;

  function resolveLiveFloor(text, roster, seedBind) {
    if (!text || !roster || !roster.length) return null;
    const P = buildPatterns(roster);
    const bind = Object.assign(Object.create(null), seedBind || {});
    const stateCounts = {};
    for (const r of roster) stateCounts[r.state] = (stateCounts[r.state] || 0) + 1;

    // Every event that can move the floor, found in one pass so they stay in
    // document order — order is the whole point, the last one wins.
    const events = [];
    const push = (index, kind, state, surname, hon) => events.push({ index, kind, state, surname, hon });

    P.bind.lastIndex = 0;
    let m;
    while ((m = P.bind.exec(text)) !== null) push(m.index, 'name', m[1], m[3], m[2]);
    P.nameOfState.lastIndex = 0;
    while ((m = P.nameOfState.exec(text)) !== null) push(m.index, 'tokens', m[3], m[2], m[1]);

    const scanAll = (re, kind, group) => {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let x;
      while ((x = g.exec(text)) !== null) push(x.index, kind, group ? x[group] : null, null);
    };
    scanAll(P.recognized, 'recognize', 1);
    scanAll(P.chairRecognizes, 'recognize', 1);
    scanAll(P.bareRecognized, 'recognize-bare');
    // The House rising is an event like any other, and being last is what matters:
    // a recognition before it is spent, a recognition after it means they are back.
    scanAll(P.adjourned, 'adjourned');
    scanAll(P.recessed, 'recess');
    scanAll(P.clerkCall, 'clerk');
    // The chair holding the floor is an event like the rest, and adding it fixes
    // two things at once. The Speaker's seal could never appear, because nothing
    // here had ever heard of the chair: over one afternoon's captions the live
    // resolver called 295 chair turns a member 212 times and the clerk 40 times,
    // and the chair 0. And the clerk's quill stuck, because 'clerk' stayed the
    // last event through every chair turn after the reading until the next
    // recognition — 46 false clerk turns against 17 real ones. The chair speaking
    // again is exactly what ends the reading, so ordering handles it.
    scanAll(P.chairSpeaks, 'chair');
    // A member addressing the chair — "MR. SPEAKER", "MADAM CHAIR" — is the one
    // reliable mark of a member speaking, and it is needed because a member very
    // often resumes with no recognition at all: "I ASK UNANIMOUS CONSENT...",
    // "WITHOUT OBJECTION, SO ORDERED.", and straight back to the member. Without
    // this the chair's line stayed the last event and the row put the Speaker's
    // seal over 114 turns of members talking. The chair never addresses itself.
    scanAll(P.addressesFloor, 'resume');

    events.sort((a, b) => a.index - b.index);

    let floor = null, basis = null, at = -1, lastNamed = null, lastState = null, presidingAt = -1, holder = null;
    for (const e of events) {
      if (e.kind === 'name' || e.kind === 'tokens') {
        const st = canonicalState(e.state, roster);
        const g = genderOfHonorific(e.hon);
        const hit = e.kind === 'tokens'
          ? matchPersonTokens(e.surname, st, roster, g)
          : matchSurname(e.surname, st, roster, g);
        if (hit) { bind[st] = hit.member; lastNamed = { member: hit.member, state: st, index: e.index }; }
        continue;
      }
      if (e.kind === 'clerk') {
        holder = 'clerk'; at = e.index; lastNamed = null;
        continue;
      }
      if (e.kind === 'chair') {
        holder = 'chair'; at = e.index;
        continue;
      }
      if (e.kind === 'resume') {
        // Back to whoever was recognised. The floor attribution is untouched —
        // this says the interruption is over, not who is speaking.
        holder = 'member'; at = e.index;
        continue;
      }
      if (e.kind === 'adjourned' || e.kind === 'recess') {
        floor = null; basis = e.kind; holder = e.kind; at = e.index; lastNamed = null;
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
      holder = 'member';
      if (st) lastState = st;
    }

    if (at < 0) return null;   // nothing in this text moves the floor
    // The chair's utterances are short and a member usually resumes straight after
    // one without any recognition to mark it, so a chair phrase that is no longer
    // the most recent thing said is the chair who HAS spoken, not the chair
    // speaking. Measured over an afternoon of captions, requiring it within 60
    // characters of the end takes the mark from 81% right to 97% right; it shows
    // for 43% of the chair's turns instead of 55%, which is the trade this site
    // makes everywhere else — silence over a confident wrong answer.
    if (holder === 'chair' && (text.length - at) <= CHAIR_RECENCY) {
      // Which chair: the Speaker gets the seal of the office, the Chair of the
      // Committee of the Whole gets the silhouette, because that one rotates among
      // members all day and naming them would be a guess. Last signal wins.
      let presiding = 'speaker';
      for (const re of [[P.intoCommittee, 'chair'], [P.roseFromCommittee, 'speaker'],
                        [P.addressesChair, 'chair'], [P.addressesSpeaker, 'speaker']]) {
        const g = new RegExp(re[0].source, 'gi');
        let x, last = -1;
        while ((x = g.exec(text)) !== null) last = x.index;
        if (last > (presidingAt || -1)) { presiding = re[1]; presidingAt = last; }
      }
      return { member: null, basis: 'chair', presiding, fromEnd: text.length - at };
    }
    if (holder === 'clerk') {
      return { member: null, basis: 'clerk', clerkAction: clerkActionPhrase(text.slice(at), P), fromEnd: text.length - at };
    }
    if (basis === 'adjourned' || basis === 'recess') {
      return { member: null, basis, sessionUntil: cleanUntil((P.until.exec(text.slice(at)) || [])[1]), fromEnd: text.length - at };
    }
    // A 'resume' — or a chair phrase too far back to still be current — marks a
    // position in the text without moving the floor. Neither says anything about
    // who is speaking, so the contract still holds: nothing found, nothing
    // returned, and the caller keeps the server's answer rather than blanking a
    // correct name mid-speech.
    if (!basis) return null;
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

  // "THE CLERK WILL REPORT THE TITLE OF THE BILL." -> "reading the bill title"
  //
  // The chair's phrasing is longer than the line it has to fit in — "reading the
  // title of the bill" overran the panel at its narrowest by 22px, and that is the
  // commonest case of all. The frequent objects get a shorter equivalent; anything
  // unrecognised passes through and ellipses if it must.
  const CLERK_OBJECT_SHORT = {
    'title of the bill': 'the bill title',
    'title of the resolution': 'the resolution title',
    'message from the senate': 'a senate message',
    'message from the president': 'a message from the president',
  };
  function clerkActionPhrase(text, P) {
    const m = P.clerkAction.exec(text || '');
    if (!m) return null;
    const verb = { REPORT: 'reading', READ: 'reading', DESIGNATE: 'designating', CALL: 'calling' }[m[1].toUpperCase()] || 'reading';
    const raw = m[2].toLowerCase().replace(/\s+/g, ' ').trim();
    return `${verb} ${CLERK_OBJECT_SHORT[raw] || 'the ' + raw}`;
  }

  // Which of the three things the speaker row can be showing: the presiding
  // officer, the reading clerk, or a member.
  //
  // Extracted from the client because the way it used to be written there was
  // wrong in a way nothing could catch — the chair branch ran only when the live
  // resolver returned NOTHING AT ALL, and the clerk branch deferred to the live
  // resolver whenever it returned anything. `live` is non-null almost
  // continuously while the House is sitting, so between them those two
  // conditions made the Speaker's seal and the clerk's quill unreachable, for
  // months, silently. The rule is about time, not about existence, and now it is
  // one function with a test.
  //
  // liveFresh means: the live track's latest floor-moving event is recent enough
  // to still be the latest one. When it is, the live track decides.
  //
  // serverFresh is the same question asked of the server's snapshot, and the two
  // institutional marks need it where a member name does not. A name that is a
  // minute behind is still worth showing, and says so — "up to 1m behind". But the
  // clerk's quill is not a name, it is the assertion THE CLERK IS READING RIGHT
  // NOW, and a reading lasts about fifteen seconds while the sidecar can be two
  // minutes back. Shown off a stale snapshot it appears after the clerk has sat
  // down and then sits there. Same for the chair. So they are asserted only from
  // evidence fresh enough for the present tense to be true, and otherwise the row
  // falls through to the member path, which can be honest about its own age.
  // How long an institutional mark must have been the answer before the row
  // shows it. The chair's turns are mostly a single sentence — over one
  // afternoon, 43 spells with a MEDIAN OF 2.2 SECONDS, 77% of them under five —
  // so the Speaker's seal was appearing for two seconds and vanishing again,
  // correct every time and useless. Waiting four seconds suppresses 30 of those
  // 43 flashes and still keeps 95% of the time the chair is genuinely holding the
  // floor, which is the whole of what the mark is for.
  //
  // The clerk gets the same wait and loses nothing: readings run a median of 16
  // seconds, so all 20 in that afternoon survive it. It also cures a smaller
  // problem — the quill fired on the chair SAYING "the clerk will report", about
  // two seconds before the reading, and now lands just after it starts.
  //
  // A member needs no wait. Their spells run a median of nearly two minutes, and
  // they are what the row falls back to while a mark is still settling.
  const MARK_DWELL_MS = 4000;

  function markHasSettled(role, sinceMs, now, dwellMs) {
    if (role !== 'chair' && role !== 'clerk') return true;
    if (!sinceMs) return false;
    return (now - sinceMs) >= (typeof dwellMs === 'number' ? dwellMs : MARK_DWELL_MS);
  }

  function floorRole(live, liveFresh, current, serverFresh) {
    if (liveFresh && live) {
      if (live.basis === 'clerk') return 'clerk';
      if (live.basis === 'chair') return 'chair';
      return 'member';   // a live event this recent outranks the server's role
    }
    if (serverFresh && current && current.role === 'chair') return 'chair';
    if (serverFresh && current && current.role === 'clerk') return 'clerk';
    return 'member';
  }

  root.HouseFloorSpeaker = {
    clerkActionPhrase, floorRole, markHasSettled, MARK_DWELL_MS,
    resolveLiveFloor, dedupeLiveCues, matchPersonTokens, cleanUntil, splitEmbeddedChairTurns, lastMatch, recognitionState,
    buildRoster, parseCaptionCues, splitTurns, matchSurname, matchManagerName, editDistance, genderOf,
    resolveFloorSpeakers, buildPatterns, canonicalState,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
