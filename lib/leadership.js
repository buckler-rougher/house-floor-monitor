// The party LEADERSHIP shown in the BALANCE OF POWER panel: in the House the Speaker, then the majority and minority leaders and whips; in the Senate the four leaders and whips
// (the Senate has no Speaker). Shared by the Worker, which reads each chamber's own leadership page, and the board, which draws it.
//
//   Leadership.parseHouse(html)           the Clerk's leadership page (clerk.house.gov/Members/ViewLeadership) -> [{ role, title, name, bioguideId, party }]
//   Leadership.parseSenate(html)          senate.gov's leadership page (senate.gov/senators/leadership.htm)    -> the same
//   Leadership.layout(people, control)    [{ big?: person }, rows] for the board: the Speaker big, then leader / whip as a majority column and a minority column
//   Leadership.mount({ base, board, photoUrlFor })   loads /leadership (House) or /senate/leadership and draws #leadership-list
//
// role is 'speaker' | 'leader' | 'whip'. Only those are kept: the pages also list conference and caucus chairs, policy and campaign committee chairs, and so on.
// A page that holds no leader or no whip is an error (null), never an empty list, so a layout change cannot show a panel that quietly says nothing.

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

  function parseSenate(html) {
    const text = String(html || '');
    const out = [];
    const re = /<img src="https:\/\/bioguide\.congress\.gov\/bioguide\/photo\/[A-Z]\/([A-Z]\d+)\.jpg" alt="([^"]+)"[\s\S]*?<i>([^<]+)<\/i>[\s\S]*?<br>\s*\(([RDI])-([A-Z]{2})\)/g;
    let m;
    while ((m = re.exec(text))) {
      const title = decode(m[3]);
      const role = /\bWhip\b/i.test(title) ? 'whip' : /\bLeader\b/i.test(title) ? 'leader' : null;
      if (!role) continue;
      const [last, first] = decode(m[2]).split(',').map((x) => x.trim());
      out.push({ role, title, name: first ? `${first} ${last}` : last, bioguideId: m[1], party: m[4], state: m[5], side: /Majority/i.test(title) ? 'majority' : /Minority/i.test(title) ? 'minority' : null });
    }
    return out.filter((p) => p.role === 'leader').length === 2 && out.filter((p) => p.role === 'whip').length === 2 ? out : null;
  }

  // Which side each person is on: the House page says (Majority / Minority); the Senate page names the party ("Democratic Leader"), so the side is whichever party holds control.
  function layout(people, control) {
    const list = people || [];
    const speaker = list.find((p) => p.role === 'speaker') || null;
    const side = (p) => p.side || (control && p.party ? (p.party === control ? 'majority' : 'minority') : null);
    const pick = (role, s) => list.find((p) => p.role === role && side(p) === s) || null;
    return { speaker, rows: [[pick('leader', 'majority'), pick('leader', 'minority')], [pick('whip', 'majority'), pick('whip', 'minority')]] };
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
      const party = p.party || (getControl && getControl()) || '';
      const cls = party === 'R' ? 'rep' : party === 'D' ? 'dem' : 'ind';
      const title = big ? 'Speaker of the House' : label[role][side];
      return `<div class="lead-card${big ? ' is-big' : ''} ${cls}">
        <span class="lead-photo">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" onload="this.style.opacity='1';" onerror="this.style.display='none';">` : ''}</span>
        <span class="lead-text"><span class="lead-name">${esc(p.name)}</span><span class="lead-title">${esc(title)}</span></span>
      </div>`;
    };
    function render() {
      if (!data || !data.leaders) return;
      const L = layout(data.leaders, getControl ? getControl() : null);
      setIfChanged(list, `${L.speaker ? card(L.speaker, 'speaker', null, true) : ''}<div class="lead-grid">${L.rows.map((r, i) => card(r[0], i ? 'whip' : 'leader', 'majority') + card(r[1], i ? 'whip' : 'leader', 'minority')).join('')}</div>`);
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
