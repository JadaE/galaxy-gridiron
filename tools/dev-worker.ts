// DEV ONLY: runs the real Worker code locally (in-memory KV, stubbed model upstream, CORS for the web preview)
// so screenshots and the web build can exercise pairing + the cost counter. Never deployed; no real keys.
import http from 'node:http';
import { handle } from '../worker/src/index';
class KV { m = new Map<string, string>(); async get(k: string) { return this.m.get(k) ?? null; } async put(k: string, v: string) { this.m.set(k, v); } async delete(k: string) { this.m.delete(k); } async list({ prefix = '' } = {}) { return { keys: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } }
const env: any = { GG_KV: new KV(), OPENAI_API_KEY: 'dev-stub', PAIRING_CODE: process.env.DEV_CODE || 'dev-pair-code', MONTH_CAP_USD: '10', DAILY_LIMIT: '30' };
const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
env.GG_KV.m.set(`spend:${d}`, '0.31');
const rf = globalThis.fetch;
globalThis.fetch = (async (u: any, i?: any) => String(u).startsWith('https://api.openai.com/')
  ? new Response(JSON.stringify({ output_text: "(Test reply from a local copy of your AI server — not a real AI answer. Once your Worker is set up, Budget AI answers here using the same league data and fit %.)", usage: { input_tokens: 2600, output_tokens: 180 } }), { status: 200 })
  : rf(u, i)) as any;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,accept', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const ch: Buffer[] = []; for await (const c of req) ch.push(c as Buffer);
  const r = await handle(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers as any, body: req.method === 'GET' ? undefined : Buffer.concat(ch) }), env);
  res.writeHead(r.status, { ...Object.fromEntries(r.headers), ...cors }); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log('dev worker on http://localhost:8787'));
