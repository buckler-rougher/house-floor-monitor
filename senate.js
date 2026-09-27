// Senate board.
//
// The page is index.html adapted, so the chrome is the House board's chrome and
// the element ids are its ids. This file drives the parts of it that are
// chamber-agnostic, plus the one Senate panel that has real data behind it.
//
// Deliberately NOT app.js. That file is 12,000 lines built around the House
// Clerk's feed and its caption track; running it here would fire a dozen
// requests for House data and populate sections with the wrong chamber's facts.
// The stylesheet is the layer that should be identical. The behaviour is not.

// api.evanhollander.org routes /house-floor/* to the Worker and nothing else.
// /senate-floor/* answers 522, meaning the request never reaches it, because the
// route list lives in the Cloudflare dashboard rather than wrangler.toml and has
// no entry for it. The Worker itself already accepts either prefix and derives
// `chamber` from it, so this is a one-word change once that route is added.
const API = 'https://api.evanhollander.org/house-floor/api';

// Only used if the payload omits it: a Congress starts in each odd year, and
// the 119th began in 2025.
const CONGRESS_FALLBACK = 119 + Math.floor((new Date().getFullYear() - 2025) / 2);

const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Day-first, matching the House board. fmtDateLong there gives
// "Saturday, 26 September 2026"; month-first would be a different house style on
// a page that is otherwise the same page.
const fmtDate = (d) =>
    `${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
const fmtDateLong = (d) => `${DAY_NAMES[d.getDay()]}, ${fmtDate(d)}`;

// Notice timestamps use the House whip panel's format, which is day-first with
// a SHORT month: app.js builds "24 Sep at 3:45 PM ET" there. These posts carry
// a date and no time, so it stops at "24 Sep".
const fmtDateNotice = (d) =>
    `${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;

function noticeDate(value) {
    const m = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return m ? fmtDateNotice(new Date(+m[3], +m[1] - 1, +m[2])) : String(value || '');
}

// Every date on this board goes through here.
//
// The sources each write dates their own way and none of them match the board:
// GPO says "Sept. 24, 2026", the vote menu says "24-Sep", the schedule says
// "2026-09-28". Rendering any of those as-is puts three formats on one page,
// which is what kept happening. The board's format is day-first, full month.
function boardDate(value) {
    if (!value) return '';
    const v = String(value).trim();

    // "2026-09-28"
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return fmtDate(new Date(+m[1], +m[2] - 1, +m[3]));

    // "Sept. 24, 2026" or "September 24, 2026"
    m = v.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),\s*(\d{4})/);
    if (m) {
        const i = MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3)));
        if (i >= 0) return fmtDate(new Date(+m[3], i, +m[2]));
    }

    // "09.16.2026", which is how a caucus post stamps itself. A cloture motion
    // that has been filed and not yet voted only exists in that prose, so this
    // is the one date shape on a cloture card that does not come from the vote
    // menu. Without this branch it fell through and printed itself raw.
    m = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m) return fmtDate(new Date(+m[3], +m[1] - 1, +m[2]));

    // "24-Sep": the vote menu carries no year, so none is invented.
    m = v.match(/^(\d{1,2})-([A-Za-z]{3,})$/);
    if (m) {
        const i = MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(m[2].toLowerCase().slice(0, 3)));
        if (i >= 0) return `${String(+m[1]).padStart(2, '0')} ${MONTH_NAMES[i]}`;
    }

    return v;   // Unrecognised: show the source's own string rather than a wrong one.
}

// The module takes these as dependencies rather than reaching for a board's
// globals, so each board supplies its own.
// The Worker marks block boundaries and list membership in the notice text with
// control characters, so any string lifted out of a notice still carries them.
// They are invisible in the DOM but they are there, and they break a leading
// capital: "\u0002Passage of Cal. #449" rendered with a stray glyph in front of it.
const stripMarks = (t) => String(t ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim();

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const _htmlCache = new WeakMap();
function setIfChanged(node, html) {
    if (!node) return;
    if (_htmlCache.get(node) === html) return;
    _htmlCache.set(node, html);
    node.innerHTML = html;
}

const el = (id) => document.getElementById(id);

// The animation module needs this board's nodes; ids differ per page.
globalThis.BoardAnimations?.init?.({ absenteeList: document.getElementById('absentee-list') });

// ── Clocks ───────────────────────────────────────────────────────────────────
// Same options object the House board uses: 24-hour, seconds, en-US pinned so
// the shape cannot change with the viewer's machine.
// Same faces as the House board, from the same file. The tick marks are drawn
// by initAnalogClocks(); without it the faces are bare circles, which is what
// this board showed when these functions were hand-ported and that one was
// missed.
const { initAnalogClocks, updateAnalogClock, getTimeParts } = globalThis.BoardClocks;

function updateTimestamp() {
    const now = new Date();
    const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const set = (id, o) => { const n = el(id); if (n) n.textContent = now.toLocaleTimeString('en-US', o); };
    set('local-time', opts);
    set('dc-time',  { ...opts, timeZone: 'America/New_York' });
    set('utc-time', { ...opts, timeZone: 'UTC' });

    // The header carries three clock faces as well as three readouts; only the
    // readouts were being driven, so the hands sat wherever the markup left them.
    updateAnalogClock(el('local-analog'), {
        hours: now.getHours(), minutes: now.getMinutes(), seconds: now.getSeconds(),
    });
    updateAnalogClock(el('dc-analog'),  getTimeParts(now, 'America/New_York'));
    updateAnalogClock(el('utc-analog'), getTimeParts(now, 'UTC'));
    updateNextSessionCountdown();
}

// ── Weather and the Capitol camera ───────────────────────────────────────────
// Both are the Capitol, not a chamber, so they are the House board's sources
// unchanged. The camera is a Senate-hosted stream even on the House board.
const WEATHER_COORDS = { lat: 38.889722, lon: -77.008889 };
const CAPCAM_URL = 'https://www-senate-gov-media-srs.akamaized.net/hls/live/2036784/capcam/capcam/master.m3u8';

async function fetchWeather() {
    const temp = el('weather-temp'), cond = el('weather-condition');
    try {
        const points = await fetch(`https://api.weather.gov/points/${WEATHER_COORDS.lat},${WEATHER_COORDS.lon}`);
        if (!points.ok) throw new Error('Points API failed');
        const forecastUrl = (await points.json()).properties.forecastHourly;
        const forecast = await fetch(forecastUrl);
        if (!forecast.ok) throw new Error('Forecast API failed');
        const current = (await forecast.json()).properties.periods[0];
        if (temp) temp.textContent = `${Math.round(current.temperature)}°${current.temperatureUnit}`;
        if (cond) cond.textContent = current.shortForecast;
    } catch (e) {
        console.error('Weather fetch error:', e);
        if (temp) temp.textContent = '--°';
        if (cond) cond.textContent = 'N/A';
    }
}

function initCapcam() {
    const video = el('capcam-video');
    if (!video) return;
    video.muted = true;
    if (window.Hls && Hls.isSupported()) {
        const hls = new Hls({ liveDurationInfinity: true });
        hls.loadSource(CAPCAM_URL);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = CAPCAM_URL;
        video.play().catch(() => {});
    }
}

// ── Connection light ─────────────────────────────────────────────────────────
// On the House board this tracks the SSE stream, so it means "connected to the
// data", not "the floor is live". Same meaning kept here, driven by whether the
// roll call source answers. It is never set to live on a timer, because a light
// that is green regardless of the data would be decoration.
// Two states, never none.
//
// @keyframes pulse is not defined in the stylesheet, so .connecting and .live
// both name an animation that does not exist and render as static dots, amber
// and green. The BARE .live-indicator is the one that animates: it runs
// live-pulse, which cycles opacity to 0.6 and scale to 0.9. So stripping both
// classes does not mean "no state", it means the dot starts flashing and
// growing -- which is why this looked wrong next to the House board, where
// app.js always leaves .live on.
function setConnection(state) {
    const dot = document.querySelector('.live-indicator');
    if (!dot) return;
    const live = state === 'live';
    dot.classList.toggle('live', live);
    dot.classList.toggle('connecting', !live);
}


// ── Balance of power ─────────────────────────────────────────────────────────
//
// 100 seats, fixed, so "whole number" is always 100 and a vacancy is a seat the
// roster does not fill. That is the Senate's own phrasing and the reason the
// threshold shown is 51: a majority of the whole number, not of those seated.
//
// Control is deliberately not "whoever has the most". Both independents caucus
// with the Democrats and the Vice President breaks ties, so a 50-48-2 Senate is
// run by the smaller bloc. The roster records a party and says nothing about
// caucusing, so the badge appears only when a party holds 51 outright and the
// panel says why when it does not.
function renderBalance(data) {
    const set = (id, v) => { const n = el(id); if (n) n.textContent = v; };
    const c = data.counts || {};
    set('party-dem', c.D ?? '--');
    set('party-rep', c.R ?? '--');
    set('party-ind', c.I ?? '--');
    set('party-total', data.seats ?? '--');

    const badge = el('majority-control-badge');
    if (badge) {
        if (data.control) {
            badge.textContent = `${data.control === 'R' ? 'REPUBLICAN' : 'DEMOCRATIC'} CONTROL`;
            badge.className = `majority-badge ${data.control.toLowerCase()}-control`;
        } else {
            badge.className = 'majority-badge hidden';
        }
    }

    const seats = data.seats || 100;
    const pct = (n) => `${((n || 0) / seats) * 100}%`;
    const fills = { 'rep-fill': c.R, 'dem-fill': c.D, 'ind-fill': c.I, 'vac-fill': data.vacancies };
    for (const [id, n] of Object.entries(fills)) { const node = el(id); if (node) node.style.width = pct(n); }

    // Majority on the left, as on the House board. appendChild moves existing
    // nodes, so re-appending in order is the reorder.
    const bar = el('rep-fill')?.parentElement;
    if (bar) {
        const order = (c.D || 0) > (c.R || 0)
            ? ['dem-fill', 'rep-fill', 'ind-fill', 'vac-fill']
            : ['rep-fill', 'dem-fill', 'ind-fill', 'vac-fill'];
        for (const id of order) { const node = el(id); if (node) bar.appendChild(node); }
    }

    // Vacancies: the Senate fills them by appointment in most states, so this is
    // usually 0 and the section would otherwise sit empty asserting nothing.
    const vacSection = el('vacancies-section');
    const vacList = el('vacancies-list');
    set('vacancies-count', data.vacancies ?? '--');
    if (vacList) {
        vacList.innerHTML = '';
        const row = document.createElement('div');
        row.className = 'vacancy-item';
        // Short on purpose: this sits in a narrow column and a sentence wraps to
        // three lines there.
        row.textContent = data.vacancies
            ? `${data.vacancies} seat${data.vacancies === 1 ? '' : 's'} unfilled`
            : `All ${data.seats || 100} seats filled`;
        vacList.appendChild(row);
    }
    if (vacSection) vacSection.classList.remove('hidden');

    // A date, not a clock time. This panel changes when a seat changes, which is
    // a matter of months, so a time of day would imply a freshness the data does
    // not have. The roster stamps itself; the fetch time is only a fallback.
    const stamp = el('party-breakdown-last-update');
    if (stamp) {
        const d = data.lastUpdated ? new Date(data.lastUpdated) : null;
        stamp.textContent = fmtDate(d && !isNaN(d) ? d : new Date());
    }

    if (!data.control && data.controlNote) console.info('[senate] control unresolved:', data.controlNote);
}

async function loadBalance() {
    try {
        const r = await fetch(`${API}/senate/roster`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        renderBalance(await r.json());
    } catch (e) {
        const stamp = el('party-breakdown-last-update');
        if (stamp) stamp.textContent = 'unavailable';
        console.error('Roster fetch failed:', e);
    }
}

// ── Airport delays ───────────────────────────────────────────────────────────
// The same module the House board uses, given this page's panel. The airports
// are the Washington ones either way: this is the building's weather problem,
// not a chamber's.
function initAirportDelays() {
    const mod = globalThis.AirportDelays;
    const listEl = el('airport-delays-list');
    if (!mod || !listEl) return;
    mod.init({ listEl, escapeHtml, setIfChanged });
    mod.fetchAirportNames()
       .then(() => mod.fetchAirportDelays())
       .catch((e) => console.error('Airport delays failed:', e));
    setInterval(() => mod.fetchAirportDelays(), mod.FAA_CONFIG.refreshInterval);
}

// ── Congress banner and next-session countdown ───────────────────────────────
//
// The House board reads its congress line out of an XML feed that has no Senate
// equivalent, so it is spelled out here. "One hundred nineteenth", not "119th":
// that is how the chamber writes its own name.
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ONES_ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
    'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth',
    'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const TENS_ORD = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth',
    'seventieth', 'eightieth', 'ninetieth'];

function ordinalWords(n) {
    if (!Number.isInteger(n) || n <= 0 || n >= 1000) return `${n}th`;
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    const head = hundreds ? `${ONES[hundreds]} hundred` : '';
    if (!rest) return `${ONES[hundreds]} hundredth`;
    let tail;
    if (rest < 20) tail = ONES_ORD[rest];
    else if (rest % 10 === 0) tail = TENS_ORD[Math.floor(rest / 10)];
    else tail = `${TENS[Math.floor(rest / 10)]}-${ONES_ORD[rest % 10]}`;
    return [head, tail].filter(Boolean).join(' ');
}

// Ticks every second, so it is driven from the clock loop rather than its own.
let nextSessionAt = null;

function formatNextSessionCountdown(target) {
    if (!(target instanceof Date) || Number.isNaN(target.getTime())) return '';
    const diffMs = target.getTime() - Date.now();
    if (diffMs <= 0) return 'NEXT SESSION: NOW';
    const total = Math.floor(diffMs / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const parts = [];
    if (days) parts.push(`${days}D`);
    if (hours) parts.push(`${hours}H`);
    if (mins || days || hours) parts.push(`${mins}M`);
    parts.push(`${String(secs).padStart(2, '0')}S`);
    return `NEXT SESSION IN ${parts.join(' ')}`;
}

function updateNextSessionCountdown() {
    const node = el('next-session-countdown');
    if (!node) return;
    if (!nextSessionAt) { node.style.display = 'none'; return; }
    node.style.display = 'inline-flex';
    node.textContent = formatNextSessionCountdown(nextSessionAt);
}

function renderCongressBanner(data) {
    const text = document.querySelector('.congress-text');
    if (text && data?.latest) {
        const congress = data.congress || CONGRESS_FALLBACK;
        const session = data.session || '';
        text.textContent = `${ordinalWords(congress)} Congress${session ? ` - Session ${session}` : ''}`.toUpperCase();
    }
    const status = el('floor-status');
    if (status) status.textContent = document.body.classList.contains('recess-mode')
        ? 'Senate adjourned' : 'Senate in session';

    const nc = data?.latest?.nextConvene ? new Date(data.latest.nextConvene) : null;
    nextSessionAt = nc && !isNaN(nc) && nc.getTime() > Date.now() ? nc : null;
    updateNextSessionCountdown();
}

// ── Session status ───────────────────────────────────────────────────────────
//
// From the Senate's own session-day record, which carries the convene and
// adjourn times and, for the next sitting, whether it is a pro forma. That flag
// is the point: a pro forma is gavel in, gavel out, so calling it "in session"
// would be true and misleading at once.
function renderSchedule(data) {
    const line = el('session-text');
    const next = el('next-votes');
    const latest = data?.latest;
    if (!line || !latest) return;

    const now = Date.now();
    const convened = latest.convene ? new Date(latest.convene) : null;
    const adjourned = latest.adjourn ? new Date(latest.adjourn) : null;
    const sitting = convened && convened.getTime() <= now && (!adjourned || adjourned.getTime() > now);

    if (sitting) {
        line.textContent = 'IN SESSION';
        document.body.classList.remove('recess-mode');
    } else {
        line.textContent = 'ADJOURNED';
        document.body.classList.add('recess-mode');
    }

    if (next) {
        const nc = latest.nextConvene ? new Date(latest.nextConvene) : null;
        if (nc && !isNaN(nc)) {
            const when = nc.toLocaleString('en-US', {
                weekday: 'short', day: '2-digit', month: 'short',
                hour: '2-digit', minute: '2-digit', hour12: true,
                timeZone: 'America/New_York', timeZoneName: 'short',
            });
            next.textContent = `NEXT CONVENES ${when}${latest.nextIsProForma ? ' (PRO FORMA)' : ''}`;
        } else {
            next.textContent = '\u00a0';
        }
    }
}

async function loadSchedule() {
    try {
        const r = await fetch(`${API}/senate/schedule`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        renderSchedule(data);
        renderCongressBanner(data);
        globalThis.VotingCalendar?.setData(scheduleToCalendarItems(data));
    } catch (e) {
        const line = el('session-text');
        if (line) line.textContent = 'SESSION STATUS UNAVAILABLE';
        console.error('Schedule fetch failed:', e);
    }
}

// ── Calendar ─────────────────────────────────────────────────────────────────
//
// The same grid the House board draws, fed from Senate session days instead of
// a House voting-days ICS.
//
// Two sources, and they disagree. floor_schedule.xml records the days the
// Senate actually convened; 2026_schedule.xml plans the non-legislative
// periods. 27 of this year's 138 sittings fall inside a planned recess, so the
// record has to outrank the plan wherever both speak -- which is why sittings
// are added first and a recess day is skipped if one already claims that date.
//
// The plan is still worth drawing for dates the record cannot reach, because
// floor_schedule.xml is retrospective: it ends at the last day the Senate sat
// and says nothing about next month. Those days are drawn in the module's grey
// rather than a colour of their own, since a tentative document should not be
// dressed as fact. No sitting days are invented for future dates: a weekday
// outside a recess is a fair guess, and a guess is not what this board does.
function scheduleToCalendarItems(data) {
    const items = [];
    const seen = new Set();
    const add = (date, label) => {
        if (!date || seen.has(date)) return;
        seen.add(date);
        items.push({ date, type: 'vote-day', label });
    };

    // Days the Senate actually convened. Recorded fact.
    const sat = [];
    for (const d of data?.days || data?.recent || []) {
        const date = (d.convene || '').slice(0, 10);
        if (!date) continue;
        // A pro forma still counts as a day the Senate sat, so it anchors the
        // forecast below, but it does not go on the calendar: gavel in and gavel
        // out is not a session day and drawing it as one is what the House board
        // avoids.
        sat.push(date);
        if (d.proForma) continue;
        add(date, 'SESSION');
    }

    // Planned sittings, for the part of the calendar the record cannot reach:
    // floor_schedule.xml is retrospective and stops at the last day the Senate
    // sat. The tentative annual schedule names the NON-legislative periods, so
    // a weekday outside one is a planned sitting day. That is a plan and it
    // moves, exactly as the House voting-days feed moves when votes are added
    // or cancelled; the calendar shows the plan as it currently stands.
    //
    // Recesses are drawn as nothing at all. No votes planned is the same
    // statement as a blank day on the House board, and the earlier version
    // greyed them as "Cancelled", which is a different and wrong claim.
    const recess = new Set();
    for (const r of data?.recesses || []) {
        if (!r.begin || !r.end) continue;
        const start = new Date(`${r.begin}T12:00:00Z`);
        const end = new Date(`${r.end}T12:00:00Z`);
        if (isNaN(start) || isNaN(end) || end < start) continue;
        for (let t = start, n = 0; t <= end && n < 400; t = new Date(t.getTime() + 86400000), n++) {
            recess.add(t.toISOString().slice(0, 10));
        }
    }

    const lastSat = sat.sort().pop();
    if (lastSat) {
        // Out to a year, which covers the three months the grid can show plus
        // whatever the month navigation reaches.
        let t = new Date(`${lastSat}T12:00:00Z`);
        for (let n = 0; n < 366; n++) {
            t = new Date(t.getTime() + 86400000);
            const date = t.toISOString().slice(0, 10);
            const dow = t.getUTCDay();
            if (dow === 0 || dow === 6) continue;
            if (recess.has(date)) continue;
            add(date, 'PLANNED');
        }
    }
    return items;
}

// ── Missing members ──────────────────────────────────────────────────────────
//
// The Senate's per-vote file lists all 100 members with a vote_cast of Yea, Nay
// or Not Voting, so the last roll call is the whole panel. It carries no
// bioguide id, only an internal lis_member_id, so the Worker joins the roster
// for photos -- on last name and state, with diacritics stripped, because the
// two files disagree about Lujan and Luján.
//
// Filtering is CSS off .absentee-list[data-filter], the way the House board
// does it. Rebuilding the list per filter destroyed and recreated every
// surviving row, which refetched and flashed the photos.
const PHOTO_PLACEHOLDER = `<svg viewBox="0 0 28 28" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="4" fill="#b22234"/><rect x="0" y="4" width="10" height="4" fill="#dde"/><rect x="0" y="8" width="10" height="4" fill="#b22234"/><rect x="0" y="12" width="10" height="4" fill="#dde"/><rect x="0" y="16" width="10" height="4" fill="#b22234"/><rect x="0" y="20" width="10" height="4" fill="#dde"/><rect x="0" y="24" width="10" height="4" fill="#b22234"/><rect x="0" y="0" width="4" height="8" fill="#3c3b6e"/><rect x="8" y="0" width="20" height="28" fill="#161b22" opacity="0.75"/><circle cx="17" cy="11" r="5" fill="#5e7080"/><path d="M6 28 C6 20 11 17 17 17 C23 17 28 20 28 28 Z" fill="#5e7080"/></svg>`;

const photoUrlFor = (bioguide) => bioguide
    ? `https://bioguide.congress.gov/bioguide/photo/${bioguide.charAt(0)}/${bioguide}.jpg`
    : '';

function renderAbsences(data) {
    const list = el('absentee-list');
    const info = el('absentee-roll-info');
    if (!list) return;

    const absent = data?.absent || [];
    const partyKey = (p) => (p === 'R' ? 'rep' : p === 'D' ? 'dem' : 'ind');
    const counts = { dem: 0, rep: 0, ind: 0 };
    for (const m of absent) counts[partyKey(m.party)]++;

    const set = (id, v) => { const n = el(id); if (n) n.textContent = v; };
    set('absentee-dem', counts.dem);
    set('absentee-rep', counts.rep);
    set('absentee-ind', counts.ind);
    set('absentee-total', absent.length);
    const indMetric = el('absentee-ind-metric');
    if (indMetric) indMetric.style.display = counts.ind ? '' : 'none';

    // Same line the House board writes: "Roll 314 • 16 September 2026 7:05 PM".
    // The vote's own file stamps it "September 24, 2026,  01:45 PM", so it is
    // reordered day-first to match the board's date format.
    if (info && data?.rollCall) {
        let when = '';
        const m = (data.voteDate || '').match(/^(\w+)\s+(\d{1,2}),\s*(\d{4}),?\s*(.*)$/);
        if (m) {
            const time = m[4].trim().replace(/^0/, '');
            when = `${parseInt(m[2], 10)} ${m[1]} ${m[3]}${time ? ' ' + time : ''}`;
        } else if (data.date) {
            when = data.date;
        }
        info.textContent = `Roll ${data.rollCall}${when ? ' \u2022 ' + when : ''}`;
    }

    if (!absent.length) {
        setIfChanged(list, '<div class="absentee-member">ALL SENATORS VOTED</div>');
        return;
    }

    const parts = absent.map((m, i) => {
        const cls = partyKey(m.party);
        const partyClass = cls === 'rep' ? 'republican' : cls === 'dem' ? 'democrat' : 'independent';
        const name = escapeHtml(`${m.first} ${m.last}`.trim());
        const photo = photoUrlFor(m.bioguide);
        return `
        <div class="absentee-member ${cls}" data-absentee-index="${i}">
            <div class="absentee-photo-wrap">
                <div class="absentee-photo-placeholder">${PHOTO_PLACEHOLDER}</div>
                ${photo ? `<img class="absentee-photo" src="${escapeHtml(photo)}" alt="${name}" loading="lazy" onload="this.style.opacity='1'" onerror="this.remove()">` : ''}
            </div>
            <div class="absentee-meta">
                <span class="absentee-name">${name}</span>
                <span class="absentee-party-tag ${partyClass}">${escapeHtml(m.party)}</span>
                <span class="absentee-state">${escapeHtml(m.state)}</span>
            </div>
        </div>`;
    });
    setIfChanged(list, parts.join(''));
}

function initAbsenceFilters() {
    const panel = el('absentee');
    const list = el('absentee-list');
    if (!panel || !list) return;

    let mode = 'all';
    panel.addEventListener('click', (e) => {
        // Both the filter bar and the metric boxes, the way the House board does
        // it. Matching only the buttons meant clicking DEMOCRATS did nothing,
        // which is most of the panel's surface.
        const btn = e.target.closest('.absentee-filter-btn');
        const metric = e.target.closest('.party-metric[data-filter]');
        const target = btn || metric;
        if (!target) return;
        const next = target.dataset.filter;
        if (!next) return;

        // Clicking the active party filter clears back to all.
        mode = (next !== 'all' && next === mode) ? 'all' : next;

        panel.querySelectorAll('.absentee-filter-btn').forEach((b) =>
            b.classList.toggle('active', b.dataset.filter === mode));

        // The rows are never rebuilt: the filter is a CSS attribute, and
        // animateAbsenteeFilter measures the list around the change. See
        // lib/animations.js for why rebuilding was wrong.
        const apply = () => {
            if (mode === 'all') delete list.dataset.filter;
            else list.dataset.filter = mode;
        };
        const anim = globalThis.BoardAnimations;
        if (anim?.animateAbsenteeFilter) anim.animateAbsenteeFilter(apply);
        else apply();
    });
}

async function loadAbsences() {
    try {
        const r = await fetch(`${API}/senate/absences`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        renderAbsences(await r.json());
    } catch (e) {
        const info = el('absentee-roll-info');
        if (info) info.textContent = 'unavailable';
        console.error('Absences fetch failed:', e);
    }
}

// ── Pending on the calendar ──────────────────────────────────────────────────
//
// General Orders, newest-placed first. See the Worker for why this is not
// "bills this week": the Senate publishes no weekly agenda, and what goes by
// unanimous consent is cleared on an internal hotline that is published
// nowhere. This is the backlog, and its newest entries are the closest thing
// to a forward signal that exists in public.
// ── Caucus floor notices ─────────────────────────────────────────────────────
//
// Both Democratic Caucus feeds in one list: SCHEDULE for the next sitting day
// and WRAP UP for the one just finished. Same markup as the House board's whip
// notices, including the type filter.
//
// The types are the caucus's own, with their own badge classes in styles.css.
// Borrowing the House board's whip-type-floor and whip-type-nightly would have
// left a badge whose class said one thing and whose text said another.
const NOTICE_TYPES = {
    'schedule': { label: 'SCHEDULE' },
    'wrap-up':  { label: 'WRAP UP' },
};
let _notices = [];
let _noticeFilter = 'all';

// The Worker returns blocks separated by blank lines, with list items prefixed
// \u0001. Consecutive items become one <ul>, everything else a <p>. The
// stylesheet already styles both inside .whip-update-body.
const LI_MARK = '\u0001';    // unordered item
const OLI_MARK = '\u0002';   // ordered item

// A wrap-up renders as its headed blocks with the tallies pulled out, rather
// than as a paragraph that happens to end in "; adopted: 77-23.". The Worker
// splits it; this draws it.
function wrapUpHtml(sections) {
    return sections.map((sec) => {
        const head = sec.heading
            ? `<div class="bill-modal-section-label">${escapeHtml(sec.heading)}</div>` : '';
        const items = sec.items.map((it) => {
            if (it.yeas == null) return `<p>${escapeHtml(it.text)}</p>`;
            // Green when it carried, red when it did not. "adopted", "invoked",
            // "agreed to" and "confirmed" all mean it carried; "not agreed to"
            // and "rejected" do not, and the word "not" is the whole difference.
            const carried = /^(?!not\b)(adopted|invoked|agreed to|confirmed|passed)/i.test(it.result);
            return `<p><span class="wrapup-result ${carried ? 'carried' : 'failed'}">${
                escapeHtml(`${it.result} ${it.yeas}-${it.nays}`)
            }</span>${escapeHtml(it.text)}</p>`;
        }).join('');
        return head + items;
    }).join('');
}

function noticeBodyHtml(text) {
    const blocks = String(text || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    const out = [];
    let list = [];
    let ordered = false;
    const flush = () => {
        if (!list.length) return;
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${list.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</${tag}>`);
        list = [];
    };
    for (const b of blocks) {
        const isOl = b.startsWith(OLI_MARK);
        const isUl = b.startsWith(LI_MARK);
        if (isOl || isUl) {
            // A run only groups while the list type holds.
            if (list.length && ordered !== isOl) flush();
            ordered = isOl;
            list.push(b.slice(1));
            continue;
        }
        flush();
        out.push(`<p>${escapeHtml(b)}</p>`);
    }
    flush();
    return out.join('');
}

function renderNotices() {
    const feed = el('caucus-notices-feed');
    if (!feed) return;
    const shown = _noticeFilter === 'all' ? _notices : _notices.filter((n) => n.type === _noticeFilter);
    if (!shown.length) {
        setIfChanged(feed, '<div class="whip-updates-loading">No floor notices.</div>');
        return;
    }
    const html = shown.slice(0, 20).map((n) => {
        const t = NOTICE_TYPES[n.type] || { label: n.type.toUpperCase() };
        return `
            <div class="whip-update-item">
                <div class="whip-update-meta">
                    <span class="whip-type-badge whip-type-${escapeHtml(n.type)}" data-filter-type="${escapeHtml(n.type)}">${escapeHtml(t.label)}</span>
                    <span class="whip-update-title">${escapeHtml(n.title)}</span>
                    <span class="whip-update-time">${escapeHtml(noticeDate(n.published))}</span>
                </div>
                <div class="whip-update-body">${
                    n.sections?.length ? wrapUpHtml(n.sections) : noticeBodyHtml(n.body || n.excerpt || '')
                }</div>
            </div>`;
    }).join('');
    setIfChanged(feed, html);
}

function renderNoticeFilter() {
    const dd = el('notice-filter-dropdown');
    if (!dd) return;
    const counts = { all: _notices.length };
    for (const n of _notices) counts[n.type] = (counts[n.type] || 0) + 1;
    // whip-type-${key} carries the chip's colour, matching its badge in the feed.
    const chip = (key, label) => `<button class="whip-filter-chip whip-type-${key}${_noticeFilter === key ? ' active' : ''}" data-notice-filter="${key}">${label}${counts[key] ? ` (${counts[key]})` : ''}</button>`;
    dd.innerHTML = `<div class="whip-filter-inner">${
        [chip('all', 'ALL'), ...Object.entries(NOTICE_TYPES).map(([k, v]) => chip(k, v.label))].join('')
    }</div>`;
}

function initNoticeFilter() {
    const btn = el('notice-filter-btn');
    const dd = el('notice-filter-dropdown');
    if (!btn || !dd) return;
    const anim = globalThis.BoardAnimations;
    btn.addEventListener('click', () => {
        // Same drawer the House board uses: in flow, with the panel height
        // pinned so opening it does not reflow the page every frame.
        if (dd.hidden) anim.openDrawer(dd);
        else anim.closeDrawer(dd);
    });
    dd.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-notice-filter]');
        if (!chip) return;
        _noticeFilter = chip.dataset.noticeFilter;
        renderNoticeFilter();
        renderNotices();
    });
}

// ── Nominations ──────────────────────────────────────────────────────────────
//
// Four stages from the Senate's own XML. Only the calendar stage can reach the
// floor; committee and privileged are upstream of it, and confirmed is done.
// Every stage the Senate publishes. Calendar and privileged are the two that can
// reach the floor -- a privileged nomination does not have to sit on the
// Executive Calendar first -- so those lead.
const NOM_STAGES = {
    calendar:   { label: 'ON CALENDAR',  badge: 'schedule', status: 'scheduled' },
    privileged: { label: 'PRIVILEGED',   badge: 'schedule', status: 'scheduled' },
    committee:  { label: 'IN COMMITTEE', badge: 'wrap-up',  status: 'pending' },
    confirmed:  { label: 'CONFIRMED',    badge: 'wrap-up',  status: 'passed' },
    failed:     { label: 'RETURNED',     badge: 'wrap-up',  status: 'failed' },
    withdrawn:  { label: 'WITHDRAWN',    badge: 'wrap-up',  status: 'failed' },
};
let _nomCounts = {};

// The XML dates are ISO; the card format is day-first with a short month.
function noticeDate2(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? fmtDateNotice(new Date(+m[1], +m[2] - 1, +m[3])) : '';
}

function nominationCard(n) {
    const st = NOM_STAGES[n.stage] || { label: n.stage.toUpperCase(), status: 'scheduled' };
    return `
        <div class="bill-card-wrap">
            <button class="bill-card" data-pn="${escapeHtml(n.pn || '')}" data-status="${st.status}" type="button">
                <div class="bill-status ${st.status}" aria-hidden="true">${STATUS_MARK[st.status] || ''}</div>
                <div class="bill-info">
                    <div class="bill-id-row">
                        <span class="bill-id">${escapeHtml(n.pn || 'PN')}</span>
                        ${n.calendarNo ? `<span class="bill-calendar-no">Cal. No. ${escapeHtml(String(n.calendarNo))}</span>` : ''}
                    </div>
                    <div class="bill-title">${escapeHtml(n.description || '')}</div>
                    <div class="bill-meta">
                        <div class="bill-action">${escapeHtml([n.organization, n.committee].filter(Boolean).join(' \u00b7 '))}</div>
                        <div class="bill-date">${escapeHtml(n.reported ? noticeDate2(n.reported) : '')}</div>
                    </div>
                </div>
            </button>
        </div>`;
}

// Drop the fade once a list is scrolled to its end: with nothing below it, a
// fade suggests more that is not there.
function watchListScroll(node) {
    if (!node) return;
    const check = () => node.classList.toggle('is-at-end',
        node.scrollTop + node.clientHeight >= node.scrollHeight - 2);
    // Listener once, check every time. It used to return early on an already
    // watched list, so the class was decided by whatever the list held on its
    // first render and never revisited: a section that later held one card kept
    // a fade over empty space, and one that grew lost the fade it needed.
    if (!node.dataset.watched) {
        node.dataset.watched = '1';
        node.addEventListener('scroll', check, { passive: true });
    }
    check();
}

// The three finished stages are an archive, not a list of business: CONFIRMED
// alone runs to 1,629 and reaches back to 20 January 2025. Only the newest
// forty are drawn, and the heading says so rather than showing a count the list
// stops well short of. The three pending stages are drawn whole, because every
// row in them is something that can still reach the floor.
const NOM_FINISHED = new Set(['confirmed', 'withdrawn', 'failed']);
const NOM_SHOWN = 40;

function renderNominations() {
    for (const stage of Object.keys(NOM_STAGES)) {
        const list = el(`nom-list-${stage}`);
        const count = el(`nom-count-${stage}`);
        const rows = _nominations.filter((n) => n.stage === stage);
        const capped = NOM_FINISHED.has(stage) && rows.length > NOM_SHOWN;
        const shown = capped ? rows.slice(0, NOM_SHOWN) : rows;
        if (count) {
            // "40 of 1,629" only where the list really was cut. Deriving it from
            // a count-versus-length comparison instead said "0 of 151" for a
            // stage whose rows had not arrived yet, which reads as a failure
            // rather than as a window.
            const total = _nomCounts[stage] ?? rows.length;
            count.textContent = capped ? `${shown.length} of ${total.toLocaleString('en-US')}`
                : total == null ? '' : String(total);
        }
        if (!list) continue;
        setIfChanged(list, shown.length
            ? shown.map(nominationCard).join('')
            : '<div class="whip-updates-loading">None at this stage.</div>');
        watchListScroll(list);
    }
}

async function loadNominations() {
    try {
        const r = await fetch(`${API}/senate/nominations`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        _nominations = d.nominations || [];
        _nomCounts = d.counts || {};
        renderNominations();
    } catch (e) {
        const feed = el('nominations-feed');
        if (feed) setIfChanged(feed, `<div class="whip-updates-loading">Nominations unavailable (${escapeHtml(e.message)}).</div>`);
    }
}

// ── Bill modal ───────────────────────────────────────────────────────────────
//
// Same markup and classes as the House modal, so it looks and animates the
// same, but not the same function: openBillModal in app.js is 324 lines with
// eleven dependencies, several of them House procedure -- whip recommendation
// tags, Rules Committee slugs, the amendments panel. None of that exists here.
//
// The overlay is built on demand rather than living in the markup, which is how
// the House one works too, so senate.html needs nothing added to it.
let _billModalTrigger = null;
let _nominations = [];

function closeSenateBillModal() {
    const overlay = el('bill-modal-overlay');
    globalThis.BoardAnimations?.hideAfterAnimation?.(overlay);
    document.removeEventListener('keydown', onSenateBillModalKey);
    if (_billModalTrigger) { _billModalTrigger.focus(); _billModalTrigger = null; }
}

function onSenateBillModalKey(e) {
    if (e.key === 'Escape') closeSenateBillModal();
}

function billModalSkeleton(id) {
    return `
        <div class="bill-modal" id="bill-main-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(id)}">
            <button class="bill-modal-close" id="bill-modal-close" aria-label="Close">✕</button>
            <div class="bill-modal-scroll">
                <div class="bill-modal-top">
                    <div class="bill-modal-header">
                        <span class="bill-modal-id">${escapeHtml(id)}</span>
                    </div>
                    <h2 class="bill-modal-title">Loading…</h2>
                </div>
            </div>
        </div>`;
}

function billModalContent(b) {
    // Sponsor as a member card with a photo, the way the House modal shows it.
    // A bare name line was the thing that made this look like a different modal.
    const sp = b.sponsor;
    const pClass = sp?.party === 'R' ? 'republican' : sp?.party === 'D' ? 'democrat' : 'independent';
    const pLetter = sp?.party === 'R' ? 'R' : sp?.party === 'D' ? 'D' : 'I';
    const photo = sp?.bioguide ? photoUrlFor(sp.bioguide) : '';
    const sponsor = sp ? `
        <div class="bill-modal-section">
            <div class="bill-modal-section-label">SPONSOR</div>
            <div class="absentee-member" style="padding:0;border:none;">
                <div class="absentee-photo-wrap" style="width:36px;height:36px;border-radius:8px;flex-shrink:0;">
                    <div class="absentee-photo-placeholder">${PHOTO_PLACEHOLDER}</div>
                    ${photo ? `<img class="absentee-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(sp.name)}" onload="this.style.opacity='1'" onerror="this.remove()">` : ''}
                </div>
                <div class="absentee-meta">
                    <span class="absentee-name">${escapeHtml(sp.name)}</span>
                    <span class="absentee-party-tag ${pClass}">${pLetter}</span>
                    <span class="absentee-state">${escapeHtml(sp.state || '')}</span>
                </div>
            </div>
        </div>` : '';

    // Party-split support bar, sponsor included in the count.
    const su = b.support;
    const pct = (n) => su.total ? (n / su.total * 100).toFixed(1) : 0;
    const coLabel = b.cosponsorCount
        ? `${b.cosponsorCount} COSPONSOR${b.cosponsorCount !== 1 ? 'S' : ''}`
        : 'NO COSPONSORS';
    const support = su ? `
        <div class="bill-modal-section">
            <div class="bill-modal-section-label">SUPPORT — ${coLabel}</div>
            <div class="bill-modal-support-bar">
                ${su.D ? `<div class="bill-modal-support-fill dem" style="width:${pct(su.D)}%" title="${su.D} Democrat${su.D !== 1 ? 's' : ''}"></div>` : ''}
                ${su.R ? `<div class="bill-modal-support-fill rep" style="width:${pct(su.R)}%" title="${su.R} Republican${su.R !== 1 ? 's' : ''}"></div>` : ''}
                ${su.I ? `<div class="bill-modal-support-fill ind" style="width:${pct(su.I)}%" title="${su.I} Independent${su.I !== 1 ? 's' : ''}"></div>` : ''}
            </div>
            <div class="bill-modal-support-labels">
                ${su.D ? `<span class="bill-modal-support-count dem">${su.D}D</span>` : ''}
                ${su.R ? `<span class="bill-modal-support-count rep">${su.R}R</span>` : ''}
                ${su.I ? `<span class="bill-modal-support-count ind">${su.I}I</span>` : ''}
            </div>
        </div>` : '';

    const committees = b.committees?.length ? `
        <div class="bill-modal-section">
            <div class="bill-modal-section-label">COMMITTEE${b.committees.length > 1 ? 'S' : ''}</div>
            <div class="bill-modal-action">${b.committees.map(escapeHtml).join(' · ')}</div>
        </div>` : '';

    return `
        <div class="bill-modal" id="bill-main-panel" role="dialog" aria-modal="true">
            <button class="bill-modal-close" id="bill-modal-close" aria-label="Close">✕</button>
            <div class="bill-modal-scroll">
                <div class="bill-modal-top">
                    <div class="bill-modal-header">
                        <span class="bill-modal-id">${escapeHtml(b.id)}</span>
                        ${b.policyArea ? `<span class="bill-modal-badge">${escapeHtml(b.policyArea)}</span>` : ''}
                    </div>
                    <h2 class="bill-modal-title">${escapeHtml(b.title || '')}</h2>
                </div>
                <div class="bill-modal-sections">${sponsor}${support}${committees}</div>
                ${b.summary ? `
                <div class="bill-modal-body">
                    <div class="bill-modal-section-label">SUMMARY (AUTHORED BY CRS)</div>
                    <p class="bill-modal-summary">${escapeHtml(b.summary)}</p>
                </div>` : ''}
                <div class="bill-modal-foot">
                    ${b.latestAction ? `
                    <div class="bill-modal-section" style="margin-bottom:12px;">
                        <div class="bill-modal-section-label">LATEST ACTION</div>
                        <div class="bill-modal-action bill-modal-action-row">
                            <span class="bill-modal-action-text">${escapeHtml(b.latestAction)}</span>
                            ${b.latestActionDate ? `<span class="bill-modal-date">${escapeHtml(boardDate(b.latestActionDate))}</span>` : ''}
                        </div>
                    </div>` : ''}
                    <div class="bill-modal-section">
                        <div class="bill-modal-section-label">LINKS</div>
                        <div class="bill-doc-links">
                            <a href="${escapeHtml(b.textUrl)}" class="bill-modal-link senate" target="_blank" rel="noopener">Bill text</a>
                            <a href="${escapeHtml(b.govinfoPdf)}" class="bill-modal-link senate" target="_blank" rel="noopener">PDF (govinfo)</a>
                            <a href="${escapeHtml(b.congressUrl)}" class="bill-modal-link senate" target="_blank" rel="noopener">Congress.gov</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}

// Bill details, warmed rather than fetched on click.
//
// The House modal is synchronous: openBillModal reads billDataMap, which one
// bulk /api/bills call fills for the week's floor business, so a click paints
// immediately. This board has no bulk endpoint -- the Senate publishes no
// weekly bill list to build one from -- so it reaches the same place by asking
// for each measure once, in the background, and keeping the answers.
//
// Worth more here than on the House board, not less: PROCEDURAL STAGES reaches
// back months rather than one week, so the same bill is on screen for far
// longer and a click on it is far more likely to be a repeat.
const _billCache = new Map();     // id -> { at, bill } | { at, error }
const _billInflight = new Map();  // id -> Promise, so a prefetch and a click share one request
// Long, because none of what the modal draws changes: sponsor, the cosponsor
// split, committees and the CRS summary are fixed at introduction. The Worker
// holds the same record for a day for the same reason.
const BILL_CACHE_MS = 6 * 60 * 60 * 1000;

function cachedBill(id) {
    const hit = _billCache.get(id);
    return hit && Date.now() - hit.at <= BILL_CACHE_MS ? hit : null;
}

function fetchSenateBill(id) {
    const hit = cachedBill(id);
    if (hit) return Promise.resolve(hit);
    if (_billInflight.has(id)) return _billInflight.get(id);
    const p = (async () => {
        try {
            const r = await fetch(`${API}/senate/bill?id=${encodeURIComponent(id)}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const bill = await r.json();
            if (bill.error) throw new Error(bill.error);
            const entry = { at: Date.now(), bill };
            _billCache.set(id, entry);
            return entry;
        } catch (e) {
            // Cached too. A measure with no Congress.gov record fails the same
            // way every time, and retrying it on every click spends the quota
            // to arrive at the same message.
            const entry = { at: Date.now(), error: e.message };
            _billCache.set(id, entry);
            return entry;
        } finally {
            _billInflight.delete(id);
        }
    })();
    _billInflight.set(id, p);
    return p;
}

// Every bill-shaped measure currently drawn, warmed two at a time so the board
// does not open twenty sockets at once on a panel nobody has clicked yet.
let _prefetched = new Set();
function prefetchBills() {
    const ids = new Set();
    for (const card of document.querySelectorAll('#senate-stages [data-bill-id], #senate-floor-measures [data-bill-id]')) {
        const id = card.dataset.billId;
        if (id && !_prefetched.has(id) && !cachedBill(id)) ids.add(id);
    }
    if (!ids.size) return;
    const queue = [...ids];
    queue.forEach((id) => _prefetched.add(id));
    const worker = async () => {
        while (queue.length) await fetchSenateBill(queue.shift());
    };
    const start = () => { worker(); worker(); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 4000 });
    else setTimeout(start, 1200);
}

async function openSenateBillModal(billId, trigger) {
    if (!billId) return;
    _billModalTrigger = trigger || null;

    let overlay = el('bill-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'bill-modal-overlay';
        overlay.className = 'bill-modal-overlay';
        document.body.appendChild(overlay);
        // Only a click on the backdrop itself closes; clicks inside must not.
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSenateBillModal(); });
    }
    overlay.hidden = false;
    delete overlay.dataset.closing;

    // Warmed: paint the real thing, with no skeleton in between. This is the
    // path almost every click takes.
    const hit = cachedBill(billId);
    const paint = (entry) => {
        if (overlay.hidden || overlay.dataset.closing) return;
        overlay.innerHTML = entry.error
            ? billModalSkeleton(billId).replace('Loading…', `Details unavailable (${escapeHtml(entry.error)})`)
            : billModalContent(entry.bill);
        overlay.querySelector('#bill-modal-close')?.addEventListener('click', closeSenateBillModal);
    };
    if (hit) paint(hit);
    else {
        overlay.innerHTML = billModalSkeleton(billId);
        overlay.querySelector('#bill-modal-close')?.addEventListener('click', closeSenateBillModal);
    }
    document.addEventListener('keydown', onSenateBillModalKey);
    if (!hit) paint(await fetchSenateBill(billId));
}

// ── Nomination modal ─────────────────────────────────────────────────────────
//
// A nomination is not a bill, so the bill endpoint cannot describe one: there
// is no sponsor, no cosponsor split and no CRS summary. Everything a card has
// to leave out is already in memory, because the NOMINATIONS panel loads all
// 2,023 records from the Senate's XML and each one carries the nominee and the
// post, the agency, the committee that reported it and the dates it moved.
// So this modal makes no request of its own.
//
// There is no Congress.gov link on it. Those pages exist, but congress.gov
// answers anything that is not a browser with a block page, so the URL shape
// could not be confirmed, and an unconfirmed link does not ship.

// A cloture card names its subject one of three ways, and each needs a
// different lookup: a measure id goes to Congress.gov, a PN number joins the
// nominations XML directly, and an "Exec. Cal. 830" from the caucus prose only
// has the calendar number to match on.
const MEASURE_ID_RE = /^(?:H\.R\.|H\.Con\.Res\.|H\.J\.Res\.|H\.Res\.|S\.Con\.Res\.|S\.J\.Res\.|S\.Res\.|S\.)\s*\d+$/i;

function findNomination({ pn, calendarNo }) {
    if (pn) return _nominations.find((n) => n.pn === pn) || null;
    if (calendarNo != null) return _nominations.find((n) => n.calendarNo === Number(calendarNo)) || null;
    return null;
}

// What to call it, in descending order of how well the source knows.
//
// The XML's own description is the full formal wording. Failing that, a roll
// call cloture carries the nominee and the post in its title. Failing that,
// a motion filed but not yet voted exists only as the caucus's own sentence,
// which names the nominee but arrives with the list marker still on it.
//
// The XML falls away exactly when a nomination is confirmed: it leaves the
// calendar file and takes its Executive Calendar number with it, so an
// "Exec. Cal. 830" card from the prose can find nothing to join once the vote
// has happened. That is the case this ladder exists for.
function nominationSubject(n, vote, id) {
    const raw = n?.description
        || (vote?.title || '').replace(/^(?:Motion to Invoke Cloture|Confirmation)\s*:?\s*/i, '')
        || vote?.text
        || '';
    return stripMarks(raw) || id;
}

function nominationModalContent(n, id, vote) {
    const st = NOM_STAGES[n?.stage] || null;

    const field = (label, value) => value ? `
        <div class="bill-modal-section">
            <div class="bill-modal-section-label">${label}</div>
            <div class="bill-modal-action">${escapeHtml(value)}</div>
        </div>` : '';

    // The vote that opened this modal, when that is where the click came from.
    // It is the reason the nomination is interesting today, so it outranks the
    // standing detail and sits first. Labelled by its own stage rather than
    // always saying CLOTURE, because a card in PASSAGE AND CONFIRMATION is a
    // confirmation and calling that cloture would be wrong.
    const clo = vote ? `
        <div class="bill-modal-section">
            <div class="bill-modal-section-label">${escapeHtml(STAGE_CHIP[vote.stage] || 'Cloture')}</div>
            <div class="bill-modal-action bill-modal-action-row">
                <span class="bill-modal-action-text">${escapeHtml(vote.result || 'Filed, not yet voted')}${
                    vote.yeas != null ? ` · ${vote.yeas}-${vote.nays}` : ''}${
                    vote.rollCall ? ` · Roll call ${vote.rollCall}` : ''}</span>
                ${vote.date ? `<span class="bill-modal-date">${escapeHtml(boardDate(vote.date))}</span>` : ''}
            </div>
        </div>` : '';

    // Received, reported, and where it sits now. A nomination with no reporting
    // date is still in committee, and saying so beats an empty row.
    // noticeDate2, not boardDate: these are the nomination's own ISO dates and
    // the card that opens this modal already draws them that way. The vote row
    // above uses boardDate for the same reason, because the card it came from
    // does.
    const dates = [
        n?.received ? ['Received', noticeDate2(n.received)] : null,
        n?.reported ? ['Reported', noticeDate2(n.reported)] : null,
    ].filter(Boolean);
    const timeline = dates.length ? `
        <div class="bill-modal-section">
            <div class="bill-modal-section-label">TIMELINE</div>
            ${dates.map(([k, v]) => `
            <div class="bill-modal-action bill-modal-action-row">
                <span class="bill-modal-action-text">${k}</span>
                <span class="bill-modal-date">${escapeHtml(v)}</span>
            </div>`).join('')}
        </div>` : '';

    const links = [
        vote?.url ? `<a href="${escapeHtml(vote.url)}" class="bill-modal-link senate" target="_blank" rel="noopener">Roll call vote</a>` : '',
        `<a href="https://www.senate.gov/general/common/generic/XML_Availability.htm" class="bill-modal-link senate" target="_blank" rel="noopener">Nominations XML</a>`,
    ].filter(Boolean).join('');

    return `
        <div class="bill-modal" id="bill-main-panel" role="dialog" aria-modal="true">
            <button class="bill-modal-close" id="bill-modal-close" aria-label="Close">✕</button>
            <div class="bill-modal-scroll">
                <div class="bill-modal-top">
                    <div class="bill-modal-header">
                        <span class="bill-modal-id">${escapeHtml(n?.pn || id)}</span>
                        ${st ? `<span class="bill-modal-badge">${escapeHtml(st.label)}</span>` : ''}
                        ${n?.calendarNo ? `<span class="bill-modal-badge">Exec. Cal. No. ${escapeHtml(String(n.calendarNo))}</span>` : ''}
                    </div>
                    <h2 class="bill-modal-title">${escapeHtml(nominationSubject(n, vote, id))}</h2>
                </div>
                <div class="bill-modal-sections">
                    ${clo}
                    ${field('POSITION', n?.organization)}
                    ${field('COMMITTEE', n?.committee)}
                    ${timeline}
                </div>
                <div class="bill-modal-foot">
                    <div class="bill-modal-section">
                        <div class="bill-modal-section-label">LINKS</div>
                        <div class="bill-doc-links">${links}</div>
                    </div>
                </div>
            </div>
        </div>`;
}

async function openSenateNominationModal({ pn, calendarNo, vote }, trigger) {
    const id = pn || (calendarNo != null ? `Exec. Cal. ${calendarNo}` : 'Nomination');
    _billModalTrigger = trigger || null;

    let overlay = el('bill-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'bill-modal-overlay';
        overlay.className = 'bill-modal-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSenateBillModal(); });
    }
    overlay.hidden = false;
    delete overlay.dataset.closing;
    overlay.innerHTML = billModalSkeleton(id);
    overlay.querySelector('#bill-modal-close')?.addEventListener('click', closeSenateBillModal);
    document.addEventListener('keydown', onSenateBillModalKey);

    // The panel usually has them already; a stage card can be clicked before
    // the nominations request has landed.
    if (!_nominations.length) { try { await loadNominations(); } catch { /* falls back to the vote's own title */ } }
    if (overlay.hidden || overlay.dataset.closing) return;

    overlay.innerHTML = nominationModalContent(findNomination({ pn, calendarNo }), id, vote);
    overlay.querySelector('#bill-modal-close')?.addEventListener('click', closeSenateBillModal);
}

// Delegated so it survives every re-render of the cards, and not scoped to one
// panel: the same card markup is rendered by ON THE FLOOR, all eight stage
// sections and all six nomination sections, and each one routes by what the
// card carries rather than by where it sits.
function initBillModal() {
    document.addEventListener('click', (e) => {
        const card = e.target.closest('[data-bill-id], [data-pn], [data-cal-no]');
        if (!card || !card.closest('.bills-section')) return;
        e.preventDefault();
        // By index rather than a serialised copy on every card: the buckets are
        // already in memory and a hundred cards carrying their own JSON is a lot
        // of markup to re-render for something only one click will ever read.
        const bucket = _stages[card.dataset.stageKey];
        const vote = bucket ? bucket[+card.dataset.stageIdx]?.latest : null;
        if (card.dataset.billId) { openSenateBillModal(card.dataset.billId, card); return; }
        // A card can carry an empty pn when the Executive Calendar number did
        // not join the XML. With no calendar number either there is nothing to
        // look up, so the click does nothing rather than opening a blank modal.
        if (!card.dataset.pn && !card.dataset.calNo) return;
        openSenateNominationModal({ pn: card.dataset.pn, calendarNo: card.dataset.calNo, vote }, card);
    });
}

// ── Procedural stages ────────────────────────────────────────────────────────
//
// One card per measure, filed under the stage of its most recent vote, with
// every earlier vote stacked above it. The Worker does the grouping; this draws
// it. See the panel's comment in senate.html for the layout and why AMENDMENTS
// is usually empty.

// Six, matching the panel. Discharge and the off-chain motions are still chip
// labels below, because a measure can carry one; they are just not columns.
const STAGE_KEYS = ['final', 'amendment', 'mtp', 'cloture', 'cloture-amdt', 'cloture-mtp'];

// Short forms for the chips and the modal. The column heading above them
// already carries the long name, so repeating it on every chip would be noise.
const STAGE_CHIP = {
    'final':        'Final vote',
    'amendment':    'Amendment',
    'mtp':          'Motion to proceed',
    'discharge':    'Discharge',
    'cloture':      'Cloture',
    'cloture-amdt': 'Cloture on an amendment',
    'cloture-mtp':  'Cloture on the motion to proceed',
    'other':        'Procedural motion',
};

// The House board's chips, reused rather than redrawn: a tick for carried, a
// cross for not.
const CHIP_TICK = '<svg width="11" height="11" viewBox="0 0 9 9" style="display:block"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M1.3,4.8 L3.6,7.1 L7.7,1.6"/></svg>';
const CHIP_CROSS = '<svg width="11" height="11" viewBox="0 0 9 9" style="display:block"><path fill="currentColor" d="M1.5,0 L4.5,3 L7.5,0 L9,1.5 L6,4.5 L9,7.5 L7.5,9 L4.5,6 L1.5,9 L0,7.5 L3,4.5 L0,1.5 Z"/></svg>';

let _stages = {};
let _stagesData = null;
// The caucus schedule, kept so a pending stage card can say when its vote is.
let _agenda = null;

// The two feeds spell a measure differently: the roll call record says
// "S. 4668", the caucus schedule says "S.4668".
const measureKey = (m) => String(m || '').replace(/\s+/g, '').toUpperCase();

// When the schedule names a pending measure, the board says when the vote is
// rather than only that one is coming.
//
// Read from the schedule, never computed. Rule XXII would let a filed cloture
// motion's ripening be worked out -- it lies over to the second calendar day of
// session -- but that needs the forward list of sitting days, and this board
// infers those at 86.9%, so the date would be wrong about one day in seven. The
// Senate also overrides the rule by unanimous consent most of the time, which
// is exactly what these posts report.
//
// Predicting the post-cloture interval would be no better and no use: of the 51
// clotures invoked this session, 19 reached the final vote the same day and 22
// the next, and every slow one straddles a recess.
function scheduledVote(measure) {
    if (!_agenda?.voteTime) return null;
    const key = measureKey(measure);
    const named = (_agenda.measures || []).some((m) => measureKey(m.measure) === key)
        || (_agenda.votes || []).some((v) => measureKey(v).includes(key));
    if (!named) return null;
    // "Monday, September 28, 2026" -> the board's own date format. The time is
    // reproduced as the caucus wrote it, the way every quoted source is.
    const day = String(_agenda.conveneDate || '').replace(/^[A-Za-z]+,\s*/, '');
    return { time: _agenda.voteTime, date: boardDate(day) };
}

// Which modal a card opens, decided by the shape of what it names. The roll
// call record gives a measure id or a PN; the caucus prose, which is the only
// place a cloture motion filed and not yet voted appears, gives "Exec. Cal. 830".
function measureTarget(measure, extra = '') {
    const m = (measure || '').trim();
    if (MEASURE_ID_RE.test(m)) return `data-bill-id="${escapeHtml(m)}"${extra}`;
    if (/^PN/i.test(m)) return `data-pn="${escapeHtml(m)}"${extra}`;
    const cal = m.match(/(\d+)\s*$/);
    if (cal) return `data-cal-no="${cal[1]}"${extra}`;
    return extra;
}

// Consecutive votes at one stage collapse once there are more than three of
// them. S. 2 took 27 amendment votes in two days and S.Con.Res. 33 took 17;
// drawn one chip each they would bury the card they belong to. Three or fewer
// stay separate, because "failed cloture twice" is the kind of thing the board
// exists to show.
function chainRuns(chain) {
    const runs = [];
    for (const v of chain || []) {
        const last = runs[runs.length - 1];
        if (last && last.stage === v.stage) last.votes.push(v);
        else runs.push({ stage: v.stage, votes: [v] });
    }
    return runs.flatMap((r) => r.votes.length <= 3 ? r.votes.map((v) => ({ single: v })) : [{ run: r }]);
}

function stageChip(item) {
    if (item.single) {
        const v = item.single;
        const cls = v.carried ? 'passed' : 'failed';
        const label = `${STAGE_CHIP[v.stage] || v.stage} · ${v.result} ${v.yeas}-${v.nays}`;
        return `
        <div class="amdt-vote-card amdt-vote-${cls}" title="${escapeHtml(`Roll call ${v.rollCall}, ${boardDate(v.date)}`)}">
            <span class="amdt-vote-circle" aria-hidden="true">${v.carried ? CHIP_TICK : CHIP_CROSS}</span>
            <span class="amdt-vote-label">${escapeHtml(label)}</span>
        </div>
        <div class="amdt-vote-connector" aria-hidden="true"></div>`;
    }
    const { stage, votes } = item.run;
    const won = votes.filter((v) => v.carried).length;
    // Amber is the House board's third chip state. A run that went both ways is
    // neither a pass nor a fail, and this is the slot that says so.
    const cls = won === votes.length ? 'passed' : won === 0 ? 'failed' : 'requested';
    const tail = won === votes.length ? 'all agreed to' : won === 0 ? 'all rejected' : `${won} agreed to, ${votes.length - won} rejected`;
    const label = `${votes.length} × ${STAGE_CHIP[stage] || stage} · ${tail}`;
    return `
    <div class="amdt-vote-card amdt-vote-${cls}" title="${escapeHtml(`Roll calls ${votes[0].rollCall}–${votes[votes.length - 1].rollCall}`)}">
        <span class="amdt-vote-circle" aria-hidden="true">${won === votes.length ? CHIP_TICK : won === 0 ? CHIP_CROSS : ''}</span>
        <span class="amdt-vote-label">${escapeHtml(label)}</span>
    </div>
    <div class="amdt-vote-connector" aria-hidden="true"></div>`;
}

// What a card is waiting for, once cloture has put it there. Phrased as the
// thing that has not happened yet, because that is the whole difference between
// this card and the one next to it that has a tally on it.
// The glyphs the House board puts in .bill-status. Same two characters, so a
// card means the same thing on either board.
const STATUS_MARK = { passed: '\u2713', failed: '\u2715' };

const STAGE_AWAITING = {
    final:     'Awaiting a final vote',
    amendment: 'Awaiting a vote on the amendment',
    mtp:       'Awaiting the motion to proceed',
};

function stageCard(m, key, i) {
    const v = m.latest;
    const chips = chainRuns(m.chain).map(stageChip).join('');

    // A pending card has no result of its own. Its last vote is already the top
    // chip, so repeating that vote's tally here would say the measure had just
    // done the thing it is in fact waiting to do.
    // The tick goes in .bill-status, which is what that circle has always been
    // for: the House board centres a glyph in it and this one was drawing it
    // empty. A pending card leaves it blank, and .bill-status.pending is
    // already the muted open circle that says nothing has happened yet.
    const idRow = m.pending
        ? `<span class="bill-calendar-no">Pending</span>`
        : `<span class="bill-calendar-no">${escapeHtml(v.result)}</span>
           <span class="wrapup-result ${v.carried ? 'carried' : 'failed'}">${v.yeas}-${v.nays}</span>`;
    const due = m.pending ? scheduledVote(m.measure) : null;
    const awaiting = STAGE_AWAITING[m.stage] || 'Awaiting a vote';
    const action = m.pending
        ? `${awaiting} · ${due ? due.time : 'cloture invoked'}`
        : `${STAGE_CHIP[v.stage] || v.stage} · Roll call ${v.rollCall}`;
    // A scheduled card is dated by when its vote is, not by when the cloture
    // that got it there was.
    const when = due ? due.date : boardDate(v.date);

    return `
    <div class="bill-slot">
        ${chips}
        <div class="bill-card-wrap">
            <button class="bill-card" ${measureTarget(m.measure, ` data-stage-key="${key}" data-stage-idx="${i}"`)} data-status="${m.status}" type="button">
                <div class="bill-status ${m.status}" aria-hidden="true">${STATUS_MARK[m.status] || ''}</div>
                <div class="bill-info">
                    <div class="bill-id-row">
                        <span class="bill-id">${escapeHtml(m.measure)}</span>
                        ${idRow}
                    </div>
                    <div class="bill-title">${escapeHtml(m.subject)}</div>
                    <div class="bill-meta">
                        <div class="bill-action">${escapeHtml(action)}</div>
                        <div class="bill-date">${escapeHtml(when)}</div>
                    </div>
                </div>
            </button>
        </div>
    </div>`;
}

function renderStages(data) {
    _stagesData = data || _stagesData;
    data = _stagesData;
    _stages = data?.stages || {};
    for (const key of STAGE_KEYS) {
        const list = el(`stage-list-${key}`);
        const count = el(`stage-count-${key}`);
        const rows = _stages[key] || [];
        if (count) count.textContent = rows.length ? String(rows.length) : '';
        if (!list) continue;
        setIfChanged(list, rows.length
            ? rows.map((m, i) => stageCard(m, key, i)).join('')
            : '<div class="whip-updates-loading">Nothing at this stage.</div>');
        watchListScroll(list);
    }
    // Say what the window reached, rather than showing a slice and letting it
    // look like the whole record.
    prefetchBills();
    const when = el('senate-stages-when');
    if (when && data?.kept != null) {
        when.textContent = data.since
            ? `${data.kept} measures since ${boardDate(data.since)}`
            : `${data.kept} measures`;
    }
}

async function loadStages() {
    // This carries the live indicator now. It used to hang off loadVotes, which
    // fed the ROLL CALL VOTES panel; that panel is gone and this reads the same
    // upstream, the Senate's own roll call menu, so it is the same signal.
    setConnection('connecting');
    try {
        const r = await fetch(`${API}/senate/stages`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        renderStages(await r.json());
        setConnection('live');
    } catch (e) {
        for (const key of STAGE_KEYS) {
            const list = el(`stage-list-${key}`);
            if (list) setIfChanged(list, `<div class="whip-updates-loading">Stages unavailable (${escapeHtml(e.message)}).</div>`);
        }
        console.error('Stages fetch failed:', e);
    }
}

// ── On the floor ─────────────────────────────────────────────────────────────
//
// The Democratic Caucus's nightly schedule for the next sitting day. General
// Orders answers "what could come up eventually", which is 528 rows and not a
// question anyone asks; this answers "what is up next", which is usually one
// measure.
//
function renderFloorSchedule(data, cloture) {
    const list = el('senate-floor-measures');
    const when = el('senate-floor-when');
    if (!list) return;

    if (when) when.textContent = data?.heading || '';

    // A cloture motion filed and not yet voted is the one forward signal the
    // roll call record cannot carry, because there is no roll call yet. It
    // exists only in the caucus's own prose, so it belongs here with the rest
    // of what is coming rather than in PROCEDURAL STAGES, which is built
    // entirely from votes that have happened.
    // A filed motion is only news while it is still filed.
    //
    // The Worker drops one once the roll call record shows a vote on the same
    // measure, which works for a bill because both sources call it "S. 4668".
    // It does not work for a nomination: the caucus prose says "Exec. Cal. 830"
    // and the roll call record says "PN999-4", so nothing matched and two dead
    // motions sat on the panel for eleven days after both nominees were
    // confirmed. Worse, they could never be matched later, because a confirmed
    // nomination leaves the calendar file and takes its calendar number with it
    // -- 0 of 1,629 confirmed records carry one.
    //
    // Which is exactly the test. If the number is still on the Executive
    // Calendar the motion is still live; if it is gone, so is the motion.
    const onCalendar = new Set(_nominations.filter((n) => n.stage === 'calendar').map((n) => n.calendarNo));
    const pending = (cloture || []).filter((c) => {
        if (c.invoked !== null) return false;
        const cal = (c.measure || '').match(/^Exec\. Cal\.\s*(\d+)/i);
        // Only judged when the calendar is loaded; an empty roster would
        // otherwise drop every one of them.
        return !cal || !onCalendar.size || onCalendar.has(Number(cal[1]));
    });

    const measures = data?.measures || [];
    if (!measures.length && !pending.length) {
        setIfChanged(list, '');
        return;
    }

    const cards = measures.map((m) => {
        // A scheduled vote naming this measure is the whole point of the panel,
        // so it goes on the card rather than being left in the prose.
        const vote = stripMarks((data.votes || []).find((v) => v.includes(m.measure)) || '');
        const status = vote ? 'pending' : 'scheduled';
        // A button, not a link: it opens the modal. The congress.gov link lives
        // inside the modal with the rest of them.
        const tag = 'button';
        const attrs = 'type="button"';
        return `
        <div class="bill-card-wrap">
            <${tag} class="bill-card" data-bill-id="${escapeHtml(m.measure)}" data-status="${status}" ${attrs}>
                <div class="bill-status ${status}" aria-hidden="true"></div>
                <div class="bill-info">
                    <div class="bill-id-row">
                        <span class="bill-id">${escapeHtml(m.measure)}</span>
                        <span class="bill-calendar-no">Cal. No. ${escapeHtml(String(m.calendarNo))}</span>
                        ${data.postCloture ? '<span class="bill-calendar-no">Post-cloture</span>' : ''}
                    </div>
                    <div class="bill-title">${escapeHtml(m.title || '')}</div>
                    <div class="bill-meta">
                        <div class="bill-action">${escapeHtml([m.author, vote ? `Scheduled: ${vote}` : 'Pending consideration'].filter(Boolean).join(' \u00b7 '))}</div>
                        <div class="bill-date">${escapeHtml(data.voteTime || '')}</div>
                    </div>
                </div>
            </${tag}>
        </div>`;
    });
    // Nominations named by the schedule, matched to the Executive Calendar XML.
    // The Senate spends much of its floor time on these and none of them are
    // bills, so the measures feed alone would show an empty panel on a
    // nominations day.
    const noms = (data.execCals || [])
        .map((n) => _nominations.find((x) => x.calendarNo === n) || { calendarNo: n })
        .map((n) => `
        <div class="bill-card-wrap">
            <button class="bill-card" data-pn="${escapeHtml(n.pn || '')}" data-cal-no="${escapeHtml(String(n.calendarNo))}" data-status="scheduled" type="button">
                <div class="bill-status scheduled" aria-hidden="true"></div>
                <div class="bill-info">
                    <div class="bill-id-row">
                        <span class="bill-id">${escapeHtml(n.pn || 'NOMINATION')}</span>
                        <span class="bill-calendar-no">Exec. Cal. No. ${escapeHtml(String(n.calendarNo))}</span>
                    </div>
                    <div class="bill-title">${escapeHtml(n.description || 'Nomination pending on the Executive Calendar')}</div>
                    <div class="bill-meta">
                        <div class="bill-action">${escapeHtml([n.organization, n.committee].filter(Boolean).join(' \u00b7 '))}</div>
                        <div class="bill-date">${escapeHtml(n.reported ? boardDate(n.reported) : '')}</div>
                    </div>
                </div>
            </button>
        </div>`);
    const filed = pending.map((c) => {
        const subject = stripMarks(c.text || c.title).replace(/^Motion to Invoke Cloture:\s*/i, '').trim();
        return `
        <div class="bill-card-wrap">
            <button class="bill-card" ${measureTarget(c.measure)} data-status="scheduled" type="button">
                <div class="bill-status scheduled" aria-hidden="true"></div>
                <div class="bill-info">
                    <div class="bill-id-row">
                        <span class="bill-id">${escapeHtml(c.measure || 'Cloture')}</span>
                        <span class="bill-calendar-no">Cloture filed</span>
                    </div>
                    <div class="bill-title">${escapeHtml(subject)}</div>
                    <div class="bill-meta">
                        <div class="bill-action">Not yet voted</div>
                        <div class="bill-date">${escapeHtml(boardDate(c.date))}</div>
                    </div>
                </div>
            </button>
        </div>`;
    });
    setIfChanged(list, cards.concat(noms, filed).join(''));
    watchListScroll(list);
    prefetchBills();
}


async function loadFloorSchedule() {
    try {
        const r = await fetch(`${API}/senate/floor-schedule`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        // Nominations first: the agenda names them by calendar number and needs
        // the XML to say who they are.
        if (!_nominations.length) await loadNominations();
        _agenda = data.agenda || null;
        renderFloorSchedule(data.agenda, data.cloture);
        // The two feeds land in whichever order the network gives them, and a
        // pending card cannot say when its vote is until the schedule is in.
        if (_stagesData) renderStages(null);
        _notices = data.notices || [];
        renderNoticeFilter();
        renderNotices();
    } catch (e) {
        const summary = el('senate-floor-summary');
        if (summary) summary.textContent = `Floor schedule unavailable (${e.message}).`;
        console.error('Floor schedule fetch failed:', e);
    }
}

// The backlog count only. See above for why the rows are not listed.


// ── Boot ─────────────────────────────────────────────────────────────────────
const todayEl = el('today-date');
if (todayEl) todayEl.textContent = fmtDateLong(new Date());

loadSchedule();
// Convene and adjourn times move over minutes, not seconds.
setInterval(loadSchedule, 5 * 60 * 1000);

initAnalogClocks();
initAirportDelays();
updateTimestamp();
setInterval(updateTimestamp, 1000);
fetchWeather();
setInterval(fetchWeather, 10 * 60 * 1000);
initCapcam();
initAbsenceFilters();
loadAbsences();
initNoticeFilter();
initBillModal();
loadNominations();
loadFloorSchedule();
// The caucus posts the next day's schedule each evening.
setInterval(loadFloorSchedule, 30 * 60 * 1000);
loadStages();
// The vote menu gains a row only when the Senate votes, a handful of times on a
// sitting day, and the Worker holds it for 30 minutes anyway. Ten rather than
// thirty because this is also what tells the header whether the board can still
// reach its API, and half an hour is a long time to sit on a stale light.
setInterval(loadStages, 10 * 60 * 1000);
setInterval(loadAbsences, 10 * 60 * 1000);
loadBalance();
// The roster changes on a timescale of months. Hourly is already generous.
setInterval(loadBalance, 60 * 60 * 1000);
