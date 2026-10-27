import os, json as _json
_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
_C = _json.load(open(_ROOT + '/app/config.local.json'))  # real values live only in the gitignored config
_S = _C['sleeper']
import asyncio, sys, json
from playwright.async_api import async_playwright
OUT=_ROOT+'/screenshots/v0.0.2'
MG=_S['leagues']['mg']; FS=_S['leagues']['fs']
SHOTS=[
 ('01-team-fam-slam-grade', f'tab=Team&league={FS}'),
 ('02-team-moments-gang', f'tab=Team&league={MG}'),
 ('03-matchup-report-card-w6', f'tab=Matchup&league={MG}&week=6'),
 ('04-league-path-top3-fam-slam', f'tab=League&league={FS}'),
 ('04b-league-path-top3-moments-gang', f'tab=League&league={MG}'),
 ('05-waivers-drop-safety', f'tab=Waivers&league={MG}'),
 ('06-trades-ideas-tags', f'tab=Trades&league={FS}'),
 ('06b-trades-moments-gang', f'tab=Trades&league={MG}'),
 ('07-videos', f'tab=Videos&league={FS}'),
 ('08-chat-compare', f'tab=Team&league={MG}&ask=Wilson%20or%20Pitts%20Sr'),
 ('08b-chat-pickup', f'tab=Team&league={MG}&ask=should%20I%20pick%20up%20pitts'),
 ('08c-chat-did-you-mean', f'tab=Team&league={MG}&ask=should%20I%20pick%20up%20Brown'),
 ('09-player-sheet-qb-change', f'tab=Team&league={FS}&player=8112'),
]
only=sys.argv[1:]
async def main():
  async with async_playwright() as p:
    br=await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx=await br.new_context(viewport={'width':412,'height':915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page=await ctx.new_page()
    errs=[]
    page.on('pageerror', lambda e: errs.append(str(e)))
    await page.goto('http://localhost:8081/?auto=1&rssproxy=1', wait_until='networkidle', timeout=180000)
    await page.wait_for_timeout(5000)
    await page.evaluate("""localStorage.setItem('ggs:tags:%s', JSON.stringify({'9509':'never','3198':'high'}))""" % FS)
    for name,q in SHOTS:
      if only and not any(o in name for o in only): continue
      await page.goto('http://localhost:8081/?auto=1&rssproxy=1&'+q, wait_until='networkidle', timeout=180000)
      await page.wait_for_timeout(5000)
      await page.screenshot(path=f'{OUT}/{name}.png')
      await page.set_viewport_size({'width':412,'height':2800}); await page.wait_for_timeout(1500)
      await page.screenshot(path=f'{OUT}/full/{name}-tall.png')
      await page.set_viewport_size({'width':412,'height':915})
      print('shot', name, flush=True)
    print('page errors:', errs[:5])
    await br.close()
asyncio.run(main())
