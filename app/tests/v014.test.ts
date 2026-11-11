// v0.0.14 hotfix: picks saved on a phone before kickoff but shared only after kickoff (for example, before the
// leaderboard password was entered) used to vanish from the board and the record. They now count as ✱ backfilled.
// Mock names/IDs only. Run: npx tsx --require ./tests/rn-shim.cjs tests/v014.test.ts
import assert from 'node:assert/strict';
import fs from 'fs';
import { resolve, Snap } from '../src/picks/sync';
import { serverPicks } from '../src/picks/restore';
import { Game, PickMap, seasonRecord, weekRecord } from '../src/picks/core';
import { VERSION_CODE, VERSION_NAME } from '../src/version';
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const byWeek: Record<number, Game[]> = JSON.parse(fs.readFileSync(__dirname + '/fixtures/games-2026-w1-7.json', 'utf8'));
const games: Record<string, Game> = {}; Object.values(byWeek).flat().forEach(g => (games[g.id] = g));
const W = 6, wk = byWeek[W];
const lastKick = Math.max(...wk.map(g => g.kickoff));
const A = { uid: '1000000000000000201', un: 'mockfriendb' }, B = { uid: '1000000000000000202', un: 'mockfriendc' };
const snap = (who: typeof A, o: Partial<Snap>): Snap => ({ id: 'r' + Math.random(), uid: who.uid, un: who.un, season: 2026, week: W, picks: {}, bf: {}, ts: 0, createdAt: 0, ...o });
const allHome = Object.fromEntries(wk.map(g => [g.id, g.home.abbr]));
const onlyLive = (p: PickMap) => Object.fromEntries(Object.entries(p).filter(([, x]) => x.src === 'live'));
(async () => {
  console.log('v0.0.14 late-shared picks');
  // the real-world shape: one snapshot with the whole week, no backfill flags, created a day after the last kickoff
  const late = snap(A, { picks: allHome, ts: lastKick - 3600e3, createdAt: lastKick + 86400e3 });
  await t('a whole week shared after every kickoff shows up as backfilled picks', () => {
    const p = resolve([late], games)[0];
    assert.equal(Object.keys(p.picks).length, wk.length);
    assert.ok(Object.values(p.picks).every(x => x.src === 'backfill' && x.week === W));
    assert.equal(p.late, 0);
  });
  await t('it gets a week record with "Include backfilled" on, and none with it off', () => {
    const p = resolve([late], games)[0];
    const on = weekRecord(wk, p.picks), off = weekRecord(wk, onlyLive(p.picks));
    assert.ok(on.w + on.l > 0); assert.equal(on.backfilled, wk.length);
    assert.equal(off.w + off.l, 0);
    assert.equal(seasonRecord(byWeek, p.picks, [1, 2, 3, 4, 5, 6, 7]).total.backfilled, wk.length);
  });
  await t('the phone-side time (ts) is not trusted: late picks never count as on time', () => {
    const p = resolve([snap(A, { picks: allHome, ts: 1, createdAt: lastKick + 1 })], games)[0];
    assert.ok(Object.values(p.picks).every(x => x.src === 'backfill'));
  });
  await t('on-time picks still win; a different team after kickoff is still only "late"', () => {
    const g = wk[0];
    const p = resolve([
      snap(B, { picks: { [g.id]: g.home.abbr }, createdAt: g.kickoff - 60e3 }),
      snap(B, { picks: { [g.id]: g.away.abbr }, createdAt: g.kickoff + 60e3 }),
    ], games)[0];
    assert.equal(p.picks[g.id].team, g.home.abbr); assert.equal(p.picks[g.id].src, 'live'); assert.equal(p.late, 1);
  });
  await t('other people are unaffected by one late sharer', () => {
    const g = wk[0];
    const ps = resolve([late, snap(B, { picks: { [g.id]: g.away.abbr }, createdAt: g.kickoff - 10 })], games);
    const b = ps.find(x => x.uid === B.uid)!;
    assert.deepEqual(Object.keys(b.picks), [g.id]); assert.equal(b.picks[g.id].src, 'live');
  });
  await t('restore after a reinstall brings late-shared picks back as backfilled', () => {
    const r = serverPicks([late], { uid: A.uid, username: A.un }, games);
    assert.equal(Object.keys(r).length, wk.length); assert.ok(Object.values(r).every(x => x.src === 'backfill'));
  });
  await t('version is 0.0.14 (14)', () => { assert.equal(VERSION_CODE, 14); assert.equal(VERSION_NAME, '0.0.14'); });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
