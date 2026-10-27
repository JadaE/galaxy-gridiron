#!/usr/bin/env bash
# Stage one version's download page under its own secret path, leaving other versions' folders in place.
# Usage: make_site_v.sh <version> <publishPaths key in app/config.local.json, e.g. v009 (or a file holding the path)> <shots-dir>
set -euo pipefail
BLURB=${BLURB:-}; PREV=${PREV:-the previous version}
FF=$(cd "$(dirname "$0")/.." && pwd); CFG=$FF/app/config.local.json
[ -f "$CFG" ] || { echo "missing app/config.local.json (copy app/config.example.json and fill it in)" >&2; exit 1; }
cfg() { jq -r "$1" "$CFG"; }
PUB=$(cfg '.publishSiteDir // empty'); PUB=${PUB:-$FF/publish-site}  # staging dir uploaded to here.now (keep it persistent: it holds every version folder)
V=$1; SECRET=$([ -f "$2" ] && tr -d "\r\n" < "$2" || cfg ".publishPaths.\"$2\""); SHOTS=$3
APK=$FF/dist/GalaxyGridiron-v$V.apk
SITE=$PUB; D=$SITE/$SECRET; rm -rf $D; mkdir -p $D/shots
[ -f $SITE/index.html ] || echo '<!doctype html><meta charset=utf-8><title>🌌</title><body style="background:#0B1022;color:#636C93;font-family:sans-serif;display:grid;place-items:center;height:90vh">✨</body>' > $SITE/index.html
cp $APK $D/; cp $SHOTS/*.png $D/shots/
SHA=$(sha256sum $APK | cut -c1-16); SIZE=$(du -m $APK | cut -f1)
{
cat <<H
<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content="noindex,nofollow"><title>Galaxy Gridiron v$V</title>
<style>body{margin:0;background:radial-gradient(1200px 600px at 90% -10%,#5b2a8a55,transparent),linear-gradient(#2A1B5E,#0F1426 40%,#0B1022);color:#EEF1FF;font-family:system-ui,Roboto,sans-serif;min-height:100vh}
main{max-width:760px;margin:auto;padding:28px 18px}h1{font-size:30px;margin:6px 0}p,li{color:#C9CEEA;line-height:1.5}
.btn{display:block;text-align:center;background:linear-gradient(90deg,#00CEB8,#7B5CFF);color:#fff;font-weight:800;font-size:18px;padding:16px;border-radius:14px;text-decoration:none;margin:18px 0}
.card{background:#161C33;border:1px solid #272F52;border-radius:16px;padding:16px;margin:14px 0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.grid a img{width:100%;border-radius:12px;border:1px solid #272F52}.small{font-size:12px;color:#636C93}b{color:#00CEB8}</style></head><body><main>
<div style="font-size:42px">🏈🪐</div><h1>Galaxy Gridiron <span style="color:#00CEB8">v$V</span></h1>
<p>${BLURB}</p>
<a class=btn href="GalaxyGridiron-v$V.apk" download>⬇ Download for Android (${SIZE} MB)</a>
<div class=card><b>Update from ${PREV} (about 1 minute)</b><ol>
<li>Open this page in <b>Chrome</b> on your Android phone and tap Download.</li>
<li>Tap the downloaded file, then tap <b>Update</b>. It installs over ${PREV}, so you don't need to uninstall.</li>
<li>If <b>Play Protect</b> warns about an "unknown app," tap <b>More details → Install anyway</b>. If Chrome asks for permission, tap <b>Settings → Allow from this source</b>, then go back.</li>
<li>Open Galaxy Gridiron and pull down to refresh.</li>${EXTRA_LI:-}</ol>
<p class=small>Don't have the app yet? Same steps, but tap Install. If Android says "App not installed," uninstall the old copy first.</p></div>
<div class=card><b>Screens</b> <span class=small>(phone-size renders of the same app code with your real league data)</span><div class=grid style="margin-top:10px">
H
for f in $D/shots/*.png; do n=$(basename $f); echo "<a href=\"shots/$n\"><img loading=lazy src=\"shots/$n\" alt=\"$n\"></a>"; done
cat <<H
</div></div>
<p class=small>Android 7+ · v$V · SHA-256 starts ${SHA} · built $(TZ=America/Chicago date '+%a %b %-d, %-I:%M %p CT')</p>
</main></body></html>
H
} > $D/index.html
echo staged $D
