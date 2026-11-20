#!/usr/bin/env bash
# JC-92: leak-check config resolution (local object required; only allow-listed
# non-secret keys inherit from example). Mock values only; never prints a secret.
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
# Placeholder that must NOT be inherited when local omits the secret key.
PH='mock-jc92-example-keystore-placeholder-bbbb'

write_ex() { # path feedbackEnabled [keystore]
  local ks=${3:-$KS}
  jq -n --arg ks "$ks" --arg up "$UP" --arg pc "$PC" --arg fb "$FB" --argjson on "$2" \
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

LAST_RC=0
run_leak() { # local example build
  local out
  set +e
  out=$(LEAK_REQUIRE_PASSWORD=0 LEAK_EXAMPLE_CONFIG="$2" bash "$ROOT/tools/leak-check.sh" pwa "$3" "$1" 2>&1)
  LAST_RC=$?
  set -e
  printf '%s' "$out" > "$TMP/last.out"
  return $LAST_RC
}
last_leaked() { grep -q "LEAK: $1 found" "$TMP/last.out"; }
last_ok() { grep -q 'pwa leak check OK' "$TMP/last.out"; }
# Fail closed: non-zero, and must not have scanned-and-passed on example placeholders.
last_fail_closed() { [ "$LAST_RC" -ne 0 ] && ! last_ok; }

echo 'resolve-appconfig'
write_ex "$TMP/ex-on.json" true
write_local "$TMP/local-omit.json"
t 'local omit + example true => feedbackEnabled true' \
  bash -c 'test "$(bash "$0/tools/resolve-appconfig.sh" "$1" "$2" | jq -r .feedbackEnabled)" = true' "$ROOT" "$TMP/local-omit.json" "$TMP/ex-on.json"
write_ex "$TMP/ex-on.json" true
write_local "$TMP/local-false.json" false
t 'explicit local false wins over example true' \
  bash -c 'test "$(bash "$0/tools/resolve-appconfig.sh" "$1" "$2" | jq -r .feedbackEnabled)" = false' "$ROOT" "$TMP/local-false.json" "$TMP/ex-on.json"
write_ex "$TMP/ex-off.json" false
write_local "$TMP/local-true.json" true
t 'explicit local true wins over example false' \
  bash -c 'test "$(bash "$0/tools/resolve-appconfig.sh" "$1" "$2" | jq -r .feedbackEnabled)" = true' "$ROOT" "$TMP/local-true.json" "$TMP/ex-off.json"
# Objects are taken from local only; example secrets are not deep-merged or filled in.
jq -n '{sleeper:{username:"from-example",userId:"1000000000000000991"},siteSlug:"ex"}' > "$TMP/ex-obj.json"
jq -n '{sleeper:{username:"from-local"}}' > "$TMP/local-obj.json"
t 'sleeper object is not deep-merged from example' \
  bash -c 'm=$(bash "$0/tools/resolve-appconfig.sh" "$1" "$2"); test "$(echo "$m" | jq -r .sleeper.username)" = from-local && test "$(echo "$m" | jq -r .sleeper.userId)" = null' "$ROOT" "$TMP/local-obj.json" "$TMP/ex-obj.json"
# Secret-bearing keys missing on local must not inherit the example placeholder.
jq -n --arg ph "$PH" --arg up "$UP" '{keystorePassword:$ph, updateChannelPath:$up, feedbackEnabled:true}' > "$TMP/ex-ph.json"
jq -n --arg up "$UP" --arg pc "$PC" --arg fb "$FB" '{updateChannelPath:$up, picksCollection:$pc, feedbackCollection:$fb}' > "$TMP/local-noks.json"
t 'secret key missing from local is not inherited from example' \
  bash -c 'm=$(bash "$0/tools/resolve-appconfig.sh" "$1" "$2"); test "$(echo "$m" | jq -r ".keystorePassword // empty")" = ""' "$ROOT" "$TMP/local-noks.json" "$TMP/ex-ph.json"

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

echo 'leak-check fail-closed when local is not a valid object'
make_build "$TMP/build-clean" 'galaxy gridiron mock pwa with no secrets'
if run_leak "$TMP/no-such-local.json" "$TMP/ex-on.json" "$TMP/build-clean"; then
  t 'missing local file exits non-zero' false
else
  t 'missing local file exits non-zero' last_fail_closed
fi
: > "$TMP/local-empty.json"
if run_leak "$TMP/local-empty.json" "$TMP/ex-on.json" "$TMP/build-clean"; then
  t 'empty local file exits non-zero' false
else
  t 'empty local file exits non-zero' last_fail_closed
fi
printf 'null\n' > "$TMP/local-null.json"
if run_leak "$TMP/local-null.json" "$TMP/ex-on.json" "$TMP/build-clean"; then
  t 'null local file exits non-zero' false
else
  t 'null local file exits non-zero' last_fail_closed
fi
printf '[]\n' > "$TMP/local-array.json"
if run_leak "$TMP/local-array.json" "$TMP/ex-on.json" "$TMP/build-clean"; then
  t 'non-object local file exits non-zero' false
else
  t 'non-object local file exits non-zero' last_fail_closed
fi

echo 'leak-check does not scan example placeholders for omitted secrets'
write_ex "$TMP/ex-ph-full.json" true "$PH"
make_build "$TMP/build-ph" "$PH"
if run_leak "$TMP/local-noks.json" "$TMP/ex-ph-full.json" "$TMP/build-ph" && last_ok && ! last_leaked keystorePassword; then
  t 'secret key missing from local does not inherit the placeholder' true
else
  t 'secret key missing from local does not inherit the placeholder' false
fi

echo 'committed example stays placeholders-only, and its flag is false (store/public build)'
t 'config.example.json feedbackEnabled is false' \
  bash -c 'test "$(jq -r .feedbackEnabled "$0/app/config.example.json")" = false' "$ROOT"
t 'config.example.json still uses placeholders' \
  bash -c 'c=$(jq -r ".feedbackCollection,.keystorePassword,.updateChannelPath,.picksCollection,.pwaSecretPath,.sleeper.username" "$0/app/config.example.json"); echo "$c" | grep -q YOUR_ && ! echo "$c" | grep -Eq "mock-jc92|fb0123456789abcdef"' "$ROOT"

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
t 'gen-appconfig feedbackEnabled follows local-then-example (false here)' \
  bash -c 'test "$(jq -r .feedbackEnabled "$0")" = false' "$GEN"
[ -f "$BEFORE" ] && cp "$BEFORE" "$GEN" || true

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
