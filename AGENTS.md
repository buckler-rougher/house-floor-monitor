# House Floor Monitor — Project Rules

## Deploy & commit rules
- Every change must be committed AND pushed in the same step
- Deploy via `git push` only — never `wrangler deploy` (auth is broken)
- After every deploy, **always state the version number** — just the latest app.js version, e.g. `v=20260611p`
- Cache-bust: bump `?v=YYYYMMDD+letter` on `styles.css` and `app.js` in `index.html` for every static file change
- Version format: `YYYYMMDD` + sequential letter (a, b, c…), e.g. `20260612a`
- Commit trailer: `Co-Authored-By: Codex Sonnet 4.6 <noreply@anthropic.com>`

## Never do
- Never recommend paid APIs or services (especially X/Twitter API)
- Never refer to Twitter as "X" — always "Twitter"
- Never use `wrangler deploy`
- Never use curl or external API calls to verify fixes — reason from local code only

## Architecture
- Cloudflare Pages (static) + Cloudflare Workers (REST + SSE via Durable Object)
- Worker changes deploy via git push → Cloudflare Workers Git integration (worker.js)
- `DomeWatchStreamCoordinator` Durable Object — single shared instance, polls data, broadcasts SSE
