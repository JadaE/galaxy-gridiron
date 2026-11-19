#!/usr/bin/env bash
# JC-92: leak-check must resolve config the same way as gen-appconfig
# (local first, then per-key fallback to example). Mock values only; never prints a secret.
# Run: bash tools/test_leak_check.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PASS=0; FAIL=0
t() {
  local n=$1; shift
  if "$@"; then PASS=$((PASS+1)); echo "  ✓ $n"
  else FAIL=$((FAIL+1)); echo "  ✗ $n"
  fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
chmod 700 "$TMP"

# Distinct mock values, never taken from config.local.json.
KS='mock-jc92-keystore-password-aaaa'
UP='mock-jc92-update-channel-path-aaaa'
PC='mock-jc92-picks-collection-aaaa'
FB='fb0123456789abcdef0123456789abcd'

write_ex() { # path feedbackEnabled
  jq -n --arg ks "$KS" --arg up "$UP" --arg pc "$PC" --arg fb "$FB" --argjson on "$2" \
    '{keystorePassword:$ks, updateChannelPath:$up, picksCollection:$pc, feedbackCollection:$fb, feedbackEnabled:$on, siteSlug:"mock-site", publicUpdatePath:"store"}' > "$1"
}
write_local() { # path [feedbackEnabled or omit]
  if [ "${2+x}" = x ]; then
    jq -n --arg ks "$KS" --arg up "$UP" --arg pc "$PC" --arg fb "$FB" --argjson on "$2" \
      '{keystorePassword:$ks, updateChannelPath:$up, picksCollection:$pc, feedbackCollection:$fb, feedbackEnabled:$on}' > "$1"
  else
    jq -n --arg ks "$KS" --arg up "$UP" --arg pc "$PC" --arg fb "$FB" \
      '{keystorePassword:$ks, updateChannelPath:$up, picksCollection:$pc, feedbackCollection:$fb}' > "$1"
  fi
}
make_build() { # dir content
  mkdir -p "$1"
  printf '%s' "$2" > "$1/index.html"
}

run_leak() { # local example build
  # stdout/stderr captured; never echo the body (may contain mock values we already know).
  local out
  set +e
  out=$(LEAK_REQUIRE_PASSWORD=0 LEAK_EXAMPLE_CONFIG="$2" bash "$ROOT/tools/leak-check.sh" pwa "$3" "$1" 2>&1)
  local rc=$?
  set -e
  printf '%s' "$out" > "$TMP/last.out"
  return $rc
}
# Returns 0 if last leak-check output reports a leak of this label (not a value).
last_leaked() { grep -q "LEAK: $1 found" "$TMP/last.out"; }
last_ok() { grep -q 'pwa leak check OK' "$TMP/last.out"; }

echo 'resolve-appconfig'
# Missing feedbackEnabled on local inherits example true
write_ex "$TMP/ex-on.json" true
write_local "$TMP/local-omit.json"
t 'local omit + example true => feedbackEnabled true' \
  bash -c 'test "$(bash "$0/tools/resolve-appconfig.sh" "$1" "$2" | jq -r .feedbackEnabled)" = true' "$ROOT" "$TMP/local-omit.json" "$TMP/ex-on.json"
# Explicit local false / true wins over example
write_ex "$TMP/ex-on.json" true
write_local "$TMP/local-false.json" false
t 'explicit local false wins over example true' \
  bash -c 'test "$(bash "$0/tools/resolve-appconfig.sh" "$1" "$2" | jq -r .feedbackEnabled)" = false' "$ROOT" "$TMP/local-false.json" "$TMP/ex-on.json"
write_ex "$TMP/ex-off.json" false
write_local "$TMP/local-true.json" true
t 'explicit local true wins over example false' \
  bash -c 'test "$(bash "$0/tools/resolve-appconfig.sh" "$1" "$2" | jq -r .feedbackEnabled)" = true' "$ROOT" "$TMP/local-true.json" "$TMP/ex-off.json"
# No deep-merge of objects: local sleeper replaces example
jq -n '{sleeper:{username:"from-example",userId:"1000000000000000991"},siteSlug:"ex"}' > "$TMP/ex-obj.json"
jq -n '{sleeper:{username:"from-local"}}' > "$TMP/local-obj.json"
t 'sleeper object is replaced, not deep-merged' \
  bash -c 'm=$(bash "$0/tools/resolve-appconfig.sh" "$1" "$2"); test "$(echo "$m" | jq -r .sleeper.username)" = from-local && test "$(echo "$m" | jq -r .sleeper.userId)" = null' "$ROOT" "$TMP/local-obj.json" "$TMP/ex-obj.json"

echo 'leak-check (a) fallback: local omits feedbackEnabled, example is true'
make_build "$TMP/build-fb" "$FB"
if run_leak "$TMP/local-omit.json" "$TMP/ex-on.json" "$TMP/build-fb" && last_ok; then
  t 'bundled inbox name is allowed when example says true' true
else
  t 'bundled inbox name is allowed when example says true' false
fi

echo 'leak-check (b) explicit local flag is respected'
if run_leak "$TMP/local-true.json" "$TMP/ex-off.json" "$TMP/build-fb" && last_ok; then
  t 'explicit local true allows a bundled inbox name' true
else
  t 'explicit local true allows a bundled inbox name' false
fi
if run_leak "$TMP/local-false.json" "$TMP/ex-on.json" "$TMP/build-fb"; then
  t 'explicit local false fails closed on a bundled inbox name' false
else
  if last_leaked feedbackCollection; then
    t 'explicit local false fails closed on a bundled inbox name' true
  else
    t 'explicit local false fails closed on a bundled inbox name' false
  fi
fi

echo 'leak-check (c) other secrets still fail'
make_build "$TMP/build-ks" "$KS"
if run_leak "$TMP/local-true.json" "$TMP/ex-on.json" "$TMP/build-ks"; then
  t 'keystore password in the build still fails leak-check' false
else
  t 'keystore password in the build still fails leak-check' last_leaked keystorePassword
fi
make_build "$TMP/build-up" "$UP"
if run_leak "$TMP/local-true.json" "$TMP/ex-on.json" "$TMP/build-up"; then
  t 'update channel path in the build still fails leak-check' false
else
  t 'update channel path in the build still fails leak-check' last_leaked updateChannelPath
fi
make_build "$TMP/build-pc" "$PC"
if run_leak "$TMP/local-true.json" "$TMP/ex-on.json" "$TMP/build-pc"; then
  t 'picks collection in the build still fails leak-check' false
else
  t 'picks collection in the build still fails leak-check' last_leaked picksCollection
fi

echo 'committed example stays placeholders-only, and its flag is true'
t 'config.example.json feedbackEnabled is true' \
  bash -c 'test "$(jq -r .feedbackEnabled "$0/app/config.example.json")" = true' "$ROOT"
t 'config.example.json still uses placeholders' \
  bash -c 'c=$(jq -r ".feedbackCollection,.keystorePassword,.updateChannelPath,.picksCollection,.pwaSecretPath,.sleeper.username" "$0/app/config.example.json"); echo "$c" | grep -q YOUR_ && ! echo "$c" | grep -Eq "mock-jc92|fb0123456789abcdef"' "$ROOT"

# A clean build (no private strings) still passes against the fixture (CHECKED > 0).
make_build "$TMP/build-clean" 'galaxy gridiron mock pwa with no secrets'
if run_leak "$TMP/local-omit.json" "$TMP/ex-on.json" "$TMP/build-clean" && last_ok; then
  t 'clean build still passes leak-check' true
else
  t 'clean build still passes leak-check' false
fi

# Smoke: gen-appconfig still writes the four public keys (do not assert real secret values).
BEFORE=$TMP/gen-before.json
cp "$ROOT/app/src/appconfig.generated.json" "$BEFORE" 2>/dev/null || true
bash "$ROOT/tools/gen-appconfig.sh" >/dev/null
GEN=$ROOT/app/src/appconfig.generated.json
t 'gen-appconfig still writes exactly the four public keys' \
  bash -c 'test "$(jq -r "keys|join(\",\")" "$0")" = "feedbackCollection,feedbackEnabled,publicUpdatePath,siteSlug"' "$GEN"
t 'gen-appconfig feedbackEnabled follows local-then-example (true here)' \
  bash -c 'test "$(jq -r .feedbackEnabled "$0")" = true' "$GEN"
# restore previous generated file if we copied it (gitignored; keeps the box as we found it)
[ -f "$BEFORE" ] && cp "$BEFORE" "$GEN" || true

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
