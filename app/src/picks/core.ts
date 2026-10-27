// Picks: game model, grading and records. Pure TS (Node-testable, no React Native imports).
export type Side = { abbr: string; name: string; short: string; logo?: string; score?: number; record?: string };
export type GameState = 'pre' | 'in' | 'post' | 'off'; // off = postponed / canceled / suspended
export type Game = { id: string; week: number; season: number; kickoff: number; home: Side; away: Side; state: GameState; detail: string; winner: string | null; tie: boolean; neutral?: boolean };
export type PickSrc = 'live' | 'backfill' | 'paste' | 'import';
export type Pick = { team: string; week: number; at: number; src: PickSrc };
export type PickMap = Record<string, Pick>; // gameId -> pick
export type Grade = 'W' | 'L' | 'NR' | 'pending' | 'none';

/** Parse one ESPN scoreboard response into games. Ties and postponements have no winner (no result). */
export function parseEspn(j: any, fallbackWeek: number, season: number): Game[] {
  const week = j?.week?.number ?? fallbackWeek;
  return (j?.events || []).map((e: any): Game | null => {
    const c = e?.competitions?.[0];
    if (!c) return null;
    const side = (h: 'home' | 'away'): Side => {
      const t = (c.competitors || []).find((x: any) => x.homeAway === h) || {};
      const tm = t.team || {};
      return { abbr: tm.abbreviation || '?', name: tm.displayName || tm.name || '?', short: tm.shortDisplayName || tm.name || tm.abbreviation || '?', logo: tm.logo, score: t.score != null && t.score !== '' ? Number(t.score) : undefined, record: t.records?.[0]?.summary };
    };
    const st = e.status?.type || c.status?.type || {};
    const nm: string = st.name || '';
    const off = /POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED|FORFEIT/.test(nm);
    const state: GameState = off ? 'off' : st.state === 'post' ? 'post' : st.state === 'in' ? 'in' : 'pre';
    const home = side('home'), away = side('away');
    let winner: string | null = null, tie = false;
    if (state === 'post' && st.completed !== false) {
      const hw = (c.competitors || []).find((x: any) => x.winner === true);
      if (hw) winner = hw.team?.abbreviation || null;
      else if (home.score != null && away.score != null) { if (home.score > away.score) winner = home.abbr; else if (away.score > home.score) winner = away.abbr; else tie = true; }
      if (home.score != null && home.score === away.score) { tie = true; winner = null; }
    }
    return { id: String(e.id), week, season, kickoff: Date.parse(e.date || c.date), home, away, state, detail: st.shortDetail || st.detail || '', winner, tie, neutral: !!c.neutralSite };
  }).filter((g: Game | null): g is Game => !!g && Number.isFinite(g.kickoff)).sort((a: Game, b: Game) => a.kickoff - b.kickoff);
}

export const started = (g: Game, now = Date.now()) => now >= g.kickoff || g.state !== 'pre';
export const final = (g: Game) => g.state === 'post' || g.state === 'off';

export function grade(g: Game, p?: Pick): Grade {
  if (!p) return 'none';
  if (g.state === 'off' || (g.state === 'post' && (g.tie || !g.winner))) return g.state === 'post' || g.state === 'off' ? 'NR' : 'pending';
  if (g.state !== 'post') return 'pending';
  return g.winner === p.team ? 'W' : 'L';
}

export type Rec = { w: number; l: number; nr: number; pending: number; picked: number; games: number; backfilled: number };
export const pct = (r: { w: number; l: number }) => (r.w + r.l ? r.w / (r.w + r.l) : 0);
export const pctStr = (r: { w: number; l: number }) => (r.w + r.l ? Math.round(pct(r) * 100) + '%' : '–');
export const recStr = (r: { w: number; l: number }) => `${r.w}-${r.l}`;

export function weekRecord(games: Game[], picks: PickMap): Rec {
  const r: Rec = { w: 0, l: 0, nr: 0, pending: 0, picked: 0, games: games.length, backfilled: 0 };
  for (const g of games) {
    const p = picks[g.id];
    if (!p) continue;
    r.picked++;
    if (p.src !== 'live') r.backfilled++;
    const x = grade(g, p);
    if (x === 'W') r.w++; else if (x === 'L') r.l++; else if (x === 'NR') r.nr++; else if (x === 'pending') r.pending++;
  }
  return r;
}

export type SeasonRow = { week: number; rec: Rec; cumW: number; cumL: number; cumPct: number | null };
export function seasonRecord(byWeek: Record<number, Game[]>, picks: PickMap, weeks: number[]) {
  let W = 0, L = 0, NR = 0, BF = 0, P = 0;
  const rows: SeasonRow[] = [];
  for (const w of weeks) {
    const rec = weekRecord(byWeek[w] || [], picks);
    W += rec.w; L += rec.l; NR += rec.nr; BF += rec.backfilled; P += rec.pending;
    rows.push({ week: w, rec, cumW: W, cumL: L, cumPct: W + L ? W / (W + L) : null });
  }
  return { rows, total: { w: W, l: L, nr: NR, backfilled: BF, pending: P } };
}

/** Can she set/change this pick now? Live picks lock at kickoff; backfill only for finished games. */
export function canPick(g: Game, mode: 'live' | 'backfill', now = Date.now()): boolean {
  if (mode === 'live') return !started(g, now);
  return g.state === 'post' || (started(g, now) && g.state !== 'in');
}

// ---------- Export / import ----------
export type PicksFile = { app: 'galaxy-gridiron-picks'; v: 1; user_id: string; username: string; season: number; exportedAt: string; picks: PickMap };
export function exportFile(userId: string, username: string, season: number, picks: PickMap): PicksFile {
  return { app: 'galaxy-gridiron-picks', v: 1, user_id: userId, username, season, exportedAt: new Date().toISOString(), picks };
}
/** Validate a pasted export. Returns cleaned picks or an error message. */
export function parseImport(text: string, validTeams: Set<string>): { ok: true; file: PicksFile; picks: PickMap; skipped: number } | { ok: false; error: string } {
  let j: any;
  try { j = JSON.parse(text.trim()); } catch { return { ok: false, error: "That isn't valid JSON. Paste the whole export text." }; }
  if (!j || j.app !== 'galaxy-gridiron-picks' || typeof j.picks !== 'object') return { ok: false, error: 'Not a Galaxy Gridiron picks export.' };
  const picks: PickMap = {}; let skipped = 0;
  for (const [gid, p] of Object.entries<any>(j.picks)) {
    if (!/^\d{4,12}$/.test(gid) || !p || !validTeams.has(p.team) || !Number.isInteger(p.week) || p.week < 1 || p.week > 23) { skipped++; continue; }
    picks[gid] = { team: p.team, week: p.week, at: Number(p.at) || Date.now(), src: ['live', 'backfill', 'paste', 'import'].includes(p.src) ? p.src : 'import' };
  }
  return { ok: true, file: j, picks, skipped };
}
/** Merge imported picks. 'keep' keeps hers on conflict, 'replace' takes the file's. */
export function mergePicks(mine: PickMap, incoming: PickMap, mode: 'keep' | 'replace'): { picks: PickMap; added: number; replaced: number; kept: number } {
  const out = { ...mine }; let added = 0, replaced = 0, kept = 0;
  for (const [g, p] of Object.entries(incoming)) {
    if (!out[g]) { out[g] = p; added++; }
    else if (out[g].team === p.team) continue;
    else if (mode === 'replace') { out[g] = p; replaced++; }
    else kept++;
  }
  return { picks: out, added, replaced, kept };
}
