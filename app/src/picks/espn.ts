// Public NFL schedule + scores from ESPN's scoreboard JSON (no key). GET only, cached on the phone.
import { getJSON, sleeper, MIN, DAY } from '../api';
import { isHostedPwa, relayUrl } from '../web';
import { parseEspn, Game } from './core';

export const REG_WEEKS = 18;
const known: Record<string, 'final' | 'live' | 'pre'> = {};
const ESPN_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const url = (season: number, w: number) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${w}&seasontype=2&dates=${season}`;
// strip the 140 KB response down to what Picks needs before caching it
const slim = (season: number, w: number) => (j: any) => parseEspn(j, w, season);

function ttlFor(season: number, w: number) {
  const k = known[season + ':' + w];
  return k === 'final' ? 7 * DAY : k === 'live' ? 1 * MIN : 10 * MIN;
}
/** One week's games. Final weeks are cached for a week; weeks with games on are refreshed every minute. */
export async function loadWeek(season: number, w: number, force = false): Promise<Game[]> {
  const opts = { force, key: `espn_${season}_${w}_v1`, transform: slim(season, w) };
  // iPhone web app: ESPN sends CORS *, but fall back to the same-site relay if Safari's request fails
  const games = await getJSON<Game[]>(url(season, w), ttlFor(season, w), opts).catch(e => (isHostedPwa() ? getJSON<Game[]>(relayUrl('espn', url(season, w).replace(ESPN_NFL, '')), ttlFor(season, w), opts) : Promise.reject(e)));
  const now = Date.now();
  known[season + ':' + w] = games.length && games.every(g => g.state === 'post' || g.state === 'off') ? 'final' : games.some(g => g.state === 'in' || (g.kickoff <= now && g.state === 'pre')) ? 'live' : 'pre';
  return games;
}
/** NFL season + current regular-season week from Sleeper's public state (falls back to ESPN's current week). */
export async function nflNow(): Promise<{ season: number; week: number }> {
  try {
    const st: any = await sleeper.state();
    const season = Number(st.season) || new Date().getFullYear();
    const wk = st.season_type === 'regular' ? Number(st.week) || 1 : st.season_type === 'post' ? REG_WEEKS : 1;
    return { season, week: Math.min(REG_WEEKS, Math.max(1, wk)) };
  } catch {
    const j: any = await getJSON('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', 10 * MIN, { key: 'espn_now' , transform: x => ({ season: x?.season?.year, week: x?.week?.number }) });
    return { season: Number(j.season) || new Date().getFullYear(), week: Math.min(REG_WEEKS, Math.max(1, Number(j.week) || 1)) };
  }
}
export const isFinalWeek = (games: Game[]) => games.length > 0 && games.every(g => g.state === 'post' || g.state === 'off');
