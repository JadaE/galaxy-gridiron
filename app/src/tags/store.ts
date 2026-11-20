// JC-109: local trade-chip (🔒 / 💎) storage. The UI still sees a flat tag map;
// this wrapper adds per-chip timestamps so a restore can merge "newest wins".
import { loadSetting, saveSetting } from '../api';

export type Chip = 'never' | 'high';
export type ChipState = { tags: Record<string, Chip>; at: Record<string, number>; ts: number };

let kv = { get: loadSetting, set: saveSetting };
export function setTagKv(get: (k: string) => Promise<string | null>, set: (k: string, v: string) => Promise<void>) { kv = { get, set }; }
export const tagKv = { get: (k: string) => kv.get(k), set: (k: string, v: string) => kv.set(k, v) };

const CHIP = new Set<Chip>(['never', 'high']);
const ID = /^[A-Za-z0-9_.-]{1,32}$/;
const LEAGUE = /^\d{1,24}$/;

export function validChipId(id: string): boolean { return ID.test(id); }
export function validLeagueId(id: string): boolean { return LEAGUE.test(id); }

function onlyChips(x: any): Record<string, Chip> {
  const out: Record<string, Chip> = {};
  if (!x || typeof x !== 'object') return out;
  for (const [id, t] of Object.entries(x)) if (validChipId(id) && CHIP.has(t as Chip)) out[id] = t as Chip;
  return out;
}
function onlyTimes(x: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!x || typeof x !== 'object') return out;
  for (const [id, n] of Object.entries(x)) if (validChipId(id) && Number.isFinite(n) && (n as number) > 0) out[id] = Number(n);
  return out;
}

export function parseChipState(raw: string | null): ChipState {
  if (!raw) return { tags: {}, at: {}, ts: 0 };
  try {
    const v = JSON.parse(raw);
    if (v && v.v === 1 && v.tags && typeof v.tags === 'object') {
      const tags = onlyChips(v.tags), at = onlyTimes(v.at);
      return { tags, at, ts: Number(v.ts) > 0 ? Number(v.ts) : 0 };
    }
    if (v && typeof v === 'object' && v.v == null) return { tags: onlyChips(v), at: {}, ts: 0 };
  } catch {}
  return { tags: {}, at: {}, ts: 0 };
}

export function serializeChipState(s: ChipState): string {
  return JSON.stringify({ v: 1, tags: s.tags, at: s.at, ts: s.ts || 0 });
}

export const tagsKey = (leagueId: string) => 'tags:' + leagueId;

export async function loadChipState(leagueId: string): Promise<ChipState> {
  if (!validLeagueId(leagueId)) return { tags: {}, at: {}, ts: 0 };
  return parseChipState(await kv.get(tagsKey(leagueId)));
}

export async function saveChipState(leagueId: string, s: ChipState): Promise<void> {
  if (!validLeagueId(leagueId)) return;
  await kv.set(tagsKey(leagueId), serializeChipState(s));
}

/** Apply one chip change (or a clear) and stamp it so a later server snapshot cannot overwrite a newer local edit. */
export function applyChip(s: ChipState, id: string, tag: Chip | null, now = Date.now()): ChipState {
  if (!validChipId(id)) return s;
  const tags = { ...s.tags }, at = { ...s.at, [id]: now };
  if (tag) tags[id] = tag; else delete tags[id];
  return { tags, at, ts: now };
}

/** Stable fingerprint of the chip set (tags + per-chip times). Used to skip a no-op login upload. */
export function chipSignature(s: ChipState): string {
  const tags = Object.keys(s.tags).sort().map(id => [id, s.tags[id]]);
  const at = Object.keys(s.at).sort().map(id => [id, s.at[id]]);
  return JSON.stringify({ tags, at });
}

export function uploadedKey(uid: string, leagueId: string): string { return `tags:sent:${uid}:${leagueId}`; }

export async function readUploadedSignature(uid: string, leagueId: string): Promise<string | null> {
  return kv.get(uploadedKey(uid, leagueId));
}

export async function markUploaded(uid: string, leagueId: string, s: ChipState): Promise<void> {
  if (!validLeagueId(leagueId)) return;
  await kv.set(uploadedKey(uid, leagueId), chipSignature(s));
}

export async function alreadyUploaded(uid: string, leagueId: string, s: ChipState): Promise<boolean> {
  const prev = await readUploadedSignature(uid, leagueId);
  return !!prev && prev === chipSignature(s);
}
