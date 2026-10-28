import os, json as _json
_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
_C = _json.load(open(_ROOT + '/app/config.local.json'))  # real values live only in the gitignored config
_S = _C['sleeper']
import asyncio, sys
from playwright.async_api import async_playwright
OUT=_ROOT+'/screenshots'
MG=_S['leagues']['mg']; FS=_S['leagues']['fs']; PAST=_S['leagues']['past']
SHOTS=[
 ('01-team-mock-league-alpha', f'tab=Team&league={FS}', None),
 ('02-team-mock-league-beta-alerts', f'tab=Team&league={MG}', None),
 ('03-matchup', f'tab=Matchup&league={FS}', None),
 ('04-league', f'tab=League&league={MG}', None),
 ('05-waivers', f'tab=Waivers&league={MG}', None),
 ('05b-waivers-mock-league-alpha', f'tab=Waivers&league={FS}', None),
 ('06-trades', f'tab=Trades&league={FS}', None),
 ('07-chat', f'tab=Chat&league={MG}&ask=Who%20should%20I%20start%3F', None),
 ('08-player-sheet', f'tab=Team&league={FS}&player=9509', None),
 ('09-past-league-2025', f'tab=League&league={PAST}', None),
 ('10-onboarding', '', None),
]
only=sys.argv[1:]
async def main():
  async with async_playwright() as p:
    br=await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx=await br.new_context(viewport={'width':412,'height':915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page=await ctx.new_page()
    # warm cache (players etc.) once
    await page.goto('http://localhost:8081/?auto=1', wait_until='networkidle', timeout=120000)
    await page.wait_for_timeout(4000)
    for name,q,_ in SHOTS:
      if only and not any(o in name for o in only): continue
      if name=='10-onboarding':
        await page.evaluate('localStorage.removeItem("ggs:username")')
        await page.goto('http://localhost:8081/', wait_until='networkidle')
      else:
        await page.goto('http://localhost:8081/?auto=1&'+q, wait_until='networkidle', timeout=120000)
      await page.wait_for_timeout(3500)
      await page.screenshot(path=f'{OUT}/{name}.png')
      await page.set_viewport_size({'width':412,'height':2600}); await page.wait_for_timeout(1500)
      await page.screenshot(path=f'{OUT}/full/{name}-tall.png')
      await page.set_viewport_size({'width':412,'height':915})
      print('shot', name, flush=True)
    await br.close()
asyncio.run(main())
