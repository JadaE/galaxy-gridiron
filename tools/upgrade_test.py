# Upgrade-path test (web preview): seed v0.0.4-era storage, load the new build WITHOUT ?auto, check the user stays signed in
# and every saved key/value is still there. Then a fresh profile: empty username field + tutorial with the username step.
import asyncio, json
from playwright.async_api import async_playwright
UID='1000000000000000001'
V004={ 'ggs:username':'demo_user', 'ggs:league':'2000000000000000002',
  f'ggs:picks:{UID}:2026': json.dumps({'401772510':{'team':'KC','week':1,'at':0,'src':'backfill'},'401772600':{'team':'BUF','week':2,'at':1757000000000,'src':'live'}}),
  f'ggs:lb:me:{UID}': json.dumps({'uid':UID,'un':'demo_user','joinedAt':1760000000000}),
  'ggs:tags:2000000000000000002': json.dumps({'11564':'high'}), 'ggs:picks:pref:inclBf':'1', 'ggs:upd:dismissed':'4' }
async def main():
  async with async_playwright() as p:
    br=await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx=await br.new_context(viewport={'width':412,'height':915}, device_scale_factor=1)
    pg=await ctx.new_page()
    await pg.goto('http://localhost:8081/?rssproxy=1', wait_until='domcontentloaded', timeout=300000)
    await pg.evaluate("(o)=>{localStorage.clear();for(const k in o)localStorage.setItem(k,o[k])}", V004)
    await pg.goto('http://localhost:8081/?rssproxy=1', wait_until='networkidle', timeout=300000); await pg.wait_for_timeout(12000)
    body=await pg.inner_text('body')
    signed = 'SLEEPER USERNAME' not in body
    tut = await pg.get_by_test_id('tutorial').count()
    after=await pg.evaluate("(ks)=>Object.fromEntries(ks.map(k=>[k,localStorage.getItem(k)]))", list(V004))
    kept=[k for k in V004 if after.get(k)==V004[k] or (k=='ggs:upd:dismissed' and after.get(k))]
    print('UPGRADE signed_in=%s tutorial_shown=%s kept=%d/%d' % (signed, tut>0, len(kept), len(V004)))
    for k in V004:
      if k not in kept: print('  changed:', k, V004[k][:60], '->', (after.get(k) or 'None')[:60])
    await pg.screenshot(path='/workspace/fantasy-football/screenshots/v0.0.6/full/upgrade-from-v004.png')
    # fresh install
    await pg.evaluate("localStorage.clear()")
    await pg.goto('http://localhost:8081/', wait_until='networkidle', timeout=300000); await pg.wait_for_timeout(5000)
    tut = await pg.get_by_test_id('tutorial').count()
    for _ in range(8):
      b=pg.get_by_text('Next', exact=True)
      if await b.count(): await b.first.click(); await pg.wait_for_timeout(300)
    last=await pg.inner_text('body')
    has_step='Last step: your Sleeper username' in last
    await pg.get_by_text('Enter my username →').first.click(); await pg.wait_for_timeout(800)
    val=await pg.locator('input').first.input_value(); ph=await pg.locator('input').first.get_attribute('placeholder')
    print('FRESH tutorial_shown=%s username_step=%s field=%r placeholder=%r' % (tut>0, has_step, val, ph))
    await br.close()
asyncio.run(main())
