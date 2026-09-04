# Dev harness

Makes the site renderable and **reproducible off-network**, which is the
precondition for touching `styles.css`. Nothing here loads on a normal page view.

## Why this exists

Two things made CSS work on this site unverifiable:

1. **You can't run it locally.** The worker's CORS allowlist is
   `house-floor.evanhollander.org` and `monitor-a6i.pages.dev` only, so every API
   call from `localhost` fails and the page renders empty.
2. **You can't see 20 of the 22 floor modes.** `prayer`, `sine-die`, `tellers`,
   `joint-meeting` and the rest only appear when the House is actually in that
   state. Refactoring their CSS blind means finding out weeks later, live.

## Usage

```bash
npm run dev                 # http://localhost:3456
```

| URL | What it does |
|---|---|
| `/?fixtures` | serve every API call from `dev/fixtures/`, off-network |
| `/?fixtures&mode=prayer` | …and drive the app into one floor mode |
| `/dev/screens.html` | all 22 modes on one page + snapshot capture |
| `/?fixtures&freeze=0` | fixtures, but with a live clock |

Mode names are in `fixtures/modes/index.json`. `?mode=` also works without
`?fixtures` (it just calls the existing `window.lockMode`), but then the panels
are empty unless the House happens to be sitting.

## How mode selection works

The harness does **not** force the body class. It feeds the app crafted
proceedings and lets the real `autoSwitchModeFromProceedings()` in `app.js`
choose, then pins the result. So a fixture that stops selecting its own mode is
itself a regression signal — the console warns when the app lands somewhere
other than the mode you asked for.

`node dev/check-modes.mjs` re-checks all 22 statically, without a browser.

## Snapshots

The baseline for a CSS refactor is a **computed-style dump**, not screenshots:
deterministic, diffs as text, no headless browser, and no antialiasing noise.

```bash
# 1. before touching CSS
open http://localhost:3456/dev/screens.html   # → "Capture snapshots"
node dev/save-snapshot.mjs before ~/Downloads/snapshots.json

# 2. make the CSS change, re-capture
node dev/save-snapshot.mjs after ~/Downloads/snapshots.json

# 3. diff — exits 1 if anything moved
node dev/compare.mjs before after
node dev/compare.mjs before after --verbose --mode prayer
```

`compare.mjs` groups by property, so "letter-spacing changed on 86 elements"
reads as one line rather than 86.

Snapshot sets are gitignored — they're large and machine-specific.

## Files

| | |
|---|---|
| `harness.js` | `fetch`/`EventSource`/`Hls` interception, frozen clock, mode pinning |
| `fixtures/base/` | captured API payloads (public, unauthenticated) |
| `fixtures/modes/` | **generated** per-mode overrides |
| `make-mode-fixtures.mjs` | regenerates `fixtures/modes/` from one table |
| `capture-fixtures.sh` | re-captures `fixtures/base/` from production |
| `check-modes.mjs` | static check that each fixture selects its own mode |
| `screens.html` | all-modes review page + snapshot capture |
| `snapshot.js` | computed-style snapshotter (runs in the page) |
| `save-snapshot.mjs` / `compare.mjs` | file and diff snapshot sets |

## Known limitations

- **`screens.html` is local-only.** Production sends `X-Frame-Options: DENY`
  (`_headers`), so the iframes only work against `npm run dev`.
- **The live video is deliberately dead.** `<video src>` and hls.js bypass
  `window.fetch`, so `hls-url.json` is blanked and `window.Hls` is stubbed. The
  PiP renders as an empty black box on purpose — that keeps snapshots stable.
- **`serve` drops query strings on `/index.html`.** It 301s to `/index`. Always
  link to `/?…`, never `/index.html?…`.
- Loading all 22 modes at once in `screens.html` is slow (22 app instances);
  leave "load on scroll" checked for browsing, uncheck only to capture.

## Finding: `sine-die` mode looks unreachable in production

Not a harness bug — worth fixing separately. The recess branch
(`app.js:5745`) returns on any `items[0]` containing `"adjourn"`, and it runs ~90
lines before the sine-die check at `app.js:5835`. Every realistic Clerk phrasing
of a sine die adjournment contains "adjourn" — including app.js's own fallback
string at `:7479`, *"The House stands adjourned sine die."* So the sine-die
branch can probably never be reached, and `body.sine-die-mode` never applies.

`fixtures/modes/sine-die/` deliberately avoids the word "adjourn" so the mode is
reachable and its CSS can still be baselined.
