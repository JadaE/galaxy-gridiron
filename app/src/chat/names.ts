// Player-name resolution for chat. Pure TS (no React Native) so it's unit-testable.
export type NP = { n: string; p: string; t?: string; i?: string };
export type Cand = { id: string; score: number; why: string };

const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
export function normalize(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`.]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export const stripSuffix = (toks: string[]) => toks.filter(t => !SUFFIX.has(t));

export function lev(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i; let rowMin = dp[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      // transposition (Damerau-lite)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[j] = Math.min(dp[j], prev);
      prev = tmp; rowMin = Math.min(rowMin, dp[j]);
    }
    if (rowMin > max) return max + 1;
  }
  return dp[b.length];
}

const NICK: Record<string, string[]> = {
  cmc: ['christian mccaffrey'], jsn: ['jaxon smith njigba'], arsb: ['amon ra st brown'], 'amon ra': ['amon ra st brown'], 'st brown': ['amon ra st brown'],
  'a j brown': ['aj brown'], ajb: ['aj brown'], deebo: ['deebo samuel'], 'kenneth walker': ['kenneth walker'], 'mhj': ['marvin harrison'],
  'bijan': ['bijan robinson'], jefferson: ['justin jefferson'], 'ceedee': ['ceedee lamb'], 'tmac': ['terry mclaurin'], 'scary terry': ['terry mclaurin'],
  'saquon': ['saquon barkley'], 'kitt': ['george kittle'], 'jt': ['jonathan taylor'], 'hollywood': ['marquise brown'], 'tank': ['tank dell'],
  'dk': ['dk metcalf'], 'jahmyr': ['jahmyr gibbs'], 'puka': ['puka nacua'], 'jamarr': ['jamarr chase'],
};
const TEAM_ALIASES: Record<string, string[]> = {
  ARI: ['cardinals', 'arizona'], ATL: ['falcons', 'atlanta'], BAL: ['ravens', 'baltimore'], BUF: ['bills', 'buffalo'], CAR: ['panthers', 'carolina'], CHI: ['bears', 'chicago'],
  CIN: ['bengals', 'cincinnati'], CLE: ['browns', 'cleveland'], DAL: ['cowboys', 'dallas'], DEN: ['broncos', 'denver'], DET: ['lions', 'detroit'], GB: ['packers', 'green bay'],
  HOU: ['texans', 'houston'], IND: ['colts', 'indianapolis'], JAX: ['jaguars', 'jacksonville', 'jags'], KC: ['chiefs', 'kansas city'], LV: ['raiders', 'las vegas'], LAC: ['chargers'],
  LAR: ['rams'], MIA: ['dolphins', 'miami'], MIN: ['vikings', 'minnesota'], NE: ['patriots', 'new england', 'pats'], NO: ['saints', 'new orleans'], NYG: ['giants'],
  NYJ: ['jets'], PHI: ['eagles', 'philadelphia', 'philly'], PIT: ['steelers', 'pittsburgh'], SF: ['49ers', 'niners', 'san francisco'], SEA: ['seahawks', 'seattle'],
  TB: ['buccaneers', 'bucs', 'tampa bay', 'tampa'], TEN: ['titans', 'tennessee'], WAS: ['commanders', 'washington'],
};

type Entry = { id: string; full: string; first: string; last: string; lastJoined: string; toks: string[] };
export class NameIndex {
  entries: Entry[] = [];
  byFull = new Map<string, string[]>();
  byLast = new Map<string, string[]>();
  byFirst = new Map<string, string[]>();
  byAlias = new Map<string, string[]>();
  constructor(public players: Record<string, NP>, public relevance: (id: string) => number = () => 0) {
    const add = (m: Map<string, string[]>, k: string, id: string) => { if (!k) return; const a = m.get(k); if (a) { if (!a.includes(id)) a.push(id); } else m.set(k, [id]); };
    for (const id in players) {
      const p = players[id];
      if (p.p === 'DEF') {
        for (const a of [...(TEAM_ALIASES[id] || []), id.toLowerCase()]) { add(this.byAlias, a, id); add(this.byAlias, a + ' d', id); add(this.byAlias, a + ' def', id); add(this.byAlias, a + ' defense', id); add(this.byAlias, a + ' dst', id); }
        continue;
      }
      const toks = stripSuffix(normalize(p.n).split(' '));
      if (!toks.length) continue;
      const first = toks[0], last = toks.slice(1).join(' ') || toks[0];
      const e: Entry = { id, full: toks.join(' '), first, last, lastJoined: last.replace(/ /g, ''), toks };
      this.entries.push(e);
      add(this.byFull, e.full, id);
      add(this.byFull, (first + ' ' + e.lastJoined), id);
      add(this.byLast, last, id);
      add(this.byLast, e.lastJoined, id);
      if (toks.length > 2) add(this.byLast, toks[toks.length - 1], id); // "njigba", "brown" for st brown
      add(this.byFirst, first, id);
      if (toks.length >= 2 && first.length <= 3) add(this.byFirst, first.split('').join(' '), id);
    }
    for (const k in NICK) for (const full of NICK[k]) for (const id of this.byFull.get(full) || []) add(this.byAlias, k, id);
  }

  /** Resolve a short phrase (already stripped of chatter) to candidates. */
  resolve(phrase: string): Cand[] {
    const q = stripSuffix(normalize(phrase).split(' ')).join(' ');
    if (!q) return [];
    const out = new Map<string, Cand>();
    const put = (id: string, score: number, why: string) => { const s = score + this.relevance(id); const c = out.get(id); if (!c || c.score < s) out.set(id, { id, score: s, why }); };
    (this.byAlias.get(q) || []).forEach(id => put(id, 95, 'alias'));
    (this.byFull.get(q) || []).forEach(id => put(id, 100, 'full'));
    (this.byFull.get(q.replace(/ /g, '')) || []).forEach(id => put(id, 96, 'full-joined'));
    const lastHits = this.byLast.get(q) || this.byLast.get(q.replace(/ /g, '')) || [];
    lastHits.forEach(id => put(id, 80, 'last'));
    const firstHits = this.byFirst.get(q) || [];
    firstHits.forEach(id => put(id, firstHits.length === 1 ? 72 : 55, 'first'));
    const toks = q.split(' ');
    if (toks.length >= 2) {
      // "kyle pitt", "j jefferson", first-initial + last
      for (const e of this.entries) {
        if ((e.first === toks[0] || (toks[0].length === 1 && e.first[0] === toks[0])) && (e.last.startsWith(toks.slice(1).join(' ')) || e.lastJoined.startsWith(toks.slice(1).join('')))) put(e.id, 88, 'first+partial');
      }
    }
    if (!out.size || [...out.values()].every(c => c.why === 'first' && firstHits.length > 1)) {
      // fuzzy on last name / full name / joined
      const qj = q.replace(/ /g, '');
      for (const e of this.entries) {
        const maxD = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
        if (!maxD) break;
        const dl = Math.min(lev(q, e.last, maxD), lev(qj, e.lastJoined, maxD));
        const df = toks.length >= 2 ? lev(q, e.full, maxD + 1) : 9;
        const dFirst = toks.length === 1 && q.length >= 5 ? lev(q, e.first, 1) : 9;
        if (dl <= maxD) put(e.id, 66 - dl * 8, 'fuzzy-last');
        if (df <= maxD + 1) put(e.id, 70 - df * 6, 'fuzzy-full');
        if (dFirst <= 1) put(e.id, 45 - dFirst * 8, 'fuzzy-first');
        if (q.length >= 4 && (e.last.startsWith(q) || e.lastJoined.startsWith(qj))) put(e.id, 58, 'prefix-last');
      }
    }
    return [...out.values()].sort((a, b) => b.score - a.score).slice(0, 6);
  }
}

const STOP = new Set(('should i start sit play pick up pickup add grab claim drop cut release trade for trade trading get acquire is are was were the a an this week ' +
  'who what which how about tell me on my team or vs versus v against better than and with do you think worth keep bench roster value rest of season ros ' +
  'player stats him his he guy right now today tonight sunday monday thursday please pls lol fantasy football waivers waiver wire start or sit ' +
  'over instead in of to it be any good will would can could does did hes ideas idea best top bad pickups trades team teams points score rank whos think thoughts should\'ve need help me give gimme vs. week7 week8 projection projections ' +
  // v0.0.5: everyday words in trade/constraint questions that fuzzy-matched real or junk names ("high" -> Hightower, "players" -> "Duplicate Player")
  'players locked lock locks high worth involve involves involving dont don without except excluding exclude other than aside leave out skip avoid not no ' +
  'some whats what\'s that them those these guys anyone anybody someone something anything everything else others all just like want wanna gonna away up off ' +
  'starters starter starting lineup valuable tagged tags tag untouchable untouchables limits diamond gems gem studs keepers keeper deal deals offer offers fair make made ' +
  'suggest suggestions suggestion possible potential smart options option targets target could should my mine i im ive really very much many more most also too got have has had get ' +
  'trading traded trader worthwhile high-value personal').split(' '));
/** Words that must never resolve to a player by themselves (even as an exact last name) when they came from a longer sentence. */
export const COMMON = new Set(['high', 'worth', 'player', 'players', 'locked', 'value', 'good', 'trade', 'trades', 'team', 'free', 'agent', 'starter', 'starters', 'best', 'top', 'week', 'start', 'bench', 'pick', 'drop', 'add', 'deal', 'offer', 'fair', 'help', 'need', 'grade', 'report', 'path', 'lineup', 'waiver', 'waivers', 'record', 'rank', 'points', 'score', 'game', 'games', 'season', 'league', 'matchup', 'opponent', 'injury', 'injured', 'out', 'bye', 'depth', 'roster', 'chat', 'ask', 'thanks', 'thank', 'hello', 'hey', 'hi', 'ok', 'okay', 'yes', 'no', 'lol']);

/** Split a question into name phrases. "Wilson or Pitts Sr" -> ["wilson", "pitts sr"] */
export function namePhrases(question: string): string[] {
  const norm = normalize(question.replace(/\?/g, ' '));
  const parts = norm.split(/\s(?:or|vs|versus|v|over|instead of|and|against)\s|,/).map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const toks = p.split(' ').filter(t => !STOP.has(t));
    if (toks.length) out.push(toks.join(' '));
  }
  return out;
}

export type Mention = { phrase: string; cands: Cand[]; best: string | null; ambiguous: boolean; clear: boolean };
/** Resolve every name phrase; mark ambiguous when the top two are close and both plausible. */
const EXACT = new Set(['full', 'full-joined', 'alias', 'last', 'first+partial']);
export function findMentions(question: string, idx: NameIndex): Mention[] {
  const res: Mention[] = [];
  for (const ph of namePhrases(question)) {
    const toks = ph.split(' ');
    let cands = toks.length <= 3 && !(toks.length === 1 && COMMON.has(toks[0])) ? idx.resolve(ph) : [];
    let clear = !!cands.length && (EXACT.has(cands[0].why) || toks.length <= 2);
    // Leftover words from a longer sentence: only accept an exact name match on a short window, never a fuzzy one,
    // and never a common word. This is what turned "high worth or locked players" into Hightower vs "Duplicate Player".
    if (!cands.length) {
      for (let n = Math.min(3, toks.length); n >= 1 && !cands.length; n--)
        for (let i = 0; i + n <= toks.length && !cands.length; i++) {
          const w = toks.slice(i, i + n);
          if (w.every(t => COMMON.has(t) || t.length < 3)) continue;
          const c = idx.resolve(w.join(' ')).filter(x => EXACT.has(x.why) && (n > 1 || x.why !== 'first'));
          if (c.length) { cands = c; clear = n > 1 || toks.length <= 2; }
        }
    }
    if (!cands.length) continue;
    const [a, b] = cands;
    const ambiguous = !!b && a.score - b.score < 6 && b.score >= 50;
    res.push({ phrase: ph, cands, best: a.id, ambiguous, clear });
  }
  return res;
}
