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
  // JC-17: one-time owner correction (tools/leaderboard.py fix-late-week) = an owner-only ARCHIVE record whose `oc`
  // is 1 minute before the earliest corrected kickoff, holding the week's picks minus games the owner ruled late.
  const firstKick = Math.min(...wk.map(g => g.kickoff));
  const lateG = wk.reduce((a, g) => (g.kickoff < a.kickoff ? g : a)); // the earliest game stays late in this mock
  const restKick = Math.min(...wk.filter(g => g.id !== lateG.id).map(g => g.kickoff));
  const fixPicks = Object.fromEntries(Object.entries(allHome).filter(([id]) => id !== lateG.id));
  const fix = snap(A, { id: 'fix', picks: fixPicks, createdAt: restKick - 60e3 });
  await t('JC-17: owner archive fix counts those picks on time, no ✱, no double count with the late live copy', () => {
    const p = resolve([late, fix], games)[0];
    assert.equal(Object.keys(p.picks).length, wk.length);
    for (const g of wk) assert.equal(p.picks[g.id].src, g.id === lateG.id ? 'backfill' : 'live', g.id);
    assert.equal(p.late, 0);
    const r = weekRecord(wk, p.picks), on = weekRecord(wk, onlyLive(p.picks));
    assert.equal(r.backfilled, 1); assert.equal(on.w + on.l + on.pending + on.nr, wk.length - 1);
  });
  await t('JC-17: a game the owner ruled late stays ✱ backfilled; other people and other weeks are unchanged', () => {
    const g = wk[0];
    const other = snap(B, { picks: { [g.id]: g.away.abbr }, createdAt: g.kickoff - 10 });
    const w5 = snap(A, { week: 5, picks: { [byWeek[5][0].id]: byWeek[5][0].home.abbr }, createdAt: byWeek[5][0].kickoff - 10 });
    const before = resolve([late, other, w5], games), after = resolve([late, other, w5, fix], games);
    assert.deepEqual(after.find(x => x.uid === B.uid), before.find(x => x.uid === B.uid));
    const a = after.find(x => x.uid === A.uid)!;
    assert.equal(a.picks[lateG.id].src, 'backfill');
    assert.deepEqual(a.picks[byWeek[5][0].id], before.find(x => x.uid === A.uid)!.picks[byWeek[5][0].id]);
  });
  // JC-34: the `oc`-only-from-archive rule now lives in the Worker (worker/test/jc34.test.ts, cleanRecord)
  await t('version is 0.0.14 or later', () => { assert.ok(VERSION_CODE >= 14); assert.ok(VERSION_NAME >= '0.0.14'); });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
