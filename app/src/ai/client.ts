// Client for the owner's own Cloudflare Worker AI proxy (worker/CONTRACT.md). The app never talks to an AI provider
// directly and holds no provider key. It stores only the Worker URL and a per-device token (secure store).
// The device token is never logged, displayed, or put in chat context.
// Pure TS (no React Native imports) so it can be tested in Node against the real Worker code; secure.ts installs
// the device storage (expo-secure-store) at startup via configureAi().
type Store = { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void>; del: (k: string) => Promise<void> };
const memStore: Record<string, string> = {};
let store: Store = { get: async k => memStore[k] ?? null, set: async (k, v) => { memStore[k] = v; }, del: async k => { delete memStore[k]; } };
let deviceName = 'Galaxy Gridiron';
export function configureAi(s: Store, name: string) { store = s; deviceName = name; }
const getSecret = (k: string) => store.get(k).catch(() => null), setSecret = (k: string, v: string) => store.set(k, v), delSecret = (k: string) => store.del(k).catch(() => {});

export type Tier = 'rules' | 'budget' | 'better';
export type Usage = { monthSpendUsd: number; monthCapUsd: number; dailyCount: number; dailyLimit: number };
export type ChatMsg = { role: 'user' | 'assistant'; content: string };
export type ChatOk = Usage & { reply: string; costUsd: number; model?: string };
export const TIER_LABEL: Record<Tier, string> = { rules: 'Rules', budget: 'Budget AI', better: 'Better AI' };
export const TIER_MODEL: Record<'budget' | 'better', string> = { budget: 'gpt-6-luna', better: 'gpt-6.1-sol' };

const K_BASE = 'gg_ai_base', K_TOKEN = 'gg_ai_token';
const DEV = typeof __DEV__ !== 'undefined' && __DEV__;
let allowHttpLocal = DEV;
export const _testAllowHttp = () => { allowHttpLocal = true; };

export class AiError extends Error {
  constructor(public code: string, message: string, public usage?: Usage) { super(message); }
}

const FRIENDLY: Record<string, string> = {
  bad_code: "That pairing code didn't match. Check it and try again.",
  rate_limited: 'Too many wrong codes. Wait an hour, then try again.',
  device_limit: 'This AI server already has the most phones it allows. Unpair an old one on the server, or raise MAX_DEVICES.',
  not_configured: "The AI server isn't fully set up yet (missing pairing code or AI key).",
  unpaired: 'This phone isn\u2019t paired anymore. Open Settings \u203a AI and pair again.',
  upstream: 'The AI provider had a problem. Nothing was charged.',
  bad_request: 'The app sent something the server didn\u2019t accept.',
  network: "Couldn't reach your AI server. Check the connection or the URL.",
  timeout: 'The AI server took too long to answer.',
  bad_url: 'That URL doesn\u2019t look right. It should start with https://',
  not_ai_server: "That address answered, but it isn't the Galaxy Gridiron AI server.",
};
export const friendly = (code: string, msg?: string) => (['cap_reached', 'daily_limit', 'upstream', 'bad_request'].includes(code) && msg ? msg : FRIENDLY[code] || msg || 'Something went wrong.');

/** Trim, drop trailing slashes; HTTPS only (plain http allowed for localhost in dev builds). */
export function normalizeBase(raw: string): string {
  let u = (raw || '').trim().replace(/\/+$/, '');
  if (u && !/^[a-z]+:\/\//i.test(u)) u = 'https://' + u;
  const ok = /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w\-./]*)?$/i.test(u) || (allowHttpLocal && /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/i.test(u));
  if (!ok) throw new AiError('bad_url', FRIENDLY.bad_url);
  return u;
}

const usageOf = (j: any): Usage | undefined =>
  j && typeof j.monthSpendUsd === 'number' ? { monthSpendUsd: j.monthSpendUsd, monthCapUsd: Number(j.monthCapUsd) || 0, dailyCount: Number(j.dailyCount) || 0, dailyLimit: Number(j.dailyLimit) || 0 } : undefined;

async function call(url: string, init: RequestInit, timeoutMs = 60000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let r: Response;
  try { r = await fetch(url, { ...init, signal: ctl.signal }); }
  catch (e: any) { throw new AiError(ctl.signal.aborted ? 'timeout' : 'network', FRIENDLY[ctl.signal.aborted ? 'timeout' : 'network']); }
  finally { clearTimeout(t); }
  let j: any = null;
  try { j = await r.json(); } catch {}
  if (!r.ok || (j && j.error)) {
    const code = (j && typeof j.error === 'string' && j.error) || (r.status === 401 ? 'unpaired' : r.status >= 500 ? 'upstream' : 'bad_request');
    throw new AiError(code, friendly(code, j?.message), usageOf(j));
  }
  if (!j) throw new AiError('upstream', 'The AI server sent an unreadable answer.');
  return j;
}

export async function getBase() { return getSecret(K_BASE); }
export async function isPaired() { return !!(await getSecret(K_TOKEN)) && !!(await getSecret(K_BASE)); }

/** GET {base}/ health check, used to test the URL she types. */
export async function testServer(raw: string): Promise<string> {
  const base = normalizeBase(raw);
  const j = await call(base + '/', { method: 'GET', headers: { Accept: 'application/json' } }, 15000);
  if (!j?.ok) throw new AiError('not_ai_server', FRIENDLY.not_ai_server);
  return base;
}

export async function pair(raw: string, code: string): Promise<void> {
  const base = await testServer(raw);
  const j = await call(base + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ code: code.trim(), deviceName }) }, 20000);
  if (typeof j.deviceToken !== 'string' || !j.deviceToken) throw new AiError('upstream', 'Pairing failed: no device token came back.');
  await setSecret(K_BASE, base);
  await setSecret(K_TOKEN, j.deviceToken);
}

export async function unpair() { await delSecret(K_TOKEN); }

/** Server no longer knows this phone's token: forget it locally so the app shows "Set up AI" again. */
async function withAuth<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e: any) { if (e?.code === 'unpaired') await unpair(); throw e; }
}
async function authed(): Promise<{ base: string; token: string }> {
  const [base, token] = await Promise.all([getSecret(K_BASE), getSecret(K_TOKEN)]);
  if (!base || !token) throw new AiError('unpaired', FRIENDLY.unpaired);
  return { base, token };
}

export async function usage(): Promise<Usage> { return withAuth(usage_); }
async function usage_(): Promise<Usage> {
  const { base, token } = await authed();
  const j = await call(base + '/usage', { method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }, 15000);
  const u = usageOf(j);
  if (!u) throw new AiError('upstream', 'The AI server sent unreadable usage.');
  return u;
}

/** Contract limits: ≤20 messages, each ≤4000 chars, ≤16000 total, last one from the user. */
export function trimMessages(msgs: ChatMsg[]): ChatMsg[] {
  let out = msgs.filter(m => m.content && m.content.trim()).map(m => ({ role: m.role, content: m.content.trim().slice(0, 1500) }));
  out = out.slice(-12);
  while (out.length > 1 && out.reduce((s, m) => s + m.content.length, 0) > 12000) out.shift();
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export async function chat(tier: 'budget' | 'better', messages: ChatMsg[], context: object): Promise<ChatOk> { return withAuth(() => chat_(tier, messages, context)); }
async function chat_(tier: 'budget' | 'better', messages: ChatMsg[], context: object): Promise<ChatOk> {
  const { base, token } = await authed();
  const msgs = trimMessages(messages);
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new AiError('bad_request', 'Nothing to ask.');
  const j = await call(base + '/chat', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ tier, messages: msgs, context }) });
  if (typeof j.reply !== 'string') throw new AiError('upstream', 'The AI server sent an unreadable answer.');
  return { reply: j.reply, costUsd: Number(j.costUsd) || 0, model: j.model, ...(usageOf(j) as Usage) };
}
