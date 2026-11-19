#!/usr/bin/env bash
# Write app/src/appconfig.generated.json (gitignored) with ONLY the public keys the app bundles:
#   siteSlug, publicUpdatePath (v0.0.12 store channel: a public, non-secret folder), feedbackEnabled, feedbackCollection.
# feedbackCollection is bundled ONLY when feedbackEnabled is true (store/public web build: on, via config.example.json).
# The private update channel, the old picks collection and every secret path stay out of the bundle (tools/leak-check.sh checks).
# Values come from tools/resolve-appconfig.sh (config.local.json first, then per-key fallback to
# config.example.json), or, with no jq / no example, a copy of app/src/appconfig.default.json.
set -euo pipefail
D=$(cd "$(dirname "$0")/.." && pwd); LOCAL=$D/app/config.local.json; EX=$D/app/config.example.json
OUT=$D/app/src/appconfig.generated.json
DEF=$D/app/src/appconfig.default.json
if ! command -v jq >/dev/null 2>&1 || [ ! -f "$EX" ]; then
  [ -f "$LOCAL" ] && { echo "gen-appconfig: jq is required to read app/config.local.json" >&2; exit 1; }
  cp "$DEF" "$OUT"; echo "gen-appconfig: wrote app/src/appconfig.generated.json from appconfig.default.json (placeholders)"; exit 0
fi
[ -f "$LOCAL" ] || echo "gen-appconfig: no app/config.local.json, using config.example.json placeholders" >&2
# Public keys may fall back to example (including feedbackCollection). Secret-bearing keys never do.
RESOLVE_INHERIT_KEYS=feedbackEnabled,siteSlug,publicUpdatePath,feedbackCollection \
  bash "$D/tools/resolve-appconfig.sh" "$LOCAL" "$EX" | jq '{
  siteSlug: .siteSlug,
  publicUpdatePath: .publicUpdatePath,
  feedbackEnabled: (.feedbackEnabled == true),
  feedbackCollection: (if .feedbackEnabled == true then (.feedbackCollection // "") else "" end)
}' > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
[ "$(jq -r 'keys|join(",")' "$OUT")" = "feedbackCollection,feedbackEnabled,publicUpdatePath,siteSlug" ] || { echo "gen-appconfig: unexpected keys" >&2; exit 1; }
echo "gen-appconfig: wrote app/src/appconfig.generated.json (4 public keys, feedback $(jq -r 'if .feedbackEnabled then "on" else "off" end' "$OUT"))"
