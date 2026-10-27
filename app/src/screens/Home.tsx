import React from 'react';
import { View, Text, useWindowDimensions, Pressable } from 'react-native';
import { Screen, Card, PlayerRow, Stat, useApp, T } from '../ui';
import { Lines, Bars, Ring } from '../charts';
import { GradeTeaser } from './ReportCard';
import UpdateBanner from './UpdateBanner';
import { C } from '../theme';
import { lineupAlerts, summary, fmt, ordinal, projOf, ppg, slotLabel, contributors, pname } from '../model';

export default function Home() {
  const { b, go, openSettings, openVideos } = useApp();
  const { width } = useWindowDimensions();
  const cw = width - 28 - 28;
  const sm = summary(b);
  const alerts = lineupAlerts(b);
  // v0.0.7: a game with one of her starters is on right now (from this week's ESPN schedule, no polling here)
  const now = Date.now();
  const liveNow = !b.isPast && b.me.starters.some(id => { const g = b.games?.[b.players[id]?.t || '']; return !!g && now >= g.kickoff && now - g.kickoff < 4 * 3600_000; });
  const me = b.me;
  const games = me.wins + me.losses + me.ties;
  const bench = me.players.filter(id => !me.starters.includes(id) && !me.reserve.includes(id));
  const contrib = contributors(b).slice(0, 8);
  const blurb = me.pfRank === 1 && me.rank > 1 ? `Most points in the league, but ${me.wins}-${me.losses}. The schedule has been rough.`
    : sm.luck < -0.8 ? `You've been unlucky: your scores would usually be good for about ${fmt(sm.expectedWins, 1)} wins.`
    : sm.luck > 0.8 ? `You've had some luck so far. Your scores point to about ${fmt(sm.expectedWins, 1)} wins.`
    : `Your record matches how you've scored (${fmt(sm.expectedWins, 1)} expected wins).`;
  return (
    <Screen info="team" title={me.name} subtitle={`@${me.display} · ${b.isPast ? 'Final' : 'Week ' + b.week}`} right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Pressable onPress={openVideos} hitSlop={8} accessibilityLabel="Videos" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 14, borderWidth: 1, borderColor: C.magenta + '99', backgroundColor: 'rgba(198,76,255,0.14)', paddingHorizontal: 9, paddingVertical: 5 }}><Text style={{ fontSize: 13 }}>🎬</Text><Text style={{ color: C.text, fontSize: 12, fontWeight: '800' }}>Videos</Text></Pressable><Pressable onPress={() => openSettings()} hitSlop={10} accessibilityLabel="Settings" style={{ padding: 6 }}><Text style={{ fontSize: 22 }}>⚙️</Text></Pressable></View>}>
      <UpdateBanner />
      {liveNow ? (
        <Pressable onPress={() => go('Matchup')} style={{ borderRadius: 14, borderWidth: 1, borderColor: C.red + 'aa', backgroundColor: 'rgba(255,92,122,0.12)', padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 14 }}>🔴</Text><Text style={{ color: C.text, fontWeight: '800', flex: 1 }}>Your players are on the field</Text><Text style={{ color: C.mint, fontWeight: '800' }}>Live matchup ›</Text>
        </Pressable>
      ) : null}
      <Card accent={C.purple}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Ring pct={games ? (me.wins + me.ties / 2) / games : 0} label={`${me.wins}-${me.losses}${me.ties ? '-' + me.ties : ''}`} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>{ordinal(me.rank)} <Text style={{ color: C.sub, fontSize: 14, fontWeight: '600' }}>of {b.teams.length}</Text></Text>
            <Text style={[T.sub, { marginTop: 4 }]}>{blurb}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', marginTop: 14 }}>
          <Stat label={`Points for (${ordinal(me.pfRank)})`} value={fmt(me.pf, 0)} color={C.mint} />
          <Stat label="Points against" value={fmt(me.pa, 0)} color={C.magenta} />
          <Stat label="All-play" value={`${sm.apW}-${sm.apL}`} />
          {me.ppts ? <Stat label="Lineup IQ" value={fmt(sm.eff * 100, 0) + '%'} color={C.gold} /> : null}
        </View>
      </Card>

      {!b.isPast && b.lastScored >= 1 ? <GradeTeaser week={b.lastScored} /> : null}
      {alerts.length ? (
        <Card title="Lineup alerts" emoji="🚨" accent={C.red}>
          {alerts.map((a, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 5 }}>
              <Text style={{ color: a.kind === 'q' ? C.gold : C.red }}>●</Text>
              <Text style={[T.body, { flex: 1, fontSize: 13 }]}>{a.text}</Text>
            </View>
          ))}
          <Text style={[T.sub, { marginTop: 6, color: C.dim }]}>Make lineup changes in the Sleeper app. This app is read-only.</Text>
        </Card>
      ) : !b.isPast ? <Card title="Lineup check" emoji="✅"><Text style={T.sub}>No injured or empty starters. Looking good.</Text></Card> : null}

      <Card title="Weekly scores" emoji="📈" right={<Pressable onPress={() => go('League')}><Text style={{ color: C.mint, fontSize: 12 }}>League ›</Text></Pressable>}>
        <Lines width={cw} labels={sm.ws.map(x => 'W' + x.w)} series={[
          { name: 'You', color: C.mint, values: sm.ws.map(x => x.me), area: true },
          { name: 'Opponent', color: C.magenta, values: sm.ws.map(x => x.opp) },
          { name: 'League avg', color: C.sub, values: sm.ws.map(x => x.avg), dashed: true },
        ]} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {sm.ws.map(x => (
            <View key={x.w} style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: (x.win ? C.green : C.red) + '22' }}>
              <Text style={{ color: x.win ? C.green : C.red, fontSize: 11, fontWeight: '700' }}>W{x.w} {x.win ? 'W' : 'L'}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Card title={b.isPast ? 'Final roster' : 'Starters'} emoji="🏈" right={!b.isPast ? <Text style={T.sub}>proj · avg</Text> : <Text style={T.sub}>avg</Text>}>
        {me.starters.map((id, i) => (
          <PlayerRow key={i + id} id={id} slot={slotLabel(b.slots[i] || '')} right={
            <View style={{ alignItems: 'flex-end' }}>
              {!b.isPast ? <Text style={{ color: C.text, fontWeight: '700' }}>{fmt(projOf(b, id))}</Text> : null}
              <Text style={T.sub}>{fmt(ppg(b, id))}</Text>
            </View>} />
        ))}
      </Card>
      <Card title="Bench" emoji="🪑">
        {bench.map(id => <PlayerRow key={id} id={id} slot="BN" right={<View style={{ alignItems: 'flex-end' }}>{!b.isPast ? <Text style={{ color: C.text, fontWeight: '700' }}>{fmt(projOf(b, id))}</Text> : null}<Text style={T.sub}>{fmt(ppg(b, id))}</Text></View>} />)}
        {me.reserve.map(id => <PlayerRow key={id} id={id} slot="IR" dim />)}
      </Card>
      {contrib.length ? (
        <Card title="Who's carried you" emoji="💪" right={<Text style={T.sub}>pts as a starter</Text>}>
          <Bars width={cw} height={150} data={contrib.map((c, i) => ({ label: pname(b, c.id).split(' ').slice(-1)[0].slice(0, 8), value: c.pts, hi: c.onTeam }))} />
          <Text style={[T.sub, { marginTop: 4 }]}>Gray bars are players who are no longer on your team.</Text>
        </Card>
      ) : null}
    </Screen>
  );
}
