import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, Linking, RefreshControl, useWindowDimensions } from 'react-native';
import { Header, Chip, T } from '../ui';
import { useBottomPad } from '../safe';
import { C } from '../theme';
import { CHANNELS, channelUrl } from '../channels';
import { channelFeed, Video } from '../api';

const GROUPS = ['All', 'TGS', 'Fantasy', 'NFL', 'Shows'] as const;
const age = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 14 ? `${d}d ago` : `${Math.floor(d / 7)}w ago`;
};

export default function Videos({ onClose }: { onClose?: () => void } = {}) {
  const padB = useBottomPad(8);
  const { width } = useWindowDimensions();
  const [feeds, setFeeds] = useState<Record<string, Video[] | null>>({});
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('All');
  const [creator, setCreator] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (force = false) => {
    await Promise.all(CHANNELS.map(async ch => {
      const v = await channelFeed(ch.id, ch.short, force);
      setFeeds(f => ({ ...f, [ch.id]: v }));
    }));
  }, []);
  useEffect(() => { load(); }, []);
  const chans = CHANNELS.filter(c => group === 'All' || c.group === group);
  const list = useMemo(() => chans.filter(c => !creator || c.id === creator).flatMap(c => feeds[c.id] || []).sort((a, b) => b.published.localeCompare(a.published)).slice(0, 40), [feeds, group, creator]);
  const failed = chans.filter(c => feeds[c.id] === null && (!creator || c.id === creator));
  const loading = chans.some(c => feeds[c.id] === undefined);
  const cw = width - 28;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 40 + padB }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} tintColor={C.mint} colors={[C.mint]} progressBackgroundColor={C.card} />}>
      <Header title="Videos" subtitle="Latest from TGS, fantasy creators & the NFL" right={onClose ? <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close videos" style={{ padding: 6 }}><Text style={{ color: C.text, fontSize: 22 }}>✕</Text></Pressable> : undefined} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 14, marginTop: -4 }}>
        {GROUPS.map(g => <Chip key={g} label={g} active={group === g} onPress={() => { setGroup(g); setCreator(null); }} />)}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 14, paddingVertical: 10 }}>
        {chans.map(c => (
          <Pressable key={c.id} onPress={() => setCreator(creator === c.id ? null : c.id)} style={{ borderRadius: 14, borderWidth: 1, borderColor: creator === c.id ? C.magenta : C.border, backgroundColor: creator === c.id ? C.magenta + '33' : C.card, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ color: creator === c.id ? C.magenta : C.sub, fontSize: 11.5, fontWeight: '700' }}>{c.short}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ paddingHorizontal: 14, gap: 12 }}>
        {loading && !list.length ? <Text style={T.sub}>Loading videos…</Text> : null}
        {list.map((v, i) => i === 0 ? (
          <Pressable key={v.url} onPress={() => Linking.openURL(v.url)} style={{ backgroundColor: C.card, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border }}>
            <Image source={{ uri: v.thumb }} style={{ width: cw, height: (cw * 9) / 16, backgroundColor: C.card2 }} />
            <View style={{ padding: 12 }}>
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{v.title}</Text>
              <Text style={{ color: C.sub, fontSize: 12, marginTop: 4 }}>{v.channel} · {age(v.published)}</Text>
            </View>
            <View style={{ position: 'absolute', top: (cw * 9) / 32 - 22, left: cw / 2 - 30, width: 60, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,0,51,0.9)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 20 }}>▶</Text></View>
          </Pressable>
        ) : (
          <Pressable key={v.url} onPress={() => Linking.openURL(v.url)} style={{ flexDirection: 'row', gap: 10, backgroundColor: C.card, borderRadius: 14, padding: 8, borderWidth: 1, borderColor: C.border }}>
            <Image source={{ uri: v.thumb }} style={{ width: 128, height: 72, borderRadius: 10, backgroundColor: C.card2 }} />
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }} numberOfLines={2}>{v.title}</Text>
              <Text style={{ color: C.sub, fontSize: 11, marginTop: 3 }}>{v.channel} · {age(v.published)}</Text>
            </View>
          </Pressable>
        ))}
        {failed.length ? (
          <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border, gap: 8 }}>
            <Text style={T.sub}>Couldn't load {failed.length === 1 ? 'this feed' : 'these feeds'} right now. Pull down to retry, or open the channel:</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {failed.map(c => (
                <Pressable key={c.id} onPress={() => Linking.openURL(channelUrl(c.id))} style={{ borderRadius: 14, borderWidth: 1, borderColor: '#FF3D5A', paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Text style={{ color: '#FF6B81', fontSize: 12, fontWeight: '700' }}>▶ {c.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
