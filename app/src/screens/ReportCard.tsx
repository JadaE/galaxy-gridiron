import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Card, useApp, T, Head } from '../ui';
import { C } from '../theme';
import { stats } from '../api';
import { weekReport, Report } from '../report';
import { fmt, pname, slotLabel } from '../model';

export function useReport(week: number) {
  const { b } = useApp();
  const [proj, setProj] = useState<Record<string, number[]> | null | undefined>(undefined);
  useEffect(() => { let on = true; setProj(undefined); stats.projections(b.season, week).then(p => on && setProj(p)).catch(() => on && setProj(null)); return () => { on = false; }; }, [week, b.league.league_id]);
  if (proj === undefined) return { loading: true, r: null as Report | null };
  return { loading: false, r: weekReport(b, week, proj) };
}

const gColor = (r: Report) => (r.gradeColor === 'good' ? C.mint : r.gradeColor === 'ok' ? C.gold : C.red);

export function GradeTeaser({ week }: { week: number }) {
  const { go } = useApp();
  const { r } = useReport(week);
  if (!r) return null;
  return (
    <Pressable onPress={() => go('Matchup')}>
      <Card accent={gColor(r)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 58, height: 58, borderRadius: 14, borderWidth: 2, borderColor: gColor(r), alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: gColor(r), fontSize: 26, fontWeight: '900' }}>{r.grade}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 15 }}>Week {week} report card</Text>
            <Text style={T.sub}>{fmt(r.total)} pts{r.projTotal ? ` vs ${fmt(r.projTotal)} projected` : ''} · {fmt(r.benchLeft)} left on bench</Text>
          </View>
          <Text style={{ color: C.mint }}>›</Text>
        </View>
      </Card>
    </Pressable>
  );
}

export default function ReportCard({ week }: { week: number }) {
  const { b, openPlayer } = useApp();
  const { loading, r } = useReport(week);
  if (loading) return <Card title={`Week ${week} report card`} emoji="📝"><Text style={T.sub}>Grading…</Text></Card>;
  if (!r) return null;
  const col = gColor(r);
  return (
    <Card title={`Week ${week} report card`} emoji="📝" accent={col}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 74, height: 74, borderRadius: 18, borderWidth: 3, borderColor: col, alignItems: 'center', justifyContent: 'center', backgroundColor: col + '18' }}>
          <Text style={{ color: col, fontSize: 34, fontWeight: '900' }}>{r.grade}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>{fmt(r.total)} pts {r.won == null ? '' : r.won ? '· W 🎉' : '· L'}</Text>
          <Text style={T.sub}>Projected {r.projTotal != null ? fmt(r.projTotal) : '-'} · League median {fmt(r.median)} · High {fmt(r.high)}</Text>
          <Text style={T.sub}>Best possible lineup {fmt(r.optimal)} · <Text style={{ color: r.benchLeft > 10 ? C.red : C.sub }}>{fmt(r.benchLeft)} left on bench</Text></Text>
        </View>
      </View>
      {r.notes.map((n, i) => <Text key={i} style={[T.sub, { marginTop: 6 }]}>• {n}</Text>)}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {r.best ? <Pressable onPress={() => openPlayer(r.best!.id)} style={{ flex: 1, backgroundColor: C.green + '18', borderRadius: 10, padding: 8, flexDirection: 'row', gap: 6, alignItems: 'center' }}><Head id={r.best.id} size={28} /><View style={{ flex: 1 }}><Text style={{ color: C.green, fontSize: 10, fontWeight: '800' }}>BEST</Text><Text style={{ color: C.text, fontSize: 12 }} numberOfLines={1}>{pname(b, r.best.id)}</Text><Text style={{ color: C.green, fontSize: 11, fontWeight: '700' }}>+{fmt(r.best.diff!)} vs proj</Text></View></Pressable> : null}
        {r.worst ? <Pressable onPress={() => openPlayer(r.worst!.id)} style={{ flex: 1, backgroundColor: C.red + '18', borderRadius: 10, padding: 8, flexDirection: 'row', gap: 6, alignItems: 'center' }}><Head id={r.worst.id} size={28} /><View style={{ flex: 1 }}><Text style={{ color: C.red, fontSize: 10, fontWeight: '800' }}>WORST</Text><Text style={{ color: C.text, fontSize: 12 }} numberOfLines={1}>{pname(b, r.worst.id)}</Text><Text style={{ color: C.red, fontSize: 11, fontWeight: '700' }}>{fmt(r.worst.diff!)} vs proj</Text></View></Pressable> : null}
      </View>
      <View style={{ marginTop: 10 }}>
        <View style={{ flexDirection: 'row', paddingBottom: 4 }}>
          <Text style={[T.sub, { width: 38 }]}></Text><Text style={[T.sub, { flex: 1 }]}>Starter</Text><Text style={[T.sub, { width: 46, textAlign: 'right' }]}>Proj</Text><Text style={[T.sub, { width: 46, textAlign: 'right' }]}>Actual</Text><Text style={[T.sub, { width: 46, textAlign: 'right' }]}>+/-</Text>
        </View>
        {r.lines.map((l, i) => (
          <Pressable key={i} onPress={() => l.id && l.id !== '0' && openPlayer(l.id)} style={{ flexDirection: 'row', paddingVertical: 3 }}>
            <Text style={{ width: 38, color: C.dim, fontSize: 10.5, fontWeight: '700' }}>{slotLabel(l.slot)}</Text>
            <Text style={{ flex: 1, color: C.text, fontSize: 12 }} numberOfLines={1}>{l.id && l.id !== '0' ? pname(b, l.id) : 'Empty'}</Text>
            <Text style={{ width: 46, textAlign: 'right', color: C.sub, fontSize: 12 }}>{l.proj != null ? fmt(l.proj) : '-'}</Text>
            <Text style={{ width: 46, textAlign: 'right', color: C.text, fontSize: 12, fontWeight: '700' }}>{fmt(l.actual)}</Text>
            <Text style={{ width: 46, textAlign: 'right', color: l.diff == null ? C.dim : l.diff >= 0 ? C.green : C.red, fontSize: 12, fontWeight: '700' }}>{l.diff == null ? '-' : (l.diff >= 0 ? '+' : '') + fmt(l.diff)}</Text>
          </Pressable>
        ))}
        <View style={{ flexDirection: 'row', paddingTop: 5, borderTopWidth: 1, borderTopColor: C.border, marginTop: 3 }}>
          <Text style={{ flex: 1, color: C.text, fontWeight: '800', fontSize: 12 }}>Total</Text>
          <Text style={{ width: 46, textAlign: 'right', color: C.sub, fontSize: 12 }}>{r.projTotal != null ? fmt(r.projTotal) : '-'}</Text>
          <Text style={{ width: 46, textAlign: 'right', color: C.text, fontSize: 12, fontWeight: '800' }}>{fmt(r.total)}</Text>
          <Text style={{ width: 46, textAlign: 'right', color: r.projTotal == null ? C.dim : r.total >= r.projTotal ? C.green : C.red, fontSize: 12, fontWeight: '800' }}>{r.projTotal == null ? '-' : (r.total >= r.projTotal ? '+' : '') + fmt(r.total - r.projTotal)}</Text>
        </View>
      </View>
      <Text style={[T.sub, { marginTop: 8, color: C.dim }]}>Grade weighs your score vs the league median (50%), how close you came to your best possible lineup (30%), and actual vs projected (20%).</Text>
    </Card>
  );
}
