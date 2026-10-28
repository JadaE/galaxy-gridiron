#!/usr/bin/env bash
# Write app/src/appconfig.generated.json (gitignored) with ONLY the 4 public keys the app bundles:
# siteSlug, updateChannelPath, picksCollection, feedbackCollection. Values come from app/config.local.json,
# falling back per key to app/config.example.json. Nothing else from config.local.json may reach the bundle.
set -euo pipefail
D=$(cd "$(dirname "$0")/.." && pwd); LOCAL=$D/app/config.local.json; EX=$D/app/config.example.json
OUT=$D/app/src/appconfig.generated.json
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
