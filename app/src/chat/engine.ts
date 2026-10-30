// Chat engines. The UI only talks to ChatEngine.answer(question, context), so a future AI backend can be swapped in.
import { posRank, rankLabel } from '../model';
import { pronObj, lineupGap, deadThisWeek, FLEX_ELIG, elig, benchWorth } from '../model';
import { Bundle, pname, ppos, projOf, val, ros, fmt, isOut, optimalLineup, slotLabel, lineupAlerts, waiverReport, txReason, summary, ordinal, matchupFor, byeWeek, famLabel, isRelevant, pron } from '../model';
import { pickups, bestDrop } from '../pickups';
import { tradeIdeas, Tags, offersFor } from '../trades';
import { tradeWords, namedOnRoster, isEitherOr, splitAsk, NOT_A_NAME } from './tradeaway';
import { NameIndex, findMentions, normalize, COMMON } from './names';
import { rosterFit, FitResult } from '../fit';
import { compareThisWeek } from './week';
import { practiceFor } from '../gameinfo';
import { parse, Action, TradeAsk } from './intents';

export type ChatContext = { b: Bundle; tags: Tags };
export type PlayerCardData = { rankAvg?: string; rankTotal?: string; id: string; name: string; pos: string; team?: string; inj?: string; proj: number; value: number; median: number; floor: number; tier: string; trend: number; status: string; statusKind: 'mine' | 'other' | 'fa'; bye?: number; fc?: number; games: number; week?: [string, string][]; flag?: string };
export type Fit = { aId: string; bId: string; aPct: number; bPct: number; reasons: string[] };
export type Reply = { text: string; players?: string[]; tab?: string; cards?: PlayerCardData[]; verdict?: string; choices?: { label: string; q: string }[]; fit?: Fit; winner?: string; engine?: 'rules' | 'budget' | 'better'; costUsd?: number; notice?: string };
export interface ChatEngine { readonly name: string; readonly enabled: boolean; answer(question: string, ctx: ChatContext): Promise<Reply> }

// ---------- Rules engine ----------
const idxCache: { key: string; idx: NameIndex | null } = { key: '', idx: null };
export function indexFor(b: Bundle) {
  const key = b.league.league_id + ':' + b.loadedAt;
  if (idxCache.key === key && idxCache.idx) return idxCache.idx;
  const mine = new Set(b.me.players);
  const rostered = new Set(b.teams.flatMap(t => t.players));
  const rel = (id: string) => (mine.has(id) ? 12 : 0) + (rostered.has(id) ? 6 : 0) + (b.proj[id] ? Math.min(6, 2 + projOf(b, id) / 4) : 0) + (b.players[id]?.t ? 0 : -10);
  // only real, findable players: no placeholders, no retired players or stale free agents with no data
  const pool: Record<string, any> = {};
  for (const id in b.players) if (rostered.has(id) || isRelevant(b, id)) pool[id] = b.players[id];
  idxCache.key = key; idxCache.idx = new NameIndex(pool, rel);
  return idxCache.idx;
}

export function card(b: Bundle, id: string): PlayerCardData {
  const v = b.valuer.get(id);
  const owner = b.teams.find(t => t.players.includes(id));
  const statusKind = owner ? (owner.rid === b.me.rid ? 'mine' : 'other') : 'fa';
  return {
    id, name: pname(b, id), pos: ppos(b, id), team: b.players[id]?.t, inj: b.players[id]?.i, proj: projOf(b, id), value: val(b, id), median: v.median, floor: v.floor, tier: v.tier, trend: v.trend,
    status: statusKind === 'mine' ? 'On your team' : statusKind === 'other' ? `@${owner!.display}${famLabel(owner!.display)}` : 'Free agent', statusKind, bye: byeWeek(b, id), fc: b.fc?.[id], games: v.games, flag: v.flag,
    rankAvg: rankLabel(posRank(b, id), 'perGame'), rankTotal: rankLabel(posRank(b, id), 'total'),
  };
}
/** In season with projections loaded, a start/sit is THIS week: Sleeper's projection (league scoring), 0 if out with no projection.
 * Same scorer as the Team tab's lineup total. Otherwise (offseason / no projections) fall back to the blended score. */
const hasWeekProj = (b: Bundle) => !b.isPast && Object.keys(b.proj).length > 50;
export const weekScore = (b: Bundle, id: string) => (hasWeekProj(b) ? (deadThisWeek(b, id) ? 0 : projOf(b, id)) : startScore(b, id));
/** Generic "who should I start?": best lineup from this week's Sleeper projections, explicit swaps, coin flips (< 1 pt) called out. */
export function lineupReply(b: Bundle): Reply {
  if (!hasWeekProj(b)) {
    const opt = optimalLineup(b, b.me.players.filter(x => !b.me.reserve.includes(x)), id => startScore(b, id));
    return { text: 'Best lineup:\n' + opt.map(o => `${slotLabel(o.slot)}: ${o.id ? pname(b, o.id) : 'empty'}`).join('\n') };
  }
  const g = lineupGap(b);
  const real = g.swaps.filter(s => s.gain >= 1);
  const small = g.swaps.filter(s => s.gain < 1);
  const nm = (id: string | null) => (id ? `${pname(b, id)} (${fmt(projOf(b, id))})` : 'the empty slot');
  const lines: string[] = [];
  if (real.length) lines.push(`Week ${b.week}: ` + real.map(s => `start ${nm(s.in)} over ${nm(s.out)} at ${slotLabel(s.slot)} (+${fmt(s.gain)})`).join('; ') + '.');
  else if (small.length) lines.push(`Week ${b.week}: you're within a point of your best lineup by Sleeper's projections.`);
  else lines.push(`Week ${b.week}: your lineup is already your best by Sleeper's projections.`);
  // coin flips: a starter vs a bench player who could take the same slot, under 1 pt apart
  const inOpt = new Set(g.opt.map(o => o.id).filter(Boolean) as string[]);
  const bench = b.me.players.filter(id => !inOpt.has(id) && !b.me.reserve.includes(id) && weekScore(b, id) > 0);
  const flips: string[] = [];
  const seen = new Set<string>();
  for (const o of g.opt) {
    if (!o.id || flips.length >= 2) continue;
    const el = FLEX_ELIG[o.slot] || [o.slot];
    const rival = bench.filter(x => !seen.has(x) && elig(b, x).some(p => el.includes(p)) && ppos(b, x) === ppos(b, o.id!)).sort((x, y) => weekScore(b, y) - weekScore(b, x))[0];
    if (!rival || weekScore(b, o.id) - weekScore(b, rival) >= 1) continue;
    seen.add(rival);
    const cmp = compareThisWeek(b, o.id, rival);
    const why = cmp.verdict.replace(/^Week \d+: (coin flip\. Lean [^:]+: |start [^.]+\. )/, '');
    const lean = cmp.winner !== o.id ? ` Matchup tiebreak leans ${pname(b, cmp.winner)}: ${why.charAt(0).toLowerCase() + why.slice(1)}` : '';
    flips.push(`🪙 ${pname(b, o.id)} ${fmt(projOf(b, o.id))} vs ${pname(b, rival)} ${fmt(projOf(b, rival))} is basically a coin flip: under a point apart in Sleeper's projections, so either is fine. My pick: ${pname(b, o.id)} (higher projection).${lean}`);
  }
  if (small.length && !flips.length) lines.push(...small.map(s => `🪙 Optional: ${nm(s.in)} over ${nm(s.out)} at ${slotLabel(s.slot)} is a coin flip (+${fmt(s.gain)}).`));
  lines.push(...flips);
  const alerts = lineupAlerts(b).filter(a => a.kind !== 'q' && a.kind !== 'swap');
  const total = `📊 Projected: ${fmt(g.curSum)} as set${g.optSum - g.curSum >= 0.05 ? `, ${fmt(g.optSum)} with the change${real.length + small.length > 1 ? 's' : ''}` : ''} (sum of starters' Sleeper projections, like Sleeper's Match screen).`;
  const body = 'Best lineup (1 per slot; FLEX = RB/WR/TE only):\n' + g.opt.map(o => `${slotLabel(o.slot)}: ${o.id ? `${pname(b, o.id)} (${fmt(projOf(b, o.id))})` : 'empty'}`).join('\n');
  return { text: `${lines.join('\n')}${alerts.length ? '\n\n⚠️ ' + alerts.map(a => a.text).join('\n⚠️ ') : ''}\n\n${total}\n\n${body}`, players: real.map(s => s.in) };
}
export const startScore = (b: Bundle, id: string) => ((isOut(b.players[id]?.i) && !(projOf(b, id) > 0)) || (Object.keys(b.proj).length > 50 && !b.proj[id]) ? 0 : 0.65 * projOf(b, id) + 0.35 * val(b, id));
const ln = (b: Bundle, id: string) => pname(b, id).split(' ').slice(-1)[0];

/** "rest of season", "fit", "long term", "keep"... = the user asked about roster fit, not this week. */
export const asksFit = (q: string) => /\b(fits?|roster fit|rest of (the )?season|ros|long[- ]?term|season[- ]long|keep|dynasty|future)\b/i.test(q);

function compare(b: Bundle, a: string, c: string, action: Action, tags: Tags, q = ''): Reply {
  const A = card(b, a), Cc = card(b, c);
  // v0.0.7: in season, "X or Y?" between two of her players (or any "start/sit X or Y") is about THIS week's game
  const bothMine = b.me.players.includes(a) && b.me.players.includes(c);
  if (!b.isPast && (action === 'start' || (!action && bothMine && !asksFit(q)))) {
    const wk = compareThisWeek(b, a, c);
    A.week = wk.rows[a]; Cc.week = wk.rows[c];
    const notMine = [a, c].filter(x => !b.me.players.includes(x)).map(x => pname(b, x));
    let verdict = wk.verdict + (notMine.length ? ` (Note: ${notMine.join(' and ')} ${notMine.length > 1 ? "aren't" : "isn't"} on your roster.)` : '');
    let fit: Fit | undefined;
    if (asksFit(q)) { try { const f = rosterFit(b, a, c); fit = { aId: a, bId: c, aPct: f.a.pct, bPct: f.b.pct, reasons: f.reasons }; } catch {} }
    return { text: wk.lines.join('\n'), cards: [A, Cc], verdict, players: [a, c], fit, winner: wk.winner };
  }
  let verdict = '';
  const why = (w: string, l: string) => {
    const r: string[] = [];
    const W = card(b, w), L = card(b, l);
    if (W.proj - L.proj > 0.5) r.push(`higher projection (${fmt(W.proj)} vs ${fmt(L.proj)})`);
    if (W.floor - L.floor > 1) r.push(`safer floor (${fmt(W.floor)} vs ${fmt(L.floor)})`);
    if (W.median - L.median > 1) r.push(`better typical week (${fmt(W.median)} vs ${fmt(L.median)})`);
    if (L.inj && isOut(L.inj)) r.push(`${ln(b, l)} is ${L.inj}`);
    if (L.bye === b.week) r.push(`${ln(b, l)} is on bye`);
    if (W.trend > 2) r.push(`${ln(b, w)} is trending up`);
    return r.length ? r.slice(0, 2).join(' and ') : 'a slight edge in projection and consistency';
  };
  if (action === 'pickup') {
    const avail = [A, Cc].filter(x => x.statusKind === 'fa');
    if (!avail.length) verdict = `Neither is a free agent: ${A.name} is ${A.status.toLowerCase()} and ${Cc.name} is ${Cc.status.toLowerCase()}.`;
    else if (avail.length === 1) { const P = pron(b, avail[0].id, true); verdict = `Only ${avail[0].name} is available. ${ros(b, avail[0].id) > bestDrop(b, avail[0].id).cost ? `${P}'s worth the add.` : `${P}'s not clearly better than your bench, though.`}`; }
    else { const [w, l] = ros(b, a) >= ros(b, c) ? [a, c] : [c, a]; verdict = `Pick up ${pname(b, w)}: ${why(w, l)}.`; }
  } else if (action === 'drop') {
    const mine = [A, Cc].filter(x => x.statusKind === 'mine');
    if (mine.length < 2) verdict = `You can only drop players on your roster${mine.length ? `. Of these, only ${mine[0].name} is yours` : ''}.`;
    else { const [keep, drop] = ros(b, a) >= ros(b, c) ? [a, c] : [c, a]; verdict = `Drop ${pname(b, drop)} and keep ${pname(b, keep)}: ${why(keep, drop)}.`; }
  } else if (action === 'trade') {
    const fa = b.fc?.[a] || 0, fc = b.fc?.[c] || 0;
    const [w, l] = fa >= fc ? [a, c] : [c, a];
    verdict = `${pname(b, w)} has the higher trade value (${Math.max(fa, fc)} vs ${Math.min(fa, fc)})${tags[w] === 'never' ? `, but you tagged ${pronObj(b, w)} 🔒 Will not trade` : ''}.`;
  } else {
    const sa = startScore(b, a), sc = startScore(b, c);
    const [w, l] = sa >= sc ? [a, c] : [c, a];
    const close = Math.abs(sa - sc) < 1.2;
    const notMine = [w, l].filter(x => !b.me.players.includes(x)).map(x => pname(b, x));
    verdict = close ? `Coin flip. Lean ${pname(b, w)} for ${why(w, l)}.` : `Start ${pname(b, w)}: ${why(w, l)}.`;
    if (notMine.length) verdict += ` (Note: ${notMine.join(' and ')} ${notMine.length > 1 ? "aren't" : "isn't"} on your roster.)`;
  }
  let fit: Fit | undefined, text = '';
  if (!b.isPast) {
    try {
      const f: FitResult = rosterFit(b, a, c);
      fit = { aId: a, bId: c, aPct: f.a.pct, bPct: f.b.pct, reasons: f.reasons };
      const W = f.winner === a ? A : Cc, wp = f.winner === a ? f.a.pct : f.b.pct;
      text = `Roster fit: ${W.name} ${wp}% vs ${(f.winner === a ? Cc : A).name} ${100 - wp}%. ` + f.reasons.slice(0, 2).join('. ') + '.';
      if (!action) {
        // plain "X or Y?": answer with roster fit, not just this week's start score
        const P = pron(b, W.id, true);
        const where = W.statusKind === 'fa' ? ` ${P}'s a free agent, so you'd need a drop.` : W.statusKind === 'other' ? ` ${P}'s on ${W.status}'s team, so it would take a trade.` : '';
        const startPick = verdict;
        const bothMine = A.statusKind === 'mine' && Cc.statusKind === 'mine';
        const startW = startScore(b, a) >= startScore(b, c) ? a : c;
        verdict = bothMine && startW !== W.id
          ? `For your roster: ${W.name} (${wp}% fit). This week: ${startPick.replace(/^Coin flip\. /, '')}`
          : `${wp < 58 ? 'Close call. Lean' : 'Go with'} ${W.name}: ${pron(b, W.id)} fits your roster better (${wp}%).${where}`;
      } else if (action === 'start') verdict = `This week: ${verdict}`;
    } catch {}
  }
  return { text, cards: [A, Cc], verdict, players: [a, c], fit };
}

function pickupOne(b: Bundle, id: string): Reply {
  const C = card(b, id);
  if (C.statusKind === 'mine') return { text: `${C.name} is already on your team.`, cards: [C] };
  if (C.statusKind === 'other') return { text: `${C.name} isn't available. ${C.status} has ${pronObj(b, id)}${C.fc ? ` (trade value ${C.fc})` : ''}. Try the Trades tab if you want ${pronObj(b, id)}.`, cards: [C], tab: 'Trades' };
  const mine = b.me.players.filter(x => !b.me.reserve.includes(x));
  const opt = optimalLineup(b, mine, x => ros(b, x));
  const elig = opt.filter(o => o.id && (FLEX_ELIG[o.slot] || [o.slot]).includes(C.pos)); // v0.0.10: a QB never counts against a FLEX starter
  const weakest = elig.sort((x, y) => x.v - y.v)[0];
  const r = ros(b, id);
  const gain = weakest ? r - weakest.v : 0;
  const drop = bestDrop(b, id);
  const net = (gain > 0 ? r : r * benchWorth(b, C.pos)) - drop.cost; // v0.0.10: bench QB/DEF/K = bye cover only
  const verdict = net > 2 && gain > 0 ? `✅ Yes, add ${pronObj(b, id)}. ${pron(b, id, true)}'d start over ${pname(b, weakest!.id!)} (+${fmt(gain)} expected pts).`
    : net > 0.5 ? `🤔 Worth it as depth (+${fmt(net)} over your weakest bench spot), but ${pron(b, id)} wouldn't start yet.`
    : `❌ Pass. He isn't better than what you already have (${fmt(r)} vs ${fmt(drop.cost)} for your most droppable player).`;
  const dropText = drop.id ? `If you add ${pronObj(b, id)}, drop ${pname(b, drop.id)} (${drop.safety} drop: ${drop.reasons.join('; ')}).` : drop.reasons[0];
  return { text: `${C.name} is a free agent in ${b.league.name}.${C.bye ? ` Bye: week ${C.bye}.` : ''}\n${dropText}`, cards: [C], verdict, players: drop.id ? [id, drop.id] : [id] };
}

function dropOne(b: Bundle, id: string): Reply {
  const C = card(b, id);
  if (C.statusKind !== 'mine') return { text: `${C.name} isn't on your roster.`, cards: [C] };
  const mine = b.me.players.filter(x => !b.me.reserve.includes(x));
  const opt = optimalLineup(b, mine, x => ros(b, x));
  const starting = opt.some(o => o.id === id);
  const alt = bestDrop(b, null);
  const verdict = starting ? `❌ Keep ${pronObj(b, id)}. ${pron(b, id, true)}'s in your best lineup right now.` : alt.id && alt.id !== id && alt.cost < ros(b, id) * benchWorth(b, ppos(b, id)) - 1 ? `🤔 If you need a spot, drop ${pname(b, alt.id)} first (${alt.reasons[0]}).` : `✅ ${pron(b, id, true)}'s a fine drop if you need the spot.`;
  return { text: `${C.name}: ${fmt(C.proj)} proj, ${fmt(C.median)} median, ${C.tier}.`, cards: [C], verdict };
}

function tradeFor(b: Bundle, id: string, tags: Tags): Reply {
  const C = card(b, id);
  if (C.statusKind === 'mine') return { text: `${C.name} is already yours.`, cards: [C] };
  if (C.statusKind === 'fa') return { text: `${C.name} is a free agent, so no trade is needed.`, cards: [C], tab: 'Waivers' };
  const { ideas } = tradeIdeas(b, tags, 40);
  const hit = ideas.find(i => i.get.includes(id));
  if (hit) return { text: `Try offering ${hit.give.map(g => pname(b, g)).join(' + ')} (${hit.giveV}) for ${C.name} (${hit.getV}). Your lineup gains about +${Math.round(hit.net)} value.`, cards: [C], players: [...hit.give, id], tab: 'Trades' };
  const v = b.fc?.[id] || 0;
  const offer = b.me.players.filter(x => tags[x] !== 'never' && x !== id && (b.fc?.[x] || 0) > 0).sort((x, y) => Math.abs((b.fc![x] || 0) - v) - Math.abs((b.fc![y] || 0) - v))[0];
  return { text: `${C.status} has ${C.name} (value ${v}).${offer ? ` The closest value match on your roster is ${pname(b, offer)} (${b.fc![offer]}), but that trade doesn't clearly improve your lineup.` : ''}`, cards: [C], tab: 'Trades' };
}

function startOne(b: Bundle, id: string): Reply {
  const C = card(b, id);
  if (C.statusKind !== 'mine') return { text: `${C.name} isn't on your roster (${C.status}).`, cards: [C] };
  const mine = b.me.players.filter(x => !b.me.reserve.includes(x));
  const opt = optimalLineup(b, mine, x => weekScore(b, x));
  const slot = opt.find(o => o.id === id);
  if (slot) return { text: '', cards: [C], verdict: `✅ Start ${pronObj(b, id)} at ${slotLabel(slot.slot)}${b.me.starters.includes(id) ? ` (${pron(b, id)} already is)` : ''}.` };
  const blockers = opt.filter(o => o.id && ppos(b, o.id) === C.pos).map(o => pname(b, o.id!));
  return { text: '', cards: [C], verdict: `🪑 Bench ${pronObj(b, id)} this week. ${blockers.length ? blockers.join(', ') + ' project higher.' : 'Others project higher.'}${isOut(C.inj) ? ` ${pron(b, id, true)}'s ${C.inj}.` : ''}` };
}

const tv = (n: number) => Math.round(n).toLocaleString('en-US');
export const TRADE_VALUE_NOTE = 'Trade value = market price from FantasyCalc (higher is worth more). "Your lineup" = how much stronger your starters get on that same scale (a backup QB only counts as bye-week cover).';
/** v0.0.11: "I want to trade Pat and Wilson, who should I ask for?" Offers where she gives exactly the players she named. */
export function tradeAwayReply(b: Bundle, tags: Tags, question: string, idx?: NameIndex): Reply | null {
  if (b.isPast || !tradeWords(question)) return null;
  const roster = b.me.players.filter(id => b.players[id]).map(id => ({ id, name: pname(b, id), pos: ppos(b, id) }));
  const { give, ambiguous } = namedOnRoster(question, roster);
  if (!give.length && !ambiguous) return null;
  if (give.length + (ambiguous ? 1 : 0) >= 2 && isEitherOr(question)) return null; // "trade Pat or Wilson?" = compare
  if (ambiguous) {
    const w = ambiguous.word, W = w[0].toUpperCase() + w.slice(1);
    return { text: `You have ${ambiguous.ids.length} players named ${W}. Which one do you mean?`, choices: ambiguous.ids.map(id => ({ label: pname(b, id), q: question.replace(new RegExp(`\\b${w}\\b`, 'i'), pname(b, id)) })) };
  }
  if (!b.fc) return { text: "Trade values haven't loaded yet. Pull down to refresh, then ask again.", players: give };
  // players she wants back, named after "for" ("Pat and Wilson for Puka?"); names before it that aren't on her team get a note
  const giveWords = new Set(give.flatMap(id => normalize(pname(b, id)).split(' ')));
  const owner = (id: string) => b.teams.find(t => t.players.includes(id));
  const { head, tail } = splitAsk(question);
  const want = idx && tail ? findMentions(tail, idx).filter(m => m.clear && m.best && !b.me.players.includes(m.best) && owner(m.best) && !m.phrase.split(' ').some(x => giveWords.has(x)) && ['full', 'full-joined', 'alias', 'last', 'first+partial'].includes(m.cands[0].why)).map(m => m.best!) : [];
  const notMine: string[] = [];
  if (idx) for (const w of [...new Set(head.split(' '))]) {
    if (w.length < 3 || COMMON.has(w) || NOT_A_NAME.has(w) || giveWords.has(w)) continue;
    const c = idx.resolve(w).filter(x => ['first', 'last', 'full'].includes(x.why) && !!b.players[x.id] && !b.me.players.includes(x.id));
    if (!c.length) continue;
    const W = w[0].toUpperCase() + w.slice(1), top = c[0], o = owner(top.id);
    notMine.push(c.length === 1 || top.score - c[1].score >= 4 ? `${pname(b, top.id)} isn't on your team (${o ? `@${o.display} has him` : "he's a free agent"})` : `I don't see a ${W} on your team`);
  }
  const { offers, giveV } = offersFor(b, give, 3, want);
  const names = (ids: string[]) => ids.map(id => pname(b, id)).join(' + ');
  const withPos = (ids: string[]) => ids.map(id => `${pname(b, id)} (${ppos(b, id)})`).join(' + ');
  const lines: string[] = [`Trading ${names(give)}: trade value ${give.length > 1 ? give.map(g => tv(b.fc![g] || 0)).join(' + ') + ' = ' : ''}${tv(giveV)}.`];
  if (notMine.length) lines.unshift(`${notMine.join('. ')}, so this is just for ${names(give)}.`);
  const locked = give.filter(g => tags[g] === 'never');
  if (locked.length) lines.push(`(You tagged ${names(locked)} 🔒 Will not trade, but here's what you could get.)`);
  if (!offers.length) return { text: lines.concat([`I couldn't find a fair trade for ${give.length > 1 ? 'them' : pronObj(b, give[0])}${want.length ? ` that gets you ${names(want)}` : ''} right now.`]).join('\n'), players: give, tab: 'Trades' };
  if (offers[0].net <= 0) lines.push('No fair deal makes your lineup stronger. The closest one:');
  offers.forEach((o, i) => lines.push(`\n${i + 1}. You give: ${names(o.give)}\n    You get: ${withPos(o.get)} (from @${o.team.display})\n    Trade value: ${tv(o.giveV)} for ${tv(o.getV)} · Your lineup: ${o.net >= 0 ? '+' : ''}${tv(o.net)}`));
  lines.push('\n' + TRADE_VALUE_NOTE);
  return { text: lines.join('\n'), players: [...give, ...offers.flatMap(o => o.get)], tab: 'Trades' };
}

/** Trade ideas, honoring "without locked / high value / my starters". 🔒 players are never offered. */
export function tradeIdeasReply(b: Bundle, tags: Tags, ask?: TradeAsk): Reply {
  const opts = { noHigh: !!ask?.noHigh, noStarters: !!ask?.noStarters };
  const { ideas } = tradeIdeas(b, tags, 3, opts);
  const locked = b.me.players.filter(id => tags[id] === 'never'), high = b.me.players.filter(id => tags[id] === 'high');
  const left: string[] = [];
  if (locked.length) left.push(`your ${locked.length} 🔒 player${locked.length === 1 ? '' : 's'}`);
  if (opts.noHigh && high.length) left.push(`your ${high.length} 💎 player${high.length === 1 ? '' : 's'}`);
  if (opts.noStarters) left.push('your starters');
  const head = left.length ? `Not offering ${left.join(' or ')}.\n` : (ask?.noLocked || ask?.noHigh) && !locked.length && !high.length ? "You haven't tagged anyone 🔒 or 💎 yet (tap a player, then a tag), so nothing extra is left out.\n" : '';
  if (!ideas.length) return { text: head + "I couldn't find a fair trade that helps right now" + (left.length ? ' with those players left out.' : '.'), tab: 'Trades' };
  return { text: (head + ideas.map((x, i) => `\n${i + 1}. You give: ${x.give.map(g => pname(b, g)).join(' + ')}${x.highTagged ? ' 💎' : ''}\n    You get: ${x.get.map(g => `${pname(b, g)} (${ppos(b, g)})`).join(' + ')} (from @${x.team.display}${famLabel(x.team.display)})\n    Trade value: ${tv(x.giveV)} for ${tv(x.getV)} · Your lineup: +${tv(x.net)}`).join('\n') + '\n\n' + TRADE_VALUE_NOTE).replace(/^\n/, ''), players: ideas.flatMap(x => [...x.give, ...x.get]), tab: 'Trades' };
}

export class RulesEngine implements ChatEngine {
  readonly name = 'rules';
  readonly enabled = true;
  async answer(question: string, { b, tags }: ChatContext): Promise<Reply> {
    if (b.isPast && !/how am i|record|standing/.test(question.toLowerCase())) return { text: 'That league is finished. Switch to a 2026 league for advice. I can still tell you how you did.' };
    const idx = indexFor(b);
    // v0.0.11: trading HER named players beats a single-player card or generic ideas
    const away = tradeAwayReply(b, tags, question, idx);
    if (away) return away;
    const p = parse(question, idx);
    if (p.ambiguous && (p.intent !== 'help')) {
      const m = p.ambiguous;
      const opts = m.cands.slice(0, 4).filter(c => c.score >= m.cands[0].score - 15);
      return {
        text: `Did you mean ${opts.map(c => `${pname(b, c.id)} (${ppos(b, c.id)}, ${b.players[c.id]?.t || 'FA'})`).join(' or ')}?`,
        choices: opts.map(c => ({ label: pname(b, c.id), q: question.replace(new RegExp(m.phrase.split(' ').join('[\\s.\'-]*'), 'i'), pname(b, c.id)) })),
      };
    }
    const ids = p.mentions.map(m => m.best!).filter(Boolean);
    switch (p.intent) {
      case 'compare': {
        // practice reports for injured players (Sleeper's public news feed, cached 2h)
        const need = ids.slice(0, 2).filter(id => b.players[id]?.i && !b.practice?.[id]);
        if (need.length && !b.isPast) { try { Object.assign((b.practice ||= {}), await practiceFor(need)); } catch {} }
        return compare(b, ids[0], ids[1], p.action, tags, question);
      }
      case 'pickup_one': return pickupOne(b, ids[0]);
      case 'drop_one': return dropOne(b, ids[0]);
      case 'tradefor_one': return tradeFor(b, ids[0], tags);
      case 'start_one': return startOne(b, ids[0]);
      case 'player': { const C = card(b, ids[0]); const v = b.valuer.get(ids[0]); return { text: [v.qbNote, v.fillNote].filter(Boolean).join('\n'), cards: [C], players: [ids[0]] }; }
      case 'lineup': return lineupReply(b);
      case 'waivers_result': {
        const wr = waiverReport(b);
        if (!wr.runAt) return { text: 'No waiver claims yet this season.' };
        const when = new Date(wr.runAt).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        return { text: `Waiver run ${when} CT:\n` + wr.latest.map(x => { const add = x.adds ? Object.keys(x.adds)[0] : ''; const r = txReason(x, wr.latest); return `${x.status === 'complete' ? '✅' : /already/.test(r) ? '↩️' : '❌'} ${pname(b, add)}: ${r}`; }).join('\n') + `\n\nThis season: ${wr.season.ok} won, ${wr.season.fail} missed.`, tab: 'Waivers' };
      }
      case 'best_pickup': {
        const f = pickups(b, 5).slice(0, 3);
        if (!f.length) return { text: 'No free agent beats your roster right now.' };
        return { text: 'Best adds for you:\n' + f.map((x, i) => `${i + 1}. ${pname(b, x.id)} (${x.pos}, ${b.players[x.id]?.t}): ${fmt(x.ros)} expected pts${x.gain > 0 ? `, +${fmt(x.gain)} over ${x.over ? pname(b, x.over) : 'your weakest starter'}` : ' as depth'}. Drop: ${x.drop.id ? pname(b, x.drop.id) : 'none needed'} (${x.drop.safety})`).join('\n'), players: f.map(x => x.id), tab: 'Waivers' };
      }
      case 'trade_ideas': return tradeIdeasReply(b, tags, p.trade);
      case 'status': {
        const s = summary(b); const me = b.me;
        return { text: `${me.name}: ${me.wins}-${me.losses}, ${ordinal(me.rank)} of ${b.teams.length}. ${fmt(me.pf, 0)} points for (${ordinal(me.pfRank)}). All-play: ${s.apW}-${s.apL}, so you'd usually have about ${fmt(s.expectedWins, 1)} wins.`, tab: 'League' };
      }
      case 'matchup': {
        const m = matchupFor(b, b.week);
        if (!m?.opp) return { text: 'No opponent this week.' };
        return { text: `Week ${b.week}: you vs @${m.opp.team.display}${famLabel(m.opp.team.display)} (${m.opp.team.wins}-${m.opp.team.losses}). Projected ${fmt(m.me.proj)} to ${fmt(m.opp.proj)}.`, tab: 'Matchup' };
      }
      case 'report': return { text: 'Your weekly report card is on the Matchup tab. Pick a finished week to see your grade.', tab: 'Matchup' };
      case 'playoffs': return { text: 'Your path to the top 3 (odds, remaining schedule, and the moves that help most) is on the League tab.', tab: 'League' };
      default:
        return { text: 'Ask me things like:\n• "Cook or Skattebo?"\n• "Should I pick up Pitts?"\n• "Drop Freiermuth?"\n• "Trade for Puka?"\n• "Who should I start?"\n• "How did my waivers go?"' };
    }
  }
}

export const rules = new RulesEngine();
// AI tiers live in src/ai (client.ts talks only to the owner's own Worker proxy); the Chat screen picks the tier.
