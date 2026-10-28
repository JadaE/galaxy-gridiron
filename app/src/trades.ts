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

export type Idea = { team: Team; give: string[]; get: string[]; giveV: number; getV: number; net: number; score: number; why: string[]; needFilled: string; highTagged: boolean; note?: string };

/** Depth weights for players behind the starters at each position. v0.0.2 counted bench players as worth 0,
 * so her highest-value bench player (seen in a real league) looked "free" and was added to almost every idea. */
const DEPTH_W: Record<string, number[]> = { QB: [0.25], RB: [0.35, 0.2], WR: [0.35, 0.2], TE: [0.25] };
export const MAX_GIVE_USES = 2; // no single player in more than 2 shown ideas
const RECENT_DAYS = 7;

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

export type TradeOpts = { noHigh?: boolean; noStarters?: boolean };
/** 🔒 Will-not-trade players are never offered. opts.noHigh also keeps 💎 personal-high-value players out,
 * opts.noStarters keeps her current starters out. */
export function tradeIdeas(b: Bundle, tags: Tags, limit = 10, opts: TradeOpts = {}) {
  if (!b.fc) return { ideas: [] as Idea[], profiles: [] as TeamProfile[], mine: null as TeamProfile | null };
  const fc = b.fc;
  const v = (id: string) => fc[id] || 0;
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
  const giveable = b.me.players.filter(id => b.players[id] && POS.includes(ppos(b, id) as any) && v(id) > 0 && tags[id] !== 'never' && !(opts.noHigh && tags[id] === 'high') && !(opts.noStarters && b.me.starters.includes(id)));
  const myNeedOrder = [...POS].sort((p, q) => mine.rel[p] - mine.rel[q]);
  const ideas: Idea[] = [];
  for (const prof of profiles) {
    if (prof.t.rid === b.me.rid) continue;
    for (const need of myNeedOrder.slice(0, 3)) {
      const targets = prof.byPos[need].filter(id => v(id) > 0 && b.players[id]).slice(0, 4);
      for (const target of targets) {
        const tv = v(target);
        const tryGive = (give: string[]) => {
          const market = give.reduce((s, g) => s + v(g), 0);
          const high = give.some(g => tags[g] === 'high');
          const eff = give.reduce((s, g) => s + v(g) * (tags[g] === 'high' ? HIGH_PREMIUM : 1), 0);
          const ratio = market / tv;
          if (high ? tv < eff : (ratio < 0.88 || ratio > 1.2)) return;
          if (!high && give.length === 2 && ratio < 1.0) return;
          if (high && ratio < 0.55) return;
          const after = b.me.players.filter(id => !give.includes(id)).concat([target]);
          const net = lineup(after) - base;
          if (net <= tv * 0.04) return;
          const givePos = [...new Set(give.map(g => ppos(b, g)))];
          const fillsTheirNeed = givePos.some(p => prof.needs.includes(p));
          const fromSurplus = prof.surplus.includes(need);
          const why: string[] = [];
          if (fromSurplus) why.push(`${prof.t.display} is deep at ${need}`);
          if (fillsTheirNeed) why.push(`they need ${givePos.filter(p => prof.needs.includes(p)).join('/')}`);
          if (high) why.push(`you get ${Math.round((tv / market) * 100)}% of market for your high-value player`);
          const justAdded = give.filter(g => recent[g]);
          const hurt = give.filter(g => isOut(b.players[g]?.i));
          const score = net * (fillsTheirNeed ? 1.45 : 1) * (fromSurplus ? 1.2 : 0.9) * (give.length === 2 ? 0.92 : 1) * (justAdded.length ? 0.6 : 1) * (hurt.length ? 0.7 : 1);
          const notes: string[] = [];
          if (justAdded.length) notes.push(`you just added ${justAdded.map(g => pname(b, g)).join(' and ')}`);
          if (hurt.length) notes.push(`${hurt.map(g => pname(b, g)).join(' and ')} is ${hurt.map(g => b.players[g]?.i).join('/')}, so expect them to ask for a discount`);
          ideas.push({ team: prof.t, give, get: [target], giveV: market, getV: tv, net, score, why, needFilled: need, highTagged: high, note: notes.length ? notes.join('; ') : undefined });
        };
        const cands = giveable.filter(g => ppos(b, g) !== need);
        for (const g of cands) tryGive([g]);
        for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
          if (Math.max(v(cands[i]), v(cands[j])) >= tv) continue;
          tryGive([cands[i], cands[j]]);
        }
      }
    }
  }
  // Diversity re-rank: each time a player is already in a shown idea, his next ideas score 55% as much,
  // and nobody appears more than MAX_GIVE_USES times. Same for asking one team over and over.
  const seen = new Set<string>(), perTeam: Record<number, number> = {}, used: Record<string, number> = {}, gotUsed: Record<string, number> = {};
  const out: Idea[] = [];
  const pool = ideas.filter(i => { const k = i.get[0] + '|' + i.give.join(','); if (seen.has(k)) return false; seen.add(k); return true; });
  const eff = (i: Idea) => i.score * Math.pow(0.55, Math.max(0, ...i.give.map(g => used[g] || 0))) * Math.pow(0.7, gotUsed[i.get[0]] || 0) * Math.pow(0.8, perTeam[i.team.rid] || 0);
  while (out.length < limit) {
    let best: Idea | null = null, bs = -Infinity;
    for (const i of pool) {
      if (out.includes(i)) continue;
      if ((perTeam[i.team.rid] || 0) >= 2 || i.give.some(g => (used[g] || 0) >= MAX_GIVE_USES)) continue;
      const e = eff(i); if (e > bs) { bs = e; best = i; }
    }
    if (!best) break;
    perTeam[best.team.rid] = (perTeam[best.team.rid] || 0) + 1; best.give.forEach(g => (used[g] = (used[g] || 0) + 1)); gotUsed[best.get[0]] = (gotUsed[best.get[0]] || 0) + 1;
    out.push(best);
  }
  return { ideas: out, profiles, mine };
}

export const tagLabel = (t?: Tag) => (t === 'never' ? '🔒 Will not trade' : t === 'high' ? '💎 Personal high value' : '');
export { pname };
