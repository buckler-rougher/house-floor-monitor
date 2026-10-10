// TREATIES before the Senate (Senate board): the treaties received in this Congress and the one before that the Senate has not yet given its advice and consent
// on, from Congress.gov's treaty API. Shared by the Worker (which shapes) and the board (which draws).
//
//   SenateTreaties.shape(record, actions)   one /treaty/<congress>/<number> record and its actions -> { id, title, topic, parties, received, latest, pending } | null
//   SenateTreaties.mount({ base })          the panel (#senate-treaties): loads /senate/treaties once an hour
//
// A treaty stays before the Senate until it acts: it is received, referred to the Foreign Relations Committee, may be reported, and ends in a resolution of
// ratification, a withdrawal or a return to the President. Pending means none of those has happened: no resolution text, no date in force, and no action whose
// text says it was ratified, agreed to, withdrawn or returned. Only the Congress.gov record decides; a treaty it has no actions for is not guessed at.

(function (root) {
  const DONE = /resolution of (?:advice and consent|ratification)|advice and consent (?:was )?(?:given|agreed)|ratif|withdrawn|returned to the president|entered into force|in force/i;
  const date = (iso) => (iso ? String(iso).slice(0, 10) : '');

  function shape(rec, actions) {
    const t = Array.isArray(rec) ? rec[0] : rec;
    if (!t || t.number == null) return null;
    const list = (actions || []).slice().sort((a, b) => date(b.actionDate).localeCompare(date(a.actionDate)));
    const short = (t.titles || []).find((x) => /short/i.test(x.titleType)) || (t.titles || [])[0] || {};
    const cg = t.congressReceived;
    return {
      id: `Treaty Doc. ${cg}-${t.number}${t.suffix || ''}`,
      congress: cg,
      number: t.number,
      title: short.title || '',
      topic: t.topic || '',
      parties: (t.countriesParties || []).map((c) => c.name).filter(Boolean),
      received: date(t.transmittedDate),
      latest: list[0] ? { date: date(list[0].actionDate), text: list[0].text || '', committee: (list[0].committee || {}).name || '' } : null,
      pending: !t.resolutionText && !t.inForceDate && !list.some((a) => DONE.test(a.text || '')),
    };
  }

  function mount({ base }) {
    const { escapeHtml: esc, setIfChanged } = root.BoardUtil;
    const fmt = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
    let data = null;
    function render() {
      const list = document.getElementById('senate-treaties-list');
      if (!list || !data) return;
      const put = (id, v) => { const n = document.getElementById(id); if (n && n.textContent !== v) n.textContent = v; };
      const items = (data.treaties || []).filter((t) => t.pending);
      put('senate-treaties-count', items.length ? `${items.length} pending` : '');
      if (!items.length) { setIfChanged(list, '<div class="empty-note">No treaties pending</div>'); return; }
      if (!list._clamp) { list.innerHTML = ''; root.ClampList.mount(list, { keep: 3 }); }
      root.ListSync.sync(list, items.map((t) => ({ key: t.id, html: `
        <div class="treaty-item">
            <div class="treaty-head"><span class="treaty-id">${esc(t.id)}</span>${t.topic ? `<span class="committee-tag">${esc(t.topic)}</span>` : ''}</div>
            <div class="treaty-title">${esc(t.title)}</div>
            <div class="treaty-meta">${t.parties.length ? esc(t.parties.join(', ')) + ' · ' : ''}Received ${esc(fmt(t.received))}</div>
            ${t.latest ? `<div class="treaty-latest">${esc(fmt(t.latest.date))}: ${esc(t.latest.text)}</div>` : ''}
        </div>` })));
      list._clamp.refresh();
      if (root.SourcePop) root.SourcePop.set(document.getElementById('senate-treaties'), { request: `GET https://api.congress.gov/v3/treaty/{congress}/{number}`, note: 'The treaties shown, as shaped from Congress.gov (the record and its actions, abridged).', json: items.map((t) => ({ treaty: t.id, topic: t.topic, received: t.received, latestAction: t.latest })), at: data.at });
    }
    const load = () => fetch(`${base}/senate/treaties`).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { data = d; render(); })
      .catch(() => { const l = document.getElementById('senate-treaties-list'); if (l && !data) setIfChanged(l, '<div class="empty-note">Treaties unavailable</div>'); });
    load();
    setInterval(load, 60 * 60 * 1000);
  }

  root.SenateTreaties = { shape, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateTreaties;
})(typeof globalThis !== 'undefined' ? globalThis : this);
