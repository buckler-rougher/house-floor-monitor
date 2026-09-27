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
  if (isSenate && (url.pathname === '/' || url.pathname === '/index.html')) {
    return next(new Request(new URL('/senate.html', url), request));
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
  '/social.webp':          { house: '/house-social.webp',           senate: '/senate-social.png' },
  '/social.svg':           { house: '/house-social.svg',            senate: '/senate-social.svg' },
  '/logo.svg':             { house: '/house-logo.svg',              senate: '/senate-logo.svg' },
};
