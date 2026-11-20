// Run: npx tsx --require ./tests/rn-shim.cjs tests/sync-retry.test.ts
import assert from 'node:assert/strict';
import { setKv, snapshotFor, enqueue, pendingCount, setFamilyKey, hasFamilyKey, _resetInflight } from '../src/picks/sync';
import { deriveFamilyKey, validKey } from '../src/picks/family';
import { backoffMs, BACKOFF_START_MS, BACKOFF_MAX_MS, canAutoFlush, runPickSync, startPickSync, _resetRetryState } from '../src/picks/retry';
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
const mem: Record<string, string> = {};
setKv(async k => mem[k] ?? null, async (k, v) => { mem[k] = v; });
const key = deriveFamilyKey('mock-family-password');
const reset = async () => {
  _resetInflight(); _resetRetryState();
  for (const k of Object.keys(mem)) delete mem[k];
  setFamilyKey(key);
};
const pick = { '401873010': { team: 'CHI', week: 7, at: 1, src: 'live' as const } };
const me = { uid: '1000000000000000012', un: 'mockuser' };

(async () => {
  console.log('Pick-sync retry triggers, backoff, and count');
  await t('backoff doubles and caps; canAutoFlush is false until it elapses', () => {
    assert.equal(backoffMs(0), 0);
    assert.equal(backoffMs(1), BACKOFF_START_MS);
    assert.equal(backoffMs(2), BACKOFF_START_MS * 2);
    assert.ok(backoffMs(20) === BACKOFF_MAX_MS);
    _resetRetryState();
    assert.equal(canAutoFlush(0), true);
  });
  await t('timer and resume respect backoff after a failed flush; launch and manual do not', async () => {
    await reset();
    await enqueue(snapshotFor(me, 2026, 7, pick));
    const fail = await runPickSync('manual', (async () => { throw new Error('net'); }) as any, 1_000);
    assert.equal(fail.error, 'offline'); assert.equal(await pendingCount(), 1);
    const skipped = await runPickSync('timer', (async () => new Response('{}', { status: 201 })) as any, 1_000);
    assert.equal(skipped.error, 'backoff'); assert.equal(await pendingCount(), 1);
    const resumeTooSoon = await runPickSync('resume', (async () => new Response('{}', { status: 201 })) as any, 1_000 + BACKOFF_START_MS - 1);
    assert.equal(resumeTooSoon.error, 'backoff');
    const later = await runPickSync('timer', (async () => new Response('{}', { status: 201 })) as any, 1_000 + BACKOFF_START_MS);
    assert.equal(later.sent, 1); assert.equal(await pendingCount(), 0);
    await enqueue(snapshotFor(me, 2026, 7, pick));
    const failed = await runPickSync('manual', (async () => { throw new Error('net'); }) as any, 10_000);
    assert.equal(failed.error, 'offline');
    const launch = await runPickSync('launch', (async () => new Response('{}', { status: 201 })) as any, 10_000);
    assert.equal(launch.sent, 1);
  });
  await t('startPickSync ticks launch, then resume and timer', async () => {
    await reset();
    await enqueue(snapshotFor(me, 2026, 7, pick));
    const reasons: string[] = [];
    let resume: ((s: string) => void) | undefined;
    let timer: (() => void) | undefined;
    const posts: number[] = [];
    const { stop, ready } = startPickSync({
      getKey: async () => JSON.stringify(key),
      fetcher: (async () => { posts.push(1); return new Response('{}', { status: 201 }); }) as any,
      intervalMs: 10_000,
      addAppStateListener: (cb) => { resume = cb; return () => {}; },
      setIntervalFn: (fn, ms) => { assert.equal(ms, 10_000); timer = fn; return () => {}; },
      onTick: r => reasons.push(r),
    });
    await ready;
    assert.deepEqual(reasons, ['launch']);
    assert.equal(await pendingCount(), 0);
    await enqueue(snapshotFor(me, 2026, 8, { '401873011': { team: 'NE', week: 8, at: 1, src: 'live' } }));
    resume!('active');
    await new Promise(r => setTimeout(r, 20));
    timer!();
    await new Promise(r => setTimeout(r, 20));
    stop();
    assert.ok(reasons.includes('resume') && reasons.includes('timer'), 'got ' + reasons.join(','));
    assert.ok(validKey(key) && hasFamilyKey());
  });
  await t('Waiting to share label is used on the Team and Picks screens', () => {
    const banner = readFileSync(new URL('../src/screens/WaitingToShare.tsx', import.meta.url), 'utf8');
    assert.match(banner, /Waiting to share/);
    const home = readFileSync(new URL('../src/screens/Home.tsx', import.meta.url), 'utf8');
    const picks = readFileSync(new URL('../src/screens/Picks.tsx', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    assert.match(home, /WaitingToShare/);
    assert.match(picks, /WaitingToShare/);
    assert.match(picks, /waiting to share/);
    assert.match(app, /startPickSync/);
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
