// The Senate's COMMITTEE MEETINGS: hearings, business meetings and markups, from Congress.gov's committee-meeting API (the Clerk's repository is the House's
// source; the Senate has none of its own that holds past an empty recess). Shared by the Worker, which shapes and picks, and the board, which draws.
//
//   SenateCommittees.shape(meeting)               one /committee-meeting/<congress>/senate/<id> record -> { id, day, time, nominations, ... } (the Eastern day and clock)
//   SenateCommittees.pick(meetings, today, days)  the first day from `today` (YYYY-MM-DD) with a meeting, looking `days` ahead -> { day, events } | null
//   SenateCommittees.mount({ base })              the panel (#senate-committees): loads /senate/committee-meetings, again every five minutes
//
// The API lists a meeting only by id and update time; the date, committees, room, status and video are in the record itself, so the Worker reads records and
// keeps them (nothing here asks the API). Times arrive in UTC and are shown in Eastern, which is where the Senate meets. A meeting that is postponed or
// canceled is still listed, and says so, because the committee's own page does.

(function (root) {
  const TZ = 'America/New_York';
  const etDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
  const etTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const BUILDING = { Hart: 'Hart', Dirksen: 'Dirksen', Russell: 'Russell', Capitol: 'Capitol' };

  function shape(m) {
    if (!m || !m.eventId || !m.date) return null;
    const names = [...new Set((m.committees || []).map((c) => c.name).filter(Boolean))];
    const bld = String((m.location || {}).building || '');
    const place = Object.keys(BUILDING).find((k) => bld.includes(k));
    const room = String((m.location || {}).room || '');
    const video = (m.videos || []).map((v) => v.url).find((u) => /^https:\/\/www\.senate\.gov\/isvp\//.test(u || '')) || null;
    return {
      id: String(m.eventId),
      date: m.date,
      day: etDay(m.date),
      time: etTime(m.date),
      type: String(m.type || '').replace(/^Open\s+/i, ''),
      closed: /^Closed/i.test(m.type || ''),
      status: m.meetingStatus || '',
      committee: names.map((n) => n.replace(/^Senate\s+/, '')).join('; '),
      location: place && room ? `${place} ${room}` : (bld && room ? `${bld} ${room}` : room || bld),
      title: String(m.title || '').replace(/\s+/g, ' ').trim(),
      docs: (m.meetingDocuments || []).map((d) => String(d.description || '').trim()).filter(Boolean),
      video,
      url: `https://www.congress.gov/event/${m.congress}th-Congress/senate-event/${m.eventId}`,
      // the nominations a hearing or meeting takes up, as the Senate's own nomination ids (PN1272-7: number, then the part with no leading zero, nothing for part 0), which is how its nominations list names them
      nominations: [...new Set(((m.relatedItems || {}).nominations || []).map((x) => `PN${x.number}${Number(x.part) > 0 ? '-' + Number(x.part) : ''}`))],
    };
  }

  function pick(meetings, today, days) {
    const from = Date.parse(today + 'T00:00:00Z');
    const upto = from + (days || 7) * 86400000;
    const ahead = (meetings || []).filter((m) => m && m.day >= today && Date.parse(m.day + 'T00:00:00Z') <= upto).sort((a, b) => a.date.localeCompare(b.date));
    if (!ahead.length) return null;
    const day = ahead[0].day;
    return { day, events: ahead.filter((m) => m.day === day) };
  }

  // ---- the board's panel ----
  function mount({ base }) {
    const { escapeHtml: esc, setIfChanged } = root.BoardUtil;
    const listEl = () => document.getElementById('senate-committees-list');
    let data = null, tries = 0;
    const entry = (e) => {
      const off = /cancel|postpone/i.test(e.status);
      const tags = [
        e.type ? `<span class="committee-tag">${esc(e.type)}</span>` : '',
        e.closed ? '<span class="committee-tag">Closed</span>' : '',
        off ? `<span class="committee-tag is-off">${esc(e.status)}</span>` : '',
        e.video ? `<a class="ext committee-video" href="${esc(e.video)}" target="_blank" rel="noopener">Video</a>` : '',
      ].filter(Boolean).join('');
      return { key: e.id, html: `
        <div class="committee-item${off ? ' is-off' : ''}">
            <span class="committee-time">${esc(e.time)}</span>
            <div class="committee-what">
                <a class="committee-title" href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(e.title)}">${esc(e.title)}</a>
                <span class="committee-name">${esc(e.committee)}</span>
                ${tags ? `<span class="committee-tags">${tags}</span>` : ''}
            </div>
            <span class="committee-room">${esc(e.location)}</span>
        </div>` };
    };
    function render() {
      const list = listEl();
      if (!list || !data) return;
      const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
      const put = (id, v) => { const n = document.getElementById(id); if (n && n.textContent !== v) n.textContent = v; };
      const events = data.events || [];
      put('senate-committees-date', events.length ? (data.date === today ? 'Today' : root.BoardUtil.fmtIsoLong(data.date)) : '');
      if (!events.length) {
        // a read still filling in is not "nothing scheduled"
        setIfChanged(list, data.pending ? '<div class="loading-indicator" role="status" aria-label="Loading committee meetings"><i></i><i></i><i></i></div>' : '<div class="empty-note">No committee meetings scheduled in the next week</div>');
      } else {
        if (!list._clamp) { list.innerHTML = ''; root.ClampList.mount(list, { keep: 5 }); }
        root.ListSync.sync(list, events.map(entry));
        list._clamp.refresh();
      }
      if (root.SourcePop) {
        const raw = events.slice(0, 6).map((e) => ({ eventId: e.id, date: e.date, type: e.type, meetingStatus: e.status, title: e.title }));
        root.SourcePop.set(document.getElementById('senate-committees'), events.length ? { request: 'GET https://api.congress.gov/v3/committee-meeting/119/senate/{eventId}', note: 'The meetings shown, as Congress.gov holds them (the first six, abridged).', json: raw, at: data.at } : null);
      }
    }
    const load = () => fetch(`${base}/senate/committee-meetings`).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { data = d; render(); if (d.pending && ++tries < 12) setTimeout(load, 15000); else tries = 0; })
      .catch(() => { const l = listEl(); if (l && !data) setIfChanged(l, '<div class="proceedings-error">COMMITTEE MEETINGS UNAVAILABLE</div>'); });
    load();
    setInterval(load, 5 * 60 * 1000);
  }

  root.SenateCommittees = { shape, pick, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SenateCommittees;
})(typeof globalThis !== 'undefined' ? globalThis : this);
