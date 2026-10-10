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

// Helpers both boards share (lib/util.js). Declared first so nothing can reach them early.
const { escapeHtml, setIfChanged, MONTH_NAMES, DAY_NAMES, fmtDate, fmtDateLong } = globalThis.BoardUtil;

// The Worker accepts either prefix and strips it, so both boards reach the same
// handlers under the same cache keys. This board asked through /house-floor/ for
// a while because api.evanhollander.org had no route for /senate-floor/* and it
// answered 522; that route exists now and returns 200 with this origin echoed
// back, so it asks under its own name.
const API = 'https://api.evanhollander.org/senate-floor/api';

// Only used if the payload omits it: a Congress starts in each odd year, and
// the 119th began in 2025.
const CONGRESS_FALLBACK = 119 + Math.floor((new Date().getFullYear() - 2025) / 2);

// Day-first, matching the House board: fmtDate and fmtDateLong are lib/util.js, shared.

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

const el = (id) => document.getElementById(id);
// (?) explanations: the engine is lib/info-popup.js, the same one the House board uses; what is true of both
// chambers is lib/info-content.js. Senate-procedure entries are added here when they are written.
InfoPopup.register(SharedInfoContent);
InfoPopup.reveal();

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

// The header clocks (readouts and faces): lib/clocks.js, shared with the House board.
function updateTimestamp() {
    BoardClocks.tick({
        local: el('local-time'), dc: el('dc-time'), utc: el('utc-time'),
        localAnalog: el('local-analog'), dcAnalog: el('dc-analog'), utcAnalog: el('utc-analog'),
    });
}

// ── Weather and the Capitol camera ───────────────────────────────────────────
// Both are the Capitol, not a chamber, so they are the House board's, unchanged:
// lib/weather.js and lib/capcam.js, shared.

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
// The Senate's roster as the Balance of Power link's popover shows it (lib/source-pop.js): the Worker passes a few of the
// roster's own <member> entries verbatim, and this prints them as the Senate wrote them (less address and phone). It says
// how many entries there are and how the counts are made.
function setBalanceManifest(data) {
    if (!globalThis.SourcePop || !Array.isArray(data.sample) || !data.sample.length) return;
    const panel = document.getElementById('party-breakdown');
    if (!panel) return;
    const X = SourcePop.xml;
    const lines = ['<contact_information>'];
    const c = data.counts || {};
    lines.push(X.note(1, (data.entries || '') + ' <member> entries. The panel counts D ' + c.D + ', R ' + c.R + ', I ' + c.I +
        ' by <party>. Shown: the first, then each senator who is neither D nor R.'));
    for (const raw of data.sample) {
        const doc = new DOMParser().parseFromString(raw, 'text/xml');
        const m = doc.querySelector('member');
        if (!m) continue;
        lines.push('  <member>');
        for (const tag of ['member_full', 'last_name', 'first_name', 'party', 'state', 'class', 'bioguide_id']) {
            const e = m.querySelector(tag);
            if (e) X.emit(e, 2, lines);
        }
        lines.push(X.note(2, 'address, phone, email, website omitted'));
        lines.push('  </member>');
    }
    lines.push('</contact_information>');
    SourcePop.set(panel, {
        title: 'The Senate\'s roster',
        request: 'GET https://www.senate.gov/general/contact_information/senators_cfm.xml',
        xml: lines.join('\n')
    });
}

function renderBalance(data) {
    const c = data.counts || {};
    const seats = data.seats || 100;
    // A date, not a clock time. This panel changes when a seat changes, which is a matter of
    // months, so a time of day would imply a freshness the data does not have. The roster stamps
    // itself; the fetch time is only a fallback.
    const d = data.lastUpdated ? new Date(data.lastUpdated) : null;

    // The panel is lib/party-balance.js, shared with the House board. Vacancies: the Senate fills
    // them by appointment in most states, so this is usually 0 and a list would otherwise sit empty
    // asserting nothing. The row is short on purpose: it sits in a narrow column and a sentence wraps
    // to three lines there.
    PartyBalance.render({
        counts: { R: c.R, D: c.D, I: c.I },
        total: data.seats,
        seats,
        control: data.control,
        vacancyCount: data.vacancies,
        vacancyHtml: data.vacancies
            ? PartyBalance.noteHtml('open', `${data.vacancies} seat${data.vacancies === 1 ? '' : 's'} unfilled`)
            : undefined,
        stamp: fmtDate(d && !isNaN(d) ? d : new Date()),
    });

    setBalanceManifest(data);
    if (!data.control && data.controlNote) console.info('[senate] control unresolved:', data.controlNote);
}

// The Senate's seniority order. Nothing the Senate publishes carries it, so the Worker
// reads it from Wikipedia and refuses a page that does not parse cleanly (see
// lib/senate-seniority.js). It changes only when a seat does, so it is fetched once
// and again hourly with the roster it is matched against. If it is unavailable the
// board just has no seniority button.
async function loadSeniority() {
    try {
        const r = await fetch(`${API}/senate/seniority`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        globalThis.SenateQuorum?.setSeniority?.(data.rows || []);
    } catch (e) {
        console.error('Seniority fetch failed:', e);
    }
}

async function loadBalance() {
    try {
        const r = await fetch(`${API}/senate/roster`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const roster = await r.json();
        renderBalance(roster);
        // The caption track names a senator by surname; this is what turns that
        // into a face, a party and a state.
        // roster.members, not roster.seats. `seats` is the chamber size, the
        // number 100; the members are under `members`. Reading the count as an
        // array left the quorum board empty and the speaker row unable to
        // resolve a surname.
        const members = roster.members || [];
        globalThis.SenateSpeaker?.setSeats?.(members);
        globalThis.SenateQuorum?.build?.(members);
        loadSeniority();
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
    mod.init({ listEl, escapeHtml, setIfChanged, workerUrl: `${API}/airport-delays` });
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
function updateNextSessionCountdown() { SessionClock.show(el('next-session-countdown'), nextSessionAt); }

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
    let sitting = convened && convened.getTime() <= now && (!adjourned || adjourned.getTime() > now);

    // The feed publishes a sitting only once it has ENDED, so on a day the
    // Senate is actually in it still describes the last completed one. Read
    // literally that says ADJOURNED all afternoon: on 28 September the latest
    // row was 24 September, adjourned 16:05, while the chamber was in a quorum
    // call.
    //
    // nextConvene is the tell. Once that time has passed the Senate has come
    // in and the feed is simply behind. Bounded to 18 hours, because a
    // nextConvene days in the past means the feed is stale in a way this
    // cannot reason about, and guessing would be worse than saying adjourned.
    const nextIn = latest.nextConvene ? new Date(latest.nextConvene).getTime() : NaN;
    if (!sitting && !isNaN(nextIn) && nextIn <= now && now - nextIn < 18 * 3600 * 1000) sitting = true;

    if (sitting) {
        line.textContent = 'IN SESSION';
        document.body.classList.remove('recess-mode');
    } else {
        line.textContent = 'ADJOURNED';
        document.body.classList.add('recess-mode');
    }

    if (next) {
        const nc = latest.nextConvene ? new Date(latest.nextConvene) : null;
        if (nc && !isNaN(nc) && nc.getTime() > now) {
            const when = nc.toLocaleString('en-US', {
                weekday: 'short', day: '2-digit', month: 'short',
                hour: '2-digit', minute: '2-digit', hour12: true,
                timeZone: 'America/New_York', timeZoneName: 'short',
            });
            // On a pro forma the (?) follows the marker, drawn only once its entry is registered.
            const help = (latest.nextIsProForma && (InfoPopup.has('pro-forma') || new URLSearchParams(location.search).has('fixtures')))
                ? ' <button type="button" class="info-btn next-votes-help is-quiet" data-info="pro-forma" aria-label="About pro forma sessions">?</button>' : '';
            next.innerHTML = `NEXT CONVENES ${when}${latest.nextIsProForma ? ' (PRO FORMA)' : ''}${help}`;
        } else if (nc && !isNaN(nc)) {
            // The feed publishes a sitting only once it has ended, so after the
            // time it last named has passed it still names that time. Showing it
            // read "NEXT CONVENES MON, SEP 28" on 2 October. The Senate has come
            // in since and the feed is behind, so what is next is not known here,
            // and saying so beats asserting a date that is already gone.
            next.textContent = 'NEXT CONVENING NOT YET PUBLISHED';
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

// The panel itself, its party filter and its rows are lib/missing-members.js, shared
// with the House board. This maps the Senate's roll call into rows.
let absencePanel = null;

function initAbsenceFilters() {
    absencePanel = MissingMembers.init({
        panel: el('absentee'),
        list: el('absentee-list'),
        placeholder: PHOTO_PLACEHOLDER,
    });
}

function renderAbsences(data) {
    if (!absencePanel) return;
    const partyKey = (p) => (p === 'R' ? 'rep' : p === 'D' ? 'dem' : 'ind');
    const members = (data?.absent || []).map((m) => ({
        party: partyKey(m.party),
        name: `${m.first} ${m.last}`.trim(),
        state: m.state,
        photoUrl: photoUrlFor(m.bioguide),
    }));

    // Same line the House board writes: "Roll 314 • 16 September 2026 7:05 PM".
    // The vote's own file stamps it "September 24, 2026,  01:45 PM", so it is
    // reordered day-first to match the board's date format.
    let info = '';
    if (data?.rollCall) {
        let when = '';
        const m = (data.voteDate || '').match(/^(\w+)\s+(\d{1,2}),\s*(\d{4}),?\s*(.*)$/);
        if (m) {
            const time = m[4].trim().replace(/^0/, '');
            when = `${parseInt(m[2], 10)} ${m[1]} ${m[3]}${time ? ' ' + time : ''}`;
        } else if (data.date) {
            when = data.date;
        }
        info = `Roll ${data.rollCall}${when ? ' \u2022 ' + when : ''}`;
    }
    absencePanel.render({ members, info, emptyText: 'ALL SENATORS VOTED' });

    // The same numbers, as the House board's LAST VOTE ABSENCES inside THRESHOLD ANALYSIS: how
    // many of each party missed the previous vote, which is what to weigh the one in front of
    // you against. The previous vote, not this one: the Senate publishes a roll call's
    // absences only after it ends.
    const lva = el('last-vote-absences');
    if (lva && data?.rollCall) {
        const by = { rep: 0, dem: 0, ind: 0 };
        for (const m of members) by[m.party]++;
        const set = (id, v) => { const n = el(id); if (n) n.textContent = String(v); };
        set('last-vote-label', `Roll ${data.rollCall}`);
        set('last-vote-d-absent', by.dem);
        set('last-vote-r-absent', by.rep);
        set('last-vote-i-absent', by.ind);
        lva.style.display = '';
    }
}

// The vote file behind the Missing Senators link's popover (lib/source-pop.js): the Senate's own XML for the latest roll
// call, as the Worker passed it (everything but the member list, then the members marked Not Voting), cut and annotated.
function setAbsenceManifest(data) {
    const s = data && data.source;
    if (!globalThis.SourcePop || !s || !s.head) return;
    const panel = document.getElementById('absentee');
    if (!panel) return;
    const X = SourcePop.xml;
    const root = new DOMParser().parseFromString(s.head, 'text/xml').documentElement;
    if (!root || root.querySelector('parsererror')) return;
    const lines = ['<' + root.tagName + X.attrs(root) + '>'];
    for (const c of root.children) {
        if (c.tagName === 'members') continue;
        if (c.children.length > 6) { lines.push(X.note(1, c.tagName + ' omitted')); continue; }
        X.emit(c, 1, lines);
    }
    lines.push('  <members>');
    lines.push(X.note(2, (s.entries || '') + ' <member> entries. The panel lists the ' + (s.notVoting || []).length + ' marked Not Voting:'));
    for (const raw of s.notVoting || []) {
        const m = new DOMParser().parseFromString(raw, 'text/xml').documentElement;
        if (m) X.emit(m, 2, lines);
    }
    lines.push('  </members>', '</' + root.tagName + '>');
    SourcePop.set(panel, {
        title: 'The Senate\'s roll call',
        request: 'GET ' + s.url,
        xml: lines.join('\n')
    });
}

// ── Source popovers for the roll call tables, nominations and session days (lib/source-pop.js) ──
//
// Each shows the Senate's own XML for its panel: the elements are the Senate's, as the Worker passed them, printed one per line.
// The Worker cuts the file to what the panel is showing; what it left out is said in a comment.

// One raw element from the Worker, printed by SourcePop.xml.emit; null if it does not parse. The xsi namespace declaration
// the Senate puts on every nomination is left out as tooling.
function emitRawXml(raw, depth, lines) {
    const doc = new DOMParser().parseFromString(raw, 'text/xml');
    const root = doc.documentElement;
    if (!root || root.tagName === 'parsererror' || doc.querySelector('parsererror')) return false;
    const from = lines.length;
    SourcePop.xml.emit(root, depth, lines);
    for (let i = from; i < lines.length; i++) lines[i] = lines[i].replace(/\sxmlns(?::\w+)?="[^"]*"/g, '');
    return true;
}

// PROCEDURAL STAGES: the roll call menu's <vote> entries behind the cards on show.
function setStagesManifest(data) {
    if (!globalThis.SourcePop) return;
    const panel = el('senate-stages');
    if (!panel) return;
    SourcePop.set(panel, {
        title: 'The Senate\'s roll call menu',
        request: data && data.congress && data.session
            ? `GET https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${data.congress}_${data.session}.xml` : undefined,
        load: async () => {
            const r = await fetch(`${API}/senate/stages-source`);
            const d = await r.json();
            if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
            const X = SourcePop.xml;
            const lines = ['<vote_summary>',
                `  <congress>${X.esc(d.congress)}</congress>`, `  <session>${X.esc(d.session)}</session>`, `  <congress_year>${X.esc(d.year)}</congress_year>`,
                X.note(1, `The menu lists ${d.total} votes. The cards show ${d.votes.length} of them: every vote on each measure shown, newest first.`),
                '  <votes>'];
            for (const raw of d.votes) emitRawXml(raw, 2, lines);
            lines.push('  </votes>', '</vote_summary>');
            return { xml: lines.join('\n'), at: d.at };
        }
    });
}

// NOMINATIONS: each sub-section's own link, with the entries that list is showing, in the order it shows them.
// The newest this many of a finished stage are listed (NOM_SHOWN, below); the Worker cuts its source to the same.
const NOM_SOURCE_SHOWN = 40;
const NOM_SOURCE_FILES = {
    calendar: 'NomCivilianPendingCalendar', privileged: 'NomPrivileged', committee: 'NomCivilianPendingCommittee',
    confirmed: 'NomCivilianConfirmed', failed: 'NomFailedOrReturned', withdrawn: 'NomWithdrawn',
};
function setNominationsManifests() {
    if (!globalThis.SourcePop) return;
    for (const stage of Object.keys(NOM_SOURCE_FILES)) {
        const list = el(`nom-list-${stage}`);
        const header = list && list.previousElementSibling;
        if (!header) continue;
        SourcePop.set(header, {
            title: 'The Senate\'s nominations file',
            load: async () => {
                const r = await fetch(`${API}/senate/nominations-source?stage=${stage}`);
                const d = await r.json();
                if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
                const X = SourcePop.xml;
                // One part per file, as the Senate publishes them: civilian and military are not merged.
                const finished = stage === 'confirmed' || stage === 'withdrawn' || stage === 'failed';
                const parts = d.files.map((f) => {
                    const lines = ['<Nominations>', `  <Congress>${X.esc(f.congress)}</Congress>`, `  <SessionNumber>${X.esc(f.session)}</SessionNumber>`];
                    lines.push(X.note(1, 'The file holds ' + f.total.toLocaleString('en-US') + ' nominations at this stage. ' +
                        (finished ? 'The list shows the newest ' + NOM_SOURCE_SHOWN + ' across the stage; ' + f.entries.length + ' of them are in this file.' : 'The list shows all of them.') +
                        ' The xsi namespace declaration is left out.'));
                    for (const raw of f.entries) emitRawXml(raw, 1, lines);
                    lines.push('</Nominations>');
                    return { request: 'GET ' + f.url, xml: lines.join('\n') };
                });
                return { parts, at: d.at };
            }
        });
    }
}

// SENATE CALENDAR: floor_schedule.xml's days for the months the grid is drawing now, and the annual schedule's recess periods
// that touch them (the plan behind the grid's PLANNED days). Fetched each time it is opened, so it follows the month navigation.
function setSessionDaysManifest() {
    if (!globalThis.SourcePop) return;
    const panel = el('voting-calendar');
    if (!panel) return;
    SourcePop.set(panel, {
        title: 'The Senate\'s session days',
        fresh: true,
        load: async () => {
            const { from, to } = VotingCalendar.visibleRange();
            const r = await fetch(`${API}/senate/session-days-source?from=${from}&to=${to}`);
            const d = await r.json();
            if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
            const X = SourcePop.xml;
            const day = ['<CongressSessionDayConvenings>'];
            day[0] = (d.floor.root || '<CongressSessionDayConvenings>');
            day.push(X.note(1, `The file holds ${d.floor.total} session days; these are the ${d.floor.days.length} from ${from} to ${to}, the days the grid is showing.`));
            for (const raw of d.floor.days) emitRawXml(raw, 1, day);
            day.push('</CongressSessionDayConvenings>');
            const parts = [{ request: 'GET ' + d.floor.url, xml: day.join('\n') }];
            if (d.annual) {
                const a = d.annual;
                const plan = ['<schedule>', `  <title>${X.esc(a.title)}</title>`, `  <approvedDate>${X.esc(a.approved)}</approvedDate>`,
                    X.note(1, `The schedule lists ${a.total} periods when the Senate is not in session; these are the ${a.dates.length} that touch ${from} to ${to}. The grid draws a weekday outside them as planned.`),
                    '  <dates>'];
                for (const raw of a.dates) emitRawXml(raw, 2, plan);
                plan.push('  </dates>', '</schedule>');
                parts.push({ request: 'GET ' + a.url, xml: plan.join('\n') });
            }
            return { parts, at: d.at };
        }
    });
}

async function loadAbsences() {
    try {
        const r = await fetch(`${API}/senate/absences`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        renderAbsences(data);
        setAbsenceManifest(data);
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
        setIfChanged(feed, '<div class="empty-note">No floor notices</div>');
        watchListScroll(feed);
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
    watchListScroll(feed);
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
                <div class="bill-status ${st.status}" aria-hidden="true">${StatusMarks.card(st.status)}</div>
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
    // lib/scroll-fade.js: also re-checks on scroll, on content change and on resize.
    ScrollFade.watch(node);
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
            : '<div class="empty-note">None at this stage</div>');
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
    setBillUrlParam(null);   // the URL reflects the closed state
}

// A bill modal is shareable as ?bill=<slug> (e.g. ?bill=hr7008), as on the House board: opening writes
// it, closing clears it, and on load a linked bill opens. The House looks the slug up in the week's
// bills; here the slug IS the measure, since the modal fetches it by id anyway.
const BILL_SLUG_TYPES = { hr: 'H.R.', hres: 'H.Res.', hjres: 'H.J.Res.', hconres: 'H.Con.Res.', s: 'S.', sres: 'S.Res.', sjres: 'S.J.Res.', sconres: 'S.Con.Res.' };
function billSlug(id) { return String(id).toLowerCase().replace(/[\s.]+/g, ''); }
function billIdFromSlug(slug) {
    const m = String(slug || '').toLowerCase().match(/^(hr|hres|hjres|hconres|s|sres|sjres|sconres)(\d{1,5})$/);
    return m ? `${BILL_SLUG_TYPES[m[1]]} ${m[2]}` : null;
}
function setBillUrlParam(slug) {
    try {
        const url = new URL(location.href);
        if (slug) url.searchParams.set('bill', slug); else url.searchParams.delete('bill');
        history.replaceState(history.state, '', url);
    } catch { /* an address that cannot be rewritten: the modal still works */ }
}
function openDeepLinkedBill() {
    let slug = null;
    try { slug = new URL(location.href).searchParams.get('bill'); } catch { /* none */ }
    const id = billIdFromSlug(slug);
    if (id) openSenateBillModal(id);
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
    // The sections are lib/bill-sections.js, the House modal's own: sponsor, support, committees, the
    // CRS summary, latest action, and links. This function maps what the Worker sent into them.
    const sp = b.sponsor;
    const sections = [
        BillSections.sponsor(sp ? {
            name: sp.name,
            party: sp.party,
            loc: (sp.state || '') + (sp.district != null ? `-${String(sp.district).padStart(2, '0')}` : ''),
            photoUrl: sp.bioguide ? photoUrlFor(sp.bioguide) : '',
            placeholder: PHOTO_PLACEHOLDER,
        } : {}),
        BillSections.support(b.support ? { ...b.support, cosponsorCount: b.cosponsorCount } : { total: 0 }),
        BillSections.committees({
            committees: b.committees,
            report: b.committeeReport,
            reportDate: b.committeeReportDate,
            formatDate: boardDate,
        }),
    ].join('');

    // Congress.gov dates an action but gives no time of day, so there is a date and where it came from.
    const actionDate = b.latestActionDate
        ? `${escapeHtml(boardDate(b.latestActionDate))}${b.congressUrl
            ? ` <a href="${escapeHtml(b.congressUrl)}/actions" class="bill-modal-source-link" target="_blank" rel="noopener">Congress.gov</a>` : ''}`
        : '';

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
                <div class="bill-modal-sections">${sections}</div>
                ${BillSections.summary(b.summary)}
                <div class="bill-modal-foot">
                    ${BillSections.action({ textHtml: b.latestAction ? escapeHtml(b.latestAction) : '', dateHtml: actionDate })}
                    ${BillSections.links({
                        linkClass: 'senate',
                        text: b.textVersionUrl || b.govinfoPdf,
                        textLabel: b.textVersionUrl ? b.textVersionType : null,
                        textTitle: b.textVersionUrl ? [b.textVersionType, b.textVersionDate].filter(Boolean).join(', ') : null,
                        report: b.committeeReportUrl,
                        reportTitle: b.committeeReportCitation,
                        cbo: b.cboCostEstimateUrl,
                        cboTitle: b.cboCostEstimateTitle,
                        memo: b.sapUrl,
                        // The (?) beside the memo button, as on the House board: drawn once its explanation exists, and
                        // in ?fixtures so it can be reviewed before then.
                        memoHelp: (InfoPopup.has('sap') || new URLSearchParams(location.search).has('fixtures')) ? 'sap' : null,
                        reportHelp: (InfoPopup.has('committee-report') || new URLSearchParams(location.search).has('fixtures')) ? 'committee-report' : null,
                        congress: b.congressUrl,
                    })}
                    ${BillSections.source(b.congressUrl)}
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
    setBillUrlParam(billSlug(billId));

    // Warmed: paint the real thing, with no skeleton in between. This is the
    // path almost every click takes.
    const hit = cachedBill(billId);
    const paint = (entry) => {
        if (overlay.hidden || overlay.dataset.closing) return;
        overlay.innerHTML = entry.error
            ? billModalSkeleton(billId).replace('Loading…', `Details unavailable (${escapeHtml(entry.error)})`)
            : billModalContent(entry.bill);
        overlay.querySelector('#bill-modal-close')?.addEventListener('click', closeSenateBillModal);
        BillSections.wireCopyLink(overlay);
        if (!entry.error) BillSections.wireSource(overlay, entry.bill.id || billId, API);
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
                        <div class="bill-modal-section-label">RESOURCES</div>
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
        if (!card || !card.closest('.bills-section, .proceedings-panel')) return;
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

// ── Floor proceedings ────────────────────────────────────────────────────────
//
// The Senate's own narrative of a sitting day, which is the nearest thing it
// publishes to the Clerk's feed the House board reads. Not a live feed: the
// page carries one day and gains the next after that day ends, so what shows
// here is the last day the Senate sat, dated so it cannot be mistaken for
// today. The Worker holds it for five minutes rather than an hour, which is
// what will make a sitting day visibly move.

function proceedingsMeasure(m) {
    const status = m.status.map((x) => `
        <div class="proceedings-status">${escapeHtml(x.text)}${
            x.rollCall ? ` <span class="proceedings-roll">Roll call ${x.rollCall}</span>` : ''}</div>`).join('');
    const amendments = (m.amendments || []).map((a) => `
        <div class="proceedings-amendment">
            <div class="proceedings-measure-id">${escapeHtml(a.id)}${a.sponsor ? ` <span class="proceedings-sponsor">${escapeHtml(a.sponsor)}</span>` : ''}</div>
            <div class="proceedings-measure-title">${escapeHtml(a.title)}</div>
            ${a.status.map((x) => `<div class="proceedings-status">${escapeHtml(x.text)}</div>`).join('')}
        </div>`).join('');
    // The id opens the same bill modal the rest of the board uses, when the
    // measure is one Congress.gov has a record for.
    const idAttr = MEASURE_ID_RE.test(m.id.trim()) ? ` data-bill-id="${escapeHtml(m.id.trim())}"` : '';
    const tag = idAttr ? 'button' : 'div';
    return `
    <div class="proceedings-item">
        <${tag} class="proceedings-measure"${idAttr}${idAttr ? ' type="button"' : ''}>
            <div class="proceedings-measure-id">${escapeHtml(m.id)}${m.sponsor ? ` <span class="proceedings-sponsor">${escapeHtml(m.sponsor)}</span>` : ''}</div>
            <div class="proceedings-measure-title">${escapeHtml(m.title)}</div>
        </${tag}>
        ${status}${amendments}
    </div>`;
}

function renderProceedings(data) {
    const feed = el('proceedings-feed');
    const stamp = el('proceedings-last-update');
    if (!feed) return;
    if (stamp) stamp.textContent = data?.date || '';
    const sections = data?.sections || [];
    if (!sections.length) {
        setIfChanged(feed, '<div class="proceedings-error">NO PROCEEDINGS DATA AVAILABLE</div>');
        return;
    }
    // Newest first, which is how the House board's feed reads and how every
    // other list on this board is sorted. The source publishes a day forwards,
    // from the prayer to the adjournment, so the sections are reversed and the
    // measures inside a section with them: the last thing the Senate did is the
    // thing worth seeing without scrolling.
    //
    // A measure's own status lines are NOT reversed. Those are one measure's
    // history and they read as cause and effect -- laid before the Senate, then
    // cloture invoked, then passed -- so flipping them would say the Senate
    // passed a bill and then took it up.
    setIfChanged(feed, [...sections].reverse().map((sec) => {
        const head = sec.heading
            ? `<div class="proceedings-section-label">${escapeHtml(sec.heading)}</div>` : '';
        if (sec.measures) return head + [...sec.measures].reverse().map(proceedingsMeasure).join('');
        return `${head}<div class="proceedings-item"><div class="proceedings-text">${escapeHtml(sec.text || '')}</div></div>`;
    }).join(''));
    watchListScroll(feed);
}

async function loadProceedings() {
    const feed = el('proceedings-feed');
    if (!feed) return;
    if (!feed.querySelector('.proceedings-item')) {
        setIfChanged(feed, '<div class="proceedings-loading">FETCHING PROCEEDINGS...</div>');
    }
    try {
        const r = await fetch(`${API}/senate/proceedings`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        renderProceedings(data);
        setProceedingsManifest(data);
    } catch (e) {
        if (!feed.querySelector('.proceedings-measure')) {
            setIfChanged(feed, `<div class="proceedings-error">Floor activity unavailable (${escapeHtml(e.message)}).</div>`);
        }
        console.error('Proceedings fetch failed:', e);
    }
}

// The floor activity page behind the Recent Floor Activity link's popover (lib/source-pop.js): the Senate's own HTML as the
// Worker passed it, from its date heading to the end of the page's main region.
function setProceedingsManifest(data) {
    const s = data && data.source;
    if (!globalThis.SourcePop || !s || !s.html) return;
    const panel = document.getElementById('proceedings');
    if (!panel) return;
    SourcePop.set(panel, {
        title: 'The Senate\'s floor activity page',
        request: 'GET ' + s.url,
        html: s.html
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

let _stages = {};
let _stagesData = null;
// The caucus schedule, kept so a pending stage card can say when its vote is.
let _agenda = null;

// When the Senate convenes today: the line under the floor status, as the House board has for its
// Calendar. "Convenes at 3 P.M." until the hour, "Convened at" after. The time is the one the Democratic
// Caucus schedule gives ("stand adjourned until 3:00pm on Monday, October 5"), which is the previous
// order's convening time and is hand-written, so the line says whose it is. Shown only when that
// schedule is for TODAY: the newest post is the next sitting's once the caucus posts it in the evening,
// and a date that is not today is not asserted (the header already names the next convening).
function renderConvening() {
    const line = el('calendar-line');
    if (!line) return;
    const iso = _agenda && Convening.isoDate(_agenda.conveneDate);
    if (!iso || !_agenda.conveneTime || iso !== Convening.today()) { line.hidden = true; return; }
    const met = Convening.hasMet(iso, _agenda.conveneTime);
    line.textContent = `${met ? 'Convened' : 'Convenes'} at ${Convening.format(_agenda.conveneTime)} \u00b7 Democratic Caucus schedule`;
    line.hidden = false;
}
setInterval(renderConvening, 30 * 1000);   // "Convenes" becomes "Convened" when the hour passes

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
            <span class="amdt-vote-circle" aria-hidden="true">${StatusMarks.chip(v.carried ? 'passed' : 'failed')}</span>
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
        <span class="amdt-vote-circle" aria-hidden="true">${StatusMarks.chip(won === votes.length ? 'passed' : won === 0 ? 'failed' : '')}</span>
        <span class="amdt-vote-label">${escapeHtml(label)}</span>
    </div>
    <div class="amdt-vote-connector" aria-hidden="true"></div>`;
}

// What a card is waiting for, once cloture has put it there. Phrased as the
// thing that has not happened yet, because that is the whole difference between
// this card and the one next to it that has a tally on it.
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
                <div class="bill-status ${m.status}" aria-hidden="true">${StatusMarks.card(m.status)}</div>
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
            : '<div class="empty-note">Nothing at this stage</div>');
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
        const stagesData = await r.json();
        renderStages(stagesData);
        setStagesManifest(stagesData);
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

    // A measure the post merely mentions in passing is not on the floor's agenda; the rest say what they are.
    const ROLE_TEXT = { 'taken-up': 'Pending consideration', cloture: 'Cloture filed', vote: 'Vote on the motion to proceed', discharge: 'Motion to discharge', possible: 'Consideration possible' };
    const cards = measures.filter((m) => !m.role || m.role !== 'named').map((m) => {
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
                        ${m.calendarNo != null ? `<span class="bill-calendar-no">Cal. No. ${escapeHtml(String(m.calendarNo))}</span>` : ''}
                        ${data.postCloture ? '<span class="bill-calendar-no">Post-cloture</span>' : ''}
                    </div>
                    <div class="bill-title">${escapeHtml(m.title || '')}</div>
                    <div class="bill-meta">
                        <div class="bill-action">${escapeHtml([m.author, vote ? `Scheduled: ${vote}` : (ROLE_TEXT[m.role] || 'Pending consideration')].filter(Boolean).join(' \u00b7 '))}</div>
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
        renderConvening();
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
setSessionDaysManifest();
setNominationsManifests();
// Convene and adjourn times move over minutes, not seconds.
setInterval(loadSchedule, 5 * 60 * 1000);

initAnalogClocks();
initAirportDelays();
updateTimestamp();
setInterval(updateTimestamp, 1000);
Weather.init({ temp: el('weather-temp'), condition: el('weather-condition') });
// The Capitol camera, lib/capcam.js: loaded on first hover, as on the House board.
CapCam.init(el('weather-panel'), el('capcam-video'));
// The Twitter list is one list and its handles cover both chambers, so the feed is
// the House's (lib/reporters.js); only the cards in the row differ. These are
// reporters on the Senate beat. Search reaches every handle the list carries.
Reporters.init({
    api: `${API}/tweets`,
    cards: [
        { handle: '@burgessev',       name: 'Burgess Everett' },
        { handle: '@mkraju',          name: 'Manu Raju' },
        { handle: '@AndrewDesiderio', name: 'Andrew Desiderio' },
        { handle: '@seungminkim',     name: 'Seung Min Kim' },
    ],
});
// Floor feed PiP (lib/floor-feed.js). The Worker resolves the Senate's own
// stream -- see handleSenateHlsUrl in worker.js for how the URL is built.
// Between sittings the Senate's floor stream does not exist, and the panel would sit empty. It
// shows the Capitol camera instead (lib/capcam.js has the stream), in the same panel with the
// source credited, and the floor takes over by itself when it goes live. The House board passes no `idle` and keeps its
// own behaviour: the last frame of the stream, as the House's feed does.
FloorFeed.init({
    hlsUrl: `${API}/senate/hls-url`,
    idle: {
        url: CapCam.url,
        source: { text: 'Capitol Camera (Secretary of the Senate)', href: 'https://www.senate.gov/general/capcam.htm' },
        hls: CapCam.hlsConfig,
    },
});
// Reads the floor feed's own caption track. Senate TV names the member at the
// moment they are recognised and never again, so the module latches the label
// rather than reading whatever is on screen. loadBalance hands it the roster.
SenateSpeaker.init({ videoId: 'player-pip', photoUrlFor });
// The bars beside the speaker. The signals come from the floor feed; this draws them.
SpeakerMeter.init(document.getElementById('pip-speaker'));
// The quorum board listens for the roll names the speaker module broadcasts.
SenateQuorum.init({ photoUrlFor });
// The floor mode: prayer, pledge, morning business, the leaders' daily remarks, wrap-up. The
// Worker reads the captions and decides (lib/senate-modes.js), so every viewer sees the same
// thing and one who joins mid-prayer sees it too; this only draws what it is told. The body
// classes are the House's, so its section styling applies.
(() => {
  const BODY = { prayer: 'prayer-mode', pledge: 'pledge-mode', 'morning-business': 'morning-hour-mode', 'wrap-up': 'morning-hour-mode', leader: 'speaker-mode', debate: 'debate-mode' };
  const ALL = [...new Set(Object.values(BODY))];
  // The poll is every few seconds; a tab that has stopped hearing from the Worker should not
  // hold a mode on screen on its own say-so.
  const STALE_MS = 30 * 1000;
  let told = { mode: null, at: 0 };
  const time = (at) => new Date(at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  const setText = (id, v) => { const n = document.getElementById(id); if (n && n.textContent !== v) n.textContent = v; };

  // The Democratic Caucus posts each sitting day's schedule the evening before, and says
  // what follows the leaders: "Following Leader remarks, the Senate will resume
  // consideration of ...". Only today's post is used, matched on the first date in its
  // title, since the newest post is for the next sitting, not this one.
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function followingLeaders() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const today = `${MONTHS[now.getMonth()]} ${now.getDate()}`;
    for (const n of _notices) {
      if (n.type !== 'schedule') continue;
      const m = String(n.title).match(new RegExp(`(${MONTHS.join('|')})\\s+(\\d{1,2})`));
      if (!m || `${m[1]} ${Number(m[2])}` !== today) continue;
      const para = String(n.body || '').split('\n').find((l) => /following leader remarks/i.test(l));
      return para ? para.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() : '';
    }
    return '';
  }

  function paintLeader(cur) {
    setText('leader-tag-text', cur.which.toUpperCase());
    setText('leader-title', cur.which);
    // The label of whoever spoke right after the chair recognized the leader; the Worker says
    // which, and null when it could not tell. Resolved here against the roster.
    const r = cur.first && SenateSpeaker.resolve(cur.first);
    const m = r && r.member || null;
    setText('leader-name', m ? `${m.first} ${m.last}` : 'Not identified from the captions');
    setText('leader-details', m ? m.state : '');
    const tag = document.getElementById('leader-party-tag');
    if (tag) {
      const cls = m ? ({ D: 'democrat', R: 'republican' }[m.party] || 'independent') : '';
      tag.textContent = m ? m.party : '';
      tag.className = `speaker-party-tag ${cls}`.trim();
    }
    const img = document.getElementById('leader-image');
    const url = m && m.bioguide ? photoUrlFor(m.bioguide) : '';
    if (img && (img.getAttribute('src') || '') !== url) { img.src = url; img.hidden = !url; }
    const next = followingLeaders();
    setText('leader-next', next ? `Democratic Caucus schedule: ${next}` : '');
  }

  // The measure under debate, drawn by lib/debate-panel.js (the House's panel, same markup). The
  // Worker names it in the mode ({ mode: 'debate', bill: 'S. 1234', source, since }); the details
  // come from /senate/bill like the modal's, warmed and cached. `source` is 'schedule' when the
  // measure is what the caucus schedule says the Senate is on, and the tag says SCHEDULED: that is
  // the day's plan, not a statement that debate has begun. Any other source is not labelled.
  let _debateBill = null;
  function paintDebate(cur) {
    const id = cur.bill || '';
    const planned = cur.source === 'schedule';
    document.getElementById('debate-section')?.classList.toggle('is-planned', planned);
    // From the schedule, the tag says what the post says will happen, not that the Senate is debating it.
    setText('debate-tag-text', planned ? ({ 'taken-up': 'CONSIDERATION', cloture: 'CLOTURE VOTE', vote: 'MOTION TO PROCEED' }[cur.role] || 'DEBATE') : 'DEBATE');
    const lenTag = document.getElementById('debate-length-tag');
    setText('debate-length-text', 'SCHEDULED');
    if (lenTag) lenTag.style.display = cur.source === 'schedule' ? '' : 'none';
    // a scheduled time is the post's own ("At 11:30am ..."), approximate, and shown as such
    const at = cur.at != null ? new Date(Date.UTC(2000, 0, 1, Math.floor(cur.at / 60), cur.at % 60)).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '';
    setText('debate-time', cur.since ? time(cur.since) : (at ? `AROUND ${at}` : ''));
    const src = document.getElementById('debate-source-link');
    if (id === _debateBill) return;
    _debateBill = id;
    DebatePanel.bare({ id, title: cur.title || '' });
    if (src) { src.href = 'https://www.congress.gov'; src.textContent = 'Congress.gov'; }
    if (!id) return;
    fetchSenateBill(id).then((entry) => {
      if (_debateBill !== id) return; // the floor moved on while this was in flight
      const b = entry.bill;
      if (!b) return; // no Congress.gov record: the id and the title we were told stay
      const sp = b.sponsor;
      DebatePanel.fill({
        id: b.id || id,
        title: b.title || cur.title || '',
        sponsor: sp ? {
          name: sp.name,
          party: sp.party,
          loc: (sp.state || '') + (sp.district != null ? `-${String(sp.district).padStart(2, '0')}` : ''),
          photoUrl: sp.bioguide ? photoUrlFor(sp.bioguide) : '',
          placeholder: PHOTO_PLACEHOLDER,
        } : null,
        support: b.support ? { ...b.support, cosponsorCount: b.cosponsorCount } : null,
        committees: b.committees,
        report: b.committeeReport,
        reportDate: b.committeeReportDate,
        formatDate: boardDate,
        summary: b.summary,
        linkClass: 'senate',
        links: { text: b.textVersionUrl || b.govinfoPdf, textLabel: b.textVersionUrl ? b.textVersionType : null, textTitle: b.textVersionUrl ? [b.textVersionType, b.textVersionDate].filter(Boolean).join(', ') : null, report: b.committeeReportUrl, cbo: b.cboCostEstimateUrl, memo: b.sapUrl, congress: b.congressUrl },
        sourceApi: API,
      });
      if (src && b.congressUrl) src.href = b.congressUrl;
    });
  }

  const apply = () => {
    const cur = told.mode && Date.now() - told.at < STALE_MS ? told.mode : null;
    const mode = cur && cur.mode;
    const cls = BODY[mode];
    for (const c of ALL) document.body.classList.toggle(c, c === cls);
    for (const k of ['prayer', 'pledge']) setText(`${k}-time`, k === mode ? time(cur.since) : '');
    if (mode === 'morning-business' || mode === 'wrap-up') {
      const wrap = mode === 'wrap-up';
      setText('floor-note-tag', wrap ? 'WRAP-UP' : 'MORNING BUSINESS');
      setText('floor-note-time', time(cur.since));
      setText('floor-note-desc', wrap
        ? "The majority leader is reading the unanimous-consent request that sets the Senate's next convening and its business."
        : 'The Senate is in a period of morning business.');
      setText('floor-note-limit', !wrap && cur.limit ? `The chair has set senators to speak for up to ${cur.limit} minutes each.` : '');
    }
    if (mode === 'leader') { setText('leader-time', time(cur.since)); paintLeader(cur); }
    if (mode === 'debate') paintDebate(cur);
    else _debateBill = null;
  };
  document.addEventListener('senate-mode', (e) => {
    told = { mode: e.detail && e.detail.mode, at: Date.now() };
    apply();
  });
  setInterval(apply, 1000);
})();
// The chamber floor shows the same roll as the board, on the real desks.
SenateChamber.init({ api: API });
// The Worker holds the whole call; the local caption reader is just faster.
SenateQuorum.syncFromWorker(API);
// Every five seconds, not fifteen: the pledge is under a minute, and the floor mode comes
// from this response. The Worker answers a repeat inside four seconds from memory.
setInterval(() => SenateQuorum.syncFromWorker(API), 5000);
initAbsenceFilters();
loadAbsences();
initNoticeFilter();
initBillModal();
openDeepLinkedBill();
loadNominations();
loadFloorSchedule();
// The caucus posts the next day's schedule each evening.
setInterval(loadFloorSchedule, 30 * 60 * 1000);
loadProceedings();
// The page is rewritten through a sitting day, so this is the one source here
// worth asking again at the rate the Worker caches it.
setInterval(loadProceedings, 5 * 60 * 1000);
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
