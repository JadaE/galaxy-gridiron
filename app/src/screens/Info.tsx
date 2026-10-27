// v0.0.7: (i) buttons. Plain-words explanations of each page's numbers, anchored to what Sleeper shows.
import React, { useState } from 'react';
import { View, Text, Modal, ScrollView, Pressable } from 'react-native';
import { C } from '../theme';
import { useInsets } from '../safe';

export type InfoKey = 'team' | 'matchup' | 'league' | 'waivers' | 'trades' | 'picks' | 'chat' | 'player';
type Sec = [string, string];
const COMMON: Sec[] = [
  ['Proj', "Sleeper's own projection for this week, scored with your league's settings. The same number you see next to a player in Sleeper's Match screen."],
  ['Median', 'His middle game this season: half his games were higher and half were lower. Less thrown off by one huge week than an average.'],
  ['Floor', 'A bad-but-normal week for him (his 25th-percentile game). A higher floor means fewer duds.'],
  ['Value', "The app's own steady-scoring number: this season's games (big spikes counted less), recent form, and how often he's been startable, blended with last season's per-game points when this season is a small sample. Sleeper doesn't show this. Use it to compare players, not as a points prediction."],
  ['Trend', 'His last 3 games minus his usual level. ▲ means he has been scoring more lately, ▼ less.'],
];
const PAGES: Record<InfoKey, { title: string; secs: Sec[] }> = {
  team: { title: 'Team page', secs: [
    ['Record, Points for, Points against', 'Same as Sleeper.'],
    ['All-play', 'Your record if you had played every team every week. It shows how good your scores were, apart from schedule luck.'],
    ['Lineup IQ', "Your points for divided by Sleeper's max points (what your best possible lineup would have scored, in hindsight). 100% means you started the right players every week."],
    ['Lineup alerts', "Problems with this week's lineup: empty slots, players on bye or ruled out, and Questionable tags with the latest practice report. Totals add up your starters' Sleeper projections, the way Sleeper's Match screen does."],
    ['Week report card (A+ to F)', "Last week's grade. Half is your score vs the league median, 30% is how close you got to your best possible lineup (\"left on bench\" = points you could have added), and 20% is how you did vs your Sleeper projection."],
    ['Weekly scores', 'Your score each week against the league average.'],
    ["Who's carried you", 'Total points each player has scored for you while in your starting lineup. Gray bars are players no longer on your team.'],
    ...COMMON,
  ] },
  matchup: { title: 'Match and Live', secs: [
    ['Score and projected totals', "Points are Sleeper's, in your league's scoring. Before games start, totals are the sum of your starters' Sleeper projections."],
    ['Live: on pace for', "Points scored so far plus each player's projection for the part of his game that's left."],
    ['Win chance', "A rough estimate from the scores so far and what's left to play (about ±55% of a projection is a normal swing for one game). It's not a betting line. Sleeper's own WIN % uses its own model, so the two can differ."],
    ['🏈 and 🔴', "🏈 = that player's team has the ball. 🔴 = they're in the red zone (inside the 20)."],
    ['Thin bars under players', "How much of that player's game is done (gold = being played now)."],
    ['Scoring plays', "Touchdowns, field goals and defensive scores involving a starter in this matchup, from ESPN's public play-by-play. Mint = your players, purple = your opponent's."],
  ] },
  league: { title: 'League page', secs: [
    ['Standings', "Same as Sleeper's: wins, then points for."],
    ['Power ranking (all-play)', 'Your record if you had played every team every week. It measures how good your scores were, apart from schedule luck.'],
    ['You vs the league average', 'Your starters at each position compared with the average team in your league.'],
    ['Path to the top 3', 'Odds from simulating the rest of the schedule with each team\'s current strength. A guide, not a guarantee.'],
  ] },
  waivers: { title: 'Waivers page', secs: [
    ['Best pickups for your team', 'Free agents ranked by how much they would add to YOUR lineup (expected points over the starter or bench player they would replace), not by general popularity.'],
    ['+4.2 (green number)', "Expected points per week he would add to your lineup. Expected points = half this week's Sleeper projection, half the app's Value. \"depth\" = he wouldn't start for you right now."],
    ['SAFE / OK / RISKY DROP', 'Who you could cut to make room, and how much that would hurt (byes in the next 3 weeks, backups at that position, injuries).'],
    ['🔥 and Trending adds (24h)', "How many Sleeper users added him in the last 24 hours (Sleeper's public trending list)."],
    ['Your moves scorecard', "A grade for each add, drop or trade, based on lineup impact. The app compares your real lineup with what you'd most likely have started without the move (the dropped player or your best bench player who played). Filling an empty or bye slot counts in full. Adds who sat on your bench count 0. TBD = no games played since the move."],
  ] },
  trades: { title: 'Trades page', secs: [
    ['Trade value (e.g. "Trade 1799")', "FantasyCalc's public market value for redraft leagues like yours. It's a value scale, not points: only the differences between players matter. Higher = more valuable in trades."],
    ['Your roster vs the league (e.g. WR -23%)', "Your starters' trade value at each position compared with the league average. Minus = below average, so that's a spot to upgrade."],
    ['You give · 3123 / You get · 3074', 'The total trade value on each side, so you can see the deal is fair on market value.'],
    ['"+675 lineup value"', "How much a trade idea raises YOUR lineup on that same value scale (your starters after the trade minus before). Bigger means a bigger upgrade for you, while staying fair enough on market value that the other team might say yes."],
    ['🔒 and 💎', '🔒 Will not trade: never offered. 💎 Personal high value: only offered for a clear overpay (at least 115% of market).'],
  ] },
  picks: { title: 'Picks page', secs: [
    ['Record and chart', 'Your pick\'em record by week. The gold line is your season win %. Games are graded from ESPN\'s public final scores.'],
    ['Leaderboard', "Honor system, by Sleeper username. Other players' picks stay hidden until that game kicks off."],
  ] },
  chat: { title: 'Ask Gridiron', secs: [
    ['"X or Y?"', "During the season this means who to start THIS week. The answer uses Sleeper's projection for this week, plus the Vegas line, the opponent, kickoff time and injury or practice news. Ask about \"rest of season\" or \"roster fit\" to compare them long term."],
    ['"Vegas expects CHI to score 26.8"', "How many points Vegas expects that team to score, worked out from the spread and the over/under. Higher is better for that team's QB, RB, WR, TE and K. For a defense you want the OTHER team's implied total to be low."],
    ['"CHI favored by 3; Vegas over/under 50.5"', 'Betting markets expect Chicago to win by about 3, and both teams together to score about 50.5 points.'],
    ['"Allows 14.1 pts/g to QBs (27th most)"', 'Average fantasy points that defense has given up to that position this season. Rank 1 = gives up the most = easiest matchup. For RB, WR and TE this counts all of them together.'],
    ['Coin flip / Lean', 'The two are within about a point this week. The tiebreak is your matchup: if you project behind, take the higher ceiling (bigger team total). If you project ahead, take the safer floor.'],
    ['Roster fit %', 'Only for pickup, drop or trade questions (or when you ask). It shows which player helps your roster more over the rest of the season, given your other players, byes and depth. The two numbers add up to 100.'],
    ...COMMON,
  ] },
  player: { title: 'Player card', secs: [
    ...COMMON,
    ['Ceiling', 'His best game this season.'],
    ['Startable %', 'How often he scored like a starter at his position this season (top ~25 RBs/WRs, top ~12 QBs/TEs in a 10-team league).'],
    ['Last 3', 'Average of his last 3 games (big spikes counted less).'],
    ['🔬 Small sample / 🩹 Returning from injury', 'Not many games this season, or games missed through injury. The app leans more on last season\'s per-game points, and counts per game so missed weeks don\'t sink a player who is healthy again.'],
    ['Recent / Season News', "Headlines from Sleeper's own news feed (Rotowire, FantasyPros, RotoBaller). Season News also lists injuries, team changes and QB changes."],
  ] },
};

export function InfoSheet({ k, onClose }: { k: InfoKey; onClose: () => void }) {
  const ins = useInsets();
  const p = PAGES[k];
  return (
    <Modal visible animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(5,8,20,0.6)' }} />
      <View style={{ maxHeight: '82%', backgroundColor: C.bg2, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: C.border, paddingTop: 16, paddingHorizontal: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '900', flex: 1 }}>ⓘ  {p.title}: what the numbers mean</Text>
          <Pressable onPress={onClose} hitSlop={12}><Text style={{ color: C.text, fontSize: 20 }}>✕</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: ins.bottom + 24, gap: 10 }}>
          {p.secs.map(([h, t]) => (
            <View key={h}><Text style={{ color: C.mint, fontWeight: '800', fontSize: 13.5 }}>{h}</Text><Text style={{ color: C.text, fontSize: 13, lineHeight: 18, marginTop: 2 }}>{t}</Text></View>
          ))}
          <Text style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>Galaxy Gridiron is read-only: it never makes moves in Sleeper.</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

export function InfoButton({ k, size = 22 }: { k: InfoKey; size?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={10} accessibilityLabel="What do these numbers mean?" style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: C.mint, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,206,184,0.12)' }}>
        <Text style={{ color: C.mint, fontWeight: '900', fontSize: size * 0.6, fontStyle: 'italic' }}>i</Text>
      </Pressable>
      {open ? <InfoSheet k={k} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
