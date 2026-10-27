import React from 'react';
import { View, Text, useWindowDimensions, Image } from 'react-native';
import { Screen, Card, useApp, T, Chip } from '../ui';
import { Bars, Lines } from '../charts';
import { C } from '../theme';
import { fmt, weeklySeries, ordinal } from '../model';
import { avatarUrl } from '../api';
import PlayoffPath from './PlayoffPath';
import { famLabel } from '../model';

export default function League() {
  const { b, leagues, selectLeague } = useApp();
  const { width } = useWindowDimensions();
  const cw = width - 28 - 28;
  const sorted = [...b.teams].sort((x, y) => x.rank - y.rank);
  const allPlay = b.teams.map(t => { const ws = weeklySeries(b, t.rid); const w = ws.reduce((s, x) => s + x.allPlayW, 0), l = ws.reduce((s, x) => s + x.allPlayL, 0); return { t, pct: w + l ? w / (w + l) : 0 }; }).sort((x, y) => y.pct - x.pct);
  const myAP = allPlay.findIndex(x => x.t.rid === b.me.rid) + 1;
  const seasons = leagues.filter(l => l.name === b.league.name || l.league_id === b.league.previous_league_id);
  const ws = weeklySeries(b);
  return (
    <Screen info="league" title="League" subtitle={`${b.teams.length} teams · ${b.league.scoring_settings?.rec === 1 ? 'PPR' : b.league.scoring_settings?.rec === 0.5 ? 'Half PPR' : 'Standard'}${b.league.settings?.type === 1 ? ' · Keeper' : b.league.settings?.type === 2 ? ' · Dynasty' : ''}`}>
      {seasons.length > 1 ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {seasons.map(l => <Chip key={l.league_id} label={`${l.season}${l.status === 'complete' ? ' (past)' : ''}`} active={l.league_id === b.league.league_id} onPress={() => selectLeague(l.league_id)} />)}
        </View>
      ) : null}
      <PlayoffPath />
      <Card title="Standings" emoji="🏆">
        <View style={{ flexDirection: 'row', paddingBottom: 6 }}>
          <Text style={[T.sub, { width: 22 }]}>#</Text><Text style={[T.sub, { flex: 1 }]}>Team</Text>
          <Text style={[T.sub, { width: 44, textAlign: 'right' }]}>W-L</Text><Text style={[T.sub, { width: 56, textAlign: 'right' }]}>PF</Text><Text style={[T.sub, { width: 56, textAlign: 'right' }]}>PA</Text>
        </View>
        {sorted.map(t => {
          const mine = t.rid === b.me.rid;
          const playoffs = b.league.settings?.playoff_teams || 0;
          return (
            <View key={t.rid} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8, backgroundColor: mine ? C.mintSoft : 'transparent', borderTopWidth: t.rank === playoffs + 1 ? 1 : 0, borderTopColor: C.purple, borderStyle: 'dashed' }}>
              <Text style={{ width: 22, color: t.rank <= playoffs ? C.mint : C.sub, fontWeight: '700' }}>{t.rank}</Text>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {t.avatar ? <Image source={{ uri: avatarUrl(t.avatar) }} style={{ width: 22, height: 22, borderRadius: 11 }} /> : <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.card2 }} />}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: mine ? C.mint : C.text, fontWeight: mine ? '800' : '600', fontSize: 13 }} numberOfLines={1}>{t.name}</Text>
                  <Text style={{ color: C.dim, fontSize: 10 }} numberOfLines={1}>@{t.display}</Text>
                </View>
              </View>
              <Text style={{ width: 44, textAlign: 'right', color: C.text, fontSize: 13 }}>{t.wins}-{t.losses}</Text>
              <Text style={{ width: 56, textAlign: 'right', color: C.text, fontSize: 13 }}>{fmt(t.pf, 0)}</Text>
              <Text style={{ width: 56, textAlign: 'right', color: C.sub, fontSize: 13 }}>{fmt(t.pa, 0)}</Text>
            </View>
          );
        })}
        {b.league.settings?.playoff_teams ? <Text style={[T.sub, { marginTop: 6 }]}>Top {b.league.settings.playoff_teams} make the playoffs (dashed line).</Text> : null}
      </Card>
      <Card title="Points for, every team" emoji="🌌">
        <Bars width={cw} data={[...b.teams].sort((x, y) => y.pf - x.pf).map(t => ({ label: t.display.slice(0, 7), value: t.pf, hi: t.rid === b.me.rid }))} />
        <Text style={T.sub}>You're {ordinal(b.me.pfRank)} in scoring. League average is {fmt(b.teams.reduce((s, t) => s + t.pf, 0) / b.teams.length, 0)}.</Text>
      </Card>
      <Card title="Power ranking (all-play)" emoji="⚡">
        <Text style={[T.sub, { marginBottom: 8 }]}>How often each team would win if it played everyone, every week. This takes schedule luck out of the record.</Text>
        {allPlay.map((x, i) => (
          <View key={x.t.rid} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 }}>
            <Text style={{ width: 18, color: C.sub, fontSize: 12 }}>{i + 1}</Text>
            <Text style={{ width: 96, color: x.t.rid === b.me.rid ? C.mint : C.text, fontSize: 12, fontWeight: x.t.rid === b.me.rid ? '800' : '500' }} numberOfLines={1}>{x.t.display}</Text>
            <View style={{ flex: 1, height: 10, backgroundColor: C.card2, borderRadius: 5 }}>
              <View style={{ width: `${x.pct * 100}%`, height: 10, borderRadius: 5, backgroundColor: x.t.rid === b.me.rid ? C.mint : C.purple }} />
            </View>
            <Text style={{ width: 38, textAlign: 'right', color: C.sub, fontSize: 12 }}>{fmt(x.pct * 100, 0)}%</Text>
          </View>
        ))}
        <Text style={[T.sub, { marginTop: 6 }]}>You're {ordinal(myAP)} in all-play and {ordinal(b.me.rank)} in the standings.</Text>
      </Card>
      {ws.length ? (
        <Card title="You vs the league average" emoji="📊">
          <Lines width={cw} labels={ws.map(x => 'W' + x.w)} series={[{ name: 'You', color: C.mint, values: ws.map(x => x.me), area: true }, { name: 'League avg', color: C.gold, values: ws.map(x => x.avg), dashed: true }]} />
        </Card>
      ) : null}
    </Screen>
  );
}
