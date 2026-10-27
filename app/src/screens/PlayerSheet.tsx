import React, { useEffect, useState } from 'react';
import { View, Text, Modal, ScrollView, Pressable, Linking, Image, useWindowDimensions } from 'react-native';
import { useApp, Head, Pos, Inj, T, Stat, TagChips } from '../ui';
import { useInsets } from '../safe';
import { isJunkPlayer } from '../junk';
import NewsCard from './NewsCard';
import { Bars } from '../charts';
import { C } from '../theme';
import { InfoButton } from './Info';
import { ytSearch, channelFeed, Video } from '../api';
import { CHANNELS } from '../channels';
import { pname, ppos, projOf, ppg, seasonPts, fmt, val, valueSource, byeWeek, famLabel } from '../model';

const SEARCH = [{ name: 'ThatsGoodSports', q: 'ThatsGoodSports' }, { name: 'Fantasy Footballers', q: 'Fantasy Footballers' }, { name: 'Late-Round', q: 'Late Round Fantasy' }, { name: 'FantasyPros', q: 'FantasyPros' }];

export default function PlayerSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { b, openVideos } = useApp();
  const { width } = useWindowDimensions();
  const [vids, setVids] = useState<Video[] | null>(null);
  const ins = useInsets();
  useEffect(() => {
    if (!id || !b.players[id] || isJunkPlayer(b.players[id])) return;
    setVids(null);
    let on = true;
    Promise.all(CHANNELS.filter(c => c.group !== 'NFL').map(c => channelFeed(c.id, c.short).catch(() => null))).then(arr => { if (on) setVids(arr.flatMap(x => x || []).sort((x, y) => y.published.localeCompare(x.published))); });
    return () => { on = false; };
  }, [id]);
  if (!id) return null;
  const pl = b.players[id];
  if (!pl || isJunkPlayer(pl)) return (
    <Modal visible animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(3,5,15,0.6)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.bg2, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: C.border, padding: 20, paddingBottom: ins.bottom + 24, gap: 8 }}>
          <Text style={{ color: C.text, fontWeight: '800', fontSize: 17 }}>Not a real player</Text>
          <Text style={{ color: C.sub, fontSize: 13 }}>Sleeper lists this as a placeholder or retired entry with no team or stats, so Gridiron leaves it out of comparisons, trades and pickups.</Text>
          <Text onPress={onClose} style={{ color: C.mint, fontWeight: '800', marginTop: 6 }}>Close</Text>
        </View>
      </Pressable>
    </Modal>
  );
  const name = pname(b, id);
  const owner = b.teams.find(t => t.players.includes(id));
  const started = new Set<number>();
  for (let w = 1; w <= b.lastScored; w++) { const m = (b.weekly[w] || []).find(x => x.roster_id === b.me.rid); if (m?.starters?.includes(id)) started.add(w); }
  const last = name.split(' ').slice(-1)[0].toLowerCase();
  const related = (vids || []).filter(v => v.title.toLowerCase().includes(last));
  const show = related.slice(0, 5);
  const v = b.isPast ? null : b.valuer.get(id);
  const weeks = v ? v.weeks.map(x => ({ w: x.w, pts: x.played ? x.pts : 0 })) : [];
  const qbChanged = !!v?.qbSplit;
  const ini = (pid?: string) => (pid ? (b.players[pid]?.n || '').split(' ').map(x => x[0]).join('').slice(0, 3) : '');
  const bye = byeWeek(b, id);
  const cw = width - 56;
  return (
    <Modal visible animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(3,5,15,0.6)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '88%', marginTop: ins.top, backgroundColor: C.bg2, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: C.border }}>
          <View style={{ alignItems: 'center', paddingTop: 8 }}><View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.border }} /></View>
          <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 30 + ins.bottom }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Head id={id} size={64} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ color: C.text, fontSize: 22, fontWeight: '800', flexShrink: 1 }}>{name}</Text><InfoButton k="player" size={20} /></View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Pos p={ppos(b, id)} /><Text style={T.sub}>{pl?.t || 'Free agent'}{pl?.a ? ` · age ${pl.a}` : ''}</Text><Inj i={pl?.i} />
                </View>
                <Text style={[T.sub, { marginTop: 4, color: owner?.rid === b.me.rid ? C.mint : C.sub }]}>{owner ? (owner.rid === b.me.rid ? 'On your team' : `Rostered by @${owner.display}${famLabel(owner.display)}`) : 'Available'}</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={12}><Text style={{ color: C.sub, fontSize: 22 }}>✕</Text></Pressable>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: C.card, borderRadius: 14, paddingVertical: 12, borderWidth: 1, borderColor: C.border }}>
              {!b.isPast ? <Stat label={`Wk ${b.week} proj`} value={fmt(projOf(b, id))} color={C.mint} /> : null}
              <Stat label="Avg / game" value={fmt(ppg(b, id))} />
              <Stat label="Season pts" value={fmt(seasonPts(b, id), 0)} />
              {b.fc?.[id] ? <Stat label="Trade value" value={String(b.fc[id])} color={C.gold} /> : null}
            </View>
            {owner?.rid === b.me.rid && !b.isPast ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ color: C.sub, fontSize: 12 }}>Trade tag</Text><TagChips id={id} /></View>
            ) : null}
            <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border }}>
              <Text style={{ color: C.text, fontWeight: '700', marginBottom: 6 }}>📈 Weekly points {b.season}{bye ? <Text style={{ color: C.dim, fontWeight: '400' }}>  · bye wk {bye}</Text> : null}</Text>
              {!v ? <Text style={T.sub}>Weekly breakdown is available for current seasons.</Text> : (
                <>
                  <Bars width={cw} height={150} valueFmt={x => (x ? x.toFixed(1) : '')} data={weeks.map(x => ({ label: 'W' + x.w, value: x.pts, hi: started.has(x.w) }))} />
                  <View style={{ flexDirection: 'row', width: cw, marginTop: 2 }}>
                    {v.weeks.map(x => (
                      <View key={x.w} style={{ width: cw / Math.max(1, v.weeks.length), alignItems: 'center', gap: 2 }}>
                        {qbChanged && x.played ? <Text style={{ color: x.qb === v.qbSplit!.cur ? C.mint : C.gold, fontSize: 9, fontWeight: '700' }}>{ini(x.qb)}</Text> : null}
                        {x.fillFor ? <Text style={{ fontSize: 9, color: C.orange, fontWeight: '800' }}>FILL</Text> : null}
                        {v.spikes.includes(x.w) ? <Text style={{ fontSize: 9 }}>⚡</Text> : null}
                        {!x.played ? <Text style={{ fontSize: 9, color: C.dim }}>{bye === x.w ? 'BYE' : 'DNP'}</Text> : null}
                      </View>
                    ))}
                  </View>
                  <Text style={[T.sub, { marginTop: 4 }]}>Bright bars = weeks he started for you. ⚡ = one-off spike (counted less){qbChanged ? '. Letters = his team\'s QB that week' : ''}.</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {[['Median', fmt(v.median)], ['Floor', fmt(v.floor)], ['Ceiling', fmt(v.ceil)], ['Startable', Math.round(v.startRate * 100) + '%'], ['Last 3', fmt(v.recent)], ['Value', fmt(val(b, id))]].map(([k, x]) => (
                      <View key={k} style={{ backgroundColor: C.card2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}><Text style={{ color: C.dim, fontSize: 10 }}>{k}</Text><Text style={{ color: C.text, fontSize: 13, fontWeight: '800' }}>{x}</Text></View>
                    ))}
                    <View style={{ backgroundColor: C.card2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}><Text style={{ color: C.dim, fontSize: 10 }}>Type</Text><Text style={{ color: v.tier === 'steady' || v.tier === 'rising' ? C.mint : v.tier === 'falling' ? C.red : C.gold, fontSize: 13, fontWeight: '800' }}>{v.tier}</Text></View>
                  </View>
                  {v.qbNote ? <Text style={[T.sub, { marginTop: 8, color: C.gold }]}>🏈 {v.qbNote}</Text> : null}
                  {v.fillNote ? <Text style={[T.sub, { marginTop: 4, color: C.orange }]}>🔁 {v.fillNote}</Text> : null}
                  {v.flag ? <Text style={[T.sub, { marginTop: 4, color: v.flag === 'small sample' ? C.gold : C.orange }]}>{v.flag === 'small sample' ? '🔬 Small sample' : v.flag === 'injured' ? '🩹 Injured' : '🩹 Returning from injury'}: {v.flagNote}</Text> : null}
                  {v.prior ? <Text style={[T.sub, { marginTop: 4, color: C.dim }]}>📚 Baseline: {v.prior.ppg} pts/g in {v.prior.label} (your league's scoring), {Math.round(v.prior.weight * 100)}% of Value. Start/sit still uses this week's Sleeper projection.</Text> : null}
                  {!v.prior && valueSource(b, id) === 'projection' ? <Text style={[T.sub, { marginTop: 4, color: C.gold }]}>📡 No game stats in Sleeper's feed yet, so Value is estimated from this week's projection.</Text> : !v.prior && valueSource(b, id) === 'blend' ? <Text style={[T.sub, { marginTop: 4, color: C.dim }]}>Only {v.games} game{v.games > 1 ? 's' : ''} of stats, so Value is blended with his projection.</Text> : null}
                </>
              )}
            </View>
            <NewsCard id={id} />
            <Pressable onPress={() => Linking.openURL(ytSearch(`${name} fantasy football week ${b.week}`))} style={{ backgroundColor: '#FF3D5A', borderRadius: 14, padding: 13, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>▶  Watch {name} videos</Text>
            </Pressable>
            <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border, gap: 8 }}>
              <Text style={{ color: C.text, fontWeight: '700' }}>🎬 Creator takes</Text>
              {show.map(v => (
                <Pressable key={v.url} onPress={() => Linking.openURL(v.url)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  {v.thumb ? <Image source={{ uri: v.thumb }} style={{ width: 96, height: 54, borderRadius: 8, backgroundColor: C.card2 }} /> : null}
                  <View style={{ flex: 1 }}><Text style={{ color: C.text, fontSize: 12.5 }} numberOfLines={2}>{v.title}</Text><Text style={{ color: C.dim, fontSize: 11 }}>{v.channel}</Text></View>
                </Pressable>
              ))}
              {vids === null ? <Text style={T.sub}>Checking creator feeds…</Text> : !show.length ? <Text style={T.sub}>No recent creator videos mention {name.split(' ').slice(-1)[0]}. Search a creator:</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {SEARCH.map(c => (
                  <Pressable key={c.name} onPress={() => Linking.openURL(ytSearch(`${c.q} ${name}`))} style={{ borderRadius: 14, borderWidth: 1, borderColor: C.magenta + '99', paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Text style={{ color: C.magenta, fontSize: 11.5, fontWeight: '700' }}>{c.name}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={() => { onClose(); openVideos(); }} hitSlop={6} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.border, paddingTop: 9, marginTop: 2 }}>
                <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>🎬 Videos: all creator feeds</Text><Text style={{ color: C.mint, fontWeight: '800' }}>›</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
