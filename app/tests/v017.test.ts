// v0.0.17 store/public release: Playoff run tab and reorganized bottom bar
// (Player pickups + Playoff run), plus all v0.0.16 features.
// Feedback stays off. The atomic AI-cap / D1 change is not in this build.
// Run: npx tsx --require ./tests/rn-shim.cjs tests/v017.test.ts
import assert from 'node:assert/strict';
import { VERSION_CODE, VERSION_NAME } from '../src/version';
import { FEEDBACK_ENABLED, CONFIG } from '../src/config';
let pass = 0, fail = 0;
const t = async (n: string, f: () => any) => { try { await f(); pass++; console.log('  ✓', n); } catch (e: any) { fail++; console.log('  ✗', n, '\n     ', e.message); } };
(async () => {
  console.log('v0.0.17 store release');
  await t('version is 0.0.17 (17)', () => { assert.equal(VERSION_CODE, 17); assert.equal(VERSION_NAME, '0.0.17'); });
  await t('feedback is off and no inbox name is bundled', () => {
    assert.equal(FEEDBACK_ENABLED, false);
    assert.equal(CONFIG.feedbackCollection || '', '');
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
