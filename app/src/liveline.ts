// v0.0.10: a player's stat line + fantasy-point breakdown while his game is live (and once it's final this week).
// Source: Sleeper's public per-player weekly stats (same feed sleeper.com uses), scored with THIS league's
// scoring_settings. Read-only GET, no keys. Pure helpers are unit-tested in tests/v010.test.ts.
import { getJSON } from './api';

export type LiveRow = { label: string; text: string; pts: number };
export type LiveLine = { pts: number; rows: LiveRow[]; opp?: string };

const n = (s: any, k: string) => (typeof s?.[k] === 'number' ? s[k] : 0);
const r1 = (x: number) => Math.round(x * 100) / 100;
/** Points from the stat keys that match `test` (league scoring weights). */
function ptsFor(s: any, scoring: Record<string, number>, test: (k: string) => boolean) {
  let p = 0;
  for (const k in s) if (test(k) && scoring[k] && typeof s[k] === 'number') p += scoring[k] * s[k];
  return r1(p);
}
const GROUPS: { label: string; test: (k: string) => boolean; text: (s: any) => string | null }[] = [
  { label: 'Passing', test: k => /^(pass_|bonus_pass)/.test(k) && !/^pass_rush/.test(k) || k === 'bonus_fd_qb',
    text: s => (n(s, 'pass_att') ? `${n(s, 'pass_cmp')}/${n(s, 'pass_att')}, ${n(s, 'pass_yd')} yds${n(s, 'pass_td') ? `, ${n(s, 'pass_td')} TD` : ''}${n(s, 'pass_int') ? `, ${n(s, 'pass_int')} INT` : ''}` : null) },
  { label: 'Rushing', test: k => /^(rush_|bonus_rush)/.test(k) && !/^rush_rec/.test(k) || k === 'bonus_fd_rb',
    text: s => (n(s, 'rush_att') ? `${n(s, 'rush_att')} car, ${n(s, 'rush_yd')} yds${n(s, 'rush_td') ? `, ${n(s, 'rush_td')} TD` : ''}` : null) },
  { label: 'Receiving', test: k => /^(rec($|_)|bonus_rec)/.test(k) || k === 'bonus_fd_wr' || k === 'bonus_fd_te',
    text: s => (n(s, 'rec_tgt') || n(s, 'rec') ? `${n(s, 'rec')} rec${n(s, 'rec_tgt') ? ` on ${n(s, 'rec_tgt')} targets` : ''}, ${n(s, 'rec_yd')} yds${n(s, 'rec_td') ? `, ${n(s, 'rec_td')} TD` : ''}` : null) },
  { label: 'Kicking', test: k => /^(fg|xp)/.test(k),
    text: s => (n(s, 'fga') || n(s, 'xpa') ? `FG ${n(s, 'fgm')}/${n(s, 'fga')}${n(s, 'fgm_lng') ? ` (long ${n(s, 'fgm_lng')})` : ''}, XP ${n(s, 'xpm')}/${n(s, 'xpa')}` : null) },
  { label: 'Defense', test: k => /^(pts_allow|yds_allow|sack|int$|def_|fum_rec|safe|blk_kick|ff$|st_|tkl)/.test(k),
    text: s => { const a = [n(s, 'sack') ? `${n(s, 'sack')} sacks` : '', n(s, 'int') ? `${n(s, 'int')} INT` : '', n(s, 'fum_rec') ? `${n(s, 'fum_rec')} fum rec` : '', n(s, 'def_td') || n(s, 'def_st_td') ? `${n(s, 'def_td') + n(s, 'def_st_td')} TD` : '', s?.pts_allow != null ? `${n(s, 'pts_allow')} pts allowed` : ''].filter(Boolean); return a.length ? a.join(', ') : null; } },
  { label: 'Fumbles / 2-pt', test: k => /^(fum_lost|fum$|pass_2pt|rush_2pt|rec_2pt)/.test(k),
    text: s => { const a = [n(s, 'fum_lost') ? `${n(s, 'fum_lost')} fumble lost` : '', n(s, 'pass_2pt') + n(s, 'rush_2pt') + n(s, 'rec_2pt') ? `${n(s, 'pass_2pt') + n(s, 'rush_2pt') + n(s, 'rec_2pt')} two-pt` : ''].filter(Boolean); return a.length ? a.join(', ') : null; } },
];

/** Stat line + points per category in league scoring. `pts` = total over ALL scored keys (bonuses included),
 * so it matches Sleeper even if a key isn't in a named group (the leftover shows as "Other"). */
export function breakdown(stats: any, scoring: Record<string, number>): LiveLine {
  const s = stats || {};
  const total = ptsFor(s, scoring, () => true);
  const rows: LiveRow[] = [];
  const used = new Set<string>();
  for (const g of GROUPS) {
    const keys = Object.keys(s).filter(k => g.test(k) && !used.has(k));
    keys.forEach(k => used.add(k));
    const pts = ptsFor(s, scoring, k => keys.includes(k));
    const text = g.text(s);
    if (text || pts) rows.push({ label: g.label, text: text || '', pts });
  }
  const other = r1(total - rows.reduce((a, r) => a + r.pts, 0));
  if (Math.abs(other) >= 0.01) rows.push({ label: 'Other', text: 'bonuses / misc', pts: other });
  return { pts: total, rows };
}

/** This week's stats for one player, refreshed at most every 20s (live). null = no stats yet. */
export async function loadPlayerWeek(id: string, season: string, week: number, force = false): Promise<any | null> {
  const j = await getJSON<Record<string, any>>(`https://api.sleeper.com/stats/nfl/player/${encodeURIComponent(id)}?season_type=regular&season=${season}&grouping=week`, 20_000, { force, key: `pl_live_${season}_${id}`, persist: false });
  const row = j?.[String(week)];
  return row && row.stats && Object.keys(row.stats).length ? { stats: row.stats, opp: row.opponent } : null;
}

/** Show the live card? Only for THIS week's game once it has kicked off (live, or final). */
export const showLive = (state?: string) => state === 'in' || state === 'post';
