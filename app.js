// Dome Watch - Single Vote Tracker

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
            const eventDate = new Date(event.date);
            eventDate.setHours(0, 0, 0, 0);
            
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
        
        updateSessionStatus();
        
    } catch (error) {
        console.error('Error fetching voting days:', error);
        updateSessionStatus('error');
    }
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
        console.log('Starting SSE streaming...');
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
                    console.log('Falling back to polling...');
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
    console.log('=== FETCH FLOOR DATA START ===');
    console.log('Worker URL:', DOMEWATCH_CONFIG.workerUrl);
    
    try {
        // Show loading state
        if (elements.voteTitle) {
            elements.voteTitle.textContent = 'FETCHING...';
        }
        
        console.log('Starting fetch request...');
        
        // Use worker endpoint instead of direct API call
        const response = await fetch(DOMEWATCH_CONFIG.workerUrl);

        console.log('Response received:');
        console.log('- Status:', response.status);
        console.log('- OK:', response.ok);
        console.log('- Headers:', [...response.headers.entries()]);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('=== API RESPONSE DATA ===');
        console.log('Raw data:', data);
        console.log('Data keys:', Object.keys(data));
        console.log('Current status:', data.now);
        console.log('Vote counts:', data.votes?.counts);
        console.log('Roll call:', data.roll_call);
        
        if (data.error) {
            console.error('API returned error:', data.error);
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

        console.log('=== FLOOR DATA STATE UPDATED ===');
        console.log('Floor data:', floorData);
        
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
                    votesNeeded: Math.ceil((floorData.voteCounts.totals?.yeas || 0 + floorData.voteCounts.totals?.nays || 0 + floorData.voteCounts.totals?.present || 0) / 2) + 1
                }
            };
            console.log('State data updated for vote map:', state.data);
        }
        
        // Update missing members
        updateAbsenteeTracking();
        
        // Update bills
        fetchBillsThisWeek();
        
        // Update vote map
        updateFloorGrid();
        
        // Update UI with new data
        updateFloorDisplay();
        
        console.log('=== FETCH FLOOR DATA SUCCESS ===');
        
    } catch (error) {
        console.error('=== FETCH FLOOR DATA ERROR ===');
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        console.error('Error message:', error.message);
        
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
        console.log('=== TIMER UPDATE SUCCESS ===');
    } else {
        console.log('=== TIMER UPDATE SKIPPED ===');
        console.log('Timer data available:', !!floorData.timer);
        console.log('Timer element available:', !!elements.lastUpdate);
    }

    // Update timeline info if available
    if (floorData.timeline && elements.proceedingsLastUpdate) {
        const timelineText = floorData.timeline.first_votes?.text || '';
        if (timelineText) {
            elements.proceedingsLastUpdate.textContent = timelineText;
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
    pledgeSection: document.getElementById('pledge-section'),
    pledgeImage: document.getElementById('pledge-image'),
    pledgeLeaderTitle: document.getElementById('pledge-leader-title'),
    pledgeLeaderName: document.getElementById('pledge-leader-name'),
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
    floorStatus: document.getElementById('floor-status'),
    // Footer elements
    footerUpdated: document.getElementById('footer-updated')
};

// RSS Feed Configuration
const RSS_CONFIG = {
    workerUrl: 'https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/proceedings',
    refreshInterval: 120000 // 2 minutes
};

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

// Bills This Week Configuration
const BILLS_CONFIG = {
    workerUrl: 'https://dome-watch-worker.pmzzg4fpnj.workers.dev/api/bills',
    refreshInterval: 300000 // 5 minutes
};

// State for bills data
let billsData = {
    ruleBills: [],
    suspensionBills: [],
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
        
        const response = await fetch(BILLS_CONFIG.workerUrl);
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
    
    // Update rule bills
    if (billsData.ruleBills.length > 0) {
        const ruleHtml = billsData.ruleBills.map(bill => createBillCard(bill)).join('');
        elements.ruleBillsList.innerHTML = ruleHtml;
    } else {
        elements.ruleBillsList.innerHTML = '<div class="no-bills">No bills under rule</div>';
    }
    
    // Update suspension bills
    if (billsData.suspensionBills.length > 0) {
        const suspensionHtml = billsData.suspensionBills.map(bill => createBillCard(bill)).join('');
        elements.suspensionBillsList.innerHTML = suspensionHtml;
    } else {
        elements.suspensionBillsList.innerHTML = '<div class="no-bills">No bills under suspension</div>';
    }
    
    // Update week date display
    if (elements.billsLastUpdate) {
        elements.billsLastUpdate.textContent = 'WEEK OF MAY 11-15';
    }
}

function createBillCard(bill) {
    const statusClass = bill.status || 'pending';
    const statusSymbol = bill.status === 'passed' ? '✓' : bill.status === 'failed' ? '✗' : '?';
    const actionText = bill.statusText || bill.latestAction || 'Scheduled for consideration';
    const actionDate = bill.latestActionDate ? formatDate(bill.latestActionDate) : '';
    
    // Add voice vote indicator
    const voiceVoteIndicator = bill.status === 'passed' || bill.status === 'requested' ? 
        '<div class="voice-vote-indicator">📢 Voice Vote</div>' : '';
    
    return `
        <div class="bill-card">
            <div class="bill-status ${statusClass}">${statusSymbol}</div>
            <div class="bill-info">
                <div class="bill-id">${bill.id}</div>
                <div class="bill-title">${bill.title}</div>
                <div class="bill-meta">
                    <div class="bill-action">${actionText}</div>
                    <div class="bill-date">${actionDate}</div>
                    ${voiceVoteIndicator}
                </div>
            </div>
        </div>
    `;
}

// Update proceedings feed (autoscroll removed)
async function updateProceedingsFeed() {
    if (!elements.proceedingsFeed) return;

    elements.proceedingsFeed.innerHTML = '<div class="proceedings-loading">FETCHING PROCEEDINGS...</div>';

    try {
        const response = await fetch(RSS_CONFIG.workerUrl);
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

        // Get the latest date for the source line
        const latestDate = new Date(data.items[0]?.pubDate || new Date());
        const dateStr = latestDate.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });

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

        // Update header with date
        if (elements.proceedingsLastUpdate) {
            elements.proceedingsLastUpdate.textContent = dateStr;
        }
        
        elements.proceedingsFeed.innerHTML = html;

        // Update debate section with latest bill information
        updateDebateSection(data.items);

        // Update prayer and pledge sections
        updatePrayerSection(data.items);
        updatePledgeSection(data.items);

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
        return;
    }

    const description = prayerItem.description;

    // Determine if it's the House Chaplain or a guest chaplain
    const isGuestChaplain = description.toLowerCase().includes('guest') ||
                           description.toLowerCase().includes('invited');

    // Extract chaplain name
    const nameMatch = description.match(/(?:by|led\s*by|offered\s*by):\s*(.+?)(?:\n|,|\.|$)/i);
    const chaplainName = nameMatch ? nameMatch[1].trim() : 'Unknown Chaplain';

    // Extract additional information
    const infoMatch = description.match(/(.+?)(?:prayer|offered)/i);
    const additionalInfo = infoMatch ? infoMatch[1].trim() : '';

    // Update prayer section elements
    elements.prayerLeaderTitle.textContent = isGuestChaplain ? 'Guest Chaplain' : 'House Chaplain';
    elements.prayerLeaderName.textContent = chaplainName;
    elements.prayerLeaderDescription.textContent = additionalInfo || description.substring(0, 200) + (description.length > 200 ? '...' : '');

    // Handle image display
    if (isGuestChaplain) {
        elements.prayerImage.style.display = 'none';
        elements.prayerImage.removeAttribute('src');
        elements.prayerImagePlaceholder.style.display = 'flex';
    } else {
        // For House Chaplain, try to use a standard image
        elements.prayerImagePlaceholder.style.display = 'none';
        elements.prayerImage.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Chaplain_of_the_US_House_of_Representatives_seal.png/240px-Chaplain_of_the_US_House_of_Representatives_seal.png';
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
        return;
    }

    const description = pledgeItem.description;

    // Extract who is leading the pledge
    const nameMatch = description.match(/(?:by|led\s*by):\s*(.+?)(?:\n|,|\.|$)/i);
    const leaderName = nameMatch ? nameMatch[1].trim() : 'Unknown Leader';

    // Update pledge section elements
    elements.pledgeLeaderTitle.textContent = 'Pledge Leader';
    elements.pledgeLeaderName.textContent = leaderName;

    // For now, hide the image since we don't have a reliable source for pledge leader photos
    elements.pledgeImage.style.display = 'none';
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
    
    console.log('Weather panel init, HLS.js available:', !!window.Hls);
    
    panel.addEventListener('mouseenter', () => {
        console.log('Weather panel hover');
        
        if (!videoLoaded) {
            video.muted = true; // Keep muted for autoplay
            
            if (window.Hls && Hls.isSupported()) {
                console.log('Using HLS.js');
                // Disable worker on local files (Safari blocks blob URLs from file:// protocol)
                const isLocalFile = window.location.protocol === 'file:';
                capcamHls = new Hls({ 
                    maxBufferLength: 30,
                    enableWorker: !isLocalFile
                });
                capcamHls.loadSource(CAPCAM_URL);
                capcamHls.attachMedia(video);
                
                capcamHls.on(Hls.Events.MANIFEST_PARSED, () => {
                    console.log('HLS manifest parsed');
                    videoLoaded = true;
                    video.play().catch(err => console.log('Play error:', err));
                });
                
                capcamHls.on(Hls.Events.ERROR, (event, data) => {
                    console.error('HLS Error:', data);
                    if (data.fatal) {
                        capcamHls.destroy();
                        videoLoaded = false;
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                console.log('Using native HLS (Safari)');
                video.src = CAPCAM_URL;
                
                // Safari sometimes fires canplay instead of loadedmetadata
                const onReady = () => {
                    console.log('Video ready (Safari)');
                    videoLoaded = true;
                    video.play().catch(err => console.log('Play error:', err));
                };
                
                video.addEventListener('loadedmetadata', onReady, { once: true });
                video.addEventListener('canplay', onReady, { once: true });
                
                video.addEventListener('error', (err) => {
                    console.error('Video error:', err);
                    console.error('Video error code:', video.error?.code);
                    console.error('Video error message:', video.error?.message);
                    videoLoaded = false;
                });
                
                // Force load for Safari
                video.load();
            } else {
                console.error('HLS not supported');
            }
        } else {
            console.log('Video already loaded, resuming');
            video.play().catch(() => {});
        }
    });
    
    panel.addEventListener('mouseleave', () => {
        console.log('Weather panel leave');
        if (videoLoaded) {
            video.pause();
        }
    });
}

// Initialize mode toggle
function initModeToggle() {
    const modeToggleBtn = document.getElementById('mode-toggle-btn');
    if (!modeToggleBtn) return;

    // Set initial mode to vote
    let currentMode = localStorage.getItem('displayMode') || 'vote';
    modeToggleBtn.setAttribute('data-mode', currentMode);

    // Apply initial mode classes
    updateModeClasses(currentMode);

    // Handle toggle click
    modeToggleBtn.addEventListener('click', () => {
        // Cycle through modes: vote -> recess -> debate -> prayer -> pledge -> vote
        const modes = ['vote', 'recess', 'debate', 'prayer', 'pledge'];
        const currentIndex = modes.indexOf(currentMode);
        currentMode = modes[(currentIndex + 1) % modes.length];

        modeToggleBtn.setAttribute('data-mode', currentMode);
        localStorage.setItem('displayMode', currentMode);

        updateModeClasses(currentMode);
    });
}

function updateModeClasses(mode) {
    // Remove all mode classes
    document.body.classList.remove('recess-mode', 'debate-mode', 'prayer-mode', 'pledge-mode');

    // Add appropriate class based on mode
    if (mode === 'recess') {
        document.body.classList.add('recess-mode');
    } else if (mode === 'debate') {
        document.body.classList.add('debate-mode');
    } else if (mode === 'prayer') {
        document.body.classList.add('prayer-mode');
    } else if (mode === 'pledge') {
        document.body.classList.add('pledge-mode');
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

        // Simple test data first
        const testAbsentees = [
            { name: 'Test Member 1', party: 'rep', state: 'CA', voteType: 'Not Voting' },
            { name: 'Test Member 2', party: 'dem', state: 'NY', voteType: 'Present' }
        ];
        
        updateAbsenteeUI(testAbsentees, '155', 2026);
        console.log('Test data displayed');
        
        // Now try real data
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
                if (vote === 'Not Voting' || vote === 'Present') {
                    const legislator = recordedVote.querySelector('legislator');
                    const name = legislator?.textContent || '';
                    const party = legislator?.getAttribute('party') || '';
                    const state = legislator?.getAttribute('state') || '';
                    
                    absentees.push({
                        name: name.trim(),
                        party: party.toLowerCase().includes('r') ? 'rep' : 'dem',
                        state: state.trim(),
                        voteType: vote
                    });
                }
            });
            
            updateAbsenteeUI(absentees, rollNumber, 2026);
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
function updateAbsenteeUI(absentees, rollNumber, year) {
    if (!elements.absenteeList) return;
    
    // Update counts
    const totalAbsentees = absentees.length;
    const repAbsentees = absentees.filter(a => a.party === 'rep').length;
    const demAbsentees = absentees.filter(a => a.party === 'dem').length;
    
        if (elements.absenteeRep) elements.absenteeRep.textContent = repAbsentees;
    if (elements.absenteeDem) elements.absenteeDem.textContent = demAbsentees;
    if (elements.absenteeTotal) elements.absenteeTotal.textContent = totalAbsentees;
    
    // Update roll call info with date/time
    if (elements.absenteeRollInfo) {
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
        });
        const timeStr = now.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });
        elements.absenteeRollInfo.textContent = `Roll ${rollNumber} • ${dateStr} ${timeStr}`;
    }
    
    // Update absentee list
    if (absentees.length > 0) {
        const absenteeHtml = absentees.map(absentee => `
            <div class="absentee-member ${absentee.party}">
                <span class="absentee-name">${absentee.name}</span>
                <span class="absentee-state">${absentee.state}</span>
                <span class="absentee-vote">${absentee.voteType}</span>
            </div>
        `).join('');
        elements.absenteeList.innerHTML = absenteeHtml;
    } else {
        elements.absenteeList.innerHTML = '<div class="absentee-member">ALL MEMBERS VOTED</div>';
    }
    
    console.log(`Roll ${rollNumber} (${year}): ${totalAbsentees} absentees`);
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
