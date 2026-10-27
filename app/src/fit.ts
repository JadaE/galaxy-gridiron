// Roster fit: which of two players fits HER roster better, as a % that sums to 100.
// Weighs position need (her lineup slots, starters and depth), byes vs her roster's bye clustering,
// the consistency-weighted value (valuation.ts) and projection. Pure TS on top of model.ts.
import { Bundle, optimalLineup, isOut, hasProj, projOf, val, byeWeek, ppos, pname, elig, FLEX_ELIG, pronObj } from './model';

export type FitSide = { id: string; pct: number; score: number; avgGain: number; insGain: number; insFor?: string; startWeeks: number; weeks: number; byeOverlap: number; bye?: number; floor: number; proj: number };
export type FitResult = { a: FitSide; b: FitSide; reasons: string[]; winner: string };

const ln = (b: Bundle, id: string) => pname(b, id).split(' ').slice(-1)[0];
/** Weeks still to play (rest of regular season + her playoff run), max 17. */
export function remainingWeeks(b: Bundle) {
  const end = Math.min(17, Math.max(b.week, b.playoffStart + 2));
  return Array.from({ length: end - b.week + 1 }, (_, i) => b.week + i);
}
function available(b: Bundle, id: string, w: number) {
  if (byeWeek(b, id) === w) return false;
  const inj = b.players[id]?.i;
  if (isOut(inj)) { const span = inj === 'IR' || inj === 'PUP' ? 4 : inj === 'NA' || inj === 'Sus' ? 2 : 1; if (w < b.week + span) return false; }
  return true;
}
function weekValue(b: Bundle, id: string, w: number) {
  const v = val(b, id);
  if (w === b.week && hasProj(b, id)) return 0.5 * projOf(b, id) + 0.5 * v;
  return v || projOf(b, id) * 0.9;
}
function lineupPts(b: Bundle, ids: string[], w: number) {
  const pool = ids.filter(id => available(b, id, w));
  return optimalLineup(b, pool, id => weekValue(b, id, w), true).reduce((s, o) => s + o.v, 0);
}
/** Her healthy players who can fill a slot that takes `pos`, and how many such slots her lineup has. */
export function posDepth(b: Bundle, pos: string, pool: string[]) {
  const slots = b.slots.filter(s => (FLEX_ELIG[s] || [s]).includes(pos));
  const strict = b.slots.filter(s => s === pos).length;
  const have = pool.filter(id => elig(b, id).includes(pos) && !isOut(b.players[id]?.i)).length;
  return { slots: slots.length, strict, have };
}

export function rosterFit(b: Bundle, x: string, y: string): FitResult {
  const pool = b.me.players.filter(id => !b.me.reserve.includes(id));
  const base = pool.filter(id => id !== x && id !== y);
  const weeks = remainingWeeks(b);
  // her starters' byes (best lineup now) -> clustering
  const nowStarters = optimalLineup(b, base, id => weekValue(b, id, b.week)).map(o => o.id).filter(Boolean) as string[];
  const side = (id: string): FitSide => {
    let gain = 0, starts = 0;
    for (const w of weeks) {
      const lb = lineupPts(b, base, w), lw = lineupPts(b, [...base, id], w);
      gain += lw - lb;
      if (available(b, id, w) && optimalLineup(b, [...base, id].filter(z => available(b, z, w)), z => weekValue(b, z, w), true).some(o => o.id === id)) starts++;
    }
    // depth insurance: what he adds if her best player at his position goes down
    const pos = ppos(b, id);
    const top = base.filter(z => elig(b, z).includes(pos) && !isOut(b.players[z]?.i)).sort((p, q) => val(b, q) - val(b, p))[0];
    let ins = 0;
    if (top) { const lessTop = base.filter(z => z !== top); for (const w of weeks) ins += lineupPts(b, [...lessTop, id], w) - lineupPts(b, lessTop, w); }
    const insGain = ins / Math.max(1, weeks.length);
    const bye = byeWeek(b, id);
    const byeOverlap = bye && bye >= b.week ? nowStarters.filter(s => byeWeek(b, s) === bye).length : 0;
    const v = b.valuer.get(id);
    const avgGain = gain / Math.max(1, weeks.length);
    // lineup gain carries need/depth/byes; the small talent + floor terms break ties and reward consistency
    const score = avgGain + 0.3 * insGain + 0.12 * val(b, id) + 0.1 * v.floor + 0.04 * projOf(b, id);
    return { id, pct: 50, score, avgGain, insGain, insFor: top, startWeeks: starts, weeks: weeks.length, byeOverlap, bye, floor: v.floor, proj: projOf(b, id) };
  };
  const A = side(x), B = side(y);
  const k = 2 + 0.15 * Math.max(Math.abs(A.score), Math.abs(B.score)); // softer when both are big contributors
  const pa = 1 / (1 + Math.exp(-(A.score - B.score) / k));
  A.pct = Math.min(97, Math.max(3, Math.round(pa * 100))); B.pct = 100 - A.pct;
  const [W, L] = A.pct >= B.pct ? [A, B] : [B, A];
  const r: { w: number; t: string }[] = [];
  const posW = ppos(b, W.id), posL = ppos(b, L.id);
  if (W.startWeeks !== L.startWeeks) r.push({ w: Math.abs(W.startWeeks - L.startWeeks) + 1, t: `${ln(b, W.id)} would start for you in ${W.startWeeks} of ${W.weeks} weeks left, ${ln(b, L.id)} in ${L.startWeeks}` });
  if (posW !== posL) {
    const dW = posDepth(b, posW, base), dL = posDepth(b, posL, base);
    const thin = (d: ReturnType<typeof posDepth>) => d.have - d.strict;
    if (thin(dW) < thin(dL)) r.push({ w: 2.5, t: `You're thinner at ${posW} (${dW.have} healthy for ${dW.strict} ${posW} spot${dW.strict > 1 ? 's' : ''}${dW.slots > dW.strict ? ' + flex' : ''}) than at ${posL} (${dL.have})` });
    else if (thin(dW) === thin(dL) && W.avgGain - L.avgGain > 0.5) r.push({ w: 1.5, t: `${ln(b, W.id)} adds more to your ${posW} spots than ${ln(b, L.id)} does at ${posL}` });
  }
  if (W.startWeeks <= 2 && L.startWeeks <= 2 && W.insGain - L.insGain > 0.5 && W.insFor) r.push({ w: 2, t: `Neither starts much, but ${ln(b, W.id)} is the better fill-in if ${ln(b, W.insFor)} misses time` });
  if (L.bye === b.week) r.push({ w: 0.5, t: `${ln(b, L.id)} is on bye this week` });
  if (L.byeOverlap >= 2 && L.byeOverlap > W.byeOverlap) r.push({ w: L.byeOverlap, t: `${ln(b, L.id)}'s week-${L.bye} bye lands with ${L.byeOverlap} of your starters` });
  else if (W.bye && W.bye < b.week && L.bye && L.bye >= b.week) r.push({ w: 1, t: `${ln(b, W.id)}'s bye is already behind ${pronObj(b, W.id)}; ${ln(b, L.id)}'s is week ${L.bye}` });
  if (W.floor - L.floor > 1.5) r.push({ w: (W.floor - L.floor) / 2, t: `Steadier: floor ${W.floor.toFixed(1)} vs ${L.floor.toFixed(1)}` });
  if (W.proj - L.proj > 1.5) r.push({ w: (W.proj - L.proj) / 3, t: `Higher projection this week (${W.proj.toFixed(1)} vs ${L.proj.toFixed(1)})` });
  else if (L.proj - W.proj > 1.5 && W.bye !== b.week) r.push({ w: 0.8, t: `${ln(b, L.id)} projects higher this week (${L.proj.toFixed(1)} vs ${W.proj.toFixed(1)}), but fit wins over the season` });
  if (isOut(b.players[L.id]?.i)) r.push({ w: 3, t: `${ln(b, L.id)} is ${b.players[L.id]!.i}` });
  r.sort((p, q) => q.w - p.w);
  const reasons = r.slice(0, 3).map(z => z.t);
  if (Math.abs(W.pct - 50) < 8) reasons.unshift('Close call: they add about the same to your roster');
  if (reasons.length < 3) {
    const dW = posDepth(b, posW, base), dL = posDepth(b, posL, base);
    reasons.push(posW === posL ? `You have ${dW.have} other healthy ${posW}s for ${dW.slots} spots that take one` : `${ln(b, W.id)} would be ${posW} depth (${dW.have} healthy now); ${ln(b, L.id)} ${posL} depth (${dL.have})`);
  }
  return { a: A, b: B, reasons, winner: W.id };
}
