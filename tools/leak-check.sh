#!/usr/bin/env bash
# Fail if a build contains any private value from app/config.local.json:
#   keystorePassword, legacyKeystorePassword, every publishPaths.* value, every sleeper.* value, updateChannelPath (the private
#   update channel), picksCollection (the old, pre-password picks collection), feedbackCollection when feedbackEnabled is not true,
#   pwaSecretPath (APK, and the public web build; only the private family PWA, LEAK_PWA_TARGET=private, is served under it),
#   and (v0.0.12) the shared leaderboard password from $GG_LEADERBOARD_PASSWORD plus everything derived from it: the full
#   SHA-256, its 40-char prefix and both family collection names. The app only derives these at runtime from what the user types.
# or ships config.local.json itself. Searches UTF-8 and UTF-16LE, case-insensitive, in every file (APK: unzipped, incl.
# assets/index.android.bundle Hermes bytecode and classes*.dex). Never prints a value: only which key leaked and where.
# Config is resolved by tools/resolve-appconfig.sh. The optional [config.json] (default app/config.local.json)
# must be a valid JSON object: missing, empty, null, or a non-object fails closed (exit 2). Secret-bearing keys
# are never taken from example placeholders. Only the allow-list of non-secret keys (feedbackEnabled, siteSlug,
# publicUpdatePath, publicWebPath) may be inherited from app/config.example.json (or LEAK_EXAMPLE_CONFIG) when
# missing on local. A missing feedbackEnabled therefore inherits example (true in the store/public build);
# an explicit local true or false is respected. Other secret checks are unchanged.
# Usage: bash tools/leak-check.sh apk <file.apk> [config.json]
#        bash tools/leak-check.sh pwa <build-dir>  [config.json]
set -uo pipefail
MODE=${1:?usage: leak-check.sh apk|pwa <apk-or-dir> [config.json]}; TARGET=${2:?usage: leak-check.sh apk|pwa <apk-or-dir> [config.json]}
D=$(cd "$(dirname "$0")/.." && pwd)
LOCAL_CFG=${3:-$D/app/config.local.json}
EX_CFG=${LEAK_EXAMPLE_CONFIG:-$D/app/config.example.json}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT; chmod 700 "$TMP"
if ! RESOLVE_REQUIRE_LOCAL=1 bash "$D/tools/resolve-appconfig.sh" "$LOCAL_CFG" "$EX_CFG" > "$TMP/cfg.json"; then
  echo "leak-check: local config is missing, empty, null, or not a JSON object ($LOCAL_CFG)" >&2; exit 2
fi
CFG=$TMP/cfg.json
case "$MODE" in
  apk) [ -f "$TARGET" ] || { echo "leak-check: no such APK" >&2; exit 2; }
       unzip -q -o "$TARGET" -d "$TMP/t" || { echo "leak-check: cannot unzip APK" >&2; exit 2; }
       [ -f "$TMP/t/assets/index.android.bundle" ] || { echo "leak-check: APK has no assets/index.android.bundle" >&2; exit 2; } ;;
  pwa) [ -d "$TARGET" ] || { echo "leak-check: no such PWA dir" >&2; exit 2; }
       mkdir -p "$TMP/t" && cp -r "$TARGET/." "$TMP/t/" ;;
  *) echo "leak-check: mode must be apk or pwa" >&2; exit 2 ;;
esac
HITS=0; CHECKED=0
check() { # label value
  local label=$1 val=$2
  [ -n "$val" ] && [ "$val" != null ] && [ "${#val}" -ge 4 ] || return 0
  CHECKED=$((CHECKED+1))
  printf '%s' "$val" > "$TMP/pat"
  printf '%s' "$val" | iconv -f UTF-8 -t UTF-16LE > "$TMP/pat16" 2>/dev/null || true
  local f hit
  for f in "$TMP/pat" "$TMP/pat16"; do
    [ -s "$f" ] || continue
    while IFS= read -r hit; do echo "LEAK: $label found in ${hit#$TMP/t/}"; HITS=$((HITS+1)); done < <(grep -rlaiF -f "$f" "$TMP/t" 2>/dev/null)
  done
}
check keystorePassword "$(jq -r '.keystorePassword // empty' "$CFG")"
while IFS=$'\t' read -r k v; do check "publishPaths.$k" "$v"; done < <(jq -r '.publishPaths // {} | to_entries[] | "\(.key)\t\(.value)"' "$CFG")
check legacyKeystorePassword "$(jq -r '.legacyKeystorePassword // empty' "$CFG")"
{ [ "$MODE" = apk ] || [ "${LEAK_PWA_TARGET:-public}" != private ]; } && check pwaSecretPath "$(jq -r '.pwaSecretPath // empty' "$CFG")"
check updateChannelPath "$(jq -r '.updateChannelPath // empty' "$CFG")"
check picksCollection "$(jq -r '.picksCollection // empty' "$CFG")"
[ -f "$D/keys/picks-collection.txt" ] && check picksCollection "$(tr -d '[:space:]' < "$D/keys/picks-collection.txt")"
[ "$(jq -r '.feedbackEnabled // false' "$CFG")" = true ] || check feedbackCollection "$(jq -r '.feedbackCollection // empty' "$CFG")"
if [ -n "${GG_LEADERBOARD_PASSWORD:-}" ]; then
  check leaderboardPassword "$(printf '%s' "$GG_LEADERBOARD_PASSWORD" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  FH=$(python3 -c 'import hashlib,os;print(hashlib.sha256(("galaxy-gridiron/leaderboard/v1\n"+os.environ["GG_LEADERBOARD_PASSWORD"].strip()).encode()).hexdigest())')
  check leaderboardHash "$FH"; check leaderboardHashPrefix "${FH:0:40}"; check familyLiveCollection "gg${FH:0:40}"; check familyArchiveCollection "gg${FH:0:40}_a"; FH=
elif [ "${LEAK_REQUIRE_PASSWORD:-1}" = 1 ]; then echo "leak-check: GG_LEADERBOARD_PASSWORD is not set; cannot check the password or its hash (LEAK_REQUIRE_PASSWORD=0 to skip)" >&2; exit 2
fi
while IFS=$'\t' read -r k v; do check "sleeper.$k" "$v"; done < <(jq -r '.sleeper // {} | paths(scalars) as $p | "\($p|join("."))\t\(getpath($p)|tostring)"' "$CFG")
# fixed: the old personal application id must never come back
check oldAppId "com.jada"
n=$(find "$TMP/t" -iname 'config.local.json*' | wc -l); [ "$n" = 0 ] || { echo "LEAK: config.local.json is inside the build"; HITS=$((HITS+1)); }
NF=$(find "$TMP/t" -type f | wc -l)
if [ "$HITS" -gt 0 ]; then echo "$MODE LEAK CHECK FAILED ($HITS hit(s))" >&2; exit 1; fi
[ "$CHECKED" -gt 0 ] || { echo "leak-check: no private values to search for (placeholder config?)" >&2; exit 2; }
echo "$MODE leak check OK: $CHECKED private value(s) searched (UTF-8 + UTF-16LE) in $NF files, 0 hits"
