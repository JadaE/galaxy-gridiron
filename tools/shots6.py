# v0.0.6 Android-viewport screenshots (react-native-web, real Sleeper data). Simulated 3-button nav bar (48dp) drawn on top.
import asyncio, sys, os, urllib.request
from playwright.async_api import async_playwright
from PIL import Image
OUT='/workspace/fantasy-football/screenshots/v0.0.6'
MG=os.environ.get('GG_LEAGUE_MG','2000000000000000001'); FS=os.environ.get('GG_LEAGUE_FS','2000000000000000002')
# (name, query, inset, viewport height, action)
SHOTS=[
 ('01-player-card-news-maye', f'tab=Team&league={FS}&inset=48&player=11564', 48, 915, 'scrollnews'),
 ('02-player-card-season-news-jefferson', f'tab=Team&league={FS}&inset=48&player=6794', 48, 915, 'season'),
 ('03-player-card-season-news-jacobs', f'tab=Team&league={FS}&inset=48&player=5850', 48, 915, 'season'),
 ('04-tutorial-1-tabs', f'league={MG}&inset=48&tutorial=1', 48, 915, None),
 ('05-tutorial-2-trade-tags', f'league={MG}&inset=48&tutorial=2', 48, 915, None),
 ('06-tutorial-3-picks', f'league={MG}&inset=48&tutorial=3', 48, 915, None),
 ('07-tutorial-4-catch-up-past-weeks', f'league={MG}&inset=48&tutorial=4', 48, 915, None),
 ('08-tutorial-5-updates', f'league={MG}&inset=48&tutorial=5', 48, 915, None),
 ('09-tutorial-6-settings-feedback', f'league={MG}&inset=48&tutorial=6', 48, 915, None),
 ('10-settings-feedback-form', f'league={MG}&inset=48&settings=all&tab=Picks', 48, 915, 'feedback'),
 ('11-settings-picks-data', f'league={MG}&inset=48&settings=all', 48, 915, None),
 ('12-picks-enter-past-picks-link', 'tab=Picks&seedpicks=1&inset=48', 48, 915, None),
 ('13-picks-entering-past-picks', 'tab=Picks&seedpicks=1&pweek=6&backfill=1&inset=48', 48, 915, None),
]
NAV="""(h)=>{const d=document.createElement('div');d.style.cssText=`position:fixed;left:0;right:0;bottom:0;height:${h}px;background:rgba(0,0,0,.55);z-index:2147483647;pointer-events:none;display:flex;align-items:center;justify-content:space-around;color:#fff;font:600 16px sans-serif;border-top:1px dashed #ff5c8a`;
d.innerHTML='<span>|||</span><span>◯</span><span>‹</span>';document.body.appendChild(d)}"""
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
    cache={}
    async def espn(route):
      u=route.request.url
      if u not in cache:
        cache[u]=await asyncio.to_thread(lambda: urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent':'okhttp/4.12.0'}), timeout=30).read())
      await route.fulfill(status=200, body=cache[u], headers={'content-type':'application/json','access-control-allow-origin':'*'})
    await ctx.route('https://site.api.espn.com/**', espn)
    page=await ctx.new_page(); errs=[]
    page.on('pageerror', lambda e: errs.append(str(e)))
    await page.goto('http://localhost:8081/?auto=1&user=demo_user&rssproxy=1', wait_until='networkidle', timeout=300000)
    await page.wait_for_timeout(6000)
    for name,q,inset,vh,act in SHOTS:
      if only and not any(o in name for o in only): continue
      await page.set_viewport_size({'width':412,'height':vh})
      await page.evaluate("localStorage.setItem('ggs:upd:dismissed','99')")
      await page.goto('http://localhost:8081/?auto=1&user=demo_user&rssproxy=1&'+q, wait_until='networkidle', timeout=180000)
      await page.wait_for_timeout(9000)
      if act in ('scrollnews','season'):
        card=page.get_by_test_id('news-card'); await card.scroll_into_view_if_needed(); await page.wait_for_timeout(800)
        if act=='season':
          await page.get_by_text('Recent News').first.click(); await page.wait_for_timeout(300)
          await page.get_by_text('Season News').first.click(); await page.wait_for_timeout(800)
          await card.scroll_into_view_if_needed()
        await page.evaluate("()=>{const c=document.querySelector('[data-testid=news-card]');let s=c&&c.parentElement;while(s&&!(s.scrollHeight>s.clientHeight+5&&getComputedStyle(s).overflowY!='visible'))s=s.parentElement;if(s)s.scrollTop=c.offsetTop-(act=='season'?140:300)}".replace("act=='season'", 'true' if act=='season' else 'false'))
        await page.wait_for_timeout(800)
      if act=='feedback':
        await page.get_by_text('Help & feedback').first.scroll_into_view_if_needed()
        await page.get_by_text('💡 Idea').first.click()
        await page.get_by_placeholder('What would make it better?').fill('Could the Picks tab show which games another player picked differently?')
        await page.wait_for_timeout(600)
        await page.evaluate("()=>{const e=[...document.querySelectorAll('div')].find(d=>d.textContent==='Help & feedback');let s=e;while(s&&!(s.scrollHeight>s.clientHeight+5&&getComputedStyle(s).overflowY!='visible'))s=s.parentElement;if(s&&e)s.scrollTop+=e.getBoundingClientRect().top-120}")
        await page.wait_for_timeout(600)
      await page.evaluate(NAV, inset)
      f=f'{OUT}/{name}.png'
      await page.screenshot(path=f); shrink(f)
      print('shot', name, os.path.getsize(f), flush=True)
    print('page errors:', errs[:5])
    await br.close()
asyncio.run(main())
