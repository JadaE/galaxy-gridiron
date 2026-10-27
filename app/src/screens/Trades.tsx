import React from 'react';
import { View, Text, useWindowDimensions, Pressable } from 'react-native';
import { Screen, Card, useApp, T, Head, Pos, TagChips } from '../ui';
import { C, posColor } from '../theme';
import { pname, ppos, famLabel } from '../model';
import { tradeIdeas, HIGH_PREMIUM } from '../trades';

const NeedChip = ({ p, kind }: { p: string; kind: 'need' | 'surplus' }) => (
  <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: (kind === 'need' ? C.magenta : C.mint) + '22', borderWidth: 1, borderColor: (kind === 'need' ? C.magenta : C.mint) + '88' }}>
    <Text style={{ color: kind === 'need' ? C.magenta : C.mint, fontSize: 11, fontWeight: '800' }}>{p}</Text>
  </View>
);

export default function Trades() {
  const { b, openPlayer, tags } = useApp();
  const { width } = useWindowDimensions();
  if (b.isPast) return <Screen info="trades" title="Trades"><Card><Text style={T.body}>Trade ideas are for current seasons.</Text></Card></Screen>;
  if (!b.fc) return <Screen info="trades" title="Trades"><Card><Text style={T.body}>Couldn't reach FantasyCalc trade values. Pull down to retry.</Text></Card></Screen>;
  const { ideas, profiles, mine } = tradeIdeas(b, tags);
  const fc = b.fc;
  const pp = (id: string) => (
    <Pressable key={id} onPress={() => openPlayer(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 }}>
      <Head id={id} size={24} />
      <Text style={{ color: C.text, fontSize: 12.5, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{pname(b, id)}</Text>
      <Pos p={ppos(b, id)} />
      {tags[id] ? <Text style={{ fontSize: 11 }}>{tags[id] === 'never' ? '🔒' : '💎'}</Text> : null}
    </Pressable>
  );
  const bw = width - 28 - 28 - 70;
  const chips = b.me.players.filter(id => ['QB', 'RB', 'WR', 'TE'].includes(ppos(b, id))).sort((x, y) => (fc[y] || 0) - (fc[x] || 0));
  return (
    <Screen info="trades" title="Trades" subtitle={`Trade deadline: week ${b.league.settings?.trade_deadline || '-'} · Values from FantasyCalc`}>
      <Card title="Your roster vs the league" emoji="🧭" accent={C.purple}>
        {(['QB', 'RB', 'WR', 'TE'] as const).map(p => {
          const r = mine!.rel[p];
          return (
            <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
              <Text style={{ width: 30, color: posColor(p), fontWeight: '800' }}>{p}</Text>
              <View style={{ width: bw, height: 12, backgroundColor: C.card2, borderRadius: 6 }}>
                <View style={{ position: 'absolute', left: bw / 2, top: -3, width: 2, height: 18, backgroundColor: C.dim }} />
                <View style={{ width: Math.min(bw, (r / 2) * bw), height: 12, borderRadius: 6, backgroundColor: r >= 1 ? C.mint : C.magenta }} />
              </View>
              <Text style={{ color: r >= 1 ? C.mint : C.magenta, fontSize: 12, fontWeight: '700' }}>{r >= 1 ? '+' : ''}{Math.round((r - 1) * 100)}%</Text>
            </View>
          );
        })}
        <Text style={[T.sub, { marginTop: 6 }]}>Starter value vs the league average. The center line is average.</Text>
      </Card>

      <Text style={{ color: C.text, fontSize: 17, fontWeight: '800', marginTop: 4 }}>💫 Trade ideas</Text>
      {ideas.length ? ideas.map((x, i) => (
        <Card key={i} title={`Ask ${x.team.display}${famLabel(x.team.display)}`} right={<Text style={{ color: C.mint, fontSize: 11, fontWeight: '800' }}>+{Math.round(x.net)} lineup value</Text>} accent={i === 0 ? C.mint : undefined}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.magenta, fontSize: 11, fontWeight: '800', marginBottom: 2 }}>YOU GIVE · {x.giveV}</Text>
              {x.give.map(pp)}
            </View>
            <Text style={{ color: C.dim, alignSelf: 'center', fontSize: 18 }}>⇄</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.mint, fontSize: 11, fontWeight: '800', marginBottom: 2 }}>YOU GET · {x.getV}</Text>
              {x.get.map(pp)}
            </View>
          </View>
          <Text style={[T.sub, { marginTop: 6 }]}>Upgrades your {x.needFilled}.{x.why.length ? ' ' + x.why.map(w => w[0].toUpperCase() + w.slice(1)).join('. ') + '.' : ''}</Text>
          {x.note ? <Text style={{ color: C.gold, fontSize: 11.5, marginTop: 4 }}>⚠️ Heads up: {x.note}.</Text> : null}
        </Card>
      )) : <Card><Text style={T.body}>No balanced trade ideas found right now. Try un-locking a player or two.</Text></Card>}

      <Card title="Your trade chips" emoji="🏷️" right={<Text style={T.sub}>tap to tag</Text>}>
        <Text style={[T.sub, { marginBottom: 6 }]}>🔒 = never included in ideas. 💎 = only offered when you get back at least {Math.round(HIGH_PREMIUM * 100)}% of market value. Tags are saved on this phone for this league.</Text>
        {chips.map(id => (
          <View key={id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Pressable onPress={() => openPlayer(id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Head id={id} size={26} />
              <View style={{ flex: 1 }}><Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{pname(b, id)}</Text><Text style={{ color: C.dim, fontSize: 11 }}>{ppos(b, id)} · value {fc[id] || '-'}</Text></View>
            </Pressable>
            <TagChips id={id} compact />
          </View>
        ))}
      </Card>

      <Card title="What each team needs" emoji="🔎">
        <Text style={[T.sub, { marginBottom: 6 }]}>Compared with the league average starter at each position. Offer what they need, ask for what they have extra of.</Text>
        {profiles.filter(p => p.t.rid !== b.me.rid).map(p => {
          const askFor = p.surplus.filter(s => mine!.needs.includes(s) || mine!.rel[s] < 1).map(s => p.byPos[s][Math.min(1, p.byPos[s].length - 1)] || p.byPos[s][0]).filter(Boolean).slice(0, 2);
          return (
            <View key={p.t.rid} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 13.5 }} numberOfLines={1}>{p.t.name} <Text style={{ color: C.sub, fontWeight: '500' }}>@{p.t.display}{famLabel(p.t.display)} · {p.t.wins}-{p.t.losses}</Text></Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                <Text style={{ color: C.sub, fontSize: 11 }}>Needs</Text>{p.needs.map(n => <NeedChip key={n} p={n} kind="need" />)}
                <Text style={{ color: C.sub, fontSize: 11, marginLeft: 8 }}>Extra</Text>{p.surplus.length ? p.surplus.map(n => <NeedChip key={n} p={n} kind="surplus" />) : <Text style={{ color: C.dim, fontSize: 11 }}>none</Text>}
              </View>
              {askFor.length ? <Text style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>Could ask about: {askFor.map(id => pname(b, id)).join(', ')}</Text> : null}
            </View>
          );
        })}
      </Card>
      <Card title="Recent league trades" emoji="🔁">
        {(() => {
          const trades = b.tx.filter(t => t.type === 'trade' && t.status === 'complete').slice(0, 6);
          if (!trades.length) return <Text style={T.sub}>No completed trades in this league yet this season.</Text>;
          return trades.map(t => (
            <View key={t.transaction_id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Text style={{ color: C.dim, fontSize: 11 }}>{new Date(t.status_updated || t.created).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })}</Text>
              {(t.roster_ids || []).map((rid: number) => {
                const got = Object.keys(t.adds || {}).filter(k => t.adds[k] === rid);
                const team = b.byRid[rid];
                return <Text key={rid} style={{ color: C.text, fontSize: 12.5, marginTop: 2 }} numberOfLines={2}><Text style={{ color: rid === b.me.rid ? C.mint : C.sub, fontWeight: '700' }}>@{team?.display}{famLabel(team?.display || '')} got </Text>{got.map(id => pname(b, id)).join(', ') || (t.draft_picks?.length ? 'draft picks' : '-')}</Text>;
              })}
            </View>
          ));
        })()}
        <Text style={[T.sub, { marginTop: 8 }]}>Sleeper doesn't share pending trade offers publicly, so check the Sleeper app for offers sent to you.</Text>
      </Card>
      <Text style={[T.sub, { paddingHorizontal: 4 }]}>Values from FantasyCalc (redraft, {b.league.total_rosters}-team PPR, based on real trades). These are starting points for a conversation, not sure things.</Text>
    </Screen>
  );
}
