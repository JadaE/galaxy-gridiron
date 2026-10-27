import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Modal, Platform, useWindowDimensions, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useInsets } from './src/safe';
import Tutorial, { tutorialSeen } from './src/screens/Tutorial';
import { C } from './src/theme';
import { AppCtx, Stars } from './src/ui';
import { loadUser, loadLeagues, loadBundle, Bundle } from './src/model';
import { saveSetting, loadSetting } from './src/api';
import Home from './src/screens/Home';
import Matchup from './src/screens/Matchup';
import League from './src/screens/League';
import Waivers from './src/screens/Waivers';
import Trades from './src/screens/Trades';
import Chat from './src/screens/Chat';
import Videos from './src/screens/Videos';
import Picks from './src/screens/Picks';
import PlayerSheet from './src/screens/PlayerSheet';
import Settings from './src/screens/Settings';
import './src/ai/secure'; // installs encrypted device storage for the AI pairing token
import { checkForUpdate, dismissed, dismiss, UpdateInfo } from './src/update';

const TABS = [
  { k: 'Team', icon: '🏠' }, { k: 'Matchup', icon: '⚔️' }, { k: 'League', icon: '🏆' },
  { k: 'Waivers', icon: '🧲' }, { k: 'Trades', icon: '🤝' }, { k: 'Picks', icon: '🎯' },
];
const qp = (k: string) => (Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get(k) : null);

function Galaxy({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  return (
    <LinearGradient colors={['#2A1B5E', '#0F1426', '#070B1C']} style={{ flex: 1 }}>
      <LinearGradient colors={['rgba(198,76,255,0.28)', 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 0.6 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <Stars w={width} h={height} n={90} seed={3} />
      {children}
    </LinearGradient>
  );
}

function Main() {
  const insets = useInsets();
  const [phase, setPhase] = useState<'boot' | 'onboard' | 'loading' | 'ready' | 'error'>('boot');
  const [username, setUsername] = useState('');
  const [me, setMe] = useState<{ user_id: string; username: string; display_name?: string; avatar?: string } | null>(null);
  const [videos, setVideos] = useState(qp('videos') === '1');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [userId, setUserId] = useState('');
  const [leagues, setLeagues] = useState<any[]>([]);
  const [b, setB] = useState<Bundle | null>(null);
  const [tab, setTab] = useState(qp('tab') || 'Team');
  const [player, setPlayer] = useState<string | null>(qp('player'));
  const [leagueModal, setLeagueModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<string | null>(qp('ask'));
  const [chatOpen, setChatOpen] = useState(!!qp('ask') || qp('tab') === 'Chat');
  const [tags, setTags] = useState<Record<string, 'never' | 'high'>>({});
  const [settings, setSettings] = useState<string | null>(qp('settings'));
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [tutorial, setTutorial] = useState<number | null>(qp('tutorial') ? Number(qp('tutorial')) - 1 : null);
  const checkUpdate = useCallback(async () => {
    try { const r = await checkForUpdate(false); if (r.info && (await dismissed()) < r.info.versionCode) setUpdate(r.info); } catch {}
  }, []);
  useEffect(() => { if (phase === 'ready') checkUpdate(); }, [phase]);
  // first run: show the tutorial once (web preview/screens with ?auto skip it unless ?tutorial=N)
  // new users see it before the username screen (its last step leads there); updating users see it once after loading
  useEffect(() => { if ((phase === 'ready' || phase === 'onboard') && !qp('auto')) tutorialSeen().then(seen => { if (!seen) setTutorial(0); }); }, [phase]);
  const leagueIdForTags = b?.league.league_id;
  useEffect(() => { if (!leagueIdForTags) return; loadSetting('tags:' + leagueIdForTags).then(v => { try { setTags(v ? JSON.parse(v) : {}); } catch { setTags({}); } }); }, [leagueIdForTags]);
  const setTag = useCallback((id: string, t: 'never' | 'high' | null) => {
    setTags(prev => { const n = { ...prev }; if (t) n[id] = t; else delete n[id]; if (leagueIdForTags) saveSetting('tags:' + leagueIdForTags, JSON.stringify(n)); return n; });
  }, [leagueIdForTags]);

  const openLeague = useCallback(async (lid: string, uid: string, force = false) => {
    setMsg('Loading league…');
    const bundle = await loadBundle(lid, uid, force);
    setB(bundle);
    saveSetting('league', lid);
  }, []);

  const start = useCallback(async (name: string) => {
    try {
      setErr(''); setPhase('loading'); setMsg('Finding your Sleeper account…');
      const u = await loadUser(name);
      setUserId(u.user_id);
      setMe({ user_id: u.user_id, username: u.username || name, display_name: u.display_name, avatar: u.avatar || undefined });
      saveSetting('username', name);
      setMsg('Fetching your leagues…');
      const { leagues: ls } = await loadLeagues(u.user_id);
      if (!ls.length) throw new Error('No NFL leagues found for this user.');
      setLeagues(ls);
      const saved = qp('league') || (await loadSetting('league'));
      const pick = ls.find(l => l.league_id === saved) || ls.find(l => l.status !== 'complete') || ls[0];
      setMsg('Loading players & projections (first launch can take ~10s)…');
      await openLeague(pick.league_id, u.user_id);
      setPhase('ready');
    } catch (e: any) { setErr(e?.message || String(e)); setPhase('error'); }
  }, [openLeague]);

  useEffect(() => { (async () => { const saved = await loadSetting('username'); if (saved) { setUsername(saved); start(saved); } else if (qp('auto') && qp('user')) start(qp('user')!); else setPhase('onboard'); })(); }, []);

  const refresh = useCallback(async () => {
    if (!b) return;
    setRefreshing(true);
    checkUpdate();
    try { const { leagues: ls } = await loadLeagues(userId, true); setLeagues(ls); await openLeague(b.league.league_id, userId, true); } catch {}
    setRefreshing(false);
  }, [b, userId]);

  if (phase !== 'ready' || !b) {
    return (
      <Galaxy>
        <StatusBar style="light" />
        {phase === 'onboard' ? <Tutorial visible={tutorial != null} signup startAt={tutorial || 0} onDone={() => setTutorial(null)} /> : null}
        <View style={{ flex: 1, justifyContent: 'center', padding: 28 }}>
          <Text style={{ fontSize: 46, textAlign: 'center' }}>🏈🪐</Text>
          <Text style={{ color: C.text, fontSize: 32, fontWeight: '900', textAlign: 'center', marginTop: 8 }}>Galaxy Gridiron</Text>
          <Text style={{ color: '#C9C3F5', textAlign: 'center', marginTop: 6 }}>Your Sleeper leagues, at a glance</Text>
          {phase === 'onboard' || phase === 'error' ? (
            <View style={{ marginTop: 34, gap: 12 }}>
              <Text style={{ color: C.sub, fontSize: 12, fontWeight: '700' }}>SLEEPER USERNAME</Text>
              <TextInput value={username} onChangeText={setUsername} placeholder="Your Sleeper username" placeholderTextColor={C.dim} autoFocus={tutorial == null} autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => start(username)}
                style={{ backgroundColor: 'rgba(22,28,51,0.9)', color: C.text, borderRadius: 14, padding: 14, fontSize: 17, borderWidth: 1, borderColor: C.border }} />
              <Pressable onPress={() => username.trim() && start(username.trim())} style={{ borderRadius: 14, overflow: 'hidden', opacity: username.trim() ? 1 : 0.5 }}>
                <LinearGradient colors={[C.mint, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ padding: 15, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Launch 🚀</Text>
                </LinearGradient>
              </Pressable>
              {err ? <Text style={{ color: C.red, textAlign: 'center' }}>{err}</Text> : null}
              <Text style={{ color: C.dim, fontSize: 12, textAlign: 'center' }}>Read-only. No password needed. This app can't change anything in your leagues.</Text>
            </View>
          ) : (
            <View style={{ marginTop: 40, alignItems: 'center', gap: 12 }}>
              <ActivityIndicator color={C.mint} size="large" />
              <Text style={{ color: C.sub }}>{msg}</Text>
            </View>
          )}
        </View>
      </Galaxy>
    );
  }

  const ctx = {
    b, refreshing, refresh, leagues, openPlayer: setPlayer, openLeagues: () => setLeagueModal(true), go: setTab,
    ask: (q: string) => { setPending(q); setChatOpen(true); },
    openChat: (q?: string) => { if (q) setPending(q); setChatOpen(true); },
    tags, setTag,
    me: me || { user_id: userId, username },
    openVideos: () => setVideos(true),
    openSettings: (sec?: string) => setSettings(sec || 'all'),
    openTutorial: () => { setSettings(null); setTutorial(0); },
    tab,
    update, dismissUpdate: () => { if (update) dismiss(update.versionCode); setUpdate(null); }, checkUpdate,
    selectLeague: async (lid: string) => { setRefreshing(true); try { await openLeague(lid, userId); } catch (e) {} setRefreshing(false); },
  };
  return (
    <AppCtx.Provider value={ctx}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar style="light" />
        <View style={{ flex: 1 }}>
          {tab === 'Team' && <Home />}
          {tab === 'Matchup' && <Matchup key={b.league.league_id} />}
          {tab === 'League' && <League />}
          {tab === 'Waivers' && <Waivers />}
          {tab === 'Trades' && <Trades />}
          {tab === 'Picks' && <Picks key={userId} />}
        </View>
        <View style={{ flexDirection: 'row', backgroundColor: '#0A0E1F', borderTopWidth: 1, borderTopColor: C.border, paddingBottom: Math.max(insets.bottom, 6), paddingTop: 6 }}>
          {TABS.map(t => {
            const on = tab === t.k;
            return (
              <Pressable key={t.k} onPress={() => setTab(t.k)} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
                <View style={{ paddingHorizontal: 12, paddingVertical: 3, borderRadius: 14, backgroundColor: on ? C.mintSoft : 'transparent' }}>
                  <Text style={{ fontSize: 18, opacity: on ? 1 : 0.55 }}>{t.icon}</Text>
                </View>
                <Text style={{ color: on ? C.mint : C.dim, fontSize: 10.5, fontWeight: on ? '800' : '600', marginTop: 2 }}>{t.k}</Text>
              </Pressable>
            );
          })}
        </View>
        {refreshing ? <View style={{ position: 'absolute', top: 40, right: 16 }}><ActivityIndicator color={C.mint} /></View> : null}
        <Pressable onPress={() => setChatOpen(true)} style={{ position: 'absolute', right: 16, bottom: Math.max(insets.bottom, 6) + 72, borderRadius: 28, overflow: 'hidden', elevation: 6, shadowColor: C.purple, shadowOpacity: 0.6, shadowRadius: 10 }}>
          <LinearGradient colors={[C.mint, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 24 }}>💬</Text>
          </LinearGradient>
        </Pressable>
        <Modal visible={chatOpen} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setChatOpen(false)}>
          <AppCtx.Provider value={ctx}>
            <Chat pending={pending} clearPending={() => setPending(null)} onClose={() => setChatOpen(false)} />
            <PlayerSheet id={chatOpen ? player : null} onClose={() => setPlayer(null)} />
          </AppCtx.Provider>
        </Modal>
        <PlayerSheet id={chatOpen || videos ? null : player} onClose={() => setPlayer(null)} />
        <Modal visible={videos} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setVideos(false)}>
          <AppCtx.Provider value={ctx}><Videos onClose={() => setVideos(false)} /></AppCtx.Provider>
        </Modal>
        <Modal visible={!!settings} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setSettings(null)}>
          <AppCtx.Provider value={ctx}><Settings section={settings || undefined} onClose={() => setSettings(null)} /></AppCtx.Provider>
        </Modal>
        <Tutorial visible={tutorial != null} startAt={tutorial || 0} onDone={() => setTutorial(null)} />
        <Modal visible={leagueModal} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setLeagueModal(false)}>
          <Pressable onPress={() => setLeagueModal(false)} style={{ flex: 1, backgroundColor: 'rgba(3,5,15,0.7)', justifyContent: 'center', padding: 24 }}>
            <View style={{ backgroundColor: C.bg2, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: C.border }}>
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 10 }}>Your leagues</Text>
              <ScrollView style={{ maxHeight: 400 }}>
                {leagues.map(l => {
                  const on = l.league_id === b.league.league_id;
                  return (
                    <Pressable key={l.league_id} onPress={() => { setLeagueModal(false); ctx.selectLeague(l.league_id); }} style={{ padding: 12, borderRadius: 12, marginBottom: 6, backgroundColor: on ? C.mintSoft : C.card, borderWidth: 1, borderColor: on ? C.mint : C.border }}>
                      <Text style={{ color: on ? C.mint : C.text, fontWeight: '700' }}>{l.name}</Text>
                      <Text style={{ color: C.sub, fontSize: 12 }}>{l.season} · {l.total_rosters} teams · {l.status === 'complete' ? 'Past season' : 'In season'}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Pressable onPress={() => { setLeagueModal(false); setSettings('all'); }} style={{ marginTop: 6, padding: 8 }}>
                <Text style={{ color: C.mint, textAlign: 'center', fontSize: 13, fontWeight: '700' }}>⚙️ Settings · updates · AI</Text>
              </Pressable>
              <Pressable onPress={async () => { setLeagueModal(false); await saveSetting('username', ''); await saveSetting('league', ''); setB(null); setPhase('onboard'); }} style={{ marginTop: 6, padding: 8 }}>
                <Text style={{ color: C.dim, textAlign: 'center', fontSize: 12 }}>Switch Sleeper user</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      </View>
    </AppCtx.Provider>
  );
}

export default function App() {
  return <SafeAreaProvider><Main /></SafeAreaProvider>;
}
