import React, { useState, useEffect } from 'react';
import { View, Text, useWindowDimensions, Pressable } from 'react-native';
import { Screen, Card, useApp, T, Head, Pos, TagChips } from '../ui';
import { C, posColor } from '../theme';
import { pname, ppos, famLabel } from '../model';
import { tradeIdeas, HIGH_PREMIUM, Idea, TeamProfile } from '../trades';
import { tradeDeadlineWeek, tradeDeadlineStatus, deadlineSubtitle, deadlineMessage } from '../deadline';

const NeedChip = ({ p, kind }: { p: string; kind: 'need' | 'surplus' }) => (
  <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: (kind === 'need' ? C.magenta : C.mint) + '22', borderWidth: 1, borderColor: (kind === 'need' ? C.magenta : C.mint) + '88' }}>
    <Text style={{ color: kind === 'need' ? C.magenta : C.mint, fontSize: 11, fontWeight: '800' }}>{p}</Text>
  </View>
);

const SKILL = ['QB', 'RB', 'WR', 'TE'];

export default function Trades({ embedded }: { embedded?: boolean } = {}) {
  const { b, openPlayer, tags } = useApp();
  const { width } = useWindowDimensions();
  const [involve, setInvolve] = useState<string | null>(null);
  const [openTeam, setOpenTeam] = useState<number | null>(null);
  useEffect(() => { setInvolve(null); setOpenTeam(null); }, [b.league.league_id]);
  const dWeek = tradeDeadlineWeek(b);
  const dStatus = tradeDeadlineStatus(b);
  const closed = dStatus === 'closed';
  const dNote = dWeek != null ? deadlineMessage(dStatus, dWeek, b.week) : '';
  const sub = `${deadlineSubtitle(dStatus, dWeek)}${b.fc ? ' · Values from FantasyCalc' : ''}`;
  if (b.isPast) { const body = <Card><Text style={T.body}>Trade ideas are for current seasons.</Text></Card>; return embedded ? body : <Screen info="trades" title="Trades">{body}</Screen>; }
  if (!closed && !b.fc) { const body = <Card><Text style={T.body}>Couldn't reach FantasyCalc trade values. Pull down to retry.</Text></Card>; return embedded ? body : <Screen info="trades" title="Trades" subtitle={sub}>{body}</Screen>; }
  const { ideas, profiles, mine } = b.fc ? tradeIdeas(b, tags, 10, involve ? { involve } : {}) : { ideas: [] as Idea[], profiles: [] as TeamProfile[], mine: null as TeamProfile | null };
  const fc = b.fc;
  const skillOf = (ids: string[]) => ids.filter(id => SKILL.includes(ppos(b, id))).sort((x, y) => ((fc?.[y] || 0) - (fc?.[x] || 0)));
  const pickChip = (id: string) => {
    const on = involve === id;
    return (
      <Pressable key={id} onPress={() => setInvolve(on ? null : id)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${on ? 'Clear' : 'See trades involving'} ${pname(b, id)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: on ? C.mint : C.border, backgroundColor: on ? C.mintSoft : C.card2 }}>
        <Head id={id} size={18} />
        <Text style={{ color: on ? C.mint : C.text, fontSize: 12, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{pname(b, id)}</Text>
        <Pos p={ppos(b, id)} />
      </Pressable>
    );
  };
  const pp = (id: string) => (
    <Pressable key={id} onPress={() => openPlayer(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3 }}>
      <Head id={id} size={24} />
      <Text style={{ color: C.text, fontSize: 12.5, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{pname(b, id)}</Text>
      <Pos p={ppos(b, id)} />
      {tags[id] ? <Text style={{ fontSize: 11 }}>{tags[id] === 'never' ? '🔒' : '💎'}</Text> : null}
    </Pressable>
  );
  const bw = width - 28 - 28 - 70;
  const chips = b.me.players.filter(id => ['QB', 'RB', 'WR', 'TE'].includes(ppos(b, id))).sort((x, y) => ((fc?.[y] || 0) - (fc?.[x] || 0)));
  const warning = dNote ? (
    <Card accent={closed ? C.dim : C.gold}>
      <Text style={{ color: closed ? C.sub : C.gold, fontSize: 14, fontWeight: '800' }}>{closed ? 'Trade deadline passed' : 'Trade deadline coming up'}</Text>
      <Text style={[T.body, { marginTop: 6, color: closed ? C.sub : C.text }]}>{dNote}</Text>
    </Card>
  ) : null;
  const inner = (
    <>
      {warning}
      {mine ? <Card title="Your roster vs the league" emoji="🧭" accent={C.purple}>
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
      </Card> : null}

      {closed ? null : <><Card title="See trades for a player" emoji="🎯" accent={involve ? C.mint : C.purple} right={involve ? <Pressable onPress={() => setInvolve(null)} accessibilityRole="button" accessibilityLabel="Clear player and show general trade ideas"><Text style={{ color: C.mint, fontSize: 12, fontWeight: '800' }}>Clear</Text></Pressable> : undefined}>
        <Text style={[T.sub, { marginBottom: 8 }]}>{involve ? `Showing only realistic trades that involve ${pname(b, involve)}.` : 'Pick a player on your roster or another team to see only the trades that involve them.'}</Text>
        <Text style={{ color: C.sub, fontSize: 11, fontWeight: '800', marginBottom: 5 }}>YOUR ROSTER</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{skillOf(b.me.players).map(pickChip)}</View>
        <Text style={{ color: C.sub, fontSize: 11, fontWeight: '800', marginTop: 10, marginBottom: 5 }}>OTHER TEAMS</Text>
        {profiles.filter(p => p.t.rid !== b.me.rid).map(p => {
          const open = openTeam === p.t.rid || (involve != null && p.t.players.includes(involve));
          return (
            <View key={p.t.rid} style={{ marginBottom: 6 }}>
              <Pressable onPress={() => setOpenTeam(open && openTeam === p.t.rid ? null : p.t.rid)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}>
                <Text style={{ color: C.text, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>{p.t.name} <Text style={{ color: C.sub, fontWeight: '500' }}>· {p.t.wins}-{p.t.losses}</Text></Text>
                <Text style={{ color: C.dim, fontSize: 12 }}>{open ? '▾' : '▸'}</Text>
              </Pressable>
              {open ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 4 }}>{skillOf(p.t.players).map(pickChip)}</View> : null}
            </View>
          );
        })}
      </Card>

      <Text style={{ color: C.text, fontSize: 17, fontWeight: '800', marginTop: 4 }}>{involve ? `💫 Trades involving ${pname(b, involve)}` : '💫 Trade ideas'}</Text>
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
          <Text style={[T.sub, { marginTop: 6 }]}>{x.why.join(' ')}</Text>
          {x.fairness ? <Text style={[T.sub, { marginTop: 4 }]}>{x.fairness}</Text> : null}
          {x.note ? <Text style={{ color: C.gold, fontSize: 11.5, marginTop: 4 }}>⚠️ Heads up: {x.note}.</Text> : null}
        </Card>
      )) : <Card>
        <Text style={T.body}>{involve
          ? `No realistic trades found involving ${pname(b, involve)} right now. Ideas have to be fairly valued and fill a need on both sides.`
          : 'No balanced trade ideas found right now. Try un-locking a player or two.'}</Text>
        {involve ? <Pressable onPress={() => setInvolve(null)} accessibilityRole="button" accessibilityLabel="Clear player and show general trade ideas" style={{ alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: C.mint }}><Text style={{ color: C.mint, fontSize: 13, fontWeight: '800' }}>Show general trade ideas</Text></Pressable> : null}
      </Card>}</>}

      <Card title="Your trade chips" emoji="🏷️" right={<Text style={T.sub}>tap to tag</Text>}>
        <Text style={[T.sub, { marginBottom: 6 }]}>🔒 = never included in ideas. 💎 = only offered when you get back at least {Math.round(HIGH_PREMIUM * 100)}% of market value. Tags are saved on this phone for this league.</Text>
        {chips.map(id => (
          <View key={id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Pressable onPress={() => openPlayer(id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Head id={id} size={26} />
              <View style={{ flex: 1 }}><Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{pname(b, id)}</Text><Text style={{ color: C.dim, fontSize: 11 }}>{ppos(b, id)} · value {fc?.[id] || '-'}</Text></View>
            </Pressable>
            <TagChips id={id} compact />
          </View>
        ))}
      </Card>

      {mine ? <Card title="What each team needs" emoji="🔎">
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
              {askFor.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 4, gap: 4 }}>
                  <Text style={{ color: C.dim, fontSize: 11 }}>Could ask about:</Text>
                  {askFor.map(id => (
                    <Pressable key={id} onPress={() => !closed && setInvolve(id)} accessibilityRole="button" accessibilityState={{ disabled: closed }} accessibilityLabel={`See trades involving ${pname(b, id)}`}>
                      <Text style={{ color: involve === id ? C.mint : C.sub, fontSize: 11, fontWeight: '700', textDecorationLine: 'underline' }}>{pname(b, id)}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </Card> : null}
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
      <Text style={[T.sub, { paddingHorizontal: 4 }]}>Trade value starts from FantasyCalc (redraft, {b.league.total_rosters}-team PPR, based on real trades) and is nudged by each player's scoring trend, including prior-season and career stats. These are starting points for a conversation, not sure things.</Text>
    </>
    );
  return embedded ? inner : <Screen info="trades" title="Trades" subtitle={sub}>{inner}</Screen>;
}
