// The OPENING DAY CARD: the steps of the first day of a Congress that the Clerk's log records and the page has no card for. From the quorum call to the Speaker's oath the log says (3 January 2025):
//   12:36  Call by States Quorum responded: 433 present
//   2:36   COMMITTEE TO ESCORT THE SPEAKER-ELECT - The Acting Clerk appointed a Committee of Members-elect to escort the Speaker-elect ...
//   2:50   The Speaker-elect was escorted into the Chamber by the Escort Committee and introduced by Representative-elect Jeffries ...
//   3:05   ADDRESS BY THE SPEAKER-ELECT - The Speaker-elect addressed the House prior to taking the Oath of Office ...
// and in between and after, the cards the page has (certification, tellers, the oaths) and the Speaker election panel (lib/speaker-panel.js) take their turns. This card is shown while the newest of
// those four entries is one of the latest in the log, and steps aside when a card of its own takes over or a long time has passed.
//
//   OpeningDay.pick(items, now)       -> { kind, text, at } | null     (pure; items newest first, as the log is)
//   OpeningDay.mount()                draws #opening-day from the page's log (`proceedingsData`), every few seconds
(function (root) {
  'use strict';

  const KINDS = [
    { re: /^Call by States Quorum responded:\s*(\d+)\s+present/i, kind: 'QUORUM CALL', cls: 'se-k-quorum', text: (m) => `The roll was called by States to find a quorum: ${m[1]} Members-elect responded present.` },
    { re: /^COMMITTEE TO ESCORT THE SPEAKER-ELECT\s*-\s*(.+)/i, kind: 'ESCORT COMMITTEE', cls: 'se-k-escort', text: (m) => m[1] },
    { re: /^The Speaker-elect was escorted into the Chamber(.*)/i, kind: 'SPEAKER-ELECT ESCORTED', cls: 'se-k-escort', text: (m) => `The Speaker-elect was escorted into the Chamber${m[1]}` },
    { re: /^ADDRESS BY THE SPEAKER-ELECT\s*-\s*(.+)/i, kind: 'ADDRESS BY THE SPEAKER-ELECT', cls: 'se-k-escort', text: (m) => m[1] },
    { re: /^Chaplain of the House of Representatives\s*-\s*(.+)/i, kind: 'CHAPLAIN APPOINTED', cls: 'se-k-chaplain', text: (m) => m[1] },
    // each party's conference or caucus tells the House who its leaders are (3 January 2025, 3:38 PM: the Republicans', then the Democrats'); both are shown together
    { re: /^ANNOUNCEMENT OF LEADERSHIP POSTS\s*-\s*(.+)/i, kind: 'LEADERSHIP POSTS', cls: 'se-k-leaders', text: (m) => m[1], together: true, newest: 12, notBy: /^(?:Considered as privileged|Motion to reconsider|On agreeing|An amendment|COMMITTEE TO REPORT|Chaplain)/i },
  ];
  // entries with a card of their own (or that move the day on): once one is newer than the step, the step is over
  const TAKES_OVER = /^(?:APPOINTMENT OF TELLERS|ADMINISTRATION OF THE OATH|CERTIFICATION OF ELECTION|NOMINATIONS FOR OFFICE|Roll call \d+ - Election of the Speaker|DEBATE\s*-|Considered as privileged)/i;
  const NEWEST = 3;                 // the step must be among the latest this many entries of the log
  const FRESH_MS = 45 * 60 * 1000;  // and no older than this

  const plain = (t) => String(t || '').replace(/&lt;[\s\S]*?&gt;/g, '').replace(/<[^>]*>/g, '').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x2014;/g, '-').replace(/\s+/g, ' ').trim();
  const stamp = (i) => Number(i && i.timestamp) || (i && i.pubDate ? Date.parse(i.pubDate) : 0) || 0;

  // "... at the direction of the Republican Conference, Mr. Scalise of Louisiana had been elected as Majority Leader and Mr. Emmer of Minnesota had been elected as Majority Whip." -> { body, people: [{ name, state, post }] }
  const PERSON_RE = /((?:Mr|Mrs|Ms|Miss)\.\s+[A-Z][A-Za-z'’\- ]*?)(?:\s+of\s+([A-Z][A-Za-z ]+?))?\s+had been elected(?:\s+as)?\s+(?:the\s+)?([A-Z][A-Za-z ]+?)(?=\s*,|\.|\s+and\b|\s*$)/g;
  function leadership(text) {
    const body = (String(text).match(/\b(Republican Conference|Democratic Caucus)\b/i) || [])[1] || '';
    const people = [];
    for (const m of String(text).matchAll(PERSON_RE)) people.push({ name: m[1].replace(/^(?:Mr|Mrs|Ms|Miss)\.\s+/, '').trim(), state: (m[2] || '').trim(), post: m[3].trim() });
    return { body, people };
  }

  function pick(items, now) {
    const list = (items || []).slice().sort((a, b) => stamp(b) - stamp(a));
    for (let k = 0; k < Math.min(12, list.length); k++) {
      const text = plain(list[k].description);
      for (const K of KINDS) {
        const m = text.match(K.re);
        if (!m || k >= (K.newest || NEWEST)) continue;
        const at = stamp(list[k]);
        if (now - at > FRESH_MS) return null;
        // the leadership posts are followed by the resolutions that elect the officers (the House's own business, no card of its own): they do not end it, the officers' oath does
        if (list.some((i) => stamp(i) > at && TAKES_OVER.test(plain(i.description)) && !(K.notBy && K.notBy.test(plain(i.description))))) return null;
        let body = K.text(m);
        if (K.together) {   // the announcements of the same kind just before it (oldest first)
          const before = list.slice(k + 1, k + 3).map((i) => plain(i.description).match(K.re)).filter(Boolean).map((x) => x[1]).reverse();
          body = before.concat(body).join(' ');
        }
        const out = { kind: K.kind, cls: K.cls, text: body.replace(/\s+/g, ' ').trim(), at };
        if (K.together) {
          const entries = list.slice(k, k + 3).filter((i) => K.re.test(plain(i.description))).reverse();
          out.groups = entries.map((i) => leadership(plain(i.description).replace(K.re, '$1'))).filter((g) => g.people.length);
        }
        return out;
      }
    }
    return null;
  }

  function mount() {
    const el = document.getElementById('opening-day');
    if (!el) return;
    let last = '';
    const draw = () => {
      const items = (typeof proceedingsData !== 'undefined' && Array.isArray(proceedingsData)) ? proceedingsData : [];
      const p = pick(items, Date.now());
      // not while the Speaker election panel is up: it is the Happening Now card for the nomination, the roll and the tellers
      // one Happening Now card: the Speaker election panel has it while the roll is read (live), and one of the page's own cards (the oath, ...) has it when one is current. After the result this card
      // is the Happening Now and the Speaker panel sits under it, joined by the column's line, with its own title.
      const speakerUp = document.body.classList.contains('speaker-election-live');
      const other = [...document.querySelectorAll('.mode-column:not(#speaker-column), .vote-display:not(.is-empty)')].some((e) => e.offsetParent && e.getBoundingClientRect().height > 0);
      if (!p || speakerUp || other) { if (!el.hidden) { el.hidden = true; el.innerHTML = ''; last = ''; } return; }
      const time = new Date(p.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
      const elected = root.__speakerElected;
      const party = (({ R: 'republican', D: 'democrat' })[String((elected && elected.party) || '')[0]]) || 'independent';
      const who = elected && /ESCORTED|ADDRESS/.test(p.kind) && elected.bioguideId
        ? `<span class="od-who"><span class="se-cph">${root.__memberPlaceholder || ''}<img src="https://bioguide.congress.gov/photo/${elected.bioguideId}.jpg" alt=""></span><span class="se-cn"><b>${String(elected.last || '').toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (x, a, b) => a + b.toUpperCase()).replace(/^Mc([a-z])/, (x, c) => 'Mc' + c.toUpperCase())}</b><span class="se-pr"><span class="absentee-party-tag ${party}">${String(elected.party || '?')[0]}</span><span class="absentee-state">${elected.state || ''}</span></span><i>Speaker-elect</i></span></span>` : '';
      // the leadership posts: one column per party's body, a row per leader (photo, name, party and state, the post), as the page draws people elsewhere
      const roster = root.__memberRoster || [];
      const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const leaderRow = (g, pe) => {
        const m = root.SpeakerElection && root.SpeakerElection.memberFromLogName(pe.name + (pe.state ? ' of ' + pe.state : ''), roster);
        const cls = (m && ({ R: 'republican', D: 'democrat' })[String(m.party || '')[0]]) || (/republican/i.test(g.body) ? 'republican' : /democrat/i.test(g.body) ? 'democrat' : 'independent');
        const img = m && m.bioguideId ? `<img src="https://bioguide.congress.gov/photo/${esc(m.bioguideId)}.jpg" alt="">` : '';
        const full = m && m.first ? `${m.first} ${pe.name}` : pe.name;   // the surname as the Clerk wrote it: the roster file keeps its capitals
        const tag = `<span class="absentee-party-tag ${cls}">${cls === 'republican' ? 'R' : cls === 'democrat' ? 'D' : 'I'}</span><span class="absentee-state">${esc((m && m.state) || '')}</span>`;
        return `<div class="od-lrow"><span class="se-cph">${root.__memberPlaceholder || ''}${img}</span><span class="se-cn"><b>${esc(full)}</b><span class="se-pr">${tag}</span></span><span class="od-post">${esc(pe.post)}</span></div>`;
      };
      const leaders = p.groups && p.groups.length
        ? `<div class="od-leaders">${p.groups.map((g) => `<div class="od-lgroup"><div class="od-lhead">${esc(g.body)}</div>${g.people.map((pe) => leaderRow(g, pe)).join('')}</div>`).join('')}</div>` : '';
      const html = `<div class="panel-header"><span class="panel-label" data-icon="live">Happening Now</span><span class="vote-type-tag se-kind ${p.cls || ''}">${p.kind}</span><span class="od-time">${time}</span><div class="panel-header-right"><span class="panel-source">Source: <a href="https://clerk.house.gov/FloorSummary" target="_blank" rel="noopener">Legislative Activity (House Clerk)</a></span></div></div>${leaders ? leaders : `<div class="od-body">${who}<p class="od-text"></p></div>`}`;
      if (html !== last) { el.innerHTML = html; const t = el.querySelector('.od-text'); if (t) t.textContent = p.text; last = html; }
      el.hidden = false;
    };
    el.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') e.target.remove(); }, true);
    draw();
    setInterval(draw, 4000);
  }

  root.OpeningDay = { pick, mount, leadership };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OpeningDay;
})(typeof globalThis !== 'undefined' ? globalThis : this);
