// Cloudflare Worker for RSS Feed Processing
// Handles CORS, caching, and XML parsing server-side

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Maximum age (in hours) for items shown in the news scroll — easy to tune
const NEWS_MAX_AGE_HOURS = 48;

// Nitter instances to try for each Twitter account (first success wins)
const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.1d4.us',
  'https://nitter.cz',
];

// Twitter accounts to include in the news scroll
const TWITTER_FEEDS = [
  { handle: 'JakeSherman', label: 'SHERMAN' },
  { handle: 'mkraju',      label: 'RAJU' },
  { handle: 'jamiedupree', label: 'DUPREE' },
];

const RSS_FEEDS = {
  proceedings: 'https://clerk.house.gov/Home/Feed',
  news: [
    'https://www.politico.com/rss/playbook.xml',
    'https://thehill.com/homenews/feed/',
    'https://www.rollcall.com/feed/',
    // Twitter feeds are fetched dynamically in handleNews via TWITTER_FEEDS + NITTER_INSTANCES
  ],
  uscp: 'https://www.uscp.gov/daily-arrests',
  bills: 'https://docs.house.gov/BillsThisWeek-RSS.xml',
  votingDays: 'https://votingdays.house.gov/voting-days.ics',
  airportDelays: 'https://nasstatus.faa.gov/api/airport-status-information',
  memberData: 'https://clerk.house.gov/xml/lists/MemberData.xml',
  congressIndex: 'https://clerk.house.gov/evs/2026/index.asp',
  bluesky: 'https://bskyrss.com/did:plc:sqqvdfeilp5ozvkq3ullwtqo.xml'
};

// DomeWatch API configuration
const DOMEWATCH_CONFIG = {
  apiKey: 'dw_WukWf8avaMpRU7uk7UyHi94ny1pHFsE8',
  baseUrl: 'https://data.domewatch.us/v1'
};

const CONGRESS_API_KEY = '5o7xqvVsCGdjdAIAdDLbdgpayABFrAtPuSfJo3EL';
const CURRENT_CONGRESS = 119;

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
        // Match Twitter handles by checking for the handle in the nitter URL path
        for (const tf of TWITTER_FEEDS) {
          if (url.includes(`/${tf.handle.toLowerCase()}/`)) return tf.label;
        }
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

function parseViewFloorActionsHtml(html) {
  try {
    const items = [];
    // Each row has a hidden span with "MM/DD/YYYY HH:MM:SS" and an Activity td
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const row = rowMatch[1];
      // Extract hidden datetime span: <span style="display:none;">05/15/2026 11:41:57</span>
      const dtMatch = row.match(/<span[^>]*style="display:none;"[^>]*>([\d\/]+ [\d:]+)<\/span>/);
      if (!dtMatch) continue;
      const datetimeStr = dtMatch[1]; // "05/15/2026 11:41:57"
      // Extract Activity td (last td with actual text)
      const tds = [...row.matchAll(/<td[^>]*data-label="Activity"[^>]*>([\s\S]*?)<\/td>/gi)];
      if (!tds.length) continue;
      const tdContent = tds[0][1];
      // Prefer the hidden span which always has the full untruncated text
      const hiddenSpanMatch = tdContent.match(/<span[^>]*style="display:none;"[^>]*>([\s\S]*?)<\/span>/i);
      const description = hiddenSpanMatch
        ? hiddenSpanMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : tdContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!description) continue;
      // Parse datetime: "05/15/2026 11:41:57" -> ISO
      const [datePart, timePart] = datetimeStr.split(' ');
      const [month, day, year] = datePart.split('/');
      const pubDate = new Date(`${year}-${month}-${day}T${timePart}-04:00`).toISOString();
      // Extract time display from the nowrap span
      const timeMatch = row.match(/<span class="nowrap">([\d:]+ [AP]M)<\/span>/);
      const timeDisplay = timeMatch ? timeMatch[1] : timePart;
      items.push({
        title: description.substring(0, 100),
        link: '',
        description: description,
        pubDate,
        timestamp: new Date(pubDate).getTime(),
        relativeTime: timeDisplay,
        source: 'PROCEEDINGS'
      });
    }
    return { items, error: items.length === 0 ? 'No proceedings items found' : null };
  } catch (error) {
    return { items: [], error: `Failed to parse floor actions: ${error.message}` };
  }
}

async function handleProceedings(request) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date'); // expected: mm/dd/yyyy

    if (date) {
      const encodedDate = encodeURIComponent(date);
      const actionsUrl = `https://clerk.house.gov/FloorSummary/ViewFloorActions?date=${encodedDate}`;
      const response = await fetch(actionsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ViewFloorActions`);
      const html = await response.text();
      const result = parseViewFloorActionsHtml(html);
      return new Response(JSON.stringify(result), {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60'
        }
      });
    }

    const xmlText = await fetchRSSFeed(RSS_FEEDS.proceedings);
    const result = parseRSSFeed(xmlText, 'proceedings');

    return new Response(JSON.stringify(result), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=120'
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
      if (result.error) errors.push(`${feedUrl}: ${result.error}`);
    } catch (error) {
      errors.push(`${feedUrl}: ${error.message}`);
    }
  }

  // Fetch Twitter accounts via nitter, trying each instance until one succeeds
  for (const account of TWITTER_FEEDS) {
    let fetched = false;
    for (const instance of NITTER_INSTANCES) {
      const feedUrl = `${instance}/${account.handle}/rss`;
      try {
        const xmlText = await fetchRSSFeed(feedUrl);
        const result = parseRSSFeed(xmlText, feedUrl);
        if (!result.error && result.items.length > 0) {
          allItems.push(...result.items);
          fetched = true;
          break;
        }
      } catch (_) {
        // try next instance
      }
    }
    if (!fetched) errors.push(`Twitter @${account.handle}: all nitter instances failed`);
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

  // Filter to items newer than NEWS_MAX_AGE_HOURS
  const cutoffTime = Date.now() - (NEWS_MAX_AGE_HOURS * 60 * 60 * 1000);
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
    const day = current.getUTCDay();
    // Normalize to UTC midnight so getTime() comparisons work across entries
    const start = new Date(Date.UTC(
        current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()
    ));
    if (day === 0) {
        start.setUTCDate(start.getUTCDate() - 6);
    } else {
        start.setUTCDate(start.getUTCDate() - (day - 1));
    }
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 4);
    return { start, end };
}

// Map bill ID string to Congress.gov type slug
function billIdToCongressType(billId) {
  // Normalize spaces within type abbreviation: "H. Res." → "H.Res.", "H. Con. Res." → "H.Con.Res."
  const norm = billId.trim().replace(/([A-Z])\.\s+(?=[A-Z])/gi, '$1.');
  const m = norm.match(/^(H\.R\.|H\.Con\.Res\.|H\.J\.Res\.|H\.Res\.|S\.Con\.Res\.|S\.J\.Res\.|S\.Res\.|S\.)\s*(\d+)$/i);
  if (!m) return null;
  const typeMap = {
    'h.r.': 'hr', 'h.con.res.': 'hconres', 'h.j.res.': 'hjres',
    'h.res.': 'hres', 's.': 's', 's.con.res.': 'sconres',
    's.j.res.': 'sjres', 's.res.': 'sres',
  };
  const slug = typeMap[m[1].toLowerCase()];
  return slug ? { type: slug, number: m[2] } : null;
}

async function fetchCongressBillSummary(billId) {
  const parsed = billIdToCongressType(billId);
  if (!parsed) return null;
  try {
    const url = `https://api.congress.gov/v3/bill/${CURRENT_CONGRESS}/${parsed.type}/${parsed.number}/summaries?api_key=${CONGRESS_API_KEY}&limit=1&sort=updateDate+desc`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const summaries = data.summaries || [];
    if (!summaries.length) return null;
    const raw = summaries[0].text || '';
    // Strip HTML tags, then strip leading bill citation ("H.R. 1234—" or "H.R. 1234 (119th Congress)—")
    let text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    text = text.replace(/^(?:H\.R\.|S\.|H\.Res\.|S\.Res\.|H\.Con\.Res\.|S\.Con\.Res\.|H\.J\.Res\.|S\.J\.Res\.)\s*\d+(?:\s*\([^)]*\))?\s*[—–\-:]\s*/i, '');
    return text || null;
  } catch {
    return null;
  }
}

async function fetchCongressBillStatus(billId) {
  const parsed = billIdToCongressType(billId);
  if (!parsed) return null;
  try {
    const url = `https://api.congress.gov/v3/bill/${CURRENT_CONGRESS}/${parsed.type}/${parsed.number}/actions?api_key=${CONGRESS_API_KEY}&limit=20&sort=updateDate+desc`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const actions = (data.actions || []).filter(a => a.type === 'Floor');
    for (const action of actions) {
      const t = (action.text || '').toLowerCase();
      const isPassage = t.includes('passed house') || t.includes('agreed to by') ||
                        t.includes('on passage passed') || t.includes('considered and passed') ||
                        t.includes('suspend the rules and pass') || t.includes('suspend the rules and agree');
      const isFailed = t.includes('failed') || t.includes('not agreed to') || t.includes('not passed');
      if (!isPassage && !isFailed) continue;
      let statusText;
      if (isFailed) {
        statusText = 'Failed';
      } else if (t.includes('voice vote') || t.includes('without objection') || t.includes('unanimous consent')) {
        statusText = 'Passed (voice vote)';
      } else if (t.includes('yeas and nays') || t.includes('roll no') || t.includes('record vote no')) {
        statusText = 'Passed (roll call)';
      } else {
        statusText = 'Passed';
      }
      return {
        status: isFailed ? 'failed' : 'passed',
        statusText,
        actionDate: action.actionDate,
        actionText: action.text
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function handleBills(request) {
  try {
    const url = new URL(request.url);
    const dateParam = url.searchParams.get('date'); // e.g. "05/12/2026"

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

    // Use provided date or now; for date override find the week containing that date
    let referenceDate;
    if (dateParam) {
      const parts = dateParam.match(/(\d+)\/(\d+)\/(\d+)/);
      referenceDate = parts
        ? new Date(Date.UTC(Number(parts[3]), Number(parts[1]) - 1, Number(parts[2])))
        : new Date();
    } else {
      referenceDate = new Date();
    }
    const { start: currentWeekStart } = getWeekRangeForDate(referenceDate);

    // Parse "Week of Month Day, Year" from entry title to match by scheduled week,
    // not by publication date (House posts next week's schedule mid-current-week).
    const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    function parseTitleWeekStart(title) {
      const m = title.match(/week of\s+([A-Za-z]+)\s+(\d+),?\s*(\d{4})/i);
      if (!m) return null;
      const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
      if (mon === undefined) return null;
      const d = new Date(Date.UTC(Number(m[3]), mon, Number(m[2])));
      return getWeekRangeForDate(d).start;
    }

    const matchingEntries = [];
    const priorWeekStart = new Date(currentWeekStart);
    priorWeekStart.setUTCDate(priorWeekStart.getUTCDate() - 7);
    const priorEntries = [];

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

      // Match by title-derived week start (most reliable)
      const titleWeekStart = parseTitleWeekStart(title);
      const weekStart = titleWeekStart || getWeekRangeForDate(entryDate).start;

      const entry = { title, content, updated, entryDate };

      if (weekStart.getTime() === currentWeekStart.getTime()) {
        matchingEntries.push(entry);
      } else if (weekStart.getTime() === priorWeekStart.getTime()) {
        priorEntries.push(entry);
      }
    }

    // Use most-recently-updated entry for the target week; fall back to prior week
    const selectedEntry = matchingEntries.sort((a, b) => b.entryDate - a.entryDate)[0]
      || priorEntries.sort((a, b) => b.entryDate - a.entryDate)[0]
      || null;

    if (!selectedEntry) {
      return new Response(JSON.stringify({ 
        ruleBills: [],
        suspensionBills: [],
        weekDate: '',
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
        const entryXml = entryMatch;
        const contentMatch = entryXml.match(/<content[^>]*>([\s\S]*?)<\/content>/);

        if (contentMatch) {
          // Decode HTML-encoded tags and entities
          const raw = contentMatch[1]
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
          const cleanContent = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

          // Match bill IDs: H.R. 1234, H.Con.Res. 75, H.Res. 12, S. 123, H.J.Res. 9
          const billIdMatches = cleanContent.matchAll(/\b(H\.R\.|H\.Con\.Res\.|H\.J\.Res\.|H\.Res\.|S\.)\s*(\d+)/gi);
          for (const m of billIdMatches) {
            const billId = `${m[1].replace(/\.$/, '').replace(/\bS$/, 'S.')} ${m[2]}`.trim();
            // Normalize: "H.R. 1234", "H.Con.Res. 75", etc.
            const normalized = `${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim();
            const lc = cleanContent.toLowerCase();

            let status = 'roll-call';
            let statusText = 'Roll call vote';

            if (/passed by voice vote/i.test(cleanContent)) {
              status = 'passed';
              statusText = 'Passed by voice vote';
            } else if (/\b(passed|agreed to)\b/i.test(cleanContent)) {
              status = 'passed';
              statusText = 'Passed';
            } else if (/\b(failed|not agreed to|rejected)\b/i.test(cleanContent)) {
              status = 'failed';
              statusText = 'Failed';
            } else if (/postponed/i.test(cleanContent)) {
              status = 'postponed';
              statusText = 'Postponed';
            } else if (/vote.*began|began.*vote|passage|final passage/i.test(cleanContent)) {
              status = 'roll-call';
              statusText = 'Roll call vote';
            } else {
              continue; // Don't update status just from a mention without context
            }

            // Only update if this is a stronger status than what we already have
            const existing = blueskyUpdates[normalized];
            const priority = { 'passed': 4, 'failed': 4, 'postponed': 3, 'roll-call': 2 };
            if (!existing || (priority[status] || 0) >= (priority[existing.status] || 0)) {
              blueskyUpdates[normalized] = { status, statusText };
            }
          }
        }
      }
    }
    
    // Parse HTML content to extract bills
    const ruleBills = [];
    const suspensionBills = [];
    
    // Prefer the week stated in the entry title (e.g. "...the Week of May 18, 2026...")
    const titleWeekMatch = selectedEntry.title.match(/week of (.+?)(?:\s*[-–]|$)/i);
    const weekDate = titleWeekMatch ? `Week of ${titleWeekMatch[1].trim()}` : getWeekRange(referenceDate);
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
    const suspensionHeaderMatch = content.match(/Items that may be considered under suspension of the rules/i);

    // Both sections stop at the next h-tag so ordering doesn't matter
    const nextHeader = /<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/i;
    const ruleSection = extractSection(content, /Items that may be considered pursuant to a rule/i, nextHeader);
    const suspensionSection = extractSection(content, /Items that may be considered under suspension of the rules/i, nextHeader);

    const parseBillsFromSection = (sectionHtml, isRule) => {
      const rows = sectionHtml.match(/<tr[^>]*class="floorItem"[^>]*>[\s\S]*?<\/tr>/g) || [];

      for (const row of rows) {
        const legisNumMatch = row.match(/<td[^>]*class="legisNum"[^>]*>([\s\S]*?)<\/td>/);
        const floorTextMatch = row.match(/<td[^>]*class="floorText"[^>]*>([\s\S]*?)<\/td>/);

        if (!legisNumMatch || !floorTextMatch) continue;

        const legisNum = legisNumMatch[1].replace(/<[^>]*>/g, '').trim();
        const floorText = floorTextMatch[1].replace(/<[^>]*>/g, '').trim();
        if (!legisNum || !floorText || legisNum.includes('::')) continue;

        // Default: bill is scheduled but not yet acted upon
        let billStatus = 'scheduled';
        let latestAction = 'Scheduled for consideration';
        let considered = false;

        // Check Bluesky updates for this bill (roll call vote announcements, outcomes)
        const blueskyUpdate = blueskyUpdates[legisNum];
        if (blueskyUpdate) {
          billStatus = blueskyUpdate.status;
          latestAction = blueskyUpdate.statusText;
          considered = true;
        }

        const bill = {
          id: legisNum,
          title: floorText,
          considerationType: isRule ? 'Under Rule' : 'Under Suspension',
          isRule,
          description: '',
          pubDate: new Date(contentUpdatedAt),
          status: billStatus,
          latestAction: latestAction,
          latestActionDate: new Date(contentUpdatedAt),
          considered
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

    // Second pass: enrich with Congress.gov floor actions + summaries
    const allBills = [...ruleBills, ...suspensionBills];
    await Promise.all(allBills.map(async (bill) => {
      const [congressStatus, summary] = await Promise.all([
        fetchCongressBillStatus(bill.id),
        fetchCongressBillSummary(bill.id),
      ]);
      if (congressStatus) {
        bill.status = congressStatus.status;
        bill.latestAction = congressStatus.statusText;
        bill.considered = true;
        if (congressStatus.actionDate) {
          bill.latestActionDate = new Date(congressStatus.actionDate + 'T00:00:00Z');
        }
      }
      if (summary) bill.summary = summary;
    }));
    
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
        const entryXml = entryMatch;

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

async function checkManifestLiveness(streamUrl) {
  try {
    const mResp = await fetch(streamUrl);
    if (!mResp.ok) return null; // URL is dead
    const manifest = await mResp.text();
    if (manifest.includes('#EXT-X-STREAM-INF')) {
      const variantLine = manifest.split('\n').find(l => l.trim() && !l.startsWith('#'));
      if (variantLine) {
        const variantUrl = variantLine.trim().startsWith('http')
          ? variantLine.trim()
          : new URL(variantLine.trim(), streamUrl).href;
        const vResp = await fetch(variantUrl);
        if (!vResp.ok) return null;
        const variantManifest = await vResp.text();
        return !variantManifest.includes('#EXT-X-ENDLIST');
      }
    }
    return !manifest.includes('#EXT-X-ENDLIST');
  } catch {
    return null; // treat as dead
  }
}

async function handleHlsUrl(env) {
  try {
    // Ask the live.house.gov proxy for the current stream URL.
    // Returns 404 when House is not in session.
    const proxyResp = await fetch(
      'https://liveproxy-azapp-prod-eastus2-003.azurewebsites.net/streamingUrl',
      { headers: { 'Accept': 'application/json' } }
    );

    let streamUrl = null;

    if (proxyResp.ok) {
      const raw = await proxyResp.text();
      try {
        const parsed = JSON.parse(raw);
        streamUrl = parsed?.url || parsed?.streamingUrl || parsed?.hlsUrl
                  || (Array.isArray(parsed) ? parsed[0] : null) || null;
        if (!streamUrl) {
          const m = raw.match(/https?:\/\/[^"'\s]+\.m3u8/i);
          if (m) streamUrl = m[0];
        }
      } catch {
        const m = raw.trim().match(/^https?:\/\/\S+/);
        if (m) streamUrl = m[0];
      }
    }

    if (streamUrl) {
      // Check if actually live
      const isLive = await checkManifestLiveness(streamUrl);
      if (isLive !== null) {
        // Save to KV so we can show the last frame later
        if (env?.HLS_CACHE) {
          await env.HLS_CACHE.put('last_url', streamUrl, { expirationTtl: 7 * 24 * 3600 });
        }
        return new Response(JSON.stringify({ url: streamUrl, isLive }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }
        });
      }
    }

    // Liveproxy returned nothing or URL is dead — try last cached URL for last-frame display
    if (env?.HLS_CACHE) {
      const cachedUrl = await env.HLS_CACHE.get('last_url');
      if (cachedUrl) {
        const isLive = await checkManifestLiveness(cachedUrl);
        if (isLive !== null) {
          return new Response(JSON.stringify({ url: cachedUrl, isLive: false }), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
          });
        }
      }
    }

    // Nothing available
    return new Response(JSON.stringify({ url: null, isLive: false }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
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

async function handleLastSessionDate(request) {
  try {
    const url = new URL(request.url);
    const fromDate = url.searchParams.get('before'); // mm/dd/yyyy of the current proceedings
    // Walk backwards from the day before the proceedings date
    const anchor = fromDate ? new Date(fromDate.replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2')) : new Date();
    for (let i = 1; i <= 30; i++) {
      const d = new Date(anchor);
      d.setDate(anchor.getDate() - i);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yyyy = d.getFullYear();
      const dateStr = `${mm}/${dd}/${yyyy}`;
      const encoded = encodeURIComponent(dateStr);
      const res = await fetch(`https://clerk.house.gov/FloorSummary/ViewFloorActions?date=${encoded}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)' }
      });
      if (!res.ok) continue;
      const html = await res.text();
      // Check for actual <tr> rows with datetime data
      if (/<span[^>]*style="display:none;"[^>]*>[\d\/]+ [\d:]+<\/span>/.test(html)) {
        return new Response(JSON.stringify({ date: `${yyyy}-${mm}-${dd}`, formatted: dateStr }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
        });
      }
    }
    throw new Error('No session found in past 30 days');
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}

async function handleLeadership() {
  try {
    const response = await fetch('https://clerk.house.gov/Members/ViewLeadership', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    // Speaker is the first leadership-box_hero section
    // BioGuide ID comes from the image path: /images/members/J000299.jpg
    const bioguideMatch = html.match(/\/images\/members\/([A-Z]\d+)\.jpg/);
    const nameMatch = html.match(/<h1[^>]*>\s*Rep\.\s+([^<]+)<\/h1>/);
    const titleMatch = html.match(/<p class="title"[^>]*>([^<]+)<\/p>/);

    if (!bioguideMatch || !nameMatch) throw new Error('Could not parse Speaker from leadership page');

    const bioguideId = bioguideMatch[1];
    const name = nameMatch[1].trim();
    const title = titleMatch ? titleMatch[1].trim() : 'Speaker of the House';

    return new Response(JSON.stringify({ bioguideId, name, title }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
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
    return await handleProceedings(request);
  } else if (path === '/api/news' && request.method === 'GET') {
    return await handleNews();
  } else if (path === '/api/bills' && request.method === 'GET') {
    return await handleBills(request);
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
  } else if (path === '/api/leadership' && request.method === 'GET') {
    return await handleLeadership();
  } else if (path === '/api/last-session-date' && request.method === 'GET') {
    return await handleLastSessionDate(request);
  } else if (path === '/api/hls-url' && request.method === 'GET') {
    return await handleHlsUrl(env);
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
