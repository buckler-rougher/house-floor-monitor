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
    
    // Find the most recent entry with actual floor content for current week
    let bestEntry = null;
    let mostRecentDate = null;
    
    for (const entryXml of entryMatches) {
      const titleMatch = entryXml.match(/<title[^>]*>([^<]*)<\/title>/);
      const updatedMatch = entryXml.match(/<updated[^>]*>([^<]*)<\/updated>/);
      const contentMatch = entryXml.match(/<content[^>]*>([\s\S]*?)<\/content>/);
      
      if (titleMatch && updatedMatch && contentMatch) {
        const title = titleMatch[1];
        const updated = updatedMatch[1];
        const content = contentMatch[1];
        
        // Look for entries with current year (2026) AND actual floor content
        if (title.includes('2026') && content.includes('floorItems')) {
          const entryDate = new Date(updated);
          
          // Initialize status variables
          let status = 'pending';
          let statusText = 'Pending consideration';
          
          if (!mostRecentDate || entryDate > mostRecentDate) {
            mostRecentDate = entryDate;
            bestEntry = {
              title: title,
              content: content,
              updated: updated,
              status: status,
              statusText: statusText
            };
          }
        }
      }
    }
    
    const mostRecentEntry = bestEntry;
    
    if (!mostRecentEntry) {
      return new Response(JSON.stringify({ 
        ruleBills: [],
        suspensionBills: [],
        weekDate: 'No current week data available'
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
    
    // Use current week date instead of parsing from RSS
    const now = new Date();
    const currentWeek = getWeekRange(now);
    const weekDate = currentWeek;
    
    // Find the best entry for current week (not just most recent)
    let currentWeekEntry = null;
    let currentWeekDate = null;
    
    for (const entryXml of entryMatches) {
      const titleMatch = entryXml.match(/<title[^>]*>([^<]*)<\/title>/);
      const updatedMatch = entryXml.match(/<updated[^>]*>([^<]*)<\/updated>/);
      const contentMatch = entryXml.match(/<content[^>]*>([\s\S]*?)<\/content>/);
      
      if (titleMatch && updatedMatch && contentMatch) {
        const title = titleMatch[1];
        const updated = updatedMatch[1];
        const content = contentMatch[1];
        
        // Look for entries with current year (2026) AND actual floor content
        if (title.includes('2026') && content.includes('floorItems')) {
          const entryDate = new Date(updated);
          
          // Check if this entry is within current week range
          const entryWeekStart = new Date(entryDate);
          const currentWeekStart = new Date(now);
          const day = currentWeekStart.getDay();
          if (day === 0) { // Sunday
            currentWeekStart.setDate(currentWeekStart.getDate() - 6); // Go back to Monday
          } else {
            currentWeekStart.setDate(currentWeekStart.getDate() - (day - 1)); // Go back to Monday
          }
          
          const entryWeekEnd = new Date(currentWeekStart);
          entryWeekEnd.setDate(currentWeekStart.getDate() + 4); // Add 4 days to get to Friday
          
          // Initialize status variables
          let status = 'pending';
          let statusText = 'Pending consideration';
          
          if (entryDate >= currentWeekStart && entryDate <= entryWeekEnd) {
            if (!currentWeekDate || entryDate > currentWeekDate) {
              currentWeekDate = entryDate;
              currentWeekEntry = {
                title: title,
                content: content,
                updated: updated,
                status: status,
                statusText: statusText
              };
            }
          }
        }
      }
    }
    
    // Parse HTML content using regex
    let content = currentWeekEntry.content;
    
    // Decode HTML entities
    content = content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    
    // Extract all floorItem rows from the content
    const allFloorRows = content.match(/<tr[^>]*class="floorItem"[^>]*>[\s\S]*?<\/tr>/g) || [];
    console.log(`Found ${allFloorRows.length} total floorItem rows`);
    
    // Find the rule section to determine context
    const ruleSectionStart = content.indexOf('Items that may be considered pursuant to a rule');
    const suspensionSectionStart = content.indexOf('Items that may be considered under suspension of rules');
    
    for (const row of allFloorRows) {
      const legisNumMatch = row.match(/<td[^>]*class="legisNum"[^>]*>([^<]*)<\/td>/);
      const floorTextMatch = row.match(/<td[^>]*class="floorText"[^>]*>([^<]*)<\/td>/);
      
      if (legisNumMatch && floorTextMatch) {
        const legisNum = legisNumMatch[1].trim();
        const floorText = floorTextMatch[1].trim();
        
        if (legisNum && floorText && !legisNum.includes('::')) {
          // Extract bill status from floor text
          let billStatus = 'pending';
          let latestAction = 'Pending consideration';
          
          if (floorText.includes('Passed') || floorText.includes('Agreed to')) {
            billStatus = 'passed';
            latestAction = 'Passed';
          } else if (floorText.includes('Failed') || floorText.includes('Not Agreed to')) {
            billStatus = 'failed';
            latestAction = 'Failed';
          } else if (floorText.includes('Postponed')) {
            billStatus = 'postponed';
            latestAction = 'Postponed';
          } else if (floorText.includes('Amended')) {
            billStatus = 'amended';
            latestAction = 'Amended';
          }

          // Use Bluesky status update if available
          const blueskyUpdate = blueskyUpdates[legisNum];
          const finalStatus = blueskyUpdate ? blueskyUpdate.status : billStatus;
          const finalStatusText = blueskyUpdate ? blueskyUpdate.statusText : latestAction;
          const finalActionDate = blueskyUpdate ? new Date(mostRecentEntry.updated) : new Date(mostRecentEntry.updated);

          const bill = {
            id: legisNum,
            title: floorText,
            considerationType: '',
            isRule: false,
            description: '',
            pubDate: new Date(mostRecentEntry.updated),
            status: finalStatus,
            latestAction: finalStatusText,
            latestActionDate: finalActionDate
          };
          
          // Determine if this is a rule or suspension bill based on position
          const rowPosition = content.indexOf(row);
          if (rowPosition > ruleSectionStart && ruleSectionStart !== -1) {
            bill.considerationType = 'Under Rule';
            bill.isRule = true;
          } else if (rowPosition > suspensionSectionStart && suspensionSectionStart !== -1) {
            bill.considerationType = 'Under Suspension';
            bill.isRule = false;
          }
          
          if (bill.isRule) {
            ruleBills.push(bill);
          } else {
            suspensionBills.push(bill);
          }
        }
      }
    }
    
    return new Response(JSON.stringify({
      ruleBills: ruleBills,
      suspensionBills: suspensionBills,
      lastUpdated: new Date(),
      weekDate: weekDate
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

async function handleDomeWatchStream() {
  try {
    const response = await fetch(`${DOMEWATCH_CONFIG.baseUrl}/stream/votes/current`, {
      method: 'GET',
      headers: {
        'X-API-Key': DOMEWATCH_CONFIG.apiKey,
        'Content-Type': 'text/event-stream',
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Return the SSE stream directly
    return new Response(response.body, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Cache-Control'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: `Failed to fetch DomeWatch stream: ${error.message}` 
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  }
}

function handleOptions() {
  return new Response(null, {
    status: 200,
    headers: CORS_HEADERS
  });
}

async function handleRequest(request) {
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
    return await handleDomeWatchStream();
  } else if (path.startsWith('/api/congress-index/roll/') && request.method === 'GET') {
    // Handle individual roll call requests
    const rollNumber = path.split('/').pop();
    return await handleRollCall(rollNumber);
  } else if (path === '/api/health' && request.method === 'GET') {
    return new Response(JSON.stringify({ 
      status: 'ok', 
      timestamp: new Date().toISOString() 
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      }
    });
  } else if (path === '/api/stream/votes/current' && request.method === 'GET') {
    return await handleDomeWatchStream();
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

// Event listener for fetch events
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
