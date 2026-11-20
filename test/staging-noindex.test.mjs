#!/usr/bin/env node
//
// functions/_middleware.js: the staging sites tell search engines to stay away, and the real sites are untouched. Runs the Pages Function directly with a stand-in for `next`. No network.
import assert from 'assert';
import { onRequest } from '../functions/_middleware.js';
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };
const call = (url) => onRequest({ request: new Request(url), next: async () => new Response('<html>page</html>', { headers: { 'content-type': 'text/html' } }) });

for (const host of ['house-floor-staging.evanhollander.org', 'senate-floor-staging.evanhollander.org']) {
  await test(`${host}: robots.txt disallows everything`, async () => {
    const r = await call(`https://${host}/robots.txt`);
    assert.strictEqual(await r.text(), 'User-agent: *\nDisallow: /\n');
    assert.match(r.headers.get('x-robots-tag'), /noindex/);
  });
  await test(`${host}: every page carries X-Robots-Tag: noindex, and there is no sitemap`, async () => {
    for (const path of ['/', '/about', '/lib/app.js']) assert.match((await call(`https://${host}${path}`)).headers.get('x-robots-tag'), /noindex, nofollow/);
    assert.strictEqual((await call(`https://${host}/sitemap.xml`)).status, 404);
  });
}

await test('the real House site is unchanged: robots.txt allows crawling and names its sitemap, pages carry no X-Robots-Tag', async () => {
  const r = await call('https://house-floor.evanhollander.org/robots.txt');
  const t = await r.text();
  assert(/Allow: \//.test(t) && /Sitemap: /.test(t), t);
  assert.strictEqual(r.headers.get('x-robots-tag'), null);
  assert.strictEqual((await call('https://house-floor.evanhollander.org/')).headers.get('x-robots-tag'), null);
});

await test('the real Senate site is unchanged: no X-Robots-Tag added by the Function', async () => {
  assert.strictEqual((await call('https://senate-floor.evanhollander.org/')).headers.get('x-robots-tag'), null);
});

console.log(`\n${n} passed`);
