// Read-only access to public Sleeper / FantasyCalc / YouTube endpoints. Only GET requests, no keys.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { rawJunkReason } from './junk';
import { isHostedPwa, relayUrl } from './web';

const SLEEPER = 'https://api.sleeper.app/v1';
const SLEEPER_X = 'https://api.sleeper.com'; // unofficial stats/projections used by sleeper.com itself
const mem: Record<string, { t: number; v: any }> = {};

export const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

async function readCache(key: string) {
  if (mem[key]) return mem[key];
  try {
    const s = await AsyncStorage.getItem('gg:' + key);
    if (s) { const o = JSON.parse(s); mem[key] = o; return o; }
  } catch {}
  return null;
}
async function writeCache(key: string, v: any, persist = true) {
  const o = { t: Date.now(), v };
  mem[key] = o;
  if (persist) { try { await AsyncStorage.setItem('gg:' + key, JSON.stringify(o)); } catch {} }
}

export let lastFetchAt = 0;
/** GET json with cache. ttl in ms; force bypasses ttl. Falls back to stale cache when offline. */
export async function getJSON<T = any>(url: string, ttl: number, opts: { force?: boolean; key?: string; transform?: (x: any) => any; persist?: boolean } = {}): Promise<T> {
  const key = opts.key || url;
  const c = await readCache(key);
  if (c && !opts.force && Date.now() - c.t < ttl) return c.v;
  try {
    const r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let v = await r.json();
    if (opts.transform) v = opts.transform(v);
    await writeCache(key, v, opts.persist !== false);
    lastFetchAt = Date.now();
    return v;
  } catch (e) {
    if (c) return c.v;
    throw e;
  }
}

export async function getText(url: string, ttl: number): Promise<string | null> {
  const c = await readCache(url);
  if (c && Date.now() - c.t < ttl) return c.v;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const t = await r.text();
    await writeCache(url, t, false);
    return t;
  } catch { return c ? c.v : null; }
}

export const sleeper = {
  state: (f?: boolean) => getJSON(`${SLEEPER}/state/nfl`, 10 * MIN, { force: f }),
  user: (u: string) => getJSON(`${SLEEPER}/user/${encodeURIComponent(u.trim())}`, DAY),
  leagues: (uid: string, season: string, f?: boolean) => getJSON<any[]>(`${SLEEPER}/user/${uid}/leagues/nfl/${season}`, HOUR, { force: f }),
  league: (id: string, f?: boolean) => getJSON(`${SLEEPER}/league/${id}`, HOUR, { force: f }),
  users: (id: string, f?: boolean) => getJSON<any[]>(`${SLEEPER}/league/${id}/users`, HOUR, { force: f }),
  rosters: (id: string, f?: boolean) => getJSON<any[]>(`${SLEEPER}/league/${id}/rosters`, 2 * MIN, { force: f }),
  matchups: (id: string, w: number, ttl: number, f?: boolean) => getJSON<any[]>(`${SLEEPER}/league/${id}/matchups/${w}`, ttl, { force: f }),
  transactions: (id: string, leg: number, f?: boolean) => getJSON<any[]>(`${SLEEPER}/league/${id}/transactions/${leg}`, 5 * MIN, { force: f }),
  /** Sleeper's in-app player news (Rotowire / FantasyPros / RotoBaller). Public GraphQL read via GET, no login (checked 2026-10-21). */
  news: (pid: string, limit: number, f?: boolean) => getJSON<NewsRaw[]>(`https://sleeper.com/graphql?query=${encodeURIComponent(`{get_player_news(sport:"nfl",player_id:"${pid.replace(/\D/g, '')}",limit:${limit}){published source source_key metadata}}`)}`, 2 * HOUR, { force: f, key: `news1_${pid}`, transform: (x: any) => slimNews(x?.data?.get_player_news) }),
  trending: (f?: boolean) => getJSON<any[]>(`${SLEEPER}/players/nfl/trending/add?lookback_hours=24&limit=50`, 30 * MIN, { force: f }),
  /** players/nfl is ~15MB: fetch at most daily, keep only fantasy-relevant fields. */
  players: () => getJSON<Record<string, P>>(`${SLEEPER}/players/nfl`, DAY, { key: 'players_slim_v3', transform: slimPlayers }),
};

export type P = { n: string; p: string; t?: string; i?: string; f?: string[]; a?: number; x?: number; r?: 1; d?: number; e?: string };
const FPOS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
export function slimPlayers(all: any): Record<string, P> {
  const out: Record<string, P> = {};
  for (const id in all) {
    const p = all[id];
    if (rawJunkReason(id, p)) continue; // placeholders, retired, active:false (see junk.ts)
    const fp: string[] = (p.fantasy_positions || [p.position]).filter((x: string) => FPOS.has(x));
    const def = p.position === 'DEF' || fp[0] === 'DEF';
    const name = def ? `${p.first_name} ${p.last_name}` : (p.full_name || `${p.first_name} ${p.last_name}`);
    out[id] = { n: name, p: def ? 'DEF' : (fp.includes(p.position) ? p.position : fp[0]), t: p.team || undefined, i: p.injury_status || undefined, f: fp.length > 1 ? fp : undefined, a: p.age || undefined, x: p.years_exp ?? undefined, r: p.search_rank && p.search_rank < 9999999 ? 1 : undefined, d: !def && p.depth_chart_order != null ? p.depth_chart_order : undefined, e: p.espn_id ? String(p.espn_id) : undefined };
  }
  return out;
}

export type NewsRaw = { ts: number; src: string; title: string; desc: string; topic?: string; url?: string };
function slimNews(arr: any): NewsRaw[] {
  if (!Array.isArray(arr)) throw new Error('no news');
  return arr.map((x: any) => ({ ts: Number(x.published) || 0, src: String(x.source || ''), title: String(x.metadata?.title || '').slice(0, 160), desc: String(x.metadata?.description || '').slice(0, 300), topic: x.metadata?.topic_id || undefined, url: x.metadata?.url || undefined })).filter(x => x.ts && x.title);
}
/** ESPN fantasy news for an ESPN athlete id (fallback when Sleeper's feed is down; only ~25% of players carry an espn_id). */
export const espnNews = (eid: string) => getJSON<NewsRaw[]>(`https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${eid.replace(/\D/g, '')}&limit=30`, 2 * HOUR, { key: `espnnews_${eid}`, transform: (x: any) => (x?.feed || []).filter((f: any) => f.type === 'Rotowire' || f.type === 'Story').map((f: any) => ({ ts: Date.parse(f.published || f.lastModified) || 0, src: f.type === 'Rotowire' ? 'rotowire_espn' : 'espn', title: String(f.headline || '').slice(0, 160), desc: String(f.description || '').slice(0, 300) })).filter((n: NewsRaw) => n.ts && n.title) });

const POSQ = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => `position%5B%5D=${p}`).join('&');
/** compact points map id -> [ppr, half, std, gp] */
function compactPts(arr: any[]): Record<string, number[]> {
  const o: Record<string, number[]> = {};
  for (const r of arr || []) {
    const s = r.stats || {};
    if (s.pts_ppr == null && s.pts_std == null) continue;
    o[r.player_id] = [s.pts_ppr ?? 0, s.pts_half_ppr ?? 0, s.pts_std ?? 0, s.gp ?? 0];
  }
  return o;
}
function compactWeek(arr: any[]): Record<string, any[]> {
  const o: Record<string, any[]> = {};
  for (const r of arr || []) {
    const s = r.stats || {};
    if (!s.gp && !s.off_snp && s.pts_ppr == null) continue;
    const snap = s.tm_off_snp ? Math.round((100 * (s.off_snp || 0)) / s.tm_off_snp) : null;
    o[r.player_id] = [s.pts_ppr ?? 0, s.pts_half_ppr ?? 0, s.pts_std ?? 0, s.gp ?? (s.off_snp ? 1 : 0), s.pos_rank_ppr ?? null, snap, r.team || null, s.pass_att ?? 0, s.gs ?? 0, s.off_snp ?? 0];
  }
  return o;
}
function compactSchedule(arr: any[]) {
  const opp: Record<string, string> = {};
  const weeksByTeam: Record<string, Set<number>> = {};
  let maxW = 0;
  for (const g of arr || []) {
    opp[`${g.week}:${g.home}`] = g.away; opp[`${g.week}:${g.away}`] = '@' + g.home;
    (weeksByTeam[g.home] ||= new Set()).add(g.week); (weeksByTeam[g.away] ||= new Set()).add(g.week);
    maxW = Math.max(maxW, g.week);
  }
  const byes: Record<string, number> = {};
  for (const t in weeksByTeam) for (let w = 1; w <= Math.min(maxW, 18); w++) if (!weeksByTeam[t].has(w)) { byes[t] = w; break; }
  return { byes, opp };
}
/** Projected points with THIS league's scoring_settings (what Sleeper's matchup screen shows), id -> [pts, pts, pts, gp]. */
export function leagueScored(arr: any[], scoring: Record<string, number>): Record<string, number[]> {
  const o: Record<string, number[]> = {};
  for (const r of arr || []) {
    const s = r.stats || {};
    if (s.pts_ppr == null && s.pts_std == null) continue;
    let pts = 0;
    for (const k in s) { const w = scoring[k]; if (w && typeof s[k] === 'number') pts += w * s[k]; }
    pts = Math.round(pts * 100) / 100;
    o[r.player_id] = [pts, pts, pts, s.gp ?? 0];
  }
  return o;
}
export const stats = {
  /** v0.0.7: projections scored with the league's own settings; cache key includes the league id. */
  projectionsLeague: (season: string, week: number, leagueId: string, scoring: Record<string, number>, f?: boolean) => getJSON<Record<string, number[]>>(`${SLEEPER_X}/projections/nfl/${season}/${week}?season_type=regular&${POSQ}`, HOUR, { force: f, key: `projL_${season}_${week}_${leagueId}`, transform: (a: any[]) => leagueScored(a, scoring) }),
  /** v0.0.7: a past season's per-game points with THIS league's scoring: id -> [ppg, games]. Cached a week. */
  priorSeason: (season: string, leagueId: string, scoring: Record<string, number>) => getJSON<Record<string, number[]>>(`${SLEEPER_X}/stats/nfl/${season}?season_type=regular&${POSQ}`, 7 * DAY, { key: `prior_${season}_${leagueId}_v1`, transform: (a: any[]) => { const o: Record<string, number[]> = {}; for (const [id, r] of Object.entries(leagueScored(a, scoring))) if (r[3] > 0) o[id] = [Math.round((r[0] / r[3]) * 100) / 100, r[3]]; return o; } }),
  projections: (season: string, week: number, f?: boolean) => getJSON<Record<string, number[]>>(`${SLEEPER_X}/projections/nfl/${season}/${week}?season_type=regular&${POSQ}`, HOUR, { force: f, transform: compactPts }),
  week: (season: string, week: number, f?: boolean) => getJSON<Record<string, number[]>>(`${SLEEPER_X}/stats/nfl/${season}/${week}?season_type=regular&${POSQ}`, 30 * MIN, { force: f, transform: compactPts }),
  season: (season: string, f?: boolean) => getJSON<Record<string, number[]>>(`${SLEEPER_X}/stats/nfl/${season}?season_type=regular&${POSQ}`, HOUR, { force: f, transform: compactPts }),
  /** rich weekly stats: id -> [ppr, half, std, gp, posRank, snap%, team, passAtt] */
  /** v0.0.8: the week in progress (before Sleeper marks it scored on Tuesday). Own cache key so a partial week is never
   * served later as a finished one. */
  weekPartial: (season: string, week: number, f?: boolean) => getJSON<Record<string, any[]>>(`${SLEEPER_X}/stats/nfl/${season}/${week}?season_type=regular&${POSQ}`, 10 * MIN, { force: f, key: `wk_part_${season}_${week}`, transform: compactWeek, persist: false }),
  weekFull: (season: string, week: number, ttl: number, f?: boolean) => getJSON<Record<string, any[]>>(`${SLEEPER_X}/stats/nfl/${season}/${week}?season_type=regular&${POSQ}`, ttl, { force: f, key: `wk_full2_${season}_${week}`, transform: compactWeek }),
  /** season schedule -> { byes: team -> bye week, opp: `${week}:${team}` -> opponent } */
  schedule: (season: string) => getJSON<{ byes: Record<string, number>; opp: Record<string, string> }>(`${SLEEPER_X}/schedule/nfl/regular/${season}`, DAY, { transform: compactSchedule }),
  playerWeeks: (id: string, season: string) => getJSON<Record<string, any>>(`${SLEEPER_X}/stats/nfl/player/${id}?season_type=regular&season=${season}&grouping=week`, 30 * MIN, { persist: false }),
};

/** FantasyCalc public trade values (redraft). Returns sleeperId -> value. */
export async function fantasyCalc(numTeams: number, ppr: number, f?: boolean): Promise<Record<string, number>> {
  const url = `https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=${numTeams}&ppr=${ppr}`;
  return getJSON(url, 6 * HOUR, { force: f, transform: (arr: any[]) => { const o: Record<string, number> = {}; for (const r of arr || []) if (r.player?.sleeperId) o[r.player.sleeperId] = r.value; return o; } });
}

export const CREATORS = [
  { name: 'The Fantasy Footballers', id: 'UC-No2ITxJsNt50oJQ3fLmUA', q: 'Fantasy Footballers' },
  { name: 'Late-Round (JJ Zachariason)', id: 'UCK5szBUaJMnuCViD6alvuXg', q: 'Late Round Fantasy Football' },
  { name: 'Fantasy Headliners', id: 'UCClRnPtjFEm7Is7hpSoTBeg', q: 'Fantasy Headliners' },
  { name: 'SleeperHQ', id: 'UCz9CnGPhYaKOw4-wcu6F_Qg', q: 'Sleeper fantasy football' },
];
export type Video = { title: string; url: string; channel: string; published: string; thumb?: string; channelId?: string; vid?: string };
/** One channel's latest uploads from public RSS. Retries once; cached ~6h; returns null on failure. */
// Web screenshots only: browsers block cross-origin RSS, so a local dev proxy can be used via ?rssproxy=1. The Android app fetches YouTube directly.
const webProxy = typeof window !== 'undefined' && typeof window.location !== 'undefined' && /rssproxy=1/.test(window.location.search || '');
// iPhone web app: same-site here.now relay (see web.ts)
const rssUrl = (id: string) => (webProxy ? `http://localhost:8090/rss?channel_id=${id}` : isHostedPwa() ? relayUrl('yt', `?channel_id=${id}`) : `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
export async function channelFeed(channelId: string, name: string, force = false): Promise<Video[] | null> {
  const key = 'feed:' + channelId;
  const c = await readCache(key);
  if (c && !force && Date.now() - c.t < 6 * HOUR) return c.v;
  const url = rssUrl(channelId);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url);
      const xml = r.ok ? await r.text() : '';
      if (xml.includes('<entry>')) {
        const out: Video[] = [];
        for (const e of xml.split('<entry>').slice(1, 16)) {
          const title = (e.match(/<title>([^<]*)<\/title>/) || [])[1];
          const vid = (e.match(/<yt:videoId>([^<]*)</) || [])[1];
          const pub = (e.match(/<published>([^<]*)</) || [])[1] || '';
          if (title && vid) out.push({ title: decode(title), url: `https://www.youtube.com/watch?v=${vid}`, channel: name, channelId, published: pub, vid, thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` });
        }
        await writeCache(key, out, true);
        return out;
      }
    } catch {}
    await new Promise(res => setTimeout(res, 700));
  }
  return c ? c.v : null;
}
/** Latest uploads via public YouTube RSS (no key). May fail; caller falls back to search links. */
export async function creatorVideos(): Promise<Video[]> {
  const out: Video[] = [];
  await Promise.all(CREATORS.map(async c => {
    const xml = await getText(rssUrl(c.id), 6 * HOUR);
    if (!xml || !xml.includes('<entry>')) return;
    for (const e of xml.split('<entry>').slice(1, 16)) {
      const title = (e.match(/<title>([^<]*)<\/title>/) || [])[1];
      const vid = (e.match(/<yt:videoId>([^<]*)</) || [])[1];
      const pub = (e.match(/<published>([^<]*)</) || [])[1] || '';
      if (title && vid) out.push({ title: decode(title), url: `https://www.youtube.com/watch?v=${vid}`, channel: c.name, published: pub, thumb: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` });
    }
  }));
  return out.sort((a, b) => b.published.localeCompare(a.published));
}
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
export const ytSearch = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
export const avatarUrl = (a?: string) => (a ? `https://sleepercdn.com/avatars/thumbs/${a}` : undefined);
export const headshot = (id: string) => (/^\d+$/.test(id) ? `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg` : `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png`);

export async function saveSetting(k: string, v: string) { try { await AsyncStorage.setItem('ggs:' + k, v); } catch {} }
export async function loadSetting(k: string) { try { return await AsyncStorage.getItem('ggs:' + k); } catch { return null; } }
