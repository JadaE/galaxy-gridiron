#!/usr/bin/env bash
# Merge app config for gen-appconfig.sh and leak-check.sh.
#
# A valid local JSON object is the source of secret-bearing keys. Those keys are
# never taken from config.example.json placeholders. Only keys on an explicit
# allow-list of non-secret / public values may be inherited from example when
# they are missing on local (has() — an explicit false or null on local wins).
#
# Default allow-list (leak-check): feedbackEnabled,siteSlug,publicUpdatePath,publicWebPath
# gen-appconfig adds feedbackCollection so its four public keys still fall back
# for a clean clone / omitted public field (RESOLVE_INHERIT_KEYS).
#
# Usage: bash tools/resolve-appconfig.sh [local.json] [example.json]
#   RESOLVE_REQUIRE_LOCAL=1  (leak-check) fail closed, exit 2, if local is
#                            missing, empty, null, or not a JSON object.
#   RESOLVE_INHERIT_KEYS=... comma-separated allow-list (default: non-secret keys)
#
# If local is not required and is missing, example is used alone (gen-appconfig
# clean-clone path). Prints merged JSON to stdout.
set -euo pipefail
D=$(cd "$(dirname "$0")/.." && pwd)
LOCAL=${1:-$D/app/config.local.json}
EX=${2:-$D/app/config.example.json}
REQUIRE=${RESOLVE_REQUIRE_LOCAL:-0}
INHERIT=${RESOLVE_INHERIT_KEYS:-feedbackEnabled,siteSlug,publicUpdatePath,publicWebPath}

is_json_object() {
  [ -f "$1" ] && [ -s "$1" ] && jq -e 'type == "object"' "$1" >/dev/null 2>&1
}

if [ "$REQUIRE" = 1 ]; then
  if ! is_json_object "$LOCAL"; then
    echo "resolve-appconfig: local config is missing, empty, null, or not a JSON object ($LOCAL)" >&2
    exit 2
  fi
fi

if is_json_object "$LOCAL" && [ -f "$EX" ]; then
  jq -n --slurpfile l "$LOCAL" --slurpfile e "$EX" --arg inherit "$INHERIT" '
    ($l[0]) as $l | ($e[0] // {}) as $e |
    reduce ($inherit | split(",") | map(select(length > 0)))[] as $k
      ($l; if has($k) then . else . + {($k): $e[$k]} end)
  '
elif is_json_object "$LOCAL"; then
  jq -n --slurpfile l "$LOCAL" '$l[0]'
elif [ "$REQUIRE" != 1 ] && [ -f "$EX" ]; then
  jq -n --slurpfile e "$EX" '$e[0] // {}'
else
  echo "resolve-appconfig: no config to merge (local=$LOCAL example=$EX)" >&2
  exit 2
fi
