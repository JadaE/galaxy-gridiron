#!/usr/bin/env bash
# Publish Galaxy Gridiron to its here.now site, ONLY after the release gate passes.
# Usage: bash tools/publish.sh <version> <apk-path>
# Reads siteSlug and publishSiteDir from the gitignored app/config.local.json.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <version> <apk-path>" >&2; exit 2
fi
VERSION="$1"; APK="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/app/config.local.json"
[ -f "$CFG" ] || { echo "missing app/config.local.json" >&2; exit 1; }
[ -f "$APK" ] || { echo "APK not found: $APK" >&2; exit 1; }

# Release gate (required; see /workspace/releases/PROCESS.md). Do not remove.
if ! bash /workspace/releases/tools/release-gate.sh galaxy-gridiron "$VERSION" "$APK"; then
  echo "Release gate FAILED for v$VERSION; nothing published. Tell Review & Release." >&2
  exit 1
fi

SLUG="$(jq -r '.siteSlug // empty' "$CFG")"
SITE="$(jq -r '.publishSiteDir // empty' "$CFG")"
[ -n "$SITE" ] || SITE="$ROOT/publish-site"
[ -n "$SLUG" ] || { echo "siteSlug missing in config" >&2; exit 1; }
[ -d "$SITE" ] || { echo "publish site folder not found" >&2; exit 1; }
[ -f "$SITE/.herenow/proxy.json" ] || { echo "publish-site/.herenow/proxy.json missing (relay routes would drop)" >&2; exit 1; }

PUB="${HERENOW_PUBLISH:-}"
if [ -z "$PUB" ]; then
  PUB="$(ls -d /home/box/agent-data/plugins/cache/cursor-public/here_now/*/skills/here-now/scripts/publish.sh \
              /home/box/sand-data/plugins/cache/cursor-public/here_now/*/skills/here-now/scripts/publish.sh 2>/dev/null | head -1 || true)"
fi
[ -n "$PUB" ] && [ -f "$PUB" ] || { echo "here.now publish script not found (set HERENOW_PUBLISH)" >&2; exit 1; }

bash "$PUB" "$SITE" --slug "$SLUG"
