# iPhone-viewport screenshots of the HOSTED web app (real here.now site, real relay), fresh profile, a demo Sleeper user.
import asyncio, os
from playwright.async_api import async_playwright
from PIL import Image
OUT='/workspace/fantasy-football/screenshots/v0.0.6/iphone'
URL='https://YOUR-SITE-SLUG.here.now/'+open('/workspace/fantasy-football/keys/pwa-secret-path.txt').read().strip()+'/'
UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
def shrink(p, limit=690_000):
  if os.path.getsize(p) > limit: Image.open(p).convert('RGB').quantize(colors=256).save(p, optimize=True)
async def main():
  async with async_playwright() as p:
    br=await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx=await br.new_context(viewport={'width':393,'height':852}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=UA)
    pg=await ctx.new_page(); errs=[]; reqs={'relay':0,'espn_direct_fail':0,'news':0}
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type=='error' and errs.append(m.text[:160]))
    pg.on('requestfinished', lambda r: (reqs.__setitem__('relay', reqs['relay']+1) if '/relay/' in r.url else None, reqs.__setitem__('news', reqs['news']+1) if 'graphql' in r.url else None))
    pg.on('requestfailed', lambda r: 'espn.com' in r.url and reqs.__setitem__('espn_direct_fail', reqs['espn_direct_fail']+1))
    async def shot(n):
      f=f'{OUT}/{n}.png'; await pg.screenshot(path=f); shrink(f); print('shot', n, os.path.getsize(f), flush=True)
    await pg.goto(URL, wait_until='networkidle', timeout=120000); await pg.wait_for_timeout(3000)
    await shot('01-first-open-tour')
    for _ in range(7):
      b=pg.get_by_text('Next', exact=True)
      if await b.count(): await b.first.click(); await pg.wait_for_timeout(250)
    await shot('02-tour-last-step-username')
    await pg.get_by_text('Enter my username →').first.click(); await pg.wait_for_timeout(600)
    await shot('03-enter-your-username')
    await pg.locator('input').first.fill(os.environ.get('GG_DEMO_USERNAME','YOUR_SLEEPER_USERNAME')); await pg.wait_for_timeout(300)
    await pg.get_by_text('Launch 🚀').first.click()
    await pg.wait_for_timeout(25000)
    await shot('04-team-tab')
    await pg.get_by_text('Picks', exact=True).last.click(); await pg.wait_for_timeout(9000)
    await shot('05-picks-tab')
    await pg.get_by_text('Team', exact=True).last.click(); await pg.wait_for_timeout(2500)
    await pg.get_by_text('Videos', exact=True).first.click(); await pg.wait_for_timeout(9000)
    await shot('06-videos-via-relay')
    print('requests', reqs); print('errors', errs[:8])
    await br.close()
asyncio.run(main())
