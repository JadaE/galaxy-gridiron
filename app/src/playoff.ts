import { Bundle, weeklySeries, optimalLineup, projOf, Team } from './model';

export type WeekOdds = { w: number; opp: Team | null; oppAvg: number; oppRec: string; pWin: number };
export type PathResult = {
  target: number; rank: number; gamesBack: number; weeks: WeekOdds[]; pTop: number; pPlayoffs: number; rankDist: number[];
  rankLo: number; rankHi: number; rankMed: number; expWins: number; myMean: number; sims: number;
};

function erf(x: number) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** future[w] = array of {roster_id, matchup_id} for remaining regular-season weeks */
export function playoffPath(b: Bundle, future: Record<number, any[]>, target = 3, sims = 2000, bump = 0): PathResult {
  const stats: Record<number, { mean: number; sd: number }> = {};
  for (const t of b.teams) {
    const ws = weeklySeries(b, t.rid).map(x => x.me);
    const mean = ws.length ? ws.reduce((s, x) => s + x, 0) / ws.length : 100;
    const sd = ws.length > 1 ? Math.sqrt(ws.reduce((s, x) => s + (x - mean) ** 2, 0) / (ws.length - 1)) : 20;
    stats[t.rid] = { mean, sd: Math.max(12, Math.min(35, sd)) };
  }
  const projNow = optimalLineup(b, b.me.players.filter(x => !b.me.reserve.includes(x)), id => projOf(b, id)).reduce((s, o) => s + o.v, 0);
  const me = b.me.rid;
  if (projNow > 40) stats[me].mean = 0.5 * stats[me].mean + 0.5 * projNow;
  stats[me].mean += bump;
  const weeks = Object.keys(future).map(Number).sort((a, c) => a - c);
  const pairs: Record<number, [number, number][]> = {};
  const weekOdds: WeekOdds[] = [];
  for (const w of weeks) {
    const byM: Record<number, number[]> = {};
    for (const x of future[w] || []) if (x.matchup_id != null) (byM[x.matchup_id] ||= []).push(x.roster_id);
    pairs[w] = Object.values(byM).filter(p => p.length === 2) as [number, number][];
    const mine = pairs[w].find(p => p.includes(me));
    if (mine) {
      const o = mine[0] === me ? mine[1] : mine[0];
      const a = stats[me], c = stats[o];
      const ot = b.byRid[o];
      weekOdds.push({ w, opp: ot, oppAvg: c.mean, oppRec: `${ot.wins}-${ot.losses}`, pWin: phi((a.mean - c.mean) / Math.sqrt(a.sd ** 2 + c.sd ** 2)) });
    }
  }
  const n = b.teams.length;
  const rankDist = new Array(n + 1).fill(0);
  const r = rng(42 + Math.round(bump * 10));
  const gauss = () => { let u = 0, v = 0; while (!u) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let winsSum = 0;
  const rids = b.teams.map(t => t.rid);
  for (let s = 0; s < sims; s++) {
    const W: Record<number, number> = {}, PF: Record<number, number> = {};
    for (const t of b.teams) { W[t.rid] = t.wins + t.ties / 2; PF[t.rid] = t.pf; }
    for (const w of weeks) for (const [x, y] of pairs[w]) {
      const px = stats[x].mean + stats[x].sd * gauss(), py = stats[y].mean + stats[y].sd * gauss();
      PF[x] += px; PF[y] += py;
      if (px > py) W[x]++; else W[y]++;
    }
    const order = [...rids].sort((p, q) => W[q] - W[p] || PF[q] - PF[p]);
    rankDist[order.indexOf(me) + 1]++;
    winsSum += W[me];
  }
  const cum = (k: number) => rankDist.slice(1, k + 1).reduce((s, x) => s + x, 0) / sims;
  const quant = (q: number) => { let c = 0; for (let k = 1; k <= n; k++) { c += rankDist[k]; if (c / sims >= q) return k; } return n; };
  const sorted = [...b.teams].sort((x, y) => x.rank - y.rank);
  const third = sorted[Math.min(target, n) - 1];
  return {
    target, rank: b.me.rank, gamesBack: Math.max(0, third.wins - b.me.wins), weeks: weekOdds, pTop: cum(target), pPlayoffs: cum(b.playoffTeams), rankDist,
    rankLo: quant(0.1), rankHi: quant(0.9), rankMed: quant(0.5), expWins: winsSum / sims, myMean: stats[me].mean, sims,
  };
}
