import os
# v0.0.3 headless screenshots: same app code on react-native-web, phone viewport, real league data.
import asyncio, sys, json, urllib.request
from playwright.async_api import async_playwright
OUT='/workspace/fantasy-football/screenshots/v0.0.3'
MG=os.environ.get('GG_LEAGUE_MG','2000000000000000001'); FS=os.environ.get('GG_LEAGUE_FS','2000000000000000002')
W='http://localhost:8787'
def token():
  req=urllib.request.Request(W+'/pair', data=json.dumps({'code':'dev-pair-code','deviceName':'Web preview'}).encode(), headers={'content-type':'application/json'})
  return json.load(urllib.request.urlopen(req))['deviceToken']
# (name, query, storage-setup)
SHOTS=[
 ('01-chat-rules-fit-wilson-pitts', f'tab=Team&league={MG}&ask=Wilson%20or%20Pitts%20Sr', 'rules'),
 ('02-chat-fit-burrow-maye-fam-slam', f'tab=Team&league={FS}&ask=Burrow%20or%20Maye', 'rules'),
 ('03-chat-budget-ai-cost-counter', f'tab=Team&league={MG}&ask=Wilson%20or%20Pitts%20Sr', 'paired'),
 ('04-chat-ai-setup-card', f'tab=Team&league={MG}&ask=Should%20I%20pick%20up%20Pitts', 'unpaired'),
 ('05-update-banner', f'tab=Team&league={FS}&updurl=http://localhost:8095/version.json', 'upd'),
 ('06-settings-ai-not-paired', f'tab=Team&league={FS}&settings=ai', 'unpairedurl'),
 ('07-settings-ai-paired', f'tab=Team&league={FS}&settings=ai', 'paired'),
 ('08-trades-ideas-fam-slam', f'tab=Trades&league={FS}', 'rules'),
 ('08b-trades-ideas-moments-gang', f'tab=Trades&league={MG}', 'rules'),
]
only=sys.argv[1:]
async def main():
  tok=token()
  async with async_playwright() as p:
    br=await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx=await br.new_context(viewport={'width':412,'height':915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page=await ctx.new_page(); errs=[]
    page.on('pageerror', lambda e: errs.append(str(e)))
    await page.goto('http://localhost:8081/?auto=1&rssproxy=1', wait_until='networkidle', timeout=240000)
    await page.wait_for_timeout(6000)
    for name,q,mode in SHOTS:
      if only and not any(o in name for o in only): continue
      js = "localStorage.removeItem('ggs:upd:lastCheck');localStorage.removeItem('ggs:upd:latest');localStorage.removeItem('ggs:upd:dismissed');localStorage.removeItem('ggs:ai:curChat');localStorage.removeItem('ggs:ai:chats');"
      js += "localStorage.setItem('ggs:tags:%s', JSON.stringify({'9509':'never'}));" % FS
      if mode=='paired': js += "localStorage.setItem('ggs:ai:tier','budget');localStorage.setItem('ggsec_gg_ai_base','%s');localStorage.setItem('ggsec_gg_ai_token','%s');localStorage.setItem('ggs:ai:usage','null');" % (W,tok)
      elif mode in('unpaired','unpairedurl'): js += "localStorage.setItem('ggs:ai:tier','budget');localStorage.removeItem('ggsec_gg_ai_token');" + ("localStorage.setItem('ggsec_gg_ai_base','https://galaxy-gridiron-ai.your-subdomain.workers.dev');" if mode=='unpairedurl' else "localStorage.removeItem('ggsec_gg_ai_base');")
      else: js += "localStorage.setItem('ggs:ai:tier','rules');"
      await page.evaluate(js)
      await page.goto('http://localhost:8081/?auto=1&rssproxy=1&'+q, wait_until='networkidle', timeout=180000)
      await page.wait_for_timeout(6500)
      await page.screenshot(path=f'{OUT}/{name}.png')
      await page.set_viewport_size({'width':412,'height':2600}); await page.wait_for_timeout(1500)
      await page.screenshot(path=f'{OUT}/full/{name}-tall.png')
      await page.set_viewport_size({'width':412,'height':915})
      print('shot', name, flush=True)
    print('page errors:', errs[:5])
    await br.close()
asyncio.run(main())
