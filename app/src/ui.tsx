import React, { createContext, useContext, useMemo } from 'react';
import { View, Text, StyleSheet, Image, Pressable, ScrollView, RefreshControl, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { useInsets as useSafeAreaInsets } from './safe';
import { C, posColor } from './theme';
import { Bundle, pname, ppos } from './model';
import { headshot } from './api';
import { InfoButton, InfoKey } from './screens/Info';

export type Ctx = { b: Bundle; refreshing: boolean; refresh: () => void; openPlayer: (id: string) => void; openLeagues: () => void; go: (tab: string) => void; ask: (q: string) => void; leagues: any[]; selectLeague: (id: string) => void; tags: Record<string, 'never' | 'high'>; setTag: (id: string, t: 'never' | 'high' | null) => void; openChat: (q?: string) => void; openSettings: (section?: string) => void; update: import('./update').UpdateInfo | null; dismissUpdate: () => void; checkUpdate: () => void; me: { user_id: string; username: string; display_name?: string; avatar?: string }; openVideos: () => void; openTutorial: () => void; tab: string };
export const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function Stars({ w, h, n = 40, seed = 7 }: { w: number; h: number; n?: number; seed?: number }) {
  const stars = useMemo(() => {
    let s = seed; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    return Array.from({ length: n }, () => ({ x: rnd() * w, y: rnd() * h, r: rnd() * 1.3 + 0.3, o: rnd() * 0.7 + 0.25 }));
  }, [w, h, n, seed]);
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill as any} pointerEvents="none">
      {stars.map((p, i) => <Circle key={i} cx={p.x} cy={p.y} r={p.r} fill="#fff" opacity={p.o} />)}
    </Svg>
  );
}

export function Header({ title, subtitle, right, pill, info }: { title: string; subtitle?: string; right?: React.ReactNode; pill?: string; info?: InfoKey }) {
  const { width } = useWindowDimensions();
  const { b, openLeagues } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={['#2A1B5E', '#151A3A', C.bg]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={[s.header, { paddingTop: Math.max(44, insets.top + 14) }]}>
      <LinearGradient colors={['rgba(198,76,255,0.35)', 'rgba(198,76,255,0)']} start={{ x: 1, y: 0 }} end={{ x: 0.3, y: 0.9 }} style={StyleSheet.absoluteFill} />
      <Stars w={width} h={130} />
      {pill ? <View style={s.leaguePill}><Text style={s.leaguePillTxt} numberOfLines={1}>{pill}</Text></View> : (
      <Pressable onPress={openLeagues} style={s.leaguePill}>
        <Text style={s.leaguePillTxt} numberOfLines={1}>{b.league.name} · {b.season}{b.isPast ? ' (past)' : ''} ▾</Text>
      </Pressable>)}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Text style={[s.title, { flexShrink: 1 }]} numberOfLines={1}>{title}</Text>{info ? <InfoButton k={info} /> : null}</View>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </LinearGradient>
  );
}

export function Screen({ title, subtitle, children, right, info }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode; info?: InfoKey }) {
  const { refreshing, refresh } = useApp();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 28 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.mint} colors={[C.mint]} progressBackgroundColor={C.card} />}>
      <Header title={title} subtitle={subtitle} right={right} info={info} />
      <View style={{ paddingHorizontal: 14, gap: 12, marginTop: -6 }}>{children}</View>
    </ScrollView>
  );
}

export function Card({ title, emoji, children, accent, right, style }: { title?: string; emoji?: string; children: React.ReactNode; accent?: string; right?: React.ReactNode; style?: any }) {
  return (
    <View style={[s.card, accent ? { borderColor: accent + '66' } : null, style]}>
      {accent ? <LinearGradient colors={[accent + '30', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 16 }]} /> : null}
      {title ? (
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>{emoji ? emoji + '  ' : ''}{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Pos({ p }: { p: string }) {
  const c = posColor(p);
  return <View style={[s.pos, { backgroundColor: c + '26', borderColor: c + '88' }]}><Text style={[s.posTxt, { color: c }]}>{p}</Text></View>;
}

export function Inj({ i }: { i?: string }) {
  if (!i) return null;
  const bad = ['IR', 'Out', 'NA', 'Sus', 'PUP'].includes(i);
  const col = bad ? C.red : i === 'Doubtful' ? C.orange : C.gold;
  const short = ({ Questionable: 'Q', Doubtful: 'D', Out: 'OUT', Sus: 'SUS' } as any)[i] || i;
  return <View style={[s.inj, { backgroundColor: col + '22', borderColor: col }]}><Text style={[s.injTxt, { color: col }]}>{short}</Text></View>;
}

export function Head({ id, size = 34 }: { id: string; size?: number }) {
  return <Image source={{ uri: headshot(id) }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.card2 }} />;
}

export function PlayerRow({ id, slot, right, sub, dim }: { id: string; slot?: string; right?: React.ReactNode; sub?: string; dim?: boolean }) {
  const { b, openPlayer } = useApp();
  const pl = b.players[id];
  if (!id || id === '0') return (
    <View style={s.prow}>{slot ? <Text style={s.slot}>{slot}</Text> : null}<Text style={{ color: C.dim, flex: 1 }}>Empty</Text></View>
  );
  return (
    <Pressable onPress={() => openPlayer(id)} style={({ pressed }) => [s.prow, pressed && { opacity: 0.6 }, dim && { opacity: 0.55 }]}>
      {slot ? <Text style={s.slot}>{slot}</Text> : null}
      <Head id={id} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={s.pname} numberOfLines={1}>{pname(b, id)}</Text>
          <Inj i={pl?.i} />
          <TagBadge id={id} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Pos p={ppos(b, id)} />
          <Text style={s.psub} numberOfLines={1}>{pl?.t || 'FA'}{sub ? ' · ' + sub : ''}</Text>
        </View>
      </View>
      {right}
    </Pressable>
  );
}

export function Stat({ label, value, color, small }: { label: string; value: string; color?: string; small?: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statV, color ? { color } : null]}>{value}{small ? <Text style={s.statSmall}> {small}</Text> : null}</Text>
      <Text style={s.statL}>{label}</Text>
    </View>
  );
}

export function Chip({ label, onPress, active }: { label: string; onPress?: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.chip, active && s.chipOn, pressed && { opacity: 0.7 }]}>
      <Text style={[s.chipTxt, active && { color: C.bg }]}>{label}</Text>
    </Pressable>
  );
}

export function TagChips({ id, compact }: { id: string; compact?: boolean }) {
  const { tags, setTag } = useApp();
  const t = tags[id];
  const chip = (k: 'never' | 'high', label: string, col: string) => (
    <Pressable key={k} onPress={() => setTag(id, t === k ? null : k)} hitSlop={6}
      style={{ borderRadius: 12, borderWidth: 1, borderColor: t === k ? col : C.border, backgroundColor: t === k ? col + '33' : 'transparent', paddingHorizontal: compact ? 6 : 9, paddingVertical: compact ? 3 : 5 }}>
      <Text style={{ color: t === k ? col : C.dim, fontSize: compact ? 10.5 : 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  return <View style={{ flexDirection: 'row', gap: 5 }}>{chip('never', compact ? '🔒' : '🔒 Will not trade', C.red)}{chip('high', compact ? '💎' : '💎 High value', C.gold)}</View>;
}

export function TagBadge({ id }: { id: string }) {
  const { tags } = useApp();
  const t = tags[id];
  if (!t) return null;
  return <Text style={{ fontSize: 11 }}>{t === 'never' ? '🔒' : '💎'}</Text>;
}

export const T = {
  body: { color: C.text, fontSize: 14, lineHeight: 20 } as const,
  sub: { color: C.sub, fontSize: 12, lineHeight: 17 } as const,
  big: { color: C.text, fontSize: 28, fontWeight: '800' } as const,
};

export const s = StyleSheet.create({
  header: { paddingTop: 44, paddingHorizontal: 16, paddingBottom: 20, overflow: 'hidden' },
  leaguePill: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 10, maxWidth: '90%' },
  leaguePillTxt: { color: C.text, fontSize: 12, fontWeight: '600' },
  title: { color: C.text, fontSize: 26, fontWeight: '800', letterSpacing: 0.3 },
  subtitle: { color: '#C9C3F5', fontSize: 13, marginTop: 3 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  pos: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, borderWidth: 1 },
  posTxt: { fontSize: 10, fontWeight: '800' },
  inj: { paddingHorizontal: 4, borderRadius: 4, borderWidth: 1 },
  injTxt: { fontSize: 9, fontWeight: '800' },
  prow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  slot: { width: 40, color: C.dim, fontSize: 11, fontWeight: '700' },
  pname: { color: C.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  psub: { color: C.sub, fontSize: 11, flexShrink: 1 },
  stat: { flex: 1, alignItems: 'center' },
  statV: { color: C.text, fontSize: 20, fontWeight: '800' },
  statSmall: { fontSize: 11, color: C.sub, fontWeight: '600' },
  statL: { color: C.sub, fontSize: 11, marginTop: 2 },
  chip: { borderRadius: 18, borderWidth: 1, borderColor: C.mint + '88', paddingHorizontal: 12, paddingVertical: 7, backgroundColor: C.mintSoft },
  chipOn: { backgroundColor: C.mint },
  chipTxt: { color: C.mint, fontSize: 12.5, fontWeight: '700' },
});
