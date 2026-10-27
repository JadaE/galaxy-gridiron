import { sleeper, stats, fantasyCalc, P, MIN, DAY, HOUR } from './api';
import { Valuer } from './valuation';
import { slimJunk } from './junk';
import { recordSnapshot } from './news';
import { GameInfo, Allowed, loadGames, pointsAllowed, practiceFor } from './gameinfo';

export type Team = { rid: number; ownerId: string; name: string; display: string; avatar?: string; wins: number; losses: number; ties: number; pf: number; pa: number; ppts: number; rank: number; pfRank: number; players: string[]; starters: string[]; reserve: string[]; waiverPos?: number };
export type Bundle = {
  league: any; state: any; season: string; isPast: boolean; userId: string;
  week: number; lastScored: number; leg: number;
  teams: Team[]; me: Team; byRid: Record<number, Team>;
  weekly: Record<number, any[]>;
  proj: Record<string, number[]>; season_: Record<string, number[]>;
  players: Record<string, P>; trending: { player_id: string; count: number }[];
  fc: Record<string, number> | null; tx: any[]; si: number; slots: string[];
  loadedAt: number; valuer: Valuer; sched: { byes: Record<string, number>; opp: Record<string, string> } | null;
  playoffStart: number; playoffTeams: number;
  /** v0.0.7: this week's games by team (ESPN), fantasy points allowed by defense/position, practice notes for her injured players */
  games: Record<string, GameInfo> | null; allowed: Allowed; practice: Record<string, { text: string; full: boolean; ts: number }>;
};

export const FLEX_ELIG: Record<string, string[]> = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};
export const slotLabel = (s: string) => ({ WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', SUPER_FLEX: 'SF', FLEX: 'FLEX' } as any)[s] || s;
const BAD = new Set(['IR', 'Out', 'NA', 'Sus', 'PUP', 'DNR', 'COV']);
export const isOut = (inj?: string) => !!inj && BAD.has(inj);
/** v0.0.7: tagged IR/Out but Sleeper still projects points this week (e.g. IR window over, practicing in full). */
export const outButProjected = (b: Bundle, id: string) => isOut(b.players[id]?.i) && (b.proj[id]?.[b.si] ?? 0) > 0;
/** Counts as 0 this week: empty slot, or Out/IR with no live projection. Matches how Sleeper totals a lineup. */
export const deadThisWeek = (b: Bundle, id: string | null) => !id || id === '0' || (isOut(b.players[id]?.i) && !outButProjected(b, id));

const num = (a?: number, d?: number) => (a || 0) + (d || 0) / 100;

export async function loadUser(username: string) {
  const u = await sleeper.user(username);
  if (!u || !u.user_id) throw new Error(`No Sleeper user named "${username}"`);
  return u;
}

/** Current-season leagues plus every previous season reachable through previous_league_id. */
export async function loadLeagues(userId: string, force?: boolean) {
  const st = await sleeper.state(force);
  const season = st.league_season || st.season;
  const cur = (await sleeper.leagues(userId, season, force)) || [];
  const out: any[] = [...cur];
  const seen = new Set(out.map(l => l.league_id));
  for (const l of cur) {
    let prev = l.previous_league_id;
    let guard = 0;
    while (prev && prev !== '0' && !seen.has(prev) && guard++ < 5) {
      try { const pl = await sleeper.league(prev); seen.add(prev); out.push(pl); prev = pl.previous_league_id; } catch { break; }
    }
  }
  // also last season's leagues even if not chained (e.g. leagues that didn't renew)
  try {
    const prevSeason = String(Number(season) - 1);
    for (const l of (await sleeper.leagues(userId, prevSeason)) || []) if (!seen.has(l.league_id)) { seen.add(l.league_id); out.push(l); }
  } catch {}
  out.sort((a, b) => (b.season.localeCompare(a.season)) || a.name.localeCompare(b.name));
  return { state: st, leagues: out };
}

/** Keep only stat rows whose team's game this week is final (row[6] = team; DEF ids are the team). */
export function finishedOnly(rows: Record<string, any[]>, games: Record<string, { state: string }>) {
  const o: Record<string, any[]> = {};
  for (const id in rows) { const t = rows[id]?.[6] || id; if (games[t]?.state === 'post') o[id] = rows[id]; }
  return o;
}
export async function loadBundle(leagueId: string, userId: string, force = false): Promise<Bundle> {
  const [state, league, users, rosters, players] = await Promise.all([
    sleeper.state(force), sleeper.league(leagueId, force), sleeper.users(leagueId, force), sleeper.rosters(leagueId, force), sleeper.players(),
  ]);
  for (const id in players) if (slimJunk(players[id])) delete players[id]; // belt and braces for older caches
  const isPast = league.status === 'complete';
  const season = league.season;
  const lastScored = Number(league.settings?.last_scored_leg ?? (isPast ? 17 : state.display_week ?? state.week - 1));
  const leg = Number(league.settings?.leg ?? state.leg ?? state.week);
  const week = isPast ? lastScored : Math.max(1, Number(state.week || leg));
  const uMap: Record<string, any> = {};
  for (const u of users || []) uMap[u.user_id] = u;
  const teams: Team[] = (rosters || []).map((r: any) => {
    const u = uMap[r.owner_id] || {};
    const s = r.settings || {};
    return {
      rid: r.roster_id, ownerId: r.owner_id, display: u.display_name || `Team ${r.roster_id}`,
      name: u.metadata?.team_name || u.display_name || `Team ${r.roster_id}`, avatar: u.avatar,
      wins: s.wins || 0, losses: s.losses || 0, ties: s.ties || 0, pf: num(s.fpts, s.fpts_decimal), pa: num(s.fpts_against, s.fpts_against_decimal), ppts: num(s.ppts, s.ppts_decimal),
      rank: 0, pfRank: 0, players: r.players || [], starters: r.starters || [], reserve: r.reserve || [], waiverPos: s.waiver_position,
    };
  });
  [...teams].sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.pf - a.pf).forEach((t, i) => (t.rank = i + 1));
  [...teams].sort((a, b) => b.pf - a.pf).forEach((t, i) => (t.pfRank = i + 1));
  const me = teams.find(t => t.ownerId === userId) || teams.find(t => (rosters.find((r: any) => r.roster_id === t.rid)?.co_owners || []).includes(userId))!;
  if (!me) throw new Error('Could not find your roster in this league');
  const byRid: Record<number, Team> = {};
  teams.forEach(t => (byRid[t.rid] = t));

  const maxW = isPast ? Math.min(18, lastScored) : week;
  const weekNums = Array.from({ length: maxW }, (_, i) => i + 1);
  const weeklyArr = await Promise.all(weekNums.map(w => sleeper.matchups(leagueId, w, isPast || w < week ? DAY : MIN, force && w >= week - 1).catch(() => [])));
  const weekly: Record<number, any[]> = {};
  weekNums.forEach((w, i) => (weekly[w] = weeklyArr[i] || []));

  const rec = league.scoring_settings?.rec ?? 1;
  const si = rec >= 0.75 ? 0 : rec >= 0.25 ? 1 : 2;
  const numTeams = league.total_rosters || teams.length;
  const legs = isPast ? [] : Array.from({ length: leg + 1 }, (_, i) => i + 1);
  const [proj, season_, trending, fc, txArr] = await Promise.all([
    isPast ? Promise.resolve({}) : (league.scoring_settings ? stats.projectionsLeague(season, week, leagueId, league.scoring_settings, force) : stats.projections(season, week, force)).catch(() => stats.projections(season, week).catch(() => ({}))),
    stats.season(season, force).catch(() => ({})),
    isPast ? Promise.resolve([]) : sleeper.trending(force).catch(() => []),
    isPast ? Promise.resolve(null) : fantasyCalc(numTeams, rec >= 0.75 ? 1 : rec >= 0.25 ? 0.5 : 0, force).catch(() => null),
    Promise.all(legs.map(l => sleeper.transactions(leagueId, l, force && l >= leg - 1).catch(() => []))),
  ]);
  const statWeeks = isPast ? [] : Array.from({ length: lastScored }, (_, i) => i + 1);
  const hurt = isPast ? [] : me.players.filter(id => players[id]?.i);
  const sc = league.scoring_settings || {};
  const [wkArr, sched, games, practice, prior1, prior2] = await Promise.all([
    Promise.all(statWeeks.map(w => stats.weekFull(season, w, w < lastScored ? DAY : HOUR, force && w === lastScored).catch(() => ({})))),
    isPast ? Promise.resolve(null) : stats.schedule(season).catch(() => null),
    isPast ? Promise.resolve(null) : loadGames(season, week, force).catch(() => null),
    isPast ? Promise.resolve({}) : practiceFor(hurt).catch(() => ({})),
    isPast ? Promise.resolve({}) : stats.priorSeason(String(Number(season) - 1), leagueId, sc).catch(() => ({})),
    isPast ? Promise.resolve({}) : stats.priorSeason(String(Number(season) - 2), leagueId, sc).catch(() => ({})),
  ]);
  const weeksFull: Record<number, Record<string, any[]>> = {};
  statWeeks.forEach((w, i) => (weeksFull[w] = (wkArr as any[])[i] || {}));
  // v0.0.8: Sleeper only marks a week scored on Tuesday, so Sunday's finished games were missing from player cards
  // until then. Add the current week's stats for games that are FINAL (live games would count as a full low game).
  if (!isPast && week > lastScored && games) {
    const part = await stats.weekPartial(season, week, force).catch(() => null);
    if (part) weeksFull[week] = finishedOnly(part, games as any);
  }
  // v0.0.7: prior-season baseline (per game, league scoring): id -> [ppgLast, gpLast, ppg2Ago, gp2Ago]
  const prior: Record<string, number[]> = {};
  for (const id in prior1 as any) prior[id] = [(prior1 as any)[id][0], (prior1 as any)[id][1], 0, 0];
  for (const id in prior2 as any) (prior[id] ||= [0, 0, 0, 0]).splice(2, 2, (prior2 as any)[id][0], (prior2 as any)[id][1]);
  const valuer = new Valuer(weeksFull, players as any, si, numTeams, prior, String(Number(season) - 1));
  let allowed: Allowed = {};
  try { allowed = pointsAllowed(weeksFull, (sched as any)?.opp, id => players[id]?.p || (id.length <= 3 ? 'DEF' : ''), si); } catch {}
  const tx = (txArr as any[][]).flat().sort((a, b) => (b.status_updated || b.created) - (a.status_updated || a.created));
  const slots = (league.roster_positions || []).filter((s: string) => s !== 'BN' && s !== 'IR' && s !== 'TAXI');
  const out: Bundle = { league, state, season, isPast, userId, week, lastScored, leg, teams, me, byRid, weekly, proj: proj as any, season_: season_ as any, players, trending: trending as any, fc: fc as any, tx, si, slots, loadedAt: Date.now(), valuer, sched: sched as any, playoffStart: Number(league.settings?.playoff_week_start || 15), playoffTeams: Number(league.settings?.playoff_teams || 6), games: games as any, allowed, practice: practice as any };
  if (!isPast) { const ros = new Set(teams.flatMap(t => t.players)); recordSnapshot(players, id => ros.has(id) || isRelevant(out, id)); }
  return out;
}

// ---------- helpers ----------
export const pname = (b: Bundle, id: string) => b.players[id]?.n || id;
export const ppos = (b: Bundle, id: string) => b.players[id]?.p || (id.length <= 3 ? 'DEF' : '?');
export const elig = (b: Bundle, id: string) => b.players[id]?.f || [ppos(b, id)];
export const projOf = (b: Bundle, id: string) => b.proj[id]?.[b.si] ?? 0;
export const hasProj = (b: Bundle, id: string) => !!b.proj[id];
export function ppg(b: Bundle, id: string) {
  const s = b.season_[id];
  if (!s || !s[3]) return 0;
  return s[b.si] / s[3];
}
/** Consistency value. Players with no usable stat rows (Sleeper's stats feed can list a player with empty stats,
 * e.g. Josh Jacobs in 2026, or not list him at all) fall back to 85% of this week's projection instead of 0;
 * players with only 1-2 games are blended with the projection. See valueSource(). */
export function val(b: Bundle, id: string) {
  if (b.isPast) return ppg(b, id);
  const v = b.valuer.get(id);
  const p = hasProj(b, id) ? projOf(b, id) : 0;
  if (v.games === 0) return v.prior ? (p > 0 ? 0.5 * v.value + 0.5 * p * 0.85 : v.value) : p * 0.85;
  if (v.games < 3 && p > 0 && !v.prior) return (v.value * v.games + p * 0.85 * (3 - v.games)) / 3;
  return v.value;
}
export const valueSource = (b: Bundle, id: string): 'stats' | 'blend' | 'projection' | 'none' => {
  const g = b.valuer.get(id).games, p = hasProj(b, id);
  return g >= 3 ? 'stats' : g > 0 ? (p ? 'blend' : 'stats') : p ? 'projection' : 'none';
};
/** rest-of-season-ish score used for pickups/drops: this week's projection blended with consistency value */
export function ros(b: Bundle, id: string) {
  const v = val(b, id), p = projOf(b, id);
  if (!hasProj(b, id)) return v * 0.9;
  return 0.5 * p + 0.5 * v;
}
export const byeWeek = (b: Bundle, id: string) => { const t = b.players[id]?.t; return t && b.sched ? b.sched.byes[t] : undefined; };
/** v0.0.6: personal nickname labels were removed (the app is shared now). Kept as a no-op so call sites stay simple. */
export const famLabel = (_display: string) => '';
export const seasonPts = (b: Bundle, id: string) => b.season_[id]?.[b.si] ?? 0;
export const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '-');
export const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

/** Greedy optimal lineup by value (fills strict slots first, then flexes). */
export function optimalLineup(b: Bundle, ids: string[], val: (id: string) => number, ignoreInjury = false) {
  const pool = ignoreInjury ? ids : ids.filter(id => !isOut(b.players[id]?.i) || outButProjected(b, id));
  const order = [...b.slots].map((s, i) => ({ s, i })).sort((a, c) => (FLEX_ELIG[a.s]?.length || 9) - (FLEX_ELIG[c.s]?.length || 9));
  const used = new Set<string>();
  const res: { slot: string; id: string | null; v: number }[] = b.slots.map(s => ({ slot: s, id: null, v: 0 }));
  for (const { s, i } of order) {
    const el = FLEX_ELIG[s] || [s];
    let best: string | null = null, bv = -1;
    for (const id of pool) if (!used.has(id) && elig(b, id).some(p => el.includes(p)) && val(id) > bv) { best = id; bv = val(id); }
    if (best) { used.add(best); res[i] = { slot: s, id: best, v: bv }; }
  }
  return res;
}

// ---------- matchup ----------
export function matchupFor(b: Bundle, week: number, rid = b.me.rid) {
  const arr = b.weekly[week] || [];
  const mine = arr.find(m => m.roster_id === rid);
  if (!mine) return null;
  const opp = mine.matchup_id != null ? arr.find(m => m.matchup_id === mine.matchup_id && m.roster_id !== rid) : null;
  const sideOf = (m: any) => {
    if (!m) return null;
    const starters: string[] = m.starters || [];
    const sp: number[] = m.starters_points || [];
    const proj = starters.reduce((s, id) => s + (id && id !== '0' ? projOf(b, id) : 0), 0);
    return { rid: m.roster_id, team: b.byRid[m.roster_id], points: m.custom_points ?? m.points ?? 0, starters, sp, proj, playersPoints: m.players_points || {} };
  };
  return { me: sideOf(mine)!, opp: sideOf(opp) };
}

export function posBreakdown(b: Bundle, side: { starters: string[]; sp: number[] } | null, useProj: boolean) {
  const o: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  if (!side) return o;
  side.starters.forEach((id, i) => { if (!id || id === '0') return; const p = ppos(b, id); o[p] = (o[p] || 0) + (useProj ? projOf(b, id) : side.sp[i] || 0); });
  return o;
}

/** Her weekly scores, opponent scores and league average for every played week. */
export function weeklySeries(b: Bundle, rid = b.me.rid) {
  const out: { w: number; me: number; opp: number; avg: number; win: boolean; allPlayW: number; allPlayL: number; oppName: string }[] = [];
  for (let w = 1; w <= b.lastScored; w++) {
    const arr = b.weekly[w] || [];
    const m = matchupFor(b, w, rid);
    if (!m || !arr.length) continue;
    const pts = arr.map(x => x.points || 0);
    if (pts.every(p => p === 0)) continue;
    const me = m.me.points, opp = m.opp?.points ?? 0;
    const avg = pts.reduce((s, x) => s + x, 0) / pts.length;
    out.push({ w, me, opp, avg, win: me > opp, allPlayW: pts.filter(p => p < me).length, allPlayL: pts.filter(p => p > me).length, oppName: m.opp?.team?.display || '-' });
  }
  return out;
}

// ---------- lineup alerts ----------
export const isDef = (b: Bundle, id: string) => ppos(b, id) === 'DEF';
/** "he" for players, "it" for team defenses. */
export const pron = (b: Bundle, id: string, cap = false) => { const w = isDef(b, id) ? 'it' : 'he'; return cap ? w[0].toUpperCase() + w.slice(1) : w; };
export const pronObj = (b: Bundle, id: string) => (isDef(b, id) ? 'it' : 'him');
export type Swap = { slot: string; out: string | null; in: string; gain: number };
/** Sleeper Player AutoSubs (league setting max_subs > 0). Which subs a manager set is NOT in Sleeper's public API. */
export const autoSubs = (b: Bundle) => Number(b.league?.settings?.max_subs || 0);
const curPts = (b: Bundle, id: string | null) => (deadThisWeek(b, id) ? 0 : projOf(b, id!));
/** Best lineup vs her current one, as explicit slot-by-slot swaps (each starter slot holds exactly one player). */
export function lineupGap(b: Bundle) {
  const starters = b.me.starters;
  const opt = optimalLineup(b, b.me.players.filter(x => !b.me.reserve.includes(x)), id => projOf(b, id));
  const optSum = opt.reduce((s, x) => s + x.v, 0);
  const curSum = starters.reduce((s, id) => s + curPts(b, id), 0);
  const optIds = new Set(opt.map(o => o.id).filter(Boolean) as string[]);
  const cur = new Set(starters.filter(id => !deadThisWeek(b, id)));
  const ins = opt.filter(o => o.id && !cur.has(o.id)).map(o => o.id!) as string[];
  const outSlots = b.slots.map((slot, i) => ({ slot, id: starters[i] && starters[i] !== '0' ? starters[i] : null })).filter(x => !x.id || !optIds.has(x.id) || deadThisWeek(b, x.id));
  const swaps: Swap[] = [];
  const left = [...ins];
  for (const o of outSlots) {
    const el = FLEX_ELIG[o.slot] || [o.slot];
    const k = left.findIndex(id => elig(b, id).some(p => el.includes(p)));
    const pick = k >= 0 ? left.splice(k, 1)[0] : left.shift();
    if (pick) swaps.push({ slot: o.slot, out: o.id, in: pick, gain: projOf(b, pick) - curPts(b, o.id) });
  }
  return { opt, optSum, curSum, swaps };
}
const swapText = (b: Bundle, s: Swap) => `${slotLabel(s.slot)}: ${s.out ? pname(b, s.out) : 'empty'} → ${pname(b, s.in)} (+${fmt(s.gain)})`;

export function lineupAlerts(b: Bundle) {
  if (b.isPast) return [];
  const alerts: { kind: 'swap' | 'empty' | 'bye' | 'q'; text: string; out?: string; in?: string }[] = [];
  const starters = b.me.starters;
  const bench = b.me.players.filter(id => !starters.includes(id) && !b.me.reserve.includes(id));
  const usedBench = new Set<string>();
  const subs = autoSubs(b);
  const subLater = !!b.league?.settings?.sub_start_time_eligibility;
  const prac = (id: string) => b.practice?.[id];
  const ko = (id: string) => { const t = b.players[id]?.t; return t ? b.games?.[t]?.kickoff : undefined; };
  const hasP = Object.keys(b.proj).length > 50;
  const gap = hasP ? lineupGap(b) : null;
  const best = gap ? fmt(gap.optSum) : '';
  starters.forEach((id, i) => {
    const slot = b.slots[i];
    const el = FLEX_ELIG[slot] || [slot];
    const pickBench = () => bench.filter(x => !usedBench.has(x) && !deadThisWeek(b, x) && elig(b, x).some(p => el.includes(p))).sort((x, y) => projOf(b, y) - projOf(b, x))[0];
    if (!id || id === '0') {
      const r = pickBench();
      if (r) usedBench.add(r);
      alerts.push({ kind: 'empty', text: `Empty ${slotLabel(slot)} slot${r ? ` - ${pname(b, r)} could fill it` : ''}`, in: r });
      return;
    }
    const inj = b.players[id]?.i;
    const noProj = hasP && !hasProj(b, id);
    if (outButProjected(b, id)) {
      const r = pickBench();
      const n = pname(b, id), P = pron(b, id), pr = prac(id);
      const plan = subs > 0 ? (r ? ` Set an AutoSub in Sleeper (best: ${pname(b, r)}, ${fmt(projOf(b, r))} proj) in case ${P}'s inactive. If you already did, you're set (Sleeper doesn't share AutoSubs publicly, so the app can't see them).` : ` Set an AutoSub in Sleeper in case ${P}'s inactive.`) : r ? ` If ${P}'s ruled out, ${pname(b, r)} (${fmt(projOf(b, r))} proj) is your best swap.` : '';
      alerts.push({ kind: 'q', text: `${n} is tagged ${inj} but still projects ${fmt(projOf(b, id))}${pr ? ` (${pr.text})` : ''}, so ${P} may return this week.${plan}`, out: id });
      return;
    }
    if (isOut(inj) || noProj) {
      const r = pickBench();
      if (r) usedBench.add(r);
      const n = pname(b, id), P = pron(b, id);
      const pr = prac(id);
      const practiced = isOut(inj) && pr?.full ? ` ${P[0].toUpperCase() + P.slice(1)} practiced in full (${pr.text.replace('full practice', '').trim() || 'this week'}), so ${P} may be activated.` : '';
      let text: string;
      if (!isOut(inj)) text = `${n} has no projection (bye week?) but is starting at ${slotLabel(slot)}.${r ? ` Start ${pname(b, r)} (${fmt(projOf(b, r))} proj) instead.` : ' No healthy bench option - check waivers.'}`;
      else if (r && subs > 0 && !(subLater && (ko(r) ?? 0) < (ko(id) ?? 0))) {
        // League AutoSubs: if she already set the bench player as the sub, the lineup is effectively maxed.
        text = `${n} is ${inj} but is starting at ${slotLabel(slot)}.${practiced} If ${pname(b, r)} (${fmt(projOf(b, r))} proj) is your AutoSub for ${isDef(b, id) ? 'it' : 'him'},{MAXED} Otherwise swap ${pname(b, r)} in. Keep ${n} in if ${P}'s activated.`;
      } else text = `${n} is ${inj} but is starting at ${slotLabel(slot)}.${practiced}${r ? ` Start ${pname(b, r)} (${fmt(projOf(b, r))} proj) instead.` : ' No healthy bench option - check waivers.'}`;
      alerts.push({ kind: isOut(inj) ? 'swap' : 'bye', text, out: id, in: r });
    } else if (inj === 'Questionable' || inj === 'Doubtful') {
      const pr = prac(id);
      alerts.push({ kind: 'q', text: `${pname(b, id)} is ${inj}${pr ? ` (${pr.text})` : ''} - check news before kickoff.`, out: id });
    }
  });
  // IR-slot players who practiced in full
  for (const id of b.me.reserve) { const pr = prac(id); if (pr?.full) alerts.push({ kind: 'q', text: `${pname(b, id)} (IR slot) had a ${pr.text}. ${pron(b, id, true)} may be back soon.`, out: id }); }
  if (gap && gap.optSum - gap.curSum >= 1 && gap.swaps.length) {
    const covered = gap.swaps.every(s => alerts.some(a => a.out === s.out && a.in === s.in && s.out));
    const plus = `+${fmt(gap.optSum - gap.curSum)}`;
    if (covered) {
      // the per-player alerts above already name every swap: just say where it gets her
      const mine = alerts.filter(a => gap.swaps.some(s => s.out === a.out && a.in === s.in));
      const last = mine[mine.length - 1];
      if (mine.every(a => a.text.includes('{MAXED}'))) mine.forEach(a => (a.text = a.text.replace('{MAXED}', ` you're already maxed (${best}${mine.length > 1 ? ` with all ${mine.length} subs` : ''}).`)));
      else last.text += ` That gets you to your best lineup: ${best} (${plus}).`;
    } else {
      alerts.push({ kind: 'swap', text: `Best lineup projects ${best} vs your current ${fmt(gap.curSum)} (${plus}). Swaps: ${gap.swaps.map(s => swapText(b, s)).join('; ')}. Everything else stays (one player per slot).` });
    }
  }
  alerts.forEach(a => (a.text = a.text.replace('{MAXED}', " you're covered.")));
  if (subs > 0 && alerts.some(a => a.kind === 'swap')) alerts.push({ kind: 'q', text: `Your league allows ${subs} AutoSub${subs > 1 ? 's' : ''} a week. Sleeper doesn't share which ones you set, so the app can't see them.` });
  return alerts;
}

// ---------- waivers ----------
export function myTx(b: Bundle) { return b.tx.filter(t => (t.roster_ids || []).includes(b.me.rid)); }
export function waiverReport(b: Bundle) {
  const mine = myTx(b).filter(t => t.type === 'waiver');
  if (!mine.length) return { latest: [], runAt: null as number | null, season: { ok: 0, fail: 0 }, usesFaab: false, budgetUsed: 0 };
  const runAt = Math.max(...mine.map(t => t.status_updated || t.created));
  const latest = mine.filter(t => runAt - (t.status_updated || t.created) < 6 * 3600_000);
  const usesFaab = b.tx.some(t => t.settings?.waiver_bid != null) || (b.league.settings?.waiver_budget ?? 0) > 0 && b.league.settings?.waiver_type === 2;
  return {
    latest, runAt,
    season: { ok: mine.filter(t => t.status === 'complete').length, fail: mine.filter(t => t.status === 'failed' && !mine.some(o => o.status === 'complete' && o.adds && t.adds && Object.keys(t.adds)[0] in o.adds && Math.abs((o.status_updated || 0) - (t.status_updated || 0)) < 6 * 3600_000)).length },
    usesFaab, budgetUsed: mine.filter(t => t.status === 'complete').reduce((s, t) => s + (t.settings?.waiver_bid || 0), 0),
  };
}
export const txReason = (t: any, run: any[] = []) => {
  const n: string = t.metadata?.notes || '';
  if (t.status === 'complete') return 'Claim processed';
  const add = t.adds ? Object.keys(t.adds)[0] : null;
  if (add && run.some(o => o !== t && o.status === 'complete' && o.adds && add in o.adds)) return 'Backup claim - you already got him with another claim';
  if (/another owner/i.test(n)) return 'Claimed by another team (higher priority)';
  if (/too many players/i.test(n)) return 'No drop picked - roster would be over the limit';
  return n || 'Failed';
};

/** For each completed add, compare the added player vs the dropped player this season. */
export function movesScorecard(b: Bundle) {
  return myTx(b).filter(t => t.status === 'complete' && (t.type === 'waiver' || t.type === 'free_agent') && t.adds).map(t => {
    const add = Object.keys(t.adds).find(k => t.adds[k] === b.me.rid)!;
    const drop = t.drops ? Object.keys(t.drops).find(k => t.drops[k] === b.me.rid) : undefined;
    const a = ppg(b, add), d = drop ? ppg(b, drop) : 0;
    return { t, add, drop, addPpg: a, dropPpg: d, diff: a - d, still: b.me.players.includes(add) };
  }).filter(x => x.add);
}

/** A real, findable player: not a placeholder, and either rostered, on an NFL team, ranked by Sleeper, projected,
 * or with games this season. Retired players and stale free agents with no data fail this. */
export function isRelevant(b: Bundle, id: string) {
  const p = b.players[id];
  if (slimJunk(p)) return false;
  if (p.p === 'DEF') return true;
  if (b.teams.some(t => t.players.includes(id))) return true;
  return !!(p.t || p.r || b.proj[id] || b.valuer.get(id).games > 0);
}
export function rosteredSet(b: Bundle) { const s = new Set<string>(); b.teams.forEach(t => t.players.forEach(p => s.add(p))); return s; }

/** Free agents ranked by how much they'd improve her weakest eligible starter. */
export function freeAgentFits(b: Bundle, limit = 20) {
  const rostered = rosteredSet(b);
  const trend: Record<string, number> = {};
  b.trending.forEach(t => (trend[t.player_id] = t.count));
  const mine = b.me.players.filter(x => !b.me.reserve.includes(x));
  const value = (id: string) => Math.max(projOf(b, id), 0) * 0.7 + ppg(b, id) * 0.3;
  const opt = optimalLineup(b, mine, value);
  const weakest: Record<string, { id: string | null; v: number }> = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const cands = opt.filter(o => (FLEX_ELIG[o.slot] || [o.slot]).includes(pos));
    if (!cands.length) continue;
    const w = cands.reduce((m, o) => (o.v < m.v ? o : m), cands[0]);
    weakest[pos] = { id: w.id, v: w.v };
  }
  const pool = new Set([...Object.keys(b.proj), ...Object.keys(trend)]);
  const res: { id: string; pos: string; proj: number; ppg: number; gain: number; over: string | null; trend: number; v: number }[] = [];
  pool.forEach(id => {
    if (rostered.has(id)) return;
    const pl = b.players[id];
    if (!pl || isOut(pl.i) || !pl.t) return;
    const pos = pl.p;
    const w = weakest[pos];
    if (!w) return;
    const v = value(id);
    const gain = v - w.v;
    res.push({ id, pos, proj: projOf(b, id), ppg: ppg(b, id), gain, over: w.id, trend: trend[id] || 0, v });
  });
  res.sort((a, c) => c.gain + Math.log10(1 + c.trend) * 0.25 - (a.gain + Math.log10(1 + a.trend) * 0.25));
  return { list: res.slice(0, limit), weakest };
}

// ---------- trades ----------
export function positionStrength(b: Bundle, t: Team) {
  const v = (id: string) => b.fc?.[id] ?? ppg(b, id) * 100;
  const need: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1 };
  b.slots.forEach(s => { if (s === 'FLEX') { need.RB += 0.4; need.WR += 0.4; need.TE += 0.2; } if (s === 'WRRB_FLEX') { need.RB += 0.5; need.WR += 0.5; } if (s === 'SUPER_FLEX') need.QB += 1; });
  const o: Record<string, { starters: number; depth: string[]; all: string[] }> = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const ids = t.players.filter(id => ppos(b, id) === pos && !isOut(b.players[id]?.i)).sort((x, y) => v(y) - v(x));
    const n = Math.round(need[pos]);
    o[pos] = { starters: ids.slice(0, n).reduce((s, id) => s + v(id), 0) / Math.max(1, n), depth: ids.slice(n), all: ids };
  }
  return o;
}

export function tradeIdeas(b: Bundle, limit = 8) {
  if (!b.fc) return { ideas: [] as any[], myWeak: [] as string[], myStrong: [] as string[], source: 'none' };
  const fc = b.fc;
  const val = (id: string) => fc[id] || 0;
  const strengths = b.teams.map(t => ({ t, s: positionStrength(b, t) }));
  const avg: Record<string, number> = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE']) avg[pos] = strengths.reduce((s, x) => s + x.s[pos].starters, 0) / strengths.length;
  const mineS = strengths.find(x => x.t.rid === b.me.rid)!.s;
  const rel = (s: any, pos: string) => s[pos].starters / (avg[pos] || 1);
  const posOrder = ['QB', 'RB', 'WR', 'TE'].sort((p, q) => rel(mineS, p) - rel(mineS, q));
  const myWeak = posOrder.slice(0, 2), myStrong = posOrder.slice(2).reverse();
  const ideas: any[] = [];
  const nStart: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1 };
  b.slots.forEach(sl => { if (sl === 'SUPER_FLEX') nStart.QB += 1; if (sl === 'FLEX' || sl === 'WRRB_FLEX') { nStart.RB += 0.5; nStart.WR += 0.5; } });
  const startersAt = (pos: string, without: string[] = [], plus: string[] = []) => {
    const ids = [...mineS[pos].all.filter(id => !without.includes(id)), ...plus.filter(id => ppos(b, id) === pos)].sort((x, y) => val(y) - val(x));
    return ids.slice(0, Math.round(nStart[pos])).reduce((t, id) => t + val(id), 0);
  };
  const lineupValue = (without: string[], plus: string[]) => ['QB', 'RB', 'WR', 'TE'].reduce((t, pos) => t + startersAt(pos, without, plus), 0);
  const base = lineupValue([], []);
  const myGiveAll = b.me.players.filter(id => ['QB', 'RB', 'WR', 'TE'].includes(ppos(b, id)) && val(id) > 0);
  for (const { t, s } of strengths) {
    if (t.rid === b.me.rid) continue;
    for (const need of ['QB', 'RB', 'WR', 'TE']) {
      const targets = s[need].all.filter(id => val(id) > 0).slice(0, 4);
      for (const target of targets) {
        const tv = val(target);
        for (const g of myGiveAll) {
          if (ppos(b, g) === need) continue;
          const gv = val(g), ratio = gv / tv;
          if (ratio < 0.88 || ratio > 1.15) continue;
          const net = lineupValue([g], [target]) - base;
          if (net <= tv * 0.04) continue;
          const theyNeed = rel(s, ppos(b, g)) < 1;
          ideas.push({ team: t, give: [g], get: [target], giveV: gv, getV: tv, net, score: net * (theyNeed ? 1.3 : 1), theyNeed, need });
        }
        for (let i = 0; i < myGiveAll.length; i++) for (let j = i + 1; j < myGiveAll.length; j++) {
          const g1 = myGiveAll[i], g2 = myGiveAll[j];
          if (Math.max(val(g1), val(g2)) >= tv) continue;
          const sv = val(g1) + val(g2), ratio = sv / tv;
          if (ratio < 1.0 || ratio > 1.3) continue;
          const net = lineupValue([g1, g2], [target]) - base;
          if (net <= tv * 0.06) continue;
          const theyNeed = rel(s, ppos(b, g1)) < 1 || rel(s, ppos(b, g2)) < 1;
          ideas.push({ team: t, give: [g1, g2], get: [target], giveV: sv, getV: tv, net, score: net * 0.9 * (theyNeed ? 1.3 : 1), theyNeed, need });
        }
      }
    }
  }
  ideas.sort((a, c) => c.score - a.score);
  const seen = new Set<string>(); const out: any[] = [];
  const perTeam: Record<number, number> = {};
  for (const i of ideas) { const k = i.get[0] + '|' + i.give.join(','); if ((perTeam[i.team.rid] = (perTeam[i.team.rid] || 0) + 1) > 2) continue; if (seen.has(k)) continue; seen.add(k); out.push(i); if (out.length >= limit) break; }
  return { ideas: out, myWeak, myStrong, source: 'FantasyCalc', avg, mine: mineS };
}

/** Top contributors: points each player scored while in her starting lineup this season. */
export function contributors(b: Bundle) {
  const o: Record<string, { pts: number; starts: number }> = {};
  for (let w = 1; w <= b.lastScored; w++) {
    const m = (b.weekly[w] || []).find(x => x.roster_id === b.me.rid);
    if (!m) continue;
    (m.starters || []).forEach((id: string, i: number) => { if (!id || id === '0') return; o[id] = o[id] || { pts: 0, starts: 0 }; o[id].pts += m.starters_points?.[i] || 0; o[id].starts++; });
  }
  return Object.entries(o).map(([id, v]) => ({ id, ...v, onTeam: b.me.players.includes(id) })).sort((a, c) => c.pts - a.pts);
}

export function summary(b: Bundle) {
  const ws = weeklySeries(b);
  const apW = ws.reduce((s, x) => s + x.allPlayW, 0), apL = ws.reduce((s, x) => s + x.allPlayL, 0);
  const n = b.teams.length;
  const avgPF = b.teams.reduce((s, t) => s + t.pf, 0) / n;
  const paRank = [...b.teams].sort((x, y) => y.pa - x.pa).findIndex(t => t.rid === b.me.rid) + 1;
  const games = b.me.wins + b.me.losses + b.me.ties;
  const expectedWins = games && apW + apL ? (apW / (apW + apL)) * games : 0;
  return { ws, apW, apL, avgPF, paRank, expectedWins, luck: b.me.wins - expectedWins, n, eff: b.me.ppts ? b.me.pf / b.me.ppts : 0 };
}
