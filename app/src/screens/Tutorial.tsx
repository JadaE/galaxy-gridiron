// v0.0.6: first-run tutorial (5 skippable galaxy-styled screens). Replay from Settings.
import React, { useState } from 'react';
import { View, Text, Pressable, Modal, Platform, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { useInsets } from '../safe';
import { saveSetting, loadSetting } from '../api';

export const TUTORIAL_KEY = 'tutorial:v1';
export const tutorialSeen = async () => !!(await loadSetting(TUTORIAL_KEY));
export const markTutorialSeen = () => saveSetting(TUTORIAL_KEY, String(Date.now()));

const TABS = [['🏠', 'Team'], ['⚔️', 'Matchup'], ['🏆', 'League'], ['🧲', 'Waivers'], ['🤝', 'Trades'], ['🎯', 'Picks']];
type Step = { emoji: string; title: string; body: string; art: React.ReactNode };

function TabArt({ on }: { on?: string[] }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: '#0A0E1F', borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingVertical: 8, alignSelf: 'stretch' }}>
      {TABS.map(([i, k]) => { const lit = !on || on.includes(k); return (
        <View key={k} style={{ flex: 1, alignItems: 'center', opacity: lit ? 1 : 0.3 }}>
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, backgroundColor: on?.includes(k) ? C.mintSoft : 'transparent' }}><Text style={{ fontSize: 18 }}>{i}</Text></View>
          <Text style={{ color: on?.includes(k) ? C.mint : C.sub, fontSize: 9.5, fontWeight: '700', marginTop: 2 }}>{k}</Text>
        </View>); })}
    </View>
  );
}
const Chip = ({ t, c }: { t: string; c: string }) => <View style={{ borderRadius: 14, borderWidth: 1, borderColor: c, backgroundColor: c + '22', paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: C.text, fontWeight: '800', fontSize: 13 }}>{t}</Text></View>;

export function steps(web: boolean, signup = false): Step[] {
  const all: Step[] = [
    { emoji: '🪐', title: 'Welcome to Galaxy Gridiron', body: 'Your Sleeper leagues at a glance. Six tabs along the bottom; the 💬 button asks the chat anything about your team. Tap any player for his card, news and live stats during his game.', art: <TabArt /> },
    { emoji: '🔒💎', title: 'Tag players for trades', body: 'On a player card, tap 🔒 Will not trade or 💎 High value. Trade ideas never offer 🔒 players and only move 💎 players for a premium. Ask chat "good trades without locked players".', art: <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }}><Chip t="🔒 Will not trade" c={C.border} /><Chip t="💎 High value" c={C.gold} /></View> },
    { emoji: '🎯', title: 'Picks & leaderboard', body: 'Pick NFL winners each week before kickoff, see your record and chart, paste old picks from Notes, and join the shared leaderboard with friends.', art: <TabArt on={['Picks']} /> },
    { emoji: '✱', title: 'Catch up past weeks', body: 'New here mid-season? On Picks, tap ✱ Enter past picks, then tap who you picked in finished games (or paste them from Notes). They count in your record and on the leaderboard, marked ✱.', art: <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }}><Chip t="✱ Enter past picks" c={C.gold} /><Chip t="📋 Paste" c={C.magenta} /></View> },
    { emoji: '🚀', title: web ? 'New versions' : 'Updates', body: web ? 'When a new version is out, a gold banner shows on the Team tab. Tap Reload and you have it.' : 'When a new version is out, a gold 🚀 banner shows on the Team tab. Tap Download update, then Update. Your settings stay.', art: <View style={{ borderRadius: 14, borderWidth: 1, borderColor: C.gold + '88', backgroundColor: '#2A1B5E', padding: 12, alignSelf: 'stretch' }}><Text style={{ color: C.gold, fontWeight: '900' }}>🚀 Update available</Text><Text style={{ color: C.sub, fontSize: 12 }}>{web ? 'Tap Reload' : 'Tap Download update'}</Text></View> },
    { emoji: '⚙️', title: 'Settings & feedback', body: 'Tap ⚙️ at the top of the Team tab for updates, AI setup, Replay tutorial, and Send feedback: report a bug or share an idea in a few words.', art: <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }}><Chip t="🐞 Bug" c={C.red} /><Chip t="💡 Idea" c={C.mint} /><Chip t="🎓 Replay" c={C.purple} /></View> },
  ];
  if (signup) all.push({ emoji: '👤', title: 'Last step: your Sleeper username', body: 'Type your own Sleeper username on the next screen. No password, and the app is read-only: it can never change anything in your leagues.', art: <View style={{ borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(22,28,51,0.9)', padding: 14, alignSelf: 'stretch' }}><Text style={{ color: C.dim, fontSize: 16 }}>Your Sleeper username</Text></View> });
  return all;
}

export default function Tutorial({ visible, onDone, startAt = 0, signup = false }: { visible: boolean; onDone: () => void; startAt?: number; signup?: boolean }) {
  const [i, setI] = useState(startAt);
  const ins = useInsets();
  const { width } = useWindowDimensions();
  const S = steps(Platform.OS === 'web', signup);
  const s = S[Math.min(i, S.length - 1)];
  const last = i >= S.length - 1;
  const done = () => { markTutorialSeen(); setI(0); onDone(); };
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={done}>
      <View style={{ flex: 1, backgroundColor: 'rgba(3,5,15,0.82)', justifyContent: 'center', padding: 18, paddingTop: ins.top + 18, paddingBottom: ins.bottom + 18 }} testID="tutorial">
        <View style={{ borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: C.purple + '88', maxWidth: 520, width: '100%', alignSelf: 'center' }}>
          <LinearGradient colors={['#2A1B5E', '#151A3A', '#0B1022']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 1 }} style={{ padding: 22, gap: 14 }}>
            <LinearGradient colors={['rgba(198,76,255,0.35)', 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.3, y: 0.8 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
            {[...Array(14)].map((_, k) => <View key={k} style={{ position: 'absolute', left: ((k * 97) % 100) / 100 * Math.min(width, 520), top: (k * 53) % 300, width: k % 3 ? 2 : 3, height: k % 3 ? 2 : 3, borderRadius: 2, backgroundColor: '#fff', opacity: 0.5 }} />)}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: C.dim, fontSize: 12, fontWeight: '700' }}>{i + 1} of {S.length}</Text>
              {!last ? <Pressable onPress={done} hitSlop={12} accessibilityRole="button"><Text style={{ color: C.sub, fontWeight: '800' }}>Skip</Text></Pressable> : null}
            </View>
            <Text style={{ fontSize: 48, textAlign: 'center' }}>{s.emoji}</Text>
            <Text style={{ color: C.text, fontSize: 22, fontWeight: '900', textAlign: 'center' }}>{s.title}</Text>
            <Text style={{ color: '#C9C3F5', fontSize: 14.5, lineHeight: 21, textAlign: 'center' }}>{s.body}</Text>
            <View style={{ marginVertical: 6 }}>{s.art}</View>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>{S.map((_, k) => <View key={k} style={{ width: k === i ? 18 : 7, height: 7, borderRadius: 4, backgroundColor: k === i ? C.mint : C.border }} />)}</View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {i > 0 ? <Pressable onPress={() => setI(i - 1)} style={{ flex: 1, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, alignItems: 'center' }}><Text style={{ color: C.text, fontWeight: '800' }}>Back</Text></Pressable> : null}
              <Pressable onPress={() => (last ? done() : setI(i + 1))} style={{ flex: 2, borderRadius: 14, overflow: 'hidden' }} accessibilityRole="button">
                <LinearGradient colors={[C.mint, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ padding: 14, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>{last ? (signup ? 'Enter my username →' : "Let's go 🚀") : 'Next'}</Text></LinearGradient>
              </Pressable>
            </View>
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}
