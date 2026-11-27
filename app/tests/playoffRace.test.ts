// Playoff run math + Player pickups defaults. Mock leagues only.
// Run: npx tsx --require ./tests/rn-shim.cjs tests/playoffRace.test.ts
import assert from 'node:assert/strict';
import {
  playoffByes, playoffRace, pairsFromMatchups, finishLine, formatRecord,
  playoffUserStrings, GROUP_TITLES, PLAYOFF_COPY, PLAYOFF_INFO_SECS,
  type RaceTeam, type RemainingGame, type RaceInput,
} from '../src/playoffRace';
import { defaultPickupsPane } from '../src/pickups';
import { tradeDeadlineStatus } from '../src/deadline';

let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };

const team = (rid: number, wins: number, losses: number, pf: number, extra: Partial<RaceTeam> = {}): RaceTeam =>
  ({ rid, wins, losses, ties: 0, pf, ...extra });

function names(rids: number[], map: Record<number, string>) {
  return rids.map(id => map[id] || String(id));
}

(async () => {
  console.log('Playoff run');

  await t('bye counts: 4 and 8 have none, 6 has two', () => {
    assert.equal(playoffByes(4), 0);
    assert.equal(playoffByes(8), 0);
    assert.equal(playoffByes(6), 2);
    assert.equal(playoffByes(0), 0);
    assert.equal(playoffByes(5), 3);
  });

  // Eight-team, four playoff spots, four weeks left. Mock names only.
  const n8: Record<number, string> = { 5: 'Cedar', 6: 'Maple', 1: 'Pine', 2: 'Oak', 3: 'Birch', 7: 'Willow', 4: 'Aspen', 8: 'Spruce' };
  const teams8: RaceTeam[] = [
    team(5, 9, 2, 1721.66),
    team(6, 8, 3, 1606.30),
    team(1, 7, 4, 1665.90),
    team(2, 6, 5, 1645.08),
    team(3, 4, 7, 1421.08),
    team(7, 4, 7, 1294.28),
    team(4, 4, 7, 1264.62),
    team(8, 2, 9, 1477.54),
  ];
  const games8: RemainingGame[] = [
    { a: 1, b: 7 }, { a: 2, b: 6 }, { a: 3, b: 4 }, { a: 5, b: 8 },
    { a: 1, b: 6 }, { a: 2, b: 5 }, { a: 3, b: 7 }, { a: 4, b: 8 },
    { a: 1, b: 3 }, { a: 5, b: 6 }, { a: 7, b: 8 }, { a: 2, b: 4 },
    { a: 1, b: 5 }, { a: 3, b: 8 }, { a: 4, b: 6 }, { a: 2, b: 7 },
  ];
  const in8: RaceInput = { teams: teams8, playoffTeams: 4, playoffStart: 16, lastScored: 11, week: 12, playoffSeedType: 0, games: games8 };

  await t('8-team / 4 playoff: locked, in control, fighting, PF-only; no byes; #1 still open', () => {
    const r = playoffRace(in8);
    assert.equal(r.unconfigured, false);
    assert.equal(r.seasonOver, false);
    assert.equal(r.usedEnum, true);
    assert.equal(r.byes, null);
    assert.equal(r.lockWins, 9);
    const g = (id: string) => (r.groups.find(x => x.id === id)?.rows || []).map(x => x.rid).sort((a, b) => a - b);
    assert.deepEqual(g('locked'), [5], 'Cedar locked: ' + names(g('locked'), n8));
    assert.deepEqual(g('control'), [1, 2, 6], 'control ' + names(g('control'), n8));
    const fight = r.groups.find(x => x.id === 'fight')!.rows;
    assert.deepEqual(fight.map(x => x.rid).sort((a, b) => a - b), [3, 4, 7, 8]);
    assert.equal(fight.find(x => x.rid === 8)!.pfOnly, true);
    assert.equal(fight.filter(x => x.rid !== 8).every(x => !x.pfOnly), true);
    assert.equal(r.groups.some(x => x.id === 'out'), false, 'nobody out');
    assert.equal(r.seed1.clinched, false);
    assert.deepEqual(r.seed1.rids.slice().sort((a, b) => a - b), [1, 2, 5, 6]);
    assert.equal(r.byRid[5].finish, 'Can finish 9-6 to 13-2');
    assert.equal(r.byRid[6].finish, 'Can finish 8-7 to 12-3');
    assert.equal(r.byRid[8].finish, 'Can finish 2-13 to 6-9 on points');
    assert.match(r.byRid[5].finish, /^Can finish /);
    assert.equal(r.byRid[5].minWins, 9);
    assert.equal(r.byRid[5].maxWins, 13);
  });

  await t('pairsFromMatchups reads Sleeper-shaped weeks and skips byes', () => {
    const weeks = {
      12: [{ roster_id: 1, matchup_id: 1 }, { roster_id: 7, matchup_id: 1 }, { roster_id: 2, matchup_id: 2 }, { roster_id: 6, matchup_id: 2 }],
      13: [{ roster_id: 3, matchup_id: 9 }], // unmatched, ignored
    };
    const p = pairsFromMatchups(weeks);
    assert.equal(p.length, 2);
    assert.deepEqual(p[0], { a: 1, b: 7 });
  });

  // 10-team, 6 playoff spots, 2 byes. Season over.
  const teams10done: RaceTeam[] = [
    team(1, 12, 2, 2000), team(2, 11, 3, 1900), team(3, 10, 4, 1800),
    team(4, 9, 5, 1700), team(5, 8, 6, 1600), team(6, 7, 7, 1500),
    team(7, 6, 8, 1400), team(8, 5, 9, 1300), team(9, 4, 10, 1200), team(10, 3, 11, 1100),
  ];
  await t('10-team / 6 playoff, season over: top 6 locked, bottom 4 out, 2 byes locked, #1 locked', () => {
    const r = playoffRace({ teams: teams10done, playoffTeams: 6, playoffStart: 16, lastScored: 15, week: 16, games: [] });
    assert.equal(r.seasonOver, true);
    assert.equal(playoffByes(6), 2);
    assert.ok(r.byes && r.byes.count === 2);
    assert.deepEqual(r.groups.find(g => g.id === 'locked')!.rows.map(x => x.rid), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(r.groups.find(g => g.id === 'out')!.rows.map(x => x.rid), [7, 8, 9, 10]);
    assert.equal(r.groups.some(g => g.id === 'control' || g.id === 'fight'), false);
    assert.equal(r.seed1.clinched, true);
    assert.deepEqual(r.seed1.rids, [1]);
    assert.deepEqual(r.byes!.clinched, [1, 2]);
    assert.deepEqual(r.byes!.open, []);
    assert.equal(r.byRid[1].finish, 'Finished 12-2');
    assert.equal(r.byRid[1].clinchBye, true);
  });

  // 10-team mid-season, byes still open. Two weeks (10 games).
  const teams10: RaceTeam[] = [
    team(1, 9, 3, 1600), team(2, 8, 4, 1550), team(3, 8, 4, 1500),
    team(4, 7, 5, 1480), team(5, 7, 5, 1400), team(6, 6, 6, 1390),
    team(7, 5, 7, 1300), team(8, 4, 8, 1200), team(9, 3, 9, 1100), team(10, 2, 10, 1000),
  ];
  const games10: RemainingGame[] = [
    { a: 1, b: 10 }, { a: 2, b: 9 }, { a: 3, b: 8 }, { a: 4, b: 7 }, { a: 5, b: 6 },
    { a: 1, b: 2 }, { a: 3, b: 4 }, { a: 5, b: 7 }, { a: 6, b: 8 }, { a: 9, b: 10 },
  ];
  await t('10-team / 6 playoff, two weeks left: byes still open, 4-team playoff would have no bye row', () => {
    const r = playoffRace({ teams: teams10, playoffTeams: 6, playoffStart: 15, lastScored: 12, week: 13, games: games10 });
    assert.equal(r.usedEnum, true);
    assert.ok(r.byes && r.byes.count === 2);
    assert.ok(r.byes.open.length + r.byes.clinched.length >= 2, 'some teams still in the bye race');
    assert.equal(r.seed1.clinched, false, 'with two weeks left #1 should still be open unless a team has run away');
    const four = playoffRace({ teams: teams10, playoffTeams: 4, playoffStart: 15, lastScored: 12, week: 13, games: games10 });
    assert.equal(four.byes, null);
    assert.equal(playoffByes(4), 0);
  });

  // 12-team smoke
  const teams12: RaceTeam[] = Array.from({ length: 12 }, (_, i) => team(i + 1, 11 - i, i, 1500 - i * 20));
  const games12: RemainingGame[] = [];
  for (let i = 0; i < 6; i++) games12.push({ a: i + 1, b: i + 7 });
  await t('12-team / 6 playoff: one week left, groups cover every team once', () => {
    const r = playoffRace({ teams: teams12, playoffTeams: 6, playoffStart: 14, lastScored: 12, week: 13, games: games12 });
    const all = r.groups.flatMap(g => g.rows.map(x => x.rid)).sort((a, b) => a - b);
    assert.deepEqual(all, teams12.map(x => x.rid));
    const seen = new Set(all);
    assert.equal(seen.size, 12);
    assert.ok(r.byes && r.byes.count === 2);
    assert.equal(r.usedEnum, true);
  });

  await t('#1 is locked when a team cannot be caught', () => {
    const teams: RaceTeam[] = [
      team(1, 13, 0, 2000), team(2, 8, 5, 1500), team(3, 7, 6, 1400), team(4, 6, 7, 1300),
      team(5, 5, 8, 1200), team(6, 4, 9, 1100), team(7, 3, 10, 1000), team(8, 2, 11, 900),
    ];
    const games: RemainingGame[] = [{ a: 1, b: 8 }, { a: 2, b: 7 }, { a: 3, b: 6 }, { a: 4, b: 5 }];
    const r = playoffRace({ teams, playoffTeams: 4, playoffStart: 16, lastScored: 13, week: 14, games });
    assert.equal(r.seed1.clinched, true);
    assert.deepEqual(r.seed1.rids, [1]);
    assert.equal(r.byRid[1].group, 'locked');
  });

  await t('unknown schedule fallback still marks a runaway locked and a last-place team out or fighting', () => {
    const teams: RaceTeam[] = [
      team(1, 11, 0, 2000), team(2, 6, 5, 1500), team(3, 5, 6, 1400), team(4, 5, 6, 1300),
      team(5, 4, 7, 1200), team(6, 3, 8, 1100), team(7, 2, 9, 1000), team(8, 0, 11, 800),
    ];
    const r = playoffRace({ teams, playoffTeams: 4, playoffStart: 16, lastScored: 11, week: 12, games: [], weeksLeft: 4 });
    assert.equal(r.usedFallback, true);
    assert.equal(r.byRid[1].group, 'locked'); // min 11, others max 10
    assert.ok(r.byRid[8].group === 'out' || r.byRid[8].pfOnly, 'Spruce-like last place is out or only on points');
  });

  await t('more than 16 remaining games uses the bounds fallback', () => {
    const teams: RaceTeam[] = [
      team(1, 8, 0, 1200), team(2, 7, 1, 1100), team(3, 6, 2, 1000), team(4, 5, 3, 900),
      team(5, 4, 4, 800), team(6, 3, 5, 700), team(7, 2, 6, 600), team(8, 1, 7, 500),
    ];
    const games: RemainingGame[] = [];
    // 17 games (repeat pairings)
    for (let i = 0; i < 17; i++) games.push({ a: (i % 8) + 1, b: ((i + 1) % 8) + 1 });
    const r = playoffRace({ teams, playoffTeams: 4, playoffStart: 18, lastScored: 8, week: 9, games });
    assert.equal(r.usedFallback, true);
    assert.equal(r.usedEnum, false);
    assert.equal(r.groups.flatMap(g => g.rows).length, 8);
  });

  await t('tied records use points-for, and a PF-only finish line is marked on points', () => {
    const teams: RaceTeam[] = [
      team(1, 6, 6, 2000), team(2, 6, 6, 1900), team(3, 6, 6, 1800), team(4, 6, 6, 1700),
      team(5, 6, 6, 1000), team(6, 5, 7, 1600), team(7, 5, 7, 1500), team(8, 5, 7, 1400),
    ];
    // Season over: top 4 by PF are in
    const r = playoffRace({ teams, playoffTeams: 4, playoffStart: 15, lastScored: 14, week: 15, games: [] });
    assert.equal(r.seasonOver, true);
    assert.deepEqual(r.groups.find(g => g.id === 'locked')!.rows.map(x => x.rid), [1, 2, 3, 4]);
    assert.ok(r.groups.find(g => g.id === 'out')!.rows.some(x => x.rid === 5));
    assert.equal(finishLine(6, 6, 0, 0, true), 'Finished 6-6 on points');
    assert.equal(formatRecord(8, 3, 1), '8-3-1');
  });

  await t('zero playoff teams is unconfigured and hides groups', () => {
    const r = playoffRace({ teams: [team(1, 5, 5, 1000)], playoffTeams: 0, playoffStart: 16, lastScored: 10, week: 11, games: [] });
    assert.equal(r.unconfigured, true);
    assert.equal(r.groups.length, 0);
  });

  await t('no jargon in labels, finish lines, or info copy', () => {
    const r = playoffRace(in8);
    const strings = [
      ...playoffUserStrings(r),
      ...Object.values(GROUP_TITLES),
      PLAYOFF_COPY.stillOpen1, PLAYOFF_COPY.clinched1,
      PLAYOFF_COPY.stillOpenBye, PLAYOFF_COPY.clinchedBye,
      PLAYOFF_COPY.waiversStillOpen,
      ...PLAYOFF_INFO_SECS.flat(),
    ];
    const bad = /magic|\bgames back\b|\bGB\b/i;
    for (const s of strings) assert.equal(bad.test(s), false, s);
  });

  console.log('\nPlayer pickups default pane');

  const b = (week: number, deadline: unknown, games?: Record<string, { state: string }> | null) => ({
    week,
    league: { league_id: 'mock-league-a', settings: deadline === undefined ? {} : { trade_deadline: deadline } },
    games: games ?? null,
  });

  await t('before the deadline, default is Trades', () => {
    assert.equal(defaultPickupsPane(tradeDeadlineStatus(b(8, 11))), 'trades');
    assert.equal(defaultPickupsPane(tradeDeadlineStatus(b(10, 11))), 'trades'); // approaching
  });

  await t('after the deadline, default is Waivers', () => {
    assert.equal(defaultPickupsPane(tradeDeadlineStatus(b(12, 11))), 'waivers');
    assert.equal(defaultPickupsPane(tradeDeadlineStatus(b(11, 11, { CHI: { state: 'post' }, DET: { state: 'post' } }))), 'waivers');
  });

  await t('no deadline defaults to Trades', () => {
    for (const raw of [0, 99, undefined, null, '', 'off']) {
      assert.equal(defaultPickupsPane(tradeDeadlineStatus(b(14, raw as any))), 'trades', String(raw));
    }
  });

  await t('switching leagues re-evaluates the default from the new settings', () => {
    const first = tradeDeadlineStatus({ week: 12, league: { league_id: 'mock-league-a', settings: { trade_deadline: 11 } } });
    const second = tradeDeadlineStatus({ week: 12, league: { league_id: 'mock-league-b', settings: { trade_deadline: 99 } } });
    const third = tradeDeadlineStatus({ week: 12, league: { league_id: 'mock-league-c', settings: { trade_deadline: 14 } } });
    assert.equal(defaultPickupsPane(first), 'waivers');
    assert.equal(defaultPickupsPane(second), 'trades');
    assert.equal(defaultPickupsPane(third), 'trades');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
