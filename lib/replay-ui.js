// THE TIME MACHINE, the part you see: the header button, the date picker, the trip itself (an animation), and, once you have arrived, the bar along the bottom that plays, scrubs and
// jumps. The engine is lib/replay-shim.js (it only loads for ?replay=YYYYMMDD); this file loads on every House page and does nothing until the button is pressed or the page is a replay.
//
//   Button  -> picker (a month at a time; days with a House video archive are lit, from the Worker's /api/replay-probe)
//   Choose  -> the trip (stars streaming past, the date counting back from today to the day chosen, the clock face spinning backward) -> /?replay=YYYYMMDD
//   Arrive  -> the same stars slow to a stop and the board appears
//   Replay  -> `window.__replay`: bar with play, back/forward, the moment as the board sees it, a scrubber marked with the gavel, the votes and the adjournment, speed, "back to live"
//              click a line in FLOOR PROCEEDINGS (or a mark on the scrubber) and the video goes to those words
//
// Reduced motion: the trip is a short fade with the same words.

(function () {
  const API = 'https://api.evanhollander.org/house-floor/api';
  const S = window.__replay || null;
  const LOCAL = /[?&]local\b/.test(location.search);
  const $ = (s, el) => (el || document).querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n) => String(n).padStart(2, '0');
  const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });   // YYYY-MM-DD
  const fmt = (iso) => { const [y, m, d] = iso.split('-'); return `${d} ${MONTHS[+m - 1]} ${y}`; };
  const clockET = (ms, secs) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', ...(secs ? { second: '2-digit' } : {}), timeZoneName: 'short' });

  // ================= the trip =================
  // `from` and `to` are YYYY-MM-DD. The date on screen counts back from one to the other (fast, then slowing as it nears), the stars accelerate, the clock face winds backward.
  // `arriving` plays it the other way: the stars slow to a stop and the date settles on `to`.
  function trip({ from, to, arriving, onDone }) {
    document.getElementById('tm-overlay')?.remove();
    const toD = new Date(to + 'T12:00:00'), fromD = new Date(from + 'T12:00:00');
    const diff = Math.round((fromD - toD) / 86400000);   // days back (negative when going forward from another replay)
    const dir = diff >= 0 ? -1 : 1;
    const ov = el('div', 'tm-overlay' + (arriving ? ' is-arriving' : ''), `
      <canvas class="tm-warp"></canvas>
      <div class="tm-core">
        <svg class="tm-clock" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="tm-clock-face" cx="50" cy="50" r="46"/>
          <g class="tm-clock-ticks"></g>
          <line class="tm-hand tm-hand-h" x1="50" y1="50" x2="50" y2="26"/>
          <line class="tm-hand tm-hand-m" x1="50" y1="50" x2="50" y2="14"/>
          <circle cx="50" cy="50" r="3" class="tm-clock-pin"/>
        </svg>
        <div class="tm-label">${arriving ? 'ARRIVED' : 'TRAVELING TO'}</div>
        <div class="tm-date" aria-live="off"></div>
        <div class="tm-sub">${arriving ? 'THE HOUSE FLOOR, AS IT WAS' : (diff >= 0 ? 'REWINDING THE HOUSE FLOOR' : 'SKIPPING AHEAD ON THE HOUSE FLOOR')}</div>
      </div>
      <div class="tm-flash"></div>`);
    document.body.appendChild(ov);
    const ticks = $('.tm-clock-ticks', ov);
    for (let i = 0; i < 12; i++) { const a = i * 30 * Math.PI / 180; ticks.insertAdjacentHTML('beforeend', `<line x1="${50 + Math.sin(a) * 40}" y1="${50 - Math.cos(a) * 40}" x2="${50 + Math.sin(a) * 44}" y2="${50 - Math.cos(a) * 44}"/>`); }
    const dateEl = $('.tm-date', ov);
    const text = (d) => `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const dur = reduce() ? 400 : (arriving ? 900 : 1700);
    const cv = $('.tm-warp', ov), g = cv.getContext('2d');
    const fit = () => { cv.width = innerWidth; cv.height = innerHeight; };
    fit();
    const stars = Array.from({ length: 260 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random() * 0.9 + 0.05, s: Math.random() * 0.9 + 0.3 }));
    const hH = $('.tm-hand-h', ov), hM = $('.tm-hand-m', ov);
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const t0 = performance.now();
    let raf = 0, done = false;
    function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      // trip: speed climbs; arrival: speed falls
      const speed = arriving ? Math.pow(1 - t, 2.2) : Math.pow(t, 1.6) + 0.04;
      const cx = cv.width / 2, cy = cv.height / 2, maxR = Math.hypot(cx, cy);
      g.fillStyle = `rgba(6, 9, 13, ${arriving ? 0.5 : 0.28})`;
      g.fillRect(0, 0, cv.width, cv.height);
      for (const s of stars) {
        const prev = s.r;
        s.r += s.s * (0.004 + speed * 0.05) * (0.4 + s.r);
        if (s.r > 1.05) { s.r = 0.02 + Math.random() * 0.05; s.a = Math.random() * Math.PI * 2; continue; }
        const x1 = cx + Math.cos(s.a) * prev * maxR, y1 = cy + Math.sin(s.a) * prev * maxR;
        const x2 = cx + Math.cos(s.a) * s.r * maxR, y2 = cy + Math.sin(s.a) * s.r * maxR;
        const hue = 150 + 60 * (1 - speed);   // green at speed, toward blue as it slows
        g.strokeStyle = `hsla(${hue}, 85%, ${60 + 30 * speed}%, ${0.25 + 0.7 * Math.min(1, s.r * 1.4)})`;
        g.lineWidth = 0.6 + s.r * 1.8 * (0.5 + speed);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
      // the clock winds backward faster as the trip goes
      const turns = arriving ? (1 - ease(t)) * 6 : ease(t) * 14;
      hM.style.transform = `rotate(${dir * turns * 360}deg)`; hM.style.transformOrigin = '50px 50px';
      hH.style.transform = `rotate(${dir * turns * 30}deg)`; hH.style.transformOrigin = '50px 50px';
      // the date counts back: ease-out so the last days are readable
      if (arriving) dateEl.textContent = text(toD);
      else { const moved = Math.round(diff * ease(t)); const d = new Date(fromD); d.setDate(d.getDate() - moved); dateEl.textContent = t >= 1 ? text(toD) : text(d); }
      if (!arriving && t > 0.82) ov.classList.add('is-flash');
      if (t < 1) raf = requestAnimationFrame(frame);
      else if (!done) { done = true; setTimeout(() => { if (arriving) { ov.classList.add('is-leaving'); setTimeout(() => ov.remove(), 700); } if (onDone) onDone(); }, arriving ? 120 : 260); }
    }
    ov.classList.add('is-on');
    raf = requestAnimationFrame(frame);
    const stop = () => { cancelAnimationFrame(raf); };
    addEventListener('pagehide', stop, { once: true });
    return ov;
  }

  function travel(isoTo, atClock) {
    const go = () => {
      try { sessionStorage.setItem('tm-arrive', JSON.stringify({ to: isoTo, from: todayET(), at: Date.now() })); } catch { /* private window: no arrival scene */ }
      location.href = `${location.pathname}?replay=${isoTo.replace(/-/g, '')}${atClock ? '&t=' + encodeURIComponent(atClock) : ''}${LOCAL ? '&local' : ''}`;
    };
    trip({ from: S ? S.iso : todayET(), to: isoTo, onDone: go });
  }

  // ================= the picker =================
  let pick = null;
  function openPicker() {
    if (pick) return;
    const now = new Date();
    let view = S ? new Date(S.iso + 'T12:00:00') : new Date(now.getFullYear(), now.getMonth(), 1, 12);
    view = new Date(view.getFullYear(), view.getMonth(), 1, 12);
    const cache = new Map();
    let chosen = null;
    const ov = el('div', 'tm-picker-overlay', `
      <div class="tm-picker" role="dialog" aria-modal="true" aria-label="Time machine">
        <div class="tm-picker-head"><span class="tm-picker-title">TIME MACHINE</span><button type="button" class="tm-picker-close" aria-label="Close"></button></div>
        <p class="tm-picker-lede">Pick a day. The board and the House floor video go back to it, and you can scrub through it.</p>
        <div class="tm-cal-nav">
          <button type="button" class="tm-nav-btn" data-step="-1" aria-label="Previous month">‹</button>
          <span class="tm-cal-title"><select class="tm-sel tm-sel-m" aria-label="Month"></select><select class="tm-sel tm-sel-y" aria-label="Year"></select></span>
          <button type="button" class="tm-nav-btn" data-step="1" aria-label="Next month">›</button>
        </div>
        <div class="tm-cal-dow">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<span>${d}</span>`).join('')}</div>
        <div class="tm-cal-grid" role="grid"></div>
        <div class="tm-picker-foot">
          <div class="tm-picked"><span class="tm-picked-label">Chosen</span><span class="tm-picked-day">none</span><span class="tm-picked-name"></span></div>
          <label class="tm-start">Start at <input type="text" class="tm-start-input" inputmode="numeric" placeholder="gavel" aria-label="Start time, Eastern (blank for the gavel)"></label>
          <button type="button" class="tm-go" disabled>Travel</button>
        </div>
        <div class="tm-picker-note">Days that lit up have a recording and captions from the House Clerk, back to 2020. Some panels have no history and say so.</div>
      </div>`);
    document.body.appendChild(ov);
    pick = ov;
    requestAnimationFrame(() => ov.classList.add('is-open'));
    const selM = $('.tm-sel-m', ov), selY = $('.tm-sel-y', ov);
    selM.innerHTML = MONTHS_LONG.map((m, i) => `<option value="${i}">${m}</option>`).join('');
    const thisYear = now.getFullYear();
    selY.innerHTML = Array.from({ length: thisYear - 2019 }, (_, i) => thisYear - i).map((y) => `<option value="${y}">${y}</option>`).join('');
    const grid = $('.tm-cal-grid', ov), goBtn = $('.tm-go', ov);

    // A month is asked for six days at a time, all at once, weekdays first; each batch lights its days as it arrives (a day the House has no record of is the slow one to answer).
    function month(y, m, onPart) {
      const key = `${y}${pad(m + 1)}`;
      let st = cache.get(key);
      if (st) { if (onPart) st.subs.push(onPart); return st; }
      st = { days: {}, pending: 0, subs: onPart ? [onPart] : [] };
      cache.set(key, st);
      const last = new Date(y, m + 1, 0).getDate();
      const ids = [];
      for (let d = 1; d <= last; d++) ids.push(d);
      const isoOf = (d) => `${y}-${pad(m + 1)}-${pad(d)}`;
      const today = todayET();
      const list = ids.filter((d) => isoOf(d) <= today);
      st.pending = list.length;
      const wk = (d) => { const w = new Date(y, m, d).getDay(); return w > 0 && w < 6; };
      const ordered = [...list.filter(wk), ...list.filter((d) => !wk(d))];
      const part = () => st.subs.forEach((f) => f());
      if (LOCAL) { for (const d of list) if (wk(d)) st.days[isoOf(d)] = { name: `LEGISLATIVE DAY OF ${MONTHS_LONG[m].toUpperCase()} ${d}, ${y}` }; st.pending = 0; return st; }
      for (let i = 0; i < ordered.length; i += 6) {
        const grp = ordered.slice(i, i + 6);
        fetch(`${API}/replay-probe?ids=${grp.map((d) => `${y}${pad(m + 1)}${pad(d)}`).join(',')}`)
          .then((r) => (r.ok ? r.json() : { days: {} })).catch(() => ({ days: {} }))
          .then((j) => { for (const d of grp) { const info = (j.days || {})[`${y}${pad(m + 1)}${pad(d)}`]; if (info && info.has) st.days[isoOf(d)] = info; } })
          .finally(() => { st.pending -= grp.length; part(); });
      }
      return st;
    }
    function draw() {
      const y = view.getFullYear(), m = view.getMonth();
      selM.value = String(m); selY.value = String(y);
      const st = month(y, m, () => { if (pick === ov && view.getFullYear() === y && view.getMonth() === m) paint(st, y, m); });
      paint(st, y, m);
    }
    function paint(st, y, m) {
      const days = st.days;
      const first = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate();
      const today = todayET();
      let html = '';
      for (let i = 0; i < first; i++) html += '<span class="tm-day is-blank"></span>';
      for (let d = 1; d <= last; d++) {
        const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
        const info = days[iso];
        const cls = ['tm-day', info ? 'has-video' : '', st.pending > 0 && !info && iso <= today ? 'is-checking' : '', iso === today ? 'is-today' : '', chosen === iso ? 'is-chosen' : ''].filter(Boolean).join(' ');
        html += info ? `<button type="button" class="${cls}" data-iso="${iso}" title="${(info.name || '').replace(/\s+/g, ' ')}">${d}</button>` : `<span class="${cls}" aria-disabled="true">${d}</span>`;
      }
      grid.innerHTML = html;
    }
    const close = () => { ov.classList.remove('is-open'); setTimeout(() => { ov.remove(); if (pick === ov) pick = null; }, 220); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    $('.tm-picker-close', ov).addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.addEventListener('click', (e) => {
      const st = e.target.closest('[data-step]');
      if (st) { view = new Date(view.getFullYear(), view.getMonth() + Number(st.dataset.step), 1, 12); draw(); return; }
      const dayBtn = e.target.closest('.tm-day.has-video');
      if (dayBtn) {
        chosen = dayBtn.dataset.iso;
        grid.querySelectorAll('.is-chosen').forEach((x) => x.classList.remove('is-chosen'));
        dayBtn.classList.add('is-chosen');
        $('.tm-picked-day', ov).textContent = fmt(chosen);
        $('.tm-picked-name', ov).textContent = (dayBtn.title || '').toLowerCase().replace(/^legislative day of ([a-z]+)/, (_, m2) => `Legislative day of ${m2[0].toUpperCase()}${m2.slice(1)}`);
        goBtn.disabled = false;
        if (e.detail === 2) go();
      }
    });
    selM.addEventListener('change', () => { view = new Date(view.getFullYear(), +selM.value, 1, 12); draw(); });
    selY.addEventListener('change', () => { view = new Date(+selY.value, view.getMonth(), 1, 12); draw(); });
    function go() {
      if (!chosen) return;
      const raw = $('.tm-start-input', ov).value.trim();
      const m = /^(\d{1,2})(?::?(\d\d))?$/.exec(raw);
      const at = m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : '';
      close();
      setTimeout(() => travel(chosen, at), 160);
    }
    goBtn.addEventListener('click', go);
    draw();
  }

  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#replay-btn')) openPicker(); });

  // ================= arriving =================
  try {
    const raw = sessionStorage.getItem('tm-arrive');
    if (raw && S) {
      sessionStorage.removeItem('tm-arrive');
      const a = JSON.parse(raw);
      if (Date.now() - a.at < 60000) {
        const show = () => trip({ from: a.from, to: a.to, arriving: true });
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
      }
    }
  } catch { /* no arrival scene */ }
  document.documentElement.classList.remove('tm-arriving');

  if (!S) return;

  // ================= the bar =================
  const bar = el('div', 'tm-bar', `
    <div class="tm-bar-row">
      <div class="tm-transport">
        <button type="button" class="tm-btn tm-back" aria-label="Back 30 seconds" title="Back 30 seconds"><svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg><span>30</span></button>
        <button type="button" class="tm-btn tm-play" aria-label="Play"></button>
        <button type="button" class="tm-btn tm-fwd" aria-label="Forward 30 seconds" title="Forward 30 seconds"><svg viewBox="0 0 24 24"><path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/></svg><span>30</span></button>
      </div>
      <div class="tm-moment"><span class="tm-moment-time">--:--:--</span><span class="tm-moment-date">${fmt(S.iso)}</span></div>
      <div class="tm-scrub"><div class="tm-segs"></div><div class="tm-future"></div><div class="tm-marks"></div><input type="range" class="tm-range" min="0" max="1000" step="1" value="0" aria-label="Position in the day"><div class="tm-tip" hidden></div></div>
      <div class="tm-speed" role="group" aria-label="Speed">${[1, 2, 4, 8].map((x) => `<button type="button" class="tm-sp${x === 1 ? ' is-on' : ''}" data-x="${x}">${x}×</button>`).join('')}</div>
      <button type="button" class="tm-leave" title="Back to the live board">Back to live</button>
    </div>
    <button type="button" class="tm-now" hidden></button>
    <div class="tm-filter-row">
      <button type="button" class="tm-agenda-btn" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h2v2H4zm4 0h12v2H8zM4 11h2v2H4zm4 0h12v2H8zM4 16h2v2H4zm4 0h12v2H8z"/></svg>Agenda</button>
      <div class="tm-legend" role="group" aria-label="Moments shown on the scrubber">${[['debate', 'Debates'], ['vote', 'Votes'], ['speech', 'Speeches'], ['other', 'Recesses and other']].map(([k, l]) => `<button type="button" class="tm-chip tm-chip-${k}" data-kind="${k}" aria-pressed="true"><i></i>${l}</button>`).join('')}</div>
      <label class="tm-outside"><input type="checkbox" class="tm-outside-box"> Show before and after the House was in session</label>
    </div>
    <div class="tm-status" hidden></div>`);
  document.body.appendChild(bar);
  const agendaBox = el('div', 'tm-agenda', `
    <div class="tm-ag-head"><input type="search" class="tm-ag-find" placeholder="Find a bill or a topic: H.R. 9497, postal, fraud…" aria-label="Find in this day" autocomplete="off"><button type="button" class="tm-ag-close" aria-label="Close the agenda">✕</button></div>
    <div class="tm-ag-list" role="list"></div>`);
  agendaBox.hidden = true;
  document.body.appendChild(agendaBox);
  const agendaList = $('.tm-ag-list', agendaBox), agendaFind = $('.tm-ag-find', agendaBox), agendaBtn = $('.tm-agenda-btn', bar);
  const nowEl = $('.tm-now', bar), playBtn = $('.tm-play', bar), range = $('.tm-range', bar), tip = $('.tm-tip', bar), marks = $('.tm-marks', bar), segs = $('.tm-segs', bar), scrub = $('.tm-scrub', bar), status = $('.tm-status', bar);
  const setPlayIcon = () => { playBtn.innerHTML = S.playing ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; playBtn.setAttribute('aria-label', S.playing ? 'Pause' : 'Play'); };
  setPlayIcon();

  let lo = 0, hi = 1;   // the part of the video the scrubber covers (media seconds): from where the day begins to the end
  const wallOf = (m) => S.timeline.wallFromMedia(m);
  // The recording runs from before the gavel to after the adjournment (the Clerk's feed is up for a while either side): the scrubber covers only the House in session unless asked.
  let outside = false, hidden = new Set();
  try { outside = localStorage.getItem('tm-outside') === '1'; hidden = new Set(JSON.parse(localStorage.getItem('tm-hidden') || '[]')); } catch { /* no storage */ }
  const sessionEdges = () => {
    let first = null, last = null;
    for (const it of S.items) {
      const d = it.description || '';
      if (/^The House convened/i.test(d) && (first == null || it.timestamp < first)) first = it.timestamp;
      if (/\badjourn/i.test(d) && /^The (House|Speaker)/i.test(d) && (last == null || it.timestamp > last)) last = it.timestamp;
    }
    return { first, last };
  };
  function bounds() {
    if (!S.timeline || !S.day) return;
    const { first, last } = sessionEdges();
    if (outside) { lo = 0; hi = Math.max(60, S.duration()); return; }
    lo = Math.max(0, S.timeline.mediaFromWall(first != null ? first : S.day.startMs) - 20);
    hi = Math.max(lo + 60, last != null ? S.timeline.mediaFromWall(last) + 30 : S.duration());
    if (Number.isFinite(S.duration()) && S.duration() > 0) hi = Math.min(hi, S.duration());
  }
  const toRange = (m) => Math.round((m - lo) / (hi - lo) * 1000);
  const fromRange = (v) => lo + (v / 1000) * (hi - lo);

  // ---- the agenda (lib/replay-agenda.js): what was on the floor and how it came out; the scrubber's marks, the "now" line and the agenda panel are all drawn from it ----
  let agenda = [], marksSig = '';
  const marksText = new Map();
  const E = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const hm = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const rowText = (r) => `${hm(r.ms)}  ${r.title}${r.detail ? `\n${r.detail}` : ''}${r.outcome ? `\n${r.outcome}` : ''}`;
  const compact = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  function drawMarks() {
    if (!S.timeline || !S.items.length) return;
    const sig = `${S.items.length}|${S.rolls.length}|${S.timeline.anchors.length}|${lo}|${hi}|${outside}|${(S.votes || []).length}`;
    if (sig === marksSig) return;
    marksSig = sig;
    agenda = window.ReplayAgenda.build(S.items, S.rolls);
    agenda.forEach((r) => { r.compact = compact(r.find); });
    marksText.clear();
    const pos = (ms) => (S.timeline.mediaFromWall(ms) - lo) / (hi - lo) * 100;
    // The track itself is the day, cut into what was on the floor: each stretch from one item to the next is a segment (debates purple, in alternating shades so neighbours read as two;
    // speeches grey; recesses amber), so scrubbing across it is scrubbing through the agenda. Votes are ticks above it.
    const out = [], parts = [];
    const stretches = agenda.filter((r) => r.kind !== 'vote');
    stretches.forEach((r, i) => {
      if (r.kind === 'adjourn') return;
      const a = Math.max(0, pos(r.ms)), b = Math.min(100, i + 1 < stretches.length ? pos(stretches[i + 1].ms) : 100);
      if (b <= a) return;
      const id = `s${i}`;
      parts.push(`<i class="tm-seg tm-seg-${r.kind === 'recess' ? 'other' : r.kind}${i % 2 ? ' is-b' : ''}" style="left:${a.toFixed(3)}%;width:${(b - a).toFixed(3)}%" data-i="${agenda.indexOf(r)}"></i>`);
      marksText.set(id, rowText(r));
    });
    segs.innerHTML = parts.join('');
    agenda.forEach((r, i) => {
      if (r.vote || r.kind === 'vote') {
        // a vote is a tick at the moment it opened (a debate's row also carries the vote that settled it, which may be hours later)
        const w = r.vote && (S.votes || []).find((v) => v.roll === r.vote.roll);
        const ms = w ? w.open : r.vote ? r.vote.ms - 45000 : r.ms;
        const p = pos(ms);
        if (p >= 0 && p <= 100) {
          const yea = /pass|agreed|adopted/i.test((r.vote && r.vote.result) || r.outcome || '');
          out.push(`<button type="button" class="tm-mark tm-mark-vote ${yea ? 'is-yea' : 'is-nay'}" style="left:${p.toFixed(3)}%" data-id="v${i}" data-ms="${ms}" aria-label="${E(r.title)}"><i></i></button>`);
          marksText.set(`v${i}`, `${hm(ms)}  Vote${r.vote ? ` (roll ${r.vote.roll})` : ''}: ${r.kind === 'debate' ? r.title : r.title.replace(/^Vote /, '')}\n${r.outcome}`);
        }
      }
    });
    marks.innerHTML = out.join('');
    applyHidden();
    drawAgenda();
  }

  // the agenda panel: every item of the day, found by typing a bill number or a word of its title, a click goes there
  let query = '';
  function drawAgenda() {
    const q = compact(query);
    const rows = agenda.map((r, i) => ({ r, i })).filter(({ r }) => !q || r.compact.includes(q));
    agendaList.innerHTML = rows.length
      ? rows.map(({ r, i }) => `<button type="button" class="tm-ag-row tm-ag-${r.kind}" data-ms="${r.ms}" data-i="${i}"><span class="tm-ag-time">${hm(r.ms)}</span><span class="tm-ag-body"><b>${E(r.title)}</b>${r.detail ? `<i>${E(r.detail.length > 150 ? r.detail.slice(0, 149) + '…' : r.detail)}</i>` : ''}${r.outcome ? `<u>${E(r.outcome)}</u>` : ''}</span></button>`).join('')
      : `<p class="tm-ag-none">Nothing in this day matches "${E(query)}".</p>`;
    const hit = new Set(rows.map(({ i }) => String(i)));
    segs.classList.toggle('has-q', !!q);
    segs.querySelectorAll('.tm-seg').forEach((b) => b.classList.toggle('is-match', hit.has(b.dataset.i)));
    curRow = -1; markNow();
  }
  let curRow = -1;
  function markNow() {
    let cur = -1;
    for (let i = 0; i < agenda.length; i++) { if (agenda[i].ms <= S.wallMs) cur = i; else break; }
    if (cur === curRow) return;
    curRow = cur;
    agendaList.querySelectorAll('.tm-ag-row').forEach((b) => { const i = Number(b.dataset.i); b.classList.toggle('is-now', i === cur); b.classList.toggle('is-future', i > cur); });
    const r = agenda[cur];
    nowEl.hidden = !r;
    if (r) { nowEl.textContent = `${r.title}${r.detail ? ` · ${r.detail}` : ''}`; nowEl.dataset.ms = String(r.ms); nowEl.className = `tm-now tm-now-${r.kind === 'recess' ? 'other' : r.kind}`; }
    if (!agendaBox.hidden) { const n = agendaList.querySelector('.tm-ag-row.is-now'); if (n) agendaList.scrollTop = Math.max(0, n.offsetTop - agendaList.offsetTop - 40); }
  }

  // the moment, the scrubber and the buttons follow the controller
  let dragging = false;
  const setFill = () => { range.style.setProperty('--fill', `${range.value / 10}%`); scrub.style.setProperty('--fill', `${range.value / 10}%`); };
  // the label under the finger or pointer: the time, and what was on the floor then
  const rowAt = (ms) => { let cur = null; for (const r of agenda) { if (r.kind === 'vote') continue; if (r.ms <= ms) cur = r; else break; } return cur; };
  function showTip(m, pct) {
    const ms = wallOf(m), r = rowAt(ms);
    tip.hidden = false;
    tip.textContent = `${clockET(ms, true)}${r ? `\n${r.title}${r.detail ? `\n${r.detail}` : ''}${r.outcome ? `\n${r.outcome}` : ''}` : ''}`;
    tip.style.left = `${Math.max(8, Math.min(92, pct))}%`;
  }
  function paint() {
    if (S.error) { status.hidden = false; status.textContent = /404/.test(S.error) ? 'There is no video archive for this day.' : `Could not load this day (${S.error}).`; return; }
    if (!S.timeline) return;
    bounds(); drawMarks();
    markNow();
    $('.tm-moment-time', bar).textContent = clockET(S.wallMs, true);
    if (!dragging) range.value = String(Math.max(0, Math.min(1000, toRange(S.timeline.mediaFromWall(S.wallMs)))));
    setFill();
    setPlayIcon();
    const sp = S.rateX; bar.querySelectorAll('.tm-sp').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.x) === sp));
    const msg = S.error ? `Could not load this day: ${S.error}` : S.syncing && S.loaded ? 'Finding the moment in the recording…' : (S.timeline && S.timeline.anchors.length === 0 ? 'Lining the video up with the captions…' : '');
    status.hidden = !msg; status.textContent = msg;
    bar.classList.toggle('is-syncing', !!(S.syncing && S.loaded));
    document.documentElement.classList.toggle('tm-syncing', !!(S.syncing && S.loaded));
  }
  S.on(paint);

  playBtn.addEventListener('click', () => (S.playing ? S.pause() : S.play()));
  $('.tm-back', bar).addEventListener('click', () => S.seekMedia(Math.max(lo, S.timeline.mediaFromWall(S.wallMs) - 30)));
  $('.tm-fwd', bar).addEventListener('click', () => S.seekMedia(Math.min(hi - 2, S.timeline.mediaFromWall(S.wallMs) + 30)));
  bar.querySelectorAll('.tm-sp').forEach((b) => b.addEventListener('click', () => S.rate(Number(b.dataset.x))));
  $('.tm-leave', bar).addEventListener('click', () => { location.href = location.pathname; });

  // scrubbing moves the video as you drag (a seek every so often, not on every pixel), and lets go where you let go
  let lastSeek = 0;
  range.addEventListener('input', () => {
    dragging = true;
    const m = fromRange(Number(range.value));
    $('.tm-moment-time', bar).textContent = clockET(wallOf(m), true);
    setFill(); showTip(m, (range.value / 1000) * 100);
    const now = performance.now();
    if (now - lastSeek > 280) { lastSeek = now; S.seekMedia(m); S.wallMs = wallOf(m); S.targetWall = null; S.syncing = false; }
  });
  range.addEventListener('change', () => { dragging = false; S.seekWall(wallOf(fromRange(Number(range.value)))); });
  range.addEventListener('pointerup', () => { dragging = false; });
  const hover = (e) => {
    const r = range.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const m = lo + f * (hi - lo);
    showTip(m, f * 100);
  };
  range.addEventListener('pointermove', hover);
  range.addEventListener('pointerleave', () => { tip.hidden = true; });
  nowEl.addEventListener('click', () => { if (nowEl.dataset.ms) S.seekWall(Number(nowEl.dataset.ms)); });
  marks.addEventListener('click', (e) => { const b = e.target.closest('.tm-mark'); if (b) S.seekWall(Number(b.dataset.ms)); });
  marks.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.tm-mark'); if (!b) return;
    tip.hidden = false; tip.textContent = marksText.get(b.dataset.id) || '';
    const r = marks.getBoundingClientRect(), br = b.getBoundingClientRect();
    tip.style.left = `${Math.max(0, Math.min(r.width, br.left + br.width / 2 - r.left))}px`;
  });
  marks.addEventListener('pointerleave', () => { tip.hidden = true; });
  // the agenda panel opens above the bar; a click on an item goes there (on a phone it also gets out of the way)
  const placeAgenda = () => { agendaBox.style.bottom = `${bar.offsetHeight}px`; };
  const setAgenda = (open) => { agendaBox.hidden = !open; agendaBtn.setAttribute('aria-expanded', String(open)); agendaBtn.classList.toggle('is-on', open); if (open) { placeAgenda(); curRow = -1; markNow(); if (!matchMedia('(max-width: 760px)').matches) agendaFind.focus(); } };
  agendaBtn.addEventListener('click', () => setAgenda(agendaBox.hidden));
  $('.tm-ag-close', agendaBox).addEventListener('click', () => setAgenda(false));
  agendaFind.addEventListener('input', () => { query = agendaFind.value; drawAgenda(); });
  agendaList.addEventListener('click', (e) => { const b = e.target.closest('.tm-ag-row'); if (!b) return; S.seekWall(Number(b.dataset.ms)); if (matchMedia('(max-width: 760px)').matches) setAgenda(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !agendaBox.hidden) setAgenda(false); });
  addEventListener('resize', () => { if (!agendaBox.hidden) placeAgenda(); });

  // which kinds of moment the scrubber shows, and whether it covers the hours the House was not sitting
  const applyHidden = () => { marks.classList.toggle('hide-debate', hidden.has('debate')); ['debate', 'vote', 'speech', 'other'].forEach((k) => { marks.classList.toggle(`hide-${k}`, hidden.has(k)); segs.classList.toggle(`hide-${k}`, hidden.has(k)); bar.querySelector(`.tm-chip-${k}`).setAttribute('aria-pressed', String(!hidden.has(k))); }); };
  applyHidden();
  bar.querySelector('.tm-legend').addEventListener('click', (e) => {
    const c = e.target.closest('.tm-chip'); if (!c) return;
    const k = c.dataset.kind; hidden.has(k) ? hidden.delete(k) : hidden.add(k); applyHidden();
    try { localStorage.setItem('tm-hidden', JSON.stringify([...hidden])); } catch { /* no storage */ }
  });
  const box = bar.querySelector('.tm-outside-box');
  box.checked = outside;
  box.addEventListener('change', () => { outside = box.checked; try { localStorage.setItem('tm-outside', outside ? '1' : '0'); } catch { /* no storage */ } marksSig = ''; paint(); });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === ' ' && !e.target.closest('button, a')) { e.preventDefault(); S.playing ? S.pause() : S.play(); }
    else if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) S.seekMedia(Math.max(lo, S.timeline.mediaFromWall(S.wallMs) - (e.shiftKey ? 5 : 15)));
    else if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) S.seekMedia(Math.min(hi - 2, S.timeline.mediaFromWall(S.wallMs) + (e.shiftKey ? 5 : 15)));
  });

  // the line last clicked stays marked through the floor log being redrawn (it is redrawn whenever the moment moves)
  let hereTs = null;
  function markHere() { document.querySelectorAll('.proceedings-item.is-here').forEach((x) => { if (Number(x.dataset.ts) !== hereTs) x.classList.remove('is-here'); }); if (hereTs != null) document.querySelectorAll(`.proceedings-item[data-ts="${hereTs}"]`).forEach((x) => x.classList.add('is-here')); }
  S.on(markHere);
  // the floor log lists the whole day, the entries yet to come greyed: keep the newest that has happened at the top of the box as the moment moves
  let nowTs = null;
  function scrollLog() {
    const feed = document.getElementById('proceedings-feed'); if (!feed) return;
    const cur = feed.querySelector('.proceedings-item:not(.is-future)');
    const ts = cur ? cur.dataset.ts : '';
    if (ts === nowTs) return;
    nowTs = ts;
    feed.scrollTop = cur ? Math.max(0, cur.offsetTop - feed.offsetTop - 6) : 0;
  }
  S.on(() => requestAnimationFrame(scrollLog));

  // ================= click a line in the floor log, go to those words =================
  // The Clerk posts an entry a little after it happens, and its minute can be off, so the click lands on the caption line that says the same thing nearest the entry's time:
  // the bill number if the entry has one, else the ritual it names; with neither, on the entry's own time.
  const RITUALS = [[/\bprayer\b/i, /PRAYER|CHAPLAIN/], [/pledge/i, /PLEDGE OF ALLEGIANCE/], [/\bjournal\b/i, /JOURNAL/], [/adjourn/i, /ADJOURN/], [/\brecess\b/i, /RECESS/], [/one[- ]minute/i, /ONE.MINUTE|ONE MINUTES/], [/unfinished business/i, /UNFINISHED BUSINESS/], [/previous question/i, /PREVIOUS QUESTION/], [/motion to recommit/i, /MOTION TO RECOMMIT/]];
  function snapFor(item) {
    const est = S.timeline.captionFromWall(item.timestamp);
    const d = item.description || '';
    const ids = [...d.matchAll(/\b(?:H\.R\.|H\.Res\.|H\.J\.Res\.|H\.Con\.Res\.|S\.J\.Res\.|S\.Res\.|S\.)\s*(\d{1,5})\b/gi)].map((m) => m[1]);
    let test = null;
    if (ids.length) {
      test = window.Replay.billMentions(ids);   // the captioner says numbers as spoken: "H.R. 95. 76", "H.J. Res. TWO 13"
    } else {
      for (const [when, then] of RITUALS) if (when.test(d)) { test = (x) => then.test(x); break; }
    }
    const cue = test ? window.Replay.snap(S.cues, est, test, 600) : null;
    return { c: cue ? cue.t : est, snapped: !!cue };
  }
  document.addEventListener('click', (e) => {
    const row = e.target.closest && e.target.closest('.proceedings-item[data-ts]');
    if (!row || e.target.closest('a, button')) return;
    const ts = Number(row.dataset.ts);
    const item = S.items.find((x) => x.timestamp === ts);
    if (!item || !S.timeline) return;
    const { c } = snapFor(item);
    S.seekWall(S.timeline.wallFromCaption(c) - 3000, ts);   // three seconds of lead-in; the line clicked stays in the log
    hereTs = ts; markHere();
  });

  // ================= once the first spot is found, learn the rest of the day in the background =================
  let started = false;
  S.on(() => { if (!started && S.loaded && !S.syncing && S.timeline) { started = true; setTimeout(() => S.calibrate && S.calibrate(), 2500); } });

  paint();
})();
