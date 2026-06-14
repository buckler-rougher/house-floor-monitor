// Cloudflare Worker for RSS Feed Processing
// Handles CORS, caching, and XML parsing server-side

const ALLOWED_ORIGINS = new Set([
  'https://house-floor.evanhollander.org',
  'https://monitor-a6i.pages.dev',
]);
// Populated at the top of handleRequest() for each incoming request
let CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://house-floor.evanhollander.org',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Returns correct CORS headers for a given request object (used by the Durable Object,
// which runs in its own isolate and never goes through handleRequest()).
function corsForRequest(request) {
  const origin = request?.headers?.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://house-floor.evanhollander.org',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ── In-memory cache ──────────────────────────────────────────────────────────
// A Worker isolate handles many concurrent requests from the same Cloudflare PoP.
// Without this, every request calls KV.get() — at 100k reads/day free tier that
// adds up fast for hot endpoints (domewatch-floor 10s TTL, proceedings-live 15s).
// This layer collapses N reads/TTL-window down to 1 KV read per isolate.
const _mem = new Map(); // key → { v: string, exp: number }
function _mGet(k) {
  const e = _mem.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _mem.delete(k); return null; }
  return e.v;
}
function _mSet(k, v, ttlMs) {
  _mem.set(k, { v, exp: Date.now() + ttlMs });
  // Evict expired entries when map grows large
  if (_mem.size > 300) { const n = Date.now(); for (const [k2, e] of _mem) if (n > e.exp) _mem.delete(k2); }
}

// ─── NEWS SETTINGS (easy to tune) ────────────────────────────────────────────
// Max age for ALL news feed items (Politico, Hill, Roll Call, journalists). Hours.
const NEWS_MAX_AGE_HOURS = 48;

// Nitter instances to try for Twitter-based journalist feeds (tried in order).
// CF Workers IPs are sometimes blocked — update this list if feeds stop working.
// RSS URL format: https://{instance}/{twitterHandle}/rss
const NITTER_INSTANCES = [
  'nitter.perennialte.ch',
  'nitter.poast.org',
  'nitter.privacydev.net',
  'nitter.cz',
  'nitter.1d4.us',
  'nitter.nl',
  'nitter.unixfox.eu',
];

const FLOOR_REPORTERS_LIST_ID = '1593329859010301953';

// Journalist feeds.
//   twitter:    Twitter handle — fetched via Nitter RSS (NITTER_INSTANCES list above)
//   blueskyDid: Bluesky DID   — fetched via bskyrss.com
// Set a field to null to skip that source for a journalist.
// To find a Bluesky DID: https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=HANDLE.bsky.social
const JOURNALIST_FEEDS = [
  { label: 'JAKE SHERMAN', twitter: 'JakeSherman', blueskyDid: null },
  { label: 'MANU RAJU',    twitter: 'mkraju',      blueskyDid: null },
  { label: 'JAMIE DUPREE', twitter: null,           blueskyDid: 'did:plc:haw3ukxfc5ppinj2rhd5gcoa' },
];
// ─────────────────────────────────────────────────────────────────────────────

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
  baseUrl: 'https://data.domewatch.us/v1'
};
// Auto-advances on Jan 3 of each odd year. 119th started Jan 3, 2025; 120th starts Jan 3, 2027.
const CURRENT_CONGRESS = (function() {
  const now = new Date();
  const year = now.getFullYear();
  const isAfterJan3 = now.getMonth() > 0 || now.getDate() >= 3;
  const effectiveYear = isAfterJan3 ? year : year - 1;
  const startYear = effectiveYear % 2 === 0 ? effectiveYear - 1 : effectiveYear;
  return 118 + (startYear - 2023) / 2;
}());
// Physical KV storage lifetime for all cached entries.
// Entries never auto-expire so we always have a previous value to compare against.
// Freshness is controlled by the ttlSeconds parameter inside kvCache, not by this TTL.
const KV_STORAGE_TTL = 30 * 24 * 3600; // 30 days
// Resolved per-request from env secrets (set via `wrangler secret put`)
let _congressApiKey = '';
let _domewatchApiKey = '';

const STREAM_COORDINATOR_OBJECT = 'domewatch-stream-coordinator';
const STREAM_FALLBACK_KEY = '__domewatch_stream_fallback__';

function decodeHtmlEntities(str) {
  return str
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
}

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

async function fetchRSSFeed(url, timeoutMs = 8000) {
  try {
    // Append timestamp to bust CDN caches (clerk.house.gov ignores Cache-Control headers)
    const bustUrl = url.includes('?') ? `${url}&_=${Date.now()}` : `${url}?_=${Date.now()}`;
    const response = await fetch(bustUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Cache-Control': 'no-cache, no-store',
        'Pragma': 'no-cache',
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
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
      let title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';

      // Extract description (handle both <description> and <content>)
      let descMatch = itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/);
      if (!descMatch) {
        descMatch = itemXml.match(/<content[^>]*>([\s\S]*?)<\/content>/);
      }
      const description = descMatch ? descMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';

      // bskyrss Atom feeds: <title> is empty, actual post text is in <content type="html">
      // as HTML-entity-encoded HTML. Fall back to content when title is empty.
      if (!title && description) {
        // Decode HTML entities, then strip tags to get plain text
        title = decodeHtmlEntities(description)
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 280); // cap at tweet-length for ticker
      }
      
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
        // Match journalist by twitter handle or bluesky DID embedded in the synthetic URL
        for (const jf of JOURNALIST_FEEDS) {
          if (jf.twitter && url.includes(`/${jf.twitter.toLowerCase()}`)) return jf.label;
          if (jf.blueskyDid && url.includes(jf.blueskyDid.toLowerCase())) return jf.label;
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

async function handleProceedings(request, env) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date'); // expected: mm/dd/yyyy

    if (date) {
      // Today's data accumulates throughout the session; past dates are immutable.
      // ttlSeconds controls how often we re-fetch from origin AND the KV freshness window.
      // Past dates: re-check every 2 hours — compare-and-write will always skip the write
      // since content never changes after the session ends.
      const todayEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const todayStr = `${(todayEt.getMonth()+1).toString().padStart(2,'0')}/${todayEt.getDate().toString().padStart(2,'0')}/${todayEt.getFullYear()}`;
      const isToday = date === todayStr;
      // in-memory TTL: 60s today (live data), 2hr past (immutable).
      // kvFreshTtl: 60s today — matches in-memory TTL so cold isolates always fetch fresh data
      //             (max staleness = 60s). Write-on-change means KV writes only happen when
      //             floor actions actually change during the session, so write count stays low.
      //             7200s past (re-check every 2hr; compare always skips write — data never changes).
      const dateTtl = isToday ? 15 : 2 * 3600;
      const dateKvFresh = isToday ? 15 : 2 * 3600;
      return kvCache(env, `proceedings-date:${date}`, dateTtl, async () => {
        const encodedDate = encodeURIComponent(date);
        const actionsUrl = `https://clerk.house.gov/FloorSummary/ViewFloorActions?date=${encodedDate}`;
        const response = await fetch(actionsUrl, {
          signal: AbortSignal.timeout(10000),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status} from ViewFloorActions`);
        const html = await response.text();
        const result = parseViewFloorActionsHtml(html);
        return new Response(JSON.stringify(result), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${dateTtl}` }
        });
      }, dateKvFresh);
    }

    // Live feed — in-memory 15s only; skip KV (kvTtl=0) to avoid 288 writes/day
    return kvCache(env, 'proceedings-live', 5, async () => {
      const xmlText = await fetchRSSFeed(RSS_FEEDS.proceedings, 10000);
      const result = parseRSSFeed(xmlText, 'proceedings');
      return new Response(JSON.stringify(result), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' }
      });
    }, 0);
  } catch (error) {
    return new Response(JSON.stringify({ items: [], error: `Failed to fetch proceedings: ${error.message}` }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
}

function parseTweetDescription(html, instance) {
  if (!html) return { tweetHtml: '', tweetImages: [], cardImage: null, quoteAuthor: null, quoteHtml: null, quoteUrl: null };

  const escaped = instance.replace(/\./g, '\\.');
  const rewriteUrl = url =>
    url.replace(new RegExp(`https?://${escaped}/`), 'https://twitter.com/').replace(/#m$/, '');

  // Split at <hr/> — everything before is the main tweet, after is quote tweet
  const [mainPart = '', quotePart = ''] = html.split(/<hr\s*\/?>/i);

  // Extract first <p> as tweet HTML
  const pMatch = mainPart.match(/<p>([\s\S]*?)<\/p>/i);
  let tweetHtml = pMatch ? pMatch[1] : mainPart.replace(/<(?!br)[^>]+>/g, '').trim();

  // Rewrite hrefs, add target=_blank, strip title attrs
  tweetHtml = tweetHtml
    .replace(/href="([^"]+)"/g, (_, h) => `href="${rewriteUrl(h)}"`)
    .replace(/<a /g, '<a target="_blank" rel="noopener" ')
    .replace(/ title="[^"]*"/g, '')
    .replace(/<br\s*\/?>/gi, '<br>');

  // Collect images from full description
  const tweetImages = [], cardImageArr = [];
  for (const [, src] of html.matchAll(/<img\s+src="([^"]+)"/g)) {
    const absolute = src.startsWith('http') ? src : `https://${instance}${src}`;
    const proxied = `https://api.evanhollander.org/house-floor/api/img-proxy?v=2&url=${encodeURIComponent(absolute)}`;
    if (src.includes('card_img')) { if (!cardImageArr.length) cardImageArr.push(proxied); }
    else if (src.includes('/pic/')) tweetImages.push(proxied);
  }

  // Extract quote tweet from blockquote in quotePart
  let quoteAuthor = null, quoteHtml = null, quoteUrl = null;
  const bqMatch = quotePart.match(/<blockquote>([\s\S]*?)<\/blockquote>/i);
  if (bqMatch) {
    const bqInner = bqMatch[1];
    const authorM = bqInner.match(/<b>([^<]+)<\/b>/);
    quoteAuthor = authorM ? authorM[1].trim() : null;
    const qpM = bqInner.match(/<p>([\s\S]*?)<\/p>/i);
    if (qpM) {
      quoteHtml = qpM[1]
        .replace(/href="([^"]+)"/g, (_, h) => `href="${rewriteUrl(h)}"`)
        .replace(/<a /g, '<a target="_blank" rel="noopener" ')
        .replace(/ title="[^"]*"/g, '')
        .replace(/<br\s*\/?>/gi, '<br>');
    }
    // Extract the URL of the quoted tweet from the main tweet body —
    // nitter appends a link to the quoted status at the end of mainPart before <hr/>
    const allStatusLinks = [...mainPart.matchAll(/href="([^"]*\/status\/[^"#]+)"/gi)];
    if (allStatusLinks.length) quoteUrl = rewriteUrl(allStatusLinks[allStatusLinks.length - 1][1]);
  }

  return { tweetHtml, tweetImages, cardImage: cardImageArr[0] || null, quoteAuthor, quoteHtml, quoteUrl };
}


async function handleTweets(env) {
  return kvCache(env, 'tweets-feed-v3', 120, async () => {
    let rawXml = null, usedInstance = null;
    for (const instance of NITTER_INSTANCES) {
      try {
        const url = `https://${instance}/i/lists/${FLOOR_REPORTERS_LIST_ID}/rss`;
        const xml = await fetchRSSFeed(url, 6000);
        if (!xml || xml.includes('RSS feed is disabled') || xml.includes('Error |') || !xml.includes('<item>')) continue;
        rawXml = xml; usedInstance = instance; break;
      } catch (_) { continue; }
    }
    if (!rawXml || !usedInstance) {
      return new Response(JSON.stringify({ tweets: [] }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const getTag = (tag, xml) => {
      const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
    };

    const tweets = (rawXml.match(/<item[^>]*>[\s\S]*?<\/item>/g) || []).slice(0, 30).map(itemXml => {
      const creator = getTag('dc:creator', itemXml);
      let title = getTag('title', itemXml);
      const description = getTag('description', itemXml);
      let link = getTag('link', itemXml).replace(/^https?:\/\/[^/]+\//, 'https://twitter.com/').replace(/#m$/, '');
      const pubDate = getTag('pubDate', itemXml);

      // RT detection
      let isRT = false, rtBy = null, isReply = false, replyTo = null;
      const rtM = title.match(/^RT by (@\w+):\s*/);
      if (rtM) { isRT = true; rtBy = rtM[1]; title = title.slice(rtM[0].length); }
      const replyM = title.match(/^R to (@\w+):\s*/);
      if (replyM) { isReply = true; replyTo = replyM[1]; title = title.slice(replyM[0].length); }

      // Handle from link or dc:creator
      const hM = link.match(/twitter\.com\/([^/]+)\/status\//);
      const handle = hM ? `@${hM[1]}` : (creator || '');

      // Relative time
      let relativeTime = '';
      try {
        const diff = Math.floor((Date.now() - new Date(pubDate).getTime()) / 60000);
        relativeTime = diff < 1 ? 'now' : diff < 60 ? `${diff}m` : diff < 1440 ? `${Math.floor(diff/60)}h` : `${Math.floor(diff/1440)}d`;
      } catch (_) {}

      const { tweetHtml, tweetImages, cardImage, quoteAuthor, quoteHtml, quoteUrl } = parseTweetDescription(description, usedInstance);
      return { handle, relativeTime, pubDate, link, isRT, rtBy, isReply, replyTo, title, html: tweetHtml, images: tweetImages, cardImage, quoteAuthor, quoteHtml, quoteUrl };
    });

    return new Response(JSON.stringify({ tweets }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' }
    });
  }, 300);
}

// Fetch a single user's Nitter profile feed — same output format as handleTweets.
async function handleUserTweets(handle) {
  let rawXml = null, usedInstance = null;
  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `https://${instance}/${handle}/rss`;
      const xml = await fetchRSSFeed(url, 6000);
      if (!xml || xml.includes('RSS feed is disabled') || xml.includes('Error |') || !xml.includes('<item>')) continue;
      rawXml = xml; usedInstance = instance; break;
    } catch (_) { continue; }
  }
  if (!rawXml || !usedInstance) {
    return new Response(JSON.stringify({ tweets: [] }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  const getTag = (tag, xml) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
  };

  const tweets = (rawXml.match(/<item[^>]*>[\s\S]*?<\/item>/g) || []).slice(0, 30).map(itemXml => {
    const creator = getTag('dc:creator', itemXml);
    let title = getTag('title', itemXml);
    const description = getTag('description', itemXml);
    let link = getTag('link', itemXml).replace(/^https?:\/\/[^/]+\//, 'https://twitter.com/').replace(/#m$/, '');
    const pubDate = getTag('pubDate', itemXml);

    let isRT = false, rtBy = null, isReply = false, replyTo = null;
    const rtM = title.match(/^RT by (@\w+):\s*/);
    if (rtM) { isRT = true; rtBy = rtM[1]; title = title.slice(rtM[0].length); }
    const replyM = title.match(/^R to (@\w+):\s*/);
    if (replyM) { isReply = true; replyTo = replyM[1]; title = title.slice(replyM[0].length); }

    const hM = link.match(/twitter\.com\/([^/]+)\/status\//);
    const tweetHandle = hM ? `@${hM[1]}` : (creator ? `@${handle}` : `@${handle}`);

    let relativeTime = '';
    try {
      const diff = Math.floor((Date.now() - new Date(pubDate).getTime()) / 60000);
      relativeTime = diff < 1 ? 'now' : diff < 60 ? `${diff}m` : diff < 1440 ? `${Math.floor(diff/60)}h` : `${Math.floor(diff/1440)}d`;
    } catch (_) {}

    const { tweetHtml, tweetImages, cardImage, quoteAuthor, quoteHtml, quoteUrl } = parseTweetDescription(description, usedInstance);
    return { handle: tweetHandle, relativeTime, pubDate, link, isRT, rtBy, isReply, replyTo, title, html: tweetHtml, images: tweetImages, cardImage, quoteAuthor, quoteHtml, quoteUrl };
  });

  return new Response(JSON.stringify({ tweets }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
  });
}

async function handleImageProxy(request) {
  const url = new URL(request.url);
  const imageUrl = url.searchParams.get('url');
  if (!imageUrl) return new Response('Missing url', { status: 400, headers: CORS_HEADERS });

  // Nitter /pic/ URLs encode the Twitter CDN path directly.
  // e.g. http://nitter.x/pic/media%2FXXX.jpg → https://pbs.twimg.com/media/XXX.jpg
  // Fetch from pbs.twimg.com directly to bypass Cloudflare bot protection on nitter.
  let fetchUrl;
  const picMatch = imageUrl.match(/\/pic\/(.+)$/);
  if (picMatch) {
    fetchUrl = `https://pbs.twimg.com/${decodeURIComponent(picMatch[1])}`;
  } else {
    // Fallback: only allow known nitter hostnames
    let allowed = false;
    try { const p = new URL(imageUrl); allowed = NITTER_INSTANCES.some(i => p.hostname === i); } catch (_) {}
    if (!allowed) return new Response('Forbidden', { status: 403, headers: CORS_HEADERS });
    fetchUrl = imageUrl;
  }

  try {
    const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(8000) });
    return new Response(resp.body, {
      headers: { ...CORS_HEADERS, 'Content-Type': resp.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }
    });
  } catch (e) { return new Response('Failed', { status: 502, headers: CORS_HEADERS }); }
}

// Fetch one nitter account — tries instances in parallel with a short per-instance
// timeout and returns the first batch of items that comes back non-empty.
async function fetchNitterFeed(handle) {
  const results = await Promise.allSettled(
    NITTER_INSTANCES.map(async instance => {
      const url = `https://${instance}/${handle}/rss`;
      const xml = await fetchRSSFeed(url, 5000);
      const parsed = parseRSSFeed(xml, url);
      if (parsed.error || !parsed.items.length) throw new Error('empty');
      return parsed.items;
    })
  );
  for (const r of results) {
    if (r.status === 'fulfilled') return r.value;
  }
  return [];
}

async function handleNews(env) {
  // In-memory TTL 5 min; KV TTL 30 min — news items are hours old, cross-PoP staleness is imperceptible.
  return kvCache(env, 'news-feed', 300, async () => {
  const errors = [];

  // All independent fetches run in parallel
  const [stdResults, uscpResult, journalistResults] = await Promise.all([
    // Standard RSS feeds (Politico, Hill, Roll Call)
    Promise.allSettled(RSS_FEEDS.news.map(async feedUrl => {
      const xml = await fetchRSSFeed(feedUrl);
      return parseRSSFeed(xml, feedUrl);
    })),
    // USCP daily arrests
    fetchRSSFeed(RSS_FEEDS.uscp).then(html => ({ arrests: parseUSCPArrests(html) })).catch(() => ({ arrests: [] })),
    // Journalist feeds (Bluesky + nitter) — each account in parallel
    Promise.allSettled(JOURNALIST_FEEDS.map(async account => {
      if (account.blueskyDid) {
        const url = `https://bskyrss.com/${account.blueskyDid}.xml`;
        const xml = await fetchRSSFeed(url, 5000);
        const parsed = parseRSSFeed(xml, url);
        if (!parsed.error && parsed.items.length) return parsed.items;
      }
      if (account.twitter) return fetchNitterFeed(account.twitter);
      return [];
    })),
  ]);

  const allItems = [];
  for (const r of stdResults) {
    if (r.status === 'fulfilled') {
      allItems.push(...r.value.items);
      if (r.value.error) errors.push(r.value.error);
    } else {
      errors.push(r.reason?.message ?? String(r.reason));
    }
  }
  allItems.push(...uscpResult.arrests);

  const journalistItems = journalistResults.flatMap(r => r.status === 'fulfilled' ? (r.value ?? []) : []);

  const cutoff = Date.now() - NEWS_MAX_AGE_HOURS * 3600_000;
  const filteredItems = [...allItems, ...journalistItems]
    .filter(item => item.timestamp > cutoff)
    .sort((a, b) => b.timestamp - a.timestamp);

  return new Response(JSON.stringify({ items: filteredItems, errors }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
  });
  }, 1800); // kvFreshTtl=1800s — re-check KV every 30 min; in-memory TTL is 5 min
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
const W_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function wFmtDate(d) {
    return `${String(d.getDate()).padStart(2, '0')} ${W_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function getWeekRange(date) {
    const today = new Date(date);
    const day = today.getDay();

    let startOfWeek = new Date(today);
    if (day === 0) startOfWeek.setDate(today.getDate() - 6);
    else if (day === 6) startOfWeek.setDate(today.getDate() - 5);
    else startOfWeek.setDate(today.getDate() - (day - 1));

    const friday = new Date(startOfWeek);
    friday.setDate(startOfWeek.getDate() + 4);

    // "18 May – 22 May 2026"
    const startStr = `${String(startOfWeek.getDate()).padStart(2, '0')} ${W_MONTHS[startOfWeek.getMonth()]}`;
    const endStr = `${String(friday.getDate()).padStart(2, '0')} ${W_MONTHS[friday.getMonth()]} ${friday.getFullYear()}`;
    return `${startStr} – ${endStr}`;
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

// ── Proceedings → Bill Status ────────────────────────────────────────────────
// Convert a Congress.gov bill URL to our canonical bill ID string.
// e.g. ".../house-bill/5317" → "H.R. 5317"
const CONGRESS_URL_PREFIX = {
  'house-bill':                  'H.R.',
  'senate-bill':                 'S.',
  'house-concurrent-resolution': 'H.Con.Res.',
  'house-joint-resolution':      'H.J.Res.',
  'house-resolution':            'H.Res.',   // actual Congress.gov URL segment
  'house-simple-resolution':     'H.Res.',   // alias, just in case
  'senate-concurrent-resolution':'S.Con.Res.',
  'senate-joint-resolution':     'S.J.Res.',
  'senate-resolution':           'S.Res.',   // actual Congress.gov URL segment
  'senate-simple-resolution':    'S.Res.',   // alias, just in case
};
function congressUrlToBillId(url) {
  const m = url.match(/congress\.gov\/bill\/[^/]+\/([^/?#]+)\/(\d+)/i);
  if (!m) return null;
  const prefix = CONGRESS_URL_PREFIX[m[1].toLowerCase()];
  return prefix ? `${prefix} ${m[2]}` : null;
}

// Fetch House floor actions for every session day this week (Monday through today, ET).
// Checking the full week prevents bills passed earlier in the week from losing their
// status on later page loads when Congress.gov lags or the KV cache hasn't warmed yet.
// Returns { "H.R. 5317": { status: "passed", statusText: "Passed 405-0" }, ... }
// Later days win over earlier days (spread order: oldest first, today last).
async function fetchProceedingsBillStatuses() {
  try {
    const now = new Date();
    const etOffset = (now.getUTCMonth() >= 2 && now.getUTCMonth() <= 10) ? -4 : -5;
    const etNow = new Date(now.getTime() + etOffset * 3600000);

    const fmtClerk = (d) => {
      const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd   = String(d.getUTCDate()).padStart(2, '0');
      const yyyy = d.getUTCFullYear();
      return `${mm}/${dd}/${yyyy}`;
    };

    // Build list of dates from Monday through today (ET), skipping weekends.
    const dow = etNow.getUTCDay(); // 0=Sun … 6=Sat
    const daysFromMon = dow === 0 ? 6 : dow === 6 ? 5 : dow - 1;
    const dates = [];
    for (let i = daysFromMon; i >= 0; i--) {
      const d = new Date(etNow);
      d.setUTCDate(etNow.getUTCDate() - i);
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) dates.push(d); // skip Sat/Sun
    }

    const responses = await Promise.all(
      dates.map(d =>
        fetch(`https://clerk.house.gov/FloorSummary/ViewFloorActions?date=${encodeURIComponent(fmtClerk(d))}`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)' } })
          .then(r => ({ d, r }))
          .catch(() => ({ d, r: null }))
      )
    );

    // Merge oldest→newest so today's data takes precedence.
    let merged = {};
    for (const { d, r } of responses) {
      if (!r?.ok) continue;
      const url = `https://clerk.house.gov/FloorSummary/ViewFloorActions?date=${encodeURIComponent(fmtClerk(d))}`;
      const dayStatuses = extractBillStatusesFromProceedings(await r.text(), url);
      merged = { ...merged, ...dayStatuses };
    }
    return merged;
  } catch { return {}; }
}

function extractBillStatusesFromProceedings(html, sourceUrl = null) {
  const statuses = {};

  // Parse each activity row: extract plain-text description + any Congress.gov bill link
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    const tdMatch = row.match(/<td[^>]*data-label="Activity"[^>]*>([\s\S]*?)<\/td>/i);
    if (!tdMatch) continue;
    const tdContent = tdMatch[1];

    // Extract Congress.gov bill link (rel="bill") — this is how we identify which bill
    const billLinkMatch = tdContent.match(/href="(https?:\/\/www\.congress\.gov\/bill\/[^"]+)"/i);
    const billId = billLinkMatch ? congressUrlToBillId(billLinkMatch[1]) : null;

    // Extract description (prefer hidden span which has full untruncated text)
    const hiddenSpan = tdContent.match(/<span[^>]*style="display:none;"[^>]*>([\s\S]*?)<\/span>/i);
    const raw = hiddenSpan ? hiddenSpan[1] : tdContent;
    const description = decodeHtmlEntities(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    rows.push({ billId, description });
  }

  // Rows are in reverse-chronological order.
  // Pattern for suspension votes (typical):
  //   [i-1] "Motion to reconsider laid on the table..."
  //   [i]   "On motion to suspend the rules and pass... Agreed to by Yeas and Nays: 405-0"  ← outcome, NO bill link
  //   [i+1] "Considered as unfinished business. <bill link>"  ← HAS bill link
  // So for each outcome row, look up to 3 rows away for the associated bill link.
  for (let i = 0; i < rows.length; i++) {
    const { description } = rows[i];

    // Recorded vote requested and deferred to a later vote series. The Clerk
    // posts these as "POSTPONED PROCEEDINGS - ... further proceedings on <bill>
    // would be postponed." The bill link is in this same row. Maps to the
    // "roll-call" (VOTE REQUESTED) status. Only set it if the bill has no
    // stronger status yet — passage/failure rows are processed earlier in this
    // same (reverse-chronological) loop, so they already win.
    const isPostponed =
      /postponed proceedings/i.test(description) ||
      /further proceedings\b[\s\S]*\bwould be postponed/i.test(description);
    if (isPostponed) {
      const pid = rows[i].billId;
      if (pid && !statuses[pid]) {
        statuses[pid] = { status: 'roll-call', statusText: 'Recorded vote requested — postponed', sourceUrl };
      }
      continue;
    }

    // Only process rows that are actual bill passage/failure motions
    const isPassageMotion =
      /on motion to suspend the rules and (pass|agree)/i.test(description) ||
      /\bon passage\b/i.test(description) ||
      /on agreeing to the (resolution|amendment)\b/i.test(description);
    if (!isPassageMotion) continue;

    let status, statusText;
    if (/(agreed to|passed)\b/i.test(description) && !/not agreed to|failed/i.test(description)) {
      status = 'passed';
      const votes = description.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)/);
      if (/voice vote|without objection/i.test(description)) {
        statusText = 'Passed (voice vote)';
      } else if (votes) {
        statusText = `Passed ${votes[1].replace(/,/g,'')}-${votes[2].replace(/,/g,'')}`;
      } else {
        statusText = 'Passed';
      }
    } else if (/\b(failed|not agreed to)\b/i.test(description)) {
      status = 'failed';
      const votes = description.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)/);
      statusText = votes ? `Failed ${votes[1].replace(/,/g,'')}-${votes[2].replace(/,/g,'')}` : 'Failed';
    } else {
      continue;
    }

    // Find the bill ID for this passage motion. The bill-link row ("Considered
    // as unfinished business. H.R. ####") follows the passage in the reverse-
    // chronological feed, but intervening rows (motion to recommit, previous
    // question, etc.) can push it several rows down — so search FORWARD up to 6
    // rows first, then a smaller backward window.
    let billId = rows[i].billId;
    for (let j = 1; j <= 6 && !billId; j++) {
      if (i + j < rows.length && rows[i + j].billId) billId = rows[i + j].billId;
    }
    for (let j = 1; j <= 3 && !billId; j++) {
      if (i - j >= 0 && rows[i - j].billId) billId = rows[i - j].billId;
    }

    if (billId && status) {
      const existing = statuses[billId];
      // "passed" and "failed" are final — don't downgrade
      if (!existing || existing.status !== 'passed') {
        statuses[billId] = { status, statusText, sourceUrl };
      }
    }
  }

  return statuses;
}
// ─────────────────────────────────────────────────────────────────────────────

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

// GovInfo "link service" → redirects to the latest official version PDF of a bill
// (e.g. .../link/bills/119/hr/8646?link-type=pdf → BILLS-119hr8646rh.pdf). Used as a
// fallback when the schedule feed didn't carry a direct floor-text PDF for a bill.
function billIdToGovInfoPdf(billId) {
  const parsed = billIdToCongressType(billId);
  if (!parsed) return null;
  return `https://www.govinfo.gov/link/bills/${CURRENT_CONGRESS}/${parsed.type}/${parsed.number}?link-type=pdf`;
}

async function fetchCongressBillSummary(billId) {
  const parsed = billIdToCongressType(billId);
  if (!parsed) return null;
  try {
    // format=json is explicit — without it the API may return XML causing resp.json() to throw.
    // limit=5 so we can try all available summaries if the first has empty text.
    const url = `https://api.congress.gov/v3/bill/${CURRENT_CONGRESS}/${parsed.type}/${parsed.number}/summaries?api_key=${_congressApiKey}&format=json&limit=5&sort=updateDate+desc`;
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    // 429/5xx = transient failure → throw so the caller doesn't cache null
    if (resp.status === 429 || resp.status >= 500) throw new Error(`HTTP ${resp.status}`);
    if (!resp.ok) return null; // 404 etc. = genuinely no summary
    const data = await resp.json();
    const summaries = data.summaries || [];
    // Try all returned summaries — pick the first one with non-empty text after stripping
    for (const s of summaries) {
      const raw = s.text || '';
      // Strip HTML tags then strip leading bill citation ("H.R. 1234—" or "H.R. 1234 (119th Congress)—")
      let text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      text = text.replace(/^(?:H\.R\.|S\.|H\.Res\.|S\.Res\.|H\.Con\.Res\.|S\.Con\.Res\.|H\.J\.Res\.|S\.J\.Res\.)\s*\d+(?:\s*\([^)]*\))?\s*[—–\-:]\s*/i, '');
      if (text.length > 20) return text; // ignore stub entries shorter than a real sentence
    }
    return null;
  } catch (e) {
    // Re-throw transient errors so the enrichment cache skips storing null
    if (e.message?.startsWith('HTTP 4') || e.message?.startsWith('HTTP 5') || e.name === 'TimeoutError') throw e;
    return null;
  }
}

async function fetchBillMeta(billId) {
  const parsed = billIdToCongressType(billId);
  if (!parsed) return null;
  const base = `https://api.congress.gov/v3/bill/${CURRENT_CONGRESS}/${parsed.type}/${parsed.number}`;
  const apiKey = `?api_key=${_congressApiKey}`;
  // Network errors propagate as thrown exceptions — callers use safeFetchMeta to avoid caching null for transient failures
  const [billResp, cosponsorsResp, committeesResp] = await Promise.all([
    fetch(`${base}${apiKey}`, { headers: { 'Accept': 'application/json' } }),
    fetch(`${base}/cosponsors${apiKey}&limit=100`, { headers: { 'Accept': 'application/json' } }),
    fetch(`${base}/committees${apiKey}&limit=5`, { headers: { 'Accept': 'application/json' } }),
  ]);
  if ([billResp, cosponsorsResp, committeesResp].some(r => r.status === 429 || r.status >= 500)) {
    throw new Error(`Congress.gov fetchBillMeta transient error: ${billResp.status}`);
  }
  const result = {};
  if (billResp.ok) {
    try {
      const data = await billResp.json();
      const s = (data.bill?.sponsors || [])[0];
      if (s) result.sponsor = { bioguideId: s.bioguideId, firstName: s.firstName, lastName: s.lastName, party: s.party, state: s.state, district: s.district ?? null };

      // Committee report: derive a stable PDF URL from the citation.
      // Always set committeeReportUrl (even null) so the enrichment cache knows
      // "no report" vs "not yet checked" and doesn't re-fetch on every warm load.
      // e.g. "H. Rept. 119-632" → https://www.congress.gov/119/crpt/hrpt632/CRPT-119hrpt632.pdf
      const crpt = (data.bill?.committeeReports || [])[0];
      result.committeeReportUrl = null;
      result.committeeReportCitation = null;
      if (crpt?.citation) {
        const m = crpt.citation.match(/^(H|S)\.\s*Rept\.\s*(\d+)-(\d+)$/i);
        if (m) {
          const chamber = m[1].toLowerCase(); // h or s
          const congress = m[2];
          const num = m[3];
          const slug = `${chamber}rpt${num}`; // hrpt632 / srpt632
          result.committeeReportCitation = crpt.citation;
          result.committeeReportUrl = `https://www.congress.gov/${congress}/crpt/${slug}/CRPT-${congress}${slug}.pdf`;
        }
      }
    } catch {}
  }
  if (cosponsorsResp.ok) {
    try {
      const data = await cosponsorsResp.json();
      result.cosponsors = (data.cosponsors || []).map(c => ({ bioguideId: c.bioguideId, firstName: c.firstName, lastName: c.lastName, party: c.party, state: c.state, district: c.district ?? null }));
    } catch {}
  }
  if (committeesResp.ok) {
    try {
      const data = await committeesResp.json();
      result.committees = (data.committees || []).map(c => c.name).filter(Boolean).slice(0, 3);
    } catch {}
  }
  return (result.sponsor || result.cosponsors?.length || result.committees?.length) ? result : null;
}

// "Ordered to be Reported" → "Reported by Committee xx – yy" / "Reported out of cmte by unanimous consent"
function formatCommitteeReport(text) {
  const t = text || '';
  if (/unanimous consent/i.test(t)) return 'Reported out of cmte by unanimous consent';
  const m = t.match(/yeas? and nays?:\s*(\d+)\s*[-–]\s*(\d+)/i);
  if (m) return `Reported by Committee ${m[1]} – ${m[2]}`;
  if (/voice vote/i.test(t)) return 'Reported by Committee (voice vote)';
  return 'Reported by Committee';
}

async function fetchCongressBillStatus(billId) {
  const parsed = billIdToCongressType(billId);
  if (!parsed) return null;
  try {
    const url = `https://api.congress.gov/v3/bill/${CURRENT_CONGRESS}/${parsed.type}/${parsed.number}/actions?api_key=${_congressApiKey}&limit=20&sort=updateDate+desc`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) return null;
    const data = await resp.json();

    let floorStatus = null;
    let committeeReport = null;

    for (const action of (data.actions || [])) {
      // Committee: "Ordered to be Reported" — pick the first (most recent) match
      if (!committeeReport && action.type === 'Committee') {
        if (/ordered to be reported/i.test(action.text || '')) {
          committeeReport = { text: formatCommitteeReport(action.text), date: action.actionDate };
        }
      }

      // Floor: passage / failure
      if (!floorStatus && action.type === 'Floor') {
        const t = (action.text || '').toLowerCase();
        const code = action.actionCode || '';
        // Skip rule-adoption actions (e.g. "Rule H. Res. 1300 passed House.")
        if (/^H1L/i.test(code) || /^rule\s+h\.?\s*res\./i.test(action.text || '')) {
          // not a bill passage action — skip
        } else {
          // "suspend the rules and pass/agree" alone matches the MOTION text that Congress.gov
          // logs when a bill is called up — NOT the outcome. Require an outcome word ("agreed to"
          // or "passed") to confirm the vote actually succeeded.
          const suspensionPassed = (t.includes('suspend the rules and pass') || t.includes('suspend the rules and agree'))
                                 && (t.includes('agreed to') || t.includes('passed'));
          const isPassage = t.includes('passed house') || t.includes('agreed to by') ||
                            t.includes('on passage passed') || t.includes('considered and passed') ||
                            suspensionPassed;
          const isFailed = t.includes('failed') || t.includes('not agreed to') || t.includes('not passed');
          if (isPassage || isFailed) {
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
            floorStatus = { status: isFailed ? 'failed' : 'passed', statusText, actionDate: action.actionDate, actionText: action.text };
          }
        }
      }

      if (floorStatus && committeeReport) break;
    }

    // Always return an object (even if both are null) as a sentinel that the API was checked.
    // null return is reserved for transient errors (don't cache).
    return { ...floorStatus, committeeReport };
  } catch {
    return null; // transient error — caller should not cache
  }
}

// Terminal statuses — once reached, never downgrade.
const TERMINAL_STATUSES = new Set(['passed', 'failed']);
const STATUS_RANK = { passed: 4, failed: 4, postponed: 3, 'roll-call': 2, scheduled: 1 };

// ── Generic KV response cache ─────────────────────────────────────────────────
// kvCache(env, key, ttlSeconds, fn, kvTtl?)
//
// Caching layers:
//   1. In-memory (_mem Map) — zero I/O, per-isolate, TTL = ttlSeconds
//   2. KV — shared across all PoPs, physical TTL = kvTtl (default KV_STORAGE_TTL = 30 days)
//   3. Origin fetch — only when both caches miss or are stale
//
// Write-on-change: KV entries are stored as { body, cachedAt } with a long physical TTL
// so the previous value is always available for comparison. After an origin fetch we only
// write to KV if the body actually changed — stable data (casualty list, leadership, member
// data, rules) may never write again after the first fetch.
//
// Pass kvFreshTtl=0 to skip KV entirely (in-memory only) — for very hot or real-time paths.
//
// TWO separate TTL concepts:
//   ttlSeconds   — in-memory freshness AND Cache-Control header. Fast path within one isolate.
//   kvFreshTtl   — how long KV data is considered fresh before we re-fetch from origin.
//                  Often longer than ttlSeconds so cold isolates don't re-fetch too aggressively.
//                  Defaults to ttlSeconds when not specified.
//   Physical KV storage is always KV_STORAGE_TTL (30 days) so old values persist for comparison.
async function kvCache(env, key, ttlSeconds, fn, kvFreshTtl = ttlSeconds) {
  const ttlMs = ttlSeconds * 1000;
  const kvFreshMs = kvFreshTtl * 1000;
  const now = Date.now();

  // 1. In-memory (zero I/O, shared within this isolate)
  const mem = _mGet(key);
  if (mem) return new Response(mem, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttlSeconds}` } });

  // 2. KV — skip if kvFreshTtl=0
  let prevBody = null;
  if (kvFreshTtl > 0 && env?.HLS_CACHE) {
    try {
      const raw = await env.HLS_CACHE.get(key);
      if (raw !== null) {
        // Entries are stored as { body, cachedAt }. Legacy raw strings → treat as stale (age=Infinity).
        let body = raw, age = Infinity;
        try {
          const w = JSON.parse(raw);
          if (typeof w?.body === 'string' && typeof w?.cachedAt === 'number') {
            body = w.body;
            age = now - w.cachedAt;
          }
        } catch {}
        prevBody = body; // saved for post-fetch comparison
        if (age < kvFreshMs) {
          // Still fresh per KV freshness window — serve, warm in-memory
          _mSet(key, body, Math.min(ttlMs, kvFreshMs - age));
          return new Response(body, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttlSeconds}` } });
        }
        // Stale by KV window — fall through to origin; prevBody held for comparison
      }
    } catch {}
  }

  // 3. Origin fetch
  const response = await fn();
  if (response.ok) {
    try {
      const body = await response.clone().text();
      _mSet(key, body, ttlMs);
      if (kvFreshTtl > 0 && env?.HLS_CACHE && body !== prevBody) {
        // Write only if content changed — stable data may never write again after first fetch
        console.log(`[KV-WRITE] key=${key} prevNull=${prevBody===null} bodyLen=${body.length}`);
        await env.HLS_CACHE.put(key, JSON.stringify({ body, cachedAt: now }), { expirationTtl: KV_STORAGE_TTL });
      }
    } catch {}
  }
  return response;
}

// ── KV cache for per-bill Congress.gov enrichment (summary, sponsor, committees, status).
// Summaries and sponsors are permanent once published; status is covered by the proceedings ratchet.
// Physical KV TTL = KV_STORAGE_TTL (30 days). Write-on-change: only writes when enrichment data
// actually differs from what is already in KV (e.g. newly published CRS summary, updated status).
const BILL_ENRICH_TTL = 6 * 60 * 60; // in-memory freshness window (6 hours)

async function getCachedBillEnrichment(env, billId) {
  const key = `bill-enrich-v3:${billId}`;
  const mem = _mGet(key);
  if (mem) return JSON.parse(mem);
  if (!env?.HLS_CACHE) return null;
  try {
    const raw = await env.HLS_CACHE.get(key);
    if (raw) { _mSet(key, raw, BILL_ENRICH_TTL * 1000); return JSON.parse(raw); }
    return null;
  } catch { return null; }
}

async function setCachedBillEnrichment(env, billId, data) {
  const key = `bill-enrich-v3:${billId}`;
  const body = JSON.stringify(data);
  _mSet(key, body, BILL_ENRICH_TTL * 1000);
  if (!env?.HLS_CACHE) return;
  try {
    // Read before write — skip the KV write if data hasn't changed
    const existing = await env.HLS_CACHE.get(key);
    if (existing !== body) {
      console.log(`[KV-WRITE] key=${key} prevNull=${existing===null}`);
      await env.HLS_CACHE.put(key, body, { expirationTtl: KV_STORAGE_TTL });
    }
  } catch {}
}

// KV key for persisted bill statuses for a given week (ISO week start date).
function billStatusCacheKey(weekStartISO) {
  return `bill_statuses_${weekStartISO}`;
}

// Read the persisted status map for this week from KV.
async function loadCachedBillStatuses(env, weekStartISO) {
  const key = billStatusCacheKey(weekStartISO);
  const mem = _mGet(key);
  if (mem) return JSON.parse(mem);
  if (!env?.HLS_CACHE) return {};
  try {
    const raw = await env.HLS_CACHE.get(key);
    if (raw) { _mSet(key, raw, 5 * 60 * 1000); return JSON.parse(raw); } // 5-min mem TTL: status changes during votes
    return {};
  } catch { return {}; }
}

// Merge live bill statuses into the cache using the ratchet rule:
// terminal statuses (passed/failed) are never downgraded.
// Returns the updated cache map and whether anything changed.
function ratchetStatuses(cached, bills) {
  const updated = { ...cached };
  let changed = false;
  for (const bill of bills) {
    const prev = updated[bill.id];
    const prevRank = STATUS_RANK[prev?.status] ?? 0;
    const currRank = STATUS_RANK[bill.status] ?? 0;
    // Only ratchet statuses from proceedings/bluesky — those sources are ephemeral and the
    // status can vanish from the live feed once a bill falls off the schedule.
    // Congress.gov statuses are always re-fetchable from the API, so we never lock them in;
    // persisting a congress-sourced status would freeze incorrect data (e.g. false passage).
    if (bill.actionSource === 'congress') continue;
    if (!prev || currRank > prevRank) {
      updated[bill.id] = {
        status: bill.status,
        statusText: bill.latestAction,
        actionSource: bill.actionSource,
        actionSourceUrl: bill.actionSourceUrl,
        latestActionDate: bill.latestActionDate,
      };
      changed = true;
    }
  }
  return { updated, changed };
}

// Write updated cache back to KV. TTL = Saturday 23:59 ET of the current week + 1 day buffer.
async function saveCachedBillStatuses(env, weekStartISO, statusMap) {
  const key = billStatusCacheKey(weekStartISO);
  const body = JSON.stringify(statusMap);
  _mSet(key, body, 5 * 60 * 1000); // keep in-memory copy fresh after write
  if (!env?.HLS_CACHE) return;
  try {
    // Expire Sunday night (8 days after Monday week start)
    console.log(`[KV-WRITE] key=${key}`);
    await env.HLS_CACHE.put(key, body, { expirationTtl: 8 * 24 * 3600 });
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────
// Casualty List  (House Press Gallery – members not returning)
// ─────────────────────────────────────────────────────────
const CASUALTY_LIST_TTL = 60 * 60; // 1 hour

function formatCasualtyStatus(raw) {
  if (!raw) return 'Retiring';
  const up = raw.trim().toUpperCase();
  if (['D', 'R', 'I'].includes(up)) return 'Retiring';
  if (up.includes('SENATE')) return 'Running for Senate';
  if (up.includes('GOVERNOR')) return 'Running for Governor';
  if (up.includes('ATTORNEY GENERAL') || up.includes('ATTY')) return 'Running for Atty. General';
  if (up.includes('LOST') && up.includes('PRIMARY')) return 'Lost Primary';
  if (up.includes('LOST') && up.includes('ELECTION')) return 'Lost Election';
  if (up.includes('RESIGN')) return 'Resigned';
  if (up.includes('DIED') || up.includes('DECEASED')) return 'Deceased';
  return raw.trim().replace(/\b\w/g, c => c.toUpperCase());
}

function parseCasualtyListHtml(html) {
  // Press gallery table format (from actual HTML inspection):
  //   Regular casualty rows:   1 cell  — "LastName[, FirstName] (Party), ST[ (Status)]"
  //   Special election rows:   3 cells — "Departed Member | Election Date | Successor"
  //
  // The page has two logical sections:
  //   1. Members not returning (1 cell per row)
  //   2. Departed members + successors (3 cells per row — successor must be IGNORED)
  //
  // Parsing row-by-row lets us skip the Successor column, which was previously
  // causing successors like Fine and Patronis to be mis-tagged as "Retiring".

  // Pattern: LastName[, FirstName] (Party), StateAbbr[ (Status)]
  const nameRe = /^([A-Z][A-Za-z'\-]+)(?:,\s+([A-Za-z][A-Za-z.'"\s\-]*?))?\s*\([DRI]\),\s*[A-Z]{2}(?:\s+\(([^)]+)\))?/i;
  const members = {};

  function processCell(rawHtml) {
    const cell = rawHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&[a-z#\d]+;/gi, '')
      .replace(/\s+/g, ' ').trim();
    const nm = nameRe.exec(cell);
    if (!nm) return;
    const lastName  = nm[1].trim().toUpperCase();
    const firstName = (nm[2] || '').trim().toUpperCase();
    const status = formatCasualtyStatus(nm[3] || null);
    if (firstName) members[`${firstName} ${lastName}`] = status;
    if (!members[lastName]) members[lastName] = status; // fallback for nickname mismatches
  }

  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = trRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = cellRe.exec(row[1])) !== null) cells.push(c[1]);

    if (cells.length === 1) {
      // Regular casualty list row — single member cell
      processCell(cells[0]);
    } else if (cells.length === 3) {
      // Two different 3-column layouts share this width:
      //   • Special election table: [Departed Member, Election Date, Successor]
      //   • Casualty list rows:      [spacer, Member, spacer]
      // Process col 0 (departed member) AND col 1 (member). Col 1 is the
      // election DATE in the special-election table, which never matches the
      // name regex, so it's harmless there. NEVER process col 2 — that's the
      // successor (e.g. Fine, Patronis), which must not be tagged as departing.
      processCell(cells[0]);
      processCell(cells[1]);
    }
    // All other row widths (header colspan rows, etc.) are skipped
  }

  return members;
}

async function handleCasualtyList(env) {
  const debug = false;
  const now = Date.now();
  const ttlMs = CASUALTY_LIST_TTL * 1000;

  if (!debug) {
    // 1. In-memory
    const mem = _mGet('casualty-list-v4');
    if (mem) return new Response(mem, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });

    // 2. KV — stored as { body, cachedAt } for compare-and-write support
    let prevBody = null;
    if (env?.HLS_CACHE) {
      try {
        const raw = await env.HLS_CACHE.get('casualty-list-v4');
        if (raw !== null) {
          let body = raw, age = Infinity;
          try {
            const w = JSON.parse(raw);
            if (typeof w?.body === 'string' && typeof w?.cachedAt === 'number') {
              body = w.body; age = now - w.cachedAt;
            }
          } catch {}
          prevBody = body;
          if (age < ttlMs) {
            _mSet('casualty-list-v4', body, ttlMs - age);
            return new Response(body, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
          }
          // Stale — fall through to origin fetch; prevBody held for comparison
        }
      } catch {}
    }

    // 3. Origin fetch — only write KV if content changed
    try {
      const resp = await fetch('https://pressgallery.house.gov/member-data/casualty-list', {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,*/*',
          'User-Agent': 'Mozilla/5.0 (compatible)',
          'Accept-Encoding': 'identity',
        }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();
      const members = parseCasualtyListHtml(html);
      if (Object.keys(members).length > 0) {
        const body = JSON.stringify(members);
        _mSet('casualty-list-v4', body, ttlMs);
        if (env?.HLS_CACHE && body !== prevBody) {
          // Only write if the list actually changed — changes maybe once a month
          console.log(`[KV-WRITE] key=casualty-list-v4 prevNull=${prevBody===null}`);
          try { await env.HLS_CACHE.put('casualty-list-v4', JSON.stringify({ body, cachedAt: now }), { expirationTtl: KV_STORAGE_TTL }); } catch {}
        }
        return new Response(body, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
      }
      return new Response(JSON.stringify(members), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
    } catch {
      // Return empty object — UI degrades gracefully (no status badges shown)
      return new Response(JSON.stringify({}), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
  }

  // debug=true path
  try {
    const resp = await fetch('https://pressgallery.house.gov/member-data/casualty-list', {
      headers: { 'Accept': 'text/html,application/xhtml+xml,*/*', 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept-Encoding': 'identity' }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    return new Response(JSON.stringify({ raw: html.slice(0, 15000) }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({}), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
}

// Cache bills responses in KV to avoid Worker CPU-time-limit 503s.
// Both the full fetch (XML parsing + Congress.gov enrichment) and the quick poll
// (XML parsing + proceedings HTML parsing) are expensive enough to exceed the
// free-tier 10ms CPU budget under concurrent load.
//   full (no quick, no date): 60s — enrichment runs at most once/min
//   quick=1: 30s — fresh enough for live vote-status badges
//   date=*: no cache — historical one-offs
async function handleBills(request, env) {
  const url = new URL(request.url);
  const quick = url.searchParams.has('quick');
  const dateParam = url.searchParams.get('date');
  if (dateParam) return _fetchBills(request, env);
  const cacheKey = quick ? 'bills-weekly-quick-v6' : 'bills-weekly-v6';
  const ttl = quick ? 30 : 60;
  // in-memory TTL (30/60s) drives per-isolate freshness.
  // kvFreshTtl=3600s — re-check KV once per hour; write-on-change skips writes when unchanged.
  return kvCache(env, cacheKey, ttl, () => _fetchBills(request, env), 3600);
}

async function _fetchBills(request, env) {
  try {
    const url = new URL(request.url);
    const dateParam = url.searchParams.get('date'); // e.g. "05/12/2026"
    // quick=1: skip slow Congress.gov enrichment — used for recurring status polls.
    // The client preserves summary/sponsor/committees from the initial full fetch.
    const quick = url.searchParams.has('quick');

    // Fetch House.gov bills schedule + today's proceedings in parallel.
    // Proceedings (House Clerk) is the authoritative source for the full vote
    // lifecycle — recorded vote requested/postponed → passed/failed — so the
    // partisan Bluesky/Dem Cloakroom feed is no longer used for bill status.
    const [billsXmlText, proceedingsStatuses, sapMapRaw] = await Promise.all([
      fetchRSSFeed(RSS_FEEDS.bills),
      fetchProceedingsBillStatuses(),
      fetchSapMap(env).catch(() => '{}'),
    ]);
    const sapMap = (() => { try { return JSON.parse(sapMapRaw); } catch { return {}; } })();

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
    const weekKey = currentWeekStart.toISOString().slice(0, 10); // "2026-05-18"

    // Load any statuses already confirmed this week (survives across requests/days)
    const cachedStatuses = await loadCachedBillStatuses(env, weekKey);

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
    
    // Prefer the week stated in the entry title (e.g. "...the Week of May 18, 2026...")
    const titleWeekMatch = selectedEntry.title.match(/week of (.+?)(?:\s*[-–]|$)/i);
    let weekDate;
    if (titleWeekMatch) {
        const raw = titleWeekMatch[1].trim();
        const parsed = new Date(raw);
        weekDate = `Week of ${!isNaN(parsed) ? wFmtDate(parsed) : raw}`;
    } else {
        weekDate = getWeekRange(referenceDate);
    }
    const contentUpdatedAt = selectedEntry.updated;

    // Parse HTML content using regex
    let content = selectedEntry.content;
    
    // Decode HTML entities
    content = decodeHtmlEntities(content);
    
    const extractSection = (source, startPattern, endPattern) => {
      const start = source.search(startPattern);
      if (start === -1) return '';
      const end = endPattern ? source.slice(start + 1).search(endPattern) : -1;
      return end === -1 ? source.slice(start) : source.slice(start, start + 1 + end);
    };

    const ruleHeaderMatch = content.match(/Items that may be considered pursuant to a rule/i);
    const suspensionHeaderMatch = content.match(/Items that may be considered under suspension of the rules/i);
    const mayBeConsideredHeaderMatch = content.match(/Items that may be considered(?!\s+pursuant|\s+under\s+suspension)/i);

    // All sections stop at the next h-tag so ordering doesn't matter
    const nextHeader = /<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/i;
    const ruleSection = extractSection(content, /Items that may be considered pursuant to a rule/i, nextHeader);
    const suspensionSection = extractSection(content, /Items that may be considered under suspension of the rules/i, nextHeader);
    const mayBeConsideredSection = extractSection(content, /Items that may be considered(?!\s+pursuant|\s+under\s+suspension)/i, nextHeader);

    // Extract the governing H.Res number from the rule section header, e.g.
    // "…pursuant to a rule (H. Res. 630, Agreed to 232-195)…"
    // This is the authoritative source — the schedule XML always names the governing rule.
    const governingHresMatch = ruleSection.match(/H\.?\s*Res\.?\s*(\d+)/i);
    const governingHres = governingHresMatch ? `H.Res. ${governingHresMatch[1]}` : null;

    // Parse bills arrays for all three consideration types
    const ruleBills = [];
    const suspensionBills = [];
    const mayBeConsideredBills = [];

    const parseBillsFromSection = (sectionHtml, target) => {
      if (!sectionHtml) return;
      const isRule = target === ruleBills;
      const rows = sectionHtml.match(/<tr[^>]*class="floorItem"[^>]*>[\s\S]*?<\/tr>/g) || [];

      for (const row of rows) {
        const legisNumMatch = row.match(/<td[^>]*class="legisNum"[^>]*>([\s\S]*?)<\/td>/);
        const floorTextMatch = row.match(/<td[^>]*class="floorText"[^>]*>([\s\S]*?)<\/td>/);

        if (!legisNumMatch || !floorTextMatch) continue;

        const legisNum = legisNumMatch[1].replace(/<[^>]*>/g, '').trim();
        const floorText = floorTextMatch[1].replace(/<[^>]*>/g, '').trim();
        if (!legisNum || !floorText || legisNum.includes('::')) continue;

        // Bill-text PDF: the schedule row links the exact document on the floor.
        // Prefer the docs.house.gov floor doc (often a Rules Committee Print — the precise
        // text being considered, incl. manager's amendments), then any .pdf in the row,
        // then fall back to GovInfo's latest official version. http→https for mixed content.
        const pdfHrefs = [...row.matchAll(/href="([^"]+\.pdf)"/gi)].map((mm) => mm[1].replace(/^http:/, 'https:'));
        const textUrl = pdfHrefs.find((h) => /docs\.house\.gov/i.test(h)) || pdfHrefs[0] || null;

        // Normalize bill ID for lookups: "H. Res. 1300" → "H.Res. 1300", "H. Con. Res. 86" → "H.Con.Res. 86"
        // The schedule XML is inconsistent with spacing inside type abbreviations.
        const normId = legisNum.replace(/([A-Z])\.\s+(?=[A-Z])/gi, '$1.');

        // Default: bill is scheduled but not yet acted upon
        let billStatus = 'scheduled';
        let latestAction = 'Scheduled for consideration';
        let considered = false;
        let actionSource = null;
        let actionSourceUrl = null;

        // Proceedings (House Clerk) — the authoritative source for the full vote
        // lifecycle: recorded vote requested/postponed (roll-call) → passed/failed.
        const proceedingsUpdate = proceedingsStatuses[normId];
        if (proceedingsUpdate) {
          billStatus = proceedingsUpdate.status;
          latestAction = proceedingsUpdate.statusText;
          considered = true;
          actionSource = 'proceedings';
          actionSourceUrl = proceedingsUpdate.sourceUrl || null;
        }

        target.push({
          id: legisNum,
          title: floorText,
          isRule,
          description: '',
          pubDate: new Date(contentUpdatedAt),
          status: billStatus,
          latestAction: latestAction,
          latestActionDate: new Date(contentUpdatedAt),
          considered,
          actionSource,
          actionSourceUrl,
          textUrl: textUrl || billIdToGovInfoPdf(legisNum),
          ...(isRule && governingHres ? { governingHres } : {}),
        });
      }
    };

    parseBillsFromSection(ruleSection, ruleBills);
    parseBillsFromSection(suspensionSection, suspensionBills);
    parseBillsFromSection(mayBeConsideredSection, mayBeConsideredBills);

    // Second pass: enrich with Congress.gov floor actions + summaries + sponsor/cosponsors/committees.
    // Skipped on quick=1 requests — caller already has this data from the initial full fetch.
    // Results are cached in KV for 30 minutes so Congress.gov is only hit on cold cache,
    // not on every page load.
    const allBills = [...ruleBills, ...suspensionBills, ...mayBeConsideredBills];
    if (!quick) await Promise.all(allBills.map(async (bill) => {
      // Check KV cache first — avoids hitting Congress.gov on warm loads
      const enrichCached = await getCachedBillEnrichment(env, bill.id);
      let congressStatus, summary, meta;
      // Both safe wrappers return undefined on transient errors (429, 5xx, network) so callers
      // can distinguish "genuinely no data" (null) from "failed this time" (undefined).
      const safeFetchSummary = (id) => fetchCongressBillSummary(id).catch(() => undefined);
      const safeFetchMeta    = (id) => fetchBillMeta(id).catch(() => undefined);
      if (enrichCached) {
        congressStatus = enrichCached.congressStatus ?? null;
        // Retry summary/meta when null — Congress.gov may have published since last fetch.
        // Always re-verify a cached terminal status (passed/failed) from Congress.gov — the
        // original detection may have been a false positive (e.g. motion text misread as passage).
        // Also retry when the cached entry predates committeeReport support.
        const needsSummary            = !enrichCached.summary;
        // Re-fetch meta when missing, or when the cached entry predates committeeReportUrl
        // support (key absent entirely — null means "checked, no report").
        const needsMeta               = !enrichCached.meta || !('committeeReportUrl' in enrichCached.meta);
        const needsCommitteeReport    = !('committeeReport' in (enrichCached.congressStatus || {}));
        const needsStatusVerify       = TERMINAL_STATUSES.has(enrichCached.congressStatus?.status);
        const needsStatusRefresh      = needsCommitteeReport || needsStatusVerify;
        if (needsSummary || needsMeta || needsStatusRefresh) {
          const [summaryResult, newMeta, freshStatus] = await Promise.all([
            needsSummary       ? safeFetchSummary(bill.id)        : Promise.resolve(enrichCached.summary),
            needsMeta          ? safeFetchMeta(bill.id)           : Promise.resolve(enrichCached.meta),
            needsStatusRefresh ? fetchCongressBillStatus(bill.id) : Promise.resolve(undefined),
          ]);
          // undefined = transient error (don't overwrite cache); null = confirmed no data
          const summaryToCache = summaryResult === undefined ? enrichCached.summary : summaryResult;
          const metaToCache    = newMeta      === undefined ? enrichCached.meta    : newMeta;
          summary = summaryResult === undefined ? enrichCached.summary : summaryResult;
          meta    = newMeta === undefined ? enrichCached.meta : newMeta;
          // freshStatus != null: replace the full congressStatus (floor action + committeeReport)
          // so a false-positive terminal status gets corrected with the live API result.
          if (freshStatus != null) {
            congressStatus = freshStatus;
          }
          if (summaryToCache || metaToCache || freshStatus != null) {
            await setCachedBillEnrichment(env, bill.id, { congressStatus, summary: summaryToCache, meta: metaToCache });
          }
        } else {
          summary = enrichCached.summary;
          meta    = enrichCached.meta;
        }
      } else {
        let summaryResult, metaResult;
        [congressStatus, summaryResult, metaResult] = await Promise.all([
          fetchCongressBillStatus(bill.id),
          safeFetchSummary(bill.id),
          safeFetchMeta(bill.id),
        ]);
        // undefined = transient error — don't cache as null so next request retries
        summary = summaryResult ?? null;
        meta    = metaResult ?? null;
        if (summaryResult !== undefined || metaResult !== undefined || congressStatus) {
          await setCachedBillEnrichment(env, bill.id, {
            congressStatus,
            summary: summaryResult !== undefined ? summaryResult : null,
            meta:    metaResult    !== undefined ? metaResult    : null,
          });
        }
      }
      if (congressStatus) {
        // Only apply floor-action fields when a floor action was actually found
        if (congressStatus.status) {
          bill.status = congressStatus.status;
          bill.latestAction = congressStatus.statusText;
          bill.considered = true;
          bill.actionSource = 'congress';
          bill.actionSourceUrl = null; // client builds the URL from billIdToCongressUrl()
          if (congressStatus.actionDate) {
            bill.latestActionDate = new Date(congressStatus.actionDate + 'T00:00:00Z');
          }
        }
        if (congressStatus.committeeReport) {
          bill.committeeReport     = congressStatus.committeeReport.text;
          bill.committeeReportDate = congressStatus.committeeReport.date;
        }
      }
      if (summary) {
        // Strip bill title if Congress.gov repeats it verbatim at the start of the summary
        let text = summary;
        const titleTrimmed = (bill.title || '').trim();
        if (titleTrimmed && text.startsWith(titleTrimmed)) {
          text = text.slice(titleTrimmed.length).replace(/^[\s.,:;—–\-]+/, '').trim();
        }
        bill.summary = text || summary;
      }
      if (meta) {
        if (meta.sponsor) bill.sponsor = meta.sponsor;
        if (meta.cosponsors) bill.cosponsors = meta.cosponsors;
        if (meta.committees) bill.committees = meta.committees;
        if (meta.committeeReportUrl) bill.committeeReportUrl = meta.committeeReportUrl;
        if (meta.committeeReportCitation) bill.committeeReportCitation = meta.committeeReportCitation;
      }
    }));

    // Apply the KV ratchet: restore any terminal statuses (passed/failed) from cache
    // that the live fetch missed (e.g. yesterday's voice votes, Congress.gov lag).
    // Skip congress-sourced entries — those are always re-verified from the live API,
    // so a stale/incorrect congress status in the ratchet must not override the fresh result.
    for (const bill of allBills) {
      const cached = cachedStatuses[bill.id];
      if (!cached || cached.actionSource === 'congress') continue;
      if ((STATUS_RANK[cached.status] ?? 0) > (STATUS_RANK[bill.status] ?? 0)) {
        bill.status = cached.status;
        bill.latestAction = cached.statusText ?? bill.latestAction;
        bill.considered = true;
        if (cached.actionSource) bill.actionSource = cached.actionSource;
        if (cached.actionSourceUrl) bill.actionSourceUrl = cached.actionSourceUrl;
        if (cached.latestActionDate) bill.latestActionDate = cached.latestActionDate;
      }
    }

    // Write back any newly reached terminal statuses so they persist for the week.
    const { updated: newCache, changed } = ratchetStatuses(cachedStatuses, allBills);
    if (changed) await saveCachedBillStatuses(env, weekKey, newCache);

    // Stamp SAP URL on each bill that has a matching Statement of Administration Policy.
    // sapMap keys are normalized bill IDs (same normId convention as parseBillsFromSection).
    for (const bill of allBills) {
      const normId = bill.id.replace(/([A-Z])\.\s+(?=[A-Z])/gi, '$1.');
      const sapUrl = sapMap[normId] || sapMap[bill.id];
      if (sapUrl) bill.sapUrl = sapUrl;
    }

    return new Response(JSON.stringify({
      ruleBills: ruleBills,
      suspensionBills: suspensionBills,
      mayBeConsideredBills: mayBeConsideredBills,
      lastUpdated: new Date(),
      weekDate: weekDate,
      rawHeaders: {
        weekTitle: selectedEntry.title,
        updated: contentUpdatedAt,
        ruleHeader: ruleHeaderMatch ? ruleHeaderMatch[0] : '',
        ruleHres: governingHres || '',
        suspensionHeader: suspensionHeaderMatch ? suspensionHeaderMatch[0] : '',
        mayBeConsideredHeader: mayBeConsideredHeaderMatch ? mayBeConsideredHeaderMatch[0] : ''
      },
      consideredBills: [...ruleBills, ...suspensionBills, ...mayBeConsideredBills].filter(b => b.considered).map(b => b.id)
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30' // 30 seconds — bills update during active floor sessions
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
        'Content-Type': 'application/json', 'Cache-Control': 'no-store'
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
        'Content-Type': 'application/json', 'Cache-Control': 'no-store'
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
        'Content-Type': 'application/json', 'Cache-Control': 'no-store'
      }
    });
  }
}

async function handleMemberData(env) {
  return kvCache(env, 'member-data-xml', 3600, async () => {
    try {
      const xmlText = await fetchRSSFeed(RSS_FEEDS.memberData, 15000);
      return new Response(JSON.stringify({ xmlData: xmlText }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: `Failed to fetch member data: ${error.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }
  });
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
        'Content-Type': 'application/json', 'Cache-Control': 'no-store'
      }
    });
  }
}

async function handleBlueskyFeed(env) {
  // In-memory TTL 2 min (same isolate); KV TTL 30 min — Bluesky posts don't update second-to-second.
  return kvCache(env, 'bluesky-ticker', 120, async () => {
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
    
    const weekDate = wFmtDate(new Date());
    
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
        'Content-Type': 'application/json', 'Cache-Control': 'no-store'
      }
    });
  }
  }, 1800); // kvFreshTtl=1800s — re-check KV every 30 min; in-memory TTL is 2 min
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
        'Content-Type': 'application/json', 'Cache-Control': 'no-store'
      }
    });
  }
}

// ── Roll Call Log ─────────────────────────────────────────────────────────────
// Stores per-roll vote counts from DomeWatch as they stream in.
// Key: roll-log-YYYYMMDD  Value: { entries: [ {roll, bill, question, dem, rep, totals, updatedAt}, ... ] }

function rollLogKey() {
  return `roll-log-${getTodayDateET()}`;
}

async function handleRollLogGet(env) {
  if (!env?.HLS_CACHE) return new Response(JSON.stringify({ entries: [] }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  try {
    // In-memory cache — avoid KV reads for burst traffic within same isolate
    const MEM_KEY = 'roll-log-assembled';
    const cached = _mGet(MEM_KEY);
    if (cached) return new Response(cached, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

    // Read today + yesterday — MTR votes don't span more than 1 legislative day
    const allEntries = [];
    const seen = new Set();
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    for (let d = 0; d < 2; d++) {
      const dt = new Date(nowET);
      dt.setDate(dt.getDate() - d);
      const key = `roll-log-${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
      const data = await env.HLS_CACHE.get(key, 'json');
      if (data?.entries) {
        for (const e of data.entries) {
          if (!seen.has(e.roll)) { seen.add(e.roll); allEntries.push(e); }
        }
      }
    }
    allEntries.sort((a, b) => (a.roll || 0) - (b.roll || 0));
    const body = JSON.stringify({ entries: allEntries });
    _mSet(MEM_KEY, body, 30_000); // cache 30s — new votes update KV, isolate picks them up next miss
    return new Response(body, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return new Response(JSON.stringify({ entries: [] }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
}


// ─────────────────────────────────────────────────────────────────────────────

// Check if an HLS manifest is live (no #EXT-X-ENDLIST) by probing a variant stream.
async function checkManifestLiveness(masterUrl) {
  try {
    const resp = await fetch(masterUrl, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return null;
    const text = await resp.text();
    // Master playlist — find first variant and check it
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variantLine = text.split('\n').find(l => l.trim() && !l.startsWith('#'));
      if (variantLine) {
        const variantUrl = variantLine.trim().startsWith('http')
          ? variantLine.trim()
          : new URL(variantLine.trim(), masterUrl).href;
        const vResp = await fetch(variantUrl, { signal: AbortSignal.timeout(4000) });
        if (!vResp.ok) return null;
        const vText = await vResp.text();
        return !vText.includes('#EXT-X-ENDLIST');
      }
    }
    return !text.includes('#EXT-X-ENDLIST');
  } catch { return null; }
}

// Extract the best HLS URL from a /broadcastevents response array.
// Prefers the "east" region; falls back to any HLS entry.
function extractHlsFromBroadcastEvents(data) {
  if (!Array.isArray(data) || !data[0]) return null;
  const event = data[0];
  const files = (event.asset || {}).files || [];
  const hlsFiles = files.filter(f => (f.type || '').toUpperCase() === 'HLS');
  if (!hlsFiles.length) return null;

  // Prefer east region; fall back to first available
  const preferred = hlsFiles.find(f => f.url && f.url.includes('/east/')) || hlsFiles[0];
  if (!preferred?.url) return null;

  // Strip the fragment (#s=... or #t=...) — hls.js handles live edge itself
  const url = preferred.url.replace(/#.*$/, '');
  // isLiveBroadcast can be "True", "False", or null (null = stream just started, assume live)
  const liveFlagStr = String(event.isLiveBroadcast || '').toLowerCase();
  const isLiveByFlag = liveFlagStr === 'true' ? true : liveFlagStr === 'false' ? false : null;
  return { url, isLiveByFlag, assetName: (event.asset || {}).name || null };
}

// Format today's date as YYYYMMDD in Eastern Time (House operates on ET)
function getTodayDateET() {
  const now = new Date();
  // UTC offset for Eastern: EST = -5, EDT = -4. Approximate with -5 (worst case off by 1hr during DST transition).
  const et = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const y = et.getUTCFullYear();
  const m = String(et.getUTCMonth() + 1).padStart(2, '0');
  const d = String(et.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function fetchBroadcastEvents(dateId) {
  const resp = await fetch(
    `https://liveproxy-azapp-prod-eastus2-003.azurewebsites.net/broadcastevents/${dateId}`,
    { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(3000) }
  );
  if (!resp.ok) return null;
  const text = await resp.text();
  if (!text || !text.trim()) return null; // empty body before session starts
  try {
    const data = JSON.parse(text);
    // Both "[]" and {"responseCode":404,...} should return null
    if (!Array.isArray(data) || !data.length) return null;
    return data;
  } catch { return null; }
}

async function handleHlsUrl(env) {
  // In-memory cache only (no KV writes — this endpoint is called on every page load).
  const MEM_KEY = 'hls-url';
  const memHit = _mGet(MEM_KEY);
  if (memHit) return new Response(memHit, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=20' } });

  const reply = (body, ttlMs, maxAge) => {
    if (ttlMs > 0) _mSet(MEM_KEY, body, ttlMs);
    return new Response(body, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}` } });
  };

  try {
    const todayId = getTodayDateET();

    // ── Try today's broadcast event ──────────────────────────────────────────
    let broadcastData = null;
    try { broadcastData = await fetchBroadcastEvents(todayId); } catch { /* timeout or error */ }

    if (broadcastData) {
      const result = extractHlsFromBroadcastEvents(broadcastData);
      if (result) {
        // If isLiveBroadcast flag is null, check the manifest directly
        let isLive = result.isLiveByFlag;
        if (isLive === null) isLive = await checkManifestLiveness(result.url) ?? false;

        if (env?.HLS_CACHE) {
          console.log(`[KV-WRITE] key=last_url`);
          try { await env.HLS_CACHE.put('last_url', result.url, { expirationTtl: 7 * 24 * 3600 }); } catch (_) {}
        }
        return reply(JSON.stringify({ url: result.url, isLive }), 20_000, 20);
      }
    }

    // ── No data for today yet — check if the cached URL is actually live ────────
    if (env?.HLS_CACHE) {
      const cachedUrl = await env.HLS_CACHE.get('last_url');
      if (cachedUrl) {
        const isLive = await checkManifestLiveness(cachedUrl) ?? false;
        return reply(JSON.stringify({ url: cachedUrl, isLive }), isLive ? 10_000 : 60_000, isLive ? 10 : 60);
      }
    }

    // Nothing available — cache briefly so we don't hammer the broadcast API
    return reply(JSON.stringify({ url: null, isLive: false }), 15_000, 30);

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
}

// Build a roll-log entry from raw DomeWatch floor data (server-side equivalent of
// the client-side rollLogEntry() that was previously sent via POST).
function buildRollLogEntry(data) {
  const iv = v => Math.max(parseInt(v) || 0, 0);
  const vc = data.votes?.counts || data.voteCounts || {};
  const t = vc.totals || {};
  const d = vc.blue   || {};
  const r = vc.red    || {};
  const rc = data.roll_call || data.rollCall || {};
  return {
    roll:     rc.number ?? null,
    bill:     rc.bill?.legisNum || rc.bill?.title || null,
    question: rc.question || null,
    totals: { yeas: iv(t.yeas), nays: iv(t.nays), present: iv(t.present), notVoting: iv(t.not_voting) },
    dem: { yeas: iv(d.yeas), nays: iv(d.nays), present: iv(d.present), notVoting: iv(d.not_voting) },
    rep: { yeas: iv(r.yeas), nays: iv(r.nays), present: iv(r.present), notVoting: iv(r.not_voting) },
    updatedAt: new Date().toISOString(),
  };
}

// Write a roll-log entry to KV when the floor is in an active vote state.
// Called as a side-effect inside handleDomeWatchFloor (only when cache is cold).
async function maybeWriteRollLog(data, env) {
  if (!env?.HLS_CACHE) return;
  const status = data.currentStatus?.value || data.now?.value;
  if (status !== 'vote' && status !== 'voting') return;
  const roll = (data.roll_call || data.rollCall)?.number;
  if (!roll) return;
  try {
    const entry = buildRollLogEntry(data);
    // Skip KV read+write if totals haven't changed since last write (dedup within this isolate)
    const dedupKey = `roll-log-dedup:${roll}`;
    const sig = `${entry.totals.yeas}-${entry.totals.nays}-${entry.totals.present}`;
    if (_mGet(dedupKey) === sig) return;
    _mSet(dedupKey, sig, 15_000); // 15s — slightly longer than the 10s poll interval

    const key = rollLogKey();
    const existing = await env.HLS_CACHE.get(key, 'json') || { entries: [] };
    const entries = existing.entries || [];
    const idx = entries.findIndex(e => e.roll === roll);
    if (idx >= 0) entries[idx] = entry; else entries.push(entry);
    if (entries.length > 50) entries.splice(0, entries.length - 50);
    await env.HLS_CACHE.put(key, JSON.stringify({ entries }), { expirationTtl: 7 * 24 * 3600 });
    // Invalidate the assembled cache so next read picks up the new entry
    _mSet('roll-log-assembled', '', 0);
  } catch { /* non-critical — don't let roll-log errors affect the floor response */ }
}

async function handleDomeWatchFloor(env) {
  // kvTtl=0: skip KV writes entirely. SSE is the real-time channel; REST is a supplement.
  // Each PoP caches independently in memory (10s), avoiding cross-PoP KV write churn.
  return kvCache(env, 'domewatch-floor', 10, async () => {
    try {
      const response = await fetch(`${DOMEWATCH_CONFIG.baseUrl}/floor`, {
        headers: { 'X-API-Key': _domewatchApiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const data = await response.json();
      // Write roll-log server-side — eliminates the need for a public POST endpoint.
      await maybeWriteRollLog(data, env);
      return new Response(JSON.stringify(data), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: `Failed to fetch DomeWatch floor data: ${error.message}` }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }
  }, 0);
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
      encoder: new TextEncoder(),
      heartbeatInterval: null
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

  const startHeartbeat = () => {
    if (relay.heartbeatInterval) return;
    relay.heartbeatInterval = setInterval(() => {
      if (relay.clients.size === 0) {
        clearInterval(relay.heartbeatInterval);
        relay.heartbeatInterval = null;
        return;
      }
      broadcast(`: heartbeat\n\n`);
    }, 20000);
  };

  const ensureUpstream = async () => {
    if (relay.upstreamReader) return;
    relay.upstreamConnected = true;
    syncRelay();

    try {
      const response = await fetch(`${DOMEWATCH_CONFIG.baseUrl}/stream/votes/current`, {
        method: 'GET',
        headers: {
          'X-API-Key': _domewatchApiKey,
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

      const STALE_MS = 300_000; // 5 min — DomeWatch goes silent during recess; 45s caused ~1800 reconnects/day
      const readWithTimeout = () => Promise.race([
        reader.read(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SSE stale: no data for 45s')), STALE_MS)
        )
      ]);

      while (true) {
        const { value, done } = await readWithTimeout();
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
      // Reconnect silently — do not broadcast errors to clients
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
      startHeartbeat();
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
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
}


async function handleAmendments(request, env) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('bill'); // e.g. "hr-1041"
  const congress = url.searchParams.get('congress') || '119';
  if (!slug || !/^[a-z0-9-]+$/.test(slug) || !/^\d+$/.test(congress)) {
    return new Response(JSON.stringify({ amendments: [], error: 'Missing or invalid bill slug' }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  const cacheKey = `amendments_${congress}_${slug}`;
  // in-memory 10 min; KV re-checked hourly; write-on-change (via kvCache) only
  // writes when the amendment list actually changes, instead of every 10 min.
  return kvCache(env, cacheKey, 600, async () => {
    try {
      const resp = await fetch(`https://rules.house.gov/bill/${congress}/${slug}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)' }
      });
      // Non-ok → return a non-ok Response so kvCache does NOT cache the failure.
      if (!resp.ok) {
        return new Response(JSON.stringify({ amendments: [], error: `rules.house.gov returned ${resp.status}` }), {
          status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'no-store' }
        });
      }
      const html = await resp.text();

      const amendments = [];
      const tableMatch = html.match(/<table[^>]*class="sortable"[^>]*>([\s\S]*?)<\/table>/);
      if (tableMatch) {
        const rows = tableMatch[1].match(/<tr>([\s\S]*?)<\/tr>/g) || [];
        for (const row of rows.slice(1)) { // skip header row
          const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
          if (cells.length < 6) continue;
          const clean = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const linkMatch = cells[2].match(/href="([^"]+)"/);
          const num = clean(cells[0]);
          const sponsors = clean(cells[2]);
          if (!/^\d+$/.test(num) || !sponsors) continue; // skip sub-headers / empty rows
          amendments.push({
            num,
            version: clean(cells[1]),
            sponsors,
            pdfUrl: linkMatch ? linkMatch[1] : null,
            party: clean(cells[3]),
            summary: clean(cells[4]),
            status: clean(cells[5]),
          });
        }
      }
      return new Response(JSON.stringify({ amendments }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    } catch (err) {
      return new Response(JSON.stringify({ amendments: [], error: err.message }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'no-store' }
      });
    }
  }, 3600);
}

// Convert ISO string to Eastern date string (YYYY-MM-DD), approximate DST
function toEasternDateStr(isoString) {
  const d = new Date(isoString);
  const month = d.getUTCMonth() + 1;
  const offset = (month >= 3 && month <= 11) ? -4 : -5;
  return new Date(d.getTime() + offset * 3600000).toISOString().slice(0, 10);
}


async function handleLeadership(env) {
  return kvCache(env, 'leadership', 3600, async () => {
    try {
      const response = await fetch('https://clerk.house.gov/Members/ViewLeadership', {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HouseMonitor/1.0)' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();

      const bioguideMatch = html.match(/\/images\/members\/([A-Z]\d+)\.jpg/);
      const nameMatch = html.match(/<h1[^>]*>\s*Rep\.\s+([^<]+)<\/h1>/);
      const titleMatch = html.match(/<p class="title"[^>]*>([^<]+)<\/p>/);

      if (!bioguideMatch || !nameMatch) throw new Error('Could not parse Speaker from leadership page');

      return new Response(JSON.stringify({
        bioguideId: bioguideMatch[1],
        name: nameMatch[1].trim(),
        title: titleMatch ? titleMatch[1].trim() : 'Speaker of the House',
      }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }
  });
}

// Fetch special rules (H.Res.) for bills currently under consideration.
// Uses Congress.gov to find recent H.Res. bills whose titles indicate they are
// "providing for consideration of" a floor bill.
async function handleRules(request, env) {
  return kvCache(env, 'rules_v7', 30 * 60, async () => {
    try {
      // Fetch the most recently-updated H.Res. bills for the current Congress.
      // Special rules are always H.Res. and their titles start with "Providing for consideration of…"
      // Limit 250 (Congress.gov max): during busy weeks dozens of commemorative
      // H.Res. resolutions get updated daily and were pushing the current week's
      // rule out of a smaller top-N window by updateDate.
      const url = `https://api.congress.gov/v3/bill/${CURRENT_CONGRESS}/hres?api_key=${_congressApiKey}&sort=updateDate+desc&limit=250&format=json`;
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!resp.ok) throw new Error(`Congress.gov /hres returned ${resp.status}`);
      const data = await resp.json();

      // Filter to only special rules (bills whose title starts with "Providing for consideration of…")
      const candidates = (data.bills || []).filter(bill => /providing for consideration/i.test(bill.title || ''));

      // Fetch individual bill detail + actions in parallel to get sponsor and passage vote.
      // The list endpoint (/hres) does not include sponsors, and latestAction is the
      // post-vote procedural motion — the actual vote count is in the actions list.
      const details = await Promise.all(
        candidates.map(async bill => {
          try {
            const base = `https://api.congress.gov/v3/bill/${CURRENT_CONGRESS}/hres/${bill.number}`;
            const key = `?api_key=${_congressApiKey}&format=json`;
            const [detailResp, actionsResp] = await Promise.all([
              fetch(`${base}${key}`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) }),
              fetch(`${base}/actions${key}&limit=15&sort=updateDate+desc`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) }),
            ]);
            const billDetail = detailResp.ok ? (await detailResp.json()).bill || null : null;
            // Find the House passage action that contains a vote count (e.g. "208 - 207")
            let passageVote = null;
            if (actionsResp.ok) {
              const actionsData = await actionsResp.json();
              const passageAction = (actionsData.actions || []).find(a => {
                const t = a.text || '';
                return /on agreeing to the resolution|passed house|on passage|agreed to by the yeas/i.test(t)
                    && /\d+\s*[-–]\s*\d+/.test(t);
              });
              if (passageAction) {
                const m = passageAction.text.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)/);
                if (m) passageVote = `${m[1].replace(/,/g,'')}-${m[2].replace(/,/g,'')}`;
              }
            }
            return { billDetail, passageVote };
          } catch { return { billDetail: null, passageVote: null }; }
        })
      );

      const rules = [];
      for (let i = 0; i < candidates.length; i++) {
        const bill = candidates[i];
        const { billDetail, passageVote } = details[i] || {};
        const title = bill.title || '';

        // Extract all bill IDs mentioned in the title (the bills this rule covers).
        // Use the same normalization as normalizeBillIdForRules() on the client:
        //   "H.R. 1041" → "HR1041", "S. 123" → "S123"
        const billPattern = /\b(H\.R\.|S\.|H\.J\.Res\.|H\.Con\.Res\.|S\.Con\.Res\.|S\.J\.Res\.|S\.Res\.)\s*(\d+)/gi;
        const bills = [];
        for (const m of title.matchAll(billPattern)) {
          bills.push((m[1] + m[2]).toUpperCase().replace(/[.\s]/g, ''));
        }
        if (!bills.length) continue;

        // Status: passed = cleared the House; reported = out of Rules Committee only
        const actionText = (bill.latestAction?.text || '').toLowerCase();
        const ruleStatus = /passed|agreed to/i.test(actionText) ? 'passed'
                         : /reported|ordered reported/i.test(actionText) ? 'reported'
                         : 'filed';

        // Sponsor comes from the detail endpoint (not present in list response)
        const sponsorList = billDetail?.sponsors || [];
        const sp = sponsorList.length ? sponsorList[0] : null;

        rules.push({
          hres: `H.Res. ${bill.number}`,
          hresNum: bill.number,
          title: bill.title || null,
          passageVote: passageVote || null,  // e.g. "208-207", null if voice vote or not yet passed
          pdfUrl: null,
          ruleStatus,
          bills,
          sponsor: sp ? {
            bioguideId: sp.bioguideId || null,
            firstName: sp.firstName || null,
            lastName: sp.lastName || null,
            party: sp.party || null,
            state: sp.state || null,
            district: sp.district ?? null,
          } : null,
        });
      }

      return new Response(JSON.stringify({ rules }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    } catch (err) {
      return new Response(JSON.stringify({ rules: [], error: err.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'no-store' }
      });
    }
  });
}

// ── Statements of Administration Policy (SAPs) ───────────────────────────────
// whitehouse.gov/omb publishes SAPs as PDF uploads. The listing page is
// server-rendered with <a href="...pdf">BILL_ID – Title (Date)</a> entries,
// so we can parse bill → PDF URL directly with no extra fetch per bill.
// Returns a map keyed by normalized bill id: { "H.R. 8646": "https://...pdf" }
async function fetchSapMap(env) {
  return kvCache(env, 'sap-map-v1', 2 * 60 * 60, async () => {
    const resp = await fetch(
      'https://www.whitehouse.gov/omb/information-resources/legislative/statements-of-administration-policy/',
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }, signal: AbortSignal.timeout(12000) }
    );
    if (!resp.ok) throw new Error(`SAP listing ${resp.status}`);
    const html = await resp.text();
    const map = {};
    // Each SAP is an anchor whose text starts with the bill ID, e.g.:
    //   <a href="…/H.R.-8646-SAP_Updated.pdf">H.R. 8646 — Agriculture … (June 4, 2026)</a>
    const linkRe = /href="(https?:\/\/www\.whitehouse\.gov\/wp-content\/uploads\/[^"]+\.pdf)"[^>]*>([^<]{3,220})/gi;
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const pdfUrl = m[1];
      const text = m[2].replace(/&#?\w+;/g, ' ').trim();
      // Extract the leading bill ID (handles H.R., H.Res., H.Con.Res., S., S.J.Res., etc.)
      const billM = text.match(/^(H\.\s*R\.|H\.\s*Con\.\s*Res\.|H\.\s*J\.\s*Res\.|H\.\s*Res\.|S\.\s*J\.\s*Res\.|S\.\s*Con\.\s*Res\.|S\.)\s*(\d+)/i);
      if (!billM) continue;
      // Normalize: collapse spaces inside type abbreviation ("H. Res." → "H.Res.")
      const normId = billM[0].replace(/([A-Z])\.\s+(?=[A-Z])/gi, '$1.').replace(/\s+(\d)/, ' $1').trim();
      if (!map[normId]) map[normId] = pdfUrl; // keep first (most recent) SAP per bill
    }
    return JSON.stringify(map);
  });
}

// ── Democratic Whip recommendations ──────────────────────────────────────────
// DomeWatch's /whip-notices endpoint publishes the House Democratic Whip's
// recommended position (YES/NO) on some upcoming votes. We surface only the
// bills with an actual recommendation (DomeWatch nulls it for low-confidence
// items). Returns a map keyed by normalized bill id so the client can match it
// to this week's bills:  { "HR8646": { recommendation: "NO", confidence: "high",
// billNumber: "H.R. 8646" }, ... }
function normalizeWhipBillId(s) {
  return (s || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

async function handleWhipNotices(env) {
  // Notices post ~twice daily (daily + nightly). 30-min freshness is plenty;
  // write-on-change keeps KV writes minimal.
  return kvCache(env, 'whip-notices-v1', 30 * 60, async () => {
    try {
      const resp = await fetch('https://data.domewatch.us/v1/whip-notices?limit=8', {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) throw new Error(`whip-notices returned ${resp.status}`);
      const data = await resp.json();
      const notices = data.data || [];

      // Notices are newest-first; the first recommendation we see for a bill wins.
      const recs = {};
      for (const notice of notices) {
        for (const item of (notice.items || [])) {
          const rec = (item.recommendation || '').toUpperCase();
          if (rec !== 'YES' && rec !== 'NO') continue; // skip null / non-recommendations
          const key = normalizeWhipBillId(item.billNumber || item.billId);
          if (!key || recs[key]) continue; // keep the most-recent occurrence
          recs[key] = {
            recommendation: rec,
            confidence: item.confidence || null,
            billNumber: item.billNumber || null,
          };
        }
      }
      return new Response(JSON.stringify({ recs }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'public, max-age=900' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ recs: {}, error: err.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'no-store' }
      });
    }
  }, 1800);
}

// ── Whip feed helpers (Firestore, DomeWatch project pacific-castle-135023) ───
// All four feed types (floor / daily / nightly / weekly) live in the same
// public Firestore project that powers domewatch.us/whip/*.
// No auth required — Firestore security rules allow public reads.
// Returns newest-first array of { id, title, body, publishedAt, noticeType }.

const FIRESTORE_PROJECT = 'pacific-castle-135023';
const FIRESTORE_RUN_QUERY = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery`;

// Generic Firestore query for a single-field-filtered ActivityFeeds collection.
async function queryWhipFeed({ collectionId = 'ActivityFeeds', noticeType, limit = 10 } = {}) {
  // Floor feed uses only the office filter; typed feeds add a 'type' field filter.
  const where = noticeType
    ? {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'Office.id' }, op: 'EQUAL', value: { stringValue: 'C001101' } } },
            { fieldFilter: { field: { fieldPath: 'type'      }, op: 'EQUAL', value: { stringValue: noticeType } } },
          ],
        },
      }
    : { fieldFilter: { field: { fieldPath: 'Office.id' }, op: 'EQUAL', value: { stringValue: 'C001101' } } };

  const query = {
    structuredQuery: {
      from: [{ collectionId }],
      where,
      orderBy: [{ field: { fieldPath: 'publishedAt' }, direction: 'DESCENDING' }],
      limit,
    },
  };

  const resp = await fetch(FIRESTORE_RUN_QUERY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Firestore returned ${resp.status}`);
  const rows = await resp.json();
  return rows
    .filter(r => r.document)
    .map(r => {
      const f = r.document.fields || {};
      return {
        id:          f.id?.stringValue || r.document.name.split('/').pop(),
        title:       f.title?.stringValue || '',
        body:        f.body?.stringValue || '',
        publishedAt: f.publishedAt?.timestampValue || null,
        noticeType:  noticeType || f.type?.stringValue || 'floor',
      };
    });
}

async function handleWhipFloorUpdates() {
  try {
    const items = await queryWhipFeed({ limit: 10 });
    return new Response(JSON.stringify({ items }), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'public, max-age=60' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ items: [], error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'no-store' }
    });
  }
}

// Daily / nightly / weekly notices — from the same DomeWatch data API as vote
// recs, but returning notice-level content (sourceText HTML, kind, postedAt).
// Field map from DomeWatch API → our schema:
//   kind        → noticeType  ("daily" | "nightly" | "weekly")
//   postedAt    → publishedAt
//   sourceText  → body        (HTML)
//   publishDate used to construct a display title
async function handleWhipNoticesFeed() {
  try {
    const resp = await fetch('https://data.domewatch.us/v1/whip-notices?limit=8', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`whip-notices returned ${resp.status}`);
    const data = await resp.json();
    const notices = data.data || [];

    const KIND_LABEL = { daily: 'Daily Whip Notice', nightly: 'Nightly Whip Notice', weekly: 'Week Ahead Notice' };

    const items = notices
      .filter(n => n.kind && n.sourceText)   // skip items with no displayable content
      .map(n => {
        // Construct a human-readable title from kind + publishDate
        const dateStr = n.publishDate
          ? new Date(n.publishDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
          : '';
        const label = KIND_LABEL[n.kind] || (n.kind.charAt(0).toUpperCase() + n.kind.slice(1) + ' Whip Notice');
        return {
          id:           n.id || '',
          title:        dateStr ? `${label} — ${dateStr}` : label,
          body:         n.sourceText || '',
          publishedAt:  n.postedAt || null,
          publishDate:  n.publishDate || null,   // YYYY-MM-DD, reliable; postedAt TZ is unreliable
          noticeType:   n.kind,
          houseMeetsAt: n.houseMeetsAt || null,
          firstVotes:   n.firstVotes   || null,
          lastVotes:    n.lastVotes    || null,
        };
      });

    return new Response(JSON.stringify({ items }), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ items: [], error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'no-store' }
    });
  }
}

// ── Raw whip-notices passthrough (inspection endpoint) ───────────────────────
// Returns the complete unfiltered DomeWatch response so we can see every field
// on every notice item (including those with null recommendations).
// Short TTL (5 min) — this is for development inspection, not production use.
async function handleWhipNoticesRaw(env) {
  try {
    const resp = await fetch('https://data.domewatch.us/v1/whip-notices?limit=8', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`whip-notices returned ${resp.status}`);
    const data = await resp.json();
    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'no-store' }
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
  _congressApiKey  = env?.CONGRESS_API_KEY  || '';
  _domewatchApiKey = env?.DOMEWATCH_API_KEY || '';

  const origin = request.headers.get('Origin') || '';
  CORS_HEADERS = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://house-floor.evanhollander.org',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/house-floor/, '');

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  // Route handling
  if (path === '/api/proceedings' && request.method === 'GET') {
    return await handleProceedings(request, env);
  } else if (path === '/api/news' && request.method === 'GET') {
    return await handleNews(env);
  } else if (path === '/api/bills' && request.method === 'GET') {
    return await handleBills(request, env);
  } else if (path === '/api/voting-days' && request.method === 'GET') {
    return await handleVotingDays();
  } else if (path === '/api/airport-delays' && request.method === 'GET') {
    return await handleAirportDelays();
  } else if (path === '/api/member-data' && request.method === 'GET') {
    return await handleMemberData(env);
  } else if (path === '/api/congress-index' && request.method === 'GET') {
    return await handleCongressIndex();
  } else if (path === '/api/tweets' && request.method === 'GET') {
    const twitterUser = url.searchParams.get('user');
    if (twitterUser) return await handleUserTweets(twitterUser.replace(/^@/, ''));
    return await handleTweets(env);
  } else if (path === '/api/img-proxy' && request.method === 'GET') {
    return await handleImageProxy(request);
  } else if (path === '/api/bluesky' && request.method === 'GET') {
    return await handleBlueskyFeed(env);
  } else if (path === '/api/casualty-list' && request.method === 'GET') {
    return await handleCasualtyList(env);
  } else if (path === '/api/rules' && request.method === 'GET') {
    return await handleRules(request, env);
  } else if (path === '/api/whip-floor-updates' && request.method === 'GET') {
    return await handleWhipFloorUpdates();
  } else if (path === '/api/whip-notices-feed' && request.method === 'GET') {
    return await handleWhipNoticesFeed();
  } else if (path === '/api/whip-notices-raw' && request.method === 'GET') {
    return await handleWhipNoticesRaw(env);
  } else if (path === '/api/whip-notices' && request.method === 'GET') {
    return await handleWhipNotices(env);
  } else if (path === '/api/amendments' && request.method === 'GET') {
    return await handleAmendments(request, env);
  } else if (path === '/api/leadership' && request.method === 'GET') {
    return await handleLeadership(env);
  } else if (path === '/api/last-session-date' && request.method === 'GET') {
    return await handleLastSessionDate(request);
  } else if (path === '/api/roll-log' && request.method === 'GET') {
    return await handleRollLogGet(env);
  } else if (path === '/api/hls-url' && request.method === 'GET') {
    return await handleHlsUrl(env);
  } else if (path === '/api/domewatch-floor' && request.method === 'GET') {
    return await handleDomeWatchFloor(env);
  } else if (path === '/api/stream/votes/current' && request.method === 'GET') {
    return await handleDomeWatchStream(request, env);
  } else if (path === '/api/stream/votes/current/status' && request.method === 'GET') {
    const coordinator = await getStreamCoordinator(env);
    return await coordinator.fetch(new Request(`${url.origin}${path}?status=1`, { method: 'POST' }));
  } else if (path.startsWith('/api/congress-index/roll/') && request.method === 'GET') {
    // Handle individual roll call requests — validate to digits only to prevent path traversal
    const rollNumber = path.split('/').pop();
    if (!/^\d{1,6}$/.test(rollNumber)) {
      return new Response('Bad request', { status: 400, headers: CORS_HEADERS });
    }
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
  } else {
    // Catch-all: return 404 with CORS headers so browsers don't log a CORS error
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
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
    // Map<connectionId, { controller, lastPingAt }>
    this.clients = new Map();
    this.upstreamReader = null;
    this.upstreamConnected = false;
    this.upstreamReconnects = 0;
    this.lastEventAt = null;
    this.currentEventId = 0;
    this.encoder = new TextEncoder();
    this.heartbeatInterval = null;
    this.proceedingsTimeout = null;
    this.floorTimeout = null;
    this._floorStatusValue = null; // last known now.value from DomeWatch floor endpoint
    this._lastPollFast = null;     // last broadcast poll-mode state (null = not yet sent)
    this.dataIntervals = new Map(); // name → intervalId
    this.dataCache = new Map();     // name → last JSON string (change detection)
    this.nextClientId = 1;
    this.health = {
      sourceOfTruth: true,
      upstreamConnected: false,
      connectedClients: 0,
      upstreamReconnects: 0,
      lastEventAt: null,
      lastError: null
    };
  }

  startHeartbeat() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      // Evict clients whose browser hasn't pinged in 2 minutes (zombie cleanup).
      const staleMs = 2 * 60 * 1000;
      const now = Date.now();
      for (const [id, entry] of this.clients) {
        if (now - entry.lastPingAt > staleMs) {
          try { entry.controller.close(); } catch {}
          this.clients.delete(id);
        }
      }
      if (this.clients.size === 0) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
        clearTimeout(this.proceedingsTimeout);
        this.proceedingsTimeout = null;
        clearTimeout(this.floorTimeout);
        this.floorTimeout = null;
        for (const id of this.dataIntervals.values()) clearInterval(id);
        this.dataIntervals.clear();
        return;
      }
      this.broadcast(`: heartbeat\n\n`);
    }, 55000);
  }

  // Returns true if current ET time is within assumed House business hours (M–F 8:55am–8pm).
  // Used as a fallback when floor status is unknown — outside these hours we default to slow mode.
  _inBusinessHours() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = now.getDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return false;
    const mins = now.getHours() * 60 + now.getMinutes();
    return mins >= 535 && mins < 1200; // 8:55am=535, 8:00pm=1200
  }

  // Returns true if the House appears to be in session, based on last known floor status
  // combined with a business-hours schedule as a safety net.
  // Fast = floor actively doing something OR (inside hours AND status unknown/active).
  // Slow = explicitly inactive (recess/not_in_session) OR outside hours with no active status.
  _shouldPollFast() {
    const INACTIVE = new Set(['recess', 'house_not_in_session']);
    const s = this._floorStatusValue;
    if (s !== null && !INACTIVE.has(s)) return true;  // known active status → fast
    if (s !== null && INACTIVE.has(s)) return false;  // known inactive → slow
    return this._inBusinessHours();                   // unknown → fall back to schedule
  }

  startProceedingsBroadcast() {
    if (this.proceedingsTimeout !== null) return;
    // Fetch proceedings directly from House.gov RSS — bypasses the Worker entirely,
    // saving ~17k Worker requests/day (one self-call per 5s × 86400s/day).
    const FAST_MS = 5_000;
    const SLOW_MS = 3 * 60_000;
    const poll = async () => {
      this.proceedingsTimeout = null;
      if (this.clients.size === 0) return; // heartbeat will clear; don't reschedule
      try {
        const resp = await fetch(`https://clerk.house.gov/Home/Feed?_=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache, no-store', 'Pragma': 'no-cache' },
          signal: AbortSignal.timeout(8000),
          cf: { cacheTtl: 0, cacheEverything: false },
        });
        if (resp.ok) {
          const xml = await resp.text();
          const result = parseRSSFeed(xml, 'proceedings');
          if (result.items?.length) {
            await this.broadcast(`event: proceedings\ndata: ${JSON.stringify({ items: result.items })}\n\n`);
          }
        }
      } catch { /* non-critical */ }
      if (this.clients.size > 0) {
        this.proceedingsTimeout = setTimeout(poll, this._shouldPollFast() ? FAST_MS : SLOW_MS);
      }
    };
    this.proceedingsTimeout = setTimeout(poll, 0); // run immediately
  }

  // Polls the DomeWatch floor REST endpoint and broadcasts as event: floor.
  // Interval adapts: fast (10s) when House is in session, slow (3 min) when not.
  startFloorBroadcast() {
    if (this.floorTimeout !== null) return;
    const FAST_MS = 10_000;
    const SLOW_MS = 3 * 60_000;
    const poll = async () => {
      this.floorTimeout = null;
      if (this.clients.size === 0) return; // heartbeat will clear; don't reschedule
      try {
        const resp = await fetch('https://api.evanhollander.org/house-floor/api/domewatch-floor', {
          signal: AbortSignal.timeout(10000),
          cf: { cacheTtl: 0, cacheEverything: false },
        });
        if (resp.ok) {
          const json = await resp.text();
          // Update cached floor status for adaptive polling decisions
          try { this._floorStatusValue = JSON.parse(json)?.now?.value ?? null; } catch {}
          if (this.dataCache.get('floor') !== json) {
            this.dataCache.set('floor', json);
            await this.broadcast(`event: floor\ndata: ${json}\n\n`);
          }
        }
      } catch { /* non-critical */ }
      if (this.clients.size > 0) {
        const fast = this._shouldPollFast();
        const nextMs = fast ? FAST_MS : SLOW_MS;
        this.floorTimeout = setTimeout(poll, nextMs);
        // Broadcast poll-mode event when state changes so the dashboard can reflect it
        if (this._lastPollFast !== fast) {
          this._lastPollFast = fast;
          const INACTIVE = new Set(['recess', 'house_not_in_session']);
          const s = this._floorStatusValue;
          const reason = s !== null ? s : 'schedule';
          this.broadcast(`event: poll-mode\ndata: ${JSON.stringify({ fast, reason, intervalMs: nextMs })}\n\n`).catch(() => {});
        }
      }
    };
    this.floorTimeout = setTimeout(poll, 0); // run immediately
  }

  // Polls low-frequency data sources once per interval for ALL connected clients,
  // then broadcasts via SSE. Eliminates per-user Worker requests for these endpoints.
  startDataBroadcasts() {
    const BASE = 'https://api.evanhollander.org/house-floor/api';

    // Simple single-URL sources
    const sources = [
      { name: 'tweets',        url: `${BASE}/tweets`,         ms: 10 * 60 * 1000 },
      { name: 'airportdelays', url: `${BASE}/airport-delays`, ms: 30 * 60 * 1000 },
      { name: 'housemakeup',   url: `${BASE}/member-data`,    ms: 30 * 60 * 1000 },
    ]; // bluesky removed — ticker is hidden (display:none)
    for (const { name, url, ms } of sources) {
      if (this.dataIntervals.has(name)) continue;
      const poll = async () => {
        if (this.clients.size === 0) return;
        try {
          const resp = await fetch(url, {
            signal: AbortSignal.timeout(20000),
            cf: { cacheTtl: 0, cacheEverything: false },
          });
          if (!resp.ok) return;
          const json = await resp.text();
          if (this.dataCache.get(name) === json) return; // unchanged, skip broadcast
          this.dataCache.set(name, json);
          await this.broadcast(`event: ${name}\ndata: ${json}\n\n`);
        } catch { /* non-critical */ }
      };
      poll(); // run immediately on first client connect
      this.dataIntervals.set(name, setInterval(poll, ms));
    }

    // Bills — combines three endpoints into one SSE event so the browser gets
    // bills + rules + whip recs in a single push.
    if (!this.dataIntervals.has('bills')) {
      const pollBills = async () => {
        if (this.clients.size === 0) return;
        try {
          const [billsResp, rulesResp, whipResp] = await Promise.all([
            fetch(`${BASE}/bills`,        { signal: AbortSignal.timeout(20000), cf: { cacheTtl: 0, cacheEverything: false } }),
            fetch(`${BASE}/rules`,        { signal: AbortSignal.timeout(20000), cf: { cacheTtl: 0, cacheEverything: false } }),
            fetch(`${BASE}/whip-notices`, { signal: AbortSignal.timeout(20000), cf: { cacheTtl: 0, cacheEverything: false } }),
          ]);
          if (!billsResp.ok) return; // bills are essential; skip if unavailable
          const bills = await billsResp.text();
          const rules = rulesResp.ok  ? await rulesResp.text()  : null;
          const whip  = whipResp.ok   ? await whipResp.text()   : null;
          // Change detection: skip broadcast if nothing changed
          const cacheKey = bills + '|' + (rules || '') + '|' + (whip || '');
          if (this.dataCache.get('bills') === cacheKey) return;
          this.dataCache.set('bills', cacheKey);
          const payload = JSON.stringify({
            bills: JSON.parse(bills),
            rules: rules ? JSON.parse(rules) : null,
            whip:  whip  ? JSON.parse(whip)  : null,
          });
          this.dataCache.set('bills-payload', payload); // cached for immediate replay to new clients
          await this.broadcast(`event: bills\ndata: ${payload}\n\n`);
        } catch { /* non-critical */ }
      };
      pollBills();
      this.dataIntervals.set('bills', setInterval(pollBills, 10 * 60 * 1000));
    }
  }

  // Immediately replays any cached data to a newly connected client so they don't
  // have to wait for the next polling interval (up to 10 min for bills).
  sendCachedDataToClient(controller) {
    const enc = this.encoder;
    const send = (eventName, data) =>
      controller.enqueue(enc.encode(`event: ${eventName}\ndata: ${data}\n\n`));
    const floor   = this.dataCache.get('floor');
    const bills   = this.dataCache.get('bills-payload');
    const tweets  = this.dataCache.get('tweets');
    const delays  = this.dataCache.get('airportdelays');
    const makeup  = this.dataCache.get('housemakeup');
    if (floor)  send('floor',         floor);
    if (bills)  send('bills',         bills);
    if (tweets) send('tweets',        tweets);
    if (delays) send('airportdelays', delays);
    if (makeup) send('housemakeup',   makeup);
    // Send current poll-mode so new clients don't have to wait for the next mode change
    if (this._lastPollFast !== null) {
      const INACTIVE = new Set(['recess', 'house_not_in_session']);
      const s = this._floorStatusValue;
      const reason = s !== null ? s : 'schedule';
      const intervalMs = this._lastPollFast ? 10_000 : 3 * 60_000;
      send('poll-mode', JSON.stringify({ fast: this._lastPollFast, reason, intervalMs }));
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const cors = corsForRequest(request);
    if (request.method === 'POST' && url.searchParams.has('status')) {
      return new Response(JSON.stringify(this.getStatus()), {
        headers: {
          'Content-Type': 'application/json',
          ...cors
        }
      });
    }

    // Ping endpoint — browser POSTs here every 45s to prove it's still alive.
    if (request.method === 'POST' && url.searchParams.has('ping')) {
      const id = url.searchParams.get('ping');
      const entry = this.clients.get(id);
      if (entry) entry.lastPingAt = Date.now();
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: cors });
    }

    const clientId = String(this.nextClientId++);
    let removed = false;

    const removeClient = () => {
      if (!removed) {
        removed = true;
        this.clients.delete(clientId);
        this.syncHealth();
      }
    };

    const readable = new ReadableStream({
      start: (controller) => {
        this.clients.set(clientId, { controller, lastPingAt: Date.now() });
        this.syncHealth();
        controller.enqueue(this.encoder.encode(
          `event: connected\ndata: ${JSON.stringify({ ok: true, sourceOfTruth: true, clientId })}\n\n`
        ));
        this.sendCachedDataToClient(controller); // replay any cached state immediately
        this.startHeartbeat();
        this.startProceedingsBroadcast();
        this.startFloorBroadcast();
        this.startDataBroadcasts();
        this.ensureUpstream();
      },
      cancel: removeClient
    });

    request.signal?.addEventListener('abort', removeClient, { once: true });

    return new Response(readable, {
      headers: {
        ...sseResponseInit().headers,
        ...cors,
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

  pingClient(clientId) {
    const entry = this.clients.get(clientId);
    if (entry) entry.lastPingAt = Date.now();
  }

  async ensureUpstream() {
    if (this.upstreamReader) return;
    this.upstreamConnected = true;
    this.syncHealth();

    try {
      const response = await fetch(`${DOMEWATCH_CONFIG.baseUrl}/stream/votes/current`, {
        method: 'GET',
        headers: {
          'X-API-Key': this.env.DOMEWATCH_API_KEY || '',
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

      // If DomeWatch goes silent (e.g. between votes), the TCP connection stays
      // open but no bytes arrive. 45s gives plenty of room before we force a
      // reconnect; clients stay connected via the 20s heartbeat comment.
      const STALE_MS = 300_000; // 5 min — DomeWatch goes silent during recess; 45s caused ~1800 reconnects/day
      const readWithTimeout = () => Promise.race([
        reader.read(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SSE stale: no data for 45s')), STALE_MS)
        )
      ]);

      while (true) {
        const { value, done } = await readWithTimeout();
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
      // Do NOT broadcast upstream errors to clients — reconnect silently so
      // clients never see a disruption during normal between-vote quiet periods.
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
    for (const [id, { controller }] of this.clients) {
      try {
        if (controller.desiredSize === null) { dead.push(id); continue; }
        controller.enqueue(encoded);
      } catch {
        dead.push(id);
      }
    }
    for (const id of dead) {
      this.clients.delete(id);
    }
    this.syncHealth();
  }
}
