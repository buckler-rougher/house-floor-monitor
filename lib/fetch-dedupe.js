// One request where the page asked for the same thing twice at once.
//
// The board's scripts start independently and several of them want the same Worker data at load (the member list, the Congress index, a roll's detail: three
// requests each, overlapping, on a cold load). Every request to the Worker is a Worker invocation, and the free plan allows 100,000 a day, so while one GET to the
// Worker is still on its way, a second for the same address shares it. Each caller gets its own copy of the response (a body can be read once).
//
// Only plain GETs to the board's own API, and only WHILE one is in flight: nothing is remembered once it answers, so polling still polls. A request that
// carries its own abort signal is left alone, since sharing it would tie one caller's timeout to another's.
(function (root) {
  const API = /^https:\/\/api\.evanhollander\.org\//;

  function install(target) {
    if (!target.fetch || target.fetch.__dedupe) return;
    const real = target.fetch.bind(target);
    const inflight = new Map();
    const wrapped = function (input, init) {
      const isReq = typeof input === 'object' && input !== null && typeof input.url === 'string';
      const url = isReq ? input.url : String(input);
      const method = String((init && init.method) || (isReq && input.method) || 'GET').toUpperCase();
      if (method !== 'GET' || !API.test(url) || (init && init.signal)) return real(input, init);
      let p = inflight.get(url);
      if (!p) {
        p = real(input, init);
        inflight.set(url, p);
        const done = () => { inflight.delete(url); };
        p.then(done, done);
      }
      return p.then((r) => r.clone());
    };
    wrapped.__dedupe = true;
    target.fetch = wrapped;
  }

  root.FetchDedupe = { install };
  if (typeof document !== 'undefined') install(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FetchDedupe;
})(typeof globalThis !== 'undefined' ? globalThis : this);
