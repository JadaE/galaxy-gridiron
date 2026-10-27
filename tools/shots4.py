# v0.0.4 headless screenshots: react-native-web, phone viewport, real ESPN schedule/scores and Sleeper data.
# Her picks in these shots are SAMPLE picks (?seedpicks=1); leaderboard rivals are labelled sample rows.
import os, json as _json
_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
_C = _json.load(open(_ROOT + '/app/config.local.json'))  # real values live only in the gitignored config
_S = _C['sleeper']
import asyncio, sys, os, urllib.request
from playwright.async_api import async_playwright
from PIL import Image
OUT=_ROOT+'/screenshots/v0.0.4'
MG=_S['leagues']['mg']; FS=_S['leagues']['fs']
SHOTS=[
 ('01-tab-bar-team-videos-button', f'tab=Team&league={FS}'),
 ('02-picks-week-view', 'tab=Picks&seedpicks=1'),
 ('03-picks-record-chart', 'tab=Picks&seedpicks=1&pview=record'),
 ('04-picks-backfill-week6', 'tab=Picks&seedpicks=1&pweek=6&backfill=1'),
 ('05-picks-paste-preview', 'tab=Picks&psheet=paste&pastedemo=1'),
 ('06-leaderboard-sample-chart', 'tab=Picks&seedpicks=1&pview=board&lbsample=1'),
 ('07-player-sheet-jacobs-value-videos', f'tab=Team&league={FS}&player=5850'),
 ('08-videos-opened-from-team', f'tab=Team&league={FS}&videos=1'),
]
only=sys.argv[1:]
def shrink(p, limit=690_000):
  if os.path.getsize(p) <= limit: return
  im=Image.open(p).convert('RGB')
  im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(p, optimize=True)
  if os.path.getsize(p) > limit:
    im=im.resize((im.width*3//4, im.height*3//4), Image.LANCZOS); im.quantize(colors=256).save(p, optimize=True)
async def main():
  async with async_playwright() as p:
    br=await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx=await br.new_context(viewport={'width':412,'height':915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    # headless Chrome on the box can't reach ESPN (works from curl and from the phone's OkHttp), so relay it
    cache={}
    async def espn(route):
      u=route.request.url
      if u not in cache:
        cache[u]=await asyncio.to_thread(lambda: urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent':'okhttp/4.12.0'}), timeout=30).read())
      await route.fulfill(status=200, body=cache[u], headers={'content-type':'application/json','access-control-allow-origin':'*'})
    await ctx.route('https://site.api.espn.com/**', espn)
    page=await ctx.new_page(); errs=[]
    page.on('pageerror', lambda e: errs.append(str(e)))
    await page.goto('http://localhost:8081/?auto=1&rssproxy=1', wait_until='networkidle', timeout=300000)
    await page.wait_for_timeout(6000)
    for name,q in SHOTS:
      if only and not any(o in name for o in only): continue
      await page.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('ggs:picks:')||k.startsWith('ggs:lb:')).forEach(k=>localStorage.removeItem(k));localStorage.setItem('ggs:upd:dismissed','99')")
      await page.goto('http://localhost:8081/?auto=1&rssproxy=1&'+q, wait_until='networkidle', timeout=180000)
      await page.wait_for_timeout(9000)
      f=f'{OUT}/{name}.png'
      await page.screenshot(path=f); shrink(f)
      await page.set_viewport_size({'width':412,'height':2400}); await page.wait_for_timeout(1500)
      f2=f'{OUT}/full/{name}-tall.png'; await page.screenshot(path=f2); shrink(f2, 1_400_000)
      await page.set_viewport_size({'width':412,'height':915})
      print('shot', name, os.path.getsize(f), flush=True)
    print('page errors:', errs[:5])
    await br.close()
asyncio.run(main())
