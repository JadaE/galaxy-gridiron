#!/usr/bin/env bash
# Write app/src/appconfig.generated.json (gitignored) with ONLY the 4 public keys the app bundles:
# siteSlug, updateChannelPath, picksCollection, feedbackCollection. Values come from app/config.local.json,
# falling back per key to app/config.example.json (or, with no jq / no example, a copy of app/src/appconfig.default.json). Nothing else from config.local.json may reach the bundle.
set -euo pipefail
D=$(cd "$(dirname "$0")/.." && pwd); LOCAL=$D/app/config.local.json; EX=$D/app/config.example.json
OUT=$D/app/src/appconfig.generated.json
DEF=$D/app/src/appconfig.default.json
# no jq or no example config (bare clone): use the committed placeholder copy so tests/type-checks still run
if ! command -v jq >/dev/null 2>&1 || [ ! -f "$EX" ]; then
  [ -f "$LOCAL" ] && { echo "gen-appconfig: jq is required to read app/config.local.json" >&2; exit 1; }
  cp "$DEF" "$OUT"; echo "gen-appconfig: wrote app/src/appconfig.generated.json from appconfig.default.json (placeholders)"; exit 0
fi
[ -f "$LOCAL" ] || { echo "gen-appconfig: no app/config.local.json, using config.example.json placeholders" >&2; LOCAL=$EX; }
jq -n --slurpfile l "$LOCAL" --slurpfile e "$EX" '
  ($l[0]) as $l | ($e[0]) as $e |
  { siteSlug: ($l.siteSlug // $e.siteSlug),
    updateChannelPath: ($l.updateChannelPath // $e.updateChannelPath),
    picksCollection: ($l.picksCollection // $e.picksCollection),
    feedbackCollection: ($l.feedbackCollection // $e.feedbackCollection) }' > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
[ "$(jq -r 'keys|join(",")' "$OUT")" = "feedbackCollection,picksCollection,siteSlug,updateChannelPath" ] || { echo "gen-appconfig: unexpected keys" >&2; exit 1; }
echo "gen-appconfig: wrote app/src/appconfig.generated.json (4 public keys)"
