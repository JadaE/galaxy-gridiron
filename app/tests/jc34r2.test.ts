// Run: npx tsx --require ./tests/rn-shim.cjs tests/jc34r2.test.ts  (JC-34 round 2: mocked store and network only; mock ids)
import assert from 'node:assert/strict';
import { setKv, snapshotFor, enqueue, flush, pendingCount, setLbToken, hasLbToken, unlockLeaderboard, setLbApi, joinLeaderboard, setLinkCode, makeLinkCode, logoutLeaderboard, aiDeviceFor } from '../src/picks/sync';
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const mem: Record<string, string> = {};
setKv(async k => mem[k] ?? null, async (k, v) => { mem[k] = v; });
const API = 'https://mock-worker.example.workers.dev', TOK = 'lb_' + 'B'.repeat(43), DEV = 'gg_' + 'C'.repeat(43);
const me = { uid: '1000000000000000031', un: 'mocklinker' };
const pick = { '401873010': { team: 'CHI', week: 7, at: 1, src: 'live' as const } };
const res = (status: number, body: any = {}) => new Response(JSON.stringify(body), { status });
(async () => {
  setLbApi(API);
  console.log('JC-34 round 2 (app side)');
  await t('P2-1: an account already linked on another phone -> "taken", the queued snapshot is kept and the user is asked for a link code', async () => {
    setLbToken(TOK); for (const k of Object.keys(mem)) delete mem[k];
    await enqueue(snapshotFor(me, 2026, 7, pick));
    const r = await flush((async (u: string) => (u.endsWith('/lb/join') ? res(409, { error: 'uid_taken' }) : res(201))) as any);
    assert.match(r.error!, /link code/); assert.equal(r.sent, 0); assert.equal(await pendingCount(), 1);
  });
  await t('P2-1: a link code goes with the next join (once); success shares the snapshot', async () => {
    setLbToken(TOK); setLinkCode('abcd-efgh-jkmn');
    const bodies: any[] = [];
    const r = await flush((async (u: string, init: any) => { if (u.endsWith('/lb/join')) { bodies.push(JSON.parse(init.body)); return res(200, { ok: true }); } return res(201); }) as any);
    assert.equal(bodies[0].link, 'abcd-efgh-jkmn'); assert.equal(r.sent, 1); assert.equal(await pendingCount(), 0);
    setLbToken(TOK);
    await joinLeaderboard(me, (async (u: string, init: any) => { bodies.push(JSON.parse(init.body)); return res(200); }) as any);
    assert.equal(bodies[1].link, undefined, 'the code is not reused');
  });
  await t('P2-1: a wrong or used link code -> "bad_link" (and it is dropped)', async () => {
    setLbToken(TOK); setLinkCode('0000-0000-0000');
    assert.equal(await joinLeaderboard(me, (async () => res(403, { error: 'bad_code' })) as any), 'bad_link');
    assert.equal(await joinLeaderboard(me, (async () => res(409, { error: 'uid_taken' })) as any), 'taken');
  });
  await t('P2-1: "Add another phone" asks the Worker for a code; statuses map cleanly', async () => {
    setLbToken(TOK);
    const ok = await makeLinkCode((async (u: string, init: any) => { assert.equal(u, API + '/lb/link'); assert.equal(init.headers.Authorization, 'Bearer ' + TOK); return res(200, { code: 'AB12-CD34-EF56', expiresInSec: 600 }); }) as any);
    assert.deepEqual(ok, { status: 'ok', code: 'AB12-CD34-EF56' });
    for (const [st, want] of [[403, 'not_joined'], [409, 'full'], [429, 'busy'], [401, 'locked'], [500, 'offline']] as const) {
      setLbToken(TOK); assert.equal((await makeLinkCode((async () => res(st)) as any)).status, want);
    }
  });
  await t('P2-3: an expired/revoked token (401 on /lb/snap) keeps the queued snapshot and locks the board (it used to drop the snapshot)', async () => {
    setLbToken(TOK); for (const k of Object.keys(mem)) delete mem[k];
    await enqueue(snapshotFor(me, 2026, 8, pick));
    const r = await flush((async (u: string) => (u.endsWith('/lb/join') ? res(200) : res(401, { error: 'unpaired' }))) as any);
    assert.match(r.error!, /^locked/); assert.equal(await pendingCount(), 1); assert.equal(hasLbToken(), false);
    setLbToken(TOK);
    assert.equal(await joinLeaderboard({ ...me, uid: '1000000000000000032' }, (async () => res(401)) as any), 'locked');
    assert.equal(hasLbToken(), false);
  });
  await t('P2-3: "Forget the password" revokes the token on the server (POST /lb/logout with that token), then forgets it', async () => {
    setLbToken(TOK);
    const calls: any[] = [];
    await logoutLeaderboard((async (u: string, init: any) => { calls.push([u, init.method, init.headers.Authorization]); return res(200); }) as any);
    assert.deepEqual(calls, [[API + '/lb/logout', 'POST', 'Bearer ' + TOK]]); assert.equal(hasLbToken(), false);
    await logoutLeaderboard((async () => { throw new Error('offline'); }) as any); // no token: nothing sent, no throw
  });
  await t('P2-2: a paired phone sends its AI device token with the unlock, and only to the same Worker', async () => {
    const seen: any[] = [];
    await unlockLeaderboard('mock-pass', (async (_u: string, init: any) => { seen.push(init.headers); return res(200, { token: TOK }); }) as any, aiDeviceFor(API + '/', DEV));
    assert.equal(seen[0]['X-GG-Device'], DEV);
    assert.equal(aiDeviceFor('https://some-other-worker.example.workers.dev', DEV), null);
    assert.equal(aiDeviceFor(null, DEV), null);
    await unlockLeaderboard('mock-pass', (async (_u: string, init: any) => { seen.push(init.headers); return res(200, { token: TOK }); }) as any, null);
    assert.equal(seen[1]['X-GG-Device'], undefined);
  });
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
