#!/usr/bin/env bash
# Stage the download site: root page is blank; everything lives under a long random path.
set -euo pipefail
FF=/workspace/fantasy-football
SECRET=$(cat $FF/keys/publish-secret-path.txt)
SITE=$FF/publish-site; rm -rf $SITE; mkdir -p $SITE/$SECRET/shots
cat > $SITE/index.html <<'H'
<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>🌌</title><body style="background:#0B1022;color:#636C93;font-family:sans-serif;display:grid;place-items:center;height:90vh">✨</body>
H
cp $FF/dist/GalaxyGridiron-v0.0.1.apk $SITE/$SECRET/
cp $FF/screenshots/*.png $SITE/$SECRET/shots/
SHA=$(sha256sum $FF/dist/GalaxyGridiron-v0.0.1.apk | cut -c1-16)
SIZE=$(du -m $FF/dist/GalaxyGridiron-v0.0.1.apk | cut -f1)
{
cat <<H
<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content="noindex,nofollow"><title>Galaxy Gridiron v0.0.1</title>
<style>body{margin:0;background:radial-gradient(1200px 600px at 90% -10%,#5b2a8a55,transparent),linear-gradient(#2A1B5E,#0F1426 40%,#0B1022);color:#EEF1FF;font-family:system-ui,Roboto,sans-serif;min-height:100vh}
main{max-width:760px;margin:auto;padding:28px 18px}h1{font-size:30px;margin:6px 0}p,li{color:#C9CEEA;line-height:1.5}
.btn{display:block;text-align:center;background:linear-gradient(90deg,#00CEB8,#7B5CFF);color:#fff;font-weight:800;font-size:18px;padding:16px;border-radius:14px;text-decoration:none;margin:18px 0}
.card{background:#161C33;border:1px solid #272F52;border-radius:16px;padding:16px;margin:14px 0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.grid a img{width:100%;border-radius:12px;border:1px solid #272F52}.small{font-size:12px;color:#636C93}b{color:#00CEB8}</style></head><body><main>
<div style="font-size:42px">🏈🪐</div><h1>Galaxy Gridiron <span style="color:#00CEB8">v0.0.1</span></h1>
<p>Your Sleeper leagues at a glance: team, matchup, league, waivers, trades, and a quick-answer chat. Read-only, so it never changes anything in your leagues.</p>
<a class=btn href="GalaxyGridiron-v0.0.1.apk" download>⬇ Download for Android (${SIZE} MB)</a>
<div class=card><b>Install in about 1 minute</b><ol>
<li>Open this page in <b>Chrome</b> on your Android phone and tap Download.</li>
<li>Tap the downloaded file. If Android says Chrome can't install unknown apps, tap <b>Settings → Allow from this source</b>, then go back.</li>
<li>Tap <b>Install</b>. <b>Play Protect</b> may warn about an "unknown app" because the app isn't from the Play Store. Tap <b>More details → Install anyway</b>. It only reads public Sleeper data.</li>
<li>Open <b>Galaxy Gridiron</b>, check that the username says demo_user, and tap <b>Launch 🚀</b>. The first load takes about 10 seconds.</li></ol></div>
<div class=card><b>Screens</b> <span class=small>(phone-size renders of the same app code with your real league data, made in a phone-sized browser)</span><div class=grid style="margin-top:10px">
H
for f in $SITE/$SECRET/shots/*.png; do n=$(basename $f); echo "<a href=\"shots/$n\"><img loading=lazy src=\"shots/$n\" alt=\"$n\"></a>"; done
cat <<H
</div></div>
<p class=small>Android 7+ · package com.jada.galaxygridiron · SHA-256 starts ${SHA} · built $(TZ=America/Chicago date '+%a %b %-d, %-I:%M %p CT')</p>
</main></body></html>
H
} > $SITE/$SECRET/index.html
echo staged $SITE/$SECRET
