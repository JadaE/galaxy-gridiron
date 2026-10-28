#!/usr/bin/env bash
# Fail if a build contains any private value from app/config.local.json:
#   keystorePassword, every publishPaths.* value, pwaSecretPath (APK only; the PWA is served under that path), every sleeper.* value,
# or ships config.local.json itself. Searches UTF-8 and UTF-16LE, case-insensitive, in every file (APK: unzipped, incl.
# assets/index.android.bundle Hermes bytecode and classes*.dex). Never prints a value: only which key leaked and where.
# Usage: bash tools/leak-check.sh apk <file.apk> [config.json]
#        bash tools/leak-check.sh pwa <build-dir>  [config.json]
set -uo pipefail
MODE=${1:?usage: leak-check.sh apk|pwa <apk-or-dir> [config.json]}; TARGET=${2:?usage: leak-check.sh apk|pwa <apk-or-dir> [config.json]}
D=$(cd "$(dirname "$0")/.." && pwd); CFG=${3:-$D/app/config.local.json}
[ -f "$CFG" ] || { echo "leak-check: no config to check against ($CFG)" >&2; exit 2; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT; chmod 700 "$TMP"
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
[ "$MODE" = apk ] && check pwaSecretPath "$(jq -r '.pwaSecretPath // empty' "$CFG")"
while IFS=$'\t' read -r k v; do check "sleeper.$k" "$v"; done < <(jq -r '.sleeper // {} | paths(scalars) as $p | "\($p|join("."))\t\(getpath($p)|tostring)"' "$CFG")
n=$(find "$TMP/t" -iname 'config.local.json*' | wc -l); [ "$n" = 0 ] || { echo "LEAK: config.local.json is inside the build"; HITS=$((HITS+1)); }
NF=$(find "$TMP/t" -type f | wc -l)
if [ "$HITS" -gt 0 ]; then echo "$MODE LEAK CHECK FAILED ($HITS hit(s))" >&2; exit 1; fi
[ "$CHECKED" -gt 0 ] || { echo "leak-check: no private values to search for (placeholder config?)" >&2; exit 2; }
echo "$MODE leak check OK: $CHECKED private value(s) searched (UTF-8 + UTF-16LE) in $NF files, 0 hits"
