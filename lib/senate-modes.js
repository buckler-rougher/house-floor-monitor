// The Senate's floor modes: which panel is the board's headline right now.
//
// The House picks a mode from the Clerk's proceedings feed. The Senate has no such feed
// (its record of a sitting is published after the sitting ends), so the only live signal
// is the caption track. This reads it for the parts of a Senate day that have a fixed
// shape: the opening prayer and pledge, morning business, the leaders' daily remarks, and
// the wrap-up. A roll call or a quorum call is not a mode here: those are
// lib/senate-call.js, and they take the board over whenever one is on.
//
// RUNS IN THE WORKER, like lib/senate-call.js: it reads the caption segments and the tab only
// draws what it is told, so every viewer sees the same mode and one who joins mid-prayer
// sees it too. (A tab-side copy of this ran first and was wrong to: two readers of one
// caption stream disagree.)
//
// TWO LAYERS. A BASE mode is one of prayer, pledge, morning business or wrap-up: one at a
// time, the latest opening replaces the last. A LEADER overlay sits on top while a leader
// has the floor for the daily remarks and falls back to the base mode it interrupted.
//
// LEADER REMARKS ARE NOT "A LEADER IS TALKING". The leaders are recognized all day for
// unanimous-consent requests and debate. What is a mode is the daily remarks: a set part of
// the day that the Democratic Caucus schedule calls "Following Leader remarks, the Senate will
// resume ...". In the Record's 27 full days from July to October neither leader has a heading
// for it more than once, and it sits right after the opening (in the first 8 to 13 items). So
// each leader's FIRST recognition after the day's opening is the remarks, once per leader per
// day, and every later recognition is ordinary speech and no mode. A Worker that missed the
// opening (a cold start mid-day) shows no leader mode rather than guess.
//
// WHAT THE WORDINGS REST ON. The Congressional Record (the Senate's own transcript, next
// morning) for 42 sitting days: the chair opens morning business with "the Senate [will] be
// in a period of morning business, with Senators permitted to speak therein for up to 10
// minutes each" on every full day sampled, and closes it with "Morning business is
// closed."; leaders are recognized as "The majority leader is recognized." and "The
// Democratic leader is recognized." (the chair says Democratic, not minority). The prayer
// and pledge cues are checked the same way. NONE has been matched against the CAPTION
// track, which is the captioner's text, so spelling and punctuation may differ (the
// recorder captured nothing before 2 October). A missed cue means the board stays on its
// default, which is the failure to prefer over a wrong mode.
//
// Captions roll: each cue repeats the one before plus a few words, and a phrase stays in
// the window for a minute or more after it was spoken. So a mode starts on a cue and is
// held until its closing phrase (plus a short hold so the panel is not gone the instant
// the last word lands), with a ceiling so a missed closing phrase cannot strand the board,
// and a cooldown so the same phrase still rolling past cannot start it again.

(function (root) {
  const MIN = 60 * 1000;
  const BASE = {
    prayer: {
      start: /\bLET US PRAY\b|\bOFFERED THE FOLLOWING PRAYER\b|\bPRAYER WILL BE OFFERED\b|\bCHAPLAIN\b[^:]{0,90}\b(?:OFFERED?|LEAD|LEADS|DELIVERED?)\b/i,
      end: /\bAMEN\b/i,
      holdMs: 10 * 1000, maxMs: 6 * MIN, cooldownMs: 3 * MIN,
    },
    pledge: {
      start: /\bI PLEDGE ALLEGIANCE\b/i,
      end: /\bLIBERTY AND JUSTICE FOR ALL\b|\bJUSTICE FOR ALL\b/i,
      holdMs: 10 * 1000, maxMs: 90 * 1000, cooldownMs: 3 * MIN,
    },
    // Morning business has no length of its own: it lasts until the chair closes it, and on
    // a day with a long morning that is hours. The ceiling is only a backstop.
    'morning-business': {
      start: /\bPERIOD OF MORNING BUSINESS\b/i,
      end: /\bMORNING BUSINESS IS CLOSED\b/i,
      holdMs: 5 * 1000, maxMs: 4 * 60 * MIN, cooldownMs: 2 * MIN,
    },
    // The majority leader's end-of-day unanimous-consent request, which sets the next
    // convening. Opens with the same sentence on every full day in the Record ("complete" on
    // one, "when the Senate adjourns on Thursday" on another). It ends when the chair declares
    // the Senate adjourned, which can follow the Democratic leader's closing remarks. This
    // mode says only that the wrap-up is happening: the Democratic Caucus posts its breakdown
    // AFTER the majority leader has read it, so there is nothing to show beside it live.
    'wrap-up': {
      start: /\bI ASK UNANIMOUS CONSENT THAT WHEN THE SENATE (?:COMPLETES?|ADJOURNS)\b/i,
      end: /\bTHE SENATE STANDS ADJOURNED\b/i,
      holdMs: 20 * 1000, maxMs: 90 * MIN, cooldownMs: 60 * MIN,
    },
  };

  // The chair recognizes a leader, or somebody else. The last one in a cue wins, because a
  // cue can hold both the previous recognition and this one.
  const LEADER_RE = /\bTHE (MAJORITY|DEMOCRATIC|REPUBLICAN|MINORITY) LEADER IS RECOGNIZED\b/gi;
  const OTHER_RE = /\bTHE (?:SENATOR|SENATORS) FROM [A-Z .'-]{3,30}? IS RECOGNIZED\b|\bTHE (?:ASSISTANT )?(?:MAJORITY|DEMOCRATIC|REPUBLICAN|MINORITY) WHIP IS RECOGNIZED\b/gi;
  const LEADER = { maxMs: 30 * MIN, holdMs: 0 };
  const LABEL_WINDOW_MS = 60 * 1000;
  const LEADER_TITLE = { majority: 'Majority Leader', democratic: 'Democratic Leader', minority: 'Democratic Leader', republican: 'Republican Leader' };
  const LIMIT_RE = /\bUP TO (\d{1,2}) MINUTES EACH\b/i;

  const empty = () => ({ base: null, leader: null, cooldown: {}, day: { opened: false, leaders: {} } });

  function lastMatch(re, text) {
    let last = null, m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) last = { index: m.index, m };
    return last;
  }

  // Take one caption cue (already flattened) at `now`. Returns the new state.
  function feed(state, text, now) {
    const t = String(text || '');
    if (!t) return state;
    const s = {
      base: state.base && { ...state.base }, leader: state.leader && { ...state.leader }, cooldown: { ...state.cooldown },
      day: { opened: !!(state.day && state.day.opened), leaders: { ...(state.day && state.day.leaders) } },
    };

    // A closing phrase ends the base mode, once, and starts its cooldown at once so the
    // same words still in the window cannot restart it.
    const cur = s.base && BASE[s.base.mode];
    if (cur && !s.base.endedAt && cur.end.test(t)) { s.base.endedAt = now; s.cooldown[s.base.mode] = now; }

    // An opening starts one, unless that kind only just ended and this is the same words
    // still in the window. The pledge follows the prayer, so it may take over.
    for (const [kind, rule] of Object.entries(BASE)) {
      if (s.base && s.base.mode === kind && !s.base.endedAt) continue;
      if (!rule.start.test(t)) continue;
      if (now - (s.cooldown[kind] || -Infinity) < rule.cooldownMs) continue;
      s.base = { mode: kind, since: now, endedAt: 0 };
      // The day has opened once a prayer or a pledge has been heard; the leaders' remarks come after.
      if (kind === 'prayer' || kind === 'pledge') s.day.opened = true;
      break;
    }
    // How long each senator may speak is the chair's own statement, so it is shown as heard.
    if (s.base && s.base.mode === 'morning-business') {
      const lim = LIMIT_RE.exec(t);
      if (lim) s.base.limit = Number(lim[1]);
    }

    // The leader overlay: whichever recognition comes last in the cue decides.
    const lead = lastMatch(LEADER_RE, t), other = lastMatch(OTHER_RE, t);
    if (lead && (!other || lead.index > other.index)) {
      const which = LEADER_TITLE[lead.m[1].toLowerCase()];
      const L = s.leader;
      if (L && !L.endedAt && L.which === which) { /* same leader, still the one speaking */ }
      else if (s.day.opened && !s.day.leaders[which]) {
        // A different leader being recognized ends the first and starts the second.
        s.leader = { which, since: now, endedAt: 0, first: null };
        s.day.leaders[which] = true;
      }
    } else if (other && s.leader && !s.leader.endedAt) {
      s.leader.endedAt = now;
    }
    return s;
  }

  // The speaker latched by lib/senate-speaker.js. A leader overlay is about whoever speaks
  // right after the chair recognizes them, so the first member label seen is the leader
  // and a different one means the leader has finished.
  function speaker(state, label, now) {
    const L = state.leader;
    if (!L || L.endedAt || !label) return state;
    // The leader's label follows the recognition within a moment. If the leader was already the
    // latched speaker no label changes, and the next one to arrive is somebody else's: after
    // LABEL_WINDOW_MS the leader's label is taken as not knowable rather than guessed.
    if (L.first === '') return state;
    if (!L.first) {
      return { ...state, leader: { ...L, first: now - L.since > LABEL_WINDOW_MS ? '' : label } };
    }
    if (L.first === label) return state;
    return { ...state, leader: { ...L, endedAt: now } };
  }

  const alive = (b, rule, now) =>
    b && !(b.endedAt && now - b.endedAt >= rule.holdMs) && now - b.since < rule.maxMs;

  // What is on screen at `now`: { mode, ... } or null. Pure: expiry is read, not stored,
  // so a state nobody has touched for ten minutes answers null without a timer.
  function current(state, now) {
    if (alive(state.leader, LEADER, now)) return { mode: 'leader', which: state.leader.which, since: state.leader.since, first: state.leader.first || null };
    const b = state.base;
    if (b && alive(b, BASE[b.mode], now)) return { mode: b.mode, since: b.since, limit: b.limit || null };
    return null;
  }

  // Drop what has expired, keeping the cooldowns that stop a finished mode restarting.
  function settle(state, now) {
    const s = { base: state.base, leader: state.leader, cooldown: { ...state.cooldown }, day: state.day };
    if (s.base && !alive(s.base, BASE[s.base.mode], now)) { s.cooldown[s.base.mode] = s.base.endedAt || s.base.since; s.base = null; }
    if (s.leader && !alive(s.leader, LEADER, now)) s.leader = null;
    return s;
  }

  root.SenateModes = { RULES: BASE, empty, feed, speaker, current, settle };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateModes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
