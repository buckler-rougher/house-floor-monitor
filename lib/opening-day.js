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
    { re: /^Call by States Quorum responded:\s*(\d+)\s+present/i, kind: 'QUORUM CALL', text: (m) => `The roll was called by States to find a quorum: ${m[1]} Members-elect responded present.` },
    { re: /^COMMITTEE TO ESCORT THE SPEAKER-ELECT\s*-\s*(.+)/i, kind: 'ESCORT COMMITTEE', text: (m) => m[1] },
    { re: /^The Speaker-elect was escorted into the Chamber(.*)/i, kind: 'SPEAKER-ELECT ESCORTED', text: (m) => `The Speaker-elect was escorted into the Chamber${m[1]}` },
    { re: /^ADDRESS BY THE SPEAKER-ELECT\s*-\s*(.+)/i, kind: 'ADDRESS BY THE SPEAKER-ELECT', text: (m) => m[1] },
  ];
  // entries with a card of their own (or that move the day on): once one is newer than the step, the step is over
  const TAKES_OVER = /^(?:APPOINTMENT OF TELLERS|ADMINISTRATION OF THE OATH|CERTIFICATION OF ELECTION|NOMINATIONS FOR OFFICE|ANNOUNCEMENT OF LEADERSHIP|Roll call \d+ - Election of the Speaker|DEBATE\s*-|Considered as privileged)/i;
  const NEWEST = 3;                 // the step must be among the latest this many entries of the log
  const FRESH_MS = 45 * 60 * 1000;  // and no older than this

  const plain = (t) => String(t || '').replace(/&lt;[\s\S]*?&gt;/g, '').replace(/<[^>]*>/g, '').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x2014;/g, '-').replace(/\s+/g, ' ').trim();
  const stamp = (i) => Number(i && i.timestamp) || (i && i.pubDate ? Date.parse(i.pubDate) : 0) || 0;

  function pick(items, now) {
    const list = (items || []).slice().sort((a, b) => stamp(b) - stamp(a));
    for (let k = 0; k < Math.min(NEWEST, list.length); k++) {
      const text = plain(list[k].description);
      for (const K of KINDS) {
        const m = text.match(K.re);
        if (!m) continue;
        const at = stamp(list[k]);
        if (now - at > FRESH_MS) return null;
        if (list.some((i) => stamp(i) > at && TAKES_OVER.test(plain(i.description)))) return null;
        return { kind: K.kind, text: K.text(m).replace(/\s+/g, ' ').trim(), at };
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
      const speakerUp = document.body.classList.contains('speaker-election-live');
      if (!p || speakerUp) { if (!el.hidden) { el.hidden = true; el.innerHTML = ''; last = ''; } return; }
      const time = new Date(p.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
      const elected = root.__speakerElected;
      const who = elected && /ESCORTED|ADDRESS/.test(p.kind) && elected.bioguideId
        ? `<span class="od-who"><span class="se-ph" style="--c:${({ R: 'var(--party-r)', D: 'var(--party-d)' })[(elected.party || '')[0]] || 'var(--text-muted)'}">${root.__memberPlaceholder || ''}<img src="https://bioguide.congress.gov/photo/${elected.bioguideId}.jpg" alt=""></span><span><b>${elected.last}</b> ${elected.party || ''}-${elected.state || ''}<i>Speaker-elect</i></span></span>` : '';
      const html = `<div class="panel-header"><span class="panel-label" data-icon="live">Happening Now</span><span class="vote-type-tag se-kind">${p.kind}</span><span class="od-time">${time}</span><div class="panel-header-right"><span class="panel-source">Source: <a href="https://clerk.house.gov/FloorSummary" target="_blank" rel="noopener">Legislative Activity (House Clerk)</a></span></div></div><div class="od-body">${who}<p class="od-text"></p></div>`;
      if (html !== last) { el.innerHTML = html; el.querySelector('.od-text').textContent = p.text; last = html; }
      el.hidden = false;
    };
    el.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') e.target.remove(); }, true);
    draw();
    setInterval(draw, 4000);
  }

  root.OpeningDay = { pick, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.OpeningDay;
})(typeof globalThis !== 'undefined' ? globalThis : this);
