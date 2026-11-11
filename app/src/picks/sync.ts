// Shared leaderboard store: here.now Site Data on the app's own download site, reached ONLY through the AI Worker
// (JC-34, v0.0.15). The Worker checks the family password (rate-limited + lockout), hands out an `lb_` token, binds it to
// one Sleeper user id, writes snapshots as that user only, and hides other people's picks until each game's kickoff.
//  * Records are insert-only snapshots of one person's picks for one week.
//  * Kickoff locks use the SERVER's createdAt timestamp: for each game we take that person's newest snapshot
//    created before kickoff. Snapshots that arrive after kickoff don't change an on-time pick; picks that only
//    arrive after kickoff are tagged ✱ backfilled and only count when "Include backfilled" is on.
//  * Archive records (picks copied from the old shared collection) come back with their original server time.
import { saveSetting, loadSetting } from '../api';
import { SITE_ORIGIN, LEADERBOARD_API } from '../config';
import { Game, Pick, PickMap } from './core';
import { validToken } from './family';

export const SITE = SITE_ORIGIN;
const APP = 'gg';
let tok: string | null = null, joinedAs: string | null = null;
let api = LEADERBOARD_API;
/** tests only */
export function setLbApi(u: string) { api = u; }
/** Set (or clear) the leaderboard token. Clears the in-memory cache. */
export function setLbToken(t: string | null) { tok = validToken(t) ? t : null; joinedAs = null; memo = null; }
export const hasLbToken = () => !!tok;
export const lbConfigured = () => !/your[-_]/i.test(api) && (/^https:\/\/[^/]+$/.test(api) || /^http:\/\/localhost(:\d+)?$/.test(api));
const auth = () => ({ Accept: 'application/json', Authorization: 'Bearer ' + tok });

export type Unlock = { status: 'ok'; token: string } | { status: 'wrong' | 'locked' | 'offline' | 'not_setup' };
/** One server-side password check. The server limits tries (per phone network and for everyone) and locks out. */
export async function unlockLeaderboard(password: string, fetcher: typeof fetch = fetch): Promise<Unlock> {
  if (!lbConfigured()) return { status: 'not_setup' };
  try {
    const r = await fetcher(`${api}/lb/unlock`, { method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ password: password.trim() }) });
    if (r.ok) { const j: any = await r.json(); return validToken(j?.token) ? { status: 'ok', token: j.token } : { status: 'offline' }; }
    return r.status === 403 ? { status: 'wrong' } : r.status === 429 ? { status: 'locked' } : r.status === 503 ? { status: 'not_setup' } : { status: 'offline' };
  } catch { return { status: 'offline' }; }
}
export type Join = 'ok' | 'denied' | 'busy' | 'offline';
/** Bind this phone's token to the user's Sleeper user id (once; the server refuses a different id later).
 * 'denied' = the server refused the id (a real "not linked"); 'busy' (429) and 'offline' (network error, 5xx such as
 * 502/503) are temporary, so callers keep the queued snapshot and retry later. */
export async function joinLeaderboard(me: { uid: string; un: string }, fetcher: typeof fetch = fetch): Promise<Join> {
  if (!tok) return 'denied';
  if (joinedAs === me.uid) return 'ok';
  let r: Response;
  try { r = await fetcher(`${api}/lb/join`, { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ uid: me.uid, un: me.un }) }); }
  catch { return 'offline'; }
  if (r.ok) { joinedAs = me.uid; return 'ok'; }
  return r.status === 429 ? 'busy' : r.status >= 500 ? 'offline' : 'denied';
}

export type Snap = { id: string; uid: string; un: string; av?: string; season: number; week: number; picks: Record<string, string>; bf: Record<string, number>; ts: number; createdAt: number };
type Queued = { uid: string; un: string; av?: string; season: number; week: number; picks: Record<string, string>; bf: Record<string, number>; ts: number; key: string };

// storage is injectable so the queue can be tested in Node
let kv = { get: loadSetting, set: saveSetting };
export function setKv(get: (k: string) => Promise<string | null>, set: (k: string, v: string) => Promise<void>) { kv = { get, set }; }
const ABBR = /^[A-Z]{2,3}$/;
/** Records from GET /lb/snaps are already cleaned by the Worker; checked again here (never trust the wire). */
function clean(d: any): Snap | null {
  const at = Number(d?.createdAt);
  if (!d || !Number.isFinite(at) || typeof d.uid !== 'string' || !/^\d{1,24}$/.test(d.uid) || typeof d.un !== 'string' || d.un.startsWith('_')) return null;
  const picks: Record<string, string> = {}, bf: Record<string, number> = {};
  for (const [g, t] of Object.entries<any>(d.picks || {})) if (/^\d{4,12}$/.test(g) && typeof t === 'string' && ABBR.test(t)) picks[g] = t;
  for (const g of Object.keys(d.bf || {})) if (picks[g]) bf[g] = 1;
  return { id: String(d.id), uid: d.uid, un: d.un.slice(0, 40), av: typeof d.av === 'string' && /^[a-z0-9]{1,64}$/i.test(d.av) ? d.av : undefined, season: Number(d.season), week: Number(d.week), picks, bf, ts: Number(d.ts) || 0, createdAt: at };
}

/** Read every snapshot for the season (paged). Cached ~90 s; offline falls back to the last copy. */
let memo: { at: number; season: number; snaps: Snap[] } | null = null;
export async function fetchSnaps(season: number, force = false, fetcher: typeof fetch = fetch): Promise<{ snaps: Snap[]; stale: boolean }> {
  if (!force && memo && memo.season === season && Date.now() - memo.at < 90_000) return { snaps: memo.snaps, stale: false };
  if (!tok) throw new Error('locked');
  try {
    const out: Snap[] = [];
    const r = await fetcher(`${api}/lb/snaps?season=${encodeURIComponent(String(season))}`, { method: 'GET', headers: auth() });
    if (r.status === 401) { tok = null; throw new Error('locked'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j: any = await r.json();
    for (const x of j.records || []) { const s = clean(x); if (s && s.season === season) out.push(s); }
    memo = { at: Date.now(), season, snaps: out };
    kv.set('lb:cache:' + season, JSON.stringify(out));
    return { snaps: out, stale: false };
  } catch (e) {
    try { const c = JSON.parse((await kv.get('lb:cache:' + season)) || 'null'); if (c) return { snaps: c, stale: true }; } catch {}
    throw e;
  }
}

/** Snapshot of one week of this phone's local picks. */
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
  if (flushing || !tok) return { sent: 0, left: (await getQueue()).length };
  flushing = true;
  let sent = 0, error: string | undefined;
  try {
    let q = await getQueue();
    while (q.length) {
      const s = q[0];
      let r: Response;
      try {
        const j = await joinLeaderboard({ uid: s.uid, un: s.un }, fetcher);
        // busy/offline: keep the queued snapshot (break before it is removed) and say so; only a real refusal is "not linked"
        if (j === 'busy') { error = 'busy (rate limited), will retry'; break; }
        if (j === 'offline') { error = 'offline'; break; }
        if (j !== 'ok') { error = 'not linked to this Sleeper account'; break; }
        r = await fetcher(`${api}/lb/snap`, { method: 'POST', headers: { ...auth(), 'content-type': 'application/json', 'Idempotency-Key': s.key }, body: JSON.stringify({ uid: s.uid, un: s.un, av: s.av || undefined, season: s.season, week: s.week, picks: s.picks, bf: s.bf, ts: s.ts, key: s.key, app: APP }) });
      } catch (e: any) { error = 'offline'; break; }
      if (r.status === 429) { error = 'busy (rate limited), will retry'; break; }
      if (!r.ok && r.status >= 500) { error = 'offline (server ' + r.status + '), will retry'; break; }
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
/** For each person and game: newest snapshot created before kickoff wins. With no on-time pick, the newest pick
 * that arrived after kickoff (flagged backfill or not) is tagged src 'backfill'. */
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
        // on time: this snapshot is the user's full set for the week, so a missing game means it was cleared
        if (team) picks[g.id] = { team, week: g.week, at: s.createdAt, src: 'live' }; else if (picks[g.id]?.src === 'live') delete picks[g.id];
        continue;
      }
      if (!team) continue;
      // after kickoff: an on-time pick never changes (a different team only counts as "late"). With no on-time pick,
      // the late pick counts as ✱ backfilled, whether it was flagged or just saved on the phone and shared late
      // (v0.0.14 hotfix: before, unflagged late picks vanished from the board and the record entirely).
      if (picks[g.id]?.src === 'live') { if (picks[g.id].team !== team) lateSeen.add(g.id); continue; }
      picks[g.id] = { team, week: g.week, at: s.createdAt, src: 'backfill' };
    }
    return { uid, un: last.un, av: last.av, picks, late: lateSeen.size };
  });
}
