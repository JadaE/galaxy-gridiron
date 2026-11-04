// v0.0.13: restore your shared picks from the leaderboard. Mock names/IDs and mocked network only.
// Run: npx tsx --require ./tests/rn-shim.cjs tests/v013.test.ts
import assert from 'node:assert/strict';
import fs from 'fs';
import { setKv, setFamilyKey, Snap } from '../src/picks/sync';
import { deriveFamilyKey } from '../src/picks/family';
import { restoreFromServer, mergeRestored, serverPicks, snapsFor, weeksToShare, restoreMessage } from '../src/picks/restore';
import { Game, PickMap } from '../src/picks/core';
import { VERSION_CODE } from '../src/version';
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const byWeek: Record<number, Game[]> = JSON.parse(fs.readFileSync(__dirname + '/fixtures/games-2026-w1-7.json', 'utf8'));
const games: Record<string, Game> = {}; Object.values(byWeek).flat().forEach(g => (games[g.id] = g));
const g6 = byWeek[6][0], g6b = byWeek[6][1], g5 = byWeek[5][0];
const mem: Record<string, string> = {};
setKv(async k => mem[k] ?? null, async (k, v) => { mem[k] = v; });
const K = deriveFamilyKey('mock-family-password');
const ME = { uid: '1000000000000000101', username: 'MockUserA' };
const rec = (o: any) => ({ id: 'r' + Math.random(), createdAt: o.createdAt, data: { app: 'gg', uid: ME.uid, un: 'mockusera', season: 2026, week: 6, bf: {}, ts: 1, ...o.data } });
// live: one page; archive: two pages (nextCursor); plus another user's record
function site(posts: string[], pages = { live: [] as any[][], archive: [] as any[][] }) {
  return (async (u: string, init?: any) => {
    if (init?.method === 'POST') { posts.push(u); return new Response('{}', { status: 201 }); }
    const coll = u.includes('/' + K.archive + '?') ? 'archive' : u.includes('/' + K.live + '?') ? 'live' : '';
    if (!coll) return new Response('{}', { status: 404 });
    const list = pages[coll as 'live' | 'archive']; const c = Number(new URL(u).searchParams.get('cursor') || 0);
    return new Response(JSON.stringify({ records: list[c] || [], nextCursor: c + 1 < list.length ? String(c + 1) : null }));
  }) as any;
}
const before = (g: Game, s = 3600e3) => new Date(g.kickoff - s).toISOString();
const pages = () => ({
  live: [[rec({ createdAt: before(g6), data: { picks: { [g6.id]: g6.home.abbr, [g6b.id]: g6b.away.abbr } } }),
          rec({ createdAt: before(g6), data: { uid: '1000000000000000202', un: 'mockuserb', picks: { [g6.id]: g6.away.abbr } } })]],
  archive: [[], [rec({ createdAt: new Date(g5.kickoff + 9e9).toISOString(), data: { week: 5, oc: g5.kickoff - 7200e3, picks: { [g5.id]: g5.home.abbr } } })]],
});
const deps = (local: { p: PickMap }, fetcher: any, who = ME) => ({ season: 2026, curWeek: 7, who, load: async () => local.p, save: async (p: PickMap) => { local.p = p; },
  loadWeek: async (_s: number, w: number) => byWeek[w] || [], fetcher });

(async () => {
  console.log('Restore picks from the leaderboard');
  await t('no password: nothing is read, asks gently only when the phone has no picks', async () => {
    setFamilyKey(null); let called = 0;
    const r = await restoreFromServer(deps({ p: {} }, (async () => { called++; return new Response('{}'); }) as any));
    assert.equal(r.status, 'locked'); assert.equal(called, 0);
    assert.ok(/password/.test(restoreMessage(r, false))); assert.equal(restoreMessage(r, true), '');
  });
  setFamilyKey(K);
  await t('restores from live AND archive (paged via nextCursor); archive keeps its original time', async () => {
    const local = { p: {} as PickMap }, posts: string[] = [];
    const r = await restoreFromServer(deps(local, site(posts, pages())));
    assert.deepEqual(r, { status: 'restored', n: 3 });
    assert.equal(local.p[g6.id].team, g6.home.abbr); assert.equal(local.p[g6b.id].team, g6b.away.abbr);
    assert.equal(local.p[g5.id].team, g5.home.abbr); assert.equal(local.p[g5.id].at, g5.kickoff - 7200e3); assert.equal(local.p[g5.id].src, 'live');
    assert.equal(restoreMessage(r, false), 'Restored 3 picks from the leaderboard');
    assert.equal(posts.length, 0, 'restore never writes to the site');
  });
  await t('username match is case-insensitive; a wrong username gets nothing', async () => {
    const other = { uid: '1000000000000000303', username: 'MockNobody' };
    const local = { p: {} as PickMap };
    const r = await restoreFromServer(deps(local, site([], pages()), other));
    assert.equal(r.status, 'none'); assert.deepEqual(local.p, {});
    const s = [{ id: 'a', uid: '9', un: 'MOCKUSERA', season: 2026, week: 6, picks: {}, bf: {}, ts: 0, createdAt: 0 } as Snap];
    assert.equal(snapsFor(s, { uid: '1', username: 'mockusera' }).length, 1);
    assert.equal(snapsFor(s, { uid: '1', username: 'mockuser' }).length, 0);
  });
  await t('merge: union; a newer local pick is kept; an older differing one is replaced by the newer server copy', () => {
    const server: PickMap = { a1: { team: 'CHI', week: 6, at: 100, src: 'live' }, a2: { team: 'NE', week: 6, at: 100, src: 'live' }, a3: { team: 'KC', week: 6, at: 100, src: 'live' } };
    const local: PickMap = { a2: { team: 'BUF', week: 6, at: 200, src: 'live' }, a3: { team: 'LV', week: 6, at: 50, src: 'live' }, a9: { team: 'DAL', week: 6, at: 1, src: 'live' } };
    const r = mergeRestored(local, server);
    assert.equal(r.restored, 2); assert.equal(r.picks.a1.team, 'CHI'); assert.equal(r.picks.a2.team, 'BUF'); assert.equal(r.picks.a3.team, 'KC'); assert.equal(r.picks.a9.team, 'DAL');
  });
  await t('running it again adds nothing (deduped)', async () => {
    const local = { p: {} as PickMap };
    await restoreFromServer(deps(local, site([], pages())));
    const n = Object.keys(local.p).length;
    const r2 = await restoreFromServer(deps(local, site([], pages())));
    assert.equal(r2.status, 'none'); assert.equal(Object.keys(local.p).length, n); assert.equal(restoreMessage(r2, true), '');
  });
  await t('kickoff locks: a change sent after kickoff is not restored as the pick', () => {
    const s: Snap[] = [
      { id: 'a', uid: ME.uid, un: 'mockusera', season: 2026, week: 6, picks: { [g6.id]: g6.home.abbr }, bf: {}, ts: 0, createdAt: g6.kickoff - 10 },
      { id: 'b', uid: ME.uid, un: 'mockusera', season: 2026, week: 6, picks: { [g6.id]: g6.away.abbr }, bf: {}, ts: 0, createdAt: g6.kickoff + 10 },
    ];
    assert.equal(serverPicks(s, ME, games)[g6.id].team, g6.home.abbr);
  });
  await t('restored picks are not re-shared on join; picks made on the phone are', () => {
    const p: PickMap = { a: { team: 'CHI', week: 5, at: 1, src: 'live', rs: 1 }, b: { team: 'NE', week: 6, at: 1, src: 'live' } };
    assert.deepEqual(weeksToShare(p), [6]);
    assert.deepEqual(weeksToShare(mergeRestored({}, { a: { team: 'CHI', week: 5, at: 1, src: 'live' } }).picks), []);
  });
  await t('version is 13', () => assert.equal(VERSION_CODE, 13));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
