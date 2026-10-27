// v0.0.7: live game day. Public, read-only, no keys:
//  - Sleeper league matchups/<week> (players_points update during games, league scoring)
//  - ESPN public scoreboard (score, quarter, clock, possession, down & distance, red zone)
//  - ESPN public game summary, slimmed to scoring plays (only for games your/your opponent's starters are in)
// Polling is done by the screen: every 45s while a relevant game is live, never when none are.
import { getJSON, sleeper } from './api';
import { isHostedPwa, relayUrl } from './web';

export type LiveGame = {
  id: string; home: string; away: string; hs: number; as: number; state: 'pre' | 'in' | 'post';
  period: number; clock: string; clockSec: number; kickoff: number; detail: string;
  poss?: string; down?: string; redzone?: boolean; last?: string; tv?: string[];
};
export type ScoringPlay = { id: string; gameId: string; team: string; text: string; type: string; period: number; clock: string; hs: number; as: number; home: string; away: string };

const ESPN_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const FIX: Record<string, string> = { WSH: 'WAS', LA: 'LAR' };
const ab = (s?: string) => (s ? FIX[s] || s : '');

export function parseLive(j: any): Record<string, LiveGame> {
  const out: Record<string, LiveGame> = {};
  for (const e of j?.events || []) {
    const c = e?.competitions?.[0];
    if (!c) continue;
    const h = (c.competitors || []).find((x: any) => x.homeAway === 'home'), a = (c.competitors || []).find((x: any) => x.homeAway === 'away');
    if (!h || !a) continue;
    const st = c.status || e.status || {};
    const sit = c.situation || {};
    const idToAbbr: Record<string, string> = { [h.team?.id]: ab(h.team?.abbreviation), [a.team?.id]: ab(a.team?.abbreviation) };
    const state = st.type?.state === 'in' ? 'in' : st.type?.state === 'post' ? 'post' : 'pre';
    const g: LiveGame = {
      id: String(e.id), home: ab(h.team?.abbreviation), away: ab(a.team?.abbreviation), hs: Number(h.score) || 0, as: Number(a.score) || 0, state,
      period: Number(st.period) || 0, clock: st.displayClock || '', clockSec: Number(st.clock) || 0, kickoff: Date.parse(e.date || c.date), detail: st.type?.shortDetail || '',
      poss: sit.possession ? idToAbbr[String(sit.possession)] : undefined, down: sit.shortDownDistanceText || sit.downDistanceText || undefined, redzone: !!sit.isRedZone,
      last: sit.lastPlay?.text ? String(sit.lastPlay.text).slice(0, 140) : undefined,
      tv: broadcasts(c),
    };
    out[g.home] = g; out[g.away] = g;
  }
  return out;
}

/** Official broadcasters from ESPN's broadcasts field (national first, de-duplicated). */
export function broadcasts(c: any): string[] {
  const n: string[] = [];
  for (const b of c?.broadcasts || []) for (const x of b?.names || []) if (x && !n.includes(x)) n.push(String(x));
  for (const g of c?.geoBroadcasts || []) { const x = g?.media?.shortName; if (x && !n.includes(x)) n.push(String(x)); }
  return n.slice(0, 4);
}
/** Official ways to watch. https links (they open the network's installed app on most phones via app links, else
 * the official site). Never unofficial streams. */
export type WatchOpt = { label: string; sub: string; url: string; kind: 'tv' | 'nfl' | 'yt' };
const NET: [RegExp, WatchOpt[]][] = [
  [/^cbs/i, [{ label: 'CBS', sub: 'CBS app or cbs.com, with a TV provider', url: 'https://www.cbs.com/live-tv/stream/', kind: 'tv' }, { label: 'Paramount+', sub: 'Streams your local CBS game', url: 'https://www.paramountplus.com/live-tv/', kind: 'tv' }]],
  [/paramount/i, [{ label: 'Paramount+', sub: 'Official stream', url: 'https://www.paramountplus.com/live-tv/', kind: 'tv' }]],
  [/^fox/i, [{ label: 'FOX Sports', sub: 'FOX Sports app or foxsports.com, with a TV provider', url: 'https://www.foxsports.com/live', kind: 'tv' }, { label: 'FOX One', sub: "FOX's streaming service", url: 'https://www.foxone.com/', kind: 'tv' }]],
  [/^nbc/i, [{ label: 'NBC', sub: 'NBC app or nbc.com, with a TV provider', url: 'https://www.nbc.com/live', kind: 'tv' }, { label: 'Peacock', sub: 'Streams NBC games', url: 'https://www.peacocktv.com/sports/nfl', kind: 'tv' }]],
  [/peacock/i, [{ label: 'Peacock', sub: 'Official stream', url: 'https://www.peacocktv.com/sports/nfl', kind: 'tv' }]],
  [/prime|amazon/i, [{ label: 'Prime Video', sub: 'Thursday Night Football', url: 'https://www.amazon.com/tnf', kind: 'tv' }]],
  [/^(espn|abc)/i, [{ label: 'ESPN', sub: 'ESPN app or espn.com/watch', url: 'https://www.espn.com/watch/', kind: 'tv' }]],
  [/disney/i, [{ label: 'Disney+', sub: 'ESPN games on Disney+', url: 'https://www.disneyplus.com/', kind: 'tv' }]],
  [/nfl ?net/i, [{ label: 'NFL Network', sub: 'NFL app or nfl.com, with a TV provider', url: 'https://www.nfl.com/network/watch/nfl-network-live', kind: 'tv' }]],
  [/netflix/i, [{ label: 'Netflix', sub: 'Official stream', url: 'https://www.netflix.com/', kind: 'tv' }]],
  [/youtube/i, [{ label: 'YouTube', sub: 'Official stream', url: 'https://www.youtube.com/@NFL', kind: 'tv' }]],
];
export const watchUrl = (name: string) => NET.find(([r]) => r.test(name))?.[1][0].url || null;
export const NFL_PLUS = 'https://www.nfl.com/plus/';
/** Official NFL YouTube channel search for this game's highlights. */
export const highlightsUrl = (g: LiveGame, week: number) => `https://www.youtube.com/@NFL/search?query=${encodeURIComponent(`${g.away} vs ${g.home} highlights week ${week}`)}`;
/** Sunday afternoon (before 5 PM CT) regional games are the ones NFL Sunday Ticket carries out of market. */
export function sundayAfternoon(kickoff: number) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date(kickoff));
  const wd = p.find(x => x.type === 'weekday')?.value, h = Number(p.find(x => x.type === 'hour')?.value);
  return wd === 'Sun' && h >= 11 && h < 17;
}
export function watchOptions(g: LiveGame, week: number): WatchOpt[] {
  const out: WatchOpt[] = [];
  const add = (o: WatchOpt) => { if (!out.some(x => x.url === o.url)) out.push(o); };
  if (g.state !== 'post') for (const n of g.tv || []) for (const o of NET.find(([r]) => r.test(n))?.[1] || []) add(o);
  const regional = sundayAfternoon(g.kickoff) && (g.tv || []).every(n => /^(cbs|fox)/i.test(n));
  if (g.state !== 'post') {
    add({ label: 'NFL+', sub: 'Live local and primetime games on your phone or tablet', url: NFL_PLUS, kind: 'nfl' });
    add({ label: 'YouTube TV', sub: 'Live TV with CBS, FOX, NBC, ESPN and NFL Network', url: 'https://tv.youtube.com/', kind: 'tv' });
    if (regional) add({ label: 'NFL Sunday Ticket', sub: 'Out-of-market Sunday afternoon games (YouTube)', url: 'https://tv.youtube.com/learn/nflsundayticket/', kind: 'tv' });
  }
  if (g.state !== 'pre') add({ label: 'Highlights', sub: 'Official NFL channel on YouTube', url: highlightsUrl(g, week), kind: 'yt' });
  return out;
}

const espn = <T,>(path: string, ttl: number, key: string, transform: (x: any) => T, force = true) =>
  getJSON<T>(ESPN_NFL + path, ttl, { force, key, transform, persist: false }).catch(e => (isHostedPwa() ? getJSON<T>(relayUrl('espn', path), ttl, { force, key, transform, persist: false }) : Promise.reject(e)));

export const loadLiveGames = (season: string, week: number, force = true) => espn(`/scoreboard?week=${week}&seasontype=2&dates=${season}`, 25_000, `live_${season}_${week}`, parseLive, force);

export function parseScoring(j: any, gameId: string): ScoringPlay[] {
  const comp = j?.header?.competitions?.[0];
  const cs = comp?.competitors || [];
  const home = ab(cs.find((x: any) => x.homeAway === 'home')?.team?.abbreviation), away = ab(cs.find((x: any) => x.homeAway === 'away')?.team?.abbreviation);
  return (j?.scoringPlays || []).map((p: any) => ({
    id: String(p.id), gameId, team: ab(p.team?.abbreviation), text: String(p.text || '').trim().slice(0, 160), type: p.type?.abbreviation || p.type?.text || '',
    period: Number(p.period?.number) || 0, clock: p.clock?.displayValue || '', hs: Number(p.homeScore) || 0, as: Number(p.awayScore) || 0, home, away,
  }));
}
/** Scoring plays for one game (~650 KB upstream, slimmed to a few hundred bytes, kept in memory only). */
export const loadScoring = (gameId: string, ttl = 15_000) => espn(`/summary?event=${encodeURIComponent(gameId)}`, ttl, `scoring_${gameId}`, (j: any) => parseScoring(j, gameId), false);
export const liveMatchups = (leagueId: string, week: number) => sleeper.matchups(leagueId, week, 25_000, true);

/** Share of the game still to play: 1 before kickoff, 0 when final. */
/** v0.0.8: the matchup is decided only when EVERY starter on both sides has a final game. A starter with no game found
 * counts as done only on a known bye (or with no NFL team); otherwise the data is just missing, so it is NOT final. */
export function matchupFinal(rows: { id: string; g?: LiveGame | null; team?: string; bye?: boolean }[], games: Record<string, LiveGame> | null): boolean {
  if (!games || !Object.keys(games).length) return false;
  const real = rows.filter(r => r.id && r.id !== '0');
  if (!real.length) return false;
  return real.every(r => (r.g ? r.g.state === 'post' : !!r.bye || !r.team));
}
/** v0.0.9: the big score line. 'Won by'/'Lost by' only once the matchup is decided (every starter's game final, or
 * Sleeper has scored the week); while games are on it is 'Leading by'/'Trailing by'. */
export function resultLine(a: number, o: number, useProj: boolean, decided: boolean, fmt: (n: number) => string): string {
  if (useProj) return a >= o ? `Projected to win by ${fmt(a - o)}` : `Projected to lose by ${fmt(o - a)}. Look for upgrades.`;
  if (!decided) return a === o ? 'Tied (games still to play)' : a > o ? `Leading by ${fmt(a - o)} (games still to play)` : `Trailing by ${fmt(o - a)} (games still to play)`;
  return a >= o ? `Won by ${fmt(a - o)} 🎉` : `Lost by ${fmt(o - a)}`;
}
/** v0.0.8: which games to pull scoring plays for this poll: every in-progress game with a matchup starter, plus a game
 * once more when it turns final or its score changed (catches the last TD). Capped to keep data use light. */
export function scoringTargets(games: Record<string, LiveGame>, teams: string[], last: Record<string, string>, cap = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of teams) {
    const g = games[t];
    if (!g || g.state === 'pre' || seen.has(g.id)) continue;
    seen.add(g.id);
    const sig = `${g.state}:${g.hs}-${g.as}`;
    if (g.state === 'in' || last[g.id] !== sig) out.push(g.id);
    last[g.id] = sig;
  }
  return out.slice(0, cap);
}
export function remaining(g?: LiveGame | null): number {
  if (!g) return 0; // no game (bye): nothing left
  if (g.state === 'pre') return 1;
  if (g.state === 'post') return 0;
  if (g.period > 4) return 0.04;
  return Math.max(0, Math.min(1, ((4 - g.period) * 900 + g.clockSec) / 3600));
}
/** Standard normal CDF (Abramowitz-Stegun). */
export function phi(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
export type SideLive = { now: number; final: number; sd2: number; left: number };
/** Projected final = points so far + this week's projection x share of the game left. ~55% of a projection is a
 * typical one-game standard deviation, so the win chance is a rough normal estimate, not a betting line. */
export function sideOutlook(rows: { pts: number; proj: number; g?: LiveGame | null; dead?: boolean }[]): SideLive {
  let now = 0, final = 0, sd2 = 0, left = 0;
  for (const r of rows) {
    const f = r.dead ? 0 : remaining(r.g);
    now += r.pts; final += r.pts + r.proj * f; sd2 += (0.55 * r.proj) ** 2 * f; if (f > 0) left++;
  }
  return { now, final, sd2, left };
}
export function winChance(me: SideLive, opp: SideLive) {
  const sd = Math.sqrt(me.sd2 + opp.sd2);
  if (sd < 0.01) return me.final > opp.final ? 1 : me.final < opp.final ? 0 : 0.5;
  return phi((me.final - opp.final) / sd);
}
/** Does this scoring play involve the player? ESPN writes full names ("Caleb Williams pass to Rome Odunze ..."). */
export function playInvolves(p: ScoringPlay, name: string, team?: string, pos?: string) {
  if (pos === 'DEF') return !!team && p.team === team && /interception|fumble|safety|blocked|punt return|kickoff return|defensive/i.test(p.text);
  if (!name) return false;
  if (p.text.toLowerCase().includes(name.toLowerCase())) return true;
  const parts = name.replace(/\b(Jr|Sr|II|III|IV)\.?$/i, '').trim().split(/\s+/);
  const last = parts[parts.length - 1];
  return !!team && (p.home === team || p.away === team) && last.length > 3 && new RegExp(`\\b${parts[0][0]}\\.? ?${last}\\b|\\b${parts[0]} ${last}\\b`, 'i').test(p.text);
}
export const anyLive = (games: Record<string, LiveGame> | null, teams: string[], now = Date.now()) =>
  !!games && teams.some(t => { const g = games[t]; return !!g && (g.state === 'in' || (g.state === 'pre' && g.kickoff - now < 10 * 60_000 && now - g.kickoff < 5 * 3600_000)); });
