#!/usr/bin/env bash
# Merge app config the same way for gen-appconfig.sh and leak-check.sh:
#   config.local.json first (if present), then per-key fallback to config.example.json.
# A key present on local (including explicit false) wins. A key missing on local
# is taken from example. Top-level objects (publishPaths, sleeper) are replaced,
# not deep-merged, so a real local object is not mixed with example placeholders.
# Usage: bash tools/resolve-appconfig.sh [local.json] [example.json]
# Prints merged JSON to stdout. If local is missing, example is used alone.
# If example is missing and local exists, local is used alone.
set -euo pipefail
D=$(cd "$(dirname "$0")/.." && pwd)
LOCAL=${1:-$D/app/config.local.json}
EX=${2:-$D/app/config.example.json}
if [ -f "$LOCAL" ] && [ -f "$EX" ]; then
  jq -n --slurpfile l "$LOCAL" --slurpfile e "$EX" '($e[0] // {}) + ($l[0] // {})'
elif [ -f "$LOCAL" ]; then
  jq -n --slurpfile l "$LOCAL" '$l[0] // {}'
elif [ -f "$EX" ]; then
  jq -n --slurpfile e "$EX" '$e[0] // {}'
else
  echo "resolve-appconfig: no config to merge (local=$LOCAL example=$EX)" >&2
  exit 2
fi
