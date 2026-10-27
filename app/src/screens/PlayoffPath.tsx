import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, useWindowDimensions, Pressable } from 'react-native';
import { Card, useApp, T } from '../ui';
import { Bars, Ring } from '../charts';
import { C } from '../theme';
import { sleeper, DAY } from '../api';
import { playoffPath } from '../playoff';
import { pickups } from '../pickups';
import { tradeIdeas } from '../trades';
import { fmt, ordinal, pname, ros, famLabel } from '../model';

export default function PlayoffPath() {
  const { b, tags, go } = useApp();
  const { width } = useWindowDimensions();
  const [future, setFuture] = useState<Record<number, any[]> | null>(null);
  const first = b.lastScored + 1, last = b.playoffStart - 1;
  useEffect(() => {
    let on = true; setFuture(null);
    const ws = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
    Promise.all(ws.map(w => sleeper.matchups(b.league.league_id, w, DAY).catch(() => []))).then(arr => { if (!on) return; const o: Record<number, any[]> = {}; ws.forEach((w, i) => (o[w] = arr[i] || [])); setFuture(o); });
    return () => { on = false; };
  }, [b.league.league_id, b.loadedAt]);
  const res = useMemo(() => {
    if (!future) return null;
    const base = playoffPath(b, future, 3, 2000);
    const moves: { label: string; gain: number; p: number; tab: string }[] = [];
    const pk = pickups(b, 10).filter(x => x.gain > 0.5)[0];
    if (pk) moves.push({ label: `Add ${pname(b, pk.id)}${pk.drop.id ? `, drop ${pname(b, pk.drop.id)}` : ''}`, gain: pk.gain, p: playoffPath(b, future, 3, 1200, pk.gain).pTop, tab: 'Waivers' });
    const ti = tradeIdeas(b, tags, 10).ideas.map(i => ({ i, g: i.get.reduce((s, id) => s + ros(b, id), 0) - i.give.reduce((s, id) => s + (b.me.starters.includes(id) ? ros(b, id) : 0), 0) })).filter(x => x.g > 0.5).sort((x, y) => y.g - x.g)[0];
    if (ti) moves.push({ label: `Trade ${ti.i.give.map(id => pname(b, id)).join(' + ')} for ${pname(b, ti.i.get[0])} (@${ti.i.team.display}${famLabel(ti.i.team.display)})`, gain: ti.g, p: playoffPath(b, future, 3, 1200, ti.g).pTop, tab: 'Trades' });
    const alertGain = (() => { const cur = b.me.starters.reduce((s, id) => s + (id && id !== '0' && !/IR|Out|NA/.test(b.players[id]?.i || '') ? ros(b, id) : 0), 0); return 0; })();
    return { base, moves: moves.sort((x, y) => y.p - x.p), alertGain };
  }, [future, tags]);
  if (b.isPast || last < first) return null;
  if (!res) return <Card title="Path to the top 3" emoji="🛤️"><Text style={T.sub}>Running 2,000 season simulations…</Text></Card>;
  const r = res.base;
  const cw = width - 56;
  const pc = (p: number) => `${Math.round(p * 100)}%`;
  return (
    <Card title="Path to the top 3" emoji="🛤️" accent={C.purple}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Ring pct={r.pTop} size={84} color={r.pTop >= 0.5 ? C.mint : r.pTop >= 0.2 ? C.gold : C.magenta} label={pc(r.pTop)} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: C.text, fontWeight: '800', fontSize: 15 }}>Chance to finish top 3</Text>
          <Text style={T.sub}>Now {ordinal(r.rank)} · {r.gamesBack ? `${r.gamesBack} game${r.gamesBack > 1 ? 's' : ''} back of 3rd` : 'in the top 3 by wins'}</Text>
          <Text style={T.sub}>Playoffs (top {b.playoffTeams}): <Text style={{ color: C.mint, fontWeight: '700' }}>{pc(r.pPlayoffs)}</Text> · Expected final record ~{fmt(r.expWins, 1)} wins</Text>
          <Text style={T.sub}>Likely finish: {ordinal(r.rankLo)}–{ordinal(r.rankHi)} (most likely {ordinal(r.rankMed)})</Text>
        </View>
      </View>
      <Text style={[T.sub, { marginTop: 10 }]}>Final regular-season rank across {r.sims.toLocaleString()} simulations</Text>
      <Bars width={cw} height={120} valueFmt={v => (v ? Math.round((v / r.sims) * 100) + '%' : '')} data={r.rankDist.slice(1).map((v, i) => ({ label: ordinal(i + 1), value: v, hi: i < 3 }))} />
      <Text style={{ color: C.text, fontWeight: '700', marginTop: 8, marginBottom: 4 }}>Remaining schedule (weeks {first}–{last})</Text>
      {r.weeks.map(w => {
        const col = w.pWin >= 0.6 ? C.green : w.pWin >= 0.45 ? C.gold : C.red;
        return (
          <View key={w.w} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
            <Text style={{ width: 30, color: C.dim, fontSize: 11, fontWeight: '700' }}>W{w.w}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 12.5 }} numberOfLines={1}>@{w.opp?.display}{famLabel(w.opp?.display || '')} <Text style={{ color: C.dim }}>({w.oppRec}, {fmt(w.oppAvg, 0)} avg)</Text></Text>
              <View style={{ height: 6, backgroundColor: C.card2, borderRadius: 3, marginTop: 3 }}><View style={{ width: `${w.pWin * 100}%`, height: 6, borderRadius: 3, backgroundColor: col }} /></View>
            </View>
            <Text style={{ width: 40, textAlign: 'right', color: col, fontWeight: '800', fontSize: 12 }}>{pc(w.pWin)}</Text>
          </View>
        );
      })}
      {res.moves.length ? (
        <>
          <Text style={{ color: C.text, fontWeight: '700', marginTop: 10, marginBottom: 4 }}>Moves that help most</Text>
          {res.moves.map((m, i) => (
            <Pressable key={i} onPress={() => go(m.tab)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.border }}>
              <View style={{ flex: 1 }}><Text style={{ color: C.text, fontSize: 12.5 }}>{m.label}</Text><Text style={{ color: C.dim, fontSize: 11 }}>+{fmt(m.gain)} expected pts/week</Text></View>
              <Text style={{ color: m.p > r.pTop ? C.mint : C.sub, fontWeight: '800', fontSize: 12 }}>{pc(r.pTop)} → {pc(m.p)}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
      <Text style={[T.sub, { marginTop: 8, color: C.dim }]}>Each team's weekly score is modeled from its season average and week-to-week swings (your average is blended with this week's best projected lineup). Ties are broken by points for.</Text>
    </Card>
  );
}
