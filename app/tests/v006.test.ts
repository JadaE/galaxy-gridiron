// Run: npx tsx tests/v006.test.ts  (tutorial, feedback, web relay helpers)
import assert from 'node:assert/strict';
import { buildRecord, sendFeedback, FEEDBACK_COLLECTION } from '../src/feedback';
import { relayUrl } from '../src/web';
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
(async () => {
  await t('feedback record: trimmed, capped, version + device attached', () => {
    const r = buildRecord({ kind: 'bug', text: '  chat bar hidden  ' + 'x'.repeat(2000), screen: 'Team', user: 'testuser' });
    assert.equal(r.kind, 'bug'); assert.ok(r.text.startsWith('chat bar hidden')); assert.equal(r.text.length, 1000);
    assert.match(r.app, /^0\.0\.\d+ \(\d+\)/); assert.ok(r.device.length > 0); assert.equal(r.user, 'testuser'); assert.ok(r.ts > 0);
  });
  await t('feedback: unknown kind becomes bug; too-short text rejected', () => { assert.equal(buildRecord({ kind: 'x' as any, text: 'abc' }).kind, 'bug'); assert.throws(() => buildRecord({ kind: 'idea', text: ' a ' })); });
  await t('feedback collection name is long and random-looking', () => { assert.match(FEEDBACK_COLLECTION, /^(fb[0-9a-f]{30}|YOUR_[A-Z_]+)$/); });
  await t('feedback POST goes to the Site Data collection, insert only', async () => {
    let seen: any = null;
    await sendFeedback({ kind: 'idea', text: 'dark mode for picks' }, (async (u: any, o: any) => { seen = { u, o }; return { ok: true, status: 201 } as any; }) as any);
    assert.ok(seen.u.endsWith('/.herenow/data/' + FEEDBACK_COLLECTION)); assert.equal(seen.o.method, 'POST'); assert.equal(JSON.parse(seen.o.body).kind, 'idea');
  });
  await t('feedback: 429 gives a friendly message', async () => { await assert.rejects(sendFeedback({ kind: 'bug', text: 'hello' }, (async () => ({ ok: false, status: 429 })) as any), /Too many/); });
  await t('relay URLs stay under the PWA folder', () => { assert.equal(relayUrl('yt', '?channel_id=UCx'), '/relay/yt?channel_id=UCx'); assert.equal(relayUrl('espn', '/scoreboard'), '/relay/espn/scoreboard'); });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
