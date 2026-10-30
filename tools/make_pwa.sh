#!/usr/bin/env bash
# Build + stage the iPhone web app (PWA) into publish-site/<pwa-secret>/ (a STABLE folder: home-screen icons point here).
# Usage: NOTES="..." bash tools/make_pwa.sh   (STAGE=0: build + leak-check into dist-web/ only, do not touch the staging folder)
set -euo pipefail
FF=$(cd "$(dirname "$0")/.." && pwd); CFG=$FF/app/config.local.json
[ -f "$CFG" ] || { echo "missing app/config.local.json (copy app/config.example.json and fill it in)" >&2; exit 1; }
cfg() { jq -r "$1" "$CFG"; }
PUB=$(cfg '.publishSiteDir // empty'); PUB=${PUB:-$FF/publish-site}  # staging dir uploaded to here.now (keep it persistent: it holds every version folder)
P=$(cfg .pwaSecretPath); SLUG=$(cfg .siteSlug); OUT=$FF/dist-web; D=$PUB/$P
VN=$(jq -r .expo.version $FF/app/app.json); VC=$(jq -r .expo.android.versionCode $FF/app/app.json)
bash $FF/tools/gen-appconfig.sh  # bundle ONLY the 4 public config keys; pwaSecretPath is injected below as the base URL only
cd $FF/app && rm -rf $OUT && PWA_BASE=/$P EXPO_PUBLIC_PWA_BASE=/$P npx expo export --platform web --output-dir $OUT >/tmp/pwa-export.log 2>&1 || { tail -20 /tmp/pwa-export.log; exit 1; }
grep -q "/$P" $OUT/_expo/static/js/web/index-*.js || { echo "PWA base not inlined" >&2; exit 1; }
PYBIN=$FF/.venv-shots/bin/python; [ -x "$PYBIN" ] || PYBIN=python3
$PYBIN - "$OUT" "$FF" <<'PY'
import sys; from PIL import Image
out=sys.argv[1]; src=Image.open(sys.argv[2]+'/app/assets/icon.png').convert('RGBA')
bg=(7,11,28,255)
def save(n, size, pad=0):
  c=Image.new('RGBA',(size,size),bg); s=int(size*(1-2*pad)); c.alpha_composite(src.resize((s,s),Image.LANCZOS),((size-s)//2,(size-s)//2)); c.convert('RGB').save(f'{out}/{n}', optimize=True)
save('apple-touch-icon.png',180); save('icon-192.png',192); save('icon-512.png',512); save('icon-maskable-512.png',512,0.1)
PY
cat > $OUT/manifest.webmanifest <<J
{"name":"Galaxy Gridiron","short_name":"Gridiron","start_url":"/$P/","scope":"/$P/","display":"standalone","orientation":"portrait",
 "background_color":"#070B1C","theme_color":"#070B1C","description":"Your Sleeper fantasy leagues at a glance (read-only).",
 "icons":[{"src":"/$P/icon-192.png","sizes":"192x192","type":"image/png"},{"src":"/$P/icon-512.png","sizes":"512x512","type":"image/png"},{"src":"/$P/icon-maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]}
J
python3 - "$OUT/index.html" "$P" <<'PY'
import sys; p,P=sys.argv[1],sys.argv[2]; s=open(p).read()
s=s.replace('<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />','<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />')
s=s.replace('<meta httpEquiv="X-UA-Compatible" content="IE=edge" />','')
head=f'''<meta name="robots" content="noindex,nofollow" />
    <meta name="apple-mobile-web-app-capable" content="yes" /><meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" /><meta name="apple-mobile-web-app-title" content="Gridiron" />
    <meta name="theme-color" content="#070B1C" /><meta name="format-detection" content="telephone=no" />
    <link rel="manifest" href="/{P}/manifest.webmanifest" /><link rel="apple-touch-icon" href="/{P}/apple-touch-icon.png" />
    <style>html,body{{background:#070B1C;overscroll-behavior:none}} body{{-webkit-tap-highlight-color:transparent}}</style>
    <title>'''
s=s.replace('<title>',head,1)
open(p,'w').write(s)
PY
cat > $OUT/pwa-version.json <<J
{"versionCode": $VC, "versionName": "$VN", "apkUrl": "https://$SLUG.here.now/$P/", "notes": $(jq -Rn --arg n "${NOTES:-}" '$n')}
J
# fail before staging if any private config value (other than this PWA's own base path) is in the build
bash $FF/tools/leak-check.sh pwa $OUT "$CFG" || { echo "PWA leak check failed: not staging" >&2; exit 1; }
[ "${STAGE:-1}" = 0 ] && { echo "built PWA v$VN ($VC) in $OUT (not staged: STAGE=0)"; du -sh $OUT; exit 0; }
rm -rf $D && mkdir -p $D && cp -r $OUT/. $D/
# same-site read-only relay (here.now proxy routes): fixed upstreams = host allowlist, GET only, no secrets
mkdir -p $PUB/.herenow
cat > $PUB/.herenow/proxy.json <<J
{"proxies": {
  "/$P/relay/yt": {"upstream": "https://www.youtube.com/feeds/videos.xml", "method": "GET", "rateLimit": "300/hour/ip"},
  "/$P/relay/espn/*": {"upstream": "https://site.api.espn.com/apis/site/v2/sports/football/nfl", "method": "GET", "rateLimit": "300/hour/ip"}
}}
J
echo "staged PWA v$VN ($VC) at $D"; du -sh $D
