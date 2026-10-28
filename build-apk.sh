#!/usr/bin/env bash
# Local release build of Galaxy Gridiron (no EAS). Usage: bash build-apk.sh
set -euo pipefail
export JAVA_HOME=$HOME/jdk17 ANDROID_HOME=$HOME/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
ROOT=$(cd "$(dirname "$0")" && pwd); CFG=$ROOT/app/config.local.json
[ -f "$CFG" ] || { echo "missing app/config.local.json (copy app/config.example.json and fill it in)" >&2; exit 1; }
cfg() { jq -r "$1" "$CFG"; }
APP=$ROOT/app
cd $APP
# version guard: app.json and src/version.ts must agree
AJ=$(node -e "const a=require('./app.json').expo;console.log(a.version+':'+a.android.versionCode)")
VT=$(node -e "const s=require('fs').readFileSync('src/version.ts','utf8');console.log(s.match(/VERSION_NAME = '([^']+)'/)[1]+':'+s.match(/VERSION_CODE = (\\d+)/)[1])")
[ "$AJ" = "$VT" ] || { echo "Version mismatch: app.json $AJ vs src/version.ts $VT" >&2; exit 1; }
GG_VERSION=${GG_VERSION:-${AJ%%:*}}
# bundle ONLY the 4 public config keys (never config.local.json itself)
bash $ROOT/tools/gen-appconfig.sh
[ -d android ] || npx expo prebuild -p android --no-install
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
G=android/app/build.gradle
# keep the native project's version in step with app.json (prebuild only runs when android/ is missing)
sed -i -E "s/^( *)versionCode [0-9]+/\1versionCode ${AJ##*:}/; s/^( *)versionName \"[^\"]*\"/\1versionName \"${AJ%%:*}\"/" $G
grep -q "versionCode ${AJ##*:}$" $G || { echo "could not set versionCode in $G" >&2; exit 1; }
if ! grep -q "GG_RELEASE_SIGNING" $G; then
python3 - "$G" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""    signingConfigs {
        debug {""","""    signingConfigs {
        release { // GG_RELEASE_SIGNING
            storeFile file(System.getenv('GG_KEYSTORE'))
            storePassword System.getenv('GG_KEYPASS')
            keyAlias 'galaxygridiron'
            keyPassword System.getenv('GG_KEYPASS')
        }
        debug {""",1)
i=s.index("        release {\n            // Caution!")
j=s.index("signingConfig signingConfigs.debug",i)
s=s[:j]+"signingConfig signingConfigs.release"+s[j+len("signingConfig signingConfigs.debug"):]
open(p,'w').write(s)
PY
fi
export GG_KEYSTORE=$ROOT/keys/galaxy-gridiron.keystore
export GG_KEYPASS=$(cfg .keystorePassword)
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64 -Dorg.gradle.jvmargs="-Xmx3g -XX:MaxMetaspaceSize=768m" --max-workers=4 --no-daemon
OUT=app/build/outputs/apk/release/app-release.apk
mkdir -p $ROOT/dist
# verify what actually got built before publishing
BADGE=$($(ls -d $ANDROID_HOME/build-tools/* | tail -1)/aapt2 dump badging $OUT | awk "NR==1")
echo "$BADGE" | grep -q "versionCode='${AJ##*:}' versionName='${AJ%%:*}'" || { echo "APK version mismatch: $BADGE" >&2; exit 1; }
# fail the build if any private config value made it into the APK (Hermes bundle, dex, resources)
bash $ROOT/tools/leak-check.sh apk $OUT "$CFG" || { echo "APK leak check failed: not copying to dist/" >&2; exit 1; }
cp $OUT $ROOT/dist/GalaxyGridiron-v${GG_VERSION}.apk
ls -la $ROOT/dist
echo BUILD_OK
