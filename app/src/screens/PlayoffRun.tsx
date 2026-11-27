import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image } from 'react-native';
import { Screen, Card, useApp, T } from '../ui';
import { C } from '../theme';
import { sleeper, DAY, avatarUrl } from '../api';
import {
  playoffRace, pairsFromMatchups, PLAYOFF_COPY,
  type GroupId, type RaceResult, type RaceRow, type RaceTeam,
} from '../playoffRace';

const GROUP_COLOR: Record<GroupId, string> = {
  locked: C.mint,
  control: C.green,
  fight: C.gold,
  out: C.dim,
};

function Crown({ size = 12 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.95, lineHeight: size, color: C.gold }}>👑</Text>
    </View>
  );
}

function RangeBar({ now, max, lockWins, scaleMax, color }: { now: number; max: number; lockWins: number | null; scaleMax: number; color: string }) {
  const pct = (w: number) => (scaleMax <= 0 ? 0 : Math.max(0, Math.min(100, (w / scaleMax) * 100)));
  const solid = pct(now);
  const ghost = Math.max(0, pct(max) - solid);
  return (
    <View style={{ height: 14, marginLeft: 30, marginRight: 2, position: 'relative' }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 6, height: 3, backgroundColor: '#0E1430', borderRadius: 2 }} />
      <View style={{ position: 'absolute', left: 0, width: `${solid}%`, top: 4, height: 7, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, borderTopRightRadius: ghost ? 0 : 4, borderBottomRightRadius: ghost ? 0 : 4, backgroundColor: color }} />
      {ghost > 0 ? <View style={{ position: 'absolute', left: `${solid}%`, width: `${ghost}%`, top: 4, height: 7, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: color, opacity: 0.32 }} /> : null}
      {/* Tick at current wins (back of the remaining-games range), same color as the lock line */}
      <View style={{ position: 'absolute', left: `${solid}%`, marginLeft: -1.5, top: 0, width: 3, height: 14, borderRadius: 1, backgroundColor: C.mint }} />
      {lockWins != null ? <View style={{ position: 'absolute', left: `${pct(lockWins)}%`, top: 0, bottom: 0, borderLeftWidth: 1.6, borderStyle: 'dashed', borderColor: C.mint }} /> : null}
    </View>
  );
}

function TeamRow({ row, result, mine, name, avatar, showCrown }: {
  row: RaceRow; result: RaceResult; mine: boolean; name: string; avatar?: string; showCrown: boolean;
}) {
  const color = GROUP_COLOR[row.group];
  return (
    <View style={{ paddingVertical: 4, paddingHorizontal: 4, borderRadius: 8, backgroundColor: mine ? C.mintSoft : 'transparent' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        {avatar ? <Image source={{ uri: avatarUrl(avatar) }} style={{ width: 22, height: 22, borderRadius: 11 }} /> : <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.card2 }} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: mine ? C.mint : C.text, fontWeight: mine ? '800' : '600', fontSize: 13 }} numberOfLines={1}>{name}</Text>
          <Text style={{ color: C.dim, fontSize: 10 }} numberOfLines={1}>{row.finish}</Text>
        </View>
        <Text style={{ width: 36, textAlign: 'right', color: C.text, fontSize: 13 }}>{row.ties ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`}</Text>
        {showCrown ? <Crown size={14} /> : <View style={{ width: 14 }} />}
      </View>
      <RangeBar now={row.wins} max={row.maxWins} lockWins={result.lockWins} scaleMax={result.scaleMax} color={color} />
    </View>
  );
}

function CompactSeed({ title, rids, byRid }: { title: string; rids: number[]; byRid: Record<number, { name: string; display: string; avatar?: string }>; }) {
  if (!rids.length) return null;
  return (
    <View style={{ marginBottom: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.gold }} />
        <Text style={{ color: C.sub, fontSize: 12, fontWeight: '800' }}>{title}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6 }}>
        {rids.map(rid => {
          const t = byRid[rid];
          const label = t?.name || t?.display || '';
          const short = label.length > 12 ? (t?.display || label).slice(0, 11) : label;
          return (
            <View key={rid} style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 2 }}>
              <View style={{ position: 'relative' }}>
                {t?.avatar ? <Image source={{ uri: avatarUrl(t.avatar) }} style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: C.gold }} /> : <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.card2, borderWidth: 1.5, borderColor: C.gold }} />}
                <View style={{ position: 'absolute', top: -6, right: -8 }}><Crown size={11} /></View>
              </View>
              <Text style={{ color: C.sub, fontSize: 9, fontWeight: '700' }} numberOfLines={1}>{short}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function PlayoffRun() {
  const { b } = useApp();
  const [future, setFuture] = useState<Record<number, any[]> | null>(null);
  const lastReg = Math.max(1, (Number(b.playoffStart) || 16) - 1);
  const first = (Number(b.lastScored) || 0) + 1;
  useEffect(() => {
    let on = true;
    setFuture(null);
    if (b.isPast || first > lastReg) { setFuture({}); return () => { on = false; }; }
    const ws = Array.from({ length: Math.max(0, lastReg - first + 1) }, (_, i) => first + i);
    Promise.all(ws.map(w => sleeper.matchups(b.league.league_id, w, DAY).catch(() => []))).then(arr => {
      if (!on) return;
      const o: Record<number, any[]> = {};
      ws.forEach((w, i) => { o[w] = arr[i] || []; });
      setFuture(o);
    });
    return () => { on = false; };
  }, [b.league.league_id, b.loadedAt, first, lastReg, b.isPast]);

  const result = useMemo(() => {
    const teams: RaceTeam[] = b.teams.map(t => ({
      rid: t.rid, wins: t.wins, losses: t.losses, ties: t.ties || 0, pf: t.pf, division: t.division,
    }));
    const weeksLeft = Math.max(0, lastReg - (Number(b.lastScored) || 0));
    const games = future == null ? [] : pairsFromMatchups(future);
    return playoffRace({
      teams,
      playoffTeams: Number(b.playoffTeams || b.league.settings?.playoff_teams || 0),
      playoffStart: b.playoffStart,
      lastScored: b.lastScored,
      week: b.week,
      playoffSeedType: Number(b.league.settings?.playoff_seed_type || 0),
      games: future == null && weeksLeft > 0 ? [] : games,
      weeksLeft,
    });
  }, [b, future, lastReg]);

  const byTeam: Record<number, { name: string; display: string; avatar?: string }> = {};
  for (const t of b.teams) byTeam[t.rid] = { name: t.name, display: t.display, avatar: t.avatar };

  const waiting = future == null && !b.isPast && first <= lastReg;
  const subtitle = result.unconfigured
    ? undefined
    : result.seasonOver || b.isPast
      ? PLAYOFF_COPY.seasonOver
      : PLAYOFF_COPY.weekOf(b.week, result.lastRegularWeek);

  return (
    <Screen info="playoffrun" title={PLAYOFF_COPY.title} subtitle={subtitle}>
      {waiting ? <Card><Text style={T.sub}>{PLAYOFF_COPY.loading}</Text></Card> : result.unconfigured ? (
        <Card><Text style={T.body}>{PLAYOFF_COPY.unconfigured}</Text></Card>
      ) : (
        <Card>
          <CompactSeed
            title={result.seed1.clinched ? PLAYOFF_COPY.clinched1 : PLAYOFF_COPY.stillOpen1}
            rids={result.seed1.rids}
            byRid={byTeam}
          />
          {result.byes ? (
            <CompactSeed
              title={result.byes.clinched.length && !result.byes.open.length ? PLAYOFF_COPY.clinchedBye : PLAYOFF_COPY.stillOpenBye}
              rids={[...result.byes.clinched, ...result.byes.open]}
              byRid={byTeam}
            />
          ) : null}
          {result.lockWins != null ? (
            <View style={{ marginLeft: 30, marginBottom: 4, height: 14, position: 'relative' }}>
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 2, height: 3, backgroundColor: '#0E1430', borderRadius: 2 }} />
              <View style={{ position: 'absolute', left: `${result.scaleMax ? (result.lockWins / result.scaleMax) * 100 : 0}%`, top: 0, bottom: 0, borderLeftWidth: 1.6, borderStyle: 'dashed', borderColor: C.mint }} />
              <Text style={{ position: 'absolute', left: `${result.scaleMax ? (result.lockWins / result.scaleMax) * 100 : 0}%`, transform: [{ translateX: -6 }], top: -1, color: C.mint, fontSize: 9.5, fontWeight: '800' }}>{result.lockWins}</Text>
            </View>
          ) : null}
          {result.groups.map(g => (
            <View key={g.id} style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: GROUP_COLOR[g.id] }} />
                <Text style={{ color: C.sub, fontSize: 12, fontWeight: '800' }}>{g.title}</Text>
              </View>
              {g.rows.map(row => (
                <TeamRow
                  key={row.rid}
                  row={row}
                  result={result}
                  mine={row.rid === b.me.rid}
                  name={byTeam[row.rid]?.name || byTeam[row.rid]?.display || ''}
                  avatar={byTeam[row.rid]?.avatar}
                  showCrown={row.alive1 || row.clinch1}
                />
              ))}
            </View>
          ))}
          <View style={{ height: 56 }} />
        </Card>
      )}
    </Screen>
  );
}

