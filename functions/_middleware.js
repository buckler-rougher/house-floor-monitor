// Two boards, one Pages project.
//
// Pages serves a single static tree per project, so the Senate board is a second
// document beside index.html rather than a second deployment. Only the DOCUMENT
// is rewritten: styles.css, app.js and every image keep their own paths, so both
// boards load the same files and the stylesheet stays one source of truth rather
// than a copy that drifts.
//
// A rewrite, not a redirect. senate-floor.evanhollander.org has to stay in the
// address bar, because app.js picks its chamber from location.hostname.
export async function onRequest({ request, next }) {
  const url = new URL(request.url);

  if (url.hostname === 'monitor-a6i.pages.dev') {
    return Response.redirect(
      `https://house-floor.evanhollander.org${url.pathname}${url.search}`,
      301
    );
  }

  const isSenate = url.hostname === 'senate-floor.evanhollander.org' ||
                   url.hostname.startsWith('senate-floor.');
  const isDoc = url.pathname === '/' || url.pathname === '/index.html';
  let page = null;
  if (isSenate && isDoc) page = await next(new Request(new URL('/senate.html', url), request));
  else if (isDoc) page = await next();
  if (page) {
    const id = billIdFromSlug(url.searchParams.get('bill'));
    if (id) return withBillPreview(page, url, id, isSenate);
    return !isSenate && !url.search ? withLiveDescription(page) : page;
  }

  // robots.txt and the sitemap belong to a host: each says only its own address. The House site lists itself; the Senate site is noindex (a robots.txt that blocked it would hide
  // that very tag from a crawler), so it keeps the plain static robots.txt and has no sitemap.
  if (!isSenate && url.pathname === '/robots.txt') {
    return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${HOUSE}/sitemap.xml\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  }
  if (!isSenate && url.pathname === '/sitemap.xml') {
    const urls = ['/', '/about', '/accessibility'].map((p) => `  <url><loc>${HOUSE}${p}</loc></url>`).join('\n');
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  }

  const legacy = LEGACY_ASSETS[url.pathname];
  if (legacy) {
    return next(new Request(new URL(isSenate ? legacy.senate : legacy.house, url), request));
  }

  return next();
}

// The unprefixed asset names, resolved to whichever chamber is asking.
//
// These used to be the House's actual files, back when there was one board.
// Both chambers have their own now, so the bare names belong to neither and
// each one is served per host. Three separate reasons this mapping has to
// exist rather than the old names simply going away:
//
//  - /favicon.ico is fetched by convention, with no link tag to point at.
//    Browsers, crawlers and feed readers all ask for it, and renaming the file
//    without this would answer every one of them with a 404.
//  - Open Graph cards already posted to Slack, Bluesky and elsewhere embed
//    /social.webp. Those are out of our hands and would break retroactively.
//  - legal.html is served on both hostnames and links the bare names on
//    purpose, so it picks up the right chamber's icon instead of hardcoding
//    the House's. That is deliberate; do not "fix" it to a prefixed name.
const LEGACY_ASSETS = {
  '/favicon.svg':          { house: '/house-favicon.svg',           senate: '/senate-favicon.svg' },
  '/favicon.png':          { house: '/house-favicon.png',           senate: '/senate-favicon.png' },
  '/favicon.ico':          { house: '/house-favicon.ico',           senate: '/senate-favicon.ico' },
  '/apple-touch-icon.png': { house: '/house-apple-touch-icon.png',  senate: '/senate-apple-touch-icon.png' },
  '/site.webmanifest':     { house: '/house.webmanifest',           senate: '/senate.webmanifest' },
  '/social.webp':          { house: '/house-social.webp',           senate: '/senate-social.webp' },
  // the Senate card was a .png until 20 October; cards already posted embed that address, so it answers with the .webp
  '/senate-social.png':    { house: '/senate-social.webp',          senate: '/senate-social.webp' },
  '/social.svg':           { house: '/house-social.svg',            senate: '/senate-social.svg' },
  '/logo.svg':             { house: '/house-logo.svg',              senate: '/senate-logo.svg' },
};

// A shared ?bill=hr8646 link previews as THAT bill, not as the board. Unfurlers (Slack, iMessage, Bluesky, Twitter) do not run scripts, so the card
// has to be in the HTML they fetch: the page's own og/twitter title and description are rewritten from the Worker's bill answer. Any failure (no
// answer in 2 s, no title) returns the page untouched, so a link never breaks for want of a preview. Display style: bill types without periods.
const SLUG_TYPES = { hr: 'H.R.', hres: 'H.Res.', hjres: 'H.J.Res.', hconres: 'H.Con.Res.', s: 'S.', sres: 'S.Res.', sjres: 'S.J.Res.', sconres: 'S.Con.Res.' };
function billIdFromSlug(slug) {
  const m = String(slug || '').toLowerCase().match(/^(hr|hres|hjres|hconres|s|sres|sjres|sconres)(\d{1,5})$/);
  return m ? `${SLUG_TYPES[m[1]]} ${m[2]}` : null;
}
const plainId = (id) => id.replace(/\./g, '');
async function withBillPreview(page, url, id, isSenate) {
  try {
    const r = await fetch(`https://api.evanhollander.org/house-floor/api/senate/bill?id=${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(2000), cf: { cacheTtl: 600, cacheEverything: true },
    });
    if (!r.ok) return page;
    const b = await r.json();
    if (!b || !b.title) return page;
    const board = isSenate ? 'Senate' : 'House';
    const title = `${plainId(id)}: ${b.title}`.slice(0, 120);
    const desc = [b.latestAction ? `Latest action${b.latestActionDate ? ` (${b.latestActionDate})` : ''}: ${b.latestAction}` : '', `Monitoring the ${board} Floor`]
      .filter(Boolean).join('. ').slice(0, 280);
    const href = `${url.origin}/?bill=${url.searchParams.get('bill').toLowerCase()}`;
    const set = (attr, value) => ({ element(e) { e.setAttribute(attr, value); } });
    return new HTMLRewriter()
      .on('title', { element(e) { e.setInnerContent(`${title} | Monitoring the ${board} Floor`); } })
      .on('meta[property="og:title"]', set('content', title))
      .on('meta[name="twitter:title"]', set('content', title))
      .on('meta[property="og:description"]', set('content', desc))
      .on('meta[name="twitter:description"]', set('content', desc))
      .on('meta[name="description"]', set('content', desc))
      .on('meta[property="og:url"]', set('content', href))
      .on('link[rel="canonical"]', set('href', href))
      .transform(page);
  } catch { return page; }
}

// A search result for the House site carries the House's state, not a fixed line: when the House has adjourned, the description says when it next meets, from the Clerk's own
// proceedings. Any failure, or a state it does not recognize, leaves the page's own description. The Time Machine and other query pages are never rewritten.
const HOUSE = 'https://house-floor.evanhollander.org';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "The next meeting is scheduled for 12:00 p.m. on November 9, 2026." -> "Monday, 09 Nov 2026 at 12:00 PM EST" (the site's date and time format), or null
function parseNextMeeting(text) {
  const m = /next meeting is scheduled for\s+(.+?)\s+on\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s*\.?$/i.exec(String(text || '').replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const t = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i.exec(m[1].trim());
  const mi = MONTH_FULL.indexOf(m[2].toLowerCase());
  if (!t || mi < 0) return null;
  const hour = Number(t[1]);
  if (hour < 1 || hour > 12) return null;
  const day = Number(m[3]), year = Number(m[4]);
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).formatToParts(new Date(Date.UTC(year, mi, day, 17))).find((p) => p.type === 'timeZoneName');
  const weekday = DAYS[new Date(Date.UTC(year, mi, day)).getUTCDay()];
  return `${weekday}, ${String(day).padStart(2, '0')} ${MONTHS[mi]} ${year} at ${String(hour).padStart(2, '0')}:${t[2] || '00'} ${t[3].toUpperCase()}M ${zone ? zone.value : 'ET'}`;
}

// the newest proceedings entry says the House adjourned: then the description says so and when it next meets; otherwise null (keep the page's own)
function descriptionFromProceedings(items) {
  const latest = Array.isArray(items) && items[0] && items[0].description;
  if (!latest || !/adjourn/i.test(latest)) return null;
  const when = parseNextMeeting(latest);
  return when ? `The House is adjourned and next meets ${when}. Live floor video, votes, bills, and the Clerk's record, from public sources.` : null;
}

async function withLiveDescription(page) {
  try {
    const r = await fetch('https://api.evanhollander.org/house-floor/api/proceedings', { signal: AbortSignal.timeout(2000), cf: { cacheTtl: 120, cacheEverything: true } });
    if (!r.ok) return page;
    const desc = descriptionFromProceedings((await r.json()).items);
    if (!desc) return page;
    const set = { element(e) { e.setAttribute('content', desc); } };
    return new HTMLRewriter().on('meta[name="description"]', set).on('meta[property="og:description"]', set).on('meta[name="twitter:description"]', set).transform(page);
  } catch { return page; }
}
