// Run: npx tsx tests/v006.test.ts  (tutorial, feedback, web relay helpers)
import assert from 'node:assert/strict';
import { buildRecord, sendFeedback, FEEDBACK_COLLECTION, feedbackOn } from '../src/feedback';
import { relayUrl, shouldShowInstallHint, installHintCopy, isIosDevice } from '../src/web';
import { normalizeSleeperUsername, sleeperUsernameHint, isSleeperUserNotFound } from '../src/username';
import { loadUser } from '../src/model';
import { shouldShowThisWeekPicksCta, THIS_WEEK_PICKS_LABEL, THIS_WEEK_PICKS_TAB } from '../src/picksCta';
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
(async () => {
  await t('feedback record: trimmed, capped, version + device attached', () => {
    const r = buildRecord({ kind: 'bug', text: '  chat bar hidden  ' + 'x'.repeat(2000), screen: 'Team', user: 'testuser' });
    assert.equal(r.kind, 'bug'); assert.ok(r.text.startsWith('chat bar hidden')); assert.equal(r.text.length, 1000);
    assert.match(r.app, /^0\.0\.\d+ \(\d+\)/); assert.ok(r.device.length > 0); assert.equal(r.user, 'testuser'); assert.ok(r.ts > 0);
  });
  await t('feedback: unknown kind becomes bug; too-short text rejected', () => { assert.equal(buildRecord({ kind: 'x' as any, text: 'abc' }).kind, 'bug'); assert.throws(() => buildRecord({ kind: 'idea', text: ' a ' })); });
  // JC-95: store/public web build has feedback off; the inbox name is not bundled.
  await t('feedback is off in the store/public build and no inbox name is bundled', async () => {
    assert.equal(feedbackOn(), false);
    assert.equal(FEEDBACK_COLLECTION, '');
    let calls = 0;
    await assert.rejects(sendFeedback({ kind: 'bug', text: 'hello' }, (async () => { calls++; return { ok: true, status: 201 }; }) as any), /paused/);
    assert.equal(calls, 0);
  });
  await t('relay URLs stay under the PWA folder', () => { assert.equal(relayUrl('yt', '?channel_id=UCx'), '/relay/yt?channel_id=UCx'); assert.equal(relayUrl('espn', '/scoreboard'), '/relay/espn/scoreboard'); });
  await t('install hint: only in a browser tab, not after Home Screen or dismiss', () => {
    assert.equal(shouldShowInstallHint({ web: true, standalone: false, dismissed: false }), true);
    assert.equal(shouldShowInstallHint({ web: true, standalone: true, dismissed: false }), false);
    assert.equal(shouldShowInstallHint({ web: true, standalone: false, dismissed: true }), false);
    assert.equal(shouldShowInstallHint({ web: false, standalone: false, dismissed: false }), false);
  });
  await t('install hint: iPhone copy names Share and Add to Home Screen; others name the browser menu', () => {
    const ios = installHintCopy('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    assert.match(ios.title, /Home Screen/);
    assert.match(ios.steps, /Share/);
    assert.match(ios.steps, /Add to Home Screen/);
    assert.match(ios.body, /clears? your picks|clear your picks/);
    const other = installHintCopy('Mozilla/5.0 (Linux; Android 14)');
    assert.match(other.steps, /browser menu/);
    assert.doesNotMatch(other.steps, /Share \(the square/);
  });
  await t('signup tutorial tells new players to add the Home Screen icon before entering a username', () => {
    const tut = readFileSync(new URL('../src/screens/Tutorial.tsx', import.meta.url), 'utf8');
    const signup = tut.split('if (signup)')[1] || '';
    assert.match(signup, /Home Screen/);
    const replayBody = tut.split('if (signup)')[0];
    assert.doesNotMatch(replayBody, /Home Screen/);
  });
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  await t('iPadOS 13+ desktop Macintosh UA with touch is treated as iPad and gets Share then Add to Home Screen', () => {
    assert.equal(isIosDevice(MAC, 0), false);
    assert.equal(isIosDevice(MAC, 1), false);
    assert.equal(isIosDevice(MAC, 2), true);
    assert.equal(isIosDevice(MAC, 5), true);
    const ipad = installHintCopy(MAC, 5);
    assert.match(ipad.steps, /Share/);
    assert.match(ipad.steps, /Add to Home Screen/);
    const mac = installHintCopy(MAC, 0);
    assert.match(mac.steps, /browser menu/);
    assert.doesNotMatch(mac.steps, /Share \(the square/);
    const named = installHintCopy('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', 0);
    assert.match(named.steps, /Share/);
  });
  await t('install note covers iPad Share then Add to Home Screen', () => {
    const note = readFileSync(new URL('../../docs/IPHONE_INSTALL.md', import.meta.url), 'utf8');
    assert.match(note, /iPad/);
    assert.match(note, /Share/);
    assert.match(note, /Add to Home Screen/);
  });
  await t('username entry trims whitespace and one leading @', () => {
    assert.equal(normalizeSleeperUsername('  MockUserA  '), 'MockUserA');
    assert.equal(normalizeSleeperUsername('@MockUserA'), 'MockUserA');
    assert.equal(normalizeSleeperUsername('  @MockUserA  '), 'MockUserA');
    assert.equal(normalizeSleeperUsername('@@MockUserA'), '@MockUserA'); // only one leading @
    assert.equal(normalizeSleeperUsername(' @ '), '');
    assert.equal(normalizeSleeperUsername(''), '');
  });
  await t('failed Sleeper lookup explains username vs display name and where to find it', () => {
    const msg = sleeperUsernameHint(' @MockDisplay ');
    assert.match(msg, /No Sleeper user named "MockDisplay"/);
    assert.match(msg, /not your display name/);
    assert.match(msg, /profile icon in the bottom-left corner/);
    assert.equal(isSleeperUserNotFound(new Error('No Sleeper user named "MockDisplay"')), true);
    assert.equal(isSleeperUserNotFound(new Error('HTTP 404')), true);
    assert.equal(isSleeperUserNotFound(new Error('HTTP 500')), false);
    assert.equal(isSleeperUserNotFound(new Error('Failed to fetch')), false);
  });
  await t("'@@x' is looked up and stored as '@x' (normalize once; lookup matches storage)", async () => {
    const stored = normalizeSleeperUsername('@@x');
    assert.equal(stored, '@x');
    const seen: string[] = [];
    const prev = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const path = String(url);
      if (path.includes('/user/')) {
        seen.push(decodeURIComponent(path.split('/user/')[1]));
        return new Response(JSON.stringify({ user_id: '1000000000000000999', username: seen[0] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('unexpected fetch ' + path);
    }) as any;
    try {
      const u = await loadUser(stored);
      assert.equal(seen.length, 1);
      assert.equal(seen[0], '@x');
      assert.equal(seen[0], stored);
      assert.equal(u.username, '@x');
    } finally { globalThis.fetch = prev; }
  });
  await t("Team tab shows Make this week's picks and opens the Picks tab for the current season", () => {
    assert.equal(THIS_WEEK_PICKS_LABEL, "Make this week's picks");
    assert.equal(THIS_WEEK_PICKS_TAB, 'Picks');
    assert.equal(shouldShowThisWeekPicksCta({ isPast: false }), true);
    assert.equal(shouldShowThisWeekPicksCta({ isPast: true }), false);
    const home = readFileSync(new URL('../src/screens/Home.tsx', import.meta.url), 'utf8');
    assert.match(home, /shouldShowThisWeekPicksCta/);
    assert.match(home, /go\(THIS_WEEK_PICKS_TAB\)/);
    assert.match(home, /THIS_WEEK_PICKS_LABEL/);
  });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
