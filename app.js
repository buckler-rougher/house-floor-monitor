// Dome Watch - Single Vote Tracker

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
        const now = new Date();
        const options = { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        };
        elements.todayDate.textContent = now.toLocaleDateString('en-US', options);
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
            } else if (todayEvent.summary.toLowerCase().includes('pro-forma')) {
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
                } else if (/^(votes? added|added votes?|added votes? day|added-votes|additional votes?)$/.test(summary)) {
                    type = 'added';
                } else if (/^(votes? cancelled|cancelled votes?|canceled votes?)$/.test(summary)) {
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
        const indicatorRank = type === 'vote-day' ? 0 : type === 'added' ? 1 : 2;
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
    const indicatorTypes = new Set(['vote-day', 'added', 'cancelled']);

    const syncCalendarSizes = () => {
        const monthEls = [prevEl, currentEl, nextEl];
        monthEls.forEach((monthEl) => {
            if (!monthEl) return;
            if (monthEl._calendar) {
                monthEl.style.height = 'auto';
                monthEl._calendar.setOption('height', 'auto');
            }
        });
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
                if (frame) {
                    frame.style.aspectRatio = '1 / 1';
                    frame.style.position = 'relative';
                }
                if (header) {
                    header.style.position = 'relative';
                    header.style.zIndex = '1';
                }
                if (number) {
                    number.style.color = '#e6edf3';
                    number.style.setProperty('color', '#e6edf3', 'important');
                    number.style.fontSize = '7px';
                    number.style.fontWeight = '700';
                    number.style.opacity = '1';
                    number.style.position = 'absolute';
                    number.style.top = '1px';
                    number.style.right = '2px';
                    number.style.zIndex = '2';
                    number.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.7)';
                }
                if (arg.isOther) return;
                const matches = eventMap.get(dateStr) || [];
                const filtered = matches.filter(match => indicatorTypes.has(match.type));
                if (frame && filtered.length) {
                    let labelEl = frame.querySelector('.calendar-event-label');
                    if (!labelEl) {
                        labelEl = document.createElement('span');
                        labelEl.className = 'calendar-event-label';
                        frame.appendChild(labelEl);
                    }
                    labelEl.dataset.type = filtered[0]?.type || 'vote-day';
                    labelEl.textContent = 'VOTES';
                    labelEl.title = filtered.map(match => match.label).join(' | ') || 'Voting Day';
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

// SSE streaming state
let sseConnection = null;
let isStreaming = false;

// SSE Streaming for real-time updates
function startSSEStreaming() {
    if (isStreaming) return;
    
    try {
        isStreaming = true;
        
        // Use worker proxy for SSE streaming to avoid CORS issues
        const eventSource = new EventSource('https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/stream/votes/current');
        
        // Show connecting state initially
        const liveIndicator = document.querySelector('.live-indicator');
        if (liveIndicator) {
            liveIndicator.classList.add('connecting');
            liveIndicator.classList.remove('live');
        }
        
        eventSource.onopen = () => {
            console.log('SSE connection opened');
            // Show subtle live indicator
            const liveIndicator = document.querySelector('.live-indicator');
            if (liveIndicator) {
                liveIndicator.classList.add('live');
                liveIndicator.classList.remove('connecting');
            }
        };
        
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('SSE data received:', data);
                
                // Update floor data state with streaming data
                floorData = {
                    lastUpdated: new Date(),
                    currentStatus: data.now || floorData.currentStatus,
                    rollCall: data.roll_call || floorData.rollCall,
                    voteCounts: data.votes?.counts || floorData.voteCounts,
                    timer: data.timer || floorData.timer,
                    timeline: data.timeline || floorData.timeline
                };
                
                // Update UI with new streaming data
                updateFloorDisplay();
                
            } catch (error) {
                console.error('Error parsing SSE data:', error);
            }
        };
        
        eventSource.onerror = (error) => {
            console.error('SSE error:', error);
            isStreaming = false;
            // Fall back to polling if SSE fails
            setTimeout(() => {
                if (!isStreaming) {
                    console.log('SSE disconnected, falling back to polling');
                    fetchFloorData();
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
async function fetchFloorData() {
    try {
        // Show loading state
        if (elements.voteTitle) {
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

        // Update state with floor data for vote map
        if (floorData.voteCounts) {
            state.data = {
                vote: {
                    yeas: floorData.voteCounts.totals?.yeas || 0,
                    nays: floorData.voteCounts.totals?.nays || 0,
                    present: floorData.voteCounts.totals?.present || 0,
                    not_voting: floorData.voteCounts.totals?.not_voting || 0,
                    title: floorData.rollCall?.question || 'Loading...',
                    id: floorData.rollCall?.number || '--',
                    date: floorData.rollCall?.bill?.considered_on || null,
                    votesNeeded: Math.ceil(((floorData.voteCounts.totals?.yeas || 0) + (floorData.voteCounts.totals?.nays || 0) + (floorData.voteCounts.totals?.present || 0)) / 2) + 1
                }
            };
            console.log('Vote map state updated:', state.data);
        }
        
        // Update missing members
        updateAbsenteeTracking();
        
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
    
    // Auto-switch mode based on DomeWatch status
    const statusLower = (statusText + ' ' + statusValue).toLowerCase();
    if (statusLower.includes('vote')) {
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
            const yeasPct = Math.round((yeas / totalVotes) * 100);
            const naysPct = Math.round((nays / totalVotes) * 100);
            const presentPct = Math.round((present / totalVotes) * 100);
            
            elements.yeasPercent.textContent = `${yeasPct}%`;
            elements.naysPercent.textContent = `${naysPct}%`;
            elements.presentPercent.textContent = `${presentPct}%`;
            
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

        // Update threshold analysis by updating global state first
        state.data = {
            vote: {
                yeas: yeas,
                nays: nays,
                present: present,
                total: totalVotes,
                votesNeeded: 218 // Simple majority threshold
            }
        };
        updateThresholdAnalysis();

        // Update quorum status
        updateQuorumStatus();
    }

    // Update timer if available
    if (floorData.timer && elements.lastUpdate) {
        console.log('=== TIMER UPDATE START ===');
        console.log('Timer data:', floorData.timer);
        console.log('Timer element:', elements.lastUpdate);
        
        const timerValue = floorData.timer.value || '';
        const timestamp = floorData.timer.timestamp ? new Date(floorData.timer.timestamp).toLocaleTimeString() : '';
        const startTimestamp = floorData.timer.timestamp ? new Date(floorData.timer.timestamp).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
        }) : '';
        const secondsRemaining = floorData.timer.seconds_remaining || 0;
        
        console.log('Timer value:', timerValue);
        console.log('Timestamp:', timestamp);
        console.log('Seconds remaining:', secondsRemaining);
        
        // Format timer display - clean and minimal
        let timerText = '';
        let valueClass = '';
        
        if (timerValue && secondsRemaining > 0) {
            timerText = `${timerValue} (${secondsRemaining}s)`;
            valueClass = 'active';
            
            // Add warning status if less than 30 seconds
            if (secondsRemaining < 30) {
                valueClass = 'warning';
            }
        } else if (timerValue) {
            timerText = `${timerValue} (Expired)`;
            valueClass = 'expired';
        } else {
            timerText = timestamp;
            valueClass = '';
        }
        
        const timerElement = document.getElementById('last-update');
        const timerStartElement = document.getElementById('vote-timer-start');
        if (timerElement) {
            // Clear existing classes
            timerElement.className = 'vote-timer-value';
            
            // Apply new classes
            if (valueClass) {
                timerElement.classList.add(valueClass);
            }
            
            // Update text content
            timerElement.textContent = timerText;
        }
        if (timerStartElement) {
            timerStartElement.textContent = startTimestamp ? `STARTED ${startTimestamp}` : '';
            timerStartElement.hidden = !startTimestamp;
        }
        console.log('=== TIMER UPDATE SUCCESS ===');
    } else {
        console.log('=== TIMER UPDATE SKIPPED ===');
        console.log('Timer data available:', !!floorData.timer);
        console.log('Timer element available:', !!elements.lastUpdate);
    }

    // Update timeline info if available
    if (floorData.timeline && elements.nextVotes) {
        const timelineText = floorData.timeline.first_votes?.text || '';
        if (timelineText) {
            elements.nextVotes.textContent = timelineText;
        }
    }
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
    refreshBtn: document.getElementById('refresh-btn'),
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
    debateBillTitle: document.getElementById('debate-bill-title'),
    debateBillId: document.getElementById('debate-bill-id'),
    debateBillSponsor: document.getElementById('debate-bill-sponsor'),
    debateBillDescription: document.getElementById('debate-bill-description'),
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
    workerUrl: 'https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/proceedings',
    refreshInterval: 120000 // 2 minutes
};

// Date override for testing proceedings from a specific date (set via console)
let proceedingsDateOverride = null;

// News Ticker Configuration
const NEWS_CONFIG = {
    workerUrl: 'https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/news',
    refreshInterval: 300000 // 5 minutes
};

// DomeWatch API Configuration
const DOMEWATCH_CONFIG = {
    apiKey: 'dw_WukWf8avaMpRU7uk7UyHi94ny1pHFsE8',
    baseUrl: 'https://data.domewatch.us/v1',
    workerUrl: 'https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/domewatch-floor',
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
    workerUrl: 'https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/member-data',
    refreshInterval: 3600000 // 1 hour
};

const CONGRESS_INDEX_CONFIG = {
    workerUrl: 'https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/congress-index',
    refreshInterval: 300000 // 5 minutes
};

// FAA Airport Status Configuration
const FAA_CONFIG = {
    workerUrl: 'https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/airport-delays',
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

// Fetch FAA airport status information
async function fetchAirportDelays() {
    try {
        if (!elements.airportDelaysList) return;

        // Show loading state
        elements.airportDelaysList.innerHTML = FAA_CONFIG.wasAirports.map(code => `
            <div class="airport-delay-item">
                <span class="airport-code">${code}</span>
                <span class="airport-status loading">LOADING</span>
            </div>
        `).join('');

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
                            const airport = closure.querySelector('ARPT')?.textContent;
                            const reason = closure.querySelector('Reason')?.textContent || 'Airport closed';
                            
                            if (airport) {
                                delays[airport] = {
                                    status: 'delay',
                                    delay: 'CLOSED',
                                    reason: reason,
                                    trend: 'Closed'
                                };
                            }
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
            elements.airportDelaysList.innerHTML = '<div class="airport-delay-item"><span class="airport-status delay">CONNECTION ERROR</span></div>';
        }
    }
}

// Update airport delays display
function updateAirportDelaysDisplay(connectionStatus = 'connected') {
    if (!elements.airportDelaysList || !airportDelays) return;

    // If disconnected, show connection error for all airports
    if (connectionStatus === 'disconnected') {
        elements.airportDelaysList.innerHTML = FAA_CONFIG.wasAirports.map(code => `
            <div class="airport-delay-item">
                <span class="airport-info">${code}</span>
                <span class="airport-status disconnected">NO DATA</span>
            </div>
        `).join('');
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

    elements.airportDelaysList.innerHTML = delaysHtml;
}

// Utility function to format dates
function formatDate(dateStr) {
    // Handle undefined or null dateStr
    if (!dateStr) {
        return 'No date';
    }
    
    // Handle various date formats from gallery
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Parse formats like "4/22/26" or "1/6/26"
    const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
    if (match) {
        const [, month, day, year] = match;
        const fullYear = 2000 + parseInt(year);
        return `${day.padStart(2, '0')} ${monthNames[parseInt(month) - 1]} ${fullYear}`;
    }
    
    // Try parsing ISO date format
    const isoDate = new Date(dateStr);
    if (!isNaN(isoDate.getTime())) {
        const day = isoDate.getDate().toString().padStart(2, '0');
        const month = monthNames[isoDate.getMonth()];
        const year = isoDate.getFullYear();
        return `${day} ${month} ${year}`;
    }
    
    return dateStr; // Return original if can't parse
}

// House Voting Days Configuration
const VOTING_DAYS_CONFIG = {
    workerUrl: 'https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/voting-days',
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
    workerUrl: 'https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/bills',
    refreshInterval: 300000 // 5 minutes
};

// State for bills data
const billDataMap = new Map();

let billsData = {
    ruleBills: [],
    suspensionBills: [],
    rawHeaders: null,
    lastUpdated: null
};
const BLUESKY_CONFIG = {
    workerUrl: 'https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/bluesky',
    refreshInterval: 60000 // 1 minute
};


// Bills This Week Functions
async function fetchBillsThisWeek() {
    console.log('=== BILLS FETCH START ===');
    try {
        console.log('Rule bills list element:', elements.ruleBillsList);
        console.log('Suspension bills list element:', elements.suspensionBillsList);
        
        const billsUrl = proceedingsDateOverride
            ? `${BILLS_CONFIG.workerUrl}?date=${encodeURIComponent(proceedingsDateOverride)}`
            : BILLS_CONFIG.workerUrl;
        const response = await fetch(billsUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        
        console.log('Bills API response:', data);
        
        // Process bills data from worker
        billsData = {
            ruleBills: data.ruleBills || [],
            suspensionBills: data.suspensionBills || [],
            rawHeaders: data.rawHeaders || null,
            lastUpdated: data.lastUpdated || new Date(),
            weekDate: data.weekDate || 'No current week bills available'
        };
        console.log(`Found ${billsData.ruleBills.length} rule bills, ${billsData.suspensionBills.length} suspension bills`);
        
        updateBillsDisplay();
        
    } catch (error) {
        console.error('Error fetching bills:', error);
        if (elements.ruleBillsList) {
            elements.ruleBillsList.innerHTML = '<div class="no-bills">Unable to load bills</div>';
        }
        if (elements.suspensionBillsList) {
            elements.suspensionBillsList.innerHTML = '<div class="no-bills">Unable to load bills</div>';
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

// Update bills display
function updateBillsDisplay() {
    if (!elements.ruleBillsList || !elements.suspensionBillsList) return;

    const billsSection = document.querySelector('.bills-section');
    if (billsSection) {
        const debug = billsSection.querySelector('.bills-raw-headers');
        if (debug) debug.remove();
    }
    
    billDataMap.clear();

    // Update rule bills
    if (billsData.ruleBills.length > 0) {
        const ruleHtml = billsData.ruleBills.map(bill => createBillCard(bill, 'rule')).join('');
        elements.ruleBillsList.innerHTML = ruleHtml;
    } else {
        elements.ruleBillsList.innerHTML = '<div class="no-bills">No bills under rule</div>';
    }

    // Update suspension bills
    if (billsData.suspensionBills.length > 0) {
        const suspensionHtml = billsData.suspensionBills.map(bill => createBillCard(bill, 'suspension')).join('');
        elements.suspensionBillsList.innerHTML = suspensionHtml;
    } else {
        elements.suspensionBillsList.innerHTML = '<div class="no-bills">No bills under suspension</div>';
    }
    
    // Update week date display
    if (elements.billsLastUpdate) {
        elements.billsLastUpdate.textContent = billsData.weekDate || 'THIS WEEK';
    }
}

function createBillCard(bill, procedure) {
    billDataMap.set(bill.id, { ...bill, procedure });
    const statusClass = bill.status || 'scheduled';
    const statusSymbol = bill.status === 'passed' ? '✓' : bill.status === 'failed' ? '✕' : '';
    const actionText = bill.statusText || bill.latestAction || 'Scheduled for consideration';
    const actionDate = bill.latestActionDate ? formatDate(bill.latestActionDate) : '';

    return `
        <div class="bill-card" data-bill-id="${bill.id}" role="button" tabindex="0">
            <div class="bill-status ${statusClass}">${statusSymbol}</div>
            <div class="bill-info">
                <div class="bill-id">${bill.id}</div>
                <div class="bill-title">${bill.title}</div>
                <div class="bill-meta">
                    <div class="bill-action">${actionText}</div>
                    <div class="bill-date">${actionDate}</div>
                </div>
            </div>
            <div class="bill-chevron">›</div>
        </div>
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

function openBillModal(billId) {
    const bill = billDataMap.get(billId);
    if (!bill) return;

    const procedureClass = bill.procedure === 'suspension' ? 'suspension' : 'rule';
    const procedureLabel = bill.procedure === 'suspension' ? 'UNDER SUSPENSION' : 'UNDER RULE';
    const statusClass = bill.status || 'scheduled';
    const statusLabel = { passed: 'PASSED', failed: 'FAILED', 'roll-call': 'VOTE IN PROGRESS' }[bill.status] || 'SCHEDULED';
    const actionText = bill.statusText || bill.latestAction || 'Scheduled for consideration';
    const actionDate = bill.latestActionDate ? formatDate(bill.latestActionDate) : '';
    const congressUrl = billIdToCongressUrl(bill.id);

    // Sponsor HTML (reuse absentee-member classes)
    let sponsorHtml = '';
    if (bill.sponsor) {
        const s = bill.sponsor;
        const pClass = s.party === 'R' ? 'republican' : s.party === 'D' ? 'democrat' : 'independent';
        const pLetter = s.party === 'R' ? 'R' : s.party === 'D' ? 'D' : 'I';
        const name = `${s.firstName} ${s.lastName}`;
        const loc = s.state + (s.district != null ? `-${s.district}` : '');
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

    let overlay = document.getElementById('bill-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'bill-modal-overlay';
        overlay.className = 'bill-modal-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) closeBillModal(); });
    }

    overlay.innerHTML = `
        <div class="bill-modal" role="dialog" aria-modal="true">
            <button class="bill-modal-close" id="bill-modal-close" aria-label="Close">✕</button>
            <div class="bill-modal-top">
                <div class="bill-modal-header">
                    <span class="bill-modal-id">${bill.id}</span>
                    <span class="bill-modal-badge ${statusClass}">${statusLabel}</span>
                    <span class="bill-modal-badge ${procedureClass}">${procedureLabel}</span>
                </div>
                <h2 class="bill-modal-title">${bill.title}</h2>
                ${sponsorHtml}
                ${cosponsorsHtml}
                ${committeeHtml}
            </div>
            ${bill.summary ? `
            <div class="bill-modal-body">
                <div class="bill-modal-section-label">SUMMARY</div>
                <p class="bill-modal-summary">${bill.summary}</p>
            </div>` : ''}
            <div class="bill-modal-foot">
                ${actionText ? `
                <div class="bill-modal-section" style="margin-bottom:12px;">
                    <div class="bill-modal-section-label">LATEST ACTION</div>
                    <div class="bill-modal-action">${actionText}${actionDate ? `<span class="bill-modal-date"> — ${actionDate}</span>` : ''}</div>
                </div>` : ''}
                ${congressUrl ? `<a href="${congressUrl}" class="bill-modal-link ${procedureClass}" target="_blank" rel="noopener">View on Congress.gov →</a>` : ''}
            </div>
        </div>
    `;
    overlay.hidden = false;
    document.getElementById('bill-modal-close').addEventListener('click', closeBillModal);
    document.addEventListener('keydown', onBillModalKey);
}

function closeBillModal() {
    const overlay = document.getElementById('bill-modal-overlay');
    if (overlay) overlay.hidden = true;
    document.removeEventListener('keydown', onBillModalKey);
}

function onBillModalKey(e) {
    if (e.key === 'Escape') closeBillModal();
}

// Auto-switch mode based on latest proceeding
function autoSwitchModeFromProceedings(items) {
    if (!items || items.length === 0) return;

    const latest = items[0].description.toLowerCase();

    // If the most recent proceeding is an adjournment, that's the final word — stay in recess.
    if (latest.includes('adjourn') || latest.includes('the house stands adjourned')) {
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

    const soItem = items.find(i => {
        const d = i.description.toLowerCase();
        return d.includes('special order speech') || d.includes('special orders');
    });
    if (soItem) {
        window.setMode('special-order');
        if (soItem.pubDate && elements.specialOrderTime) {
            elements.specialOrderTime.textContent = new Date(soItem.pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        }
        if (elements.specialOrderDescriptionLine) {
            elements.specialOrderDescriptionLine.textContent = decodeHtml(soItem.description);
        }
        return;
    }

    const omItem = items.find(i => {
        const d = i.description.toLowerCase();
        return d.includes('one minute speech') || d.includes('one-minute speech');
    });
    if (omItem) {
        window.setMode('one-minute');
        if (omItem.pubDate && elements.oneMinuteTime) {
            elements.oneMinuteTime.textContent = new Date(omItem.pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        }
        if (elements.oneMinuteDescriptionLine) {
            elements.oneMinuteDescriptionLine.textContent = decodeHtml(omItem.description);
        }
        return;
    }

    const mhItem = items.find(i => {
        const d = i.description.toLowerCase();
        return d.includes('morning-hour debate') || d.includes('morning hour debate');
    });
    if (mhItem) {
        window.setMode('morning-hour');
        if (mhItem.pubDate && elements.morningHourTime) {
            elements.morningHourTime.textContent = new Date(mhItem.pubDate).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            });
        }
        return;
    }

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
        return;
    }
    if (latest.includes('speaker pro tempore') || latest.includes('pro tempore')) {
        window.setMode('speaker');
        return;
    }

    // Oath and journal can appear anywhere in the day — search all items
    const oathItem = items.find(i => /^OATH OF OFFICE\b/i.test(i.description.trim()));
    if (oathItem) {
        window.setMode('oath');
        return;
    }

    const hasJournal = items.some(i => {
        const d = i.description.toLowerCase();
        return d.includes('approval of the journal') || d.includes('approved the journal') || d.includes('announced approval of the journal');
    });
    if (hasJournal) window.setMode('journal');
}

// Update proceedings feed (autoscroll removed)
async function updateProceedingsFeed() {
    if (!elements.proceedingsFeed) return;

    elements.proceedingsFeed.innerHTML = '<div class="proceedings-loading">FETCHING PROCEEDINGS...</div>';

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
            elements.proceedingsFeed.innerHTML = '<div class="proceedings-error">NO PROCEEDINGS DATA AVAILABLE</div>';
            return;
        }

        // Show the proceedings date in the header span
        const proceedingsDate = proceedingsDateOverride
            ? new Date(proceedingsDateOverride)
            : new Date(data.items[0]?.pubDate || new Date());
        const dateStr = proceedingsDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        if (elements.proceedingsLastUpdate) {
            elements.proceedingsLastUpdate.textContent = dateStr;
        }

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
                    ${escapeHtml(item.description)}
                </div>
            </div>
        `;
        }).join('');

        elements.proceedingsFeed.innerHTML = timelineHtml + html;

        // Auto-switch mode based on latest proceeding
        autoSwitchModeFromProceedings(data.items);

        // Update debate section with latest bill information
        updateDebateSection(data.items);

        // Update prayer and pledge sections
        updatePrayerSection(data.items);
        updatePledgeSection(data.items);
        updateSpeakerSection(data.items);
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
        elements.proceedingsFeed.innerHTML = '<div class="proceedings-error">UNABLE TO FETCH PROCEEDINGS</div>';
    }
}

// Update debate section with bill information
function updateDebateSection(items) {
    if (!elements.debateBillTitle || !items || items.length === 0) return;
    
    // Get the latest item
    const latestItem = items[0];
    
    // Try to extract bill information from the description
    const description = latestItem.description || '';
    
    // Try to find bill number (e.g., H.R. 1234, S. 567)
    const billMatch = description.match(/[HS]\.?\s*R\.?\s*\d+/i);
    const billId = billMatch ? billMatch[0].toUpperCase().replace(/\s/g, '') : 'Unknown Bill';
    
    // Try to find bill title (first sentence or line)
    const titleMatch = description.match(/^(.+?)(?:\n|$)/);
    const billTitle = titleMatch ? titleMatch[1].trim() : description.substring(0, 100);
    
    // Try to find sponsor (looking for patterns like "Sponsor: Rep. Name")
    const sponsorMatch = description.match(/(?:sponsor|by|introduced\s*by):\s*(.+?)(?:\n|,|$)/i);
    const sponsor = sponsorMatch ? sponsorMatch[1].trim() : 'Unknown Sponsor';
    
    // Update debate section elements
    elements.debateBillTitle.textContent = billTitle;
    elements.debateBillId.textContent = billId;
    elements.debateBillSponsor.textContent = `Sponsor: ${sponsor}`;
    elements.debateBillDescription.textContent = description.substring(0, 300) + (description.length > 300 ? '...' : '');
}

// Update prayer section with chaplain information
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
        const res = await fetch(`https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/last-session-date?before=${encodeURIComponent(before)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { date } = await res.json();
        if (date) {
            const d = new Date(date + 'T12:00:00');
            elements.journalLastSessionDate.textContent = d.toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
            });
        }
    } catch (e) {
        console.error('fetchLastSessionDate failed:', e);
    }
}

async function fetchJournalChairInfo(name) {
    try {
        const clean = name.replace(/^(?:Mr\.|Ms\.|Mrs\.|Dr\.|the\s+Honorable)\s+/i, '').trim();
        const lastName = clean.split(/\s+/).pop();
        const memberRes = await fetch('https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/member-data');
        const memberData = await memberRes.json();
        const xml = memberData.xmlData || '';
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
        const res = await fetch('https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/leadership');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (elements.journalChairName) elements.journalChairName.textContent = data.name;
        const memberRes = await fetch('https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/member-data');
        const memberData = await memberRes.json();
        const xml = memberData.xmlData || '';
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
            elements.journalImage.style.display = 'block';
            if (elements.journalImagePlaceholder) elements.journalImagePlaceholder.style.display = 'none';
        }
        if (elements.journalChairWebsite) {
            elements.journalChairWebsite.href = profileUrl;
            elements.journalChairWebsite.textContent = profileUrl;
        }
    }
}

async function fetchSpeakerAsChair() {
    try {
        const response = await fetch('https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/leadership');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        const { bioguideId, name } = data;
        if (elements.pledgeLeaderName) elements.pledgeLeaderName.textContent = name;

        // Fetch member details from member-data XML for party/district/etc
        const memberRes = await fetch('https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/member-data');
        if (!memberRes.ok) throw new Error('member-data failed');
        const memberData = await memberRes.json();
        const xml = memberData.xmlData || '';
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
            elements.pledgeImage.style.display = 'block';
            if (elements.pledgeImagePlaceholder) elements.pledgeImagePlaceholder.style.display = 'none';
        }
        const profileUrl = buildCongressProfileUrl(bioguideId);
        if (elements.pledgeLeaderWebsite) {
            elements.pledgeLeaderWebsite.href = profileUrl;
            elements.pledgeLeaderWebsite.textContent = profileUrl;
        }
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
        elements.speakerMemberWebsite.href = websiteUrl;
        elements.speakerMemberWebsite.textContent = websiteUrl;
const photoUrl = buildBioguidePhotoUrl(match.bioguideId);
        if (elements.speakerImagePlaceholder) elements.speakerImagePlaceholder.style.display = 'none';
        if (elements.speakerImage) {
            elements.speakerImage.onerror = () => {
                if (elements.speakerImagePlaceholder) elements.speakerImagePlaceholder.style.display = 'flex';
                elements.speakerImage.style.display = 'none';
            };
            elements.speakerImage.src = photoUrl;
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
    return district.trim().replace(/^(\d+)(?:st|nd|rd|th)$/i, '$1');
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
            districtNum = ORDINAL_TO_NUM[word] ? String(ORDINAL_TO_NUM[word]) : ordinalMatch[1];
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

        // Try to fetch member data from the worker first
        const workerUrl = `https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/member-data`;
        
        let clerkDataText;
        try {
            const workerResponse = await fetch(workerUrl);
            if (workerResponse.ok) {
                const workerData = await workerResponse.json();
                console.log('Worker response type:', typeof workerData);
                
                if (workerData && workerData.xmlData) {
                    console.log('Worker returned XML data, length:', workerData.xmlData.length);
                    clerkDataText = workerData.xmlData;
                } else {
                    console.log('Worker returned unexpected format:', workerData);
                    throw new Error('Unexpected worker response format');
                }
            } else {
                throw new Error(`Worker returned HTTP ${workerResponse.status}`);
            }
        } catch (workerError) {
            console.log('Worker endpoint failed, cannot fetch data:', workerError);
            showPledgePlaceholder();
            return;
        }

        console.log('Parsing XML data from worker');
        
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
                elements.pledgeLeaderWebsite.href = websiteUrl;
                elements.pledgeLeaderWebsite.textContent = websiteUrl;
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
        if (elements.pledgeLeaderWebsite) {
            elements.pledgeLeaderWebsite.href = '#';
            elements.pledgeLeaderWebsite.textContent = '--';
        }
        showPledgePlaceholder();

    } catch (error) {
        console.error('Error fetching member photo from clerk data:', error);
        elements.pledgePartyTag.textContent = '';
        elements.pledgeTime.textContent = '';
        elements.pledgeLeaderDetails.textContent = '';
        elements.pledgeLeaderAdditional.textContent = '';
        if (elements.pledgeLeaderWebsite) {
            elements.pledgeLeaderWebsite.href = '#';
            elements.pledgeLeaderWebsite.textContent = '--';
        }
        showPledgePlaceholder();
    }
}

let memberDataXmlCache = null;
let memberDataXmlCachePromise = null;

async function getMemberDataXml() {
    if (memberDataXmlCache) return memberDataXmlCache;
    if (memberDataXmlCachePromise) return memberDataXmlCachePromise;

    memberDataXmlCachePromise = (async () => {
        const workerUrl = `https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/member-data`;
        const workerResponse = await fetch(workerUrl);
        if (!workerResponse.ok) {
            throw new Error(`Worker returned HTTP ${workerResponse.status}`);
        }

        const workerData = await workerResponse.json();
        if (!workerData || !workerData.xmlData) {
            throw new Error('Unexpected worker response format');
        }

        memberDataXmlCache = workerData.xmlData;
        return memberDataXmlCache;
    })();

    try {
        return await memberDataXmlCachePromise;
    } finally {
        memberDataXmlCachePromise = null;
    }
}

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
                const districtNum = member.querySelector('district')?.textContent?.replace(/[^0-9]/g, '') || '';
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
            elements.vacanciesList.innerHTML = vacanciesHtml;
        } else {
            elements.vacanciesList.innerHTML = '<div class="no-vacancies">No current vacancies</div>';
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
    
    elements.tickerContent.innerHTML = html;
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
        
        // Step 2: Get current forecast
        const forecastUrl = pointsData.properties.forecast;
        const forecastResponse = await fetch(forecastUrl);
        if (!forecastResponse.ok) throw new Error('Forecast API failed');
        const forecastData = await forecastResponse.json();
        
        // Get current period (first period is usually current)
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
    updateProceedingsFeed();
    fetchBillsThisWeek();
    return `Proceedings date set to ${normalized} — refreshing...`;
};
window.clearDate = function() {
    proceedingsDateOverride = null;
    updateProceedingsFeed();
    fetchBillsThisWeek();
    return 'Date override cleared — back to live feed';
};

// Global mode switch function for console access
window.setMode = function(mode) {
    const validModes = ['vote', 'recess', 'debate', 'prayer', 'silence', 'oath', 'speaker', 'pledge', 'journal', 'morning-hour', 'one-minute', 'special-order', 'joint-meeting', 'message', 'cert-election', 'cert-electoral', 'sine-die', 'new-session', 'admin-oath', 'joint-session'];
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
    document.body.classList.remove('recess-mode', 'debate-mode', 'prayer-mode', 'silence-mode', 'oath-mode', 'speaker-mode', 'pledge-mode', 'journal-mode', 'morning-hour-mode', 'one-minute-mode', 'special-order-mode', 'joint-meeting-mode', 'message-mode', 'cert-election-mode', 'cert-electoral-mode', 'sine-die-mode', 'new-session-mode', 'admin-oath-mode', 'joint-session-mode');

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
    }
}

// Initialize
function init() {
    updateTimestamp();
    setInterval(updateTimestamp, 1000);
    updateTodayDate();
    setInterval(updateTodayDate, 60000); // Update date every minute
    
    elements.refreshBtn.addEventListener('click', fetchFloorData);
    
    // Fetch voting days calendar first
    fetchVotingDays();
    
    // Fetch airport names first
    fetchAirportNames().then(() => {
        // Initialize other data after airport names are loaded
        fetchFloorData(); // Initial DomeWatch floor data fetch
        fetchWeather();
        fetchAirportDelays();
    });
    
    // Start SSE streaming for real-time updates (with polling fallback)
    startSSEStreaming();
    
    // Note: SSE streaming is working, no need for polling fallback
    // setInterval(() => {
    //     if (!isStreaming) {
    //         fetchFloorData();
    //     }
    // }, DOMEWATCH_CONFIG.refreshInterval); // Refresh DomeWatch floor data every 10 seconds if not streaming
    setInterval(fetchWeather, 300000); // Refresh weather every 5 minutes
    setInterval(updateProceedingsFeed, RSS_CONFIG.refreshInterval); // Refresh RSS every 2 minutes
    setInterval(fetchHouseMakeup, HOUSE_MAKEUP_CONFIG.refreshInterval); // Refresh House makeup every 5 minutes
    setInterval(fetchBlueskyFeed, BLUESKY_CONFIG.refreshInterval); // Refresh Bluesky every 1 minute
    setInterval(fetchAirportDelays, FAA_CONFIG.refreshInterval); // Refresh airport delays every 5 minutes
    
    // Initialize
    initWeatherPanel();
    
    // Initialize floor grid
    initFloorGrid();
    
    // Initialize mode toggle
    initModeToggle();
    
    // Fetch initial data
    updateProceedingsFeed();
    fetchHouseMakeup();
    fetchBlueskyFeed();
    fetchNewsTicker();

    initHlsPlayer();

    // Bill card click → modal
    const billsSection = document.querySelector('.bills-section');
    if (billsSection) {
        billsSection.addEventListener('click', e => {
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

async function initHlsPlayer() {
    const video = document.getElementById('player');
    const fallback = document.getElementById('video-fallback');
    const endedLabel = document.getElementById('video-ended-label');
    if (!video) return;

    function showFallback() {
        video.style.visibility = 'hidden';
        fallback.style.display = 'flex';
        fallback.setAttribute('aria-hidden', 'false');
        if (endedLabel) endedLabel.hidden = true;
    }

    function hideFallback() {
        fallback.style.display = 'none';
        fallback.setAttribute('aria-hidden', 'true');
        video.style.visibility = 'visible';
    }

    let streamUrl, isLive;
    try {
        const resp = await fetch('https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/hls-url');
        const data = await resp.json();
        if (!data.url) {
            showFallback();
            return;
        }
        streamUrl = data.url;
        isLive = data.isLive;
    } catch {
        showFallback();
        return;
    }

    function onReady() {
        hideFallback();
        if (isLive) {
            if (endedLabel) endedLabel.hidden = true;
            video.play().catch(() => {});
        } else {
            if (endedLabel) endedLabel.hidden = false;
            // Seek to last frame once duration is known
            function seekToEnd() {
                if (isFinite(video.duration) && video.duration > 1) {
                    video.currentTime = video.duration - 0.5;
                }
            }
            if (isFinite(video.duration) && video.duration > 1) {
                seekToEnd();
            } else {
                video.addEventListener('loadedmetadata', seekToEnd, { once: true });
                video.addEventListener('durationchange', seekToEnd, { once: true });
            }
        }
    }

    if (window.Hls && Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 30 });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, onReady);
        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) showFallback();
        });
        video.addEventListener('ended', () => {
            if (isFinite(video.duration)) video.currentTime = video.duration - 0.05;
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        video.addEventListener('loadedmetadata', onReady, { once: true });
        video.addEventListener('error', showFallback);
        video.addEventListener('ended', () => {
            if (isFinite(video.duration)) video.currentTime = video.duration - 0.05;
        });
    } else {
        showFallback();
    }
}

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
            elements.tickerContent.innerHTML = '<div class="ticker-item">No news available</div>';
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
        elements.tickerContent.innerHTML = continuousContent;
        elements.tickerContent.style.paddingLeft = '0'; 
        // Let CSS handle the animation so hover pause works reliably
        elements.tickerContent.style.animation = ''; 
        
    } catch (error) {
        console.error('News ticker fetch error:', error);
        elements.tickerContent.innerHTML = '<div class="ticker-item">Unable to fetch news</div>';
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

function updateAnalogClock(clockElement, time) {
    if (!clockElement) return;

    const hourDegrees = ((time.hours % 12) * 30) + (time.minutes * 0.5);
    const minuteDegrees = (time.minutes * 6) + (time.seconds * 0.1);
    const secondDegrees = time.seconds * 6;

    clockElement.style.setProperty('--hour-angle', `${hourDegrees}deg`);
    clockElement.style.setProperty('--minute-angle', `${minuteDegrees}deg`);
    clockElement.style.setProperty('--second-angle', `${secondDegrees}deg`);
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
const HOUSE_SEATS = {
    total: 435,
    dem: 213,
    rep: 222
};

const HOUSE_TOTAL_MEMBERS = 435;
const US_CHAMBER_LAYOUT = {
    rows: [25, 31, 37, 43, 49, 55, 61, 67, 67],
    leftParty: 'republican',
    rightParty: 'democrat'
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
    // Remove only existing seats, keep labels
    const existingSeats = container.querySelectorAll('.seat');
    existingSeats.forEach(s => s.remove());

    const seats = createUsChamberLayout(container, US_CHAMBER_LAYOUT);
    seats.forEach((seatData) => {
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
    const floorY = height - 26;
    const innerXRadius = width * 0.16;
    const outerXRadius = width * 0.43;
    const innerYRadius = height * 0.22;
    const outerYRadius = height * 0.72;
    const leftStart = Math.PI * 0.17;
    const leftEnd = Math.PI * 0.47;
    const rightStart = Math.PI * 0.53;
    const rightEnd = Math.PI * 0.83;
    const seats = [];

    config.rows.forEach((count, rowIdx) => {
        const rowProgress = rowIdx / (config.rows.length - 1);
        const xRadius = innerXRadius + (outerXRadius - innerXRadius) * rowProgress;
        const yRadius = innerYRadius + (outerYRadius - innerYRadius) * rowProgress;
        
        for (let i = 0; i < count; i++) {
            const side = i < count / 2 ? -1 : 1;
            const sideIndex = side === -1 ? i : i - Math.ceil(count / 2);
            const sideCount = side === -1 ? Math.ceil(count / 2) : Math.floor(count / 2);
            const sideProgress = sideCount > 1 ? sideIndex / (sideCount - 1) : 0;
            const angle = side === -1
                ? leftStart + (leftEnd - leftStart) * sideProgress
                : rightStart + (rightEnd - rightStart) * sideProgress;
            const x = centerX + xRadius * Math.cos(angle);
            const y = floorY - yRadius * Math.sin(angle);
            
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
        elements.absenteeList.innerHTML = '<div class="absentee-member">ERROR</div>';
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
            // rollDate format: "15-May-2026"
            const parts = rollDate.split('-');
            if (parts.length === 3) {
                const months = {jan:'Jan',feb:'Feb',mar:'Mar',apr:'Apr',may:'May',jun:'Jun',jul:'Jul',aug:'Aug',sep:'Sep',oct:'Oct',nov:'Nov',dec:'Dec'};
                const mon = months[parts[1].toLowerCase().slice(0,3)] || parts[1];
                dateTimeStr = `${mon} ${parseInt(parts[0])}`;
            } else {
                dateTimeStr = rollDate;
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
                </div>
            </div>
        `;}).join('');
        elements.absenteeList.innerHTML = absenteeHtml;
    } else {
        elements.absenteeList.innerHTML = '<div class="absentee-member">ALL MEMBERS VOTED</div>';
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
    const votesRemaining = Math.max(HOUSE_TOTAL_MEMBERS - totalCast, 0);
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
    console.log('=== FLOOR GRID UPDATE START ===');
    console.log('State data:', state.data);
    console.log('State vote:', state.data?.vote);
    
    if (!state.data || !state.data.vote) {
        console.log('No vote data available for floor grid');
        return;
    }
    
    const vote = state.data.vote;
    console.log('Vote data:', vote);
    console.log('Vote counts - yeas:', vote.yeas, 'nays:', vote.nays, 'present:', vote.present);
    
    const seats = elements.floorArch.querySelectorAll('.seat');
    console.log('Found seats:', seats.length);
    
    applyChamberStatuses(Array.from(seats), [
        { status: 'yea', count: vote.yeas },
        { status: 'nay', count: vote.nays },
        { status: 'present', count: vote.present }
    ]);
    
    console.log('=== FLOOR GRID UPDATE COMPLETE ===');
}

function applyChamberStatuses(seats, statuses) {
    const orderedSeats = seats
        .slice()
        .sort((a, b) => {
            const rowDelta = Number(a.dataset.row) - Number(b.dataset.row);
            if (rowDelta !== 0) return rowDelta;
            return Number(a.dataset.seatOrder) - Number(b.dataset.seatOrder);
        });

    let cursor = 0;
    orderedSeats.forEach((seat) => seat.classList.remove('yea', 'nay', 'present'));

    statuses.forEach(({ status, count }) => {
        const safeCount = Math.max(Number(count) || 0, 0);
        const end = Math.min(cursor + safeCount, orderedSeats.length);

        for (let i = cursor; i < end; i++) {
            orderedSeats[i].classList.add(status);
        }
        cursor = end;
    });
}

// Update Quorum Status
async function updateQuorumStatus() {
    try {
        // Get latest roll call data from Clerk (same source as missing members)
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
        
    } catch (error) {
        console.error('Error updating quorum status:', error);
        // Fallback to original logic if Clerk data fails
        if (!state.data || !state.data.vote) return;
        
        const vote = state.data.vote;
        const totalVoted = vote.yeas + vote.nays + vote.present;
        const quorumRequired = 218; // Fallback hardcoded value
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

// Start the application
document.addEventListener('DOMContentLoaded', init);

// Immediate test - this should run as soon as app.js loads
console.log('APP.JS LOADED SUCCESSFULLY');
if (elements.voteTitle) {
    elements.voteTitle.textContent = 'JS LOADED - TESTING FETCH...';
}
