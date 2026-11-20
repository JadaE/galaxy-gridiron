// JC-109: bring trade chips back after a reinstall, the way picks already do.
// Reads typ:'tags' snapshots for this Sleeper user from the live family collection, newest snapshot
// per league as the base set, then merges with local state so the newest change wins per chip
// (a newer local clear is kept). Restored chips are not re-uploaded until the user edits them.
import { hasFamilyKey, setFamilyKey } from '../picks/sync';
import { validKey } from '../picks/family';
import { ChipState, loadChipState, saveChipState, validLeagueId } from './store';
import { QueuedTag, TagSnap, enqueueTags, fetchTagSnaps, flushTags, snapshotTags } from './sync';

export type Who = { uid: string; username: string; av?: string; display?: string };

export function snapsFor(snaps: TagSnap[], who: Who): TagSnap[] {
  const names = new Set([who.username, who.display].filter(Boolean).map(s => String(s).trim().toLowerCase()));
  return snaps.filter(s => s.uid === who.uid || names.has(s.un.trim().toLowerCase()));
}

/** Newest snapshot per league for this user. The snapshot is the complete chip set at createdAt. */
export function serverSets(snaps: TagSnap[], who: Who): Record<string, ChipState & { createdAt: number }> {
  const out: Record<string, ChipState & { createdAt: number }> = {};
  for (const s of [...snapsFor(snaps, who)].sort((a, b) => a.createdAt - b.createdAt)) {
    const at = { ...s.at };
    for (const id of Object.keys(s.tags)) if (!at[id]) at[id] = s.createdAt;
    out[s.league] = { tags: { ...s.tags }, at, ts: s.ts || s.createdAt, createdAt: s.createdAt };
  }
  return out;
}

/**
 * Newest wins per chip. The server snapshot is a complete set at createdAt: a chip the server
 * no longer has is treated as cleared at that time, unless a local edit is newer.
 */
export function mergeChips(local: ChipState, server: ChipState, serverAt: number): { state: ChipState; changed: number } {
  const ids = new Set([...Object.keys(local.tags), ...Object.keys(local.at), ...Object.keys(server.tags), ...Object.keys(server.at)]);
  const tags: ChipState['tags'] = {}, at: Record<string, number> = {};
  let changed = 0;
  for (const id of ids) {
    const lAt = local.at[id] || 0;
    const sHas = Object.prototype.hasOwnProperty.call(server.tags, id);
    const sAt = server.at[id] || (sHas || Object.keys(server.tags).length || Object.keys(server.at).length ? serverAt : 0);
    // If the server set is newer than this local chip and the id is absent, it's a clear.
    const serverTag = sHas ? server.tags[id] : undefined;
    const useLocal = lAt >= sAt && lAt > 0;
    if (useLocal) {
      if (local.tags[id]) tags[id] = local.tags[id];
      at[id] = lAt;
    } else if (sAt > 0) {
      if (serverTag) tags[id] = serverTag;
      at[id] = sAt;
      const was = local.tags[id];
      if (was !== tags[id]) changed++;
    }
  }
  const ts = Math.max(local.ts || 0, server.ts || serverAt || 0);
  return { state: { tags, at, ts }, changed };
}

export type RestoreResult = { status: 'restored'; n: number } | { status: 'none' } | { status: 'locked' } | { status: 'offline' };

export async function restoreTagsFromServer(who: Who, fetcher: typeof fetch = fetch, leagues?: string[]): Promise<RestoreResult> {
  if (!hasFamilyKey()) return { status: 'locked' };
  let snaps: TagSnap[];
  try { snaps = await fetchTagSnaps(fetcher); } catch { return { status: 'offline' }; }
  const sets = serverSets(snaps, who);
  const lids = new Set([...Object.keys(sets), ...(leagues || [])].filter(validLeagueId));
  let n = 0;
  for (const lid of lids) {
    const server = sets[lid];
    const local = await loadChipState(lid);
    if (!server) continue;
    const r = mergeChips(local, server, server.createdAt);
    if (!r.changed) continue;
    await saveChipState(lid, r.state);
    n += r.changed;
  }
  return n ? { status: 'restored', n } : { status: 'none' };
}

export async function restoreTagsOnStart(who: Who, getKey: () => Promise<string | null>, fetcher?: typeof fetch, leagues?: string[]): Promise<RestoreResult> {
  if (!hasFamilyKey()) { try { const k = JSON.parse((await getKey()) || 'null'); if (validKey(k)) setFamilyKey(k); } catch {} }
  return restoreTagsFromServer(who, fetcher, leagues);
}

/** Persist a chip edit locally and queue a snapshot. Flush separately so the UI stays snappy. */
export async function saveAndQueueTag(leagueId: string, who: Who, local: ChipState): Promise<void> {
  await saveChipState(leagueId, local);
  if (!hasFamilyKey() || !validLeagueId(leagueId)) return;
  await enqueueTags(snapshotTags({ uid: who.uid, un: who.username, av: who.av }, leagueId, local));
}

export async function uploadLocalTags(who: Who, leagueId: string, fetcher?: typeof fetch): Promise<void> {
  if (!hasFamilyKey() || !validLeagueId(leagueId)) return;
  const local = await loadChipState(leagueId);
  if (!local.ts && !Object.keys(local.tags).length) return;
  await enqueueTags(snapshotTags({ uid: who.uid, un: who.username, av: who.av }, leagueId, local));
  await flushTags(fetcher);
}

export function restoreTagsMessage(r: RestoreResult): string {
  if (r.status === 'restored') return `Restored ${r.n} trade chip${r.n === 1 ? '' : 's'} from the leaderboard`;
  return '';
}

export type { QueuedTag };
