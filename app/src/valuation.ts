// Consistency-first player valuation from weekly stats. Pure TS (no React Native imports) so it can be unit-tested.
export type WeekRow = any[]; // [ppr, half, std, gp, posRank, snap%, team, passAtt, gs, offSnaps]
export type Weeks = Record<number, Record<string, WeekRow>>;
export type PMap = Record<string, { n: string; p: string; t?: string; i?: string }>;
export type WeekPt = { w: number; pts: number; played: boolean; rank: number | null; snap: number | null; team: string | null; qb?: string; fillFor?: string; weight: number };
export type Val = {
  id: string; weeks: WeekPt[]; games: number; mean: number; median: number; floor: number; ceil: number;
  startRate: number; trend: number; recent: number; value: number; spikes: number[];
  qbNote?: string; qbSplit?: { cur: string; withCur: number; withOther: number; nCur: number; nOther: number };
  fillNote?: string; tier: 'steady' | 'boom-bust' | 'rising' | 'falling' | 'limited';
  /** v0.0.7 prior-season baseline (per game, league scoring) and how much it counted */
  prior?: { ppg: number; games: number; weight: number; label: string };
  /** this-season value before the prior was blended in */
  seasonValue?: number;
  missed?: number;
  /** 'small sample' | 'returning from injury' | 'injured' */
  flag?: string; flagNote?: string;
};

const OUT = new Set(['IR', 'Out', 'NA', 'Sus', 'PUP']);
const pct = (arr: number[], q: number) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
};
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export class Valuer {
  private memo: Record<string, Val> = {};
  private teamQB: Record<string, string> = {}; // `${w}:${team}` -> qb id
  private byTeamPos: Record<string, string[]> = {}; // `${team}:${pos}` -> ids
  readonly lastWeek: number;
  constructor(public weeks: Weeks, public players: PMap, public si: number, public nTeams: number, public priorMap: Record<string, number[]> = {}, public priorLabel = 'last season') {
    this.lastWeek = Math.max(0, ...Object.keys(weeks).map(Number).filter(w => Object.keys(weeks[w] || {}).length > 0));
    for (const w in weeks) {
      // team QB of the week: started (gs) first, then most pass attempts (per research calc_demo.py)
      const best: Record<string, [string, number]> = {};
      for (const id in weeks[w]) {
        const r = weeks[w][id];
        if (players[id]?.p !== 'QB' || !r[6] || !r[7]) continue;
        const key = (r[8] || 0) * 1000 + r[7];
        if (!best[r[6]] || key > best[r[6]][1]) best[r[6]] = [id, key];
      }
      for (const t in best) this.teamQB[`${w}:${t}`] = best[t][0];
    }
    for (const id in players) { const p = players[id]; if (p.t) (this.byTeamPos[`${p.t}:${p.p}`] ||= []).push(id); }
  }
  startLine(pos: string) {
    const per: Record<string, number> = { QB: 1, RB: 2.5, WR: 2.8, TE: 1.2, K: 1, DEF: 1 };
    return Math.max(6, Math.round(this.nTeams * (per[pos] || 1)));
  }
  /** His team's starting QB (most pass attempts) for week w, from the same weekly stats the QB-change split uses. */
  qbOf(w: number, team: string): string | undefined { return this.teamQB[`${w}:${team}`]; }
  /** Raw weekly row: [ppr, half, std, gp, posRank, snap%, team, passAtt, gs, offSnaps] */
  row(w: number, id: string): any[] | undefined { return this.weeks[w]?.[id]; }
  get lastScoredWeek() { return this.lastWeek; }
  private raw(id: string): WeekPt[] {
    const out: WeekPt[] = [];
    for (let w = 1; w <= this.lastWeek; w++) {
      const r = this.weeks[w]?.[id];
      const played = !!r && (r[3] || 0) > 0;
      const team = r?.[6] || null;
      out.push({ w, pts: r ? r[this.si] || 0 : 0, played, rank: r?.[4] ?? null, snap: r?.[5] ?? null, team, qb: team ? this.teamQB[`${w}:${team}`] : undefined, weight: 1 });
    }
    return out;
  }
  get(id: string): Val {
    if (this.memo[id]) return this.memo[id];
    const pl = this.players[id];
    const pos = pl?.p || '?';
    const wk = this.raw(id);
    // --- fill-in detection (RB/WR/TE): a better teammate at his position missed the week
    let fillNote: string | undefined;
    if (pl?.t && ['RB', 'WR', 'TE'].includes(pos)) {
      // usual starter = teammate with the most snaps over the previous 3 weeks (rolling, per research calc_demo / v002.md)
      const team = pl.t;
      const mates = (this.byTeamPos[`${team}:${pos}`] || []);
      const snapsIn = (m: string, from: number, to: number) => { let n = 0; for (let w = Math.max(1, from); w <= to; w++) { const r = this.weeks[w]?.[m]; if (r && r[6] === team) n += r[9] || 0; } return n; };
      const leads = new Set<string>();
      let n = 0, lastLead: string | null = null;
      wk.forEach(x => {
        if (!x.played || x.team !== team) return;
        const from = x.w > 1 ? x.w - 3 : 1, to = x.w > 1 ? x.w - 1 : Math.min(3, this.lastWeek);
        let lead: string | null = null, most = 0;
        for (const m of mates) { const sn = snapsIn(m, from, to); if (sn > most) { most = sn; lead = m; } }
        if (!lead || lead === id) return;
        const lr = this.weeks[x.w]?.[lead];
        const leadSnap = lr && lr[6] === team ? (lr[5] ?? 0) : 0;
        if (leadSnap < 25) { x.fillFor = lead; leads.add(lead); lastLead = lead; n++; }
      });
      if (n && lastLead) {
        const lead: string = lastLead;
        const lastRow = this.weeks[this.lastWeek]?.[lead];
        const back = !OUT.has(this.players[lead]?.i || '') && !!lastRow && (lastRow[5] ?? 0) >= 25;
        if (back) wk.forEach(x => { if (x.fillFor) x.weight = 0.4; });
        fillNote = `${n} game${n > 1 ? 's' : ''} filling in for ${[...leads].map(l => this.players[l]?.n || 'a teammate').join(' / ')}${back ? " (he's back now, so those weeks count less)" : ' (still out)'}`;
      }
    }
    // --- QB context: current QB vs earlier QBs
    let qbNote: string | undefined, qbSplit: Val['qbSplit'];
    if (['WR', 'TE', 'RB'].includes(pos)) {
      const played = wk.filter(x => x.played && x.qb);
      const cur = played.length ? played[played.length - 1].qb! : undefined;
      if (cur && played.some(x => x.qb !== cur)) {
        const a = played.filter(x => x.qb === cur).map(x => x.pts), b = played.filter(x => x.qb !== cur).map(x => x.pts);
        qbSplit = { cur, withCur: avg(a), withOther: avg(b), nCur: a.length, nOther: b.length };
        qbNote = `QB change: ${avg(a).toFixed(1)} pts/g with ${this.players[cur]?.n || 'current QB'} (${a.length}g) vs ${avg(b).toFixed(1)} with others (${b.length}g)`;
        if (a.length >= 2) played.forEach(x => { if (x.qb === cur) x.weight *= 1.4; });
      }
    }
    const pl_ = wk.filter(x => x.played);
    const pts = pl_.map(x => x.pts);
    const games = pl_.length;
    const median = pct(pts, 0.5), floor = pct(pts, 0.25), p75 = pct(pts, 0.75), ceil = Math.max(0, ...pts);
    const cap = p75 + Math.max(4, p75 - floor); // spike clip
    const spikes = pl_.filter(x => x.pts > cap).map(x => x.w);
    const wsum = pl_.reduce((s, x) => s + x.weight, 0) || 1;
    const clippedMean = pl_.reduce((s, x) => s + Math.min(x.pts, cap) * x.weight, 0) / wsum;
    const mean = avg(pts);
    const line = this.startLine(pos);
    const startRate = games ? pl_.filter(x => x.rank != null && x.rank <= line).length / games : 0;
    const last3 = pl_.slice(-3);
    const recent = last3.length ? last3.reduce((s, x) => s + Math.min(x.pts, cap), 0) / last3.length : 0;
    const trend = games >= 4 ? recent - clippedMean : 0;
    let value = games ? (0.35 * clippedMean + 0.25 * median + 0.2 * floor + 0.2 * recent) * (0.85 + 0.3 * startRate) : 0;
    // --- v0.0.7: prior-season baseline. Per game (so missed games don't sink a healthy-again player), weighted by
    // how much this season has shown: 0 games = all prior, ~8+ games = mostly this season.
    const pr = this.priorMap[id];
    let prior: Val['prior'];
    const seasonValue = value;
    if (pr && (pr[1] >= 3 || pr[3] >= 3)) {
      const w1 = Math.min(17, pr[1] || 0), w2 = 0.5 * Math.min(17, pr[3] || 0);
      const ppg = (pr[0] * w1 + pr[2] * w2) / ((w1 + w2) || 1);
      const k = Math.min(3.5, 0.25 * (w1 + w2)); // prior counts as up to 3.5 "games" (~40% at 5 games played, ~25% at 10)
      const pv = ppg; // same scale as this season's value (which already regresses spikes)
      value = games ? (value * games + pv * k) / (games + k) : pv;
      prior = { ppg: Math.round(ppg * 10) / 10, games: Math.round(w1 + w2 * 2), weight: Math.round((k / (games + k)) * 100) / 100, label: w2 && w1 ? `${this.priorLabel} + year before` : this.priorLabel };
    } else if (games && games < 3) value *= 0.8 + 0.1 * games; // small sample, no history to lean on
    // --- missed games: his team played but he didn't (injury / inactive)
    const teamWeeks = wk.filter(x => !x.played && (x.team || pl?.t) && this.teamQB[`${x.w}:${x.team || pl?.t}`]).length;
    const missed = pl_.length ? teamWeeks : 0;
    const lastPlayed = pl_.length ? pl_[pl_.length - 1].w : 0;
    let flag: string | undefined, flagNote: string | undefined;
    if (missed >= 2 && OUT.has(pl?.i || '')) { flag = 'injured'; flagNote = `Missed ${missed} games this season; valued per game played${prior ? ` and on ${prior.label} (${prior.ppg}/g)` : ''}.`; }
    else if (missed >= 2 && lastPlayed === this.lastWeek) { flag = 'returning from injury'; flagNote = `Back after missing ${missed} games; valued per game played${prior ? ` and on ${prior.label} (${prior.ppg}/g)` : ''}.`; }
    else if (games < 4) { flag = 'small sample'; flagNote = `Only ${games} game${games === 1 ? '' : 's'} this season${prior ? `, so ${prior.label} (${prior.ppg}/g) counts for ${Math.round(prior.weight * 100)}%` : ''}.`; }
    const cv = mean ? (p75 - floor) / Math.max(1, median) : 0;
    const tier: Val['tier'] = games < 3 ? 'limited' : trend > 3 ? 'rising' : trend < -3 ? 'falling' : cv > 0.9 ? 'boom-bust' : 'steady';
    const v: Val = { id, weeks: wk, games, mean, median, floor, ceil, startRate, trend, recent, value, spikes, qbNote, qbSplit, fillNote, tier, prior, seasonValue, missed, flag, flagNote };
    this.memo[id] = v;
    return v;
  }
}
