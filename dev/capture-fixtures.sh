#!/usr/bin/env bash
# Re-capture dev/fixtures/base/ from production.
#
# Fixtures are a point-in-time snapshot of public, unauthenticated endpoints —
# there is nothing secret in them. Re-run when an API's shape changes and the
# harness starts rendering empty panels.
#
#   ./dev/capture-fixtures.sh
#
# Note: the per-mode files under fixtures/modes/ are GENERATED, not captured —
# regenerate those with `node dev/make-mode-fixtures.mjs`.
set -euo pipefail
cd "$(dirname "$0")"
API=https://api.evanhollander.org/house-floor/api
OUT=fixtures/base
mkdir -p "$OUT"

get() { # get <url> <outfile>
  local code
  code=$(curl -sL --max-time 30 -H 'Origin: https://house-floor.evanhollander.org' \
              -H 'User-Agent: house-floor-dev-harness' -o "$OUT/$2" -w '%{http_code}' "$1")
  printf '  %-26s %s  %sb\n' "$2" "$code" "$(wc -c < "$OUT/$2" | tr -d ' ')"
  [ "$code" = 200 ] || echo "    ! non-200, check $OUT/$2"
}

echo "worker endpoints:"
for ep in domewatch-floor cold-start-bundle bills leadership member-data \
          congress-index news tweets bluesky airport-delays voting-days; do
  get "$API/$ep" "$ep.json"
done
get "$API/last-session-date" last-session-date.json
get "$API/stream/votes/current/status" stream-status.json

# The proceedings endpoint is date-scoped; pin it to the last day the House sat
# so the fixture always has content.
DATE=$(python3 -c "import json,sys;print(json.load(open('$OUT/last-session-date.json'))['formatted'])")
echo "proceedings for $DATE:"
get "$API/proceedings?date=$DATE" proceedings.json

echo "third-party:"
get "https://api.weather.gov/points/38.889722,-77.008889" weather-points.json
FC=$(python3 -c "import json;print(json.load(open('$OUT/weather-points.json'))['properties']['forecastHourly'])")
get "$FC" weather-forecast.json
get "https://raw.githubusercontent.com/lxndrblz/Airports/main/airports.csv" airports.csv

# The live stream URL is deliberately blanked: <video src> and hls.js bypass
# window.fetch, so an empty URL is the only way to keep the players off the
# network and the snapshots deterministic.
printf '{"url":"","isLive":false}\n' > "$OUT/hls-url.json"
echo "  hls-url.json               (blanked on purpose)"
echo "done."
