// The 404 page's "Report an error" link: opens the form on THIS host with the address that was not found and the page that linked to it (if the browser says), so the
// report arrives knowing what failed. suggest-box.js reads `missing` and `from` and writes them into the form.
(function () {
  const a = document.getElementById('nf-report');
  if (!a) return;
  const q = new URLSearchParams({ report: 'error', missing: location.href.slice(0, 300) });
  if (document.referrer) q.set('from', document.referrer.slice(0, 300));
  a.href = '/?' + q.toString();
})();
