# House Floor Monitor — Project Rules

## Deploy & commit rules
- Every change must be committed AND pushed in the same step
- Deploy via `git push` only — never `wrangler deploy` (auth is broken)
- After every deploy, **always state the version number** — just the latest app.js version, e.g. `v=20260611p`
- Cache-bust: bump `?v=YYYYMMDD+letter` on `styles.css` and `app.js` in `index.html` for every static file change
- Version format: `YYYYMMDD` + sequential letter (a, b, c…), e.g. `20260612a`
- Commit trailer: `Co-Authored-By: Claude <noreply@anthropic.com>` — no model
  name or version. This used to pin a specific one, which meant it was wrong
  every time a new model shipped, and the disagreement between it and whatever
  the tooling suggested had to be resolved by hand each time. Git cares who
  wrote it, not which build.

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

## Typography

This site uses the EMH type system, shared across every evanhollander.org site.
Full reference: `cdn.evanhollander.org/TYPOGRAPHY.md`.

- **EMH Grotesk** (Inter) — body and UI, `wght` 100–900
- **EMH Mono** (Fira Code) — numerals that change in place, technical strings,
  version numbers; pair with `font-variant-numeric: tabular-nums`
- **EMH Serif** (EB Garamond) — display headings and small caps, static 400

Three families, not one. Never `font-family: 'EMH'`.

- **No italic exists in any of them.** The browser synthesises an oblique by
  shearing the roman and it looks wrong, especially on Inter. Use
  `font-weight: 500` for emphasis.
- **Small caps come from EMH Serif only.** Inter ships no `smcp` (checked against
  v4.1), so `font-variant-caps` on Grotesk silently synthesises them. For a sans
  small-caps look, letterspace `text-transform: uppercase` instead.
- Declare the real weight range and keep both `format()` entries; `font-display: swap`
  always; `crossorigin` on any preload, even though the file is ours.
