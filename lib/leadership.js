// The party LEADERSHIP shown in the BALANCE OF POWER panel: in the House the Speaker, then the majority and minority leaders and whips; in the Senate the four leaders and whips
// (the Senate has no Speaker). Shared by the Worker, which reads each chamber's own leadership page, and the board, which draws it.
//
//   Leadership.parseHouse(html)           the Clerk's leadership page (clerk.house.gov/Members/ViewLeadership) -> [{ role, title, name, bioguideId, party }]
//   Leadership.parseSenate(html)          senate.gov's leadership page (senate.gov/senators/leadership.htm)    -> the same
//   Leadership.layout(people, control)    { top, rows } for the board: the officers big (the Speaker; or the President of the Senate and the President Pro Tempore), then leaders (and, in the House, whips) as a majority column and a minority column
//   Leadership.mount({ base, board, photoUrlFor })   loads /leadership (House) or /senate/leadership and draws #leadership-list
//
// role is 'speaker' | 'leader' | 'whip' (House) or 'president' | 'protem' | 'leader' (Senate, which keeps no whips). Only those are kept: the pages also list conference and caucus chairs, policy and campaign committee chairs, and so on.
// A page that does not hold every one of them is an error (null), never an empty list, so a layout change cannot show a panel that quietly says nothing.

(function (root) {
  const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  function parseHouse(html) {
    const text = String(html || '');
    const cols = [...text.matchAll(/leadership-col (republican|democrat)/g)].map((m) => ({ at: m.index, party: m[1] === 'republican' ? 'R' : 'D' }));
    const out = [];
    const re = /<img[^>]*src="\/images\/members\/([A-Z]\d+)\.jpg"[^>]*>[\s\S]*?<h[13][^>]*>\s*Rep\.\s*([^<]+?)\s*<\/h[13]>\s*<p class="title"[^>]*>([^<]+)<\/p>/g;
    let m;
    while ((m = re.exec(text))) {
      const title = decode(m[3]);
      const role = /^Speaker/i.test(title) ? 'speaker' : /^(Majority|Minority) Leader$/i.test(title) ? 'leader' : /^(Majority|Minority) Whip$/i.test(title) ? 'whip' : null;
      if (!role) continue;
      const col = cols.filter((c) => c.at < m.index).pop();
      // the Speaker is above both columns: the leader of the majority party, so no party here
      out.push({ role, title, name: decode(m[2]), bioguideId: m[1], party: role === 'speaker' ? null : (col ? col.party : null), side: /^Majority/i.test(title) ? 'majority' : /^Minority/i.test(title) ? 'minority' : null });
    }
    const has = (r) => out.some((p) => p.role === r);
    return has('speaker') && out.filter((p) => p.role === 'leader').length === 2 && out.filter((p) => p.role === 'whip').length === 2 ? out : null;
  }

  // The Senate's page lists, in order: the Constitutionally mandated officers (the Vice President, who is the President of the Senate, and the President Pro Tempore), then each party's
  // leadership. Each is a cell with a Bioguide photo, an italic title, a linked "Last, <br>First" and, for a senator, "(R-SD)". The whips are on the page and are not kept.
  function parseSenate(html) {
    const text = String(html || '');
    const out = [];
    const re = /<img src="https:\/\/bioguide\.congress\.gov\/bioguide\/photo\/[A-Z]\/([A-Z]\d+)\.jpg"[^>]*>[\s\S]*?<i>([^<]+)<\/i>[\s\S]*?<\/strong>\s*<br>\s*<a [^>]*>([^<]*(?:<br>[^<]*)?)<\/a>\s*<br>\s*(?:\(([RDI])-([A-Z]{2})\))?/g;
    let m;
    while ((m = re.exec(text))) {
      const title = decode(m[2]);
      const role = /^Vice President$/i.test(title) ? 'president' : /^President Pro Tempore$/i.test(title) ? 'protem' : /\bLeader\b/i.test(title) ? 'leader' : null;
      if (!role) continue;
      const [last, first] = decode(m[3].replace(/<br>/g, ' ')).split(',').map((x) => x.trim());
      out.push({
        role,
        // the Vice President presides as the President of the Senate
        title: role === 'president' ? 'President of the Senate' : role === 'protem' ? 'President Pro Tempore' : title,
        name: first ? `${first} ${last}` : last, bioguideId: m[1], party: m[4] || null, state: m[5] || null,
        side: /Majority/i.test(title) ? 'majority' : /Minority/i.test(title) ? 'minority' : null,
      });
    }
    const n = (r) => out.filter((p) => p.role === r).length;
    return n('president') === 1 && n('protem') === 1 && n('leader') === 2 ? out : null;
  }

  // Which side each person is on: the House page says (Majority / Minority); the Senate page names the party ("Democratic Leader"), so the side is whichever party holds control.
  function layout(people, control) {
    const list = people || [];
    const side = (p) => p.side || (control && p.party ? (p.party === control ? 'majority' : 'minority') : null);
    const pick = (role, s) => list.find((p) => p.role === role && side(p) === s) || null;
    // the officers at the top (the Speaker; or the President of the Senate and the President Pro Tempore), then a row of leaders and, in the House, a row of whips
    const top = ['speaker', 'president', 'protem'].map((r) => list.find((p) => p.role === r)).filter(Boolean);
    const rows = [[pick('leader', 'majority'), pick('leader', 'minority')]];
    if (list.some((p) => p.role === 'whip')) rows.push([pick('whip', 'majority'), pick('whip', 'minority')]);
    return { top, rows };
  }

  // ---- the board's block ----
  function mount({ base, board, photoUrlFor, getControl }) {
    const { escapeHtml: esc, setIfChanged } = root.BoardUtil;
    const list = document.getElementById('leadership-list');
    if (!list) return;
    let data = null;
    const label = { leader: { majority: 'Majority Leader', minority: 'Minority Leader' }, whip: { majority: 'Majority Whip', minority: 'Minority Whip' } };
    const card = (p, role, side, big) => {
      if (!p) return `<div class="lead-card is-empty"></div>`;
      const photo = photoUrlFor ? photoUrlFor(p.bioguideId) : '';
      const party = p.party || (p.role === 'speaker' && getControl ? getControl() : '') || '';
      // the Vice President's party is not on the page, so no colour is claimed for them
      const cls = party === 'R' ? 'rep' : party === 'D' ? 'dem' : party === 'I' ? 'ind' : 'none';
      const title = big ? p.title : label[role][side];
      return `<div class="lead-card${big ? ' is-big' : ''} ${cls}">
        <span class="lead-photo">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" onload="this.style.opacity='1';" onerror="this.style.display='none';">` : ''}</span>
        <span class="lead-text"><span class="lead-name">${esc(p.name)}</span><span class="lead-title">${esc(title)}</span></span>
      </div>`;
    };
    function render() {
      if (!data || !data.leaders) return;
      const L = layout(data.leaders, getControl ? getControl() : null);
      setIfChanged(list, `<div class="lead-top${L.top.length > 1 ? ' is-pair' : ''}">${L.top.map((p) => card(p, p.role, null, true)).join('')}</div><div class="lead-grid">${L.rows.map((r, i) => card(r[0], i ? 'whip' : 'leader', 'majority') + card(r[1], i ? 'whip' : 'leader', 'minority')).join('')}</div>`);
      list.closest('.leadership-section').hidden = false;
    }
    const load = () => fetch(`${base}/${board === 'senate' ? 'senate/' : ''}leadership`)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { data = d; render(); })
      .catch(() => { /* the panel is right without it */ });
    load();
    setInterval(load, 60 * 60 * 1000);
    return { render };
  }

  root.Leadership = { parseHouse, parseSenate, layout, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Leadership;
})(typeof globalThis !== 'undefined' ? globalThis : this);
