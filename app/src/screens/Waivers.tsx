import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Screen, Card, PlayerRow, useApp, T, Chip } from '../ui';
import { Ring } from '../charts';
import { C } from '../theme';
import { waiverReport, txReason, fmt, pname, rosteredSet } from '../model';
import { pickups, openSpots } from '../pickups';
import { movesReport, Move } from '../moves';
import { Pressable } from 'react-native';

const ct = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';

export default function Waivers() {
  const { b } = useApp();
  const [pos, setPos] = useState('ALL');
  if (b.isPast) return <Screen info="waivers" title="Waivers"><Card><Text style={T.body}>Waivers and free-agent tools are for current seasons. Switch to a 2026 league.</Text></Card></Screen>;
  const wr = waiverReport(b);
  const fresh = wr.runAt ? Date.now() - wr.runAt < 3.5 * 86400_000 : false;
  const okN = wr.latest.filter(t => t.status === 'complete').length;
  const realN = wr.latest.filter(t => t.status === 'complete' || !/already got him/.test(txReason(t, wr.latest))).length;
  const fits = pickups(b, 60);
  const list = fits.filter(x => pos === 'ALL' || x.pos === pos).slice(0, 10);
  const spots = openSpots(b);
  const moves = movesReport(b);
  const [openMove, setOpenMove] = useState<string | null>(null);
  const [allMoves, setAllMoves] = useState(false);
  const rostered = rosteredSet(b);
  const total = wr.season.ok + wr.season.fail;
  return (
    <Screen info="waivers" title="Waivers" subtitle={`Waiver priority: ${b.me.waiverPos ? '#' + b.me.waiverPos : '-'} of ${b.teams.length}${wr.usesFaab ? ` · FAAB used $${wr.budgetUsed}` : ''}`}>
      <Card title="How did my waivers go?" emoji="🌠" accent={C.mint}>
        {wr.runAt ? (
          <>
            <Text style={[T.sub, { marginBottom: 6 }]}>{fresh ? 'Latest run' : 'Most recent results (no new results from this week\'s run yet)'}: {ct(wr.runAt)}</Text>
            {fresh ? <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 6 }}>{okN} of {realN} claims hit {okN === realN ? '🎉' : okN ? '👍' : '😬'}</Text> : null}
            {wr.latest.map(t => {
              const add = t.adds ? Object.keys(t.adds)[0] : null;
              const drop = t.drops ? Object.keys(t.drops)[0] : null;
              const ok = t.status === 'complete';
              const dup = !ok && /already got him/.test(txReason(t, wr.latest));
              return (
                <View key={t.transaction_id} style={{ borderLeftWidth: 3, borderLeftColor: ok ? C.green : dup ? C.dim : C.red, paddingLeft: 8, marginVertical: 4 }}>
                  {add ? <PlayerRow id={add} sub={drop ? `drop ${pname(b, drop)}` : 'no drop'} right={<Text style={{ color: ok ? C.green : dup ? C.sub : C.red, fontWeight: '800' }}>{ok ? 'GOT HIM' : dup ? 'BACKUP' : 'MISSED'}</Text>} /> : null}
                  <Text style={[T.sub, { color: ok ? C.green : dup ? C.sub : C.red }]}>{txReason(t, wr.latest)}{t.settings?.waiver_bid != null ? ` · bid $${t.settings.waiver_bid}` : ''}</Text>
                </View>
              );
            })}
            {wr.latest.some(t => /too many players/i.test(t.metadata?.notes || '')) ? <Text style={[T.sub, { marginTop: 6, color: C.gold }]}>Tip: pick a drop player on each claim when your roster is full, or the claim fails.</Text> : null}
            {wr.latest.some(t => /another owner/i.test(t.metadata?.notes || '')) ? <Text style={[T.sub, { marginTop: 4, color: C.gold }]}>Waivers here go in reverse standings order, so the teams below you get first pick.</Text> : null}
          </>
        ) : <Text style={T.sub}>No waiver claims found yet this season.</Text>}
        {total ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12 }}>
            <Ring pct={wr.season.ok / total} size={62} label={`${Math.round((wr.season.ok / total) * 100)}%`} />
            <Text style={[T.sub, { flex: 1 }]}>Season claim success: {wr.season.ok} won, {wr.season.fail} missed.</Text>
          </View>
        ) : null}
      </Card>

      <Card title="Best pickups for your team" emoji="🧲" right={<Text style={T.sub}>fit vs your starters</Text>}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
          {['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(p => <Chip key={p} label={p} active={pos === p} onPress={() => setPos(p)} />)}
        </ScrollView>
        {list.map(x => {
          const sc = x.drop.safety === 'Safe' ? C.green : x.drop.safety === 'OK' ? C.gold : C.red;
          return (
            <View key={x.id} style={{ borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 6 }}>
              <PlayerRow id={x.id} sub={`${fmt(x.proj)} proj · ${fmt(x.value)} value${x.bye ? ` · bye ${x.bye}` : ''}${x.trend ? ` · 🔥${x.trend > 999 ? Math.round(x.trend / 1000) + 'k' : x.trend}` : ''}`} right={
                <View style={{ alignItems: 'flex-end', maxWidth: 110 }}>
                  <Text style={{ color: x.gain > 0 ? C.mint : C.sub, fontWeight: '800' }}>{x.gain > 0 ? `+${fmt(x.gain)}` : 'depth'}</Text>
                  <Text style={{ color: C.dim, fontSize: 10 }} numberOfLines={1}>{x.gain > 0 ? `vs ${x.over ? pname(b, x.over) : 'empty'}` : 'bench upgrade'}</Text>
                </View>} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 44 }}>
                <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: sc + '22', borderWidth: 1, borderColor: sc }}><Text style={{ color: sc, fontSize: 10, fontWeight: '800' }}>{x.drop.safety.toUpperCase()} DROP</Text></View>
                <Text style={{ color: C.sub, fontSize: 11, flex: 1 }} numberOfLines={2}>{x.drop.id ? `Drop ${pname(b, x.drop.id)}: ${x.drop.reasons.join('; ')}` : x.drop.reasons[0]}</Text>
              </View>
            </View>
          );
        })}
        {!list.length ? <Text style={T.sub}>No free agent beats your roster at this position right now.</Text> : null}
        <Text style={[T.sub, { marginTop: 6 }]}>Expected points = half this week's projection, half a consistency score (median, floor, starter rate, last 3 weeks, with one-off spikes counted less). The drop pick looks at bye weeks in the next 3 weeks, how many backups you have at each position, and injuries.{spots > 0 ? ` You have ${spots} open roster spot${spots > 1 ? 's' : ''}.` : ''} 🔥 = Sleeper adds in the last 24h.</Text>
      </Card>

      <Card title="Trending adds (24h)" emoji="🔥">
        {b.trending.slice(0, 10).map(t => (
          <PlayerRow key={t.player_id} id={t.player_id} sub={`${t.count.toLocaleString()} adds`} right={<Text style={{ color: rostered.has(t.player_id) ? C.dim : C.mint, fontSize: 11, fontWeight: '700' }}>{b.me.players.includes(t.player_id) ? 'YOURS' : rostered.has(t.player_id) ? 'Rostered' : 'Available'}</Text>} />
        ))}
      </Card>

      {moves.length ? (
        <Card title="Your moves scorecard" emoji="📋" right={<Text style={T.sub}>lineup impact</Text>}>
          {(allMoves ? moves : moves.slice(0, 6)).map((m: Move) => {
            const col = m.color === 'good' ? C.green : m.color === 'bad' ? C.red : m.color === 'ok' ? C.gold : C.dim;
            const open = openMove === m.key;
            return (
              <Pressable key={m.key} onPress={() => setOpenMove(open ? null : m.key)} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 10, borderWidth: 2, borderColor: col, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: col, fontWeight: '900', fontSize: m.grade === 'TBD' ? 11 : 16 }}>{m.grade}</Text></View>
                  <View style={{ flex: 1 }}>
                    {m.adds.length ? <Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>+ {m.adds.map(a => pname(b, a)).join(', ')}</Text> : null}
                    {m.drops.length ? <Text style={{ color: C.sub, fontSize: 12 }} numberOfLines={1}>− {m.drops.map(d => pname(b, d)).join(', ')}</Text> : null}
                    <Text style={{ color: C.dim, fontSize: 10.5 }}>Wk {m.leg} · {m.kind === 'free_agent' ? 'free agent' : m.kind === 'mixed' ? 'add + drop' : m.kind}{m.weeks.length ? ` · ${m.weeks.length} wk${m.weeks.length > 1 ? 's' : ''} graded` : ''}</Text>
                  </View>
                  <Text style={{ color: col, fontWeight: '800' }}>{m.weeks.length ? (m.net >= 0 ? '+' : '') + fmt(m.net) : '—'}</Text>
                </View>
                {open ? (
                  <View style={{ marginTop: 6, marginLeft: 50, gap: 3 }}>
                    <Text style={{ color: C.text, fontSize: 12, lineHeight: 16 }}>{m.summary}</Text>
                    {m.weeks.filter(w => w.net !== 0).map(w => <Text key={w.w} style={{ color: C.sub, fontSize: 11.5, lineHeight: 15 }}>Wk {w.w} ({w.net >= 0 ? '+' : ''}{fmt(w.net)}): {w.text}.</Text>)}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          {moves.length > 6 ? <Text onPress={() => setAllMoves(!allMoves)} style={{ color: C.mint, fontSize: 12, fontWeight: '700', marginTop: 8 }}>{allMoves ? 'Show fewer' : `Show all ${moves.length} moves`} ›</Text> : null}
          <Text style={[T.sub, { marginTop: 6 }]}>Tap a move for the why. Each grade compares your real lineup with what you'd most likely have started without the move (the player you dropped or your best bench option that played). Filling an empty or bye slot counts in full. Adds that sat on your bench count 0. Separate add and drop transactions made close together count as one move.</Text>
        </Card>
      ) : null}
    </Screen>
  );
}
