// The browser tab's title says what the floor is doing, as one word or two: "Vote | Monitoring the House Floor", "Debate | ...", "Prayer | ...", "Adjourned | ...", and the plain
// name while nothing is known yet. A reader with the tab in the background sees at a glance when something starts. Both sites use it; the Senate passes its own call classes.
//
//   LiveTitle.compute({ base, classes, status, voteNo })     pure: the title   (test/live-title.test.js)
//
// `classes` are the body's classes (the sites set a `<mode>-mode` class for what is on the floor, `recess-mode` for adjourned or in recess, and the Senate `senate-call-vote` /
// `senate-call-quorum`); `status` is the banner's status line; `voteNo` is the roll call number once the vote panel has one (it says a vote is up; the title does not show it).
(function (root) {
  const LABEL = {
    debate: 'Debate', prayer: 'Prayer', silence: 'Moment of silence', oath: 'Oath of office', speaker: 'Speaker pro tempore', pledge: 'Pledge of Allegiance', journal: 'Journal',
    'morning-hour': 'Morning hour', 'one-minute': 'One-minute speeches', 'special-order': 'Special order speeches', 'joint-meeting': 'Joint meeting', 'joint-session': 'Joint session',
    tellers: 'Tellers', message: 'Message from the Senate', 'committee-chair': 'Committee chair', privilege: 'Question of privilege', 'house-privilege': 'Question of privilege',
    'privilege-notice': 'Privilege notice', 'cert-election': 'Certification of election', 'cert-electoral': 'Counting electoral votes', 'sine-die': 'Sine die', 'new-session': 'New session',
    'admin-oath': 'Oath of office',
  };
  const PENDING = /^(|--|—|loading\.\.\.)$/i;

  // "House adjourned" -> "Adjourned", "House in recess" -> "In recess": the site's name is already in the title
  const fromStatus = (status) => {
    const t = String(status || '').replace(/\s+/g, ' ').trim().replace(/^(the\s+)?(house|senate)(\s+is)?(\s+now)?\s*/i, '');
    return PENDING.test(t) ? '' : t.charAt(0).toUpperCase() + t.slice(1);
  };

  function compute({ base, classes = [], status = '', voteNo = '' } = {}) {
    const titled = (what) => (what ? `${what} | ${base}` : base);
    const has = (c) => classes.includes(c);
    if (has('senate-call-vote')) return titled('Vote');
    if (has('senate-call-quorum')) return titled('Quorum call');
    if (has('recess-mode')) return titled(fromStatus(status));
    for (const c of classes) {
      const m = /^(.+)-mode$/.exec(c);
      if (m && m[1] !== 'all' && LABEL[m[1]]) return titled(LABEL[m[1]]);
    }
    if (/^\d+$/.test(String(voteNo || '').trim()) && !classes.some((c) => /-mode$/.test(c))) return titled('Vote');
    return titled(fromStatus(status));
  }

  function start() {
    const base = document.title;
    let queued = false;
    const apply = () => {
      queued = false;
      const status = (document.getElementById('floor-status') || {}).textContent;
      const num = document.querySelector('#vote-id .vote-id-num');
      const t = compute({ base, classes: [...document.body.classList], status, voteNo: num ? num.textContent : '' });
      if (document.title !== t) document.title = t;
    };
    const soon = () => { if (!queued) { queued = true; requestAnimationFrame(apply); } };
    new MutationObserver(soon).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    for (const id of ['floor-status', 'vote-id']) {
      const el = document.getElementById(id);
      if (el) new MutationObserver(soon).observe(el, { childList: true, characterData: true, subtree: true });
    }
    soon();
  }

  root.LiveTitle = { compute };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LiveTitle;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
