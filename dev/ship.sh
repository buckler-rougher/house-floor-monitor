#!/usr/bin/env bash
#
# Ship a change the safe way: every step must pass or NOTHING is committed or pushed.
#
#   dev/ship.sh --pr "message"            branch, check, commit, push, open a pull request
#   dev/ship.sh --pr --merge "message"    ...then wait for the `test` check and merge it (the merge is the deploy)
#   dev/ship.sh --staging "message"       check and commit, then put it on the `staging` branch to try it on the staging sites first
#   dev/ship.sh --direct "message"        push to the current branch as it is (an emergency revert on main; the ruleset lets an admin through)
#   add --dry-run to any of them: run every check, say what would happen, change nothing on GitHub
#
# `main` is protected (a ruleset requires a pull request and a green `test`), and a push to main is the deploy, so on main a plain `dev/ship.sh "message"` is refused: pick --pr.
#
# Why it fails closed (19 November 2026): a commit chained with `;` went out after its own syntax check had FAILED, and a broken script reached production. Here `set -e` stops at the first failing step,
# so a failed check, a failed test, or a failed commit never reaches a push.
#
# Steps, in order:
#   1. the CSP hashes (an inline script that changed needs its new hash, or the page loses the script)
#   2. the generated stylesheets (styles.house.css and styles.senate.css are built from styles.css)
#   3. the whole test suite, which includes test/syntax.test.js (every script the pages load must parse) and the roll-call replay against the official roll
#   4. commit, then push, then (with --pr) the pull request
# It does not poll the deploy. Reload the live page once and look at what you changed.
set -euo pipefail

mode=""; merge=0; dry=0; msg=""
for a in "$@"; do
  case "$a" in
    --pr) mode=pr ;;
    --staging) mode=staging ;;
    --direct) mode=direct ;;
    --merge) merge=1 ;;
    --dry-run) dry=1 ;;
    -*) echo "unknown option: $a" >&2; exit 2 ;;
    *) msg="$a" ;;
  esac
done
usage() { sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
[ -n "$msg" ] || usage
cd "$(git rev-parse --show-toplevel)"
branch="$(git rev-parse --abbrev-ref HEAD)"
default="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"; default="${default:-main}"

if [ -z "$mode" ]; then
  if [ "$branch" = "$default" ]; then
    echo "REFUSED: $default is protected (a pull request and a green \`test\` are required)." >&2
    echo "  use --pr (or --pr --merge), --staging to try it on the staging sites, or --direct for an emergency revert." >&2
    exit 2
  fi
  mode=branch
fi
if [ "$merge" = 1 ] && [ "$mode" != pr ]; then echo "--merge only goes with --pr" >&2; exit 2; fi
say() { echo "== $*"; }
run() { if [ "$dry" = 1 ]; then echo "   [dry run] $*"; else "$@"; fi; }

say "mode: $mode   branch: $branch$([ "$dry" = 1 ] && echo '   (DRY RUN: nothing will be pushed)')"

say "1/4 CSP hashes";            node dev/csp-hashes.mjs > /dev/null
say "2/4 generated stylesheets"; npm run css > /dev/null
say "3/4 tests"
npm test > /tmp/ship-test.out 2>&1 || { tail -30 /tmp/ship-test.out; echo "TESTS FAILED: nothing was committed or pushed." >&2; exit 1; }
tail -1 /tmp/ship-test.out

say "4/4 commit and push"
if [ "$mode" = pr ] && [ "$branch" = "$default" ]; then
  slug="$(printf '%s' "$msg" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-//; s/-$//' | cut -c1-40)"
  newbranch="ship/${slug}-$(date +%m%d-%H%M)"
  say "new branch: $newbranch"
  run git checkout -q -b "$newbranch"
  branch="$newbranch"
fi

trailer="Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  say "nothing to commit (the branch already holds the change)"
else
  git add -A
  git diff --cached --stat
  run git commit -q -m "$msg

$trailer"
fi

case "$mode" in
  direct|branch) run git push -u origin HEAD ;;
  staging)
    run git push --force origin HEAD:refs/heads/staging   # staging is a scratch branch: it is rebuilt from whatever is being tried
    echo "on staging: https://house-floor-staging.evanhollander.org  https://senate-floor-staging.evanhollander.org/senate  (give the builds a minute or two)" ;;
  pr)
    run git push -u origin HEAD
    if [ "$dry" = 1 ]; then echo "   [dry run] gh pr create --title \"$msg\" ...${merge:+ ; then wait for checks and merge}"; exit 0; fi
    url="$(gh pr view "$branch" --json url --jq .url 2>/dev/null || true)"
    if [ -z "$url" ]; then
      url="$(gh pr create --base "$default" --head "$branch" --title "$msg" --body "$msg

🤖 Generated with [Claude Code](https://claude.com/claude-code)")"
    fi
    echo "pull request: $url"
    if [ "$merge" = 1 ]; then
      # only the REQUIRED checks (the ruleset requires `test`): a Cloudflare preview build that fails on a branch must not block a change whose tests passed
      say "waiting for the required checks (a failing one stops here and nothing is merged)"
      gh pr checks "$url" --required --watch --fail-fast
      gh pr merge "$url" --squash --delete-branch
      git checkout -q "$default" && git pull -q --ff-only
      echo "merged. $default is at $(git rev-parse --short HEAD). Reload the live page once and check it; do not poll the deploy."
    else
      echo "when the \`test\` check is green:  gh pr merge $url --squash --delete-branch"
    fi ;;
esac
echo "done: $(git rev-parse --short HEAD) on $branch ($mode)."
