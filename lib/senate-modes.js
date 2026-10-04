// The Senate's floor modes: which panel is the board's headline right now.
//
// The House picks a mode from the Clerk's proceedings feed. The Senate has no such feed
// (its record of a sitting is published after the sitting ends), so the only live signal
// is the caption track. This reads it for the two openings every day starts with, the
// prayer and the pledge. A roll call or a quorum call is not a mode here: those are
// lib/senate-call.js, and they take the board over whenever one is on.
//
// WORDINGS ARE NOT CONFIRMED. The caption recorder captured nothing before 2 October, so
// none of these patterns has been matched against a real Senate caption. The pledge text
// is the statutory wording and is as safe as a pattern gets; the prayer cues are the
// chair's and the Chaplain's stock phrases and are a best guess. Check them against the
// first real capture (AGENTS.md, Open issues). Until then a missed opening means the board
// stays on its default, which is the failure to prefer over a wrong mode.
//
// Captions roll: each cue repeats the one before plus a few words, and a phrase stays in
// the window for a minute or more after it was spoken. So a mode starts on a cue and is
// held until its closing phrase (plus a short hold so the panel is not gone the instant
// the last word lands), with a ceiling so a missed closing phrase cannot strand the board,
// and a cooldown so the same phrase still rolling past cannot start it again.

(function (root) {
  const RULES = {
    prayer: {
      start: /\bLET US PRAY\b|\bOFFERED THE FOLLOWING PRAYER\b|\bPRAYER WILL BE OFFERED\b|\bCHAPLAIN\b[^.]{0,60}\b(?:OFFERED?|LEAD|LEADS|DELIVERED?)\b/i,
      end: /\bAMEN\b/i,
      holdMs: 10 * 1000,
      maxMs: 6 * 60 * 1000,
      cooldownMs: 3 * 60 * 1000,
    },
    pledge: {
      start: /\bI PLEDGE ALLEGIANCE\b/i,
      end: /\bLIBERTY AND JUSTICE FOR ALL\b|\bJUSTICE FOR ALL\b/i,
      holdMs: 10 * 1000,
      maxMs: 90 * 1000,
      cooldownMs: 3 * 60 * 1000,
    },
  };

  const empty = () => ({ mode: null, since: 0, endedAt: 0, cooldown: {} });

  // Take one caption cue (already flattened) at `now`. Returns the new state.
  function feed(state, text, now) {
    const s = { ...state, cooldown: { ...state.cooldown } };
    const t = String(text || '');
    if (!t) return s;

    // A closing phrase ends the mode we are in, once.
    const cur = s.mode && RULES[s.mode];
    if (cur && !s.endedAt && cur.end.test(t)) { s.endedAt = now; s.cooldown[s.mode] = now; }

    // An opening starts one, unless that kind only just ended and this is the same
    // words still in the window. The pledge follows the prayer, so it may take over.
    for (const [kind, rule] of Object.entries(RULES)) {
      if (kind === s.mode && !s.endedAt) continue;
      if (!rule.start.test(t)) continue;
      if (now - (s.cooldown[kind] || -Infinity) < rule.cooldownMs) continue;
      s.mode = kind; s.since = now; s.endedAt = 0;
      break;
    }
    return s;
  }

  // The mode on screen at `now`, or null. Pure: expiry is read, not stored, so a state
  // that nobody has touched for ten minutes answers null without a timer.
  function current(state, now) {
    const rule = state.mode && RULES[state.mode];
    if (!rule) return null;
    if (state.endedAt && now - state.endedAt >= rule.holdMs) return null;
    if (now - state.since >= rule.maxMs) return null;
    return state.mode;
  }

  // Fold a finished mode into the cooldown so it cannot restart. Call after `current`
  // returns null for a state whose mode is set.
  function settle(state, now) {
    if (!state.mode || current(state, now)) return state;
    return { mode: null, since: 0, endedAt: 0, cooldown: { ...state.cooldown, [state.mode]: state.endedAt || state.since } };
  }

  root.SenateModes = { RULES, empty, feed, current, settle };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateModes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
