# House Floor Monitor — Project Rules

## Deploy & commit rules
- Every change must be committed AND pushed in the same step
- Deploy via `git push` only — never `wrangler deploy` (auth is broken)
- After every deploy, **always state the version number** — just the latest app.js version, e.g. `v=20260611p`
- Cache-bust: bump `?v=YYYYMMDD+letter` on `styles.css` and `app.js` in `index.html` for every static file change
- Version format: `YYYYMMDD` + sequential letter (a, b, c…), e.g. `20260612a`
- Commit trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

## Tests
- `npm test` — checks the vote-series parser against real Whip notices saved in
  `test/notices.json`. No network, no dependencies, runs in under a second.
- Run it before pushing ANY change to `parseVoteItemsFromHtml` or the regexes it uses
  (`NON_VOTE_RE`, `ACTION_RE`, `NEXT_VOTE_CONNECTOR_RE`). Every vote-timeline bug so far
  came from the Whip's hand-written HTML taking a shape the parser had not seen, and
  each one silently added or dropped a vote on the live site.
- The saved notices are verbatim bodies, deliberately including the awkward ones: the
  next-vote connector glued inside the previous `<li>`, scheduling paragraphs that name a
  bill, "Next votes predicted" lines, and a Whip typo. Do not "clean them up".
- Adding a case: capture the body verbatim from the Whip's public Firestore feed (see the
  header of `test/parse-notices.test.js`) and hand-check the expected rows. For a
  "Floor Update – N Votes" notice the row count must equal the N in its own title — the
  test enforces that, so an expectation blessed from buggy output gets caught.

## Never do
- Never recommend paid APIs or services (especially X/Twitter API)
- Never refer to Twitter as "X" — always "Twitter"
- Never use `wrangler deploy`
- External API calls and curl are allowed for research and data fetching; do not use them solely to verify code fixes (reason from local code for that)

## Architecture
- Cloudflare Pages (static) + Cloudflare Workers (REST + SSE via Durable Object)
- Worker changes deploy via git push → Cloudflare Workers Git integration (worker.js)
- `DomeWatchStreamCoordinator` Durable Object — single shared instance, polls data, broadcasts SSE
