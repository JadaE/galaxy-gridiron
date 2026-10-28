// Run: npx tsx --require ./tests/rn-shim.cjs tests/v010.test.ts  (v0.0.10: 1-QB trade/drop values, live player line, leaderboard order)
import assert from 'node:assert/strict';
import { Bundle, benchWorth, flexable } from '../src/model';
import { bestDrop, pickups } from '../src/pickups';
import { tradeIdeas, lineupFC } from '../src/trades';
import { fantasyCalcUrl } from '../src/api';
import { breakdown, showLive } from '../src/liveline';
import fs from 'node:fs';
const LIVE = JSON.parse(fs.readFileSync(__dirname + '/fixtures/live-player-week.json', 'utf8'));
const src = (f: string) => fs.readFileSync(__dirname + '/../src/' + f, 'utf8');
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message, process.env.STACK ? e.stack : ''); } };

// 1 QB, 1 DEF, QB/DEF not flex-eligible (like a standard 1-QB league)
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
// id -> [pos, points/week]
function league(slots: string[], mine: Record<string, [string, number]>, fa: Record<string, [string, number]> = {}, others: Record<string, [string, number]> = {}, fc: Record<string, number> = {}): Bundle {
  const players: any = {}, proj: any = {}, vals: any = {};
  const add = (r: Record<string, [string, number]>) => { for (const id in r) { const [p, v] = r[id]; players[id] = { n: 'Player ' + id, p, t: 'TM' + id }; proj[id] = [v, v, v, 1]; vals[id] = v; } };
  add(mine); add(fa); add(others);
  for (let k = 0; k < 60; k++) proj['x' + k] = [0, 0, 0, 0];
  const me: any = { rid: 1, players: Object.keys(mine), starters: [], reserve: [], display: 'Team A' };
  const them: any = { rid: 2, players: Object.keys(others), starters: [], reserve: [], display: 'Team B' };
  const valuer = { get: (id: string) => ({ value: vals[id] || 0, games: vals[id] ? 6 : 0, floor: (vals[id] || 0) * 0.7, median: vals[id] || 0 }) };
  const bench = Object.keys(mine).length - slots.length;
  return { slots, players, proj, si: 0, me, teams: [me, them], byRid: { 1: me, 2: them }, isPast: false, week: 8, trending: [], tx: [], sched: null, valuer,
    league: { settings: {}, roster_positions: [...slots, ...Array(bench).fill('BN')], total_rosters: 2 }, fc, practice: {}, games: null, allowed: {} } as any;
}
const MINE: Record<string, [string, number]> = { q1: ['QB', 21], r1: ['RB', 16], r2: ['RB', 13], w1: ['WR', 17], w2: ['WR', 15], t1: ['TE', 9], w3: ['WR', 14], k1: ['K', 8], d1: ['DEF', 8],
  w4: ['WR', 12.5], q2: ['QB', 13], r3: ['RB', 6] };

(async () => {
  console.log('v0.0.10 #1 backup QB is not over-valued');
  await t('QB, K and DEF cannot flex in a 1-QB league; QB can with SUPER_FLEX', () => {
    assert.equal(flexable(SLOTS, 'QB'), false); assert.equal(flexable(SLOTS, 'DEF'), false); assert.equal(flexable(SLOTS, 'WR'), true);
    assert.ok(benchWorth({ slots: SLOTS }, 'QB') < 0.5);
    assert.equal(benchWorth({ slots: ['QB', 'SUPER_FLEX', 'WR'] }, 'QB'), 1);
  });
  await t('FantasyCalc asks for 1-QB values (not superflex) by default', () => {
    assert.match(fantasyCalcUrl(10, 1), /numQbs=1&/); assert.match(fantasyCalcUrl(10, 1, 2), /numQbs=2&/);
  });
  await t('drop pick: a 12-pt bench WR is kept over a 13-pt backup QB', () => {
    const mine = { ...MINE }; delete mine.r3; // bench = w4 (12.5) and q2 (13)
    const d = bestDrop(league(SLOTS, mine), null);
    assert.equal(d.id, 'q2', JSON.stringify(d));
    assert.equal(bestDrop(league(['QB', 'SUPER_FLEX', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'], { ...mine, q3: ['QB', 12] }), null).id !== 'q1', true);
  });
  await t('adding a free-agent QB never costs a ~20-pt WR', () => {
    const mine = { ...MINE }; delete mine.q2; mine.w5 = ['WR', 19.5];
    const b = league(SLOTS, mine, { fq: ['QB', 14], fw: ['WR', 11] });
    const list = pickups(b, 10);
    for (const f of list) assert.notEqual(f.drop.id, 'w5', `${f.id} -> drop ${f.drop.id}`);
    const q = list.find(f => f.id === 'fq');
    if (q) assert.ok(q.drop.id !== 'w5' && q.drop.id !== 'w4');
    assert.notEqual(bestDrop(b, 'fq').id, 'w5');
  });
  await t('trade ideas never give a FLEX-starting WR for a QB who would sit', () => {
    const fc = { q1: 7000, q2: 1500, r1: 5000, r2: 4000, w1: 5200, w2: 4500, w3: 4200, w4: 3000, t1: 2500, r3: 800, oq: 4300, oq2: 4100, ow: 3000, or: 2500, ot: 2000 };
    const b = league(SLOTS, MINE, {}, { oq: ['QB', 15], oq2: ['QB', 14], ow: ['WR', 11], or: ['RB', 9], ot: ['TE', 8] }, fc);
    const { ideas } = tradeIdeas(b, {}, 20);
    for (const i of ideas) assert.ok(!(i.get.includes('oq') || i.get.includes('oq2')) || !i.give.some(g => ['w1', 'w2', 'w3'].includes(g)), `${i.give} -> ${i.get}`);
  });
  await t('trade lineup counts the FLEX starter at full value and a backup QB as bye cover', () => {
    const b = league(SLOTS, MINE);
    const v = (id: string) => ({ q1: 7000, q2: 4000, w1: 5000, w2: 4500, w3: 4200 } as any)[id] || 0;
    const all = lineupFC(b, ['q1', 'q2', 'w1', 'w2', 'w3'], v);
    assert.equal(all - lineupFC(b, ['q1', 'q2', 'w1', 'w2'], v), 4200, 'losing the FLEX WR costs his full value');
    assert.ok(all - lineupFC(b, ['q1', 'w1', 'w2', 'w3'], v) <= 400, 'losing the backup QB costs little');
  });
  console.log('v0.0.10 #2 live stats on the player card');
  await t('QB live line: stat text + points per category in league scoring, total matches', () => {
    const L = breakdown(LIVE.qb_live, LIVE.scoring);
    assert.equal(L.pts, 6.6 + 4 - 1 + 1.4);
    const pass_ = L.rows.find(r => r.label === 'Passing')!, rush = L.rows.find(r => r.label === 'Rushing')!;
    assert.equal(pass_.text, '19/33, 165 yds, 1 TD, 1 INT'); assert.equal(pass_.pts, 9.6);
    assert.equal(rush.text, '2 car, 14 yds'); assert.equal(rush.pts, 1.4);
    assert.ok(!L.rows.some(r => r.label === 'Fumbles / 2-pt'), 'a fumble he recovered (0 lost) shows nothing');
  });
  await t('WR live line: receptions, negative rush and a lost fumble', () => {
    const L = breakdown(LIVE.wr_live, LIVE.scoring);
    assert.equal(L.rows.find(r => r.label === 'Receiving')!.text, '6 rec on 9 targets, 88 yds, 1 TD');
    assert.equal(L.rows.find(r => r.label === 'Receiving')!.pts, 20.8);
    assert.equal(L.rows.find(r => r.label === 'Fumbles / 2-pt')!.pts, -2);
    assert.equal(L.pts, Math.round((20.8 - 0.3 - 2) * 100) / 100);
    assert.equal(Math.round(L.rows.reduce((a, r) => a + r.pts, 0) * 100) / 100, L.pts, 'rows add up to the total');
  });
  await t('DEF live line uses the points-allowed bucket', () => {
    const L = breakdown(LIVE.def_live, LIVE.scoring);
    assert.equal(L.pts, 3 + 2 + 2 + 4);
    assert.match(L.rows.find(r => r.label === 'Defense')!.text, /3 sacks, 1 INT, 1 fum rec, 10 pts allowed/);
  });
  await t('live card only once his game has kicked off (live or final), never before', () => {
    assert.equal(showLive('pre'), false); assert.equal(showLive(undefined), false); assert.equal(showLive('in'), true); assert.equal(showLive('post'), true);
  });
  await t('no stats yet -> zero points, no rows', () => assert.deepEqual(breakdown({}, LIVE.scoring), { pts: 0, rows: [] }));
  console.log('v0.0.10 #3/#4/#6 UI cleanups');
  await t('#3 player card has no creator-takes or watch-videos buttons', () => {
    const s = src('screens/PlayerSheet.tsx'); assert.ok(!/Creator takes|Watch \{name\} videos|ytSearch/.test(s));
  });
  await t('#4 only one weekly-score chart (Team tab); League no longer repeats it', () => {
    assert.ok(!/You vs the league average/.test(src('screens/League.tsx'))); assert.match(src('screens/Home.tsx'), /Weekly scores/);
  });
  await t('#5 your pick is banana yellow, a correct pick stays green', () => {
    const s = src('screens/Picks.tsx'); assert.match(s, /mine \? C\.banana/); assert.match(src('theme.ts'), /banana: '#FFE135'/);
  });
  await t('#6 leaderboard grid: newest week first, titles, How it works moved to (i)', () => {
    const s = src('screens/Picks.tsx');
    assert.match(s, /weeks=\{\[\.\.\.played\]\.reverse\(\)\}/); assert.match(s, /title="Picks by week"/); assert.match(s, /title="Running win % by week"/);
    assert.ok(!/title="How it works"/.test(s)); assert.match(s, /InfoButton k="picksboard"/); assert.match(src('screens/Info.tsx'), /picksboard: \{ title: 'How the leaderboard works'/);
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
