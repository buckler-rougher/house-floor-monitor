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

  return next();
}
