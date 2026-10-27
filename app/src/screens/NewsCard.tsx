// v0.0.6: compact player news on the player card (rules-based; see src/news.ts for sources).
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useApp } from '../ui';
import { C } from '../theme';
import { playerNews, PlayerNews, NewsLine, fmtDay } from '../news';

const ICON: Record<string, string> = { injuryMajor: '🚑', injury: '🩹', practice: '🏃', team: '🔀', suspension: '⛔', role: '📋', qb: '🏈', game: '📊', missed: '⏸️', league: '🤝', other: '📰', opinion: '💬' };

function Line({ l, showWeek }: { l: NewsLine; showWeek?: boolean }) {
  const when = l.ts ? (showWeek && l.week ? (l.week > 0 ? `Wk ${l.week}` : 'Pre') : fmtDay(l.ts)) : '';
  return (
    <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 5 }}>
      <Text style={{ width: 44, color: C.dim, fontSize: 11, fontWeight: '700', paddingTop: 1 }}>{when}</Text>
      <Text style={{ fontSize: 12 }}>{ICON[l.kind] || '•'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontSize: 12.5, lineHeight: 17 }}>{l.text}{showWeek && l.ts ? <Text style={{ color: C.dim }}>  · {fmtDay(l.ts)}</Text> : null}</Text>
        <Text style={{ color: C.dim, fontSize: 10 }}>{l.src}{l.more ? ` · ${l.more} similar merged` : ''}</Text>
      </View>
    </View>
  );
}

function Section({ title, count, open, onToggle, children }: { title: string; count?: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <View>
      <Pressable onPress={onToggle} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }} accessibilityRole="button">
        <Text style={{ color: C.text, fontWeight: '800', fontSize: 13.5, flex: 1 }}>{title}{count != null ? <Text style={{ color: C.dim, fontWeight: '600' }}>  {count}</Text> : null}</Text>
        <Text style={{ color: C.mint, fontWeight: '800' }}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export default function NewsCard({ id }: { id: string }) {
  const { b } = useApp();
  const [n, setN] = useState<PlayerNews | null>(null);
  const [openR, setOpenR] = useState(true), [openS, setOpenS] = useState(false), [all, setAll] = useState(false);
  useEffect(() => { let on = true; setN(null); playerNews(b, id).then(x => on && setN(x)); return () => { on = false; }; }, [id, b.loadedAt]);
  const season = n?.season || [];
  const shown = all ? season : season.slice(0, 8);
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 8 }} testID="news-card">
      {!n ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8 }}><ActivityIndicator size="small" color={C.mint} /><Text style={{ color: C.sub, fontSize: 12 }}>Loading news…</Text></View> : (
        <>
          <Section title="📰 Recent News" open={openR} onToggle={() => setOpenR(!openR)}>
            {n.recent.length ? n.recent.map((l, i) => <Line key={i} l={l} />) : <Text style={{ color: C.sub, fontSize: 12, paddingBottom: 6 }}>{n.status || 'No recent news.'}</Text>}
            {n.recent.length && n.status ? <Text style={{ color: C.gold, fontSize: 11 }}>{n.status}</Text> : null}
          </Section>
          <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />
          <Section title="🗓️ Season News" count={season.length} open={openS} onToggle={() => setOpenS(!openS)}>
            {shown.map((l, i) => <Line key={i} l={l} showWeek />)}
            {season.length > 8 ? <Text onPress={() => setAll(!all)} style={{ color: C.mint, fontSize: 12, fontWeight: '700', paddingVertical: 4 }}>{all ? 'Show fewer' : `Show all ${season.length}`}</Text> : null}
            {!season.length ? <Text style={{ color: C.sub, fontSize: 12 }}>No injuries, role, team or QB changes found this season.</Text> : null}
            <Text style={{ color: C.dim, fontSize: 10, paddingVertical: 4 }}>Injury, team and depth-chart changes from Sleeper's player data are tracked daily{n.snapSince ? ` since ${fmtDay(n.snapSince)}` : ' from today'}; earlier items come from news, weekly stats and league moves.</Text>
          </Section>
        </>
      )}
    </View>
  );
}
