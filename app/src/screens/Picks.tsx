// NFL game Picks: weekly pick'em tracker outside the fantasy leagues. Schedule + scores from ESPN's public
// scoreboard, picks stored on the phone per Sleeper user, optional shared leaderboard (honor system).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInsets, useBottomPad } from '../safe';
import { View, Text, ScrollView, Pressable, Image, RefreshControl, useWindowDimensions, Platform, Modal, TextInput, Share, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Header, Card, T, useApp } from '../ui';
import { InfoButton } from './Info';
import { C } from '../theme';
import { PickChart, PctLines } from '../charts';
import { avatarUrl, sleeper } from '../api';
import { Game, Pick, PickMap, grade, weekRecord, seasonRecord, canPick, started, pct, pctStr, recStr, exportFile, parseImport, mergePicks } from '../picks/core';
import { loadWeek, nflNow, REG_WEEKS } from '../picks/espn';
import { loadPicks, savePicks, loadLbMe, saveLbMe, LbMe, loadPref, savePref } from '../picks/store';
import { parseNotes, ParseResult } from '../picks/parse';
import { TEAMS } from '../picks/teams';
import { fetchSnaps, resolve, snapshotFor, enqueue, flush, pendingCount, Person } from '../picks/sync';

const qp = (k: string) => (Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get(k) : null);
const tz = 'America/Chicago';
const dayKey = (t: number) => new Date(t).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' });
const timeOf = (t: number) => new Date(t).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }) + ' CT';
const PALETTE = [C.mint, C.gold, C.magenta, '#5AB8FF', C.orange, C.pink, '#A3E635', '#B79CFF'];
const logo = (abbr: string) => `https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/${abbr.toLowerCase()}.png`;

type View_ = 'week' | 'record' | 'board';

function Seg({ v, set }: { v: View_; set: (v: View_) => void }) {
  const it: [View_, string][] = [['week', '🏈 Games'], ['record', '📈 My record'], ['board', '🏆 Leaderboard']];
  return (
    <View style={{ flexDirection: 'row', backgroundColor: C.card, borderRadius: 14, padding: 3, borderWidth: 1, borderColor: C.border }}>
      {it.map(([k, l]) => (
        <Pressable key={k} onPress={() => set(k)} style={{ flex: 1, borderRadius: 11, overflow: 'hidden' }}>
          {v === k ? <LinearGradient colors={[C.mint, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingVertical: 8, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12.5 }}>{l}</Text></LinearGradient>
            : <View style={{ paddingVertical: 8, alignItems: 'center' }}><Text style={{ color: C.sub, fontWeight: '700', fontSize: 12.5 }}>{l}</Text></View>}
        </Pressable>
      ))}
    </View>
  );
}

function TeamBtn({ g, side, pick, mode, onPick, others }: { g: Game; side: 'home' | 'away'; pick?: Pick; mode: 'live' | 'backfill'; onPick: (abbr: string) => void; others: { un: string; av?: string }[] }) {
  const t = g[side];
  const mine = pick?.team === t.abbr;
  const gr = mine ? grade(g, pick) : 'none';
  const done = g.state === 'post';
  const won = done && g.winner === t.abbr;
  const col = gr === 'W' ? C.green : gr === 'L' ? C.red : gr === 'NR' ? C.sub : mine ? C.banana : C.border; // v0.0.10: banana yellow pick vs green win
  const locked = !canPick(g, mode);
  return (
    <Pressable onPress={() => onPick(t.abbr)} style={({ pressed }) => ({ flex: 1, borderRadius: 14, borderWidth: mine ? 2 : 1, borderColor: col, backgroundColor: mine ? col + '22' : C.card2, padding: 9, alignItems: 'center', gap: 3, opacity: pressed ? 0.7 : locked && !mine ? 0.75 : 1 })}>
      <Image source={{ uri: t.logo || logo(t.abbr) }} style={{ width: 34, height: 34 }} />
      <Text style={{ color: C.text, fontWeight: '800', fontSize: 13 }} numberOfLines={1}>{t.short}</Text>
      <Text style={{ color: C.dim, fontSize: 10.5 }}>{side === 'home' ? 'home' : 'away'}{t.record ? ` · ${t.record}` : ''}</Text>
      {g.state !== 'pre' && t.score != null ? <Text style={{ color: won ? C.text : C.sub, fontWeight: won ? '900' : '600', fontSize: 18 }}>{t.score}</Text> : null}
      {mine ? <Text style={{ color: col, fontWeight: '900', fontSize: 11 }}>{gr === 'W' ? '✓ WIN' : gr === 'L' ? '✗ LOSS' : gr === 'NR' ? 'NO RESULT' : 'YOUR PICK'}{pick && pick.src !== 'live' ? ' ✱' : ''}</Text> : null}
      {others.length ? <View style={{ flexDirection: 'row', gap: 2, marginTop: 1 }}>{others.slice(0, 5).map(o => o.av ? <Image key={o.un} source={{ uri: avatarUrl(o.av) }} style={{ width: 15, height: 15, borderRadius: 8 }} /> : <View key={o.un} style={{ width: 15, height: 15, borderRadius: 8, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 8, fontWeight: '800' }}>{o.un[0]?.toUpperCase()}</Text></View>)}</View> : null}
    </Pressable>
  );
}

function GameCard({ g, pick, mode, onPick, people }: { g: Game; pick?: Pick; mode: 'live' | 'backfill'; onPick: (g: Game, abbr: string) => void; people: Person[] }) {
  const open = started(g);
  // other people's picks stay hidden until kickoff (client-side; the store is readable by link)
  const whoPicked = (abbr: string) => (open ? people.filter(p => p.picks[g.id]?.team === abbr).map(p => ({ un: p.un, av: p.av })) : []);
  const hidden = !open ? people.filter(p => p.picks[g.id]).length : 0;
  const status = g.state === 'off' ? 'Postponed · no result' : g.state === 'post' ? (g.tie ? 'Final · tie (no result)' : 'Final') : g.state === 'in' ? '🔴 ' + (g.detail || 'Live') : timeOf(g.kickoff);
  const lock = mode === 'live' && open;
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: mode === 'backfill' && g.state === 'post' ? C.gold + '66' : C.border, padding: 10, gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: g.state === 'in' ? C.red : C.sub, fontSize: 11.5, fontWeight: '700' }}>{status}</Text>
        <Text style={{ color: C.dim, fontSize: 11 }}>{lock ? '🔒 locked' : mode === 'backfill' && g.state === 'post' ? '✱ backfill' : hidden ? `🔒 ${hidden} friend${hidden > 1 ? 's' : ''} picked` : !open ? 'locks at kickoff' : ''}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TeamBtn g={g} side="away" pick={pick} mode={mode} onPick={a => onPick(g, a)} others={whoPicked(g.away.abbr)} />
        <Text style={{ color: C.dim, fontWeight: '800' }}>{g.neutral ? 'vs' : '@'}</Text>
        <TeamBtn g={g} side="home" pick={pick} mode={mode} onPick={a => onPick(g, a)} others={whoPicked(g.home.abbr)} />
      </View>
    </View>
  );
}

const Big = ({ v, l, col }: { v: string; l: string; col?: string }) => (
  <View style={{ flex: 1, backgroundColor: C.card2, borderRadius: 12, padding: 10, alignItems: 'center' }}>
    <Text style={{ color: col || C.text, fontSize: 22, fontWeight: '900' }}>{v}</Text>
    <Text style={{ color: C.dim, fontSize: 10.5, fontWeight: '700', marginTop: 2 }}>{l}</Text>
  </View>
);

function Avatar({ av, un, size = 30, col }: { av?: string; un: string; size?: number; col?: string }) {
  return av ? <Image source={{ uri: avatarUrl(av) }} style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: col || C.border }} />
    : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: (col || C.purple) + '55', borderWidth: 2, borderColor: col || C.border, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.text, fontWeight: '900', fontSize: size * 0.42 }}>{un[0]?.toUpperCase()}</Text></View>;
}

// Clearly-labelled made-up rows, only for the web screenshot (?lbsample=1)
function samplePeople(byWeek: Record<number, Game[]>, upto: number): Person[] {
  const mk = (uid: string, un: string, hit: number, seed: number): Person => {
    const picks: PickMap = {};
    let s = seed;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let w = 1; w <= upto; w++) for (const g of byWeek[w] || []) {
      const fav = g.winner || g.home.abbr;
      const other = fav === g.home.abbr ? g.away.abbr : g.home.abbr;
      picks[g.id] = { team: rnd() < hit ? fav : other, week: w, at: 0, src: 'live' };
    }
    return { uid, un, picks, late: 0, sample: true };
  };
  return [mk('s1', 'Sample player A', 0.64, 7), mk('s2', 'Sample player B', 0.57, 21)];
}

export default function Picks() {
  const { me } = useApp();
  const { width } = useWindowDimensions();
  const [season, setSeason] = useState(0);
  const [curWeek, setCurWeek] = useState(0);
  const [week, setWeek] = useState(0);
  const [byWeek, setByWeek] = useState<Record<number, Game[]>>({});
  const [picks, setPicks] = useState<PickMap>({});
  const [view, setView] = useState<View_>((qp('pview') as View_) || 'week');
  const [mode, setMode] = useState<'live' | 'backfill'>(qp('backfill') ? 'backfill' : 'live');
  const [toast, setToast] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [lbMe, setLbMe] = useState<LbMe | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [lbState, setLbState] = useState<{ loading?: boolean; err?: string; stale?: boolean; pending?: number; at?: number }>({});
  const [inclBf, setInclBf] = useState(true);
  const [sheet, setSheet] = useState<null | 'paste' | 'export' | 'import' | 'join'>((qp('psheet') as any) || null);
  const picksRef = useRef<PickMap>({});
  const flushT = useRef<any>(null);
  const uid = me.user_id;

  const loadAll = useCallback(async (force = false) => {
    try {
      const n = await nflNow();
      setSeason(n.season); setCurWeek(n.week); setWeek(w => w || Number(qp('pweek')) || n.week);
      const p = await loadPicks(uid, n.season);
      // web screenshot only: seed sample picks so the record view has something to draw
      if (qp('seedpicks') && !Object.keys(p).length) (globalThis as any).__seed = true;
      picksRef.current = p; setPicks(p);
      const cur = await loadWeek(n.season, n.week, force);
      setByWeek(b => ({ ...b, [n.week]: cur }));
      const rest = Array.from({ length: REG_WEEKS }, (_, i) => i + 1).filter(w => w !== n.week);
      for (let i = 0; i < rest.length; i += 4) {
        const chunk = await Promise.all(rest.slice(i, i + 4).map(w => loadWeek(n.season, w, force && w <= n.week).then(g => [w, g] as const).catch(() => [w, null] as const)));
        setByWeek(b => { const o = { ...b }; chunk.forEach(([w, g]) => { if (g) o[w] = g; }); return o; });
      }
      setErr('');
    } catch (e: any) { setErr(e?.message || String(e)); }
  }, [uid]);
  useEffect(() => { loadAll(); loadLbMe(uid).then(setLbMe); loadPref('inclBf', '1').then(v => setInclBf(v === '1')); }, [uid]);

  // demo seeding for screenshots (?seedpicks=1): sample picks for finished weeks, marked backfilled
  useEffect(() => {
    if (!(globalThis as any).__seed || !season) return;
    const ws = Object.keys(byWeek).map(Number).filter(w => w < curWeek);
    if (ws.length < curWeek - 1) return;
    (globalThis as any).__seed = false;
    const p: PickMap = {}; let s = 5;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (const w of ws) for (const g of byWeek[w]) { const fav = g.winner || g.home.abbr; p[g.id] = { team: rnd() < 0.66 ? fav : (fav === g.home.abbr ? g.away.abbr : g.home.abbr), week: w, at: 0, src: w <= 3 ? 'paste' : 'backfill' }; }
    const cur = byWeek[curWeek] || []; cur.slice(0, 6).forEach((g, i) => { p[g.id] = { team: i % 3 ? g.home.abbr : g.away.abbr, week: curWeek, at: 0, src: 'live' }; });
    picksRef.current = p; setPicks(p);
  }, [byWeek, season, curWeek]);

  // refresh scores every minute while games are on
  const live = (byWeek[curWeek] || []).some(g => g.state === 'in' || (started(g) && g.state === 'pre'));
  useEffect(() => {
    if (!live || !season) return;
    const t = setInterval(() => loadWeek(season, curWeek, true).then(g => setByWeek(b => ({ ...b, [curWeek]: g }))).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [live, season, curWeek]);

  const allGames = useMemo(() => { const m: Record<string, Game> = {}; Object.values(byWeek).flat().forEach(g => (m[g.id] = g)); return m; }, [byWeek]);

  const loadBoard = useCallback(async (force = false) => {
    if (!season) return;
    if (qp('lbsample')) { setPeople(samplePeople(byWeek, curWeek - 1)); setLbState({ at: Date.now() }); return; }
    setLbState(s => ({ ...s, loading: true }));
    try {
      const f = await flush();
      const r = await fetchSnaps(season, force);
      setPeople(resolve(r.snaps, allGames).filter(p => p.uid !== (lbMe?.uid || uid)));
      setLbState({ stale: r.stale, pending: f.left, at: Date.now(), err: f.error && f.left ? `Couldn't sync yet (${f.error}); ${f.left} update${f.left > 1 ? 's' : ''} queued` : undefined });
    } catch (e: any) { setLbState({ err: 'Leaderboard offline: ' + (e?.message || e), pending: await pendingCount() }); }
  }, [season, allGames, lbMe, uid, curWeek, byWeek]);
  useEffect(() => { if (lbMe || qp('lbsample')) loadBoard(); }, [lbMe, season, Object.keys(byWeek).length]);

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(x => (x === t ? '' : x)), 2600); };
  const commit = useCallback(async (next: PickMap, weeks: number[]) => {
    picksRef.current = next; setPicks(next);
    await savePicks(uid, season, next);
    if (lbMe) {
      for (const w of new Set(weeks)) await enqueue(snapshotFor(lbMe, season, w, next));
      clearTimeout(flushT.current);
      flushT.current = setTimeout(() => flush().then(r => setLbState(s => ({ ...s, pending: r.left, err: r.error && r.left ? `Saved on your phone; sharing when back online (${r.left} queued)` : undefined }))), 2500);
    }
  }, [uid, season, lbMe]);

  // picks imported from Settings › Picks data: share those weeks once the leaderboard identity is known
  useEffect(() => { (async () => {
    if (!lbMe || !season) return;
    const raw = await loadPref('resync:' + uid, '');
    if (!raw) return;
    await savePref('resync:' + uid, '');
    const p = await loadPicks(uid, season); picksRef.current = p; setPicks(p);
    try { commit(p, JSON.parse(raw)); } catch {}
  })(); }, [lbMe, season, uid]);

  const onPick = useCallback((g: Game, abbr: string) => {
    const cur = picksRef.current[g.id];
    if (!canPick(g, mode)) {
      if (cur?.team === abbr) return;
      flash(mode === 'live' ? (g.state === 'post' ? 'Locked at kickoff. Use "Pick past winners" to fill in finished games.' : 'Locked: this game has kicked off.') : g.state === 'in' ? 'This game is still on. Backfill works once it is final.' : "This game hasn't been played yet. Switch back to live picks.");
      return;
    }
    const next = { ...picksRef.current };
    if (cur?.team === abbr) delete next[g.id];
    else next[g.id] = { team: abbr, week: g.week, at: Date.now(), src: mode === 'live' ? 'live' : 'backfill' };
    commit(next, [g.week]);
  }, [mode, commit]);

  const weeks = useMemo(() => Array.from({ length: Math.max(1, curWeek) }, (_, i) => i + 1), [curWeek]);
  const season_ = useMemo(() => seasonRecord(byWeek, picks, weeks), [byWeek, picks, weeks]);
  const games = byWeek[week] || [];
  const wr = weekRecord(games, picks);
  const finishedInWeek = games.filter(g => g.state === 'post').length;
  // last week with at least one finished game (for "✱ Enter past picks")
  const lastDone = (() => { for (let w = Math.max(curWeek, 1); w >= 1; w--) if ((byWeek[w] || []).some(g => g.state === 'post')) return w; return 0; })();
  const enterPast = () => { if (!finishedInWeek && lastDone) setWeek(lastDone); setView('week'); setMode('backfill'); };
  const groups = useMemo(() => { const m: [string, Game[]][] = []; for (const g of games) { const k = dayKey(g.kickoff); const last = m[m.length - 1]; if (last && last[0] === k) last[1].push(g); else m.push([k, [g]]); } return m; }, [games]);
  const cw = width - 28 - 24;

  const refresh = async () => { setRefreshing(true); await loadAll(true); if (lbMe) await loadBoard(true); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }} stickyHeaderIndices={[1]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.mint} colors={[C.mint]} progressBackgroundColor={C.card} />}>
        <Header info="picks" title="Picks" pill={`NFL ${season || ''} · all leagues`} subtitle={`Week ${curWeek || '…'} · season ${recStr(season_.total)} (${pctStr(season_.total)})`}
          right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Avatar av={me.avatar} un={me.username} size={34} col={C.mint} /></View>} />
        <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.bg }}><Seg v={view} set={setView} /></View>
        <View style={{ paddingHorizontal: 14, gap: 12 }}>
          {err ? <Card><Text style={{ color: C.red }}>Couldn't load the NFL schedule: {err}. Pull down to retry.</Text></Card> : null}

          {view === 'week' && (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {Array.from({ length: REG_WEEKS }, (_, i) => i + 1).map(w => {
                  const on = w === week, r = weekRecord(byWeek[w] || [], picks);
                  return (
                    <Pressable key={w} onPress={() => { setWeek(w); if (w >= curWeek) setMode('live'); }} style={{ borderRadius: 12, borderWidth: 1, borderColor: on ? C.mint : w === curWeek ? C.purple : C.border, backgroundColor: on ? C.mintSoft : C.card, paddingHorizontal: 11, paddingVertical: 6, alignItems: 'center', minWidth: 52 }}>
                      <Text style={{ color: on ? C.mint : C.text, fontWeight: '800', fontSize: 12.5 }}>Wk {w}</Text>
                      <Text style={{ color: C.dim, fontSize: 10 }}>{r.w + r.l ? recStr(r) : w === curWeek ? 'now' : w > curWeek ? '' : '–'}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Big v={recStr(wr)} l={`WEEK ${week} W-L`} col={C.mint} />
                <Big v={pctStr(wr)} l="WEEK WIN %" />
                <Big v={`${wr.picked}/${games.length}`} l="PICKED" col={wr.picked === games.length && games.length ? C.green : C.gold} />
              </View>
              {mode === 'backfill' ? (
                <View style={{ borderRadius: 14, borderWidth: 1, borderColor: C.gold, backgroundColor: C.gold + '1A', padding: 11, gap: 8 }} testID="past-picks-banner">
                  <Text style={{ color: C.gold, fontWeight: '800' }}>✱ Entering past picks · Week {week}</Text>
                  <Text style={T.sub}>{finishedInWeek ? 'Tap who you picked in each finished game. These are marked ✱ and count in your record and on the leaderboard.' : 'No finished games this week. Pick an earlier week above.'}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <Pressable onPress={() => setSheet('paste')} hitSlop={6} style={{ borderRadius: 10, borderWidth: 1, borderColor: C.magenta, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ color: C.magenta, fontWeight: '800', fontSize: 12 }}>📋 Paste from Notes</Text></Pressable>
                    <View style={{ flex: 1 }} />
                    <Pressable onPress={() => setMode('live')} hitSlop={6} style={{ borderRadius: 10, backgroundColor: C.gold, paddingHorizontal: 14, paddingVertical: 7 }}><Text style={{ color: C.bg, fontWeight: '900', fontSize: 12.5 }}>Done</Text></Pressable>
                  </View>
                </View>
              ) : lastDone ? (
                <Text onPress={enterPast} accessibilityRole="button" style={{ color: C.gold, fontWeight: '800', fontSize: 13, alignSelf: 'flex-end', paddingVertical: 2 }}>✱ Enter past picks ›</Text>
              ) : null}
              {!games.length && !err ? <Card><ActivityIndicator color={C.mint} /><Text style={[T.sub, { textAlign: 'center', marginTop: 6 }]}>Loading week {week}…</Text></Card> : null}
              {groups.map(([day, gs]) => (
                <View key={day} style={{ gap: 8 }}>
                  <Text style={{ color: C.sub, fontWeight: '800', fontSize: 12, letterSpacing: 0.5, marginTop: 4 }}>{day.toUpperCase()}</Text>
                  {gs.map(g => <GameCard key={g.id} g={g} pick={picks[g.id]} mode={mode} onPick={onPick} people={people} />)}
                </View>
              ))}
              {games.length ? <Text style={[T.sub, { textAlign: 'center' }]}>Scores: ESPN public scoreboard. Ties and postponed games count as no result.</Text> : null}
            </>
          )}

          {view === 'record' && (
            <>
              {lastDone ? <Text onPress={enterPast} accessibilityRole="button" style={{ color: C.gold, fontWeight: '800', fontSize: 13, alignSelf: 'flex-end' }}>✱ Enter past picks ›</Text> : null}
              <Card title="Season record" emoji="📈" accent={C.mint} right={<Text style={{ color: C.dim, fontSize: 11 }}>{season}</Text>}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Big v={recStr(season_.total)} l="SEASON W-L" col={C.mint} />
                  <Big v={pctStr(season_.total)} l="SEASON WIN %" col={pct(season_.total) >= 0.5 ? C.green : C.red} />
                  <Big v={recStr(weekRecord(byWeek[curWeek] || [], picks))} l={`WEEK ${curWeek} W-L`} />
                </View>
                <View style={{ marginTop: 10 }}>
                  <PickChart width={cw} current={curWeek} weeks={season_.rows.map(r => ({ w: r.week, pct: r.rec.w + r.rec.l ? pct(r.rec) : null, cum: r.rec.w + r.rec.l ? r.cumPct : null, n: r.rec.w + r.rec.l }))} />
                </View>
                {season_.total.backfilled ? <Text style={[T.sub, { marginTop: 6 }]}>✱ {season_.total.backfilled} backfilled pick{season_.total.backfilled > 1 ? 's' : ''} included. {season_.total.nr ? `${season_.total.nr} tie/postponed = no result.` : ''}</Text> : season_.total.nr ? <Text style={[T.sub, { marginTop: 6 }]}>{season_.total.nr} tie/postponed = no result.</Text> : null}
              </Card>
              <Card title="Week by week" emoji="🗓️">
                {season_.rows.slice().reverse().map(r => {
                  const p = r.rec.w + r.rec.l ? pct(r.rec) : null;
                  return (
                    <Pressable key={r.week} onPress={() => { setWeek(r.week); setView('week'); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.border, gap: 10 }}>
                      <Text style={{ color: r.week === curWeek ? C.mint : C.text, fontWeight: '800', width: 52 }}>Wk {r.week}</Text>
                      <Text style={{ color: C.text, fontWeight: '800', width: 44 }}>{r.rec.w + r.rec.l ? recStr(r.rec) : '–'}</Text>
                      <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: C.card2, overflow: 'hidden' }}>{p != null ? <View style={{ width: `${Math.round(p * 100)}%`, height: 8, backgroundColor: p >= 0.5 ? C.mint : C.magenta }} /> : null}</View>
                      <Text style={{ color: C.sub, width: 40, textAlign: 'right', fontSize: 12 }}>{p != null ? Math.round(p * 100) + '%' : ''}</Text>
                      <Text style={{ color: C.dim, width: 64, textAlign: 'right', fontSize: 10.5 }}>{r.rec.pending ? `${r.rec.pending} to play` : r.rec.backfilled ? `✱${r.rec.backfilled}` : r.rec.picked ? `${r.rec.picked} picks` : ''}</Text>
                    </Pressable>
                  );
                })}
              </Card>
              {/* v0.0.6: the Backup & backfill card (Paste / Export / Import) was removed from the UI. Saved picks, their storage keys and ✱ backfilled picks are untouched and still count. */}
            </>
          )}

          {view === 'board' && (
            <Board me={me} lbMe={lbMe} people={people} byWeek={byWeek} weeks={weeks} myPicks={picks} curWeek={curWeek} width={cw} inclBf={inclBf}
              setInclBf={v => { setInclBf(v); savePref('inclBf', v ? '1' : '0'); }} state={lbState} onJoin={() => setSheet('join')} onReload={() => loadBoard(true)}
              onLeave={async () => { await saveLbMe(uid, null); setLbMe(null); setPeople([]); }} />
          )}
        </View>
      </ScrollView>
      {toast ? <View style={{ position: 'absolute', left: 20, right: 20, bottom: 24, backgroundColor: C.card2, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.gold + '88' }}><Text style={{ color: C.text, textAlign: 'center', fontSize: 13 }}>{toast}</Text></View> : null}
      <PasteSheet open={sheet === 'paste'} onClose={() => setSheet(null)} byWeek={byWeek} curWeek={curWeek} picks={picks}
        onSave={(res, dw) => {
          const next = { ...picksRef.current }; let kept = 0;
          for (const m of res.matched) {
            const g = allGames[m.gameId]; if (!g) continue;
            if (next[m.gameId]?.src === 'live' && next[m.gameId].team !== m.team) { kept++; continue; }
            next[m.gameId] = { team: m.team, week: m.week, at: Date.now(), src: started(g) ? 'paste' : 'live' };
          }
          commit(next, res.matched.map(m => m.week)); setSheet(null);
          flash(`Saved ${res.matched.length - kept} picks${kept ? ` (kept ${kept} you made in the app)` : ''}`);
        }} />
      <ExportSheet open={sheet === 'export'} onClose={() => setSheet(null)} text={JSON.stringify(exportFile(uid, me.username, season, picks), null, 1)} n={Object.keys(picks).length} />
      <ImportSheet open={sheet === 'import'} onClose={() => setSheet(null)} onImport={(inc, modeI) => { const r = mergePicks(picksRef.current, inc, modeI); commit(r.picks, Object.values(inc).map(p => p.week)); setSheet(null); flash(`Imported: ${r.added} added, ${r.replaced} replaced${r.kept ? `, ${r.kept} kept yours` : ''}`); }} />
      <JoinSheet open={sheet === 'join'} onClose={() => setSheet(null)} defaultName={me.display_name || me.username}
        onJoin={async (u) => {
          const m: LbMe = { uid: u.user_id, un: u.display_name || u.username, av: u.avatar || undefined, display: u.display_name, joinedAt: Date.now() };
          await saveLbMe(uid, m); setLbMe(m); setSheet(null);
          const ws = [...new Set(Object.values(picksRef.current).map(p => p.week))];
          for (const w of ws) await enqueue(snapshotFor(m, season, w, picksRef.current));
          flash(`Joined as ${m.un}. Sharing your picks…`);
        }} />
    </View>
  );
}

// ---------------- Leaderboard ----------------
function Board({ me, lbMe, people, byWeek, weeks, myPicks, curWeek, width, inclBf, setInclBf, state, onJoin, onReload, onLeave }: {
  me: { user_id: string; username: string; display_name?: string; avatar?: string }; lbMe: LbMe | null; people: Person[]; byWeek: Record<number, Game[]>; weeks: number[]; myPicks: PickMap; curWeek: number; width: number;
  inclBf: boolean; setInclBf: (v: boolean) => void; state: { loading?: boolean; err?: string; stale?: boolean; pending?: number; at?: number }; onJoin: () => void; onReload: () => void; onLeave: () => void;
}) {
  const sample = people.some(p => p.sample);
  if (!lbMe && !sample) return (
    <Card title="Shared leaderboard" emoji="🏆" accent={C.gold}>
      <Text style={T.body}>See how your picks stack up against friends and anyone else in your leagues who uses Galaxy Gridiron.</Text>
      <Text style={[T.sub, { marginTop: 6 }]}>No logins: you choose your Sleeper username once and your picks are shared under it (honor system). Other people's picks for a game stay hidden in the app until it kicks off.</Text>
      <Pressable onPress={onJoin} style={{ borderRadius: 14, overflow: 'hidden', marginTop: 12 }}><LinearGradient colors={[C.gold, C.magenta]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ padding: 13, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '900' }}>Join the leaderboard</Text></LinearGradient></Pressable>
    </Card>
  );
  const mine: Person = { uid: lbMe?.uid || me.user_id, un: lbMe?.un || me.display_name || me.username, av: lbMe?.av || me.avatar, picks: myPicks, late: 0 };
  const filt = (p: PickMap) => (inclBf ? p : Object.fromEntries(Object.entries(p).filter(([, x]) => x.src === 'live')));
  const rows = [mine, ...people].map((p, i) => {
    const s = seasonRecord(byWeek, filt(p.picks), weeks);
    const bf = inclBf ? seasonRecord(byWeek, p.picks, weeks).total.backfilled : 0;
    return { p, s, bf, wk: s.rows.find(r => r.week === curWeek)?.rec, last: s.rows.filter(r => r.rec.w + r.rec.l).slice(-1)[0], me: i === 0 };
  });
  const ranked = [...rows].sort((a, b) => pct(b.s.total) - pct(a.s.total) || b.s.total.w - a.s.total.w);
  const colorOf = (uid: string) => PALETTE[rows.findIndex(r => r.p.uid === uid) % PALETTE.length];
  const played = weeks.filter(w => (byWeek[w] || []).some(g => g.state === 'post'));
  return (
    <>
      {sample ? <View style={{ borderRadius: 12, borderWidth: 1, borderColor: C.gold, backgroundColor: C.gold + '1A', padding: 10 }}><Text style={{ color: C.gold, fontWeight: '800', fontSize: 12.5 }}>SAMPLE DATA: the two sample rows are made up for this preview. Real rows appear once they join.</Text></View> : null}
      <Card title="Leaderboard" emoji="🏆" accent={C.gold} right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Pressable onPress={onReload} hitSlop={8}><Text style={{ color: C.mint, fontSize: 12, fontWeight: '700' }}>{state.loading ? 'Syncing…' : '↻ Sync'}</Text></Pressable><InfoButton k="picksboard" size={20} /></View>}>
        {ranked.map((r, i) => (
          <View key={r.p.uid} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: i < ranked.length - 1 ? 1 : 0, borderBottomColor: C.border }}>
            <Text style={{ color: i === 0 ? C.gold : C.sub, fontWeight: '900', width: 18, fontSize: 15 }}>{i + 1}</Text>
            <Avatar av={r.p.av} un={r.p.un} col={colorOf(r.p.uid)} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: r.me ? C.mint : C.text, fontWeight: '800' }} numberOfLines={1}>{r.p.un}{r.me ? ' (you)' : ''}</Text>
              <Text style={{ color: C.dim, fontSize: 11 }}>Wk {curWeek}: {r.wk && r.wk.w + r.wk.l ? recStr(r.wk) : r.wk?.picked ? `${r.wk.picked} picked` : 'no picks yet'}{r.bf ? ` · ✱${r.bf}` : ''}{r.p.late ? ` · ${r.p.late} late` : ''}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: C.text, fontWeight: '900', fontSize: 16 }}>{recStr(r.s.total)}</Text>
              <Text style={{ color: pct(r.s.total) >= 0.5 ? C.green : C.red, fontWeight: '800', fontSize: 12 }}>{pctStr(r.s.total)}</Text>
            </View>
          </View>
        ))}
        <Pressable onPress={() => setInclBf(!inclBf)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: inclBf ? C.gold : C.border, backgroundColor: inclBf ? C.gold : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{inclBf ? <Text style={{ color: C.bg, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}</View>
          <Text style={{ color: C.sub, fontSize: 12.5 }}>Include backfilled picks ✱ (entered after the game)</Text>
        </Pressable>
        {lbMe ? <Text style={[T.sub, { marginTop: 8 }]}>Sharing as {lbMe.un}{state.pending ? ` · ${state.pending} update${state.pending > 1 ? 's' : ''} waiting to sync` : ' · synced'}{state.stale ? ' · offline copy' : ''}. Tap (i) for how it works.</Text> : null}
        {state.err ? <Text style={{ color: C.gold, fontSize: 12, marginTop: 4 }}>{state.err}</Text> : null}
        {lbMe ? <Pressable onPress={onLeave} style={{ marginTop: 8 }}><Text style={{ color: C.dim, fontSize: 12 }}>Stop sharing on this phone</Text></Pressable> : null}
      </Card>
      <Card title="Running win % by week" emoji="🌌">
        <PctLines width={width} labels={played.map(w => 'W' + w)} series={rows.map(r => ({ name: r.p.un + (r.me ? ' (you)' : ''), color: colorOf(r.p.uid), values: played.map(w => r.s.rows.find(x => x.week === w)?.cumPct ?? null) }))} />
      </Card>
      <Card title="Picks by week" emoji="🗓️">
        <WeekGrid rows={rows.map(r => ({ uid: r.p.uid, name: r.p.un.replace(' (sample)', '*'), color: colorOf(r.p.uid), recs: Object.fromEntries(r.s.rows.map(y => [y.week, y.rec])) }))} weeks={[...played].reverse()} width={width} />
        <Text style={[T.sub, { marginTop: 6 }]}>Newest week first. Gold = best that week.</Text>
      </Card>
    </>
  );
}

/** v0.0.10: newest week first, frozen name column, fade + arrow when there are more weeks to the right. */
const NAME_W = 92, CELL_W = 46, ROW_H = 28;
function WeekGrid({ rows, weeks, width }: { rows: { uid: string; name: string; color: string; recs: Record<number, { w: number; l: number }> }[]; weeks: number[]; width: number }) {
  const [x, setX] = useState(0);
  const [viewW, setViewW] = useState(Math.max(CELL_W, width - NAME_W));
  const fullW = weeks.length * CELL_W;
  const more = fullW - viewW - x > 4;
  const best = (w: number) => Math.max(0, ...rows.map(o => o.recs[w]?.w || 0));
  return (
    <View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: NAME_W }}>
          <View style={{ height: ROW_H - 8 }} />
          {rows.map(r => <View key={r.uid} style={{ height: ROW_H, justifyContent: 'center' }}><Text style={{ color: r.color, fontSize: 12, fontWeight: '800' }} numberOfLines={1}>{r.name}</Text></View>)}
        </View>
        <View style={{ flex: 1 }} onLayout={e => setViewW(e.nativeEvent.layout.width)}>
          <ScrollView horizontal showsHorizontalScrollIndicator onScroll={e => setX(e.nativeEvent.contentOffset.x)} scrollEventThrottle={32}>
            <View>
              <View style={{ flexDirection: 'row', height: ROW_H - 8 }}>{weeks.map(w => <Text key={w} style={{ width: CELL_W, color: C.dim, fontSize: 11, textAlign: 'center', fontWeight: '700' }}>W{w}</Text>)}</View>
              {rows.map(r => (
                <View key={r.uid} style={{ flexDirection: 'row', height: ROW_H, alignItems: 'center' }}>
                  {weeks.map(w => { const rec = r.recs[w] || { w: 0, l: 0 }; const top = rec.w + rec.l > 0 && rec.w === best(w); return <Text key={w} style={{ width: CELL_W, textAlign: 'center', color: rec.w + rec.l ? (top ? C.gold : C.text) : C.dim, fontSize: 12, fontWeight: top && rec.w ? '900' : '600' }}>{rec.w + rec.l ? recStr(rec as any) : '–'}</Text>; })}
                </View>
              ))}
            </View>
          </ScrollView>
          {more ? (
            <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
              <LinearGradient colors={['rgba(22,28,51,0)', C.card]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
              <Text style={{ color: C.mint, fontSize: 18, fontWeight: '900', paddingRight: 2 }}>›</Text>
            </View>
          ) : null}
        </View>
      </View>
      {more ? <Text style={{ color: C.mint, fontSize: 11, marginTop: 4, textAlign: 'right' }}>Swipe for older weeks ›</Text> : null}
    </View>
  );
}

// ---------------- sheets ----------------
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ins = useInsets();
  const padB = useBottomPad(18, true);
  return (
    <Modal visible={open} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: 'rgba(3,5,15,0.6)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.bg2, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: C.border, maxHeight: '92%', marginTop: ins.top, paddingBottom: padB }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 6 }}>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '900', flex: 1 }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}><Text style={{ color: C.text, fontSize: 20 }}>✕</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 14, paddingTop: 4, gap: 10 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const input = { backgroundColor: C.card, color: C.text, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border, fontSize: 14 } as const;
const Btn = ({ label, onPress, disabled, alt }: { label: string; onPress: () => void; disabled?: boolean; alt?: boolean }) => (
  <Pressable onPress={disabled ? undefined : onPress} style={{ borderRadius: 13, overflow: 'hidden', opacity: disabled ? 0.45 : 1, flex: 1 }}>
    {alt ? <View style={{ padding: 12, alignItems: 'center', borderWidth: 1, borderColor: C.mint, borderRadius: 13 }}><Text style={{ color: C.mint, fontWeight: '800' }}>{label}</Text></View>
      : <LinearGradient colors={[C.mint, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ padding: 12, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '900' }}>{label}</Text></LinearGradient>}
  </Pressable>
);

export const PASTE_DEMO = `Week 4
Browns ✅
Colts W
Pats over Bills
Bears
Jags ✔
Giants
Rams (L)
Packers vs Bucs - Packers
Ravens W
Cowboys ❌
Vikings
Chiefs over Raiders
49ers
Seahawks W
Panthers ✅
Saints
Week 4: 11-5 🙌
wk5: Bucs, Jags, Pack, Texans, bengals
Giants vs Commanders
random reminder: buy snacks`;

function PasteSheet({ open, onClose, byWeek, curWeek, picks, onSave }: { open: boolean; onClose: () => void; byWeek: Record<number, Game[]>; curWeek: number; picks: PickMap; onSave: (r: ParseResult, dw: number) => void }) {
  const [text, setText] = useState(qp('pastedemo') ? PASTE_DEMO : '');
  const [dw, setDw] = useState(0);
  const defW = dw || Math.max(1, curWeek - 1);
  const res = useMemo(() => (text.trim() ? parseNotes(text, byWeek, defW) : null), [text, byWeek, defW]);
  const byW = useMemo(() => { const m: Record<number, ParseResult['matched']> = {}; res?.matched.forEach(x => (m[x.week] = m[x.week] || []).push(x)); return m; }, [res]);
  return (
    <Sheet open={open} onClose={onClose} title="📋 Paste from Notes">
      <Text style={T.sub}>Paste your picks the way you wrote them: team names, nicknames or abbreviations, one per line or comma-separated, with "Week 5" lines and W/L or ✅/❌ if you have them. Nothing is saved until you tap Save.</Text>
      <TextInput value={text} onChangeText={setText} multiline placeholder={'Week 5\nBucs ✅\nJags W\nPackers over Bears…'} placeholderTextColor={C.dim} style={[input, { minHeight: 120, maxHeight: 200, textAlignVertical: 'top' }]} autoCorrect={false} autoCapitalize="none" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text style={{ color: C.sub, fontSize: 12 }}>Lines before any "Week N" go to:</Text>
        {[defW - 1, defW, defW + 1].filter(w => w >= 1 && w <= REG_WEEKS).map(w => (
          <Pressable key={w} onPress={() => setDw(w)} style={{ borderRadius: 10, borderWidth: 1, borderColor: w === defW ? C.mint : C.border, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: w === defW ? C.mintSoft : 'transparent' }}><Text style={{ color: w === defW ? C.mint : C.sub, fontWeight: '700', fontSize: 12 }}>Wk {w}</Text></Pressable>
        ))}
      </View>
      {res ? (
        <>
          <Text style={{ color: C.text, fontWeight: '900', marginTop: 4 }}>Preview: {res.matched.length} matched · {res.unmatched.length} not matched</Text>
          {Object.entries(byW).map(([w, list]) => {
            const r = { w: list.filter(x => byWeek[Number(w)]?.find(g => g.id === x.gameId)?.winner === x.team).length, l: list.filter(x => { const g = byWeek[Number(w)]?.find(g => g.id === x.gameId); return g?.state === 'post' && g.winner && g.winner !== x.team; }).length };
            return (
              <View key={w} style={{ backgroundColor: C.card, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.border, gap: 4 }}>
                <Text style={{ color: C.mint, fontWeight: '900' }}>Week {w} · {list.length} picks · graded {recStr(r)}</Text>
                {list.map(x => {
                  const g = byWeek[Number(w)]?.find(y => y.id === x.gameId);
                  const res_ = g ? grade(g, { team: x.team, week: x.week, at: 0, src: 'paste' }) : 'none';
                  const existing = picks[x.gameId];
                  return (
                    <View key={x.gameId} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                      <Text style={{ width: 18, color: res_ === 'W' ? C.green : res_ === 'L' ? C.red : C.dim, fontWeight: '900' }}>{res_ === 'W' ? '✓' : res_ === 'L' ? '✗' : '·'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: C.text, fontSize: 12.5 }}><Text style={{ fontWeight: '800' }}>{TEAMS[x.team]?.name || x.team}</Text> over {TEAMS[x.opp]?.name || x.opp}  <Text style={{ color: C.dim }}>“{x.raw.slice(0, 32)}”</Text></Text>
                        {x.warn ? <Text style={{ color: C.gold, fontSize: 11 }}>⚠️ {x.warn}</Text> : null}
                        {existing && existing.team !== x.team ? <Text style={{ color: C.orange, fontSize: 11 }}>{existing.src === 'live' ? `keeps your in-app pick (${existing.team})` : `replaces ${existing.team}`}</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}
          {res.unmatched.length ? (
            <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.red + '66', gap: 4 }}>
              <Text style={{ color: C.red, fontWeight: '900' }}>Not matched (won't be saved)</Text>
              {res.unmatched.map((u, i) => <Text key={i} style={{ color: C.sub, fontSize: 12 }}><Text style={{ color: C.text }}>Line {u.line}: “{u.raw.slice(0, 40)}”</Text> · {u.reason}</Text>)}
            </View>
          ) : null}
          {res.info.length ? <Text style={{ color: C.dim, fontSize: 11.5 }}>Skipped: {res.info.map(u => `line ${u.line} (${u.reason})`).join('; ')}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}><Btn label={`Save ${res.matched.length} picks`} disabled={!res.matched.length} onPress={() => onSave(res, defW)} /></View>
          <Text style={[T.sub, { textAlign: 'center' }]}>Saved picks for finished games are marked ✱ backfilled.</Text>
        </>
      ) : null}
    </Sheet>
  );
}

export function ExportSheet({ open, onClose, text, n }: { open: boolean; onClose: () => void; text: string; n: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title="⬆️ Export picks">
      <Text style={T.sub}>{n} picks as JSON. Share it to Notes, Drive or email as a backup; Import reads it back on any phone.</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {Platform.OS !== 'web' || typeof navigator !== 'undefined' && (navigator as any).share ? <Btn label="Share…" onPress={() => Share.share({ message: text, title: 'Galaxy Gridiron picks' }).catch(() => {})} /> : null}
        {Platform.OS === 'web' ? <Btn alt label={copied ? 'Copied ✓' : 'Copy'} onPress={() => { (navigator as any).clipboard?.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false)); }} /> : null}
        {Platform.OS === 'web' ? <Btn alt label="Download file" onPress={() => { try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = 'galaxy-gridiron-picks.json'; a.click(); } catch {} }} /> : null}
      </View>
      <TextInput value={text} editable={false} multiline style={[input, { fontSize: 11, maxHeight: 260, fontFamily: Platform.OS === 'android' ? 'monospace' : undefined }]} selectTextOnFocus />
    </Sheet>
  );
}

export function ImportSheet({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (p: PickMap, mode: 'keep' | 'replace') => void }) {
  const [text, setText] = useState('');
  const r = useMemo(() => (text.trim() ? parseImport(text, new Set(Object.keys(TEAMS))) : null), [text]);
  return (
    <Sheet open={open} onClose={onClose} title="⬇️ Import picks">
      <Text style={T.sub}>Paste a Galaxy Gridiron picks export.</Text>
      <TextInput value={text} onChangeText={setText} multiline placeholder='{"app":"galaxy-gridiron-picks", …}' placeholderTextColor={C.dim} style={[input, { minHeight: 110, maxHeight: 220, textAlignVertical: 'top', fontSize: 12 }]} autoCorrect={false} autoCapitalize="none" />
      {r && !r.ok ? <Text style={{ color: C.red }}>{r.error}</Text> : null}
      {r && r.ok ? (
        <>
          <Text style={{ color: C.text }}>{Object.keys(r.picks).length} picks from {r.file.username} ({r.file.season}){r.skipped ? `, ${r.skipped} unreadable rows skipped` : ''}.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}><Btn label="Merge (keep mine)" onPress={() => onImport(r.picks, 'keep')} /><Btn alt label="Replace on conflict" onPress={() => onImport(r.picks, 'replace')} /></View>
        </>
      ) : null}
    </Sheet>
  );
}

function JoinSheet({ open, onClose, defaultName, onJoin }: { open: boolean; onClose: () => void; defaultName: string; onJoin: (u: any) => void }) {
  const [name, setName] = useState(defaultName);
  const [u, setU] = useState<any>(null);
  const [st, setSt] = useState<{ busy?: boolean; err?: string }>({});
  useEffect(() => { setName(defaultName); setU(null); }, [defaultName, open]);
  const check = async () => {
    setSt({ busy: true }); setU(null);
    try { const x: any = await sleeper.user(name); if (!x?.user_id) throw new Error(); setU(x); setSt({}); } catch { setSt({ err: `No Sleeper user named "${name.trim()}"` }); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="🏆 Join the leaderboard">
      <Text style={T.sub}>Your Sleeper username (checked against Sleeper's public profile). Your picks will be shared under it.</Text>
      <TextInput value={name} onChangeText={t => { setName(t); setU(null); }} autoCapitalize="none" autoCorrect={false} style={input} onSubmitEditing={check} />
      {!u ? <View style={{ flexDirection: 'row' }}><Btn label={st.busy ? 'Checking…' : 'Check username'} onPress={check} disabled={!name.trim() || st.busy} /></View> : null}
      {st.err ? <Text style={{ color: C.red }}>{st.err}</Text> : null}
      {u ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.mint + '88' }}>
            <Avatar av={u.avatar} un={u.username || name} size={48} col={C.mint} />
            <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: '900', fontSize: 16 }}>{u.display_name || u.username}</Text><Text style={T.sub}>@{u.username}</Text></View>
          </View>
          <View style={{ flexDirection: 'row' }}><Btn label={`Join as ${u.display_name || u.username}`} onPress={() => onJoin(u)} /></View>
        </>
      ) : null}
      <Text style={[T.sub, { marginTop: 4 }]}>Honor system: no password, so please only use your own name. Picks are shared on a private, unlisted link that only this app knows.</Text>
    </Sheet>
  );
}
