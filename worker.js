// Cloudflare Worker for RSS Feed Processing
// Handles CORS, caching, and XML parsing server-side

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RSS_FEEDS = {
  proceedings: 'https://clerk.house.gov/Home/Feed',
  news: [
    'https://www.politico.com/rss/playbook.xml',
    'https://thehill.com/homenews/feed/',
    'https://www.rollcall.com/feed/',
    'https://nitter.privacydev.net/JakeSherman/rss',
    'https://nitter.poast.org/JakeSherman/rss'
  ],
  uscp: 'https://www.uscp.gov/daily-arrests',
  bills: 'https://docs.house.gov/BillsThisWeek-RSS.xml',
  votingDays: 'https://votingdays.house.gov/voting-days.ics',
  airportDelays: 'https://nasstatus.faa.gov/api/airport-status-information',
  memberData: 'https://clerk.house.gov/xml/lists/MemberData.xml',
  congressIndex: 'https://clerk.house.gov/evs/2026/index.asp',
  bluesky: 'https://bskyrss.com/did:plc:cr26c7oguulx6ipxdy6bf2it.xml'
};

// DomeWatch API configuration
const DOMEWATCH_CONFIG = {
  apiKey: 'dw_WukWf8avaMpRU7uk7UyHi94ny1pHFsE8',
  baseUrl: 'https://data.domewatch.us/v1'
};

const STREAM_COORDINATOR_OBJECT = 'domewatch-stream-coordinator';
const STREAM_FALLBACK_KEY = '__domewatch_stream_fallback__';

function sseResponseInit() {
  return {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Source-Of-Truth': 'durable-object'
    }
  };
}

async function getStreamCoordinator(env) {
  const id = env.DOMEWATCH_STREAM_COORDINATOR.idFromName(STREAM_COORDINATOR_OBJECT);
  return env.DOMEWATCH_STREAM_COORDINATOR.get(id);
}

async function fetchRSSFeed(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    
    // For congress index, we expect HTML, so don't throw error for HTML responses
    return text;
  } catch (error) {
    throw new Error(`Failed to fetch feed: ${error.message}`);
  }
}

function parseRSSFeed(xmlText, feedType = 'proceedings') {
  try {
    // Parse XML using regex (DOMParser not available in Cloudflare Workers)
    // Handle both RSS (<item>) and Atom (<entry>) formats
    let itemMatches = xmlText.match(/<item[^>]*>[\s\S]*?<\/item>/g);
    let isAtom = false;
    
    if (!itemMatches || itemMatches.length === 0) {
      // Try Atom format
      itemMatches = xmlText.match(/<entry[^>]*>[\s\S]*?<\/entry>/g);
      isAtom = true;
    }
    
    if (!itemMatches || itemMatches.length === 0) {
      return { items: [], error: 'No items found in feed' };
    }

    const parsedItems = itemMatches.map(itemXml => {
      // Extract title
      const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';
      
      // Extract description (handle both <description> and <content>)
      let descMatch = itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/);
      if (!descMatch) {
        descMatch = itemXml.match(/<content[^>]*>([\s\S]*?)<\/content>/);
      }
      const description = descMatch ? descMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';
      
      // Extract pubDate (handle both <pubDate> and <published>/<updated>)
      let pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/);
      if (!pubDateMatch) {
        pubDateMatch = itemXml.match(/<published[^>]*>([\s\S]*?)<\/published>/);
      }
      if (!pubDateMatch) {
        pubDateMatch = itemXml.match(/<updated[^>]*>([\s\S]*?)<\/updated>/);
      }
      const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
      
      // Extract link (handle both <link> content and href attribute)
      let linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/);
      if (!linkMatch) {
        linkMatch = itemXml.match(/<link[^>]*href="([^"]*)"/);
      }
      const link = linkMatch ? (linkMatch[1] || linkMatch[0]).trim() : '';
      
      // Extract source name from feed type
      const getSourceName = (feedUrl) => {
        if (!feedUrl) return 'NEWS';
        const url = feedUrl.toLowerCase();
        if (url.includes('politico')) return 'POLITICO';
        if (url.includes('thehill')) return 'THE HILL';
        if (url.includes('rollcall')) return 'ROLL CALL';
        if (url.includes('jakesherman') || url.includes('nitter') || url.includes('sherman')) return 'SHERMAN';
        return 'NEWS';
      };
      
      // Calculate relative time
      let relativeTime = '';
      if (pubDate) {
        try {
          const itemDate = new Date(pubDate);
          const now = new Date();
          const diffMs = now - itemDate;
          const diffMins = Math.floor(diffMs / 60000);
          const diffHours = Math.floor(diffMs / 3600000);
          const diffDays = Math.floor(diffMs / 86400000);
          
          if (diffDays > 0) {
            relativeTime = `${diffDays}d ago`;
          } else if (diffHours > 0) {
            relativeTime = `${diffHours}h ago`;
          } else if (diffMins > 0) {
            relativeTime = `${diffMins}m ago`;
          } else {
            relativeTime = 'Just now';
          }
        } catch (error) {
          relativeTime = '';
        }
      }
      
      return {
        title: title.trim(),
        link: link.trim(),
        description: description.trim(),
        pubDate: pubDate.trim(),
        timestamp: pubDate ? new Date(pubDate).getTime() : Date.now(),
        relativeTime: relativeTime || 'Just now',
        source: getSourceName(feedType)
      };
    });
    
    return { items: parsedItems, error: null };
  } catch (error) {
    return { items: [], error: `Failed to parse RSS: ${error.message}` };
  }
}

function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else if (diffMins > 0) {
    return `${diffMins}m ago`;
  } else {
    return 'Just now';
  }
}

async function handleProceedings() {
  try {
    const xmlText = await fetchRSSFeed(RSS_FEEDS.proceedings);
    const result = parseRSSFeed(xmlText, 'proceedings');
    
    return new Response(JSON.stringify(result), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=120' // 2 minutes
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      items: [], 
      error: `Failed to fetch proceedings: ${error.message}` 
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
}

async function handleNews() {
  const allItems = [];
  const errors = [];

  // Fetch standard news feeds
  for (const feedUrl of RSS_FEEDS.news) {
    try {
      const xmlText = await fetchRSSFeed(feedUrl);
      const result = parseRSSFeed(xmlText, feedUrl);
      allItems.push(...result.items);
      
      if (result.error) {
        errors.push(`${feedUrl}: ${result.error}`);
      }
    } catch (error) {
      errors.push(`${feedUrl}: ${error.message}`);
    }
  }

  // Fetch and parse USCP Daily Arrests
  try {
    const htmlText = await fetchRSSFeed(RSS_FEEDS.uscp);
    const arrestItems = parseUSCPArrests(htmlText);
    allItems.push(...arrestItems);
  } catch (error) {
    errors.push(`USCP: ${error.message}`);
  }

  // Sort all items by timestamp
  allItems.sort((a, b) => b.timestamp - a.timestamp);

  // Filter to only include articles from the last 72 hours (3 days)
  const cutoffTime = Date.now() - (72 * 60 * 60 * 1000);
  const filteredItems = allItems.filter(item => item.timestamp > cutoffTime);

  return new Response(JSON.stringify({ 
    items: filteredItems,
    errors: errors 
  }), {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300' // 5 minutes
    }
  });
}

function parseUSCPArrests(html) {
  const items = [];
  try {
    // Locate the table body content
    const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!tbodyMatch) return [];

    const rows = tbodyMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
    if (!rows) return [];

    for (const row of rows) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g);
      if (cells && cells.length >= 5) {
        // Clean cell content: remove tags, decode entities, trim
        const clean = (cell) => cell.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
        
        const charge = clean(cells[0]);
        const dateStr = clean(cells[1]);
        const summary = clean(cells[4]);
        
        // Extract only the first part of the summary for the ticker (e.g., first sentence or up to 150 chars)
        const brief = summary.length > 150 ? summary.substring(0, 150) + "..." : summary;
        
        // Parse date for timestamp
        const timestamp = new Date(dateStr).getTime() || Date.now();
        
        items.push({
          title: `ARREST: ${charge} - ${brief}`,
          link: 'https://www.uscp.gov/daily-arrests',
          description: summary,
          pubDate: dateStr,
          timestamp: timestamp,
          relativeTime: getTimeAgo(new Date(timestamp)),
          source: 'USCP'
        });
      }
    }
  } catch (e) {
    console.error('USCP parse error:', e);
  }
  return items;
}

// Helper function to get current week range through Friday
function getWeekRange(date) {
    const today = new Date(date);
    const day = today.getDay();
    
    // Calculate start of current week (Monday or today if weekend)
    let startOfWeek = new Date(today);
    if (day === 0) { // Sunday
        startOfWeek.setDate(today.getDate() - 6); // Go back to Monday
    } else if (day === 6) { // Saturday
        startOfWeek.setDate(today.getDate() - 5); // Go back to Monday
    } else {
        startOfWeek.setDate(today.getDate() - (day - 1)); // Go back to Monday
    }
    
    // Calculate Friday of current week
    const fridayOffset = 5 - 1; // Friday = 5
    const friday = new Date(startOfWeek);
    friday.setDate(startOfWeek.getDate() + fridayOffset);
    
    // Format as "Month Day - Month Day, Year"
    const options = { month: 'short', day: 'numeric' };
    const startStr = startOfWeek.toLocaleDateString('en-US', options);
    const endStr = friday.toLocaleDateString('en-US', options);
    
    return `${startStr} - ${endStr}, ${startOfWeek.getFullYear()}`;
}

function getWeekRangeForDate(date) {
    const current = new Date(date);
    const day = current.getDay();
    const start = new Date(current);

    if (day === 0) {
        start.setDate(current.getDate() - 6);
    } else {
        start.setDate(current.getDate() - (day - 1));
    }

    const end = new Date(start);
    end.setDate(start.getDate() + 4);

    return { start, end };
}

async function handleBills() {
  try {
    // Fetch both House.gov bills and Bluesky updates
    const [billsXmlText, blueskyXmlText] = await Promise.all([
      fetchRSSFeed(RSS_FEEDS.bills),
      fetchRSSFeed(RSS_FEEDS.bluesky)
    ]);
    
    // Parse Atom feed entries
    const entryMatches = billsXmlText.match(/<entry[^>]*>[\s\S]*?<\/entry>/g);
    if (!entryMatches) {
      return new Response(JSON.stringify({ 
        ruleBills: [],
        suspensionBills: [],
        error: 'No entries found in bills feed'
      }), {
        status: 404,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json'
        }
      });
    }
    
    const now = new Date();
    const { start: currentWeekStart, end: currentWeekEnd } = getWeekRangeForDate(now);

    const currentWeekEntries = [];
    const futureWeekEntries = [];

    for (const entryXml of entryMatches) {
      const titleMatch = entryXml.match(/<title[^>]*>([^<]*)<\/title>/);
      const updatedMatch = entryXml.match(/<updated[^>]*>([^<]*)<\/updated>/);
      const contentMatch = entryXml.match(/<content[^>]*>([\s\S]*?)<\/content>/);

      if (!titleMatch || !updatedMatch || !contentMatch) continue;

      const title = titleMatch[1];
      const updated = updatedMatch[1];
      const content = contentMatch[1];
      if (!content.includes('floorItems')) continue;

      const entryDate = new Date(updated);
      if (Number.isNaN(entryDate.getTime())) continue;

      const entryWeekRange = getWeekRangeForDate(entryDate);
      const entry = { title, content, updated, entryDate };

      if (entryWeekRange.start.getTime() === currentWeekStart.getTime()) {
        if (entryDate <= now) {
          currentWeekEntries.push(entry);
        } else {
          futureWeekEntries.push(entry);
        }
      }
    }

    const selectedEntry = currentWeekEntries.sort((a, b) => b.entryDate - a.entryDate)[0]
      || futureWeekEntries.sort((a, b) => b.entryDate - a.entryDate)[0]
      || null;

    if (!selectedEntry) {
      return new Response(JSON.stringify({ 
        ruleBills: [],
        suspensionBills: [],
        weekDate: getWeekRange(now),
        consideredBills: []
      }), {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300'
        }
      });
    }
    
    // Parse Bluesky updates for status information
    const blueskyEntryMatches = blueskyXmlText.match(/<entry>[\s\S]*?<\/entry>/gs);
    const blueskyUpdates = {};
    
    if (blueskyEntryMatches) {
      for (const entryMatch of blueskyEntryMatches) {
        const entryXml = entryMatch[0];
        const contentMatch = entryXml.match(/<content[^>]*>([\s\S]*?)<\/content>/);
        
        if (contentMatch) {
          const cleanContent = contentMatch[1].replace(/<[^>]*>/g, '').trim();
          const billIdMatch = cleanContent.match(/H\.?[Rr]\.? (\d+)/i);
          
          if (billIdMatch) {
            const billId = `H.R. ${billIdMatch[1]}`;
            let status = 'pending';
            let statusText = 'Scheduled for consideration';
            
            if (cleanContent.includes('passed') || cleanContent.includes('agreed to')) {
              status = 'passed';
              statusText = 'Passed';
            } else if (cleanContent.includes('failed') || cleanContent.includes('rejected')) {
              status = 'failed';
              statusText = 'Failed';
            } else if (cleanContent.includes('postponed')) {
              status = 'postponed';
              statusText = 'Postponed';
            }
            
            blueskyUpdates[billId] = { status, statusText };
          }
        }
      }
    }
    
    // Parse HTML content to extract bills
    const ruleBills = [];
    const suspensionBills = [];
    
    const weekDate = getWeekRange(now);
    const contentUpdatedAt = selectedEntry.updated;

    // Parse HTML content using regex
    let content = selectedEntry.content;
    
    // Decode HTML entities
    content = content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    
    const extractSection = (source, startPattern, endPattern) => {
      const start = source.search(startPattern);
      if (start === -1) return '';
      const end = endPattern ? source.slice(start + 1).search(endPattern) : -1;
      return end === -1 ? source.slice(start) : source.slice(start, start + 1 + end);
    };

    const ruleHeaderMatch = content.match(/Items that may be considered pursuant to a rule/i);
    const suspensionHeaderMatch = content.match(/Items that may be considered under suspension of rules/i);

    const ruleSection = extractSection(
      content,
      /Items that may be considered pursuant to a rule/i,
      /Items that may be considered under suspension of rules/i
    );
    const suspensionSection = extractSection(
      content,
      /Items that may be considered under suspension of rules/i,
      /<h[1-6][^>]*>.*?<\/h[1-6]>/i
    );

    const parseBillsFromSection = (sectionHtml, isRule) => {
      const rows = sectionHtml.match(/<tr[^>]*class="floorItem"[^>]*>[\s\S]*?<\/tr>/g) || [];
      console.log(`Found ${rows.length} floorItem rows in ${isRule ? 'rule' : 'suspension'} section`);

      for (const row of rows) {
        const legisNumMatch = row.match(/<td[^>]*class="legisNum"[^>]*>([\s\S]*?)<\/td>/);
        const floorTextMatch = row.match(/<td[^>]*class="floorText"[^>]*>([\s\S]*?)<\/td>/);

        if (!legisNumMatch || !floorTextMatch) continue;

        const legisNum = legisNumMatch[1].replace(/<[^>]*>/g, '').trim();
        const floorText = floorTextMatch[1].replace(/<[^>]*>/g, '').trim();
        if (!legisNum || !floorText || legisNum.includes('::')) continue;

        let billStatus = 'pending';
        let latestAction = 'Pending consideration';
        let considered = false;

        if (/(Passed|Agreed to)/i.test(floorText)) {
          billStatus = 'passed';
          latestAction = 'Passed';
          considered = true;
        } else if (/(Failed|Not Agreed to)/i.test(floorText)) {
          billStatus = 'failed';
          latestAction = 'Failed';
          considered = true;
        } else if (/Postponed/i.test(floorText)) {
          billStatus = 'postponed';
          latestAction = 'Postponed';
          considered = true;
        } else if (/Amended/i.test(floorText)) {
          billStatus = 'amended';
          latestAction = 'Amended';
          considered = true;
        } else if (/considered|consideration|reported|laid over|debated/i.test(floorText)) {
          billStatus = 'considered';
          latestAction = 'Considered';
          considered = true;
        }

        const blueskyUpdate = blueskyUpdates[legisNum];
        const finalStatus = blueskyUpdate ? blueskyUpdate.status : billStatus;
        const finalStatusText = blueskyUpdate ? blueskyUpdate.statusText : latestAction;

        const bill = {
          id: legisNum,
          title: floorText,
          considerationType: isRule ? 'Under Rule' : 'Under Suspension',
          isRule,
          description: '',
          pubDate: new Date(contentUpdatedAt),
          status: finalStatus,
          latestAction: finalStatusText,
          latestActionDate: new Date(contentUpdatedAt),
          considered: considered || !!blueskyUpdate
        };

        if (isRule) {
          ruleBills.push(bill);
        } else {
          suspensionBills.push(bill);
        }
      }
    };

    if (ruleSection) parseBillsFromSection(ruleSection, true);
    if (suspensionSection) parseBillsFromSection(suspensionSection, false);
    
    return new Response(JSON.stringify({
      ruleBills: ruleBills,
      suspensionBills: suspensionBills,
      lastUpdated: new Date(),
      weekDate: weekDate,
      rawHeaders: {
        weekTitle: selectedEntry.title,
        updated: contentUpdatedAt,
        ruleHeader: ruleHeaderMatch ? ruleHeaderMatch[0] : '',
        suspensionHeader: suspensionHeaderMatch ? suspensionHeaderMatch[0] : ''
      },
      consideredBills: [...ruleBills, ...suspensionBills].filter(b => b.considered).map(b => b.id)
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // 5 minutes
      }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ 
      ruleBills: [],
      suspensionBills: [],
      error: `Failed to fetch bills: ${error.message}` 
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
}

async function handleVotingDays() {
  try {
    const icsText = await fetchRSSFeed(RSS_FEEDS.votingDays);
    console.log('ICS text length:', icsText.length);
    console.log('ICS fetch successful, first 200 chars:', icsText.substring(0, 200));
    
    // Enhanced ICS parsing - extract dates and summaries
    const events = [];
    const lines = icsText.split('\n');
    let currentEvent = {};
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine === 'BEGIN:VEVENT') {
        currentEvent = {};
      } else if (trimmedLine === 'END:VEVENT') {
        if (currentEvent.date) {
          events.push({
            date: currentEvent.date,
            summary: currentEvent.summary || 'Voting Day'
          });
          console.log('Found voting day:', currentEvent.date, 'summary:', currentEvent.summary);
        }
        currentEvent = {};
      } else if (trimmedLine.startsWith('DTSTART;VALUE=DATE:')) {
        const dateMatch = trimmedLine.match(/DTSTART;VALUE=DATE:(\d{8})/);
        if (dateMatch) {
          const dateStr = dateMatch[1];
          currentEvent.date = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
        }
      } else if (trimmedLine.startsWith('SUMMARY:')) {
        currentEvent.summary = trimmedLine.substring(8).trim();
      }
    }
    
    console.log('Parsed voting days:', events);
    
    return new Response(JSON.stringify({ 
      votingDays: events.sort((a, b) => new Date(b.date) - new Date(a.date)).reverse() // Sort by date, newest first
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600' // 1 hour
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      votingDays: [], 
      error: `Failed to fetch voting days: ${error.message}` 
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
}

async function handleAirportDelays() {
  try {
    const xmlText = await fetchRSSFeed(RSS_FEEDS.airportDelays);
    
    return new Response(JSON.stringify({ 
      xmlData: xmlText 
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // 5 minutes
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: `Failed to fetch airport delays: ${error.message}` 
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
}

async function handleMemberData() {
  try {
    const xmlText = await fetchRSSFeed(RSS_FEEDS.memberData);
    
    return new Response(JSON.stringify({ 
      xmlData: xmlText 
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600' // 1 hour
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: `Failed to fetch member data: ${error.message}` 
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
}

async function handleCongressIndex() {
  try {
    const htmlText = await fetchRSSFeed(RSS_FEEDS.congressIndex);
    
    // Extract roll call numbers from HTML using regex
    const rollCallPattern = /rollnumber=(\d+)">(\d+)<\/A>/g;
    const rollNumbers = [];
    let match;
    
    while ((match = rollCallPattern.exec(htmlText)) !== null) {
      rollNumbers.push({
        rollNumber: match[1],
        displayNumber: match[2]
      });
    }
    
    // Get the most recent roll number
    const latestRoll = rollNumbers.length > 0 ? rollNumbers[0] : null;
    
    return new Response(JSON.stringify({ 
      htmlData: htmlText,
      rollNumbers: rollNumbers,
      latestRollNumber: latestRoll ? latestRoll.rollNumber : null
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // 5 minutes
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: `Failed to fetch congress index: ${error.message}` 
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
}

async function handleBlueskyFeed() {
  try {
    const xmlText = await fetchRSSFeed(RSS_FEEDS.bluesky);
    
    // Parse Bluesky posts for bill status updates
    const billUpdates = [];
    const entryMatches = xmlText.match(/<entry>[\s\S]*?<\/entry>/gs);
    
    if (entryMatches) {
      for (const entryMatch of entryMatches) {
        const entryXml = entryMatch[0];
        
        const titleMatch = entryXml.match(/<title[^>]*>([^<]*)<\/title>/);
        const updatedMatch = entryXml.match(/<updated[^>]*>([^<]*)<\/updated>/);
        const contentMatch = entryXml.match(/<content[^>]*>([\s\S]*?)<\/content>/);
        const authorMatch = entryXml.match(/<author>[\s\S]*?<name[^>]*>([^<]*)<\/name>/);
        
        if (titleMatch && updatedMatch && contentMatch) {
          const title = titleMatch[1];
          const content = contentMatch[1];
          const author = authorMatch ? authorMatch[1] : 'Unknown';
          
          // Clean up content - remove HTML tags
          const cleanContent = content.replace(/<[^>]*>/g, '').trim();
          
          // Extract bill information from content
          const billIdMatch = cleanContent.match(/H\.?[Rr]\.? (\d+)/i);
          const billId = billIdMatch ? `H.R. ${billIdMatch[1]}` : null;
          
          // Extract bill status
          let status = 'pending';
          let statusText = 'Scheduled for consideration';
          
          if (cleanContent.includes('passed') || cleanContent.includes('agreed to')) {
            status = 'passed';
            statusText = 'Passed';
          } else if (cleanContent.includes('failed') || cleanContent.includes('rejected')) {
            status = 'failed';
            statusText = 'Failed';
          } else if (cleanContent.includes('postponed')) {
            status = 'postponed';
            statusText = 'Postponed';
          } else if (cleanContent.includes('amended')) {
            status = 'amended';
            statusText = 'Amended';
          }
          
          if (billId) {
            billUpdates.push({
              id: billId,
              title: cleanContent.substring(0, 200),
              content: cleanContent,
              author: author,
              status: status,
              statusText: statusText,
              updated: updatedMatch[1],
              timestamp: new Date(updatedMatch[1]).getTime()
            });
          }
        }
      }
    }
    
    // Sort by most recent first
    billUpdates.sort((a, b) => b.timestamp - a.timestamp);
    
    const options = { month: 'long', day: 'numeric', year: 'numeric' };
    const weekDate = new Date().toLocaleDateString('en-US', options);
    
    return new Response(JSON.stringify({
      billUpdates: billUpdates,
      weekDate: weekDate,
      lastUpdated: new Date().toISOString()
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60' // 1 minute
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: `Failed to fetch bluesky feed: ${error.message}`
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
}

async function handleRollCall(rollNumber) {
  try {
    const currentYear = new Date().getFullYear();
    const rollUrl = `https://clerk.house.gov/evs/${currentYear}/roll${rollNumber}.xml`;
    const xmlText = await fetchRSSFeed(rollUrl);
    
    return new Response(xmlText, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=300' // 5 minutes
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: `Failed to fetch roll call ${rollNumber}: ${error.message}` 
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
}

async function handleDomeWatchFloor() {
  try {
    const response = await fetch(`${DOMEWATCH_CONFIG.baseUrl}/floor`, {
      method: 'GET',
      headers: {
        'X-API-Key': DOMEWATCH_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    return new Response(JSON.stringify(data), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=10' // 10 seconds for real-time data
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: `Failed to fetch DomeWatch floor data: ${error.message}` 
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
}

async function handleDomeWatchStream(request, env) {
  try {
    if (env && env.DOMEWATCH_STREAM_COORDINATOR) {
      const coordinator = await getStreamCoordinator(env);
      return await coordinator.fetch(request);
    }
    return await handleDomeWatchStreamFallback(request);
  } catch (error) {
    return await handleDomeWatchStreamFallback(request, error);
  }
}

async function handleDomeWatchStreamFallback(request, priorError = null) {
  if (!globalThis[STREAM_FALLBACK_KEY]) {
    globalThis[STREAM_FALLBACK_KEY] = {
      clients: new Set(),
      upstreamReader: null,
      upstreamConnected: false,
      upstreamReconnects: 0,
      lastEventAt: null,
      lastError: priorError ? priorError.message : null,
      encoder: new TextEncoder()
    };
  }

  const relay = globalThis[STREAM_FALLBACK_KEY];

  const syncRelay = () => {
    relay.clientCount = relay.clients.size;
  };

  const broadcast = (chunk) => {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    const encoded = relay.encoder.encode(text);
    for (const controller of [...relay.clients]) {
      try {
        controller.enqueue(encoded);
      } catch {
        relay.clients.delete(controller);
      }
    }
    syncRelay();
  };

  const ensureUpstream = async () => {
    if (relay.upstreamReader) return;
    relay.upstreamConnected = true;
    syncRelay();

    try {
      const response = await fetch(`${DOMEWATCH_CONFIG.baseUrl}/stream/votes/current`, {
        method: 'GET',
        headers: {
          'X-API-Key': DOMEWATCH_CONFIG.apiKey,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      relay.upstreamReader = reader;
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        relay.lastEventAt = new Date().toISOString();
        broadcast(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      relay.lastError = error.message;
      relay.upstreamReconnects += 1;
      relay.upstreamReader = null;
      relay.upstreamConnected = false;
      syncRelay();
      broadcast(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      setTimeout(() => {
        relay.upstreamReader = null;
        ensureUpstream();
      }, 3000);
    }
  };

  let controllerRef = null;
  const readable = new ReadableStream({
    start: (controller) => {
      controllerRef = controller;
      relay.clients.add(controller);
      syncRelay();
      controller.enqueue(relay.encoder.encode(`event: connected\ndata: ${JSON.stringify({ ok: true, sourceOfTruth: 'worker-singleton-fallback', priorError: priorError?.message || null })}\n\n`));
      ensureUpstream();
    },
    cancel: () => {
      if (controllerRef) {
        relay.clients.delete(controllerRef);
        controllerRef = null;
        syncRelay();
      }
    }
  });

  request.signal?.addEventListener('abort', () => {
    if (controllerRef) {
      relay.clients.delete(controllerRef);
      controllerRef = null;
      syncRelay();
    }
  }, { once: true });

  return new Response(readable, {
    headers: {
      ...sseResponseInit().headers,
      'X-Source-Of-Truth': 'worker-singleton-fallback',
      'X-Connected-Clients': String(relay.clients.size),
      'X-Relay-Mode': 'fallback'
    }
  });
}

function handleOptions() {
  return new Response(null, {
    status: 200,
    headers: CORS_HEADERS
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  // Route handling
  if (path === '/api/proceedings' && request.method === 'GET') {
    return await handleProceedings();
  } else if (path === '/api/news' && request.method === 'GET') {
    return await handleNews();
  } else if (path === '/api/bills' && request.method === 'GET') {
    return await handleBills();
  } else if (path === '/api/voting-days' && request.method === 'GET') {
    return await handleVotingDays();
  } else if (path === '/api/airport-delays' && request.method === 'GET') {
    return await handleAirportDelays();
  } else if (path === '/api/member-data' && request.method === 'GET') {
    return await handleMemberData();
  } else if (path === '/api/congress-index' && request.method === 'GET') {
    return await handleCongressIndex();
  } else if (path === '/api/bluesky' && request.method === 'GET') {
    return await handleBlueskyFeed();
  } else if (path === '/api/domewatch-floor' && request.method === 'GET') {
    return await handleDomeWatchFloor();
  } else if (path === '/api/stream/votes/current' && request.method === 'GET') {
    return await handleDomeWatchStream(request, env);
  } else if (path === '/api/stream/votes/current/status' && request.method === 'GET') {
    const coordinator = await getStreamCoordinator(env);
    return await coordinator.fetch(new Request(request.url, { method: 'POST' }));
  } else if (path.startsWith('/api/congress-index/roll/') && request.method === 'GET') {
    // Handle individual roll call requests
    const rollNumber = path.split('/').pop();
    return await handleRollCall(rollNumber);
  } else if (path === '/api/health' && request.method === 'GET') {
    const coordinator = await getStreamCoordinator(env);
    const streamStatus = await coordinator.fetch(new Request(`${url.origin}/api/stream/votes/current/status?status=1`, { method: 'POST' })).then(r => r.json()).catch(() => null);
    return new Response(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      sourceOfTruth: 'durable-object',
      stream: streamStatus
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  } else if (path.startsWith('/api/congress-index/roll/') && request.method === 'GET') {
    return new Response(JSON.stringify({ 
      error: 'Not found' 
    }), {
      status: 404,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};

export class DomeWatchStreamCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Set();
    this.upstreamReader = null;
    this.upstreamConnected = false;
    this.upstreamReconnects = 0;
    this.lastEventAt = null;
    this.currentEventId = 0;
    this.encoder = new TextEncoder();
    this.health = {
      sourceOfTruth: true,
      upstreamConnected: false,
      connectedClients: 0,
      upstreamReconnects: 0,
      lastEventAt: null,
      lastError: null
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.searchParams.has('status')) {
      return new Response(JSON.stringify(this.getStatus()), {
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS
        }
      });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    let controllerRef = null;
    const readable = new ReadableStream({
      start: (controller) => {
        controllerRef = controller;
        this.clients.add(controller);
        this.syncHealth();
        controller.enqueue(this.encoder.encode(`event: connected\ndata: ${JSON.stringify({ ok: true, sourceOfTruth: true })}\n\n`));
        this.ensureUpstream();
      },
      cancel: () => {
        if (controllerRef) {
          this.clients.delete(controllerRef);
          controllerRef = null;
          this.syncHealth();
        }
      }
    });

    request.signal?.addEventListener('abort', () => {
      if (controllerRef) {
        this.clients.delete(controllerRef);
        controllerRef = null;
        this.syncHealth();
      }
    }, { once: true });

    return new Response(readable, {
      headers: {
        ...sseResponseInit().headers,
        'X-Connected-Clients': String(this.clients.size)
      }
    });
  }

  getStatus() {
    return {
      ...this.health,
      connectedClients: this.clients.size,
      upstreamConnected: this.upstreamConnected,
      upstreamReconnects: this.upstreamReconnects,
      lastEventAt: this.lastEventAt
    };
  }

  syncHealth(extra = {}) {
    this.health = {
      ...this.health,
      ...extra,
      connectedClients: this.clients.size,
      upstreamConnected: this.upstreamConnected,
      upstreamReconnects: this.upstreamReconnects,
      lastEventAt: this.lastEventAt
    };
  }

  async ensureUpstream() {
    if (this.upstreamReader) return;
    this.upstreamConnected = true;
    this.syncHealth();

    try {
      const response = await fetch(`${DOMEWATCH_CONFIG.baseUrl}/stream/votes/current`, {
        method: 'GET',
        headers: {
          'X-API-Key': DOMEWATCH_CONFIG.apiKey,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      this.upstreamReader = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        this.lastEventAt = new Date().toISOString();
        this.syncHealth();
        await this.broadcast(value);
      }
    } catch (error) {
      this.health.lastError = error.message;
      this.upstreamReconnects += 1;
      this.upstreamConnected = false;
      this.upstreamReader = null;
      this.syncHealth();
      await this.broadcast(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      await this.scheduleReconnect();
    }
  }

  async scheduleReconnect() {
    await new Promise(resolve => setTimeout(resolve, 3000));
    this.upstreamReader = null;
    this.ensureUpstream();
  }

  async broadcast(chunk) {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    const encoded = this.encoder.encode(text);
    const dead = [];
    for (const client of this.clients) {
      try {
        client.enqueue(encoded);
      } catch {
        dead.push(client);
      }
    }
    for (const client of dead) {
      this.clients.delete(client);
    }
    this.syncHealth();
  }
}
