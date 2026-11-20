#!/usr/bin/env bash
#
# Ship a change the safe way: every step must pass or NOTHING is committed or pushed.
#
#   dev/ship.sh "commit message"
#
# Why this exists (19 November 2026): a commit chained with `;` went out after its own syntax check had FAILED, and a broken script reached production. Here `set -e` stops at the first failing step, so a
# failed check, a failed test, or a failed commit never reaches `git push`. A push to main is the deploy (Cloudflare Pages and the Worker build from it), so this is the gate.
#
# Steps, in order:
#   1. the CSP hashes (an inline script that changed needs its new hash, or the page loses the script)
#   2. the generated stylesheets (styles.house.css and styles.senate.css are built from styles.css)
#   3. the whole test suite, which includes test/syntax.test.js (every script the pages load must parse) and the roll-call replay against the official roll
#   4. commit, then push
# It does not poll the deploy. Reload the live page once and look at what you changed.
set -euo pipefail

msg="${1:-}"
if [ -z "$msg" ]; then echo 'usage: dev/ship.sh "commit message"' >&2; exit 2; fi
cd "$(git rev-parse --show-toplevel)"

branch="$(git rev-parse --abbrev-ref HEAD)"
echo "== branch: $branch"

echo "== 1/4 CSP hashes";            node dev/csp-hashes.mjs > /dev/null
echo "== 2/4 generated stylesheets"; npm run css > /dev/null
echo "== 3/4 tests";                 npm test > /tmp/ship-test.out 2>&1 || { tail -30 /tmp/ship-test.out; echo "TESTS FAILED: nothing was committed or pushed." >&2; exit 1; }
tail -1 /tmp/ship-test.out

echo "== 4/4 commit and push"
git add -A
git diff --cached --stat
git commit -m "$msg

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
echo "pushed $(git rev-parse --short HEAD) to $branch. Reload the live page once and check it; do not poll the deploy."
