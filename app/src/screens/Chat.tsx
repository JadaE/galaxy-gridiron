import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, KeyboardAvoidingView, ActivityIndicator, Platform } from 'react-native';
import { useBottomPad } from '../safe';
import { LinearGradient } from 'expo-linear-gradient';
import { Header, useApp, Chip, T, Head, Pos, Inj } from '../ui';
import { C } from '../theme';
import { rules, Reply, PlayerCardData, Fit } from '../chat/engine';
import { fmt, pname } from '../model';
import { Tier, TIER_LABEL, isPaired, chat as aiChat, AiError, ChatMsg, Usage } from '../ai/client';
import { buildContext } from '../ai/context';
import { loadTier, saveTier, currentChat, newChat, addCost, saveUsage, loadUsage, money, monthLabel } from '../ai/costs';

export const QUICK = ['Who should I start?', 'Best pickup?', 'How did my waivers go?', 'Trade ideas', 'How am I doing?', 'Who am I playing?'];
type Msg = { from: 'me' | 'bot' } & Reply;

const tierColor: Record<string, string> = { steady: C.mint, rising: C.green, falling: C.red, 'boom-bust': C.gold, limited: C.sub };
function PCard({ c, onPress, win }: { c: PlayerCardData; onPress: () => void; win?: boolean }) {
  const st = c.statusKind === 'mine' ? C.mint : c.statusKind === 'fa' ? C.gold : C.sub;
  return (
    <Pressable onPress={onPress} style={{ flex: 1, backgroundColor: C.card2, borderRadius: 12, padding: 9, borderWidth: 1, borderColor: win ? C.mint : C.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Head id={c.id} size={30} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontWeight: '800', fontSize: 12.5 }} numberOfLines={1}>{c.name}</Text>
          <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><Pos p={c.pos} /><Text style={{ color: C.sub, fontSize: 10 }}>{c.team || 'FA'}</Text><Inj i={c.inj} /></View>
        </View>
      </View>
      {[
        ...(c.week || []),
        ['Proj', fmt(c.proj)], ['Median', fmt(c.median)], ['Floor', fmt(c.floor)], ['Value', fmt(c.value)],
        ['Trend', (c.trend > 0 ? '▲ ' : c.trend < 0 ? '▼ ' : '') + fmt(Math.abs(c.trend))], ...(c.fc ? [['Trade', String(c.fc)]] : []), ...(c.bye ? [['Bye', 'Wk ' + c.bye]] : []),
      ].map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
          <Text style={{ color: C.dim, fontSize: 11 }}>{k}</Text><Text style={{ color: C.text, fontSize: 11.5, fontWeight: '700' }}>{v}</Text>
        </View>
      ))}
      <Text style={{ color: tierColor[c.tier] || C.sub, fontSize: 10.5, fontWeight: '800', marginTop: 5 }}>{c.tier.toUpperCase()}{c.games ? ` · ${c.games}g` : ''}</Text>
      {c.flag ? <Text style={{ color: c.flag === 'small sample' ? C.gold : C.orange, fontSize: 10, fontWeight: '700', marginTop: 1 }}>{c.flag === 'small sample' ? '🔬 small sample' : c.flag === 'injured' ? '🩹 injured' : '🩹 returning from injury'}</Text> : null}
      <Text style={{ color: st, fontSize: 10.5, marginTop: 2 }} numberOfLines={1}>{c.status}</Text>
    </Pressable>
  );
}

/** Roster-fit split bar: which player fits HER roster better (sums to 100%). */
export function FitBar({ fit }: { fit: Fit }) {
  const { b } = useApp();
  const ln = (id: string) => pname(b, id).split(' ').slice(-1)[0];
  const aWin = fit.aPct >= fit.bPct;
  return (
    <View style={{ backgroundColor: 'rgba(123,92,255,0.12)', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.purple + '66' }}>
      <Text style={{ color: C.sub, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6 }}>🧩 ROSTER FIT FOR YOUR TEAM</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={{ color: aWin ? C.mint : C.sub, fontWeight: '900', fontSize: 15 }}>{ln(fit.aId)} {fit.aPct}%</Text>
        <Text style={{ color: !aWin ? C.mint : C.sub, fontWeight: '900', fontSize: 15 }}>{fit.bPct}% {ln(fit.bId)}</Text>
      </View>
      <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 5, backgroundColor: C.card2 }}>
        <LinearGradient colors={aWin ? [C.mint, C.purple] : ['#3A4270', '#2A3158']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${fit.aPct}%` as any }} />
        <View style={{ width: 2, backgroundColor: C.bg }} />
        <LinearGradient colors={!aWin ? [C.purple, C.mint] : ['#2A3158', '#3A4270']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
      </View>
      {fit.reasons.slice(0, 3).map((r, i) => <Text key={i} style={{ color: C.text, fontSize: 12, marginTop: i ? 3 : 7, lineHeight: 16 }}>• {r}</Text>)}
    </View>
  );
}

function TierPicker({ tier, onPick }: { tier: Tier; onPick: (t: Tier) => void }) {
  const opts: { t: Tier; label: string; sub: string }[] = [
    { t: 'rules', label: '⚙️ Rules', sub: 'free' }, { t: 'budget', label: '✨ Budget AI', sub: 'gpt-6-luna' }, { t: 'better', label: '🚀 Better AI', sub: 'gpt-6.1-sol' },
  ];
  return (
    <View style={{ flexDirection: 'row', backgroundColor: C.card, borderRadius: 14, padding: 3, marginHorizontal: 12, marginTop: 10, borderWidth: 1, borderColor: C.border }}>
      {opts.map(o => {
        const on = o.t === tier;
        return (
          <Pressable key={o.t} onPress={() => onPick(o.t)} style={{ flex: 1, borderRadius: 11, overflow: 'hidden' }} accessibilityRole="button" accessibilityState={{ selected: on }}>
            {on ? <LinearGradient colors={[C.mint + 'DD', C.purple + 'DD']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} /> : null}
            <View style={{ paddingVertical: 6, alignItems: 'center' }}>
              <Text style={{ color: on ? '#fff' : C.sub, fontWeight: '800', fontSize: 12.5 }}>{o.label}</Text>
              <Text style={{ color: on ? '#EFEAFF' : C.dim, fontSize: 9.5 }}>{o.sub}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function CostCounter({ tier, chatCost, usage, busy, onNew }: { tier: Tier; chatCost: number; usage: Usage | null; busy: boolean; onNew: () => void }) {
  const pct = usage && usage.monthCapUsd ? Math.min(1, usage.monthSpendUsd / usage.monthCapUsd) : 0;
  const col = pct > 0.9 ? C.red : pct > 0.7 ? C.gold : C.mint;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 5, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: '#0A0E1F' }}>
      {busy ? <ActivityIndicator size="small" color={C.mint} /> : <Text style={{ color: col, fontSize: 10 }}>●</Text>}
      <Text style={{ color: C.sub, fontSize: 11, flex: 1, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
        {tier === 'rules' ? 'Rules · free · answers from your league data' :
          `This chat ${money(chatCost)} · ${monthLabel()} ${usage ? `${money(usage.monthSpendUsd)} / ${money(usage.monthCapUsd)}` : '$-- / --'}${usage ? ` · ${usage.dailyCount}/${usage.dailyLimit} today` : ''}`}
      </Text>
      {tier !== 'rules' ? <Text onPress={onNew} style={{ color: C.mint, fontSize: 11, fontWeight: '700' }}>New chat</Text> : null}
    </View>
  );
}

export default function Chat({ pending, clearPending, onClose }: { pending?: string | null; clearPending?: () => void; onClose?: () => void }) {
  const { b, tags, openPlayer, go, openSettings } = useApp();
  const hello: Msg = { from: 'bot', text: `Hey ${(b.me.display || 'there').split(/[ _]/)[0]}! 👋 Ask me about ${b.league.name}. Try a player name, "Wilson or Pitts Sr?", or "should I pick up Pitts?"`, engine: 'rules' };
  const [msgs, setMsgs] = useState<Msg[]>([hello]);
  const [input, setInput] = useState('');
  const [tier, setTier] = useState<Tier>('rules');
  const [paired, setPaired] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [chatId, setChatId] = useState('');
  const [chatCost, setChatCost] = useState(0);
  const [busy, setBusy] = useState(false);
  const sv = useRef<any>(null);
  const ready = useRef(false);
  const queued = useRef<string | null>(null);
  const tierRef = useRef<Tier>('rules'), chatRef = useRef(''), msgsRef = useRef<Msg[]>([hello]), busyRef = useRef(false);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  const refreshAi = useCallback(async () => {
    setPaired(await isPaired());
    setUsage(await loadUsage());
  }, []);
  useEffect(() => { (async () => {
    const t0 = await loadTier(); tierRef.current = t0; setTier(t0); await refreshAi();
    const c = await currentChat(); chatRef.current = c.id; setChatId(c.id); setChatCost(c.cost.cost);
    ready.current = true;
    if (queued.current) { const q = queued.current; queued.current = null; send(q); }
  })(); }, []);
  const pick = (t: Tier) => { tierRef.current = t; setTier(t); saveTier(t); refreshAi(); };
  const startNew = async () => { const id = await newChat(); chatRef.current = id; setChatId(id); msgsRef.current = [hello]; setChatCost(0); setMsgs([hello]); };

  const history = (list: Msg[]): ChatMsg[] => list.slice(1).map(m => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.from === 'me' ? m.text : [m.verdict, m.text].filter(Boolean).join('\n') } as ChatMsg));

  const send = async (q: string) => {
    if (!q.trim() || busyRef.current) return;
    if (!ready.current) { queued.current = q; return; }
    setInput('');
    const tier = tierRef.current;
    const next = [...msgsRef.current, { from: 'me', text: q } as Msg];
    msgsRef.current = next; setMsgs(next);
    let r: Reply;
    try { r = await rules.answer(q, { b, tags }); r.engine = 'rules'; } catch (e: any) { r = { text: 'Sorry, something went wrong with that one: ' + (e?.message || e), engine: 'rules' }; }
    if (tier !== 'rules' && !r.choices?.length) {
      const ok = await isPaired(); setPaired(ok);
      if (!ok) r = { ...r, notice: 'AI isn\u2019t set up yet, so this is the free Rules answer.' };
      else {
        setBusy(true); busyRef.current = true;
        try {
          const ctx = buildContext(b, tags, { mentioned: r.players, fit: r.fit });
          const res = await aiChat(tier, history(next), ctx);
          const u: Usage = { monthSpendUsd: res.monthSpendUsd, monthCapUsd: res.monthCapUsd, dailyCount: res.dailyCount, dailyLimit: res.dailyLimit };
          setUsage(u); saveUsage(u);
          const c = await addCost(chatRef.current, res.costUsd); setChatCost(c.cost);
          r = { text: res.reply, cards: r.cards, fit: r.fit, winner: r.winner, players: r.players, tab: r.tab, engine: tier, costUsd: res.costUsd };
        } catch (e: any) {
          const err = e instanceof AiError ? e : new AiError('network', String(e?.message || e));
          if (err.usage) { setUsage(err.usage); saveUsage(err.usage); }
          if (err.code === 'unpaired') setPaired(false);
          r = { ...r, notice: `${err.message} Here's the free Rules answer instead.` };
        }
        setBusy(false); busyRef.current = false;
      }
    }
    msgsRef.current = [...msgsRef.current, { from: 'bot', ...r } as Msg];
    setMsgs(msgsRef.current);
    setTimeout(() => sv.current?.scrollToEnd({ animated: true }), 60);
  };
  useEffect(() => { if (pending) { send(pending); clearPending?.(); } }, [pending]);
  // input bar clears the Android nav bar (gesture or 3-button); while typing the keyboard covers that area instead
  const padB = useBottomPad(12, true);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <Header info="chat" title="Ask Gridiron" subtitle={tier === 'rules' ? 'Answers from your league data' : `${TIER_LABEL[tier]} · grounded in your league data`} right={onClose ? <Pressable onPress={onClose} hitSlop={12} style={{ padding: 6 }}><Text style={{ color: C.text, fontSize: 22 }}>✕</Text></Pressable> : null} />
      <TierPicker tier={tier} onPick={pick} />
      {tier !== 'rules' && paired === false ? (
        <Pressable onPress={() => { onClose?.(); openSettings('ai'); }} style={{ marginHorizontal: 12, marginTop: 8, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: C.purple + '88' }}>
          <LinearGradient colors={['rgba(123,92,255,0.30)', 'rgba(0,206,184,0.10)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 24 }}>🛰️</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontWeight: '800' }}>Set up AI in Settings</Text>
              <Text style={{ color: C.sub, fontSize: 12, marginTop: 2 }}>Pair this phone with your AI server once. Until then you'll get the free Rules answers.</Text>
            </View>
            <Text style={{ color: C.mint, fontWeight: '800' }}>Set up ›</Text>
          </LinearGradient>
        </Pressable>
      ) : null}
      <ScrollView ref={sv} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }} onContentSizeChange={() => sv.current?.scrollToEnd({ animated: true })}>
        {msgs.map((m, i) => (
          <View key={i} style={{ alignSelf: m.from === 'me' ? 'flex-end' : 'flex-start', maxWidth: m.cards?.length === 2 ? '100%' : '90%', width: m.cards?.length === 2 ? '100%' : undefined }}>
            <View style={{ backgroundColor: m.from === 'me' ? C.purple : C.card, borderRadius: 16, borderBottomRightRadius: m.from === 'me' ? 4 : 16, borderBottomLeftRadius: m.from === 'bot' ? 4 : 16, padding: 11, borderWidth: m.from === 'bot' ? 1 : 0, borderColor: m.engine && m.engine !== 'rules' ? C.purple + '99' : C.border, gap: 8 }}>
              {m.notice ? <Text style={{ color: C.gold, fontSize: 12 }}>⚠️ {m.notice}</Text> : null}
              {m.cards?.length ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {m.cards.map(c => <PCard key={c.id} c={c} onPress={() => openPlayer(c.id)} win={m.cards!.length === 2 && (m.winner ? m.winner === c.id : !!m.fit && (m.fit.aPct >= m.fit.bPct ? m.fit.aId : m.fit.bId) === c.id)} />)}
                </View>
              ) : null}
              {m.fit ? <FitBar fit={m.fit} /> : null}
              {m.verdict && m.engine === 'rules' ? <View style={{ backgroundColor: C.mintSoft, borderRadius: 10, padding: 9, borderLeftWidth: 3, borderLeftColor: C.mint }}><Text style={{ color: C.text, fontSize: 13.5, fontWeight: '700' }}>{m.verdict}</Text></View> : null}
              {m.text && !(m.fit && m.engine === 'rules') ? <Text style={[T.body, { fontSize: 13.5 }]}>{m.text}</Text> : null}
              {m.choices?.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{m.choices.map(c => <Chip key={c.label} label={c.label} onPress={() => send(c.q)} />)}</View> : null}
              {m.tab ? <Text onPress={() => { onClose?.(); go(m.tab!); }} style={{ color: C.mint, fontSize: 12, fontWeight: '700' }}>Open {m.tab} ›</Text> : null}
              {m.from === 'bot' && m.engine && m.engine !== 'rules' ? <Text style={{ color: C.dim, fontSize: 10 }}>{TIER_LABEL[m.engine]} · {money(m.costUsd || 0)}</Text> : null}
            </View>
          </View>
        ))}
        {busy ? <View style={{ alignSelf: 'flex-start', flexDirection: 'row', gap: 6, alignItems: 'center', padding: 8 }}><ActivityIndicator color={C.purple} size="small" /><Text style={{ color: C.sub, fontSize: 12 }}>{TIER_LABEL[tier]} is thinking…</Text></View> : null}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingVertical: 8 }}>
        {QUICK.map(q => <Chip key={q} label={q} onPress={() => send(q)} />)}
      </ScrollView>
      <CostCounter tier={tier} chatCost={chatCost} usage={usage} busy={busy} onNew={startNew} />
      <View testID="chat-input-bar" style={{ flexDirection: 'row', gap: 8, padding: 10, paddingBottom: padB, backgroundColor: C.bg2 }}>
        <TextInput value={input} onChangeText={setInput} onSubmitEditing={() => send(input)} placeholder='Try "Wilson or Pitts Sr?"' placeholderTextColor={C.dim} style={{ flex: 1, backgroundColor: C.card, color: C.text, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: C.border }} returnKeyType="send" editable={!busy} />
        <Pressable onPress={() => send(input)} disabled={busy} style={{ backgroundColor: busy ? C.dim : C.mint, borderRadius: 20, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: C.bg, fontWeight: '800' }}>Send</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
