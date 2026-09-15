/**
 * The Congressional Record as ground truth for who spoke on the House floor.
 *
 * WHY THIS FILE EXISTS
 * lib/floor-speaker.js INFERS names from the parliamentary ritual in the Clerk's
 * captions, because the captions name nobody. That inference is wrong sometimes,
 * and the failures are invisible in aggregate: across one evening the resolved
 * share climbed 76% -> 84% while the live header was, at four separate moments,
 * confidently showing the wrong member. Every one of those was caught by a human
 * watching the floor and saying so. That does not scale and it does not run
 * overnight.
 *
 * GPO publishes the Record the next morning with every speech granule tagged by
 * bioguide ID, free and with no API key:
 *
 *   https://www.govinfo.gov/metadata/pkg/CREC-YYYY-MM-DD/mods.xml
 *
 *   <congMember bioGuideId="B001292" chamber="H" role="SPEAKING" state="VA">
 *     <name type="parsed">Mr. BEYER</name>
 *
 * So yesterday can always be graded exactly, which turns "the resolver seems to
 * be doing well" into a list of the specific turns it got wrong.
 *
 * WHAT COUNTS AS SPOKEN
 * Only pagePrefix H. The Record also carries E pages (Extensions of Remarks —
 * text SUBMITTED for printing, never uttered on the floor) and D pages (the Daily
 * Digest, a summary). Counting E pages would credit the resolver for members who
 * were not in the room, and on 2026-09-03 they were 41 of 155 granules.
 *
 * Role must be SPEAKING; the same element is also used with SUBMITTING.
 *
 * LOADING
 * Same globalThis convention as lib/bill-id.js and lib/floor-speaker.js.
 */
(function (root) {
  'use strict';

  // Granule ids carry their own order: CREC-2026-09-03-pt1-PgH5481-5 is page
  // H5481, fifth item. Sorting the strings lexically puts H999 after H5481, so
  // the page number and sub-index are pulled out and compared numerically.
  function granuleOrder(accessId) {
    const m = /PgH(\d+)(?:-(\d+))?/.exec(accessId || '');
    if (!m) return [Infinity, Infinity];
    return [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 1];
  }

  /**
   * Ordered list of House floor speeches from a CREC mods.xml.
   * @returns {Array<{bioguideId, parsedName, state, party, granule, title, page, index}>}
   */
  function parseCrecSpeakers(modsXml) {
    const out = [];
    if (typeof modsXml !== 'string') return out;

    // Split on the constituent boundary rather than matching a balanced element:
    // mods.xml nests relatedItem inside relatedItem, so a lazy
    // <relatedItem>...</relatedItem> match closes on the wrong tag.
    const chunks = modsXml.split(/(?=<relatedItem type="constituent")/);
    for (let i = 1; i < chunks.length; i++) {
      const b = chunks[i];
      const idm = /ID="id-(CREC-[^"]+)"/.exec(b);
      if (!idm) continue;
      const granule = idm[1];
      const prefix = (/<pagePrefix>([^<]*)<\/pagePrefix>/.exec(b) || [, ''])[1];
      if (prefix !== 'H') continue;                        // floor only — see header
      const title = (/<title>([^<]*)<\/title>/.exec(b) || [, ''])[1];
      const [page, index] = granuleOrder(granule);

      const memRe = /<congMember\s([^>]*)>([\s\S]*?)<\/congMember>/g;
      let mm;
      while ((mm = memRe.exec(b)) !== null) {
        const attrs = mm[1];
        if (!/role="SPEAKING"/.test(attrs)) continue;      // not SUBMITTING
        const bioguideId = (/bioGuideId="([^"]+)"/.exec(attrs) || [, ''])[1];
        if (!bioguideId) continue;
        out.push({
          bioguideId,
          parsedName: (/<name type="parsed">([^<]*)<\/name>/.exec(mm[2]) || [, ''])[1].trim(),
          state: (/state="([^"]+)"/.exec(attrs) || [, ''])[1],
          party: (/party="([^"]+)"/.exec(attrs) || [, ''])[1],
          granule, title, page, index,
        });
      }
    }
    out.sort((a, b) => (a.page - b.page) || (a.index - b.index));
    return out;
  }

  // Longest common subsequence length — used to score ORDER, not just membership.
  // Two runs can contain the same set of members while the resolver had the
  // hand-offs backwards, and that is the failure that puts one member's name on
  // another's speech.
  function lcsLength(a, b) {
    if (!a.length || !b.length) return 0;
    let prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array(b.length + 1).fill(0);
      for (let j = 1; j <= b.length; j++) {
        cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // Collapse consecutive turns by the same member into one entry: the Record has
  // one granule per speech, the captions have many turns per speech, so comparing
  // them turn-for-turn would measure caption chunking rather than attribution.
  function runs(ids) {
    const out = [];
    for (const id of ids) if (id && id !== out[out.length - 1]) out.push(id);
    return out;
  }

  /**
   * Score a resolved timeline against the Record for the same day.
   *
   * `unconfirmed` is the number that matters: members the site named who the
   * Record says never spoke on the floor that day. Those are unambiguously wrong,
   * and they are grouped by `basis` so the failing rule is named rather than
   * guessed at.
   */
  function gradeTimeline(timeline, crecSpeakers) {
    const speech = (timeline || []).filter((x) => x.role === 'speech');
    const ours = speech.filter((x) => x.member && x.member.bioguideId);

    // No Record for this day means NOT GRADED, never "everything is wrong". The
    // Record lands the morning after, so grading today mid-session finds an empty
    // set and would otherwise declare every correctly-identified member a false
    // positive — the one output that would make this tool worth ignoring.
    if (!crecSpeakers || !crecSpeakers.length) {
      return {
        graded: false,
        reason: 'no House floor speeches in the Record for this date (not published yet, or no session)',
        speechTurns: speech.length,
        attributedTurns: ours.length,
        coveragePct: speech.length ? Math.round((ours.length / speech.length) * 100) : null,
      };
    }

    const crecSet = new Set(crecSpeakers.map((s) => s.bioguideId));
    const ourSet = new Set(ours.map((x) => x.member.bioguideId));

    const confirmed = [...ourSet].filter((id) => crecSet.has(id));
    const unconfirmed = [...ourSet].filter((id) => !crecSet.has(id));
    const missed = [...crecSet].filter((id) => !ourSet.has(id));

    // Which rule produced each unconfirmed name, and how many turns it affected.
    const byBasis = {};
    for (const x of ours) {
      const bad = !crecSet.has(x.member.bioguideId);
      const b = x.basis || 'unknown';
      byBasis[b] = byBasis[b] || { turns: 0, unconfirmedTurns: 0 };
      byBasis[b].turns++;
      if (bad) byBasis[b].unconfirmedTurns++;
    }

    const ourRuns = runs(ours.map((x) => x.member.bioguideId));
    const crecRuns = runs(crecSpeakers.map((s) => s.bioguideId));
    const lcs = lcsLength(ourRuns, crecRuns);

    const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
    return {
      graded: true,
      speechTurns: speech.length,
      attributedTurns: ours.length,
      coveragePct: pct(ours.length, speech.length),
      crecSpeakers: crecSet.size,
      ourSpeakers: ourSet.size,
      confirmed: confirmed.length,
      // Share of the members we named that the Record confirms spoke. Anything
      // below 100% means the site printed a name that did not speak.
      precisionPct: pct(confirmed.length, ourSet.size),
      recallPct: pct(confirmed.length, crecSet.size),
      // How much of the Record's speaking ORDER we reproduced.
      sequencePct: pct(lcs, crecRuns.length),
      unconfirmedIds: unconfirmed,
      missedIds: missed,
      byBasis,
    };
  }

  root.Crec = { parseCrecSpeakers, gradeTimeline, granuleOrder, lcsLength, runs };
})(typeof globalThis !== 'undefined' ? globalThis : this);
