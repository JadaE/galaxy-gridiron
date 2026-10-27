import { Bundle, matchupFor, optimalLineup, pname } from './model';

export type PlayerLine = { id: string; slot: string; actual: number; proj: number | null; diff: number | null };
export type Report = {
  week: number; grade: string; gradeColor: 'good' | 'ok' | 'bad'; total: number; projTotal: number | null; optimal: number; benchLeft: number;
  median: number; high: number; rankThisWeek: number; teams: number; won: boolean | null; oppPts: number | null;
  lines: PlayerLine[]; best: PlayerLine | null; worst: PlayerLine | null; missed: { benchId: string; starterId: string; gain: number } | null; notes: string[];
};
const clamp = (x: number) => Math.max(-1, Math.min(1, x));

export function weekReport(b: Bundle, w: number, projW: Record<string, number[]> | null): Report | null {
  const m = matchupFor(b, w);
  const arr = b.weekly[w] || [];
  if (!m || !arr.length || arr.every(x => !x.points)) return null;
  const pp: Record<string, number> = m.me.playersPoints || {};
  const pj = (id: string) => (projW && projW[id] ? projW[id][b.si] : null);
  const lines: PlayerLine[] = m.me.starters.map((id, i) => {
    const proj = id && id !== '0' ? pj(id) : null;
    const actual = m.me.sp[i] || 0;
    return { id, slot: b.slots[i] || '', actual, proj, diff: proj == null ? null : actual - proj };
  });
  const total = m.me.points;
  const projTotal = projW ? lines.reduce((s, l) => s + (l.proj || 0), 0) : null;
  const rosterIds = Object.keys(pp);
  const opt = optimalLineup(b, rosterIds, id => pp[id] || 0, true);
  const optimal = Math.max(total, opt.reduce((s, o) => s + o.v, 0));
  const benchLeft = optimal - total;
  const pts = arr.map(x => x.points || 0).sort((a, c) => a - c);
  const median = pts.length % 2 ? pts[(pts.length - 1) / 2] : (pts[pts.length / 2 - 1] + pts[pts.length / 2]) / 2;
  const high = pts[pts.length - 1];
  const rankThisWeek = pts.filter(p => p > total).length + 1;
  const eff = optimal ? total / optimal : 1;
  const score = 0.5 * clamp((total - median) / (0.25 * median || 1)) + 0.3 * clamp((eff - 0.85) / 0.15) + 0.2 * (projTotal ? clamp((total / projTotal - 1) / 0.2) : 0);
  const grade = score >= 0.75 ? 'A+' : score >= 0.55 ? 'A' : score >= 0.4 ? 'B+' : score >= 0.25 ? 'B' : score >= 0.1 ? 'C+' : score >= -0.05 ? 'C' : score >= -0.25 ? 'D' : 'F';
  const withProj = lines.filter(l => l.diff != null && l.id && l.id !== '0');
  const best = withProj.length ? withProj.reduce((a, c) => (c.diff! > a.diff! ? c : a)) : null;
  const worst = withProj.length ? withProj.reduce((a, c) => (c.diff! < a.diff! ? c : a)) : null;
  // biggest single bench miss
  let missed: Report['missed'] = null;
  const starterSet = new Set(m.me.starters);
  for (const o of opt) {
    if (!o.id || starterSet.has(o.id)) continue;
    const idx = b.slots.indexOf(o.slot);
    const cand = lines.filter(l => (l.slot === o.slot || idx >= 0) && !opt.some(x => x.id === l.id)).sort((a, c) => a.actual - c.actual)[0];
    if (cand && o.v - cand.actual > (missed?.gain || 2)) missed = { benchId: o.id, starterId: cand.id, gain: o.v - cand.actual };
  }
  const notes: string[] = [];
  notes.push(`${total.toFixed(1)} pts was ${rankThisWeek === 1 ? 'the top score' : `#${rankThisWeek} of ${arr.length}`} this week (median ${median.toFixed(1)}).`);
  if (benchLeft > 0.5) notes.push(`You left ${benchLeft.toFixed(1)} pts on your bench${missed ? `: ${pname(b, missed.benchId)} would have added ${missed.gain.toFixed(1)}` : ''}.`);
  else notes.push('You started your best possible lineup. 👏');
  return { week: w, grade, gradeColor: score >= 0.25 ? 'good' : score >= -0.05 ? 'ok' : 'bad', total, projTotal, optimal, benchLeft, median, high, rankThisWeek, teams: arr.length, won: m.opp ? total > m.opp.points : null, oppPts: m.opp?.points ?? null, lines, best, worst, missed, notes };
}
