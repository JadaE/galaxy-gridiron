// Sleeper's players feed contains placeholder and stale entries. Pure TS (Node-testable).
// Raw-feed patterns seen Oct 21 2026 (players/nfl, ~11k rows):
//  * "Duplicate Player" rows (dozens; e.g. 5282 WR CHI Inactive active:false) and "<Name> DUPLICATE" (13782)
//  * active:false with a stale team (Dwayne Haskins PIT, Glen Coffee SF, Myles White NYJ...)
//  * retired players with short numeric ids (Tim Hightower id 83, Brent Celek, Knowshon Moreno: 378 of them)
//    that slipped through because ids of 3 chars or fewer were treated as team defenses
//  * no team + not 'Active' status (retired / long gone)
//  * no position / no fantasy positions (240 / 322), missing first or last name
//  * ~1,450 team-less "Active" players with no 2025/2026 stats, no projection and search_rank 9999999
//    (stale free agents). They're kept (they might sign) but hidden from chat matching and pickups.
export const JUNK_NAME = /\bduplicate\b|placeholder|\btest player\b|\bunknown player\b|\btbd\b|\bplayer \d+\b|^player$/i;
export const TEAMS = new Set('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LAR MIA MIN NE NO NYG NYJ PHI PIT SF SEA TB TEN WAS'.split(' '));
const FPOS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

/** Why a raw Sleeper players/nfl row should be dropped, or null to keep it. */
export function rawJunkReason(id: string, p: any): string | null {
  if (!p) return 'empty row';
  const fp: string[] = (p.fantasy_positions || [p.position]).filter((x: string) => FPOS.has(x));
  if (!fp.length) return 'no fantasy position';
  if (p.position === 'DEF' || fp[0] === 'DEF') return TEAMS.has(id) ? null : 'defense row without a team id';
  const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
  if (!name || !p.first_name || !p.last_name) return 'missing name';
  if (JUNK_NAME.test(name) || JUNK_NAME.test(p.last_name || '')) return 'placeholder name';
  if (p.active === false) return 'Sleeper marks inactive (active:false)';
  if (!p.team && p.status !== 'Active') return 'no team and not active (retired)';
  return null;
}

/** Same idea for the slim cached record (names only). Catches rows cached by older app versions too. */
/** Slim-player check used by the app (sheet, chat, pools). */
export const isJunkPlayer = (p?: { n?: string; p?: string }) => slimJunk(p);
export const slimJunk = (p?: { n?: string; p?: string }) => !p || !p.n || !p.p || JUNK_NAME.test(p.n);
