// Shared leaderboard store: here.now Site Data on the app's own download site, in a collection with an
// unguessable name. Honor system, no logins, no keys in the app.
//  * Anyone with the collection URL can read it, so hiding other people's picks until kickoff is done
//    in the app (client-side), not by the server.
//  * The collection is insert-only for the public: records can't be edited or deleted by anyone but the
//    site owner. Each write is a snapshot of one person's picks for one week.
//  * Kickoff locks use the SERVER's createdAt timestamp: for each game we take that person's newest snapshot
//    created before kickoff. Snapshots that arrive after kickoff don't change a pick (backfilled picks are
//    flagged and only count when "Include backfilled" is on).
import { saveSetting, loadSetting } from '../api';
import { Game, Pick, PickMap } from './core';

export const SITE = 'https://YOUR-SITE-SLUG.here.now';
export const COLLECTION = 'YOUR_COLLECTION_ID';
const BASE = `${SITE}/.herenow/data/${COLLECTION}`;
const APP = 'gg';

export type Snap = { id: string; uid: string; un: string; av?: string; season: number; week: number; picks: Record<string, string>; bf: Record<string, number>; ts: number; createdAt: number };
type Queued = { uid: string; un: string; av?: string; season: number; week: number; picks: Record<string, string>; bf: Record<string, number>; ts: number; key: string };

// storage is injectable so the queue can be tested in Node
let kv = { get: loadSetting, set: saveSetting };
export function setKv(get: (k: string) => Promise<string | null>, set: (k: string, v: string) => Promise<void>) { kv = { get, set }; }
const ABBR = /^[A-Z]{2,3}$/;
function clean(r: any): Snap | null {
  const d = r?.data, at = Date.parse(r?.createdAt);
  if (!d || !Number.isFinite(at) || d.app !== APP || typeof d.uid !== 'string' || !/^\d{1,24}$/.test(d.uid) || typeof d.un !== 'string' || d.un.startsWith('_')) return null;
  const picks: Record<string, string> = {}, bf: Record<string, number> = {};
  for (const [g, t] of Object.entries<any>(d.picks || {})) if (/^\d{4,12}$/.test(g) && typeof t === 'string' && ABBR.test(t)) picks[g] = t;
  for (const g of Object.keys(d.bf || {})) if (picks[g]) bf[g] = 1;
  return { id: String(r.id), uid: d.uid, un: d.un.slice(0, 40), av: typeof d.av === 'string' && /^[a-z0-9]{1,64}$/i.test(d.av) ? d.av : undefined, season: Number(d.season), week: Number(d.week), picks, bf, ts: Number(d.ts) || 0, createdAt: at };
}

/** Read every snapshot for the season (paged). Cached ~90 s; offline falls back to the last copy. */
let memo: { at: number; season: number; snaps: Snap[] } | null = null;
export async function fetchSnaps(season: number, force = false, fetcher: typeof fetch = fetch): Promise<{ snaps: Snap[]; stale: boolean }> {
  if (!force && memo && memo.season === season && Date.now() - memo.at < 90_000) return { snaps: memo.snaps, stale: false };
  try {
    const out: Snap[] = [];
    let cursor: string | null = null, pages = 0;
    do {
      const r = await fetcher(`${BASE}?limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j: any = await r.json();
      for (const x of j.records || []) { const s = clean(x); if (s && s.season === season) out.push(s); }
      cursor = j.nextCursor || null;
    } while (cursor && ++pages < 60);
    memo = { at: Date.now(), season, snaps: out };
    kv.set('lb:cache:' + season, JSON.stringify(out));
    return { snaps: out, stale: false };
  } catch (e) {
    try { const c = JSON.parse((await kv.get('lb:cache:' + season)) || 'null'); if (c) return { snaps: c, stale: true }; } catch {}
    throw e;
  }
}

/** Snapshot of one week of her local picks. */
export function snapshotFor(me: { uid: string; un: string; av?: string }, season: number, week: number, picks: PickMap): Queued {
  const p: Record<string, string> = {}, bf: Record<string, number> = {};
  for (const [g, x] of Object.entries(picks)) if (x.week === week) { p[g] = x.team; if (x.src === 'backfill' || x.src === 'paste' || x.src === 'import') bf[g] = 1; }
  return { uid: me.uid, un: me.un, av: me.av, season, week, picks: p, bf, ts: Date.now(), key: `${me.uid}-${season}-${week}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
}

// ---- offline queue: newest snapshot per user+week, retried until it's accepted ----
async function getQueue(): Promise<Queued[]> { try { return JSON.parse((await kv.get('lb:queue')) || '[]'); } catch { return []; } }
async function setQueue(q: Queued[]) { await kv.set('lb:queue', JSON.stringify(q)); }
export async function enqueue(s: Queued) {
  const q = (await getQueue()).filter(x => !(x.uid === s.uid && x.season === s.season && x.week === s.week));
  q.push(s); await setQueue(q);
}
export async function pendingCount() { return (await getQueue()).length; }
let flushing = false;
/** Send queued snapshots. Stops at the first network/rate-limit failure and keeps the rest for later. */
export async function flush(fetcher: typeof fetch = fetch): Promise<{ sent: number; left: number; error?: string }> {
  if (flushing) return { sent: 0, left: (await getQueue()).length };
  flushing = true;
  let sent = 0, error: string | undefined;
  try {
    let q = await getQueue();
    while (q.length) {
      const s = q[0];
      let r: Response;
      try {
        r = await fetcher(BASE, { method: 'POST', headers: { 'content-type': 'application/json', Origin: SITE, 'Idempotency-Key': s.key }, body: JSON.stringify({ uid: s.uid, un: s.un, av: s.av || undefined, season: s.season, week: s.week, picks: s.picks, bf: s.bf, ts: s.ts, app: APP }) });
      } catch (e: any) { error = 'offline'; break; }
      if (r.status === 429) { error = 'busy (rate limited), will retry'; break; }
      if (!r.ok && r.status >= 500) { error = 'server error ' + r.status; break; }
      // 4xx other than 429: the snapshot itself is bad; drop it so it can't block the queue
      if (!r.ok) error = 'rejected ' + r.status;
      else { sent++; if (memo) memo.at = 0; }
      q = (await getQueue()).filter(x => x.key !== s.key);
      await setQueue(q);
    }
    return { sent, left: q.length, error };
  } finally { flushing = false; }
}

// ---- resolving picks per person ----
export type Person = { uid: string; un: string; av?: string; picks: PickMap; late: number; sample?: boolean };
/** For each person and game: newest snapshot created before kickoff wins. Backfilled entries (made after the
 * game) come from the newest snapshot that has them flagged and are tagged src 'backfill'. */
export function resolve(snaps: Snap[], games: Record<string, Game>): Person[] {
  const byUser: Record<string, Snap[]> = {}, wk: Record<number, Game[]> = {};
  for (const s of snaps) (byUser[s.uid] = byUser[s.uid] || []).push(s);
  for (const g of Object.values(games)) (wk[g.week] = wk[g.week] || []).push(g);
  return Object.entries(byUser).map(([uid, list]) => {
    list.sort((a, b) => a.createdAt - b.createdAt);
    const last = list[list.length - 1];
    const picks: PickMap = {};
    const lateSeen = new Set<string>();
    for (const s of list) for (const g of wk[s.week] || []) {
      const team = s.picks[g.id];
      if (team && team !== g.home.abbr && team !== g.away.abbr) continue;
      if (s.createdAt < g.kickoff) {
        // on time: this snapshot is her full set for the week, so a missing game means she cleared it
        if (team) picks[g.id] = { team, week: g.week, at: s.createdAt, src: 'live' }; else if (picks[g.id]?.src === 'live') delete picks[g.id];
        continue;
      }
      if (!team) continue;
      if (s.bf[g.id]) { if (picks[g.id]?.src !== 'live') picks[g.id] = { team, week: g.week, at: s.createdAt, src: 'backfill' }; continue; }
      if (picks[g.id]?.team !== team) lateSeen.add(g.id);
    }
    return { uid, un: last.un, av: last.av, picks, late: lateSeen.size };
  });
}
