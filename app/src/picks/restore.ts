// v0.0.13: bring your own shared picks back from the leaderboard after a reinstall (no export/import needed).
// Reads BOTH family collections (live + archive, paged) through fetchSnaps, keeps only this Sleeper user's
// snapshots, resolves them with the same kickoff-lock rules as the board (archive `oc` times only), and merges them
// into the phone's picks: union by game, a newer local pick is never overwritten, re-running adds nothing.
// Restored picks are flagged `rs` so they're never re-shared as new snapshots. Read-only: nothing is written to the site.
import { Game, Pick, PickMap } from './core';
import { fetchSnaps, hasFamilyKey, resolve, setFamilyKey, Snap } from './sync';

export type Who = { uid: string; username: string; display?: string };

/** This user's snapshots only: same Sleeper user id, or the same name (case-insensitive). */
export function snapsFor(snaps: Snap[], who: Who): Snap[] {
  const names = new Set([who.username, who.display].filter(Boolean).map(s => String(s).trim().toLowerCase()));
  return snaps.filter(s => s.uid === who.uid || names.has(s.un.trim().toLowerCase()));
}

/** Her picks as the server has them. With games: kickoff-locked like the board. Without: newest snapshot per game. */
export function serverPicks(snaps: Snap[], who: Who, games?: Record<string, Game>): PickMap {
  const mine = snapsFor(snaps, who).map(s => ({ ...s, uid: '_me' }));
  if (!mine.length) return {};
  if (games && Object.keys(games).length) return resolve(mine, games)[0]?.picks || {};
  const out: PickMap = {};
  for (const s of [...mine].sort((a, b) => a.createdAt - b.createdAt)) for (const [g, team] of Object.entries(s.picks)) out[g] = { team, week: s.week, at: s.createdAt, src: s.bf[g] ? 'backfill' : 'live' };
  return out;
}

/** Union by game. Local wins unless the server copy is strictly newer. Returns how many picks changed. */
export function mergeRestored(local: PickMap, server: PickMap): { picks: PickMap; restored: number } {
  const out: PickMap = { ...local }; let restored = 0;
  for (const [g, p] of Object.entries(server)) {
    const cur = out[g];
    if (cur && (cur.team === p.team || (cur.at || 0) >= (p.at || 0))) continue;
    out[g] = { ...p, rs: 1 } as Pick; restored++;
  }
  return { picks: out, restored };
}

/** Weeks worth sharing on join: skip weeks whose picks all came back from the server. */
export function weeksToShare(picks: PickMap): number[] {
  return [...new Set(Object.values(picks).filter(p => !(p as any).rs).map(p => p.week))];
}

export type RestoreResult = { status: 'restored'; n: number } | { status: 'none' } | { status: 'locked' } | { status: 'offline' };
type Deps = {
  season: number; curWeek: number; who: Who;
  load: () => Promise<PickMap>; save: (p: PickMap) => Promise<void>;
  loadWeek?: (season: number, w: number) => Promise<Game[]>;
  fetcher?: typeof fetch;
};
let running: Promise<RestoreResult> | null = null;
const listeners = new Set<(n: number) => void>();
export const onRestored = (f: (n: number) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export function restoreFromServer(d: Deps): Promise<RestoreResult> {
  if (running) return running;
  running = (async (): Promise<RestoreResult> => {
    if (!hasFamilyKey()) return { status: 'locked' };
    let snaps: Snap[];
    try { snaps = (await fetchSnaps(d.season, true, d.fetcher)).snaps; } catch { return { status: 'offline' }; }
    if (!snapsFor(snaps, d.who).length) return { status: 'none' };
    let games: Record<string, Game> | undefined;
    if (d.loadWeek) {
      games = {};
      for (let w = 1; w <= Math.max(1, d.curWeek); w++) { try { for (const g of await d.loadWeek(d.season, w)) games[g.id] = g; } catch {} }
    }
    const local = await d.load(); // read right before writing so nothing made meanwhile is lost
    const r = mergeRestored(local, serverPicks(snaps, d.who, games));
    if (!r.restored) return { status: 'none' };
    await d.save(r.picks);
    listeners.forEach(f => { try { f(r.restored); } catch {} });
    return { status: 'restored', n: r.restored };
  })().finally(() => { running = null; });
  return running;
}

/** App start / username entry: load the saved family key (if any) and restore. Never sees the password. */
export async function restoreOnStart(who: Who, getKey: () => Promise<string | null>, d: Omit<Deps, 'who'>): Promise<RestoreResult> {
  if (!hasFamilyKey()) { try { const k = JSON.parse((await getKey()) || 'null'); if (k) setFamilyKey(k); } catch {} }
  return restoreFromServer({ ...d, who });
}

export function restoreMessage(r: RestoreResult, hadLocal: boolean): string {
  if (r.status === 'restored') return `Restored ${r.n} pick${r.n === 1 ? '' : 's'} from the leaderboard`;
  if (r.status === 'locked' && !hadLocal) return 'Have the leaderboard password? Enter it on the Picks tab to bring your shared picks back.';
  return '';
}
