// Local cost ledger for the opencode-style counter: cost per chat (persisted) + last known month usage from the Worker.
import { saveSetting, loadSetting } from '../api';
import type { Usage, Tier } from './client';

export type ChatCost = { cost: number; n: number; startedAt: number };
export type UsageSnap = Usage & { at: number; month: string };
const monthKey = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).slice(0, 7);
export const monthLabel = () => new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short' });

export async function loadTier(): Promise<Tier> { const t = await loadSetting('ai:tier'); return t === 'budget' || t === 'better' ? t : 'rules'; }
export async function saveTier(t: Tier) { await saveSetting('ai:tier', t); }

async function chats(): Promise<Record<string, ChatCost>> { try { return JSON.parse((await loadSetting('ai:chats')) || '{}'); } catch { return {}; } }
export async function currentChat(): Promise<{ id: string; cost: ChatCost }> {
  let id = await loadSetting('ai:curChat');
  if (!id) { id = 'c' + Date.now(); await saveSetting('ai:curChat', id); }
  const all = await chats();
  return { id, cost: all[id] || { cost: 0, n: 0, startedAt: Date.now() } };
}
export async function newChat(): Promise<string> { const id = 'c' + Date.now(); await saveSetting('ai:curChat', id); return id; }
export async function addCost(id: string, usd: number): Promise<ChatCost> {
  const all = await chats();
  const c = all[id] || { cost: 0, n: 0, startedAt: Date.now() };
  c.cost = Math.round((c.cost + usd) * 1e6) / 1e6; c.n++;
  all[id] = c;
  const keep = Object.entries(all).sort((a, b) => b[1].startedAt - a[1].startedAt).slice(0, 40);
  await saveSetting('ai:chats', JSON.stringify(Object.fromEntries(keep)));
  return c;
}
export async function saveUsage(u: Usage) { await saveSetting('ai:usage', JSON.stringify({ ...u, at: Date.now(), month: monthKey() })); }
export async function loadUsage(): Promise<UsageSnap | null> {
  try { const u: UsageSnap = JSON.parse((await loadSetting('ai:usage')) || 'null'); if (!u) return null; return u.month === monthKey() ? u : { ...u, monthSpendUsd: 0, dailyCount: 0, month: monthKey() }; } catch { return null; }
}
export const money = (n: number) => (n > 0 && n < 0.01 ? '$' + n.toFixed(4).replace(/0+$/, '') : '$' + n.toFixed(2));
