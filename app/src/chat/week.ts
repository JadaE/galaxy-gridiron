// v0.0.7: "X or Y?" during the season is a THIS-WEEK start/sit question. Score = Sleeper's projection for this week,
// nudged (a little) by the Vegas implied team total and how many fantasy points the opponent allows to that position.
// Every reason shown is a real number from Sleeper / ESPN; anything missing is just left out.
import { Bundle, pname, ppos, projOf, hasProj, isOut, fmt, ordinal, matchupFor, lineupGap, optimalLineup, isDef, deadThisWeek } from '../model';
import { GameInfo, leagueAvgAllowed, kickoffCT } from '../gameinfo';

const clamp = (x: number, a: number) => Math.max(-a, Math.min(a, x));
const r1 = (n: number) => Math.round(n * 10) / 10;
export type WeekInfo = {
  id: string; pos: string; team?: string; g: GameInfo | null; bye: boolean; out: boolean; proj: number;
  allowed?: { avg: number; rank: number; n: number }; adj: number; score: number;
};

export function weekInfo(b: Bundle, id: string): WeekInfo {
  const pos = ppos(b, id), team = b.players[id]?.t;
  const g = (team && b.games?.[team]) || null;
  const bye = !!team && !!b.games && Object.keys(b.games).length > 20 && !g; // ESPN lists every game of the week
  const out = deadThisWeek(b, id);
  const proj = projOf(b, id);
  const allowed = g ? b.allowed?.[g.opp]?.[pos] : undefined;
  let adj = 0;
  if (g && allowed && allowed.n >= 3) adj += clamp((allowed.avg - leagueAvgAllowed(b.allowed, pos)) * 0.25, 2);
  if (g) {
    if (pos === 'DEF' && g.oppImplied != null) adj += clamp((22 - g.oppImplied) * 0.15, 1.5);
    else if (pos !== 'DEF' && g.implied != null) adj += clamp((g.implied - 22.5) * 0.12, 1.5);
  }
  if (!hasProj(b, id) && !g) adj = 0;
  const score = out || bye ? 0 : Math.max(0, proj + adj);
  return { id, pos, team, g, bye, out, proj, allowed, adj, score };
}

const oppName = (b: Bundle, w: WeekInfo) => (w.g ? (w.g.home ? 'vs ' : '@ ') + w.g.opp : '');
const posLabel = (p: string) => (p === 'DEF' ? 'defenses' : ['RB', 'WR', 'TE'].includes(p) ? p + 's combined' : p + 's');
/** The opposing starting QB for D/ST answers. Uses THIS week's projections first (they follow QB changes within a
 * day, e.g. a new starter announced midweek); Sleeper's depth chart can lag, so it's only the fallback. */
export function oppQb(b: Bundle, team: string) {
  let best: string | null = null, bv = 0, dep: string | null = null, d = 99;
  for (const id in b.players) {
    const p = b.players[id];
    if (p.t !== team || p.p !== 'QB') continue;
    const v = projOf(b, id);
    if (v > bv) { best = id; bv = v; }
    if (p.d != null && p.d < d && !isOut(p.i)) { dep = id; d = p.d; }
  }
  return bv >= 3 ? best : Object.keys(b.proj).length > 50 ? null : dep;
}
const line = (g: GameInfo, team?: string) => (g.spread == null || g.total == null ? '' : ` (${g.spread === 0 ? 'even game' : `${team || ''} ${g.spread < 0 ? 'favored by' : 'underdog by'} ${Math.abs(g.spread)}`}; Vegas over/under ${g.total} = points both teams are expected to score)`);

/** One plain line of matchup facts for a player this week. */
export function matchupLine(b: Bundle, w: WeekInfo): string {
  const n = pname(b, w.id);
  if (w.bye) return `${n}: on bye this week.`;
  if (!w.g) return `${n}: no game found for week ${b.week}.`;
  const g = w.g, bits: string[] = [];
  bits.push(`${oppName(b, w)}, ${kickoffCT(g.kickoff)}`);
  if (w.pos === 'DEF') {
    if (g.oppImplied != null) bits.push(`Vegas expects ${g.opp} to score ${fmt(g.oppImplied)}${line(g, w.team)}`);
    const q = oppQb(b, g.opp);
    if (q) bits.push(`facing QB ${pname(b, q)}${b.players[q]?.i ? ` (${b.players[q].i})` : ''}`);
    if (w.allowed) bits.push(`${g.opp} gives up ${fmt(w.allowed.avg)} pts/g to defenses (${ordinal(w.allowed.rank)} most)`);
  } else {
    if (g.implied != null) bits.push(`Vegas expects ${w.team} to score ${fmt(g.implied)}${line(g, w.team)}`);
    if (w.allowed) bits.push(`${g.opp} allows ${fmt(w.allowed.avg)} pts/g to ${posLabel(w.pos)} (${ordinal(w.allowed.rank)} most)`);
  }
  const inj = b.players[w.id]?.i, pr = b.practice?.[w.id];
  if (inj || pr) bits.push(`${inj || 'status'}${pr ? `: ${pr.text}` : ''}`);
  return `${n}: ${bits.join('; ')}.`;
}

/** Projected score for both sides this week: as set, and if each side fixes empty/bye/out slots. */
export function matchupOutlook(b: Bundle) {
  const m = matchupFor(b, b.week);
  if (!m?.opp || Object.keys(b.proj).length < 50) return null;
  const set = (starters: string[]) => starters.reduce((s, id) => s + (deadThisWeek(b, id) ? 0 : projOf(b, id)), 0);
  const me = lineupGap(b);
  const oppT = m.opp.team;
  const oppBest = optimalLineup(b, oppT.players.filter(x => !oppT.reserve.includes(x)), id => projOf(b, id)).reduce((s, x) => s + x.v, 0);
  const oppSet = set(m.opp.starters);
  const dead = m.opp.starters.filter(id => deadThisWeek(b, id) || !hasProj(b, id) || projOf(b, id) <= 0).map(id => (id && id !== '0' ? pname(b, id) : 'empty slot'));
  return { opp: oppT, meSet: me.curSum, meBest: me.optSum, oppSet, oppBest, dead };
}

export type WeekCompare = { winner: string; loser: string; close: boolean; verdict: string; lines: string[]; rows: Record<string, [string, string][]> };
export function compareThisWeek(b: Bundle, a: string, c: string): WeekCompare {
  const A = weekInfo(b, a), Cc = weekInfo(b, c);
  let [W, L] = A.score >= Cc.score ? [A, Cc] : [Cc, A];
  const diff = W.score - L.score;
  const close = diff < 0.75 && !L.out && !L.bye;
  const why: string[] = [];
  const outlook = matchupOutlook(b);
  let tiebreak = '';
  if (close && outlook && A.pos === Cc.pos) {
    // close call: underdogs want ceiling (bigger team total), favorites want floor (steadier player)
    const meP = outlook.meBest, opP = outlook.oppBest;
    const ceilOf = (w: WeekInfo) => (w.pos === 'DEF' ? -(w.g?.oppImplied ?? 99) : w.g?.implied ?? 0);
    if (meP < opP - 5) {
      const [x, y] = ceilOf(A) >= ceilOf(Cc) ? [A, Cc] : [Cc, A];
      if (ceilOf(x) !== ceilOf(y)) { [W, L] = [x, y]; tiebreak = `You project behind this week (${fmt(meP)} vs ${fmt(opP)} if both lineups are full), so take the higher ceiling`; }
    } else if (meP > opP + 5) {
      const fl = (w: WeekInfo) => b.valuer.get(w.id).floor;
      const [x, y] = fl(A) >= fl(Cc) ? [A, Cc] : [Cc, A];
      if (fl(x) !== fl(y)) { [W, L] = [x, y]; tiebreak = `You project ahead this week (${fmt(meP)} vs ${fmt(opP)}), so take the safer floor (${fmt(fl(x))} vs ${fmt(fl(y))})`; }
    }
  }
  if (L.bye) why.push(`${pname(b, L.id)} is on bye`);
  else if (L.out) why.push(`${pname(b, L.id)} is ${b.players[L.id]?.i}`);
  if (W.proj - L.proj > 0.3) why.push(`higher projection this week (${fmt(W.proj)} vs ${fmt(L.proj)})`);
  if (W.g && L.g) {
    if (W.pos === 'DEF') { if (W.g.oppImplied != null && L.g.oppImplied != null && L.g.oppImplied - W.g.oppImplied >= 1) why.push(`${W.g.opp} is expected to score less (${fmt(W.g.oppImplied)} vs ${fmt(L.g.oppImplied)})`); }
    else if (W.g.implied != null && L.g.implied != null && W.g.implied - L.g.implied >= 1) why.push(`Vegas expects his team to score more (${fmt(W.g.implied)} vs ${fmt(L.g.implied)})`);
    if (W.allowed && L.allowed && W.allowed.rank + 4 <= L.allowed.rank) why.push(`softer opponent (${W.g.opp} allows ${fmt(W.allowed.avg)} vs ${fmt(L.allowed.avg)} to ${posLabel(W.pos)})`);
  }
  const subj = isDef(b, W.id) ? pname(b, W.id) : pname(b, W.id);
  const reason = (tiebreak ? [tiebreak] : []).concat(why).slice(0, 3).join('; ') || 'a slight edge in this week’s projection and matchup';
  let verdict = close && !tiebreak ? `Week ${b.week}: coin flip. Lean ${subj}: ${reason}.` : `Week ${b.week}: start ${subj}. ${reason[0].toUpperCase() + reason.slice(1)}.`;
  const lines = [A, Cc].map(w => '• ' + matchupLine(b, w));
  // locks: the earlier game decides when she has to choose
  const kicks = [A, Cc].filter(w => w.g).sort((x, y) => x.g!.kickoff - y.g!.kickoff);
  if (kicks.length === 2 && kicks[0].g!.kickoff < kicks[1].g!.kickoff - 3 * 3600_000 && kicks[0].g!.kickoff > Date.now()) lines.push(`⏰ ${pname(b, kicks[0].id)} plays first and locks ${kicks[0].g!.kickoff - Date.now() < 7 * 86400_000 ? kickoffCT(kicks[0].g!.kickoff) : 'at kickoff'}, so decide before then.`);
  if (outlook) {
    const o = outlook;
    const fix = o.dead.length && o.oppBest - o.oppSet > 1 ? ` (${fmt(o.oppBest)} if they fix ${o.dead.slice(0, 3).join(', ')}: bye, out or empty)` : '';
    lines.push(`📊 You ${fmt(o.meSet)}${o.meBest - o.meSet > 1 ? ` (${fmt(o.meBest)} best)` : ''} vs @${o.opp.display} ${fmt(o.oppSet)}${fix}.`);
  }
  const rows: Record<string, [string, string][]> = {};
  for (const w of [A, Cc]) rows[w.id] = w.bye ? [[`Wk ${b.week}`, 'BYE']] : w.g ? [[`Wk ${b.week}`, oppName(b, w)], ['Kick', kickoffCT(w.g.kickoff).replace(' CT', '')], ...(w.pos === 'DEF' ? (w.g.oppImplied != null ? [['Opp Vegas pts', fmt(w.g.oppImplied)] as [string, string]] : []) : w.g.implied != null ? [['Vegas team pts', fmt(w.g.implied)] as [string, string]] : [])] : [];
  return { winner: W.id, loser: L.id, close, verdict, lines, rows };
}
export { r1 };
