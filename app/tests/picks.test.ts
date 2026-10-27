// Run: npx tsx tests/picks.test.ts  (offline: uses ESPN fixtures from 2026 weeks 1-7, captured Oct 21 2026)
import assert from 'node:assert/strict';
import fs from 'fs';
import { parseEspn, grade, weekRecord, seasonRecord, canPick, parseImport, mergePicks, exportFile, Game, PickMap } from '../src/picks/core';
import { parseNotes, pickFromSegment } from '../src/picks/parse';
import { findTeams, TEAMS } from '../src/picks/teams';
let pass = 0, fail = 0;
const t = (n: string, f: () => void) => { try { f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const byWeek: Record<number, Game[]> = JSON.parse(fs.readFileSync(__dirname + '/fixtures/games-2026-w1-7.json', 'utf8'));
const g5 = parseEspn(JSON.parse(fs.readFileSync(__dirname + '/fixtures/espn-2026-w5.json', 'utf8')), 5, 2026);
const game = (w: number, a: string) => byWeek[w].find(g => g.home.abbr === a || g.away.abbr === a)!;

console.log('ESPN + grading');
t('week 5 parses 15 games, NYG@WSH is a tie with no winner', () => { assert.equal(g5.length, 15); const x = g5.find(g => g.home.abbr === 'WSH')!; assert.equal(x.tie, true); assert.equal(x.winner, null); });
t('tie grades as no result', () => assert.equal(grade(game(5, 'WSH'), { team: 'WSH', week: 5, at: 0, src: 'live' }), 'NR'));
t('postponed grades as no result', () => assert.equal(grade({ ...game(5, 'KC' as any) || game(5, 'BUF'), state: 'off', winner: null }, { team: 'BUF', week: 5, at: 0, src: 'live' }), 'NR'));
t('win/loss/pending', () => {
  assert.equal(grade(game(1, 'SEA'), { team: 'SEA', week: 1, at: 0, src: 'live' }), 'W');
  assert.equal(grade(game(1, 'SEA'), { team: 'NE', week: 1, at: 0, src: 'live' }), 'L');
  assert.equal(grade(game(7, 'CHI'), { team: 'CHI', week: 7, at: 0, src: 'live' }), 'pending');
});
t('picks lock at kickoff; backfill only for finished games', () => {
  const g = game(7, 'CHI');
  assert.equal(canPick(g, 'live', g.kickoff - 1000), true);
  assert.equal(canPick(g, 'live', g.kickoff + 1000), false);
  assert.equal(canPick(g, 'backfill', g.kickoff - 1000), false);
  assert.equal(canPick(game(6, 'GB'), 'backfill'), true);
});
t('week + season record with cumulative %', () => {
  const p: PickMap = {};
  for (const g of byWeek[1]) p[g.id] = { team: g.home.abbr, week: 1, at: 0, src: 'backfill' };
  const r = weekRecord(byWeek[1], p);
  assert.equal(r.w + r.l, 16); assert.equal(r.backfilled, 16);
  const s = seasonRecord(byWeek, p, [1, 2]);
  assert.equal(s.rows[1].cumW, r.w); assert.equal(s.total.w, r.w);
});

console.log('Team matching');
t('nicknames, abbreviations and cities', () => {
  const cases: [string, string][] = [['Niners', 'SF'], ['9ers', 'SF'], ['bucs', 'TB'], ['Pats', 'NE'], ['jags', 'JAX'], ['Fins', 'MIA'], ['Philly', 'PHI'], ['Green Bay', 'GB'], ['Kansas City Chiefs', 'KC'], ['KC', 'KC'], ['G-Men', 'NYG'], ['LA Rams', 'LAR'], ['bolts', 'LAC'], ['Commanders', 'WSH'], ['Vegas', 'LV'], ['the chiefs', 'KC'], ['Steelers', 'PIT'], ['49ers', 'SF'], ['Seattle', 'SEA'], ['cowboy', 'DAL']];
  for (const [s, a] of cases) assert.deepEqual(findTeams(s).map(m => m.abbr), [a], s);
});
t('everyday words are not teams ("no", "was", "min", "ten", "sea")', () => {
  assert.deepEqual(findTeams('no idea, was close, ten min at sea').map(m => m.abbr), []);
  assert.deepEqual(findTeams('NO').map(m => m.abbr), ['NO']);
});
t('"Los Angeles" or "New York" alone is not a match', () => { assert.deepEqual(findTeams('Los Angeles').length, 0); assert.deepEqual(findTeams('New York').length, 0); });
t('segment rules: over/beat, repeated pick, flags', () => {
  assert.deepEqual(pickFromSegment('Chiefs over Raiders'), { team: 'KC', opp: 'LV' });
  assert.deepEqual(pickFromSegment('Raiders lose to Chiefs'), { team: 'KC', opp: 'LV' });
  assert.deepEqual(pickFromSegment('Bills vs Jets - Bills'), { team: 'BUF', opp: 'NYJ' });
  assert.deepEqual(pickFromSegment('KC > LV'), { team: 'KC', opp: 'LV' });
  assert.deepEqual(pickFromSegment('Chiefs* @ Raiders'), { team: 'KC', opp: 'LV' });
  assert.deepEqual(pickFromSegment('Raiders @ Chiefs ✅'), { team: 'KC', opp: 'LV' });
  assert.deepEqual(pickFromSegment('Bears vs Packers, picked Packers'.split(',')[1]), { team: 'GB' });
  assert.ok('err' in (pickFromSegment('Chiefs vs Raiders') as any));
});

console.log('Paste from Notes');
const S1 = `Week 1
Seahawks ✅
Niners W
bucs L
Saints ❌
NYJ - W
Ravens
pitt (W)
Bears won
Jags
bills
Raiders ✔
vikings
Eagles
cards
giants
Chiefs
Week 1: 13-3`;
t('sample 1: emoji/W/L lines with a header', () => {
  const r = parseNotes(S1, byWeek, 7);
  assert.equal(r.matched.length, 16, JSON.stringify(r.unmatched));
  assert.equal(r.unmatched.length, 0, JSON.stringify(r.unmatched));
  assert.equal(r.info.length, 1);
  const bucs = r.matched.find(m => m.team === 'TB')!; assert.equal(bucs.marker, 'L'); assert.equal(bucs.warn, undefined);
  const saints = r.matched.find(m => m.team === 'NO')!; assert.equal(saints.marker, 'L');
});
const S2 = `wk2: BUF, CAR, MIN, PHI, NE, GB, CLE, NO
 - Bengals over Texans
 - Broncos > Jags ✓
 - lv / lac → raiders   
 - Cowboys beat Commanders (W)
Seattle W, Niners W, KC, Rams
week 3
1. ATL over GB
2. Bills vs Chargers - Bills
3) Browns
* colts w
* KC L
• giants ✅
Steelers (pick) vs Bengals
Jax
wash
Detroit
Vikings
Ravens
Raiders
Broncos
Chicago
hello this is a random line
`;
t('sample 2: comma lists, wk2:, over/>/beat, numbered and bullet lists', () => {
  const r = parseNotes(S2, byWeek, 7);
  const w2 = r.matched.filter(m => m.week === 2), w3 = r.matched.filter(m => m.week === 3);
  assert.equal(w2.length, 16, 'w2 ' + JSON.stringify(r.unmatched));
  assert.equal(w3.length, 15, 'w3 ' + JSON.stringify(r.unmatched));
  assert.deepEqual(r.unmatched.map(u => u.line), [23]);
  const kc = w3.find(m => m.team === 'KC')!; assert.equal(kc.marker, 'L'); assert.ok(kc.warn && /says L/.test(kc.warn), 'KC won in week 3, note says L');
});
const S3 = `NFL WEEK FIVE PICKS 🏈
Bucs
Jaguars
packers
Texans
bengals
patriots
Vikings
jets
Steelers
Commanders
Broncos
Lions
49ers
Ravens
Rams
Went 11-3 this week!`;
t('sample 3: "WEEK FIVE" header, tie flagged, record line ignored', () => {
  const r = parseNotes(S3, byWeek, 7);
  assert.equal(r.matched.length, 15, JSON.stringify(r.unmatched));
  assert.ok(r.matched.find(m => m.team === 'WSH')!.warn!.includes('tie'));
  assert.equal(r.unmatched.length, 0, JSON.stringify(r.unmatched));
});
t('sample 4: no header uses the default week; bye teams are reported', () => {
  const r = parseNotes('Bills\nChargers\nChiefs over Chargers\nseahawks', byWeek, 7);
  assert.deepEqual(r.matched.map(m => m.team), ['SEA']); // Bills/Chargers on bye, KC plays SEA not LAC
  assert.ok(r.unmatched.some(u => /Bills didn't play in week 7/.test(u.reason)));
});
t('sample 5: duplicate pick for one game, last line wins with a warning', () => {
  const r = parseNotes('Week 6\nPackers\nCowboys', byWeek, 7);
  assert.equal(r.matched.length, 1); assert.equal(r.matched[0].team, 'DAL'); assert.ok(/replaces line 2/.test(r.matched[0].warn || ''));
});
t('sample 6: ambiguous "X vs Y" goes to unmatched with a hint', () => {
  const r = parseNotes('week 4\nChiefs vs Raiders', byWeek, 7);
  assert.equal(r.matched.length, 0); assert.ok(/over/.test(r.unmatched[0].reason));
});
t('sample 7: wrong opponent is caught', () => { const r = parseNotes('Week 4\nChiefs over Bills', byWeek, 7); assert.ok(/played LV/.test(r.unmatched[0].reason)); });
t('sample 8: messy whitespace, CRLF, W6 shorthand header, all caps', () => {
  const r = parseNotes('W6\r\n  DENVER  \r\n\r\nHOUSTON TEXANS W\r\nbears ✅✅\r\n', byWeek, 7);
  assert.equal(r.matched.length, 3, JSON.stringify(r.unmatched)); assert.deepEqual(r.matched.map(m => m.week), [6, 6, 6]);
});

console.log('Export / import');
t('export then import round-trips; junk rows skipped', () => {
  const p: PickMap = { [game(6, 'GB').id]: { team: 'GB', week: 6, at: 1, src: 'live' } };
  const f = exportFile('1000000000000000001', 'testuser', 2026, p);
  const txt = JSON.stringify({ ...f, picks: { ...f.picks, bad: { team: 'XYZ', week: 99 } } });
  const r = parseImport(txt, new Set(Object.keys(TEAMS)));
  assert.ok(r.ok); if (r.ok) { assert.equal(Object.keys(r.picks).length, 1); assert.equal(r.skipped, 1); }
  assert.equal(parseImport('{nope', new Set()).ok, false);
});
t('merge keep vs replace', () => {
  const a: PickMap = { '1': { team: 'GB', week: 6, at: 1, src: 'live' } }, b: PickMap = { '1': { team: 'DAL', week: 6, at: 2, src: 'import' }, '2': { team: 'KC', week: 6, at: 2, src: 'import' } };
  assert.deepEqual([mergePicks(a, b, 'keep').picks['1'].team, mergePicks(a, b, 'keep').added], ['GB', 1]);
  assert.equal(mergePicks(a, b, 'replace').picks['1'].team, 'DAL');
});
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
