import { Bundle, Team, ppos, isOut, pname } from '../../app/src/model';

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

export type Idea = { team: Team; give: string[]; get: string[]; giveV: number; getV: number; net: number; score: number; why: string[]; needFilled: string; highTagged: boolean };

export function tradeIdeas(b: Bundle, tags: Tags, limit = 10) {
  if (!b.fc) return { ideas: [] as Idea[], profiles: [] as TeamProfile[], mine: null as TeamProfile | null };
  const fc = b.fc;
  const v = (id: string) => fc[id] || 0;
  const ns = nStarters(b);
  const profiles = teamProfiles(b);
  const mine = profiles.find(p => p.t.rid === b.me.rid)!;
  const lineup = (ids: string[]) => POS.reduce((s, p) => s + ids.filter(id => ppos(b, id) === p && !isOut(b.players[id]?.i)).map(v).sort((x, y) => y - x).slice(0, Math.round(ns[p])).reduce((a, c) => a + c, 0), 0);
  const base = lineup(b.me.players);
  const giveable = b.me.players.filter(id => POS.includes(ppos(b, id) as any) && v(id) > 0 && tags[id] !== 'never');
  const myNeedOrder = [...POS].sort((p, q) => mine.rel[p] - mine.rel[q]);
  const ideas: Idea[] = [];
  for (const prof of profiles) {
    if (prof.t.rid === b.me.rid) continue;
    for (const need of myNeedOrder.slice(0, 3)) {
      const targets = prof.byPos[need].filter(id => v(id) > 0).slice(0, 4);
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
          const score = net * (fillsTheirNeed ? 1.45 : 1) * (fromSurplus ? 1.2 : 0.9) * (give.length === 2 ? 0.92 : 1);
          ideas.push({ team: prof.t, give, get: [target], giveV: market, getV: tv, net, score, why, needFilled: need, highTagged: high });
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
  ideas.sort((a, c) => c.score - a.score);
  const seen = new Set<string>(), perTeam: Record<number, number> = {}, used: Record<string, number> = {};
  const out: Idea[] = [];
  for (const i of ideas) {
    const k = i.get[0] + '|' + i.give.join(',');
    if (seen.has(k)) continue;
    if ((perTeam[i.team.rid] || 0) >= 2) continue;
    if (i.give.some(g => (used[g] || 0) >= 3)) continue;
    seen.add(k); perTeam[i.team.rid] = (perTeam[i.team.rid] || 0) + 1; i.give.forEach(g => (used[g] = (used[g] || 0) + 1));
    out.push(i);
    if (out.length >= limit) break;
  }
  return { ideas: out, profiles, mine };
}

export const tagLabel = (t?: Tag) => (t === 'never' ? '🔒 Will not trade' : t === 'high' ? '💎 Personal high value' : '');
export { pname };
