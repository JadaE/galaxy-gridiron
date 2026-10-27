// v0.0.6: rules-based player news for the player card (no AI, no login, no keys).
// Sources, all public reads:
//  - Sleeper in-app news (Rotowire / FantasyPros / RotoBaller), sleeper.com/graphql get_player_news via GET, no token.
//  - ESPN fantasy news JSON as a fallback when the player has an espn_id in Sleeper's data.
//  - Derived events: Sleeper weekly stats (missed games, team change, his team's QB change, lost/gained start),
//    this league's transactions, and daily snapshots of Sleeper's players file (injury / team / depth chart diffs).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sleeper, espnNews, NewsRaw, P } from './api';
import type { Bundle } from './model';

export type Kind = 'injury' | 'injuryMajor' | 'team' | 'suspension' | 'role' | 'qb' | 'game' | 'practice' | 'opinion' | 'other' | 'missed' | 'league';
export type NewsLine = { ts?: number; week?: number; text: string; src: string; kind: Kind; more?: number };

export const SRC: Record<string, string> = { rotowire: 'Rotowire', fantasy_pros: 'FantasyPros', rotoballer: 'RotoBaller', rotowire_espn: 'Rotowire via ESPN', espn: 'ESPN' };
export const srcLabel = (s: string) => SRC[s] || s;

const R = {
  injuryMajor: /\b(injured reserve|placed on ir|to ir|on ir|off ir|from ir|ir return|activated|exempt list|commissioner exempt|designated (him |\w+ )?(to|for) return|ruled out|won'?t play|will not play|out for (the )?(season|year|week|game)|season-ending|surgery|torn|tear|fracture|broken|concussion protocol|pup list|reserve\/|out indefinitely|multiple weeks|week-to-week|weeks? to return|returns? from|back from (injury|ir))\b/i,
  suspension: /\b(suspend\w*|suspension|reinstat\w*)\b/i,
  team: /\b(traded|trade(s|d)? (him|to)|acquired?|acquires|signs?|signed|re-signs?|released(?! of)|release(?! of)|waived?|cut by|claimed|joins?|joining|dealt|elevated|promoted to the active|practice squad|free agent)\b/i,
  role: /\b(named (the )?starter|start(s|ing)? (at|for|in place)|will start|to start|benched|bench(ing)?|demot\w+|promot\w+|depth chart|takes? over|lead back|bell-?cow|workhorse|starting job|starting role|backup|under center|snap share|split work|committee|wr1|rb1|te1|qb1|role (grows|expands|shrinks|reduced)|expanded role|reduced role|first-team|second-team)\b/i,
  injury: /\b(injur\w*|questionable|doubtful|hamstring|ankle|knee|shoulder|groin|calf|foot|toe|back|neck|wrist|hand|hip|illness|ribs?|oblique|chest|elbow|thumb|achilles|quad|concussion|limited|did not practice|dnp|didn'?t practice|sits? out|sat out|missed practice|injury report|no injury designation|off injury report|cleared|good to go|status|game-time|up in (the )?air|expected to play|absent|will play|set to play|return to practice|back in action|day-to-day|gtd)\b/i,
  practice: /\b(practice[sd]?|practicing|full participant|logs? full)\b/i,
  game: /\b(completed|rushed|caught|carries|targets|yards|touchdowns?|tds?|interceptions?|fumbles?|receptions?|catches|scores?|win|loss|rout|blowout)\b/i,
  opinion: /\?|\b(worth|could|should|might|may|is it|buy|sell|dynasty|rankings?|outlook|sleeper pick|start or sit|start\/sit|bounce-?back|fade|trust|value|ceiling|floor|momentum|environment|believe|potential|projection|preview|matchup)\b/i,
};
const SPEC = /\?|^(is|are|can|will|should|could|why|how|what)\b|\b(worth|could|should|might|is it|believe|potential|in line for|poised|primed|in store|set up|smash|sleeper|bust|breakout candidate|ceiling|floor|dynasty|too risky|stash value|late-round|adp|draft pick|rankings?|fade|buy-low|sell-high|trade target)\b/i;
export function classify(title: string, desc = '', src = ''): Kind {
  const t = title, td = `${title} ${desc}`;
  // speculation/opinion headlines (mostly RotoBaller) never count as news events; Rotowire blurbs are factual
  if (!src.startsWith('rotowire') && (SPEC.test(t) || SPEC.test(t.replace(/^\S+ \S+(?: (?:Jr|Sr|II|III)\.?)?('s?|’s?)? /, ''))) && !/\b(ruled out|placed on|activated|traded|signed|released by|suspended for)\b/i.test(t)) return 'opinion';
  if (R.suspension.test(td)) return 'suspension';
  if (R.injuryMajor.test(t) || R.injuryMajor.test(desc.slice(0, 160))) return 'injuryMajor';
  if (R.team.test(t)) return 'team';
  if (R.role.test(t)) return 'role';
  if (R.injury.test(t)) return R.practice.test(t) && !/questionable|doubtful|out\b/i.test(t) ? 'practice' : 'injury';
  if (R.opinion.test(t)) return 'opinion';
  if (R.game.test(t)) return 'game';
  return 'other';
}

/** "Drake Maye - Three more TD tosses in win" -> "Three more TD tosses in win"; drops the player's own name prefix. */
export function plain(title: string, name: string): string {
  let t = title.replace(/\s+/g, ' ').trim();
  const dash = t.indexOf(' - ');
  if (dash > 0 && dash < 40) t = t.slice(dash + 3);
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  t = t.replace(new RegExp(`^${esc}('s?|’s?)?\\s*`, 'i'), m => (/['’]/.test(m) ? 'His ' : ''));
  t = t.replace(/^[\s:;,.\-–—]+/, '');
  if (!t) return title;
  return t[0].toUpperCase() + t.slice(1);
}
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length > 3 && !['drake', 'week', 'with', 'from', 'that', 'this', 'into', 'after', 'over'].includes(w)));
function similar(a: string, b: string) { const A = words(a), B = words(b); if (!A.size || !B.size) return false; let n = 0; A.forEach(w => B.has(w) && n++); return n / Math.min(A.size, B.size) >= 0.4; }
const PREF: Record<string, number> = { rotowire: 3, rotowire_espn: 3, fantasy_pros: 2, rotoballer: 1, espn: 1 };
const DAYMS = 86_400_000;
export const fmtDay = (ts: number) => { const d = new Date(ts); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`; };

type Cluster = { ts: number; kind: Kind; items: NewsRaw[] };
/** Merge repeats: same Sleeper topic, or same kind within 2 days with overlapping words. Newest first. */
export function cluster(items: NewsRaw[], name: string): Cluster[] {
  const out: Cluster[] = [];
  for (const it of [...items].sort((a, b) => b.ts - a.ts)) {
    const kind = classify(it.title, it.desc, it.src);
    const p = plain(it.title, name);
    const grp = (k: Kind) => (k === 'game' || k === 'opinion' || k === 'other' ? 'g' : k === 'injury' || k === 'practice' ? 'i' : k);
    const hit = out.find(c => (it.topic && c.items.some(x => x.topic === it.topic)) ||
      (Math.abs(c.ts - it.ts) <= 2 * DAYMS && grp(c.kind) === grp(kind) &&
        (c.items.some(x => similar(plain(x.title, name), p)) || (grp(kind) === 'g' && Math.abs(c.ts - it.ts) <= DAYMS) || grp(kind) === 'i')));
    if (hit) { hit.items.push(it); if (rank(kind) > rank(hit.kind)) hit.kind = kind; } else out.push({ ts: it.ts, kind, items: [it] });
  }
  return out;
}
const rank = (k: Kind) => ({ suspension: 9, injuryMajor: 8, team: 7, role: 6, injury: 5, practice: 3, game: 4, other: 2, opinion: 1 } as any)[k] || 0;
function best(c: Cluster) { return [...c.items].sort((a, b) => (PREF[b.src] || 0) - (PREF[a.src] || 0) || (classify(a.title, '', a.src) === 'opinion' ? 1 : 0) - (classify(b.title, '', b.src) === 'opinion' ? 1 : 0))[0]; }
function toLine(c: Cluster, name: string): NewsLine {
  const b = best(c);
  const srcs = [...new Set(c.items.map(x => srcLabel(x.src)))];
  return { ts: c.ts, kind: c.kind, text: plain(b.title, name), src: `${srcLabel(b.src)} via ${b.src.includes('espn') ? 'ESPN' : 'Sleeper'}${srcs.length > 1 ? ` (+${srcs.filter(s => s !== srcLabel(b.src)).join(', ')})` : ''}`, more: c.items.length - 1 };
}

/** Recent News: 2-4 plain lines from the last 14 days, repeats merged, opinion pieces only if nothing else. */
export function recent(items: NewsRaw[], name: string, now = Date.now()): NewsLine[] {
  const fresh = items.filter(x => now - x.ts <= 14 * DAYMS);
  const pool = (fresh.length ? fresh : items.slice(0, 6));
  const cs = cluster(pool, name);
  const facts = cs.filter(c => c.kind !== 'opinion');
  const pick = (facts.length >= 2 ? facts : cs).slice(0, 4);
  // always keep the newest injury/role/team item if it fell off
  const key = cs.find(c => rank(c.kind) >= 5);
  if (key && !pick.includes(key)) pick[pick.length - 1 >= 3 ? 3 : pick.length] = key;
  return pick.sort((a, b) => b.ts - a.ts).map(c => toLine(c, name));
}

const MAJOR = new Set<Kind>(['injuryMajor', 'team', 'suspension', 'role']);
/** Season News from the news feed: only decision-relevant items, one line per event. */
export function seasonFromNews(items: NewsRaw[], name: string, sinceTs: number): NewsLine[] {
  return cluster(items.filter(x => x.ts >= sinceTs), name).filter(c => MAJOR.has(c.kind) && c.items.some(x => classify(x.title, x.desc, x.src) !== 'opinion')).map(c => toLine(c, name));
}

export const weekOfTs = (ts: number, start: string) => Math.max(0, Math.floor((ts - Date.parse(start + 'T12:00:00Z')) / (7 * DAYMS)) + 1);

/** Events from Sleeper weekly stats + league transactions (backfilled for the whole season). */
export function derived(b: Bundle, id: string): NewsLine[] {
  const pl = b.players[id]; if (!pl || b.isPast) return [];
  const out: NewsLine[] = [];
  const v = b.valuer, last = v.lastScoredWeek;
  const name = (pid?: string) => (pid ? b.players[pid]?.n || 'another QB' : 'unknown');
  let prevTeam: string | null = null, missRun: number[] = [], wasStarter = false;
  const flush = () => { if (missRun.length) { const a = missRun[0], z = missRun[missRun.length - 1]; out.push({ week: z, kind: 'missed', text: a === z ? `Didn't play Wk ${a}` : `Didn't play Wks ${a}–${z}`, src: 'Sleeper weekly stats' }); missRun = []; } };
  for (let w = 1; w <= last; w++) {
    const r = v.row(w, id);
    const team = r?.[6] || null;
    const played = !!r && (r[3] || 0) > 0;
    const myTeam = team || prevTeam || pl.t || null;
    const bye = myTeam && b.sched?.byes?.[myTeam] === w;
    if (played && team) {
      flush();
      if (prevTeam && team !== prevTeam) out.push({ week: w, kind: 'team', text: `First game with ${team} (was ${prevTeam})`, src: 'Sleeper weekly stats' });
      const gs = (r![8] || 0) > 0;
      if (pl.p === 'QB' || pl.p === 'RB' || pl.p === 'WR' || pl.p === 'TE') {
        if (w > 1 && wasStarter && !gs && pl.p === 'QB') out.push({ week: w, kind: 'role', text: `Played but didn't start Wk ${w}`, src: 'Sleeper weekly stats' });
        if (w > 1 && !wasStarter && gs && pl.p === 'QB' && w > 2) out.push({ week: w, kind: 'role', text: `Started Wk ${w}`, src: 'Sleeper weekly stats' });
      }
      wasStarter = gs;
      prevTeam = team;
    } else if (!bye && w < last + 1 && (prevTeam || pl.t)) missRun.push(w);
    else if (bye) { /* bye week: keeps a missed streak going without counting the bye */ }
  }
  flush();
  // his team's QB change (same weekly-QB logic as the QB-change split)
  const team = pl.t;
  if (team) {
    let prev: string | undefined;
    for (let w = 1; w <= last; w++) {
      if (b.sched?.byes?.[team] === w) continue;
      const q = v.qbOf(w, team); if (!q) continue;
      if (prev && q !== prev) out.push({ week: w, kind: 'qb', text: q === id ? `Took over as ${team}'s QB from ${name(prev)} (Wk ${w})` : prev === id ? `${name(q)} started at QB for ${team} instead of him (Wk ${w})` : `${team} QB change: ${name(prev)} → ${name(q)} (Wk ${w})`, src: 'Sleeper weekly stats' });
      prev = q;
    }
  }
  // this league's moves
  for (const t of b.tx) {
    if (t.status !== 'complete') continue;
    const add = t.adds?.[id], drop = t.drops?.[id];
    if (add == null && drop == null) continue;
    const who = (rid: number) => '@' + (b.byRid[rid]?.display || 'a team');
    const ts = t.status_updated || t.created;
    const text = t.type === 'trade' ? `Traded to ${who(add)} (from ${who(drop)})` : add != null ? `${t.type === 'waiver' ? 'Claimed off waivers' : 'Picked up'} by ${who(add)}${drop != null ? '' : ''}` : `Dropped by ${who(drop)}`;
    out.push({ ts, kind: 'league', text, src: `${b.league.name} transactions` });
  }
  return out;
}

// ---- daily snapshots of Sleeper's players data: injury status / team / depth chart history (starts the day it's installed) ----
type Snap = Record<string, [string, string, number]>; // id -> [team, injury, depth]
export type HistEv = { ts: number; id: string; kind: Kind; text: string };
const SNAP_KEY = 'gg:news:snap1', HIST_KEY = 'gg:news:hist1';
let kv = { get: (k: string) => AsyncStorage.getItem(k), set: (k: string, v: string) => AsyncStorage.setItem(k, v) };
export const setNewsKv = (x: typeof kv) => { kv = x; };
export function diffSnap(prev: Snap, players: Record<string, P>, ts: number, keep: (id: string) => boolean): { snap: Snap; ev: HistEv[] } {
  const snap: Snap = {}, ev: HistEv[] = [];
  for (const id in players) {
    if (!keep(id)) continue;
    const p = players[id]; if (p.p === 'DEF') continue;
    const cur: [string, string, number] = [p.t || '', p.i || '', p.d ?? 0];
    snap[id] = cur;
    const o = prev[id]; if (!o) continue;
    if (o[0] !== cur[0]) ev.push({ ts, id, kind: 'team', text: cur[0] ? (o[0] ? `Team changed: ${o[0]} → ${cur[0]}` : `Signed with ${cur[0]}`) : `No longer on ${o[0]} (released or free agent)` });
    if (o[1] !== cur[1]) {
      const major = /^(IR|Out|PUP|Sus|NA)$/.test(cur[1]) || /^(IR|PUP|Sus)$/.test(o[1]);
      ev.push({ ts, id, kind: /Sus/.test(cur[1] + o[1]) ? 'suspension' : major ? 'injuryMajor' : 'injury', text: cur[1] ? `Injury status: ${o[1] || 'healthy'} → ${cur[1]}` : `Injury status cleared (was ${o[1]})` });
    }
    if (o[2] && cur[2] && o[2] !== cur[2] && o[0] === cur[0]) ev.push({ ts, id, kind: 'role', text: `Depth chart: ${p.p}${o[2]} → ${p.p}${cur[2]}` });
  }
  return { snap, ev };
}
let snapping: Promise<void> | null = null;
/** Called after each bundle load; the players file is cached for a day, so this diffs about once a day. */
export function recordSnapshot(players: Record<string, P>, keep: (id: string) => boolean, now = Date.now()): Promise<void> {
  if (snapping) return snapping;
  snapping = (async () => {
    try {
      const prevS = await kv.get(SNAP_KEY);
      const prev = prevS ? JSON.parse(prevS) : null;
      if (prev && now - prev.ts < 6 * 3_600_000) return; // at most every 6h
      const { snap, ev } = diffSnap(prev?.s || {}, players, now, keep);
      await kv.set(SNAP_KEY, JSON.stringify({ ts: now, since: prev?.since || now, s: snap }));
      if (ev.length) {
        const h: HistEv[] = JSON.parse((await kv.get(HIST_KEY)) || '[]');
        await kv.set(HIST_KEY, JSON.stringify([...ev, ...h].slice(0, 3000)));
      }
    } catch {} finally { snapping = null; }
  })();
  return snapping;
}
export async function history(id: string): Promise<{ ev: HistEv[]; since: number | null }> {
  try {
    const h: HistEv[] = JSON.parse((await kv.get(HIST_KEY)) || '[]');
    const s = await kv.get(SNAP_KEY);
    return { ev: h.filter(x => x.id === id), since: s ? JSON.parse(s).since : null };
  } catch { return { ev: [], since: null }; }
}

export type PlayerNews = { recent: NewsLine[]; season: NewsLine[]; status: string; snapSince: number | null };
/** Everything the card needs. Never throws; says plainly what failed. */
export async function playerNews(b: Bundle, id: string, force = false): Promise<PlayerNews> {
  const pl = b.players[id];
  const name = pl?.n || '';
  let items: NewsRaw[] = [], status = '';
  if (pl && pl.p !== 'DEF') {
    try { items = await sleeper.news(id, 100, force); status = items.length ? '' : 'No news items on Sleeper for him yet.'; }
    catch {
      if (pl.e) { try { items = await espnNews(pl.e); status = 'Sleeper news unavailable; showing ESPN.'; } catch { status = "Couldn't reach Sleeper or ESPN news."; } }
      else status = "Couldn't reach Sleeper news. Pull down to retry later.";
    }
  } else status = 'Team defenses have no player news feed.';
  const start = b.state?.season_start_date || `${b.season}-09-01`;
  const since = Date.parse(start + 'T00:00:00Z') - 21 * DAYMS; // include late preseason
  const h = await history(id);
  const der = derived(b, id);
  const fromNews = seasonFromNews(items, name, since);
  const snapLines: NewsLine[] = h.ev.map(e => ({ ts: e.ts, kind: e.kind, text: e.text, src: 'Sleeper player data (daily check)' }));
  const tsOf = (l: NewsLine) => l.ts ?? Date.parse(start + 'T12:00:00Z') + ((l.week || 1) - 1) * 7 * DAYMS + 4 * DAYMS; // weekly events ~Sunday
  const season = [...fromNews, ...der, ...snapLines].map(l => ({ ...l, ts: tsOf(l), week: l.week ?? weekOfTs(tsOf(l), start) })).sort((a, b) => b.ts! - a.ts!);
  return { recent: recent(items, name), season, status, snapSince: h.since };
}
