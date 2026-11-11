// Run: npx tsx tests/sync.test.ts  (mocked store and network only)
import assert from 'node:assert/strict';
import fs from 'fs';
import { setKv, resolve, snapshotFor, enqueue, flush, pendingCount, fetchSnaps, Snap, setLbToken, hasLbToken, unlockLeaderboard, setLbApi } from '../src/picks/sync';
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
  await t('a pick that only arrives after kickoff counts as backfilled, not on time (v0.0.14)', () => {
    const p = resolve([snap({ picks: { [g6.id]: g6.home.abbr }, createdAt: g6.kickoff + 1 })], games)[0];
    assert.equal(p.picks[g6.id].src, 'backfill'); assert.equal(p.late, 0);
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

  console.log('Offline queue (JC-34: through the Worker, token only)');
  const API = 'https://mock-worker.example.workers.dev', TOK = 'lb_' + 'A'.repeat(43);
  setLbApi(API);
  await t('no leaderboard token: nothing is sent and the board stays locked', async () => {
    setLbToken(null); assert.equal(hasLbToken(), false);
    await enqueue(snapshotFor({ uid: '1000000000000000008', un: 'nokey' }, 2026, 7, { '401873010': { team: 'CHI', week: 7, at: 1, src: 'live' } }));
    let called = 0;
    const r = await flush((async () => { called++; return new Response('{}', { status: 201 }); }) as any);
    assert.equal(called, 0); assert.equal(r.sent, 0);
    await assert.rejects(fetchSnaps(2026, true, (async () => { called++; return new Response('{}'); }) as any), /locked/);
    assert.equal(called, 0);
    for (const k of Object.keys(mem)) delete mem[k];
  });
  setLbToken(TOK);
  await t('one queued snapshot per user+week; offline keeps it; next flush joins once, then sends with Bearer + Idempotency-Key', async () => {
    const me = { uid: '1000000000000000007', un: 'testuser' };
    await enqueue(snapshotFor(me, 2026, 7, { '401873010': { team: 'CHI', week: 7, at: 1, src: 'live' } }));
    await enqueue(snapshotFor(me, 2026, 7, { '401873010': { team: 'NE', week: 7, at: 2, src: 'live' } }));
    assert.equal(await pendingCount(), 1);
    const off = await flush((async () => { throw new Error('net'); }) as any);
    assert.equal(off.error, 'offline'); assert.equal(await pendingCount(), 1);
    const rl = await flush((async (u: string) => new Response('{}', { status: u.endsWith('/lb/join') ? 200 : 429 })) as any);
    assert.ok(/rate/.test(rl.error!)); assert.equal(await pendingCount(), 1);
    const seen: { u: string; init: any }[] = [];
    const ok = await flush((async (u: string, init: any) => { seen.push({ u, init }); return new Response('{"ok":true}', { status: u.endsWith('/lb/join') ? 200 : 201 }); }) as any);
    assert.equal(ok.sent, 1); assert.equal(await pendingCount(), 0);
    const snapCall = seen.find(x => x.u === API + '/lb/snap')!;
    assert.equal(snapCall.init.headers.Authorization, 'Bearer ' + TOK); assert.ok(snapCall.init.headers['Idempotency-Key']);
    assert.equal(JSON.parse(snapCall.init.body).picks['401873010'], 'NE');
    assert.ok(seen.every(x => x.u.startsWith(API + '/lb/')), 'never talks to Site Data directly');
  });
  await t('reads come only from the Worker (GET /lb/snaps); records are re-checked', async () => {
    const urls: string[] = [];
    const rec = (o: any = {}) => ({ id: 'x' + Math.random(), uid: '1000000000000000009', un: 'friend2', season: 2026, week: 6, picks: { [g6.id]: g6.home.abbr, bad: 'zz' }, bf: {}, ts: 1, createdAt: g6.kickoff - 3600e3, ...o });
    const r = await fetchSnaps(2026, true, (async (u: string, init: any) => { urls.push(u); assert.equal(init.headers.Authorization, 'Bearer ' + TOK); return new Response(JSON.stringify({ records: [rec(), rec({ un: '_x' }), rec({ season: 2025 })] })); }) as any);
    assert.deepEqual(urls, [API + '/lb/snaps?season=2026']);
    assert.equal(r.snaps.length, 1); assert.deepEqual(r.snaps[0].picks, { [g6.id]: g6.home.abbr });
  });
  await t('password check is server-side: 200 token = ok, 403 = wrong, 429 = locked, 503 = not set up, network = offline', async () => {
    let body: any;
    const ok = await unlockLeaderboard(' mock-family-password ', (async (u: string, init: any) => { body = JSON.parse(init.body); assert.equal(u, API + '/lb/unlock'); return new Response(JSON.stringify({ token: TOK })); }) as any);
    assert.deepEqual(ok, { status: 'ok', token: TOK }); assert.equal(body.password, 'mock-family-password');
    assert.equal((await unlockLeaderboard('x', (async () => new Response('{}', { status: 403 })) as any)).status, 'wrong');
    assert.equal((await unlockLeaderboard('x', (async () => new Response('{}', { status: 429 })) as any)).status, 'locked');
    assert.equal((await unlockLeaderboard('x', (async () => new Response('{}', { status: 503 })) as any)).status, 'not_setup');
    assert.equal((await unlockLeaderboard('x', (async () => { throw new Error('net'); }) as any)).status, 'offline');
    // a 200 without a real token is not an unlock
    assert.equal((await unlockLeaderboard('x', (async () => new Response('{"records":[]}')) as any)).status, 'offline');
    setLbApi(''); assert.equal((await unlockLeaderboard('x', (async () => { throw new Error('should not call'); }) as any)).status, 'not_setup'); setLbApi(API);
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
