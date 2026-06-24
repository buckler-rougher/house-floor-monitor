// Dome Watch - Single Vote Tracker

// Allowlist-sanitize HTML from external sources (e.g. nitter tweet bodies).
// Keeps <a href="https://..."> links; strips everything else.
function sanitizeTweetHtml(html) {
    if (!html) return '';
    // 1. Keep existing <a href="https://..."> links, strip all other tags
    let out = html
        .replace(/<a\s+[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
            (_, href, inner) =>
                `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(inner.replace(/<[^>]+>/g, ''))}</a>`)
        .replace(/<[^>]+>/g, '');
    // 2. Auto-link URLs — strip trailing punctuation that's likely not part of the URL
    const trimUrl = u => u.replace(/[.,;:!?)]+$/, '');
    out = out.replace(/(?<![">=/\w])(https?:\/\/[^\s<>"]+)/g,
        m => { const u = trimUrl(m); return `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u)}</a>`; });
    // Bare domains with a path (e.g. cbsn.ws/4okdGWi) — require slash to avoid false positives
    out = out.replace(/(?<![">=/\w@.])\b([a-z0-9][a-z0-9-]*\.[a-z]{2,6}\/[^\s<>".,;:!?)]+)/gi,
        (_, url) => `<a href="https://${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`);
    // 3. Auto-link @handles
    out = out.replace(/(?<![/\w@])@([\w]+)/g,
        (_, handle) => `<a href="https://twitter.com/${handle}" target="_blank" rel="noopener noreferrer">@${handle}</a>`);
    return out;
}

// Shared member photo placeholder: US flag (left) + person silhouette, scales to any size
const MEMBER_PHOTO_PLACEHOLDER = `<svg viewBox="0 0 28 28" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="4" fill="#b22234"/><rect x="0" y="4" width="10" height="4" fill="#dde"/><rect x="0" y="8" width="10" height="4" fill="#b22234"/><rect x="0" y="12" width="10" height="4" fill="#dde"/><rect x="0" y="16" width="10" height="4" fill="#b22234"/><rect x="0" y="20" width="10" height="4" fill="#dde"/><rect x="0" y="24" width="10" height="4" fill="#b22234"/><rect x="0" y="0" width="4" height="8" fill="#3c3b6e"/><rect x="8" y="0" width="20" height="28" fill="#161b22" opacity="0.75"/><circle cx="17" cy="11" r="5" fill="#5e7080"/><path d="M6 28 C6 20 11 17 17 17 C23 17 28 20 28 28 Z" fill="#5e7080"/></svg>`;

// Current Congress number — auto-advances on Jan 3 of each odd year.
// 119th started Jan 3, 2025; 120th starts Jan 3, 2027; no code change needed.
const CURRENT_CONGRESS = (function() {
    const now = new Date();
    const year = now.getFullYear();
    const isAfterJan3 = now.getMonth() > 0 || now.getDate() >= 3;
    const effectiveYear = isAfterJan3 ? year : year - 1;
    const startYear = effectiveYear % 2 === 0 ? effectiveYear - 1 : effectiveYear;
    return 118 + (startYear - 2023) / 2;
}());
// Ordinal slug for congress.gov URLs, e.g. "119th-congress", "121st-congress"
const CURRENT_CONGRESS_SLUG = (function(n) {
    const s = n % 100;
    if (s >= 11 && s <= 13) return `${n}th-congress`;
    const r = n % 10;
    if (r === 1) return `${n}st-congress`;
    if (r === 2) return `${n}nd-congress`;
    if (r === 3) return `${n}rd-congress`;
    return `${n}th-congress`;
}(CURRENT_CONGRESS));

// Guard against unnecessary DOM thrashing — skip innerHTML update if content unchanged
const _htmlCache = new WeakMap();
function setIfChanged(el, html) {
    if (!el) return;
    if (_htmlCache.get(el) === html) return;
    _htmlCache.set(el, html);
    el.innerHTML = html;
}

// Set a member profile link, showing friendly text instead of raw URL
function setMemberProfileLink(el, url) {
    if (!el) return;
    if (!url || url === '#') { el.href = '#'; el.textContent = '--'; return; }
    el.href = url;
    el.textContent = url.includes('congress.gov') ? 'View on Congress.gov →' : 'View profile →';
}

const DEBUG_LOG_ALLOW = [
    'SSE connection opened',
    'SSE data received:',
    'SSE disconnected, falling back to polling',
    'DomeWatch response:',
    'DomeWatch payload:',
    'SSE error:',
    'Failed to start SSE streaming:',
    'Fetch floor data failed:',
    // Voting days
    'Today:', 'Today event found:', 'All events:', 'Is fly-in day:', 'Event summary:',
    'Final todayStatus:', 'Updating session status to:', 'Session text element:', 'Session status updated to:',
    // Timer
    '=== TIMER UPDATE', 'Timer data:', 'Timer element:', 'Timer value:',
    'Timestamp:', 'Seconds remaining:', 'Timer data available:', 'Timer element available:',
    // Bills
    '=== BILLS FETCH START ===', 'Rule bills list element:', 'Suspension bills list element:',
    'Bills API response:', 'Found ', 'Vote map state updated:',
    // Debate section debug
    '[debate]', '[debate-nav]', '[bills→debate]',
];

const __originalConsoleLog = console.log.bind(console);
console.log = (...args) => {
    const first = String(args[0] ?? '');
    if (DEBUG_LOG_ALLOW.some(prefix => first.startsWith(prefix))) {
        __originalConsoleLog(...args);
    }
};

// Update Footer Timestamp
function updateFooterTimestamp() {
    if (!elements.footerUpdated) return;
    const now = new Date();
    elements.footerUpdated.textContent = `Last updated: ${now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    })}`;
}

// Update Today's Date
function updateTodayDate() {
    if (elements.todayDate) {
        elements.todayDate.textContent = fmtDateLong(new Date());
    }
    
    // Update source links with dynamic year
    updateSourceLinks();
}

// Update source links with current year
function updateSourceLinks() {
    const currentYear = new Date().getFullYear();
    const clerkUrl = `https://clerk.house.gov/evs/${currentYear}/index.asp`;
    document.querySelectorAll('a[href*="clerk.house.gov/evs/"]').forEach(a => {
        a.href = clerkUrl;
    });
}

// Fetch House Voting Days
async function fetchVotingDays() {
    try {
        // Fetch voting days data from worker
        const response = await fetch(VOTING_DAYS_CONFIG.workerUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Convert voting days to events format
        const events = data.votingDays.map(item => ({ 
            date: item.date, 
            summary: item.summary || 'Vote Day'
        }));
        
        // Determine today's session status
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let todayStatus = 'unknown';
        let todayEvent = null;
        
        // Find today's events (there may be multiple)
        const todayEvents = [];
        for (const event of events) {
            const [ey, em, ed] = event.date.split('-').map(Number);
            const eventDate = new Date(ey, em - 1, ed);
            
            if (eventDate.getTime() === today.getTime()) {
                todayEvents.push(event);
            }
        }
        
        // Prioritize fly-in events if multiple exist for today
        if (todayEvents.length > 0) {
            const flyInEvent = todayEvents.find(event =>
                event.summary.toLowerCase().includes('fly-in')
            );
            todayEvent = flyInEvent || todayEvents[0];
        }

        const lastActualVoteDate = data.lastActualVoteDate || null;

        if (todayEvent) {
            // Determine if it's a fly-in day
            const isFlyIn = checkIfFlyInDay(today, events);

            const isWeekend = today.getDay() === 0 || today.getDay() === 6;
            const summaryLower = todayEvent.summary.toLowerCase();

            // Explicit ICS event type wins over the gap heuristic.
            // Check named types first so e.g. a pro-forma session that happens
            // to fall after a multi-day gap isn't misclassified as fly-in.
            if (/pro[- ]forma/i.test(todayEvent.summary)) {
                todayStatus = 'pro-forma';
            } else if (!isWeekend && (isFlyIn || summaryLower.includes('fly-in') || summaryLower.includes('fly in'))) {
                todayStatus = 'fly-in';
                // Promote airport delays panel on fly-in days
                const absenteePanel = document.getElementById('absentee');
                const airportPanel = document.getElementById('airport-delays');
                if (absenteePanel && airportPanel && absenteePanel.nextElementSibling !== airportPanel) {
                    absenteePanel.insertAdjacentElement('afterend', airportPanel);
                }
            } else if (summaryLower.includes('added')) {
                todayStatus = 'added-votes';
            } else if (isWeekend) {
                todayStatus = 'no-session';
            } else {
                todayStatus = 'in-session';
            }
        } else {
            todayStatus = 'no-session';
        }
        
        votingDaysData = {
            days: events,
            lastUpdated: new Date(),
            currentSessionStatus: todayStatus
        };

        votingCalendarData = events
            .map(item => {
                const summary = (item.summary || '')
                    .replace(/[^a-z0-9 ]+/gi, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();
                let type = null;
                if (/fly.?in/.test(summary)) {
                    type = 'fly-in';
                } else if (/fly.?out/.test(summary)) {
                    type = 'fly-out';
                } else if (/added|additional/.test(summary) && /vote/.test(summary)) {
                    type = 'added';
                } else if (/cancel/.test(summary) && /vote/.test(summary)) {
                    type = 'cancelled';
                } else if (/vote|voting/.test(summary)) {
                    type = 'vote-day';
                }
                return {
                    ...item,
                    type
                };
            })
            .filter(item => item.type);
        renderVotingDaysCalendar();
        renderThisWeek();

        updateSessionStatus();
        
    } catch (error) {
        console.error('Error fetching voting days:', error);
        updateSessionStatus('error');
    }
}

function renderThisWeek() {
    const el = document.getElementById('this-week-body');
    if (!el || !votingCalendarData.length) return;

    // Get Mon–Sun of the current week
    const now = new Date();
    const dow = now.getDay(); // 0=Sun
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const toDateStr = d => d.toISOString().slice(0, 10);
    const weekDates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return toDateStr(d);
    });

    // Collect events falling in this week
    const weekEvents = votingCalendarData.filter(e => weekDates.includes(e.date));

    if (!weekEvents.length) {
        el.innerHTML = '<span class="this-week-empty">No votes scheduled this week</span>';
        return;
    }

    const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const TYPE_CLASS = {
        'fly-in':    'this-week-day-fly',
        'fly-out':   'this-week-day-fly',
        'vote-day':  'this-week-day-vote',
        'added':     'this-week-day-vote',
        'cancelled': 'this-week-day-recess',
    };
    const TYPE_LABEL = {
        'fly-in':    'Fly In',
        'fly-out':   'Fly Out',
        'vote-day':  'Votes',
        'added':     'Votes+',
        'cancelled': 'Cancelled',
    };

    // Group events by date so fly-in + vote-day on same day become one chip
    const byDate = new Map();
    weekEvents.forEach(e => {
        if (!byDate.has(e.date)) byDate.set(e.date, new Set());
        byDate.get(e.date).add(e.type);
    });

    el.innerHTML = [...byDate.entries()].map(([date, types]) => {
        const [y, m, d] = date.split('-').map(Number);
        const dayName = DAY_SHORT[new Date(y, m - 1, d).getDay()];
        // Determine class (fly takes priority over vote, added over everything)
        const cls = types.has('added') ? TYPE_CLASS['added']
            : (types.has('fly-in') || types.has('fly-out')) ? TYPE_CLASS['fly-in']
            : types.has('cancelled') ? TYPE_CLASS['cancelled']
            : TYPE_CLASS['vote-day'];
        // Build combined label
        let lbl;
        if (types.has('fly-in') && types.has('vote-day'))       lbl = 'Fly In + Votes';
        else if (types.has('fly-out') && types.has('vote-day')) lbl = 'Votes + Fly Out';
        else if (types.has('fly-in'))                           lbl = 'Fly In';
        else if (types.has('fly-out'))                          lbl = 'Fly Out';
        else if (types.has('added'))                            lbl = 'Votes+';
        else if (types.has('cancelled'))                        lbl = 'Cancelled';
        else                                                    lbl = 'Votes';
        return `<span class="this-week-day ${cls}">${dayName} · ${lbl}</span>`;
    }).join('');
}

let calendarMonthOffset = 0; // months offset from today's month (desktop window center)
let calendarMobileIdx = 1;   // which of the 3 rendered months is visible on mobile

function renderVotingDaysCalendar() {
    const prevEl = document.getElementById('voting-calendar-prev');
    const currentEl = document.getElementById('voting-calendar-current');
    const nextEl = document.getElementById('voting-calendar-next');

    if (!prevEl || !currentEl || !nextEl) return;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const baseMonth = new Date(now.getFullYear(), now.getMonth() + calendarMonthOffset, 1);
    const monthDates = [
        new Date(baseMonth.getFullYear(), baseMonth.getMonth() - 1, 1),
        new Date(baseMonth.getFullYear(), baseMonth.getMonth(), 1),
        new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 1),
    ];

    // Build date → events map
    const eventMap = new Map();
    votingCalendarData.forEach(item => {
        const list = eventMap.get(item.date) || [];
        list.push(item);
        eventMap.set(item.date, list);
    });

    const MONTH_NAMES_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    const COLORS = {
        'fly-in':    { cell: 'cal-day-vote', num: '#4ade80', lbl: '#86efac' },
        'fly-out':   { cell: 'cal-day-vote', num: '#4ade80', lbl: '#86efac' },
        'vote-day':  { cell: 'cal-day-vote', num: '#4ade80', lbl: '#86efac' },
        'added':     { cell: 'cal-day-added', num: '#fbbf24', lbl: '#fcd34d' },
        'cancelled': { cell: 'cal-day-cancelled', num: '#6e7681', lbl: '#6e7681' },
    };

    const buildMonth = (el, monthStart) => {
        const year = monthStart.getFullYear();
        const month = monthStart.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDow = monthStart.getDay();

        let html = `<div class="cal-title">${MONTH_NAMES_LONG[month]} ${year}</div>`;
        html += `<div class="cal-grid">`;
        DOW.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
        for (let i = 0; i < firstDow; i++) html += `<div class="cal-day cal-day-empty"></div>`;

        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const evts = eventMap.get(ds) || [];
            const types = new Set(evts.map(e => e.type));
            const isToday = ds === todayStr;

            // Determine color priority: added > vote/fly > cancelled
            const colorType = types.has('added') ? 'added'
                : (types.has('vote-day') || types.has('fly-in') || types.has('fly-out')) ? 'vote-day'
                : types.has('cancelled') ? 'cancelled'
                : null;
            const c = colorType ? COLORS[colorType] : null;
            const cellClass = ['cal-day', c?.cell, isToday ? 'cal-day-today' : ''].filter(Boolean).join(' ');

            // Labels in priority order
            const lbls = [];
            if (types.has('fly-in'))    lbls.push(`<span class="cal-lbl" style="color:${c.lbl}">FLY IN</span>`);
            if (types.has('fly-out'))   lbls.push(`<span class="cal-lbl" style="color:${c.lbl}">FLY OUT</span>`);
            if (types.has('vote-day'))  lbls.push(`<span class="cal-lbl" style="color:${c.lbl}">VOTES</span>`);
            if (types.has('added'))     lbls.push(`<span class="cal-lbl" style="color:${c.lbl}">VOTES+</span>`);
            if (types.has('cancelled') && !types.has('vote-day') && !types.has('added'))
                                        lbls.push(`<span class="cal-lbl cal-lbl-strike" style="color:${c.lbl}">VOTES</span>`);

            const numStyle = c ? `style="color:${c.num}"` : '';
            const lblsHtml = lbls.length ? `<div class="cal-lbls">${lbls.join('')}</div>` : '';
            html += `<div class="${cellClass}">
                <span class="cal-num" ${numStyle}>${d}</span>
                ${lblsHtml}
            </div>`;
        }
        html += `</div>`;
        el.innerHTML = html;
    };

    buildMonth(prevEl, monthDates[0]);
    buildMonth(currentEl, monthDates[1]);
    buildMonth(nextEl, monthDates[2]);

    // Only highlight the center month if it's actually the current real month
    currentEl.classList.toggle('voting-calendar-month-center', calendarMonthOffset === 0);

    // Mobile nav: mobileIdx 0/1/2 picks which rendered month is shown.
    // Pressing past the edge shifts the 3-month window and wraps around.
    const mobileEls = [prevEl, currentEl, nextEl];
    const updateMobileView = () => {
        mobileEls.forEach((el, i) => el.classList.toggle('cal-mobile-visible', i === calendarMobileIdx));
        const d = monthDates[calendarMobileIdx];
        const titleEl = document.getElementById('calendar-mobile-title');
        if (titleEl) titleEl.textContent = `${MONTH_NAMES_LONG[d.getMonth()]} ${d.getFullYear()}`;
    };
    updateMobileView();

    const prevBtn = document.getElementById('calendar-mobile-prev');
    const nextBtn = document.getElementById('calendar-mobile-next');
    if (prevBtn) prevBtn.onclick = () => {
        if (calendarMobileIdx > 0) {
            calendarMobileIdx--;
            updateMobileView();
        } else {
            calendarMonthOffset -= 3;
            calendarMobileIdx = 2;
            renderVotingDaysCalendar();
        }
    };
    if (nextBtn) nextBtn.onclick = () => {
        if (calendarMobileIdx < 2) {
            calendarMobileIdx++;
            updateMobileView();
        } else {
            calendarMonthOffset += 3;
            calendarMobileIdx = 0;
            renderVotingDaysCalendar();
        }
    };

    // Desktop nav
    const dPrev = document.getElementById('calendar-desktop-prev');
    const dNext = document.getElementById('calendar-desktop-next');
    const dToday = document.getElementById('calendar-desktop-today');
    if (dPrev) dPrev.onclick = () => { calendarMonthOffset -= 3; calendarMobileIdx = 1; renderVotingDaysCalendar(); };
    if (dNext) dNext.onclick = () => { calendarMonthOffset += 3; calendarMobileIdx = 1; renderVotingDaysCalendar(); };
    if (dToday) {
        dToday.classList.toggle('calendar-today-at-current', calendarMonthOffset === 0);
        dToday.onclick = () => { calendarMonthOffset = 0; calendarMobileIdx = 1; renderVotingDaysCalendar(); };
    }
}

// Fly-in day = today is on the ICS calendar but yesterday is not.
// Simple calendar check — no KV heuristics.
function checkIfFlyInDay(today, events) {
    const pad = n => String(n).padStart(2, '0');
    const toStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

    if (!events.some(e => e.date === toStr(today))) return false;

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return !events.some(e => e.date === toStr(yesterday));
}

// Update Session Status Display
function updateSessionStatus(status = null) {
    if (!elements.sessionText) return;
    
    const sessionStatus = status || votingDaysData.currentSessionStatus;
    
    // Update session status based on voting days calendar
    switch (sessionStatus) {
        case 'fly-in':
            elements.sessionText.textContent = 'FLY-IN DAY';
            break;
        case 'in-session':
            elements.sessionText.textContent = 'IN SESSION';
            break;
        case 'pro-forma':
            elements.sessionText.textContent = 'PRO-FORMA SESSION';
            break;
        case 'added-votes':
            elements.sessionText.textContent = 'IN SESSION';
            break;
        case 'no-session':
            elements.sessionText.textContent = 'OUT OF SESSION';
            break;
        case 'error':
            elements.sessionText.textContent = 'SESSION UNKNOWN';
            break;
        default:
            elements.sessionText.textContent = 'SESSION UNKNOWN';
            break;
    }
    updateNextSessionCountdown();
}

function parseNextSessionFromProceedings(items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const latest = items[0];
    const text = (latest?.description || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/next meeting is scheduled for\s+(.+?)\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*\.?$/i);
    if (!match) return null;

    const timeText = match[1]
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b([ap])\.m\.?/ig, (_, ap) => `${ap.toUpperCase()}M`)
        .replace(/\b([ap])m\b/ig, (_, ap) => `${ap.toUpperCase()}M`);
    const dateText = match[2].replace(/\s+/g, ' ').trim();
    const parsed = new Date(`${dateText} ${timeText}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatNextSessionCountdown(target) {
    if (!(target instanceof Date) || Number.isNaN(target.getTime())) return '';
    const diffMs = target.getTime() - Date.now();
    if (diffMs <= 0) return 'NEXT SESSION: NOW';

    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const parts = [];
    if (days) parts.push(`${days}D`);
    if (hours) parts.push(`${hours}H`);
    if (mins || days || hours) parts.push(`${mins}M`);
    parts.push(`${String(secs).padStart(2, '0')}S`);
    return `NEXT SESSION IN ${parts.join(' ')}`;
}

function updateNextSessionCountdown() {
    if (!elements.nextSessionCountdown) return;
    if (!nextSessionAt) {
        elements.nextSessionCountdown.style.display = 'none';
        elements.nextSessionCountdown.textContent = 'Next session: --';
        return;
    }
    elements.nextSessionCountdown.style.display = 'inline-flex';
    elements.nextSessionCountdown.textContent = formatNextSessionCountdown(nextSessionAt);
}

// API Configuration
const API_CONFIG = {
    corsProxy: 'https://proxy.pmzzg4fpnj.workers.dev/proxy?url=',
    refreshInterval: 30000, // 30 seconds
    fallbackMode: true
};


// State for DomeWatch floor data
let floorData = {
    lastUpdated: null,
    currentStatus: null,
    rollCall: null,
    voteCounts: null,
    timer: null,
    timeline: null
};

// ── Roll call log ─────────────────────────────────────────────────────────────
// Tracks DomeWatch vote counts per roll call. Overwrites current roll's entry
// as tallies stream in; finalises and starts a new entry when roll number changes.
let rollLog = [];           // in-memory mirror of what's been POSTed to worker
let rollLogCurrentRoll = null; // roll number we're currently tracking



// Called by both the initial REST load and the SSE event: roll-log handler.
function applyRollLogData(entries) {
    if (!Array.isArray(entries)) return;
    rollLog = entries;
    const activeRoll = floorData?.rollCall?.number ? String(floorData.rollCall.number) : null;
    const isSubstantive = e => {
        if (activeRoll && String(e.roll) === activeRoll) return false;
        const total = (e.totals?.yeas || 0) + (e.totals?.nays || 0);
        if (total < 150) return false;
        const q = (e.question || '').toLowerCase();
        if (/motion to (commit|recommit|table)|previous question|ordering the previous/i.test(q)) return false;
        return true;
    };
    const last = [...rollLog].reverse().find(isSubstantive) || rollLog[rollLog.length - 1];
    if (last && !_lastVoteAbsences) {
        _lastVoteAbsences = {
            d: last.dem?.notVoting ?? '--',
            r: last.rep?.notVoting ?? '--',
            i: last.ind?.notVoting ?? 0,
            roll: last.roll || null,
            question: last.question || null,
        };
        updateLastVoteAbsencesDisplay();
    }
    applyRollLogToBills(rollLog, activeRoll);
    updateVoteTimelineStatus(); // refresh absence badges with newly loaded data
}

async function loadRollLog() {
    try {
        const resp = await fetch('https://api.evanhollander.org/house-floor/api/roll-log');
        const data = await resp.json();
        applyRollLogData(data.entries);
    } catch(e) { console.error('[loadRollLog]', e); }
}

async function loadWhipFeed() {
    try {
        const BASE = 'https://api.evanhollander.org/house-floor/api';
        const [floorResp, noticesResp] = await Promise.all([
            fetch(`${BASE}/whip-floor-updates`),
            fetch(`${BASE}/whip-notices-feed`),
        ]);
        const floor   = floorResp.ok   ? (await floorResp.json()).items   || [] : [];
        const notices = noticesResp.ok ? (await noticesResp.json()).items || [] : [];
        applyWhipFeedData({ floor, notices });
    } catch(e) { console.error('[loadWhipFeed]', e); }
}

function applyRollLogToBills(entries, activeRoll) {
    if (!Array.isArray(entries) || !billsData) return;
    const PROCEDURAL = /motion to (commit|recommit|table)|previous question|ordering the previous|motion to refer/i;
    const normalizeBillType = raw => {
        const t = raw.replace(/\s*\.\s*/g, '.').replace(/\s+/g, '').toUpperCase();
        return { 'H':'H.R.','H.':'H.R.',
                 'HR':'H.R.','H.R.':'H.R.','HRES':'H.Res.','H.RES.':'H.Res.',
                 'HJRES':'H.J.Res.','HCONRES':'H.Con.Res.',
                 'S':'S.','S.':'S.','SRES':'S.Res.','S.RES.':'S.Res.',
                 'SJRES':'S.J.Res.','SCONRES':'S.Con.Res.' }[t] || null;
    };
    const matchBillId = q =>
        q.match(/(?:^|\s[-–]\s)(H\.?\s*R\.?|H\.?\s*Res\.?|H\.?\s*J\.?\s*Res\.?|H\.?\s*Con\.?\s*Res\.?|H|S\.?(?:\s*(?:J\.?\s*)?(?:Con\.?\s*)?Res\.?)?)\s+(\d+)/i)
        || q.match(/\b(H\.R\.|H\.Res\.|H\.J\.Res\.|H\.Con\.Res\.|S\.(?:Res\.|J\.Res\.|Con\.Res\.)?)\s*(\d+)/i);
    let changed = false;
    for (const entry of entries) {
        if (activeRoll && String(entry.roll) === activeRoll) continue; // skip active vote
        const q = entry.question || '';

        // Motion to commit/recommit: update the MTR indicator but skip bill passage logic
        if (/motion to (?:re)?commit/i.test(q)) {
            const yeas = entry.totals?.yeas || 0;
            const nays = entry.totals?.nays || 0;
            if (yeas + nays > 0) {
                // Try question string first, then fall back to the dedicated bill field
                let bid = null;
                const qm = matchBillId(q) || (entry.bill ? matchBillId(entry.bill) : null);
                if (qm) {
                    const type = normalizeBillType(qm[1]);
                    if (type) bid = normalizeBillIdForRules(`${type} ${qm[2]}`);
                }
                if (bid) {
                    const existing = motionsToRecommit.get(bid);
                    const status = yeas > nays ? 'passed' : 'failed';
                    if (!existing || existing.status === 'pending' || !existing.type) {
                        const mtrType = /recommit/i.test(q) ? 'recommit' : 'commit';
                        const mtrData = { type: mtrType, status, voteText: `${yeas}-${nays}` };
                        motionsToRecommit.set(bid, mtrData);
                        // Persist onto bill object so it survives proceedings rollover
                        for (const key of ['ruleBills', 'suspensionBills', 'mayBeConsideredBills']) {
                            const bill = (billsData[key] || []).find(b => normalizeBillIdForRules(b.id) === bid);
                            if (bill) { bill.mtr = mtrData; break; }
                        }
                        saveMtrToStorage();
                        changed = true;
                    }
                }
            }
            continue;
        }

        if (PROCEDURAL.test(q)) continue;
        const yeas = entry.totals?.yeas || 0;
        const nays = entry.totals?.nays || 0;
        if (yeas + nays === 0) continue;
        const qm = matchBillId(q);
        if (!qm) continue;
        const type = normalizeBillType(qm[1]);
        if (!type) continue;
        const billId = `${type} ${qm[2]}`;
        const isSuspension = /suspend/i.test(q);
        const required = isSuspension ? Math.ceil((yeas + nays) * 2 / 3) : Math.floor((yeas + nays) / 2) + 1;
        const passed = yeas >= required;
        for (const key of ['ruleBills', 'suspensionBills', 'mayBeConsideredBills']) {
            const bill = (billsData[key] || []).find(b => b.id === billId);
            if (bill && bill.status !== 'passed' && bill.status !== 'failed') {
                bill.status = passed ? 'passed' : 'failed';
                bill.latestAction = passed ? `Passed (Roll Call ${entry.roll}): ${yeas}-${nays}` : `Failed (Roll Call ${entry.roll}): ${yeas}-${nays}`;
                changed = true;
            }
        }
        // Also handle H.Res. rule passage
        if (/^H\.Res\.\s*\d+$/i.test(billId)) {
            const hresNum = billId.match(/(\d+)/)?.[1];
            if (hresNum) {
                for (const e of specialRulesMap.values()) {
                    if (String(e.hresNum) === String(hresNum) && e.ruleStatus !== 'passed' && e.ruleStatus !== 'failed') {
                        e.ruleStatus = passed ? 'passed' : 'failed';
                        e.passageVote = `${yeas}-${nays}`;
                        changed = true;
                    }
                }
            }
        }
    }
    if (changed) updateBillsDisplay();
}

// ─────────────────────────────────────────────────────────────────────────────

// SSE streaming state
let sseConnection = null;
let isStreaming = false;
let lastSseTallyAt  = 0;   // ms timestamp of last vote.tally received (for stale detection)
let lastFloorSseAt  = 0;   // ms timestamp of last event: floor received from DO
let _lastVoteAbsences = null;  // { d, r, roll, question } — committed when vote ends
let _stagedVoteAbsences = null; // staging: updated every tally, never shown directly
let _wasInVote = false;         // tracks vote→non-vote transition
let lastSseReconnectAt = 0; // ms timestamp of last watchdog-forced reconnect (loop guard only)
let sseReconnectCount = 0; // how many times we've reconnected to the SSE endpoint
let lastFloorPollAt   = 0; // ms timestamp of last REST floor poll (for countdown display)

// ── Connection dashboard tooltip ──────────────────────────────────────────────
(function initConnectionDashboard() {
    const trigger   = document.getElementById('brand-trigger');
    const dashboard = document.getElementById('connection-dashboard');
    if (!trigger || !dashboard) return;

    const $ = (id) => document.getElementById(id);
    let tickInterval  = null;
    let hideTimer     = null;
    let workerStatus  = null; // cached from last /status fetch
    const POLL_MS     = () => window._pollModeState?.intervalMs || 10_000; // mirrors server adaptive interval

    function badge(cls, text) {
        return `<span class="conn-dash-badge ${cls}">${text}</span>`;
    }

    function ago(ms) {
        if (!ms) return '—';
        const s = Math.round((Date.now() - ms) / 1000);
        if (s < 5)  return 'just now';
        if (s < 60) return `${s}s ago`;
        const m = Math.floor(s / 60);
        return `${m}m ${s % 60}s ago`;
    }

    function isoAgo(iso) {
        if (!iso) return '—';
        return ago(new Date(iso).getTime());
    }

    function render() {
        // ── Your browser ──────────────────────────────────────────────────────
        const rs     = sseConnection ? sseConnection.readyState : -1;
        const isLive = rs === EventSource.OPEN;
        const isConn = rs === EventSource.CONNECTING;

        const dot = $('cd-dot');
        if (dot) {
            dot.className = 'conn-dash-dot ' +
                (isLive ? 'state-live' : isConn ? 'state-connecting' : 'state-error');
        }
        const statusEl = $('cd-status');
        if (statusEl) {
            statusEl.textContent = isLive ? 'Live stream active' : isConn ? 'Connecting…' : 'Disconnected';
        }

        const streamEl = $('cd-stream');
        if (streamEl) {
            streamEl.innerHTML = isLive ? badge('green', 'SSE connected') :
                                 isConn ? badge('amber', 'connecting') :
                                          badge('red', 'disconnected');
        }

        const lastDataEl = $('cd-last-data');
        if (lastDataEl) {
            const dataTs = floorData?.lastUpdated ? floorData.lastUpdated.getTime() : 0;
            lastDataEl.textContent = dataTs ? ago(dataTs) : '—';
        }

        const reconnEl = $('cd-reconnects');
        if (reconnEl) reconnEl.textContent = sseReconnectCount === 0 ? 'none' : String(sseReconnectCount);

        // ── Worker (server) ───────────────────────────────────────────────────
        const ws = workerStatus;
        const upstreamEl = $('cd-upstream');
        if (upstreamEl) {
            upstreamEl.innerHTML = ws == null ? '—' :
                ws.upstreamConnected ? badge('green', 'connected') : badge('red', 'disconnected');
        }

        const clientsEl = $('cd-clients');
        if (clientsEl) {
            if (ws == null) { clientsEl.textContent = '—'; }
            else {
                const n = ws.connectedClients ?? '?';
                clientsEl.textContent = `${n} browser${n !== 1 ? 's' : ''}`;
            }
        }

        const srvReconnEl = $('cd-srv-reconnects');
        if (srvReconnEl) {
            if (ws == null) { srvReconnEl.textContent = '—'; }
            else {
                const n = ws.upstreamReconnects ?? 0;
                srvReconnEl.textContent = n === 0 ? 'none' : String(n);
            }
        }

        const lastEventEl = $('cd-last-event');
        if (lastEventEl) lastEventEl.textContent = ws?.lastEventAt ? isoAgo(ws.lastEventAt) : '—';

        // ── Floor ─────────────────────────────────────────────────────────────
        const floorStatusEl = $('cd-floor-status');
        if (floorStatusEl) {
            const val  = floorData?.currentStatus?.value || '';
            const text = floorData?.currentStatus?.text  || val || '—';
            floorStatusEl.innerHTML = val ? badge('blue', text) : '—';
        }

        // Poll mode indicator
        const pollModeEl = $('cd-poll-mode');
        if (pollModeEl) {
            const pm = window._pollModeState;
            if (!pm) {
                pollModeEl.textContent = '—';
            } else {
                const interval = pm.fast ? '10s / 5s' : '3m';
                const reasonLabel = pm.reason === 'schedule'
                    ? (pm.fast ? 'business hours' : 'after hours')
                    : pm.reason.replace(/_/g, ' ');
                pollModeEl.innerHTML = pm.fast
                    ? badge('green', `FAST · ${interval}`) + ` <small style="opacity:.6">${reasonLabel}</small>`
                    : badge('amber', `SLOW · ${interval}`) + ` <small style="opacity:.6">${reasonLabel}</small>`;
            }
        }

        // Countdown to next REST poll
        const countdownEl = $('cd-next-poll');
        if (countdownEl) {
            if (!lastFloorPollAt) {
                countdownEl.textContent = '—';
            } else {
                const elapsed = Date.now() - lastFloorPollAt;
                const remaining = Math.max(0, Math.ceil((POLL_MS() - elapsed) / 1000));
                countdownEl.textContent = remaining === 0 ? 'now…' : `${remaining}s`;
            }
        }
    }

    function fetchWorkerStatus() {
        fetch('https://api.evanhollander.org/house-floor/api/stream/votes/current/status')
            .then(r => r.ok ? r.json() : null)
            .then(data => { workerStatus = data; render(); })
            .catch(() => {});
    }

    function cancelHide() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }

    function scheduleHide() {
        cancelHide();
        // Small delay so cursor can cross the gap between trigger and panel
        hideTimer = setTimeout(() => {
            dashboard.classList.remove('visible');
            dashboard.setAttribute('aria-hidden', 'true');
            clearInterval(tickInterval);
            tickInterval = null;
            workerStatus = null;
        }, 120);
    }

    function show() {
        cancelHide();
        if (dashboard.classList.contains('visible')) return; // already open
        dashboard.classList.add('visible');
        dashboard.setAttribute('aria-hidden', 'false');
        fetchWorkerStatus();
        render();
        tickInterval = setInterval(render, 1000);
    }

    trigger.addEventListener('mouseenter', show);
    trigger.addEventListener('mouseleave', scheduleHide);
    dashboard.addEventListener('mouseenter', cancelHide);
    dashboard.addEventListener('mouseleave', scheduleHide);

    // Keyboard: toggle on Enter/Space, close on Escape
    trigger.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            dashboard.classList.contains('visible') ? scheduleHide() : show();
        } else if (e.key === 'Escape') {
            scheduleHide();
            trigger.focus();
        }
    });

    // Keep aria-expanded in sync
    const observer = new MutationObserver(() => {
        trigger.setAttribute('aria-expanded', dashboard.classList.contains('visible') ? 'true' : 'false');
    });
    observer.observe(dashboard, { attributes: true, attributeFilter: ['class'] });
})();
// ── End connection dashboard ──────────────────────────────────────────────────

// ── Vote countdown timer ──────────────────────────────────────────────────────
// The DomeWatch SSE sends timer.value ("MM:SS") every ~1s.
// We record that value + the moment we received it, then interpolate locally
// at 500ms so the display is smooth between server ticks and self-corrects on
// the next tick.
const voteTimer = {
    interval: null,      // setInterval handle
    seconds: 0,          // parsed seconds from last server sync
    syncedAt: 0,         // Date.now() at last server sync
    openedAt: null,      // timer.timestamp (when the vote clock was opened)
};

const VOTE_OVERTIME_KEY = 'voteOvertimeStartedAt'; // sessionStorage key

function syncVoteTimer(timerData) {
    if (!timerData?.value) return;
    const parts = timerData.value.split(':').map(Number);
    if (parts.length !== 2 || parts.some(isNaN)) return;
    const newSeconds = parts[0] * 60 + parts[1];

    if (newSeconds === 0) {
        // During overtime DomeWatch sets timestamp = the exact moment the clock hit 0.
        // Use it directly so late joiners and refreshes both get the correct duration.
        const serverExpiry = timerData.timestamp ? new Date(timerData.timestamp).getTime() : 0;
        const stored       = sessionStorage.getItem(VOTE_OVERTIME_KEY);
        const anchor       = serverExpiry || (stored ? parseInt(stored, 10) : 0) || Date.now();
        voteTimer.syncedAt = anchor;
        voteTimer.seconds  = 0;
        // Keep sessionStorage in sync as a fallback for when timestamp isn't available
        if (!stored || parseInt(stored, 10) !== anchor) {
            sessionStorage.setItem(VOTE_OVERTIME_KEY, String(anchor));
        }
    } else {
        // Normal countdown — clear any stale overtime anchor
        sessionStorage.removeItem(VOTE_OVERTIME_KEY);
        voteTimer.seconds  = newSeconds;
        voteTimer.syncedAt = Date.now();
    }

    // Only update openedAt during countdown — in overtime, DomeWatch repurposes
    // timestamp to mean "moment the clock hit 0", not "when the vote opened".
    // Preserving the last countdown value keeps the OPENED label correct.
    if (newSeconds > 0) {
        voteTimer.openedAt = timerData.timestamp || null;
    }
    if (!voteTimer.interval) {
        voteTimer.interval = setInterval(tickVoteTimer, 100);
    }
}

function tickVoteTimer() {
    const elapsedMs = Date.now() - voteTimer.syncedAt;
    const totalMs   = voteTimer.seconds * 1000 - elapsedMs; // negative = overtime
    const overtime  = totalMs < 0;
    const absMs     = Math.abs(totalMs);
    const mm        = Math.floor(absMs / 60000);
    const ss        = Math.floor((absMs % 60000) / 1000);
    const cs        = Math.floor((absMs % 1000) / 10); // centiseconds (2 digits)
    const display   = (overtime ? '+' : '')
                    + `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;

    const el = document.getElementById('last-update');
    if (el) {
        el.className = 'vote-timer-value';
        if (overtime)              el.classList.add('overtime');
        else if (totalMs < 60000)  el.classList.add('warning');
        else                       el.classList.add('active');
        el.textContent = display;
    }

    // Drive SVG timer arc — fills from 0→full as 15-min constitutional floor elapses
    const arcFill = document.getElementById('vta-fill');
    if (arcFill) {
        const CIRC = 125.66; // 2π × r=20
        const progress = overtime
            ? 1
            : Math.max(0, Math.min(1, 1 - totalMs / 900000));
        arcFill.style.strokeDashoffset = String((CIRC * (1 - progress)).toFixed(2));
        arcFill.style.stroke = overtime
            ? 'var(--accent-red)'
            : totalMs < 60000
                ? 'var(--accent-amber)'
                : 'var(--accent-green)';
    }
    // Don't clear — keep running in overtime until the 30s REST poll confirms vote ended
}

function clearVoteTimer() {
    if (voteTimer.interval) {
        clearInterval(voteTimer.interval);
        voteTimer.interval = null;
    }
    voteTimer.seconds  = 0;
    voteTimer.syncedAt = 0;
    sessionStorage.removeItem(VOTE_OVERTIME_KEY);
}
// ─────────────────────────────────────────────────────────────────────────────

// Fast-path vote count update — called on every SSE tick, touches only the count
// DOM elements. Keeps the numbers in sync without triggering the full render.
// Flip-clock digit animator — animates only the digit places that changed.
// e.g. 68→69 flips only the last digit; 69→70 flips both; 9→10 flips all.
function flipToNumber(el, newVal) {
    const newStr = (newVal === null || newVal === undefined)
        ? '--'
        : String(Math.max(0, parseInt(newVal) || 0));
    const oldStr = el.dataset.flipVal || '';
    if (oldStr === newStr) return;
    el.dataset.flipVal = newStr;

    const FLIP_MS = 180;

    // First render or to/from placeholder — no animation, just build structure
    if (!oldStr || oldStr.includes('-') || newStr.includes('-')) {
        el.innerHTML = [...newStr].map(ch =>
            `<span class="flip-digit"><span class="flip-digit-char">${ch}</span></span>`
        ).join('');
        return;
    }

    if (oldStr.length === newStr.length) {
        // Same digit count — animate only changed positions
        const digitEls = el.querySelectorAll('.flip-digit');
        [...newStr].forEach((newCh, i) => {
            if (newCh === oldStr[i]) return;
            const wrapper = digitEls[i];
            const oldSpan = wrapper.querySelector('.flip-digit-char:not(.exiting)');
            if (!oldSpan) return;
            oldSpan.classList.add('exiting');
            oldSpan.addEventListener('animationend', () => oldSpan.remove(), { once: true });
            const newSpan = document.createElement('span');
            newSpan.className = 'flip-digit-char entering';
            newSpan.textContent = newCh;
            wrapper.appendChild(newSpan);
            newSpan.addEventListener('animationend', () => newSpan.classList.remove('entering'), { once: true });
        });
    } else {
        // Digit count changed — exit ALL old digits, then enter ALL new digits
        el.querySelectorAll('.flip-digit-char:not(.exiting)').forEach(span => span.classList.add('exiting'));
        setTimeout(() => {
            el.innerHTML = [...newStr].map(ch =>
                `<span class="flip-digit"><span class="flip-digit-char entering">${ch}</span></span>`
            ).join('');
            el.querySelectorAll('.flip-digit-char.entering').forEach(s =>
                s.addEventListener('animationend', () => s.classList.remove('entering'), { once: true })
            );
        }, FLIP_MS);
    }
}

function updateVoteCountsDisplay(counts) {
    if (!counts) return;
    const totals = counts.totals || {};
    const iv = v => Math.max(parseInt(v) || 0, 0);
    const yeas    = iv(totals.yeas);
    const nays    = iv(totals.nays);
    const present = iv(totals.present);
    const notVoting = iv(totals.not_voting);
    const totalVotes = yeas + nays + present;

    if (elements.yeasCount)    flipToNumber(elements.yeasCount,    yeas);
    if (elements.naysCount)    flipToNumber(elements.naysCount,    nays);
    if (elements.presentCount) flipToNumber(elements.presentCount, present);
    if (elements.totalVotes)   elements.totalVotes.textContent   = totalVotes > 0 ? `Total: ${(yeas + nays + present + notVoting).toLocaleString()}` : 'Total: --';

    if (totalVotes > 0) {
        const yPct = yeas    / totalVotes * 100;
        const nPct = nays    / totalVotes * 100;
        const pPct = present / totalVotes * 100;
        if (elements.yeasPercent)    elements.yeasPercent.textContent    = `${yPct.toFixed(1)}%`;
        if (elements.naysPercent)    elements.naysPercent.textContent    = `${nPct.toFixed(1)}%`;
        if (elements.presentPercent) elements.presentPercent.textContent = `${pPct.toFixed(1)}%`;
        if (elements.yeasBar)    elements.yeasBar.style.width    = `${yPct}%`;
        if (elements.naysBar)    elements.naysBar.style.width    = `${nPct}%`;
        if (elements.presentBar) elements.presentBar.style.width = `${pPct}%`;
    }

    // Bold whichever side is leading
    if (elements.yeasCount && elements.naysCount) {
        elements.yeasCount.style.fontWeight = yeas > nays ? 'bold' : 'normal';
        elements.naysCount.style.fontWeight = nays > yeas ? 'bold' : 'normal';
    }

    // Stage D/R absences — only committed to _lastVoteAbsences when the vote ends,
    // so mid-vote "not_voting" (people who haven't cast yet) never pollutes the display.
    const blue = counts.blue || {};
    const red  = counts.red  || {};

    // Party breakdown under yeas/nays
    const white = counts.white || {};
    const dY = Math.max(parseInt(blue.yeas)  || 0, 0);
    const rY = Math.max(parseInt(red.yeas)   || 0, 0);
    const iY = Math.max(parseInt(white.yeas) || 0, 0);
    const dN = Math.max(parseInt(blue.nays)  || 0, 0);
    const rN = Math.max(parseInt(red.nays)   || 0, 0);
    const iN = Math.max(parseInt(white.nays) || 0, 0);
    if (elements.yeasD) elements.yeasD.innerHTML = `${dY}<span class="cpb-suffix">D</span>`;
    if (elements.yeasR) elements.yeasR.innerHTML = `${rY}<span class="cpb-suffix">R</span>`;
    if (elements.yeasI) { elements.yeasI.innerHTML = `${iY}<span class="cpb-suffix">I</span>`; elements.yeasI.style.display = iY > 0 ? '' : 'none'; }
    if (elements.naysD) elements.naysD.innerHTML = `${dN}<span class="cpb-suffix">D</span>`;
    if (elements.naysR) elements.naysR.innerHTML = `${rN}<span class="cpb-suffix">R</span>`;
    if (elements.naysI) { elements.naysI.innerHTML = `${iN}<span class="cpb-suffix">I</span>`; elements.naysI.style.display = iN > 0 ? '' : 'none'; }

    // "X not yet voted" contextual label
    const notYetEl = document.getElementById('vote-not-yet');
    if (notYetEl) {
        if (notVoting > 0) {
            notYetEl.textContent = `${notVoting} not yet voted`;
            notYetEl.hidden = false;
        } else {
            notYetEl.hidden = true;
        }
    }

    const dNV = Math.max(parseInt(blue.not_voting) || 0, 0);
    const rNV = Math.max(parseInt(red.not_voting)  || 0, 0);
    _stagedVoteAbsences = {
        d: dNV,
        r: rNV,
        i: Math.max(notVoting - dNV - rNV, 0),
        roll: floorData.rollCall?.number || null,
        question: floorData.rollCall?.question || null,
    };

    // Update floor grid with party breakdown (fast DOM, no network)
    const ivf  = v => Math.max(parseInt(v) || 0, 0);
    state.data = {
        vote: {
            yeas, nays, present, not_voting: notVoting, total: totalVotes,
            votesNeeded: getVotesNeeded(/suspend/i.test(floorData.rollCall?.question || '')),
            dem: { yeas: ivf(blue.yeas), nays: ivf(blue.nays), present: ivf(blue.present) },
            rep: { yeas: ivf(red.yeas),  nays: ivf(red.nays),  present: ivf(red.present)  },
        }
    };
    updateFloorGrid();
    // Refresh vote-series timeline circles on every tally tick
    updateVoteTimelineStatus();
}

function updateLastVoteAbsencesDisplay() {
    if (!_lastVoteAbsences || !elements.lastVoteAbsences) return;
    elements.lastVoteDAbsent.textContent = _lastVoteAbsences.d;
    elements.lastVoteRAbsent.textContent = _lastVoteAbsences.r;
    if (elements.lastVoteIAbsent) elements.lastVoteIAbsent.textContent = _lastVoteAbsences.i ?? 0;
    if (elements.lastVoteLabel) {
        const roll = _lastVoteAbsences.roll ? `Roll Call ${_lastVoteAbsences.roll}` : '';
        elements.lastVoteLabel.textContent = roll;
    }
    elements.lastVoteAbsences.style.display = '';
}

// SSE Streaming for real-time updates
function startSSEStreaming() {
    if (isStreaming) return;
    
    try {
        isStreaming = true;
        
        // Use worker proxy for SSE streaming to avoid CORS issues
        const eventSource = new EventSource('https://api.evanhollander.org/house-floor/api/stream/votes/current');
        
        // Show connecting state initially
        const liveIndicator = document.querySelector('.live-indicator');
        if (liveIndicator) {
            liveIndicator.classList.add('connecting');
            liveIndicator.classList.remove('live');
        }
        
        eventSource.onopen = () => {
            const liveIndicator = document.querySelector('.live-indicator');
            if (liveIndicator) {
                liveIndicator.classList.add('live');
                liveIndicator.classList.remove('connecting');
            }
            // REST fallback: load roll-log and whip-feed directly so vote-series
            // absences and timeline are available even if DO polling is delayed.
            loadRollLog();
            loadWhipFeed();
        };

        // DomeWatch sends named events — onmessage only fires for unnamed events,
        // so we must use addEventListener for each event type.

        // vote.tally: real-time tally during an active roll call vote
        // Data shape: { tickAt, vote: { counts, roll_call, timer } }
        // Throttled full render — at most once per 2 seconds from SSE ticks
        let sseRenderPending = false;
        const scheduleFullRender = () => {
            if (sseRenderPending) return;
            sseRenderPending = true;
            setTimeout(() => { sseRenderPending = false; updateFloorDisplay(); }, 2000);
        };

        eventSource.addEventListener('vote.tally', (event) => {
            try {
                const data = JSON.parse(event.data);
                const v = data.vote || {};
                // Ignore DomeWatch test votes
                if (/test vote/i.test(v.roll_call?.question || '')) return;
                lastSseTallyAt = Date.now(); // track liveness for stale watchdog
                floorData = {
                    ...floorData,
                    lastUpdated: new Date(),
                    currentStatus: { value: 'vote' },
                    rollCall: v.roll_call || floorData.rollCall,
                    voteCounts: v.counts || floorData.voteCounts,
                    timer: v.timer || floorData.timer,
                };
                syncVoteTimer(v.timer);
                // Hot path: update count numbers immediately every tick.
                // Use floorData.voteCounts (already has v.counts || old fallback) so a
                // tally event with empty/null counts never flashes 0-0-0.
                updateVoteCountsDisplay(floorData.voteCounts);
                // Slow path: full re-render throttled to 2s (floor grid etc.)
                scheduleFullRender();
            } catch (error) {
                console.error('Error parsing SSE vote.tally:', error);
            }
        });

        // connected: initial handshake — no data to process, just confirms stream is live
        eventSource.addEventListener('connected', (event) => {
            // Start pinging the DO every 45s so it can detect and evict zombie connections.
            try {
                const { clientId } = JSON.parse(event.data);
                if (clientId) {
                    const pingUrl = `https://api.evanhollander.org/house-floor/api/stream/votes/current?ping=${encodeURIComponent(clientId)}`;
                    const sendPing = () => fetch(pingUrl, { method: 'POST' }).catch(() => {});
                    sendPing();
                    const pingInterval = setInterval(sendPing, 90_000);
                    eventSource.addEventListener('error', () => clearInterval(pingInterval), { once: true });
                }
            } catch {}
        });

        // Proceedings pushed from DO every 5s — replaces per-client REST polling
        eventSource.addEventListener('proceedings', (event) => {
            try {
                const data = JSON.parse(event.data);
                if (Array.isArray(data.items)) {
                    proceedingsData = data.items;
                    renderProceedingsFeedPanel(data.items); // update the visible panel
                    autoSwitchModeFromProceedings(data.items);
                    updateBillStatusFromProceedings(data.items);
                    if (updateMotionsToRecommit(data.items)) updateBillsDisplay();
                    updateDebateSection(data.items);
                    updatePrayerSection(data.items);
                    updateSilenceSection(data.items);
                    updatePledgeSection(data.items);
                    updateSpeakerSection(data.items);
                    updateCommitteeChairSection(data.items);
                    updateJournalSection(data.items);
                    updateOathSection(data.items);
                    updateMessageSection(data.items);
                    updateCertElectionSection(data.items);
                    updateCertElectoralSection(data.items);
                    updateSineDieSection(data.items);
                }
            } catch {}
        });

        // All data pushed from DO — one shared fetch for all connected clients
        eventSource.addEventListener('floor', (event) => {
            try {
                const data = JSON.parse(event.data);
                lastFloorSseAt = Date.now();
                applyFloorData(data);
            } catch {}
        });
        eventSource.addEventListener('bills', (event) => {
            try { applyBillsData(JSON.parse(event.data)); } catch {}
        });
        eventSource.addEventListener('tweets', (event) => {
            try { fetchTweets(JSON.parse(event.data)); } catch {}
        });
        eventSource.addEventListener('airportdelays', (event) => {
            try { fetchAirportDelays(JSON.parse(event.data)); } catch {}
        });
        eventSource.addEventListener('housemakeup', (event) => {
            try { fetchHouseMakeup(JSON.parse(event.data)); } catch {}
        });
        eventSource.addEventListener('poll-mode', (event) => {
            try { window._pollModeState = JSON.parse(event.data); } catch {}
        });
        eventSource.addEventListener('whip-feed', (event) => {
            try { applyWhipFeedData(JSON.parse(event.data)); } catch {}
        });
        eventSource.addEventListener('roll-log', (event) => {
            try { applyRollLogData(JSON.parse(event.data).entries); } catch {}
        });
        eventSource.addEventListener('casualty-list', (event) => {
            try { applyCasualtyData(JSON.parse(event.data)); } catch {}
        });

        // Fallback for any unnamed default messages
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Map REST-style shape if present
                floorData = {
                    ...floorData,
                    lastUpdated: new Date(),
                    currentStatus: data.now || floorData.currentStatus,
                    rollCall: data.roll_call || floorData.rollCall,
                    voteCounts: data.votes?.counts || floorData.voteCounts,
                    timer: data.timer || floorData.timer,
                    timeline: data.timeline || floorData.timeline
                };
                updateFloorDisplay();
            } catch (error) {
                console.error('Error parsing SSE data:', error);
            }
        };

        eventSource.onerror = (error) => {
            console.error('SSE error:', error);
            // Close the broken connection so the browser stops auto-reconnecting it;
            // we manage reconnects ourselves to avoid duplicate connections.
            eventSource.close();
            if (sseConnection === eventSource) sseConnection = null;
            isStreaming = false;
            sseReconnectCount++;
            const liveIndicator = document.querySelector('.live-indicator');
            if (liveIndicator) {
                liveIndicator.classList.remove('live');
                liveIndicator.classList.add('connecting');
            }
            // Retry SSE after 5s rather than permanently falling back to polling
            setTimeout(() => {
                if (!isStreaming) {
                    startSSEStreaming();
                }
            }, 5000);
        };
        
        sseConnection = eventSource;
        
    } catch (error) {
        console.error('Failed to start SSE streaming:', error);
        isStreaming = false;
        // Fall back to polling
        fetchFloorData();
    }
}

// Fetch DomeWatch Floor Data (fallback)
// Process a floor state payload — called by both the SSE event: floor handler
// and the fallback fetchFloorData() REST fetch. All transition logic lives here.
function applyFloorData(data) {
    lastFloorPollAt = Date.now();

    if (!data || data.error) {
        updateFloorDisplay('error');
        return;
    }

    // Detect vote → non-vote transition BEFORE overwriting floorData,
    // so reconcileVoteWithBills can still read the last roll call + counts.
    const nowInVote = data.now?.value === 'vote' || data.now?.value === 'voting';
    if (_wasInVote && !nowInVote) {
        reconcileVoteWithBills(true); // force=true: bypass the in-vote guard
    }

    // During an active vote, the DomeWatch tally SSE delivers live counts every ~1s
    // while the floor REST is cached up to 10s — using stale REST counts would snap
    // the display backwards. Keep SSE-sourced voteCounts when the stream is fresh.
    const sseRecentlyTallied = lastSseTallyAt > 0 && (Date.now() - lastSseTallyAt) < 15_000;
    floorData = {
        lastUpdated: new Date(),
        currentStatus: data.now,
        rollCall: data.roll_call,
        voteCounts: sseRecentlyTallied ? (floorData.voteCounts || data.votes?.counts) : data.votes?.counts,
        timer: data.timer,
        timeline: data.timeline
    };

    if (_wasInVote && !nowInVote && _stagedVoteAbsences) {
        // Only commit absences if this was a substantive vote (≥150 yea/nay, non-procedural).
        const vc = floorData.voteCounts || {};
        const t  = vc.totals || {};
        const stagedTotal = (parseInt(t.yeas) || 0) + (parseInt(t.nays) || 0);
        const stagedQ = (_stagedVoteAbsences.question || '').toLowerCase();
        const stagedIsSubstantive = stagedTotal >= 150 &&
            !/motion to (commit|recommit|table)|previous question|ordering the previous/i.test(stagedQ);
        if (stagedIsSubstantive) {
            _lastVoteAbsences = { ..._stagedVoteAbsences };
            updateLastVoteAbsencesDisplay();
        }
    }
    _wasInVote = nowInVote;

    if (!nowInVote) clearVoteTimer();

    // Update vote map state
    if (floorData.voteCounts) {
        const t = floorData.voteCounts.totals || {};
        const d = floorData.voteCounts.blue  || {};
        const r = floorData.voteCounts.red   || {};
        const iv = v => Math.max(parseInt(v) || 0, 0);
        state.data = {
            vote: {
                yeas: iv(t.yeas), nays: iv(t.nays), present: iv(t.present), not_voting: iv(t.not_voting),
                dem: { yeas: iv(d.yeas), nays: iv(d.nays), present: iv(d.present) },
                rep: { yeas: iv(r.yeas), nays: iv(r.nays), present: iv(r.present) },
                title: floorData.rollCall?.question || 'Loading...',
                id: floorData.rollCall?.number || '--',
                date: floorData.rollCall?.bill?.considered_on || null,
                votesNeeded: getVotesNeeded(/suspend/i.test(floorData.rollCall?.question || ''))
            }
        };
    }

    updateAbsenteeTracking();
    updateQuorumStatus();
    updateBillsDisplay();
    updateFloorGrid();
    updateFloorDisplay();
}

// Fetch floor data directly — used for initial page load and as SSE fallback.
// Under normal operation the DO pushes event: floor every 5s; this only fires
// when the SSE stream hasn't delivered a floor event recently.
async function fetchFloorData(silent = false) {
    try {
        if (!silent && elements.voteTitle) {
            elements.voteTitle.textContent = 'FETCHING...';
        }
        const response = await fetch(DOMEWATCH_CONFIG.workerUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        applyFloorData(data);
    } catch (error) {
        console.error('Fetch floor data failed:', error);
        updateFloorDisplay('error');
    }
}

// Returns the billDataMap entry matching the current roll call vote, or null.
// Used to show/hide the VIEW BILL button during votes.
// DomeWatch question format: "H R 8464 - On Passage" or "H Res 100 - On Agreeing"
// (space-separated, no dots) — same format reconcileVoteWithBills expects.
function findBillForCurrentVote() {
    if (!floorData?.rollCall?.question || !billDataMap.size) return null;
    const q = floorData.rollCall.question;
    // Skip procedural votes that don't map to a bill card
    if (/motion to (commit|recommit|table)|previous question|ordering the previous|motion to refer|quorum/i.test(q)) return null;

    // Normalize "HR", "H R", "H.R.", "H. R." etc → canonical key via same map used elsewhere
    const normType = raw => {
        const t = raw.replace(/\s*\.\s*/g, '.').replace(/\s+/g, '').toUpperCase();
        return { 'HR':'H.R.','H.R.':'H.R.','H':'H.R.',
                 'HRES':'H.Res.','H.RES.':'H.Res.',
                 'HJRES':'H.J.Res.','H.J.RES.':'H.J.Res.',
                 'HCONRES':'H.Con.Res.','H.CON.RES.':'H.Con.Res.',
                 'S':'S.','S.':'S.',
                 'SRES':'S.Res.','S.RES.':'S.Res.',
                 'SJRES':'S.J.Res.','SCONRES':'S.Con.Res.' }[t] || null;
    };

    // Match both dotted ("H.R. 8464") and DomeWatch space-separated ("H R 8464", "H 8464") formats
    const m = q.match(/(?:^|\s-\s|\s)(H\.?R\.?|H\.?\s*(?:J\.?\s*)?(?:Con\.?\s*)?Res\.?|H|S\.?(?:\s*(?:J\.?\s*)?(?:Con\.?\s*)?Res\.?)?|S)\s+(\d+)/i);
    if (!m) return null;

    const type = normType(m[1]);
    if (!type) return null;
    const billId = `${type} ${m[2]}`;

    let bill = billDataMap.get(billId);
    if (bill) return bill;

    // H.Res. may be stored as hres-XXXX
    if (type === 'H.Res.') {
        bill = billDataMap.get(`hres-${m[2]}`);
        if (bill) return bill;
    }

    // Last-resort: normalized key scan
    for (const [key, val] of billDataMap) {
        if (/^hres-/.test(key)) continue;
        if (key.replace(/\s+/g, ' ').trim() === billId) return val;
    }
    return null;
}

// Show/hide the VIEW BILL button based on whether there's a matching bill card.
// Called from both updateFloorDisplay (floor state changes) and updateBillsDisplay
// (bills load) so the button appears as soon as either piece of data is ready.
function syncVoteBillBtn() {
    if (!elements.voteBillBtn) return;
    const bill = findBillForCurrentVote();
    if (bill) {
        elements.voteBillBtn.dataset.billId = bill.id;
        elements.voteBillBtn.style.display = '';
    } else {
        elements.voteBillBtn.style.display = 'none';
        delete elements.voteBillBtn.dataset.billId;
    }
}

// Update Floor Display with DomeWatch Data
function updateFloorDisplay(status = null) {
    if (status === 'error') {
        // Don't overwrite live vote data with an error message — just silently skip.
        // The SSE stream is still updating tallies; a transient REST error is not user-facing.
        return;
    }

    if (!floorData.currentStatus) return;

    
    // Update session status based on DomeWatch data
    const statusText = floorData.currentStatus.text || 'Unknown';
    const statusValue = floorData.currentStatus.value || 'unknown';
    
    // Auto-switch mode based on DomeWatch status.
    // REST API returns value "voting"; SSE handler sets value "vote" — handle both.
    // Switch INTO vote mode whenever REST says so (don't require SSE — SSE may be slow
    // to connect on page load, leaving the app stuck in debate mode during a live vote).
    // Switch OUT of vote mode only when REST says non-vote AND SSE has gone quiet (>90s),
    // so stale cached REST data can't snap us out of vote mode while tallies still flow.
    const statusLower = (statusText + ' ' + statusValue).toLowerCase();
    const sseIsLive = lastSseTallyAt > 0 && (Date.now() - lastSseTallyAt) < 90_000;
    const restSaysVote = statusLower.includes('vote') || statusLower.includes('voting');
    const isTestVote = /test vote/i.test(floorData.rollCall?.question || '');
    if (!window._modeLocked) {
        if (restSaysVote && !isTestVote) {
            window.setMode('vote');
        } else if (!sseIsLive && statusLower.includes('debate')) {
            window.setMode('debate');
        } else if (!sseIsLive && (statusLower.includes('adjourn') || statusLower.includes('recess'))) {
            window.setMode('recess');
        }
    }

    // Update floor status with house adjournment information
    if (elements.floorStatus) {
        elements.floorStatus.textContent = statusText;
    }
    
    // Update vote title - show roll call question with title below
    if (elements.voteTitle && floorData.rollCall && floorData.rollCall.question) {
        const question = floorData.rollCall.question;
        const title = floorData.rollCall.bill?.title || '';
        
        if (title) {
            elements.voteTitle.textContent = '';
            const sub = document.createElement('span');
            sub.style.cssText = 'font-weight:300;opacity:0.8';
            sub.textContent = title;
            elements.voteTitle.append(question, document.createElement('br'), sub);
        } else {
            elements.voteTitle.textContent = question;
        }
    }

    // Update vote ID with roll call info if available
    if (elements.voteId && floorData.rollCall) {
        const rollCallNumber = floorData.rollCall.number || '';
        if (rollCallNumber) {
            elements.voteId.textContent = `Roll Call ${rollCallNumber}`;
        } else {
            elements.voteId.textContent = 'Roll Call --';
        }
        updateVoteTypeTag(floorData.rollCall.question);
    }

    // Show VIEW BILL button IFF the current vote maps to a bill card
    syncVoteBillBtn();

    // Update vote counts if available
    if (floorData.voteCounts && elements.yeasCount && elements.naysCount && elements.presentCount) {
        const totals = floorData.voteCounts.totals || {};
        const yeas = parseInt(totals.yeas) || 0;
        const nays = parseInt(totals.nays) || 0;
        const present = parseInt(totals.present) || 0;
        const notVoting = parseInt(totals.not_voting) || 0;
        const totalVotes = yeas + nays + present; // Exclude Not Voting from progress bar
        const totalVotesWithNotVoting = yeas + nays + present + notVoting; // For display purposes

        // updateVoteCountsDisplay handles all count/percent/bar DOM writes
        updateVoteCountsDisplay(floorData.voteCounts);

        // Update state for floor grid — include per-party breakdown if available
        const iv = v => Math.max(parseInt(v) || 0, 0);
        const blue = floorData.voteCounts.blue || {};
        const red  = floorData.voteCounts.red  || {};
        state.data = {
            vote: {
                yeas, nays, present,
                not_voting: notVoting,
                total: totalVotes,
                votesNeeded: getVotesNeeded(/suspend/i.test(floorData.rollCall?.question || '')),
                dem: { yeas: iv(blue.yeas), nays: iv(blue.nays), present: iv(blue.present) },
                rep: { yeas: iv(red.yeas),  nays: iv(red.nays),  present: iv(red.present)  },
            }
        };
        updateThresholdAnalysis();
        // updateFloorGrid() is called from updateVoteCountsDisplay() on every SSE tick
        // and from fetchFloorData() on the 30s poll — not needed here.

        // updateQuorumStatus() makes a network request — run it only from the 30s REST
        // poll (fetchFloorData), not on every SSE tick.
    }

    // Countdown display is handled by tickVoteTimer() / syncVoteTimer().
    // Here we only update the "STARTED HH:MM" label from the timer's open timestamp.
    const timerStartElement = document.getElementById('vote-timer-start');
    if (timerStartElement) {
        // Use voteTimer.openedAt only — floorData.timer.timestamp changes meaning
        // in overtime (becomes clock-hit-0 time) so we never read it for display.
        const openedAt = voteTimer.openedAt;
        if (openedAt) {
            const startStr = new Date(openedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            timerStartElement.textContent = `OPENED ${startStr}`;
            timerStartElement.hidden = false;
        } else {
            timerStartElement.hidden = true;
        }
    }
    // If we have timer data from a REST poll (not SSE), sync it once so the
    // local countdown starts even if SSE hasn't delivered a tick yet.
    if (floorData.timer?.value && !voteTimer.interval) {
        syncVoteTimer(floorData.timer);
    }

    // Update timeline info if available
    if (floorData.timeline && elements.nextVotes) {
        const timelineText = floorData.timeline.first_votes?.text || '';
        if (timelineText) {
            elements.nextVotes.textContent = timelineText;
        }
    }

}

// After a vote finishes, look up the bill in billsData by roll call question and update its status.
function reconcileVoteWithBills(force = false) {
    if (!floorData.rollCall || !floorData.voteCounts) return;
    // Don't update while a vote is actively in progress (unless called at transition)
    if (!force && floorData.currentStatus?.value === 'vote') return;

    const totals = floorData.voteCounts.totals || {};
    const yeas = parseInt(totals.yeas) || 0;
    const nays = parseInt(totals.nays) || 0;
    if (yeas + nays === 0) return;

    // Parse bill ID from question, e.g. "S 1003 - On Motion to Suspend..." or "H R 1041 - ..."
    const question = floorData.rollCall.question || '';

    // Skip procedural motions — these are not passage votes
    if (/motion to (commit|recommit|table)|previous question|ordering the previous|motion to refer/i.test(question)) return;
    // Normalize abbreviation with optional spaces/dots to our canonical form
    const normalizeBillType = raw => {
        const t = raw.replace(/\s*\.\s*/g, '.').replace(/\s+/g, '').toUpperCase();
        const map = {
            'H': 'H.R.', 'H.': 'H.R.',  // plain "H" or "H." = H.R. (DomeWatch format)
            'HR': 'H.R.', 'H.R.': 'H.R.',
            'HRES': 'H.Res.', 'H.RES.': 'H.Res.',
            'HJRES': 'H.J.Res.', 'H.J.RES.': 'H.J.Res.',
            'HCONRES': 'H.Con.Res.', 'H.CON.RES.': 'H.Con.Res.',
            'S': 'S.', 'S.': 'S.', 'SRES': 'S.Res.', 'S.RES.': 'S.Res.',
            'SJRES': 'S.J.Res.', 'SCONRES': 'S.Con.Res.'
        };
        return map[t] || null;
    };
    // Try space-separated DomeWatch format: "H R 8464", "H 8464", "S 1003", "H Res 100"
    // then fall back to standard dotted notation: "H.R. 8464", "H.Res. 100"
    const qm = question.match(/(?:^|\s[-–]\s)(H\.?\s*R\.?|H\.?\s*Res\.?|H\.?\s*J\.?\s*Res\.?|H\.?\s*Con\.?\s*Res\.?|H|S\.?(?:\s*(?:J\.?\s*)?(?:Con\.?\s*)?Res\.?)?)\s+(\d+)/i)
            || question.match(/\b(H\.R\.|H\.Res\.|H\.J\.Res\.|H\.Con\.Res\.|S\.(?:Res\.|J\.Res\.|Con\.Res\.)?)\s*(\d+)/i);
    if (!qm) return;

    const type = normalizeBillType(qm[1]);
    if (!type) return;
    const billId = `${type} ${qm[2]}`;

    // Look for the bill across all three billsData arrays
    const allArrays = ['ruleBills', 'suspensionBills', 'mayBeConsideredBills'];
    let found = false;
    for (const key of allArrays) {
        const arr = billsData[key] || [];
        const bill = arr.find(b => b.id === billId);
        if (bill) {
            // Determine pass/fail: suspension requires 2/3 of votes cast; regular = simple majority
            const isSuspension = /suspend/i.test(question);
            const required = isSuspension ? Math.ceil((yeas + nays) * 2 / 3) : Math.floor((yeas + nays) / 2) + 1;
            const passed = yeas >= required;
            const rollNum = floorData.rollCall.number ? ` (Roll Call ${floorData.rollCall.number})` : '';
            bill.status = passed ? 'passed' : 'failed';
            bill.latestAction = passed
                ? `Passed${rollNum}: ${yeas}-${nays}`
                : `Failed${rollNum}: ${yeas}-${nays}`;
            bill.considered = true;
            found = true;
            break;
        }
    }
    // If not found in billsData, check if this is an H.Res. rule in specialRulesMap
    // (the rule itself isn't a "bill" in the list, but its passage updates rule status tags)
    if (!found && /^H\.Res\.\s*\d+$/i.test(billId)) {
        const hresNum = billId.match(/(\d+)/)?.[1];
        if (hresNum) {
            const passed = yeas > nays;
            const rollNum = floorData.rollCall.number ? ` (Roll Call ${floorData.rollCall.number})` : '';
            let ruleUpdated = false;
            for (const entry of specialRulesMap.values()) {
                if (String(entry.hresNum) === String(hresNum)) {
                    entry.ruleStatus = passed ? 'passed' : 'failed';
                    entry.passageVote = `${yeas}-${nays}`;
                    ruleUpdated = true;
                }
            }
            if (ruleUpdated) updateBillsDisplay();
        }
    }
    if (found) updateBillsDisplay();
}

// State Management
let state = {
    isConnected: false,
    lastUpdate: null,
    data: null
};

let floorGridResizeObserver = null;

// DOM Elements
const elements = {
    localTime: document.getElementById('local-time'),
    dcTime: document.getElementById('dc-time'),
    localAnalog: document.getElementById('local-analog'),
    dcAnalog: document.getElementById('dc-analog'),
    utcAnalog: document.getElementById('utc-analog'),
    utcTime: document.getElementById('utc-time'),
    voteTitle: document.getElementById('vote-title'),
    voteId: document.getElementById('vote-id'),
    voteBillBtn: document.getElementById('vote-bill-btn'),
    yeasCount: document.getElementById('yeas-count'),
    yeasPercent: document.getElementById('yeas-percent'),
    yeasD: document.getElementById('yeas-d'),
    yeasR: document.getElementById('yeas-r'),
    yeasI: document.getElementById('yeas-i'),
    yeaThreshold: document.getElementById('yea-threshold'),
    presentCount: document.getElementById('present-count'),
    presentPercent: document.getElementById('present-percent'),
    naysCount: document.getElementById('nays-count'),
    naysPercent: document.getElementById('nays-percent'),
    naysD: document.getElementById('nays-d'),
    naysR: document.getElementById('nays-r'),
    naysI: document.getElementById('nays-i'),
    nayThreshold: document.getElementById('nay-threshold'),
    yeasBar: document.getElementById('yeas-bar'),
    presentBar: document.getElementById('present-bar'),
    naysBar: document.getElementById('nays-bar'),
    totalVotes: document.getElementById('total-votes'),
    thresholdState: document.getElementById('threshold-state'),
    votesRemaining: document.getElementById('votes-remaining'),
    yeasNeeded: document.getElementById('yeas-needed'),
    naysToBlock: document.getElementById('nays-to-block'),
    maxPossibleYeas: document.getElementById('max-possible-yeas'),
    lastVoteAbsences: document.getElementById('last-vote-absences'),
    lastVoteDAbsent: document.getElementById('last-vote-d-absent'),
    lastVoteRAbsent: document.getElementById('last-vote-r-absent'),
    lastVoteIAbsent: document.getElementById('last-vote-i-absent'),
    lastVoteLabel: document.getElementById('last-vote-label'),
    lastUpdate: document.getElementById('last-update'),
        weatherPanel: document.getElementById('weather-panel'),
    capcamVideo: document.getElementById('capcam-video'),
    weatherTemp: document.getElementById('weather-temp'),
    weatherCondition: document.getElementById('weather-condition'),
    membersPresent: document.getElementById('members-present'),
    sessionStatus: document.getElementById('session-status'),
    quorumIndicator: document.getElementById('quorum-indicator'),
    quorumFill: document.getElementById('quorum-fill'),
    quorumSessionStatus: document.getElementById('quorum-session-status'),
    floorArch: document.getElementById('floor-arch'),
    proceedingsFeed: document.getElementById('proceedings-feed'),
    proceedingsLastUpdate: document.getElementById('proceedings-last-update'),
        absenteeRep: document.getElementById('absentee-rep'),
    absenteeDem: document.getElementById('absentee-dem'),
    absenteeInd: document.getElementById('absentee-ind'),
    absenteeIndMetric: document.getElementById('absentee-ind-metric'),
    absenteeTotal: document.getElementById('absentee-total'),
    absenteeList: document.getElementById('absentee-list'),
    tickerContent: document.getElementById('ticker-content'),
    partyRep: document.getElementById('party-rep'),
    partyDem: document.getElementById('party-dem'),
    partyTotal: document.getElementById('party-total'),
    partyInd: document.getElementById('party-ind'),
    repFill: document.getElementById('rep-fill'),
    demFill: document.getElementById('dem-fill'),
    indFill: document.getElementById('ind-fill'),
    vacFill: document.getElementById('vac-fill'),
    partyBreakdownLastUpdate: document.getElementById('party-breakdown-last-update'),
    majorityControlBadge: document.getElementById('majority-control-badge'),
    vacanciesCount: document.getElementById('vacancies-count'),
    vacanciesList: document.getElementById('vacancies-list'),
    debateSection: document.getElementById('debate-section'),
    debateLengthTag: document.getElementById('debate-length-tag'),
    debateLengthText: document.getElementById('debate-length-text'),
    debateBillTitle: document.getElementById('debate-bill-title'),
    debateBillId: document.getElementById('debate-bill-id'),
    debateBillDescription: document.getElementById('debate-bill-description'),
    debateSponsorSection: document.getElementById('debate-sponsor-section'),
    debateSponsorInner: document.getElementById('debate-sponsor-inner'),
    debateSupportSection: document.getElementById('debate-support-section'),
    debateSupportLabel: document.getElementById('debate-support-label'),
    debateSupportBar: document.getElementById('debate-support-bar'),
    debateSupportLabels: document.getElementById('debate-support-labels'),
    debateTime: document.getElementById('debate-time'),
    debatePanelNav: document.getElementById('debate-panel-nav'),
    debateBillPanel: document.getElementById('debate-bill-panel'),
    debateAmendmentsPanel: document.getElementById('debate-amendments-panel'),
    cotwIndicator: document.getElementById('cotw-indicator'),
    debateRuleTag: document.getElementById('debate-rule-tag'),
    debateSourceLink: document.getElementById('debate-source-link'),
    debateCommitteesSection: document.getElementById('debate-committees-section'),
    debateCommitteesLabel: document.getElementById('debate-committees-label'),
    debateCommitteesList: document.getElementById('debate-committees-list'),
    debateCommitteeDate: document.getElementById('debate-committee-date'),
    debateSummarySection: document.getElementById('debate-summary-section'),
    debateLinksFoot: document.getElementById('debate-links-foot'),
    debateLinkText: document.getElementById('debate-link-text'),
    debateLinkReport: document.getElementById('debate-link-report'),
    debateLinkSap: document.getElementById('debate-link-sap'),
    debateLinkCongress: document.getElementById('debate-link-congress'),
    prayerSection: document.getElementById('prayer-section'),
    prayerImage: document.getElementById('prayer-image'),
    prayerImagePlaceholder: document.getElementById('prayer-image-placeholder'),
    prayerLeaderTitle: document.getElementById('prayer-leader-title'),
    prayerLeaderName: document.getElementById('prayer-leader-name'),
    prayerLeaderDescription: document.getElementById('prayer-leader-description'),
    prayerTime: document.getElementById('prayer-time'),
    pledgeSection: document.getElementById('pledge-section'),
    pledgeImage: document.getElementById('pledge-image'),
    pledgeImagePlaceholder: document.getElementById('pledge-image-placeholder'),
    pledgeLeaderTitle: document.getElementById('pledge-leader-title'),
    pledgeLeaderName: document.getElementById('pledge-leader-name'),
    pledgePartyTag: document.getElementById('pledge-party-tag'),
    pledgeTime: document.getElementById('pledge-time'),
    pledgeLeaderDetails: document.getElementById('pledge-leader-details'),
    pledgeLeaderAdditional: document.getElementById('pledge-leader-additional'),
    pledgeLeaderWebsite: document.getElementById('pledge-leader-website'),
    journalImage: document.getElementById('journal-image'),
    journalImagePlaceholder: document.getElementById('journal-image-placeholder'),
    journalChairTitle: document.getElementById('journal-chair-title'),
    journalChairName: document.getElementById('journal-chair-name'),
    journalPartyTag: document.getElementById('journal-party-tag'),
    journalTime: document.getElementById('journal-time'),
    journalChairDetails: document.getElementById('journal-chair-details'),
    journalChairAdditional: document.getElementById('journal-chair-additional'),
    journalChairWebsite: document.getElementById('journal-chair-website'),
    journalLastSessionDate: document.getElementById('journal-last-session-date'),
    oneMinuteTime: document.getElementById('one-minute-time'),
    oneMinuteDescriptionLine: document.getElementById('one-minute-description-line'),
    specialOrderTime: document.getElementById('special-order-time'),
    specialOrderDescriptionLine: document.getElementById('special-order-description-line'),
    jointMeetingTime: document.getElementById('joint-meeting-time'),
    jointMeetingDescriptionLine: document.getElementById('joint-meeting-description-line'),
    tellersTime: document.getElementById('tellers-time'),
    tellersDescription: document.getElementById('tellers-description'),
    tellersList: document.getElementById('tellers-list'),
    messageTime: document.getElementById('message-time'),
    messageFromLine: document.getElementById('message-from-line'),
    messageBody: document.getElementById('message-body'),
    morningHourTime: document.getElementById('morning-hour-time'),
    certElectionTime: document.getElementById('cert-election-time'),
    certElectionText: document.getElementById('cert-election-text'),
    certElectoralTime: document.getElementById('cert-electoral-time'),
    certElectoralText: document.getElementById('cert-electoral-text'),
    sineDieTime: document.getElementById('sine-die-time'),
    sineDieDescriptionLine: document.getElementById('sine-die-description-line'),
    newSessionTime: document.getElementById('new-session-time'),
    newSessionDescriptionLine: document.getElementById('new-session-description-line'),
    adminOathTime: document.getElementById('admin-oath-time'),
    adminOathAdministeredBy: document.getElementById('admin-oath-administered-by'),
    adminOathRecipients: document.getElementById('admin-oath-recipients'),
    jointSessionTime: document.getElementById('joint-session-time'),
    jointSessionDescriptionLine: document.getElementById('joint-session-description-line'),
    jointSessionPresidingLine: document.getElementById('joint-session-presiding-line'),
    silenceSection: document.getElementById('silence-section'),
    silenceTitle: document.getElementById('silence-title'),
    silenceDescription: document.getElementById('silence-description'),
    silenceTime: document.getElementById('silence-time'),
    oathSection: document.getElementById('oath-section'),
    oathImagePlaceholder: document.getElementById('oath-image-placeholder'),
    oathImage: document.getElementById('oath-image'),
    oathMemberTitle: document.getElementById('oath-member-title'),
    oathMemberName: document.getElementById('oath-member-name'),
    oathMemberDescription: document.getElementById('oath-member-description'),
    oathTime: document.getElementById('oath-time'),
    committeeChairSection: document.getElementById('committee-chair-section'),
    committeeChairImage: document.getElementById('committee-chair-image'),
    committeeChairImagePlaceholder: document.getElementById('committee-chair-image-placeholder'),
    committeeChairMemberTitle: document.getElementById('committee-chair-member-title'),
    committeeChairMemberName: document.getElementById('committee-chair-member-name'),
    committeeChairPartyTag: document.getElementById('committee-chair-party-tag'),
    committeeChairTime: document.getElementById('committee-chair-time'),
    committeeChairMemberDetails: document.getElementById('committee-chair-member-details'),
    committeeChairMemberAdditional: document.getElementById('committee-chair-member-additional'),
    committeeChairMemberWebsite: document.getElementById('committee-chair-member-website'),
    speakerSection: document.getElementById('speaker-section'),
    speakerImage: document.getElementById('speaker-image'),
    speakerImagePlaceholder: document.getElementById('speaker-image-placeholder'),
    speakerMemberTitle: document.getElementById('speaker-member-title'),
    speakerMemberName: document.getElementById('speaker-member-name'),
    speakerPartyTag: document.getElementById('speaker-party-tag'),
    speakerTime: document.getElementById('speaker-time'),
    speakerMemberDetails: document.getElementById('speaker-member-details'),
    speakerMemberAdditional: document.getElementById('speaker-member-additional'),
    speakerMemberWebsite: document.getElementById('speaker-member-website'),
    speakerMemberDescription: document.getElementById('speaker-member-description'),
    congressInfo: document.getElementById('congress-info'),
    nextSessionCountdown: document.getElementById('next-session-countdown'),
    airportDelaysList: document.getElementById('airport-delays-list'),
    absenteeRollInfo: document.getElementById('absentee-roll-info'),
    // Bills This Week elements
    billsLastUpdate: document.getElementById('bills-last-update'),
    ruleBillsList: document.getElementById('rule-bills-list'),
    suspensionBillsList: document.getElementById('suspension-bills-list'),
    // Header elements
    todayDate: document.getElementById('today-date'),
    sessionStatus: document.getElementById('session-status'),
    sessionIndicator: document.getElementById('session-status')?.querySelector('.session-indicator'),
    sessionText: document.getElementById('session-status')?.querySelector('.session-text'),
    nextVotes: document.getElementById('next-votes'),
    floorStatus: document.getElementById('floor-status'),
    // Footer elements
    footerUpdated: document.getElementById('footer-updated')
};

// Debate rule tag: clicking the PURSUANT TO button opens the H.Res. modal
if (elements.debateRuleTag) {
    elements.debateRuleTag.addEventListener('click', e => {
        const btn = e.target.closest('[data-bill-id]');
        if (btn) openBillModal(btn.dataset.billId);
    });
}

// VIEW BILL button in vote header
if (elements.voteBillBtn) {
    elements.voteBillBtn.addEventListener('click', () => {
        const billId = elements.voteBillBtn.dataset.billId;
        if (billId) openBillModal(billId);
    });
}

// RSS Feed Configuration
const RSS_CONFIG = {
    workerUrl: 'https://api.evanhollander.org/house-floor/api/proceedings',
    refreshInterval: 5000 // 5 seconds — proceedings drives mode switching
};

// Date override for testing proceedings from a specific date (set via console)
let proceedingsDateOverride = null;

// News Ticker Configuration
const NEWS_CONFIG = {
    workerUrl: 'https://api.evanhollander.org/house-floor/api/news',
    refreshInterval: 300000 // 5 minutes
};

// DomeWatch API Configuration
const DOMEWATCH_CONFIG = {
    baseUrl: 'https://data.domewatch.us/v1',
    workerUrl: 'https://api.evanhollander.org/house-floor/api/domewatch-floor',
    refreshInterval: 10000 // 10 seconds for floor data
};

// House Makeup Configuration
const HOUSE_MAKEUP_CONFIG = {
    url: 'https://clerk.house.gov/xml/lists/MemberData.xml',
    refreshInterval: 300000 // 5 minutes
};

// State for RSS feed
let proceedingsData = [];
let nextSessionAt = null;

// Absentee filter state
let absenteeFilterMode = 'all'; // 'all' | 'rep' | 'dem'
let _absenteesPayload = null; // { absentees, rollNumber, rollDate, rollTime }

// State for House makeup
let houseMakeup = null;
let vacancies = [];
let lastUpdatedDate = null;
let _chaplainPhotoCache = null; // { name, url } — avoids repeat Wikipedia lookups
let _lastChaplainName = null;   // last House Chaplain name seen; drives the info popup

// Congress Information
let currentCongress = null;
let currentSession = null;
let controllingParty = null;

// Worker endpoint configurations
const MEMBER_DATA_CONFIG = {
    workerUrl: 'https://api.evanhollander.org/house-floor/api/member-data',
    refreshInterval: 3600000 // 1 hour
};

// getMemberXml() — alias for getMemberDataXml(), defined further below

const CONGRESS_INDEX_CONFIG = {
    workerUrl: 'https://api.evanhollander.org/house-floor/api/congress-index',
    refreshInterval: 300000 // 5 minutes
};

// ISO 7001 PI TF 016 (Arrivals — landing plane) and a vertical-flip of the same for Departures.
// PI TF 016 path renders reliably at small sizes; PI TF 015 (departures) does not, so we derive
// the departure glyph by flipping PI TF 016 vertically (plane ascending instead of descending).
const ARRIVALS_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52.917 52.917" width="14" height="14" style="vertical-align:middle;margin-left:4px"><g transform="translate(-188.57376,-109.44473)"><path fill="currentColor" d="m 218.8853,125.93666 -5.64152,8.46357 -12.31398,0.95963 c -4.46542,0.31793 -6.48546,1.82059 -6.44456,2.96003 0.0398,1.11042 2.02836,1.92405 5.46064,1.81642 a 0.92036289,0.92036289 0 0 0 -0.38188,0.74518 0.92036289,0.92036289 0 0 0 0.92035,0.92036 0.92036289,0.92036289 0 0 0 0.92036,-0.92036 0.92036289,0.92036289 0 0 0 -0.4656,-0.79995 c 0.20035,-0.0154 0.40337,-0.033 0.61184,-0.0543 l 12.80388,-0.50953 a 0.92036289,0.92036289 0 0 0 -0.60824,0.86506 0.92036289,0.92036289 0 0 0 0.92037,0.92036 0.92036289,0.92036289 0 0 0 0.92035,-0.92036 0.92036289,0.92036289 0 0 0 -0.67593,-0.88728 l 1.9637,-0.078 a 0.92036289,0.92036289 0 0 0 -0.57826,0.85422 0.92036289,0.92036289 0 0 0 0.92036,0.92035 0.92036289,0.92036289 0 0 0 0.92036,-0.92035 0.92036289,0.92036289 0 0 0 -0.64699,-0.87902 l 5.90868,-0.23513 10.34717,-2.35696 1.50172,-8.33851 -3.30005,-0.18655 -3.11196,5.78208 -7.50032,-0.0388 1.55547,-8.02277 z m -24.35201,18.53427 v 1.39888 h 41.04659 v -1.39888 z"/></g></svg>`;
// Departures: PI TF 016 airplane body flipped vertically (ascending) + baseline rect at bottom
const DEPARTURES_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52.917 52.917" width="52.917" height="52.917" style="width:14px;height:14px;vertical-align:middle;margin-left:4px"><g transform="translate(-151.3157,-101.28343)"><path fill="currentColor" fill-rule="evenodd" d="m 171.55992,115.6357 -3.63802,1.4428 4.26537,6.96288 -6.83731,2.63447 -4.89272,-4.32842 -2.94814,1.31723 4.32841,7.27656 10.28723,-1.38028 20.26543,-6.75462 c 4.18881,-1.10754 6.25862,-2.8375 5.84874,-4.0442 -0.36669,-1.07956 -2.74488,-1.78489 -6.93653,-0.53537 l -11.58792,3.36827 z m -14.30145,23.02081 v 1.19166 h 41.02333 v -1.19166 z"/></g></svg>`;

// FAA Airport Status Configuration
const FAA_CONFIG = {
    workerUrl: 'https://api.evanhollander.org/house-floor/api/airport-delays',
    wasAirports: ['DCA', 'IAD', 'BWI'], // Always show these WAS airports
    airportsCsvUrl: 'https://raw.githubusercontent.com/lxndrblz/Airports/main/airports.csv',
    refreshInterval: 300000 // Check every 5 minutes
};

// Airport name and URL mapping (will be populated from CSV)
let airportNames = {};
let airportUrls = {};

// Fetch airport names from CSV
async function fetchAirportNames() {
    try {
        const response = await fetch(FAA_CONFIG.airportsCsvUrl);
        if (!response.ok) throw new Error('Failed to fetch airport names');
        
        const csvText = await response.text();
        const lines = csvText.split('\n');
        
        // Skip header and parse each line
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                const columns = line.split(',');
                if (columns.length >= 7) {
                    const iata = columns[0].replace(/"/g, '').trim();    // Column 0: IATA code
                    const name = columns[2].replace(/"/g, '').trim();    // Column 2: Airport name
                    const url = columns[6].replace(/"/g, '').trim();     // Column 6: Airport URL
                    if (iata && name) {
                        airportNames[iata] = name;
                        if (url && url !== '') {
                            airportUrls[iata] = url;
                        }
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('Failed to load airport names:', error);
        // Fallback to basic mapping
        airportNames = {
            'DCA': 'Ronald Reagan Washington National',
            'IAD': 'Washington Dulles International',
            'BWI': 'Baltimore/Washington International'
        };
        airportUrls = {};
    }
}

// Returns true only for full airport closures; runway/taxiway-only NOTAMs return false.
function isFaaFullAirportClosure(reason) {
    const upper = reason.toUpperCase();

    // Aircraft-class restrictions take priority — "AP CLSD TO NON SKED" is still partial
    if (/\b(CLSD|CLOSED)\s+TO\s+NON[\s-]?SKED\b/.test(upper)) return false;
    if (/\b(CLSD|CLOSED)\s+TO\s+TRANSIENT\b/.test(upper)) return false;
    if (/\b(CLSD|CLOSED)\s+TO\s+(GA|GENERAL\s+AVIATION)\b/.test(upper)) return false;
    if (/\b(CLSD|CLOSED)\s+TO\s+(VFR|IFR)\b/.test(upper)) return false;
    if (/\bNOT\s+AVBL\s+TO\s+NON[\s-]?SKED\b/.test(upper)) return false;

    // Explicit full-airport closure phrases
    if (/\bAP\s+CLSD\b/.test(upper)) return true;
    if (/\bARPT\s+CLSD\b/.test(upper)) return true;
    if (/\bAIRPORT\s+CLSD\b/.test(upper)) return true;
    if (/\bAD\s+CLSD\b/.test(upper)) return true;
    if (/\bCLSD\s+TO\s+ALL\s+(ACFT|ARCRFT|AIRCRAFT)\b/.test(upper)) return true;
    if (/\bAP\s+NOT\s+AVBL\b/.test(upper)) return true;

    // Runway- or taxiway-specific closures — airport remains operational
    if (/\bRWY\s+[\dLRC]/.test(upper)) return false;
    if (/\bTWY\s+[A-Z]/.test(upper)) return false;
    if (/\bRUNWAY\s+\d/.test(upper)) return false;
    if (/\bTAXIWAY\s+/.test(upper)) return false;

    // Unclassifiable — assume full closure to avoid missing genuine closures
    return true;
}

// Fetch FAA airport status information
async function fetchAirportDelays(preData = null) {
    try {
        if (!elements.airportDelaysList) return;

        // Show loading state (only if empty to avoid flash on refresh)
        if (!elements.airportDelaysList.hasChildNodes()) {
            elements.airportDelaysList.innerHTML =
                `<div class="airport-section-header">WAS AREA · ARRIVALS ${ARRIVALS_GLYPH}</div>` +
                FAA_CONFIG.wasAirports.map(code => `
                    <div class="airport-delay-item">
                        <div class="airport-item-main">
                            <span class="airport-info">${code}</span>
                            <span class="airport-status loading">LOADING</span>
                        </div>
                    </div>
                `).join('');
        }

        const delays = {};

        // Initialize WAS airports as normal (always show these)
        FAA_CONFIG.wasAirports.forEach(code => {
            delays[code] = { status: 'normal', delay: 'No delays', reason: '', trend: '' };
        });

        // Track connection status
        let connectionStatus = 'connected'; // 'connected', 'disconnected', 'error'

        // Fetch all airport delays from the main API endpoint (or use pre-pushed SSE data)
        try {
            let jsonData;
            if (preData) {
                jsonData = preData;
            } else {
                const response = await fetch(FAA_CONFIG.workerUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                jsonData = await response.json();
            }
            {
                if (jsonData.error) {
                    throw new Error(jsonData.error);
                }

                const xmlText = jsonData.xmlData || '';
                
                // Parse XML to find all delay types
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
                const delayTypes = xmlDoc.querySelectorAll('Delay_type');
                
                delayTypes.forEach(delayType => {
                    const typeName = delayType.querySelector('Name')?.textContent || '';
                    
                    // Handle Airport Closures
                    if (typeName === 'Airport Closures') {
                        const closures = delayType.querySelectorAll('Airport_Closure_List Airport');
                        closures.forEach(closure => {
                            const airport = closure.querySelector('ARPT')?.textContent?.trim();
                            const reason = closure.querySelector('Reason')?.textContent?.trim() || 'Airport closed';
                            const reopenText = closure.querySelector('Reopen')?.textContent?.trim();
                            const beginText = closure.querySelector('Begin')?.textContent?.trim();

                            if (!airport) return;

                            const now = new Date();

                            // Skip closures whose window has already ended
                            if (reopenText) {
                                const reopenTime = new Date(reopenText);
                                if (!isNaN(reopenTime.getTime()) && reopenTime < now) return;
                            }

                            // Skip closures that haven't started yet
                            if (beginText) {
                                const beginTime = new Date(beginText);
                                if (!isNaN(beginTime.getTime()) && beginTime > now) return;
                            }

                            // Skip runway/taxiway-only NOTAMs — the airport itself is open
                            if (!isFaaFullAirportClosure(reason)) return;

                            delays[airport] = {
                                status: 'delay',
                                delay: 'CLOSED',
                                reason: reason,
                                trend: 'Closed'
                            };
                        });
                    }
                    
                    // Handle General Arrival/Departure Delays
                    if (typeName === 'General Arrival/Departure Delay Info') {
                        const delayList = delayType.querySelectorAll('Arrival_Departure_Delay_List Delay');
                        delayList.forEach(delay => {
                            const airport = delay.querySelector('ARPT')?.textContent?.trim();
                            const reason = delay.querySelector('Reason')?.textContent?.trim() || '';
                            const minDelay = delay.querySelector('Min')?.textContent?.trim() || '';
                            const maxDelay = delay.querySelector('Max')?.textContent?.trim() || '';
                            const trend = delay.querySelector('Trend')?.textContent?.trim() || '';
                            const arrDep = delay.querySelector('Arrival_Departure')?.textContent?.trim() || '';

                            if (!airport) return;

                            const isWas = FAA_CONFIG.wasAirports.includes(airport);
                            // WAS airports: arrival delays only; others: departure delays only
                            if (isWas && arrDep !== 'Arrival') return;
                            if (!isWas && arrDep !== 'Departure') return;

                            delays[airport] = {
                                status: minDelay ? 'delay' : 'normal',
                                delay: minDelay && maxDelay ? `${minDelay}-${maxDelay} min` : 'No delays',
                                reason: reason,
                                trend: trend
                            };
                        });
                    }

                    // Handle Ground Stop Programs (FAA XML: "Ground Stop Programs")
                    if (typeName === 'Ground Stop Programs') {
                        const programs = delayType.querySelectorAll('Ground_Stop_List Program');
                        programs.forEach(program => {
                            const airport = program.querySelector('ARPT')?.textContent?.trim();
                            const reason = program.querySelector('Reason')?.textContent?.trim() || '';
                            const endTime = program.querySelector('End_Time')?.textContent?.trim() || '';

                            if (!airport) return;

                            delays[airport] = {
                                status: 'ground-stop',
                                delay: 'GROUND STOP',
                                reason: reason + (endTime ? ` · until ${endTime}` : ''),
                                trend: ''
                            };
                        });
                    }

                    // Handle Ground Delay Programs (FAA XML: "Ground Delay Programs") — arrival restrictions
                    if (typeName === 'Ground Delay Programs') {
                        const gds = delayType.querySelectorAll('Ground_Delay_List Ground_Delay');
                        gds.forEach(gd => {
                            const airport = gd.querySelector('ARPT')?.textContent?.trim();
                            const reason = gd.querySelector('Reason')?.textContent?.trim() || '';
                            const avg = gd.querySelector('Avg')?.textContent?.trim() || '';

                            if (!airport) return;
                            // Ground stop takes priority over ground delay
                            if (delays[airport]?.status === 'ground-stop') return;

                            delays[airport] = {
                                status: 'ground-delay',
                                delay: avg || 'DELAYED',
                                reason: reason,
                                trend: ''
                            };
                        });
                    }
                });
                
                // Mark as connected successfully
                connectionStatus = 'connected';
            }
        } catch (error) {
            console.error('FAA API fetch error:', error);
            connectionStatus = 'disconnected';
        }

        // Update state
        airportDelays = delays;

        // Update display with connection status
        updateAirportDelaysDisplay(connectionStatus);

    } catch (error) {
        console.error('Airport delays fetch error:', error);
        if (elements.airportDelaysList) {
            setIfChanged(elements.airportDelaysList,
                `<div class="airport-section-header">WAS AREA · ARRIVALS ${ARRIVALS_GLYPH}</div>` +
                `<div class="airport-delay-item"><div class="airport-item-main"><span class="airport-info">CONNECTION ERROR</span><span class="airport-status delay">ERROR</span></div></div>`);
        }
    }
}

// Render a single airport row (used by updateAirportDelaysDisplay)
function renderAirportRow(code, data) {
    const statusClass = data.status === 'normal' ? 'normal'
        : data.status === 'ground-stop' ? 'ground-stop'
        : data.status === 'ground-delay' ? 'ground-delay'
        : data.status === 'disconnected' ? 'disconnected'
        : 'delay';
    const delayText = data.status === 'normal' ? 'NO DELAYS'
        : data.status === 'ground-stop' ? 'GROUND STOP'
        : data.status === 'ground-delay' ? (data.delay || 'GROUND DELAY')
        : data.status === 'disconnected' ? 'NO DATA'
        : (data.delay || 'DELAYS');
    const airportName = airportNames[code] || '';
    const airportUrl = airportUrls[code];

    const trendClass = data.trend === 'Increasing' ? 'up' : data.trend === 'Decreasing' ? 'down' : '';
    const trendSymbol = data.trend === 'Increasing' ? '↑' : data.trend === 'Decreasing' ? '↓' : '';
    const hasDetail = data.status !== 'normal' && data.status !== 'disconnected' && data.reason;
    const normalTimeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const subLine = data.status === 'normal'
        ? `<div class="airport-item-sub"><span class="airport-reason">No delay reported as of ${normalTimeStr}</span></div>`
        : hasDetail
        ? `<div class="airport-item-sub"><span class="airport-reason">${escapeHtml(data.reason)}</span>${trendSymbol ? `<span class="airport-trend ${trendClass}">${trendSymbol}</span>` : ''}</div>`
        : `<div class="airport-item-sub"></div>`;

    const inner = `<div class="airport-delay-item">
        <div class="airport-info-col">
            <span class="airport-info">${escapeHtml(code)}${airportName ? ` · ${escapeHtml(airportName)}` : ''}</span>
            ${subLine}
        </div>
        <span class="airport-status ${statusClass}">${escapeHtml(delayText)}</span>
    </div>`;

    return airportUrl
        ? `<a href="${escapeHtml(airportUrl)}" target="_blank" rel="noopener" class="airport-delay-item-link">${inner}</a>`
        : inner;
}

// Update airport delays display
function updateAirportDelaysDisplay(connectionStatus = 'connected') {
    if (!elements.airportDelaysList || !airportDelays) return;

    const wasAirports = FAA_CONFIG.wasAirports;

    // If disconnected, show NO DATA for WAS airports only
    if (connectionStatus === 'disconnected') {
        setIfChanged(elements.airportDelaysList,
            `<div class="airport-section-header">WAS AREA · ARRIVALS ${ARRIVALS_GLYPH}</div>` +
            wasAirports.map(code => renderAirportRow(code, { status: 'disconnected', delay: 'NO DATA', reason: '', trend: '' })).join(''));
        return;
    }

    // WAS section — always show DCA/IAD/BWI
    const wasHtml = wasAirports.map(code => {
        const data = airportDelays[code] || { status: 'normal', delay: 'No delays', reason: '', trend: '' };
        return renderAirportRow(code, data);
    }).join('');

    // Nationwide section — non-WAS airports with any active delay or ground stop
    const nationalEntries = Object.entries(airportDelays)
        .filter(([code]) => !wasAirports.includes(code))
        .filter(([, data]) => data.status !== 'normal');
    const nationalHtml = nationalEntries.map(([code, data]) => renderAirportRow(code, data)).join('');

    let html = `<div class="airport-section-header">WAS AREA · ARRIVALS ${ARRIVALS_GLYPH}</div>${wasHtml}`;
    if (nationalHtml) {
        html += `<div class="airport-section-header national-header">NATIONWIDE · DEPARTURES ${DEPARTURES_GLYPH}</div>${nationalHtml}`;
    }

    setIfChanged(elements.airportDelaysList, html);
}

// Convert a string to Title Case, respecting common minor words
function toTitleCase(str) {
    const minors = new Set(['a','an','the','and','but','or','for','nor','on','at','to','by','of','in','up']);
    return str.toLowerCase().replace(/\b\w+/g, (word, offset) =>
        (offset === 0 || !minors.has(word)) ? word.charAt(0).toUpperCase() + word.slice(1) : word
    );
}

// Parse a debate length phrase like "forty minutes" or "one hour" into "40 MIN" / "1 HR"
function parseDebateLength(text) {
    const lower = text.trim().toLowerCase();
    const wordMap = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
        'fifteen': 15, 'twenty': 20, 'thirty': 30, 'forty': 40,
        'forty-five': 45, 'forty five': 45,
        'sixty': 60, 'ninety': 90,
        'one and a half': 90, 'one and one-half': 90,
    };
    const m = lower.match(/^(.+?)\s+(hours?|minutes?)$/);
    if (!m) return null;
    const numPart = m[1].trim();
    const unit = m[2];
    const n = wordMap[numPart] ?? parseInt(numPart, 10);
    if (!n || isNaN(n)) return null;
    return unit.startsWith('hour') ? (n === 1 ? '1 HOUR' : `${n} HOURS`) : `${n} MIN`;
}

// Utility function to format dates
const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// "02 May 2026"
function fmtDate(d) {
    return `${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

// "Tuesday, 20 May 2026"
function fmtDateLong(d) {
    return `${DAY_NAMES[d.getDay()]}, ${fmtDate(d)}`;
}

// Accepts date strings in various formats (ISO, M/D/YY, M/D/YYYY) → "20 May 2026"
function formatDate(dateStr) {
    if (!dateStr) return 'No date';

    // Parse "4/22/26" or "1/6/2026"
    const slash = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) {
        const fullYear = slash[3].length === 2 ? 2000 + parseInt(slash[3]) : parseInt(slash[3]);
        const d = new Date(fullYear, parseInt(slash[1]) - 1, parseInt(slash[2]));
        return fmtDate(d);
    }

    // ISO or any other parseable string — parse as local date to avoid UTC offset shifting the day
    const isoLocal = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoLocal) {
        const d = new Date(parseInt(isoLocal[1]), parseInt(isoLocal[2]) - 1, parseInt(isoLocal[3]));
        return fmtDate(d);
    }

    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return fmtDate(d);

    return dateStr;
}

// House Voting Days Configuration
const VOTING_DAYS_CONFIG = {
    workerUrl: 'https://api.evanhollander.org/house-floor/api/voting-days',
    refreshInterval: 3600000 // 1 hour
};

// State for voting days data
let votingDaysData = {
    days: [],
    lastUpdated: null,
    currentSessionStatus: 'unknown'
};

let votingCalendarData = [];


// Bills This Week Configuration
const BILLS_CONFIG = {
    workerUrl: 'https://api.evanhollander.org/house-floor/api/bills',
    refreshInterval: 300000 // 5 minutes — SSE + fetchFloorData() already trigger bills refresh on vote events
};

// State for bills data
const billDataMap = new Map();

// Map from normalized bill ID -> rule info {hres, hresNum, pdfUrl, ruleStatus}
const specialRulesMap = new Map();

// Map from normalized bill ID -> Democratic Whip recommendation
// { recommendation: "YES"|"NO", confidence: "high"|"medium"|"low" }
const whipRecMap = new Map();

// Lookup map from member name -> casualty status (e.g. "Retiring", "Running for Senate")
// Populated at startup from /api/casualty-list.  Keys: "FIRSTNAME LASTNAME" and "LASTNAME".
let casualtyMap = {};

// Normalize a bill ID to match the rules.house.gov slug format, e.g. "H.R. 1041" -> "HR1041"
function normalizeBillIdForRules(billId) {
    return billId.toUpperCase().replace(/[.\s]/g, '');
}

// Extract a normalized bill ID from arbitrary text (question, legisNum, etc.).
// Flexible: allows optional dots and spaces inside the bill type prefix AND
// between the prefix and number, e.g. "H. R. 3633", "H.R.3633", "H.R. 3633",
// "H.Res. 45", "S. 1234", "S.1234" all return the same normalized form.
// Uses \s* (not \s+) because DomeWatch legisNum can be "H.R.3633" (no space).
// Returns the normalized string (e.g. "HR3633") or null if no match.
function extractBillNormFromText(text) {
    if (!text) return null;
    const m = text.match(/\b(H\.?\s*J\.?\s*Res\.?|H\.?\s*Con\.?\s*Res\.?|H\.?\s*Res\.?|H\.?\s*R\.?|S\.?\s*J\.?\s*Res\.?|S\.?\s*Con\.?\s*Res\.?|S\.?\s*Res\.?|S\.?)\s*(\d+)/i);
    if (!m) return null;
    return normalizeBillIdForRules(m[1] + m[2]);
}

// Called by SSE event: casualty-list. Populates casualtyMap.
function applyCasualtyData(data) {
    if (data && typeof data === 'object' && !data.error) casualtyMap = data;
}

// Look up a member's casualty status using their match object from the Clerk XML.
// Returns e.g. "Retiring", "Running for Senate", or null if not on the casualty list.
function getCasualtyStatus(match) {
    if (!match || !casualtyMap) return null;
    const firstName = (match.firstName || '').toUpperCase();
    const lastName  = (match.lastName  || '').toUpperCase();
    if (firstName && lastName) {
        const full = `${firstName} ${lastName}`;
        if (full in casualtyMap) return casualtyMap[full];
    }
    if (lastName && lastName in casualtyMap) return casualtyMap[lastName];
    return null;
}

// fetchSpecialRules() and fetchWhipRecs() removed — both are delivered via
// the SSE event: bills payload (rules + whip bundled by the Durable Object).

// ── Whip Floor Updates (Firestore ActivityFeeds via worker proxy) ────────────
// Shared cache of the last fetched items — lets updateVoteTimelineStatus()
// refresh circle states on each SSE tick without re-fetching Firestore.
let whipFloorItems = [];
let whipNoticeFilter = null; // null = all; 'floor'|'daily'|'nightly'|'weekly' = filtered

// ── Vote recs state ──────────────────────────────────────────────────────────
// currentVotesList: [{billId, text, duration, action}] from latest series render
let currentVotesList = [];

// Who controls the House right now. Flip this when control changes.
// 'R' = Republicans majority, Democrats minority; 'D' = vice versa.
const HOUSE_MAJORITY_PARTY = 'R';

// Granular auto-fill preferences (persisted to localStorage)
let voteRecsPrefs = (() => {
    try {
        const s = localStorage.getItem('voteRecsPrefs');
        if (s) {
            const parsed = JSON.parse(s);
            // Migrate old boolean followWhip → string ('follow'/'oppose'/null)
            if (parsed.followWhip === true)  parsed.followWhip = 'follow';
            if (parsed.followWhip === false) parsed.followWhip = null;
            return parsed;
        }
    } catch (e) {}
    return { followWhip: null, pq: null, rule: null, ruleMeasures: null, suspensions: null, mtr: null };
})();

// Last-clicked preset button ('nothing' | 'D' | 'R'), for button highlighting
let voteRecsPreset = localStorage.getItem('voteRecsPreset') || 'nothing';

// per-vote rec: key → {vote: null|'YES'|'NO', note: ''}
// key = (billId || text) + '|' + (action || '')
const voteRecsMap = new Map();

// Called by the SSE event: whip-feed handler with payload { floor: [...], notices: [...] }
// pushed by the Durable Object every 2 min (single poll for all connected clients).
function applyWhipFeedData({ floor = [], notices = [] }) {
    const tag = (items, type) => (items || []).map(it => ({ ...it, noticeType: it.noticeType || type }));
    // DomeWatch stores ET times with a +00:00 UTC label (e.g. 6:41 PM ET → "18:41+00:00").
    // Firestore floor timestamps are real UTC. Add the EDT offset (4h) to DomeWatch
    // timestamps so the two series sort chronologically against each other.
    const EDT_OFFSET_MS = 4 * 60 * 60 * 1000;
    const sortKey = (item) => {
        const t = item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
        return (item.noticeType || 'floor') === 'floor' ? t : t + EDT_OFFSET_MS;
    };
    const all = [
        ...tag(floor,   'floor'),
        ...tag(notices, null),
    ].sort((a, b) => sortKey(b) - sortKey(a));
    whipFloorItems = all;
    renderWhipNoticesFeed(whipFloorItems);
    renderVoteTimeline(whipFloorItems);
}

// ── Whip Notices feed (scrollable, all items) ─────────────────────────────
const WHIP_NOTICE_TYPE_LABEL = {
    floor:          'FLOOR UPDATE',
    'floor update': 'FLOOR UPDATE',
    daily:          'DAILY PREVIEW',
    nightly:        'NIGHTLY PREVIEW',
    weekly:         'WEEKLY PREVIEW',
};

function renderWhipNoticesFeed(items) {
    const feed = document.getElementById('whip-updates-feed');
    if (!feed) return;

    // Apply active filter
    const filtered = whipNoticeFilter
        ? items.filter(it => (it.noticeType || 'floor').toLowerCase() === whipNoticeFilter)
        : items;

    if (filtered.length === 0) {
        feed.innerHTML = `<div class="whip-updates-loading">${whipNoticeFilter ? 'No ' + whipNoticeFilter + ' notices.' : 'No notices today.'}</div>`;
        return;
    }

    feed.innerHTML = filtered.map(item => {
        const typeKey   = (item.noticeType || 'floor').toLowerCase();
        const typeLabel = WHIP_NOTICE_TYPE_LABEL[typeKey] || typeKey.toUpperCase();
        const isFloor   = typeKey === 'floor';

        // Always show a timestamp. Format: "10 Jun at 3:41 PM EDT" for all types.
        // Floor: accurate Firestore UTC timestamps → convert to user's local TZ.
        // Daily/nightly/weekly: DomeWatch stores ET as +00:00 UTC — render in UTC
        // to recover the correct ET send time. No weekday, day-before-month.
        let whenStr = '';
        if (item.publishedAt) {
            const d = new Date(item.publishedAt);
            const tz = isFloor ? undefined : 'UTC'; // UTC recovers ET for DomeWatch
            const day   = d.toLocaleDateString('en-US', { day: '2-digit',   timeZone: tz });
            const month = d.toLocaleDateString('en-US', { month: 'short',   timeZone: tz });
            const time  = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit',
                                                           timeZone: tz, timeZoneName: isFloor ? 'short' : undefined });
            const tzLabel = isFloor ? '' : ' ET';
            whenStr = `${day} ${month} at ${time}${tzLabel}`;
        }

        // Schedule block for daily/nightly/weekly — horizontal stat cards
        let schedHtml = '';
        if (!isFloor && (item.houseMeetsAt || item.firstVotes || item.lastVotes)) {
            // Clean up values: "Approximately X" → "~X", newlines → " · "
            const fmt = v => escapeHtml(v.replace(/\bApproximately\b\s*/gi, '~').replace(/\n/g, ' · '));
            const stats = [
                item.houseMeetsAt ? ['MEETS',       fmt(item.houseMeetsAt)] : null,
                item.firstVotes   ? ['FIRST VOTES', fmt(item.firstVotes)]   : null,
                item.lastVotes    ? ['LAST VOTES',  fmt(item.lastVotes)]    : null,
            ].filter(Boolean);
            schedHtml = `<div class="whip-notice-schedule">${
                stats.map(([label, val]) =>
                    `<div class="whip-sched-stat"><div class="whip-sched-label">${label}</div><div class="whip-sched-val">${val}</div></div>`
                ).join('')
            }</div>`;
        }

        return `
            <div class="whip-update-item">
                <div class="whip-update-meta">
                    <span class="whip-type-badge whip-type-${typeKey}" data-filter-type="${typeKey}">${typeLabel}</span>
                    <span class="whip-update-title">${escapeHtml(item.title)}</span>
                    ${whenStr ? `<span class="whip-update-time">${escapeHtml(whenStr)}</span>` : ''}
                </div>
                ${schedHtml}
                <div class="whip-update-body">${sanitizeHtml(item.body)}</div>
            </div>`;
    }).join('');
}

function renderWhipFilterDropdown() {
    const dropdown = document.getElementById('whip-filter-dropdown');
    if (!dropdown) return;

    const presentTypes = [...new Set(whipFloorItems.map(it => (it.noticeType || 'floor').toLowerCase()))];
    const allTypes = ['floor', 'daily', 'nightly', 'weekly'].filter(t => presentTypes.includes(t));

    const chips = [
        `<button class="whip-filter-chip whip-type-all${whipNoticeFilter === null ? ' active' : ''}" data-filter-type="all">ALL</button>`,
        ...allTypes.map(t => {
            const label = WHIP_NOTICE_TYPE_LABEL[t] || t.toUpperCase();
            const isActive = whipNoticeFilter === t;
            return `<button class="whip-filter-chip whip-type-${t}${isActive ? ' active' : ''}" data-filter-type="${t}">${label}</button>`;
        }),
    ];
    dropdown.innerHTML = chips.join('');
    dropdown.hidden = false;
}

function setWhipFilter(type) {
    whipNoticeFilter = (type === 'all' || type === whipNoticeFilter) ? null : type;
    const btn = document.getElementById('whip-filter-btn');
    if (btn) {
        btn.classList.toggle('active', whipNoticeFilter !== null);
        btn.dataset.activeFilter = whipNoticeFilter || '';
    }
    // Re-render chips in-place so active state updates without closing drawer
    renderWhipFilterDropdown();
    renderWhipNoticesFeed(whipFloorItems);
}

// ── Vote Series Timeline ───────────────────────────────────────────────────
// Matches "Floor Update – N Votes – …" notice titles.
const VOTE_SERIES_RE = /floor\s+update\s*[–\-]\s*\d+\s*votes?/i;

// Parse vote items from a Whip notice body HTML.
// The Whip's format is inconsistent: first vote often appears in a plain <p>,
// subsequent votes in <ol><li>. Scan ALL <p> and <li> elements and keep only
// those that contain a bill reference. Deduplicate by billId (same bill can
// appear in both a "Following this vote..." paragraph AND an <ol><li>).
function parseVoteItemsFromHtml(htmlBody) {
    const div = document.createElement('div');
    div.innerHTML = htmlBody;
    const seen = new Set();
    const results = [];
    const SUSPENSION_RE = /under\s+suspension\s+of\s+the\s+rules/i;

    // Elements that contain a bill reference but are NOT actual vote items —
    // scheduling context, reminders, postponements, cancellations.
    const NON_VOTE_RE = new RegExp([
        /^[\*\s]*members\s+are\s+(?:advised|reminded|further\s+advised)\b/,
        /^any\s+recorded\s+votes?\s+requested\s+on\b/,
        /\bwill\s+be\s+postponed\b/,
        /\bhave\s+been\s+postponed\b/,
        /^next\/last\s+votes?\s+predicted:/,
        /^(?:after|following)\s+(?:last\s+votes?|(?:general\s+)?debate|the\s+(?:first|second|third|fourth)\s+vote\s+series|this\s+vote\s+series)\b/,
        /\bsign\s+the\s+\S+\s+discharge\s+petition\b/i,
        /house\s+republicans\s+have\s+pulled\s+the\s+vote/,
    ].map(r => r.source).join('|'), 'i');

    // Full action-prefix regex — order matters (longer/more-specific first)
    const ACTION_RE = /^(?:\(IF\s+(?:REQUESTED|OFFERED)\)\s*)?(?:(?:democratic|republican)\s+)?(concurring\s+in\s+the\s+senate\s+amendments?\s+to|final\s+passage\s+of|adoption\s+of|passage\s+of|consideration\s+of|amendment\s+to|motion\s+on\s+ordering\s+the\s+previous\s+question\s*(?:\([^)]*\))?|motion\s+to\s+recommit\s+on|motion\s+to\s+(?:re)?commit\s+on|motion\s+to\s+discharge\s+(?:on\s+)?|motion\s+to\s+table\s+(?:on\s+)?|motion\s+to\s+refer\s+(?:on\s+)?)\s*/i;

    // Normalize raw action string → canonical token
    function canonicalAction(raw) {
        const a = raw.toLowerCase();
        if (/senate\s+amendment/.test(a))      return 'senate amendment';
        if (/final\s+passage/.test(a))          return 'final passage';
        if (/adoption/.test(a))                 return 'adoption';
        if (/passage/.test(a))                  return 'passage';
        if (/consideration/.test(a))            return 'consideration';
        if (/amendment\s+to/.test(a))           return 'amendment to rule';
        if (/previous\s+question/.test(a))      return 'previous question';
        if (/motion\s+to\s+recommit/.test(a))   return 'motion to recommit';
        if (/motion\s+to\s+(?:re)?commit/.test(a)) return 'motion to commit';
        if (/motion\s+to\s+discharge/.test(a))  return 'motion to discharge';
        if (/motion\s+to\s+table/.test(a))      return 'motion to table';
        if (/motion\s+to\s+refer/.test(a))      return 'motion to refer';
        return null;
    }

    let suspensionContext = false;

    for (const el of div.querySelectorAll('p, li')) {
        const raw = el.textContent.trim();
        if (!raw) continue;

        if (SUSPENSION_RE.test(raw)) suspensionContext = true;
        if (NON_VOTE_RE.test(raw)) continue; // scheduling/reminder text — not a vote item

        const m = raw.match(/(H\.J\.\s*Res\.|H\.Con\.\s*Res\.|H\.\s*Res\.|H\.R\.|S\.J\.\s*Res\.|S\.Con\.\s*Res\.|S\.\s*Res\.|S\.)\s*(\d+)/i);

        // Items with no bill reference: include <li> elements that aren't connector
        // phrases — covers things like "Quorum Call" and "Manual Roll Call Vote on the
        // Election of the Speaker" that appear in FDOC notices without a bill ID.
        if (!m) {
            if (el.tagName.toLowerCase() !== 'li') continue;
            if (/^(?:following|after)\b/i.test(raw)) continue; // connector phrase
            const labelText = raw
                .replace(/\s*[–\-]\s*VOTE\s+(?:YES|NO)\b/gi, '')
                .replace(/\s*[–\-]\s*\d+\s*min(?:utes?)?/gi, '')
                .trim();
            if (!labelText) continue;
            const durMatch = raw.match(/\b(\d+)\s*min(?:utes?)?/i);
            results.push({ text: labelText, billId: null, duration: durMatch ? `${durMatch[1]} min` : null, action: null });
            continue;
        }

        const billId = `${m[1].replace(/\s+/g, '')} ${m[2]}`;
        if (seen.has(billId)) continue;
        seen.add(billId);

        // Strip inline connector phrases and VOTE YES/NO badges
        const stripped = raw
            .replace(/^(?:following this vote[^:]*:?\s*|the house will then take[^:]*:?\s*)/i, '')
            .replace(/\s*[–\-]\s*VOTE\s+(?:YES|NO)\b/gi, '')
            .trim();

        const actionMatch = ACTION_RE.exec(stripped);
        let action;
        if (actionMatch) {
            // actionMatch[1] is the captured group (the part after any party/IF-prefix)
            action = canonicalAction(actionMatch[1] || actionMatch[0]);
            suspensionContext = false;
        } else {
            action = suspensionContext ? 'suspension' : null;
        }

        const text = actionMatch ? stripped.slice(actionMatch[0].length).trim() : stripped;
        const durMatch = text.match(/\b(\d+)\s*min(?:utes?)?/i);
        const duration = durMatch ? `${durMatch[1]} min` : null;
        results.push({ text, billId, duration, action });
    }
    return results;
}

// Determine status of a vote-timeline item from live data.
// Returns 'pending' | 'active' | 'passed' | 'failed'
// Map action token → patterns that the live rollCall.question should match.
// Used to disambiguate two items with the same billId (e.g. PQ and Rule adoption
// both reference H.Res. 722 — we only mark the one whose question type matches).
const ACTION_QUESTION_PATTERNS = {
    'previous question':   [/previous\s+question/i],
    'motion to recommit':  [/recommit/i],
    'motion to commit':    [/commit/i],
    'motion to table':     [/motion\s+to\s+table/i],
    'motion to discharge': [/discharge/i],
    'motion to refer':     [/motion\s+to\s+refer/i],
    'senate amendment':    [/concur|senate\s+amendment/i],
    'adoption':            [/agreeing|adoption/i],
    'passage':             [/passage/i],
    'final passage':       [/passage/i],
    'suspension':          [/suspend/i],
    'consideration':       [/consideration/i],
    'amendment to rule':   [/amendment/i],
};

function questionMatchesAction(question, action) {
    if (!action) return true; // no action context — allow any match
    const patterns = ACTION_QUESTION_PATTERNS[action.toLowerCase()];
    if (!patterns) return true; // unknown action — don't filter
    return patterns.some(re => re.test(question));
}

function getVoteTlStatus(billId, action = null) {
    if (!billId) return 'pending';

    // Normalize for H.Res. lookups
    const hresMatch = billId.match(/^H\.Res\.\s*(\d+)/i);
    const hresNum = hresMatch ? hresMatch[1] : null;

    // Check if this bill is currently being voted on.
    // Strategy: match bill# in question or bill.legisNum, then verify the question
    // type matches the expected action so PQ and Rule adoption on the same H.Res.
    // don't both show as active simultaneously.
    const activeRC = floorData.rollCall;
    if (activeRC) {
        const BILL_ID_RE = /(H\.J\.\s*Res\.|H\.Con\.\s*Res\.|H\.\s*Res\.|H\.R\.|S\.J\.\s*Res\.|S\.Con\.\s*Res\.|S\.\s*Res\.|S\.)\s*(\d+)/i;
        const billNormActive = normalizeBillIdForRules(billId);
        const activeQ = activeRC.question || '';
        const qm = activeQ.match(BILL_ID_RE);
        const lm = (activeRC.bill?.legisNum || '').match(BILL_ID_RE);
        const billMatches = (qm && normalizeBillIdForRules(`${qm[1]} ${qm[2]}`) === billNormActive) ||
                            (lm && normalizeBillIdForRules(`${lm[1]} ${lm[2]}`) === billNormActive);
        if (billMatches && questionMatchesAction(activeQ, action)) return 'active';
    }

    // For H.Res. resolutions, check specialRulesMap — rule votes store their
    // outcome in ruleStatus, not in billDataMap.status.
    if (hresNum) {
        for (const entry of specialRulesMap.values()) {
            if (String(entry.hresNum) === hresNum) {
                if (entry.ruleStatus === 'passed') return 'passed';
                if (entry.ruleStatus === 'failed') return 'failed';
            }
        }
    }

    // Check rollLog directly — also check entry.bill (not just entry.question)
    // since some procedural votes ("On Ordering the Previous Question") don't
    // include the H.Res. number in the question text.
    // extractBillNormFromText handles flexible spacing ("H. R." vs "H.R.").
    // IMPORTANT: Check rollLog BEFORE billDataMap so completed votes are detected
    // even if they haven't been updated in billDataMap yet (e.g., during final vote).
    const billNorm = normalizeBillIdForRules(billId);
    for (const entry of rollLog) {
        const qNorm = extractBillNormFromText(entry.question);
        const bNorm = extractBillNormFromText(entry.bill);
        if (qNorm !== billNorm && bNorm !== billNorm) continue;
        const yeas = entry.totals?.yeas || 0;
        const nays = entry.totals?.nays || 0;
        if (yeas + nays > 0) return yeas > nays ? 'passed' : 'failed';
    }

    // Check billDataMap (updated by applyRollLogToBills via SSE)
    let bill = billDataMap.get(billId);
    if (!bill && hresNum) bill = billDataMap.get(`hres-${hresNum}`);
    // Normalized scan — handles "H. Res. 1335" (XML) vs "H.Res. 1335" (Whip) spacing mismatch
    if (!bill) {
        const norm = normalizeBillIdForRules(billId);
        for (const [key, val] of billDataMap) {
            if (normalizeBillIdForRules(key) === norm) { bill = val; break; }
        }
    }
    if (bill?.status === 'passed') return 'passed';
    if (bill?.status === 'failed') return 'failed';

    return 'pending';
}

// Format a vote result badge string for a completed/active circle.
function voteTlResultText(billId, status) {
    if (status === 'pending') return '';
    if (status === 'active') {
        const vc = floorData.voteCounts;
        if (vc) {
            return `VOTING ${vc.yeas || 0}–${vc.nays || 0}`;
        }
        return 'VOTING';
    }
    // passed/failed — find the vote counts from specialRulesMap, rollLog, or billDataMap
    const hresNum = billId?.match(/^H\.Res\.\s*(\d+)/i)?.[1];
    // For H.Res., specialRulesMap stores passageVote as "yeas-nays"
    if (hresNum) {
        for (const entry of specialRulesMap.values()) {
            if (String(entry.hresNum) === hresNum && entry.passageVote) {
                return `${status.toUpperCase()} ${entry.passageVote.replace('-', '–')}`;
            }
        }
    }
    const rlNorm = normalizeBillIdForRules(billId || '');
    for (const entry of rollLog) {
        const eq = entry.question || '';
        const eb = entry.bill || '';
        const combined = eq + (eb ? ' ' + eb : '');
        const em = combined.match(/(H\.J\.\s*Res\.|H\.Con\.\s*Res\.|H\.\s*Res\.|H\.R\.|S\.J\.\s*Res\.|S\.Con\.\s*Res\.|S\.\s*Res\.|S\.)\s*(\d+)/i);
        if (em && normalizeBillIdForRules(`${em[1]} ${em[2]}`) === rlNorm) {
            const y = entry.totals?.yeas || 0;
            const n = entry.totals?.nays || 0;
            if (y + n > 0) return `${status.toUpperCase()} ${y}–${n}`;
        }
    }
    // Fallback to billDataMap latestAction vote counts
    let bill = billId ? billDataMap.get(billId) : null;
    if (!bill && hresNum) bill = billDataMap.get(`hres-${hresNum}`);
    if (!bill && billId) {
        const norm = normalizeBillIdForRules(billId);
        for (const [key, val] of billDataMap) {
            if (normalizeBillIdForRules(key) === norm) { bill = val; break; }
        }
    }
    const m = (bill?.latestAction || '').match(/(\d+)-(\d+)/);
    if (m) return `${status.toUpperCase()} ${m[1]}–${m[2]}`;
    return status.toUpperCase();
}

// Returns { d, r, i } absences for a vote-timeline item, or null if unavailable.
// Active vote: live not_voting from current tally. Completed: from roll log.
function getVoteTlAbsences(billId, status) {
    if (status === 'pending') return null;
    if (status === 'active') {
        const vc = floorData?.voteCounts;
        if (!vc) return null;
        const d = Math.max(parseInt(vc.blue?.not_voting)   || 0, 0);
        const r = Math.max(parseInt(vc.red?.not_voting)    || 0, 0);
        const tNV = Math.max(parseInt(vc.totals?.not_voting) || 0, 0);
        const i = Math.max(tNV - d - r, 0);
        return { d, r, i };
    }
    // passed / failed — match against roll log
    if (!billId) return null;
    const billNorm = normalizeBillIdForRules(billId);
    for (const entry of rollLog) {
        // Search question first, then fall back to bill legisNum — same as applyRollLogToBills.
        // extractBillNormFromText allows spaces inside bill-type prefixes ("H. R." etc.)
        // and no-space formats ("H.R.3633") that DomeWatch sometimes returns.
        const qNorm = extractBillNormFromText(entry.question);
        const bNorm = extractBillNormFromText(entry.bill);
        if (qNorm !== billNorm && bNorm !== billNorm) continue;
        const d = entry.dem?.notVoting ?? null;
        const r = entry.rep?.notVoting ?? null;
        if (d !== null || r !== null) return { d: d ?? 0, r: r ?? 0, i: entry.ind?.notVoting ?? 0 };
    }
    return null;
}

// Build colored HTML for the absences badge. Safe — content is numbers only.
function buildAbsenceHtml(absences) {
    if (!absences) return '';
    const { d, r, i: rawI = 0 } = absences;
    const i = rawI;
    const total = (typeof d === 'number' && typeof r === 'number') ? d + r + i : null;
    let html = `<span class="absent-d">D ${d}</span> · <span class="absent-r">R ${r}</span>`;
    if (i > 0) html += ` · <span class="absent-i">I ${i}</span>`;
    if (total !== null) html += ` · ${total} absent`;
    return html;
}

// Re-render just the status circles/badges (called on every SSE vote.tally tick).
function updateVoteTimelineStatus() {
    const body = document.getElementById('vote-series-body');
    if (!body) return;
    const items = Array.from(body.querySelectorAll('.vote-tl-item'));
    const liveStatuses = [];
    items.forEach((item, idx) => {
        const billId = item.dataset.billId || null;
        const action = item.dataset.action || null;
        const status = getVoteTlStatus(billId, action);
        liveStatuses.push(status);
        const circle = item.querySelector('.vote-tl-circle');
        const result = item.querySelector('.vote-tl-result');
        if (circle) {
            circle.className = `vote-tl-circle ${status}`;
        }
        const text = voteTlResultText(billId, status);
        if (result) {
            result.className = `vote-tl-result ${status}`;
            result.textContent = text;
            result.style.display = text ? '' : 'none';
        } else if (text) {
            // Item was rendered as pending (no result span) — inject one now
            let badges = item.querySelector('.vote-tl-badges');
            if (!badges) {
                badges = document.createElement('div');
                badges.className = 'vote-tl-badges';
                item.querySelector('.vote-tl-content').appendChild(badges);
            }
            const span = document.createElement('span');
            span.className = `vote-tl-result ${status}`;
            span.textContent = text;
            badges.appendChild(span);
        }
        // Update absences badge
        const absences = getVoteTlAbsences(billId, status);
        const absHtml = buildAbsenceHtml(absences);
        const absEl = item.querySelector('.vote-tl-absences');
        if (absEl) {
            absEl.innerHTML = absHtml;
            absEl.style.display = absHtml ? '' : 'none';
        } else if (absHtml) {
            let badges = item.querySelector('.vote-tl-badges');
            if (!badges) {
                badges = document.createElement('div');
                badges.className = 'vote-tl-badges';
                item.querySelector('.vote-tl-content').appendChild(badges);
            }
            const span = document.createElement('span');
            span.className = 'vote-tl-absences';
            span.innerHTML = absHtml;
            badges.appendChild(span);
        }
    });
    // Once every vote has a terminal result the series is over — hide immediately
    // rather than waiting for the next full re-render (matches renderVoteTimeline).
    if (liveStatuses.length && liveStatuses.every(s => s === 'passed' || s === 'failed')) {
        currentVotesList = [];
        body.innerHTML = '<div class="whip-updates-loading">No active vote series.</div>';
        const subHeader = document.getElementById('vote-series-sub-header');
        if (subHeader) subHeader.hidden = true;
        return;
    }
    // Refresh connector-dotted classes based on updated statuses
    items.forEach((item, i) => {
        const nextStatus = liveStatuses[i + 1];
        const dotted = nextStatus !== undefined && (liveStatuses[i] === 'pending' || nextStatus === 'pending');
        item.classList.toggle('connector-dotted', dotted);
    });
}

// Build the display label and description for a vote-timeline item.
// Prefers billDataMap title over Whip raw text — cleaner and authoritative.
// Motion types (Motion to Commit, Previous Question, etc.) are appended
// when detectable from rollLog or the Whip text.
// Returns { label, desc, canOpenModal }.
function voteTlLabelAndDesc(billId, whipText, action) {
    const hresNum = billId?.match(/^H\.Res\.\s*(\d+)/i)?.[1];

    // Resolve the billDataMap entry — try direct, hres-XXXX, then normalized scan
    // to handle spacing differences between Whip text and schedule XML legisNum.
    let bill = billId ? billDataMap.get(billId) : null;
    if (!bill && hresNum) bill = billDataMap.get(`hres-${hresNum}`);
    if (!bill && billId) {
        const norm = normalizeBillIdForRules(billId);
        for (const [key, val] of billDataMap) {
            if (normalizeBillIdForRules(key) === norm) { bill = val; break; }
        }
    }

    // Build label — bill ID first, qualifier in parens
    // e.g. "H.Res. 1335 (Adoption)", "H.R. 9238 (Suspend the Rules and Pass)"
    const baseLabel = billId || whipText.split(/\s[–\-]\s/)[0].trim();
    const ACTION_QUALIFIER_MAP = {
        'suspension':           'Suspend the Rules and Pass',
        'senate amendment':     'Senate Amendment',
        'final passage':        'Final Passage',
        'adoption':             'Adoption',
        'passage':              'Passage',
        'consideration':        'Consideration',
        'amendment to rule':    'Amendment to Rule',
        'previous question':    'Previous Question',
        'motion to recommit':   'Motion to Recommit',
        'motion to commit':     'Motion to Commit',
        'motion to discharge':  'Motion to Discharge',
        'motion to table':      'Motion to Table',
        'motion to refer':      'Motion to Refer',
    };
    const actionQualifier = action ? (ACTION_QUALIFIER_MAP[action.toLowerCase()] || null) : null;
    const label = actionQualifier ? `${baseLabel} (${actionQualifier})` : baseLabel;

    // Primary description: bill title from billDataMap
    let desc = bill?.title || '';

    // For H.Res. with no billDataMap entry, check specialRulesMap for context
    if (!desc && hresNum) {
        for (const [key, entry] of specialRulesMap.entries()) {
            if (String(entry.hresNum) === hresNum) {
                desc = `Rule for ${key}`;
                break;
            }
        }
    }

    // Fall back to cleaned Whip text (strip bill ID prefix, duration, connectors)
    if (!desc) {
        desc = whipText
            .replace(/^(H\.J\.Res\.|H\.Con\.Res\.|H\.Res\.|H\.R\.|S\.J\.Res\.|S\.Con\.Res\.|S\.Res\.|S\.)\s*\d+\s*[–\-]?\s*/i, '')
            .replace(/\s*[–\-]\s*\d+\s*min(?:utes?)?/gi, '')
            .replace(/\s*following this vote.*$/is, '')
            .trim();
    }

    // If the action qualifier already covers the motion type (e.g. "Motion to Recommit"),
    // skip the motionKeywords scan — avoids duplicating it in both label and desc.
    // Still run the scan if action is a procedural qualifier (passage/adoption/suspension)
    // so that any motion embedded in the rollLog question still surfaces in desc.
    const actionIsMotion = actionQualifier && /motion|previous question/i.test(actionQualifier);
    if (!actionIsMotion) {
        const motionKeywords = [
            [/motion\s+to\s+recommit/i,          'Motion to Recommit'],
            [/motion\s+to\s+(?:re)?commit/i,      'Motion to Commit'],
            [/previous\s+question/i,              'Previous Question'],
            [/motion\s+to\s+table/i,              'Motion to Table'],
            [/motion\s+to\s+discharge/i,          'Motion to Discharge'],
            [/motion\s+to\s+refer/i,              'Motion to Refer'],
        ];
        let motion = '';
        const billNormMK = normalizeBillIdForRules(billId || '');
        for (const entry of rollLog) {
            const eq = entry.question || '';
            const eb = entry.bill || '';
            const em = (eq + ' ' + eb).match(/(H\.J\.\s*Res\.|H\.Con\.\s*Res\.|H\.\s*Res\.|H\.R\.|S\.J\.\s*Res\.|S\.Con\.\s*Res\.|S\.\s*Res\.|S\.)\s*(\d+)/i);
            if (em && normalizeBillIdForRules(`${em[1]} ${em[2]}`) === billNormMK) {
                for (const [re, lbl] of motionKeywords) {
                    if (re.test(eq)) { motion = lbl; break; }
                }
                break;
            }
        }
        if (!motion) {
            for (const [re, lbl] of motionKeywords) {
                if (re.test(whipText)) { motion = lbl; break; }
            }
        }
        if (motion && desc && !desc.toLowerCase().includes(motion.toLowerCase())) {
            desc = `${motion} — ${desc}`;
        } else if (motion && !desc) {
            desc = motion;
        }
    }

    return { label, desc };
}

// Convert an hour+minute in America/New_York to a UTC Date,
// anchored to the same ET calendar day as refDate.
function etHMtoDate(h24, min, refDate) {
    // Get a Date object whose getHours()/getMinutes() return ET wall time
    const etRef = new Date(refDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    // Compute the UTC↔ET offset at refDate
    const offsetMs = refDate.getTime() - etRef.getTime();
    // Build target ET time on the same day
    const target = new Date(etRef);
    target.setHours(h24, min, 0, 0);
    return new Date(target.getTime() + offsetMs);
}

// Parse vote-series notice metadata: start time, live flag, total est. duration, end time.
function parseVoteSeriesMeta(currentItem, allVotes) {
    const div = document.createElement('div');
    div.innerHTML = currentItem.body || '';
    const text = div.textContent;
    const ref = currentItem.publishedAt ? new Date(currentItem.publishedAt) : new Date();

    // Detect "the House is now taking the following vote(s)"
    const isLive = /the\s+house\s+is\s+now\s+taking\b/i.test(text);

    // Parse "At approximately H:MM [– H:MM] a.m./p.m."
    let approxStart = null;
    const mTime = text.match(
        /at\s+approximately\s+(\d{1,2}):(\d{2})\s*(?:[-–—]\s*\d{1,2}:\d{2})?\s*(a\.m\.|p\.m\.)/i
    );
    if (mTime) {
        let h = parseInt(mTime[1], 10);
        const mn = parseInt(mTime[2], 10);
        if (/p\.m\./i.test(mTime[3]) && h < 12) h += 12;
        if (/a\.m\./i.test(mTime[3]) && h === 12) h = 0;
        approxStart = etHMtoDate(h, mn, ref);
    }

    // Total estimate: first vote doubled (travel time), rest as listed
    let totalMin = 0;
    allVotes.forEach((v, i) => {
        const d = v.duration ? parseInt(v.duration, 10) : 0;
        totalMin += (i === 0) ? d * 2 : d;
    });

    // End time anchored to: approxStart (pre-vote) or publishedAt (live/unknown)
    const baseDate = approxStart || ref;
    const endTime = totalMin > 0 ? new Date(baseDate.getTime() + totalMin * 60000) : null;

    return { isLive, approxStart, totalMin, endTime };
}

// Render the full vote-series timeline from the latest matching notice.
function renderVoteTimeline(items) {
    const body = document.getElementById('vote-series-body');
    const subHeader = document.getElementById('vote-series-sub-header');
    const subStatus = document.getElementById('vote-series-sub-status');
    const subTiming = document.getElementById('vote-series-sub-timing');
    if (!body) return;

    const hideSubHeader = () => { if (subHeader) subHeader.hidden = true; };

    // Always use the MOST RECENT matching notice as the authoritative list
    // (stale high-vote-count notices from earlier series must not win).
    // Then look back up to 90 minutes to find bills that appeared in the
    // previous notice but were dropped once they completed — that way a
    // follow-up "1 vote" notice doesn't erase already-voted items.
    const seriesItems = items.filter(item => VOTE_SERIES_RE.test(item.title));
    if (!seriesItems.length) {
        body.innerHTML = '<div class="whip-updates-loading">No vote series announced yet.</div>';
        hideSubHeader();
        return;
    }
    const currentItem = seriesItems[0]; // newest-first from Firestore

    const currentVotes = parseVoteItemsFromHtml(currentItem.body);
    const currentBillSet = new Set(currentVotes.map(v => v.billId).filter(Boolean));

    // Scan older notices within 90 min for bills since completed & dropped
    const LOOKBACK_MS = 90 * 60 * 1000;
    const baseTime = currentItem.publishedAt ? new Date(currentItem.publishedAt).getTime() : Date.now();
    const completedVotes = [];
    for (let i = 1; i < seriesItems.length; i++) {
        const prev = seriesItems[i];
        if (!prev.publishedAt) continue;
        if (baseTime - new Date(prev.publishedAt).getTime() > LOOKBACK_MS) break;
        for (const vote of parseVoteItemsFromHtml(prev.body)) {
            if (vote.billId && !currentBillSet.has(vote.billId)) {
                completedVotes.push(vote);
                currentBillSet.add(vote.billId);
            }
        }
    }

    // Completed (older) votes come first in the timeline; current/pending after
    const votes = [...completedVotes, ...currentVotes];
    if (votes.length === 0) {
        body.innerHTML = '<div class="whip-updates-loading">No votes listed in notice.</div>';
        hideSubHeader();
        return;
    }

    // Hide the section once the most-recent series is no longer useful:
    //  (a) every vote has a terminal result (all passed/failed) — the series concluded; or
    //  (b) it's stale — the latest notice is too old to be the current session's series
    //      (its roll-log data may also have been purged, which would render blank circles).
    // Staleness is measured in elapsed time (not calendar day) so an overnight series
    // posted the previous night still shows the next morning.
    const statuses = votes.map(({ billId, action }) => getVoteTlStatus(billId, action));
    const meta = parseVoteSeriesMeta(currentItem, votes);
    const allComplete = statuses.every(s => s === 'passed' || s === 'failed');
    // Anchor staleness to elapsed time, NOT meta.isLive: a notice's "the House is now
    // taking..." text is frozen, so an 11-day-old series still parses as isLive — the very
    // case we must hide. A genuinely live series is inherently recent, so the time window
    // alone correctly keeps it visible.
    const staleAnchor = meta.endTime || (currentItem.publishedAt ? new Date(currentItem.publishedAt) : null);
    const VOTE_SERIES_STALE_MS = 12 * 60 * 60 * 1000; // hide ~12h after the series' estimated end
    const isStale = staleAnchor && (Date.now() - staleAnchor.getTime() > VOTE_SERIES_STALE_MS);
    if (allComplete || isStale) {
        currentVotesList = [];
        body.innerHTML = '<div class="whip-updates-loading">No active vote series.</div>';
        hideSubHeader();
        return;
    }

    // ── Secondary header ─────────────────────────────────────────────────────
    if (subHeader && subStatus && subTiming) {
        const { isLive, approxStart, totalMin, endTime } = meta;
        const etFmt = (d, opts) => d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', ...opts });

        // Left: status message
        if (isLive) {
            const word = votes.length === 1 ? 'vote' : 'votes';
            subStatus.textContent = `The House is now taking the following ${word}:`;
        } else if (approxStart) {
            subStatus.textContent = `Est. start: ${etFmt(approxStart, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}`;
        } else {
            subStatus.textContent = '';
        }

        // Right: update time (precise) + est. total + est. end
        const timingParts = [];
        if (currentItem.publishedAt) {
            const upd = etFmt(new Date(currentItem.publishedAt), {
                hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZoneName: 'short'
            });
            timingParts.push(`Updated ${upd}`);
        }
        if (totalMin > 0) timingParts.push(`~${totalMin} min`);
        if (endTime) {
            timingParts.push(`Est. end ~${etFmt(endTime, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}`);
        }
        subTiming.textContent = timingParts.join(' · ');

        subHeader.hidden = !(subStatus.textContent || subTiming.textContent);
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Store for vote-recs modal access
    currentVotesList = votes;

    const itemsHtml = votes.map(({ text, billId, duration, action }, i) => {
        const status = statuses[i];
        const nextStatus = statuses[i + 1];
        // Dotted connector when this item or the next is pending
        const connectorDotted = nextStatus !== undefined && (status === 'pending' || nextStatus === 'pending');
        const resultText = voteTlResultText(billId, status);
        const absences = getVoteTlAbsences(billId, status);
        const absHtml = buildAbsenceHtml(absences);
        const { label: billLabel, desc } = voteTlLabelAndDesc(billId, text, action);
        const billAttr = billId ? ` data-bill-id="${escapeHtml(billId)}"` : '';
        const actionAttr = action ? ` data-action="${escapeHtml(action)}"` : '';
        const extraClass = connectorDotted ? ' connector-dotted' : '';
        const hasBadges = duration || resultText || absHtml;
        return `
            <div class="vote-tl-item${extraClass}"${billAttr}${actionAttr}>
                <div class="vote-tl-circle ${status}"><span class="vote-tl-num">${i + 1}</span></div>
                <div class="vote-tl-content">
                    <div class="vote-tl-bill"${billId ? ` onclick="openBillModal('${escapeHtml(billId)}')"` : ''}>${escapeHtml(billLabel)}</div>
                    ${desc ? `<div class="vote-tl-desc">${escapeHtml(desc)}</div>` : ''}
                    ${hasBadges ? `<div class="vote-tl-badges">
                        ${duration ? `<span class="vote-tl-duration">${escapeHtml(duration)}</span>` : ''}
                        ${resultText ? `<span class="vote-tl-result ${status}">${escapeHtml(resultText)}</span>` : ''}
                        ${absHtml ? `<span class="vote-tl-absences">${absHtml}</span>` : ''}
                    </div>` : ''}
                </div>
            </div>`;
    }).join('');

    body.innerHTML = `<div class="vote-tl-items">${itemsHtml}</div>`;
}

// Build the Dem Whip recommendation tag for a bill, or '' if none.
function whipRecTagHtml(billId) {
    const rec = whipRecMap.get(normalizeBillIdForRules(billId));
    if (!rec || (rec.recommendation !== 'YES' && rec.recommendation !== 'NO')) return '';
    const dir = rec.recommendation === 'YES' ? 'yes' : 'no';
    const conf = (rec.confidence || '').toLowerCase();
    const confShort = conf === 'high' ? 'high' : conf === 'medium' ? 'med' : conf === 'low' ? 'low' : '';
    const title = `House Democratic Whip recommends voting ${rec.recommendation}` +
        (conf ? ` (${conf} confidence)` : '') + ' — source: DomeWatch';
    return `<span class="whip-tag" title="${title}">` +
        `<span class="whip-tag-label">DEM WHIP</span>` +
        `<span class="whip-tag-rec whip-${dir}">${rec.recommendation}</span>` +
        `</span>`;
}

// ── Vote Recs Modal ──────────────────────────────────────────────────────────

// Compare two pref objects key-by-key.
function prefsMatch(a, b) {
    return ['followWhip', 'pq', 'rule', 'ruleMeasures', 'suspensions', 'mtr']
        .every(k => a[k] === b[k]);
}

// Return which preset ('nothing'|'D'|'R'|'custom') the current prefs match.
function computeCurrentPreset() {
    const nothing = { followWhip: null, pq: null, rule: null, ruleMeasures: null, suspensions: null, mtr: null };
    if (prefsMatch(voteRecsPrefs, nothing))        return 'nothing';
    if (prefsMatch(voteRecsPrefs, getPartyPrefs('D'))) return 'D';
    if (prefsMatch(voteRecsPrefs, getPartyPrefs('R'))) return 'R';
    return 'custom';
}

// Reflect voteRecsPreset in the switcher buttons and show/hide the verify note.
function syncPresetButtons() {
    document.querySelectorAll('#vrec-preset-switcher .bills-sort-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === voteRecsPreset);
    });
    const note = document.getElementById('vrec-autofill-note');
    if (note) note.hidden = (voteRecsPreset === 'nothing');
}

function voteRecKey(billId, action, text) {
    return (billId || text || '') + '|' + (action || '');
}

function getWhipRecFor(billId) {
    if (!billId) return null;
    const rec = whipRecMap.get(normalizeBillIdForRules(billId));
    if (!rec || (rec.recommendation !== 'YES' && rec.recommendation !== 'NO')) return null;
    return rec.recommendation; // 'YES' or 'NO'
}

// Return the party preset preference object for 'D' or 'R',
// accounting for current majority/minority roles.
function getPartyPrefs(party) {
    const isMajority = party === HOUSE_MAJORITY_PARTY;
    if (party === 'D') {
        // Follow Dem Whip recs where available; other positions by role
        return isMajority
            ? { followWhip: 'follow', pq: 'YES', rule: 'YES', ruleMeasures: 'YES', suspensions: 'YES', mtr: 'NO'  }
            : { followWhip: 'follow', pq: 'NO',  rule: 'NO',  ruleMeasures: 'NO',  suspensions: 'YES', mtr: 'YES' };
    }
    if (party === 'R') {
        // Oppose Dem Whip by default (Republicans vote against Dem Whip position)
        return isMajority
            ? { followWhip: 'oppose', pq: 'YES', rule: 'YES', ruleMeasures: 'YES', suspensions: 'YES', mtr: 'NO'  }
            : { followWhip: 'oppose', pq: 'NO',  rule: 'NO',  ruleMeasures: 'NO',  suspensions: 'YES', mtr: 'YES' };
    }
    return { followWhip: null, pq: null, rule: null, ruleMeasures: null, suspensions: null, mtr: null };
}

// Derive the auto-fill vote for one item from current prefs.
function applyPrefsToVote(billId, action) {
    const p = voteRecsPrefs;
    // Dem Whip rec takes priority when followWhip is 'follow'
    if (p.followWhip === 'follow' && billId) {
        const whipRec = getWhipRecFor(billId);
        if (whipRec) return whipRec;
    }
    // Flip Dem Whip rec when followWhip is 'oppose'
    if (p.followWhip === 'oppose' && billId) {
        const whipRec = getWhipRecFor(billId);
        if (whipRec) return whipRec === 'YES' ? 'NO' : 'YES';
    }
    // Map vote action to pref bucket
    switch (action) {
        case 'previous question':  return p.pq;
        case 'adoption':           return p.rule;        // Rule H.Res. adoption
        case 'consideration':      return p.rule;        // Considering the rule
        case 'amendment to rule':  return p.rule;
        case 'passage':
        case 'final passage':
        case 'senate amendment':   return p.ruleMeasures;
        case 'suspension':         return p.suspensions;
        case 'motion to recommit':
        case 'motion to commit':   return p.mtr;
        default:
            // null action + billId → assume rule measure
            return billId ? p.ruleMeasures : null;
    }
}

// Re-apply current prefs to all entries in voteRecsMap (overwrites vote, keeps note).
function applyVoteRecsAutoFill() {
    for (const { billId, text, action } of currentVotesList) {
        const key = voteRecKey(billId, action, text);
        const entry = voteRecsMap.get(key) || { vote: null, note: '' };
        entry.vote = applyPrefsToVote(billId, action);
        voteRecsMap.set(key, entry);
    }
}

// ── Prefs panel ──────────────────────────────────────────────────────────────

// Canonical string representation of a pref value for data-pref-val matching.
function prefValToStr(val) {
    if (val === null || val === undefined) return 'null';
    return String(val); // 'YES', 'NO', 'PRESENT', 'follow', 'oppose'
}

// Surgically toggle active classes on pref toggle buttons without re-rendering DOM.
// Called by setVrecPref() so pref clicks never teardown/rebuild any HTML.
function updatePrefToggles() {
    const body = document.getElementById('vrec-prefs-body');
    if (!body) return;
    body.querySelectorAll('[data-pref-key]').forEach(container => {
        const prefKey = container.dataset.prefKey;
        const valStr = prefValToStr(voteRecsPrefs[prefKey]);
        container.querySelectorAll('.bills-sort-btn[data-pref-val]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.prefVal === valStr);
        });
    });
}

// Full re-render of the prefs panel (called on modal open and preset changes only).
function renderVoteRecsPrefs() {
    const body = document.getElementById('vrec-prefs-body');
    if (!body) return;
    const p = voteRecsPrefs;

    function prefToggle(prefKey, label) {
        const valStr = prefValToStr(p[prefKey]);
        const cls = dv => dv === valStr ? ' active' : '';
        const k = escapeHtml(prefKey);
        return `<div class="vrec-pref-row">
            <span class="vrec-pref-label">${label}</span>
            <div class="bills-sort-switcher" data-pref-key="${k}">
                <button class="bills-sort-btn${cls('null')}"    data-pref-val="null"    onclick="setVrecPref('${k}',null)"     >—</button>
                <button class="bills-sort-btn${cls('YES')}"     data-pref-val="YES"     onclick="setVrecPref('${k}','YES')"    >Yes</button>
                <button class="bills-sort-btn${cls('NO')}"      data-pref-val="NO"      onclick="setVrecPref('${k}','NO')"     >No</button>
                <button class="bills-sort-btn${cls('PRESENT')}" data-pref-val="PRESENT" onclick="setVrecPref('${k}','PRESENT')">Pres</button>
            </div>
        </div>`;
    }

    // followWhip: null=—, 'follow'=Follow, 'oppose'=Oppose
    const fwStr = prefValToStr(p.followWhip);
    const fwCls = dv => dv === fwStr ? ' active' : '';

    body.innerHTML = `
        <div class="vrec-follow-whip-row">
            <span class="vrec-pref-label">Dem Whip</span>
            <div class="bills-sort-switcher" data-pref-key="followWhip">
                <button class="bills-sort-btn${fwCls('null')}"   data-pref-val="null"   onclick="setVrecPref('followWhip',null)"     >—</button>
                <button class="bills-sort-btn${fwCls('follow')}" data-pref-val="follow" onclick="setVrecPref('followWhip','follow')" >Follow</button>
                <button class="bills-sort-btn${fwCls('oppose')}" data-pref-val="oppose" onclick="setVrecPref('followWhip','oppose')" >Oppose</button>
            </div>
        </div>
        ${prefToggle('pq',           'Previous Question')}
        ${prefToggle('rule',         'Rule adoption')}
        ${prefToggle('ruleMeasures', 'Rule measures')}
        ${prefToggle('suspensions',  'Suspensions')}
        ${prefToggle('mtr',          'Recommit / Commit')}`;
}

// Called by pref toggle buttons. Saves the pref, re-applies auto-fill to all rows,
// and surgically updates both the row buttons and pref toggles.
function setVrecPref(prefKey, val) {
    if (val === 'null') val = null; // safety: HTML attribute string → real null
    voteRecsPrefs[prefKey] = val;
    localStorage.setItem('voteRecsPrefs', JSON.stringify(voteRecsPrefs));
    voteRecsPreset = computeCurrentPreset();
    localStorage.setItem('voteRecsPreset', voteRecsPreset);
    applyVoteRecsAutoFill();
    syncPresetButtons();
    updatePrefToggles();
    updateAllRowButtons();
}

// Surgically update every row's selection indicator from voteRecsMap.
// Sets data-sel on the .vrec-vote-btns container; CSS does the styling.
// No class manipulation — can't be silently cleared by any re-render side effect.
function updateAllRowButtons() {
    const body = document.getElementById('vrec-body');
    if (!body) return;
    body.querySelectorAll('.vrec-row').forEach(row => {
        const key = row.dataset.vrecKey;
        const entry = voteRecsMap.get(key) || { vote: null, note: '' };
        const btns = row.querySelector('.vrec-vote-btns');
        if (btns) btns.dataset.sel = entry.vote || '';
    });
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function renderVoteRecsRows() {
    const body = document.getElementById('vrec-body');
    if (!body) return;
    if (!currentVotesList.length) {
        body.innerHTML = '<div style="padding:20px 24px;color:var(--text-muted);font-family:var(--font-mono);font-size:var(--fs-base);">No votes in current series.</div>';
        return;
    }
    body.innerHTML = currentVotesList.map(({ billId, text, action }, i) => {
        const key = voteRecKey(billId, action, text);
        const entry = voteRecsMap.get(key) || { vote: null, note: '' };
        const { label } = voteTlLabelAndDesc(billId, text, action);
        const whipRec = getWhipRecFor(billId);
        const whipChip = whipRec
            ? `<span class="vrec-whip-chip vrec-whip-${whipRec.toLowerCase()}">DEM WHIP: ${whipRec}</span>`
            : '';
        const safeKey = escapeHtml(key);
        // Label is clickable if there's a bill to look up
        const labelEl = billId
            ? `<button class="vrec-row-label clickable" onclick="openBillModal('${escapeHtml(billId)}')">${escapeHtml(label)}</button>`
            : `<span class="vrec-row-label">${escapeHtml(label)}</span>`;
        // data-sel on the container drives the CSS highlight — no sel-* classes needed
        return `<div class="vrec-row" data-vrec-key="${safeKey}">
            <div class="vrec-row-top">
                <span class="vrec-row-num">${i + 1}.</span>
                ${labelEl}
                ${whipChip}
            </div>
            <div class="vrec-vote-btns" data-sel="${escapeHtml(entry.vote || '')}">
                <button class="vrec-vote-btn" data-vote="YES"     onclick="setVoteRec('${safeKey}','YES')">YES</button>
                <button class="vrec-vote-btn" data-vote="NO"      onclick="setVoteRec('${safeKey}','NO')">NO</button>
                <button class="vrec-vote-btn" data-vote="PRESENT" onclick="setVoteRec('${safeKey}','PRESENT')">PRESENT</button>
                <button class="vrec-vote-btn" data-vote=""        onclick="setVoteRec('${safeKey}',null)">—</button>
            </div>
            <input class="vrec-note-input" type="text" placeholder="Note (optional)"
                value="${escapeHtml(entry.note || '')}"
                oninput="setVoteRecNote('${safeKey}', this.value)">
        </div>`;
    }).join('');
}

function setVoteRec(key, vote) {
    const entry = voteRecsMap.get(key) || { vote: null, note: '' };
    entry.vote = vote;
    voteRecsMap.set(key, entry);
    // Set data-sel on the button group container — CSS does the rest.
    // Using data attribute means no class list to accidentally clear.
    const row = document.querySelector(`.vrec-row[data-vrec-key="${CSS.escape(key)}"]`);
    if (row) {
        const btns = row.querySelector('.vrec-vote-btns');
        if (btns) btns.dataset.sel = vote || '';
    }
}

function setVoteRecNote(key, note) {
    const entry = voteRecsMap.get(key) || { vote: null, note: '' };
    entry.note = note;
    voteRecsMap.set(key, entry);
}

// ── Preset buttons (Nothing / D / R) ─────────────────────────────────────────

function setVoteRecsPreset(preset) {
    if (preset === 'custom') return; // auto-derived; clicking it is a no-op

    voteRecsPreset = preset;
    localStorage.setItem('voteRecsPreset', preset);

    if (preset === 'nothing') {
        // Clear all prefs and blank all votes (preserve notes)
        voteRecsPrefs = { followWhip: null, pq: null, rule: null, ruleMeasures: null, suspensions: null, mtr: null };
        for (const [, entry] of voteRecsMap) { entry.vote = null; }
    } else {
        voteRecsPrefs = getPartyPrefs(preset);
        applyVoteRecsAutoFill();
    }
    localStorage.setItem('voteRecsPrefs', JSON.stringify(voteRecsPrefs));

    syncPresetButtons();
    renderVoteRecsPrefs();
    updateAllRowButtons(); // surgical — keeps note fields intact
}

// ── Open / close ─────────────────────────────────────────────────────────────

function openVoteRecsModal() {
    const overlay = document.getElementById('vrec-overlay');
    if (!overlay) return;

    // Initialize entries for any new votes (preserve existing notes/votes)
    for (const { billId, text, action } of currentVotesList) {
        const key = voteRecKey(billId, action, text);
        if (!voteRecsMap.has(key)) {
            voteRecsMap.set(key, { vote: applyPrefsToVote(billId, action), note: '' });
        }
    }

    syncPresetButtons();
    renderVoteRecsPrefs();
    renderVoteRecsRows();
    overlay.removeAttribute('hidden');
    overlay.onclick = e => { if (e.target === overlay) closeVoteRecsModal(); };
    document.addEventListener('keydown', _vrecEscHandler);

    // Push hash so the modal survives reload and can be shared
    if (location.hash !== '#build-vote-recs') {
        history.pushState(null, '', '#build-vote-recs');
    }
}

function closeVoteRecsModal() {
    const overlay = document.getElementById('vrec-overlay');
    if (!overlay || overlay.hasAttribute('hidden')) return;
    overlay.setAttribute('hidden', '');
    document.removeEventListener('keydown', _vrecEscHandler);
    // Remove hash when modal is closed
    if (location.hash === '#build-vote-recs') {
        history.pushState(null, '', location.pathname + location.search);
    }
}

function _vrecEscHandler(e) {
    if (e.key === 'Escape') closeVoteRecsModal();
}

function exportVoteRecs() {
    const lines = ['VOTE RECS', ''];
    currentVotesList.forEach(({ billId, text, action }, i) => {
        const key = voteRecKey(billId, action, text);
        const entry = voteRecsMap.get(key) || { vote: null, note: '' };
        const { label } = voteTlLabelAndDesc(billId, text, action);
        const voteStr = entry.vote || '—';
        const notePart = entry.note ? ` (note: ${entry.note})` : '';
        lines.push(`${i + 1}. ${label}: ${voteStr}${notePart}`);
    });
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('vrec-export-btn');
        if (!btn) return;
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
    }).catch(() => {
        // Fallback: select text from a temporary textarea
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    });
}

// ── Rice Index of Cohesion ──────────────────────────────────────────────────
// Parses the bill's latestAction/statusText for a vote score.
// Voice/unanimous → 1.0. Recorded vote "X-Y" → |X-Y|/(X+Y). No data → null.
function computeRiceIndex(bill) {
    // Use bill.committeeReport — the formatted committee-vote string the worker extracts
    // from Congress.gov action history. Possible values:
    //   "Reported by Committee (voice vote)"
    //   "Reported out of cmte by unanimous consent"
    //   "Reported by Committee 28 – 16"
    //   "Reported by Committee"  (no vote data → null)
    const text = (bill.committeeReport || '').trim();
    if (!text) return null;
    if (/voice vote|without objection|unanimous/i.test(text)) return 1.0;
    // No colon needed — the formatted text is just "... X – Y"
    const m = text.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        if (a + b >= 5) return Math.abs(a - b) / (a + b);
    }
    return null;
}

// HSL color for a Rice value: 0 = red (hue 0°), 1 = green (hue 120°)
function riceIndexColor(rice) {
    const hue = Math.round(rice * 120);
    const lum = rice > 0.65 ? 44 : 55;
    return `hsl(${hue},60%,${lum}%)`;
}

// Sort mode: 'status' (default) | 'listed'
let billsSortMode = 'status';

const BILL_STATUS_SORT_ORDER = { scheduled: 0, 'roll-call': 1, passed: 2, failed: 2, postponed: 2 };

// Amendment sort mode: 'status' | 'listed'
let amendmentsSortMode = 'status';
// Made-in-order/adopted first (most actionable), pending middle, withdrawn/failed last
const AMENDMENT_STATUS_SORT_ORDER = { adopted: 0, submitted: 1, failed: 2 };
// Amendment party filter: 'all' | 'rep' | 'dem' | 'bipartisan'
let amendmentsPartyFilter = 'all';
// Amendment member filter: null = no filter, string = only amendments with this sponsor
let amendmentsMemberFilter = null;
// Amendment text search query
let amendmentsSearchQuery = '';

function sortBillsForDisplay(bills) {
    const indexed = bills.map((b, i) => ({ ...b, _origIdx: b._origIdx ?? i }));
    if (billsSortMode === 'status') {
        return indexed.sort((a, b) => {
            const pa = BILL_STATUS_SORT_ORDER[a.status] ?? 0;
            const pb = BILL_STATUS_SORT_ORDER[b.status] ?? 0;
            if (pa !== pb) return pa - pb;
            return a._origIdx - b._origIdx;
        });
    }
    return indexed.sort((a, b) => a._origIdx - b._origIdx);
}

let billsData = {
    ruleBills: [],
    suspensionBills: [],
    mayBeConsideredBills: [],
    rawHeaders: null,
    lastUpdated: null
};
const BLUESKY_CONFIG = {
    workerUrl: 'https://api.evanhollander.org/house-floor/api/bluesky',
    refreshInterval: 180000 // 3 minutes — KV-cached at 2 min; Cloakroom posts don't arrive faster than this
};


// Bills This Week Functions
// True after the first successful full fetch (with Congress.gov enrichment).
// Subsequent calls use ?quick=1 and preserve enrichment fields from the initial load.
let billsFullyEnriched = false;

// Merge incoming bill data with what we already have locally.
// Rules:
//  1. Never downgrade a higher-priority status (e.g. passed → scheduled).
//  2. When enrichment is partial (quick-mode server response), carry over
//     Congress.gov fields (summary, sponsor, committees) from the previous state.
const STATUS_PRIORITY = { passed: 4, failed: 4, 'roll-call': 3, postponed: 2, scheduled: 1 };
function mergeBills(newArr, existingArr, isQuick = false) {
    const byId = Object.fromEntries((existingArr || []).map(b => [b.id, b]));
    return (newArr || []).map((bill, i) => {
        const prev = byId[bill.id];
        // Stamp committeeAction on first arrival so floor-vote rewrites to latestAction never clobber it
        if (!prev) return { ...bill, committeeAction: bill.latestAction || '', _origIdx: i };

        const keepOldStatus = (STATUS_PRIORITY[prev.status] || 0) > (STATUS_PRIORITY[bill.status] || 0);
        const statusFields = keepOldStatus
            ? { status: prev.status, latestAction: prev.latestAction, considered: prev.considered,
                actionSource: prev.actionSource, actionSourceUrl: prev.actionSourceUrl,
                latestActionDate: prev.latestActionDate }
            : {};

        const enrichment = isQuick ? {
            summary:             bill.summary             ?? prev.summary,
            sponsor:             bill.sponsor             ?? prev.sponsor,
            cosponsors:          bill.cosponsors          ?? prev.cosponsors,
            committees:          bill.committees          ?? prev.committees,
            committeeReport:     bill.committeeReport     ?? prev.committeeReport,
            committeeReportDate: bill.committeeReportDate ?? prev.committeeReportDate,
        } : {};

        // Always carry forward a stored MTR outcome — it won't come back from the API
        const mtrField = bill.mtr ?? prev.mtr ? { mtr: bill.mtr ?? prev.mtr } : {};

        return { ...bill, ...enrichment, ...statusFields, ...mtrField,
                 committeeAction: prev.committeeAction || bill.latestAction || '',
                 _origIdx: i };
    });
}

// Apply a combined bills+rules+whip payload (from either an initial fetch or an
// SSE push from the DO). Handles all merge/override logic in one place.
function applyBillsData({ bills: data, rules: rulesData, whip: whipData }, isQuick = false) {
    if (!data) return;

    billsData = {
        ruleBills:            mergeBills(data.ruleBills,            billsData.ruleBills,            isQuick),
        suspensionBills:      mergeBills(data.suspensionBills,      billsData.suspensionBills,      isQuick),
        mayBeConsideredBills: mergeBills(data.mayBeConsideredBills, billsData.mayBeConsideredBills, isQuick),
        rawHeaders:  data.rawHeaders  || billsData.rawHeaders  || null,
        lastUpdated: data.lastUpdated || new Date(),
        weekDate:    data.weekDate    || billsData.weekDate    || 'No current week bills available'
    };

    if (!isQuick) billsFullyEnriched = true;

    // Apply rules — preserve any in-memory ruleStatus overrides set by reconcileVoteWithBills
    if (rulesData) {
        const ruleStatusOverrides = new Map();
        for (const entry of specialRulesMap.values()) {
            if ((entry.ruleStatus === 'passed' || entry.ruleStatus === 'failed') &&
                !ruleStatusOverrides.has(entry.hresNum)) {
                ruleStatusOverrides.set(entry.hresNum, { ruleStatus: entry.ruleStatus, passageVote: entry.passageVote });
            }
        }
        specialRulesMap.clear();
        for (const rule of (rulesData.rules || [])) {
            const override = ruleStatusOverrides.get(rule.hresNum);
            for (const billKey of rule.bills) {
                specialRulesMap.set(billKey, {
                    hres: rule.hres, hresNum: rule.hresNum, title: rule.title || null,
                    passageVote: override?.passageVote ?? rule.passageVote ?? null,
                    pdfUrl: rule.pdfUrl, ruleStatus: override?.ruleStatus ?? rule.ruleStatus,
                    bills: rule.bills, sponsor: rule.sponsor || null,
                });
            }
        }
    }

    // Apply whip recs
    if (whipData) {
        whipRecMap.clear();
        for (const [key, rec] of Object.entries(whipData.recs || {})) {
            whipRecMap.set(key, rec);
        }
    }

    // Apply any completed roll results from the roll log (catches missed transitions)
    const activeRoll = floorData?.rollCall?.number ? String(floorData.rollCall.number) : null;
    applyRollLogToBills(rollLog, activeRoll);

    // Restore MTR outcomes from localStorage (survives page reloads & daily proceedings rollover)
    loadMtrFromStorage();
    applyStoredMtrToBills();

    updateBillsDisplay();

    // Backfill MTR outcomes from past proceedings (runs once after first bills load)
    if (!backfillMtrFromProceedings._done) {
        backfillMtrFromProceedings._done = true;
        backfillMtrFromProceedings();
    }
    if (proceedingsData.length) updateDebateSection(proceedingsData);
}

async function fetchBillsThisWeek() {
    try {
        // Quick mode: skip Congress.gov enrichment on repeat fetches — DO SSE handles those.
        const isQuick = billsFullyEnriched;
        let billsUrl = proceedingsDateOverride
            ? `${BILLS_CONFIG.workerUrl}?date=${encodeURIComponent(proceedingsDateOverride)}`
            : BILLS_CONFIG.workerUrl;
        if (isQuick) billsUrl += (billsUrl.includes('?') ? '&' : '?') + 'quick=1';

        // rules + whip-notices delivered via SSE event: bills — fetch bills only here.
        // This path is only reached for date overrides (setDate/clearDate).
        const billsResp = await fetch(billsUrl);
        const data = billsResp.ok ? await billsResp.json() : null;

        if (!data || data.error) throw new Error(data?.error || `HTTP ${billsResp.status}`);

        applyBillsData({ bills: data, rules: null, whip: null }, isQuick);

    } catch (error) {
        console.error('Error fetching bills:', error);
        if (elements.ruleBillsList) {
            setIfChanged(elements.ruleBillsList, '<div class="no-bills">Unable to load bills</div>');
        }
        if (elements.suspensionBillsList) {
            setIfChanged(elements.suspensionBillsList, '<div class="no-bills">Unable to load bills</div>');
        }
    }
}

// Mark bills as passed when proceedings contain a voice vote passage.
// Roll call votes are handled via DomeWatch SSE. This covers voice votes, which
// emit two separate items: the outcome row ("On motion to suspend the rules…
// Agreed to by voice vote") contains no bill ID — the bill ID lives in a nearby
// item ("H.R. 1234 – Considered under suspension…"). Mirror the worker's
// ±3-row window to correlate the two.
function updateBillStatusFromProceedings(items) {
    if (!items || items.length === 0) return;

    const billIdPattern = /\b(H\.R\.|H\.Res\.|H\.J\.Res\.|H\.Con\.Res\.|S\.(?:Res\.|J\.Res\.|Con\.Res\.)?|S\.)\s*(\d+)/i;
    const allArrays = ['ruleBills', 'suspensionBills', 'mayBeConsideredBills'];
    let changed = false;

    const extractBillId = desc => {
        const m = desc.match(billIdPattern);
        return m ? `${m[1].replace(/\s+/g, '')} ${m[2]}` : null;
    };

    const isOutcomeRow = desc =>
        /on motion to suspend the rules and (pass|agree)/i.test(desc) ||
        /\bon passage\b/i.test(desc) ||
        /on agreeing to the (resolution|amendment)\b/i.test(desc);

    const isPassed = desc =>
        /(agreed to|passed)\b/i.test(desc) &&
        !/not agreed to|failed/i.test(desc) &&
        /voice vote|without objection/i.test(desc);

    for (let i = 0; i < items.length; i++) {
        const desc = items[i].description || '';
        if (!isOutcomeRow(desc) || !isPassed(desc)) continue;

        // Outcome row rarely contains the bill ID itself; look at nearby items
        let billId = extractBillId(desc);
        for (let j = 1; j <= 3 && !billId; j++) {
            if (i + j < items.length) billId = extractBillId(items[i + j].description || '');
            if (!billId && i - j >= 0) billId = extractBillId(items[i - j].description || '');
        }
        if (!billId) continue;

        const normId = billId.replace(/\s+/g, '');
        for (const key of allArrays) {
            const bill = (billsData[key] || []).find(b => b.id.replace(/\s+/g, '') === normId);
            if (bill && bill.status !== 'passed' && bill.status !== 'failed') {
                bill.status = 'passed';
                bill.latestAction = 'Passed (voice vote)';
                bill.latestActionDate = items[i].pubDate || '';
                bill.actionSource = 'proceedings';
                bill.actionSourceUrl = items[i].link || '';
                changed = true;
            }
        }
    }

    if (changed) updateBillsDisplay();

    // Separately: scan for H.Res. rule outcomes from recorded votes and update specialRulesMap.
    // "On agreeing to the resolution Agreed to by recorded vote: 213 - 211 (Roll no. 211)."
    // isPassed() excludes these because they aren't voice votes, so handle them here.
    let ruleChanged = false;
    for (let i = 0; i < items.length; i++) {
        const desc = items[i].description || '';
        if (!/on agreeing to the resolution\b/i.test(desc)) continue;
        if (!/(agreed to|passed)\b/i.test(desc) || /not agreed to|failed/i.test(desc)) continue;
        // Look for H.Res. number in this item or nearby
        let hresId = null;
        const hresPattern = /H\.?\s*Res\.\s*(\d+)/i;
        for (let j = 0; j <= 3 && !hresId; j++) {
            if (i + j < items.length) { const m = (items[i + j].description || '').match(hresPattern); if (m) hresId = m[1]; }
            if (!hresId && i - j >= 0) { const m = (items[i - j].description || '').match(hresPattern); if (m) hresId = m[1]; }
        }
        if (!hresId) continue;
        // Extract vote counts if present: "recorded vote: 213 - 211"
        const votesMatch = desc.match(/recorded vote:\s*(\d+)\s*[-–]\s*(\d+)/i);
        const passageVote = votesMatch ? `${votesMatch[1]}-${votesMatch[2]}` : null;
        for (const entry of specialRulesMap.values()) {
            if (String(entry.hresNum) === String(hresId) && entry.ruleStatus !== 'passed' && entry.ruleStatus !== 'failed') {
                entry.ruleStatus = 'passed';
                if (passageVote) entry.passageVote = passageVote;
                ruleChanged = true;
            }
        }
    }
    if (ruleChanged) updateBillsDisplay();
}

// ── Motion to Recommit / Commit ──────────────────────────────────────────────
// Map: normalizedBillId → { status: 'pending'|'failed'|'passed', voteText: string|null }
// Populated from proceedings items; shown as an indicator above the bill card.
const motionsToRecommit = new Map();

// Fetch proceedings for the past 7 days and backfill MTR outcomes.
// Called once after bills load so bill objects exist to stamp.
async function backfillMtrFromProceedings() {
    const API = 'https://api.evanhollander.org/house-floor/api/proceedings';
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    let changed = false;
    for (let d = 1; d <= 2; d++) {  // yesterday + 2 days ago — MTRs on older bills are no longer relevant
        const dt = new Date(nowET);
        dt.setDate(dt.getDate() - d);
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        const yyyy = dt.getFullYear();
        try {
            const resp = await fetch(`${API}?date=${mm}/${dd}/${yyyy}`, { signal: AbortSignal.timeout(8000) });
            if (!resp.ok) continue;
            const data = await resp.json();
            if (data?.items?.length) {
                if (updateMotionsToRecommit(data.items)) changed = true;
            }
        } catch { /* non-critical */ }
    }
    if (changed) updateBillsDisplay();
}

const MTR_STORAGE_KEY = 'mtr-outcomes';
const MTR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function saveMtrToStorage() {
    try {
        const entries = [];
        for (const [id, data] of motionsToRecommit) {
            if (data.status === 'passed' || data.status === 'failed') {
                entries.push([id, { ...data, _saved: Date.now() }]);
            }
        }
        localStorage.setItem(MTR_STORAGE_KEY, JSON.stringify(entries));
    } catch {}
}

function loadMtrFromStorage() {
    try {
        const raw = localStorage.getItem(MTR_STORAGE_KEY);
        if (!raw) return;
        const now = Date.now();
        const entries = JSON.parse(raw);
        for (const [id, data] of entries) {
            if (now - (data._saved || 0) > MTR_TTL_MS) continue; // expired
            if (!motionsToRecommit.has(id)) {
                motionsToRecommit.set(id, { type: data.type || null, status: data.status, voteText: data.voteText || null });
            }
        }
    } catch {}
}

// Apply stored MTR outcomes onto bill objects in billsData (called after bills load)
function applyStoredMtrToBills() {
    for (const [billId, mtrData] of motionsToRecommit) {
        if (mtrData.status !== 'passed' && mtrData.status !== 'failed') continue;
        for (const key of ['ruleBills', 'suspensionBills', 'mayBeConsideredBills']) {
            const bill = (billsData[key] || []).find(b => normalizeBillIdForRules(b.id) === billId);
            if (bill && !bill.mtr) { bill.mtr = mtrData; break; }
        }
    }
}

// Scan proceedings items for motion to commit/recommit events and update the map.
// Returns true if anything changed (caller should redraw bills if so).
function updateMotionsToRecommit(items) {
    if (!items?.length) return false;
    const billIdPat = /\b(H\.R\.|H\.Res\.|H\.J\.Res\.|H\.Con\.Res\.|S\.(?:Res\.|J\.Res\.|Con\.Res\.)?|S\.)\s*(\d+)/i;
    const extractNormId = text => {
        const m = text.match(billIdPat);
        return m ? normalizeBillIdForRules(`${m[1].trim()} ${m[2]}`) : null;
    };
    let changed = false;
    for (let i = 0; i < items.length; i++) {
        const desc = items[i].description || '';
        if (!/motion to (?:re)?commit/i.test(desc)) continue;

        let status, voteText;
        if (/^\s*on motion to (?:re)?commit/i.test(desc)) {
            // Outcome row — "On motion to commit: Failed by recorded vote: 20-16"
            const failed = /\b(failed|not agreed to)\b/i.test(desc);
            const passed = !failed && /(agreed to|passed)\b/i.test(desc);
            status = failed ? 'failed' : passed ? 'passed' : 'pending';
            const vm = desc.match(/(?:vote|nays):\s*(\d+)\s*[-–]\s*(\d+)/i);
            if (vm) voteText = `${vm[1]}-${vm[2]}`;
        } else {
            // Motion offered but not yet voted on
            status = 'pending';
        }

        // Find the associated bill in nearby proceedings items (±5)
        let billId = extractNormId(desc);
        for (let j = 1; j <= 5 && !billId; j++) {
            if (i + j < items.length) billId = extractNormId(items[i + j].description || '');
            if (!billId && i - j >= 0) billId = extractNormId(items[i - j].description || '');
        }
        if (!billId) continue;

        const existing = motionsToRecommit.get(billId);
        // Never downgrade a definitive outcome back to pending
        if (existing?.status === 'failed' || existing?.status === 'passed') {
            if (status === 'pending') continue;
        }
        if (!existing || existing.status !== status || existing.voteText !== voteText || !existing.type) {
            const mtrType = /recommit/i.test(desc) ? 'recommit' : 'commit';
            const mtrData = { type: mtrType, status, voteText: voteText || null };
            motionsToRecommit.set(billId, mtrData);
            // Persist onto bill object so it survives proceedings rollover
            if (status === 'passed' || status === 'failed') {
                for (const key of ['ruleBills', 'suspensionBills', 'mayBeConsideredBills']) {
                    const bill = (billsData[key] || []).find(b => normalizeBillIdForRules(b.id) === billId);
                    if (bill) { bill.mtr = mtrData; break; }
                }
                saveMtrToStorage();
            }
            changed = true;
        }
    }
    return changed;
}

// Update bills display
function updateBillsDisplay() {
    if (!elements.ruleBillsList || !elements.suspensionBillsList) return;

    const billsSection = document.querySelector('.bills-section');
    if (billsSection) {
        const debug = billsSection.querySelector('.bills-raw-headers');
        if (debug) debug.remove();
    }

    billDataMap.clear();

    const sortedRule = sortBillsForDisplay(billsData.ruleBills);
    const sortedSuspension = sortBillsForDisplay(billsData.suspensionBills);

    if (sortedRule.length > 0) {
        setIfChanged(elements.ruleBillsList, sortedRule.map(bill => createBillCard(bill, 'rule')).join(''));
    } else {
        setIfChanged(elements.ruleBillsList, '<div class="no-bills">No bills subject to a rule</div>');
    }

    if (sortedSuspension.length > 0) {
        setIfChanged(elements.suspensionBillsList, sortedSuspension.map(bill => createBillCard(bill, 'suspension')).join(''));
    } else {
        setIfChanged(elements.suspensionBillsList, '<div class="no-bills">No bills under suspension</div>');
    }

    if (elements.billsLastUpdate) {
        elements.billsLastUpdate.textContent = billsData.weekDate || 'THIS WEEK';
    }

    // Column count — injected directly into title text
    const ruleTitleEl = document.getElementById('rule-bills-title');
    if (ruleTitleEl) ruleTitleEl.textContent = sortedRule.length ? `SUBJECT TO A RULE (${sortedRule.length})` : 'SUBJECT TO A RULE';
    const suspTitleEl = document.getElementById('suspension-bills-title');
    if (suspTitleEl) suspTitleEl.textContent = sortedSuspension.length ? `UNDER SUSPENSION (${sortedSuspension.length})` : 'UNDER SUSPENSION';

    // [data-sort] scope: only target bills-panel sort buttons, not vote-recs modal buttons
    // which also use .bills-sort-btn but carry data-preset/data-pref-val instead of data-sort.
    document.querySelectorAll('.bills-sort-btn[data-sort]:not(.amdt-sort-btn):not(.amdt-filter-btn)').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === billsSortMode);
    });

    // Populate SPECIAL RULE(S) section
    const ruleTagsContainer = document.getElementById('rule-tags-container');
    const ruleGoverningSection = document.getElementById('rule-governing-section');
    if (ruleTagsContainer && specialRulesMap.size > 0) {
        const seen = new Set();
        const cards = [];
        for (const bill of billsData.ruleBills) {
            const rule = specialRulesMap.get(normalizeBillIdForRules(bill.id));
            if (rule && !seen.has(rule.hresNum)) {
                seen.add(rule.hresNum);
                const statusClass = rule.ruleStatus === 'passed' ? 'passed'
                    : rule.ruleStatus === 'reported' ? 'scheduled'
                    : 'scheduled';
                const statusSymbol = rule.ruleStatus === 'passed' ? '✓' : '';
                const voteStr = rule.passageVote ? ` ${rule.passageVote}` : '';
                const actionText = rule.ruleStatus === 'passed' ? `Passed${voteStr}`
                    : rule.ruleStatus === 'reported' ? 'Reported by Rules Committee'
                    : 'Pending';
                const ruleCardId = `hres-${rule.hresNum}`;
                const congressUrl = `https://www.congress.gov/bill/${CURRENT_CONGRESS_SLUG}/house-resolution/${rule.hresNum}`;
                billDataMap.set(ruleCardId, {
                    id: rule.hres,
                    title: rule.title || 'Special rule governing floor consideration',
                    procedure: 'hres',
                    status: rule.ruleStatus === 'passed' ? 'passed' : 'scheduled',
                    statusText: actionText,
                    latestAction: actionText,
                    congressUrl,
                    pdfUrl: rule.pdfUrl || null,
                    coveredBills: rule.bills || [],
                    sponsor: rule.sponsor || null,
                });
                cards.push(`
                    <button class="bill-card" data-bill-id="${ruleCardId}" data-status="${statusClass}" type="button">
                        <div class="bill-status ${statusClass}" aria-hidden="true">${statusSymbol}</div>
                        <div class="bill-info">
                            <div class="bill-id">${rule.hres}</div>
                            <div class="bill-title">${escapeHtml(rule.title || 'Special rule governing floor consideration')}</div>
                            <div class="bill-meta">
                                <div class="bill-action">${actionText}</div>
                            </div>
                        </div>
                        <div class="bill-chevron" aria-hidden="true">›</div>
                    </button>
                `);
            }
        }
        ruleTagsContainer.innerHTML = cards.join('');
        const show = cards.length > 0;
        const headerEl = document.getElementById('special-rules-header');
        if (headerEl) headerEl.textContent = cards.length === 1 ? 'SPECIAL RULE' : 'SPECIAL RULES';
        if (ruleGoverningSection) ruleGoverningSection.style.display = show ? '' : 'none';
        ruleTagsContainer.style.display = show ? '' : 'none';
    } else {
        if (ruleGoverningSection) ruleGoverningSection.style.display = 'none';
        if (ruleTagsContainer) ruleTagsContainer.style.display = 'none';
    }

    // Populate MAY BE CONSIDERED section — exclude H.Res. bills already shown as special rules
    const mayBeConsideredList = document.getElementById('may-be-considered-list');
    const mayBeConsideredSection = document.getElementById('may-be-considered-section');
    const shownHresNorms = new Set([...specialRulesMap.values()].map(r => normalizeBillIdForRules(r.hres)));
    const sortedMaybe = sortBillsForDisplay(
        (billsData.mayBeConsideredBills || []).filter(b => !shownHresNorms.has(normalizeBillIdForRules(b.id)))
    );
    if (mayBeConsideredList) {
        if (sortedMaybe.length > 0) {
            setIfChanged(mayBeConsideredList, sortedMaybe.map(bill => createBillCard(bill, 'maybe')).join(''));
            if (mayBeConsideredSection) mayBeConsideredSection.style.display = '';
        } else {
            setIfChanged(mayBeConsideredList, '');
            if (mayBeConsideredSection) mayBeConsideredSection.style.display = 'none';
        }
    }

    // Auto-open a ?bill=<slug> deep link once its bill has loaded.
    maybeOpenDeepLinkedBill();

    // Re-evaluate VIEW BILL button — bills may have just loaded for the first time
    syncVoteBillBtn();
}

function createBillCard(bill, procedure) {
    billDataMap.set(bill.id, { ...bill, procedure });
    const statusClass = bill.status || 'scheduled';
    const statusSymbol = bill.status === 'passed' ? '✓' : bill.status === 'failed' ? '✕' : '';
    const actionText = bill.statusText || bill.latestAction || 'Scheduled for consideration';
    const actionDate = bill.latestActionDate ? formatDate(bill.latestActionDate) : '';

    const rice = computeRiceIndex(bill);
    const riceSpan = rice !== null
        ? `<span class="bill-rice" data-tooltip="Rice Index of Cohesion · 0 = evenly split · 1 = unanimous" style="color:${riceIndexColor(rice)}"><span class="bill-rice-label">RICE </span>${rice.toFixed(2)}</span>`
        : '';

    const cardHtml = `
        <button class="bill-card" data-bill-id="${bill.id}" data-status="${statusClass}" type="button">
            <div class="bill-status ${statusClass}" aria-hidden="true">${statusSymbol}</div>
            <div class="bill-info">
                <div class="bill-id-row">
                    <span class="bill-id">${bill.id}</span>
                    ${whipRecTagHtml(bill.id)}
                </div>
                <div class="bill-title">${escapeHtml(bill.title)}</div>
                <div class="bill-meta">
                    <div class="bill-action">${actionText}</div>
                    <div class="bill-date">${actionDate}</div>
                    ${riceSpan}
                </div>
            </div>
            <div class="bill-chevron" aria-hidden="true">›</div>
        </button>`;

    // Live proceedings map wins; fall back to value stored on the bill object (survives daily rollover)
    // Only show if there's an actual vote result — pending MTR on a passed/finished bill is noise
    const mtr = motionsToRecommit.get(normalizeBillIdForRules(bill.id)) || bill.mtr || null;
    if (!mtr || !mtr.voteText) return cardHtml;

    const mtrTypeName = mtr.type === 'commit' ? 'Motion to Commit' : 'Motion to Recommit';
    const mtrLabel = mtr.status === 'failed' ? `${mtrTypeName} Failed${mtr.voteText ? ' · ' + mtr.voteText : ''}`
                   : mtr.status === 'passed' ? `${mtrTypeName} Passed${mtr.voteText ? ' · ' + mtr.voteText : ''}`
                   : mtrTypeName;
    const mtrIcon  = mtr.status === 'failed'
                   ? `<svg width="9" height="9" viewBox="0 0 9 9" style="display:block"><path fill="currentColor" d="M1.5,0 L4.5,3 L7.5,0 L9,1.5 L6,4.5 L9,7.5 L7.5,9 L4.5,6 L1.5,9 L0,7.5 L3,4.5 L0,1.5 Z"/></svg>`
                   : mtr.status === 'passed' ? '✓'
                   : '';

    return `<div class="bill-slot">
        <div class="mtr-card mtr-${mtr.status}" data-bill-id="${bill.id}" role="button" tabindex="0">
            <span class="mtr-circle" aria-hidden="true">${mtrIcon}</span>
            <span class="mtr-label">${mtrLabel}</span>
        </div>
        <div class="mtr-connector" aria-hidden="true"></div>
        ${cardHtml}
    </div>`;
}

function billIdToCongressUrl(billId) {
    const norm = billId.trim().replace(/([A-Z])\.\s+(?=[A-Z])/gi, '$1.');
    const m = norm.match(/^(H\.R\.|H\.Con\.Res\.|H\.J\.Res\.|H\.Res\.|S\.Con\.Res\.|S\.J\.Res\.|S\.Res\.|S\.)\s*(\d+)$/i);
    if (!m) return null;
    const typeMap = {
        'h.r.': 'house-bill', 'h.con.res.': 'house-concurrent-resolution',
        'h.j.res.': 'house-joint-resolution', 'h.res.': 'house-resolution',
        's.': 'senate-bill', 's.con.res.': 'senate-concurrent-resolution',
        's.j.res.': 'senate-joint-resolution', 's.res.': 'senate-resolution',
    };
    const slug = typeMap[m[1].toLowerCase()];
    return slug ? `https://www.congress.gov/bill/${CURRENT_CONGRESS_SLUG}/${slug}/${m[2]}` : null;
}

function billIdToRulesSlug(billId) {
    const m = billId.trim().match(/^(H\.R\.|H\.Con\.Res\.|H\.J\.Res\.|H\.Res\.|S\.)\s*(\d+)$/i);
    if (!m) return null;
    const typeSlug = m[1].toLowerCase().replace(/\./g, '').replace(/\s/g, '');
    return `${typeSlug}-${m[2]}`;
}

function openBillModalToAmendments(billId) {
    openBillModal(billId);
    // Switch immediately to amendments panel after the modal is built
    const nav = document.getElementById('bill-panel-nav');
    const mainPanel = document.getElementById('bill-main-panel');
    const amendmentsPanel = document.getElementById('bill-amendments-panel-el');
    if (nav && mainPanel && amendmentsPanel) {
        nav.querySelectorAll('.bill-panel-nav-btn').forEach(b => b.classList.remove('is-active'));
        nav.querySelector('[data-panel="amendments"]')?.classList.add('is-active');
        mainPanel.classList.remove('panel-visible');
        amendmentsPanel.classList.add('panel-visible');
    }
}

// ── Deep links ───────────────────────────────────────────────────────────────
// A bill modal is shareable via ?bill=<slug> (e.g. ?bill=hr8646). Opening a modal
// writes the param; closing clears it; on load we auto-open the linked bill once
// the bills data has arrived.
function billSlug(id) { return normalizeBillIdForRules(id).toLowerCase(); } // "H.R. 8646" → "hr8646"

function setBillUrlParam(slug) {
    try {
        const url = new URL(location.href);
        if (slug) url.searchParams.set('bill', slug);
        else url.searchParams.delete('bill');
        history.replaceState(history.state, '', url);
    } catch {}
}

let _deepLinkOpened = false;
function maybeOpenDeepLinkedBill() {
    if (_deepLinkOpened) return;
    let slug;
    try { slug = new URL(location.href).searchParams.get('bill'); } catch { slug = null; }
    if (!slug) { _deepLinkOpened = true; return; } // nothing to open
    slug = slug.toLowerCase();
    for (const id of billDataMap.keys()) {
        if (billSlug(id) === slug) { _deepLinkOpened = true; openBillModal(id); return; }
    }
    // Not in billDataMap yet (bills still loading) — leave the flag false to retry
    // on the next updateBillsDisplay.
}

function openBillModal(billId) {
    let bill = billDataMap.get(billId);
    // H.Res. rule resolutions are stored as "hres-NNNN", not "H.Res. NNNN"
    if (!bill && /H\.?\s*Res\./i.test(billId)) {
        const n = billId.match(/(\d+)/)?.[1];
        if (n) bill = billDataMap.get(`hres-${n}`);
    }
    // Last-resort: normalized scan to handle spacing differences ("H. Res." vs "H.Res.")
    if (!bill) {
        const norm = normalizeBillIdForRules(billId);
        for (const [key, val] of billDataMap) {
            if (normalizeBillIdForRules(key) === norm) { bill = val; break; }
        }
    }
    if (!bill) {
        // Bill not on the floor this week — link out to Congress.gov
        const url = billIdToCongressUrl(billId);
        if (url) window.open(url, '_blank', 'noopener');
        return;
    }

    const procedureClass = bill.procedure === 'suspension' ? 'suspension' : bill.procedure === 'maybe' ? 'maybe' : bill.procedure === 'hres' ? 'rule' : 'rule';
    const procedureLabel = bill.procedure === 'suspension' ? 'UNDER SUSPENSION' : bill.procedure === 'maybe' ? 'MAY BE CONSIDERED' : bill.procedure === 'hres' ? 'SPECIAL RULE' : 'SUBJECT TO A RULE';
    const statusClass = bill.status || 'scheduled';
    const statusLabel = { passed: 'PASSED', failed: 'FAILED', 'roll-call': 'VOTE REQUESTED' }[bill.status] || 'SCHEDULED';
    const actionText = bill.statusText || bill.latestAction || 'Scheduled for consideration';
    const actionDate = bill.latestActionDate ? formatDate(bill.latestActionDate) : '';
    // Decode Congress.gov HTML entities (&nbsp; &mdash; etc.) and strip any tags before escaping
    const summaryText = bill.summary ? (() => { const d = document.createElement('div'); d.innerHTML = bill.summary; return d.textContent.trim(); })() : '';
    let actionTimeStr = '';
    // Congress.gov only has date precision (actionDate = "YYYY-MM-DD", stored as midnight UTC).
    // Bluesky and proceedings timestamps have real time precision — show the time for those.
    if ((bill.actionSource === 'bluesky' || bill.actionSource === 'proceedings') && bill.latestActionDate) {
        try {
            actionTimeStr = new Date(bill.latestActionDate).toLocaleTimeString('en-US', {
                hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
            });
        } catch (_) {}
    }
    const congressUrl = billIdToCongressUrl(bill.id);
    let actionSourceHtml = '';
    if (bill.actionSource === 'bluesky' && bill.actionSourceUrl) {
        actionSourceHtml = ` <a href="${bill.actionSourceUrl}" class="bill-modal-source-link" target="_blank" rel="noopener">Bluesky</a>`;
    } else if (bill.actionSource === 'proceedings' && bill.actionSourceUrl) {
        actionSourceHtml = ` <a href="${bill.actionSourceUrl}" class="bill-modal-source-link" target="_blank" rel="noopener">House Clerk</a>`;
    } else if (bill.actionSource === 'congress' && congressUrl) {
        actionSourceHtml = ` <a href="${congressUrl}/actions" class="bill-modal-source-link" target="_blank" rel="noopener">Congress.gov</a>`;
    }

    // Sponsor HTML (reuse absentee-member classes)
    let sponsorHtml = '';
    if (bill.sponsor) {
        const s = bill.sponsor;
        const pClass = s.party === 'R' ? 'republican' : s.party === 'D' ? 'democrat' : 'independent';
        const pLetter = s.party === 'R' ? 'R' : s.party === 'D' ? 'D' : 'I';
        const name = `${s.firstName} ${s.lastName}`;
        const loc = s.state + (s.district != null ? `-${String(s.district).padStart(2, '0')}` : '');
        const photo = `https://bioguide.congress.gov/bioguide/photo/${s.bioguideId.charAt(0)}/${s.bioguideId}.jpg`;
        sponsorHtml = `
            <div class="bill-modal-section">
                <div class="bill-modal-section-label">SPONSOR</div>
                <div class="absentee-member" style="padding:0;border:none;">
                    <div class="absentee-photo-wrap" style="width:36px;height:36px;border-radius:8px;flex-shrink:0;">
                        <div class="absentee-photo-placeholder">${MEMBER_PHOTO_PLACEHOLDER}</div>
                        <img class="absentee-photo" src="${photo}" alt="${name}" onload="this.style.opacity='1';" onerror="this.style.display='none';" />
                    </div>
                    <div class="absentee-meta">
                        <span class="absentee-party-tag ${pClass}">${pLetter}</span>
                        <span class="absentee-name">${name}</span>
                        <span class="absentee-state">${loc}</span>
                    </div>
                </div>
            </div>`;
    }

    // Cosponsors bar (includes sponsor in count)
    let cosponsorsHtml = '';
    const allSupporters = [
        ...(bill.sponsor ? [bill.sponsor] : []),
        ...(bill.cosponsors || []),
    ];
    if (allSupporters.length > 0) {
        const rCount = allSupporters.filter(m => m.party === 'R').length;
        const dCount = allSupporters.filter(m => m.party === 'D').length;
        const iCount = allSupporters.filter(m => m.party !== 'R' && m.party !== 'D').length;
        const total = allSupporters.length;
        const rPct = (rCount / total * 100).toFixed(1);
        const dPct = (dCount / total * 100).toFixed(1);
        const iPct = (iCount / total * 100).toFixed(1);
        const coLabel = bill.cosponsors?.length ? `${bill.cosponsors.length} COSPONSOR${bill.cosponsors.length !== 1 ? 'S' : ''}` : 'NO COSPONSORS';
        cosponsorsHtml = `
            <div class="bill-modal-section">
                <div class="bill-modal-section-label">SUPPORT — ${coLabel}</div>
                <div class="bill-modal-support-bar">
                    ${dCount ? `<div class="bill-modal-support-fill dem" style="width:${dPct}%" title="${dCount} Democrat${dCount !== 1 ? 's' : ''}"></div>` : ''}
                    ${rCount ? `<div class="bill-modal-support-fill rep" style="width:${rPct}%" title="${rCount} Republican${rCount !== 1 ? 's' : ''}"></div>` : ''}
                    ${iCount ? `<div class="bill-modal-support-fill ind" style="width:${iPct}%" title="${iCount} Independent${iCount !== 1 ? 's' : ''}"></div>` : ''}
                </div>
                <div class="bill-modal-support-labels">
                    ${dCount ? `<span class="bill-modal-support-count dem">${dCount}D</span>` : ''}
                    ${rCount ? `<span class="bill-modal-support-count rep">${rCount}R</span>` : ''}
                    ${iCount ? `<span class="bill-modal-support-count ind">${iCount}I</span>` : ''}
                </div>
            </div>`;
    }

    // Committee — the report vote count is embedded INTO the committee tag itself
    // as a prominent green-ayes / red-nays tally, so the committee and its vote
    // read as one unit. Date sits to the right of the tag row.
    const reportInner = (() => {
        if (!bill.committeeReport) return '';
        const m = bill.committeeReport.match(/(\d+)\s*[–-]\s*(\d+)/);
        if (m) {
            return `<span class="committee-chip-tally"><b class="ct-aye">${m[1]}</b><span class="ct-sep">–</span><b class="ct-nay">${m[2]}</b></span>`;
        }
        const label = /unanimous consent/i.test(bill.committeeReport) ? 'Unanimous Consent'
            : /voice vote/i.test(bill.committeeReport) ? 'Voice Vote'
            : escapeHtml(bill.committeeReport.replace(/^reported( by committee)?\s*/i, '') || 'Reported');
        return `<span class="committee-chip-tally committee-chip-tally-text">${label}</span>`;
    })();
    const committeeDateHtml = (bill.committeeReport && bill.committeeReportDate)
        ? `<span class="bill-modal-date">${formatDate(bill.committeeReportDate)}</span>` : '';

    // Attach the report to the first (reporting) committee chip. If there are no
    // named committees but a report exists, show a single "Committee" chip.
    const committeeNames = bill.committees?.length ? bill.committees : (bill.committeeReport ? ['Committee'] : []);
    const committeeHtml = committeeNames.length ? `
        <div class="bill-modal-section">
            <div class="bill-modal-section-label">COMMITTEE</div>
            <div class="bill-modal-committee-row">
                <div class="bill-modal-committees">
                    ${committeeNames.map((c, i) => `<span class="bill-modal-committee">
                        <span class="committee-chip-name">${c}</span>
                        ${i === 0 ? reportInner : ''}
                    </span>`).join('')}
                </div>
                ${committeeDateHtml}
            </div>
        </div>` : '';

    // Kept for the sections list below (committee report now lives inside committeeHtml).
    const committeeReportHtml = '';

    let overlay = document.getElementById('bill-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'bill-modal-overlay';
        overlay.className = 'bill-modal-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) closeBillModal(); });
    }

    const modalRule = bill.procedure === 'rule' ? specialRulesMap.get(normalizeBillIdForRules(bill.id)) : null;
    // Fall back to governingHres from the schedule XML when specialRulesMap doesn't have a match
    // (e.g. the H.Res fell outside the top-50 Congress.gov results or the rules endpoint is stale).
    const fallbackHres = (!modalRule && bill.procedure === 'rule' && bill.governingHres) ? bill.governingHres : null;
    const modalRuleTagHtml = modalRule ? (() => {
        const sc = modalRule.ruleStatus === 'passed' ? 'rule-tag-passed'
            : modalRule.ruleStatus === 'reported' ? 'rule-tag-reported'
            : 'rule-tag-unknown';
        return `<button class="bill-rule-tag ${sc} bill-rule-tag-modal" type="button" data-bill-id="hres-${modalRule.hresNum}">${modalRule.hres}${modalRule.ruleStatus === 'passed' ? ' ✓' : ''}</button>`;
    })() : fallbackHres ? (() => {
        const hresNum = fallbackHres.match(/(\d+)$/)?.[1];
        if (!hresNum) return `<span class="bill-rule-tag rule-tag-unknown bill-rule-tag-modal">${fallbackHres}</span>`;
        return `<button class="bill-rule-tag rule-tag-unknown bill-rule-tag-modal" type="button" data-bill-id="hres-${hresNum}">${fallbackHres}</button>`;
    })() : '';

    const rulesSlug = (bill.procedure === 'rule') ? billIdToRulesSlug(bill.id) : null;
    // Bill-text PDF — provided by the worker (the exact floor doc, GovInfo fallback).
    // Last resort if missing: the Congress.gov text page (has a PDF download button).
    const textUrl = bill.textUrl || (congressUrl ? `${congressUrl}/text` : null);

    if (rulesSlug) overlay.classList.add('has-amendments');
    else overlay.classList.remove('has-amendments');

    overlay.innerHTML = `
        ${rulesSlug ? `
        <div class="bill-panel-nav" id="bill-panel-nav">
            <button class="bill-panel-nav-btn is-active" data-panel="main">Bill Details</button>
            <button class="bill-panel-nav-btn" data-panel="amendments">Amendments</button>
        </div>` : ''}
        <div class="bill-modal" id="bill-main-panel" role="dialog" aria-modal="true">
            <button class="bill-modal-close" id="bill-modal-close" aria-label="Close">✕</button>
            <div class="bill-modal-scroll">
            <div class="bill-modal-top">
                <div class="bill-modal-header">
                    <span class="bill-modal-id">${bill.id}</span>
                    <span class="bill-modal-badge ${statusClass}">${statusLabel}</span>
                    <span class="bill-modal-badge ${procedureClass}">${procedureLabel}</span>
                    ${modalRuleTagHtml}
                    ${whipRecTagHtml(bill.id)}
                </div>
                <h2 class="bill-modal-title">${escapeHtml(bill.title)}</h2>
            </div>
            <div class="bill-modal-sections">
                ${sponsorHtml}
                ${cosponsorsHtml}
                ${committeeHtml}
                ${committeeReportHtml}
            </div>
            ${summaryText ? `
            <div class="bill-modal-body">
                <div class="bill-modal-section-label">SUMMARY (AUTHORED BY CRS)</div>
                <p class="bill-modal-summary">${escapeHtml(summaryText)}</p>
            </div>` : ''}
            <div class="bill-modal-foot">
                ${actionText ? `
                <div class="bill-modal-section" style="margin-bottom:12px;">
                    <div class="bill-modal-section-label">LATEST ACTION</div>
                    <div class="bill-modal-action bill-modal-action-row">
                        <span class="bill-modal-action-text">${actionText}</span>
                        ${actionDate ? `<span class="bill-modal-date">${actionDate}${actionTimeStr ? `, ${actionTimeStr}` : ''}${actionSourceHtml}</span>` : ''}
                    </div>
                </div>` : ''}
                <div class="bill-modal-section">
                    <div class="bill-modal-section-label">LINKS</div>
                    <div class="bill-doc-links">
                        ${textUrl ? `<a href="${textUrl}" class="bill-modal-link ${procedureClass}" target="_blank" rel="noopener">View Bill Text →</a>` : ''}
                        ${bill.committeeReportUrl ? `<a href="${bill.committeeReportUrl}" class="bill-modal-link ${procedureClass}" target="_blank" rel="noopener" title="${bill.committeeReportCitation || 'Committee Report'}">View Committee Report →</a>` : ''}
                        ${bill.sapUrl ? `<a href="${bill.sapUrl}" class="bill-modal-link ${procedureClass}" target="_blank" rel="noopener">View White House Memo →</a>` : ''}
                        ${congressUrl ? `<a href="${congressUrl}" class="bill-modal-link ${procedureClass}" target="_blank" rel="noopener">View on Congress.gov →</a>` : ''}
                        <button class="bill-modal-link bill-copy-link" id="bill-copy-link" type="button" aria-label="Copy link to this bill"><svg class="bill-copy-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span class="bill-copy-text">Copy link</span></button>
                    </div>
                </div>
            </div>
            </div>
        </div>
        ${rulesSlug ? `
        <div class="bill-amendments-panel" id="bill-amendments-panel-el">
            <div class="bill-amendments-panel-header">
                <div class="amdt-header-left">
                    <span class="bill-amendments-panel-title">Amendments</span>
                    <span class="bill-amendments-count" id="amendments-count"></span>
                </div>
                <div class="amdt-controls">
                    <div class="bills-sort-switcher amdt-filter-switcher">
                        <button class="bills-sort-btn amdt-filter-btn active" data-filter="all">All</button>
                        <button class="bills-sort-btn amdt-filter-btn" data-filter="dem">D</button>
                        <button class="bills-sort-btn amdt-filter-btn" data-filter="rep">R</button>
                        <button class="bills-sort-btn amdt-filter-btn" data-filter="bipartisan">Bipartisan</button>
                    </div>
                    <div class="bills-sort-switcher amdt-sort-switcher">
                        <button class="bills-sort-btn amdt-sort-btn" data-sort="status">Status</button>
                        <button class="bills-sort-btn amdt-sort-btn" data-sort="listed">Listed</button>
                    </div>
                </div>
            </div>
            <div class="amdt-search-bar">
                <input type="search" class="amdt-search-input" data-amdt-search placeholder="Search by #, sponsor, or summary…" autocomplete="off">
            </div>
            <div class="bill-amendments-panel-body" id="amendments-body">
                <div class="bill-amendments-empty">Loading…</div>
            </div>
            <div class="bill-modal-foot">
                <div class="bill-doc-links">
                    <a href="https://rules.house.gov/bill/${currentCongress || 119}/${rulesSlug}" class="bill-modal-link rule" target="_blank" rel="noopener">View on rules.house.gov →</a>
                </div>
            </div>
        </div>` : ''}
    `;
    overlay.hidden = false;
    _billModalTrigger = document.activeElement;
    // Deep link: reflect the open bill in the URL so it's shareable.
    setBillUrlParam(billSlug(billId));
    const closeBtn = document.getElementById('bill-modal-close');
    closeBtn.addEventListener('click', closeBillModal);
    document.addEventListener('keydown', onBillModalKey);
    const modal = document.getElementById('bill-main-panel');
    if (modal) { _billModalTrapCleanup = trapFocus(overlay); closeBtn.focus(); }

    // Copy-link button — copies the current (deep-linked) URL.
    const copyBtn = document.getElementById('bill-copy-link');
    if (copyBtn) {
        const copyLabel = copyBtn.querySelector('.bill-copy-text');
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(location.href);
                const prev = copyLabel ? copyLabel.textContent : '';
                if (copyLabel) copyLabel.textContent = 'Copied';
                copyBtn.classList.add('copied');
                setTimeout(() => { if (copyLabel) copyLabel.textContent = prev; copyBtn.classList.remove('copied'); }, 1500);
            } catch {}
        });
    }

    // Rule-tag buttons in the modal open the modal for that H.Res.
    overlay.querySelectorAll('.bill-rule-tag-modal[data-bill-id]').forEach(btn => {
        btn.addEventListener('click', () => openBillModal(btn.dataset.billId));
    });

    // Reset amendment filters on every new modal open so All is always active initially
    amendmentsPartyFilter = 'all';
    amendmentsMemberFilter = null;
    amendmentsSearchQuery = '';
    // Sync sort + filter buttons without CSS transitions (prevents flash/fade on open)
    overlay.querySelectorAll('.amdt-filter-btn, .amdt-sort-btn').forEach(btn => { btn.style.transition = 'none'; });
    overlay.querySelectorAll('.amdt-sort-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.sort === amendmentsSortMode));
    overlay.querySelectorAll('.amdt-filter-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.filter === amendmentsPartyFilter));
    requestAnimationFrame(() =>
        overlay.querySelectorAll('.amdt-filter-btn, .amdt-sort-btn').forEach(btn => { btn.style.transition = ''; }));

    if (rulesSlug) {
        const mainPanel = document.getElementById('bill-main-panel');
        const amendmentsPanel = document.getElementById('bill-amendments-panel-el');
        const nav = document.getElementById('bill-panel-nav');
        if (nav && mainPanel && amendmentsPanel) {
            mainPanel.classList.add('panel-visible');
            nav.querySelectorAll('.bill-panel-nav-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    nav.querySelectorAll('.bill-panel-nav-btn').forEach(b => b.classList.remove('is-active'));
                    btn.classList.add('is-active');
                    if (btn.dataset.panel === 'main') {
                        mainPanel.classList.add('panel-visible');
                        amendmentsPanel.classList.remove('panel-visible');
                    } else {
                        mainPanel.classList.remove('panel-visible');
                        amendmentsPanel.classList.add('panel-visible');
                    }
                });
            });
        }
        loadAmendments(rulesSlug);
    }
}

// ── Amendment rendering helpers (module-level so sort re-render can call them) ──

const _amendmentsDataCache = new Map(); // slug → { amendments, xmlDoc }

function amendmentStatusClass(s) {
    const l = (s || '').toLowerCase();
    if (l.includes('made in order') || l.includes('adopted')) return 'adopted';
    if (l.includes('not') || l.includes('failed') || l.includes('withdrawn')) return 'failed';
    return 'submitted';
}
const _amdtPartyClass = p => {
    const l = (p || '').toLowerCase();
    if (l === 'r' || l.startsWith('rep')) return 'rep';
    if (l === 'd' || l.startsWith('dem')) return 'dem';
    return 'ind';
};
const _amdtPartyLetter = p => _amdtPartyClass(p) === 'rep' ? 'R' : _amdtPartyClass(p) === 'dem' ? 'D' : 'I';
const _amdtParseSponsorTokens = str =>
    str.split(/,\s*(?=[A-Z])/).map(t => {
        const m = t.trim().match(/^(.+?)\s*\(([A-Z]{2})\)$/);
        return m ? { raw: t.trim(), lastName: m[1].trim(), state: m[2] } : { raw: t.trim(), lastName: null, state: null };
    }).filter(t => t.raw);
const _amdtCleanDistrict = d => {
    if (!d) return d;
    const stripped = d.replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1').trim();
    return /^\d+$/.test(stripped) ? stripped.padStart(2, '0') : stripped;
};

// Pre-compute enriched sponsors + bipartisan flag once after fetch,
// so renderAmendmentsTable never needs xmlDoc at render time.
function enrichAmendments(amendments, xmlDoc) {
    return amendments.map(a => {
        const tokens = _amdtParseSponsorTokens(a.sponsors || '');
        const enrichedSponsors = tokens.map(t => {
            const match = (xmlDoc && t.lastName && t.state)
                ? findBestMemberMatchByName(xmlDoc, t.lastName, t.state) : null;
            const party = match ? _amdtPartyClass(match.party) : _amdtPartyClass(a.party);
            const dist = match?.district && match.district !== '0' ? _amdtCleanDistrict(match.district) : '';
            return {
                name: match ? match.fullName : t.raw,
                party,
                letter: party === 'rep' ? 'R' : party === 'dem' ? 'D' : 'I',
                photoUrl: match ? buildBioguidePhotoUrl(match.bioguideId) : null,
                profileUrl: match ? buildCongressProfileUrl(match.bioguideId) : null,
                distLabel: match ? `${match.state}${dist ? '-' + dist : ''}` : (t.state || ''),
            };
        });
        const parties = new Set([...enrichedSponsors.map(s => s.party), _amdtPartyClass(a.party)]);
        const isBipartisan = parties.has('rep') && parties.has('dem');
        return {
            ...a,
            _enrichedSponsors: enrichedSponsors,
            _isBipartisan: isBipartisan,
            _dotParty: isBipartisan ? 'bipartisan' : _amdtPartyClass(a.party),
        };
    });
}

function sortAmendmentsForDisplay(amendments) {
    const indexed = amendments.map((a, i) => ({ ...a, _origIdx: i }));
    if (amendmentsSortMode === 'status') {
        return indexed.sort((a, b) => {
            const sa = AMENDMENT_STATUS_SORT_ORDER[amendmentStatusClass(a.status)] ?? 1;
            const sb = AMENDMENT_STATUS_SORT_ORDER[amendmentStatusClass(b.status)] ?? 1;
            if (sa !== sb) return sa - sb;
            return a._origIdx - b._origIdx;
        });
    }
    return indexed.sort((a, b) => a._origIdx - b._origIdx); // 'listed'
}

function renderAmendmentsTable({ amendments }, body) {
    let display = sortAmendmentsForDisplay(amendments);

    // Party filter
    if (amendmentsPartyFilter === 'bipartisan') {
        display = display.filter(a => a._isBipartisan);
    } else if (amendmentsPartyFilter !== 'all') {
        display = display.filter(a => a._dotParty === amendmentsPartyFilter);
    }

    // Member filter (show only amendments that include this sponsor)
    if (amendmentsMemberFilter) {
        display = display.filter(a =>
            a._enrichedSponsors?.some(s => s.name === amendmentsMemberFilter));
    }

    // Text search — matches amendment #, sponsor names, summary
    if (amendmentsSearchQuery) {
        const q = amendmentsSearchQuery.toLowerCase();
        display = display.filter(a =>
            String(a.num).includes(q) ||
            (a.summary || '').toLowerCase().includes(q) ||
            (a._enrichedSponsors || []).some(s => s.name.toLowerCase().includes(q)));
    }

    const renderSponsors = (a) => {
        const dotParty = a._dotParty || _amdtPartyClass(a.party);
        const chips = (a._enrichedSponsors || []).map(s => {
            const isActive = amendmentsMemberFilter === s.name;
            const safeAttr = s.name.replace(/"/g, '&quot;');
            const imgHtml = s.photoUrl ? `<img class="amdt-sponsor-photo" src="${s.photoUrl}" alt="" onload="this.style.opacity='1';" onerror="this.style.display='none';">` : '';
            const wrapHtml = `<div class="amdt-sponsor-photo-wrap"><div class="amdt-sponsor-photo-placeholder">${MEMBER_PHOTO_PLACEHOLDER}</div>${imgHtml}</div>`;
            const photoHtml = s.profileUrl
                ? `<a href="${s.profileUrl}" target="_blank" rel="noopener" class="amdt-sponsor-photo-link">${wrapHtml}</a>`
                : wrapHtml;
            return `<div class="amdt-sponsor-chip">
                ${photoHtml}
                <span class="amdt-sponsor-name">
                    <span class="amdt-sponsor-party-tag ${s.party}">${s.letter}</span>
                    <button class="amdt-member-btn${isActive ? ' active' : ''}" type="button" data-member-name="${safeAttr}" title="Filter to ${s.name}'s amendments">${s.name}</button>
                    ${s.distLabel ? `<span class="amdt-sponsor-dist"> ${s.distLabel}</span>` : ''}
                </span>
            </div>`;
        });
        return `<button class="amdt-party ${dotParty}" type="button" data-filter-party="${dotParty}" title="Filter by party" aria-label="Filter by ${dotParty}"></button>
                <div class="amdt-sponsor-list">${chips.join('')}</div>`;
    };

    body.innerHTML = display.length ? `
        <table class="amendments-table">
            <thead><tr><th>#</th><th>Sponsor(s)</th><th>Summary</th><th>Status</th><th></th></tr></thead>
            <tbody>${display.map(a => `
                <tr>
                    <td class="amdt-num">${escapeHtml(String(a.num ?? ''))}</td>
                    <td class="amdt-sponsors">${renderSponsors(a)}</td>
                    <td class="amdt-summary">${escapeHtml(a.summary ?? '')}</td>
                    <td><span class="amdt-status-badge ${amendmentStatusClass(a.status)}">${escapeHtml(a.status ?? '')}</span></td>
                    <td class="amdt-pdf-cell">${a.pdfUrl ? `<a href="${a.pdfUrl}" class="amdt-pdf-btn" target="_blank" rel="noopener" title="Open amendment PDF">↗</a>` : ''}</td>
                </tr>`).join('')}
            </tbody>
        </table>` : '<div class="bill-amendments-empty">No amendments match this filter.</div>';
}

async function loadAmendments(slug, bodyId = 'amendments-body', countId = 'amendments-count') {
    const body = document.getElementById(bodyId);
    const countEl = document.getElementById(countId);
    if (!body) return;
    try {
        let cached = _amendmentsDataCache.get(slug);
        if (!cached) {
            const congress = currentCongress || 119;
            const [resp, xmlText] = await Promise.all([
                fetch(`https://api.evanhollander.org/house-floor/api/amendments?bill=${encodeURIComponent(slug)}&congress=${congress}`),
                getMemberDataXml().catch(() => null)
            ]);
            const data = await resp.json();
            const xmlDoc = xmlText ? parseMemberDataXml(xmlText) : null;
            cached = { amendments: enrichAmendments(data.amendments || [], xmlDoc) };
            _amendmentsDataCache.set(slug, cached);
        }
        if (!cached.amendments.length) {
            body.innerHTML = '<div class="bill-amendments-empty">No amendments submitted.</div>';
            return;
        }
        if (countEl) countEl.textContent = `${cached.amendments.length} submitted`;
        body.dataset.amendmentsSlug = slug;
        renderAmendmentsTable(cached, body);
        // Sync sort + filter buttons to current mode
        document.querySelectorAll('.amdt-sort-btn').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.sort === amendmentsSortMode));
        document.querySelectorAll('.amdt-filter-btn').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.filter === amendmentsPartyFilter));
    } catch (e) {
        body.innerHTML = '<div class="bill-amendments-empty">Failed to load amendments.</div>';
    }
}

// Focus trap utility — returns a cleanup function
function trapFocus(el) {
    const sel = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    function handler(e) {
        if (e.key !== 'Tab') return;
        const nodes = [...el.querySelectorAll(sel)];
        if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
        else            { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
    }
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
}

let _billModalTrigger = null;
let _billModalTrapCleanup = null;

function closeBillModal() {
    const overlay = document.getElementById('bill-modal-overlay');
    if (overlay) overlay.hidden = true;
    document.removeEventListener('keydown', onBillModalKey);
    if (_billModalTrapCleanup) { _billModalTrapCleanup(); _billModalTrapCleanup = null; }
    if (_billModalTrigger) { _billModalTrigger.focus(); _billModalTrigger = null; }
    setBillUrlParam(null); // drop ?bill= so the URL reflects the closed state
}

function onBillModalKey(e) {
    if (e.key === 'Escape') closeBillModal();
}

// Info popup
const INFO_CONTENT = {
    'prayer': {
        title: 'Opening Prayer',
        tags: ['SINCE 1789', 'ELECTED OFFICER', 'GUEST CHAPLAINS WELCOME'],
        image: {
            url: 'https://images.collections.yale.edu/iiif/2/yuag:241bd49f-0b2b-40d4-82de-f4c9e0031a1c/full/!1200,1200/0/default.jpg',
            alt: 'The First Prayer in Congress, September 1774 in Carpenters Hall Philadelphia',
            caption: 'Harvey S. Sadd, <em>The First Prayer in Congress, September 1774</em>, ca. 1848. Steel engraving. <a href="https://artgallery.yale.edu/collections/objects/16816" target="_blank" rel="noopener">Yale University Art Gallery</a>.'
        },
        body: () => {
            const name = _lastChaplainName || 'the House Chaplain';
            return `The House has opened each day of session with a prayer since April 1, 1789 — one of its oldest unbroken traditions. The House Chaplain is an elected officer of the House who typically delivers the prayer, though Members frequently invite guest chaplains from many faith traditions in their place.\n\nBeyond the daily prayer, the Chaplain provides confidential pastoral counseling to Members, families, and Capitol staff. The current Chaplain is ${name}.`;
        },
        source: 'Summary generated by AI from <a href="https://www.congress.gov/crs_external_products/R/PDF/R41807/R41807.5.pdf" target="_blank" rel="noopener">CRS Report R41807</a>'
    },
    'moment-of-silence': {
        title: 'Moment of Silence',
        tags: [],
        body: `"The House has observed moments of silence as a way to honor notable individuals, fallen heroes and soldiers of wars, and victims of national tragedies. In one instance, the House stood in silent prayer in observance of the Nazi invasion of France."`,
        source: '<a href="https://www.govinfo.gov/content/pkg/GPO-HPREC-DESCHLERS-V17/pdf/GPO-HPREC-DESCHLERS-V17-4-14.pdf" target="_blank" rel="noopener">Deschler-Brown-Johnson Precedents, Ch. 36 § 13</a>'
    },
    'speaker-pro-tempore': {
        title: 'Speaker Pro Tempore',
        tags: ['MAX 3 LEGISLATIVE DAYS'],
        body: `Simple designation — without formal House approval — is permitted for up to three legislative days. The Speaker may designate a Member orally (in open House or off the record) or in writing when absent at the start of a session. The designation may also be withdrawn.

The designated Speaker pro tempore must ordinarily seek House consent before carrying out sensitive functions a Speaker would handle as a matter of course — such as administering the oath of office, appointing conferees, or referring Presidential messages to committees.`,
        source: '<a href="https://www.govinfo.gov/content/pkg/GPO-HPREC-DESCHLERS-V1/pdf/GPO-HPREC-DESCHLERS-V1-6-3-4.pdf" target="_blank" rel="noopener">Deschler\'s Precedents, Ch. 6 § 12</a>'
    },
    'journal': {
        title: "Approval of the Journal",
        tags: [],
        body: `The Constitution requires each chamber to keep a Journal. The House Journal is the official record of chamber <em>actions</em> — votes, motions, quorum calls, amendments — not the text of debate (that's the Congressional Record).

Each legislative day, the Speaker announces approval of the previous day's Journal. Any Member may demand a recorded vote on approval, which has historically been used to force Members to the floor and establish a quorum before important business.`,
        source: 'Summary generated by AI from <a href="https://www.congress.gov/crs_external_products/R/PDF/R45209/R45209.4.pdf" target="_blank" rel="noopener">CRS Report R45209</a>'
    },
    'under-rule': {
        title: 'Consideration Under a Rule',
        tags: ['RULES COMMITTEE', 'MAJORITY VOTE'],
        body: `The Rules Committee reports a "special rule" — a simple House resolution (H.Res.) — that sets the exact terms for floor debate on a specific bill. The House must first pass the rule by simple majority before the bill itself can be considered.

The rule specifies debate time (typically 1–2 hours, split equally), and which amendments may be offered. An <strong>open rule</strong> allows any germane amendment; a <strong>closed rule</strong> permits none; a <strong>structured rule</strong> lists only specified amendments. This gives the majority party significant control over what happens on the floor.`,
        source: 'Summary generated by AI from <a href="https://www.congress.gov/crs_external_products/R/PDF/R48308/R48308.1.pdf" target="_blank" rel="noopener">CRS Report R48308</a>'
    },
    'under-suspension': {
        title: 'Suspension of the Rules',
        tags: ['2/3 MAJORITY REQUIRED', '40 MIN DEBATE', 'NO AMENDMENTS', 'MON & TUE'],
        body: `An expedited procedure under House Rule XV for non-controversial bills. "Suspension" means temporarily setting aside normal House rules for a streamlined process.

Passage requires a two-thirds supermajority. Debate is capped at 40 minutes (20 per side). No floor amendments may be offered. Bills are scheduled by the Speaker, typically on Mondays and Tuesdays. A bill that fails under suspension can still return under regular order requiring only a simple majority.`,
        source: 'Summary generated by AI from <a href="https://www.congress.gov/crs_external_products/RS/PDF/98-314/98-314.16.pdf" target="_blank" rel="noopener">CRS Report 98-314</a>'
    },
    'dem-whip-notices': {
        title: 'Dem Whip Notices',
        tags: ['DEMOCRATIC MINORITY'],
        body: `This section republishes notices from the House Democratic Whip's office via DomeWatch for informational purposes only.

The Republican Whip's notices are not publicly available in a machine-readable format and are therefore not included.

Notice types:
<strong>FLOOR</strong> — real-time updates published during an active floor session, typically announcing upcoming votes, vote counts, or procedural moves.
<strong>DAILY</strong> — published each morning with the day's expected schedule and vote positions.
<strong>NIGHTLY</strong> — published in the evening with next-day guidance.
<strong>WEEKLY</strong> — the week-ahead schedule distributed to Democratic Members.`,
        source: 'Source: <a href="https://domewatch.us" target="_blank" rel="noopener">DomeWatch</a>'
    }
};

// Preload images for info popups in the background so they're cached by the time the user opens (?)
Object.values(INFO_CONTENT).forEach(c => { if (c.image?.url) { new Image().src = c.image.url; } });

function openInfoPopup(key) {
    const content = INFO_CONTENT[key];
    if (!content) return;

    let overlay = document.getElementById('info-popup-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'info-popup-overlay';
        overlay.className = 'info-popup-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) closeInfoPopup(); });
    }

    const tagsHtml = content.tags?.length
        ? `<div class="info-popup-tags">${content.tags.map(t => `<span class="info-popup-tag">${t}</span>`).join('')}</div>`
        : '';
    const bodyText = typeof content.body === 'function' ? content.body() : content.body;
    const imageHtml = content.image ? `
        <figure class="info-popup-figure">
            <img src="${content.image.url}" alt="${content.image.alt}" class="info-popup-image" loading="lazy">
        </figure>
        <p class="info-popup-caption">${content.image.caption}</p>` : '';
    overlay.innerHTML = `
        <div class="info-popup" role="dialog" aria-modal="true">
            <button class="info-popup-close" id="info-popup-close" aria-label="Close">&#x2715;</button>
            <div class="info-popup-title">${content.title}</div>
            ${tagsHtml}
            <div class="info-popup-body">${bodyText.split('\n\n').map(p => `<p>${p}</p>`).join('')}</div>
            ${content.source ? `<div class="info-popup-source">${content.source}</div>` : ''}
            ${imageHtml}
        </div>
    `;
    overlay.hidden = false;
    const _infoTrigger = document.activeElement;
    const infoClose = document.getElementById('info-popup-close');
    infoClose.addEventListener('click', () => closeInfoPopup(_infoTrigger));
    // Store the bound handler so we can remove the exact same reference on close
    _infoKeyHandler = e => onInfoPopupKey(e, _infoTrigger);
    document.addEventListener('keydown', _infoKeyHandler);
    _infoPopupTrapCleanup = trapFocus(overlay);
    infoClose.focus();
}

let _infoPopupTrapCleanup = null;
let _infoKeyHandler = null;
function closeInfoPopup(trigger) {
    const overlay = document.getElementById('info-popup-overlay');
    if (overlay) overlay.hidden = true;
    if (_infoKeyHandler) { document.removeEventListener('keydown', _infoKeyHandler); _infoKeyHandler = null; }
    if (_infoPopupTrapCleanup) { _infoPopupTrapCleanup(); _infoPopupTrapCleanup = null; }
    if (trigger) trigger.focus();
}

function onInfoPopupKey(e, trigger) {
    if (e.key === 'Escape') closeInfoPopup(trigger);
}

// Auto-switch mode based on latest proceeding
function autoSwitchModeFromProceedings(items) {
    if (window._modeLocked) return;
    if (!items || items.length === 0) return;

    // Only the REST poll (fetchFloorData) should exit vote mode.
    // Proceedings fire every 5s and must never knock us out of an active vote.
    const liveStatus = floorData.currentStatus?.value;
    const sseIsLive  = lastSseTallyAt > 0 && (Date.now() - lastSseTallyAt) < 90_000;
    const inVoteMode = document.body.classList.contains('vote-mode') ||
                       liveStatus === 'vote' || liveStatus === 'voting' || sseIsLive;
    if (inVoteMode) {
        window.setMode('vote');
        return;
    }

    const latest = items[0].description.toLowerCase();

    // If the most recent proceeding is a recess or adjournment, stay in recess.
    if (latest.includes('adjourn') ||
        latest.includes('do now recess') ||
        latest.includes('stands in recess') ||
        latest.includes('house do now recess')) {
        window.setMode('recess');
        return;
    }

    // Appointment of Tellers — fires when it's the most-recent proceeding
    if (latest.startsWith('appointment of tellers')) {
        window.setMode('tellers');
        updateTellersSection(items);
        if (items[0].pubDate && elements.tellersTime) {
            elements.tellersTime.textContent = new Date(items[0].pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        }
        return;
    }

    // Joint Session (highest priority — rare, significant)
    // Use find() (newest first); if newest match is DISSOLVED, session is over
    const jsItem = items.find(i => /^JOINT SESSION\b/i.test(i.description.trim()) && !/DISSOLVED/i.test(i.description));
    if (jsItem) {
        window.setMode('joint-session');
        updateJointSessionSection(items);
        if (jsItem.pubDate && elements.jointSessionTime) {
            elements.jointSessionTime.textContent = new Date(jsItem.pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        }
        return;
    }

    // Certification of Electoral Votes
    const certElectoralItem = items.find(i => /^CERTIFICATION OF ELECTORAL VOTES\b/i.test(i.description.trim()));
    if (certElectoralItem) {
        window.setMode('cert-electoral');
        updateCertElectoralSection(items);
        if (certElectoralItem.pubDate && elements.certElectoralTime) {
            elements.certElectoralTime.textContent = new Date(certElectoralItem.pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        }
        return;
    }

    // Certification of Election
    const certElectionItem = items.find(i => /^CERTIFICATION OF ELECTION\b/i.test(i.description.trim()));
    if (certElectionItem) {
        window.setMode('cert-election');
        updateCertElectionSection(items);
        if (certElectionItem.pubDate && elements.certElectionTime) {
            elements.certElectionTime.textContent = new Date(certElectionItem.pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        }
        return;
    }

    // New Session (20th Amendment)
    const newSessionItem = items.find(i => {
        const d = i.description.toLowerCase();
        return d.includes('20th amendment') && (d.includes('convened') || d.includes('new legislative day'));
    });
    if (newSessionItem) {
        window.setMode('new-session');
        updateNewSessionSection(items);
        if (newSessionItem.pubDate && elements.newSessionTime) {
            elements.newSessionTime.textContent = new Date(newSessionItem.pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        }
        return;
    }

    // Administration of the Oath of Office (bulk/ceremonial — distinct from individual oath)
    const adminOathItem = items.find(i => /^ADMINISTRATION OF THE OATH OF OFFICE\b/i.test(i.description.trim()));
    if (adminOathItem) {
        window.setMode('admin-oath');
        updateAdminOathSection(items);
        if (adminOathItem.pubDate && elements.adminOathTime) {
            elements.adminOathTime.textContent = new Date(adminOathItem.pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        }
        return;
    }

    // Sine Die
    if (latest.includes('sine die')) {
        window.setMode('sine-die');
        updateSineDieSection(items);
        return;
    }

    // Joint Meeting — find newest joint-meeting-related item; if it's dissolved, mode is off
    const jmLatest = items.find(i => /^JOINT MEETING\b/i.test(i.description.trim()));
    if (jmLatest && !/DISSOLVED/i.test(jmLatest.description)) {
        window.setMode('joint-meeting');
        updateJointMeetingSection(items);
        if (jmLatest.pubDate && elements.jointMeetingTime) {
            elements.jointMeetingTime.textContent = new Date(jmLatest.pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        }
        return;
    }

    // These modes are driven purely by the most-recent item. They must be checked
    // before the candidates block, which scans all history and would otherwise let
    // a stale morning-hour item win over a just-started prayer, pledge, etc.
    if (latest.startsWith('the house received a message from')) {
        window.setMode('message');
        return;
    }
    if (latest.includes('prayer') || latest.includes('chaplain')) {
        window.setMode('prayer');
        return;
    }
    if (latest.includes('pledge') || latest.includes('allegiance')) {
        window.setMode('pledge');
        return;
    }
    if (latest.includes('moment of silence') || latest.includes('silence')) {
        window.setMode('silence');
        updateSilenceSection(items);
        return;
    }
    if (latest.includes('act as chairman of the committee') || latest.includes('act as chair of the committee')) {
        window.setMode('committee-chair');
        updateCommitteeChairSection(items);
        return;
    }
    if (latest.includes('speaker pro tempore') || latest.includes('pro tempore')) {
        window.setMode('speaker');
        return;
    }

    // For episodic modes (one-minute, special-order, morning-hour) vs persistent debate (COWH),
    // pick whichever has the most recent matching item — avoids stale morning speeches
    // overriding afternoon floor debate.
    const itemTime = i => i?.pubDate ? new Date(i.pubDate).getTime() : 0;

    // Don't surface episodic items from before the most recent recess/adjournment.
    // items[0] is the most recent; recess at index N means only items[0..N-1] are post-recess.
    const recessIdx = items.findIndex(i => {
        const d = i.description.toLowerCase();
        return d.includes('do now recess') || d.includes('stands in recess') ||
               d.includes('house do now recess') || d.includes('adjourn');
    });
    const candidateItems = recessIdx > 0 ? items.slice(0, recessIdx) : items;

    // Find the most recent passage/vote outcome item — if it's newer than the debate item,
    // the bill has already passed and we should not re-enter debate mode for it.
    const outcomeItem = candidateItems.find(i => {
        const d = i.description.toLowerCase();
        return /\bon passage\b/.test(d) ||
               /on agreeing to the (resolution|amendment)\b/.test(d) ||
               /agreed to by (recorded vote|voice vote|without objection)/i.test(d) ||
               /passed by (recorded vote|voice vote)/i.test(d);
    });

    const cotwItem = candidateItems.find(i => {
        const d = i.description.toLowerCase();
        if (d.includes('morning-hour debate') || d.includes('morning hour debate')) return false;
        const isDebate = d.includes('act as chairman of the committee') ||
               d.includes('committee of the whole') ||
               d.includes('resolved itself into the committee') ||
               d.startsWith('debate -') ||
               (d.includes('proceeded with') && d.includes('debate'));
        if (!isDebate) return false;
        // If a passage outcome is more recent than this debate item, the debate is over
        if (outcomeItem && itemTime(outcomeItem) >= itemTime(i)) return false;
        return true;
    });

    const soItem = candidateItems.find(i => {
        const d = i.description.toLowerCase();
        return d.includes('special order speech') || d.includes('special orders');
    });

    const omItem = candidateItems.find(i => {
        const d = i.description.toLowerCase();
        return d.includes('one minute speech') || d.includes('one-minute speech');
    });

    const mhItem = candidateItems.find(i => {
        const d = i.description.toLowerCase();
        return d.includes('morning-hour debate') || d.includes('morning hour debate');
    });

    // Build candidate list sorted by most-recent timestamp; COWH wins ties
    const candidates = [];
    if (cotwItem) candidates.push({ mode: 'debate',        item: cotwItem, tiebreak: 1 });
    if (soItem)   candidates.push({ mode: 'special-order', item: soItem,   tiebreak: 0 });
    if (omItem)   candidates.push({ mode: 'one-minute',    item: omItem,   tiebreak: 0 });
    if (mhItem)   candidates.push({ mode: 'morning-hour',  item: mhItem,   tiebreak: 0 });

    if (candidates.length > 0) {
        candidates.sort((a, b) => (itemTime(b.item) - itemTime(a.item)) || (b.tiebreak - a.tiebreak));
        const winner = candidates[0];
        if (winner.mode === 'debate') {
            window.setMode('debate');
            updateDebateSection(items);
        } else if (winner.mode === 'special-order') {
            window.setMode('special-order');
            if (soItem.pubDate && elements.specialOrderTime) {
                elements.specialOrderTime.textContent = new Date(soItem.pubDate).toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
                });
            }
            if (elements.specialOrderDescriptionLine) {
                elements.specialOrderDescriptionLine.textContent = decodeHtml(soItem.description);
            }
        } else if (winner.mode === 'one-minute') {
            window.setMode('one-minute');
            if (omItem.pubDate && elements.oneMinuteTime) {
                elements.oneMinuteTime.textContent = new Date(omItem.pubDate).toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
                });
            }
            if (elements.oneMinuteDescriptionLine) {
                elements.oneMinuteDescriptionLine.textContent = decodeHtml(omItem.description);
            }
        } else if (winner.mode === 'morning-hour') {
            window.setMode('morning-hour');
            if (mhItem.pubDate && elements.morningHourTime) {
                elements.morningHourTime.textContent = new Date(mhItem.pubDate).toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
                });
            }
        }
        return;
    }

    // Oath: only trigger if it's a recent proceeding (top 5), not an old one from earlier today
    const oathItem = items.slice(0, 5).find(i => /^OATH OF OFFICE\b/i.test(i.description.trim()));
    if (oathItem) {
        window.setMode('oath');
        return;
    }

    // Journal mode is NOT sticky. Only enter it when the journal approval is the
    // single most-recent proceeding (items[0]). Previously this scanned the entire
    // day with .some(), so a journal approval from hours ago became a catch-all that
    // overrode active business (votes, debate) whenever live status was unavailable.
    const latestDesc = items[0].description.toLowerCase();
    const latestIsJournal =
        latestDesc.includes('approval of the journal') ||
        latestDesc.includes('approved the journal') ||
        latestDesc.includes('announced approval of the journal');
    if (latestIsJournal) window.setMode('journal');
}

// Render the proceedings panel from an items array (no fetch — pure DOM update).
// Called both by updateProceedingsFeed (after REST fetch) and the SSE proceedings handler.
function proceedingsAgo(ms) {
    const diff = Math.floor((Date.now() - ms) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 360) return `${Math.floor(diff / 60)}h ago`;
    return '';
}

// Wrap bill number mentions in proceedings text with buttons that open the bill modal.
// Longer patterns must come first so H.J.Res. isn't partially matched as H. etc.
function linkifyBillNumbers(text) {
    // Clerk proceedings use "H. Res." (space after H.) — allow optional spaces throughout
    return text.replace(
        /(H\.J\.\s*Res\.|H\.Con\.\s*Res\.|H\.\s*Res\.|H\.R\.|S\.J\.\s*Res\.|S\.Con\.\s*Res\.|S\.\s*Res\.|S\.)\s*(\d+)/g,
        (match, type, num) => {
            // Normalize type to canonical form (strip internal spaces) so the id is stable
            const canonicalType = type.replace(/\s+/g, '');
            const billId = `${canonicalType} ${num}`;
            // If this bill is on the floor, open the modal; otherwise link to Congress.gov
            const hasModal = billDataMap.has(billId) || (() => {
                const norm = normalizeBillIdForRules(billId);
                for (const k of billDataMap.keys()) {
                    if (normalizeBillIdForRules(k) === norm) return true;
                }
                return false;
            })();
            if (hasModal) {
                return `<button class="proc-bill-link" data-bill-id="${escapeHtml(billId)}">${escapeHtml(match)}</button>`;
            }
            const url = billIdToCongressUrl(billId);
            if (url) {
                return `<a class="proc-bill-link proc-bill-external" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(match)}</a>`;
            }
            return escapeHtml(match);
        }
    );
}

function renderProceedingsFeedPanel(items) {
    if (!elements.proceedingsFeed) return;
    if (!items || items.length === 0) {
        setIfChanged(elements.proceedingsFeed, '<div class="proceedings-error">NO PROCEEDINGS DATA AVAILABLE</div>');
        return;
    }
    const proceedingsDate = proceedingsDateOverride
        ? new Date(proceedingsDateOverride)
        : new Date(items[0]?.pubDate || new Date());
    const dateStr = fmtDate(proceedingsDate);
    const timelineText = floorData.timeline?.first_votes?.text || '';
    const timelineHtml = timelineText ? `
        <div class="proceedings-next-header">
            <span class="proceedings-next-label">NEXT</span>
            <span class="proceedings-next-text">${escapeHtml(timelineText)}</span>
        </div>` : '';
    const html = items.map(item => {
        const pubDate = new Date(item.pubDate);
        const timeStr = pubDate.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
        });
        const agoStr = proceedingsAgo(pubDate.getTime());
        return `
        <div class="proceedings-item">
            <div class="proceedings-text">
                <span class="proceedings-time">${timeStr}</span>
                ${linkifyBillNumbers(decodeHtml(item.description))}
            </div>
        </div>`;
    }).join('');
    setIfChanged(elements.proceedingsFeed, timelineHtml + html);
    if (elements.proceedingsLastUpdate) {
        elements.proceedingsLastUpdate.textContent = dateStr;
    }
}

// Update proceedings feed (autoscroll removed)
async function updateProceedingsFeed() {
    if (!elements.proceedingsFeed) return;

    // Only show the loading placeholder on the very first load (feed is empty)
    if (!elements.proceedingsFeed.querySelector('.proceedings-item')) {
        setIfChanged(elements.proceedingsFeed, '<div class="proceedings-loading">FETCHING PROCEEDINGS...</div>');
    }

    try {
        const proceedingsUrl = proceedingsDateOverride
            ? `${RSS_CONFIG.workerUrl}?date=${encodeURIComponent(proceedingsDateOverride)}`
            : RSS_CONFIG.workerUrl;
        const response = await fetch(proceedingsUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (!data.items || data.items.length === 0) {
            setIfChanged(elements.proceedingsFeed, '<div class="proceedings-error">NO PROCEEDINGS DATA AVAILABLE</div>');
            return;
        }

        // Render the panel (HTML + date header)
        renderProceedingsFeedPanel(data.items);

        // Store items globally so debate/mode sections can re-render after bills load
        proceedingsData = data.items;
        nextSessionAt = parseNextSessionFromProceedings(data.items);

        // Auto-switch mode based on latest proceeding
        autoSwitchModeFromProceedings(data.items);

        // Mark any voice-vote or agreed-to passages reflected in proceedings
        updateBillStatusFromProceedings(data.items);

        // Update motion to recommit indicator on bill cards
        if (updateMotionsToRecommit(data.items)) updateBillsDisplay();

        // Update debate section with latest bill information
        updateDebateSection(data.items);

        // Update prayer, silence, and pledge sections
        updatePrayerSection(data.items);
        updateSilenceSection(data.items);
        updatePledgeSection(data.items);
        updateSpeakerSection(data.items);
        updateCommitteeChairSection(data.items);
        updateJournalSection(data.items);
        updateOathSection(data.items);
        updateMessageSection(data.items);
        updateTellersSection(data.items);
        if (document.body.classList.contains('tellers-mode') && !findTellersProceeding(data.items)) {
            showTellersEmptyState('No appointment of tellers appears in these proceedings.');
        }

        // Update new mode sections
        updateCertElectionSection(data.items);
        updateCertElectoralSection(data.items);
        updateSineDieSection(data.items);
        updateNewSessionSection(data.items);
        updateAdminOathSection(data.items);
        updateJointSessionSection(data.items);
        updateNextSessionCountdown();

    } catch (error) {
        console.error('Error fetching proceedings:', error);
        setIfChanged(elements.proceedingsFeed, '<div class="proceedings-error">UNABLE TO FETCH PROCEEDINGS</div>');
    }
}

let _debateLastBillId = null; // tracks which bill is shown so tab isn't reset on every poll

// Update debate section with bill information
function updateDebateSection(items) {
    if (!elements.debateBillTitle || !items || items.length === 0) return;

    // ── 1. Find the best proceedings item ───────────────────────────────
    // Mirror autoSwitchModeFromProceedings: only look at post-recess items
    // so stale debate entries from before a recess can never match.
    const recessIdx = items.findIndex(i => {
        const d = i.description.toLowerCase();
        return d.includes('do now recess') || d.includes('stands in recess') ||
               d.includes('house do now recess') || d.includes('adjourn');
    });
    const recentItems = recessIdx > 0 ? items.slice(0, recessIdx) : items;

    const debateItem = recentItems.find(i => /^DEBATE\b/i.test(i.description));
    const fallbackItem = recentItems.find(i => {
        const d = i.description.toLowerCase();
        if (d.includes('morning-hour debate') || d.includes('morning hour debate')) return false;
        return d.includes('committee of the whole') || d.includes('consideration of') || d.includes('proceeded to');
    });
    const activeItem = debateItem || fallbackItem;

    // ── 2. Parse debate length and bill ID from "proceeded with X of debate on BILL" ─
    let debateLengthLabel = null;
    let foundBillId = null;

    if (activeItem) {
        const desc = activeItem.description;

        // Debate length: "proceeded with forty minutes of debate" / "one hour of debate"
        const timeMatch = desc.match(/proceeded with (.+?) of debate/i);
        if (timeMatch) {
            debateLengthLabel = parseDebateLength(timeMatch[1]);
        }

        // Bill ID at end of phrase: "on S. 1003" / "on H.R. 1234" / "on H. Res. 456"
        const onBillMatch = desc.match(/\bon\s+(H\.\s*(?:R\.|Res\.|J\.\s*Res\.|Con\.\s*Res\.)|S\.\s*(?:Res\.\s*|Con\.\s*Res\.\s*|J\.\s*Res\.\s*)?)\s*(\d+)/i);
        if (onBillMatch) {
            // Normalize: collapse internal spaces between letters and re-attach number
            const prefix = onBillMatch[1].replace(/\s+/g, '').replace(/([A-Z])\.\s*(?=[A-Z])/gi, '$1.') + ' ';
            foundBillId = prefix + onBillMatch[2];
        } else {
            // Fallback: first bill pattern in description
            const billPattern = /\b(H\.R\.|H\.\s*Res\.|H\.\s*J\.\s*Res\.|H\.\s*Con\.\s*Res\.|S\.(?:\s*Res\.|\s*Con\.\s*Res\.|\s*J\.\s*Res\.)?)\s*(\d+)/gi;
            const m = billPattern.exec(desc);
            if (m) {
                foundBillId = m[1].replace(/\s+/g, '').replace(/([A-Z])\.\s*(?=[A-Z])/gi, '$1.') + ' ' + m[2];
            }
        }
    }

    // ── 3. Look up bill in billDataMap (try normalized variations) ────────
    let foundBill = null;
    if (foundBillId) {
        foundBill = billDataMap.get(foundBillId);
        if (!foundBill) {
            // Try normalizing both key and needle for comparison
            const normNeedle = foundBillId.replace(/([A-Z])\.\s+(?=[A-Z])/gi, '$1.').replace(/\s+/g, ' ').trim();
            for (const [key, val] of billDataMap) {
                const normKey = key.replace(/([A-Z])\.\s+(?=[A-Z])/gi, '$1.').replace(/\s+/g, ' ').trim();
                if (normKey === normNeedle) { foundBill = val; break; }
            }
        }
        // H.Res. rule resolutions are stored in billDataMap as "hres-XXXX" (not "H.Res. XXXX")
        if (!foundBill && /H\.?\s*Res\./i.test(foundBillId)) {
            const hresNum = foundBillId.match(/(\d+)/)?.[1];
            if (hresNum) foundBill = billDataMap.get(`hres-${hresNum}`);
        }
        // H.Res. with no billDataMap entry: look up the underlying bill from proceedings.
        // "DEBATE - ...on H. Res. 1140" → proceedings say it's "providing for consideration
        // of H.R. 5408" → show H.R. 5408's details (sponsor, summary, etc.) instead of blank.
        // IMPORTANT: only use proceedings items that mention THIS specific H.Res. number,
        // to avoid picking up entries from a different H.Res. debated earlier today.
        if (!foundBill && /H\.?\s*Res\./i.test(foundBillId)) {
            const hresNum = foundBillId.match(/(\d+)/)?.[1];
            const idPattern = /\b(H\.R\.|H\.\s*Res\.|S\.\s*(?:Res\.)?\s*|S\.)\s*(\d+)/gi;
            for (const item of recentItems) {
                const desc = item.description || '';
                if (!/provid(?:ing|es) for consideration of/i.test(desc)) continue;
                // Only use items that refer to THIS H.Res. (not another one from earlier)
                if (hresNum && !new RegExp(`\\bRes\\.\\s*${hresNum}\\b`).test(desc)) continue;
                for (const m of desc.matchAll(idPattern)) {
                    const normalized = m[1].replace(/\s+/g, '') + ' ' + m[2];
                    if (normalized === foundBillId) continue; // skip the H.Res. itself
                    const candidate = billDataMap.get(normalized)
                        || (/H\.?\s*Res\./i.test(normalized) && billDataMap.get(`hres-${normalized.match(/(\d+)/)?.[1]}`))
                        || null;
                    if (candidate) { foundBill = candidate; break; }
                }
                if (foundBill) break;
            }
        }
    }

    // Wider fallback: only run when there was no DEBATE/committee item at all.
    // If an activeItem was found but named no bill (e.g. "motion to discharge"),
    // scanning further would pull in stale bill references from old proceedings.
    if (!foundBill && !foundBillId && !activeItem) {
        const billPattern = /\b(H\.R\.|H\.Res\.|H\.J\.Res\.|H\.Con\.Res\.|S\.)\s*(\d+)/gi;
        for (const item of recentItems) {
            const desc = item.description || '';
            const descLower = desc.toLowerCase();
            if (!descLower.includes('committee of the whole') && !descLower.includes('consideration of') &&
                !descLower.includes('proceeded to') && !descLower.includes('debate')) continue;
            for (const m of desc.matchAll(billPattern)) {
                const raw = m[0].replace(/\s+/g, ' ').trim();
                if (billDataMap.has(raw)) { foundBill = billDataMap.get(raw); break; }
            }
            if (foundBill) break;
        }
    }

    // ── 4. Update debate length tag + timestamp ───────────────────────────
    if (elements.debateLengthTag && elements.debateLengthText) {
        if (debateLengthLabel) {
            elements.debateLengthText.textContent = debateLengthLabel;
            elements.debateLengthTag.style.display = '';
        } else {
            elements.debateLengthTag.style.display = 'none';
        }
    }
    if (elements.debateTime) {
        const pubDate = activeItem?.pubDate;
        if (pubDate) {
            elements.debateTime.textContent = new Date(pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        } else {
            elements.debateTime.textContent = '';
        }
    }

    // ── 5. Committee of the Whole indicator (shown in congress-info panel) ───
    if (elements.cotwIndicator) {
        const cotwIn  = items.findIndex(i => /resolved itself into the committee of the whole/i.test(i.description));
        const cotwOut = items.findIndex(i => /rose from the committee of the whole/i.test(i.description));
        const inSession = cotwIn >= 0 && (cotwOut < 0 || cotwIn < cotwOut);
        elements.cotwIndicator.style.display = inSession ? '' : 'none';
    }

    // ── 6. Special rule tag ───────────────────────────────────────────────
    const specialRule = foundBill ? specialRulesMap.get(normalizeBillIdForRules(foundBill.id)) : null;
    const fallbackDebateHres = (!specialRule && foundBill?.governingHres) ? foundBill.governingHres : null;
    if (elements.debateRuleTag) {
        if (specialRule) {
            elements.debateRuleTag.innerHTML = `<button class="bill-rule-tag" type="button" data-bill-id="hres-${specialRule.hresNum}">PURSUANT TO ${specialRule.hres}</button>`;
        } else if (fallbackDebateHres) {
            const hresNum = fallbackDebateHres.match(/(\d+)$/)?.[1];
            if (hresNum) {
                elements.debateRuleTag.innerHTML = `<button class="bill-rule-tag" type="button" data-bill-id="hres-${hresNum}">PURSUANT TO ${fallbackDebateHres}</button>`;
            } else {
                elements.debateRuleTag.innerHTML = `<span class="bill-rule-tag">PURSUANT TO ${fallbackDebateHres}</span>`;
            }
        } else {
            elements.debateRuleTag.innerHTML = '';
        }
    }

    // ── 6. Panel nav (Bill Details ↔ Amendments toggle) ──────────────────
    const rulesSlug = foundBill ? billIdToRulesSlug(foundBill.id) : null;
    const hasAmendments = rulesSlug && (foundBill?.procedure === 'rule' || foundBill?.isRule === true);
    // Header source follows the active panel: Bill Details → House Clerk;
    // Amendments → House Rules Committee (where amendments are filed).
    const setDebateSource = (panel) => {
        const a = elements.debateSourceLink;
        if (!a) return;
        if (panel === 'amendments' && rulesSlug) {
            a.href = `https://rules.house.gov/bill/${currentCongress || 119}/${rulesSlug}`;
            a.textContent = 'House Rules Committee';
        } else {
            a.href = 'https://clerk.house.gov/FloorSummary';
            a.textContent = 'Legislative Activity (House Clerk)';
        }
    };
    if (elements.debatePanelNav) {
        if (hasAmendments) {
            elements.debatePanelNav.style.display = 'flex';
            // Wire up nav buttons once (avoid stacking listeners)
            const navBtns = elements.debatePanelNav.querySelectorAll('.bill-panel-nav-btn');
            const billPanel = elements.debateBillPanel;
            const amendPanel = elements.debateAmendmentsPanel;
            navBtns.forEach(btn => {
                btn.onclick = () => {
                    navBtns.forEach(b => b.classList.remove('is-active'));
                    btn.classList.add('is-active');
                    if (btn.dataset.panel === 'bill') {
                        if (billPanel) billPanel.style.display = '';
                        if (amendPanel) amendPanel.style.display = 'none';
                        setDebateSource('bill');
                    } else {
                        if (billPanel) billPanel.style.display = 'none';
                        if (amendPanel) amendPanel.style.display = '';
                        loadAmendments(rulesSlug, 'debate-amendments-body', 'debate-amendments-count');
                        setDebateSource('amendments');
                    }
                };
            });
            // Reset to bill panel only when the bill changes (not on every 15s poll)
            if (foundBillId !== _debateLastBillId) {
                _debateLastBillId = foundBillId;
                navBtns.forEach(b => b.classList.remove('is-active'));
                navBtns[0]?.classList.add('is-active');
                if (billPanel) billPanel.style.display = '';
                if (amendPanel) amendPanel.style.display = 'none';
                setDebateSource('bill');
            }
        } else {
            elements.debatePanelNav.style.display = 'none';
            setDebateSource('bill'); // no amendments tab → always Clerk
        }
    }

    // ── 6. Render bill details ────────────────────────────────────────────
    if (foundBill) {
        elements.debateBillTitle.textContent = foundBill.title || '—';
        elements.debateBillId.textContent = foundBill.id || '';

        // Sponsor block
        if (elements.debateSponsorSection && elements.debateSponsorInner) {
            if (foundBill.sponsor) {
                const s = foundBill.sponsor;
                const pClass = s.party === 'R' ? 'republican' : s.party === 'D' ? 'democrat' : 'independent';
                const pLetter = s.party === 'R' ? 'R' : s.party === 'D' ? 'D' : 'I';
                const name = `${s.firstName} ${s.lastName}`;
                const loc = s.state + (s.district != null ? `-${String(s.district).padStart(2, '0')}` : '');
                const photo = `https://bioguide.congress.gov/bioguide/photo/${s.bioguideId.charAt(0)}/${s.bioguideId}.jpg`;
                elements.debateSponsorInner.innerHTML = `
                    <div class="absentee-member" style="padding:0;border:none;">
                        <div class="absentee-photo-wrap" style="width:36px;height:36px;border-radius:8px;flex-shrink:0;">
                            <div class="absentee-photo-placeholder">${MEMBER_PHOTO_PLACEHOLDER}</div>
                            <img class="absentee-photo" src="${photo}" alt="${name}" onload="this.style.opacity='1';" onerror="this.style.display='none';" />
                        </div>
                        <div class="absentee-meta">
                            <span class="absentee-party-tag ${pClass}">${pLetter}</span>
                            <span class="absentee-name">${name}</span>
                            <span class="absentee-state">${loc}</span>
                        </div>
                    </div>`;
                elements.debateSponsorSection.style.display = '';
            } else {
                elements.debateSponsorSection.style.display = 'none';
            }
        }

        // Cosponsor support bar
        if (elements.debateSupportSection && elements.debateSupportBar && elements.debateSupportLabels) {
            const allSupporters = [
                ...(foundBill.sponsor ? [foundBill.sponsor] : []),
                ...(foundBill.cosponsors || []),
            ];
            if (allSupporters.length > 0) {
                const rCount = allSupporters.filter(m => m.party === 'R').length;
                const dCount = allSupporters.filter(m => m.party === 'D').length;
                const iCount = allSupporters.filter(m => m.party !== 'R' && m.party !== 'D').length;
                const total = allSupporters.length;
                const rPct = (rCount / total * 100).toFixed(1);
                const dPct = (dCount / total * 100).toFixed(1);
                const iPct = (iCount / total * 100).toFixed(1);
                const coLabel = foundBill.cosponsors?.length
                    ? `${foundBill.cosponsors.length} COSPONSOR${foundBill.cosponsors.length !== 1 ? 'S' : ''}`
                    : 'NO COSPONSORS';
                if (elements.debateSupportLabel) elements.debateSupportLabel.textContent = `SUPPORT — ${coLabel}`;
                elements.debateSupportBar.innerHTML = [
                    dCount ? `<div class="bill-modal-support-fill dem" style="width:${dPct}%" title="${dCount} Democrat${dCount !== 1 ? 's' : ''}"></div>` : '',
                    rCount ? `<div class="bill-modal-support-fill rep" style="width:${rPct}%" title="${rCount} Republican${rCount !== 1 ? 's' : ''}"></div>` : '',
                    iCount ? `<div class="bill-modal-support-fill ind" style="width:${iPct}%" title="${iCount} Independent${iCount !== 1 ? 's' : ''}"></div>` : '',
                ].join('');
                elements.debateSupportLabels.innerHTML = [
                    dCount ? `<span class="bill-modal-support-count dem">${dCount}D</span>` : '',
                    rCount ? `<span class="bill-modal-support-count rep">${rCount}R</span>` : '',
                    iCount ? `<span class="bill-modal-support-count ind">${iCount}I</span>` : '',
                ].join('');
                elements.debateSupportSection.style.display = '';
            } else {
                elements.debateSupportSection.style.display = 'none';
            }
        }

        // Committee (merged: chips + report tally + date — mirrors modal layout)
        if (elements.debateCommitteesSection && elements.debateCommitteesList) {
            const hasReport = !!foundBill.committeeReport;
            const committeeNames = foundBill.committees?.length ? foundBill.committees : (hasReport ? ['Committee'] : []);
            if (committeeNames.length || hasReport) {
                // Build report tally/text inner HTML (same logic as modal)
                let reportInner = '';
                if (hasReport) {
                    const tallyM = foundBill.committeeReport.match(/(\d+)[-–](\d+)/);
                    if (tallyM) {
                        reportInner = `<span class="committee-chip-tally"><b class="ct-aye">${tallyM[1]}</b><span class="ct-sep">–</span><b class="ct-nay">${tallyM[2]}</b></span>`;
                    } else {
                        const label = escapeHtml(foundBill.committeeReport.replace(/^reported( by committee)?\s*/i, '') || 'Reported');
                        reportInner = `<span class="committee-chip-tally committee-chip-tally-text">${label}</span>`;
                    }
                }
                elements.debateCommitteesList.innerHTML = committeeNames
                    .map((c, i) => `<span class="bill-modal-committee"><span class="committee-chip-name">${escapeHtml(c)}</span>${i === 0 ? reportInner : ''}</span>`)
                    .join('');
                // Label: "REFERRED TO" if no report, "COMMITTEE" if reported
                if (elements.debateCommitteesLabel) {
                    elements.debateCommitteesLabel.textContent = hasReport ? 'COMMITTEE' : 'REFERRED TO';
                }
                // Date pinned right
                if (elements.debateCommitteeDate) {
                    if (foundBill.committeeReportDate) {
                        elements.debateCommitteeDate.textContent = formatDate(foundBill.committeeReportDate);
                        elements.debateCommitteeDate.style.display = '';
                    } else {
                        elements.debateCommitteeDate.style.display = 'none';
                    }
                }
                elements.debateCommitteesSection.style.display = '';
            } else {
                elements.debateCommitteesSection.style.display = 'none';
            }
        }

        // Summary
        if (elements.debateSummarySection && elements.debateBillDescription) {
            if (foundBill.summary) {
                // Decode HTML entities (e.g. &nbsp;) before display as plain text
                const tmp = document.createElement('div');
                tmp.innerHTML = foundBill.summary;
                elements.debateBillDescription.textContent = tmp.textContent;
                elements.debateSummarySection.style.display = '';
            } else {
                elements.debateSummarySection.style.display = 'none';
            }
        }

        // Links footer
        const congressUrl = billIdToCongressUrl(foundBill.id);
        const procedureClass = foundBill.procedure === 'suspension' ? 'suspension' : 'rule';
        const textUrl = foundBill.textUrl || null;
        if (elements.debateLinksFoot) {
            const setLink = (el, url, label) => {
                if (!el) return;
                if (url) { el.href = url; el.className = `bill-modal-link ${procedureClass}`; el.style.display = ''; }
                else { el.style.display = 'none'; }
            };
            setLink(elements.debateLinkText,    textUrl,                  'View Bill Text →');
            setLink(elements.debateLinkReport,  foundBill.committeeReportUrl, 'View Committee Report →');
            setLink(elements.debateLinkSap,     foundBill.sapUrl,         'View White House Memo →');
            setLink(elements.debateLinkCongress, congressUrl,             'View on Congress.gov →');
            const anyLink = textUrl || foundBill.committeeReportUrl || foundBill.sapUrl || congressUrl;
            elements.debateLinksFoot.style.display = anyLink ? '' : 'none';
        }
    } else {
        // Bill not in billDataMap.
        // For H.Res. rule resolutions: extract the underlying bill IDs from the proceedings
        // and try to look up the primary underlying bill in billDataMap so the full rich
        // display (sponsor, summary, etc.) can show.  The H.Res. is just the procedural wrapper.
        // Build a descriptive title from proceedings for H.Res. rules
        let fallbackTitle = foundBillId ? '—' : '—';
        if (foundBillId && /H\.?\s*Res\./i.test(foundBillId)) {
            const hresNum = foundBillId.match(/(\d+)/)?.[1];
            for (const item of recentItems) {
                const desc = item.description || '';
                if (!/provid(?:ing|es) for consideration of/i.test(desc)) continue;
                // Only use items that refer to THIS H.Res. (not another one from earlier)
                if (hresNum && !new RegExp(`\\bRes\\.\\s*${hresNum}\\b`).test(desc)) continue;
                const idPattern = /\b(H\.R\.|H\.\s*Res\.|S\.\s*(?:Res\.)?\s*|S\.)\s*(\d+)/gi;
                const ids = [];
                for (const m of desc.matchAll(idPattern)) {
                    const normalized = m[1].replace(/\s+/g, '') + ' ' + m[2];
                    if (normalized === foundBillId) continue;
                    if (!ids.includes(normalized)) ids.push(normalized);
                }
                if (ids.length > 0) {
                    const listed = ids.length === 1
                        ? ids[0]
                        : ids.slice(0, -1).join(', ') + ', and ' + ids[ids.length - 1];
                    fallbackTitle = `Providing for consideration of ${listed}`;
                    break;
                }
            }
        }
        elements.debateBillTitle.textContent = fallbackTitle;
        elements.debateBillId.textContent = foundBillId || '—';
        if (elements.debateSponsorSection) elements.debateSponsorSection.style.display = 'none';
        if (elements.debateSupportSection) elements.debateSupportSection.style.display = 'none';
        if (elements.debateCommitteesSection) elements.debateCommitteesSection.style.display = 'none';
        if (elements.debateSummarySection) elements.debateSummarySection.style.display = 'none';
        if (elements.debateLinksFoot) elements.debateLinksFoot.style.display = 'none';
    }
}

// Update silence section with honoree information
function updateSilenceSection(items) {
    if (!elements.silenceTitle || !items || items.length === 0) return;

    const silenceItem = items.find(item =>
        /moment of silence/i.test(item.description) || /\bsilence\b/i.test(item.description)
    );

    if (!silenceItem) {
        elements.silenceTitle.textContent = 'Moment of Silence';
        if (elements.silenceDescription) elements.silenceDescription.textContent = '';
        if (elements.silenceTime) elements.silenceTime.textContent = '';
        return;
    }

    // Full proceedings text e.g.
    // "MOMENT OF SILENCE - The House observed a moment of silence in honor of the victims of..."
    const fullText = silenceItem.description.replace(/\s+/g, ' ').trim();

    // Strip the "MOMENT OF SILENCE - " prefix to get the body sentence
    const body = fullText.replace(/^MOMENT OF SILENCE\s*[-–]\s*/i, '').trim();

    // Extract a short title from the body ("in honor of X" / "for X" / "in memory of X")
    const honorMatch = body.match(/in (?:honor|memory|memoriam) of (.+?)(?:\.|,|$)/i)
                    || body.match(/for (?:the )?(.+?)(?:\.|,|$)/i);
    const shortTitle = honorMatch ? honorMatch[1].trim() : 'Moment of Silence';

    if (elements.silenceTitle) elements.silenceTitle.textContent = toTitleCase(shortTitle);
    if (elements.silenceDescription) elements.silenceDescription.textContent = body;

    if (elements.silenceTime && silenceItem.pubDate) {
        const date = new Date(silenceItem.pubDate);
        elements.silenceTime.textContent = date.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
        });
    }
}

function updatePrayerSection(items) {
    if (!elements.prayerLeaderTitle || !items || items.length === 0) return;

    // Search for prayer-related proceedings
    const prayerItem = items.find(item => {
        const desc = item.description.toLowerCase();
        return desc.includes('prayer') || desc.includes('chaplain');
    });

    if (!prayerItem) {
        elements.prayerLeaderTitle.textContent = 'No Prayer Information';
        elements.prayerLeaderName.textContent = '--';
        elements.prayerLeaderDescription.textContent = 'No prayer information available in current proceedings.';
        elements.prayerTime.textContent = '';
        if (elements.prayerLeaderWebsite) {
            elements.prayerLeaderWebsite.href = 'https://chaplain.house.gov/chaplaincy/index.html';
            elements.prayerLeaderWebsite.textContent = 'https://chaplain.house.gov';
        }
        return;
    }

    const description = prayerItem.description;
    const pubDate = prayerItem.pubDate;
    const normalizedDescription = description.replace(/\s+/g, ' ').trim();

    // Extract time from pubDate
    if (pubDate) {
        const date = new Date(pubDate);
        const timeStr = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        });
        elements.prayerTime.textContent = timeStr;
    }

    // Determine if it's the House Chaplain or a guest chaplain
    const isGuestChaplain = /guest|invited|offered by/i.test(normalizedDescription) &&
                           !/chaplain\s+margaret|house chaplain/i.test(normalizedDescription);

    const chaplainWebsite = isGuestChaplain
        ? 'https://chaplain.house.gov/chaplaincy/guest_chaplains.html'
        : 'https://chaplain.house.gov/chaplaincy/index.html';

    // Extract chaplain name - handle both house chaplain and guest prayer formats
    let chaplainName = 'Unknown Chaplain';
    const guestMatch = normalizedDescription.match(/(?:today'?s\s+prayer\s+was\s+)?offered\s+by\s+([^,]+)(?:,|$)/i);
    if (guestMatch) {
        chaplainName = guestMatch[1].trim();
    }

    const nameMatch = normalizedDescription.match(/chaplain\s+([^.]+)\./i);
    if (nameMatch) {
        chaplainName = nameMatch[1].trim();
    } else if (!guestMatch) {
        // Fallback to other patterns
        const fallbackMatch = normalizedDescription.match(/(?:by|led\s*by|offered\s*by):?\s*(.+?)(?:\n|,|\.|$)/i);
        if (fallbackMatch) {
            chaplainName = fallbackMatch[1].trim();
        }
    }

    // Remove trailing period if present
    chaplainName = chaplainName.replace(/\.$/, '').trim();

    // Keep the House Chaplain name in sync for the info popup (not guests)
    if (!isGuestChaplain) _lastChaplainName = chaplainName;

    // Extract additional information - try to get meaningful description
    let additionalInfo = '';
    
    // Try to extract text between the name and the end, skipping common patterns
    const afterNameMatch = normalizedDescription.match(new RegExp(chaplainName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*,\\s*(.+)', 'i'));
    if (afterNameMatch && afterNameMatch[1]) {
        additionalInfo = afterNameMatch[1].trim();
        // Remove common prefixes like "Today's", "The", etc.
        additionalInfo = additionalInfo.replace(/^(Today's|The|A)\s+/i, '');
        // Limit length
        if (additionalInfo.length > 150) {
            additionalInfo = additionalInfo.substring(0, 150) + '...';
        }
    }

    // Update prayer section elements
    elements.prayerLeaderTitle.textContent = isGuestChaplain ? 'Guest Chaplain' : 'House Chaplain';
    elements.prayerLeaderName.textContent = chaplainName;
    elements.prayerLeaderDescription.textContent = additionalInfo || (isGuestChaplain ? 'Leading the House in prayer.' : 'The Chaplain intercedes for Members and asks for blessings on them as they labor to make decisions for the good of the nation.');
    if (elements.prayerLeaderWebsite) {
        elements.prayerLeaderWebsite.href = chaplainWebsite;
        elements.prayerLeaderWebsite.textContent = 'https://chaplain.house.gov';
    }

    // Handle image display
    if (isGuestChaplain) {
        elements.prayerImage.style.display = 'none';
        elements.prayerImage.removeAttribute('src');
        elements.prayerImagePlaceholder.style.display = 'flex';
    } else {
        // For House Chaplain, look up photo via Wikipedia using the name from proceedings.
        // Placeholder shows while loading; fades to photo on success; stays on failure.
        elements.prayerImage.alt = `${chaplainName}, House Chaplain`;
        elements.prayerImage.style.opacity = '0';

        const applyChaplainPhoto = (url) => {
            elements.prayerImagePlaceholder.style.display = 'none';
            elements.prayerImage.style.display = 'block';
            elements.prayerImage.onload = () => { elements.prayerImage.style.opacity = '1'; };
            elements.prayerImage.onerror = () => {
                elements.prayerImage.style.display = 'none';
                elements.prayerImagePlaceholder.style.display = 'flex';
            };
            elements.prayerImage.src = url;
        };

        if (_chaplainPhotoCache?.name === chaplainName) {
            applyChaplainPhoto(_chaplainPhotoCache.url);
        } else {
            elements.prayerImagePlaceholder.style.display = 'flex';
            elements.prayerImage.style.display = 'none';
            (async () => {
                try {
                    const q = encodeURIComponent(chaplainName + ' chaplain');
                    const searchRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=1&format=json&origin=*`);
                    if (!searchRes.ok) throw new Error('search failed');
                    const searchData = await searchRes.json();
                    const pageId = searchData?.query?.search?.[0]?.pageid;
                    if (!pageId) throw new Error('no article');

                    const imgRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&pageids=${pageId}&prop=pageimages&pithumbsize=400&format=json&origin=*`);
                    if (!imgRes.ok) throw new Error('image fetch failed');
                    const imgData = await imgRes.json();
                    const thumbUrl = imgData?.query?.pages?.[pageId]?.thumbnail?.source;
                    if (!thumbUrl) throw new Error('no image');

                    _chaplainPhotoCache = { name: chaplainName, url: thumbUrl };
                    if (elements.prayerImage) applyChaplainPhoto(thumbUrl);
                } catch (_e) {
                    // Photo is optional — placeholder already showing
                }
            })();
        }
    }
}

// Update pledge section with pledge leader information
function updatePledgeSection(items) {
    if (!elements.pledgeLeaderTitle || !items || items.length === 0) return;

    // Search for pledge-related proceedings
    const pledgeItem = items.find(item => {
        const desc = item.description.toLowerCase();
        return desc.includes('pledge') || desc.includes('allegiance');
    });

    if (!pledgeItem) {
        elements.pledgeLeaderTitle.textContent = 'No Pledge Information';
        elements.pledgeLeaderName.textContent = '--';
        elements.pledgePartyTag.textContent = '';
        elements.pledgeLeaderDetails.textContent = '';
        elements.pledgeLeaderAdditional.textContent = '';
        elements.pledgeTime.textContent = '';
        return;
    }

    const description = pledgeItem.description;
    const pubDate = pledgeItem.pubDate;

    // Extract time from pubDate
    if (pubDate) {
        const date = new Date(pubDate);
        const timeStr = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        });
        elements.pledgeTime.textContent = timeStr;
    }

    // Extract who is leading the pledge
    const designatedMatch = description.match(/designated\s+(.+?)\s+to\s+lead/i);
    const chairLedMatch = /the\s+chair\s+led/i.test(description);

    if (designatedMatch) {
        let leaderName = designatedMatch[1].trim();
        leaderName = leaderName.replace(/^(?:the\s+honorable|honorable|Mr\.|Ms\.|Mrs\.|Dr\.)\s+/i, '').trim();
        elements.pledgeLeaderTitle.textContent = 'Pledge Leader';
        elements.pledgeLeaderName.textContent = leaderName;
        fetchMemberPhotoFromClerkData(leaderName);
    } else if (chairLedMatch) {
        // "The Chair led" — resolve who the Chair is
        const proTemporeItem = items.find(item => {
            const d = item.description.toLowerCase();
            return d.includes('speaker pro tempore') || d.includes('designated the honorable');
        });

        if (proTemporeItem) {
            // Use the designated Speaker Pro Tempore
            const proMatch = proTemporeItem.description.match(
                /designated\s+the\s+Honorable\s+(.+?)\s+to\s+act/i
            ) || proTemporeItem.description.match(/designated\s+(.+?)\s+to\s+act/i);
            const proName = proMatch ? proMatch[1].trim() : null;
            if (proName) {
                elements.pledgeLeaderTitle.textContent = 'Pledge Leader';
                elements.pledgeLeaderName.textContent = proName;
                fetchMemberPhotoFromClerkData(proName);
                return;
            }
        }

        // No pro tempore — fall back to the elected Speaker
        elements.pledgeLeaderTitle.textContent = 'Pledge Leader';
        elements.pledgeLeaderName.textContent = 'Resolving Speaker...';
        fetchSpeakerAsChair();
    } else {
        const fallbackMatch = description.match(/(?:by|led\s*by):\s*(.+?)(?:\n|,|\.|$)/i);
        if (fallbackMatch) {
            let leaderName = fallbackMatch[1].trim().replace(/^(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+/i, '');
            elements.pledgeLeaderTitle.textContent = 'Pledge Leader';
            elements.pledgeLeaderName.textContent = leaderName;
            fetchMemberPhotoFromClerkData(leaderName);
        }
    }
}

async function updateJournalSection(items) {
    if (!elements.journalChairTitle) return;

    const journalItem = items.find(item =>
        item.description.toLowerCase().includes('approval of the journal') ||
        item.description.toLowerCase().includes('approved the journal')
    );

    if (journalItem?.pubDate) {
        const d = new Date(journalItem.pubDate);
        elements.journalTime.textContent = d.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
        });
    }

    // Find last session date and display it
    fetchLastSessionDate();

    // Determine the Chair: pro tempore if present, else Speaker
    const proTemporeItem = items.find(item => {
        const d = item.description.toLowerCase();
        return d.includes('speaker pro tempore') || d.includes('designated the honorable');
    });

    if (proTemporeItem) {
        const proMatch = proTemporeItem.description.match(
            /designated\s+the\s+Honorable\s+(.+?)\s+to\s+act/i
        ) || proTemporeItem.description.match(/designated\s+(.+?)\s+to\s+act/i);
        const proName = proMatch ? proMatch[1].trim() : null;
        if (proName) {
            elements.journalChairTitle.textContent = 'Speaker Pro Tempore';
            elements.journalChairName.textContent = proName;
            fetchJournalChairInfo(proName);
            return;
        }
    }

    // No pro tempore — use the Speaker
    elements.journalChairTitle.textContent = 'Speaker of the House';
    elements.journalChairName.textContent = 'Resolving...';
    fetchJournalSpeakerInfo();
}

async function fetchLastSessionDate() {
    if (!elements.journalLastSessionDate) return;
    try {
        const before = proceedingsDateOverride || (() => {
            const t = new Date();
            return `${String(t.getMonth()+1).padStart(2,'0')}/${String(t.getDate()).padStart(2,'0')}/${t.getFullYear()}`;
        })();
        const res = await fetch(`https://api.evanhollander.org/house-floor/api/last-session-date?before=${encodeURIComponent(before)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { date } = await res.json();
        if (date) {
            const d = new Date(date + 'T12:00:00');
            elements.journalLastSessionDate.textContent = fmtDateLong(d);
        }
    } catch (e) {
        console.error('fetchLastSessionDate failed:', e);
    }
}

async function fetchJournalChairInfo(name) {
    try {
        const clean = name.replace(/^(?:Mr\.|Ms\.|Mrs\.|Dr\.|the\s+Honorable)\s+/i, '').trim();
        const lastName = clean.split(/\s+/).pop();
        const xml = await getMemberXml();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml, 'text/xml');
        const members = xmlDoc.querySelectorAll('member');
        let best = null, bestScore = 0;
        for (const m of members) {
            const ln = m.querySelector('lastname')?.textContent.trim() || '';
            const score = calculateNameSimilarity(lastName, ln);
            if (score > bestScore && score > 0.5) { bestScore = score; best = m; }
        }
        if (best) populateJournalChair(best);
    } catch (e) {
        console.error('fetchJournalChairInfo failed:', e);
    }
}

async function fetchJournalSpeakerInfo() {
    try {
        const res = await fetch('https://api.evanhollander.org/house-floor/api/leadership');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (elements.journalChairName) elements.journalChairName.textContent = data.name;
        const xml = await getMemberXml();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml, 'text/xml');
        const members = xmlDoc.querySelectorAll('member');
        for (const m of members) {
            if (m.querySelector('bioguideID')?.textContent.trim() === data.bioguideId) {
                populateJournalChair(m, data.bioguideId);
                break;
            }
        }
    } catch (e) {
        console.error('fetchJournalSpeakerInfo failed:', e);
        if (elements.journalChairName) elements.journalChairName.textContent = 'Speaker of the House';
    }
}

function populateJournalChair(memberEl, bioguideIdOverride) {
    const bioguideId = bioguideIdOverride || memberEl.querySelector('bioguideID')?.textContent.trim() || '';
    const firstName = memberEl.querySelector('firstname')?.textContent.trim() || '';
    const lastName = memberEl.querySelector('lastname')?.textContent.trim() || '';
    const party = memberEl.querySelector('party')?.textContent.trim() || '';
    const state = memberEl.querySelector('state')?.getAttribute('postal-code') || '';
    const district = memberEl.querySelector('district')?.textContent.trim() || '';
    const town = memberEl.querySelector('townname')?.textContent.trim() || '';

    if (elements.journalChairName) elements.journalChairName.textContent = `${firstName} ${lastName}`;
    if (elements.journalPartyTag) {
        elements.journalPartyTag.textContent = party;
        elements.journalPartyTag.className = 'journal-party-tag ' +
            (party === 'R' ? 'republican' : party === 'D' ? 'democrat' : 'independent');
    }
    if (elements.journalChairDetails) elements.journalChairDetails.textContent = `${state}-${normalizeDistrict(district)}`;
    if (elements.journalChairAdditional) elements.journalChairAdditional.textContent = town ? `from ${town}, ${state}` : '';

    if (bioguideId) {
        const photoUrl = buildBioguidePhotoUrl(bioguideId);
        const profileUrl = buildCongressProfileUrl(bioguideId);
        if (elements.journalImage) {
            elements.journalImage.style.opacity = '0';
            elements.journalImage.onload = () => { elements.journalImage.style.opacity = '1'; };
            elements.journalImage.onerror = () => { elements.journalImage.style.opacity = '0'; };
            elements.journalImage.src = photoUrl;
            elements.journalImage.alt = `${firstName} ${lastName}`;
        }
        setMemberProfileLink(elements.journalChairWebsite, profileUrl);
    }
}

async function fetchSpeakerAsChair() {
    try {
        const response = await fetch('https://api.evanhollander.org/house-floor/api/leadership');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        const { bioguideId, name } = data;
        if (elements.pledgeLeaderName) elements.pledgeLeaderName.textContent = name;

        // Fetch member details from member-data XML for party/district/etc
        const xml = await getMemberXml();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml, 'text/xml');
        const members = xmlDoc.querySelectorAll('member');
        let match = null;
        for (const m of members) {
            if (m.querySelector('bioguideID')?.textContent.trim() === bioguideId) {
                match = m; break;
            }
        }

        if (match) {
            const party = match.querySelector('party')?.textContent.trim() || '';
            const state = match.querySelector('state')?.getAttribute('postal-code') || '';
            const district = match.querySelector('district')?.textContent.trim() || '';
            const town = match.querySelector('townname')?.textContent.trim() || '';
            if (elements.pledgePartyTag) {
                elements.pledgePartyTag.textContent = party;
                elements.pledgePartyTag.className = 'pledge-party-tag ' +
                    (party === 'R' ? 'republican' : party === 'D' ? 'democrat' : 'independent');
            }
            if (elements.pledgeLeaderDetails) elements.pledgeLeaderDetails.textContent = `${state}-${normalizeDistrict(district)}`;
            if (elements.pledgeLeaderAdditional) elements.pledgeLeaderAdditional.textContent = town ? `from ${town}, ${state}` : '';
        }

        // Photo from BioGuide
        const photoUrl = buildBioguidePhotoUrl(bioguideId);
        if (elements.pledgeImage) {
            elements.pledgeImage.style.display = 'block';
            elements.pledgeImage.style.opacity = '0';
            elements.pledgeImage.onload = () => { elements.pledgeImage.style.opacity = '1'; };
            elements.pledgeImage.onerror = () => { elements.pledgeImage.style.display = 'none'; };
            elements.pledgeImage.src = photoUrl;
            elements.pledgeImage.alt = name || 'Speaker of the House';
        }
        const profileUrl = buildCongressProfileUrl(bioguideId);
        setMemberProfileLink(elements.pledgeLeaderWebsite, profileUrl);
    } catch (error) {
        console.error('fetchSpeakerAsChair failed:', error);
        if (elements.pledgeLeaderName) elements.pledgeLeaderName.textContent = 'Speaker of the House';
    }
}

async function fetchSpeakerMemberInfo(leaderName) {
    try {
        const normalizedName = leaderName.replace(/\s+/g, ' ').trim();
        const stateMatch = normalizedName.match(/(?:of|from)\s+([A-Z]{2})\b/i);
        const state = stateMatch ? stateMatch[1].toUpperCase() : '';
        const nameOnly = normalizedName
            .replace(/^(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+/i, '')
            .replace(/\s+(?:of|from)\s+[A-Z]{2}\b/i, '')
            .trim();

        if (!nameOnly) return;

        const rawLastName = nameOnly.split(/\s+/).slice(-1)[0];
        const xmlText = await getMemberDataXml();
        const xmlDoc = parseMemberDataXml(xmlText);
        const members = xmlDoc.querySelectorAll('member');
        let bestMatch = null;
        let bestScore = 0;

        for (const member of members) {
            const stateElement = member.querySelector('state');
            const memberState = stateElement ? stateElement.getAttribute('postal-code') : '';
            if (state && memberState.toUpperCase() !== state.toUpperCase()) continue;

            const lastNameElement = member.querySelector('lastname');
            const firstNameElement = member.querySelector('firstname');
            const bioguideElement = member.querySelector('bioguideID');
            const partyElement = member.querySelector('party');
            const districtElement = member.querySelector('district');
            const townElement = member.querySelector('townname');
            const websiteElement = member.querySelector('website') || member.querySelector('member-website') || member.querySelector('home-page');

            if (!lastNameElement || !firstNameElement || !bioguideElement) continue;

            const memberLastName = lastNameElement.textContent.trim();
            const memberFirstName = firstNameElement.textContent.trim();
            const bioguideId = bioguideElement.textContent.trim();
            const party = partyElement ? partyElement.textContent.trim() : '';
            const district = districtElement ? districtElement.textContent.trim() : '';
            const town = townElement ? townElement.textContent.trim() : '';
            const website = websiteElement ? websiteElement.textContent.trim() : '';
            const score = calculateNameSimilarity(rawLastName, memberLastName);

            if (score > bestScore && score > 0.3) {
                bestScore = score;
                bestMatch = {
                    lastName: memberLastName,
                    firstName: memberFirstName,
                    fullName: `${memberFirstName} ${memberLastName}`,
                    bioguideId,
                    party,
                    district,
                    state: memberState,
                    town,
                    website
                };
            }
        }

        const match = bestMatch;
        if (!match || !match.bioguideId) return;

        elements.speakerMemberName.textContent = match.fullName;
        elements.speakerMemberDetails.textContent = `${match.state}-${normalizeDistrict(match.district)}`;
        elements.speakerPartyTag.textContent = match.party || '';
        elements.speakerPartyTag.className = 'pledge-party-tag';
        if (match.party === 'R') elements.speakerPartyTag.classList.add('republican');
        else if (match.party === 'D') elements.speakerPartyTag.classList.add('democrat');
        else elements.speakerPartyTag.classList.add('independent');
        elements.speakerMemberAdditional.textContent = match.town ? `from ${match.town}, ${match.state}` : '';
        const websiteUrl = buildCongressProfileUrl(match.bioguideId);
        setMemberProfileLink(elements.speakerMemberWebsite, websiteUrl);
const photoUrl = buildBioguidePhotoUrl(match.bioguideId);
        if (elements.speakerImage) {
            elements.speakerImage.style.display = 'block';
            elements.speakerImage.style.opacity = '0';
            elements.speakerImage.onload = () => { elements.speakerImage.style.opacity = '1'; };
            elements.speakerImage.onerror = () => { elements.speakerImage.style.display = 'none'; };
            elements.speakerImage.src = photoUrl;
            elements.speakerImage.alt = match.fullName || 'Speaker Pro Tempore';
        }
    } catch (error) {
        console.error('Failed to resolve speaker pro tempore member:', error);
    }
}

function updateSpeakerSection(items) {
    if (!elements.speakerMemberTitle || !items || items.length === 0) return;

    const speakerItem = items.find(item => {
        const desc = item.description.toLowerCase();
        return desc.includes('speaker pro tempore') || desc.includes('speaker designated');
    });

    if (!speakerItem) {
        elements.speakerMemberTitle.textContent = 'No Speaker Pro Tempore Information';
        elements.speakerMemberName.textContent = '--';
        elements.speakerPartyTag.textContent = '';
        elements.speakerMemberDetails.textContent = '';
        elements.speakerMemberAdditional.textContent = '';
        elements.speakerMemberDescription.textContent = '';
        elements.speakerTime.textContent = '';
        return;
    }

    const description = speakerItem.description;
    const pubDate = speakerItem.pubDate;

    if (pubDate) {
        const date = new Date(pubDate);
        const timeStr = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        });
        elements.speakerTime.textContent = timeStr;
    }

    let leaderName = 'Unknown Speaker';
    const match = description.match(/designated\s+the\s+Honorable\s+(.+?)\s+to\s+act\s+as\s+Speaker pro tempore/i)
        || description.match(/designated\s+(.+?)\s+to\s+act\s+as\s+Speaker pro tempore/i)
        || description.match(/honorable\s+(.+?)\s+to\s+act\s+as\s+Speaker pro tempore/i);
    if (match) {
        leaderName = match[1].trim();
    }

    elements.speakerMemberTitle.textContent = 'Speaker Pro Tempore';
    elements.speakerMemberName.textContent = leaderName;

    fetchSpeakerMemberInfo(leaderName);
}

function updateCommitteeChairSection(items) {
    if (!elements.committeeChairMemberTitle || !items || items.length === 0) return;

    const chairItem = items.find(i => {
        const d = i.description.toLowerCase();
        return d.includes('act as chairman of the committee') || d.includes('act as chair of the committee');
    });

    if (!chairItem) return;

    if (chairItem.pubDate && elements.committeeChairTime) {
        elements.committeeChairTime.textContent = new Date(chairItem.pubDate).toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
        });
    }

    const nameMatch = chairItem.description.match(/designated\s+the\s+Honorable\s+(.+?)\s+to\s+act\s+as\s+Chair(?:man)?\s+of\s+the\s+Committee/i)
        || chairItem.description.match(/Honorable\s+(.+?)\s+to\s+act\s+as\s+Chair(?:man)?\s+of\s+the\s+Committee/i);
    const memberName = nameMatch ? nameMatch[1].trim() : null;

    if (memberName) {
        elements.committeeChairMemberName.textContent = memberName;
        fetchCommitteeChairMemberInfo(memberName);
    }
}

async function fetchCommitteeChairMemberInfo(leaderName) {
    try {
        const normalizedName = leaderName.replace(/\s+/g, ' ').trim();
        const stateMatch = normalizedName.match(/(?:of|from)\s+([A-Z]{2})\b/i);
        const state = stateMatch ? stateMatch[1].toUpperCase() : '';
        const nameOnly = normalizedName
            .replace(/^(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+/i, '')
            .replace(/\s+(?:of|from)\s+[A-Z]{2}\b/i, '')
            .trim();

        if (!nameOnly) return;

        const rawLastName = nameOnly.split(/\s+/).slice(-1)[0];
        const xmlText = await getMemberDataXml();
        const xmlDoc = parseMemberDataXml(xmlText);
        const members = xmlDoc.querySelectorAll('member');
        let bestMatch = null, bestScore = 0;

        for (const member of members) {
            const stateElement = member.querySelector('state');
            const memberState = stateElement ? stateElement.getAttribute('postal-code') : '';
            if (state && memberState.toUpperCase() !== state.toUpperCase()) continue;

            const lastNameEl = member.querySelector('lastname');
            const firstNameEl = member.querySelector('firstname');
            const bioguideEl = member.querySelector('bioguideID');
            const partyEl = member.querySelector('party');
            const districtEl = member.querySelector('district');
            const townEl = member.querySelector('townname');
            if (!lastNameEl || !firstNameEl || !bioguideEl) continue;

            const score = calculateNameSimilarity(rawLastName, lastNameEl.textContent.trim());
            if (score > bestScore && score > 0.3) {
                bestScore = score;
                bestMatch = {
                    fullName: `${firstNameEl.textContent.trim()} ${lastNameEl.textContent.trim()}`,
                    bioguideId: bioguideEl.textContent.trim(),
                    party: partyEl ? partyEl.textContent.trim() : '',
                    district: districtEl ? districtEl.textContent.trim() : '',
                    state: memberState,
                    town: townEl ? townEl.textContent.trim() : ''
                };
            }
        }

        if (!bestMatch) return;

        elements.committeeChairMemberName.textContent = bestMatch.fullName;
        elements.committeeChairMemberDetails.textContent = `${bestMatch.state}-${normalizeDistrict(bestMatch.district)}`;
        if (elements.committeeChairPartyTag) {
            elements.committeeChairPartyTag.textContent = bestMatch.party || '';
            elements.committeeChairPartyTag.className = 'committee-chair-party-tag';
            if (bestMatch.party === 'R') elements.committeeChairPartyTag.classList.add('republican');
            else if (bestMatch.party === 'D') elements.committeeChairPartyTag.classList.add('democrat');
            else elements.committeeChairPartyTag.classList.add('independent');
        }
        elements.committeeChairMemberAdditional.textContent = bestMatch.town ? `from ${bestMatch.town}, ${bestMatch.state}` : '';
        setMemberProfileLink(elements.committeeChairMemberWebsite, buildCongressProfileUrl(bestMatch.bioguideId));
        const photoUrl = buildBioguidePhotoUrl(bestMatch.bioguideId);
        if (elements.committeeChairImage) {
            elements.committeeChairImage.style.display = 'block';
            elements.committeeChairImage.style.opacity = '0';
            elements.committeeChairImage.onload = () => { elements.committeeChairImage.style.opacity = '1'; };
            elements.committeeChairImage.onerror = () => { elements.committeeChairImage.style.display = 'none'; };
            elements.committeeChairImage.src = photoUrl;
            elements.committeeChairImage.alt = bestMatch.fullName || 'Committee Chair';
        }
    } catch (e) {
        console.error('fetchCommitteeChairMemberInfo error:', e);
    }
}

const ORDINAL_TO_NUM = {
    first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10,
    eleventh:11,twelfth:12,thirteenth:13,fourteenth:14,fifteenth:15,sixteenth:16,
    seventeenth:17,eighteenth:18,nineteenth:19,twentieth:20,
    'twenty-first':21,'twenty-second':22,'twenty-third':23,'twenty-fourth':24,'twenty-fifth':25,
    'twenty-sixth':26,'twenty-seventh':27,'twenty-eighth':28,'twenty-ninth':29,'thirtieth':30,
    'thirty-first':31,'thirty-second':32,'thirty-third':33,'thirty-fourth':34,'thirty-fifth':35,
    'thirty-sixth':36,'thirty-seventh':37,'thirty-eighth':38,'thirty-ninth':39,'fortieth':40,
    'forty-first':41,'forty-second':42,'forty-third':43,'forty-fourth':44,'forty-fifth':45,
    'forty-sixth':46,'forty-seventh':47,'forty-eighth':48,'forty-ninth':49,'fiftieth':50,
    'fifty-first':51,'fifty-second':52,'fifty-third':53,
};

const STATE_NAME_TO_ABBR = {
    'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
    'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
    'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
    'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
    'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
    'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
    'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
    'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
    'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
    'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
    'District of Columbia':'DC','Puerto Rico':'PR','Guam':'GU','Virgin Islands':'VI',
    'American Samoa':'AS','Northern Mariana Islands':'MP',
};

function normalizeDistrict(district) {
    if (!district) return '';
    if (/^at\s+large$/i.test(district.trim())) return 'AL';
    const num = district.trim().replace(/^(\d+)(?:st|nd|rd|th)$/i, '$1');
    return /^\d+$/.test(num) ? num.padStart(2, '0') : num;
}

function formatOathDistrict(districtText) {
    // "Eleventh District, State of New Jersey" → "NJ-11"
    // "At Large District, State of Wyoming" → "WY-AL"
    const stateMatch = districtText.match(/State\s+of\s+(.+)$/i);
    const stateAbbr = stateMatch ? (STATE_NAME_TO_ABBR[stateMatch[1].trim()] || stateMatch[1].trim()) : '';

    const ordinalMatch = districtText.match(/^([\w-]+)\s+District/i);
    let districtNum = '';
    if (ordinalMatch) {
        const word = ordinalMatch[1].toLowerCase();
        if (word === 'at' || word === 'at large') {
            districtNum = 'AL';
        } else {
            const n = ORDINAL_TO_NUM[word] ? String(ORDINAL_TO_NUM[word]) : ordinalMatch[1];
            districtNum = /^\d+$/.test(n) ? n.padStart(2, '0') : n;
        }
    }

    return stateAbbr && districtNum ? `${stateAbbr}-${districtNum}` : districtText;
}

// Update oath section with member information
function updateOathSection(items) {
    if (!elements.oathMemberTitle || !items || items.length === 0) return;

    const oathItem = items.find(i => /^OATH OF OFFICE\b/i.test(i.description.trim()));
    if (!oathItem) return;

    const description = oathItem.description;

    if (oathItem.pubDate && elements.oathTime) {
        elements.oathTime.textContent = new Date(oathItem.pubDate).toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
        });
    }

    // "OATH OF OFFICE - Representative-elect Jane Smith, Eleventh District, State of New Jersey, presented herself..."
    const afterDash = description.replace(/^OATH\s+OF\s+OFFICE\s*[-–]\s*/i, '').trim();

    const singleMatch = afterDash.match(/^(?:Representative|Delegate|Resident\s+Commissioner)-elect\s+([^,]+),/i);
    let memberName = '';
    let districtFormatted = '';

    if (singleMatch) {
        memberName = singleMatch[1].trim();
        const afterName = afterDash.slice(singleMatch[0].length);
        const districtMatch = afterName.match(/^([^,]+(?:,\s*State\s+of\s+[^,]+)?)(?:,\s*presented|,\s*[a-z]|$)/i);
        if (districtMatch) {
            districtFormatted = formatOathDistrict(districtMatch[1].trim());
        }
    }

    elements.oathMemberTitle.textContent = 'Representative-elect';
    elements.oathMemberName.textContent = memberName || '--';
    elements.oathMemberDescription.textContent = districtFormatted || '';

    if (elements.oathImage) {
        elements.oathImage.style.display = 'block';
        elements.oathImage.style.opacity = '0';
        elements.oathImage.removeAttribute('src');
    }
    if (memberName) {
        const _oathLastName = memberName.trim().split(/\s+/).pop();
        (async () => {
            try {
                const xmlText = await getMemberDataXml();
                const xmlDoc = parseMemberDataXml(xmlText);
                let bestId = null, bestScore = 0;
                for (const m of xmlDoc.querySelectorAll('member')) {
                    const ln = m.querySelector('lastname')?.textContent.trim() || '';
                    const bg = m.querySelector('bioguideID')?.textContent.trim() || '';
                    if (!ln || !bg) continue;
                    const s = calculateNameSimilarity(_oathLastName, ln);
                    if (s > bestScore && s > 0.7) { bestScore = s; bestId = bg; }
                }
                if (bestId && elements.oathImage) {
                    const photoUrl = buildBioguidePhotoUrl(bestId);
                    elements.oathImage.style.display = 'block';
                    elements.oathImage.style.opacity = '0';
                    elements.oathImage.onload = () => { elements.oathImage.style.opacity = '1'; };
                    elements.oathImage.onerror = () => { elements.oathImage.style.display = 'none'; };
                    elements.oathImage.src = photoUrl;
                    elements.oathImage.alt = memberName;
                }
            } catch (_e) { /* photo is optional */ }
        })();
    }
}

// Update message section
function updateMessageSection(items) {
    if (!elements.messageFromLine || !items || items.length === 0) return;

    const msgItem = items.find(i =>
        i.description.toLowerCase().startsWith('the house received a message from')
    );
    if (!msgItem) return;

    const raw = msgItem.description;
    const firstPeriod = raw.indexOf('.');
    const fromLine = firstPeriod > -1 ? raw.slice(0, firstPeriod + 1) : raw;
    const body = firstPeriod > -1 ? raw.slice(firstPeriod + 1).trim() : '';

    elements.messageFromLine.textContent = decodeHtml(fromLine);
    elements.messageBody.textContent = decodeHtml(body);

    if (msgItem.pubDate && elements.messageTime) {
        elements.messageTime.textContent = new Date(msgItem.pubDate).toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
        });
    }
}

// Update cert-election section
function updateCertElectionSection(items) {
    const item = items.find(i => /^CERTIFICATION OF ELECTION\b/i.test(i.description.trim()));
    if (!item) return;
    if (elements.certElectionText) {
        elements.certElectionText.textContent = decodeHtml(item.description);
    }
}

// Update cert-electoral section
function updateCertElectoralSection(items) {
    const item = items.find(i => /^CERTIFICATION OF ELECTORAL VOTES\b/i.test(i.description.trim()));
    if (!item) return;
    if (elements.certElectoralText) {
        elements.certElectoralText.textContent = decodeHtml(item.description);
    }
}

// Update sine die section
function updateSineDieSection(items) {
    if (!items || items.length === 0) return;
    const latest = items[0].description;
    if (elements.sineDieDescriptionLine) {
        elements.sineDieDescriptionLine.textContent = decodeHtml(latest) || 'The House stands adjourned sine die.';
    }
    if (items[0].pubDate && elements.sineDieTime) {
        elements.sineDieTime.textContent = new Date(items[0].pubDate).toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
        });
    }
}

// Update new session section
function updateNewSessionSection(items) {
    const item = items.find(i => {
        const d = i.description.toLowerCase();
        return d.includes('20th amendment') && (d.includes('convened') || d.includes('new legislative day'));
    });
    if (!item) return;
    if (elements.newSessionDescriptionLine) {
        elements.newSessionDescriptionLine.textContent = decodeHtml(item.description);
    }
}

// Update admin oath section
function updateAdminOathSection(items) {
    const item = items.find(i => /^ADMINISTRATION OF THE OATH OF OFFICE\b/i.test(i.description.trim()));
    if (!item) return;

    const afterDash = item.description.replace(/^ADMINISTRATION OF THE OATH OF OFFICE\s*[-–]\s*/i, '').trim();
    const lower = afterDash.toLowerCase();

    let administeredBy = 'The Speaker';
    let recipients = afterDash.replace(/\.$/, '').trim();

    if (lower.includes('dean of the house')) {
        administeredBy = 'Dean of the House';
        recipients = 'Speaker-elect';
    } else if (lower.includes('members-elect')) {
        administeredBy = 'The Speaker';
        // Try to extract congress number e.g. "119th Congress"
        const congressMatch = afterDash.match(/(\d+(?:st|nd|rd|th)\s+Congress)/i);
        recipients = congressMatch ? `Members-elect of the ${congressMatch[1]}` : 'Members-elect';
    } else if (lower.includes('officers')) {
        administeredBy = 'The Speaker';
        recipients = 'Officers of the House';
    } else {
        administeredBy = 'The Speaker';
        const periodIdx = afterDash.indexOf('.');
        recipients = (periodIdx > -1 ? afterDash.slice(0, periodIdx) : afterDash).trim();
    }

    if (elements.adminOathAdministeredBy) elements.adminOathAdministeredBy.textContent = administeredBy;
    if (elements.adminOathRecipients) elements.adminOathRecipients.textContent = recipients;
}

// Update joint session section
function updateJointSessionSection(items) {
    const item = items.find(i => /^JOINT SESSION\b/i.test(i.description.trim()));
    if (!item) return;

    // Strip label prefix: "JOINT SESSION CALLED TO ORDER - " or "JOINT SESSION - "
    const stripped = decodeHtml(item.description.replace(/^JOINT SESSION\s*(?:CALLED TO ORDER\s*)?[-–]\s*/i, '').trim());

    if (elements.jointSessionDescriptionLine) {
        elements.jointSessionDescriptionLine.textContent = stripped || 'The House and Senate have convened in Joint Session.';
    }

    if (elements.jointSessionPresidingLine) {
        if (stripped.toLowerCase().includes('vice president')) {
            elements.jointSessionPresidingLine.textContent = 'Presided over by the Vice President';
        } else {
            elements.jointSessionPresidingLine.textContent = '';
        }
    }
}

// Update joint meeting section
function updateJointMeetingSection(items) {
    const item = items.find(i => /^JOINT MEETING\b/i.test(i.description.trim()) && !/DISSOLVED/i.test(i.description));
    if (!item) return;
    const stripped = decodeHtml(item.description.replace(/^JOINT MEETING\s*[-–]\s*/i, '').trim());
    if (elements.jointMeetingDescriptionLine) {
        elements.jointMeetingDescriptionLine.textContent = stripped || 'The House convened in Joint Meeting with the Senate.';
    }
}

// Update tellers section
function updateTellersSection(items) {
    const item = findTellersProceeding(items);
    if (!item || !elements.tellersDescription || !elements.tellersList) return;

    const stripped = decodeHtml(item.description.replace(/^APPOINTMENT OF TELLERS\s*[-–]\s*/i, '').trim());
    elements.tellersDescription.textContent = stripped;

    const names = extractTellerNames(stripped);
    elements.tellersList.innerHTML = '';
    names.forEach(name => {
        const card = document.createElement('div');
        card.className = 'teller-card';
        card.innerHTML = `
            <div class="teller-photo-wrap">
                <div class="teller-photo-placeholder">${MEMBER_PHOTO_PLACEHOLDER}</div>
                <img class="teller-photo" alt="${escapeHtml(name)}" />
            </div>
            <div class="teller-meta">
                <div class="teller-name">${escapeHtml(name)}</div>
                <div class="teller-details">
                    <span class="speaker-party-tag teller-party-tag">--</span>
                    <span class="teller-state">--</span>
                </div>
                <div class="teller-meta-line">Matching teller record…</div>
                <a class="teller-link" href="#" target="_blank" rel="noopener">--</a>
            </div>
        `;
        elements.tellersList.appendChild(card);
        fetchTellerInfo(name, card);
    });
}

function findTellersProceeding(items) {
    if (!items || !items.length) return null;
    return items.find(i => /^APPOINTMENT OF TELLERS\b/i.test(i.description.trim())) || null;
}

function extractTellerNames(text) {
    const cleaned = (text || '').replace(/\.\s*$/, '').trim();
    const afterColon = cleaned.includes(':') ? cleaned.slice(cleaned.lastIndexOf(':') + 1).trim() : cleaned;
    const suffix = afterColon.replace(/^(?:the\s+Chair announced the Speaker's appointment as tellers on the part of the House to count the electoral votes:\s*)/i, '').trim();
    const candidates = suffix.split(/\s+and\s+/i).map(part => part.replace(/,\s*$/, '').trim()).filter(Boolean);
    return candidates.map(part => {
        const idx = part.lastIndexOf(',');
        return idx > -1 ? part.slice(0, idx).trim() : part;
    }).filter(Boolean);
}

function parseTellerName(nameStr) {
    const normalized = nameStr.replace(/\s+/g, ' ').trim();
    const stateMatch = normalized.match(/\bof\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s*$/);
    const stateName = stateMatch ? stateMatch[1] : '';
    const state = stateName ? (STATE_NAME_TO_ABBR[stateName] || stateName.toUpperCase().slice(0, 2)) : '';
    const nameOnly = normalized
        .replace(/^(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+/i, '')
        .replace(/\s+of\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\s*$/i, '')
        .trim();
    return { rawName: normalized, nameOnly, state };
}

async function fetchTellerInfo(nameStr, cardEl) {
    try {
        const { nameOnly, state } = parseTellerName(nameStr);
        const rawLastName = nameOnly.split(/\s+/).pop() || nameOnly;

        const xmlText = await getMemberDataXml();
        const xmlDoc = parseMemberDataXml(xmlText);
        const bestMatch = findBestMemberMatchByName(xmlDoc, rawLastName, state);

        if (!bestMatch) return;

        const partyClass = bestMatch.party === 'R' ? 'republican' : bestMatch.party === 'D' ? 'democrat' : 'independent';
        const district = normalizeDistrict(bestMatch.district);
        const photoUrl = bestMatch.bioguideId ? buildBioguidePhotoUrl(bestMatch.bioguideId) : '';
        const profileUrl = bestMatch.bioguideId ? buildCongressProfileUrl(bestMatch.bioguideId) : '#';
        const town = bestMatch.town ? `from ${bestMatch.town}, ${bestMatch.state}` : '';

        if (cardEl) {
            cardEl.querySelector('.teller-name').textContent = bestMatch.fullName;
            const partyTag = cardEl.querySelector('.teller-party-tag');
            partyTag.textContent = bestMatch.party || '?';
            partyTag.className = `speaker-party-tag teller-party-tag ${partyClass}`;
            cardEl.querySelector('.teller-state').textContent = `${bestMatch.state}${district ? '-' + district : ''}`;
            cardEl.querySelector('.teller-meta-line').textContent = town || 'House teller';
            setMemberProfileLink(cardEl.querySelector('.teller-link'), profileUrl);

            const img = cardEl.querySelector('.teller-photo');
            if (img && photoUrl) {
                img.style.opacity = '0';
                img.onload = () => { img.style.opacity = '1'; };
                img.onerror = () => { img.style.display = 'none'; };
                img.src = photoUrl;
                img.alt = bestMatch.fullName;
            }
            const placeholder = cardEl.querySelector('.teller-photo-placeholder');
            if (placeholder && photoUrl) placeholder.style.display = 'none';
        }

    } catch (e) {
        console.error('fetchTellerInfo error:', e);
    }
}

function showTellersEmptyState(message) {
    if (!elements.tellersDescription || !elements.tellersList) return;
    elements.tellersDescription.textContent = message;
    setIfChanged(elements.tellersList, '<div class="teller-card"><div class="teller-meta"><div class="teller-name">No tellers listed</div><div class="teller-meta-line">This proceedings set does not include an appointment of tellers entry.</div></div></div>');
}

// Fetch member data from House Clerk and get photo
async function fetchMemberPhotoFromClerkData(leaderName) {
    try {
        // Parse member name - handle "Mr. Thompson of PA", "Mr. McGarvey", or "Morgan McGarvey"
        const withStateMatch = leaderName.match(/(?:Mr\.|Ms\.|Mrs\.|Dr\.)?\s*(\w+)\s+of\s+(\w+)/i);
        const prefixMatch = leaderName.match(/(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+([\w]+(?:\s+[\w]+)*)/i);
        const lastName = withStateMatch ? withStateMatch[1]
            : prefixMatch ? prefixMatch[1].split(/\s+/).pop()
            : leaderName.split(/\s+/).pop();
        const state = withStateMatch ? withStateMatch[2] : null;

        let clerkDataText;
        try {
            clerkDataText = await getMemberXml();
        } catch (workerError) {
            console.error('Member XML fetch failed:', workerError);
            showPledgePlaceholder();
            return;
        }

        // Parse the XML data
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(clerkDataText, 'text/xml');

        // Get all member elements
        const members = xmlDoc.querySelectorAll('member');
        let bestMatch = null;
        let bestScore = 0;

        // Find matching members — filter by state only when we have one
        for (const member of members) {
            const stateElement = member.querySelector('state');
            const memberState = stateElement ? stateElement.getAttribute('postal-code') : '';

            if (state && memberState.toUpperCase() !== state.toUpperCase()) {
                continue;
            }
            
            const lastNameElement = member.querySelector('lastname');
            const firstNameElement = member.querySelector('firstname');
            const middleNameElement = member.querySelector('middlename');
            const bioguideElement = member.querySelector('bioguideID');
            const partyElement = member.querySelector('party');
            const districtElement = member.querySelector('district');
            const townElement = member.querySelector('townname');
            const websiteElement = member.querySelector('website') || member.querySelector('member-website') || member.querySelector('home-page');

            if (!lastNameElement || !firstNameElement || !bioguideElement) continue;

            const memberLastName = lastNameElement.textContent.trim();
            const memberFirstName = firstNameElement.textContent.trim();
            const memberMiddleName = middleNameElement ? middleNameElement.textContent.trim() : '';
            const bioguideId = bioguideElement.textContent.trim();
            const party = partyElement ? partyElement.textContent.trim() : '';
            const district = districtElement ? districtElement.textContent.trim() : '';
            const town = townElement ? townElement.textContent.trim() : '';
            const website = websiteElement ? websiteElement.textContent.trim() : '';
            
            // Score based on last name similarity
            const score = calculateNameSimilarity(lastName, memberLastName);
            if (score > bestScore && score > 0.3) {
                bestScore = score;
                bestMatch = {
                    lastName: memberLastName,
                    firstName: memberFirstName,
                    fullName: [memberFirstName, memberMiddleName, memberLastName].filter(Boolean).join(' '),
                    bioguideId: bioguideId,
                    party: party,
                    district: district,
                    state: memberState,
                    town: town,
                    website: website
                };
            }
        }

        if (bestMatch && bestMatch.bioguideId) {
            // Update the display with member information
            elements.pledgeLeaderName.textContent = bestMatch.fullName;
            elements.pledgeLeaderDetails.textContent = `${bestMatch.state}-${normalizeDistrict(bestMatch.district)}`;
            
            // Set party tag
            elements.pledgePartyTag.textContent = bestMatch.party;
            elements.pledgePartyTag.className = 'pledge-party-tag';
            if (bestMatch.party === 'R') {
                elements.pledgePartyTag.classList.add('republican');
            } else if (bestMatch.party === 'D') {
                elements.pledgePartyTag.classList.add('democrat');
            } else {
                elements.pledgePartyTag.classList.add('independent');
            }
            
            // Show additional interesting info
            let additionalInfo = [];
            if (bestMatch.town) {
                additionalInfo.push(`from ${bestMatch.town}, ${bestMatch.state}`);
            }
            elements.pledgeLeaderAdditional.textContent = additionalInfo.length > 0 ? additionalInfo.join(' • ') : '';
            if (elements.pledgeLeaderWebsite) {
                const websiteUrl = bestMatch.website || buildCongressProfileUrl(bestMatch.bioguideId);
                setMemberProfileLink(elements.pledgeLeaderWebsite, websiteUrl);
            }
            
            // Use the official Biographical Directory image path.
            // The photo endpoint is organized by the first letter of the BioGuide ID.
            const photoUrl = `https://bioguide.congress.gov/bioguide/photo/${bestMatch.bioguideId.charAt(0)}/${bestMatch.bioguideId}.jpg`;
            elements.pledgeImage.style.display = 'block';
            elements.pledgeImage.style.opacity = '0';
            elements.pledgeImage.onload = () => { elements.pledgeImage.style.opacity = '1'; };
            elements.pledgeImage.onerror = () => { elements.pledgeImage.style.display = 'none'; };
            elements.pledgeImage.src = photoUrl;
            return;
        }

        // Fallback to placeholder if no match found or photo doesn't exist
        elements.pledgePartyTag.textContent = '';
        elements.pledgeTime.textContent = '';
        elements.pledgeLeaderDetails.textContent = '';
        elements.pledgeLeaderAdditional.textContent = '';
        setMemberProfileLink(elements.pledgeLeaderWebsite, null);
        showPledgePlaceholder();

    } catch (error) {
        console.error('Error fetching member photo from clerk data:', error);
        elements.pledgePartyTag.textContent = '';
        elements.pledgeTime.textContent = '';
        elements.pledgeLeaderDetails.textContent = '';
        elements.pledgeLeaderAdditional.textContent = '';
        setMemberProfileLink(elements.pledgeLeaderWebsite, null);
        showPledgePlaceholder();
    }
}

// ── Member XML cache (shared by all callers, 1-hour TTL, in-flight dedup) ──────
let memberDataXmlCache    = null;
let memberDataXmlCacheAt  = 0;
let memberDataXmlInflight = null;
const MEMBER_XML_TTL_MS   = 60 * 60 * 1000; // 1 hour

async function getMemberDataXml() {
    const now = Date.now();
    if (memberDataXmlCache && (now - memberDataXmlCacheAt) < MEMBER_XML_TTL_MS) {
        return memberDataXmlCache;
    }
    if (memberDataXmlInflight) return memberDataXmlInflight;
    memberDataXmlInflight = fetch(MEMBER_DATA_CONFIG.workerUrl)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(data => {
            if (!data?.xmlData) throw new Error('No xmlData in response');
            memberDataXmlCache   = data.xmlData;
            memberDataXmlCacheAt = Date.now();
            return memberDataXmlCache;
        })
        .finally(() => { memberDataXmlInflight = null; });
    return memberDataXmlInflight;
}

const getMemberXml = getMemberDataXml; // alias used throughout

function parseMemberDataXml(xmlText) {
    const parser = new DOMParser();
    return parser.parseFromString(xmlText, 'text/xml');
}

function findBestMemberMatchByName(xmlDoc, lastName, state) {
    const members = xmlDoc.querySelectorAll('member');
    let bestMatch = null;
    let bestScore = 0;

    for (const member of members) {
        const stateElement = member.querySelector('state');
        const memberState = stateElement ? stateElement.getAttribute('postal-code') : '';
        if (memberState.toUpperCase() !== state.toUpperCase()) continue;

        const lastNameElement = member.querySelector('lastname');
        const firstNameElement = member.querySelector('firstname');
        const bioguideElement = member.querySelector('bioguideID');
        const partyElement = member.querySelector('party');
        const districtElement = member.querySelector('district');
        const townElement = member.querySelector('townname');

        if (!lastNameElement || !firstNameElement || !bioguideElement) continue;

        const memberLastName = lastNameElement.textContent.trim();
        const memberFirstName = firstNameElement.textContent.trim();
        const bioguideId = bioguideElement.textContent.trim();

        // Skip vacant seats (empty name/bioguide in MemberData XML)
        if (!memberLastName || !bioguideId) continue;
        const party = partyElement ? partyElement.textContent.trim() : '';
        const district = districtElement ? districtElement.textContent.trim() : '';
        const town = townElement ? townElement.textContent.trim() : '';
        const score = calculateNameSimilarity(lastName, memberLastName);

        if (score > bestScore && score > 0.3) {
            bestScore = score;
            bestMatch = {
                lastName: memberLastName,
                firstName: memberFirstName,
                fullName: `${memberFirstName} ${memberLastName}`,
                bioguideId,
                party,
                district,
                state: memberState,
                town
            };
        }
    }

    return bestMatch;
}

function buildBioguidePhotoUrl(bioguideId) {
    if (!bioguideId) return '';
    return `https://bioguide.congress.gov/bioguide/photo/${bioguideId.charAt(0)}/${bioguideId}.jpg`;
}

function buildCongressProfileUrl(bioguideId) {
    if (!bioguideId) return '#';
    return `https://clerk.house.gov/members/${bioguideId}`;
}

function formatAbsenteePartyTag(party) {
    if (party === 'rep') {
        return '<span class="pledge-party-tag republican">R</span>';
    }
    if (party === 'dem') {
        return '<span class="pledge-party-tag democrat">D</span>';
    }
    return '<span class="pledge-party-tag independent">I</span>';
}

function normalizeAbsenteeRollName(name) {
    if (!name) return '';
    return name
        .replace(/\s*\([A-Z]{2}\)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseAbsenteeRollName(name) {
    const normalized = normalizeAbsenteeRollName(name);

    // House Clerk roll call XML uses "LastName, FirstName" format.
    // Split on comma first so we don't accidentally extract the first name.
    const commaIdx = normalized.indexOf(',');
    if (commaIdx > 0) {
        return {
            rawName: normalized,
            lastName: normalized.slice(0, commaIdx).trim(),
            state: ''
        };
    }

    const match = normalized.match(/^(.+?)\s*\(([A-Z]{2})\)$/i);
    if (match) {
        return {
            rawName: normalized,
            lastName: match[1].trim(),
            state: match[2].toUpperCase()
        };
    }

    const lastToken = normalized.split(/\s+/).pop() || normalized;
    return {
        rawName: normalized,
        lastName: lastToken,
        state: ''
    };
}

async function decorateAbsenteePhotos(absentees) {
    const list = elements.absenteeList;
    if (!list || !absentees || absentees.length === 0) return;

    try {
        const xmlText = await getMemberDataXml();
        const xmlDoc = parseMemberDataXml(xmlText);

        absentees.forEach((absentee, index) => {
            const memberEl = list.querySelector(`[data-absentee-index="${index}"]`);
            if (!memberEl) return;

            const match = findBestMemberMatchByName(xmlDoc, absentee.name, absentee.state);
            if (!match || !match.bioguideId) return;

            const img = memberEl.querySelector('.absentee-photo');
            if (!img) return;

            img.alt = match.fullName;
            img.src = buildBioguidePhotoUrl(match.bioguideId);
            img.style.display = 'block';
            img.onerror = () => {
                img.style.display = 'none';
                const placeholder = memberEl.querySelector('.absentee-photo-placeholder');
                if (placeholder) placeholder.style.display = 'flex';
            };

            const placeholder = memberEl.querySelector('.absentee-photo-placeholder');
            if (placeholder) placeholder.style.display = 'none';
        });
    } catch (error) {
        console.error('Failed to decorate absentee photos:', error);
    }
}

// Calculate similarity between two names using Sørensen–Dice coefficient on bigrams.
// This correctly penalises mismatched characters, unlike the prior character-presence
// approach which scored "Doe" highly against "Rodriguez" (d, o, e all appear).
function calculateNameSimilarity(name1, name2) {
    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();

    if (!n1 || !n2) return 0;
    if (n1 === n2) return 1.0;
    if (n1.includes(n2) || n2.includes(n1)) return 0.85;

    // Build bigram frequency maps
    const bigrams = s => {
        const map = new Map();
        for (let i = 0; i < s.length - 1; i++) {
            const bg = s.slice(i, i + 2);
            map.set(bg, (map.get(bg) || 0) + 1);
        }
        return map;
    };

    const b1 = bigrams(n1);
    const b2 = bigrams(n2);

    let intersection = 0;
    for (const [bg, count] of b1) {
        intersection += Math.min(count, b2.get(bg) || 0);
    }

    const total = (n1.length - 1) + (n2.length - 1);
    return total <= 0 ? 0 : (2 * intersection) / total;
}

function showPledgePlaceholder() {
    elements.pledgeImage.style.display = 'block';
    elements.pledgeImage.style.opacity = '0';
    elements.pledgeImage.removeAttribute('src');
    elements.pledgePartyTag.textContent = '';
    elements.pledgeTime.textContent = '';
    elements.pledgeLeaderDetails.textContent = '';
    elements.pledgeLeaderAdditional.textContent = '';
}

function decodeHtml(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Sanitize HTML from external sources (Firestore whip notices, etc.)
// Allows a safe allow-list of tags/attributes; strips everything else.
function sanitizeHtml(dirty) {
    if (!dirty) return '';
    const ALLOWED_TAGS = new Set(['P','BR','STRONG','EM','B','I','UL','OL','LI',
        'A','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','CODE','PRE','SPAN','DIV']);
    const ALLOWED_ATTRS = { A: ['href'] };

    const doc = new DOMParser().parseFromString(dirty, 'text/html');

    function cleanNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();
        if (node.nodeType !== Node.ELEMENT_NODE) return null;
        if (!ALLOWED_TAGS.has(node.tagName)) {
            // Strip the tag but keep its children
            const frag = document.createDocumentFragment();
            node.childNodes.forEach(c => { const n = cleanNode(c); if (n) frag.appendChild(n); });
            return frag;
        }
        const el = document.createElement(node.tagName.toLowerCase());
        (ALLOWED_ATTRS[node.tagName] || []).forEach(attr => {
            if (!node.hasAttribute(attr)) return;
            const val = node.getAttribute(attr);
            if (attr === 'href' && /^\s*javascript:/i.test(val)) return; // block JS URLs
            el.setAttribute(attr, val);
        });
        if (node.tagName === 'A') {
            el.setAttribute('rel', 'noopener noreferrer');
            el.setAttribute('target', '_blank');
        }
        node.childNodes.forEach(c => { const n = cleanNode(c); if (n) el.appendChild(n); });
        return el;
    }

    const tmp = document.createElement('div');
    doc.body.childNodes.forEach(c => { const n = cleanNode(c); if (n) tmp.appendChild(n); });
    return tmp.innerHTML;
}

// Return a safe URL string, or '' if it could be a javascript: injection.
function safeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return /^\s*javascript:/i.test(url) ? '' : url;
}

// House Makeup Functions
async function fetchHouseMakeup(preData = null) {
    try {
        let jsonData;
        if (preData) {
            jsonData = preData;
        } else {
            const response = await fetch(MEMBER_DATA_CONFIG.workerUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            jsonData = await response.json();
        }
        if (jsonData.error) {
            throw new Error(jsonData.error);
        }
        
        const xmlText = jsonData.xmlData || '';
        
        // Initialize counts to 0 - will be populated by XML parsing
        let repCount = 0;
        let demCount = 0;
        let indCount = 0;
        
        // Parse XML to extract party breakdown and vacancies
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        // Extract title info for Congress and Majority control
        const titleInfo = xmlDoc.querySelector('title-info');
        if (titleInfo) {
            currentCongress = titleInfo.querySelector('congress-num')?.textContent || currentCongress;
            currentSession = titleInfo.querySelector('session')?.textContent || currentSession;
            controllingParty = titleInfo.querySelector('majority')?.textContent || controllingParty;
            
            // Update Congress info display
            if (elements.congressInfo) {
                const congressText = titleInfo.querySelector('congress-text')?.textContent || `${currentCongress}th Congress`;
                const congressTextElement = elements.congressInfo.querySelector('.congress-text');
                if (congressTextElement) {
                    congressTextElement.textContent = `${congressText} - Session ${currentSession}`;
                }
            }
        }

        // Extract last updated date from publish-date attribute
        const publishDate = xmlDoc.querySelector('MemberData')?.getAttribute('publish-date');
        if (publishDate) {
            lastUpdatedDate = publishDate;
        }
        
        // Extract current vacancies (members with predecessor info but no current member name)
        vacancies = [];
        const members = xmlDoc.querySelectorAll('member');
        
        members.forEach(member => {
            const namelist = member.querySelector('namelist');
            const predecessorInfo = member.querySelector('predecessor-info');
            const districtInfo = member.querySelector('district')?.textContent || '';
            
            // Check if this is a voting seat (not a Delegate or Resident Commissioner)
            // Delegates and Resident Commissioners are non-voting members and don't count towards the "Whole Number"
            const isVotingMember = !districtInfo.includes('Delegate') && !districtInfo.includes('Resident Commissioner');
            
            // Check if this is a vacancy (no current member name but has predecessor)
            if (!namelist?.textContent.trim() && predecessorInfo) {
                const predOfficialName = predecessorInfo.querySelector('pred-official-name')?.textContent;
                const predVacateDate = predecessorInfo.querySelector('pred-vacate-date')?.textContent;
                const cause = predecessorInfo.getAttribute('cause');
                const footnote = predecessorInfo.querySelector('pred-footnote')?.textContent;
                
                // Get state abbreviation and district number
                const stateAbbrev = member.querySelector('statedata')?.getAttribute('postal-code') || 
                                   member.querySelector('state')?.getAttribute('postal-code') || '';
                const districtNum = (member.querySelector('district')?.textContent?.replace(/[^0-9]/g, '') || '').padStart(2, '0').replace(/^0+$/, '');
                const formattedDistrict = stateAbbrev && districtNum ? `${stateAbbrev}-${districtNum}` : districtInfo;
                
                // Only count as vacancy if predecessor info has valid vacate date and cause
                if (predOfficialName && predVacateDate && cause) {
                    let causeText = '';
                    if (cause === 'R') causeText = 'Resignation';
                    else if (cause === 'D') causeText = 'Death';
                    else if (cause === 'E') causeText = 'Expulsion';
                    else causeText = 'Unknown';
                    
                    vacancies.push({
                        member: predOfficialName,
                        reason: causeText,
                        date: predVacateDate,
                        district: formattedDistrict,
                        footnote: footnote || ''
                    });
                }
            } else if (namelist?.textContent.trim() && isVotingMember) {
                // Count current voting members by party
                const party = member.querySelector('party')?.textContent?.trim();
                if (party === 'R') repCount++;
                else if (party === 'D') demCount++;
                else if (party === 'I' || party === 'ID') indCount++;
            }
        });
        
        // Sort vacancies chronologically by vacate date (oldest first)
        vacancies.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateA - dateB; // Oldest first
        });
        
        houseMakeup = {
            republicans: repCount,
            democrats: demCount,
            independents: indCount,
            total: repCount + demCount + indCount // The "Whole Number" of the House
        };
        
        updatePartyBreakdownDisplay();
        
    } catch (error) {
        console.error('Error fetching house makeup:', error);
        if (houseMakeup) {
            updatePartyBreakdownDisplay();
        }
    }
}

function updatePartyBreakdownDisplay() {
    if (!houseMakeup) return;
    
    // Update metrics
    if (elements.partyRep) elements.partyRep.textContent = houseMakeup.republicans;
    if (elements.partyDem) elements.partyDem.textContent = houseMakeup.democrats;
    if (elements.partyInd) elements.partyInd.textContent = houseMakeup.independents;
    if (elements.partyTotal) elements.partyTotal.textContent = houseMakeup.total;
    
    // Update Majority Control Badge
    if (elements.majorityControlBadge) {
        if (controllingParty) {
            const partyFull = controllingParty === 'R' ? 'REPUBLICAN' : (controllingParty === 'D' ? 'DEMOCRATIC' : controllingParty);
            elements.majorityControlBadge.textContent = `${partyFull} CONTROL`;
            elements.majorityControlBadge.className = `majority-badge ${controllingParty.toLowerCase()}-control`;
        } else {
            elements.majorityControlBadge.className = 'majority-badge hidden';
        }
    }
    
    // Update visual bar
    if (elements.repFill && elements.demFill && elements.indFill && elements.vacFill) {
        // Derive from live clerk data (members + vacancies) so the bar stays correct
        // if the House ever expands; falls back to the constitutional constant.
        const totalSeats = (houseMakeup.total + vacancies.length) || HOUSE_TOTAL_MEMBERS;
        const repPercent = (houseMakeup.republicans / totalSeats) * 100;
        const demPercent = (houseMakeup.democrats / totalSeats) * 100;
        const indPercent = (houseMakeup.independents / totalSeats) * 100;
        const vacPercent = (vacancies.length / totalSeats) * 100;
        
        elements.repFill.style.width = `${repPercent}%`;
        elements.demFill.style.width = `${demPercent}%`;
        elements.indFill.style.width = `${indPercent}%`;
        elements.vacFill.style.width = `${vacPercent}%`;

        // Majority party always on left — append in desired order (appendChild moves existing nodes)
        const partyBar = elements.repFill.parentElement;
        if (partyBar) {
            const order = houseMakeup.democrats > houseMakeup.republicans
                ? [elements.demFill, elements.repFill, elements.indFill, elements.vacFill]
                : [elements.repFill, elements.demFill, elements.indFill, elements.vacFill];
            order.forEach(el => partyBar.appendChild(el));
        }
    }
    
    // Update last update time
    if (elements.partyBreakdownLastUpdate) {
        if (lastUpdatedDate) {
            elements.partyBreakdownLastUpdate.textContent = formatDate(lastUpdatedDate);
        } else {
            const now = new Date();
            elements.partyBreakdownLastUpdate.textContent = now.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                hour12: false 
            });
        }
    }
    
    // Update vacancies display
    if (elements.vacanciesCount && elements.vacanciesList) {
        elements.vacanciesCount.textContent = vacancies.length;
        
        if (vacancies.length > 0) {
            const vacanciesHtml = vacancies.map(vacancy => {
                const tagClass = vacancy.reason === 'Death' ? 'tag-death' : 'tag-resignation';
                const tagText = vacancy.reason === 'Death' ? 'DECEASED' : 'RESIGNED';
                return `
                    <div class="vacancy-item">
                        <span class="vacancy-tag ${tagClass}">${tagText}</span>
                        <span class="vacancy-district">${vacancy.district}</span>
                        <span class="vacancy-member">${vacancy.member}</span>
                        <span class="vacancy-date">${formatDate(vacancy.date)}</span>
                    </div>
                `;
            }).join('');
            setIfChanged(elements.vacanciesList, vacanciesHtml);
        } else {
            setIfChanged(elements.vacanciesList, '<div class="no-vacancies">No current vacancies</div>');
        }
    }

}

// Floor Reporters (via nitter proxy)
const DEFAULT_REPORTER_CARDS = [
    { handle: '@JakeSherman',    name: 'Jake Sherman' },
    { handle: '@ChadPergram',    name: 'Chad Pergram' },
    { handle: '@ringwiss',       name: 'Ringwiss' },
    { handle: '@MacFarlaneNews', name: 'Scott MacFarlane' },
    { handle: '@AndrewSolender', name: 'Andrew Solender' },
    { handle: '@mkraju',         name: 'Manu Raju' },
];

const REPORTER_NAMES = {
    '@AdamZHerman':     'Adam Herman',
    '@HouseInSession':  'Billy House',
    '@NBCPolitics':     'NBC Politics',
    '@ScottNover':      'Scott Nover',
    '@adamwren':        'Adam Wren',
    '@ddale8':          'Daniel Dale',
    '@kwelkernbc':      'Kristen Welker',
    '@kyledcheney':     'Kyle Cheney',
    '@meredithllee':    'Meredith Lee',
    '@metzgov':         'Bryan Metzger',
    '@stephen_neukam':  'Stephen Neukam',
    '@AlecAHernandez':  'Alec Hernandez',
    '@AndrewDesiderio': 'Andrew Desiderio',
    '@AndrewSolender':  'Andrew Solender',
    '@BBCWorld':        'BBC World',
    '@BarakRavid':      'Barak Ravid',
    '@Cat_Zakrzewski':  'Cat Zakrzewski',
    '@ChadPergram':     'Chad Pergram',
    '@CraigCaplan':     'Craig Caplan',
    '@DefenseBaron':    'Jon Harper',
    '@FarnoushAmiri':   'Farnoush Amiri',
    '@InsidePolitics':  'Inside Politics',
    '@John_Hudson':     'John Hudson',
    '@JonathanLanday':  'Jonathan Landay',
    '@JonathanTamari':  'Jonathan Tamari',
    '@KDilanianMSNOW':  'Ken Dilanian',
    '@LisaMascaro':     'Lisa Mascaro',
    '@MacFarlaneNews':  'Scott MacFarlane',
    '@MattGlassman312': 'Matt Glassman',
    '@NormOrnstein':    'Norm Ornstein',
    '@Olivia_Beavers':  'Olivia Beavers',
    '@ReutersZengerle': 'Patricia Zengerle',
    '@UrsulaPerano':    'Ursula Perano',
    '@bresreports':     'Jake Bres',
    '@cami_mondeaux':   'Cami Mondeaux',
    '@connorobrienNH':  'Connor O\'Brien',
    '@emilybrooksnews': 'Emily Brooks',
    '@grace_panetta':   'Grace Panetta',
    '@greggiroux':      'Greg Giroux',
    '@jacq_thomsen':    'Jacqueline Thomsen',
    '@JakeSherman':     'Jake Sherman',
    '@jamiedupree':     'Jamie Dupree',
    '@mkraju':          'Manu Raju',
    '@maxwelltani':     'Maxwell Tani',
    '@mikedebonis':     'Mike DeBonis',
    '@mychaelschnell':  'Mychael Schnell',
    '@nancyayoussef':   'Nancy Youssef',
    '@natalieandrews':  'Natalie Andrews',
    '@pkcapitol':       'Paul Kane',
    '@politico':        'Politico',
    '@ryanjreilly':     'Ryan J. Reilly',
    '@sahilkapur':      'Sahil Kapur',
    '@sarahnferris':    'Sarah Ferris',
    '@scottwongDC':     'Scott Wong',
    '@seungminkim':     'Seung Min Kim',
    '@tvheidihatch':    'Heidi Hatch',
    // Additional handles seen in feed
    '@AdamDalyNews':    'Adam Daly',
    '@CBSNews':         'CBS News',
    '@FoxReports':      'Fox News Reports',
    '@HenryJGomez':     'Henry J. Gomez',
    '@HowardMortman':   'Howard Mortman',
    '@juliegraceb':     'Julie Grace Brufke',
    '@marksatter':      'Mark Satter',
    '@mmillerwtop':     'Mitchell Miller',
    '@wildstein':       'David Wildstein',
    '@KyleAlexStewart': 'Kyle Stewart',
    '@akarl_smith':     'A.G. Karl Smith',
};

function tweetRelativeTime(ms) {
    const diff = Math.floor((Date.now() - ms) / 60000);
    if (diff < 1) return 'now';
    if (diff < 60) return `${diff}m`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h`;
    return `${Math.floor(diff / 1440)}d`;
}

// Tick all visible tweet timestamps every 30s
setInterval(() => {
    document.querySelectorAll('.tweet-time[data-ts]').forEach(el => {
        const ts = parseInt(el.dataset.ts, 10);
        if (ts) el.textContent = tweetRelativeTime(ts);
    });
}, 30_000);

// New-tweet banner state
let _feedLoaded    = false; // true after first successful list-feed render
let _feedNewestTs  = 0;     // pubDate timestamp of newest tweet seen in list feed
let _feedNewPending = 0;    // count of new tweets not yet scrolled-to by user

async function fetchTweets(preData = null, userHandle = null) {
    const feed = document.getElementById('tweets-feed');
    if (!feed) return;
    // Don't override a user-profile view with SSE list pushes
    if (preData && window._tweetUserMode) return;
    try {
        let data;
        if (preData) {
            data = preData;
        } else {
            const apiUrl = userHandle
                ? `https://api.evanhollander.org/house-floor/api/tweets?user=${encodeURIComponent(userHandle)}`
                : 'https://api.evanhollander.org/house-floor/api/tweets';
            data = await fetch(apiUrl).then(r => r.json());
        }
        if (!data.tweets || !data.tweets.length) {
            feed.innerHTML = '<div class="tweets-empty">No posts available.</div>';
            return;
        }
        const renderTweet = (t, opts = {}) => {
            const { isThreadParent = false, isThreadReply = false } = opts;
            const rtByHandle = t.rtBy || '';
            const rtByLink = rtByHandle
                ? `<a href="https://twitter.com/${rtByHandle.replace('@', '')}" target="_blank" rel="noopener">${escapeHtml(rtByHandle)}</a>`
                : '';
            const rtBar = t.isRT
                ? `<div class="tweet-rt-bar">↩ ${rtByLink} retweeted</div>`
                : '';

            const onImgError = `this.style.display='none';const w=this.closest('.tweet-images,.tweet-card');if(w&&!w.querySelector('img:not([style*="none"])')&&w!==null)w.style.display='none'`;

            const imagesHtml = t.images && t.images.length
                ? `<div class="tweet-images tweet-images-${Math.min(t.images.length, 4)}">${
                    t.images.slice(0, 4).map(src =>
                        `<img class="tweet-img" src="${src}" loading="lazy" alt="" style="cursor:pointer" onerror="${onImgError}">`
                    ).join('')
                  }</div>`
                : '';

            const cardHtml = t.cardImage && !t.images.length
                ? `<div class="tweet-card"><img class="tweet-card-img tweet-img" src="${t.cardImage}" loading="lazy" alt="" style="cursor:pointer" onerror="this.closest('.tweet-card').style.display='none'"></div>`
                : '';

            const quoteInner = t.quoteAuthor
                ? `<span class="tweet-quote-author">${escapeHtml(t.quoteAuthor)}</span>
                   <div class="tweet-quote-text">${sanitizeTweetHtml(t.quoteHtml)}</div>`
                : '';
            const quoteHtml = quoteInner
                ? (t.quoteUrl
                    ? `<a class="tweet-quote" href="${escapeHtml(t.quoteUrl)}" target="_blank" rel="noopener">${quoteInner}</a>`
                    : `<div class="tweet-quote">${quoteInner}</div>`)
                : '';

            // Sanitize body then fix truncated URLs (display text ending with …) to point at the tweet page
            let bodyHtml = sanitizeTweetHtml(t.html) || escapeHtml(t.title || '');
            if (t.link) {
                bodyHtml = bodyHtml.replace(/<a([^>]*)href="[^"]*"([^>]*)>([^<]*…)<\/a>/g,
                    (_, pre, post, text) => `<a${pre}href="${escapeHtml(t.link)}"${post} title="View tweet for full URL">${text}</a>`);
            }

            const avatarLetter = (t.handle || '?').replace('@', '')[0].toUpperCase();
            const bareHandle = (t.handle || '').replace('@', '');
            const avatarSrc = bareHandle ? `https://unavatar.io/x/${bareHandle}` : '';
            const avatarInner = avatarSrc
                ? `<img src="${avatarSrc}" alt="" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
                  + `<span style="display:none;width:100%;height:100%;align-items:center;justify-content:center">${avatarLetter}</span>`
                : avatarLetter;
            const profileUrl = t.handle ? `https://twitter.com/${t.handle.replace('@', '')}` : null;
            const displayName = REPORTER_NAMES[t.handle] || bareHandle || null;
            const authorHtml = profileUrl
                ? `<a class="tweet-author-block" href="${profileUrl}" target="_blank" rel="noopener">
                    ${displayName ? `<span class="tweet-display-name">${escapeHtml(displayName)}</span>` : ''}
                    <span class="tweet-handle">${escapeHtml(t.handle || '')}</span>
                  </a>`
                : `<span class="tweet-author-block">
                    ${displayName ? `<span class="tweet-display-name">${escapeHtml(displayName)}</span>` : ''}
                    <span class="tweet-handle">${escapeHtml(t.handle || '')}</span>
                  </span>`;

            const cls = ['tweet-item', isThreadParent ? 'tweet-thread-parent' : '', isThreadReply ? 'tweet-thread-reply' : ''].filter(Boolean).join(' ');
            const avatarHtml = profileUrl
                ? `<a class="tweet-avatar" href="${profileUrl}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${avatarInner}</a>`
                : `<div class="tweet-avatar">${avatarInner}</div>`;
            const tweetTs = t.pubDate ? new Date(t.pubDate).getTime() : '';
            const tweetTimeText = tweetTs ? tweetRelativeTime(tweetTs) : escapeHtml(t.relativeTime || '');
            const tweetFullTime = tweetTs
                ? new Date(tweetTs).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
                : '';
            const filterBtn = t.handle
                ? `<button class="tweet-filter-btn" data-handle="${escapeHtml(t.handle)}" title="Filter by ${escapeHtml(t.handle)}" aria-label="Filter by ${escapeHtml(t.handle)}"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M0.5 1.5L9.5 1.5L6 5.5L6 8.5L4 8.5L4 5.5Z"/></svg></button>`
                : '';
            return `<div class="${cls}" data-handle="${escapeHtml(t.handle || '')}">
                ${rtBar}
                <div class="tweet-header">
                    <div class="tweet-author-area">
                        ${avatarHtml}
                        ${authorHtml}
                        ${filterBtn}
                    </div>
                    <span class="tweet-time"${tweetTs ? ` data-ts="${tweetTs}"` : ''}${tweetFullTime ? ` title="${escapeHtml(tweetFullTime)}"` : ''}>${tweetTimeText}</span>
                    ${t.link ? `<a class="tweet-ext-link" href="${t.link}" target="_blank" rel="noopener">↗</a>` : ''}
                </div>
                <div class="tweet-body">${bodyHtml}</div>
                ${imagesHtml}${cardHtml}${quoteHtml}
            </div>`;
        };

        // Snapshot scroll position before innerHTML wipes it (setting innerHTML resets scrollTop)
        const wasScrolledDown = feed.scrollTop > 60;

        // Count tweets newer than the last list-feed render (list mode only)
        let newCount = 0;
        if (_feedLoaded && !userHandle) {
            newCount = data.tweets.filter(t => {
                const ts = t.pubDate ? new Date(t.pubDate).getTime() : 0;
                return ts > _feedNewestTs;
            }).length;
        }
        // Keep newest-ts current for list feeds
        if (!userHandle) {
            const latestTs = data.tweets.reduce((max, t) =>
                Math.max(max, t.pubDate ? new Date(t.pubDate).getTime() : 0), 0);
            if (latestTs > _feedNewestTs) _feedNewestTs = latestTs;
        }

        // Group consecutive reply threads
        const items = [];
        const tweets = data.tweets;
        let i = 0;
        while (i < tweets.length) {
            const t = tweets[i];
            const next = tweets[i + 1];
            // If next tweet is a reply to this tweet's handle, group as thread
            if (next && next.isReply && next.replyTo === t.handle) {
                items.push(`<div class="tweet-thread">${renderTweet(t, { isThreadParent: true })}${renderTweet(next, { isThreadReply: true })}</div>`);
                i += 2;
            } else {
                items.push(renderTweet(t));
                i += 1;
            }
        }
        feed.innerHTML = items.join('');
        applyTweetFilter();

        // "↑ N new tweets" banner — shown when new posts arrived while user was scrolled down
        if (_feedLoaded && newCount > 0 && !userHandle) {
            if (wasScrolledDown) {
                _feedNewPending += newCount;
                const n = _feedNewPending;
                const banner = document.createElement('button');
                banner.className = 'tweets-new-banner';
                banner.textContent = `↑ ${n} new tweet${n === 1 ? '' : 's'}`;
                banner.addEventListener('click', () => {
                    feed.scrollTo({ top: 0, behavior: 'smooth' });
                    banner.remove();
                    _feedNewPending = 0;
                });
                feed.insertBefore(banner, feed.firstChild);
            } else {
                _feedNewPending = 0; // user is already at top — tweets visible on render
            }
        }
        if (!userHandle) _feedLoaded = true;
    } catch (e) {
        feed.innerHTML = '<div class="tweets-empty">Failed to load posts.</div>';
    }
}

// Document-level delegated listener — survives feed re-renders, no inline onclick needed
document.addEventListener('click', e => {
    // Proceedings bill number links → open bill modal (or congress.gov for external)
    const billLink = e.target.closest('.proc-bill-link');
    if (billLink) {
        if (billLink.classList.contains('proc-bill-external')) return; // let <a> navigate naturally
        e.preventDefault();
        const billId = billLink.dataset.billId;
        if (billId) openBillModal(billId);
        return;
    }
    // Image lightbox
    const img = e.target.closest('.tweet-img');
    if (img) {
        const container = img.closest('.tweet-images, .tweet-card');
        const allSrcs = container ? [...container.querySelectorAll('.tweet-img')].map(i => i.src) : [img.src];
        openTweetImageLightbox(img.src, allSrcs);
    }
    // Reporter filter button
    const filterBtn = e.target.closest('.tweet-filter-btn');
    if (filterBtn) {
        e.preventDefault();
        const handle = filterBtn.dataset.handle;
        window._tweetFilter = (window._tweetFilter === handle) ? null : handle;
        applyTweetFilter();
    }
});

function openTweetImageLightbox(clickedSrc, allSrcs) {
    const srcs = (allSrcs && allSrcs.length) ? allSrcs : [clickedSrc];
    let idx = srcs.indexOf(clickedSrc);
    if (idx === -1) idx = 0;

    let overlay = document.getElementById('tweet-img-lightbox');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'tweet-img-lightbox';
        overlay.innerHTML =
            `<button id="lb-prev" class="lb-nav-btn" aria-label="Previous image">&#8249;</button>` +
            `<img id="tweet-img-lightbox-img" alt="">` +
            `<button id="lb-next" class="lb-nav-btn" aria-label="Next image">&#8250;</button>`;
        overlay.addEventListener('click', e => {
            if (!e.target.closest('.lb-nav-btn') && !e.target.closest('#tweet-img-lightbox-img'))
                overlay.classList.remove('open');
        });
        overlay.querySelector('#lb-prev').addEventListener('click', e => { e.stopPropagation(); lbNavigate(-1); });
        overlay.querySelector('#lb-next').addEventListener('click', e => { e.stopPropagation(); lbNavigate(1); });
        document.addEventListener('keydown', e => {
            if (!overlay.classList.contains('open')) return;
            if (e.key === 'Escape') overlay.classList.remove('open');
            if (e.key === 'ArrowLeft')  lbNavigate(-1);
            if (e.key === 'ArrowRight') lbNavigate(1);
        });
        document.body.appendChild(overlay);
    }

    overlay._lbSrcs = srcs;
    overlay._lbIdx  = idx;
    lbUpdateImage(overlay);
    overlay.classList.add('open');
}

function lbNavigate(dir) {
    const overlay = document.getElementById('tweet-img-lightbox');
    if (!overlay) return;
    const srcs = overlay._lbSrcs || [];
    overlay._lbIdx = (overlay._lbIdx + dir + srcs.length) % srcs.length;
    lbUpdateImage(overlay);
}

function lbUpdateImage(overlay) {
    const srcs = overlay._lbSrcs || [];
    const idx  = overlay._lbIdx  || 0;
    overlay.querySelector('#tweet-img-lightbox-img').src = srcs[idx] || '';
    const single = srcs.length <= 1;
    overlay.querySelector('#lb-prev').style.display = single ? 'none' : '';
    overlay.querySelector('#lb-next').style.display = single ? 'none' : '';
}

// ── Reporter filter ──────────────────────────────────────────────────────────
window._tweetFilter   = null;  // '@Handle' of active filter, or null
window._tweetUserMode = false; // true when showing a specific user's profile feed

function applyTweetFilter() {
    const handle = window._tweetFilter;

    // Update reporter card active states
    document.querySelectorAll('.reporter-card').forEach(card => {
        card.classList.toggle('active', card.dataset.handle === handle);
    });

    // Active-filter chip — only shown when filtered reporter has no card in the row
    // (reporters in the card row already show their active state via .reporter-card.active)
    const chip = document.getElementById('reporter-active-chip');
    if (chip) {
        const hasCard = handle && !!document.querySelector(`#reporter-cards-row .reporter-card[data-handle="${handle}"]`);
        if (handle && !hasCard) {
            const displayName = REPORTER_NAMES[handle] || handle.replace('@', '');
            const bare = handle.replace('@', '');
            chip.innerHTML =
                `<img class="reporter-card-avatar" src="https://unavatar.io/x/${escapeHtml(bare)}" alt="" onerror="this.style.display='none'">` +
                `<span class="reporter-chip-name">${escapeHtml(displayName)}</span>` +
                `<span class="reporter-chip-clear" aria-hidden="true">✕</span>`;
            chip.style.display = '';
        } else {
            chip.style.display = 'none';
        }
    }

    const feed = document.getElementById('tweets-feed');
    if (!feed) return;
    feed.querySelectorAll('.tweet-item, .tweet-thread').forEach(el => {
        if (!handle) { el.style.display = ''; return; }
        if (el.classList.contains('tweet-thread')) {
            const handles = [...el.querySelectorAll('[data-handle]')].map(i => i.dataset.handle);
            el.style.display = handles.some(h => h === handle) ? '' : 'none';
        } else {
            el.style.display = (el.dataset.handle === handle) ? '' : 'none';
        }
    });
}

function initReporterCards() {
    const row = document.getElementById('reporter-cards-row');
    if (!row) return;

    row.innerHTML = DEFAULT_REPORTER_CARDS.map(r => {
        const bare = r.handle.replace('@', '');
        return `<button class="reporter-card" data-handle="${escapeHtml(r.handle)}">` +
            `<img class="reporter-card-avatar" src="https://unavatar.io/x/${escapeHtml(bare)}" alt="" onerror="this.style.display='none'">` +
            `${escapeHtml(r.name)}</button>`;
    }).join('');

    // Active-chip clear button
    const activeChip = document.getElementById('reporter-active-chip');
    if (activeChip) {
        activeChip.addEventListener('click', () => {
            window._tweetFilter   = null;
            window._tweetUserMode = false;
            applyTweetFilter();
            fetchTweets();
        });
    }

    row.addEventListener('click', e => {
        const card = e.target.closest('.reporter-card');
        if (!card) return;
        const handle = card.dataset.handle;
        if (window._tweetFilter === handle) {
            // Deselect → back to list feed
            window._tweetFilter   = null;
            window._tweetUserMode = false;
            applyTweetFilter();
            fetchTweets();
        } else {
            // Select → load that user's profile; update card states only,
            // do NOT filter the existing feed so it stays visible until new data arrives
            window._tweetFilter   = handle;
            window._tweetUserMode = true;
            document.querySelectorAll('.reporter-card').forEach(c => {
                c.classList.toggle('active', c.dataset.handle === handle);
            });
            fetchTweets(null, handle.replace('@', ''));
        }
    });

    const searchBtn     = document.getElementById('reporter-search-btn');
    const searchRow     = document.getElementById('reporter-search-row');
    const searchInput   = document.getElementById('reporter-search-input');
    const searchResults = document.getElementById('reporter-search-results');
    const searchClear   = document.getElementById('reporter-search-clear');

    // Build search index from REPORTER_NAMES + any extra default-card handles not in the map
    const searchIndex = Object.entries(REPORTER_NAMES).map(([handle, name]) => ({ handle, name }));
    DEFAULT_REPORTER_CARDS.forEach(r => {
        if (!REPORTER_NAMES[r.handle]) searchIndex.push({ handle: r.handle, name: r.name });
    });

    if (searchBtn && searchRow && searchInput) {
        searchBtn.addEventListener('click', () => {
            const isOpen = searchRow.style.display !== 'none';
            searchRow.style.display = isOpen ? 'none' : '';
            if (!isOpen) {
                searchInput.focus();
                if (searchResults) searchResults.style.display = 'none';
            }
        });

        if (searchResults) {
            searchInput.addEventListener('input', () => {
                const val = searchInput.value.trim().toLowerCase();
                if (!val) { searchResults.style.display = 'none'; return; }
                const matches = searchIndex.filter(({ handle, name }) =>
                    handle.replace('@', '').toLowerCase().includes(val) ||
                    name.toLowerCase().includes(val)
                ).slice(0, 8);
                if (!matches.length) { searchResults.style.display = 'none'; return; }
                searchResults.innerHTML = matches.map(({ handle, name }) =>
                    `<button class="reporter-search-result" data-handle="${escapeHtml(handle)}">` +
                    `<span class="reporter-result-name">${escapeHtml(name)}</span>` +
                    `<span class="reporter-result-handle">${escapeHtml(handle)}</span>` +
                    `</button>`
                ).join('');
                searchResults.style.display = '';
            });

            searchResults.addEventListener('click', e => {
                const btn = e.target.closest('.reporter-search-result');
                if (!btn) return;
                const handle = btn.dataset.handle;
                window._tweetFilter   = handle;
                window._tweetUserMode = true;
                document.querySelectorAll('.reporter-card').forEach(c => {
                    c.classList.toggle('active', c.dataset.handle === handle);
                });
                fetchTweets(null, handle.replace('@', ''));
                searchResults.style.display = 'none';
                searchInput.value = '';
                searchRow.style.display = 'none';
            });
        }

        searchInput.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                searchRow.style.display = 'none';
                if (searchResults) searchResults.style.display = 'none';
                searchInput.value = '';
            }
        });

        if (searchClear) {
            searchClear.addEventListener('click', () => {
                searchInput.value = '';
                if (searchResults) searchResults.style.display = 'none';
                window._tweetFilter   = null;
                window._tweetUserMode = false;
                applyTweetFilter();
                fetchTweets();
                searchRow.style.display = 'none';
            });
        }
    }
}

// Bluesky Functions
async function fetchBlueskyFeed(preData = null) {
    try {
        let jsonData;
        if (preData) {
            jsonData = preData;
        } else {
            const response = await fetch(BLUESKY_CONFIG.workerUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            jsonData = await response.json();
        }
        if (jsonData.error) {
            throw new Error(jsonData.error);
        }
        
        // Handle new posts-based response
        if (jsonData.posts && jsonData.posts.length > 0) {
            blueskyData = jsonData.posts.slice(0, 10).map(post => ({
                text: post.content || post.title || '',
                author: post.author || 'Bluesky User',
                timestamp: post.updated || new Date().toISOString()
            }));
            
            updateTicker();
        }
        
    } catch (error) {
        console.error('Bluesky fetch error:', error);
        // Fallback to mock data
        blueskyData = [
            { text: "Monitoring House floor activity...", author: "System", timestamp: new Date().toISOString() },
            { text: "Vote tracking active", author: "System", timestamp: new Date().toISOString() },
            { text: "Live feed status: STANDBY", author: "System", timestamp: new Date().toISOString() }
        ];
        updateTicker();
    }
}

function updateTicker() {
    if (!elements.tickerContent) return;
    
    // Duplicate data for seamless scrolling if needed
    const displayData = [...blueskyData, ...blueskyData];
    
    const html = displayData.map(item => 
        `<span class="ticker-item">[${escapeHtml(item.author)}] ${escapeHtml(item.text)}</span>`
    ).join('');
    
    setIfChanged(elements.tickerContent, html);
}

// Weather Data
const WEATHER_COORDS = {
    lat: 38.889722,
    lon: -77.008889
};

async function fetchWeather() {
    try {
        // Step 1: Get grid endpoint from points
        const pointsUrl = `https://api.weather.gov/points/${WEATHER_COORDS.lat},${WEATHER_COORDS.lon}`;
        const pointsResponse = await fetch(pointsUrl);
        if (!pointsResponse.ok) throw new Error('Points API failed');
        const pointsData = await pointsResponse.json();
        
        // Step 2: Get hourly forecast (more accurate for current conditions)
        const forecastUrl = pointsData.properties.forecastHourly;
        const forecastResponse = await fetch(forecastUrl);
        if (!forecastResponse.ok) throw new Error('Forecast API failed');
        const forecastData = await forecastResponse.json();

        // First hourly period is the current hour
        const current = forecastData.properties.periods[0];
        
        // Update DOM
        elements.weatherTemp.textContent = `${Math.round(current.temperature)}°${current.temperatureUnit}`;
        elements.weatherCondition.textContent = current.shortForecast;
    } catch (error) {
        console.error('Weather fetch error:', error);
        elements.weatherTemp.textContent = '--°';
        elements.weatherCondition.textContent = 'N/A';
    }
}

// Weather Panel Video
let capcamHls = null;
const CAPCAM_URL = 'https://www-senate-gov-media-srs.akamaized.net/hls/live/2036784/capcam/capcam/master.m3u8';
let videoLoaded = false;

function initWeatherPanel() {
    const panel = elements.weatherPanel;
    const video = elements.capcamVideo;

    video.muted = true;
    const isLocalFile = window.location.protocol === 'file:';

    function startCapcam() {
        if (videoLoaded || capcamHls) return;
        if (window.Hls && Hls.isSupported()) {
            capcamHls = new Hls({ maxBufferLength: 4, maxMaxBufferLength: 8, enableWorker: !isLocalFile });
            capcamHls.loadSource(CAPCAM_URL);
            capcamHls.attachMedia(video);
            capcamHls.on(Hls.Events.MANIFEST_PARSED, () => { videoLoaded = true; video.play().catch(() => {}); });
            capcamHls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) { capcamHls.destroy(); capcamHls = null; videoLoaded = false; }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = CAPCAM_URL;
            video.addEventListener('canplay', () => { videoLoaded = true; video.play().catch(() => {}); }, { once: true });
            video.addEventListener('error', () => { videoLoaded = false; });
            video.load();
        }
    }

    // Load on first hover only — avoids buffering live video nobody is watching
    panel.addEventListener('mouseenter', () => {
        startCapcam();
        if (videoLoaded) video.play().catch(() => {});
    });

    panel.addEventListener('mouseleave', () => {
        video.pause();
    });
}

// Console API: setDate('mm/dd/yyyy') / clearDate()
window.setDate = function(dateStr) {
    const normalized = dateStr.replace(/-/g, '/');
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(normalized)) {
        return 'Invalid date format. Use mm/dd/yyyy, e.g. setDate("05/17/2026")';
    }
    proceedingsDateOverride = normalized;
    billsFullyEnriched = false; // force full re-enrichment for the new date
    updateProceedingsFeed();
    fetchBillsThisWeek();
    return `Proceedings date set to ${normalized} — refreshing...`;
};
window.clearDate = function() {
    proceedingsDateOverride = null;
    billsFullyEnriched = false; // force full re-enrichment on return to live
    updateProceedingsFeed();
    fetchBillsThisWeek();
    return 'Date override cleared — back to live feed';
};

// Global mode switch function for console access
window.setMode = function(mode) {
    const validModes = ['vote', 'recess', 'debate', 'prayer', 'silence', 'oath', 'speaker', 'pledge', 'journal', 'morning-hour', 'one-minute', 'special-order', 'joint-meeting', 'tellers', 'message', 'cert-election', 'cert-electoral', 'sine-die', 'new-session', 'admin-oath', 'joint-session', 'committee-chair'];
    if (!validModes.includes(mode)) {
        console.error(`Invalid mode: ${mode}. Valid modes are: ${validModes.join(', ')}`);
        return;
    }

    updateModeClasses(mode);
    if (mode === 'tellers' && proceedingsData.length) {
        updateTellersSection(proceedingsData);
    }
};

// Console helpers for testing — freeze/unfreeze the auto-switch without
// touching setMode itself (so manual setMode('prayer') etc. still work).
//   lockMode()          → disable auto-switch, print current mode
//   lockMode('prayer')  → disable auto-switch AND switch to that mode
//   lockMode('all')     → show every panel at once (debug layout review)
//   unlockMode()        → re-enable auto-switch
window._modeLocked = false;
window.lockMode = function(mode) {
    window._modeLocked = true;
    if (mode === 'all') {
        updateModeClasses('all');
    } else if (mode) {
        window.setMode(mode);
    }
    console.info(`%c[mode] AUTO-SWITCH LOCKED${mode ? ' → ' + mode : ''} — call unlockMode() to restore`, 'color:#f59e0b;font-weight:bold');
};
window.unlockMode = function() {
    window._modeLocked = false;
    console.info('%c[mode] Auto-switch restored', 'color:#22c55e;font-weight:bold');
};

// Initialize mode (no toggle — mode is driven by DomeWatch)
function initModeToggle() {
    updateModeClasses('vote');
}

function updateModeClasses(mode) {
    // Remove all mode classes (including all-mode debug class)
    document.body.classList.remove('recess-mode', 'debate-mode', 'prayer-mode', 'silence-mode', 'oath-mode', 'speaker-mode', 'pledge-mode', 'journal-mode', 'morning-hour-mode', 'one-minute-mode', 'special-order-mode', 'joint-meeting-mode', 'tellers-mode', 'message-mode', 'cert-election-mode', 'cert-electoral-mode', 'sine-die-mode', 'new-session-mode', 'admin-oath-mode', 'joint-session-mode', 'committee-chair-mode', 'all-mode');

    // Special: show every panel simultaneously (lockMode('all') debug helper).
    // all-mode CSS (last in stylesheet) overrides the !important vote-display
    // hiding that each individual mode class applies.
    if (mode === 'all') {
        document.body.classList.add('all-mode', 'debate-mode', 'prayer-mode', 'silence-mode', 'oath-mode', 'speaker-mode', 'pledge-mode', 'journal-mode', 'morning-hour-mode', 'one-minute-mode', 'special-order-mode', 'joint-meeting-mode', 'tellers-mode', 'message-mode', 'cert-election-mode', 'cert-electoral-mode', 'sine-die-mode', 'new-session-mode', 'admin-oath-mode', 'joint-session-mode', 'committee-chair-mode');
        return;
    }

    // Add appropriate class based on mode
    if (mode === 'recess') {
        document.body.classList.add('recess-mode');
    } else if (mode === 'debate') {
        document.body.classList.add('debate-mode');
    } else if (mode === 'prayer') {
        document.body.classList.add('prayer-mode');
    } else if (mode === 'silence') {
        document.body.classList.add('silence-mode');
    } else if (mode === 'oath') {
        document.body.classList.add('oath-mode');
    } else if (mode === 'speaker') {
        document.body.classList.add('speaker-mode');
    } else if (mode === 'pledge') {
        document.body.classList.add('pledge-mode');
    } else if (mode === 'journal') {
        document.body.classList.add('journal-mode');
    } else if (mode === 'morning-hour') {
        document.body.classList.add('morning-hour-mode');
    } else if (mode === 'one-minute') {
        document.body.classList.add('one-minute-mode');
    } else if (mode === 'special-order') {
        document.body.classList.add('special-order-mode');
    } else if (mode === 'joint-meeting') {
        document.body.classList.add('joint-meeting-mode');
    } else if (mode === 'tellers') {
        document.body.classList.add('tellers-mode');
    } else if (mode === 'message') {
        document.body.classList.add('message-mode');
    } else if (mode === 'cert-election') {
        document.body.classList.add('cert-election-mode');
    } else if (mode === 'cert-electoral') {
        document.body.classList.add('cert-electoral-mode');
    } else if (mode === 'sine-die') {
        document.body.classList.add('sine-die-mode');
    } else if (mode === 'new-session') {
        document.body.classList.add('new-session-mode');
    } else if (mode === 'admin-oath') {
        document.body.classList.add('admin-oath-mode');
    } else if (mode === 'joint-session') {
        document.body.classList.add('joint-session-mode');
    } else if (mode === 'committee-chair') {
        document.body.classList.add('committee-chair-mode');
    }
}

// Initialize
function init() {
    const footerYear = document.getElementById('footer-year');
    if (footerYear) footerYear.textContent = new Date().getFullYear();

    // Version indicator — read from the ?v= cache-buster on the app.js script tag.
    // This value is hardcoded in the HTML file that Pages serves, so it reflects
    // the actual deployed build rather than the latest git commit.
    const deployVersion = document.querySelector('script[src^="app.js"]')
        ?.src?.match(/[?&]v=([^&]+)/)?.[1] ?? '—';
    const cdBuild = document.getElementById('cd-build');
    if (cdBuild) cdBuild.textContent = deployVersion;

    updateTimestamp();
    setInterval(updateTimestamp, 1000);
    setInterval(updateNextSessionCountdown, 1000);
    updateTodayDate();
    setInterval(updateTodayDate, 60000); // Update date every minute
    
    
    // bills, rules, whip, roll-log, casualty-list all delivered via SSE from the DO.
    // fetchBillsThisWeek() only called here for date overrides (setDate/clearDate).
    fetchVotingDays();
    fetchFloorData();
    fetchWeather();

    // Whip notices filter button — toggle dropdown open/closed
    const whipFilterBtn = document.getElementById('whip-filter-btn');
    if (whipFilterBtn) {
        whipFilterBtn.addEventListener('click', e => {
            e.stopPropagation();
            const dropdown = document.getElementById('whip-filter-dropdown');
            if (!dropdown) return;
            if (!dropdown.hidden) {
                // Close — keep button active only if a filter is still selected
                dropdown.hidden = true;
                whipFilterBtn.classList.toggle('active', whipNoticeFilter !== null);
            } else {
                renderWhipFilterDropdown();
                // Button is active while dropdown is open (or filter selected)
                whipFilterBtn.classList.add('active');
            }
        });
    }
    // Delegate: filter chips in dropdown + inline type badges on items
    // Dropdown only opens/closes via the filter button — no outside-click close.
    document.addEventListener('click', e => {
        const chip = e.target.closest('[data-filter-type]');
        if (!chip) return;
        setWhipFilter(chip.dataset.filterType);
    });

    // Airport delays need the name lookup — start both in parallel, delays waits on names
    fetchAirportNames().then(() => fetchAirportDelays());
    
    // Start SSE streaming for real-time updates (with polling fallback)
    startSSEStreaming();

    // Client-side SSE staleness watchdog.
    // During an active roll call vote DomeWatch sends vote.tally every ~1s.
    // If we're in vote mode but haven't received a tally tick for 45s, the
    // SSE connection has gone zombie (open but silent). Force a reconnect.
    setInterval(() => {
        const inVote = floorData?.currentStatus?.value === 'vote' ||
                       floorData?.currentStatus?.value === 'voting';
        if (inVote && lastSseTallyAt > 0 && (Date.now() - lastSseTallyAt) > 45000) {
            if (sseConnection) { sseConnection.close(); sseConnection = null; }
            isStreaming = false;
            lastSseReconnectAt = Date.now(); // reset to avoid a tight reconnect loop (NOT lastSseTallyAt — that would falsely extend sseIsLive)
            startSSEStreaming();
        }
    }, 15000);

    // Floor state is now pushed via event: floor from the DO every 5s.
    // This fallback only fires when the SSE stream hasn't delivered a floor event
    // in the last 15s (e.g. DO restarting, SSE reconnecting after a drop).
    setInterval(() => {
        const floorSseRecent = lastFloorSseAt > 0 && (Date.now() - lastFloorSseAt) < 15_000;
        if (!floorSseRecent) fetchFloorData(true);
    }, 10000);
    setInterval(fetchWeather, 1800000); // Weather every 30 min (direct to NWS, zero Worker cost)
    // bills, tweets, bluesky, airportdelays, housemakeup are all pushed via SSE from the DO —
    // no browser polling needed; the DO fetches once for all connected users.
    // Initialize
    initWeatherPanel();
    
    // Initialize floor grid
    initFloorGrid();
    
    // Initialize mode toggle
    initModeToggle();

    // Initialize SVG analog clocks (tick marks)
    initAnalogClocks();
    
    // Fetch initial data
    updateProceedingsFeed();
    fetchHouseMakeup();
    fetchBlueskyFeed();
    fetchNewsTicker();
    fetchTweets();
    initReporterCards();

    // Info popup click delegation
    document.addEventListener('click', e => {
        const btn = e.target.closest('.info-btn');
        if (btn) { e.stopPropagation(); openInfoPopup(btn.dataset.info); }
    });

    // Amendment search input — live filter
    document.addEventListener('input', e => {
        if (!e.target.closest('[data-amdt-search]')) return;
        amendmentsSearchQuery = e.target.value.trim();
        _reRenderAllAmendmentBodies();
    });

    // Amendment sort + filter + dot + member — global delegation (spans modal + debate panels)
    const _reRenderAllAmendmentBodies = () => {
        document.querySelectorAll('[data-amendments-slug]').forEach(bodyEl => {
            const cached = _amendmentsDataCache.get(bodyEl.dataset.amendmentsSlug);
            if (cached) renderAmendmentsTable(cached, bodyEl);
        });
    };
    document.addEventListener('click', e => {
        // Sort buttons
        const amdtSortBtn = e.target.closest('.amdt-sort-btn');
        if (amdtSortBtn) {
            amendmentsSortMode = amdtSortBtn.dataset.sort;
            document.querySelectorAll('.amdt-sort-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.sort === amendmentsSortMode));
            _reRenderAllAmendmentBodies();
            return;
        }
        // Party filter buttons (All / D / R / Bipartisan)
        const amdtFilterBtn = e.target.closest('.amdt-filter-btn');
        if (amdtFilterBtn) {
            amendmentsPartyFilter = amdtFilterBtn.dataset.filter;
            if (amendmentsPartyFilter === 'all') amendmentsMemberFilter = null; // "All" resets member filter too
            document.querySelectorAll('.amdt-filter-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.filter === amendmentsPartyFilter));
            _reRenderAllAmendmentBodies();
            return;
        }
        // Party dot click — toggle that party filter
        const dotBtn = e.target.closest('[data-filter-party]');
        if (dotBtn) {
            const party = dotBtn.dataset.filterParty;
            amendmentsPartyFilter = amendmentsPartyFilter === party ? 'all' : party;
            document.querySelectorAll('.amdt-filter-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.filter === amendmentsPartyFilter));
            _reRenderAllAmendmentBodies();
            return;
        }
        // Member name click — toggle member filter
        const memberBtn = e.target.closest('.amdt-member-btn');
        if (memberBtn) {
            const name = memberBtn.dataset.memberName;
            amendmentsMemberFilter = amendmentsMemberFilter === name ? null : name;
            _reRenderAllAmendmentBodies();
        }
    });

    // Bill card click → modal; sort button click → re-sort
    const billsSection = document.querySelector('.bills-section');
    if (billsSection) {
        billsSection.addEventListener('click', e => {
            const sortBtn = e.target.closest('.bills-sort-btn');
            if (sortBtn && !sortBtn.classList.contains('amdt-sort-btn')) { billsSortMode = sortBtn.dataset.sort; updateBillsDisplay(); return; }
            const card = e.target.closest('[data-bill-id]');
            if (card) openBillModal(card.dataset.billId);
        });
        billsSection.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                const card = e.target.closest('[data-bill-id]');
                if (card) { e.preventDefault(); openBillModal(card.dataset.billId); }
            }
        });
    }

    // Absentee filter toggle — handles both filter-bar buttons and metric box clicks
    const absenteePanel = document.querySelector('.absentee-panel');
    if (absenteePanel) {
        absenteePanel.addEventListener('click', e => {
            const btn = e.target.closest('.absentee-filter-btn');
            const metric = e.target.closest('.party-metric[data-filter]');
            const target = btn || metric;
            if (!target) return;
            const newFilter = target.dataset.filter;
            if (!newFilter) return;
            // Clicking the already-active party filter clears back to all
            absenteeFilterMode = (newFilter !== 'all' && newFilter === absenteeFilterMode) ? 'all' : newFilter;
            if (_absenteesPayload) {
                updateAbsenteeUI(
                    _absenteesPayload.absentees,
                    _absenteesPayload.rollNumber,
                    _absenteesPayload.rollDate,
                    _absenteesPayload.rollTime
                );
            }
        });
    }
}

// ── Committee Live Feeds ─────────────────────────────────────────────────────

// Fetch news ticker from RSS feeds
async function fetchNewsTicker() {
    try {
        if (!elements.tickerContent) return;
        
        const response = await fetch(NEWS_CONFIG.workerUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        if (!data.items || data.items.length === 0) {
            setIfChanged(elements.tickerContent, '<div class="ticker-item">No news available</div>');
            return;
        }
        
        // Randomize news items and create tactical ticker content
        const shuffledItems = [...data.items].sort(() => Math.random() - 0.5);
        
        // Quintuple the items to ensure the ticker is full from the start on all screen sizes
        const displayItems = [...shuffledItems, ...shuffledItems, ...shuffledItems, ...shuffledItems, ...shuffledItems];
        
        const continuousContent = displayItems.map(item => {
            const href = safeUrl(item.link);
            return `<a ${href ? `href="${escapeHtml(href)}"` : ''} target="_blank" rel="noopener noreferrer" class="ticker-item">
                <span class="ticker-source">${escapeHtml(item.source || '')}</span>
                <span class="ticker-text">${escapeHtml(item.title || '')}</span>
                <span class="ticker-time">${escapeHtml(item.relativeTime || '')}</span>
            </a>`;
        }).join('');
        
        // Update ticker display
        setIfChanged(elements.tickerContent, continuousContent);
        elements.tickerContent.style.paddingLeft = '0';
        // Force a reflow so Safari restarts the CSS animation after innerHTML change.
        // Without this, Safari freezes the ticker until a hover/blur triggers a repaint.
        elements.tickerContent.style.animation = 'none';
        void elements.tickerContent.offsetWidth; // flush layout — also lets us measure natural width
        // Constant ~80px/s regardless of item count
        const tickerDuration = Math.round(elements.tickerContent.scrollWidth / 80);
        elements.tickerContent.style.animation = '';
        elements.tickerContent.style.animationDuration = `${tickerDuration}s`;
        
    } catch (error) {
        console.error('News ticker fetch error:', error);
        setIfChanged(elements.tickerContent, '<div class="ticker-item">Unable to fetch news</div>');
    }
}

// Helper function to get source name from URL


// Update Timestamp
function updateTimestamp() {
    const now = new Date();
    const timeOptions = {
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: false 
    };

    elements.localTime.textContent = now.toLocaleTimeString('en-US', timeOptions);
    elements.dcTime.textContent = now.toLocaleTimeString('en-US', {
        ...timeOptions,
        timeZone: 'America/New_York'
    });
    elements.utcTime.textContent = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'UTC'
    });

    updateAnalogClock(elements.localAnalog, {
        hours: now.getHours(),
        minutes: now.getMinutes(),
        seconds: now.getSeconds()
    });

    const dcParts = getTimeParts(now, 'America/New_York');
    updateAnalogClock(elements.dcAnalog, dcParts);
    
    const utcParts = getTimeParts(now, 'UTC');
    updateAnalogClock(elements.utcAnalog, utcParts);
}

function getTimeParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    }).formatToParts(date);

    return {
        hours: Number(parts.find(part => part.type === 'hour').value),
        minutes: Number(parts.find(part => part.type === 'minute').value),
        seconds: Number(parts.find(part => part.type === 'second').value)
    };
}

function initAnalogClocks() {
    ['local', 'dc', 'utc'].forEach(id => {
        const svg = document.getElementById(`${id}-analog`);
        if (!svg) return;
        const ticks = svg.querySelector('.clock-ticks');
        if (!ticks) return;
        for (let i = 0; i < 60; i++) {
            const isHour = i % 5 === 0;
            const rad = (i * 6 - 90) * Math.PI / 180;
            const outer = 44;
            const inner = isHour ? 36 : 40;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', (50 + outer * Math.cos(rad)).toFixed(2));
            line.setAttribute('y1', (50 + outer * Math.sin(rad)).toFixed(2));
            line.setAttribute('x2', (50 + inner * Math.cos(rad)).toFixed(2));
            line.setAttribute('y2', (50 + inner * Math.sin(rad)).toFixed(2));
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('stroke', isHour ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.2)');
            line.setAttribute('stroke-width', isHour ? '2' : '0.8');
            ticks.appendChild(line);
        }
    });
}

function updateAnalogClock(clockElement, time) {
    if (!clockElement) return;

    const hourDeg = ((time.hours % 12) * 30) + (time.minutes * 0.5);
    const minuteDeg = (time.minutes * 6) + (time.seconds * 0.1);
    const secondDeg = time.seconds * 6;

    clockElement.querySelector('.hour-hand')?.setAttribute('transform', `rotate(${hourDeg.toFixed(2)},50,50)`);
    clockElement.querySelector('.minute-hand')?.setAttribute('transform', `rotate(${minuteDeg.toFixed(2)},50,50)`);
    clockElement.querySelector('.second-hand')?.setAttribute('transform', `rotate(${secondDeg.toFixed(2)},50,50)`);
}



// Floor Grid Configuration
const HOUSE_TOTAL_MEMBERS = 435;

// Returns the current "Whole Number" of the House — members sworn in, excluding vacancies.
// houseMakeup.total is populated by fetchHouseMakeup(); falls back to HOUSE_TOTAL_MEMBERS minus
// any vacancies we've already parsed.
function getWholeNumber() {
    return houseMakeup?.total || (HOUSE_TOTAL_MEMBERS - vacancies.length);
}

// Votes needed to pass, based on the current Whole Number.
// Simple majority: floor(n/2)+1. Suspension of rules: ceil(n*2/3).
function getVotesNeeded(isSuspension = false) {
    const n = getWholeNumber();
    return isSuspension ? Math.ceil(n * 2 / 3) : Math.floor(n / 2) + 1;
}
const US_CHAMBER_LAYOUT = {
    rows: [25, 31, 37, 43, 49, 55, 61, 67, 67],
    // side===-1 uses angles 30-85° (cos>0, screen RIGHT) → democrats
    // side=== 1 uses angles 95-149° (cos<0, screen LEFT)  → republicans
    leftParty: 'democrat',
    rightParty: 'republican'
};

function initFloorGrid() {
    renderArchSeats();
    updateFloorGrid();

    if ('ResizeObserver' in window && elements.floorArch) {
        floorGridResizeObserver = new ResizeObserver(() => {
            renderArchSeats();
            updateFloorGrid();
        });
        floorGridResizeObserver.observe(elements.floorArch);
    }
}

function renderArchSeats() {
    if (!elements.floorArch) return;

    const container = elements.floorArch;
    container.querySelectorAll('.seat, .chamber-rings-svg').forEach(el => el.remove());

    const w = container.offsetWidth || 720;
    const h = container.offsetHeight || 280;
    const nRows = US_CHAMBER_LAYOUT.rows.length;
    const cx = w / 2;
    const floorY = h * 0.96;
    const innerR = w * 0.16, outerR = w * 0.47;
    const aisleHalfW = 21; // half of 42px center-aisle

    // Draw SVG arc guides using the same math as the dots
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;overflow:visible;';
    svg.classList.add('chamber-rings-svg');

    for (let rowIdx = 0; rowIdx < nRows; rowIdx++) {
        const rp = rowIdx / (nRows - 1);
        const R = innerR + (outerR - innerR) * rp;
        const opacity = 0.18 - rowIdx * 0.008;
        // Per-row gap angle so center gap is exactly aisleHalfW pixels at every row radius
        const gapAngle = R > aisleHalfW ? Math.acos(aisleHalfW / R) : Math.PI / 2;

        // Two arc segments per row — one per side of center aisle
        for (const [aStart, aEnd] of [[0, gapAngle], [Math.PI - gapAngle, Math.PI]]) {
            const segSteps = Math.max(3, Math.round(40 * (aEnd - aStart) / (Math.PI / 2)));
            let d = '';
            for (let s = 0; s <= segSteps; s++) {
                const angle = aStart + (aEnd - aStart) * (s / segSteps);
                const px = cx + R * Math.cos(angle);
                const py = floorY - R * Math.sin(angle);
                d += (s === 0 ? 'M' : 'L') + `${px.toFixed(1)} ${py.toFixed(1)} `;
            }
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', `rgba(139,148,158,${opacity.toFixed(3)})`);
            path.setAttribute('stroke-width', '1');
            svg.appendChild(path);
        }
    }

    // Insert SVG before labels
    const firstLabel = container.querySelector('.arch-label, .dais-label');
    container.insertBefore(svg, firstLabel || container.firstChild);

    const seats = createUsChamberLayout(container, US_CHAMBER_LAYOUT);
    seats.forEach(seatData => {
        const seat = document.createElement('div');
        seat.className = 'seat';
        seat.dataset.party = seatData.party;
        seat.dataset.row = seatData.row;
        seat.dataset.seatOrder = seatData.order;
        seat.style.left = `${seatData.x}%`;
        seat.style.top = `${seatData.y}%`;
        container.appendChild(seat);
    });
}

function createUsChamberLayout(container, config) {
    const width = container.offsetWidth || 720;
    const height = container.offsetHeight || 280;
    const centerX = width / 2;
    const floorY = height * 0.96;
    const innerR = width * 0.16, outerR = width * 0.47;
    const aisleHalfW = 21;
    const seats = [];

    config.rows.forEach((count, rowIdx) => {
        const rowProgress = rowIdx / (config.rows.length - 1);
        const R = innerR + (outerR - innerR) * rowProgress;
        // gapAngle ensures center gap = exactly aisleHalfW*2 pixels at this row's radius
        const gapAngle = R > aisleHalfW ? Math.acos(aisleHalfW / R) : Math.PI / 2;

        for (let i = 0; i < count; i++) {
            const side = i < count / 2 ? -1 : 1;
            const sideIndex = side === -1 ? i : i - Math.ceil(count / 2);
            const sideCount = side === -1 ? Math.ceil(count / 2) : Math.floor(count / 2);
            const sideProgress = sideCount > 1 ? sideIndex / (sideCount - 1) : 0;
            // side===-1: Democrat, screen RIGHT, angle 0 (right edge, floor) → gapAngle (right of aisle)
            // side=== 1: Republican, screen LEFT, angle PI-gapAngle (left of aisle) → PI (left edge, floor)
            const angle = side === -1
                ? gapAngle * sideProgress
                : (Math.PI - gapAngle) + gapAngle * sideProgress;
            const x = centerX + R * Math.cos(angle);
            const y = floorY - R * Math.sin(angle);
            
            seats.push({
                party: side === 1 ? config.rightParty : config.leftParty,
                row: rowIdx + 1,
                order: (rowProgress * 1000) + sideProgress,
                x: (x / width) * 100,
                y: (y / height) * 100
            });
        }
    });

    return seats.slice(0, HOUSE_TOTAL_MEMBERS);
}

let _absenteeInFlight = false;
let _absenteeDebounceTimer = null;
async function updateAbsenteeTracking() {
    // Fetch immediately so the section paints as soon as the page loads.
    if (_absenteeInFlight) return;
    _absenteeInFlight = true;
    try {
        await _doAbsenteeTracking();
    } finally {
        _absenteeInFlight = false;
    }
}

async function _doAbsenteeTracking() {
    try {
        if (!elements.absenteeList) return;

        try {
            const indexResponse = await fetch(CONGRESS_INDEX_CONFIG.workerUrl);
            if (!indexResponse.ok) throw new Error(`HTTP ${indexResponse.status}`);
            const jsonData = await indexResponse.json();

            const rollNumber = jsonData.latestRollNumber;

            const rollResponse = await fetch(`${CONGRESS_INDEX_CONFIG.workerUrl}/roll/${rollNumber}`);
            const rollXml = await rollResponse.text();
            
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(rollXml, 'text/xml');
            
            const absentees = [];
            const recordedVotes = xmlDoc.querySelectorAll('recorded-vote');
            
            recordedVotes.forEach(recordedVote => {
                const vote = recordedVote.querySelector('vote')?.textContent;
                if (vote === 'Not Voting') {
                    const legislator = recordedVote.querySelector('legislator');
                    const name = legislator?.textContent || '';
                    const party = legislator?.getAttribute('party') || '';
                    const state = legislator?.getAttribute('state') || '';
                    
                    const trimmedName = name.trim();
                    if (!trimmedName) return; // vacant seat — skip
                    absentees.push({
                        name: trimmedName,
                        party: party === 'R' ? 'rep' : party === 'D' ? 'dem' : 'ind',
                        state: state.trim(),
                        voteType: vote
                    });
                }
            });

            const rollDate = xmlDoc.querySelector('action-date')?.textContent?.trim() || '';
            const rollTime = xmlDoc.querySelector('action-time')?.textContent?.trim() || '';
            await updateAbsenteeUI(absentees, rollNumber, rollDate, rollTime);

        } catch (error) {
            console.error('Absentee tracking fetch failed:', error);
        }

    } catch (error) {
        console.error('Absentee tracking error:', error);
        setIfChanged(elements.absenteeList, '<div class="absentee-member">ERROR</div>');
    }
}

// Update absentee UI with data from roll call
async function updateAbsenteeUI(absentees, rollNumber, rollDate, rollTime) {
    if (!elements.absenteeList) return;

    // Update counts
    const totalAbsentees = absentees.length;
    const repAbsentees = absentees.filter(a => a.party === 'rep').length;
    const demAbsentees = absentees.filter(a => a.party === 'dem').length;
    const indAbsentees = absentees.filter(a => a.party === 'ind').length;

    if (elements.absenteeRep) elements.absenteeRep.textContent = repAbsentees;
    if (elements.absenteeDem) elements.absenteeDem.textContent = demAbsentees;
    if (elements.absenteeTotal) elements.absenteeTotal.textContent = totalAbsentees;
    if (elements.absenteeInd) elements.absenteeInd.textContent = indAbsentees;
    if (elements.absenteeIndMetric) {
        elements.absenteeIndMetric.style.display = indAbsentees > 0 ? '' : 'none';
    }

    // Update roll call info with date/time from XML
    if (elements.absenteeRollInfo) {
        let dateTimeStr = '';
        if (rollDate) {
            // rollDate format from Clerk XML: "15-May-2026"
            const parts = rollDate.split('-');
            if (parts.length === 3) {
                // parts[0]=day, parts[1]=month name, parts[2]=year
                const monthIdx = MONTH_NAMES.findIndex(m => m.toLowerCase().startsWith(parts[1].toLowerCase().slice(0, 3)));
                const mon = monthIdx >= 0 ? MONTH_NAMES[monthIdx] : parts[1];
                dateTimeStr = `${parseInt(parts[0])} ${mon} ${parts[2]}`;
            } else {
                dateTimeStr = formatDate(rollDate);
            }
        }
        if (rollTime) dateTimeStr += ` ${rollTime}`;
        elements.absenteeRollInfo.textContent = `Roll ${rollNumber}${dateTimeStr ? ' • ' + dateTimeStr : ''}`;
    }
    
    // Cache payload so the filter can re-render without a refetch
    _absenteesPayload = { absentees, rollNumber, rollDate, rollTime };

    // Apply dim/active state to metric boxes and sync filter buttons
    const absenteePanel = document.querySelector('.absentee-panel');
    if (absenteePanel) {
        absenteePanel.querySelectorAll('.party-metric[data-filter]').forEach(m => {
            const mFilter = m.dataset.filter;
            // Dim all metrics except the selected one (total dims too when a party is active)
            const isActive = absenteeFilterMode === 'all' || mFilter === absenteeFilterMode;
            m.classList.toggle('dim', !isActive);
        });
        absenteePanel.querySelectorAll('.absentee-filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.filter === absenteeFilterMode);
        });
    }

    // Update absentee list
    if (absentees.length > 0) {
        let xmlDoc = null;
        try {
            const xmlText = await getMemberDataXml();
            xmlDoc = parseMemberDataXml(xmlText);
        } catch (error) {
            console.error('Failed to load member XML for absentees:', error);
        }

        // Filter by party when not 'all'
        let displayAbsentees = absentees;
        if (absenteeFilterMode === 'rep') {
            displayAbsentees = absentees.filter(a => a.party === 'rep');
        } else if (absenteeFilterMode === 'dem') {
            displayAbsentees = absentees.filter(a => a.party === 'dem');
        }

        const htmlParts = [];
        displayAbsentees.forEach((absentee, absenteeIndex) => {

            const parsedName = parseAbsenteeRollName(absentee.name);
            const match = xmlDoc ? findBestMemberMatchByName(xmlDoc, parsedName.lastName || parsedName.rawName, absentee.state || parsedName.state) : null;
            const displayName = match ? match.fullName : (parsedName.rawName || 'Unknown');
            const nd = match ? normalizeDistrict(match.district) : '';
            const displayState = match ? (nd ? `${match.state}-${nd}` : match.state) : absentee.state;
            const photoUrl = match && match.bioguideId ? buildBioguidePhotoUrl(match.bioguideId) : '';
            const partyClass = absentee.party === 'rep' ? 'republican' : absentee.party === 'dem' ? 'democrat' : 'independent';
            const casualtyStatus = getCasualtyStatus(match);

            htmlParts.push(`
            <div class="absentee-member ${absentee.party}" data-absentee-index="${absenteeIndex}">
                <div class="absentee-photo-wrap">
                    <div class="absentee-photo-placeholder">${MEMBER_PHOTO_PLACEHOLDER}</div>
                    ${photoUrl ? `<img class="absentee-photo" src="${photoUrl}" alt="${displayName}" onload="this.style.opacity='1';" onerror="this.style.display='none';" />` : ''}
                </div>
                <div class="absentee-meta">
                    <span class="absentee-party-tag ${partyClass}">${absentee.party === 'rep' ? 'R' : absentee.party === 'dem' ? 'D' : 'I'}</span>
                    <span class="absentee-name">${displayName}</span>
                    <span class="absentee-state">${displayState}</span>
                    ${casualtyStatus ? `<span class="absentee-casualty-status">${casualtyStatus}</span>` : ''}
                </div>
            </div>`);
        });
        setIfChanged(elements.absenteeList, htmlParts.join(''));
    } else {
        setIfChanged(elements.absenteeList, '<div class="absentee-member">ALL MEMBERS VOTED</div>');
    }
}

// Update API Status Indicator
function updateApiStatus() {
    // API status indicator removed
}

// Update UI
function updateUI() {
    updateApiStatus();
    updateFloorDisplay();
    updatePartyBreakdown();
    updateThresholdAnalysis();
    updateQuorumStatus();
    updateAbsenteeTracking();
    updateFloorGrid();
    updateLastUpdate();
    fetchBillsThisWeek();
    updateTodayDate();
    updateFooterTimestamp();
    // Ensure session status is updated after other logic
    setTimeout(() => {
        fetchVotingDays();
    }, 1000);
}

function updateVoteTypeTag(question) {
    const tag = document.getElementById('vote-type-tag');
    if (!tag) return;
    if (!question) { tag.textContent = ''; tag.className = 'vote-type-tag'; return; }
    let label, cls;
    if      (/suspend/i.test(question))                               { label = 'SUSPENSION · 2/3'; cls = 'amber'; }
    else if (/on passage/i.test(question))                            { label = 'PASSAGE';           cls = 'green'; }
    else if (/motion to recommit/i.test(question))                    { label = 'RECOMMIT';          cls = 'red';   }
    else if (/motion to table/i.test(question))                       { label = 'TABLE';             cls = 'muted'; }
    else if (/previous question/i.test(question))                     { label = 'PREV QUESTION';     cls = 'muted'; }
    else if (/conference report/i.test(question))                     { label = 'CONFERENCE';        cls = 'blue';  }
    else if (/on (the |agreeing to the )?amendment/i.test(question))  { label = 'AMENDMENT';         cls = 'blue';  }
    else if (/on agreeing/i.test(question))                           { label = 'RESOLUTION';        cls = 'blue';  }
    else if (/quorum/i.test(question))                                { label = 'QUORUM CALL';       cls = 'muted'; }
    else                                                               { label = '';                  cls = '';      }
    tag.textContent = label;
    tag.className = 'vote-type-tag' + (cls ? ` vtt-${cls}` : '');
}

function updateThresholdAnalysis() {
    if (!state.data || !state.data.vote) return;

    const vote = state.data.vote;
    const totalCast = vote.yeas + vote.nays + vote.present;
    const wholeNumber = totalCast + (vote.not_voting || 0);
    const votesRemaining = Math.max(wholeNumber - totalCast, 0);
    const yeasNeeded = Math.max(vote.votesNeeded - vote.yeas, 0);
    const maxPossibleYeas = vote.yeas + votesRemaining;
    const naysToBlock = vote.yeas >= vote.votesNeeded
        ? 0
        : Math.max(maxPossibleYeas - vote.votesNeeded + 1, 0);

    let stateText = 'IN PLAY';
    let stateClass = 'in-play';

    if (vote.yeas >= vote.votesNeeded) {
        stateText = 'PASS LOCKED';
        stateClass = 'locked-pass';
    } else if (maxPossibleYeas < vote.votesNeeded) {
        stateText = 'FAIL LOCKED';
        stateClass = 'locked-fail';
    }

    elements.thresholdState.classList.remove('in-play', 'locked-pass', 'locked-fail');
    elements.thresholdState.classList.add(stateClass);
    elements.thresholdState.textContent = stateText;
    elements.votesRemaining.textContent = votesRemaining;
    elements.yeasNeeded.textContent = yeasNeeded;
    elements.naysToBlock.textContent = naysToBlock;
    elements.maxPossibleYeas.textContent = maxPossibleYeas;

    // Position threshold marker hairline on the progress bar
    const marker = document.getElementById('vote-threshold-marker');
    if (marker) {
        if (wholeNumber > 0) {
            const pct = Math.min((vote.votesNeeded / wholeNumber) * 100, 99);
            marker.style.left = `${pct.toFixed(2)}%`;
            marker.style.display = '';
        } else {
            marker.style.display = 'none';
        }
    }
}

function updateFloorGrid() {
    if (!state.data?.vote) return;

    const vote = state.data.vote;
    const seats = Array.from(elements.floorArch.querySelectorAll('.seat'));

    // Sort each party's seats by row then position (inner → outer, aisle → edge)
    const sortSeats = arr => arr.sort((a, b) => {
        const dr = Number(a.dataset.row) - Number(b.dataset.row);
        return dr !== 0 ? dr : Number(a.dataset.seatOrder) - Number(b.dataset.seatOrder);
    });

    const repSeats = sortSeats(seats.filter(s => s.dataset.party === 'republican'));
    const demSeats = sortSeats(seats.filter(s => s.dataset.party === 'democrat'));

    seats.forEach(s => s.classList.remove('yea', 'nay', 'present', 'not-voting', 'vacant'));

    // Mark vacant seats: last N seats on each side, proportional to layout size
    const vacCount = vacancies.length;
    if (vacCount > 0) {
        const totalGridSeats = repSeats.length + demSeats.length;
        const vacRep = Math.round(vacCount * repSeats.length / totalGridSeats);
        const vacDem = vacCount - vacRep;
        if (vacRep > 0) repSeats.slice(-vacRep).forEach(s => s.classList.add('vacant'));
        if (vacDem > 0) demSeats.slice(-vacDem).forEach(s => s.classList.add('vacant'));
    }

    // Use per-party breakdown when available, fall back to proportional distribution
    if (vote.rep && vote.dem && (vote.rep.yeas + vote.rep.nays + vote.rep.present + vote.dem.yeas + vote.dem.nays + vote.dem.present) > 0) {
        fillPartySeats(repSeats, [
            { status: 'yea',     count: vote.rep.yeas },
            { status: 'nay',     count: vote.rep.nays },
            { status: 'present', count: vote.rep.present },
        ]);
        fillPartySeats(demSeats, [
            { status: 'yea',     count: vote.dem.yeas },
            { status: 'nay',     count: vote.dem.nays },
            { status: 'present', count: vote.dem.present },
        ]);
    } else {
        // No party breakdown — distribute totals proportionally across both sides
        const total = vote.yeas + vote.nays + vote.present;
        if (total === 0) return;
        const allSeats = [...repSeats, ...demSeats];
        fillPartySeats(allSeats, [
            { status: 'yea',     count: vote.yeas },
            { status: 'nay',     count: vote.nays },
            { status: 'present', count: vote.present },
        ]);
    }
}

function fillPartySeats(seats, statuses) {
    let cursor = 0;
    statuses.forEach(({ status, count }) => {
        const n = Math.max(parseInt(count) || 0, 0);
        const end = Math.min(cursor + n, seats.length);
        for (let i = cursor; i < end; i++) seats[i].classList.add(status);
        cursor = end;
    });
}

// Set the quorum bar fill. The fill is a left-anchored rounded pill whose width
// is numerator/denominator; its gradient is sized to the full track width so the
// gradient appears "revealed" by the fill rather than compressed (5 of 435 votes
// shows just the red→orange start, with a rounded right cap).
function setQuorumFill(numerator, denominator) {
    const el = elements.quorumFill;
    if (!el) return;
    const frac = denominator > 0 ? Math.min(Math.max(numerator / denominator, 0), 1) : 0;
    el.style.width = `${frac * 100}%`;
    // Gradient image width = track width = fill width / frac → background-size %
    el.style.backgroundSize = frac > 0 ? `${100 / frac}% 100%` : '100% 100%';
}

// Update Quorum Status
async function updateQuorumStatus() {
    // If a live vote is in progress, use DomeWatch data directly — the Clerk's XML file
    // is often unavailable (404) while a vote is open, and the index is one roll behind.
    const isLiveVote = floorData.currentStatus?.value === 'vote' ||
                       floorData.currentStatus?.value === 'voting';
    if (isLiveVote && floorData.rollCall?.number && floorData.voteCounts) {
        const t          = floorData.voteCounts.totals || {};
        const iv         = v => Math.max(parseInt(v) || 0, 0);
        const yeas       = iv(t.yeas);
        const nays       = iv(t.nays);
        const present    = iv(t.present);
        const notVoting  = iv(t.not_voting);
        const totalVoted = yeas + nays + present;
        const wholeNumber = totalVoted + notVoting;
        const quorumRequired = Math.ceil(wholeNumber / 2);
        const quorumMet  = totalVoted >= quorumRequired;
        const rollNumber = floorData.rollCall.number;

        elements.membersPresent.textContent = totalVoted;
        if (elements.quorumSessionStatus) elements.quorumSessionStatus.textContent = wholeNumber;
        const quorumRequiredEl = document.querySelector('.quorum-metrics .metric-item:nth-child(2) .metric-value');
        if (quorumRequiredEl) quorumRequiredEl.textContent = quorumRequired;
        const quorumLabels = document.querySelector('.quorum-labels');
        if (quorumLabels) quorumLabels.innerHTML = `<span>0</span><span>${quorumRequired}</span><span>${wholeNumber}</span>`;

        if (!elements.quorumIndicator) return;
        const indicatorDot  = elements.quorumIndicator.querySelector('.indicator-dot');
        const indicatorText = elements.quorumIndicator.querySelector('.indicator-text');
        indicatorDot.classList.remove('quorum-not-met');
        if (quorumMet) {
            indicatorDot.classList.add('quorum-met');
            indicatorText.textContent = `ROLL CALL ${rollNumber} • Quorum Met`;
        } else if (totalVoted > 0) {
            indicatorDot.classList.add('quorum-not-met');
            indicatorText.textContent = `ROLL CALL ${rollNumber} • Quorum Not Met`;
        } else {
            indicatorText.textContent = 'INACTIVE';
        }
        setQuorumFill(totalVoted, wholeNumber);
        document.getElementById('quorum-progress-bar')?.setAttribute('aria-valuenow', totalVoted);
        return;
    }

    try {
        // Not in a live vote — fetch the most recent completed roll from the Clerk index
        const indexResponse = await fetch(CONGRESS_INDEX_CONFIG.workerUrl);
        if (!indexResponse.ok) throw new Error(`HTTP ${indexResponse.status}`);
        const jsonData = await indexResponse.json();

        const rollNumber = jsonData.latestRollNumber;
        const rollResponse = await fetch(`${CONGRESS_INDEX_CONFIG.workerUrl}/roll/${rollNumber}`);
        const rollXml = await rollResponse.text();
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(rollXml, 'text/xml');
        
        // Count total legislators and voting members from Clerk data
        const recordedVotes = xmlDoc.querySelectorAll('recorded-vote');
        const totalLegislators = recordedVotes.length;
        
        let yeas = 0, nays = 0, present = 0;
        recordedVotes.forEach(recordedVote => {
            const vote = recordedVote.querySelector('vote')?.textContent;
            if (vote === 'Yea') yeas++;
            else if (vote === 'Nay') nays++;
            else if (vote === 'Present') present++;
        });
        
        const totalVoted = yeas + nays + present;
        const quorumRequired = Math.ceil(totalLegislators / 2); // Majority of total legislators
        const quorumMet = totalVoted >= quorumRequired;
        
        // Update metrics
        elements.membersPresent.textContent = totalVoted;
        
        // Update quorum required display
        const quorumRequiredElement = document.querySelector('.quorum-metrics .metric-item:nth-child(2) .metric-value');
        if (quorumRequiredElement) {
            quorumRequiredElement.textContent = quorumRequired;
        }
        
        // Update quorum labels - show 0-215-430 scale
        const quorumLabels = document.querySelector('.quorum-labels');
        if (quorumLabels) {
            quorumLabels.innerHTML = `<span>0</span><span>${quorumRequired}</span><span>${totalLegislators}</span>`;
        }
        
        // Update session status metric to show Whole Number
        if (elements.quorumSessionStatus) {
            elements.quorumSessionStatus.textContent = totalLegislators;
        }
        
        // Update indicator
        const indicatorDot = elements.quorumIndicator.querySelector('.indicator-dot');
        const indicatorText = elements.quorumIndicator.querySelector('.indicator-text');
        
        indicatorDot.classList.remove('quorum-not-met');
        
        if (quorumMet) {
            indicatorDot.classList.add('quorum-met');
            indicatorText.textContent = `ROLL CALL ${rollNumber} • Quorum Met`;
        } else if (totalVoted > 0) {
            indicatorDot.classList.add('quorum-not-met');
            indicatorText.textContent = `ROLL CALL ${rollNumber} • Quorum Not Met`;
        } else {
            indicatorText.textContent = 'INACTIVE';
        }
        
        // Fill reveals the gradient left-to-right by the vote fraction.
        setQuorumFill(totalVoted, totalLegislators);
        document.getElementById('quorum-progress-bar')?.setAttribute('aria-valuenow', totalVoted);
        
    } catch (error) {
        console.error('Error updating quorum status:', error);
        // Fallback to original logic if Clerk data fails
        if (!state.data || !state.data.vote) return;
        
        const vote = state.data.vote;
        const totalVoted = vote.yeas + vote.nays + vote.present;
        const quorumRequired = getVotesNeeded(false);
        const quorumMet = totalVoted >= quorumRequired;
        
        elements.membersPresent.textContent = totalVoted;
        
        const indicatorDot = elements.quorumIndicator.querySelector('.indicator-dot');
        const indicatorText = elements.quorumIndicator.querySelector('.indicator-text');
        
        indicatorDot.classList.remove('quorum-not-met');
        
        if (quorumMet) {
            indicatorDot.classList.add('quorum-met');
            indicatorText.textContent = `ROLL CALL ${vote.rollCall} • Quorum Met`;
        } else if (totalVoted > 0) {
            indicatorDot.classList.add('quorum-not-met');
            indicatorText.textContent = `ROLL CALL ${vote.rollCall} • Quorum Not Met`;
        } else {
            indicatorText.textContent = 'INACTIVE';
        }
        
        // Fallback path: scale against the full chamber (435) so the fill,
        // gradient, and 0/218/435 labels all stay aligned.
        setQuorumFill(totalVoted, 435);
        document.getElementById('quorum-progress-bar')?.setAttribute('aria-valuenow', totalVoted);
    }
}

// Update Vote Display


// Update Last Update Time
function updateLastUpdate() {
    if (state.lastUpdate && elements.lastUpdate) {
        elements.lastUpdate.textContent = `Last updated: ${state.lastUpdate.toLocaleTimeString()}`;
    }
}

// ── HLS PiP — always-on live feed, click to expand ───────────────────────────
(function initYouTubePip() {
    const pip         = document.getElementById('youtube-pip');
    const pipVideo    = document.getElementById('player-pip');
    const backdrop    = document.getElementById('pip-backdrop');
    const pipOverlay  = pip?.querySelector('.youtube-pip-overlay');
    const closeBtn    = document.getElementById('pip-close-btn');
    if (!pip || !pipVideo) return;

    const pipSnapshot = document.getElementById('player-pip-snapshot');
    const pipLoading  = document.getElementById('pip-loading');
    let pipHls          = null;
    let pipSnapshotHls  = null; // short-lived HLS instance used only to grab the last frame of a finished VOD
    let pipWaitTimer    = null;
    let expanded        = false;
    let edgeKeeper      = null; // interval pinning live playback to the edge
    let pipFrozen       = false; // true once a last-frame snapshot has been captured
    // Bumped on every loadPip(). Snapshot/freeze callbacks capture the value at
    // schedule time and bail if it changed — so an in-flight last-frame grab can
    // never pause/hide a newer live stream that started in the meantime.
    let pipGen          = 0;

    // Enable embedded CEA-608/708 captions on the PiP video. The House feed
    // carries multiple tracks (English CC1 + Spanish), so prefer English and
    // explicitly disable the others — otherwise the first track (sometimes
    // Spanish) would show. Tracks may appear before or after load.
    function isEnglishTrack(t) {
        const lang = (t.language || '').toLowerCase();
        const label = (t.label || '').toLowerCase();
        if (lang) return lang.startsWith('en');
        // No language tag (common for CEA-608): fall back to label heuristics.
        // CC1 is the primary English service; treat unlabeled as English too.
        return /english|cc1|^cc$|primary/.test(label) || label === '';
    }
    // Custom caption rendering: we set the chosen track to 'hidden' (cues stay
    // active and fire cuechange, but the browser does NOT draw them), then paint
    // the active cues into our own overlay. This gives full control over size
    // (scales to the PiP via cq units) and position (always bottom-center),
    // instead of the native 608 renderer's fixed sizing/positioning.
    let pipCaptionTrack = null;
    let pipCaptionOverlay = null;
    function captionOverlay() {
        if (pipCaptionOverlay && pipCaptionOverlay.isConnected) return pipCaptionOverlay;
        const host = pipVideo.parentElement; // .youtube-pip-video
        let el = host?.querySelector('.pip-caption-overlay');
        if (!el && host) {
            el = document.createElement('div');
            el.className = 'pip-caption-overlay';
            host.appendChild(el);
        }
        pipCaptionOverlay = el;
        return el;
    }
    let pipCaptionText = '';       // currently displayed text (for dedupe)
    let pipCaptionClearTimer = null;
    // True pop-on: hold the last COMPLETE two-line block on screen, and only swap
    // to the next block once both of its lines are finished — so the caption never
    // scrolls line-by-line and is always a stable two-line frame (one pair behind
    // the audio, like TV pop-on).
    let capDisp = ['', '']; // the held block currently shown
    let capPend = ['', '']; // the next block being built (top, then bottom)
    let capPendSlot = 0;    // which pending line the building line fills
    let capBuilding = '';   // the line currently being spoken (roll-up bottom)

    function commitCaption(el, text) {
        if (text === pipCaptionText) return;
        if (window.__capDebug) console.log('[cap] →', JSON.stringify(text));
        pipCaptionText = text;
        el.textContent = text;
        el.classList.toggle('has-text', !!text);
    }

    let captionsEnabled = true; // CC button only HIDES the overlay (via the
    // .captions-off class); the pop-on frame keeps building in the background so
    // re-enabling shows the current caption immediately.
    function renderActiveCues() {
        const el = captionOverlay();
        if (!el) return;
        const cues = pipCaptionTrack && pipCaptionTrack.activeCues ? [...pipCaptionTrack.activeCues] : [];
        // Order top→bottom by reading order. Roll-up cues share a startTime and
        // hls.js hands them newest-first, so reverse the array index on ties.
        const indexed = cues.map((c, idx) => ({ c, idx }));
        indexed.sort((a, b) => (a.c.startTime - b.c.startTime) || (b.idx - a.idx));
        const lines = [];
        for (const { c } of indexed) {
            const t = (c.text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (t && t !== lines[lines.length - 1]) lines.push(t);
        }
        const building = lines[lines.length - 1] || ''; // bottom = newest = in-progress line

        if (!building) {
            // The cue stream briefly empties between speech segments (~1-3s). Keep
            // the current block on screen and only clear after a genuinely long
            // gap, so normal pauses don't blank the captions (which then skipped
            // content while the pop-on rebuilt).
            if (pipCaptionText && !pipCaptionClearTimer) {
                pipCaptionClearTimer = setTimeout(() => {
                    pipCaptionClearTimer = null;
                    capDisp = ['', '']; capPend = ['', '']; capPendSlot = 0; capBuilding = '';
                    commitCaption(el, '');
                }, 6000);
            }
            return;
        }
        if (pipCaptionClearTimer) { clearTimeout(pipCaptionClearTimer); pipCaptionClearTimer = null; }

        if (building === capBuilding) {
            return; // no change
        }
        if (!capBuilding || building.startsWith(capBuilding)) {
            // First line of a block, or the same line still growing word-by-word.
            capBuilding = building;
            capPend[capPendSlot] = building;
        } else {
            // A new line started → the current pending line just finalized.
            if (capPendSlot === 0) {
                // Top line of the pending block is done; start filling the bottom.
                capPendSlot = 1;
                capPend[1] = building;
            } else {
                // Bottom line done → the pending PAIR is complete. Pop it onto the
                // display (both lines swap at once), and begin the next block.
                capDisp = [capPend[0], capPend[1]];
                capPend = [building, ''];
                capPendSlot = 0;
            }
            capBuilding = building;
        }
        // Only the held, complete block is shown — the in-progress pending block
        // is not displayed until it finishes (true pop-on).
        commitCaption(el, capDisp.filter(Boolean).join('\n'));
    }
    let pipCaptionPoll = null;
    function enablePipCaptions() {
        const tracks = [...pipVideo.textTracks].filter(t => t.kind === 'captions' || t.kind === 'subtitles');
        if (!tracks.length) return false;
        const english = tracks.find(isEnglishTrack) || tracks[0];
        // 'hidden' (not 'showing') keeps cues active without native rendering.
        for (const t of tracks) t.mode = (t === english) ? 'hidden' : 'disabled';
        pipCaptionTrack = english;
        // Poll activeCues rather than relying on 'cuechange': Safari does NOT
        // reliably fire cuechange on hidden tracks, but it DOES keep activeCues
        // populated. renderActiveCues dedupes, so a 250ms poll is cheap and
        // repaints only when the caption text actually changes.
        if (!pipCaptionPoll) pipCaptionPoll = setInterval(renderActiveCues, 250);
        // Also listen for cuechange where it does fire (Chrome) for instant updates.
        english.removeEventListener('cuechange', renderActiveCues);
        english.addEventListener('cuechange', renderActiveCues);
        renderActiveCues();
        return true;
    }

    function hidePipLoading() { if (pipLoading) pipLoading.style.display = 'none'; }
    function resetPipLoading() { if (pipLoading) pipLoading.style.display = 'flex'; }

    // Grab the current video frame into pipSnapshot and switch to the still image.
    // `gen` is the loadPip generation this grab belongs to; if a newer stream has
    // loaded since it was scheduled, abort so we never freeze/hide a live video.
    function captureCurrentFrame(gen) {
        if (gen !== pipGen || pipFrozen || !pipSnapshot || !pipVideo.videoWidth) return;
        try {
            const c = document.createElement('canvas');
            c.width  = pipVideo.videoWidth;
            c.height = pipVideo.videoHeight;
            c.getContext('2d').drawImage(pipVideo, 0, 0, c.width, c.height);
            const dataUrl = c.toDataURL();
            if (!dataUrl || dataUrl === 'data:,') return;
            if (gen !== pipGen) return; // a live stream loaded during the draw — don't freeze it
            pipFrozen = true;
            pipSnapshot.src           = dataUrl;
            pipSnapshot.style.display = 'block';
            pipSnapshot.removeAttribute('hidden');
            pipVideo.style.display    = 'none';
        } catch {}
    }

    // Seek to the last buffered frame, play one frame to decode it, then freeze.
    // Bails if a newer stream loaded (gen mismatch); retry is capped (~6s).
    function freezePipAtEnd(gen, tries = 0) {
        if (gen !== pipGen || pipFrozen) return;
        const end = pipVideo.seekable.length ? pipVideo.seekable.end(pipVideo.seekable.length - 1) : NaN;
        if (!isFinite(end) || end <= 1) {
            if (tries < 20) setTimeout(() => freezePipAtEnd(gen, tries + 1), 300);
            return;
        }
        const onSeeked = () => {
            const tryGrab = () => {
                if (gen !== pipGen) return;
                if (pipVideo.videoWidth > 0) { pipVideo.pause(); captureCurrentFrame(gen); }
                else { requestAnimationFrame(tryGrab); }
            };
            pipVideo.play().then(() => requestAnimationFrame(tryGrab)).catch(() => requestAnimationFrame(tryGrab));
        };
        pipVideo.addEventListener('seeked', onSeeked, { once: true });
        pipVideo.currentTime = end - 0.3;
    }

    // Load a finished VOD URL, seek to the last second, and freeze on that frame.
    // Used when the page loads while the house is already adjourned.
    function loadPipSnapshot(url) {
        if (pipFrozen) return;
        const gen = pipGen; // tied to the current load; a live loadPip bumps pipGen and invalidates this
        if (pipSnapshotHls) { try { pipSnapshotHls.destroy(); } catch {} pipSnapshotHls = null; }
        if (window.Hls && Hls.isSupported()) {
            const hls = new Hls({ capLevelToPlayerSize: false, startLevel: 0 });
            pipSnapshotHls = hls;
            hls.loadSource(url);
            hls.attachMedia(pipVideo);
            pipVideo.muted = true;
            let grabbed = false;
            hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
                if (grabbed || gen !== pipGen) return;
                const dur = data.details?.totalduration;
                if (!isFinite(dur) || dur < 2) return;
                grabbed = true;
                const onSeeked = () => {
                    const tryGrab = () => {
                        if (gen !== pipGen) { try { hls.destroy(); } catch {} if (pipSnapshotHls === hls) pipSnapshotHls = null; return; }
                        if (pipVideo.videoWidth > 0) {
                            pipVideo.pause();
                            captureCurrentFrame(gen);
                            try { hls.destroy(); } catch {}
                            if (pipSnapshotHls === hls) pipSnapshotHls = null;
                        } else { requestAnimationFrame(tryGrab); }
                    };
                    pipVideo.play().then(() => requestAnimationFrame(tryGrab)).catch(() => {
                        try { hls.destroy(); } catch {}
                        if (pipSnapshotHls === hls) pipSnapshotHls = null;
                    });
                };
                pipVideo.addEventListener('seeked', onSeeked, { once: true });
                pipVideo.currentTime = dur - 1;
            });
            hls.on(Hls.Events.ERROR, (_, d) => {
                if (d.fatal) { try { hls.destroy(); } catch {} if (pipSnapshotHls === hls) pipSnapshotHls = null; }
            });
        } else if (pipVideo.canPlayType('application/vnd.apple.mpegurl')) {
            pipVideo.src = url;
            pipVideo.muted = true;
            pipVideo.addEventListener('loadedmetadata', () => {
                if (isFinite(pipVideo.duration) && pipVideo.duration > 2) pipVideo.currentTime = pipVideo.duration - 1;
            }, { once: true });
            pipVideo.addEventListener('seeked', () => freezePipAtEnd(gen), { once: true });
            pipVideo.load();
        }
    }

    // Audio is controlled explicitly by the mute button (below), NOT by
    // expanding/collapsing — so expand/collapse no longer touch muted state.
    function expand() {
        if (expanded) return;
        expanded = true;
        pip.classList.add('pip-expanded');
        if (backdrop) backdrop.classList.add('pip-backdrop-visible');
        if (pipOverlay) pipOverlay.style.pointerEvents = 'none';
    }

    function collapse() {
        if (!expanded) return;
        expanded = false;
        pip.classList.remove('pip-expanded');
        if (backdrop) backdrop.classList.remove('pip-backdrop-visible');
        if (pipOverlay) pipOverlay.style.pointerEvents = 'auto';
    }

    // Mute/unmute toggle
    const muteBtn = document.getElementById('pip-mute-btn');
    function syncMuteBtn() {
        if (!muteBtn) return;
        const unmuted = !pipVideo.muted;
        muteBtn.classList.toggle('is-unmuted', unmuted);
        muteBtn.setAttribute('aria-pressed', String(unmuted));
        muteBtn.setAttribute('aria-label', unmuted ? 'Mute' : 'Unmute');
        muteBtn.title = unmuted ? 'Mute' : 'Unmute';
    }
    if (muteBtn) {
        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            pipVideo.muted = !pipVideo.muted;
            if (!pipVideo.muted) pipVideo.play().catch(() => {});
            syncMuteBtn();
        });
        pipVideo.addEventListener('volumechange', syncMuteBtn);
        syncMuteBtn();
    }

    // CC toggle (closed captions on/off)
    const ccBtn = document.getElementById('pip-cc-btn');
    if (ccBtn) {
        ccBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            captionsEnabled = !captionsEnabled;
            ccBtn.classList.toggle('is-on', captionsEnabled);
            ccBtn.setAttribute('aria-pressed', String(captionsEnabled));
            // Just hide/show the overlay — captions keep building in the background.
            const ov = captionOverlay();
            if (ov) ov.classList.toggle('captions-off', !captionsEnabled);
        });
    }

    if (pipOverlay) pipOverlay.addEventListener('click', expand);
    if (backdrop) backdrop.addEventListener('click', collapse);
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); collapse(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded) collapse(); });

    // Keep live playback near the edge WITHOUT causing jitter. Frequent small
    // seeks (old: >8s drift every 5s) made the video stutter as it kept snapping
    // forward. Now we only correct a genuinely large fall-behind (>20s), checked
    // every 12s, and land a few seconds back from the edge so it settles instead
    // of immediately drifting past the threshold again.
    function startEdgeKeeper() {
        if (edgeKeeper) clearInterval(edgeKeeper);
        edgeKeeper = setInterval(() => {
            if (pipVideo.paused || pipVideo.seekable.length === 0) return;
            const edge = pipVideo.seekable.end(pipVideo.seekable.length - 1);
            if (isFinite(edge) && (edge - pipVideo.currentTime) > 20) {
                pipVideo.currentTime = edge - 4;
            }
        }, 12000);
    }

    // When the live stream ends, freeze on the last frame. Registered once on the
    // persistent video element; reads pipGen at fire time (the current stream's).
    pipVideo.addEventListener('ended', () => freezePipAtEnd(pipGen));

    // Load the live stream
    function loadPip(url) {
        pipFrozen = false;
        const gen = ++pipGen; // invalidates any in-flight snapshot/freeze from a prior load
        if (pipSnapshotHls) { try { pipSnapshotHls.destroy(); } catch {} pipSnapshotHls = null; }
        pipVideo.style.display = 'block';
        if (pipSnapshot) { pipSnapshot.style.display = 'none'; pipSnapshot.setAttribute('hidden', ''); }
        pipVideo.muted = true;
        if (window.Hls && Hls.isSupported()) {
            if (pipHls) { try { pipHls.destroy(); } catch {} pipHls = null; }
            pipHls = new Hls({
                maxBufferLength: 2, maxMaxBufferLength: 4,
                liveSyncDurationCount: 1, liveMaxLatencyDurationCount: 2,
                liveDurationInfinity: true,
                // Don't cap quality to the small PiP box — keep it sharp at any size.
                capLevelToPlayerSize: false,
                startLevel: -1,
            });
            pipHls.loadSource(url);
            pipHls.attachMedia(pipVideo);
            pipVideo.addEventListener('canplay', hidePipLoading, { once: true });
            pipHls.on(Hls.Events.MANIFEST_PARSED, () => {
                // Force the highest rendition regardless of the player's size.
                if (pipHls.levels && pipHls.levels.length) pipHls.nextLevel = pipHls.levels.length - 1;
                pipVideo.play().catch(() => {});
                startEdgeKeeper();
            });
            pipHls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, enablePipCaptions);
            pipHls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { hidePipLoading(); captureCurrentFrame(gen); } });
        } else if (pipVideo.canPlayType('application/vnd.apple.mpegurl')) {
            pipVideo.src = url;
            pipVideo.play().catch(() => {});
            pipVideo.addEventListener('canplay', hidePipLoading, { once: true });
            startEdgeKeeper();
        }
        // Captions: scan now, on new tracks, and poll for the first 20s.
        pipVideo.textTracks.addEventListener('addtrack', enablePipCaptions);
        let capTries = 0;
        const capPoll = setInterval(() => {
            if (enablePipCaptions() || ++capTries > 20) clearInterval(capPoll);
        }, 1000);
    }

    // Fetch stream and load; retry while the feed is still not live.
    // The timer callback clears its own guard before re-entering fetchAndLoad().
    function scheduleFetchAndLoad(delayMs = 5000) {
        if (pipWaitTimer !== null) clearTimeout(pipWaitTimer);
        pipWaitTimer = setTimeout(() => {
            pipWaitTimer = null;
            fetchAndLoad();
        }, delayMs);
    }

    function fetchAndLoad() {
        if (pipWaitTimer !== null) return;
        pipWaitTimer = -1;
        fetch('https://api.evanhollander.org/house-floor/api/hls-url')
            .then(r => r.json())
            .then(d => {
                pipWaitTimer = null;
                if (d?.url && d.isLive) {
                    loadPip(d.url);
                } else {
                    hidePipLoading();
                    if (d?.url && !pipFrozen) loadPipSnapshot(d.url);
                    scheduleFetchAndLoad();
                }
            })
            .catch(() => {
                pipWaitTimer = null;
                scheduleFetchAndLoad();
            });
    }

    // Always show PiP immediately
    pip.classList.add('pip-active');
    fetchAndLoad();
})();

// ── Hash routing for Build Vote Recs modal ───────────────────────────────────
// Open modal if URL already has the hash on load; handle back/forward navigation.
window.addEventListener('popstate', () => {
    if (location.hash === '#build-vote-recs') {
        openVoteRecsModal();
    } else {
        closeVoteRecsModal();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    if (location.hash === '#build-vote-recs') openVoteRecsModal();
});

// Start the application
document.addEventListener('DOMContentLoaded', init);
