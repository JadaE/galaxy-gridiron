import { Bundle, ros, optimalLineup, FLEX_ELIG, elig, ppos, pname, isOut, rosteredSet, byeWeek, projOf, val, isRelevant } from './model';

export type DropPick = { id: string | null; cost: number; safety: 'Safe' | 'OK' | 'Risky'; reasons: string[] };

const lastName = (b: Bundle, id: string) => pname(b, id).split(' ').slice(-1)[0];

/** How many bench spots her roster allows vs uses. */
export function openSpots(b: Bundle) {
  const size = (b.league.roster_positions || []).filter((x: string) => x !== 'IR' && x !== 'TAXI').length;
  const used = b.me.players.filter(id => !b.me.reserve.includes(id)).length;
  return size - used;
}

/** Choose the safest player to drop if she adds `addId`. */
export function bestDrop(b: Bundle, addId: string | null): DropPick {
  if (openSpots(b) > 0) return { id: null, cost: 0, safety: 'Safe', reasons: ['You have an open roster spot, so no drop is needed'] };
  const mine = b.me.players.filter(id => !b.me.reserve.includes(id));
  const starters = new Set(optimalLineup(b, mine, id => ros(b, id)).map(o => o.id).filter(Boolean) as string[]);
  const wk = b.week;
  const cands = mine.filter(id => !starters.has(id) && id !== addId);
  if (!cands.length) return { id: null, cost: 99, safety: 'Risky', reasons: ['Every player is a starter'] };
  const scored = cands.map(c => {
    const pos = ppos(b, c);
    let cost = ros(b, c);
    const reasons: string[] = [];
    const inj = b.players[c]?.i;
    if (isOut(inj)) { cost *= inj === 'IR' ? 0.35 : 0.6; reasons.push(`${inj === 'IR' ? 'On IR' : inj} and taking a bench spot`); }
    // positional scarcity + bye coverage
    const samePos = mine.filter(x => x !== c && elig(b, x).includes(pos) && !isOut(b.players[x]?.i));
    const addSame = addId && elig(b, addId).includes(pos) ? 1 : 0;
    const startersAtPos = [...starters].filter(s => ppos(b, s) === pos);
    for (const s of startersAtPos) {
      const bw = byeWeek(b, s);
      if (bw && bw >= wk && bw <= wk + 2) {
        const backups = samePos.filter(x => !starters.has(x)).length + addSame;
        if (backups === 0) { cost += 8; reasons.push(`Only backup ${pos} and ${lastName(b, s)} has a bye in week ${bw}`); }
        else if (['RB', 'WR'].includes(pos)) { cost += 2; reasons.push(`Helps cover ${lastName(b, s)}'s week ${bw} bye`); }
      }
    }
    if (['QB', 'TE', 'K', 'DEF'].includes(pos) && samePos.length + addSame === 0) { cost += 3; reasons.push(`Your only other ${pos}`); }
    const myBye = byeWeek(b, c);
    if (myBye && myBye >= wk && myBye <= wk + 1) reasons.push(`On bye week ${myBye}`);
    if (['K', 'DEF'].includes(pos) && samePos.length >= 1 && !reasons.length) reasons.push(`Spare ${pos} - only needed for byes`);
    if (!reasons.length) reasons.push(`Bench player, ${ros(b, c).toFixed(1)} expected pts`);
    return { id: c, cost, reasons };
  }).sort((x, y) => x.cost - y.cost);
  const best = scored[0];
  const addV = addId ? ros(b, addId) : 0;
  const safety: DropPick['safety'] = best.cost < addV * 0.6 && !best.reasons.some(r => /Only|only/.test(r)) ? 'Safe' : best.cost < addV ? 'OK' : 'Risky';
  return { id: best.id, cost: best.cost, safety, reasons: best.reasons };
}

export type Fit = { id: string; pos: string; proj: number; value: number; ros: number; gain: number; over: string | null; trend: number; drop: DropPick; score: number; bye?: number };

/** Free agents ranked by lineup gain + depth gain, with a smart drop for each. */
export function pickups(b: Bundle, limit = 30): Fit[] {
  if (b.isPast) return [];
  const rostered = rosteredSet(b);
  const trend: Record<string, number> = {};
  b.trending.forEach(t => (trend[t.player_id] = t.count));
  const mine = b.me.players.filter(x => !b.me.reserve.includes(x));
  const opt = optimalLineup(b, mine, id => ros(b, id));
  const weakest: Record<string, { id: string | null; v: number }> = {};
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const cands = opt.filter(o => (FLEX_ELIG[o.slot] || [o.slot]).includes(pos));
    if (cands.length) { const w = cands.reduce((m, o) => (o.v < m.v ? o : m), cands[0]); weakest[pos] = { id: w.id, v: w.v }; }
  }
  const genericDrop = bestDrop(b, null);
  const pool = new Set([...Object.keys(b.proj), ...Object.keys(trend)]);
  const res: Fit[] = [];
  pool.forEach(id => {
    if (rostered.has(id)) return;
    const pl = b.players[id];
    if (!pl || isOut(pl.i) || !pl.t || !isRelevant(b, id)) return;
    const w = weakest[pl.p];
    if (!w) return;
    const r = ros(b, id);
    const gain = r - w.v;
    const depth = r - genericDrop.cost;
    if (depth <= 0 && gain <= 0) return;
    const score = Math.max(gain, 0) + 0.5 * Math.max(depth, 0) + Math.min(1.5, Math.log10(1 + (trend[id] || 0)) * 0.25);
    res.push({ id, pos: pl.p, proj: projOf(b, id), value: val(b, id), ros: r, gain, over: w.id, trend: trend[id] || 0, drop: genericDrop, score, bye: byeWeek(b, id) });
  });
  res.sort((a, c) => c.score - a.score);
  const top = res.slice(0, limit);
  // refine drop per player for the top ones (position-aware)
  top.forEach(f => (f.drop = bestDrop(b, f.id)));
  return top;
}
