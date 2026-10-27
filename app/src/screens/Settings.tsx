import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useBottomPad } from '../safe';
import { useApp } from '../ui';
import { sendFeedback, FeedbackKind } from '../feedback';
import { ExportSheet, ImportSheet } from './Picks';
import { loadPicks, savePicks, savePref } from '../picks/store';
import { exportFile, mergePicks, PickMap } from '../picks/core';
import { nflNow } from '../picks/espn';
import { LinearGradient } from 'expo-linear-gradient';
import { Header, Card, T } from '../ui';
import { C } from '../theme';
import { VERSION_NAME, VERSION_CODE } from '../version';
import { checkForUpdate, openDownload, isWebApp, UpdateInfo } from '../update';
import { getBase, isPaired, pair, unpair, usage as fetchUsage, testServer, AiError, Usage, TIER_MODEL } from '../ai/client';
import { loadUsage, saveUsage, money, monthLabel } from '../ai/costs';

const Btn = ({ label, onPress, kind = 'main', disabled }: { label: string; onPress: () => void; kind?: 'main' | 'ghost'; disabled?: boolean }) => (
  <Pressable onPress={onPress} disabled={disabled} style={{ borderRadius: 12, overflow: 'hidden', opacity: disabled ? 0.5 : 1, flex: kind === 'ghost' ? undefined : 1 }}>
    {kind === 'main' ? (
      <LinearGradient colors={[C.mint, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '800' }}>{label}</Text></LinearGradient>
    ) : <View style={{ paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: C.border, borderRadius: 12, alignItems: 'center' }}><Text style={{ color: C.sub, fontWeight: '700' }}>{label}</Text></View>}
  </Pressable>
);
const inputStyle = { backgroundColor: C.card2, color: C.text, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.border, fontSize: 14 } as const;

export default function Settings({ onClose, section }: { onClose: () => void; section?: string }) {
  const padB = useBottomPad(0, true);
  const { me, tab, openTutorial } = useApp();
  const [fbKind, setFbKind] = useState<FeedbackKind>('bug');
  const [fbText, setFbText] = useState('');
  const [fbScreen, setFbScreen] = useState(tab || '');
  const [fbState, setFbState] = useState<{ busy?: boolean; ok?: string; err?: string }>({});
  const [pk, setPk] = useState<{ season: number; picks: PickMap } | null>(null);
  const [pkSheet, setPkSheet] = useState<null | 'export' | 'import'>(null);
  const [pkMsg, setPkMsg] = useState('');
  useEffect(() => { (async () => { try { const n = await nflNow(); if (me?.user_id) setPk({ season: n.season, picks: await loadPicks(me.user_id, n.season) }); } catch {} })(); }, [me?.user_id]);
  const doImport = async (inc: PickMap, mode: 'keep' | 'replace') => {
    if (!pk || !me?.user_id) return;
    const cur = await loadPicks(me.user_id, pk.season); // never drop what's saved: merge into it
    const r = mergePicks(cur, inc, mode);
    await savePicks(me.user_id, pk.season, r.picks);
    await savePref('resync:' + me.user_id, JSON.stringify([...new Set(Object.values(inc).map(p => p.week))]));
    setPk({ season: pk.season, picks: r.picks }); setPkSheet(null);
    setPkMsg(`Imported: ${r.added} added, ${r.replaced} replaced${r.kept ? `, ${r.kept} kept yours` : ''}.`);
  };
  const submitFb = async () => {
    setFbState({ busy: true });
    try { await sendFeedback({ kind: fbKind, text: fbText, screen: fbScreen, user: me?.display_name || me?.username }); setFbText(''); setFbState({ ok: 'Sent ✓ Thanks! It goes to a private inbox.' }); }
    catch (e: any) { setFbState({ err: e?.message || 'Could not send.' }); }
  };
  const [upd, setUpd] = useState<{ state: 'idle' | 'busy' | 'done' | 'err'; info?: UpdateInfo | null; latest?: UpdateInfo | null; msg?: string }>({ state: 'idle' });
  const [base, setBase] = useState('');
  const [code, setCode] = useState('');
  const [paired, setPaired] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => { setBase((await getBase()) || ''); setPaired(await isPaired()); setUsage(await loadUsage()); })(); }, []);

  const check = async () => {
    setUpd({ state: 'busy' });
    try { const r = await checkForUpdate(true); setUpd({ state: 'done', info: r.info, latest: r.latest }); }
    catch (e: any) { setUpd({ state: 'err', msg: "Couldn't check right now. Try again on Wi-Fi or mobile data." }); }
  };
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setAiMsg(null);
    try { setAiMsg({ ok: true, t: await fn() }); }
    catch (e: any) { setAiMsg({ ok: false, t: e instanceof AiError ? e.message : 'Something went wrong.' }); if (e?.usage) setUsage(e.usage); }
    setBusy(false);
  };
  const doTest = () => run(async () => { const u = await testServer(base); setBase(u); return 'Server found ✓ It answered as the Galaxy Gridiron AI server.'; });
  const doPair = () => run(async () => {
    if (!code.trim()) throw new AiError('bad_code', 'Type the pairing code first.');
    await pair(base, code); setCode(''); setPaired(true);
    try { const u = await fetchUsage(); setUsage(u); saveUsage(u); } catch {}
    return 'Paired ✓ This phone can use Budget AI and Better AI now.';
  });
  const doUsage = () => run(async () => { const u = await fetchUsage(); setUsage(u); saveUsage(u); return 'Usage updated.'; });
  const doUnpair = () => run(async () => { await unpair(); setPaired(false); return 'Unpaired. AI tiers fall back to Rules until you pair again.'; });

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <Header title="Settings" subtitle={`Galaxy Gridiron v${VERSION_NAME}`} right={<Pressable onPress={onClose} hitSlop={12} style={{ padding: 6 }}><Text style={{ color: C.text, fontSize: 22 }}>✕</Text></Pressable>} />
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 40 + padB }} keyboardShouldPersistTaps="handled">
        {(
          <Card title="App version" emoji="🪐" accent={C.purple}>
            <Text style={T.body}>You're on <Text style={{ color: C.mint, fontWeight: '800' }}>v{VERSION_NAME}</Text> <Text style={{ color: C.dim }}>(build {VERSION_CODE})</Text></Text>
            <View style={{ flexDirection: 'row', marginTop: 10 }}><Btn label={upd.state === 'busy' ? 'Checking…' : 'Check for updates'} onPress={check} disabled={upd.state === 'busy'} /></View>
            {upd.state === 'done' && upd.info ? (
              <View style={{ marginTop: 10, gap: 6 }}>
                <Text style={{ color: C.gold, fontWeight: '800' }}>✨ v{upd.info.versionName} is ready</Text>
                {upd.info.notes ? <Text style={T.sub}>{upd.info.notes}</Text> : null}
                <View style={{ flexDirection: 'row' }}><Btn label={isWebApp() ? `Reload for v${upd.info.versionName}` : `Download v${upd.info.versionName}`} onPress={() => openDownload(upd.info!)} /></View>
                <Text style={[T.sub, { color: C.dim }]}>{isWebApp() ? 'Reloads the app. Your settings stay.' : 'Chrome downloads it; tap the file, then Update. Your settings stay.'}</Text>
              </View>
            ) : upd.state === 'done' ? <Text style={[T.sub, { marginTop: 8 }]}>✅ You're up to date{upd.latest ? ` (latest is v${upd.latest.versionName})` : ''}.</Text>
              : upd.state === 'err' ? <Text style={{ color: C.red, marginTop: 8, fontSize: 12.5 }}>{upd.msg}</Text> : null}
            <Text style={[T.sub, { marginTop: 8, color: C.dim }]}>The app also checks by itself when it opens (at most every 6 hours).</Text>
          </Card>
        )}

        <Card title="Picks data" emoji="💾" accent={C.gold}>
          <Text style={T.sub}>Your picks are saved on this device{pk ? ` (${Object.keys(pk.picks).length} for ${pk.season})` : ''}. Export a backup you can keep in Notes or email; Import reads one back on any device.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Btn label="⬆️ Export backup" onPress={() => setPkSheet('export')} disabled={!pk} />
            <Btn kind="ghost" label="⬇️ Import" onPress={() => setPkSheet('import')} disabled={!pk} />
          </View>
          {pkMsg ? <Text style={{ color: C.green, marginTop: 8, fontSize: 12.5 }}>{pkMsg}</Text> : null}
        </Card>
        {pk ? <ExportSheet open={pkSheet === 'export'} onClose={() => setPkSheet(null)} text={JSON.stringify(exportFile(me.user_id, me.username, pk.season, pk.picks), null, 1)} n={Object.keys(pk.picks).length} /> : null}
        <ImportSheet open={pkSheet === 'import'} onClose={() => setPkSheet(null)} onImport={doImport} />

        <Card title="Help & feedback" emoji="💌" accent={C.magenta}>
          <View style={{ flexDirection: 'row', marginBottom: 12 }}><Btn kind="ghost" label="🎓 Replay tutorial" onPress={openTutorial} /></View>
          <Text style={{ color: C.sub, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>SEND FEEDBACK</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['bug', 'idea'] as const).map(k => (
              <Pressable key={k} onPress={() => setFbKind(k)} accessibilityRole="radio" accessibilityState={{ selected: fbKind === k }} style={{ flex: 1, borderRadius: 12, borderWidth: 1, borderColor: fbKind === k ? (k === 'bug' ? C.red : C.mint) : C.border, backgroundColor: fbKind === k ? (k === 'bug' ? C.red : C.mint) + '22' : 'transparent', padding: 10, alignItems: 'center' }}>
                <Text style={{ color: C.text, fontWeight: '800' }}>{k === 'bug' ? '🐞 Bug' : '💡 Idea'}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput value={fbText} onChangeText={t => { setFbText(t); if (fbState.ok || fbState.err) setFbState({}); }} placeholder={fbKind === 'bug' ? 'What went wrong? (a sentence is plenty)' : "What would make it better?"} placeholderTextColor={C.dim} multiline maxLength={1000} style={[inputStyle, { minHeight: 84, textAlignVertical: 'top', marginTop: 10 }]} />
          <Text style={{ color: C.sub, fontSize: 11, fontWeight: '700', marginTop: 10, marginBottom: 4 }}>SCREEN (OPTIONAL)</Text>
          <TextInput value={fbScreen} onChangeText={setFbScreen} placeholder="e.g. Picks" placeholderTextColor={C.dim} maxLength={40} style={inputStyle} />
          <View style={{ flexDirection: 'row', marginTop: 10 }}><Btn label={fbState.busy ? 'Sending…' : 'Send feedback'} onPress={submitFb} disabled={!!fbState.busy || fbText.trim().length < 3} /></View>
          {fbState.ok ? <Text style={{ color: C.green, marginTop: 8, fontSize: 12.5 }}>{fbState.ok}</Text> : fbState.err ? <Text style={{ color: C.red, marginTop: 8, fontSize: 12.5 }}>{fbState.err}</Text> : null}
          <Text style={[T.sub, { marginTop: 10, color: C.dim }]}>Attached automatically: app v{VERSION_NAME}, your Sleeper username{me?.username ? ` (${me.display_name || me.username})` : ''}, and your device/OS. Nothing else.</Text>
        </Card>

        <Card title="AI chat" emoji="🛰️" accent={C.mint}>
          <Text style={T.sub}>Budget AI ({TIER_MODEL.budget}) and Better AI ({TIER_MODEL.better}) go through <Text style={{ color: C.text }}>your own</Text> AI server (a Cloudflare Worker). The AI key lives only on that server. This phone stores just the server address and a pairing token, encrypted on the device.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: paired ? C.green : C.dim }} />
            <Text style={{ color: paired ? C.green : C.sub, fontWeight: '800' }}>{paired ? 'Paired' : 'Not paired'}</Text>
          </View>
          {paired && usage ? (
            <View style={{ marginTop: 8 }}>
              <Text style={{ color: C.text, fontSize: 13 }}>{monthLabel()} spend {money(usage.monthSpendUsd)} of {money(usage.monthCapUsd)} cap · {usage.dailyCount}/{usage.dailyLimit} questions today</Text>
              <View style={{ height: 8, backgroundColor: C.card2, borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
                <LinearGradient colors={[C.mint, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.max(2, Math.min(100, usage.monthCapUsd ? (100 * usage.monthSpendUsd) / usage.monthCapUsd : 0))}%` as any, height: 8 }} />
              </View>
            </View>
          ) : null}
          <Text style={{ color: C.sub, fontSize: 11, fontWeight: '700', marginTop: 12, marginBottom: 4 }}>SERVER URL</Text>
          <TextInput value={base} onChangeText={setBase} placeholder="https://galaxy-gridiron-ai.<you>.workers.dev" placeholderTextColor={C.dim} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={inputStyle} />
          {!paired ? (
            <>
              <Text style={{ color: C.sub, fontSize: 11, fontWeight: '700', marginTop: 10, marginBottom: 4 }}>ONE-TIME PAIRING CODE</Text>
              <TextInput value={code} onChangeText={setCode} placeholder="from your setup steps" placeholderTextColor={C.dim} autoCapitalize="none" autoCorrect={false} secureTextEntry style={inputStyle} />
            </>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Btn kind="ghost" label="Test URL" onPress={doTest} disabled={busy || !base.trim()} />
            {paired ? <Btn label="Refresh usage" onPress={doUsage} disabled={busy} /> : <Btn label="Pair this phone" onPress={doPair} disabled={busy || !base.trim()} />}
          </View>
          {busy ? <ActivityIndicator color={C.mint} style={{ marginTop: 8 }} /> : null}
          {aiMsg ? <Text style={{ color: aiMsg.ok ? C.green : C.red, marginTop: 8, fontSize: 12.5 }}>{aiMsg.t}</Text> : null}
          {paired ? <Text onPress={doUnpair} style={{ color: C.dim, fontSize: 12, marginTop: 12 }}>Unpair this phone</Text> : null}
          <Text style={[T.sub, { marginTop: 12, color: C.dim }]}>Rules chat stays free and is always the default. Caps are enforced by your server: a monthly budget and a daily question limit per phone. Never paste an AI key into this app.</Text>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
