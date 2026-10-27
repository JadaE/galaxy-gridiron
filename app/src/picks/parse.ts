// "Paste from Notes": turn free-form pick notes into picks. Tolerant by design; anything it can't place is
// returned as unmatched with a reason so the preview can show it. Pure TS (Node-testable).
import { Game } from './core';
import { findTeams, TEAMS, norm } from './teams';

export type Parsed = { line: number; raw: string; week: number; gameId: string; team: string; opp: string; marker?: 'W' | 'L'; warn?: string };
export type Unmatched = { line: number; raw: string; reason: string };
export type ParseResult = { matched: Parsed[]; unmatched: Unmatched[]; info: Unmatched[]; weeks: number[] };

const NUMW: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const WEEK_RE = new RegExp(`(?:^|[^a-z])(?:week|wk|wek|weel)\\s*[#:.\\-]?\\s*(\\d{1,2}|${Object.keys(NUMW).join('|')})\\b`, 'i');
const W_SHORT_RE = /^\s*[\-*•#]*\s*w(\d{1,2})\b/i;
const ORD_WEEK_RE = /\b(\d{1,2})(?:st|nd|rd|th)\s+week\b/i;
const WIN = /(✅|✔|✓|☑|👍|💰|🟢|🎯)/u, LOSS = /(❌|✗|✖|✘|👎|🔴|⛔)/u;
const OVER = /\b(over|beat|beats|beating|def|defeat|defeats|defeated|beats the|to beat|to win over|over the|downs|tops)\b|>|>>|=>/;
const PICKW = /\b(pick|picked|picks|took|take|taking|going with|go with|winner|lean|my pick)\b/;
const SPLIT_VS = /\s+(?:vs\.?|v\.?|versus|@|at|-|–|—|\/)\s+/i;

function weekOf(raw: string): { week: number; rest: string } | null {
  let m = raw.match(WEEK_RE);
  if (m) { const v = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMW[m[1].toLowerCase()]; if (v >= 1 && v <= 23) return { week: v, rest: raw.slice((m.index || 0) + m[0].length) }; }
  m = raw.match(W_SHORT_RE);
  if (m) { const v = Number(m[1]); if (v >= 1 && v <= 23) return { week: v, rest: raw.slice((m.index || 0) + m[0].length) }; }
  m = raw.match(ORD_WEEK_RE);
  if (m) { const v = Number(m[1]); if (v >= 1 && v <= 23) return { week: v, rest: raw.slice((m.index || 0) + m[0].length) }; }
  return null;
}

function markerOf(raw: string): 'W' | 'L' | undefined {
  const s = raw.replace(/\b\d{1,2}\s*-\s*\d{1,2}\b/g, ' '); // scores are not markers
  const n = ' ' + norm(s) + ' ';
  const capsL = /(^|[\s(\[:\-])L([\s)\].!]|$)/.test(s), capsW = /(^|[\s(\[:\-])W([\s)\].!]|$)/.test(s);
  const w = WIN.test(s) || capsW || / (win|won|correct|hit|winner) /.test(n) || /\(w\)/i.test(s);
  const l = LOSS.test(s) || capsL || / (loss|lost|lose|wrong|miss|missed) /.test(n) || /\(l\)/i.test(s);
  if (w && !l) return 'W';
  if (l && !w) return 'L';
  return undefined;
}

/** Which team did she pick in one segment? Returns abbr, null (no team), or an error string. */
export function pickFromSegment(seg: string): { team: string; opp?: string } | { err: string } | null {
  const ms = findTeams(seg);
  const uniq = [...new Set(ms.map(m => m.abbr))];
  if (!uniq.length) return null;
  if (uniq.length === 1) return { team: uniq[0] };
  if (uniq.length > 2) return { err: `found ${uniq.length} teams (${uniq.join(', ')}), so it's unclear which is the pick` };
  const [a, b] = uniq;
  // 3 mentions like "Bills vs Jets - Bills": the repeated last one is the pick
  if (ms.length >= 3) { const last = ms[ms.length - 1].abbr; if (ms.slice(0, -1).some(m => m.abbr === last)) return { team: last, opp: last === a ? b : a }; }
  const n = ' ' + norm(seg) + ' ';
  const between = seg.replace(/\s+/g, ' ');
  // "X over Y" / "X beat Y" / "X > Y"
  const i0 = ms[0], i1 = ms[1];
  const mid = n.slice(i0.end, i1.start);
  if (OVER.test(mid) || /(?:>|=>|»)/.test(between.split(/\s+/).slice(1, -1).join(' ')) && !/</.test(between)) return { team: i0.abbr, opp: i1.abbr };
  if (/\b(lose to|loses to|lost to|falls to|under)\b/.test(mid)) return { team: i1.abbr, opp: i0.abbr };
  // "pick: X" / "took X" anywhere: the team right after the pick word
  const pw = n.match(PICKW);
  if (pw && pw.index != null) { const after = ms.find(m => m.start > pw.index!); if (after) return { team: after.abbr, opp: after.abbr === a ? b : a }; }
  // "X vs Y" with a marker on one side: "**Chiefs** vs Raiders", "Chiefs* @ Raiders", "Chiefs ✅ vs Raiders", "(Chiefs) vs Raiders"
  const parts = seg.split(SPLIT_VS);
  if (parts.length === 2) {
    const flag = (p: string) => /\*|✅|✔|✓|☑|👈|⭐|★|\(pick\)|\[x\]|<--|<-|←|!$/.test(p) || /^\s*\(.*\)\s*$/.test(p) || /^[^a-z]*[A-Z]{3,}[^a-z]*$/.test(p.trim()) && false;
    const fa = flag(parts[0]), fb = flag(parts[1]);
    const ta = findTeams(parts[0])[0]?.abbr, tb = findTeams(parts[1])[0]?.abbr;
    if (ta && tb && fa !== fb) return fa ? { team: ta, opp: tb } : { team: tb, opp: ta };
    // trailing ": X" or "- X" already handled by 3 mentions; ALL CAPS team name marks a pick ("CHIEFS vs Raiders")
    const capsA = /[A-Z]{4,}/.test(parts[0]) && !/[a-z]/.test(parts[0].replace(/[^A-Za-z]/g, '')), capsB = /[A-Z]{4,}/.test(parts[1]) && !/[a-z]/.test(parts[1].replace(/[^A-Za-z]/g, ''));
    if (ta && tb && capsA !== capsB) return capsA ? { team: ta, opp: tb } : { team: tb, opp: ta };
  }
  return { err: `two teams (${a} and ${b}) but no sign of which you picked. Write it like "${TEAMS[a].name} over ${TEAMS[b].name}" or just "${TEAMS[a].name}"` };
}

const RECORD_ONLY = /^[^a-z]*\b\d{1,2}\s*[-–]\s*\d{1,2}(?:\s*[-–]\s*\d{1,2})?\b[^a-z]*$/i;

export function parseNotes(text: string, byWeek: Record<number, Game[]>, defaultWeek: number): ParseResult {
  const matched: Parsed[] = [], unmatched: Unmatched[] = [], info: Unmatched[] = [];
  const weeks = new Set<number>();
  let week = defaultWeek;
  const lines = text.replace(/\r/g, '').split('\n');
  lines.forEach((rawLine, idx) => {
    const line = idx + 1;
    let raw = rawLine.replace(/^\s*(?:[-*•·▪◦‣>]+|\d{1,2}[.)]|\[[ x]?\])\s*/i, '').trim();
    if (!raw) return;
    const wk = weekOf(raw);
    if (wk) {
      week = wk.week; weeks.add(week);
      raw = wk.rest.replace(/^[\s:.\-–—)]+/, '').trim();
      if (!raw) return;
      if (RECORD_ONLY.test(raw) || /^(record|went|total|picks?)\b/i.test(raw) && !findTeams(raw).length) { info.push({ line, raw: rawLine.trim(), reason: `week ${week} record line (I grade from real scores instead)` }); return; }
    }
    if ((RECORD_ONLY.test(raw) || /\b\d{1,2}\s*[-–]\s*\d{1,2}\b/.test(raw)) && !findTeams(raw).length) { info.push({ line, raw: rawLine.trim(), reason: 'looks like a record or score, skipped' }); return; }
    const segs = raw.split(/\s*(?:[,;|\t]|\s&\s|\band\b|\s\+\s)\s*/i).filter(s => s.trim());
    // keep "X vs Y - X" together even if someone wrote commas inside it rarely; a segment without a team is folded into the previous one for markers
    const units: string[] = [];
    for (const s of segs) { if (!findTeams(s).length && units.length) units[units.length - 1] += ' ' + s; else units.push(s); }
    let any = false;
    for (const u of units) {
      const r = pickFromSegment(u);
      if (r === null) continue;
      any = true;
      if ('err' in r) { unmatched.push({ line, raw: rawLine.trim(), reason: r.err }); continue; }
      weeks.add(week);
      const games = byWeek[week] || [];
      if (!games.length) { unmatched.push({ line, raw: rawLine.trim(), reason: `no schedule loaded for week ${week}` }); continue; }
      const g = games.find(x => x.home.abbr === r.team || x.away.abbr === r.team);
      if (!g) { unmatched.push({ line, raw: rawLine.trim(), reason: `${TEAMS[r.team]?.name || r.team} didn't play in week ${week} (bye?). Add a "Week N" line above it` }); continue; }
      const opp = g.home.abbr === r.team ? g.away.abbr : g.home.abbr;
      if (r.opp && r.opp !== opp) { unmatched.push({ line, raw: rawLine.trim(), reason: `${r.team} played ${opp} in week ${week}, not ${r.opp}` }); continue; }
      const marker = markerOf(u);
      let warn: string | undefined;
      if (g.state === 'off') warn = 'postponed/canceled: no result';
      else if (g.state === 'post' && (g.tie || !g.winner)) warn = 'tie: no result';
      else if (g.state !== 'post') warn = g.state === 'in' ? 'in progress' : 'not played yet';
      else if (marker && (marker === 'W') !== (g.winner === r.team)) warn = `your note says ${marker}, but ${TEAMS[r.team]?.name || r.team} ${g.winner === r.team ? 'won' : 'lost'} ${g.home.abbr === r.team ? `${g.home.score}-${g.away.score}` : `${g.away.score}-${g.home.score}`}`;
      const dup = matched.findIndex(m => m.gameId === g.id);
      if (dup >= 0) {
        const prev = matched[dup];
        if (prev.team !== r.team) warn = (warn ? warn + '; ' : '') + `replaces line ${prev.line} (${prev.team})`;
        matched.splice(dup, 1);
      }
      matched.push({ line, raw: rawLine.trim(), week, gameId: g.id, team: r.team, opp, marker, warn });
    }
    if (!any) unmatched.push({ line, raw: rawLine.trim(), reason: 'no NFL team found' });
  });
  return { matched, unmatched, info, weeks: [...weeks].sort((a, b) => a - b) };
}
