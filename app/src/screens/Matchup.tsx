import React, { useEffect, useState } from 'react';
import { View, Text, useWindowDimensions, ScrollView, Platform } from 'react-native';
import { Screen, Card, PlayerRow, useApp, T, Chip, Head } from '../ui';
import { VersusBars, TugBar } from '../charts';
import { C } from '../theme';
import { matchupFor, posBreakdown, fmt, projOf, slotLabel, pname, famLabel, byeWeek } from '../model';
import { LiveGame, loadLiveGames, matchupFinal, resultLine } from '../live';
import ReportCard from './ReportCard';
import LiveCard from './Live';

export default function Matchup() {
  const { b } = useApp();
  const { width } = useWindowDimensions();
  const cw = width - 28 - 28;
  const [week, setWeek] = useState(() => (Platform.OS === 'web' && typeof window !== 'undefined' && Number(new URLSearchParams(window.location.search).get('week'))) || b.week);
  const m = matchupFor(b, week);
  // v0.0.9: a week Sleeper hasn't scored yet is only decided when every starter's game on both sides is final
  const scored = b.isPast || week <= b.lastScored;
  const [games, setGames] = useState<Record<string, LiveGame> | null>(null);
  useEffect(() => {
    if (scored) return;
    let on = true;
    const go = () => loadLiveGames(b.season, week, false).then(g => { if (on) setGames(g); }).catch(() => {});
    go(); const iv = setInterval(go, 25_000);
    return () => { on = false; clearInterval(iv); };
  }, [week, b.loadedAt, scored]);
  const played = !!m && (m.me.points > 0 || (m.opp?.points ?? 0) > 0);
  const weeks = Array.from({ length: b.isPast ? b.lastScored : b.week }, (_, i) => i + 1);
  if (!m) return <Screen info="matchup" title="Matchup"><Card><Text style={T.body}>No matchup found for week {week}.</Text></Card></Screen>;
  const useProj = !played && !b.isPast;
  const teamOf = (id: string) => b.players[id]?.t;
  const decided = scored || matchupFinal([...m.me.starters, ...(m.opp?.starters || [])].map(id => ({ id, g: games?.[teamOf(id) || ''], team: teamOf(id), bye: !!teamOf(id) && byeWeek(b, id) === week })), games);
  const a = useProj ? m.me.proj : m.me.points, o = useProj ? (m.opp?.proj ?? 0) : (m.opp?.points ?? 0);
  const pa = posBreakdown(b, m.me, useProj), po = posBreakdown(b, m.opp, useProj);
  const rows = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => ({ label: p, a: pa[p] || 0, b: po[p] || 0 }));
  const edge = rows.filter(r => r.a > r.b).map(r => r.label), weak = rows.filter(r => r.b > r.a).map(r => r.label);
  return (
    <Screen info="matchup" title={`Week ${week}`} subtitle={useProj ? 'Projected (games not started)' : played ? 'Final / live scores' : ''}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {weeks.map(w => <Chip key={w} label={`W${w}${w <= b.lastScored ? ' ✓' : ''}`} active={w === week} onPress={() => setWeek(w)} />)}
      </ScrollView>
      {!b.isPast && (week === b.week || (Platform.OS === 'web' && typeof window !== 'undefined' && Number(new URLSearchParams(window.location.search).get('livewk')) === week)) ? <LiveCard week={week} /> : null}
      <Card accent={a >= o ? C.mint : C.magenta}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: C.mint, fontSize: 12, fontWeight: '700' }}>YOU</Text>
            <Text style={{ color: C.text, fontSize: 34, fontWeight: '900' }}>{fmt(a)}</Text>
            <Text style={T.sub} numberOfLines={1}>{m.me.team.name}</Text>
          </View>
          <Text style={{ color: C.dim, fontWeight: '800' }}>VS</Text>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: C.magenta, fontSize: 12, fontWeight: '700' }}>{m.opp?.team?.display?.toUpperCase() || 'BYE'}{m.opp?.team ? famLabel(m.opp.team.display).toUpperCase() : ''}</Text>
            <Text style={{ color: C.text, fontSize: 34, fontWeight: '900' }}>{fmt(o)}</Text>
            <Text style={T.sub} numberOfLines={1}>{m.opp?.team?.name || ''}{m.opp?.team ? ` (${m.opp.team.wins}-${m.opp.team.losses})` : ''}</Text>
          </View>
        </View>
        <View style={{ marginTop: 12 }}><TugBar a={a} b={o} width={cw} /></View>
        <Text style={[T.sub, { marginTop: 8, textAlign: 'center' }]}>
          {resultLine(a, o, useProj, decided, fmt)}
        </Text>
      </Card>
      {week <= b.lastScored && !b.isPast ? <ReportCard week={week} /> : null}
      <Card title="Position by position" emoji="⚔️" right={<Text style={T.sub}>{useProj ? 'projected' : 'actual'}</Text>}>
        <VersusBars rows={rows} width={cw} />
        <Text style={[T.sub, { marginTop: 8 }]}>
          {edge.length ? `You have the edge at ${edge.join(', ')}. ` : ''}{weak.length ? `They're stronger at ${weak.join(', ')}.` : ''}
        </Text>
      </Card>
      <Card title="Head to head" emoji="🧑‍🤝‍🧑">
        {m.me.starters.map((id, i) => {
          const oid = m.opp?.starters[i];
          const av = useProj ? projOf(b, id) : m.me.sp[i] || 0;
          const ov = oid ? (useProj ? projOf(b, oid) : m.opp!.sp[i] || 0) : 0;
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Head id={id} size={26} />
                <View style={{ flex: 1 }}><Text style={{ color: C.text, fontSize: 12 }} numberOfLines={1}>{pname(b, id)}</Text><Text style={{ color: av >= ov ? C.mint : C.sub, fontWeight: '800', fontSize: 13 }}>{fmt(av)}</Text></View>
              </View>
              <Text style={{ width: 40, textAlign: 'center', color: C.dim, fontSize: 10, fontWeight: '700' }}>{slotLabel(b.slots[i] || '')}</Text>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                <View style={{ flex: 1, alignItems: 'flex-end' }}><Text style={{ color: C.text, fontSize: 12 }} numberOfLines={1}>{oid ? pname(b, oid) : '-'}</Text><Text style={{ color: ov > av ? C.magenta : C.sub, fontWeight: '800', fontSize: 13 }}>{fmt(ov)}</Text></View>
                {oid ? <Head id={oid} size={26} /> : null}
              </View>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}
