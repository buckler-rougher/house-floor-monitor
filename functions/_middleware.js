export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname === 'monitor-a6i.pages.dev') {
    return Response.redirect(
      `https://house-floor.evanhollander.org${url.pathname}${url.search}`,
      301
    );
  }
  return next();
}
