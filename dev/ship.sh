#!/usr/bin/env bash
#
# Ship a change the safe way: every step must pass or NOTHING is committed or pushed.
#
#   dev/ship.sh --pr "message"            branch, check, commit, push, open a pull request (it stops there: opening and merging are two decisions)
#   dev/ship.sh --merge-pr=N              check pull request N, show what it will merge, ask you to confirm, wait for the required checks, merge (the merge is the deploy)
#   dev/ship.sh --merge-pr=N --yes        the same without the prompt, for a caller with no keyboard; the person who owns the repo has to have said to merge N
#   dev/ship.sh --staging "message"       check and commit, then put it on the `staging` branch to try it on the staging sites first
#   dev/ship.sh --direct "message"        push to the current branch as it is (an emergency revert on main; the ruleset lets an admin through)
#   add --dry-run to --pr, --staging or --direct: run every check, say what would happen, change nothing on GitHub
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

mode=""; mergepr=""; yes=0; dry=0; msg=""
for a in "$@"; do
  case "$a" in
    --pr) mode=pr ;;
    --staging) mode=staging ;;
    --direct) mode=direct ;;
    --merge-pr=*) mergepr="${a#--merge-pr=}"; mode=mergepr ;;
    --yes) yes=1 ;;
    --dry-run) dry=1 ;;
    -*) echo "unknown option: $a" >&2; exit 2 ;;
    *) msg="$a" ;;
  esac
done
usage() { sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
[ -n "$msg" ] || [ -n "$mergepr" ] || usage
cd "$(git rev-parse --show-toplevel)"
branch="$(git rev-parse --abbrev-ref HEAD)"
default="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"; default="${default:-main}"

if [ -z "$mode" ]; then
  if [ "$branch" = "$default" ]; then
    echo "REFUSED: $default is protected (a pull request and a green \`test\` are required)." >&2
    echo "  use --pr (then --merge-pr=N), --staging to try it on the staging sites, or --direct for an emergency revert." >&2
    exit 2
  fi
  mode=branch
fi
if [ "$yes" = 1 ] && [ "$mode" != mergepr ]; then echo "--yes only goes with --merge-pr=N" >&2; exit 2; fi
say() { echo "== $*"; }
run() { if [ "$dry" = 1 ]; then echo "   [dry run] $*"; else "$@"; fi; }

if [ "$mode" = mergepr ]; then
  case "$mergepr" in ''|*[!0-9]*) echo "--merge-pr needs a pull request number: --merge-pr=12" >&2; exit 2 ;; esac
  info="$(gh pr view "$mergepr" --json number,state,baseRefName,headRefName,author,title,url,mergeable)" || { echo "no such pull request: $mergepr" >&2; exit 1; }
  field() { printf '%s' "$info" | python3 -c "import sys,json; d=json.load(sys.stdin); v=d; [v:=v[k] for k in '$1'.split('.')]; print(v)"; }
  state="$(field state)"; base="$(field baseRefName)"; head="$(field headRefName)"; author="$(field author.login)"; title="$(field title)"; url="$(field url)"
  me="$(gh api user --jq .login)"
  [ "$state" = OPEN ]       || { echo "REFUSED: #$mergepr is $state, not OPEN." >&2; exit 1; }
  [ "$base" = "$default" ]  || { echo "REFUSED: #$mergepr targets $base, not $default." >&2; exit 1; }
  [ "$author" = "$me" ]     || { echo "REFUSED: #$mergepr was opened by $author, not by you ($me)." >&2; exit 1; }
  echo "About to merge:"; echo "  $url"; echo "  \"$title\""; echo "  $head -> $base   (merging deploys to production)"
  if [ "$yes" != 1 ]; then
    if [ -t 0 ]; then read -r -p "Type the pull request number ($mergepr) to merge it: " ans; [ "$ans" = "$mergepr" ] || { echo "not confirmed: nothing merged." >&2; exit 1; }
    else echo "REFUSED: no keyboard to confirm on. Pass --yes only when the repo's owner has said to merge #$mergepr." >&2; exit 1; fi
  fi
  say "waiting for the required checks (a failing one stops here and nothing is merged)"
  gh pr checks "$mergepr" --required --watch --fail-fast
  gh pr merge "$mergepr" --squash --delete-branch
  git checkout -q "$default" 2>/dev/null && git pull -q --ff-only 2>/dev/null || true
  echo "merged #$mergepr. Reload the live page once and check it; do not poll the deploy."
  exit 0
fi

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
    if [ "$dry" = 1 ]; then echo "   [dry run] gh pr create --title \"$msg\" ..."; exit 0; fi
    url="$(gh pr view "$branch" --json url --jq .url 2>/dev/null || true)"
    if [ -z "$url" ]; then
      url="$(gh pr create --base "$default" --head "$branch" --title "$msg" --body "$msg

🤖 Generated with [Claude Code](https://claude.com/claude-code)")"
    fi
    echo "pull request: $url"
    echo "when you are ready (the \`test\` check must be green):  dev/ship.sh --merge-pr=$(gh pr view "$url" --json number --jq .number)"

esac
echo "done: $(git rev-parse --short HEAD) on $branch ($mode)."
