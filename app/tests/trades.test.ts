// JC-110: realistic trade suggestions. Deterministic mock rosters and mock names only.
// Run: npx tsx --require ./tests/rn-shim.cjs tests/trades.test.ts
import assert from 'node:assert/strict';
import { Bundle } from '../src/model';
import { tradeIdeas, tradeValue, fairnessLine, FAIR_MIN, FAIR_MAX, lineupFC } from '../src/trades';

let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };

type Spec = { name: string; pos: string; team: string; fc: number; pts: number; trend?: number; prior?: { ppg: number; label: string }; inj?: string };
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

function teamOf(rid: number, display: string, name: string, roster: Record<string, Spec>): any {
  return { rid, display, name, wins: 4, losses: 4, ties: 0, players: Object.keys(roster), starters: Object.keys(roster).slice(0, 9), reserve: [] };
}

function league(mine: Record<string, Spec>, other: Record<string, Spec>, week = 8, byes: Record<string, number> = {}, extra: Record<string, Spec>[] = []): Bundle {
  const all = Object.assign({}, mine, other, ...extra);
  const players: any = {}, fc: Record<string, number> = {}, vals: Record<string, Spec> = {};
  for (const id of Object.keys(all)) {
    const s = all[id];
    players[id] = { n: s.name, p: s.pos, t: s.team, i: s.inj };
    fc[id] = s.fc;
    vals[id] = s;
  }
  const valuer = { get: (id: string) => {
    const s = vals[id];
    if (!s) return { value: 0, games: 0, trend: 0, mean: 0 };
    return { value: s.pts, games: 8, trend: s.trend || 0, mean: s.pts, prior: s.prior };
  } };
  const me = teamOf(1, 'mockusera', 'River Otters', mine);
  const them = teamOf(2, 'mockuserb', 'Pine Badgers', other);
  const more = extra.map((roster, i) => teamOf(i + 3, `mockuser${i + 3}`, `Summit Wolves ${i + 3}`, roster));
  const teams = [me, them, ...more];
  const byRid = Object.fromEntries(teams.map(tm => [tm.rid, tm]));
  return {
    slots: SLOTS, players, fc, valuer, si: 0, me, teams, byRid,
    isPast: false, week, proj: {}, trending: [], tx: [], sched: { byes, opp: {} },
    league: { settings: {}, roster_positions: [...SLOTS, 'BN', 'BN', 'BN'], total_rosters: teams.length, name: 'Mock League' },
    practice: {}, games: null, allowed: {},
  } as any;
}

// River Otters: deep at RB, thin at WR. Pine Badgers: deep at WR (with a star ace), thin at RB.
const MINE: Record<string, Spec> = {
  qb1: { name: 'Quinn Avery', pos: 'QB', team: 'CHI', fc: 4000, pts: 18 },
  cr:  { name: 'Cole Rivers', pos: 'RB', team: 'CHI', fc: 5000, pts: 16.2 },
  mq:  { name: 'Mara Quinn', pos: 'RB', team: 'DET', fc: 3500, pts: 13.1 },
  rb3: { name: 'Owen Pike', pos: 'RB', team: 'GB', fc: 2000, pts: 8.4 },
  wr1: { name: 'Lila Shaw', pos: 'WR', team: 'CHI', fc: 2800, pts: 10.2 },
  wr2: { name: 'Eden Brooks', pos: 'WR', team: 'MIN', fc: 1800, pts: 7.5 },
  te1: { name: 'Sam Ortiz', pos: 'TE', team: 'CHI', fc: 2000, pts: 8.0 },
  k1:  { name: 'Kicker A', pos: 'K', team: 'CHI', fc: 200, pts: 7 },
  d1:  { name: 'Defense A', pos: 'DEF', team: 'CHI', fc: 200, pts: 7 },
};
const THEM: Record<string, Spec> = {
  qb2: { name: 'Blair James', pos: 'QB', team: 'NE', fc: 4000, pts: 18 },
  rbA: { name: 'Hugo Bell', pos: 'RB', team: 'NE', fc: 2500, pts: 9.1 },
  rbB: { name: 'Chris Vale', pos: 'RB', team: 'NYJ', fc: 1500, pts: 6.2 },
  tv:  { name: 'Theo Voss', pos: 'WR', team: 'NE', fc: 5500, pts: 17.8 },
  np:  { name: 'Nia Park', pos: 'WR', team: 'SEA', fc: 3400, pts: 12.8 },
  wrD: { name: 'Remy Cole', pos: 'WR', team: 'LAR', fc: 2200, pts: 9.0 },
  te2: { name: 'Pat Elms', pos: 'TE', team: 'NE', fc: 2000, pts: 8.0 },
  k2:  { name: 'Kicker B', pos: 'K', team: 'NE', fc: 200, pts: 7 },
  d2:  { name: 'Defense B', pos: 'DEF', team: 'NE', fc: 200, pts: 7 },
};

(async () => {
  console.log('Realistic trade suggestions (JC-110)');
  const b = league(MINE, THEM);
  const { ideas } = tradeIdeas(b, {}, 12);

  await t('suggestions stay inside fairness bounds (no lopsided value)', () => {
    assert.ok(ideas.length > 0, 'expected at least one idea');
    for (const i of ideas) {
      const r = i.giveV / i.getV;
      assert.ok(r >= FAIR_MIN && r <= FAIR_MAX, `${i.give} -> ${i.get} ratio ${r.toFixed(2)}`);
      const slack = Math.max(150, 0.05 * Math.max(i.giveV, i.getV));
      assert.ok(i.net >= -slack && i.theirNet >= -slack, `one-sided lineup ${i.net} vs ${i.theirNet} (slack ${slack})`);
    }
  });

  await t('need-fit: each idea fills a real need on both sides, and does not ask a WR-thin team for a WR', () => {
    for (const i of ideas) {
      const getPos = i.get.map(id => b.players[id].p);
      const givePos = i.give.map(id => b.players[id].p);
      assert.ok(getPos.includes('WR'), `Otters are thin at WR, but idea got ${getPos} (${i.get.map(id => b.players[id].n)})`);
      assert.ok(givePos.includes('RB'), `Badgers are thin at RB, but idea gave ${givePos}`);
    }
  });

  await t('no absurd offers: two mid RBs are not asked for Theo Voss, the other team\'s WR ace', () => {
    for (const i of ideas) {
      assert.ok(!(i.get.includes('tv') && i.give.length >= 2), `bundled ask for Theo Voss: give ${i.give.map(id => b.players[id].n)} get ${i.get.map(id => b.players[id].n)}`);
      const giveMax = Math.max(...i.give.map(id => b.fc![id]));
      const getMax = Math.max(...i.get.map(id => b.fc![id]));
      if (i.give.length > i.get.length) assert.ok(getMax < 5000, '2-for-1 should not target a star ace');
    }
  });

  await t('includes a fair 1-for-1 (Mara Quinn for Nia Park) and prefers even shapes over 2-for-1', () => {
    const even = ideas.find(i => i.give.includes('mq') && i.get.includes('np') && i.give.length === 1 && i.get.length === 1);
    assert.ok(even, 'expected Mara Quinn ⇄ Nia Park. ideas: ' + ideas.map(i => `${i.give}=>${i.get}`).join('; '));
    const twoForOne = ideas.filter(i => i.give.length === 2 && i.get.length === 1);
    const oneForOne = ideas.filter(i => i.give.length === 1 && i.get.length === 1);
    assert.ok(oneForOne.length >= twoForOne.length, `1-for-1 ${oneForOne.length} vs 2-for-1 ${twoForOne.length}`);
  });

  await t('plain-language explanation uses pts/g and a fairness line that says what 50/50 means', () => {
    assert.match(fairnessLine(3500, 3500), /50\/50 is an even ask/);
    assert.ok(ideas.some(i => i.why.some(w => /pts\/g/.test(w)) && /50\/50 is an even ask/.test(i.fairness)));
    const even = ideas.find(i => i.give.includes('mq') && i.get.includes('np'));
    if (even) {
      assert.match(even.why.join(' '), /Mara Quinn.*pts\/g/);
      assert.match(even.why.join(' '), /Nia Park.*pts\/g/);
    }
  });

  await t('an injured player is not asked for, and a 🔒 chip is never offered', () => {
    const hurt = league(MINE, { ...THEM, np: { ...THEM.np, inj: 'Out' } });
    for (const i of tradeIdeas(hurt, {}, 12).ideas) assert.ok(!i.get.includes('np'));
    const locked = tradeIdeas(b, { mq: 'never', cr: 'never', rb3: 'never' }, 12).ideas;
    for (const i of locked) i.give.forEach(g => assert.notEqual(g, 'mq'));
    for (const i of locked) i.give.forEach(g => assert.notEqual(tagsNever(g), true));
    function tagsNever(g: string) { return g === 'mq' || g === 'cr' || g === 'rb3'; }
  });

  await t('prior-season production raises trade value so a slow start is not treated as a scrub', () => {
    const vet: Record<string, Spec> = { ...MINE, wr1: { ...MINE.wr1, fc: 2800, pts: 14.8, prior: { ppg: 16.4, label: 'last season' } } };
    const flash: Record<string, Spec> = { ...THEM, np: { ...THEM.np, fc: 2800, pts: 9.0 } };
    const b2 = league(vet, flash);
    const vVet = tradeValue(b2, 'wr1'), vFlash = tradeValue(b2, 'np');
    assert.ok(vVet > vFlash, `veteran ${vVet.toFixed(0)} should outrank same-market flash ${vFlash.toFixed(0)}`);
    assert.equal(lineupFC(b, ['cr', 'mq'], id => b.fc![id] || 0) > 0, true);
  });

  // 2-for-2 WR swap used to check only get.find (the first incoming WR). A later WR on bye
  // can still drop startable WR count below what's needed. Summit Wolves exist only to
  // lift the league WR average so both sides can have a WR need while the Badgers still
  // have WR depth. Other Otters players are 🔒 so this pair is the only giveable idea.
  const HOLE_MINE: Record<string, Spec> = {
    qb1: { name: 'Quinn Avery', pos: 'QB', team: 'CHI', fc: 4000, pts: 18 },
    cr:  { name: 'Cole Rivers', pos: 'RB', team: 'CHI', fc: 5000, pts: 16.2 },
    mq:  { name: 'Mara Quinn', pos: 'RB', team: 'DET', fc: 3500, pts: 13.1 },
    rb3: { name: 'Owen Pike', pos: 'RB', team: 'GB', fc: 2000, pts: 8.4 },
    wr1: { name: 'Lila Shaw', pos: 'WR', team: 'CHI', fc: 4000, pts: 14.0 },
    wr2: { name: 'Eden Brooks', pos: 'WR', team: 'MIN', fc: 1500, pts: 6.5 },
    te1: { name: 'Sam Ortiz', pos: 'TE', team: 'CHI', fc: 2000, pts: 8.0 },
    k1:  { name: 'Kicker A', pos: 'K', team: 'CHI', fc: 200, pts: 7 },
    d1:  { name: 'Defense A', pos: 'DEF', team: 'CHI', fc: 200, pts: 7 },
  };
  const HOLE_THEM: Record<string, Spec> = {
    qb2: { name: 'Blair James', pos: 'QB', team: 'NE', fc: 4000, pts: 18 },
    rbA: { name: 'Hugo Bell', pos: 'RB', team: 'NE', fc: 2500, pts: 9.1 },
    rbB: { name: 'Chris Vale', pos: 'RB', team: 'NYJ', fc: 1500, pts: 6.2 },
    tv:  { name: 'Theo Voss', pos: 'WR', team: 'NE', fc: 8000, pts: 20.0 },
    np:  { name: 'Nia Park', pos: 'WR', team: 'SEA', fc: 2800, pts: 11.0 },
    wrD: { name: 'Remy Cole', pos: 'WR', team: 'LAR', fc: 2700, pts: 10.5 },
    te2: { name: 'Pat Elms', pos: 'TE', team: 'NE', fc: 2000, pts: 8.0 },
    k2:  { name: 'Kicker B', pos: 'K', team: 'NE', fc: 200, pts: 7 },
    d2:  { name: 'Defense B', pos: 'DEF', team: 'NE', fc: 200, pts: 7 },
  };
  const HOLE_T3: Record<string, Spec> = {
    t3qb: { name: 'T3 QB', pos: 'QB', team: 'KC', fc: 4000, pts: 18 },
    t3rb1: { name: 'T3 RB1', pos: 'RB', team: 'KC', fc: 4000, pts: 14 },
    t3rb2: { name: 'T3 RB2', pos: 'RB', team: 'KC', fc: 3500, pts: 12 },
    t3wr1: { name: 'T3 WR1', pos: 'WR', team: 'KC', fc: 9000, pts: 22 },
    t3wr2: { name: 'T3 WR2', pos: 'WR', team: 'KC', fc: 9000, pts: 22 },
    t3te: { name: 'T3 TE', pos: 'TE', team: 'KC', fc: 2000, pts: 8 },
    t3k: { name: 'T3 K', pos: 'K', team: 'KC', fc: 200, pts: 7 },
    t3d: { name: 'T3 DEF', pos: 'DEF', team: 'KC', fc: 200, pts: 7 },
  };
  const onlyWrs: Record<string, 'never'> = { qb1: 'never', cr: 'never', mq: 'never', rb3: 'never', te1: 'never' };
  const twoForTwo = (ideas: { give: string[]; get: string[] }[]) =>
    ideas.find(i => i.give.length === 2 && i.get.length === 2 && i.give.includes('wr1') && i.give.includes('wr2') && i.get.includes('np') && i.get.includes('wrD'));

  await t('a bye that opens a startable-position hole omits the idea (2-for-2, later incoming player)', () => {
    const open = league(HOLE_MINE, HOLE_THEM, 8, {}, [HOLE_T3]);
    assert.ok(twoForTwo(tradeIdeas(open, onlyWrs, 12).ideas), 'baseline without a bye should still offer Lila + Eden for Nia + Remy');
    const hole = league(HOLE_MINE, HOLE_THEM, 8, { LAR: 8 }, [HOLE_T3]);
    assert.equal(twoForTwo(tradeIdeas(hole, onlyWrs, 12).ideas), undefined);
  });

  await t('a bye that does not open a hole is still allowed and noted', () => {
    const b2 = league(MINE, THEM, 8, { SEA: 8 });
    const even = tradeIdeas(b2, {}, 12).ideas.find(i => i.give.includes('mq') && i.get.includes('np') && i.give.length === 1 && i.get.length === 1);
    assert.ok(even, 'Mara Quinn ⇄ Nia Park should still be suggested when Nia is on bye but no WR hole opens');
    assert.match(even!.note || '', /Nia Park is on bye this week/);
  });

  await t('selecting a roster player returns only realistic ideas that include them', () => {
    const { ideas: focused } = tradeIdeas(b, {}, 12, { involve: 'mq' });
    assert.ok(focused.length > 0, 'expected ideas involving Mara Quinn');
    for (const i of focused) {
      assert.ok(i.give.includes('mq') || i.get.includes('mq'), i.give + '=>' + i.get);
      const r = i.giveV / i.getV;
      assert.ok(r >= FAIR_MIN && r <= FAIR_MAX, `ratio ${r}`);
    }
    assert.ok(focused.some(i => i.give.includes('mq') && i.get.includes('np') && i.give.length === 1 && i.get.length === 1));
  });

  await t('selecting a player on another team returns only realistic ideas that get them', () => {
    const { ideas: focused } = tradeIdeas(b, {}, 12, { involve: 'np' });
    assert.ok(focused.length > 0, 'expected ideas involving Nia Park');
    for (const i of focused) assert.ok(i.get.includes('np') || i.give.includes('np'));
    assert.ok(focused.every(i => i.get.includes('np')));
  });

  await t('no realistic deal for a selected player yields an empty list', () => {
    assert.equal(tradeIdeas(b, {}, 12, { involve: 'd1' }).ideas.length, 0); // defense is not in the skill-position idea pool
    const hurt = league(MINE, { ...THEM, np: { ...THEM.np, inj: 'Out' } });
    assert.equal(tradeIdeas(hurt, {}, 12, { involve: 'np' }).ideas.length, 0);
    const locked = tradeIdeas(b, { mq: 'never' }, 12, { involve: 'mq' }).ideas;
    assert.equal(locked.length, 0);
  });

  await t('player-specific ideas still exclude unrealistic, Out, and bye-hole deals', () => {
    const { ideas: forAce } = tradeIdeas(b, {}, 12, { involve: 'tv' });
    for (const i of forAce) {
      assert.ok(!(i.get.includes('tv') && i.give.length >= 2), 'bundled ask for Theo Voss');
      const r = i.giveV / i.getV;
      assert.ok(r >= FAIR_MIN && r <= FAIR_MAX);
    }
    const hole = league(HOLE_MINE, HOLE_THEM, 8, { LAR: 8 }, [HOLE_T3]);
    const onlyWrsLocal: Record<string, 'never'> = { qb1: 'never', cr: 'never', mq: 'never', rb3: 'never', te1: 'never' };
    const focused = tradeIdeas(hole, onlyWrsLocal, 12, { involve: 'wrD' }).ideas;
    assert.equal(twoForTwo(focused), undefined);
    assert.ok(!focused.some(i => i.get.includes('wrD') && i.get.includes('np') && i.give.includes('wr1') && i.give.includes('wr2')));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
