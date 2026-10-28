# v0.0.7 (from shots5.py) headless screenshots: react-native-web at a phone viewport with SIMULATED Android nav-bar insets.
# ?inset=48 = 3-button nav (48dp), ?inset=24 = gesture nav (24dp). A translucent fake nav bar is drawn over the
# bottom inset so you can see that nothing interactive sits under it. Real device insets come from the OS.
import os, json as _json
_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
_C = _json.load(open(_ROOT + '/app/config.local.json'))  # real values live only in the gitignored config
_S = _C['sleeper']
import asyncio, sys, os, json, urllib.request
from playwright.async_api import async_playwright
from PIL import Image
OUT=_ROOT+'/screenshots/v0.0.8'
MG=_S['leagues']['mg']; FS=_S['leagues']['fs']
HER="What's some good trades that don't involve high worth or locked players?"
from urllib.parse import quote
TAGS={}
SHOTS=[
 ('01-chat-who-should-i-start-week7', f'league={MG}&inset=48&tab=Chat&chip=1', 48),
]
NAV="""(h)=>{const d=document.createElement('div');d.style.cssText=`position:fixed;left:0;right:0;bottom:0;height:${h}px;background:rgba(0,0,0,.55);z-index:2147483647;pointer-events:none;display:flex;align-items:center;justify-content:space-around;color:#fff;font:600 16px sans-serif;border-top:1px dashed #ff5c8a`;
d.innerHTML=h>=40?'<span>|||</span><span>◯</span><span>‹</span>':'<span style="width:110px;height:4px;border-radius:2px;background:#fff;display:block"></span>';document.body.appendChild(d)}"""
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
    await page.goto('http://localhost:8081/?auto=1&user='+_S['username']+'&rssproxy=1', wait_until='networkidle', timeout=300000)
    await page.wait_for_timeout(6000)
    for name,q,inset in SHOTS:
      if only and not any(o in name for o in only): continue
      await page.evaluate("(t)=>{for(const l in t)localStorage.setItem('ggs:tags:'+l, JSON.stringify(t[l]));localStorage.setItem('ggs:upd:dismissed','99')}", TAGS)
      await page.goto('http://localhost:8081/?auto=1&user='+_S['username']+'&rssproxy=1&'+q, wait_until='networkidle', timeout=180000)
      await page.wait_for_timeout(9000)
      if 'type=' in q:  # type it like she did (tags are loaded by then)
        from urllib.parse import unquote
        txt=unquote(q.split('type=')[1])
        inp=page.get_by_placeholder('Try "Wilson or Pitts Sr?"'); await inp.fill(txt); await inp.press('Enter'); await page.wait_for_timeout(2500)
      if 'info=1' in q:
        await page.get_by_label('What do these numbers mean?').first.click(); await page.wait_for_timeout(1500)
      if 'chip=1' in q:
        await page.get_by_text('Who should I start?').first.click(); await page.wait_for_timeout(3000)
        if 'scrolldown=1' in q:
          await page.get_by_text('Best lineup (1 per slot', exact=False).first.scroll_into_view_if_needed(); await page.wait_for_timeout(800)
        else:
          await page.get_by_text('Week 7:', exact=False).last.evaluate('e=>e.scrollIntoView({block:"start"})'); await page.wait_for_timeout(800)
      if 'watch=1' in q:
        b=page.get_by_text('Watch', exact=False).filter(has_text='📺 Watch') if 'week=6' not in q else page.get_by_text('Highlights', exact=False)
        await b.first.scroll_into_view_if_needed(timeout=8000); await b.first.click(); await page.wait_for_timeout(1500)
      if 'scroll=watch' in q:
        await page.get_by_text('Your games').first.scroll_into_view_if_needed(timeout=8000); await page.wait_for_timeout(800)
      if 'scroll=moves' in q:
        el=page.get_by_text('Your moves', exact=False).first
        try: await el.scroll_into_view_if_needed(timeout=5000)
        except Exception as e: print('noscroll', e)
        await page.wait_for_timeout(800)
      await page.evaluate(NAV, inset)
      f=f'{OUT}/{name}.png'
      await page.screenshot(path=f); shrink(f)
      print('shot', name, os.path.getsize(f), flush=True)
    print('page errors:', errs[:5])
    await br.close()
asyncio.run(main())
