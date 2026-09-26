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

// The module takes these as dependencies rather than reaching for a board's
// globals, so each board supplies its own.
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

// ── Roll call votes ──────────────────────────────────────────────────────────
function renderVotes(payload) {
    const feed = el('senate-votes-feed');
    const stamp = el('senate-votes-updated');
    if (!feed) return;
    feed.innerHTML = '';

    const votes = payload?.votes || [];
    if (!votes.length) {
        const row = document.createElement('div');
        row.className = 'proceedings-item';
        row.textContent = 'No roll call votes recorded for this session yet.';
        feed.appendChild(row);
        return;
    }

    for (const v of votes.slice(0, 25)) {
        const row = document.createElement('div');
        row.className = 'proceedings-item';

        const num = document.createElement('span');
        num.className = 'proceedings-time';
        // Trailing space: the spans are adjacent, so without it the roll number
        // runs into the measure -- "244H.Con.Res. 89".
        num.textContent = `${v.date} · ${v.number} `;

        // textContent throughout: every field is remote text from senate.gov.
        const body = document.createElement('span');
        body.className = 'proceedings-text';
        const bits = [];
        if (v.issue) bits.push(`${v.issue}:`);
        if (v.question) bits.push(v.question);
        if (v.yeas != null && v.nays != null) bits.push(`${v.yeas}-${v.nays}`);
        if (v.result) bits.push(`(${v.result})`);
        body.textContent = bits.join(' ');

        row.append(num, body);
        feed.appendChild(row);
    }
    if (stamp && payload?.congress) {
        stamp.textContent = `${payload.congress}th Congress, session ${payload.session}`;
    }
}

async function loadVotes() {
    setConnection('connecting');
    try {
        const r = await fetch(`${API}/senate/votes`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        renderVotes(await r.json());
        setConnection('live');
    } catch (e) {
        setConnection('connecting');
        const feed = el('senate-votes-feed');
        if (!feed) return;
        feed.innerHTML = '';
        const row = document.createElement('div');
        row.className = 'proceedings-item';
        // Name the source that failed. This board has more than one upstream and
        // they fail differently; a bare "unavailable" sends the reader looking in
        // the wrong place.
        row.textContent = `Roll call list unavailable (${e.message}).`;
        feed.appendChild(row);
    }
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
// a House voting-days ICS. Every day the Senate actually convened is a sitting
// day; the tentative annual schedule's non-legislative periods are drawn as
// cancelled, which is the module's grey, because "planned recess" is what they
// are and a colour claiming otherwise would overstate a tentative document.
function scheduleToCalendarItems(data) {
    const items = [];
    const ymd = (iso) => (iso || '').slice(0, 10);

    for (const d of data?.recent || []) {
        const date = ymd(d.convene);
        if (!date) continue;
        items.push({ date, type: 'vote-day', summary: 'Senate in session' });
    }

    // Recess windows are inclusive ranges, so walk them day by day. Guarded at
    // 400 days so a malformed or open-ended range cannot spin.
    for (const r of data?.recesses || []) {
        if (!r.begin || !r.end) continue;
        const start = new Date(`${r.begin}T12:00:00Z`);
        const end = new Date(`${r.end}T12:00:00Z`);
        if (isNaN(start) || isNaN(end) || end < start) continue;
        for (let t = start, n = 0; t <= end && n < 400; t = new Date(t.getTime() + 86400000), n++) {
            const date = t.toISOString().slice(0, 10);
            if (items.some((i) => i.date === date)) continue;
            items.push({ date, type: 'cancelled', summary: r.note || 'Non-legislative period' });
        }
    }
    return items;
}

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
loadVotes();
loadBalance();
// The roster changes on a timescale of months. Hourly is already generous.
setInterval(loadBalance, 60 * 60 * 1000);
// The record moves in minutes to hours, never seconds. Slow poll on purpose.
setInterval(loadVotes, 5 * 60 * 1000);
