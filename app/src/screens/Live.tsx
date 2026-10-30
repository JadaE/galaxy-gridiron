// v0.0.7: Live game day card for the Matchup tab: live points for your starters and your opponent's, game clock,
// possession, a win-chance bar that moves with the games, and a scoring-play feed for the players in this matchup.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, AppState, Pressable, Animated, Easing, Linking, Modal } from 'react-native';
import { useInsets } from '../safe';
import { LinearGradient } from 'expo-linear-gradient';
import { Card, Head, useApp, T } from '../ui';
import { C } from '../theme';
import { pname, ppos, projOf, slotLabel, fmt, deadThisWeek, byeWeek } from '../model';
import { LiveGame, ScoringPlay, loadLiveGames, loadScoring, liveMatchups, remaining, sideOutlook, winChance, playInvolves, anyLive, watchOptions, matchupFinal, scoringTargets } from '../live';
import { kickoffCT } from '../gameinfo';

const POLL = 25_000; // v0.0.8: was 45 s; only runs while a game with a matchup starter is live
type Side = { starters: string[]; sp: number[]; pp: Record<string, number> };

function Pulse() {
  const a = useRef(new Animated.Value(0.35)).current;
  useEffect(() => { const l = Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.timing(a, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true })])); l.start(); return () => l.stop(); }, []);
  return <Animated.View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: C.red, opacity: a }} />;
}

export function gameChip(g: LiveGame | null | undefined, team?: string) {
  if (!g) return { text: 'BYE', color: C.dim };
  if (g.state === 'pre') return { text: kickoffCT(g.kickoff).replace(' CT', ''), color: C.sub };
  if (g.state === 'post') return { text: 'Final', color: C.dim };
  const q = g.period > 4 ? 'OT' : `Q${g.period}`;
  const ball = g.poss && g.poss === team ? (g.redzone ? ' 🏈🔴' : ' 🏈') : '';
  return { text: `${q} ${g.clock}${ball}`, color: C.gold };
}

export default function LiveCard({ week }: { week: number }) {
  const { b, openPlayer } = useApp();
  const [games, setGames] = useState<Record<string, LiveGame> | null>(null);
  const [mu, setMu] = useState<any[] | null>(null);
  const [plays, setPlays] = useState<ScoringPlay[]>([]);
  const [at, setAt] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const lastScore = useRef<Record<string, string>>({});
  const tickRef = useRef<() => void>(() => {});
  const active = useRef(true);

  const sidesOf = (arr: any[]) => {
    const mine = arr.find((m: any) => m.roster_id === b.me.rid);
    const opp = mine && mine.matchup_id != null ? arr.find((m: any) => m.matchup_id === mine.matchup_id && m.roster_id !== b.me.rid) : null;
    const side = (m: any): Side | null => (m ? { starters: m.starters || [], sp: m.starters_points || [], pp: m.players_points || {} } : null);
    return { me: side(mine), opp: side(opp), oppRid: opp?.roster_id as number | undefined };
  };
  const sides = useMemo(() => sidesOf(mu || b.weekly[week] || []), [mu, week, b]);
  const teamOf = (id: string) => b.players[id]?.t;
  const starterIds = [...(sides.me?.starters || []), ...(sides.opp?.starters || [])].filter(id => id && id !== '0');
  const teams = Array.from(new Set(starterIds.map(teamOf).filter(Boolean) as string[]));

  const tick = async () => {
    if (!active.current) return;
    try {
      const [g, m] = await Promise.all([loadLiveGames(b.season, week), liveMatchups(b.league.league_id, week).catch(() => null)]);
      setGames(g); if (m) setMu(m); setAt(Date.now());
      // v0.0.8: rebuild the player/team list from the fresh matchup every poll (the old one was frozen at first render)
      const ss = sidesOf(m || mu || b.weekly[week] || []);
      const tms = Array.from(new Set([...(ss.me?.starters || []), ...(ss.opp?.starters || [])].filter(id => id && id !== '0').map(teamOf).filter(Boolean) as string[]));
      // scoring plays: every live game with this matchup's starters, every poll (+ once more when a game goes final)
      const changed = scoringTargets(g, tms, lastScore.current);
      if (changed.length) {
        const got = await Promise.all(changed.map(id => loadScoring(id).catch(() => null)));
        if (got.every(x => x === null)) return;
        setPlays(prev => { const ok = changed.filter((_, i) => got[i]); const keep = prev.filter(p => !ok.includes(p.gameId)); return keep.concat(...(got.filter(Boolean) as ScoringPlay[][])); });
      }
    } catch {}
  };
  tickRef.current = tick;
  useEffect(() => { tick(); }, [week, b.loadedAt]);
  const live = anyLive(games, teams);
  useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => tickRef.current(), POLL);
    const sub = AppState.addEventListener('change', s => { active.current = s === 'active'; if (active.current) tickRef.current(); });
    return () => { clearInterval(iv); sub.remove(); active.current = true; };
  }, [live, week]);

  if (!sides.me) return null;
  const rows = (s: Side | null) => (s ? s.starters.map((id, i) => ({ id, pts: id && id !== '0' ? (s.pp[id] ?? s.sp[i] ?? 0) : 0, proj: id && id !== '0' && week === b.week ? projOf(b, id) : 0, g: id && id !== '0' ? games?.[teamOf(id) || ''] : null, dead: week === b.week && deadThisWeek(b, id) })) : []);
  const mr = rows(sides.me), or = rows(sides.opp);
  const mo = sideOutlook(mr), oo = sideOutlook(or);
  const wp = sides.opp ? winChance(mo, oo) : 1;
  const started = [...mr, ...or].some(r => r.g && r.g.state !== 'pre');
  const allFinal = matchupFinal([...mr, ...or].map(r => ({ ...r, team: teamOf(r.id), bye: !!teamOf(r.id) && byeWeek(b, r.id) === week })), games);
  const oppTeam = sides.oppRid != null ? b.byRid[sides.oppRid] : null;
  const fraction = (g?: LiveGame | null) => (g ? 1 - remaining(g) : 1);

  // scoring feed for players in this matchup
  const feed = plays.map(p => {
    const who = [...(sides.me?.starters || []).map(id => ({ id, mine: true })), ...(sides.opp?.starters || []).map(id => ({ id, mine: false }))].filter(x => x.id && x.id !== '0' && playInvolves(p, pname(b, x.id), teamOf(x.id), ppos(b, x.id)));
    return { p, who };
  }).filter(x => x.who.length);
  const kick = (p: ScoringPlay) => Object.values(games || {}).find(g => g.id === p.gameId)?.kickoff || 0;
  const order = (p: ScoringPlay) => kick(p) + p.period * 1e6 + (900 - clockS(p.clock)) * 1000;
  feed.sort((x, y) => order(y.p) - order(x.p));
  const shown = showAll ? feed : feed.slice(0, 6);

  const status = !started ? 'Kickoff ' + (Object.values(games || {}).length ? nextKick(mr.concat(or), games) : 'soon') : allFinal ? 'All games final' : `${mo.left + oo.left} players still to play`;
  return (
    <Card accent={C.red}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {live ? <Pulse /> : <Text style={{ fontSize: 13 }}>🛰️</Text>}
        <Text style={{ color: C.text, fontSize: 16, fontWeight: '900', flex: 1 }}>{live ? 'LIVE' : allFinal && started ? 'Final' : 'Game day'} · Week {week}</Text>
        <Text style={{ color: C.dim, fontSize: 10.5 }}>{at ? `updated ${new Date(at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })} CT` : 'loading…'}</Text>
      </View>
      {/* scoreboard + win chance */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.mint, fontSize: 11, fontWeight: '800' }}>YOU</Text>
          <Text style={{ color: C.text, fontSize: 30, fontWeight: '900' }}>{fmt(mo.now)}</Text>
          {!allFinal ? <Text style={{ color: C.sub, fontSize: 11 }}>on pace for {fmt(mo.final)}</Text> : null}
        </View>
        <View style={{ alignItems: 'center', paddingBottom: 4 }}>
          <Text style={{ color: wp >= 0.5 ? C.mint : C.magenta, fontSize: 22, fontWeight: '900' }}>{Math.round(wp * 100)}%</Text>
          <Text style={{ color: C.dim, fontSize: 10 }}>{allFinal && started ? (wp >= 0.5 ? 'you won' : 'you lost') : 'win chance'}</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={{ color: C.magenta, fontSize: 11, fontWeight: '800' }} numberOfLines={1}>{oppTeam ? '@' + oppTeam.display.toUpperCase() : 'BYE'}</Text>
          <Text style={{ color: C.text, fontSize: 30, fontWeight: '900' }}>{fmt(oo.now)}</Text>
          {!allFinal ? <Text style={{ color: C.sub, fontSize: 11 }}>on pace for {fmt(oo.final)}</Text> : null}
        </View>
      </View>
      <View style={{ height: 10, borderRadius: 5, overflow: 'hidden', flexDirection: 'row', marginTop: 8, backgroundColor: C.card2 }}>
        <LinearGradient colors={[C.mint, '#4FE3D2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.max(3, Math.min(97, wp * 100))}%` as any }} />
        <LinearGradient colors={[C.purple, C.magenta]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
      </View>
      <Text style={[T.sub, { marginTop: 6, fontSize: 11 }]}>{status}</Text>

      {/* player by player */}
      <View style={{ marginTop: 10 }}>
        {mr.map((r, i) => {
          const o = or[i];
          const cm = gameChip(r.g, teamOf(r.id)), co = o ? gameChip(o.g, teamOf(o.id)) : null;
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Pressable onPress={() => r.id && r.id !== '0' && openPlayer(r.id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {r.id && r.id !== '0' ? <Head id={r.id} size={24} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontSize: 11.5 }} numberOfLines={1}>{r.id && r.id !== '0' ? pname(b, r.id) : 'Empty'}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Text style={{ color: o && r.pts >= o.pts ? C.mint : C.text, fontWeight: '900', fontSize: 14 }}>{fmt(r.pts)}</Text>
                    <Text style={{ color: cm.color, fontSize: 10 }} numberOfLines={1}>{cm.text}</Text>
                  </View>
                  <View style={{ height: 3, borderRadius: 2, backgroundColor: C.card2, marginTop: 2, marginRight: 8 }}><View style={{ height: 3, borderRadius: 2, width: `${fraction(r.g) * 100}%` as any, backgroundColor: r.g?.state === 'in' ? C.gold : C.mint + '88' }} /></View>
                </View>
              </Pressable>
              <Text style={{ width: 36, textAlign: 'center', color: C.dim, fontSize: 9.5, fontWeight: '800' }}>{slotLabel(b.slots[i] || '')}</Text>
              {o ? (
                <Pressable onPress={() => o.id && o.id !== '0' && openPlayer(o.id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={{ color: C.text, fontSize: 11.5 }} numberOfLines={1}>{o.id && o.id !== '0' ? pname(b, o.id) : 'Empty'}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text style={{ color: co!.color, fontSize: 10 }} numberOfLines={1}>{co!.text}</Text>
                      <Text style={{ color: o.pts > r.pts ? C.magenta : C.text, fontWeight: '900', fontSize: 14 }}>{fmt(o.pts)}</Text>
                    </View>
                    <View style={{ height: 3, borderRadius: 2, backgroundColor: C.card2, marginTop: 2, marginLeft: 8, alignSelf: 'stretch', alignItems: 'flex-end' }}><View style={{ height: 3, borderRadius: 2, width: `${fraction(o.g) * 100}%` as any, backgroundColor: o.g?.state === 'in' ? C.gold : C.magenta + '88' }} /></View>
                  </View>
                  {o.id && o.id !== '0' ? <Head id={o.id} size={24} /> : null}
                </Pressable>
              ) : <View style={{ flex: 1 }} />}
            </View>
          );
        })}
      </View>

      {/* where to watch: official broadcasters only */}
      <WatchList games={[...mr, ...or].map(r => r.g).filter((g): g is LiveGame => !!g)} week={week} />

      {/* scoring plays */}
      <Text style={{ color: C.text, fontWeight: '800', marginTop: 12 }}>⚡ Scoring plays</Text>
      {shown.length ? shown.map(({ p, who }) => (
        <View key={p.id} style={{ flexDirection: 'row', gap: 8, marginTop: 7 }}>
          <View style={{ width: 4, borderRadius: 2, backgroundColor: who.some(w => w.mine) ? C.mint : C.magenta }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 12, lineHeight: 16 }}>{p.text}</Text>
            <Text style={{ color: C.dim, fontSize: 10.5 }}>{who.map(w => (w.mine ? '' : '@') + pname(b, w.id).split(' ').slice(-1)[0]).join(', ')} · {p.away} {p.as}-{p.hs} {p.home} · Q{p.period} {p.clock}</Text>
          </View>
        </View>
      )) : <Text style={[T.sub, { marginTop: 4 }]}>{started ? 'None yet.' : 'TDs and field goals show up here.'}</Text>}
      {feed.length > 6 ? <Text onPress={() => setShowAll(!showAll)} style={{ color: C.mint, fontSize: 12, fontWeight: '700', marginTop: 8 }}>{showAll ? 'Show less' : `Show all ${feed.length}`} ›</Text> : null}
      <Text style={{ color: C.dim, fontSize: 10, marginTop: 8 }}>Points: Sleeper · Clock: ESPN · Win chance is an estimate · Updates every 25s</Text>
    </Card>
  );
}
function WatchList({ games, week }: { games: LiveGame[]; week: number }) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<LiveGame | null>(null);
  const uniq = games.filter((g, i) => games.findIndex(x => x.id === g.id) === i).sort((a, c) => (a.state === 'in' ? -1 : 0) - (c.state === 'in' ? -1 : 0) || a.kickoff - c.kickoff);
  if (!uniq.length) return null;
  const list = open ? uniq : uniq.slice(0, 3);
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ color: C.text, fontWeight: '800' }}>📺 Your games</Text>
      {list.map(g => (
        <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 7, gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 12.5, fontWeight: '700' }}>{g.away} {g.state === 'pre' ? '' : g.as + ' '}@ {g.home}{g.state === 'pre' ? '' : ' ' + g.hs}</Text>
            <Text style={{ color: C.dim, fontSize: 10.5 }}>{g.state === 'in' ? `Q${g.period} ${g.clock}${g.down ? ' · ' + g.down : ''}` : g.state === 'post' ? 'Final' : kickoffCT(g.kickoff)}{g.tv?.length ? ' · On ' + g.tv.join(', ') : ''}</Text>
          </View>
          <Pressable onPress={() => setSheet(g)} style={{ borderRadius: 12, borderWidth: 1, borderColor: (g.state === 'post' ? '#FF3D5A' : C.mint) + 'AA', backgroundColor: (g.state === 'post' ? '#FF3D5A' : C.mint) + '1A', paddingHorizontal: 11, paddingVertical: 5 }}>
            <Text style={{ color: g.state === 'post' ? '#FF3D5A' : C.mint, fontSize: 11.5, fontWeight: '800' }}>{g.state === 'post' ? '▶ Highlights' : '📺 Watch'}</Text>
          </Pressable>
        </View>
      ))}
      {uniq.length > 3 ? <Text onPress={() => setOpen(!open)} style={{ color: C.mint, fontSize: 12, fontWeight: '700', marginTop: 6 }}>{open ? 'Show less' : `All ${uniq.length} games`} ›</Text> : null}
      {sheet ? <WatchSheet g={sheet} week={week} onClose={() => setSheet(null)} /> : null}
    </View>
  );
}
function WatchSheet({ g, week, onClose }: { g: LiveGame; week: number; onClose: () => void }) {
  const ins = useInsets();
  const opts = watchOptions(g, week);
  const col = (k: string) => (k === 'yt' ? '#FF3D5A' : k === 'nfl' ? C.gold : C.mint);
  return (
    <Modal visible animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(5,8,20,0.6)' }} />
      <View style={{ backgroundColor: C.bg2, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: C.border, padding: 18, paddingBottom: ins.bottom + 22 }}>
        <LinearGradient colors={['#7B5CFF33', 'transparent']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 120, borderTopLeftRadius: 22, borderTopRightRadius: 22 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: C.text, fontSize: 19, fontWeight: '900', flex: 1 }}>{g.away} @ {g.home}</Text>
          <Pressable onPress={onClose} hitSlop={12}><Text style={{ color: C.text, fontSize: 20 }}>✕</Text></Pressable>
        </View>
        <Text style={{ color: C.mint, fontSize: 14, fontWeight: '800', marginTop: 2 }}>{g.tv?.length ? 'On ' + g.tv.join(', ') : 'Broadcaster not listed yet'}</Text>
        <Text style={{ color: C.dim, fontSize: 11.5, marginBottom: 10 }}>{g.state === 'in' ? `Live · Q${g.period} ${g.clock}` : g.state === 'post' ? `Final · ${g.away} ${g.as}, ${g.home} ${g.hs}` : kickoffCT(g.kickoff)}</Text>
        {opts.map(o => (
          <Pressable key={o.url} onPress={() => Linking.openURL(o.url)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: col(o.kind) + '77', backgroundColor: col(o.kind) + '14', paddingHorizontal: 13, paddingVertical: 10, marginTop: 7 }}>
            <Text style={{ fontSize: 16 }}>{o.kind === 'yt' ? '▶️' : o.kind === 'nfl' ? '🏈' : '📺'}</Text>
            <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: '800', fontSize: 14 }}>{o.label}</Text><Text style={{ color: C.sub, fontSize: 11 }}>{o.sub}</Text></View>
            <Text style={{ color: col(o.kind), fontSize: 18 }}>›</Text>
          </Pressable>
        ))}
        <Text style={{ color: C.dim, fontSize: 10.5, marginTop: 10 }}>Broadcaster from ESPN's listing. Each button opens that service's own app if you have it, or its official website. Sign-in or a subscription may be needed, and local TV varies by market.</Text>
      </View>
    </Modal>
  );
}
const clockS = (c: string) => { const [m, s] = (c || '0:0').split(':').map(Number); return (m || 0) * 60 + (s || 0); };
function nextKick(rows: { g?: LiveGame | null }[], games: Record<string, LiveGame> | null) {
  const t = rows.map(r => r.g).filter(g => g && g.state === 'pre').map(g => g!.kickoff).sort((a, c) => a - c)[0];
  return t ? kickoffCT(t) : 'soon';
}
