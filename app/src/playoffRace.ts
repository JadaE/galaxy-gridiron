/** Deterministic playoff-run math from already-loaded Sleeper settings and remaining matchups. No AI. */

export const MAX_ENUM_GAMES = 16;

export type RaceTeam = {
  rid: number;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  division?: number | null;
};

export type RemainingGame = { a: number; b: number };

export type RaceInput = {
  teams: RaceTeam[];
  playoffTeams: number;
  playoffStart: number;
  lastScored: number;
  week: number;
  /** Sleeper settings.playoff_seed_type: 0 = record, 1 = division winners first. */
  playoffSeedType?: number;
  /** Remaining regular-season games (roster ids). */
  games: RemainingGame[];
  /**
   * When games are missing, weeks of regular season still to play.
   * Used only for the best/worst-wins fallback.
   */
  weeksLeft?: number;
};

export type GroupId = 'locked' | 'control' | 'fight' | 'out';

export type RaceRow = {
  rid: number;
  group: GroupId;
  pfOnly: boolean;
  finish: string;
  wins: number;
  losses: number;
  ties: number;
  minWins: number;
  maxWins: number;
  clinch1: boolean;
  alive1: boolean;
  clinchBye: boolean;
  aliveBye: boolean;
};

export type RaceResult = {
  rows: RaceRow[];
  byRid: Record<number, RaceRow>;
  groups: { id: GroupId; title: string; rows: RaceRow[] }[];
  seed1: { clinched: boolean; rids: number[] };
  byes: { count: number; clinched: number[]; open: number[] } | null;
  lockWins: number | null;
  lastRegularWeek: number;
  seasonOver: boolean;
  unconfigured: boolean;
  usedEnum: boolean;
  usedFallback: boolean;
  scaleMax: number;
};

export const GROUP_TITLES: Record<GroupId, string> = {
  locked: 'Locked in',
  control: 'In control',
  fight: 'Fighting for a spot',
  out: 'Out',
};

export const PLAYOFF_COPY = {
  title: 'Playoff run',
  stillOpen1: 'Still open for #1',
  clinched1: 'Locked in at #1',
  stillOpenBye: 'Still open for a bye',
  clinchedBye: 'Bye locked',
  seasonOver: 'Regular season is over',
  weekOf: (w: number, last: number) => `Week ${w} of ${last}`,
  unconfigured: "This league doesn't have playoffs set up.",
  loading: 'Loading the remaining games…',
  waiversStillOpen: 'Waivers are still open — switch to that tab to see them.',
};

/** Plain (i) copy: one short sentence per header, plus the bar. No sports jargon. */
export const PLAYOFF_INFO_SECS: [string, string][] = [
  ['Still open for #1 / Locked in at #1', 'Teams that can still finish first, or the team that has already locked first place.'],
  ['Bye', 'Shown only when this league gives first-round byes. These teams can still get one, or have already locked one.'],
  ['Locked in', 'These teams have already locked a playoff spot, no matter how the rest of the season goes.'],
  ['In control', 'These teams will lock a playoff spot if they win their remaining games, no matter what anyone else does.'],
  ['Fighting for a spot', 'These teams can still make the playoffs, but they need some help or a strong finish. "On points" means they only get in if points-for breaks their way.'],
  ['Out', 'These teams can no longer make the playoffs.'],
  ['The bar', "The solid part is the team's current wins, and the faded part is what they can still add. The dashed line is the number of wins that locks a playoff spot — once the solid bar crosses it, they're locked in."],
];

/** Byes so the first playoff round fills a power of two. 4 or 8 teams → 0; 6 teams → 2. */
export function playoffByes(playoffTeams: number): number {
  const n = Math.max(0, Math.floor(Number(playoffTeams) || 0));
  if (n <= 1) return 0;
  let p = 1;
  while (p < n) p *= 2;
  return p - n;
}

export function formatRecord(w: number, l: number, t = 0): string {
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

export function finishLine(wins: number, losses: number, ties: number, left: number, pfOnly: boolean): string {
  const lo = formatRecord(wins, losses + left, ties);
  const hi = formatRecord(wins + left, losses, ties);
  if (left <= 0 || lo === hi) return pfOnly ? `Finished ${lo} on points` : `Finished ${lo}`;
  return `Can finish ${lo} to ${hi}${pfOnly ? ' on points' : ''}`;
}

export function pairsFromMatchups(weeks: Record<number, any[]> | null | undefined): RemainingGame[] {
  const games: RemainingGame[] = [];
  if (!weeks) return games;
  const weekNums = Object.keys(weeks).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  for (const w of weekNums) {
    const by: Record<string, number[]> = {};
    for (const x of weeks[w] || []) {
      if (x == null || x.matchup_id == null || x.roster_id == null) continue;
      const rid = Number(x.roster_id);
      if (!Number.isFinite(rid)) continue;
      (by[String(x.matchup_id)] ||= []).push(rid);
    }
    for (const rids of Object.values(by)) {
      if (rids.length === 2 && rids[0] !== rids[1]) games.push({ a: rids[0], b: rids[1] });
    }
  }
  return games;
}

function lastRegularWeek(playoffStart: number): number {
  const s = Number(playoffStart);
  if (!Number.isFinite(s) || s <= 1) return 17;
  return s - 1;
}

type Flags = {
  locked: boolean;
  alive: boolean;
  pfOnly: boolean;
  control: boolean;
  clinch1: boolean;
  alive1: boolean;
  clinchBye: boolean;
  aliveBye: boolean;
  minW: number;
  maxW: number;
};

function compareAt(
  wa: number, la: number, pfa: number,
  wb: number, lb: number, pfb: number,
): number {
  if (wa !== wb) return wb - wa;
  if (la !== lb) return la - lb;
  return pfb - pfa;
}

/** Position of focus (1-based) in seed order. worstPf=true ranks focus last among record-ties. */
function positionOf(
  focus: number,
  W: ArrayLike<number>,
  L: ArrayLike<number>,
  pf: ArrayLike<number>,
  n: number,
  worstPf: boolean,
  seedType: number,
  div: ArrayLike<number>,
  hasDiv: boolean,
): number {
  const better = (i: number, j: number, iIsFocus: boolean, jIsFocus: boolean) => {
    // When the focus team is in the comparison, ignore points-for and give
    // the focus the worst or best tiebreak, so a clinch is PF-proof.
    if (iIsFocus || jIsFocus) {
      if (W[i] !== W[j]) return W[i] > W[j];
      if (L[i] !== L[j]) return L[i] < L[j];
      if (iIsFocus) return !worstPf;
      return worstPf;
    }
    const c = compareAt(W[i], L[i], pf[i], W[j], L[j], pf[j]);
    if (c !== 0) return c < 0;
    return i < j;
  };

  if (hasDiv && seedType === 1) {
    const divIds: number[] = [];
    const seen: Record<number, true> = {};
    for (let i = 0; i < n; i++) {
      const d = div[i];
      if (d && !seen[d]) { seen[d] = true; divIds.push(d); }
    }
    const winners: number[] = [];
    const rest: number[] = [];
    for (const d of divIds) {
      let win = -1;
      for (let i = 0; i < n; i++) if (div[i] === d) {
        if (win < 0 || better(i, win, i === focus, win === focus)) win = i;
      }
      if (win >= 0) winners.push(win);
    }
    winners.sort((i, j) => (better(i, j, i === focus, j === focus) ? -1 : 1));
    for (let i = 0; i < n; i++) if (!winners.includes(i)) rest.push(i);
    rest.sort((i, j) => (better(i, j, i === focus, j === focus) ? -1 : 1));
    const order = winners.concat(rest);
    return order.indexOf(focus) + 1;
  }

  let pos = 1;
  for (let i = 0; i < n; i++) {
    if (i === focus) continue;
    if (better(i, focus, false, true)) pos++;
  }
  return pos;
}

function lockCheckAt(
  tMaxOrWins: number,
  othersMax: number[],
  spots: number,
): boolean {
  // Others who can reach this win total can pass on points-for, so they count as threats.
  let threats = 0;
  for (const m of othersMax) if (m >= tMaxOrWins) threats++;
  return threats < spots;
}

function eliminatedAt(tMax: number, othersMin: number[], spots: number): boolean {
  let alwaysAhead = 0;
  for (const m of othersMin) if (m > tMax) alwaysAhead++;
  return alwaysAhead >= spots;
}

function enumerate(input: RaceInput, byeCount: number): { flags: Flags[]; lockWins: number | null } | null {
  const teams = input.teams;
  const nT = teams.length;
  const games = input.games;
  const nG = games.length;
  if (nG > MAX_ENUM_GAMES) return null;
  const spots = input.playoffTeams;
  const seedType = input.playoffSeedType || 0;
  const ridTo = new Map<number, number>();
  for (let i = 0; i < nT; i++) ridTo.set(teams[i].rid, i);
  const gA = new Int16Array(nG);
  const gB = new Int16Array(nG);
  const left = new Uint8Array(nT);
  for (let i = 0; i < nG; i++) {
    const ai = ridTo.get(games[i].a), bi = ridTo.get(games[i].b);
    if (ai == null || bi == null) return null; // unknown roster → fallback
    gA[i] = ai; gB[i] = bi;
    left[ai]++; left[bi]++;
  }
  const baseW = new Uint8Array(nT);
  const baseL = new Uint8Array(nT);
  const ties = new Uint8Array(nT);
  const pf = new Float64Array(nT);
  const div = new Int16Array(nT);
  let hasDiv = false;
  for (let i = 0; i < nT; i++) {
    baseW[i] = teams[i].wins;
    baseL[i] = teams[i].losses;
    ties[i] = teams[i].ties || 0;
    pf[i] = teams[i].pf;
    const d = teams[i].division;
    div[i] = d && d > 0 ? d : 0;
    if (div[i]) hasDiv = true;
  }

  const clinchPo = new Uint8Array(nT).fill(1);
  const alivePo = new Uint8Array(nT);
  const strictIn = new Uint8Array(nT);
  const clinch1 = new Uint8Array(nT).fill(1);
  const alive1 = new Uint8Array(nT);
  const clinchBye = new Uint8Array(nT).fill(1);
  const aliveBye = new Uint8Array(nT);
  const winOutTotal = new Uint32Array(nT);
  const winOutIn = new Uint32Array(nT);
  const minW = new Uint8Array(nT).fill(255);
  const maxW = new Uint8Array(nT);

  const W = new Uint8Array(nT);
  const L = new Uint8Array(nT);
  const N = 1 << nG;
  let maxOutWins = -1;

  for (let mask = 0; mask < N; mask++) {
    W.set(baseW);
    for (let i = 0; i < nG; i++) {
      if ((mask >>> i) & 1) W[gA[i]]++;
      else W[gB[i]]++;
    }
    for (let t = 0; t < nT; t++) {
      L[t] = baseL[t] + left[t] - (W[t] - baseW[t]);
      if (W[t] < minW[t]) minW[t] = W[t];
      if (W[t] > maxW[t]) maxW[t] = W[t];
    }
    for (let t = 0; t < nT; t++) {
      const wonAll = W[t] === baseW[t] + left[t];
      if (wonAll) winOutTotal[t]++;
      const posW = positionOf(t, W, L, pf, nT, true, seedType, div, hasDiv);
      const posB = positionOf(t, W, L, pf, nT, false, seedType, div, hasDiv);
      if (posW > spots) { clinchPo[t] = 0; if (W[t] > maxOutWins) maxOutWins = W[t]; }
      else strictIn[t] = 1;
      if (posB <= spots) alivePo[t] = 1;
      if (wonAll && posW <= spots) winOutIn[t]++;
      if (posW > 1) clinch1[t] = 0;
      if (posB <= 1) alive1[t] = 1;
      if (byeCount > 0) {
        if (posW > byeCount) clinchBye[t] = 0;
        if (posB <= byeCount) aliveBye[t] = 1;
      }
    }
  }

  const lockWins = maxOutWins < 0 ? 0 : maxOutWins + 1;

  const flags: Flags[] = [];
  for (let t = 0; t < nT; t++) {
    const locked = !!clinchPo[t];
    const alive = !!alivePo[t];
    const pfOnly = alive && !strictIn[t];
    const control = !locked && alive && winOutTotal[t] > 0 && winOutIn[t] === winOutTotal[t];
    flags.push({
      locked, alive, pfOnly, control,
      clinch1: !!clinch1[t], alive1: !!alive1[t],
      clinchBye: byeCount > 0 && !!clinchBye[t],
      aliveBye: byeCount > 0 && !!aliveBye[t],
      minW: minW[t] === 255 ? baseW[t] : minW[t],
      maxW: maxW[t],
    });
  }
  return { flags, lockWins };
}

function fallback(input: RaceInput, byeCount: number): { flags: Flags[]; lockWins: number | null } {
  const teams = input.teams;
  const nT = teams.length;
  const spots = input.playoffTeams;
  const ridTo = new Map<number, number>();
  for (let i = 0; i < nT; i++) ridTo.set(teams[i].rid, i);
  const left = new Uint8Array(nT);
  const plays = Array.from({ length: nT }, () => [] as number[]);
  if (input.games.length) {
    for (const g of input.games) {
      const ai = ridTo.get(g.a), bi = ridTo.get(g.b);
      if (ai == null || bi == null) continue;
      left[ai]++; left[bi]++;
      plays[ai].push(bi);
      plays[bi].push(ai);
    }
  } else {
    const wl = Math.max(0, Math.floor(Number(input.weeksLeft) || 0));
    for (let i = 0; i < nT; i++) left[i] = wl;
  }
  const minW: number[] = [];
  const maxW: number[] = [];
  for (let i = 0; i < nT; i++) {
    minW[i] = teams[i].wins;
    maxW[i] = teams[i].wins + left[i];
  }
  const flags: Flags[] = [];
  for (let t = 0; t < nT; t++) {
    const othersMax = maxW.filter((_, i) => i !== t);
    const othersMin = minW.filter((_, i) => i !== t);
    const locked = lockCheckAt(minW[t], othersMax, spots);
    const elim = eliminatedAt(maxW[t], othersMin, spots);
    const alive = !elim;
    // Can this team get in on wins alone (worst PF) in some world? If their max beats enough others' mins strictly.
    let alwaysAheadAtMax = 0;
    for (const m of othersMin) if (m > maxW[t]) alwaysAheadAtMax++;
    let canTie = 0;
    for (const m of othersMin) if (m <= maxW[t]) canTie++;
    const strictPossible = alwaysAheadAtMax + 1 <= spots && (nT - alwaysAheadAtMax >= 1);
    // With worst PF, ties at maxWins go against them, so they need maxWins > others' min for a wins-lock path.
    let othersCanMatchOrBeatMax = 0;
    for (let i = 0; i < nT; i++) if (i !== t && maxW[i] >= maxW[t]) othersCanMatchOrBeatMax++;
    // pfOnly: alive but cannot be strictly ahead of the cut on wins in any bound scenario.
    // If even at max wins, at least `spots` others have minWins >= maxW, they can only sneak in on points (or not at all).
    let othersMinGeMax = 0;
    for (const m of othersMin) if (m >= maxW[t]) othersMinGeMax++;
    const pfOnly = alive && !locked && othersMinGeMax >= spots - 0 && !lockCheckAt(maxW[t], othersMax, spots) && othersMin.filter(m => m > maxW[t]).length + othersMin.filter(m => m === maxW[t]).length >= spots;
    // Simpler pfOnly: alive, not locked, and even winning out they don't lock on worst PF
    const winOutMax = maxW[t];
    const othersMaxIfTWinsOut = othersMax.map((m, j) => {
      // j indexes othersMax which skipped t — reconstruct
      return m;
    });
    // Reduce opponents' max by 1 when schedule is known
    const othersMaxWinOut: number[] = [];
    for (let i = 0; i < nT; i++) if (i !== t) {
      let m = maxW[i];
      for (const opp of plays[t]) if (opp === i) m = Math.max(minW[i], m - 1);
      othersMaxWinOut.push(m);
    }
    const control = alive && !locked && lockCheckAt(winOutMax, othersMaxWinOut, spots);
    const pfOnly2 = alive && !locked && !lockCheckAt(winOutMax, othersMaxWinOut, spots) && othersMin.filter(m => m > maxW[t]).length < spots && !control;
    // #1 / bye bounds
    const clinch1 = lockCheckAt(minW[t], othersMax, 1);
    const alive1 = !eliminatedAt(maxW[t], othersMin, 1);
    const clinchBye = byeCount > 0 && lockCheckAt(minW[t], othersMax, byeCount);
    const aliveBye = byeCount > 0 && !eliminatedAt(maxW[t], othersMin, byeCount);
    void othersMaxIfTWinsOut; void canTie; void strictPossible; void othersCanMatchOrBeatMax; void pfOnly;
    flags.push({
      locked, alive, pfOnly: pfOnly2, control,
      clinch1, alive1, clinchBye, aliveBye,
      minW: minW[t], maxW: maxW[t],
    });
  }
  // lock line: smallest W such that a team with W wins would be locked vs others' max
  let lockWins: number | null = null;
  const allMax = flags.map(f => f.maxW);
  const hi = Math.max(0, ...allMax);
  for (let w = 0; w <= hi + 1; w++) {
    // A team with exactly `w` current-or-final wins is locked if threats with max>=w < spots
    if (lockCheckAt(w, allMax, spots)) { lockWins = w; break; }
  }
  return { flags, lockWins };
}

export function playoffRace(input: RaceInput): RaceResult {
  const playoffTeams = Math.max(0, Math.floor(Number(input.playoffTeams) || 0));
  const lastReg = lastRegularWeek(input.playoffStart);
  const weeksLeft = Math.max(0, lastReg - (Number(input.lastScored) || 0));
  const unconfigured = playoffTeams <= 0 || !input.teams.length;
  const games = (input.games || []).filter(g => g && g.a !== g.b);
  const seasonOver = !unconfigured && games.length === 0 && weeksLeft <= 0;

  const empty = (): RaceResult => ({
    rows: [], byRid: {}, groups: [],
    seed1: { clinched: false, rids: [] },
    byes: null, lockWins: null, lastRegularWeek: lastReg,
    seasonOver, unconfigured, usedEnum: false, usedFallback: false, scaleMax: 0,
  });
  if (unconfigured) return empty();

  const byeCount = playoffByes(playoffTeams);
  const src = { ...input, playoffTeams, games, weeksLeft: input.weeksLeft ?? weeksLeft };

  let usedEnum = false, usedFallback = false;
  let computed: { flags: Flags[]; lockWins: number | null };
  if (seasonOver) {
    usedEnum = false;
    // Final standings use actual points-for.
    const teams = input.teams;
    const n = teams.length;
    const W = teams.map(t => t.wins);
    const L = teams.map(t => t.losses);
    const pf = teams.map(t => t.pf);
    const div = teams.map(t => t.division && t.division > 0 ? t.division : 0);
    const hasDiv = div.some(d => d > 0);
    const seedType = input.playoffSeedType || 0;
    const order = Array.from({ length: n }, (_, i) => i);
    const betterFinal = (i: number, j: number) => {
      const c = compareAt(W[i], L[i], pf[i], W[j], L[j], pf[j]);
      if (c !== 0) return c < 0;
      return i < j;
    };
    order.sort((i, j) => (betterFinal(i, j) ? -1 : 1));
    if (hasDiv && seedType === 1) {
      const divIds: number[] = [];
      const seen: Record<number, true> = {};
      for (let i = 0; i < n; i++) { const d = div[i]; if (d && !seen[d]) { seen[d] = true; divIds.push(d); } }
      const winners: number[] = [];
      for (const d of divIds) {
        let win = -1;
        for (let i = 0; i < n; i++) if (div[i] === d) {
          if (win < 0 || betterFinal(i, win)) win = i;
        }
        if (win >= 0) winners.push(win);
      }
      winners.sort((i, j) => (betterFinal(i, j) ? -1 : 1));
      const rest = order.filter(i => !winners.includes(i));
      order.length = 0; order.push(...winners, ...rest);
    }
    const posOf = new Map(order.map((idx, p) => [idx, p + 1]));
    const flags: Flags[] = teams.map((t, i) => {
      const pos = posOf.get(i) || n;
      const inPo = pos <= playoffTeams;
      return {
        locked: inPo, alive: inPo, pfOnly: false, control: false,
        clinch1: pos === 1, alive1: pos === 1,
        clinchBye: byeCount > 0 && pos <= byeCount,
        aliveBye: byeCount > 0 && pos <= byeCount,
        minW: t.wins, maxW: t.wins,
      };
    });
    const lastIn = flags.map((f, i) => ({ f, i })).filter(x => x.f.locked).map(x => teams[x.i].wins);
    const lockWins = lastIn.length ? Math.min(...lastIn) : null;
    computed = { flags, lockWins };
  } else if (games.length > 0 && games.length <= MAX_ENUM_GAMES) {
    const en = enumerate(src, byeCount);
    if (en) { computed = en; usedEnum = true; }
    else { computed = fallback(src, byeCount); usedFallback = true; }
  } else {
    computed = fallback(src, byeCount);
    usedFallback = true;
  }

  const rows: RaceRow[] = input.teams.map((t, i) => {
    const f = computed.flags[i];
    let group: GroupId;
    if (!f.alive) group = 'out';
    else if (f.locked) group = 'locked';
    else if (f.control) group = 'control';
    else group = 'fight';
    const left = f.maxW - t.wins;
    return {
      rid: t.rid, group, pfOnly: !!f.pfOnly && group === 'fight',
      finish: finishLine(t.wins, t.losses, t.ties || 0, left, !!f.pfOnly && group === 'fight'),
      wins: t.wins, losses: t.losses, ties: t.ties || 0,
      minWins: f.minW, maxWins: f.maxW,
      clinch1: f.clinch1, alive1: f.alive1,
      clinchBye: f.clinchBye, aliveBye: f.aliveBye,
    };
  });

  // Seed order for display within groups: current record, then pf
  const currentOrder = [...input.teams].sort((a, b) => compareAt(a.wins, a.losses, a.pf, b.wins, b.losses, b.pf)).map(t => t.rid);
  const rankNow = new Map(currentOrder.map((rid, i) => [rid, i]));
  rows.sort((a, b) => (rankNow.get(a.rid) ?? 0) - (rankNow.get(b.rid) ?? 0));

  const byRid: Record<number, RaceRow> = {};
  for (const r of rows) byRid[r.rid] = r;

  const groupOrder: GroupId[] = ['locked', 'control', 'fight', 'out'];
  const groups = groupOrder
    .map(id => ({ id, title: GROUP_TITLES[id], rows: rows.filter(r => r.group === id) }))
    .filter(g => g.rows.length > 0);

  const clinched1 = rows.filter(r => r.clinch1).map(r => r.rid);
  const open1 = rows.filter(r => r.alive1).map(r => r.rid);
  const seed1 = clinched1.length
    ? { clinched: true, rids: clinched1 }
    : { clinched: false, rids: open1 };

  let byes: RaceResult['byes'] = null;
  if (byeCount > 0) {
    byes = {
      count: byeCount,
      clinched: rows.filter(r => r.clinchBye).map(r => r.rid),
      open: rows.filter(r => r.aliveBye && !r.clinchBye).map(r => r.rid),
    };
  }

  const scaleMax = Math.max(1, ...rows.map(r => r.maxWins), computed.lockWins || 0);
  return {
    rows, byRid, groups, seed1, byes,
    lockWins: computed.lockWins,
    lastRegularWeek: lastReg, seasonOver, unconfigured,
    usedEnum, usedFallback, scaleMax,
  };
}

/** User-facing strings from this module, for the no-jargon test. */
export function playoffUserStrings(r?: RaceResult): string[] {
  const out = [
    ...Object.values(GROUP_TITLES),
    ...Object.values(PLAYOFF_COPY).filter(v => typeof v === 'string') as string[],
    PLAYOFF_COPY.weekOf(12, 15),
    ...PLAYOFF_INFO_SECS.flat(),
    finishLine(8, 3, 0, 4, false),
    finishLine(2, 9, 0, 4, true),
    finishLine(9, 2, 0, 0, false),
  ];
  if (r) for (const row of r.rows) out.push(row.finish);
  return out;
}
