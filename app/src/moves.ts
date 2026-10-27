// v0.0.7: "Your moves" scorecard graded on LINEUP IMPACT, not raw points.
// For each move (a waiver claim, free-agent add, drop, or trade; separate add and drop transactions made close
// together count as one move), and for each scored week after it:
//   gain  = points an added player scored in YOUR starting lineup
//   minus = what you'd most likely have started in that slot without the move: the dropped player or your best
//           eligible bench player that week (by season average); nobody eligible = an empty slot = 0
//   and if a dropped player would have started over one of your starters (higher season average) and outscored
//   him, that difference counts against the move.
import { Bundle, pname, ppos, elig, FLEX_ELIG, slotLabel, myTx, fmt } from './model';

export type MoveWeek = { w: number; net: number; text: string };
export type Move = { key: string; kind: 'waiver' | 'free_agent' | 'trade' | 'mixed'; adds: string[]; drops: string[]; created: number; leg: number; weeks: MoveWeek[]; net: number; grade: string; color: 'good' | 'ok' | 'bad' | 'tbd'; summary: string };

const GROUP_MS = 20 * 60_000;
export function groupMoves(b: Bundle) {
  const tx = myTx(b).filter(t => t.status === 'complete' && ['waiver', 'free_agent', 'trade'].includes(t.type)).sort((x, y) => (x.status_updated || x.created) - (y.status_updated || y.created));
  const groups: any[][] = [];
  for (const t of tx) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    // pair a lone drop with a lone add (or vice versa) made in the same week within 20 minutes; trades stand alone
    if (g && t.type !== 'trade' && prev.type !== 'trade' && prev.leg === t.leg && (t.status_updated || t.created) - (prev.status_updated || prev.created) < GROUP_MS) g.push(t);
    else groups.push([t]);
  }
  const mine = (o: any) => Object.keys(o || {}).filter(k => o[k] === b.me.rid);
  return groups.map(g => {
    const adds = Array.from(new Set(g.flatMap(t => mine(t.adds))));
    const drops = Array.from(new Set(g.flatMap(t => mine(t.drops)))).filter(d => !adds.includes(d));
    const kinds = Array.from(new Set(g.map(t => t.type)));
    return { key: g.map(t => t.transaction_id).join('+'), kind: (kinds.length > 1 ? 'mixed' : kinds[0]) as Move['kind'], adds: adds.filter(a => !drops.includes(a)), drops, created: g[0].status_updated || g[0].created, leg: Math.min(...g.map(t => t.leg || 1)) };
  }).filter(m => m.adds.length || m.drops.length);
}

/** One player's points in week w: league scoring from any team's matchup if he was rostered, else Sleeper's weekly stats. */
function ptsIn(b: Bundle, w: number, id: string) {
  for (const m of b.weekly[w] || []) if (m.players_points && id in m.players_points) return Number(m.players_points[id]) || 0;
  const r = b.valuer.row(w, id);
  return r ? Number(r[b.si]) || 0 : 0;
}
const avg = (b: Bundle, id: string) => b.valuer.get(id).mean || 0;
const ln = (b: Bundle, id: string) => { const parts = pname(b, id).replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, '').split(' '); return ppos(b, id) === 'DEF' ? pname(b, id) : parts[parts.length - 1]; };
/** He actually played that week (not on bye, not inactive), so he was a real option for the slot. */
const played = (b: Bundle, w: number, id: string) => { const r = b.valuer.row(w, id); return !!r && (Number(r[3]) || 0) > 0; };

export function gradeMove(b: Bundle, m: ReturnType<typeof groupMoves>[number]): Move {
  const weeks: MoveWeek[] = [];
  for (let w = Math.max(1, m.leg); w <= b.lastScored; w++) {
    const mm = (b.weekly[w] || []).find((x: any) => x.roster_id === b.me.rid);
    if (!mm) continue;
    const have: string[] = mm.players || Object.keys(mm.players_points || {});
    // only weeks after the move happened: an add is on the roster / a drop is gone
    const inEffect = m.adds.length ? m.adds.some(a => have.includes(a)) : m.drops.every(d => !have.includes(d));
    if (!inEffect) continue;
    const gone = m.drops.filter(d => !have.includes(d)); // a dropped player you later re-added is already in `have`
    const starters: string[] = mm.starters || [];
    const sp: number[] = mm.starters_points || [];
    const pool = new Set([...have.filter(id => !starters.includes(id) && !m.adds.includes(id)), ...gone]);
    let net = 0;
    const bits: string[] = [];
    starters.forEach((id, i) => {
      if (!m.adds.includes(id)) return;
      const slot = (b.slots[i] || '') as string;
      const el = FLEX_ELIG[slot] || [slot];
      const rep = [...pool].filter(x => played(b, w, x) && elig(b, x).some(p => el.includes(p))).sort((x, y) => avg(b, y) - avg(b, x))[0];
      const got = sp[i] || 0, alt = rep ? ptsIn(b, w, rep) : 0;
      if (rep) pool.delete(rep);
      net += got - alt;
      bits.push(`${ln(b, id)} scored ${fmt(got)} at ${slotLabel(slot)}; without the move ${rep ? `${pname(b, rep)} likely starts there (${fmt(alt)})` : 'that slot is empty (0)'}`);
    });
    // a dropped player who'd have started over one of your other starters and outscored him
    for (const d of gone) {
      if (!pool.has(d)) continue;
      let worst: { i: number; v: number } | null = null;
      starters.forEach((id, i) => {
        if (!id || id === '0' || m.adds.includes(id)) return;
        const el = FLEX_ELIG[b.slots[i]] || [b.slots[i]];
        if (!played(b, w, d) || !elig(b, d).some(p => el.includes(p)) || avg(b, d) <= avg(b, id)) return;
        if (!worst || avg(b, id) < avg(b, starters[worst.i])) worst = { i, v: sp[i] || 0 };
      });
      const wv = worst as { i: number; v: number } | null;
      if (wv) {
        const dp = ptsIn(b, w, d), loss = Math.max(0, dp - wv.v);
        if (loss > 0) { net -= loss; bits.push(`${ln(b, d)} would likely have started over ${ln(b, starters[wv.i])} and scored ${fmt(dp)} vs ${fmt(wv.v)}`); }
      }
    }
    weeks.push({ w, net, text: bits.length ? bits.join('. ') : `No lineup effect (${m.adds.length ? m.adds.map(a => ln(b, a)).join(', ') + ' sat on your bench' : 'the dropped player wouldn\'t have started'})` });
  }
  const net = weeks.reduce((s, x) => s + x.net, 0);
  const n = weeks.length;
  const grade = !n ? 'TBD' : net >= 20 ? 'A+' : net >= 10 ? 'A' : net >= 5 ? 'B+' : net >= 1.5 ? 'B' : net > -1.5 ? 'C' : net > -5 ? 'C-' : net > -10 ? 'D' : 'F';
  const color: Move['color'] = !n ? 'tbd' : net >= 1.5 ? 'good' : net > -1.5 ? 'ok' : 'bad';
  const who = [m.adds.length ? `added ${m.adds.map(a => pname(b, a)).join(' + ')}` : '', m.drops.length ? `dropped ${m.drops.map(d => pname(b, d)).join(' + ')}` : ''].filter(Boolean).join(', ');
  const posNote = m.adds.length && m.drops.length && m.adds.every(a => !m.drops.some(d => ppos(b, d) === ppos(b, a))) ? ` (a ${m.drops.map(d => ppos(b, d)).join('/')} for a ${m.adds.map(a => ppos(b, a)).join('/')})` : '';
  const summary = !n ? `You ${who}${posNote}. No games scored since, so it's too early to grade.`
    : `You ${who}${posNote}. Over ${n} week${n > 1 ? 's' : ''} that's ${net >= 0 ? '+' : ''}${fmt(net)} lineup points vs. not making the move${net >= 1.5 ? '. Good move.' : net > -1.5 ? ', about even.' : '. It cost you.'}`;
  return { ...m, weeks, net, grade, color, summary };
}

export function movesReport(b: Bundle): Move[] {
  return groupMoves(b).map(m => gradeMove(b, m)).sort((x, y) => y.created - x.created);
}
