// Dome Watch - Single Vote Tracker

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
    const timeString = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    if (elements.footerUpdated) {
        elements.footerUpdated.textContent = `Last updated: ${timeString}`;
    }
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
    
    // Update missing members source link
    const absenteeSource = document.querySelector('.absentee-source a');
    if (absenteeSource) {
        absenteeSource.href = clerkUrl;
    }
    
    // Update quorum source link
    const quorumSource = document.querySelector('.quorum-source a');
    if (quorumSource) {
        quorumSource.href = clerkUrl;
    }
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
        
        console.log('Today:', today.toDateString());
        console.log('Today event found:', todayEvent);
        console.log('All events:', events);
        
        if (todayEvent) {
            // Determine if it's a fly-in day
            const isFlyIn = checkIfFlyInDay(today, events);
            
            console.log('Is fly-in day:', isFlyIn);
            console.log('Event summary:', todayEvent.summary);
            
            if (isFlyIn) {
                todayStatus = 'fly-in';
            } else if (todayEvent.summary.toLowerCase().includes('fly-in')) {
                todayStatus = 'fly-in';
            } else if (/pro[- ]forma/i.test(todayEvent.summary)) {
                todayStatus = 'pro-forma';
            } else if (todayEvent.summary.toLowerCase().includes('added')) {
                todayStatus = 'added-votes';
            } else {
                todayStatus = 'in-session';
            }
        } else {
            todayStatus = 'no-session';
        }
        
        console.log('Final todayStatus:', todayStatus);
        
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
                if (/^(voting day|vote day)$/.test(summary)) {
                    type = 'vote-day';
                } else if (/fly.?in/.test(summary)) {
                    type = 'fly-in';
                } else if (/fly.?out/.test(summary)) {
                    type = 'fly-out';
                } else if (/^(votes? added|added votes?|added votes? day|added-votes|additional votes?)$/.test(summary)) {
                    type = 'added';
                } else if (/^(votes? cancelled|cancelled votes?|canceled votes?|canceled vote day|cancelled vote day)$/.test(summary)) {
                    type = 'cancelled';
                }
                return {
                    ...item,
                    type
                };
            })
            .filter(item => item.type);
        renderVotingDaysCalendar();

        updateSessionStatus();
        
    } catch (error) {
        console.error('Error fetching voting days:', error);
        updateSessionStatus('error');
    }
}

function renderVotingDaysCalendar() {
    const prevEl = document.getElementById('voting-calendar-prev');
    const currentEl = document.getElementById('voting-calendar-current');
    const nextEl = document.getElementById('voting-calendar-next');
    const timeEl = document.getElementById('voting-calendar-time');

    if (!prevEl || !currentEl || !nextEl || !window.FullCalendar || !window.FullCalendar.Calendar) return;



    const now = new Date();
    const baseMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthDates = [
        new Date(baseMonth.getFullYear(), baseMonth.getMonth() - 1, 1),
        new Date(baseMonth.getFullYear(), baseMonth.getMonth(), 1),
        new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 1)
    ];

    const events = votingCalendarData.map((item, index) => {
        const type = item.type || 'vote-day';
        const indicatorRank = { 'fly-in': 0, 'fly-out': 1, 'added': 2, 'vote-day': 3, 'cancelled': 4 }[type] ?? 5;
        return {
            start: item.date,
            title: '',
            id: `${item.date}-${index}-${type}`,
            extendedProps: {
                type,
                label: item.summary || 'Voting Day',
                indicatorRank
            }
        };
    });
    const eventMap = new Map();
    events.forEach((event) => {
        const list = eventMap.get(event.start) || [];
        list.push(event.extendedProps);
        eventMap.set(event.start, list);
    });
    const indicatorTypes = new Set(['vote-day', 'fly-in', 'fly-out', 'added', 'cancelled']);

    const applyHarnessCorners = () => {
        [prevEl, currentEl, nextEl].forEach(calEl => {
            if (!calEl) return;
            calEl.querySelectorAll('.fc-view-harness').forEach(h => {
                h.style.setProperty('border', '1px solid #30363d', 'important');
                h.style.setProperty('border-radius', '8px', 'important');
            });
        });
    };

    const syncCalendarSizes = () => {
        const monthEls = [prevEl, currentEl, nextEl];
        monthEls.forEach((monthEl) => {
            if (!monthEl) return;
            if (monthEl._calendar) {
                monthEl.style.height = 'auto';
                monthEl._calendar.setOption('height', 'auto');
            }
        });
        // setOption triggers an internal re-render; apply corner fix after it settles
        setTimeout(applyHarnessCorners, 50);
    };

    const renderCalendar = (el, monthDate) => {
        if (el._calendar) {
            el._calendar.destroy();
        }

        const calendar = new FullCalendar.Calendar(el, {
            initialView: 'dayGridMonth',
            initialDate: monthDate,
            headerToolbar: { left: '', center: 'title', right: '' },
            fixedWeekCount: false,
            showNonCurrentDates: false,
            height: 'auto',
            selectable: false,
            editable: false,
            navLinks: false,
            datesSet: applyHarnessCorners,
            dayMaxEvents: false,
            dayMaxEventRows: false,
            moreLinkClick: false,
            events,
            eventDidMount: (arg) => {
                const type = arg.event.extendedProps.type || 'vote-day';
                const label = arg.event.extendedProps.label || 'Voting Day';
                arg.el.setAttribute('title', label);
                arg.el.classList.add(`calendar-event-${type}`);
                arg.el.style.background = 'transparent';
                arg.el.style.border = 'none';
                arg.el.style.padding = '0';
                arg.el.style.margin = '0';
            },
            dayCellDidMount: (arg) => {
                const dateStr = arg.dateStr || arg.date.toISOString().slice(0, 10);
                const frame = arg.el.querySelector('.fc-daygrid-day-frame');
                const header = arg.el.querySelector('.fc-daygrid-day-top');
                const number = arg.el.querySelector('.fc-daygrid-day-number');

                // Override FullCalendar's white cell background
                arg.el.style.setProperty('background', 'transparent', 'important');

                if (frame) {
                    frame.style.aspectRatio = '1 / 1';
                    frame.style.position = 'relative';
                }
                if (header) {
                    header.style.position = 'relative';
                    header.style.zIndex = '1';
                }
                const isToday = arg.el.classList.contains('fc-day-today');
                if (number) {
                    number.style.setProperty('color', '#8b949e', 'important');
                    number.style.fontSize = '7px';
                    number.style.fontWeight = '600';
                    number.style.opacity = '1';
                    number.style.position = 'absolute';
                    number.style.top = '1px';
                    number.style.right = '2px';
                    number.style.zIndex = '2';
                    number.style.textShadow = 'none';
                    number.style.lineHeight = '1';
                    // padding so text never touches the circle edge
                    number.style.padding = '2px 2px';

                    // Today: circle grows around the padded number, not the other way around
                    if (isToday) {
                        number.style.setProperty('color', '#ffffff', 'important');
                        number.style.fontWeight = '800';
                        number.style.display = 'inline-flex';
                        number.style.alignItems = 'center';
                        number.style.justifyContent = 'center';
                        number.style.borderRadius = '50%';
                        number.style.background = 'rgba(255,255,255,0.15)';
                        number.style.border = '1px solid rgba(255,255,255,0.35)';
                        number.style.boxSizing = 'border-box';
                        number.style.minWidth = '14px';
                        number.style.minHeight = '14px';
                    }
                }

                if (arg.isOther) return;

                const matches = eventMap.get(dateStr) || [];
                const filtered = matches
                    .filter(m => indicatorTypes.has(m.type))
                    .sort((a, b) => (a.indicatorRank ?? 9) - (b.indicatorRank ?? 9));

                if (!filtered.length) {
                    arg.el.addEventListener('mouseenter', () =>
                        arg.el.style.setProperty('background', 'rgba(255,255,255,0.05)', 'important'));
                    arg.el.addEventListener('mouseleave', () =>
                        arg.el.style.setProperty('background', 'transparent', 'important'));
                    return;
                }

                const VOTE_COLORS = {
                    'fly-in':    { base: 'rgba(63,185,80,0.16)',   hover: 'rgba(63,185,80,0.28)',   label: '#86efac', num: '#4ade80' },
                    'fly-out':   { base: 'rgba(63,185,80,0.16)',   hover: 'rgba(63,185,80,0.28)',   label: '#86efac', num: '#4ade80' },
                    'vote-day':  { base: 'rgba(63,185,80,0.16)',   hover: 'rgba(63,185,80,0.28)',   label: '#86efac', num: '#4ade80' },
                    'added':     { base: 'rgba(210,153,34,0.16)',  hover: 'rgba(210,153,34,0.28)',  label: '#fcd34d', num: '#fbbf24' },
                    'cancelled': { base: 'rgba(139,148,158,0.10)', hover: 'rgba(139,148,158,0.20)', label: '#6e7681', num: '#6e7681' },
                };

                const typesPresent = new Set(filtered.map(m => m.type));
                const tipText  = filtered.map(m => m.label).join(' · ') || 'Voting Day';
                // Color priority: added (amber) > fly-in/fly-out/vote-day (green) > cancelled (grey)
                const colorType = typesPresent.has('added') ? 'added'
                                : typesPresent.has('cancelled') && typesPresent.size === 1 ? 'cancelled'
                                : filtered[0]?.type || 'vote-day';
                const voteType = filtered[0]?.type || 'vote-day';
                const c = VOTE_COLORS[colorType] || VOTE_COLORS['vote-day'];

                arg.el.dataset.voteType = voteType;
                arg.el.style.setProperty('background', c.base, 'important');
                if (number) number.style.setProperty('color', c.num, 'important');

                arg.el.addEventListener('mouseenter', () =>
                    arg.el.style.setProperty('background', c.hover, 'important'));
                arg.el.addEventListener('mouseleave', () =>
                    arg.el.style.setProperty('background', c.base, 'important'));

                // Build stacked label lines
                const AMBER = '#fcd34d';
                const GREEN = '#86efac';
                const GREY  = '#6e7681';
                const labelLines = [];
                if (typesPresent.has('fly-in'))  labelLines.push({ text: 'FLY IN',  color: c.label, strike: false });
                if (typesPresent.has('fly-out')) labelLines.push({ text: 'FLY OUT', color: c.label, strike: false });
                const hasVote       = typesPresent.has('vote-day') || typesPresent.has('added');
                const onlyCancelled = typesPresent.has('cancelled') && !hasVote && !typesPresent.has('fly-in') && !typesPresent.has('fly-out');
                if (hasVote)        labelLines.push({ text: typesPresent.has('added') ? 'VOTES+' : 'VOTES', color: c.label, strike: false });
                if (onlyCancelled)  labelLines.push({ text: 'VOTES', color: GREY, strike: true });

                if (!frame || !labelLines.length) return;

                let container = frame.querySelector('.calendar-event-label');
                if (!container) {
                    container = document.createElement('div');
                    container.className = 'calendar-event-label';
                    frame.appendChild(container);
                }
                container.innerHTML = '';
                container.title = tipText;
                container.dataset.type = voteType;
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.alignItems = 'center';
                container.style.gap = '1px';

                for (const line of labelLines) {
                    const span = document.createElement('span');
                    span.textContent = line.text;
                    span.style.color = line.color;
                    span.style.fontSize = '5.5px';
                    span.style.fontWeight = '800';
                    span.style.lineHeight = '1';
                    span.style.letterSpacing = '0.5px';
                    span.style.fontFamily = 'var(--font-mono)';
                    if (line.strike) span.style.textDecoration = 'line-through';
                    container.appendChild(span);
                }
            },
            dayHeaderDidMount: (arg) => {
                arg.el.style.background = '#1f2937';
                arg.el.style.color = '#ffffff';
                arg.el.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                arg.el.style.padding = '0';
                const label = arg.el.querySelector('.fc-col-header-cell-cushion');
                if (label) {
                    label.style.color = '#ffffff';
                    label.style.fontSize = '7px';
                    label.style.fontWeight = '700';
                    label.style.opacity = '1';
                }
            }
        });

        calendar.render();
        el._calendar = calendar;

        requestAnimationFrame(syncCalendarSizes);
    };

    renderCalendar(prevEl, monthDates[0]);
    renderCalendar(currentEl, monthDates[1]);
    renderCalendar(nextEl, monthDates[2]);

    if (!window.__votingCalendarResizeBound) {
        window.__votingCalendarResizeBound = true;
        window.addEventListener('resize', () => requestAnimationFrame(syncCalendarSizes));
    }

    requestAnimationFrame(syncCalendarSizes);
}

// Parse ICS content
function parseICS(icsText) {
    const events = [];
    const lines = icsText.split('\n');
    let currentEvent = {};
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (trimmedLine === 'BEGIN:VEVENT') {
            currentEvent = {};
        } else if (trimmedLine === 'END:VEVENT') {
            if (currentEvent.date && currentEvent.summary) {
                events.push({
                    date: currentEvent.date,
                    summary: currentEvent.summary,
                    description: currentEvent.description || ''
                });
            }
            currentEvent = {};
        } else if (trimmedLine.startsWith('DTSTART:')) {
            const dateStr = trimmedLine.substring(8);
            currentEvent.date = parseICSDate(dateStr);
        } else if (trimmedLine.startsWith('SUMMARY:')) {
            currentEvent.summary = trimmedLine.substring(8);
        } else if (trimmedLine.startsWith('DESCRIPTION:')) {
            currentEvent.description = trimmedLine.substring(12);
        }
    }
    
    return events;
}

// Parse ICS date format (YYYYMMDD)
function parseICSDate(dateStr) {
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1; // JS months are 0-indexed
    const day = parseInt(dateStr.substring(6, 8));
    return new Date(year, month, day);
}

// Check if today is a fly-in day (first voting day of the week)
function checkIfFlyInDay(today, events) {
    const todayDay = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - todayDay); // Start of week (Sunday)
    weekStart.setHours(0, 0, 0, 0);
    
    // Find all voting days this week
    const weekEvents = events.filter(event => {
        const eventDate = new Date(event.date);
        eventDate.setHours(0, 0, 0, 0);
        return eventDate >= weekStart && eventDate <= today;
    });
    
    // Sort by date
    weekEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Check if today is the first voting day of the week
    return weekEvents.length > 0 && 
           new Date(weekEvents[0].date).getTime() === today.getTime();
}

// Update Session Status Display
function updateSessionStatus(status = null) {
    if (!elements.sessionText) return;
    
    const sessionStatus = status || votingDaysData.currentSessionStatus;
    
    console.log('Updating session status to:', sessionStatus);
    console.log('Session text element:', elements.sessionText);
    
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
    
    console.log('Session status updated to:', elements.sessionText.textContent);
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

function rollLogEntry(rollCall, voteCounts) {
    const iv = v => Math.max(parseInt(v) || 0, 0);
    const t = (voteCounts?.totals) || {};
    const d = (voteCounts?.blue)   || {};
    const r = (voteCounts?.red)    || {};
    return {
        roll:      rollCall?.number ?? null,
        bill:      rollCall?.bill?.legisNum || rollCall?.bill?.title || null,
        question:  rollCall?.question || null,
        totals: {
            yeas:       iv(t.yeas),
            nays:       iv(t.nays),
            present:    iv(t.present),
            notVoting:  iv(t.not_voting),
        },
        dem: { yeas: iv(d.yeas), nays: iv(d.nays), present: iv(d.present) },
        rep: { yeas: iv(r.yeas), nays: iv(r.nays), present: iv(r.present) },
        updatedAt: new Date().toISOString(),
    };
}

// KV write debounce: at most one write per 60s per roll, plus one final write on roll change
let _rollLogDebounceTimer = null;
let _rollLogPendingEntry  = null;
const ROLL_LOG_DEBOUNCE_MS = 60_000;

function postRollLogEntry(entry, immediate = false) {
    if (!entry?.roll) return;
    // Always update in-memory log instantly
    const idx = rollLog.findIndex(e => e.roll === entry.roll);
    if (idx >= 0) rollLog[idx] = entry; else rollLog.push(entry);

    if (immediate) {
        // Flush any pending debounce and write now
        clearTimeout(_rollLogDebounceTimer);
        _rollLogDebounceTimer = null;
        _rollLogPendingEntry  = null;
        fetch('https://api.evanhollander.org/house-floor/api/roll-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
        }).catch(() => {});
        return;
    }

    // Debounced path — coalesce rapid SSE ticks into one write per minute
    _rollLogPendingEntry = entry;
    if (_rollLogDebounceTimer) return; // already scheduled
    _rollLogDebounceTimer = setTimeout(() => {
        _rollLogDebounceTimer = null;
        const e = _rollLogPendingEntry;
        _rollLogPendingEntry = null;
        if (!e) return;
        fetch('https://api.evanhollander.org/house-floor/api/roll-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(e),
        }).catch(() => {});
    }, ROLL_LOG_DEBOUNCE_MS);
}

async function loadRollLog() {
    try {
        const resp = await fetch('https://api.evanhollander.org/house-floor/api/roll-log');
        const data = await resp.json();
        if (Array.isArray(data.entries)) rollLog = data.entries;
    } catch {}
}

// Call whenever floorData.rollCall / floorData.voteCounts changes during a vote
function trackRollLog() {
    // Only log during an active vote — DomeWatch returns stale roll call data
    // even when the chamber is in recess, which would burn KV writes all day.
    const status = floorData.currentStatus?.value;
    if (status !== 'vote' && status !== 'voting') return;

    const roll = floorData.rollCall?.number;
    const counts = floorData.voteCounts;
    if (!roll || !counts) return;

    const rollChanged = rollLogCurrentRoll !== null && rollLogCurrentRoll !== roll;
    if (rollChanged) {
        // Previous roll is final — flush immediately so we don't lose last known counts
        const prev = rollLog.find(e => e.roll === rollLogCurrentRoll);
        if (prev) postRollLogEntry(prev, /* immediate */ true);
    }
    rollLogCurrentRoll = roll;
    postRollLogEntry(rollLogEntry(floorData.rollCall, counts)); // debounced
}
// ─────────────────────────────────────────────────────────────────────────────

// SSE streaming state
let sseConnection = null;
let isStreaming = false;
let lastSseTallyAt = 0;    // ms timestamp of last vote.tally received (for stale detection)
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
    const POLL_MS     = 10_000; // matches the floor REST poll interval

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
            if (val === 'vote' || val === 'voting') {
                floorStatusEl.innerHTML = badge('amber', 'VOTE IN PROGRESS');
            } else if (val === 'recess') {
                floorStatusEl.innerHTML = badge('red', 'recess');
            } else if (val) {
                floorStatusEl.innerHTML = badge('green', text);
            } else {
                floorStatusEl.textContent = '—';
            }
        }

        // Countdown to next REST poll
        const countdownEl = $('cd-next-poll');
        if (countdownEl) {
            if (!lastFloorPollAt) {
                countdownEl.textContent = '—';
            } else {
                const elapsed = Date.now() - lastFloorPollAt;
                const remaining = Math.max(0, Math.ceil((POLL_MS - elapsed) / 1000));
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

    voteTimer.openedAt = timerData.timestamp || null;
    if (!voteTimer.interval) {
        voteTimer.interval = setInterval(tickVoteTimer, 50);
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
    if (elements.totalVotes)   elements.totalVotes.textContent   = `Total Votes: ${(yeas + nays + present + notVoting).toLocaleString()}`;

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

    // Update floor grid with party breakdown (fast DOM, no network)
    const blue = counts.blue || {};
    const red  = counts.red  || {};
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
            console.log('SSE connection opened');
            const liveIndicator = document.querySelector('.live-indicator');
            if (liveIndicator) {
                liveIndicator.classList.add('live');
                liveIndicator.classList.remove('connecting');
            }
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
                lastSseTallyAt = Date.now(); // track liveness for stale watchdog
                const data = JSON.parse(event.data);
                const v = data.vote || {};
                floorData = {
                    ...floorData,
                    lastUpdated: new Date(),
                    currentStatus: { value: 'vote' },
                    rollCall: v.roll_call || floorData.rollCall,
                    voteCounts: v.counts || floorData.voteCounts,
                    timer: v.timer || floorData.timer,
                };
                syncVoteTimer(v.timer);
                trackRollLog();
                // Hot path: update count numbers immediately every tick
                updateVoteCountsDisplay(v.counts);
                // Slow path: full re-render throttled to 2s (floor grid etc.)
                scheduleFullRender();
            } catch (error) {
                console.error('Error parsing SSE vote.tally:', error);
            }
        });

        // connected: initial handshake — no data to process, just confirms stream is live
        eventSource.addEventListener('connected', (event) => {
            console.log('SSE connected event:', event.data);
            // Start pinging the DO every 45s so it can detect and evict zombie connections.
            try {
                const { clientId } = JSON.parse(event.data);
                if (clientId) {
                    const pingUrl = `https://api.evanhollander.org/house-floor/api/stream/votes/current?ping=${encodeURIComponent(clientId)}`;
                    const sendPing = () => fetch(pingUrl, { method: 'POST' }).catch(() => {});
                    sendPing();
                    const pingInterval = setInterval(sendPing, 45_000);
                    eventSource.addEventListener('error', () => clearInterval(pingInterval), { once: true });
                }
            } catch {}
        });

        // Fallback for any unnamed default messages
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('SSE message (unnamed):', data);
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
                    console.log('SSE disconnected, retrying...');
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
async function fetchFloorData(silent = false) {
    lastFloorPollAt = Date.now();
    try {
        // Show loading state only on explicit (non-background) fetches
        if (!silent && elements.voteTitle) {
            elements.voteTitle.textContent = 'FETCHING...';
        }
        
        // Use worker endpoint instead of direct API call
        const response = await fetch(DOMEWATCH_CONFIG.workerUrl);

        console.log('DomeWatch response:', {
            status: response.status,
            ok: response.ok,
            headers: Object.fromEntries(response.headers.entries())
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('DomeWatch payload:', data);
        
        if (data.error) {
            console.error('DomeWatch error:', data.error);
            throw new Error(data.error);
        }
        
        // Update floor data state
        floorData = {
            lastUpdated: new Date(),
            currentStatus: data.now,
            rollCall: data.roll_call,
            voteCounts: data.votes?.counts,
            timer: data.timer,
            timeline: data.timeline
        };

        // Clear the local vote countdown if we're no longer in a vote
        if (data.now?.value !== 'vote' && data.now?.value !== 'voting') {
            clearVoteTimer();
        }
        trackRollLog();

        // Update state with floor data for vote map
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
            console.log('Vote map state updated:', state.data);
        }
        
        // Update missing members
        updateAbsenteeTracking();

        // Quorum check — runs here (30s REST poll) not on every SSE tick
        updateQuorumStatus();

        // Update bills
        fetchBillsThisWeek();

        // Update vote map
        updateFloorGrid();

        // Update UI with new data
        updateFloorDisplay();
        
    } catch (error) {
        console.error('Fetch floor data failed:', error);
        
        // Update UI to show error state
        updateFloorDisplay('error');
    }
}

// Update Floor Display with DomeWatch Data
function updateFloorDisplay(status = null) {
    if (status === 'error') {
        // Show error state in vote display
        if (elements.voteTitle) elements.voteTitle.textContent = 'API ERROR';
        if (elements.voteId) elements.voteId.textContent = 'Unable to fetch data';
        return;
    }

    if (!floorData.currentStatus) return;

    
    // Update session status based on DomeWatch data
    const statusText = floorData.currentStatus.text || 'Unknown';
    const statusValue = floorData.currentStatus.value || 'unknown';
    
    // Auto-switch mode based on DomeWatch status.
    // Only switch INTO vote mode when SSE tallies are actively coming in — this prevents
    // stale DomeWatch REST data from locking the app in vote mode after a vote ends.
    // Note: REST API returns value "voting"; SSE handler sets value "vote" — handle both.
    const statusLower = (statusText + ' ' + statusValue).toLowerCase();
    const sseIsLive = lastSseTallyAt > 0 && (Date.now() - lastSseTallyAt) < 90_000;
    if ((statusLower.includes('vote') || statusLower.includes('voting')) && sseIsLive) {
        window.setMode('vote');
    } else if (statusLower.includes('debate')) {
        window.setMode('debate');
    } else if (statusLower.includes('adjourn') || statusLower.includes('recess')) {
        window.setMode('recess');
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
            elements.voteTitle.innerHTML = `${question}<br><span style="font-weight: 300; opacity: 0.8;">${title}</span>`;
        } else {
            elements.voteTitle.textContent = question;
        }
    }

    // Update vote ID with roll call info if available
    if (elements.voteId && floorData.rollCall) {
        const rollCallNumber = floorData.rollCall.number || 'Unknown';
        elements.voteId.textContent = `Roll Call ${rollCallNumber}`;
    }

    // Update vote counts if available
    if (floorData.voteCounts && elements.yeasCount && elements.naysCount && elements.presentCount) {
        const totals = floorData.voteCounts.totals || {};
        const yeas = parseInt(totals.yeas) || 0;
        const nays = parseInt(totals.nays) || 0;
        const present = parseInt(totals.present) || 0;
        const notVoting = parseInt(totals.not_voting) || 0;
        const totalVotes = yeas + nays + present; // Exclude Not Voting from progress bar
        const totalVotesWithNotVoting = yeas + nays + present + notVoting; // For display purposes

        // Update vote counts with better formatting
        elements.yeasCount.textContent = yeas.toLocaleString();
        elements.naysCount.textContent = nays.toLocaleString();
        elements.presentCount.textContent = present.toLocaleString();

        // Update percentages with better formatting
        if (totalVotes > 0) {
            const yeasPct    = (yeas    / totalVotes) * 100;
            const naysPct    = (nays    / totalVotes) * 100;
            const presentPct = (present / totalVotes) * 100;

            elements.yeasPercent.textContent = `${yeasPct.toFixed(1)}%`;
            elements.naysPercent.textContent = `${naysPct.toFixed(1)}%`;
            elements.presentPercent.textContent = `${presentPct.toFixed(1)}%`;
            
            // Add visual indicators for leading side
            if (yeas > nays) {
                elements.yeasCount.style.fontWeight = 'bold';
                elements.naysCount.style.fontWeight = 'normal';
            } else if (nays > yeas) {
                elements.naysCount.style.fontWeight = 'bold';
                elements.yeasCount.style.fontWeight = 'normal';
            } else {
                elements.yeasCount.style.fontWeight = 'normal';
                elements.naysCount.style.fontWeight = 'normal';
            }
        }

        // Update total votes with better formatting (includes Not Voting for display)
        if (elements.totalVotes) {
            elements.totalVotes.textContent = `Total Votes: ${totalVotesWithNotVoting.toLocaleString()}`;
        }

        // Update progress bars with smooth animations
        if (elements.yeasBar && elements.naysBar && elements.presentBar) {
            const yeasWidth = totalVotes > 0 ? (yeas / totalVotes) * 100 : 0;
            const naysWidth = totalVotes > 0 ? (nays / totalVotes) * 100 : 0;
            const presentWidth = totalVotes > 0 ? (present / totalVotes) * 100 : 0;
            
            elements.yeasBar.style.width = `${yeasWidth}%`;
            elements.naysBar.style.width = `${naysWidth}%`;
            elements.presentBar.style.width = `${presentWidth}%`;
            const voteProgressBar = document.getElementById('vote-progress-bar');
            if (voteProgressBar) voteProgressBar.setAttribute('aria-valuenow', Math.round(yeasWidth));
            
            // Add color coding based on vote status
            if (totalVotes === 0) {
                // No votes yet - neutral colors
                elements.yeasBar.style.backgroundColor = '#666';
                elements.naysBar.style.backgroundColor = '#666';
                elements.presentBar.style.backgroundColor = '#666';
            } else {
                // Active vote - party colors
                elements.yeasBar.style.backgroundColor = '#2ecc71'; // Green
                elements.naysBar.style.backgroundColor = '#e74c3c'; // Red  
                elements.presentBar.style.backgroundColor = '#f39c12'; // Orange
            }
        }

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
        const openedAt = floorData.timer?.timestamp || voteTimer.openedAt;
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

    // Sync completed roll call results back to bill cards
    reconcileVoteWithBills();
}

// After a vote finishes, look up the bill in billsData by roll call question and update its status.
function reconcileVoteWithBills() {
    if (!floorData.rollCall || !floorData.voteCounts) return;
    // Don't update while a vote is actively in progress
    if (floorData.currentStatus?.value === 'vote') return;

    const totals = floorData.voteCounts.totals || {};
    const yeas = parseInt(totals.yeas) || 0;
    const nays = parseInt(totals.nays) || 0;
    if (yeas + nays === 0) return;

    // Parse bill ID from question, e.g. "S 1003 - On Motion to Suspend..." or "H R 1041 - ..."
    const question = floorData.rollCall.question || '';
    // Normalize abbreviation with optional spaces/dots to our canonical form
    const normalizeBillType = raw => {
        const t = raw.replace(/\s*\.\s*/g, '.').replace(/\s+/g, '').toUpperCase();
        const map = {
            'HR': 'H.R.', 'H.R.': 'H.R.', 'HRES': 'H.Res.', 'H.RES.': 'H.Res.',
            'HJRES': 'H.J.Res.', 'H.J.RES.': 'H.J.Res.',
            'HCONRES': 'H.Con.Res.', 'H.CON.RES.': 'H.Con.Res.',
            'S': 'S.', 'S.': 'S.', 'SRES': 'S.Res.', 'S.RES.': 'S.Res.',
            'SJRES': 'S.J.Res.', 'SCONRES': 'S.Con.Res.'
        };
        return map[t] || null;
    };
    // Match "S 1003", "H R 1041", "H Res 100", etc. at the start or after a dash
    const qm = question.match(/(?:^|\s-\s)(H(?:\s*\.?\s*(?:J\s*\.?\s*)?(?:Con\s*\.?\s*)?Res\.?)?|S(?:\s*\.?\s*(?:J\s*\.?\s*)?(?:Con\s*\.?\s*)?Res\.?)?)\s+(\d+)/i);
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
    if (found) updateBillsDisplay();
}

// Mock Data (single vote)
const MOCK_DATA = {
    vote: {
        id: 'H.R. 8405',
        title: 'To provide for the establishment of the Advanced Research Projects Agency for Health',
        rollCall: '124',
        date: '2024-05-10',
        yeas: 20,
        nays: 10,
        present: 100,
        total: 416,
        votesNeeded: 209
    },
    projection: {
        result: 'PASS',
        confidence: 94,
        margin: 20
    }
};

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
    yeasCount: document.getElementById('yeas-count'),
    yeasPercent: document.getElementById('yeas-percent'),
    presentCount: document.getElementById('present-count'),
    presentPercent: document.getElementById('present-percent'),
    naysCount: document.getElementById('nays-count'),
    naysPercent: document.getElementById('nays-percent'),
    yeasBar: document.getElementById('yeas-bar'),
    presentBar: document.getElementById('present-bar'),
    naysBar: document.getElementById('nays-bar'),
    totalVotes: document.getElementById('total-votes'),
    thresholdState: document.getElementById('threshold-state'),
    votesRemaining: document.getElementById('votes-remaining'),
    yeasNeeded: document.getElementById('yeas-needed'),
    naysToBlock: document.getElementById('nays-to-block'),
    maxPossibleYeas: document.getElementById('max-possible-yeas'),
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
    debateRuleTag: document.getElementById('debate-rule-tag'),
    debateCommitteesSection: document.getElementById('debate-committees-section'),
    debateCommitteesList: document.getElementById('debate-committees-list'),
    debateCommitteeReportSection: document.getElementById('debate-committee-report-section'),
    debateCommitteeReportText: document.getElementById('debate-committee-report-text'),
    debateSummarySection: document.getElementById('debate-summary-section'),
    debateCongressFoot: document.getElementById('debate-congress-foot'),
    debateCongressLink: document.getElementById('debate-congress-link'),
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
    apiKey: 'dw_WukWf8avaMpRU7uk7UyHi94ny1pHFsE8',
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

// State for House makeup
let houseMakeup = null;
let vacancies = [];
let lastUpdatedDate = null;

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
        
        console.log('Loaded airport names:', Object.keys(airportNames).length);
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
async function fetchAirportDelays() {
    try {
        if (!elements.airportDelaysList) return;

        // Show loading state (only if empty to avoid flash on refresh)
        if (!elements.airportDelaysList.hasChildNodes()) {
            elements.airportDelaysList.innerHTML = FAA_CONFIG.wasAirports.map(code => `
                <div class="airport-delay-item">
                    <span class="airport-code">${code}</span>
                    <span class="airport-status loading">LOADING</span>
                </div>
            `).join('');
        }

        const delays = {};

        // Initialize WAS airports as normal (always show these)
        FAA_CONFIG.wasAirports.forEach(code => {
            delays[code] = {
                status: 'normal',
                delay: 'No delays',
                reason: 'No delays',
                trend: 'Normal'
            };
        });

        // Track connection status
        let connectionStatus = 'connected'; // 'connected', 'disconnected', 'error'
        
        // Fetch all airport delays from the main API endpoint
        try {
            const response = await fetch(FAA_CONFIG.workerUrl);
            
            if (response.ok) {
                const jsonData = await response.json();
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
                            const airport = delay.querySelector('ARPT')?.textContent;
                            const reason = delay.querySelector('Reason')?.textContent || 'Unknown';
                            const minDelay = delay.querySelector('Min')?.textContent || '';
                            const maxDelay = delay.querySelector('Max')?.textContent || '';
                            const trend = delay.querySelector('Trend')?.textContent || '';
                            
                            if (airport) {
                                delays[airport] = {
                                    status: minDelay ? 'delay' : 'normal',
                                    delay: minDelay && maxDelay ? `${minDelay}-${maxDelay} minutes` : 'No delays',
                                    reason: reason,
                                    trend: trend
                                };
                            }
                        });
                    }
                });
                
                // Mark as connected successfully
                connectionStatus = 'connected';
            } else {
                throw new Error('API request failed');
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
            setIfChanged(elements.airportDelaysList, '<div class="airport-delay-item"><span class="airport-status delay">CONNECTION ERROR</span></div>');
        }
    }
}

// Update airport delays display
function updateAirportDelaysDisplay(connectionStatus = 'connected') {
    if (!elements.airportDelaysList || !airportDelays) return;

    // If disconnected, show connection error for all airports
    if (connectionStatus === 'disconnected') {
        setIfChanged(elements.airportDelaysList, FAA_CONFIG.wasAirports.map(code => `
            <div class="airport-delay-item">
                <span class="airport-info">${code}</span>
                <span class="airport-status disconnected">NO DATA</span>
            </div>
        `).join(''));
        return;
    }

    const delaysHtml = Object.entries(airportDelays).map(([code, data]) => {
        const statusClass = data.status === 'normal' ? 'normal' : 'delay';
        const delayText = data.status === 'normal' ? 'NO DELAYS' : data.delay || 'DELAYS';
        const airportName = airportNames[code] || code;
        const airportUrl = airportUrls[code];
        
        return `
            ${airportUrl ? 
                `<a href="${airportUrl}" target="_blank" rel="noopener" class="airport-delay-item-link">
                    <div class="airport-delay-item">
                        <span class="airport-info">${code} - ${airportName}</span>
                        <span class="airport-status ${statusClass}">${delayText}</span>
                    </div>
                </a>` :
                `<div class="airport-delay-item">
                    <span class="airport-info">${code} - ${airportName}</span>
                    <span class="airport-status ${statusClass}">${delayText}</span>
                </div>`
            }
        `;
    }).join('');

    setIfChanged(elements.airportDelaysList, delaysHtml);
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

// Lookup map from member name -> casualty status (e.g. "Retiring", "Running for Senate")
// Populated at startup from /api/casualty-list.  Keys: "FIRSTNAME LASTNAME" and "LASTNAME".
let casualtyMap = {};

// Normalize a bill ID to match the rules.house.gov slug format, e.g. "H.R. 1041" -> "HR1041"
function normalizeBillIdForRules(billId) {
    return billId.toUpperCase().replace(/[.\s]/g, '');
}

// Load casualty list (members not returning) from worker endpoint.
// Populates casualtyMap with "FIRSTNAME LASTNAME" and "LASTNAME" keys → status string.
async function loadCasualtyList() {
    try {
        const resp = await fetch('https://api.evanhollander.org/house-floor/api/casualty-list');
        if (!resp.ok) return;
        const data = await resp.json();
        if (data && typeof data === 'object' && !data.error) casualtyMap = data;
    } catch {}
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

async function fetchSpecialRules() {
    try {
        const resp = await fetch('https://api.evanhollander.org/house-floor/api/rules', { cache: 'no-store' });
        if (!resp.ok) return;
        const data = await resp.json();
        specialRulesMap.clear();
        for (const rule of (data.rules || [])) {
            for (const billKey of rule.bills) {
                // billKey is already normalized (e.g. "HR1041")
                specialRulesMap.set(billKey, {
                    hres: rule.hres,
                    hresNum: rule.hresNum,
                    title: rule.title || null,
                    passageVote: rule.passageVote || null,
                    pdfUrl: rule.pdfUrl,
                    ruleStatus: rule.ruleStatus,
                    bills: rule.bills,
                    sponsor: rule.sponsor || null,
                });
            }
        }
    } catch (e) {
        console.error('fetchSpecialRules error:', e);
    }
}

// Sort mode: 'status' (default) | 'listed'
let billsSortMode = 'status';

const BILL_STATUS_SORT_ORDER = { scheduled: 0, 'roll-call': 1, passed: 2, failed: 2, postponed: 2 };

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

async function fetchBillsThisWeek() {
    console.log('=== BILLS FETCH START ===');
    try {
        console.log('Rule bills list element:', elements.ruleBillsList);
        console.log('Suspension bills list element:', elements.suspensionBillsList);

        // Quick mode: skip Congress.gov enrichment (summaries, sponsors, committees).
        // We already have that from the initial full fetch; only Bluesky + House XML
        // status updates matter on recurring polls.
        const isQuick = billsFullyEnriched;
        let billsUrl = proceedingsDateOverride
            ? `${BILLS_CONFIG.workerUrl}?date=${encodeURIComponent(proceedingsDateOverride)}`
            : BILLS_CONFIG.workerUrl;
        if (isQuick) billsUrl += (billsUrl.includes('?') ? '&' : '?') + 'quick=1';

        const response = await fetch(billsUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }

        console.log('Bills API response:', data);

        // Merge incoming bill data with what we already have locally.
        // Rules:
        //  1. Never downgrade a higher-priority status (e.g. passed → scheduled).
        //  2. On quick refreshes, carry over Congress.gov enrichment fields
        //     (summary, sponsor, cosponsors, committees) since the server skipped them.
        const STATUS_PRIORITY = { passed: 4, failed: 4, 'roll-call': 3, postponed: 2, scheduled: 1 };
        const mergeBills = (newArr, existingArr) => {
            const byId = Object.fromEntries((existingArr || []).map(b => [b.id, b]));
            return (newArr || []).map((bill, i) => {
                const prev = byId[bill.id];
                if (!prev) return { ...bill, _origIdx: i };

                // Keep higher-priority status from previous state
                const keepOldStatus = (STATUS_PRIORITY[prev.status] || 0) > (STATUS_PRIORITY[bill.status] || 0);
                const statusFields = keepOldStatus
                    ? { status: prev.status, latestAction: prev.latestAction, considered: prev.considered,
                        actionSource: prev.actionSource, actionSourceUrl: prev.actionSourceUrl,
                        latestActionDate: prev.latestActionDate }
                    : {};

                // On quick refresh carry over enrichment the server didn't re-fetch
                const enrichment = isQuick ? {
                    summary:     bill.summary     ?? prev.summary,
                    sponsor:     bill.sponsor     ?? prev.sponsor,
                    cosponsors:  bill.cosponsors  ?? prev.cosponsors,
                    committees:  bill.committees  ?? prev.committees,
                } : {};

                return { ...bill, ...enrichment, ...statusFields, _origIdx: i };
            });
        };

        billsData = {
            ruleBills:           mergeBills(data.ruleBills,           billsData.ruleBills),
            suspensionBills:     mergeBills(data.suspensionBills,     billsData.suspensionBills),
            mayBeConsideredBills:mergeBills(data.mayBeConsideredBills,billsData.mayBeConsideredBills),
            rawHeaders:   data.rawHeaders  || billsData.rawHeaders  || null,
            lastUpdated:  data.lastUpdated || new Date(),
            weekDate:     data.weekDate    || billsData.weekDate    || 'No current week bills available'
        };

        if (!isQuick) billsFullyEnriched = true; // mark enrichment complete after first full fetch

        console.log(`Found ${billsData.ruleBills.length} rule bills, ${billsData.suspensionBills.length} suspension bills, ${billsData.mayBeConsideredBills.length} may-be-considered bills`);

        updateBillsDisplay();

        // Re-render debate/mode sections now that billDataMap is populated.
        // This ensures the Bill ↔ Amendments toggle appears without waiting for
        // the next floor data poll (which could be up to 10s later).
        console.log('[bills→debate] proceedingsData.length=', proceedingsData.length, 'billDataMap.size=', billDataMap.size);
        if (proceedingsData.length) updateDebateSection(proceedingsData);

        // Fetch special rules in parallel, then re-render cards with rule tags
        fetchSpecialRules().then(() => updateBillsDisplay());

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

// Update bill statuses using Congress.gov API
async function updateBillStatuses() {
    const allBills = [...billsData.ruleBills, ...billsData.suspensionBills];
    
    // Process bills in batches to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < allBills.length; i += batchSize) {
        const batch = allBills.slice(i, i + batchSize);
        await Promise.all(batch.map(updateBillStatus));
        
        // Small delay between batches
        if (i + batchSize < allBills.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}

// Update individual bill status
async function updateBillStatus(bill) {
    try {
        // Parse bill ID (e.g., "H.R. 1234" -> "hr/1234")
        const billMatch = bill.id.match(/H\.R\. (\d+)/);
        if (!billMatch) return;
        
        const billNumber = billMatch[1];
        const apiPath = `/bill/119/hr/${billNumber}/actions`;
        const url = BILLS_CONFIG.congressWorker + apiPath;
        
        const response = await fetch(url, { method: 'GET', credentials: 'omit' });
        
        if (!response.ok) {
            console.warn(`Failed to fetch status for ${bill.id}: ${response.status}`);
            return;
        }
        
        const data = await response.json();
        
        if (data && data.actions && data.actions.length > 0) {
            const latestAction = data.actions[0]; // Most recent action first
            
            bill.latestAction = latestAction.actionText || '';
            bill.latestActionDate = latestAction.actionDate || '';
            
            // Determine status based on latest action
            const actionText = (latestAction.actionText || '').toLowerCase();
            if (actionText.includes('pass') && actionText.includes('house')) {
                bill.status = 'passed';
            } else if (actionText.includes('fail') || actionText.includes('rejected')) {
                bill.status = 'failed';
            } else {
                bill.status = 'pending';
            }
        }
        
    } catch (error) {
        console.warn(`Error updating status for ${bill.id}:`, error);
        // Keep as pending if API fails
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
        setIfChanged(elements.ruleBillsList, '<div class="no-bills">No bills under rule</div>');
    }

    if (sortedSuspension.length > 0) {
        setIfChanged(elements.suspensionBillsList, sortedSuspension.map(bill => createBillCard(bill, 'suspension')).join(''));
    } else {
        setIfChanged(elements.suspensionBillsList, '<div class="no-bills">No bills under suspension</div>');
    }

    if (elements.billsLastUpdate) {
        elements.billsLastUpdate.textContent = billsData.weekDate || 'THIS WEEK';
    }

    document.querySelectorAll('.bills-sort-btn').forEach(btn => {
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
                const congressUrl = `https://www.congress.gov/bill/119th-congress/house-resolution/${rule.hresNum}`;
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
}

function createBillCard(bill, procedure) {
    billDataMap.set(bill.id, { ...bill, procedure });
    const statusClass = bill.status || 'scheduled';
    const statusSymbol = bill.status === 'passed' ? '✓' : bill.status === 'failed' ? '✕' : '';
    const actionText = bill.statusText || bill.latestAction || 'Scheduled for consideration';
    const actionDate = bill.latestActionDate ? formatDate(bill.latestActionDate) : '';

    return `
        <button class="bill-card" data-bill-id="${bill.id}" data-status="${statusClass}" type="button">
            <div class="bill-status ${statusClass}" aria-hidden="true">${statusSymbol}</div>
            <div class="bill-info">
                <div class="bill-id">${bill.id}</div>
                <div class="bill-title">${escapeHtml(bill.title)}</div>
                <div class="bill-meta">
                    <div class="bill-action">${actionText}</div>
                    <div class="bill-date">${actionDate}</div>
                </div>
            </div>
            <div class="bill-chevron" aria-hidden="true">›</div>
        </button>
    `;
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
    return slug ? `https://www.congress.gov/bill/119th-congress/${slug}/${m[2]}` : null;
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

function openBillModal(billId) {
    const bill = billDataMap.get(billId);
    if (!bill) return;

    const procedureClass = bill.procedure === 'suspension' ? 'suspension' : bill.procedure === 'maybe' ? 'maybe' : bill.procedure === 'hres' ? 'rule' : 'rule';
    const procedureLabel = bill.procedure === 'suspension' ? 'UNDER SUSPENSION' : bill.procedure === 'maybe' ? 'MAY BE CONSIDERED' : bill.procedure === 'hres' ? 'SPECIAL RULE' : 'UNDER RULE';
    const statusClass = bill.status || 'scheduled';
    const statusLabel = { passed: 'PASSED', failed: 'FAILED', 'roll-call': 'VOTE REQUESTED' }[bill.status] || 'SCHEDULED';
    const actionText = bill.statusText || bill.latestAction || 'Scheduled for consideration';
    const actionDate = bill.latestActionDate ? formatDate(bill.latestActionDate) : '';
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
                        <img class="absentee-photo" src="${photo}" style="display:block" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" alt="${name}" />
                        <div class="absentee-photo-placeholder" style="display:none;">${pLetter}</div>
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
                    ${rCount ? `<div class="bill-modal-support-fill rep" style="width:${rPct}%" title="${rCount} Republican${rCount !== 1 ? 's' : ''}"></div>` : ''}
                    ${dCount ? `<div class="bill-modal-support-fill dem" style="width:${dPct}%" title="${dCount} Democrat${dCount !== 1 ? 's' : ''}"></div>` : ''}
                    ${iCount ? `<div class="bill-modal-support-fill ind" style="width:${iPct}%" title="${iCount} Independent${iCount !== 1 ? 's' : ''}"></div>` : ''}
                </div>
                <div class="bill-modal-support-labels">
                    ${rCount ? `<span class="bill-modal-support-count rep">${rCount}R</span>` : ''}
                    ${dCount ? `<span class="bill-modal-support-count dem">${dCount}D</span>` : ''}
                    ${iCount ? `<span class="bill-modal-support-count ind">${iCount}I</span>` : ''}
                </div>
            </div>`;
    }

    // Committees
    const committeeHtml = bill.committees?.length ? `
        <div class="bill-modal-section">
            <div class="bill-modal-section-label">REFERRED TO</div>
            <div class="bill-modal-committees">
                ${bill.committees.map(c => `<span class="bill-modal-committee">${c}</span>`).join('')}
            </div>
        </div>` : '';

    // Committee report action ("Reported by Committee xx – yy")
    const committeeReportHtml = bill.committeeReport ? `
        <div class="bill-modal-section">
            <div class="bill-modal-section-label">COMMITTEE ACTION</div>
            <div class="bill-modal-action">${escapeHtml(bill.committeeReport)}${bill.committeeReportDate ? `<span class="bill-modal-date"> — ${formatDate(bill.committeeReportDate)}</span>` : ''}</div>
        </div>` : '';

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
        const href = modalRule.pdfUrl || `https://www.congress.gov/bill/119th-congress/house-resolution/${modalRule.hresNum}`;
        return `<a class="bill-rule-tag ${sc} bill-rule-tag-modal" href="${href}" target="_blank" rel="noopener">${modalRule.hres}${modalRule.ruleStatus === 'passed' ? ' ✓' : ''}</a>`;
    })() : fallbackHres ? (() => {
        const hresNum = fallbackHres.match(/(\d+)$/)?.[1];
        const href = hresNum ? `https://www.congress.gov/bill/119th-congress/house-resolution/${hresNum}` : '#';
        return `<a class="bill-rule-tag rule-tag-unknown bill-rule-tag-modal" href="${href}" target="_blank" rel="noopener">${fallbackHres}</a>`;
    })() : '';

    const rulesSlug = (bill.procedure === 'rule') ? billIdToRulesSlug(bill.id) : null;

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
            <div class="bill-modal-top">
                <div class="bill-modal-header">
                    <span class="bill-modal-id">${bill.id}</span>
                    <span class="bill-modal-badge ${statusClass}">${statusLabel}</span>
                    <span class="bill-modal-badge ${procedureClass}">${procedureLabel}</span>
                    ${modalRuleTagHtml}
                </div>
                <h2 class="bill-modal-title">${escapeHtml(bill.title)}</h2>
            </div>
            <div class="bill-modal-sections">
                ${sponsorHtml}
                ${cosponsorsHtml}
                ${committeeHtml}
                ${committeeReportHtml}
            </div>
            ${bill.summary ? `
            <div class="bill-modal-body">
                <div class="bill-modal-section-label">SUMMARY (AUTHORED BY CRS)</div>
                <p class="bill-modal-summary">${bill.summary}</p>
            </div>` : ''}
            <div class="bill-modal-foot">
                ${actionText ? `
                <div class="bill-modal-section" style="margin-bottom:12px;">
                    <div class="bill-modal-section-label">LATEST ACTION</div>
                    <div class="bill-modal-action">${actionText}${actionDate ? `<span class="bill-modal-date"> — ${actionDate}${actionTimeStr ? `, ${actionTimeStr}` : ''}${actionSourceHtml}</span>` : ''}</div>
                </div>` : ''}
                ${congressUrl ? `<a href="${congressUrl}" class="bill-modal-link ${procedureClass}" target="_blank" rel="noopener">View on Congress.gov →</a>` : ''}
            </div>
        </div>
        ${rulesSlug ? `
        <div class="bill-amendments-panel" id="bill-amendments-panel-el">
            <div class="bill-amendments-panel-header">
                <span class="bill-amendments-panel-title">Amendments</span>
                <span class="bill-amendments-count" id="amendments-count"></span>
            </div>
            <div class="bill-amendments-panel-body" id="amendments-body">
                <div class="bill-amendments-empty">Loading…</div>
            </div>
            <div class="bill-modal-foot">
                <a href="https://rules.house.gov/bill/${currentCongress || 119}/${rulesSlug}" class="bill-modal-link rule" target="_blank" rel="noopener">View on rules.house.gov →</a>
            </div>
        </div>` : ''}
    `;
    overlay.hidden = false;
    _billModalTrigger = document.activeElement;
    const closeBtn = document.getElementById('bill-modal-close');
    closeBtn.addEventListener('click', closeBillModal);
    document.addEventListener('keydown', onBillModalKey);
    const modal = document.getElementById('bill-main-panel');
    if (modal) { _billModalTrapCleanup = trapFocus(overlay); closeBtn.focus(); }

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

async function loadAmendments(slug, bodyId = 'amendments-body', countId = 'amendments-count') {
    const body = document.getElementById(bodyId);
    const countEl = document.getElementById(countId);
    if (!body) return;
    try {
        const congress = currentCongress || 119;
        const [resp, xmlText] = await Promise.all([
            fetch(`https://api.evanhollander.org/house-floor/api/amendments?bill=${encodeURIComponent(slug)}&congress=${congress}`),
            getMemberDataXml().catch(() => null)
        ]);
        const data = await resp.json();
        if (!data.amendments?.length) {
            body.innerHTML = '<div class="bill-amendments-empty">No amendments submitted.</div>';
            return;
        }
        if (countEl) countEl.textContent = `${data.amendments.length} submitted`;

        const xmlDoc = xmlText ? parseMemberDataXml(xmlText) : null;

        const sc = s => {
            const l = s.toLowerCase();
            if (l.includes('made in order') || l.includes('adopted')) return 'adopted';
            if (l.includes('not') || l.includes('failed') || l.includes('withdrawn')) return 'failed';
            return 'submitted';
        };

        const partyClass = p => {
            const l = (p || '').toLowerCase();
            if (l === 'r' || l.startsWith('rep')) return 'rep';
            if (l === 'd' || l.startsWith('dem')) return 'dem';
            return 'ind';
        };

        const parseSponsorTokens = str =>
            str.split(/,\s*(?=[A-Z])/).map(t => {
                const m = t.trim().match(/^(.+?)\s*\(([A-Z]{2})\)$/);
                return m ? { raw: t.trim(), lastName: m[1].trim(), state: m[2] } : { raw: t.trim(), lastName: null, state: null };
            }).filter(t => t.raw);

        const partyLetter = p => partyClass(p) === 'rep' ? 'R' : partyClass(p) === 'dem' ? 'D' : 'I';
        const cleanDistrict = d => {
            if (!d) return d;
            const stripped = d.replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1').trim();
            return /^\d+$/.test(stripped) ? stripped.padStart(2, '0') : stripped;
        };

        const renderSponsors = (a) => {
            const tokens = parseSponsorTokens(a.sponsors);
            const amendmentDot = partyClass(a.party); // one dot per amendment
            const chips = tokens.map(t => {
                const match = (xmlDoc && t.lastName && t.state)
                    ? findBestMemberMatchByName(xmlDoc, t.lastName, t.state)
                    : null;
                const pc = match ? partyClass(match.party) : partyClass(a.party);
                const pl = match ? partyLetter(match.party) : partyLetter(a.party);
                const name = match ? match.fullName : t.raw;
                const photoUrl = match ? `https://bioguide.congress.gov/photo/${match.bioguideId}.jpg` : null;
                const profileUrl = match ? buildCongressProfileUrl(match.bioguideId) : null;
                const dist = match && match.district && match.district !== '0' ? cleanDistrict(match.district) : '';
                const distLabel = match ? `${match.state}${dist ? '-' + dist : ''}` : (t.state || '');
                const nameHtml = a.pdfUrl
                    ? `<a href="${a.pdfUrl}" target="_blank" rel="noopener" class="amdt-sponsor-link">${name}</a>`
                    : name;
                const imgHtml = `<img class="amdt-sponsor-photo" src="${photoUrl || ''}" alt="">`;
                const wrapHtml = `<div class="amdt-sponsor-photo-wrap">${imgHtml}</div>`;
                const photoHtml = photoUrl
                    ? (profileUrl ? `<a href="${profileUrl}" target="_blank" rel="noopener" class="amdt-sponsor-photo-link">${wrapHtml}</a>` : wrapHtml)
                    : wrapHtml;
                return `<div class="amdt-sponsor-chip">
                    ${photoHtml}
                    <span class="amdt-sponsor-name"><span class="amdt-sponsor-party-tag ${pc}">${pl}</span>${nameHtml}${distLabel ? `<span class="amdt-sponsor-dist"> ${distLabel}</span>` : ''}</span>
                </div>`;
            });
            return `<span class="amdt-party ${amendmentDot}"></span><div class="amdt-sponsor-list">${chips.join('')}</div>`;
        };

        body.innerHTML = `
            <table class="amendments-table">
                <thead><tr><th>#</th><th>Sponsor(s)</th><th>Summary</th><th>Status</th></tr></thead>
                <tbody>${data.amendments.map(a => `
                    <tr>
                        <td class="amdt-num">${a.num}</td>
                        <td class="amdt-sponsors">${renderSponsors(a)}</td>
                        <td class="amdt-summary">${a.summary}</td>
                        <td><span class="amdt-status-badge ${sc(a.status)}">${a.status}</span></td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
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
}

function onBillModalKey(e) {
    if (e.key === 'Escape') closeBillModal();
}

// Info popup
const INFO_CONTENT = {
    'prayer': {
        title: 'Opening Prayer',
        tags: ['SINCE 1789', 'ELECTED OFFICER', 'GUEST CHAPLAINS WELCOME'],
        body: `The House has opened each day of session with a prayer since April 1, 1789 — one of its oldest unbroken traditions. The House Chaplain is an elected officer of the House who typically delivers the prayer, though Members frequently invite guest chaplains from many faith traditions in their place.

Beyond the daily prayer, the Chaplain provides confidential pastoral counseling to Members, families, and Capitol staff. The current Chaplain is Rev. Margaret Kibben, elected in 2021 as the first woman to hold the role.`,
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
    }
};

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
    overlay.innerHTML = `
        <div class="info-popup" role="dialog" aria-modal="true">
            <button class="info-popup-close" id="info-popup-close" aria-label="Close">&#x2715;</button>
            <div class="info-popup-title">${content.title}</div>
            ${tagsHtml}
            <div class="info-popup-body">${content.body.split('\n\n').map(p => `<p>${p}</p>`).join('')}</div>
            ${content.source ? `<div class="info-popup-source">${content.source}</div>` : ''}
        </div>
    `;
    overlay.hidden = false;
    const _infoTrigger = document.activeElement;
    const infoClose = document.getElementById('info-popup-close');
    infoClose.addEventListener('click', () => closeInfoPopup(_infoTrigger));
    document.addEventListener('keydown', e => onInfoPopupKey(e, _infoTrigger));
    trapFocus(overlay);
    infoClose.focus();
}

let _infoPopupTrapCleanup = null;
function closeInfoPopup(trigger) {
    const overlay = document.getElementById('info-popup-overlay');
    if (overlay) overlay.hidden = true;
    document.removeEventListener('keydown', onInfoPopupKey);
    if (trigger) trigger.focus();
}

function onInfoPopupKey(e, trigger) {
    if (e.key === 'Escape') closeInfoPopup(trigger);
}

// Auto-switch mode based on latest proceeding
function autoSwitchModeFromProceedings(items) {
    if (!items || items.length === 0) return;

    // Respect DomeWatch vote status only while SSE is actively sending tallies.
    // After 90s of SSE silence the vote is almost certainly over; let proceedings drive.
    const liveStatus = floorData.currentStatus?.value;
    const sseIsLive  = lastSseTallyAt > 0 && (Date.now() - lastSseTallyAt) < 90_000;
    if ((liveStatus === 'vote' || liveStatus === 'voting') && sseIsLive) {
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

    // Joint Session (highest priority — rare, significant)
    const jsItem = items.find(i => /^JOINT SESSION\b/i.test(i.description.trim()));
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

    const jmItem = items.findLast(i => /^JOINT MEETING\b/i.test(i.description.trim()));
    if (jmItem) {
        window.setMode('joint-meeting');
        if (jmItem.pubDate && elements.jointMeetingTime) {
            elements.jointMeetingTime.textContent = new Date(jmItem.pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        }
        if (elements.jointMeetingDescriptionLine) {
            elements.jointMeetingDescriptionLine.textContent = decodeHtml(jmItem.description.replace(/^JOINT MEETING\s*[-–]\s*/i, '').trim());
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

    const cotwItem = candidateItems.find(i => {
        const d = i.description.toLowerCase();
        if (d.includes('morning-hour debate') || d.includes('morning hour debate')) return false;
        return d.includes('act as chairman of the committee') ||
               d.includes('committee of the whole') ||
               d.includes('resolved itself into the committee') ||
               d.startsWith('debate -') ||   // "DEBATE - The House proceeded with..."
               (d.includes('proceeded with') && d.includes('debate'));
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

    // Oath and journal can appear anywhere in the day — search all items
    const oathItem = items.find(i => /^OATH OF OFFICE\b/i.test(i.description.trim()));
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
        const response = await fetch(proceedingsUrl);
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

        // Show the proceedings date in the header span
        const proceedingsDate = proceedingsDateOverride
            ? new Date(proceedingsDateOverride)
            : new Date(data.items[0]?.pubDate || new Date());
        const dateStr = fmtDate(proceedingsDate);

        // Pinned timeline item from DomeWatch (e.g. "First votes: Wednesday at 12:30 PM")
        const timelineText = floorData.timeline?.first_votes?.text || '';
        const timelineHtml = timelineText ? `
            <div class="proceedings-item proceedings-timeline-pin">
                <div class="proceedings-text">
                    <span class="proceedings-time">NEXT</span>
                    ${escapeHtml(timelineText)}
                </div>
            </div>` : '';

        const html = data.items.map(item => {
            const pubDate = new Date(item.pubDate);
            const timeStr = pubDate.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            });

            return `
            <div class="proceedings-item">
                <div class="proceedings-text">
                    <span class="proceedings-time">${timeStr}</span>
                    ${decodeHtml(item.description)}
                </div>
            </div>
        `;
        }).join('');

        setIfChanged(elements.proceedingsFeed, timelineHtml + html);


        if (elements.proceedingsLastUpdate) {
            elements.proceedingsLastUpdate.textContent = dateStr;
        }

        // Store items globally so debate/mode sections can re-render after bills load
        proceedingsData = data.items;

        // Auto-switch mode based on latest proceeding
        autoSwitchModeFromProceedings(data.items);

        // Mark any voice-vote or agreed-to passages reflected in proceedings
        updateBillStatusFromProceedings(data.items);

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

        // Update new mode sections
        updateCertElectionSection(data.items);
        updateCertElectoralSection(data.items);
        updateSineDieSection(data.items);
        updateNewSessionSection(data.items);
        updateAdminOathSection(data.items);
        updateJointSessionSection(data.items);

    } catch (error) {
        console.error('Error fetching proceedings:', error);
        setIfChanged(elements.proceedingsFeed, '<div class="proceedings-error">UNABLE TO FETCH PROCEEDINGS</div>');
    }
}

let _debateLastBillId = null; // tracks which bill is shown so tab isn't reset on every poll

// Update debate section with bill information
function updateDebateSection(items) {
    console.log('[debate] updateDebateSection called: items.length=', items?.length, 'hasTitleEl=', !!elements.debateBillTitle);
    if (!elements.debateBillTitle || !items || items.length === 0) return;

    // ── 1. Find the best proceedings item ───────────────────────────────
    // Prefer items that start with "DEBATE" (e.g. "DEBATE - The House proceeded with…")
    const debateItem = items.find(i => /^DEBATE\b/i.test(i.description));
    const fallbackItem = items.find(i => {
        const d = i.description.toLowerCase();
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
    }

    // Wider fallback: scan all debate-related items for any bill in the map
    if (!foundBill) {
        const billPattern = /\b(H\.R\.|H\.Res\.|H\.J\.Res\.|H\.Con\.Res\.|S\.)\s*(\d+)/gi;
        for (const item of items) {
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

    // ── 5. Special rule tag ───────────────────────────────────────────────
    const specialRule = foundBill ? specialRulesMap.get(normalizeBillIdForRules(foundBill.id)) : null;
    const fallbackDebateHres = (!specialRule && foundBill?.governingHres) ? foundBill.governingHres : null;
    if (elements.debateRuleTag) {
        if (specialRule) {
            const href = specialRule.pdfUrl || `https://www.congress.gov/bill/119th-congress/house-resolution/${specialRule.hresNum}`;
            elements.debateRuleTag.innerHTML = `<a class="bill-rule-tag" href="${href}" target="_blank" rel="noopener">PURSUANT TO ${specialRule.hres}</a>`;
        } else if (fallbackDebateHres) {
            const hresNum = fallbackDebateHres.match(/(\d+)$/)?.[1];
            const href = hresNum ? `https://www.congress.gov/bill/119th-congress/house-resolution/${hresNum}` : '#';
            elements.debateRuleTag.innerHTML = `<a class="bill-rule-tag" href="${href}" target="_blank" rel="noopener">PURSUANT TO ${fallbackDebateHres}</a>`;
        } else {
            elements.debateRuleTag.innerHTML = '';
        }
    }

    // ── 6. Panel nav (Bill Details ↔ Amendments toggle) ──────────────────
    const rulesSlug = foundBill ? billIdToRulesSlug(foundBill.id) : null;
    const hasAmendments = rulesSlug && (foundBill?.procedure === 'rule' || foundBill?.isRule === true);
    console.log('[debate-nav] foundBillId:', foundBillId, '| foundBill:', foundBill?.id, '| procedure:', foundBill?.procedure, '| isRule:', foundBill?.isRule, '| rulesSlug:', rulesSlug, '| hasAmendments:', hasAmendments, '| billDataMap size:', billDataMap.size);
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
                    } else {
                        if (billPanel) billPanel.style.display = 'none';
                        if (amendPanel) amendPanel.style.display = '';
                        loadAmendments(rulesSlug, 'debate-amendments-body', 'debate-amendments-count');
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
            }
        } else {
            elements.debatePanelNav.style.display = 'none';
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
                            <img class="absentee-photo" src="${photo}" style="display:block" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" alt="${name}" />
                            <div class="absentee-photo-placeholder" style="display:none;">${pLetter}</div>
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
                    rCount ? `<div class="bill-modal-support-fill rep" style="width:${rPct}%" title="${rCount} Republican${rCount !== 1 ? 's' : ''}"></div>` : '',
                    dCount ? `<div class="bill-modal-support-fill dem" style="width:${dPct}%" title="${dCount} Democrat${dCount !== 1 ? 's' : ''}"></div>` : '',
                    iCount ? `<div class="bill-modal-support-fill ind" style="width:${iPct}%" title="${iCount} Independent${iCount !== 1 ? 's' : ''}"></div>` : '',
                ].join('');
                elements.debateSupportLabels.innerHTML = [
                    rCount ? `<span class="bill-modal-support-count rep">${rCount}R</span>` : '',
                    dCount ? `<span class="bill-modal-support-count dem">${dCount}D</span>` : '',
                    iCount ? `<span class="bill-modal-support-count ind">${iCount}I</span>` : '',
                ].join('');
                elements.debateSupportSection.style.display = '';
            } else {
                elements.debateSupportSection.style.display = 'none';
            }
        }

        // Committees
        if (elements.debateCommitteesSection && elements.debateCommitteesList) {
            if (foundBill.committees?.length) {
                elements.debateCommitteesList.innerHTML = foundBill.committees
                    .map(c => `<span class="bill-modal-committee">${c}</span>`).join('');
                elements.debateCommitteesSection.style.display = '';
            } else {
                elements.debateCommitteesSection.style.display = 'none';
            }
        }

        // Committee Action
        if (elements.debateCommitteeReportSection && elements.debateCommitteeReportText) {
            if (foundBill.committeeReport) {
                const crDate = foundBill.committeeReportDate ? ` — ${formatDate(foundBill.committeeReportDate)}` : '';
                elements.debateCommitteeReportText.innerHTML = `${escapeHtml(foundBill.committeeReport)}<span class="bill-modal-date">${crDate}</span>`;
                elements.debateCommitteeReportSection.style.display = '';
            } else {
                elements.debateCommitteeReportSection.style.display = 'none';
            }
        }

        // Summary
        if (elements.debateSummarySection && elements.debateBillDescription) {
            if (foundBill.summary) {
                elements.debateBillDescription.innerHTML = foundBill.summary;
                elements.debateSummarySection.style.display = '';
            } else {
                elements.debateSummarySection.style.display = 'none';
            }
        }

        // Congress.gov link
        const congressUrl = billIdToCongressUrl(foundBill.id);
        const procedureClass = foundBill.procedure === 'suspension' ? 'suspension' : 'rule';
        if (elements.debateCongressFoot && elements.debateCongressLink) {
            if (congressUrl) {
                elements.debateCongressLink.href = congressUrl;
                elements.debateCongressLink.className = `bill-modal-link ${procedureClass}`;
                elements.debateCongressFoot.style.display = '';
            } else {
                elements.debateCongressFoot.style.display = 'none';
            }
        }
    } else {
        // Bill not in map yet — show ID and a clean pending state
        elements.debateBillTitle.textContent = foundBillId ? 'Bill details loading…' : '—';
        elements.debateBillId.textContent = foundBillId || '—';
        if (elements.debateSponsorSection) elements.debateSponsorSection.style.display = 'none';
        if (elements.debateSupportSection) elements.debateSupportSection.style.display = 'none';
        if (elements.debateCommitteesSection) elements.debateCommitteesSection.style.display = 'none';
        if (elements.debateCommitteeReportSection) elements.debateCommitteeReportSection.style.display = 'none';
        if (elements.debateSummarySection) elements.debateSummarySection.style.display = 'none';
        if (elements.debateCongressFoot) elements.debateCongressFoot.style.display = 'none';
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
    const guestMatch = normalizedDescription.match(/(?:today'?s\s+prayer\s+was\s+)?offered\s+by\s+([^,\.]+)(?:,|\.|$)/i);
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

    // Restore full title for known chaplains
    if (/margaret grun kibben/i.test(chaplainName)) {
        chaplainName = 'The Reverend Doctor Margaret Grun Kibben';
    }

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
        // For House Chaplain, use the specific Margaret Kibben photo
        elements.prayerImagePlaceholder.style.display = 'none';
        elements.prayerImage.src = 'https://upload.wikimedia.org/wikipedia/commons/a/af/Margaret_G._Kibben_Portrait_for_the_118th_Congress_%282024%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original';
        elements.prayerImage.alt = 'Rev. Margaret Kibben, House Chaplain';
        elements.prayerImage.style.display = 'block';
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
        leaderName = leaderName.replace(/^(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+/i, '').trim();
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
            elements.journalImage.onerror = () => {
                if (elements.journalImagePlaceholder) elements.journalImagePlaceholder.style.display = 'flex';
                elements.journalImage.style.display = 'none';
            };
            elements.journalImage.src = photoUrl;
            elements.journalImage.alt = `${firstName} ${lastName}`;
            elements.journalImage.style.display = 'block';
            if (elements.journalImagePlaceholder) elements.journalImagePlaceholder.style.display = 'none';
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
            elements.pledgeImage.onerror = () => {
                if (elements.pledgeImagePlaceholder) elements.pledgeImagePlaceholder.style.display = 'flex';
                elements.pledgeImage.style.display = 'none';
            };
            elements.pledgeImage.src = photoUrl;
            elements.pledgeImage.alt = name || 'Speaker of the House';
            elements.pledgeImage.style.display = 'block';
            if (elements.pledgeImagePlaceholder) elements.pledgeImagePlaceholder.style.display = 'none';
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

        if (!nameOnly) {
            if (elements.speakerImagePlaceholder) elements.speakerImagePlaceholder.style.display = 'flex';
            if (elements.speakerImage) elements.speakerImage.style.display = 'none';
            return;
        }

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
        if (elements.speakerImagePlaceholder) elements.speakerImagePlaceholder.style.display = 'none';
        if (elements.speakerImage) {
            elements.speakerImage.onerror = () => {
                if (elements.speakerImagePlaceholder) elements.speakerImagePlaceholder.style.display = 'flex';
                elements.speakerImage.style.display = 'none';
            };
            elements.speakerImage.src = photoUrl;
            elements.speakerImage.alt = match.fullName || 'Speaker Pro Tempore';
            elements.speakerImage.style.display = 'block';
        }
    } catch (error) {
        console.error('Failed to resolve speaker pro tempore member:', error);
        if (elements.speakerImagePlaceholder) elements.speakerImagePlaceholder.style.display = 'flex';
        if (elements.speakerImage) elements.speakerImage.style.display = 'none';
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
        if (elements.committeeChairImagePlaceholder) elements.committeeChairImagePlaceholder.style.display = 'none';
        if (elements.committeeChairImage) {
            elements.committeeChairImage.onerror = () => {
                elements.committeeChairImage.style.display = 'none';
                if (elements.committeeChairImagePlaceholder) elements.committeeChairImagePlaceholder.style.display = 'flex';
            };
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

    if (elements.oathImagePlaceholder) {
        elements.oathImagePlaceholder.style.display = 'flex';
    }
    const oathImg = document.getElementById('oath-image');
    if (oathImg) {
        oathImg.style.display = 'none';
        oathImg.removeAttribute('src');
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

        console.log(`Searching for member: ${lastName}${state ? ' from ' + state : ''}`);

        let clerkDataText;
        try {
            clerkDataText = await getMemberXml();
        } catch (workerError) {
            console.log('Member XML fetch failed:', workerError);
            showPledgePlaceholder();
            return;
        }
        
        // Parse the XML data
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(clerkDataText, 'text/xml');
        
        // Get all member elements
        const members = xmlDoc.querySelectorAll('member');
        console.log(`Found ${members.length} total members in XML`);
        
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
            
            // Score based on last name similarity
            const score = calculateNameSimilarity(lastName, memberLastName);
            
            console.log(`Comparing "${lastName}" with "${memberLastName}": score ${score}, bioguide: ${bioguideId}`);
            
            if (score > bestScore && score > 0.3) {
                bestScore = score;
                bestMatch = {
                    lastName: memberLastName,
                    firstName: memberFirstName,
                    fullName: `${memberFirstName} ${memberLastName}`,
                    bioguideId: bioguideId,
                    party: party,
                    district: district,
                    state: memberState,
                    town: town,
                    website: website
                };
            }
        }

        console.log('Best match:', bestMatch, 'Score:', bestScore);
        console.log('Has bioguide ID:', bestMatch && bestMatch.bioguideId);

        if (bestMatch && bestMatch.bioguideId) {
            console.log('Updating display with member info');
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
            
            console.log('Updated name:', elements.pledgeLeaderName.textContent);
            console.log('Updated details:', elements.pledgeLeaderDetails.textContent);
            console.log('Party tag:', elements.pledgePartyTag.textContent);
            console.log('Additional info:', elements.pledgeLeaderAdditional.textContent);
            
            // Use the official Biographical Directory image path.
            // The photo endpoint is organized by the first letter of the BioGuide ID.
            const photoUrl = `https://bioguide.congress.gov/bioguide/photo/${bestMatch.bioguideId.charAt(0)}/${bestMatch.bioguideId}.jpg`;

            console.log('Trying photo URL:', photoUrl);
            console.log('Bioguide ID:', bestMatch.bioguideId);

            elements.pledgeImage.onerror = () => {
                console.log('Photo failed to load, falling back to placeholder');
                showPledgePlaceholder();
            };

            elements.pledgeImagePlaceholder.style.display = 'none';
            elements.pledgeImage.src = photoUrl;
            elements.pledgeImage.style.display = 'block';
            return;
        } else {
            console.log('No best match found or no bioguide ID');
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

// Calculate similarity between two names
function calculateNameSimilarity(name1, name2) {
    const n1 = name1.toLowerCase();
    const n2 = name2.toLowerCase();
    
    if (n1 === n2) return 1.0;
    
    // Check if one contains the other
    if (n1.includes(n2) || n2.includes(n1)) return 0.8;
    
    // Simple Levenshtein-like distance for partial matches
    const longer = n1.length > n2.length ? n1 : n2;
    const shorter = n1.length > n2.length ? n2 : n1;
    
    if (longer.length === 0) return 0;
    
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
        if (longer.includes(shorter[i])) {
            matches++;
        }
    }
    
    return matches / longer.length;
}

function showPledgePlaceholder() {
    elements.pledgeImage.style.display = 'none';
    elements.pledgeImage.removeAttribute('src');
    elements.pledgeImagePlaceholder.style.display = 'flex';
    elements.pledgePartyTag.textContent = '';
    elements.pledgeTime.textContent = '';
    elements.pledgeLeaderDetails.textContent = '';
    elements.pledgeLeaderAdditional.textContent = '';
}

// Utility function to calculate time ago
async function getTimeAgo(date) {
    const now = new Date();
    const diff = Math.floor((now - date) / 1000); // seconds
    
    if (diff < 60) return 'JUST NOW';
    if (diff < 3600) return `${Math.floor(diff / 60)} MIN AGO`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} HOURS AGO`;
    return `${Math.floor(diff / 86400)} DAYS AGO`;
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

// House Makeup Functions
async function fetchHouseMakeup() {
    try {
        const response = await fetch(MEMBER_DATA_CONFIG.workerUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const jsonData = await response.json();
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
                        member: `Rep. ${predOfficialName}`,
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
        const totalSeats = 435; // Fixed total House seats
        const repPercent = (houseMakeup.republicans / totalSeats) * 100;
        const demPercent = (houseMakeup.democrats / totalSeats) * 100;
        const indPercent = (houseMakeup.independents / totalSeats) * 100;
        const vacPercent = (vacancies.length / totalSeats) * 100;
        
        elements.repFill.style.width = `${repPercent}%`;
        elements.demFill.style.width = `${demPercent}%`;
        elements.indFill.style.width = `${indPercent}%`;
        elements.vacFill.style.width = `${vacPercent}%`;
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

// Bluesky Functions
async function fetchBlueskyFeed() {
    try {
        const response = await fetch(BLUESKY_CONFIG.workerUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const jsonData = await response.json();
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
        
        console.log('Weather updated:', current.shortForecast, current.temperature);
        
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

    // Load capcam immediately so it's buffered and ready on first hover
    video.muted = true;
    const isLocalFile = window.location.protocol === 'file:';

    if (window.Hls && Hls.isSupported()) {
        capcamHls = new Hls({ maxBufferLength: 30, enableWorker: !isLocalFile, autoStartLoad: true });
        capcamHls.loadSource(CAPCAM_URL);
        capcamHls.attachMedia(video);
        capcamHls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoLoaded = true;
            // Don't play yet — wait for first hover
        });
        capcamHls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) { capcamHls.destroy(); capcamHls = null; videoLoaded = false; }
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = CAPCAM_URL;
        const onReady = () => { videoLoaded = true; };
        video.addEventListener('loadedmetadata', onReady, { once: true });
        video.addEventListener('canplay', onReady, { once: true });
        video.addEventListener('error', () => { videoLoaded = false; });
        video.load();
    }

    // Hover shows/plays, leave pauses
    panel.addEventListener('mouseenter', () => {
        if (videoLoaded) {
            video.play().catch(() => {});
        } else if (capcamHls) {
            // Still loading — play as soon as manifest is ready
            capcamHls.once(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        }
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
    const validModes = ['vote', 'recess', 'debate', 'prayer', 'silence', 'oath', 'speaker', 'pledge', 'journal', 'morning-hour', 'one-minute', 'special-order', 'joint-meeting', 'message', 'cert-election', 'cert-electoral', 'sine-die', 'new-session', 'admin-oath', 'joint-session', 'committee-chair'];
    if (!validModes.includes(mode)) {
        console.error(`Invalid mode: ${mode}. Valid modes are: ${validModes.join(', ')}`);
        return;
    }

    updateModeClasses(mode);
};

// Initialize mode (no toggle — mode is driven by DomeWatch)
function initModeToggle() {
    updateModeClasses('vote');
}

function updateModeClasses(mode) {
    // Remove all mode classes
    document.body.classList.remove('recess-mode', 'debate-mode', 'prayer-mode', 'silence-mode', 'oath-mode', 'speaker-mode', 'pledge-mode', 'journal-mode', 'morning-hour-mode', 'one-minute-mode', 'special-order-mode', 'joint-meeting-mode', 'message-mode', 'cert-election-mode', 'cert-electoral-mode', 'sine-die-mode', 'new-session-mode', 'admin-oath-mode', 'joint-session-mode', 'committee-chair-mode');

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
    updateTodayDate();
    setInterval(updateTodayDate, 60000); // Update date every minute
    
    
    // Fire all critical fetches immediately in parallel
    loadCasualtyList();
    loadRollLog();
    fetchVotingDays();
    fetchFloorData();
    fetchWeather();

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
            console.log('SSE vote.tally stale >45s during active vote — forcing reconnect');
            if (sseConnection) { sseConnection.close(); sseConnection = null; }
            isStreaming = false;
            lastSseTallyAt = Date.now(); // reset to avoid a tight reconnect loop
            startSSEStreaming();
        }
    }, 15000);

    // Poll the REST floor endpoint every 30s alongside SSE.
    // SSE gives us real-time vote tallies, but it only sends vote.tally events —
    // it does NOT send an event when a vote ends. Without this poll, currentStatus
    // stays stuck at 'vote' forever and reconcileVoteWithBills never fires.
    // Poll REST floor endpoint every 10s as a reliable fallback.
    // SSE is the fast path, but if the upstream goes silent (between votes, stale
    // connection) the REST poll ensures counts stay current.
    setInterval(() => fetchFloorData(true), 10000);
    setInterval(fetchWeather, 300000); // Refresh weather every 5 minutes
    setInterval(updateProceedingsFeed, RSS_CONFIG.refreshInterval); // Refresh proceedings every 15s
    setInterval(fetchBillsThisWeek, BILLS_CONFIG.refreshInterval); // Refresh bills every 5 minutes
    setInterval(fetchHouseMakeup, HOUSE_MAKEUP_CONFIG.refreshInterval); // Refresh House makeup every 5 minutes
    setInterval(fetchBlueskyFeed, BLUESKY_CONFIG.refreshInterval); // Refresh Bluesky every 3 minutes
    setInterval(fetchAirportDelays, FAA_CONFIG.refreshInterval); // Refresh airport delays every 5 minutes
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

    // Info popup click delegation
    document.addEventListener('click', e => {
        const btn = e.target.closest('.info-btn');
        if (btn) { e.stopPropagation(); openInfoPopup(btn.dataset.info); }
    });

    // Bill card click → modal; sort button click → re-sort
    const billsSection = document.querySelector('.bills-section');
    if (billsSection) {
        billsSection.addEventListener('click', e => {
            const sortBtn = e.target.closest('.bills-sort-btn');
            if (sortBtn) { billsSortMode = sortBtn.dataset.sort; updateBillsDisplay(); return; }
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
}

// initHlsPlayer removed — video is now handled entirely by initYouTubePip (always-on PiP)

async function initHlsPlayer_UNUSED() {
    const video = document.getElementById('player');
    if (!video) return;
    let currentHls = null;
    let pollTimer = null;
    let frozen = false;

    function hideOverlay() {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }
    function showUnavailable() {
        hideOverlay();
        video.style.display = 'none';
        if (fallback) fallback.style.display = 'flex';
    }
    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(async () => {
            try {
                const d = await (await fetch('https://api.evanhollander.org/house-floor/api/hls-url')).json();
                if (d.url) { clearInterval(pollTimer); pollTimer = null; loadStream(d.url, d.isLive); }
            } catch {}
        }, 10_000);
    }

    function freezeAtEnd() {
        if (frozen) return;
        const end = video.seekable.length ? video.seekable.end(video.seekable.length - 1) : NaN;
        if (!isFinite(end) || end <= 1) { setTimeout(freezeAtEnd, 300); return; }
        frozen = true;
        video.__hlsIsLive = false;
        window.__hlsSessionEnded = true;
        window.dispatchEvent(new CustomEvent('hls-session-ended'));
        video.controls = false;
        const onSeeked = () => {
            video.play().then(() => {
                const grab = () => {
                    if (video.videoWidth > 0) {
                        video.pause();
                        if (snapshot) {
                            try {
                                snapshot.width  = video.videoWidth;
                                snapshot.height = video.videoHeight;
                                snapshot.getContext('2d').drawImage(video, 0, 0, snapshot.width, snapshot.height);
                                snapshot.hidden = false;
                                video.style.display = 'none';
                            } catch {}
                        }
                    } else { requestAnimationFrame(grab); }
                };
                requestAnimationFrame(grab);
            }).catch(() => video.pause());
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        video.currentTime = end - 0.3;
        const frozenUrl = video.__hlsSrc;
        const t = setInterval(async () => {
            try {
                const d = await (await fetch('https://api.evanhollander.org/house-floor/api/hls-url')).json();
                if (d.url && d.isLive && d.url !== frozenUrl) {
                    clearInterval(t);
                    frozen = false;
                    window.__hlsSessionEnded = false;
                    if (loadingOverlay) loadingOverlay.style.display = '';
                    loadStream(d.url, true);
                }
            } catch {}
        }, 30_000);
    }

    function loadStream(url, isLive) {
        if (currentHls) { try { currentHls.destroy(); } catch {} currentHls = null; }
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        frozen = false;
        video.__hlsSrc = url;
        video.__hlsIsLive = isLive;
        // Show video, hide fallback/snapshot — identical to PiP load()
        video.style.display = 'block';
        video.muted = true;
        video.controls = true;
        if (snapshot) { snapshot.hidden = true; }
        if (fallback) fallback.style.display = 'none';

        if (window.Hls && Hls.isSupported()) {
            const hls = new Hls({ maxBufferLength: 2, maxMaxBufferLength: 4, liveSyncDurationCount: 1, liveMaxLatencyDurationCount: 2, liveDurationInfinity: true });
            currentHls = hls;
            hls.loadSource(url);
            hls.attachMedia(video);
            video.addEventListener('canplay', hideOverlay, { once: true });
            setTimeout(hideOverlay, 5000);
            hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
            hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { showUnavailable(); startPolling(); } });
            video.addEventListener('ended', () => freezeAtEnd());
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.play().catch(() => {});
            video.addEventListener('canplay', hideOverlay, { once: true });
            setTimeout(hideOverlay, 5000);
            video.addEventListener('ended', () => freezeAtEnd());
        } else {
            showUnavailable();
        }
    }

    // Initial load
    try {
        const d = await (await fetch('https://api.evanhollander.org/house-floor/api/hls-url')).json();
        if (d.url) { loadStream(d.url, d.isLive); return; }
    } catch {}
    showUnavailable();
    startPolling();
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
        
        const continuousContent = displayItems.map(item => `
            <a href="${item.link}" target="_blank" rel="noopener" class="ticker-item">
                <span class="ticker-source">${item.source}</span>
                <span class="ticker-text">${item.title}</span>
                <span class="ticker-time">${item.relativeTime}</span>
            </a>
        `).join('');
        
        // Update ticker display
        setIfChanged(elements.tickerContent, continuousContent);
        elements.tickerContent.style.paddingLeft = '0';
        // Force a reflow so Safari restarts the CSS animation after innerHTML change.
        // Without this, Safari freezes the ticker until a hover/blur triggers a repaint.
        elements.tickerContent.style.animation = 'none';
        void elements.tickerContent.offsetWidth; // flush layout
        elements.tickerContent.style.animation = '';
        
    } catch (error) {
        console.error('News ticker fetch error:', error);
        setIfChanged(elements.tickerContent, '<div class="ticker-item">Unable to fetch news</div>');
    }
}

// Helper function to get source name from URL
function getSourceFromUrl(url) {
    if (url.includes('nitter.net')) return 'Nitter';
    if (url.includes('thehill.com')) return 'The Hill';
    if (url.includes('rollcall.com')) return 'Roll Call';
    if (url.includes('politico.com')) return 'Politico';
    return 'News';
}

// Helper function to format time
function formatTime(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
    });
}

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

// Fetch Data from API
async function fetchData() {
    // Currently using mock data
    state.data = MOCK_DATA;
    state.isConnected = true;
    state.lastUpdate = new Date();
    updateUI();
}

// Process API Data (transform to our format)
function processApiData(apiData) {
    // Transform API response to match our data structure
    // Customize this based on actual API response format
    return {
        vote: {
            id: apiData.vote?.id || MOCK_DATA.vote.id,
            title: apiData.vote?.title || MOCK_DATA.vote.title,
            rollCall: apiData.vote?.rollCall || MOCK_DATA.vote.rollCall,
            date: apiData.vote?.date || MOCK_DATA.vote.date,
            yeas: apiData.vote?.yeas || MOCK_DATA.vote.yeas,
            nays: apiData.vote?.nays || MOCK_DATA.vote.nays,
            present: apiData.vote?.present || MOCK_DATA.vote.present,
            total: apiData.vote?.total || MOCK_DATA.vote.total,
            votesNeeded: apiData.vote?.votesNeeded || MOCK_DATA.vote.votesNeeded
        },
        projection: {
            result: apiData.projection?.result || MOCK_DATA.projection.result,
            confidence: apiData.projection?.confidence || MOCK_DATA.projection.confidence,
            margin: apiData.projection?.margin || MOCK_DATA.projection.margin
        }
    };
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

async function updateAbsenteeTracking() {
    console.log('=== ABSENTEE TRACKING UPDATE START ===');
    try {
        if (!elements.absenteeList) {
            console.log('Absentee list element not found');
            return;
        }

        try {
            const indexResponse = await fetch(CONGRESS_INDEX_CONFIG.workerUrl);
            if (!indexResponse.ok) throw new Error(`HTTP ${indexResponse.status}`);
            const jsonData = await indexResponse.json();
            
            const rollNumber = jsonData.latestRollNumber;
            console.log('Found latest roll number:', rollNumber);
            
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
                    
                    absentees.push({
                        name: name.trim(),
                        party: party === 'R' ? 'rep' : party === 'D' ? 'dem' : 'ind',
                        state: state.trim(),
                        voteType: vote
                    });
                }
            });

            const rollDate = xmlDoc.querySelector('action-date')?.textContent?.trim() || '';
            const rollTime = xmlDoc.querySelector('action-time')?.textContent?.trim() || '';
            await updateAbsenteeUI(absentees, rollNumber, rollDate, rollTime);
            console.log('Real data displayed:', absentees.length, 'absentees');
            
        } catch (error) {
            console.error('Real data fetch failed:', error);
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
    
    // Update absentee list
    if (absentees.length > 0) {
        let xmlDoc = null;
        try {
            const xmlText = await getMemberDataXml();
            xmlDoc = parseMemberDataXml(xmlText);
        } catch (error) {
            console.error('Failed to load member XML for absentees:', error);
        }

        const absenteeHtml = absentees.map((absentee, absenteeIndex) => {
            const parsedName = parseAbsenteeRollName(absentee.name);
            const match = xmlDoc ? findBestMemberMatchByName(xmlDoc, parsedName.lastName || parsedName.rawName, absentee.state || parsedName.state) : null;
            const displayName = match ? match.fullName : parsedName.rawName;
            const nd = match ? normalizeDistrict(match.district) : '';
            const displayState = match ? (nd ? `${match.state}-${nd}` : match.state) : absentee.state;
            const photoUrl = match && match.bioguideId ? buildBioguidePhotoUrl(match.bioguideId) : '';
            const photoStyle = photoUrl ? 'display:block;' : '';
            const partyClass = absentee.party === 'rep' ? 'republican' : absentee.party === 'dem' ? 'democrat' : 'independent';
            const casualtyStatus = getCasualtyStatus(match);

            return `
            <div class="absentee-member ${absentee.party}" data-absentee-index="${absenteeIndex}">
                <div class="absentee-photo-wrap">
                    <img class="absentee-photo" alt="${displayName}" src="${photoUrl}" style="${photoStyle}" />
                    <div class="absentee-photo-placeholder">--</div>
                </div>
                <div class="absentee-meta">
                    <span class="absentee-party-tag ${partyClass}">${absentee.party === 'rep' ? 'R' : absentee.party === 'dem' ? 'D' : 'I'}</span>
                    <span class="absentee-name">${displayName}</span>
                    <span class="absentee-state">${displayState}</span>
                    ${casualtyStatus ? `<span class="absentee-casualty-status">${casualtyStatus}</span>` : ''}
                </div>
            </div>
        `;}).join('');
        setIfChanged(elements.absenteeList, absenteeHtml);
    } else {
        setIfChanged(elements.absenteeList, '<div class="absentee-member">ALL MEMBERS VOTED</div>');
    }
    
    console.log(`Roll ${rollNumber} (${rollDate}): ${totalAbsentees} absentees`);
}

// Update API Status Indicator
function updateApiStatus() {
    // API status indicator removed
}

// Update UI
function updateUI() {
    updateApiStatus();
    
    // Use DomeWatch data if available, otherwise fall back to mock data
    if (floorData.currentStatus) {
        updateFloorDisplay();
        updatePartyBreakdown();
        updateThresholdAnalysis();
        updateQuorumStatus();
        updateAbsenteeTracking();
        updateFloorGrid();
    } else {
        updateVoteDisplay();
        updatePartyBreakdown();
        updateThresholdAnalysis();
        updateQuorumStatus();
        updateAbsenteeTracking();
        updateFloorGrid();
    }
    
    updateLastUpdate();
    fetchBillsThisWeek();
    updateTodayDate();
    updateFooterTimestamp();
    // Ensure session status is updated after other logic
    setTimeout(() => {
        fetchVotingDays();
    }, 1000);
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
        const emptyPct = 100 - Math.min((totalVoted / wholeNumber) * 100, 100);
        elements.quorumFill.style.width = `${emptyPct}%`;
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
        
        // Update progress bar - shrink from right to reveal gradient underneath
        const percentage = Math.min((totalVoted / totalLegislators) * 100, 100);
        const emptyPercentage = 100 - percentage;
        elements.quorumFill.style.width = `${emptyPercentage}%`;
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
        
        const percentage = Math.min((totalVoted / quorumRequired) * 100, 100);
        elements.quorumFill.style.width = `${percentage}%`;
        document.getElementById('quorum-progress-bar')?.setAttribute('aria-valuenow', totalVoted);
    }
}

// Update Vote Display
function updateVoteDisplay() {
    if (!state.data || !state.data.vote) return;
    
    const v = state.data.vote;
    
    elements.voteTitle.textContent = v.title;
    elements.voteId.textContent = v.id;
    elements.yeasCount.textContent = v.yeas;
    elements.presentCount.textContent = v.present;
    elements.naysCount.textContent = v.nays;
    
    const total = v.yeas + v.nays + v.present;
    const yeasPercent = total > 0 ? ((v.yeas / total) * 100).toFixed(1) : 0;
    const presentPercent = total > 0 ? ((v.present / total) * 100).toFixed(1) : 0;
    const naysPercent = total > 0 ? ((v.nays / total) * 100).toFixed(1) : 0;
    
    elements.yeasPercent.textContent = `${yeasPercent}%`;
    elements.presentPercent.textContent = `${presentPercent}%`;
    elements.naysPercent.textContent = `${naysPercent}%`;
    elements.totalVotes.textContent = `Total: ${total}`;
}

// Update Progress Bar
function updateProgress() {
    if (!state.data || !state.data.vote) return;
    
    const v = state.data.vote;
    const total = v.yeas + v.nays + v.present;
    
    if (total > 0) {
        const yeasPercent = (v.yeas / total) * 100;
        const presentPercent = (v.present / total) * 100;
        const naysPercent = (v.nays / total) * 100;
        
        elements.yeasBar.style.width = `${yeasPercent}%`;
        elements.presentBar.style.width = `${presentPercent}%`;
        elements.naysBar.style.width = `${naysPercent}%`;
    }
}

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
    let pipHls       = null;
    let pipWaitTimer = null;
    let expanded     = false;
    let edgeKeeper   = null; // interval pinning live playback to the edge

    // Enable embedded CEA-608/708 captions on the PiP video. Tracks may appear
    // before or after load, so scan now + poll briefly until one is shown.
    function enablePipCaptions() {
        for (let i = 0; i < pipVideo.textTracks.length; i++) {
            const t = pipVideo.textTracks[i];
            if (t.kind === 'captions' || t.kind === 'subtitles') {
                if (t.mode !== 'showing') t.mode = 'showing';
                return true;
            }
        }
        return false;
    }

    function hidePipLoading() { if (pipLoading) pipLoading.style.display = 'none'; }
    function resetPipLoading() { if (pipLoading) pipLoading.style.display = 'flex'; }

    function expand() {
        if (expanded) return;
        expanded = true;
        pip.classList.add('pip-expanded');
        if (backdrop) backdrop.classList.add('pip-backdrop-visible');
        if (pipOverlay) pipOverlay.style.pointerEvents = 'none';
        pipVideo.muted = false;
    }

    function collapse() {
        if (!expanded) return;
        expanded = false;
        pip.classList.remove('pip-expanded');
        if (backdrop) backdrop.classList.remove('pip-backdrop-visible');
        if (pipOverlay) pipOverlay.style.pointerEvents = 'auto';
        pipVideo.muted = true;
    }

    if (pipOverlay) pipOverlay.addEventListener('click', expand);
    if (backdrop) backdrop.addEventListener('click', collapse);
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); collapse(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded) collapse(); });

    // Keep live playback pinned to the edge. HLS live-sync alone let the feed
    // fall ~40s behind real time; this snaps forward whenever drift exceeds 8s.
    function startEdgeKeeper() {
        if (edgeKeeper) clearInterval(edgeKeeper);
        edgeKeeper = setInterval(() => {
            if (pipVideo.paused || pipVideo.seekable.length === 0) return;
            const edge = pipVideo.seekable.end(pipVideo.seekable.length - 1);
            if (isFinite(edge) && (edge - pipVideo.currentTime) > 8) {
                pipVideo.currentTime = edge - 1.5;
            }
        }, 5000);
    }

    // Load the live stream
    function loadPip(url) {
        pipVideo.style.display = 'block';
        if (pipSnapshot) pipSnapshot.style.display = 'none';
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
            pipHls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { hidePipLoading(); } });
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

    // Fetch stream and load; retry every 30s if unavailable
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
                    pipWaitTimer = setTimeout(fetchAndLoad, 30_000);
                }
            })
            .catch(() => {
                pipWaitTimer = null;
                pipWaitTimer = setTimeout(fetchAndLoad, 30_000);
            });
    }

    // Always show PiP immediately
    pip.classList.add('pip-active');
    fetchAndLoad();
})();

// Start the application
document.addEventListener('DOMContentLoaded', init);

