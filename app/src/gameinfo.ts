// v0.0.7: this week's NFL games (opponent, home/away, kickoff, Vegas line) from ESPN's public scoreboard JSON, plus
// "fantasy points allowed by position" computed from Sleeper weekly stats we already load. GET only, no keys.
import { getJSON, sleeper, HOUR, MIN, NewsRaw } from './api';
import { isHostedPwa, relayUrl } from './web';

export type GameInfo = { opp: string; home: boolean; kickoff: number; spread: number | null; total: number | null; implied: number | null; oppImplied: number | null; state: string };
const ESPN_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
/** ESPN and Sleeper disagree on a couple of abbreviations. */
const FIX: Record<string, string> = { WSH: 'WAS', LA: 'LAR' };
const ab = (s: string) => FIX[s] || s;

/** ESPN scoreboard -> team -> GameInfo. spread is from that team's side (negative = favored). */
export function parseGames(j: any): Record<string, GameInfo> {
  const out: Record<string, GameInfo> = {};
  for (const e of j?.events || []) {
    const c = e?.competitions?.[0];
    if (!c) continue;
    const kickoff = Date.parse(e.date || c.date);
    const h = (c.competitors || []).find((x: any) => x.homeAway === 'home'), a = (c.competitors || []).find((x: any) => x.homeAway === 'away');
    if (!h || !a) continue;
    const H = ab(h.team?.abbreviation || ''), A = ab(a.team?.abbreviation || '');
    const o = (c.odds || [])[0] || {};
    const total = Number.isFinite(Number(o.overUnder)) && o.overUnder != null ? Number(o.overUnder) : null;
    // "CHI -3" -> favorite CHI by 3. "EVEN" -> 0.
    let homeSpread: number | null = null;
    const m = String(o.details || '').match(/^([A-Z]{2,3})\s+(-?\d+(?:\.\d+)?)$/);
    if (m) { const fav = ab(m[1]); const n = Math.abs(Number(m[2])); homeSpread = fav === H ? -n : fav === A ? n : null; }
    else if (/^even$/i.test(String(o.details || ''))) homeSpread = 0;
    const imp = (sp: number | null) => (total != null && sp != null ? Math.round(((total - sp) / 2) * 100) / 100 : null);
    const st = e.status?.type?.state || 'pre';
    out[H] = { opp: A, home: true, kickoff, spread: homeSpread, total, implied: imp(homeSpread), oppImplied: imp(homeSpread == null ? null : -homeSpread), state: st };
    out[A] = { opp: H, home: false, kickoff, spread: homeSpread == null ? null : -homeSpread, total, implied: imp(homeSpread == null ? null : -homeSpread), oppImplied: imp(homeSpread), state: st };
  }
  return out;
}

export async function loadGames(season: string, week: number, force = false): Promise<Record<string, GameInfo>> {
  const u = `${ESPN_NFL}/scoreboard?week=${week}&seasontype=2&dates=${season}`;
  const opts = { force, key: `games_${season}_${week}_v1`, transform: parseGames };
  return getJSON<Record<string, GameInfo>>(u, 30 * MIN, opts).catch(e => (isHostedPwa() ? getJSON<Record<string, GameInfo>>(relayUrl('espn', u.replace(ESPN_NFL, '')), 30 * MIN, opts) : Promise.reject(e)));
}

export type Allowed = Record<string, Record<string, { avg: number; rank: number; n: number }>>;
/**
 * Fantasy points each defense has allowed per position (QB, RB, WR, TE, K) and, for DEF, points opposing
 * defenses scored against that team's offense. rank 1 = allows the most (easiest matchup).
 * weeks: week -> id -> compact row (index si = points, 6 = team); opp: `${week}:${team}` -> opponent ("@X" = away).
 */
export function pointsAllowed(weeks: Record<number, Record<string, any[]>>, opp: Record<string, string> | undefined, pos: (id: string) => string, si: number): Allowed {
  const sum: Record<string, Record<string, Record<number, number>>> = {};
  if (!opp) return {};
  for (const w in weeks) for (const id in weeks[w]) {
    const r = weeks[w][id];
    const team = r[6]; const p = pos(id);
    if (!team || !p || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p)) continue;
    const o = (opp[`${w}:${team}`] || '').replace('@', '');
    if (!o) continue;
    const pts = Number(r[si]) || 0;
    if (p === 'QB' && !(r[7] >= 10)) continue; // skip trick-play / mop-up QBs
    ((sum[o] ||= {})[p] ||= {})[Number(w)] = (((sum[o][p] || {})[Number(w)]) || 0) + pts;
  }
  const out: Allowed = {};
  for (const p of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const rows = Object.keys(sum).map(t => { const ws = Object.values(sum[t][p] || {}); return { t, n: ws.length, avg: ws.length ? ws.reduce((s, x) => s + x, 0) / ws.length : 0 }; }).filter(x => x.n);
    rows.sort((a, c) => c.avg - a.avg).forEach((x, i) => ((out[x.t] ||= {})[p] = { avg: Math.round(x.avg * 10) / 10, rank: i + 1, n: x.n }));
  }
  return out;
}
export const leagueAvgAllowed = (a: Allowed, p: string) => { const v = Object.values(a).map(x => x[p]?.avg).filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; };

/** Latest practice / game-status line from Sleeper's public news feed (last 6 days), e.g. "Full practice Wednesday". */
export function practiceNote(news: NewsRaw[], now = Date.now()): { text: string; full: boolean; ts: number } | null {
  const recent = (news || []).filter(n => now - n.ts < 6 * 24 * HOUR).sort((a, c) => c.ts - a.ts);
  for (const n of recent) {
    const s = `${n.title} ${n.desc}`;
    const day = (s.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/) || [])[1] || '';
    let text = '';
    if (/\b(ruled out|won'?t play|will not play|inactive)\b/i.test(s)) text = 'ruled out';
    else if (/\bfull(?:y)? (?:practice|participant)|practiced in full|logs? full\b|full session/i.test(s)) text = 'full practice';
    else if (/\blimited\b/i.test(s)) text = 'limited practice';
    else if (/\b(DNP|did ?n[o']t practice|doesn'?t practice|not practicing|didn'?t take part|did not take part|sat out practice)\b/i.test(s)) text = 'did not practice';
    else if (/\bquestionable\b/i.test(s) && /\b(listed|designat|tagged)\b/i.test(s)) text = 'listed questionable';
    if (text) return { text: text + (day && text !== 'ruled out' ? ' ' + day : ''), full: text === 'full practice', ts: n.ts };
  }
  return null;
}
export async function practiceFor(ids: string[]): Promise<Record<string, { text: string; full: boolean; ts: number }>> {
  const out: Record<string, { text: string; full: boolean; ts: number }> = {};
  await Promise.all(ids.filter(id => /^\d+$/.test(id)).slice(0, 12).map(async id => { try { const n = practiceNote(await sleeper.news(id, 6)); if (n) out[id] = n; } catch {} }));
  return out;
}

/** "Sun 12:00 PM CT" */
export const kickoffCT = (ts: number) => {
  try { return new Date(ts).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(',', '') + ' CT'; } catch { return ''; }
};
