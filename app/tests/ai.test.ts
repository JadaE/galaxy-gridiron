// Run: npx tsx tests/ai.test.ts
// App AI client (src/ai/client.ts) against the REAL Worker code (worker/src/index.ts) on a local HTTP server,
// with in-memory KV and a stubbed OpenAI upstream. No network, no keys. Also checks roster-fit invariants.
import assert from 'node:assert/strict';
import http from 'node:http';
import { handle } from '../../worker/src/index';
import * as ai from '../src/ai/client';

class KV { m = new Map<string, string>(); async get(k: string) { return this.m.get(k) ?? null; } async put(k: string, v: string) { this.m.set(k, v); } async delete(k: string) { this.m.delete(k); } async list({ prefix = '' } = {}) { return { keys: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } }
const env: any = { GG_KV: new KV(), OPENAI_API_KEY: 'test-not-a-key', PAIRING_CODE: 'galaxy-123', MONTH_CAP_USD: '5', DAILY_LIMIT: '3' };
const realFetch = globalThis.fetch;
let upstreamMode: 'ok' | 'fail' = 'ok';
let lastUpstreamBody: any = null;
globalThis.fetch = (async (url: any, init?: any) => {
  if (String(url).startsWith('https://api.openai.com/')) {
    lastUpstreamBody = JSON.parse(init.body);
    if (upstreamMode === 'fail') return new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 });
    return new Response(JSON.stringify({ output_text: 'Start Wilson. (stub reply)', usage: { input_tokens: 2000, output_tokens: 150 } }), { status: 200 });
  }
  return realFetch(url, init);
}) as any;
const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await handle(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers as any, body: req.method === 'GET' ? undefined : body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
});
let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void>) { try { await fn(); pass++; console.log('  ✓', name); } catch (e: any) { fail++; console.log('  ✗', name, '\n     ', e.message); } }
const code = async (p: Promise<any>) => { try { await p; return 'ok'; } catch (e: any) { return e.code; } };

server.listen(0, async () => {
  const base = `http://localhost:${(server.address() as any).port}`;
  ai._testAllowHttp();
  console.log('AI client vs real Worker');
  await t('rejects non-https URL', async () => assert.equal(await code(ai.testServer('http://example.com')), 'bad_url'));
  await t('GET / health check passes', async () => assert.equal(await ai.testServer(base + '/'), base));
  await t('not paired -> chat throws unpaired', async () => assert.equal(await code(ai.chat('budget', [{ role: 'user', content: 'hi' }], {})), 'unpaired'));
  await t('wrong pairing code -> bad_code with friendly text', async () => { try { await ai.pair(base, 'nope'); assert.fail(); } catch (e: any) { assert.equal(e.code, 'bad_code'); assert.match(e.message, /didn't match/); } });
  await t('pair stores token; isPaired true', async () => { await ai.pair(base, 'galaxy-123'); assert.equal(await ai.isPaired(), true); });
  await t('usage shape', async () => { const u = await ai.usage(); assert.equal(u.monthCapUsd, 5); assert.equal(u.dailyLimit, 3); assert.equal(u.dailyCount, 0); });
  await t('chat ok returns reply, cost, usage, model', async () => {
    const r = await ai.chat('budget', [{ role: 'user', content: 'Wilson or Pitts?' }], { league: { name: 'Moments Gang' } });
    assert.equal(r.reply, 'Start Wilson. (stub reply)'); assert.ok(r.costUsd > 0); assert.equal(r.dailyCount, 1); assert.equal(r.model, 'gpt-6-luna');
    assert.equal(lastUpstreamBody.model, 'gpt-6-luna'); assert.ok(!JSON.stringify(lastUpstreamBody).includes('gg_'), 'device token must not reach the model');
  });
  await t('better tier uses gpt-6.1-sol', async () => { const r = await ai.chat('better', [{ role: 'user', content: 'x' }], {}); assert.equal(r.model, 'gpt-6.1-sol'); });
  await t('upstream error -> upstream code + usage, slot released', async () => {
    upstreamMode = 'fail'; try { await ai.chat('budget', [{ role: 'user', content: 'x' }], {}); assert.fail(); } catch (e: any) { assert.equal(e.code, 'upstream'); assert.ok(e.usage); assert.equal(e.usage.dailyCount, 2); assert.match(e.message, /prepaid/); } upstreamMode = 'ok';
  });
  await t('daily limit -> daily_limit with usage', async () => {
    await ai.chat('budget', [{ role: 'user', content: 'x' }], {});
    try { await ai.chat('budget', [{ role: 'user', content: 'x' }], {}); assert.fail(); } catch (e: any) { assert.equal(e.code, 'daily_limit'); assert.equal(e.usage.dailyCount, 3); }
  });
  await t('monthly cap -> cap_reached', async () => {
    const month = [...env.GG_KV.m.keys()].find((k: string) => k.startsWith('spend:'));
    env.GG_KV.m.set(month, '5.01');
    try { await ai.chat('budget', [{ role: 'user', content: 'x' }], {}); assert.fail(); } catch (e: any) { assert.equal(e.code, 'cap_reached'); assert.ok(e.usage.monthSpendUsd >= 5); assert.match(e.message, /Rules chat still works/); }
  });
  await t('server forgot device -> local token cleared', async () => {
    const keys = [...env.GG_KV.m.keys()].filter((k: string) => k.startsWith('device:')); const saved = keys.map((k: string) => [k, env.GG_KV.m.get(k)]); keys.forEach((k: string) => env.GG_KV.m.delete(k));
    assert.equal(await code(ai.usage()), 'unpaired'); assert.equal(await ai.isPaired(), false);
    saved.forEach(([k, v]: any) => env.GG_KV.m.set(k, v)); await ai.pair(base, 'galaxy-123').catch(() => {});
  });
  await t('trimMessages keeps contract limits', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as any, content: 'x'.repeat(3000) }));
    const out = ai.trimMessages([...many, { role: 'user', content: 'last' }]);
    assert.ok(out.length <= 20); assert.equal(out[0].role, 'user'); assert.equal(out[out.length - 1].content, 'last'); assert.ok(out.reduce((s, m) => s + m.content.length, 0) <= 16000);
  });
  await t('unpair -> unpaired again', async () => { await ai.unpair(); assert.equal(await code(ai.usage()), 'unpaired'); });
  await t('device_limit after MAX_DEVICES', async () => { env.MAX_DEVICES = '1'; assert.equal(await code(ai.pair(base, 'galaxy-123')), 'device_limit'); });
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
