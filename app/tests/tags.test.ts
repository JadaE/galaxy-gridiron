// JC-109: trade chips save, restore after a reinstall, and merge. Mock names/IDs and mocked network only.
// Run: npx tsx --require ./tests/rn-shim.cjs tests/tags.test.ts
import assert from 'node:assert/strict';
import { setKv, setFamilyKey, fetchSnaps } from '../src/picks/sync';
import { deriveFamilyKey } from '../src/picks/family';
import { applyChip, parseChipState, serializeChipState, setTagKv, ChipState } from '../src/tags/store';
import { enqueueTags, fetchTagSnaps, flushTags, pendingTagCount, snapshotTags, TAGS_TYP } from '../src/tags/sync';
import { mergeChips, restoreTagsFromServer, restoreTagsMessage, restoreTagsOnStart, saveAndQueueTag, serverSets, snapsFor } from '../src/tags/restore';
import { SITE_ORIGIN as SITE } from '../src/config';

let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };

const mem: Record<string, string> = {};
const reset = () => { for (const k of Object.keys(mem)) delete mem[k]; };
const kvGet = async (k: string) => mem[k] ?? null;
const kvSet = async (k: string, v: string) => { mem[k] = v; };
setKv(kvGet, kvSet);
setTagKv(kvGet, kvSet);

const K = deriveFamilyKey('mock-family-password');
const ME = { uid: '1000000000000000101', username: 'MockUserA' };
const LID = '999000111222';
const empty: ChipState = { tags: {}, at: {}, ts: 0 };

const rec = (o: any) => ({
  id: 'r' + Math.random(),
  createdAt: o.createdAt,
  data: { app: 'gg', typ: TAGS_TYP, uid: ME.uid, un: 'mockusera', league: LID, tags: {}, at: {}, ts: 1, ...o.data },
});
function site(posts: { url: string; body: any; key: string }[], pages: any[][] = [[]]) {
  return (async (u: string, init?: any) => {
    if (init?.method === 'POST') {
      posts.push({ url: u, body: JSON.parse(init.body), key: init.headers['Idempotency-Key'] || init.headers['idempotency-key'] });
      return new Response('{}', { status: 201 });
    }
    if (!u.includes('/' + K.live + '?')) return new Response('{}', { status: 404 });
    const c = Number(new URL(u).searchParams.get('cursor') || 0);
    return new Response(JSON.stringify({ records: pages[c] || [], nextCursor: c + 1 < pages.length ? String(c + 1) : null }));
  }) as any;
}

(async () => {
  console.log('Trade chip save, restore, and merge');

  await t('legacy flat map still loads; v1 keeps per-chip times', () => {
    const legacy = parseChipState(JSON.stringify({ '1001': 'never', '1002': 'high' }));
    assert.deepEqual(legacy.tags, { '1001': 'never', '1002': 'high' });
    assert.equal(legacy.ts, 0);
    const next = applyChip(legacy, '1001', null, 50);
    assert.equal(next.tags['1001'], undefined);
    assert.equal(next.at['1001'], 50);
    const v1 = parseChipState(serializeChipState(next));
    assert.equal(v1.at['1001'], 50);
    assert.equal(v1.tags['1002'], 'high');
  });

  await t('no family password: nothing is sent and restore stays locked', async () => {
    reset(); setFamilyKey(null);
    let called = 0;
    const r = await restoreTagsFromServer(ME, (async () => { called++; return new Response('{}'); }) as any);
    assert.equal(r.status, 'locked'); assert.equal(called, 0);
    const local = applyChip(empty, '1001', 'never', 10);
    await saveAndQueueTag(LID, ME, local);
    assert.equal(await pendingTagCount(), 0);
    const flush = await flushTags((async () => { called++; return new Response('{}', { status: 201 }); }) as any);
    assert.equal(flush.sent, 0); assert.equal(called, 0);
  });

  await t('save queues a typ:tags snapshot and flush posts it to the live collection with Origin + Idempotency-Key', async () => {
    reset(); setFamilyKey(K);
    const local = applyChip(applyChip(empty, '1001', 'never', 10), '1002', 'high', 11);
    await saveAndQueueTag(LID, ME, local);
    assert.equal(await pendingTagCount(), 1);
    const posts: { url: string; body: any; key: string }[] = [];
    const r = await flushTags(site(posts));
    assert.equal(r.sent, 1); assert.equal(await pendingTagCount(), 0);
    assert.equal(posts.length, 1);
    assert.ok(posts[0].url.startsWith(SITE + '/.herenow/data/' + K.live));
    assert.equal(posts[0].body.typ, TAGS_TYP);
    assert.equal(posts[0].body.app, 'gg');
    assert.equal(posts[0].body.uid, ME.uid);
    assert.equal(posts[0].body.league, LID);
    assert.deepEqual(posts[0].body.tags, { '1001': 'never', '1002': 'high' });
    assert.ok(posts[0].key && posts[0].body.ts === 11);
    assert.equal(JSON.parse(mem['tags:' + LID]).tags['1002'], 'high');
  });

  await t('fresh install: empty local picks up the server set for this Sleeper user', async () => {
    reset(); setFamilyKey(K);
    const pages = [[rec({ createdAt: new Date(1_000).toISOString(), data: { tags: { '1001': 'never', '1002': 'high' }, at: { '1001': 1_000, '1002': 1_000 }, ts: 1_000 } })]];
    const r = await restoreTagsFromServer(ME, site([], pages));
    assert.equal(r.status, 'restored');
    assert.equal(r.status === 'restored' && r.n, 2);
    const saved = parseChipState(mem['tags:' + LID]);
    assert.deepEqual(saved.tags, { '1001': 'never', '1002': 'high' });
    assert.equal(restoreTagsMessage(r), 'Restored 2 trade chips from the leaderboard');
    const r2 = await restoreTagsFromServer(ME, site([], pages));
    assert.equal(r2.status, 'none');
  });

  await t('username match is case-insensitive; another user is ignored', () => {
    const snaps = [
      { id: 'a', uid: '9', un: 'MOCKUSERA', league: LID, tags: { '1001': 'never' as const }, at: {}, ts: 1, createdAt: 1 },
      { id: 'b', uid: '1000000000000000202', un: 'mockuserb', league: LID, tags: { '1001': 'high' as const }, at: {}, ts: 2, createdAt: 2 },
    ];
    assert.equal(snapsFor(snaps, { uid: '1', username: 'mockusera' }).length, 1);
    assert.equal(snapsFor(snaps, { uid: '1', username: 'mockuser' }).length, 0);
    const sets = serverSets(snaps, { uid: '1', username: 'MockUserA' });
    assert.equal(sets[LID].tags['1001'], 'never');
  });

  await t('merge: newest wins per chip; a newer local clear is kept; an older local tag loses to the server', () => {
    const server: ChipState = { tags: { '1001': 'never', '1002': 'high' }, at: { '1001': 100, '1002': 100 }, ts: 100 };
    const local: ChipState = {
      tags: { '1002': 'never', '1003': 'high' },
      at: { '1002': 200, '1003': 50, '1001': 40 },
      ts: 200,
    };
    // 1001: local older never-clear? at=40, not in local.tags (cleared at 40) vs server never at 100 -> server never
    // 1002: local never at 200 vs server high at 100 -> local never
    // 1003: local high at 50 vs not on server at 100 (complete set) -> cleared
    const r = mergeChips(local, server, 100);
    assert.equal(r.state.tags['1001'], 'never');
    assert.equal(r.state.tags['1002'], 'never');
    assert.equal(r.state.tags['1003'], undefined);
    assert.ok(r.changed >= 2);
    const kept = mergeChips({ tags: { '1001': 'high' }, at: { '1001': 250 }, ts: 250 }, server, 100);
    assert.equal(kept.state.tags['1001'], 'high');
    assert.equal(kept.state.tags['1002'], 'high');
  });

  await t('a typ:tags record is not treated as a picks snapshot', async () => {
    reset(); setFamilyKey(K);
    const mixed = [[
      rec({ createdAt: new Date(1_000).toISOString(), data: { typ: TAGS_TYP, tags: { '1001': 'never' }, season: 2026, week: 7, picks: {} } }),
    ]];
    const { snaps } = await fetchSnaps(2026, true, site([], mixed));
    assert.equal(snaps.length, 0);
    const tags = await fetchTagSnaps(site([], mixed));
    assert.equal(tags.length, 1);
    assert.equal(tags[0].tags['1001'], 'never');
  });

  await t('restoreOnStart loads the saved family key; 401 drops the queued snapshot and keeps the key', async () => {
    reset(); setFamilyKey(null);
    mem['secret-not-used'] = 'x';
    const pages = [[rec({ createdAt: new Date(1_000).toISOString(), data: { tags: { '1001': 'high' }, ts: 1_000 } })]];
    const r = await restoreTagsOnStart(ME, async () => JSON.stringify(K), site([], pages));
    assert.equal(r.status, 'restored');
    assert.equal(parseChipState(mem['tags:' + LID]).tags['1001'], 'high');
    await enqueueTags(snapshotTags({ uid: ME.uid, un: ME.username }, LID, parseChipState(mem['tags:' + LID])));
    const flushed = await flushTags((async () => new Response('{}', { status: 401 })) as any);
    assert.equal(flushed.error, 'rejected 401');
    assert.equal(await pendingTagCount(), 0);
    const { hasFamilyKey } = await import('../src/picks/sync');
    assert.equal(hasFamilyKey(), true);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
