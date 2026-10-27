import assert from 'node:assert/strict';
import { matchupFinal, scoringTargets, resultLine, LiveGame } from '../src/live';
import { finishedOnly } from '../src/model';
let pass = 0, fail = 0;
const t = (n: string, f: () => any) => { try { f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const G = (id: string, state: string, hs = 0, as = 0) => ({ id, state, hs, as, period: 4, clock: '0:00', clockSec: 0 } as any as LiveGame);
const games: Record<string, LiveGame> = { KC: G('1', 'post', 24, 20), DEN: G('1', 'post', 24, 20), DAL: G('2', 'in', 7, 3), PHI: G('2', 'in', 7, 3) };
console.log('v0.0.8 live + week rollover');
t('#3 not final while a starter plays tonight', () => assert.equal(matchupFinal([{ id: 'a', g: games.KC, team: 'KC' }, { id: 'b', g: games.DAL, team: 'DAL' }], games), false));
t('#3 starter whose game is missing is NOT treated as finished', () => assert.equal(matchupFinal([{ id: 'a', g: games.KC, team: 'KC' }, { id: 'b', g: undefined, team: 'SEA' }], games), false));
t('#3 games not loaded yet -> not final', () => assert.equal(matchupFinal([{ id: 'a', g: undefined, team: 'KC' }], null), false));
t('#3 bye week and empty slots count as done', () => assert.equal(matchupFinal([{ id: 'a', g: games.KC, team: 'KC' }, { id: 'b', team: 'SEA', bye: true }, { id: '0' }], games), true));
t('#2/#5 scoring fetched for live games every poll, final games once', () => {
  const last: Record<string, string> = {};
  assert.deepEqual(scoringTargets(games, ['KC', 'DAL', 'PHI', 'DEN'], last), ['1', '2']);
  assert.deepEqual(scoringTargets(games, ['KC', 'DAL', 'PHI', 'DEN'], last), ['2']); // final game not refetched, live one is
  assert.deepEqual(scoringTargets(games, [], last), []);
});
t('#14 current-week stats kept only for finished games', () => {
  const rows = { p1: [20, 18, 16, 1, 3, 90, 'KC'], p2: [3, 3, 3, 1, 40, 50, 'DAL'], KC: [8, 8, 8, 1, 5, null, null] };
  assert.deepEqual(Object.keys(finishedOnly(rows as any, games as any)).sort(), ['KC', 'p1']);
});
const f1 = (n: number) => n.toFixed(1);
t('v0.0.9 big score: Leading by while games are on, Won by only when decided', () => {
  assert.equal(resultLine(123.5, 100.8, false, false, f1), 'Leading by 22.7 (games still to play)');
  assert.equal(resultLine(90, 100.8, false, false, f1), 'Trailing by 10.8 (games still to play)');
  assert.equal(resultLine(123.5, 100.8, false, true, f1), 'Won by 22.7 🎉');
  assert.equal(resultLine(90, 100.8, false, true, f1), 'Lost by 10.8');
  assert.match(resultLine(90, 100, true, false, f1), /^Projected to lose by 10.0/);
  const dec = matchupFinal([{ id: 'a', g: games.KC, team: 'KC' }, { id: 'b', g: games.DAL, team: 'DAL' }], games);
  assert.ok(!resultLine(123.5, 100.8, false, dec, f1).startsWith('Won'));
});
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
