import { Bundle, Team, ppos, isOut, pname, FLEX_ELIG, flexable } from './model';

export type Tag = 'never' | 'high';
export type Tags = Record<string, Tag>;
export const HIGH_PREMIUM = 1.15;
const POS = ['QB', 'RB', 'WR', 'TE'] as const;

function nStarters(b: Bundle) {
  const n: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1 };
  b.slots.forEach(s => { if (s === 'SUPER_FLEX') n.QB += 1; if (s === 'FLEX') { n.RB += 0.4; n.WR += 0.45; n.TE += 0.15; } if (s === 'WRRB_FLEX') { n.RB += 0.5; n.WR += 0.5; } if (s === 'REC_FLEX') { n.WR += 0.7; n.TE += 0.3; } });
  return n;
}

export type TeamProfile = { t: Team; rel: Record<string, number>; needs: string[]; surplus: string[]; byPos: Record<string, string[]>; starterAvg: Record<string, number> };

export function teamProfiles(b: Bundle): TeamProfile[] {
  const fc = b.fc || {};
  const v = (id: string) => fc[id] || 0;
  const ns = nStarters(b);
  const base = b.teams.map(t => {
    const byPos: Record<string, string[]> = {};
    const starterAvg: Record<string, number> = {};
    for (const p of POS) {
      byPos[p] = t.players.filter(id => ppos(b, id) === p && !isOut(b.players[id]?.i)).sort((x, y) => v(y) - v(x));
      const n = Math.max(1, Math.round(ns[p]));
      starterAvg[p] = byPos[p].slice(0, n).reduce((s, id) => s + v(id), 0) / n;
    }
    return { t, byPos, starterAvg };
  });
  const lg: Record<string, number> = {};
  for (const p of POS) lg[p] = base.reduce((s, x) => s + x.starterAvg[p], 0) / base.length || 1;
  return base.map(x => {
    const rel: Record<string, number> = {};
    for (const p of POS) rel[p] = x.starterAvg[p] / lg[p];
    const order = [...POS].sort((p, q) => rel[p] - rel[q]);
    const needs = order.filter(p => rel[p] < 0.95).slice(0, 2);
    const surplus = [...POS].filter(p => {
      const n = Math.max(1, Math.round(ns[p]));
      const depth = x.byPos[p].slice(n).filter(id => v(id) >= lg[p] * 0.45).length;
      return rel[p] > 1.08 || depth >= 1;
    }).sort((p, q) => rel[q] - rel[p]);
    return { ...x, rel, needs: needs.length ? needs : [order[0]], surplus };
  });
}

export type Idea = { team: Team; give: string[]; get: string[]; giveV: number; getV: number; net: number; theirNet: number; score: number; why: string[]; needFilled: string; highTagged: boolean; note?: string; fairness: string };

/** Depth weights for players behind the starters at each position. v0.0.2 counted bench players as worth 0,
 * so her highest-value bench player (seen in a real league) looked "free" and was added to almost every idea. */
const DEPTH_W: Record<string, number[]> = { QB: [0.25], RB: [0.35, 0.2], WR: [0.35, 0.2], TE: [0.25] };
export const MAX_GIVE_USES = 2; // no single player in more than 2 shown ideas
const RECENT_DAYS = 7;
/** Combined trade-value ratio must stay in this window so asks stay roughly even (50/50 is even). */
export const FAIR_MIN = 0.85;
export const FAIR_MAX = 1.18;

/** Players she added in the last week (waivers/free agency/trade). */
export function recentlyAdded(b: Bundle): Record<string, number> {
  const out: Record<string, number> = {};
  const cut = Date.now() - RECENT_DAYS * 86400_000;
  for (const t of b.tx) {
    if (t.status !== 'complete' || !t.adds) continue;
    const at = t.status_updated || t.created;
    if (at < cut) continue;
    for (const id in t.adds) if (t.adds[id] === b.me.rid && b.me.players.includes(id)) out[id] = Math.max(out[id] || 0, at);
  }
  return out;
}

/** Trade-value lineup: starters at full value, bench at DEPTH_W (QB depth in a 1-QB league is bye cover only). */
export function lineupFC(b: Bundle, ids: string[], v: (id: string) => number) {
  const pool = ids.filter(id => POS.includes(ppos(b, id) as any) && !isOut(b.players[id]?.i)).sort((x, y) => v(y) - v(x));
  const used = new Set<string>();
  let total = 0;
  const strict = b.slots.filter(s => POS.includes(s as any));
  const flex = b.slots.filter(s => !POS.includes(s as any) && (FLEX_ELIG[s] || []).some(p => POS.includes(p as any)));
  for (const s of [...strict, ...flex]) {
    const el = FLEX_ELIG[s] || [s];
    const pick = pool.find(id => !used.has(id) && el.includes(ppos(b, id)));
    if (pick) { used.add(pick); total += v(pick); }
  }
  for (const p of POS) {
    const w = p === 'QB' && !flexable(b.slots, 'QB') ? [0.1] : DEPTH_W[p];
    const rest = pool.filter(id => !used.has(id) && ppos(b, id) === p);
    total += w.reduce((a, wt, i) => a + wt * (rest[i] ? v(rest[i]) : 0), 0);
  }
  return total;
}

function valGet(b: Bundle, id: string): { value: number; trend?: number; mean?: number; prior?: { ppg: number; label: string } } | null {
  try { return b.valuer?.get?.(id) || null; } catch { return null; }
}

/** Median FantasyCalc / production (pts/g) so the two scales can be blended. */
export function productionScale(b: Bundle): number {
  const ratios: number[] = [];
  for (const t of b.teams) for (const id of t.players) {
    const m = b.fc?.[id] || 0, p = valGet(b, id)?.value || 0;
    if (m > 0 && p > 0) ratios.push(m / p);
  }
  if (!ratios.length) return 0;
  ratios.sort((a, c) => a - c);
  return ratios[Math.floor(ratios.length / 2)];
}

/** Market value nudged by existing production/trend scores (those already blend prior-season and career stats). */
export function tradeValue(b: Bundle, id: string, scale = productionScale(b)): number {
  const market = b.fc?.[id] || 0;
  const raw = valGet(b, id);
  const prod = raw?.value || 0;
  let adj = scale && prod ? prod * scale : 0;
  const trend = raw?.trend || 0;
  if (adj && trend > 3) adj *= 1.08;
  if (adj && trend < -3) adj *= 0.94;
  if (!market) return adj;
  if (!adj) return market;
  return 0.65 * market + 0.35 * adj;
}

export function fairnessLine(giveV: number, getV: number): string {
  const total = giveV + getV;
  if (total <= 0) return '';
  const send = Math.round((giveV / total) * 100), get = 100 - send;
  return `Fairness ${send}/${get}: you send ${send}% of the combined trade value, you get ${get}%. 50/50 is an even ask.`;
}

function onBye(b: Bundle, id: string): boolean {
  const team = b.players[id]?.t;
  const bye = team ? b.sched?.byes?.[team] : undefined;
  return bye != null && bye === b.week;
}

function combos(ids: string[], n: 2): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  return out;
}

function ptsLabel(b: Bundle, id: string): string {
  const raw = valGet(b, id);
  const pts = raw?.value || raw?.mean;
  const name = pname(b, id);
  if (!pts) return name;
  const prior = raw?.prior ? `, ${raw.prior.label} ${raw.prior.ppg}/g` : '';
  return `${name} (${pts.toFixed(1)} pts/g${prior})`;
}

export type TradeOpts = { noHigh?: boolean; noStarters?: boolean };
/** 🔒 Will-not-trade players are never offered. opts.noHigh also keeps 💎 personal-high-value players out,
 * opts.noStarters keeps her current starters out. */
export function tradeIdeas(b: Bundle, tags: Tags, limit = 10, opts: TradeOpts = {}) {
  if (!b.fc) return { ideas: [] as Idea[], profiles: [] as TeamProfile[], mine: null as TeamProfile | null };
  const scale = productionScale(b);
  const v = (id: string) => tradeValue(b, id, scale);
  const ns = nStarters(b);
  const profiles = teamProfiles(b);
  const mine = profiles.find(p => p.t.rid === b.me.rid)!;
  // v0.0.10: fill her REAL lineup slots (strict QB/RB/WR/TE first, then each FLEX with the best eligible player left),
  // then add bench depth at a discount. Before, FLEX was a fractional count that rounded away, so a WR starting at
  // FLEX looked like a cheap bench piece and got traded for a QB who would sit. A QB only counts past the 1st
  // when the league has a SUPER_FLEX; otherwise a backup QB is bye cover only.
  const lineup = (ids: string[]) => lineupFC(b, ids, v);
  const recent = recentlyAdded(b);
  const base = lineup(b.me.players);
  const giveable = b.me.players.filter(id => b.players[id] && POS.includes(ppos(b, id) as any) && v(id) > 0 && tags[id] !== 'never' && !(opts.noHigh && tags[id] === 'high') && !(opts.noStarters && b.me.starters.includes(id)) && !isOut(b.players[id]?.i));
  const myNeedOrder = [...POS].sort((p, q) => mine.rel[p] - mine.rel[q]);
  const ideas: Idea[] = [];
  const startableCount = (ids: string[], pos: string) => ids.filter(id => ppos(b, id) === pos && !isOut(b.players[id]?.i) && !onBye(b, id)).length;
  const needed = (pos: string) => Math.max(1, Math.round(ns[pos]));

  const askable = (prof: TeamProfile, pos: string, allowAce: boolean) => {
    const list = prof.byPos[pos].filter(id => v(id) > 0 && b.players[id] && !isOut(b.players[id]?.i));
    if (prof.surplus.includes(pos)) return allowAce ? list.slice(0, needed(pos) + 2) : list.slice(1, needed(pos) + 2);
    // They are not deep here: never take their best player in a bundled ask; 1-for-1 may still swap mid-tier.
    return allowAce ? list.slice(1, needed(pos) + 1) : [];
  };

  for (const prof of profiles) {
    if (prof.t.rid === b.me.rid) continue;
    const theirBase = lineup(prof.t.players);
    const tryDeal = (give: string[], get: string[]) => {
      if (give.some(g => get.includes(g))) return;
      const marketGive = give.reduce((s, g) => s + v(g), 0);
      const marketGet = get.reduce((s, g) => s + v(g), 0);
      if (marketGive <= 0 || marketGet <= 0) return;
      const high = give.some(g => tags[g] === 'high');
      const eff = give.reduce((s, g) => s + v(g) * (tags[g] === 'high' ? HIGH_PREMIUM : 1), 0);
      const ratio = marketGive / marketGet;
      if (ratio < FAIR_MIN || ratio > FAIR_MAX) return;
      if (high && marketGet < eff) return;
      const myAfter = b.me.players.filter(id => !give.includes(id)).concat(get);
      const theirAfter = prof.t.players.filter(id => !get.includes(id)).concat(give);
      const net = lineup(myAfter) - base;
      const theirNet = lineup(theirAfter) - theirBase;
      // Roughly fair for both sides: neither lineup may drop by more than a small slack.
      // A need-for-need 1-for-1 of similar value can dip a few points when a bench piece moves into a starting slot.
      const slack = Math.max(150, 0.05 * Math.max(marketGive, marketGet));
      if (net < -slack || theirNet < -slack) return;
      const givePos = [...new Set(give.map(g => ppos(b, g)))];
      const getPos = [...new Set(get.map(g => ppos(b, g)))];
      const helpsMe = getPos.some(p => mine.needs.includes(p) || mine.rel[p] < 1);
      const helpsThem = givePos.some(p => prof.needs.includes(p) || prof.rel[p] < 1);
      if (!helpsMe || !helpsThem) return;
      for (const p of getPos) if (startableCount(myAfter, p) < Math.min(needed(p), startableCount(b.me.players, p)) && onBye(b, get.find(id => ppos(b, id) === p) || '')) return;
      for (const p of givePos) if (startableCount(theirAfter, p) < Math.min(needed(p), startableCount(prof.t.players, p)) && give.some(id => ppos(b, id) === p && onBye(b, id))) return;
      const fromSurplus = getPos.some(p => prof.surplus.includes(p));
      const why: string[] = [];
      why.push(`You'd send ${give.map(g => ptsLabel(b, g)).join(' and ')} for ${get.map(g => ptsLabel(b, g)).join(' and ')}.`);
      if (fromSurplus) why.push(`${prof.t.display} is deep at ${getPos.filter(p => prof.surplus.includes(p)).join('/')}.`);
      if (helpsThem) why.push(`They need ${givePos.filter(p => prof.needs.includes(p) || prof.rel[p] < 1).join('/')}.`);
      if (helpsMe) why.push(`You need ${getPos.filter(p => mine.needs.includes(p) || mine.rel[p] < 1).join('/')}.`);
      const justAdded = give.filter(g => recent[g]);
      const shape = give.length === 1 && get.length === 1 ? 1.15 : give.length === get.length ? 1 : 0.72;
      const score = (net + theirNet * 0.85) * shape * (justAdded.length ? 0.6 : 1);
      const notes: string[] = [];
      if (justAdded.length) notes.push(`you just added ${justAdded.map(g => pname(b, g)).join(' and ')}`);
      const byeGet = get.filter(id => onBye(b, id));
      if (byeGet.length) notes.push(`${byeGet.map(id => pname(b, id)).join(' and ')} is on bye this week`);
      ideas.push({ team: prof.t, give, get, giveV: Math.round(marketGive), getV: Math.round(marketGet), net, theirNet, score, why, needFilled: getPos.find(p => mine.needs.includes(p) || mine.rel[p] < 1) || getPos[0], highTagged: high, note: notes.length ? notes.join('; ') : undefined, fairness: fairnessLine(marketGive, marketGet) });
    };

    for (const need of myNeedOrder.slice(0, 3)) {
      const one = askable(prof, need, true);
      const depth = askable(prof, need, false);
      const prefer = giveable.filter(g => ppos(b, g) !== need);
      const pool = (prefer.length ? prefer : giveable).slice().sort((a, c) => v(c) - v(a)).slice(0, 8);
      for (const target of one) for (const g of pool) tryDeal([g], [target]);
      // 2-for-2 even swaps, then 2-for-1 only for surplus depth (never their ace).
      const getPool = [...new Set(myNeedOrder.slice(0, 3).flatMap(p => askable(prof, p, false)))].sort((a, c) => v(c) - v(a)).slice(0, 8);
      const givePairs = combos(pool, 2);
      for (const gp of combos(getPool, 2)) for (const give of givePairs) tryDeal(give, gp);
      for (const target of depth) for (const give of givePairs) {
        if (Math.max(v(give[0]), v(give[1])) >= v(target)) continue;
        tryDeal(give, [target]);
      }
    }
  }
  // Diversity re-rank: each time a player is already in a shown idea, his next ideas score 55% as much,
  // and nobody appears more than MAX_GIVE_USES times. Same for asking one team over and over.
  const seen = new Set<string>(), perTeam: Record<number, number> = {}, used: Record<string, number> = {}, gotUsed: Record<string, number> = {};
  const out: Idea[] = [];
  const keyOf = (i: Idea) => i.get.slice().sort().join(',') + '|' + i.give.slice().sort().join(',');
  const pool = ideas.filter(i => { const k = keyOf(i); if (seen.has(k)) return false; seen.add(k); return true; });
  const eff = (i: Idea) => i.score * Math.pow(0.55, Math.max(0, ...i.give.map(g => used[g] || 0))) * Math.pow(0.7, Math.max(0, ...i.get.map(g => gotUsed[g] || 0))) * Math.pow(0.8, perTeam[i.team.rid] || 0);
  while (out.length < limit) {
    let best: Idea | null = null, bs = -Infinity;
    for (const i of pool) {
      if (out.includes(i)) continue;
      if ((perTeam[i.team.rid] || 0) >= 2 || i.give.some(g => (used[g] || 0) >= MAX_GIVE_USES)) continue;
      const e = eff(i); if (e > bs) { bs = e; best = i; }
    }
    if (!best) break;
    perTeam[best.team.rid] = (perTeam[best.team.rid] || 0) + 1; best.give.forEach(g => (used[g] = (used[g] || 0) + 1)); best.get.forEach(g => (gotUsed[g] = (gotUsed[g] || 0) + 1));
    out.push(best);
  }
  return { ideas: out, profiles, mine };
}

export const tagLabel = (t?: Tag) => (t === 'never' ? '🔒 Will not trade' : t === 'high' ? '💎 Personal high value' : '');
export { pname };

export type Offer = { team: Team; give: string[]; get: string[]; giveV: number; getV: number; net: number; fair: boolean };
/** v0.0.11: she names the players she wants to trade away ("Pat and Wilson"). Every offer gives EXACTLY those players
 * and gets 1 or 2 players back from one team, at a fair price (their trade value within about 15% of hers).
 * net = how much her trade-value lineup improves (starters full value, bench discounted, a backup QB in a 1-QB
 * league is bye cover only), so a QB she can't start never looks like a win. `want` limits what she gets to those players. */
export function offersFor(b: Bundle, give: string[], limit = 3, want: string[] = []): { offers: Offer[]; giveV: number } {
  if (!b.fc || !give.length) return { offers: [], giveV: 0 };
  const fc = b.fc;
  const v = (id: string) => fc[id] || 0;
  const giveV = give.reduce((s, g) => s + v(g), 0);
  if (giveV <= 0) return { offers: [], giveV };
  const base = lineupFC(b, b.me.players, v);
  const all: Offer[] = [];
  for (const t of b.teams) {
    if (t.rid === b.me.rid) continue;
    let pool = t.players.filter(id => b.players[id] && POS.includes(ppos(b, id) as any) && v(id) > 0 && !isOut(b.players[id]?.i)).sort((x, y) => v(y) - v(x));
    if (want.length) { if (!want.some(w => pool.includes(w))) continue; }
    pool = pool.slice(0, 10);
    const sets: string[][] = pool.map(id => [id]);
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) sets.push([pool[i], pool[j]]);
    for (const get of sets) {
      if (want.length && !want.every(w => get.includes(w) || !t.players.includes(w))) continue;
      const getV = get.reduce((s, g) => s + v(g), 0);
      const ratio = getV / giveV;
      if (ratio < 0.85 || ratio > 1.15) continue;
      const after = b.me.players.filter(id => !give.includes(id)).concat(get);
      const net = lineupFC(b, after, v) - base;
      all.push({ team: t, give, get, giveV, getV, net, fair: true });
    }
  }
  all.sort((x, y) => y.net - x.net || x.get.length - y.get.length);
  const out: Offer[] = [], perTeam: Record<number, number> = {}, gotUsed = new Set<string>();
  const good = all.filter(o => o.net > 0);
  for (const o of good.length ? good : all) {
    if (out.length >= limit) break;
    if ((perTeam[o.team.rid] || 0) >= 2 || o.get.some(g => gotUsed.has(g))) continue;
    perTeam[o.team.rid] = (perTeam[o.team.rid] || 0) + 1; o.get.forEach(g => gotUsed.add(g));
    out.push(o);
    if (!good.length) break; // nothing helps: show only the closest fair deal
  }
  return { offers: out, giveV };
}
