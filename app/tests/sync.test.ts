// Run: npx tsx tests/sync.test.ts  (mocked store and network only)
import assert from 'node:assert/strict';
import fs from 'fs';
import { setKv, resolve, snapshotFor, enqueue, flush, pendingCount, fetchSnaps, Snap, setFamilyKey, hasFamilyKey, probeFamilyKey } from '../src/picks/sync';
import { deriveFamilyKey } from '../src/picks/family';
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
  await t('no family password: nothing is sent and the board stays locked', async () => {
    setFamilyKey(null); assert.equal(hasFamilyKey(), false);
    await enqueue(snapshotFor({ uid: '1000000000000000008', un: 'nokey' }, 2026, 7, { '401873010': { team: 'CHI', week: 7, at: 1, src: 'live' } }));
    let called = 0;
    const r = await flush((async () => { called++; return new Response('{}', { status: 201 }); }) as any);
    assert.equal(called, 0); assert.equal(r.sent, 0);
    await assert.rejects(fetchSnaps(2026, true, (async () => { called++; return new Response('{}'); }) as any), /locked/);
    assert.equal(called, 0);
    for (const k of Object.keys(mem)) delete mem[k];
  });
  setFamilyKey(deriveFamilyKey('mock-family-password'));
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
  await t('writes and reads go only to the derived collections; archive keeps original times', async () => {
    const k = deriveFamilyKey('mock-family-password');
    const urls: string[] = [];
    const rec = (createdAt: string, extra: any = {}) => ({ id: 'x' + Math.random(), createdAt, data: { app: 'gg', uid: '1000000000000000009', un: 'friend2', season: 2026, week: 6, picks: { [g6.id]: g6.home.abbr }, bf: {}, ts: 1, ...extra } });
    const before = new Date(g6.kickoff - 3600e3).toISOString(), after = new Date(g6.kickoff + 86400e3).toISOString();
    const f = (async (u: string) => {
      urls.push(u);
      if (u.includes('/' + k.archive + '?')) return new Response(JSON.stringify({ records: [rec(after, { oc: g6.kickoff - 7200e3 })] }));
      return new Response(JSON.stringify({ records: [rec(after, { oc: g6.kickoff - 7200e3 })] }));
    }) as any;
    const r = await fetchSnaps(2026, true, f);
    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes('/.herenow/data/' + k.live + '?')); assert.ok(urls[1].includes('/.herenow/data/' + k.archive + '?'));
    const [live, arch] = r.snaps;
    assert.equal(live.createdAt, Date.parse(after), 'oc is ignored in the public collection');
    assert.equal(arch.createdAt, g6.kickoff - 7200e3, 'oc is trusted in the owner-only archive');
    // a missing archive (404) is fine
    const r2 = await fetchSnaps(2026, true, (async (u: string) => (u.includes(k.archive) ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ records: [rec(before)] })))) as any);
    assert.equal(r2.snaps.length, 1);
  });
  await t('password check: 200 = ok, 404 (collection not active) = wrong, network error = offline', async () => {
    const k = deriveFamilyKey('mock-family-password');
    assert.equal(await probeFamilyKey(k, (async () => new Response('{"records":[]}')) as any), 'ok');
    assert.equal(await probeFamilyKey(k, (async () => new Response('{"code":"collection_disabled"}', { status: 404 })) as any), 'wrong');
    assert.equal(await probeFamilyKey(k, (async () => { throw new Error('net'); }) as any), 'offline');
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
