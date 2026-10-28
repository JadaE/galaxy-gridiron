// Run: npx tsx tests/sync.test.ts  (mocked store; plus one live read of the real collection)
import assert from 'node:assert/strict';
import fs from 'fs';
import { setKv, resolve, snapshotFor, enqueue, flush, pendingCount, fetchSnaps, Snap } from '../src/picks/sync';
import { SITE_ORIGIN as SITE } from '../src/config';
import { Game, weekRecord } from '../src/picks/core';
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const byWeek: Record<number, Game[]> = JSON.parse(fs.readFileSync(__dirname + '/fixtures/games-2026-w1-7.json', 'utf8'));
const games: Record<string, Game> = {}; Object.values(byWeek).flat().forEach(g => (games[g.id] = g));
const g6 = byWeek[6][0], g6b = byWeek[6][5];
const snap = (o: Partial<Snap>): Snap => ({ id: 'r' + Math.random(), uid: '1', un: 'friend1', season: 2026, week: 6, picks: {}, bf: {}, ts: 0, createdAt: 0, ...o });
const mem: Record<string, string> = {};
setKv(async k => mem[k] ?? null, async (k, v) => { mem[k] = v; });
(async () => {
  console.log('Leaderboard resolve');
  await t('last snapshot before kickoff wins; later change is ignored and counted late', () => {
    const p = resolve([
      snap({ picks: { [g6.id]: g6.home.abbr }, createdAt: g6.kickoff - 3600e3 }),
      snap({ picks: { [g6.id]: g6.away.abbr }, createdAt: g6.kickoff - 60e3 }),
      snap({ picks: { [g6.id]: g6.home.abbr }, createdAt: g6.kickoff + 60e3 }),
    ], games)[0];
    assert.equal(p.picks[g6.id].team, g6.away.abbr); assert.equal(p.late, 1);
  });
  await t('a pick that only arrives after kickoff does not count', () => {
    const p = resolve([snap({ picks: { [g6.id]: g6.home.abbr }, createdAt: g6.kickoff + 1 })], games)[0];
    assert.equal(p.picks[g6.id], undefined); assert.equal(p.late, 1);
  });
  await t('backfilled entries are kept but tagged, and never override an on-time pick', () => {
    const p = resolve([
      snap({ picks: { [g6.id]: g6.home.abbr }, createdAt: g6.kickoff - 10 }),
      snap({ picks: { [g6.id]: g6.away.abbr, [g6b.id]: g6b.home.abbr }, bf: { [g6.id]: 1, [g6b.id]: 1 }, createdAt: g6.kickoff + 9 * 86400e3 }),
    ], games)[0];
    assert.equal(p.picks[g6.id].src, 'live'); assert.equal(p.picks[g6.id].team, g6.home.abbr); assert.equal(p.picks[g6b.id].src, 'backfill');
    assert.equal(weekRecord(byWeek[6], p.picks).backfilled, 1);
  });
  await t('clearing a pick before kickoff removes it', () => {
    const p = resolve([snap({ picks: { [g6.id]: g6.home.abbr }, createdAt: g6.kickoff - 100 }), snap({ picks: {}, createdAt: g6.kickoff - 50 })], games)[0];
    assert.equal(p.picks[g6.id], undefined);
  });
  await t('a team that is not in the game is ignored', () => { assert.deepEqual(resolve([snap({ picks: { [g6.id]: 'ZZZ' }, createdAt: 0 })], games)[0].picks, {}); });
  await t('latest username/avatar wins per user id', () => { const p = resolve([snap({ un: 'old', createdAt: 1 }), snap({ un: 'friend1', av: 'abc', createdAt: 2 })], games)[0]; assert.equal(p.un, 'friend1'); assert.equal(p.av, 'abc'); });

  console.log('Offline queue');
  await t('one queued snapshot per user+week; offline keeps it; next flush sends it with Origin + Idempotency-Key', async () => {
    const me = { uid: '1000000000000000007', un: 'testuser' };
    await enqueue(snapshotFor(me, 2026, 7, { '401873010': { team: 'CHI', week: 7, at: 1, src: 'live' } }));
    await enqueue(snapshotFor(me, 2026, 7, { '401873010': { team: 'NE', week: 7, at: 2, src: 'live' } }));
    assert.equal(await pendingCount(), 1);
    const off = await flush((async () => { throw new Error('net'); }) as any);
    assert.equal(off.error, 'offline'); assert.equal(await pendingCount(), 1);
    const rl = await flush((async () => new Response('{}', { status: 429 })) as any);
    assert.ok(/rate/.test(rl.error!)); assert.equal(await pendingCount(), 1);
    let seen: any;
    const ok = await flush((async (_u: string, init: any) => { seen = init; return new Response('{"record":{}}', { status: 201 }); }) as any);
    assert.equal(ok.sent, 1); assert.equal(await pendingCount(), 0);
    assert.equal(seen.headers.Origin, SITE); assert.ok(seen.headers['Idempotency-Key']);
    assert.equal(JSON.parse(seen.body).picks['401873010'], 'NE');
  });
  await t('live read of the real collection (self-test rows are filtered out)', async () => {
    if (/YOUR-SITE-SLUG/.test(SITE)) { console.log('      skipped (placeholder config)'); return; }
    const r = await fetchSnaps(2026, true);
    assert.ok(Array.isArray(r.snaps)); assert.ok(r.snaps.every(s => !s.un.startsWith('_')));
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
