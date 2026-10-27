// Compact league snapshot sent as `context` to the AI proxy (target < 6 KB). Only facts the rules engine
// already has. No tokens, keys, user ids or URLs. Rows are arrays; `_keys` explains the columns.
import { Bundle, pname, ppos, projOf, val, byeWeek, matchupFor, waiverReport, txReason, ordinal, famLabel, slotLabel, summary } from '../model';
import { pickups } from '../pickups';
import { tradeIdeas, Tags } from '../trades';
import { Fit } from '../chat/engine';

const r1 = (n: number) => Math.round(n * 10) / 10;
export const CONTEXT_MAX = 6000;

function row(b: Bundle, id: string, slot?: string) {
  const v = b.valuer.get(id);
  return [slot || ppos(b, id), pname(b, id), ppos(b, id), b.players[id]?.t || 'FA', r1(projOf(b, id)), r1(val(b, id)), r1(v.median), r1(v.floor), v.tier, byeWeek(b, id) ?? null, b.players[id]?.i || null, v.prior ? r1(v.prior.ppg) : null, v.flag || null];
}

export function buildContext(b: Bundle, tags: Tags, extra: { mentioned?: string[]; fit?: Fit } = {}) {
  const me = b.me;
  const bench = me.players.filter(id => !me.starters.includes(id) && !me.reserve.includes(id));
  const m = !b.isPast ? matchupFor(b, b.week) : null;
  const sc = b.league.scoring_settings?.rec ?? 1;
  const ctx: any = {
    app: 'Galaxy Gridiron (read-only; cannot make moves)',
    _keys: { player: ['slot', 'name', 'pos', 'nfl', 'projThisWeek', 'consistencyValue', 'median', 'floor', 'tier', 'bye', 'injury', 'priorSeasonPerGame', 'flag'] },
    league: { name: b.league.name, season: b.season, week: b.week, past: b.isPast, teams: b.teams.length, scoring: sc >= 0.75 ? 'PPR' : sc >= 0.25 ? 'Half PPR' : 'Standard', lineup: b.slots.map(slotLabel), playoffsStartWeek: b.playoffStart, playoffTeams: b.playoffTeams, tradeDeadline: b.league.settings?.trade_deadline ?? null },
    me: { team: me.name, record: `${me.wins}-${me.losses}${me.ties ? '-' + me.ties : ''}`, rank: ordinal(me.rank), pf: Math.round(me.pf), pfRank: ordinal(me.pfRank) },
    starters: me.starters.map((id, i) => (id && id !== '0' ? row(b, id, slotLabel(b.slots[i] || '')) : [slotLabel(b.slots[i] || ''), 'EMPTY'])),
    bench: bench.map(id => row(b, id, 'BN')),
    ir: me.reserve.map(id => row(b, id, 'IR')),
    tags: { willNotTrade: Object.keys(tags).filter(k => tags[k] === 'never').map(id => pname(b, id)), personalHighValue: Object.keys(tags).filter(k => tags[k] === 'high').map(id => pname(b, id)) },
  };
  if (m?.opp) ctx.opponent = { team: m.opp.team.name, manager: m.opp.team.display + famLabel(m.opp.team.display), record: `${m.opp.team.wins}-${m.opp.team.losses}`, projTotal: r1(m.opp.proj), myProjTotal: r1(m.me.proj), starters: m.opp.starters.filter(x => x && x !== '0').map(x => `${pname(b, x)} ${ppos(b, x)} ${r1(projOf(b, x))}`) };
  ctx.standings = [...b.teams].sort((x, y) => x.rank - y.rank).map(t => `${t.rank}. ${t.display}${famLabel(t.display)} ${t.wins}-${t.losses} PF ${Math.round(t.pf)}${t.rid === me.rid ? ' (YOU)' : ''}`);
  try { if (!b.isPast) ctx.waiverFits = pickups(b, 5).map(f => ({ add: `${pname(b, f.id)} ${f.pos} ${b.players[f.id]?.t}`, expPts: r1(f.ros), gainOverStarter: r1(f.gain), drop: f.drop.id ? pname(b, f.drop.id) : null, dropSafety: f.drop.safety })); } catch {}
  try { if (!b.isPast && b.fc) ctx.tradeIdeas = tradeIdeas(b, tags, 3).ideas.map(i => ({ with: i.team.display, give: i.give.map(g => pname(b, g)), get: i.get.map(g => pname(b, g)), why: i.why })); } catch {}
  try { const wr = waiverReport(b); if (wr.runAt) ctx.lastWaivers = wr.latest.map(x => `${x.status === 'complete' ? 'WON' : 'MISSED'} ${pname(b, x.adds ? Object.keys(x.adds)[0] : '')}: ${txReason(x, wr.latest)}`); } catch {}
  try { const s = summary(b); ctx.me.allPlay = `${s.apW}-${s.apL}`; ctx.me.expectedWins = r1(s.expectedWins); } catch {}
  if (extra.mentioned?.length) {
    const mine = new Set(me.players);
    ctx.askedAbout = extra.mentioned.slice(0, 3).map(id => { const owner = b.teams.find(t => t.players.includes(id)); return { player: row(b, id), owner: mine.has(id) ? 'YOU' : owner ? owner.display : 'free agent', tradeValue: b.fc?.[id] ?? null, qbNote: b.valuer.get(id).qbNote, fillNote: b.valuer.get(id).fillNote }; });
  }
  if (extra.fit) ctx.rosterFit = { [pname(b, extra.fit.aId)]: extra.fit.aPct + '%', [pname(b, extra.fit.bId)]: extra.fit.bPct + '%', reasons: extra.fit.reasons };
  // keep it small: drop the least important sections first
  for (const k of ['standings', 'lastWaivers', 'tradeIdeas', 'opponent', 'waiverFits', 'ir']) { if (JSON.stringify(ctx).length <= CONTEXT_MAX) break; delete ctx[k]; }
  if (JSON.stringify(ctx).length > CONTEXT_MAX) ctx.bench = ctx.bench.slice(0, 5);
  return ctx;
}
